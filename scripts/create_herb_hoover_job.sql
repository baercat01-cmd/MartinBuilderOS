-- Create the "Herb Hoover" job and walk it through the normal lifecycle:
--   quoting (quote created)  ->  on_hold  ->  active
--
-- Mirrors what the app does:
--   * CreateJobDialog inserts with status = 'quoting' and a generated quote_number
--   * JobsView.setJobOnHold()  updates status -> 'on_hold'
--   * JobsView.activateJob()   updates status -> 'active' (DB trigger assigns job_number)
--
-- Safe to re-run: if a "Herb Hoover" job already exists it is reused instead of
-- being duplicated, and it is still left in the Active section.
--
-- Run in the SQL editor of the project the app points at (VITE_SUPABASE_URL).

DO $$
DECLARE
  v_job_id        uuid;
  v_quote_number  text;
BEGIN
  SELECT id
    INTO v_job_id
    FROM jobs
   WHERE name = 'Herb Hoover'
     AND client_name = 'Herb Hoover'
   ORDER BY created_at
   LIMIT 1;

  IF v_job_id IS NULL THEN
    -- Same quote number source the create-quote dialog uses; fall back to the
    -- table's own default/trigger if the RPC is not present.
    BEGIN
      SELECT generate_quote_number() INTO v_quote_number;
    EXCEPTION WHEN undefined_function THEN
      v_quote_number := NULL;
    END;

    -- Step 1: created as a quote
    INSERT INTO jobs (
      name,
      client_name,
      address,
      status,
      quote_number,
      documents,
      components,
      is_internal
    ) VALUES (
      'Herb Hoover',
      'Herb Hoover',
      '123',
      'quoting',
      v_quote_number,
      '[]'::jsonb,
      '[]'::jsonb,
      false
    )
    RETURNING id INTO v_job_id;

    RAISE NOTICE 'Created quote for job % (id %)', 'Herb Hoover', v_job_id;
  ELSE
    RAISE NOTICE 'Reusing existing Herb Hoover job (id %)', v_job_id;
  END IF;

  -- Step 2: moved to On Hold
  UPDATE jobs
     SET status = 'on_hold',
         updated_at = now()
   WHERE id = v_job_id;

  -- Step 3: activated - job_number gets assigned by the trigger, and the job
  -- becomes visible to crew members so they can log hours against it.
  UPDATE jobs
     SET status = 'active',
         updated_at = now()
   WHERE id = v_job_id;
END $$;

-- Confirm the result
SELECT id,
       job_number,
       quote_number,
       name,
       client_name,
       address,
       status,
       is_internal,
       projected_start_date
  FROM jobs
 WHERE name = 'Herb Hoover';
