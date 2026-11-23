# API Documentation

Base URL `http://localhost:3000`. All bodies are JSON. Errors have the shape `{ "error": "message", "details": [...] }`.
Authentication is a signed, `httpOnly`, `SameSite=Lax` cookie `ceb_session` (JWT, 8 h) set by login/register.
Roles are loaded from PostgreSQL on every request; a deactivated user loses access immediately.

Status codes: `400` validation / database rule, `401` not logged in, `403` wrong role or not the owner, `404` not found, `409` conflict (duplicate, full, wrong state).

## Authentication
| Method & path | Role | Body | Result |
|---|---|---|---|
| `POST /api/auth/register` | public | `{fullName, email, password, department?}` | 201 `{user}` + cookie. **Always creates a student** (a `role` field is ignored) |
| `POST /api/auth/login` | public | `{email, password}` | 200 `{user, redirectTo}` + cookie; 401 on bad credentials |
| `POST /api/auth/logout` | any | - | clears the cookie |
| `GET /api/auth/me` | any | - | `{user}` or `{user: null}` |

## Events
| Method & path | Role | Notes |
|---|---|---|
| `GET /api/events` | public | query: `q, categoryId, venueId, when=upcoming\|past\|all, limit, offset`. Only published/completed events. `scope=manage` (organizer: own events, admin: all, incl. drafts/cancelled) |
| `GET /api/events/:id` | public | detail + `viewer` block (own booking, attended, feedback, canManage). Drafts only visible to owner/admin (otherwise 404) |
| `POST /api/events` | organizer, admin | `{title, description, categoryId, venueId, startTime, endTime, capacity, status: draft\|published}` -> 201 `{eventId}`; embedding + graph sync happen automatically |
| `PUT /api/events/:id` | owner organizer, admin | partial update; 409 if cancelled/completed |
| `DELETE /api/events/:id` | owner organizer, admin | only drafts |
| `POST /api/events/:id/status` | owner organizer, admin | `{status: "published"}` publishes a draft; `{status: "cancelled"}` calls stored procedure `cancel_event` and returns `{cancelledBookings}` |
| `GET /api/events/:id/similar` | public | pgvector nearest neighbours |
| `GET /api/events/:id/stats` | owner organizer, admin | fill %, attendance %, cancellations, bookings per day, rating distribution |

## Booking
| Method & path | Role | Notes |
|---|---|---|
| `POST /api/events/:id/book` | **student** | transaction + `SELECT ... FOR UPDATE`; 201 `{bookingId}`; 409 if full / duplicate / not open |
| `POST /api/events/:id/cancel` | **student** | cancels the caller's own confirmed booking; 404 if none; 409 once the event started |
| `GET /api/bookings` | any logged-in | student: own; organizer: bookings of own events; admin: all. Optional `?eventId=` |

## Attendance and feedback
| Method & path | Role | Notes |
|---|---|---|
| `GET /api/events/:id/participants` | owner organizer, admin | confirmed participants with attendance state |
| `PUT /api/events/:id/attendance` | owner organizer, admin | `{records:[{bookingId, attended}]}` all-or-nothing; trigger rejects non-confirmed bookings (409) |
| `GET /api/events/:id/feedback` | public | author = first name only (full name for organizer/admin) |
| `POST /api/events/:id/feedback` | **student** | `{rating 1-5, comment?}`; only if marked present (403 otherwise); once per event (409) |

## Search and recommendations
| Method & path | Role | Notes |
|---|---|---|
| `GET /api/search` | public | `q`, `mode=keyword\|semantic`, `categoryId`, `when`, `limit`. Semantic results include `similarity` (0-1) |
| `GET /api/recommendations` | **student** | Neo4j graph recommendations with `reasons`; `source` is `neo4j` or `postgres-fallback` |
| `GET/PUT /api/interests` | **student** | `{categoryIds:[...]}` (becomes `LIKES` edges) |
| `GET /api/meta` | public | categories (with path/depth) and active venues |

## Organizer / admin
| Method & path | Role | Notes |
|---|---|---|
| `GET /api/organizer/stats` | organizer, admin | totals and per-event table for the caller's events |
| `GET /api/admin/stats` | **admin** | users/events/bookings by status, popularity ranking (window function), bookings per day, category breakdown |
| `GET /api/admin/users`, `PATCH /api/admin/users/:id` | **admin** | `{isActive?, role?}`; an admin cannot change themselves |
| `GET/POST /api/admin/venues`, `PUT/DELETE /api/admin/venues/:id` | **admin** | delete is refused (409) while events use the venue; capacity below a planned event is refused by trigger |
| `POST /api/admin/categories`, `PUT/DELETE /api/admin/categories/:id` | **admin** | parent cycles rejected using a recursive query |
| `POST /api/admin/complete-events` | **admin** | calls procedure `complete_finished_events()` |

## Authorisation proof
`tests/api.test.ts > unauthorised access and role restrictions` calls the API directly (no UI) as anonymous, student, organizer and admin and checks 401/403/200.
Examples you can run with curl are in [DEMO_GUIDE.md](DEMO_GUIDE.md) (step "Prove RBAC without the UI").
