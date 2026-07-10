/* eslint-disable no-console */
import argon2 from 'argon2';
import { db } from '../src/db/pool.js';
import { encryptField, blindIndex } from '../src/utils/crypto.js';
import { DoctorsRepository } from '../src/modules/doctors/doctors.repository.js';
import { AvailabilityRepository } from '../src/modules/availability/availability.repository.js';
import { generateSlots } from '../src/modules/availability/availability.service.js';

/**
 * Idempotent development seed. Creates specializations, an admin, a patient and
 * a few verified doctors with availability for the next 7 days.
 *
 *   admin@amrutam.test   / Admin@12345
 *   patient@amrutam.test / Patient@12345
 *   ayurveda@amrutam.test (doctor) / Doctor@12345
 */
const SPECIALIZATIONS = [
  ['ayurveda', 'Ayurveda'],
  ['general-physician', 'General Physician'],
  ['dermatology', 'Dermatology'],
  ['nutrition', 'Nutrition & Dietetics'],
  ['mental-health', 'Mental Health'],
];

async function createUser(email: string, password: string, role: string): Promise<string> {
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const res = await db.query<{ id: string }>(
    `INSERT INTO users (email_enc, email_bidx, password_hash, role, email_verified)
     VALUES ($1,$2,$3,$4,true)
     ON CONFLICT (email_bidx) DO UPDATE SET role = EXCLUDED.role
     RETURNING id`,
    [encryptField(email), blindIndex(email, { lowercase: true }), hash, role],
  );
  return res.rows[0].id;
}

async function main(): Promise<void> {
  console.log('Seeding…');
  for (const [slug, name] of SPECIALIZATIONS) {
    await db.query(
      `INSERT INTO specializations (slug, name) VALUES ($1,$2) ON CONFLICT (slug) DO NOTHING`,
      [slug, name],
    );
  }

  await createUser('admin@amrutam.test', 'Admin@12345', 'admin');
  await createUser('patient@amrutam.test', 'Patient@12345', 'patient');

  const doctorsRepo = new DoctorsRepository();
  const slotsRepo = new AvailabilityRepository();

  const doctorSeeds = [
    { email: 'ayurveda@amrutam.test', name: 'Dr. Meera Nair', spec: 'ayurveda', fee: 600, exp: 12 },
    { email: 'gp@amrutam.test', name: 'Dr. Arjun Rao', spec: 'general-physician', fee: 400, exp: 8 },
    { email: 'derma@amrutam.test', name: 'Dr. Priya Shah', spec: 'dermatology', fee: 800, exp: 15 },
  ];

  for (const seed of doctorSeeds) {
    const userId = await createUser(seed.email, 'Doctor@12345', 'doctor');
    let doctor = await doctorsRepo.findByUserId(userId);
    if (!doctor) {
      doctor = await doctorsRepo.create({
        userId,
        displayName: seed.name,
        bio: `${seed.name} — experienced practitioner.`,
        yearsExperience: seed.exp,
        consultationFee: seed.fee,
        languages: ['English', 'Hindi'],
        specializationSlugs: [seed.spec],
      });
    }
    await db.query(`UPDATE doctors SET is_verified = true WHERE id = $1`, [doctor.id]);

    // Availability: 10:00–13:00, next 7 days, 30-min slots.
    const blocks = Array.from({ length: 7 }, (_, d) => {
      const day = new Date();
      day.setDate(day.getDate() + d + 1);
      const start = new Date(day);
      start.setHours(10, 0, 0, 0);
      const end = new Date(day);
      end.setHours(13, 0, 0, 0);
      return { start: start.toISOString(), end: end.toISOString() };
    });
    const slots = generateSlots(blocks, 30);
    const created = await slotsRepo.bulkInsert(doctor.id, slots);
    console.log(`  ${seed.name}: ${created} slots`);
  }

  console.log('Seed complete.');
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
