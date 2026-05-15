# Deploy Bubblle on AWS (MVP)

This app is **one Docker image** running **Daphne (ASGI)** with **WebSockets**, **PostgreSQL**, and **Redis**. The path that matches that shape with minimal moving parts is **ECS Fargate** in front of an **Application Load Balancer**, plus **RDS** and **ElastiCache**.

## What you are deploying

| Piece | AWS service |
|--------|-------------|
| HTTPS + WebSockets | **Application Load Balancer (ALB)** → target group → containers on **port 8000** |
| App container | **ECS Fargate** (same image as local Docker) |
| Postgres | **RDS PostgreSQL** |
| Redis (Channels + cache + rate limits) | **ElastiCache for Redis** |
| Container image | **ECR** |
| Secrets | **Secrets Manager** or **SSM Parameter Store** (recommended for `DJANGO_SECRET_KEY`, DB password) |

Optional: **Route 53** for DNS, **ACM** for TLS on the ALB.

The repo ships **WhiteNoise** so `/static/` is served by Django in the container (no S3 required for MVP).

---

## 1. Network

1. Use a **VPC** with **two+ public subnets** (ALB) and **two+ private subnets** (ECS tasks, RDS, Redis).
2. **NAT Gateway** (or NAT per AZ) so private subnets can pull images and reach AWS APIs.

---

## 2. RDS (PostgreSQL)

1. Create **RDS PostgreSQL** (e.g. 16) in **private subnets**.
2. Security group **inbound**: **5432** from the **ECS tasks security group** only.
3. Note: endpoint, port, database name, master user, password → map to `POSTGRES_*` env vars.

---

## 3. ElastiCache (Redis)

1. Create a **Redis** cluster in the **same VPC** as ECS (private subnets).
2. Security group **inbound**: **6379** from the **ECS tasks security group** only.
3. Use the primary endpoint as `REDIS_URL`, e.g. `redis://your-redis.xxx.cache.amazonaws.com:6379/0`
4. If you enable **AUTH**, use `redis://:PASSWORD@endpoint:6379/0` (store password in Secrets Manager).

---

## 4. ECR + image

```bash
aws ecr create-repository --repository-name bubblle --region YOUR_REGION

aws ecr get-login-password --region YOUR_REGION | docker login --username AWS --password-stdin YOUR_ACCOUNT.dkr.ecr.YOUR_REGION.amazonaws.com

docker build -t bubblle:latest .
docker tag bubblle:latest YOUR_ACCOUNT.dkr.ecr.YOUR_REGION.amazonaws.com/bubblle:latest
docker push YOUR_ACCOUNT.dkr.ecr.YOUR_REGION.amazonaws.com/bubblle:latest
```

---

## 5. Application Load Balancer (critical for WebSockets)

1. **ALB** in public subnets, **listener HTTPS (443)** with an **ACM** certificate for your domain.
2. **Target group**: type **IP** (Fargate), protocol **HTTP**, port **8000**, health check path **`/api/health/`**, matcher **200**.
3. **Idle timeout**: under ALB attributes, raise **idle timeout** (e.g. **3600** seconds) so long‑lived WebSocket connections are less likely to drop when quiet.
4. **Sticky sessions** are **not** required for Django Channels when Redis is the channel layer (shared state).

---

## 6. ECS Fargate

1. **Cluster** → **Task definition**:
   - **Image**: your ECR URI.
   - **Port mapping**: container **8000**, protocol TCP.
   - **CPU / memory**: start e.g. **0.5 vCPU / 1 GB** and tune.
2. **Environment variables** (non-secret can be plain env; secrets from Secrets Manager):

| Variable | Example / note |
|----------|----------------|
| `DJANGO_SECRET_KEY` | Long random string (secret) |
| `DJANGO_DEBUG` | `0` |
| `DJANGO_ALLOWED_HOSTS` | `yourdomain.com,alb-dns-name.elb.amazonaws.com` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://yourdomain.com` (comma‑separated if several) |
| `SESSION_COOKIE_SECURE` | `1` (HTTPS only) |
| `POSTGRES_HOST` | RDS endpoint |
| `POSTGRES_PORT` | `5432` |
| `POSTGRES_DB` | your DB name |
| `POSTGRES_USER` | your user |
| `POSTGRES_PASSWORD` | from secret |
| `REDIS_URL` | ElastiCache URL |

3. **Service**: Fargate, desired count ≥ 1, attach to the **target group**, subnets **private**, public IP **disabled** if using NAT.

---

## 7. Database migrations

Run migrations **once per release** (not on every task start in prod if you prefer clean startups):

```bash
# Example: one-off ECS task with same image, command override:
python manage.py migrate --noinput
```

Use **ECS “Run task”** with the same task definition but **command override**, or a tiny **CodeDeploy / CI job** that runs the container with that command.

---

## 8. Expired bubbles worker

Your `docker-compose` uses a sidecar loop calling `expire_bubbles`. On ECS you can:

- Add a **second service** with the same image, desired count 1, command override:  
  `sh -c 'while true; do python manage.py expire_bubbles; sleep 60; done'`  
  or  
- Use **EventBridge** + **ECS scheduled task** every minute to run `python manage.py expire_bubbles`.

---

## 9. Production checklist

- [ ] `DJANGO_DEBUG=0`, strong `DJANGO_SECRET_KEY`
- [ ] `DJANGO_ALLOWED_HOSTS` includes your real hostname (and ALB DNS if you hit it directly)
- [ ] `DJANGO_CSRF_TRUSTED_ORIGINS` includes `https://your-hostname`
- [ ] `SESSION_COOKIE_SECURE=1` behind HTTPS
- [ ] RDS and Redis **not** publicly accessible; only ECS SG inbound
- [ ] ALB **HTTPS** only for users (redirect HTTP→HTTPS)
- [ ] Health check **`/api/health/`** returning 200
- [ ] **One** Redis for both Channels and Django cache (as in this project) — scale ECS tasks horizontally; do **not** run multiple Redis instances for the same logical layer without changing config

---

## Simpler alternative: single EC2

For the smallest bill / fastest manual path: one **EC2** in a public subnet, **Docker Compose** on the host with RDS + ElastiCache still managed, or Redis/Postgres on the same box (not ideal for prod). Put **Caddy** or **nginx** in front for TLS and proxy to Daphne. This is fine for a **private beta**, not for HA.

---

## Lightsail containers

**Lightsail** can run a **container service** with a public load balancer, but WebSocket + multi-service (worker) is less standard than ECS. Possible for a small demo; use **ECS** if you expect to grow.

---

## Need help choosing?

- **Default recommendation:** **ECS Fargate + ALB + RDS + ElastiCache** as above.  
- **Tightest budget / solo hack:** **EC2 + Docker Compose** + managed RDS + ElastiCache.

If you tell me your preferred region and whether you already have a domain in Route 53, the next concrete step is usually: **create RDS + Redis + ECR push + ALB + first ECS service** in that order.
