/**
 * Role-based access control primitives. Roles map to coarse permissions;
 * routes declare the permission they need and the RBAC guard checks the caller.
 * Keeping permissions explicit (rather than checking role strings inline)
 * makes the authorisation surface auditable in one place.
 */
export const ROLES = ['patient', 'doctor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'doctor:manage_availability',
  'doctor:write_prescription',
  'consultation:read_own',
  'consultation:update_clinical',
  'booking:create',
  'booking:cancel_own',
  'payment:read_own',
  'admin:read_analytics',
  'admin:manage_users',
  'admin:read_audit',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  patient: ['booking:create', 'booking:cancel_own', 'consultation:read_own', 'payment:read_own'],
  doctor: [
    'doctor:manage_availability',
    'doctor:write_prescription',
    'consultation:read_own',
    'consultation:update_clinical',
  ],
  admin: [
    'admin:read_analytics',
    'admin:manage_users',
    'admin:read_audit',
    'consultation:read_own',
  ],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
