# PostHog Analytics — Verification Record (branch wip/mb-posthog)

Verified 2026-07-06 against a local Vite dev server (`npm run dev -- --port 8090`),
using a throwaway `.env.local` (deleted afterward) with a **fake key** and
`VITE_POSTHOG_HOST=http://127.0.0.1:9099` — an unreachable localhost port — so the
SDK's behavior was observable in the network log while **no analytics data could
leave the machine**. Playwright is not in this repo; verification was done by
driving a preview browser and inspecting CDP network + page state.

## What was implemented

- `src/lib/analytics.ts` — single analytics module (the ONE analytics system):
  - `posthog.init` with `opt_out_capturing_by_default: true`, autocapture on,
    session replay on, `person_profiles: 'identified_only'`, `defaults: '2025-05-24'`
    (SPA history-change pageviews).
  - Refuses to init when: no `VITE_POSTHOG_KEY`, current path is a public portal
    (`/vendor-pricing`, `/customer-portal`, `/subcontractor-portal`, `/plan`), or
    the profile role is not a staff role.
  - On success: `opt_in_capturing()` → `register({ role_app, staff_role })` super
    properties → `identify(user.id, { email, username, staff_role, role_app })`.
  - `disableStaffAnalytics()` opts out + resets on sign-out.
- `src/App.tsx` — one `useEffect` in `AppContent` (mounted only under
  `AuthProvider`, i.e. never on portal routes): enables analytics when
  `authState === 'authenticated' && profile`, disables otherwise. Double-gated
  with the pathname check inside analytics.ts.
- `.env.example` — documented `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`.
- No other tracking calls anywhere.

## Portal silence checks (constraint 1)

Each portal was loaded with a fake token; for each, three probes were checked:
`window.posthog` (undefined), `localStorage` keys starting `ph_` (none), and the
full CDP network log filtered for the PostHog host `127.0.0.1:9099` and
`i.posthog.com` (zero requests). The only posthog-related network entry anywhere
was Vite serving the JS module source itself (`/node_modules/.vite/deps/posthog-js.js`),
which is just the import graph — the SDK was never initialized.

| Portal | URL tested | Rendered | PostHog requests | SDK inited |
|---|---|---|---|---|
| Customer | `/customer-portal?token=fake_verify_token` | "Access denied" page | 0 | no |
| Subcontractor | `/subcontractor-portal?token=fake_verify_token` | "Invalid subcontractor link" | 0 | no |
| Vendor pricing | `/vendor-pricing/fake_verify_token` | "Invalid Link" | 0 | no |
| Plan share | `/plan?token=fake_verify_token` | "Plan link not available" | 0 | no |

## Staff-positive check (constraint 2)

Simulated the real login flow's persistence (set `fieldtrack_user_id` to an
existing office user's id from the app's own offline cache + `fieldtrack_authenticated=true`,
then loaded `/`). The app routed to `/office?tab=jobs` and, probing the actual
ES-module instance (`window.posthog` is not set in module usage — probe via
`import('/node_modules/.vite/deps/posthog-js.js')`):

- `__loaded: true`, `has_opted_in_capturing(): true`
- `get_distinct_id()` = the staff user's UUID (identify worked)
- super properties: `role_app: "Office"`, `staff_role: "office"`
- config: `api_host: http://127.0.0.1:9099`, token = the fake key (env-driven, not hardcoded)
- Network: repeated `POST http://127.0.0.1:9099/e/` (event capture batches, with
  retries) and `GET /array/<key>/config` (remote config) — i.e. pageview +
  autocapture events were being sent. All failed with ERR_CONNECTION_REFUSED
  **by design** (fake host).
- Session replay showed `sessionRecordingStarted(): false` locally: recording
  activation depends on the PostHog project's remote config, which was
  unreachable. **Must be confirmed in the real dashboard** (see checks below).

Cleanup performed: simulated session + `ph_*` localStorage cleared, dev server
stopped, `.env.local` deleted.

## What Cody should do / eyeball

1. Set `VITE_POSTHOG_KEY` + `VITE_POSTHOG_HOST` in the deploy env (Vercel) — until
   then the code is inert (init short-circuits without a key).
2. In the PostHog project: enable **Record user sessions** (replay activation is a
   project setting delivered via remote config).
3. Review the two-line role mapping in `src/lib/analytics.ts` (`crew`/`foreman` →
   "Foreman", `driver` → "Fleet") and the portal prefix list.
4. Pre-existing observation, unrelated to this change: on the PUBLIC portal pages
   the app's offline-sync layer downloads staff tables (user_profiles, jobs,
   time_entries…) via the anon key. Not an analytics issue, but a data-exposure
   smell worth a look.

## PostHog dashboard checks (after deploy with real key)

1. **Activity → Live events**: log into the office app → `$pageview` events with
   `role_app = Office`, person = your user id/email. Click around a few tabs →
   `$autocapture` events appear.
2. **Session replay**: a new recording appears for that session, attributed to the
   identified person, filterable by `role_app`.
3. **Persons**: person shows `email`, `username`, `staff_role`, `role_app`.
4. **Negative check**: open a real customer-portal link in an incognito window →
   no new events/recordings appear for it (also verifiable in the browser: DevTools
   Network tab filtered to your PostHog host shows zero requests on portal pages).
5. Slice usage: Insights → filter any event by `role_app` (Office / Foreman /
   Payroll / Shop / Fleet).
