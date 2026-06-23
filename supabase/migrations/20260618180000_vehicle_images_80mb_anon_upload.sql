-- Vehicle/equipment photos: 80 MB bucket limit + anon storage policies (PIN-auth fleet app).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-images',
  'vehicle-images',
  true,
  83886080,
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif'
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
      AND policyname = 'vehicle_images_anon_select'
  ) THEN
    CREATE POLICY vehicle_images_anon_select
      ON storage.objects FOR SELECT TO anon
      USING (bucket_id = 'vehicle-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'vehicle_images_anon_insert'
  ) THEN
    CREATE POLICY vehicle_images_anon_insert
      ON storage.objects FOR INSERT TO anon
      WITH CHECK (bucket_id = 'vehicle-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'vehicle_images_anon_update'
  ) THEN
    CREATE POLICY vehicle_images_anon_update
      ON storage.objects FOR UPDATE TO anon
      USING (bucket_id = 'vehicle-images')
      WITH CHECK (bucket_id = 'vehicle-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'vehicle_images_anon_delete'
  ) THEN
    CREATE POLICY vehicle_images_anon_delete
      ON storage.objects FOR DELETE TO anon
      USING (bucket_id = 'vehicle-images');
  END IF;
END $$;

-- Persist image_url after upload when using the anon API key.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vehicles'
      AND policyname = 'anon_can_update_vehicles'
  ) THEN
    CREATE POLICY anon_can_update_vehicles
      ON public.vehicles FOR UPDATE TO anon
      USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.ensure_vehicle_images_storage_json(p_payload jsonb DEFAULT '{}'::jsonb)
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

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vehicles'
      AND policyname = 'anon_can_update_vehicles'
  ) THEN
    CREATE POLICY anon_can_update_vehicles
      ON public.vehicles FOR UPDATE TO anon USING (true) WITH CHECK (true);
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_vehicle_images_storage_json(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_vehicle_images_storage_json(jsonb) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
