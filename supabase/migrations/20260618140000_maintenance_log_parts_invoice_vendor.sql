-- Invoice number and vendor on maintenance part line items (grouped by invoice on receipts).

ALTER TABLE public.maintenance_log_parts
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS vendor text;

CREATE INDEX IF NOT EXISTS maintenance_log_parts_invoice_idx
  ON public.maintenance_log_parts (maintenance_log_id, invoice_number);

NOTIFY pgrst, 'reload schema';
