import posthog from 'posthog-js';
import type { UserProfile } from '@/types';

/**
 * Internal-usage analytics (PostHog) for the staff role-apps only.
 *
 * Hard privacy constraint: the four public token-gated portals are used by
 * real customers/subcontractors/vendors and must NEVER be captured or
 * recorded. Capture is double-gated:
 *   1. enableStaffAnalytics() is only called from AppContent, which is
 *      mounted under AuthProvider on the internal "/*" route — the portal
 *      routes render outside that tree entirely.
 *   2. This module independently refuses to init on any portal pathname.
 */

const PUBLIC_PORTAL_PATH_PREFIXES = [
  '/vendor-pricing',
  '/customer-portal',
  '/subcontractor-portal',
  '/plan',
] as const;

/** Which staff dashboard a role lands on (see role routing in App.tsx). */
const ROLE_APP_BY_ROLE: Record<string, string> = {
  office: 'Office',
  crew: 'Foreman',
  foreman: 'Foreman',
  payroll: 'Payroll',
  shop: 'Shop',
  driver: 'Fleet',
};

export function isPublicPortalPath(pathname: string): boolean {
  return PUBLIC_PORTAL_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

let initialized = false;

/**
 * Init + opt in + identify, only for an authenticated staff user on an
 * internal route. Safe to call repeatedly (e.g. on profile refresh).
 */
export function enableStaffAnalytics(profile: UserProfile): void {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return;
  if (isPublicPortalPath(window.location.pathname)) return;

  const roleApp = ROLE_APP_BY_ROLE[profile.role];
  if (!roleApp) return;

  if (!initialized) {
    posthog.init(key, {
      api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com',
      defaults: '2025-05-24',
      // Nothing is captured until the staff gates above have passed and we
      // explicitly opt in below.
      opt_out_capturing_by_default: true,
      autocapture: true,
      person_profiles: 'identified_only',
      // Session replay stays enabled (disable_session_recording defaults to false).
    });
    initialized = true;
  }

  posthog.opt_in_capturing();
  // Super property: stamps role_app on every event/replay so usage can be
  // sliced by which staff app (Office/Foreman/Payroll/Shop/Fleet) was in use.
  posthog.register({ role_app: roleApp, staff_role: profile.role });
  posthog.identify(profile.id, {
    email: profile.email,
    username: profile.username ?? undefined,
    staff_role: profile.role,
    role_app: roleApp,
  });
}

/** Stop capture and drop identity on sign-out. */
export function disableStaffAnalytics(): void {
  if (!initialized) return;
  posthog.opt_out_capturing();
  posthog.reset();
}
