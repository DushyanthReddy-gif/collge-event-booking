import type { SessionUser } from '@/lib/auth/session';
import { query } from '@/lib/db/pool';
import { ApiError } from '@/lib/db/errors';
import { safeSync, syncMeta, syncUsers } from '@/lib/neo4j/sync';

export async function getSystemStats() {
  const [users, events, bookings, totals, popular, perDay, categories] = await Promise.all([
    query<{ role: string; n: number }>(`SELECT r.role_name AS role, COUNT(*)::int AS n FROM users u JOIN roles r ON r.role_id = u.role_id GROUP BY r.role_name ORDER BY r.role_name`),
    query<{ status: string; n: number }>(`SELECT status, COUNT(*)::int AS n FROM events GROUP BY status ORDER BY status`),
    query<{ status: string; n: number }>(`SELECT status, COUNT(*)::int AS n FROM bookings GROUP BY status ORDER BY status`),
    query<{ venues: number; categories: number; avg_rating: number | null; attendance_pct: number | null }>(
      `SELECT (SELECT COUNT(*)::int FROM venues) AS venues, (SELECT COUNT(*)::int FROM categories) AS categories,
              (SELECT ROUND(AVG(rating), 2)::float FROM feedback) AS avg_rating,
              (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE attended) / NULLIF(COUNT(*), 0), 1)::float FROM attendance) AS attendance_pct`),
    // popularity analysis with a window function
    query<{ title: string; bookings: number; capacity: number; fill: number; rank: number }>(
      `SELECT title, confirmed_bookings::int AS bookings, capacity,
              ROUND(100.0 * confirmed_bookings / capacity, 1)::float AS fill,
              RANK() OVER (ORDER BY confirmed_bookings DESC)::int AS rank
       FROM v_event_overview WHERE status IN ('published', 'completed')
       ORDER BY confirmed_bookings DESC, title LIMIT 6`),
    query<{ day: string; n: number }>(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
              (SELECT COUNT(*)::int FROM bookings b WHERE b.booked_at::date = d::date AND b.status = 'confirmed') AS n
       FROM generate_series(current_date - 13, current_date, interval '1 day') AS d ORDER BY d`),
    query<{ category: string; events: number; bookings: number }>(
      `SELECT category_name AS category, COUNT(*)::int AS events, SUM(confirmed_bookings)::int AS bookings
       FROM v_event_overview WHERE status IN ('published', 'completed') GROUP BY category_name ORDER BY bookings DESC`),
  ]);
  return {
    usersByRole: users.rows, eventsByStatus: events.rows, bookingsByStatus: bookings.rows,
    venues: totals.rows[0].venues, categories: totals.rows[0].categories,
    averageRating: totals.rows[0].avg_rating, attendancePercent: totals.rows[0].attendance_pct,
    popularEvents: popular.rows, bookingsPerDay: perDay.rows, categoryBreakdown: categories.rows,
  };
}

export async function listUsers() {
  const { rows } = await query(
    `SELECT u.user_id AS "userId", u.full_name AS "fullName", u.email, r.role_name AS role, u.department,
            u.is_active AS "isActive", u.created_at AS "createdAt"
     FROM users u JOIN roles r ON r.role_id = u.role_id ORDER BY u.user_id`);
  return rows;
}

export async function patchUser(admin: SessionUser, userId: number, patch: { isActive?: boolean; role?: string }) {
  if (userId === admin.userId) throw new ApiError(409, 'Admins cannot change their own role or active status');
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.isActive !== undefined) { params.push(patch.isActive); sets.push(`is_active = $${params.length}`); }
  if (patch.role !== undefined) { params.push(patch.role); sets.push(`role_id = (SELECT role_id FROM roles WHERE role_name = $${params.length})`); }
  params.push(userId);
  const res = await query(`UPDATE users SET ${sets.join(', ')} WHERE user_id = $${params.length} RETURNING user_id`, params);
  if (res.rowCount === 0) throw new ApiError(404, 'User not found');
  await safeSync('user changed', () => syncUsers([userId]));
}

// ------------------------------ venues ------------------------------
export async function listVenues(activeOnly = false) {
  const { rows } = await query(
    `SELECT venue_id AS "venueId", name, location, capacity, is_active AS "isActive"
     FROM venues ${activeOnly ? 'WHERE is_active' : ''} ORDER BY name`);
  return rows;
}
export async function createVenue(v: { name: string; location: string; capacity: number; isActive: boolean }) {
  const { rows } = await query<{ venue_id: number }>(
    'INSERT INTO venues (name, location, capacity, is_active) VALUES ($1, $2, $3, $4) RETURNING venue_id',
    [v.name, v.location, v.capacity, v.isActive]);
  await safeSync('venue created', syncMeta);
  return rows[0].venue_id;
}
export async function updateVenue(id: number, v: { name: string; location: string; capacity: number; isActive: boolean }) {
  const res = await query('UPDATE venues SET name = $1, location = $2, capacity = $3, is_active = $4 WHERE venue_id = $5 RETURNING venue_id',
    [v.name, v.location, v.capacity, v.isActive, id]);
  if (res.rowCount === 0) throw new ApiError(404, 'Venue not found');
  await safeSync('venue updated', syncMeta);
}
export async function deleteVenue(id: number) {
  const res = await query('DELETE FROM venues WHERE venue_id = $1', [id]); // FK RESTRICT -> 409 when events use it
  if (res.rowCount === 0) throw new ApiError(404, 'Venue not found');
  await safeSync('venue deleted', async () => {
    const { runWrite } = await import('@/lib/neo4j/driver');
    await runWrite('MATCH (v:Venue {venueId: $id}) DETACH DELETE v', { id });
  });
}

// ------------------------------ categories ------------------------------
export async function listCategories() {
  const { rows } = await query(
    `SELECT c.category_id AS "categoryId", c.name, c.description, c.parent_category_id AS "parentCategoryId",
            p.path, p.depth::int AS depth
     FROM categories c JOIN v_category_paths p ON p.category_id = c.category_id ORDER BY p.path`);
  return rows;
}
async function assertNoCycle(categoryId: number, parentId: number | null | undefined) {
  if (!parentId) return;
  // recursive CTE: is the proposed parent inside the subtree of the category itself?
  const { rowCount } = await query(
    `WITH RECURSIVE sub AS (
       SELECT category_id FROM categories WHERE category_id = $1
       UNION ALL
       SELECT c.category_id FROM categories c JOIN sub s ON c.parent_category_id = s.category_id)
     SELECT 1 FROM sub WHERE category_id = $2`, [categoryId, parentId]);
  if (rowCount) throw new ApiError(400, 'A category cannot be placed below itself or one of its sub-categories');
}
export async function createCategory(c: { name: string; description: string; parentCategoryId?: number | null }) {
  const { rows } = await query<{ category_id: number }>(
    'INSERT INTO categories (name, description, parent_category_id) VALUES ($1, $2, $3) RETURNING category_id',
    [c.name, c.description, c.parentCategoryId ?? null]);
  await safeSync('category created', syncMeta);
  return rows[0].category_id;
}
export async function updateCategory(id: number, c: { name: string; description: string; parentCategoryId?: number | null }) {
  await assertNoCycle(id, c.parentCategoryId);
  const res = await query('UPDATE categories SET name = $1, description = $2, parent_category_id = $3 WHERE category_id = $4 RETURNING category_id',
    [c.name, c.description, c.parentCategoryId ?? null, id]);
  if (res.rowCount === 0) throw new ApiError(404, 'Category not found');
  await safeSync('category updated', syncMeta);
}
export async function deleteCategory(id: number) {
  const res = await query('DELETE FROM categories WHERE category_id = $1', [id]);
  if (res.rowCount === 0) throw new ApiError(404, 'Category not found');
  await safeSync('category deleted', async () => {
    const { runWrite } = await import('@/lib/neo4j/driver');
    await runWrite('MATCH (c:Category {categoryId: $id}) DETACH DELETE c', { id });
  });
}

export async function completeFinishedEvents(): Promise<number> {
  const { rows } = await query<{ p_updated: number }>('CALL complete_finished_events(0)');
  return rows[0]?.p_updated ?? 0;
}
