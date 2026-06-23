-- Run once in OnSpace / Supabase SQL editor when equipment photo upload fails with RLS 42501.
-- Creates mb_ensure_fleet_storage_json (callable from the app) + applies policies immediately.

CREATE OR REPLACE FUNCTION public.mb_ensure_fleet_storage_json(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'vehicle-images',
    'vehicle-images',
    true,
    83886080,
    ARRAY[
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'
    ]::text[]
  )
  ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'vehicle_images_anon_select'
  ) THEN
    CREATE POLICY vehicle_images_anon_select
      ON storage.objects FOR SELECT TO anon USING (bucket_id = 'vehicle-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'vehicle_images_anon_insert'
  ) THEN
    CREATE POLICY vehicle_images_anon_insert
      ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'vehicle-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'vehicle_images_anon_update'
  ) THEN
    CREATE POLICY vehicle_images_anon_update
      ON storage.objects FOR UPDATE TO anon
      USING (bucket_id = 'vehicle-images') WITH CHECK (bucket_id = 'vehicle-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'vehicle_images_anon_delete'
  ) THEN
    CREATE POLICY vehicle_images_anon_delete
      ON storage.objects FOR DELETE TO anon USING (bucket_id = 'vehicle-images');
  END IF;

  IF to_regclass('public.vehicles') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vehicles'
      AND policyname = 'anon_can_update_vehicles'
  ) THEN
    CREATE POLICY anon_can_update_vehicles
      ON public.vehicles FOR UPDATE TO anon USING (true) WITH CHECK (true);
  END IF;

  PERFORM pg_notify('pgrst', 'reload schema');
  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.mb_ensure_fleet_storage_json(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mb_ensure_fleet_storage_json(jsonb) TO anon, authenticated, service_role;

SELECT public.mb_ensure_fleet_storage_json('{}'::jsonb);

NOTIFY pgrst, 'reload schema';
