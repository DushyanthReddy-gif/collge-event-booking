# ER Diagram

This diagram is generated from the **implemented** schema (`db/schema/001_schema.sql` + `003_vector.sql`), not from an imaginary design.
It renders on GitHub, in VS Code (Markdown Preview Mermaid Support) and at <https://mermaid.live>.

```mermaid
erDiagram
    ROLES ||--o{ USERS : "has (role_id)"
    USERS ||--o{ EVENTS : "organizes (organizer_id)"
    USERS ||--o{ BOOKINGS : "makes (student_id)"
    USERS ||--o{ FEEDBACK : "writes (student_id)"
    USERS ||--o{ ATTENDANCE : "marks (marked_by)"
    USERS ||--o{ STUDENT_INTERESTS : "likes (student_id)"
    CATEGORIES ||--o{ CATEGORIES : "parent of (parent_category_id)"
    CATEGORIES ||--o{ EVENTS : "classifies (category_id)"
    CATEGORIES ||--o{ STUDENT_INTERESTS : "liked in (category_id)"
    VENUES ||--o{ EVENTS : "hosts (venue_id)"
    EVENTS ||--o{ BOOKINGS : "receives (event_id)"
    EVENTS ||--o{ FEEDBACK : "gets (event_id)"
    BOOKINGS ||--o| ATTENDANCE : "recorded as (booking_id)"

    ROLES {
        smallint role_id PK
        varchar role_name UK "student | organizer | admin"
        text description
    }
    USERS {
        int user_id PK
        varchar full_name
        varchar email UK
        text password_hash "bcrypt"
        smallint role_id FK
        varchar department
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }
    CATEGORIES {
        int category_id PK
        varchar name UK
        text description
        int parent_category_id FK "self reference"
    }
    VENUES {
        int venue_id PK
        varchar name UK
        varchar location
        int capacity "CHECK > 0"
        boolean is_active
    }
    EVENTS {
        int event_id PK
        varchar title
        text description
        int category_id FK
        int venue_id FK
        int organizer_id FK
        timestamptz start_time
        timestamptz end_time "CHECK > start_time"
        int capacity "CHECK > 0, <= venue capacity (trigger)"
        varchar status "draft|published|cancelled|completed"
        timestamptz cancelled_at "set by trigger"
        vector_384 embedding "pgvector"
    }
    BOOKINGS {
        int booking_id PK
        int event_id FK
        int student_id FK
        varchar status "confirmed | cancelled"
        timestamptz booked_at
        timestamptz cancelled_at "set by trigger"
    }
    ATTENDANCE {
        int attendance_id PK
        int booking_id FK "UNIQUE"
        boolean attended
        timestamptz marked_at
        int marked_by FK
    }
    FEEDBACK {
        int feedback_id PK
        int event_id FK
        int student_id FK
        smallint rating "CHECK 1..5"
        text comment
        timestamptz created_at
    }
    STUDENT_INTERESTS {
        int student_id PK "FK"
        int category_id PK "FK"
        timestamptz created_at
    }
```

## Cardinalities in words

| Relationship | Cardinality | Implemented by |
|---|---|---|
| Role - User | one role has many users; a user has exactly one role | `users.role_id` NOT NULL FK |
| User (organizer) - Event | one organizer organises many events; an event has exactly one organizer | `events.organizer_id` FK |
| Category - Category | a category has 0..1 parent and many children (hierarchy) | `categories.parent_category_id` self-FK |
| Category - Event | one category classifies many events | `events.category_id` FK |
| Venue - Event | one venue hosts many events (never overlapping in time) | `events.venue_id` FK + EXCLUDE constraint |
| User (student) - Booking | a student makes many bookings | `bookings.student_id` FK |
| Event - Booking | an event has many bookings (at most `capacity` confirmed) | `bookings.event_id` FK + trigger |
| Booking - Attendance | 0..1 attendance record per booking | `attendance.booking_id` UNIQUE FK |
| Student - Event via Feedback | a student rates an event at most once | `UNIQUE (event_id, student_id)` |
| Student - Category via Interests | many-to-many | junction table `student_interests` (composite PK) |

## Entity-relationship notes
* **Booking** is the associative entity of the many-to-many relationship *student attends event*; it carries its own attributes (status, timestamps).
* **Feedback** is a second associative entity between student and event.
* **student_interests** is a pure junction table resolving the many-to-many between students and categories.
* `v_event_overview`, `v_booking_details` and `v_category_paths` are views, so they are not entities in the diagram.
