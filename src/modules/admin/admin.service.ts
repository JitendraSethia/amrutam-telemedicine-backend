import { cache } from '../../cache/redis.js';
import { sha256Hex, stableStringify } from '../../utils/hash.js';
import { NotFoundError } from '../../utils/errors.js';
import { AdminRepository, type AnalyticsOverview } from './admin.repository.js';
import { AuditService, type AuditRecord } from '../audit/audit.service.js';
import { DoctorsService } from '../doctors/doctors.service.js';
import type { Page } from '../../utils/pagination.js';

const ANALYTICS_TTL = 60; // analytics tolerate 1-minute staleness; cache to cut load

export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly audit: AuditService,
    private readonly doctors: DoctorsService,
  ) {}

  private cacheKey(name: string, params: unknown): string {
    return `admin:${name}:${sha256Hex(stableStringify(params))}`;
  }

  async overview(from: string, to: string): Promise<AnalyticsOverview> {
    return cache.remember(this.cacheKey('overview', { from, to }), ANALYTICS_TTL, () =>
      this.repo.overview(from, to),
    );
  }

  async consultationsPerDay(from: string, to: string): Promise<{ day: string; count: number }[]> {
    return cache.remember(this.cacheKey('cpd', { from, to }), ANALYTICS_TTL, () =>
      this.repo.consultationsPerDay(from, to),
    );
  }

  async topDoctors(limit: number): Promise<
    { doctorId: string; displayName: string; completed: number; ratingAvg: number }[]
  > {
    return cache.remember(this.cacheKey('top', { limit }), ANALYTICS_TTL, () =>
      this.repo.topDoctors(limit),
    );
  }

  async queryAudit(filters: {
    actorUserId?: string;
    resourceType?: string;
    resourceId?: string;
    action?: string;
    limit: number;
    cursor?: string;
  }): Promise<Page<AuditRecord>> {
    return this.audit.query(filters);
  }

  async verifyDoctor(adminId: string, doctorId: string): Promise<void> {
    const ok = await this.repo.verifyDoctor(doctorId);
    if (!ok) throw new NotFoundError('Doctor');
    await this.doctors.invalidate(doctorId);
    await this.audit.record({
      actorUserId: adminId,
      actorRole: 'admin',
      action: 'doctor.verified',
      resourceType: 'doctor',
      resourceId: doctorId,
    });
  }
}
