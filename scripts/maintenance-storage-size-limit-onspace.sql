-- Run once in OnSpace / Supabase SQL editor to allow large maintenance receipt PDFs.
-- Default job-files bucket limit is 50MB; this raises job-files and vehicle-documents to 200MB.

UPDATE storage.buckets
SET file_size_limit = 209715200
WHERE id IN ('job-files', 'vehicle-documents');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-documents',
  'vehicle-documents',
  true,
  209715200,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
