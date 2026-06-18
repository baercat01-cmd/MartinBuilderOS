-- PIN-auth app uses the anon key; allow maintenance parts/documents writes for anon + authenticated.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_log_parts TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_log_documents TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_documents'
      AND policyname = 'anon_can_insert_maintenance_log_documents'
  ) THEN
    CREATE POLICY anon_can_insert_maintenance_log_documents
      ON public.maintenance_log_documents FOR INSERT TO anon WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_documents'
      AND policyname = 'anon_can_update_maintenance_log_documents'
  ) THEN
    CREATE POLICY anon_can_update_maintenance_log_documents
      ON public.maintenance_log_documents FOR UPDATE TO anon USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_documents'
      AND policyname = 'anon_can_delete_maintenance_log_documents'
  ) THEN
    CREATE POLICY anon_can_delete_maintenance_log_documents
      ON public.maintenance_log_documents FOR DELETE TO anon USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_parts'
      AND policyname = 'anon_can_insert_maintenance_log_parts'
  ) THEN
    CREATE POLICY anon_can_insert_maintenance_log_parts
      ON public.maintenance_log_parts FOR INSERT TO anon WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_parts'
      AND policyname = 'anon_can_update_maintenance_log_parts'
  ) THEN
    CREATE POLICY anon_can_update_maintenance_log_parts
      ON public.maintenance_log_parts FOR UPDATE TO anon USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_parts'
      AND policyname = 'anon_can_delete_maintenance_log_parts'
  ) THEN
    CREATE POLICY anon_can_delete_maintenance_log_parts
      ON public.maintenance_log_parts FOR DELETE TO anon USING (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
