import type { UserProfile, UserRole } from '@/types';

export interface UserRoleSection {
  role: UserRole;
  title: string;
  shortLabel: string;
}

/** Main Martin Builder OS login — jobs, time, office, payroll (not fleet-only). */
export const MAIN_APP_ROLE_SECTIONS: UserRoleSection[] = [
  { role: 'crew', title: 'Crew Members', shortLabel: 'Crew' },
  { role: 'foreman', title: 'Foremen', shortLabel: 'Foreman' },
  { role: 'shop', title: 'Shop Members', shortLabel: 'Shop' },
  { role: 'office', title: 'Office Members', shortLabel: 'Office' },
  { role: 'payroll', title: 'Payroll Members', shortLabel: 'Payroll' },
];

/** Fleet-only PIN users — shown separately from the main app picker. */
export const FLEET_DRIVER_SECTION: UserRoleSection = {
  role: 'driver',
  title: 'Fleet Drivers',
  shortLabel: 'Driver',
};

/** All roles (e.g. User Management admin screen). */
export const USER_ROLE_SECTIONS: UserRoleSection[] = [
  ...MAIN_APP_ROLE_SECTIONS,
  FLEET_DRIVER_SECTION,
];

const ALL_ROLES: UserRole[] = ['crew', 'foreman', 'shop', 'office', 'payroll', 'driver'];

export function groupUsersByRole(users: UserProfile[]): Record<UserRole, UserProfile[]> {
  const grouped = Object.fromEntries(ALL_ROLES.map((role) => [role, [] as UserProfile[]])) as Record<
    UserRole,
    UserProfile[]
  >;

  for (const user of users) {
    const role = user.role as UserRole;
    if (grouped[role]) {
      grouped[role].push(user);
    }
  }

  for (const role of ALL_ROLES) {
    grouped[role].sort((a, b) => (a.username || '').localeCompare(b.username || ''));
  }

  return grouped;
}

export function getRoleMemberLabel(role: UserRole | undefined): string {
  switch (role) {
    case 'office':
      return 'Office Member';
    case 'payroll':
      return 'Payroll Member';
    case 'shop':
      return 'Shop Member';
    case 'foreman':
      return 'Foreman';
    case 'driver':
      return 'Fleet Driver';
    case 'crew':
    default:
      return 'Crew Member';
  }
}

export function getRoleBadgeLabel(role: UserRole | undefined): string {
  switch (role) {
    case 'office':
      return 'Office';
    case 'payroll':
      return 'Payroll';
    case 'shop':
      return 'Shop';
    case 'foreman':
      return 'Foreman';
    case 'driver':
      return 'Driver';
    case 'crew':
    default:
      return 'Crew';
  }
}
