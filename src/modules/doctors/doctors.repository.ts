import { db } from '../../db/pool.js';
import { decodeCursor, buildPage, type Page } from '../../utils/pagination.js';

export interface Specialization {
  id: number;
  slug: string;
  name: string;
}

export interface DoctorProfile {
  id: string;
  userId: string;
  displayName: string;
  bio: string | null;
  yearsExperience: number;
  consultationFee: number;
  currency: string;
  languages: string[];
  ratingAvg: number;
  ratingCount: number;
  isVerified: boolean;
  isAccepting: boolean;
  timezone: string;
  specializations: Specialization[];
}

export interface DoctorSearchFilters {
  q?: string;
  specialization?: string; // slug
  minRating?: number;
  maxFee?: number;
  language?: string;
  sort?: 'rating' | 'fee' | 'experience';
  limit: number;
  cursor?: string;
}

const SORT_COLUMN: Record<NonNullable<DoctorSearchFilters['sort']>, { col: string; dir: 'ASC' | 'DESC' }> = {
  rating: { col: 'd.rating_avg', dir: 'DESC' },
  fee: { col: 'd.consultation_fee', dir: 'ASC' },
  experience: { col: 'd.years_experience', dir: 'DESC' },
};

function mapRow(r: Record<string, unknown>): DoctorProfile {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    displayName: r.display_name as string,
    bio: (r.bio as string) ?? null,
    yearsExperience: Number(r.years_experience),
    consultationFee: Number(r.consultation_fee),
    currency: r.currency as string,
    languages: (r.languages as string[]) ?? [],
    ratingAvg: Number(r.rating_avg),
    ratingCount: Number(r.rating_count),
    isVerified: r.is_verified as boolean,
    isAccepting: r.is_accepting as boolean,
    timezone: r.timezone as string,
    specializations: (r.specializations as Specialization[]) ?? [],
  };
}

const SELECT_DOCTOR = `
  SELECT d.*,
         COALESCE(
           (SELECT json_agg(json_build_object('id', s.id, 'slug', s.slug, 'name', s.name))
              FROM doctor_specializations ds
              JOIN specializations s ON s.id = ds.specialization_id
             WHERE ds.doctor_id = d.id),
           '[]'::json
         ) AS specializations
    FROM doctors d`;

export class DoctorsRepository {
  async findById(id: string): Promise<DoctorProfile | null> {
    const res = await db.read(`${SELECT_DOCTOR} WHERE d.id = $1`, [id]);
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<DoctorProfile | null> {
    const res = await db.read(`${SELECT_DOCTOR} WHERE d.user_id = $1`, [userId]);
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async create(input: {
    userId: string;
    displayName: string;
    bio?: string;
    yearsExperience: number;
    consultationFee: number;
    languages: string[];
    specializationSlugs: string[];
  }): Promise<DoctorProfile> {
    return db.tx(async (client) => {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO doctors (user_id, display_name, bio, years_experience, consultation_fee, languages)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          input.userId,
          input.displayName,
          input.bio ?? null,
          input.yearsExperience,
          input.consultationFee,
          input.languages,
        ],
      );
      const doctorId = ins.rows[0].id;
      if (input.specializationSlugs.length) {
        await client.query(
          `INSERT INTO doctor_specializations (doctor_id, specialization_id)
           SELECT $1, s.id FROM specializations s WHERE s.slug = ANY($2::text[])`,
          [doctorId, input.specializationSlugs],
        );
      }
      const res = await client.query(`${SELECT_DOCTOR} WHERE d.id = $1`, [doctorId]);
      return mapRow(res.rows[0]);
    });
  }

  async updateProfile(
    doctorId: string,
    patch: Partial<{
      bio: string;
      consultationFee: number;
      languages: string[];
      isAccepting: boolean;
      timezone: string;
    }>,
  ): Promise<DoctorProfile | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, col] of [
      ['bio', 'bio'],
      ['consultationFee', 'consultation_fee'],
      ['languages', 'languages'],
      ['isAccepting', 'is_accepting'],
      ['timezone', 'timezone'],
    ] as const) {
      if (patch[key] !== undefined) {
        params.push(patch[key]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (!sets.length) return this.findById(doctorId);
    params.push(doctorId);
    await db.query(`UPDATE doctors SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    return this.findById(doctorId);
  }

  /** Recompute a doctor's rating aggregates from the reviews table. Done
   * asynchronously (rating.recompute job) to avoid hot-row contention. */
  async recomputeRating(doctorId: string): Promise<void> {
    await db.query(
      `UPDATE doctors d
          SET rating_avg = COALESCE(r.avg, 0),
              rating_count = COALESCE(r.cnt, 0)
         FROM (SELECT AVG(rating)::numeric(3,2) AS avg, COUNT(*)::int AS cnt
                 FROM reviews WHERE doctor_id = $1) r
        WHERE d.id = $1`,
      [doctorId],
    );
  }

  /**
   * Faceted doctor search with keyset pagination. Only `is_accepting` doctors
   * are returned. Sorting is stabilised by `(sortColumn, id)` so the cursor is
   * a total order — no skipped/duplicated rows across pages even under writes.
   */
  async search(f: DoctorSearchFilters): Promise<Page<DoctorProfile>> {
    const sort = SORT_COLUMN[f.sort ?? 'rating'];
    const where: string[] = ['d.is_accepting = true'];
    const params: unknown[] = [];
    const push = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (f.q) where.push(`d.display_name ILIKE ${push(`%${f.q}%`)}`);
    if (f.minRating !== undefined) where.push(`d.rating_avg >= ${push(f.minRating)}`);
    if (f.maxFee !== undefined) where.push(`d.consultation_fee <= ${push(f.maxFee)}`);
    if (f.language) where.push(`${push(f.language)} = ANY(d.languages)`);
    if (f.specialization) {
      where.push(
        `EXISTS (SELECT 1 FROM doctor_specializations ds
                   JOIN specializations s ON s.id = ds.specialization_id
                  WHERE ds.doctor_id = d.id AND s.slug = ${push(f.specialization)})`,
      );
    }

    const cur = decodeCursor<{ v: number; id: string }>(f.cursor);
    if (cur) {
      const op = sort.dir === 'DESC' ? '<' : '>';
      where.push(`(${sort.col}, d.id) ${op} (${push(cur.v)}, ${push(cur.id)})`);
    }

    const limitParam = push(f.limit + 1);
    const sql = `${SELECT_DOCTOR}
       WHERE ${where.join(' AND ')}
       ORDER BY ${sort.col} ${sort.dir}, d.id ${sort.dir}
       LIMIT ${limitParam}`;
    const res = await db.read(sql, params);
    const rows = res.rows.map(mapRow);
    const sortValue = (d: DoctorProfile): number =>
      f.sort === 'fee' ? d.consultationFee : f.sort === 'experience' ? d.yearsExperience : d.ratingAvg;
    return buildPage(rows, f.limit, (d) => ({ v: sortValue(d), id: d.id }));
  }
}
