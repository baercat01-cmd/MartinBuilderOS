-- After contract sign clones a job workbook, repoint package line items to the working copy.
CREATE OR REPLACE FUNCTION public.remap_material_bundle_items_for_quote(
  p_job_id uuid,
  p_quote_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked_wb_id uuid;
  v_working_wb_id uuid;
  v_updated integer := 0;
BEGIN
  SELECT id INTO v_locked_wb_id
  FROM material_workbooks
  WHERE job_id = p_job_id AND quote_id = p_quote_id AND status = 'locked'
  ORDER BY version_number DESC NULLS LAST, updated_at DESC NULLS LAST
  LIMIT 1;

  SELECT id INTO v_working_wb_id
  FROM material_workbooks
  WHERE job_id = p_job_id AND quote_id = p_quote_id AND status = 'working'
  ORDER BY version_number DESC NULLS LAST, updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_locked_wb_id IS NULL OR v_working_wb_id IS NULL THEN
    RETURN 0;
  END IF;

  WITH pairs AS (
    SELECT
      old_item.id AS old_item_id,
      new_item.id AS new_item_id
    FROM material_sheets old_sheet
    JOIN material_items old_item ON old_item.sheet_id = old_sheet.id
    JOIN material_sheets new_sheet
      ON new_sheet.workbook_id = v_working_wb_id
     AND new_sheet.sheet_name = old_sheet.sheet_name
     AND COALESCE(new_sheet.order_index, 0) = COALESCE(old_sheet.order_index, 0)
     AND COALESCE(new_sheet.sheet_type, 'proposal') = COALESCE(old_sheet.sheet_type, 'proposal')
    JOIN material_items new_item
      ON new_item.sheet_id = new_sheet.id
     AND COALESCE(new_item.order_index, 0) = COALESCE(old_item.order_index, 0)
     AND new_item.material_name = old_item.material_name
     AND COALESCE(new_item.sku, '') = COALESCE(old_item.sku, '')
     AND COALESCE(new_item.quantity, 0) = COALESCE(old_item.quantity, 0)
    WHERE old_sheet.workbook_id = v_locked_wb_id
  )
  UPDATE material_bundle_items mbi
  SET material_item_id = pairs.new_item_id
  FROM pairs
  JOIN material_bundles mb ON mb.id = mbi.bundle_id
  WHERE mbi.material_item_id = pairs.old_item_id
    AND mb.job_id = p_job_id
    AND pairs.new_item_id IS DISTINCT FROM pairs.old_item_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.remap_material_bundle_items_for_quote(uuid, uuid) IS
  'Repoint material_bundle_items from locked proposal workbook items to matching job workbook items.';
