/** Error type thrown by services; the route wrapper turns it into a JSON response. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

interface PgLikeError {
  code?: string;
  constraint?: string;
  message?: string;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  users_email_key: 'That email address is already registered',
  uq_active_booking: 'You already have a confirmed booking for this event',
  feedback_event_id_student_id_key: 'You have already submitted feedback for this event',
  venues_name_key: 'A venue with that name already exists',
  categories_name_key: 'A category with that name already exists',
  ex_events_no_venue_overlap: 'That venue is already booked for an overlapping time',
};

/**
 * Maps PostgreSQL errors (SQLSTATE codes, including the custom UExxx codes raised by our
 * triggers/procedures in db/schema/002_advanced.sql) to HTTP errors. Anything unknown
 * becomes a generic 500 so internals are never leaked to the browser.
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const e = err as PgLikeError;
  switch (e?.code) {
    case '23505':
      return new ApiError(409, CONSTRAINT_MESSAGES[e.constraint ?? ''] ?? 'Duplicate value');
    case '23P01':
      return new ApiError(409, CONSTRAINT_MESSAGES[e.constraint ?? ''] ?? 'Conflicting record');
    case '23503':
      return new ApiError(409, 'Related record not found, or it is still in use by other records');
    case '23514':
      return new ApiError(400, `Value rejected by database rule${e.constraint ? ` (${e.constraint})` : ''}`);
    case '23502':
    case '22P02':
    case '22007':
    case '22003':
      return new ApiError(400, 'Invalid input value');
    case 'UE001':
      return new ApiError(400, e.message ?? 'Capacity exceeds venue capacity');
    case 'UE002':
    case 'UE003':
    case 'UE004':
    case 'UE009':
      return new ApiError(409, e.message ?? 'Operation not allowed in the current state');
    case 'UE005':
    case 'UE006':
    case 'UE007':
      return new ApiError(403, e.message ?? 'Not allowed');
    case 'UE008':
      return new ApiError(404, e.message ?? 'Not found');
    default:
      console.error('[db] unexpected error', err);
      return new ApiError(500, 'Internal server error');
  }
}
