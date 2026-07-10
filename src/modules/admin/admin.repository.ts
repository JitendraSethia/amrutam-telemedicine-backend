import { db } from '../../db/pool.js';

export interface AnalyticsOverview {
  totalConsultations: number;
  byStatus: Record<string, number>;
  revenue: number;
  activeDoctors: number;
  newUsers: number;
}

export class AdminRepository {
  /** Aggregated KPIs for a time window. Reads go to the replica (if configured)
   * to keep analytical scans off the primary. */
  async overview(from: string, to: string): Promise<AnalyticsOverview> {
    const [statusRes, revenueRes, doctorsRes, usersRes] = await Promise.all([
      db.read<{ status: string; count: string }>(
        `SELECT status, count(*)::int AS count FROM consultations
          WHERE created_at >= $1 AND created_at < $2 GROUP BY status`,
        [from, to],
      ),
      db.read<{ revenue: string }>(
        `SELECT COALESCE(SUM(amount),0)::numeric AS revenue FROM payments
          WHERE status = 'succeeded' AND created_at >= $1 AND created_at < $2`,
        [from, to],
      ),
      db.read<{ count: string }>(`SELECT count(*)::int AS count FROM doctors WHERE is_accepting`),
      db.read<{ count: string }>(
        `SELECT count(*)::int AS count FROM users WHERE created_at >= $1 AND created_at < $2`,
        [from, to],
      ),
    ]);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of statusRes.rows) {
      byStatus[row.status] = Number(row.count);
      total += Number(row.count);
    }
    return {
      totalConsultations: total,
      byStatus,
      revenue: Number(revenueRes.rows[0]?.revenue ?? 0),
      activeDoctors: Number(doctorsRes.rows[0]?.count ?? 0),
      newUsers: Number(usersRes.rows[0]?.count ?? 0),
    };
  }

  async consultationsPerDay(
    from: string,
    to: string,
  ): Promise<{ day: string; count: number }[]> {
    const res = await db.read<{ day: string; count: string }>(
      `SELECT date_trunc('day', scheduled_start) AS day, count(*)::int AS count
         FROM consultations
        WHERE scheduled_start >= $1 AND scheduled_start < $2
        GROUP BY day ORDER BY day ASC`,
      [from, to],
    );
    return res.rows.map((r) => ({ day: r.day, count: Number(r.count) }));
  }

  async topDoctors(limit: number): Promise<
    { doctorId: string; displayName: string; completed: number; ratingAvg: number }[]
  > {
    const res = await db.read<{
      doctor_id: string;
      display_name: string;
      completed: string;
      rating_avg: string;
    }>(
      `SELECT d.id AS doctor_id, d.display_name, d.rating_avg,
              count(c.*) FILTER (WHERE c.status = 'completed')::int AS completed
         FROM doctors d
         LEFT JOIN consultations c ON c.doctor_id = d.id
        GROUP BY d.id
        ORDER BY completed DESC, d.rating_avg DESC
        LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => ({
      doctorId: r.doctor_id,
      displayName: r.display_name,
      completed: Number(r.completed),
      ratingAvg: Number(r.rating_avg),
    }));
  }

  async verifyDoctor(doctorId: string): Promise<boolean> {
    const res = await db.query(`UPDATE doctors SET is_verified = true WHERE id = $1`, [doctorId]);
    return (res.rowCount ?? 0) > 0;
  }
}
