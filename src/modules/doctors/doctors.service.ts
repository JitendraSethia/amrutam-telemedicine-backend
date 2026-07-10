import { cache } from '../../cache/redis.js';
import { cacheOps } from '../../observability/metrics.js';
import { sha256Hex, stableStringify } from '../../utils/hash.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import {
  DoctorsRepository,
  type DoctorProfile,
  type DoctorSearchFilters,
} from './doctors.repository.js';
import type { Page } from '../../utils/pagination.js';

const PROFILE_TTL = 300; // 5 min
const SEARCH_TTL = 30; // 30 s — search is read-heavy and tolerant of slight staleness

/**
 * Read-optimised doctor service. Individual profiles use cache-aside (5 min);
 * search results are cached for 30s keyed by a hash of the filter set. Any
 * mutation invalidates the affected profile and the whole search namespace so
 * clients never see a doctor that has stopped accepting bookings.
 */
export class DoctorsService {
  constructor(private readonly repo: DoctorsRepository) {}

  async getById(id: string): Promise<DoctorProfile> {
    const key = `doctor:profile:${id}`;
    const cached = await cache.get<DoctorProfile>(key);
    if (cached) {
      cacheOps.inc({ result: 'hit' });
      return cached;
    }
    cacheOps.inc({ result: 'miss' });
    const doctor = await this.repo.findById(id);
    if (!doctor) throw new NotFoundError('Doctor');
    await cache.set(key, doctor, PROFILE_TTL);
    return doctor;
  }

  async search(filters: DoctorSearchFilters): Promise<Page<DoctorProfile>> {
    const key = `doctors:search:${sha256Hex(stableStringify(filters))}`;
    const cached = await cache.get<Page<DoctorProfile>>(key);
    if (cached) {
      cacheOps.inc({ result: 'hit' });
      return cached;
    }
    cacheOps.inc({ result: 'miss' });
    const page = await this.repo.search(filters);
    await cache.set(key, page, SEARCH_TTL);
    return page;
  }

  async getMyProfile(userId: string): Promise<DoctorProfile> {
    const doctor = await this.repo.findByUserId(userId);
    if (!doctor) throw new NotFoundError('Doctor profile');
    return doctor;
  }

  async createMyProfile(
    userId: string,
    input: {
      displayName: string;
      bio?: string;
      yearsExperience: number;
      consultationFee: number;
      languages: string[];
      specializationSlugs: string[];
    },
  ): Promise<DoctorProfile> {
    const existing = await this.repo.findByUserId(userId);
    if (existing) throw new ConflictError('Doctor profile already exists', 'PROFILE_EXISTS');
    const created = await this.repo.create({ userId, ...input });
    await this.invalidateSearch();
    return created;
  }

  async updateMyProfile(
    userId: string,
    patch: Partial<{
      bio: string;
      consultationFee: number;
      languages: string[];
      isAccepting: boolean;
      timezone: string;
    }>,
  ): Promise<DoctorProfile> {
    const doctor = await this.repo.findByUserId(userId);
    if (!doctor) throw new NotFoundError('Doctor profile');
    const updated = await this.repo.updateProfile(doctor.id, patch);
    await this.invalidate(doctor.id);
    return updated!;
  }

  /** Resolve the doctor id for a user, throwing if they have no doctor profile. */
  async requireDoctorId(userId: string): Promise<string> {
    const doctor = await this.repo.findByUserId(userId);
    if (!doctor) throw new ForbiddenError('No doctor profile for this account');
    return doctor.id;
  }

  /** Invoked by the rating.recompute worker after a new review. */
  async recomputeRating(doctorId: string): Promise<void> {
    await this.repo.recomputeRating(doctorId);
    await this.invalidate(doctorId);
  }

  async invalidate(doctorId: string): Promise<void> {
    await cache.del(`doctor:profile:${doctorId}`);
    await this.invalidateSearch();
  }

  private async invalidateSearch(): Promise<void> {
    await cache.invalidatePattern('doctors:search:*');
  }
}
