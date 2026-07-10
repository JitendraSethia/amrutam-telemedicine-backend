import { AuditService } from './modules/audit/audit.service.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import { AuthService } from './modules/auth/auth.service.js';
import { DoctorsRepository } from './modules/doctors/doctors.repository.js';
import { DoctorsService } from './modules/doctors/doctors.service.js';
import { AvailabilityRepository } from './modules/availability/availability.repository.js';
import { AvailabilityService } from './modules/availability/availability.service.js';
import { ConsultationsRepository } from './modules/consultations/consultations.repository.js';
import { ConsultationsService } from './modules/consultations/consultations.service.js';
import { PaymentsRepository } from './modules/payments/payments.repository.js';
import { PaymentGateway } from './modules/payments/payments.gateway.js';
import { PaymentsService } from './modules/payments/payments.service.js';
import { SagaRepository } from './modules/bookings/saga.repository.js';
import { BookingService } from './modules/bookings/booking.service.js';
import { PrescriptionsRepository } from './modules/prescriptions/prescriptions.repository.js';
import { PrescriptionsService } from './modules/prescriptions/prescriptions.service.js';
import { AdminRepository } from './modules/admin/admin.repository.js';
import { AdminService } from './modules/admin/admin.service.js';

/**
 * Composition root. All wiring lives here (constructor injection); modules
 * depend on abstractions passed in, never on a global service locator. This
 * makes services trivially unit-testable with fakes and keeps the dependency
 * graph explicit. Repositories are exposed too so background workers can use
 * them without going through HTTP-oriented services.
 */
export function buildContainer() {
  // Repositories (data access).
  const authRepo = new AuthRepository();
  const doctorsRepo = new DoctorsRepository();
  const availabilityRepo = new AvailabilityRepository();
  const consultationsRepo = new ConsultationsRepository();
  const paymentsRepo = new PaymentsRepository();
  const prescriptionsRepo = new PrescriptionsRepository();
  const sagaRepo = new SagaRepository();
  const adminRepo = new AdminRepository();

  // Infrastructure adapters.
  const gateway = new PaymentGateway();

  // Services (business logic) — wired in dependency order.
  const audit = new AuditService();
  const auth = new AuthService(authRepo, audit);
  const doctors = new DoctorsService(doctorsRepo);
  const availability = new AvailabilityService(availabilityRepo, doctors, audit);
  const consultations = new ConsultationsService(
    consultationsRepo,
    availabilityRepo,
    paymentsRepo,
    audit,
  );
  const bookings = new BookingService(
    availabilityRepo,
    consultationsRepo,
    consultations,
    paymentsRepo,
    gateway,
    sagaRepo,
    audit,
  );
  const payments = new PaymentsService(paymentsRepo, gateway, audit);
  const prescriptions = new PrescriptionsService(prescriptionsRepo, consultationsRepo, audit);
  const admin = new AdminService(adminRepo, audit, doctors);

  return {
    // services
    audit,
    auth,
    doctors,
    availability,
    consultations,
    bookings,
    payments,
    prescriptions,
    admin,
    // repositories (for workers / tests)
    repos: {
      authRepo,
      doctorsRepo,
      availabilityRepo,
      consultationsRepo,
      paymentsRepo,
      prescriptionsRepo,
      sagaRepo,
      adminRepo,
    },
  };
}

export type Container = ReturnType<typeof buildContainer>;
