-- NCC and Training are time-entry jobs only; hide them from foreman job cards.
UPDATE jobs
SET is_internal = true
WHERE name IN ('NCC', 'Training')
  AND (is_internal IS DISTINCT FROM true);
