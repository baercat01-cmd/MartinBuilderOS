-- Default NCC job for crew time entry (Sheldon Weaver / NCC)
INSERT INTO jobs (name, client_name, address, status, is_internal, documents, components)
SELECT
  'NCC',
  'Sheldon Weaver',
  'N/A',
  'active',
  true,
  '[]'::jsonb,
  '[]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM jobs WHERE name = 'NCC'
);
