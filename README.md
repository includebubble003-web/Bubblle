# Bubblle — Anonymous realtime geo chat (MVP)

Temporary **bubbles** (geo-fenced chat rooms) backed by **Django + DRF + Channels**, **Redis** (channel layer + rate limits + ephemeral counters), and **PostgreSQL**. The browser UI is **Django templates + vanilla JS** (no React), tuned for **mobile-first** dark UI and **WebSocket-first** chat.

## Architecture (simple)

| Layer | Role |
|--------|------|
| **Django HTTP** | Templates (`/`, `/bubble/<uuid>/`), REST JSON under `/api/`. |
| **Django Channels** | WebSocket `/ws/bubble/<uuid>/` for live messages, typing, presence, online count. |
| **PostgreSQL** | `Bubble`, `Message`, `AnonymousSession` — durable truth. |
| **Redis** | Channels layer groups; Django cache for online counts, message/typing throttles, `django-ratelimit`. |

**Anonymous identity:** `GET /api/me/` creates or resumes an `AnonymousSession`, sets HttpOnly cookie `bbl_anon` (`session_uuid`). Display name is cached in `localStorage` for instant UI labels. WebSockets reuse the same cookie via `SessionAuthMiddleware`.

**Geo:** Haversine distance in meters (no PostGIS). **Discovery:** client sends `lat,lng` + `search_radius_m`; server filters active bubbles. **Join/chat:** client must be within each bubble’s `radius` meters of its center.

**Expiry:** `expires_at` on `Bubble`; `expire_bubbles` management command (Compose `expiry-worker` loop) sets `active=False`. APIs and consumers reject inactive/expired bubbles.

## Folder structure

```
Bubblle/
├── manage.py
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── bubblle/                 # Django project (settings, asgi, urls)
├── sessions_app/            # AnonymousSession + /api/me/
├── bubbles/                 # Bubble, Message, REST, Channels consumer, routing
├── templates/
├── static/
│   ├── css/app.css
│   └── js/{session.js,app.js,bubble.js}
```

## Quick start (Docker)

1. Copy env and adjust secrets for anything public:

   ```bash
   cp .env.example .env
   ```

2. Build and run:

   ```bash
   docker compose up --build
   ```

3. Open **http://localhost:8000** — allow geolocation in the browser.

Services: **web** (Daphne + ASGI), **db** (Postgres), **redis**, **expiry-worker** (minute cron loop calling `expire_bubbles`).

## Local development (without Docker)

Prerequisites: Python 3.12+, Postgres, Redis.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: POSTGRES_HOST=localhost, REDIS_URL=redis://127.0.0.1:6379/0
createdb bubblle   # or use your superuser to create DB/user matching .env
python manage.py migrate
daphne -b 127.0.0.1 -p 8000 bubblle.asgi:application
```

Workflow: change code → Daphne reloads on restart (use `runserver` only if you accept **no WebSockets**; this project targets **Daphne/ASGI**).

## REST API

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/me/` | Bootstrap anonymous session; sets `bbl_anon` cookie. |
| `POST` | `/api/bubbles/` | Create bubble (`title`, `latitude`, `longitude`, `radius`, `expires_in_seconds`). |
| `GET` | `/api/bubbles/nearby/?lat=&lng=&search_radius_m=` | Active bubbles with `distance_m`, `remaining_seconds`, `online_count`. |
| `GET` | `/api/bubbles/<uuid>/?lat=&lng=` | Detail + distance when coords passed. |
| `GET` | `/api/bubbles/<uuid>/messages/?limit=` | Recent messages. |
| `POST` | `/api/bubbles/<uuid>/messages/` | JSON `{ "message", "latitude", "longitude" }` (geofence + cookie session). |
| `GET` | `/api/health/` | Liveness. |

Rate limits (Redis-backed via `django-ratelimit`) are applied on hot paths (see `sessions_app/views.py`, `bubbles/views.py`).

## WebSocket protocol

Connect (after `/api/me/` and with location):

`ws(s)://<host>/ws/bubble/<bubble_uuid>/?lat=<>&lng=<>`

Client → server JSON:

- `{ "type": "chat", "message": "...", "latitude": ..., "longitude": ... }`
- `{ "type": "typing", "typing": true|false, "latitude": ..., "longitude": ... }`

Server → client JSON:

- `{ "type": "chat", "payload": { id, anonymous_name, message, created_at } }`
- `{ "type": "presence", "event": "user_joined"|"user_left", "name": "...", "online": N }`
- `{ "type": "typing", "name": "...", "typing": bool }`
- `{ "type": "error", "code": "slow_down"|"out_of_radius"|"bubble_closed" }`

## Security notes (MVP)

- **No login** — abuse mitigation is **IP rate limits**, **per-session message throttle** (REST + WS, Redis), **bubble expiry**, **geofence checks** on REST POST and WS frames, and **WS connect** validation (active bubble + inside radius).
- **Production:** set `DJANGO_DEBUG=0`, strong `DJANGO_SECRET_KEY`, `SESSION_COOKIE_SECURE=1` behind HTTPS, tighten `DJANGO_ALLOWED_HOSTS`, and put the app behind a reverse proxy with TLS.

## Admin

Create a superuser with `python manage.py createsuperuser`, then visit `/admin/` to inspect bubbles, messages, and sessions.

## Deploying to AWS

See **[docs/AWS_DEPLOY.md](docs/AWS_DEPLOY.md)** for ECS Fargate + ALB + RDS + ElastiCache, health checks, WebSocket idle timeout, migrations, and the expiry worker.
