import { describe, it, expect } from 'vitest';
import { roleHasPermission, isRole } from '../../src/types/roles.js';

describe('RBAC permission model', () => {
  it('grants patients booking + own-consultation reads', () => {
    expect(roleHasPermission('patient', 'booking:create')).toBe(true);
    expect(roleHasPermission('patient', 'consultation:read_own')).toBe(true);
  });
  it('denies patients doctor/admin permissions', () => {
    expect(roleHasPermission('patient', 'doctor:write_prescription')).toBe(false);
    expect(roleHasPermission('patient', 'admin:read_analytics')).toBe(false);
  });
  it('grants doctors clinical permissions but not admin', () => {
    expect(roleHasPermission('doctor', 'doctor:write_prescription')).toBe(true);
    expect(roleHasPermission('doctor', 'consultation:update_clinical')).toBe(true);
    expect(roleHasPermission('doctor', 'admin:manage_users')).toBe(false);
  });
  it('grants admins analytics + audit + user management', () => {
    expect(roleHasPermission('admin', 'admin:read_analytics')).toBe(true);
    expect(roleHasPermission('admin', 'admin:read_audit')).toBe(true);
    expect(roleHasPermission('admin', 'booking:create')).toBe(false);
  });
  it('validates role strings', () => {
    expect(isRole('doctor')).toBe(true);
    expect(isRole('root')).toBe(false);
  });
});
