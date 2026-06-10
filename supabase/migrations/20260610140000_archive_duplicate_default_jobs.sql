-- Keep one active NCC and Training job; archive accidental duplicates.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn
  FROM jobs
  WHERE name IN ('NCC', 'Training')
)
UPDATE jobs
SET status = 'archived'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
