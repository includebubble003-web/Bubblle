# Map architecture — communities & questions

Bubblle treats **communities** (chat bubbles) and **questions** as two content types in the same local discovery ecosystem. Both appear on the map as first-class location entities.

## What is a map marker?

A map marker is a **Leaflet pin** representing one discoverable location entity near the user. Each marker is normalized on the frontend into a unified shape:

```json
{
  "id": "uuid",
  "type": "community" | "question",
  "title": "Software Engineers",
  "latitude": 20.937,
  "longitude": 77.779,
  "href": "/bubble/{id}/" | "/question/{id}/"
}
```

Additional fields (reply counts, active users, distance) are used for badges and preview cards but do not change marker behavior.

## Data sources

| Entity | API | Coordinates from |
|--------|-----|------------------|
| Community | `GET /api/bubbles/nearby/` | `Bubble.latitude`, `Bubble.longitude` |
| Question | `GET /api/questions/nearby/` | `Question.latitude`, `Question.longitude` |

Both endpoints accept `lat`, `lng`, and `search_radius_m`. The client polls them in parallel from `chat-app.js` and passes results to `map-home.js`.

Each API row includes a `type` field (`community` or `question`) for clarity. The frontend normalizes rows via `static/js/map-entities.js`.

## Domain model

### Bubble (community)

A **Bubble** is a geo-fenced group chat at a fixed location. It is the unit of community conversation.

- Location: `Bubble.latitude`, `Bubble.longitude`, `Bubble.radius`
- Map marker → opens community chat at `/bubble/{id}/`

### Question

A **Question** is location-scoped anonymous Q&A. It has **its own coordinates**, independent of any linked community.

- Location: `Question.latitude`, `Question.longitude` (always used for map placement)
- Map marker → opens question detail at `/question/{id}/`

### `Question.bubble` (optional FK)

```python
bubble = models.ForeignKey(Bubble, null=True, blank=True, on_delete=models.SET_NULL)
```

This FK is **not** used for map placement. It is an optional **community tag** — e.g. “Best Coffee for WFH?” tagged under “Coffee Lovers” for context in feeds and the ask flow.

| Concern | Source |
|---------|--------|
| Where does the question appear on the map? | `Question.latitude/longitude` |
| Which community is it related to? | `Question.bubble` (optional) |
| Where does the community appear on the map? | `Bubble.latitude/longitude` |

Questions and communities can share similar coordinates (seed data adds small jitter) but remain separate entities with separate markers.

## Frontend flow

```
chat-app.js
  └─ fetch /api/bubbles/nearby/ + /api/questions/nearby/
       └─ onMapBubblesUpdated(bubbles, questions)
            └─ map-home.js
                 ├─ buildMapEntities() → unified list
                 ├─ syncMapEntities() → Leaflet markers (❓ / 💬)
                 └─ marker click → preview card → navigate by type
```

### Marker click behavior

1. User taps marker
2. Preview card appears (title, stat line, action button)
3. User taps **Open Discussion** or **Open Community** → navigates to destination

Both types follow the same interaction pattern. Feed cards still navigate directly; map taps show the preview first.

### Marker rendering

- **Question:** ❓ fixed 40×40 px pin
- **Community:** 💬 fixed 40×40 px pin
- Badge: reply count (questions) or active member count (communities)
- Questions render above communities when overlapping (`zIndexOffset`)

Implementation: `static/js/map-entities.js` + `static/css/map.css` (`.map-pin-*`).

## Files

| File | Role |
|------|------|
| `bubbles/models.py` | `Bubble`, `Question`, optional `Question.bubble` |
| `bubbles/services.py` | Serialization + `type` field |
| `static/js/map-entities.js` | Unified entity model, pin HTML, preview HTML |
| `static/js/map-home.js` | Leaflet sync, preview UI, navigation |
| `static/css/map.css` | Pin and preview styles |
