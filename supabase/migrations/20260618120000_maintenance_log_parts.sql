-- Maintenance ticket parts line items + receipt attachments per part.

CREATE TABLE IF NOT EXISTS public.maintenance_log_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_log_id uuid NOT NULL REFERENCES public.maintenance_logs(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer,
  file_type text,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  maintenance_log_part_id uuid
);

CREATE INDEX IF NOT EXISTS maintenance_log_documents_log_id_idx
  ON public.maintenance_log_documents (maintenance_log_id);

ALTER TABLE public.maintenance_log_documents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_documents'
      AND policyname = 'anyone_can_view_maintenance_log_documents'
  ) THEN
    CREATE POLICY anyone_can_view_maintenance_log_documents
      ON public.maintenance_log_documents FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'maintenance_log_documents'
      AND policyname = 'authenticated_can_insert_maintenance_log_documents'
  ) THEN
    CREATE POLICY authenticated_can_insert_maintenance_log_documents
      ON public.maintenance_log_documents FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'maintenance_log_documents'
      AND policyname = 'authenticated_can_delete_maintenance_log_documents'
  ) THEN
    CREATE POLICY authenticated_can_delete_maintenance_log_documents
      ON public.maintenance_log_documents FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.maintenance_log_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_log_id uuid NOT NULL REFERENCES public.maintenance_logs(id) ON DELETE CASCADE,
  part_number text,
  description text,
  cost numeric(10, 2),
  receipt_document_id uuid REFERENCES public.maintenance_log_documents(id) ON DELETE SET NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_log_parts_log_id_idx
  ON public.maintenance_log_parts (maintenance_log_id);

ALTER TABLE public.maintenance_log_parts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'maintenance_log_parts'
      AND policyname = 'anyone_can_view_maintenance_log_parts'
  ) THEN
    CREATE POLICY anyone_can_view_maintenance_log_parts
      ON public.maintenance_log_parts FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'maintenance_log_parts'
      AND policyname = 'authenticated_can_insert_maintenance_log_parts'
  ) THEN
    CREATE POLICY authenticated_can_insert_maintenance_log_parts
      ON public.maintenance_log_parts FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'maintenance_log_parts'
      AND policyname = 'authenticated_can_update_maintenance_log_parts'
  ) THEN
    CREATE POLICY authenticated_can_update_maintenance_log_parts
      ON public.maintenance_log_parts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'maintenance_log_parts'
      AND policyname = 'authenticated_can_delete_maintenance_log_parts'
  ) THEN
    CREATE POLICY authenticated_can_delete_maintenance_log_parts
      ON public.maintenance_log_parts FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

ALTER TABLE public.maintenance_log_documents
  DROP CONSTRAINT IF EXISTS maintenance_log_documents_maintenance_log_part_id_fkey;

ALTER TABLE public.maintenance_log_documents
  ADD COLUMN IF NOT EXISTS maintenance_log_part_id uuid;

ALTER TABLE public.maintenance_log_documents
  ADD CONSTRAINT maintenance_log_documents_maintenance_log_part_id_fkey
  FOREIGN KEY (maintenance_log_part_id) REFERENCES public.maintenance_log_parts(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
