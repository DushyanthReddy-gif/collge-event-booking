import type { SessionUser } from '@/lib/auth/session';
import { query, withTransaction } from '@/lib/db/pool';
import { safeSync, syncInterests } from '@/lib/neo4j/sync';

export async function getInterests(user: SessionUser): Promise<number[]> {
  const { rows } = await query<{ category_id: number }>('SELECT category_id FROM student_interests WHERE student_id = $1', [user.userId]);
  return rows.map((r) => r.category_id);
}

export async function setInterests(user: SessionUser, categoryIds: number[]): Promise<void> {
  await withTransaction(async (c) => {
    await c.query('DELETE FROM student_interests WHERE student_id = $1', [user.userId]);
    for (const id of new Set(categoryIds)) {
      await c.query('INSERT INTO student_interests (student_id, category_id) VALUES ($1, $2)', [user.userId, id]);
    }
  });
  await safeSync('interests', () => syncInterests([user.userId]));
}
