/**
 * Returns the bundled SQL fix for the driver role constraint issue.
 * The `enabled` flag controls whether the (lazy) fetch is triggered.
 */
export function useDriverRoleFixSql(enabled: boolean): { sql: string } {
  // Inline the SQL as a string constant so there is no async fetch and no
  // missing-file build error.  Keeping it here (rather than importing the .sql
  // file directly) avoids Vite/Rollup needing a raw-file loader plugin.
  const sql = enabled
    ? `-- =============================================================================
-- ONE FILE — paste into YOUR project's SQL console (same database as REST API).
--
-- Stops 23514 on role "driver" by REMOVING brittle CHECK constraints and enforcing
-- allowed roles in a BEFORE ROW trigger (runs before any leftover CHECK weirdness).
--
-- OnSpace (*.backend.onspace.ai): use the SQL console for THAT project only.
-- =============================================================================

-- A) Fleet column + helper
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS can_manage_fleet_vehicles boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.user_can_manage_fleet_vehicles()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT (up.role::text IN ('office','foreman','driver') OR COALESCE(up.can_manage_fleet_vehicles,false))
    FROM public.user_profiles up WHERE up.id = auth.uid()
  ), false);
$$;

GRANT EXECUTE ON FUNCTION public.user_can_manage_fleet_vehicles() TO authenticated;

-- B) Drop every role CHECK constraint on user_profiles
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, t.relname AS tbl, c.conname AS conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'c' AND t.relname = 'user_profiles'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', r.sch, r.tbl, r.conname);
  END LOOP;
END $$;

-- B2) Trigger function that enforces allowed roles (including driver)
CREATE OR REPLACE FUNCTION public.mb_user_profiles_role_bi()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v text;
BEGIN
  v := lower(btrim(COALESCE(NEW.role::text, '')));
  IF v = '' THEN NEW.role := 'crew'; RETURN NEW; END IF;
  IF v NOT IN ('crew','foreman','office','payroll','shop','driver') THEN
    RAISE EXCEPTION 'invalid role: %', NEW.role USING ERRCODE = '23514';
  END IF;
  NEW.role := v; RETURN NEW;
END; $$;

DO $$
DECLARE p RECORD; r RECORD;
BEGIN
  FOR p IN
    SELECT n.nspname AS sch, c.oid AS tbl_oid, c.relname AS tname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'user_profiles' AND c.relkind IN ('r','p')
      AND n.nspname NOT IN ('pg_catalog','information_schema')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_mb_user_profiles_role_bi ON %I.%I', p.sch, p.tname);
    EXECUTE format(
      'CREATE TRIGGER tr_mb_user_profiles_role_bi
         BEFORE INSERT OR UPDATE OF role ON %I.%I
         FOR EACH ROW EXECUTE PROCEDURE public.mb_user_profiles_role_bi()',
      p.sch, p.tname);
  END LOOP;
END $$;

-- C) Grants
ALTER TABLE public.user_profiles DISABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_profiles TO anon, authenticated, service_role;

-- D) PostgREST reload
NOTIFY pgrst, 'reload schema';

-- E) Smoke test
DO $$
BEGIN
  INSERT INTO public.user_profiles (username, email, role) VALUES ('__driver_test__','','driver');
  DELETE FROM public.user_profiles WHERE username = '__driver_test__';
  RAISE NOTICE 'driver insert test: SUCCESS';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'driver insert test: FAILED — %', SQLERRM;
END $$;`
    : '';

  return { sql };
}
