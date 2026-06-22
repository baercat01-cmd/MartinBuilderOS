-- =============================================================================
-- Run in Supabase Dashboard → SQL Editor (Project Settings → API for your ref).
-- Creates maintenance_log_parts, maintenance_log_documents, anon RLS, storage.
-- Matches: supabase/migrations/20260618160000_maintenance_fleet_supabase_complete.sql
-- =============================================================================

-- Complete maintenance ticket schema for PIN-auth fleet app (anon key).
-- Creates parts/documents tables, invoice columns, anon RLS, maintenance_logs writes, storage access.

-- ── Tables ────────────────────────────────────────────────────────────────────

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

CREATE TABLE IF NOT EXISTS public.maintenance_log_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_log_id uuid NOT NULL REFERENCES public.maintenance_logs(id) ON DELETE CASCADE,
  part_number text,
  description text,
  cost numeric(10, 2),
  receipt_document_id uuid REFERENCES public.maintenance_log_documents(id) ON DELETE SET NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  invoice_number text,
  vendor text
);

CREATE INDEX IF NOT EXISTS maintenance_log_parts_log_id_idx
  ON public.maintenance_log_parts (maintenance_log_id);

CREATE INDEX IF NOT EXISTS maintenance_log_parts_invoice_idx
  ON public.maintenance_log_parts (maintenance_log_id, invoice_number);

ALTER TABLE public.maintenance_log_parts
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS vendor text;

ALTER TABLE public.maintenance_log_documents
  DROP CONSTRAINT IF EXISTS maintenance_log_documents_maintenance_log_part_id_fkey;

ALTER TABLE public.maintenance_log_documents
  ADD COLUMN IF NOT EXISTS maintenance_log_part_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'maintenance_log_documents_maintenance_log_part_id_fkey'
  ) THEN
    ALTER TABLE public.maintenance_log_documents
      ADD CONSTRAINT maintenance_log_documents_maintenance_log_part_id_fkey
      FOREIGN KEY (maintenance_log_part_id) REFERENCES public.maintenance_log_parts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.maintenance_log_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_log_parts ENABLE ROW LEVEL SECURITY;

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
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_documents'
      AND policyname = 'authenticated_can_insert_maintenance_log_documents'
  ) THEN
    CREATE POLICY authenticated_can_insert_maintenance_log_documents
      ON public.maintenance_log_documents FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_documents'
      AND policyname = 'authenticated_can_update_maintenance_log_documents'
  ) THEN
    CREATE POLICY authenticated_can_update_maintenance_log_documents
      ON public.maintenance_log_documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_documents'
      AND policyname = 'authenticated_can_delete_maintenance_log_documents'
  ) THEN
    CREATE POLICY authenticated_can_delete_maintenance_log_documents
      ON public.maintenance_log_documents FOR DELETE TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_parts'
      AND policyname = 'anyone_can_view_maintenance_log_parts'
  ) THEN
    CREATE POLICY anyone_can_view_maintenance_log_parts
      ON public.maintenance_log_parts FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_parts'
      AND policyname = 'authenticated_can_insert_maintenance_log_parts'
  ) THEN
    CREATE POLICY authenticated_can_insert_maintenance_log_parts
      ON public.maintenance_log_parts FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_parts'
      AND policyname = 'authenticated_can_update_maintenance_log_parts'
  ) THEN
    CREATE POLICY authenticated_can_update_maintenance_log_parts
      ON public.maintenance_log_parts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'maintenance_log_parts'
      AND policyname = 'authenticated_can_delete_maintenance_log_parts'
  ) THEN
    CREATE POLICY authenticated_can_delete_maintenance_log_parts
      ON public.maintenance_log_parts FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- ── Grants + anon write (PIN login uses anon key) ─────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_log_parts TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_log_documents TO anon, authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('public.maintenance_logs') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_logs TO anon, authenticated, service_role;
  END IF;
END $$;

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

  IF to_regclass('public.maintenance_logs') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'maintenance_logs'
        AND policyname = 'anon_can_insert_maintenance_logs'
    ) THEN
      CREATE POLICY anon_can_insert_maintenance_logs
        ON public.maintenance_logs FOR INSERT TO anon WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'maintenance_logs'
        AND policyname = 'anon_can_update_maintenance_logs'
    ) THEN
      CREATE POLICY anon_can_update_maintenance_logs
        ON public.maintenance_logs FOR UPDATE TO anon USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'maintenance_logs'
        AND policyname = 'anon_can_delete_maintenance_logs'
    ) THEN
      CREATE POLICY anon_can_delete_maintenance_logs
        ON public.maintenance_logs FOR DELETE TO anon USING (true);
    END IF;
  END IF;
END $$;

-- ── Storage: vehicle-documents bucket (50MB receipts, anon upload) ───────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-documents',
  'vehicle-documents',
  true,
  52428800,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'vehicle_documents_anon_select'
  ) THEN
    CREATE POLICY vehicle_documents_anon_select
      ON storage.objects FOR SELECT TO anon
      USING (bucket_id = 'vehicle-documents');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'vehicle_documents_anon_insert'
  ) THEN
    CREATE POLICY vehicle_documents_anon_insert
      ON storage.objects FOR INSERT TO anon
      WITH CHECK (bucket_id = 'vehicle-documents');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'vehicle_documents_anon_update'
  ) THEN
    CREATE POLICY vehicle_documents_anon_update
      ON storage.objects FOR UPDATE TO anon
      USING (bucket_id = 'vehicle-documents')
      WITH CHECK (bucket_id = 'vehicle-documents');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'vehicle_documents_anon_delete'
  ) THEN
    CREATE POLICY vehicle_documents_anon_delete
      ON storage.objects FOR DELETE TO anon
      USING (bucket_id = 'vehicle-documents');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
