import { db } from '../../db/pool.js';
import { decryptField, encryptField } from '../../utils/crypto.js';
import { enqueue } from '../../jobs/queue.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { PrescriptionsRepository, type PrescriptionRow } from './prescriptions.repository.js';
import { ConsultationsRepository } from '../consultations/consultations.repository.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../../types/context.js';
import type { RequestMeta } from '../auth/auth.service.js';
import type { Page } from '../../utils/pagination.js';

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  notes?: string;
}
export interface PrescriptionContent {
  medications: Medication[];
  advice?: string;
  followUpInDays?: number;
}
export interface PrescriptionDTO {
  id: string;
  consultationId: string;
  doctorId: string;
  patientId: string;
  content: PrescriptionContent;
  issuedAt: string;
  supersedesId: string | null;
}

export class PrescriptionsService {
  constructor(
    private readonly repo: PrescriptionsRepository,
    private readonly consultations: ConsultationsRepository,
    private readonly audit: AuditService,
  ) {}

  private toDTO(row: PrescriptionRow): PrescriptionDTO {
    return {
      id: row.id,
      consultationId: row.consultation_id,
      doctorId: row.doctor_id,
      patientId: row.patient_id,
      content: JSON.parse(decryptField(row.content_enc)!) as PrescriptionContent,
      issuedAt: row.issued_at,
      supersedesId: row.supersedes_id,
    };
  }

  private async resolveDoctorId(user: AuthenticatedUser): Promise<string | undefined> {
    if (user.doctorId) return user.doctorId;
    const res = await db.query<{ id: string }>(`SELECT id FROM doctors WHERE user_id = $1`, [user.id]);
    return res.rows[0]?.id;
  }

  async issue(
    user: AuthenticatedUser,
    consultationId: string,
    content: PrescriptionContent,
    meta: RequestMeta,
    supersedesId?: string,
  ): Promise<PrescriptionDTO> {
    if (!content.medications.length) throw new ValidationError('At least one medication is required');
    const consultation = await this.consultations.findById(consultationId);
    if (!consultation) throw new NotFoundError('Consultation');

    const doctorId = await this.resolveDoctorId(user);
    if (!doctorId || consultation.doctor_id !== doctorId) {
      throw new ForbiddenError('Only the treating doctor can issue a prescription');
    }
    if (!['in_progress', 'completed'].includes(consultation.status)) {
      throw new ValidationError('Prescriptions can only be issued for active/completed consultations');
    }

    const created = await this.repo.create({
      consultationId,
      doctorId,
      patientId: consultation.patient_id,
      contentEnc: encryptField(JSON.stringify(content))!,
      supersedesId,
    });

    await this.audit.record({
      actorUserId: user.id,
      actorRole: 'doctor',
      action: 'prescription.issued',
      resourceType: 'prescription',
      resourceId: created.id,
      ip: meta.ip,
      requestId: meta.requestId,
      metadata: { consultationId, medicationCount: content.medications.length },
    });
    // PDF rendering is heavy → offload to a worker.
    await enqueue('prescription.pdf', { prescriptionId: created.id });

    return this.toDTO(created);
  }

  async getForViewer(user: AuthenticatedUser, id: string): Promise<PrescriptionDTO> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError('Prescription');
    const isPatient = user.role === 'patient' && row.patient_id === user.id;
    const doctorId = user.role === 'doctor' ? await this.resolveDoctorId(user) : undefined;
    const isDoctor = doctorId === row.doctor_id;
    if (!isPatient && !isDoctor) throw new ForbiddenError('Not authorised to view this prescription');
    return this.toDTO(row);
  }

  async listMine(user: AuthenticatedUser, filters: { limit: number; cursor?: string }): Promise<Page<PrescriptionDTO>> {
    if (user.role !== 'patient') throw new ForbiddenError('Only patients can list their prescriptions here');
    const page = await this.repo.listForPatient(user.id, filters);
    return { items: page.items.map((r) => this.toDTO(r)), nextCursor: page.nextCursor };
  }
}
