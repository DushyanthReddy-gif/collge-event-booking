# College Event Booking & Management System

A full-stack DBMS project: **Next.js + TypeScript + Tailwind** on top of **PostgreSQL** (transactions), **Neo4j** (graph recommendations) and **pgvector** (semantic search).

| Role | What they can do |
|---|---|
| Student | register, log in, browse/search events (keyword or semantic), book a seat, cancel, see bookings, rate attended events, get graph recommendations |
| Organizer | create/edit/publish/cancel own events, see participants, mark attendance, view statistics |
| Admin | system statistics, manage users, events, venues, categories, view all bookings |

Authorisation is enforced on the server (API guards + ownership checks + database triggers), not just in the UI.

## Prerequisites
* Node.js 20 or newer (developed on 22) and npm
* Docker + Docker Compose (for PostgreSQL+pgvector and Neo4j)
* Internet access on the first `npm run setup` (downloads the ~25 MB embedding model once; see *Offline* below)

## Setup (clean machine)
```bash
unzip College_Event_Booking_Management_System.zip
cd College_Event_Booking_Management_System

cp .env.example .env            # then edit SESSION_SECRET (openssl rand -base64 48)
npm install
docker compose up -d            # PostgreSQL + pgvector on :5432, Neo4j on :7474/:7687
docker compose ps               # wait until both are "healthy" (Neo4j: up to ~1 min)

npm run setup                   # schema + seed data (PostgreSQL), embeddings (pgvector), graph (Neo4j)
npm run dev                     # http://localhost:3000
```
On Windows use the same commands in PowerShell (`copy .env.example .env`).

Demo logins (password for all: `Password@123`): `admin@college.edu`, `rajesh.kumar@college.edu` (organizer), `priya.menon@college.edu` (organizer), `aarav.sharma@college.edu` (student) and nine more students.

## Useful commands
| Command | Purpose |
|---|---|
| `npm run setup` | full reset: PostgreSQL + embeddings + Neo4j graph |
| `npm run db:reset` / `db:embed` / `neo4j:setup` | the individual steps |
| `npm test` | 38 tests (start `npm run dev` first) |
| `npm run typecheck` / `npm run build` | static checks |
| `docker compose exec -T postgres psql -U ceb_user -d college_events -f /db/demo/03_queries.sql` | run an SQL demo (`01_ddl`, `02_dml`, `03_queries`, `04_advanced`, `05_vector`, `99_drop_demo`) |
| `docker compose exec -T neo4j cypher-shell -u neo4j -p ceb_neo4j_password -f /db/nosql/02_demo.cypher` | Neo4j READ/CREATE/UPDATE/DELETE demo |

## Offline / no model download
Set `EMBEDDING_PROVIDER=hash` in `.env` before `npm run setup`. Semantic search then uses a lightweight lexical fallback instead of the MiniLM model (see `docs/VECTOR_SEARCH.md`).

## Project structure
```text
src/app/            pages and API route handlers (src/app/api/**)
src/components/     UI components (event manager, admin panel, dashboards ...)
src/lib/db/         pg pool, transactions, error mapping
src/lib/auth/       passwords (bcrypt), sessions (JWT cookie), guards, interests
src/lib/events/     event services, participants/attendance/feedback, statistics
src/lib/bookings/   concurrency-safe booking transaction
src/lib/neo4j/      driver (circuit breaker), PostgreSQL->graph sync, recommendations
src/lib/embeddings/ local embedding model + event embedding storage
src/lib/search/     keyword + semantic (pgvector) search
src/lib/admin/      admin services
src/schemas/        Zod validation schemas
db/schema/          001_schema.sql, 002_advanced.sql (functions/triggers/procedures/views), 003_vector.sql
db/seed/            001_seed.sql (demo data)
db/demo/            01_ddl, 02_dml, 03_queries, 04_advanced, 05_vector, 99_drop_demo
db/nosql/           01_schema.cypher, 02_demo.cypher
docs/               ER diagram, database design, SQL, NoSQL, vector, API, demo guide, testing, report
scripts/            db-setup, embed-events, neo4j-setup
tests/              Vitest suites
docker-compose.yml  PostgreSQL+pgvector and Neo4j
```

## Documentation
[ER diagram](docs/ER_DIAGRAM.md) - [Database design](docs/DATABASE_DESIGN.md) - [SQL queries](docs/SQL_QUERIES.md) - [NoSQL / Neo4j](docs/NOSQL.md) - [Vector search](docs/VECTOR_SEARCH.md) - [API](docs/API_DOCUMENTATION.md) - [**Demo guide**](docs/DEMO_GUIDE.md) - [Testing](docs/TESTING.md) - [Project report](docs/PROJECT_REPORT.md)

## Original Contributions
Beyond basic CRUD: concurrency-safe booking (row lock + trigger, tested with parallel requests), database-enforced role/business rules, semantic search with pgvector,
explained graph recommendations from Neo4j with PostgreSQL fallback, hierarchical categories with recursive queries, attendance analytics, attendance-gated feedback, role-specific workspaces,
and atomic event cancellation by stored procedure. Details: [docs/PROJECT_REPORT.md](docs/PROJECT_REPORT.md#6-original-contributions).

## Known limitations
The Neo4j projection is eventually consistent (repair: `npm run neo4j:setup`); no login rate limiting or password reset; the offline `hash` embedding provider is lexical, not truly semantic.
