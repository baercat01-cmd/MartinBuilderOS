-- Default Training job for crew time entry
INSERT INTO jobs (name, client_name, address, status, is_internal, documents, components)
SELECT
  'Training',
  'Internal',
  'N/A',
  'active',
  true,
  '[]'::jsonb,
  '[]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM jobs WHERE name = 'Training'
);
