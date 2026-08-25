import type { UserProfile } from '@/types';

/**
 * Returns true when the given profile is allowed to archive, restore, or
 * permanently delete vehicle records in Fleet Settings.
 *
 * Mirrors the `user_can_manage_fleet_vehicles()` Postgres function:
 *   - role in ('office', 'foreman', 'driver')
 *   - OR can_manage_fleet_vehicles = true
 */
export function canManageFleetVehicleRecords(
  profile: UserProfile | null | undefined,
): boolean {
  if (!profile) return false;
  if (profile.can_manage_fleet_vehicles) return true;
  return (
    profile.role === 'office' ||
    profile.role === 'foreman' ||
    profile.role === 'driver'
  );
}
