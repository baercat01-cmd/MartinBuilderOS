import type { SupabaseClient } from '@supabase/supabase-js';

export function jobHasMultipleFormalProposals(quotes: { is_customer_estimate?: boolean }[]): boolean {
  return quotes.filter((q) => q.is_customer_estimate !== true).length > 1;
}

export function isPostgrestSchemaError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '');
  const msg = String((error as { message?: string })?.message || '').toLowerCase();
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    /column.*exist|schema cache|could not find/i.test(msg)
  );
}

export function isMissingColumnError(error: unknown, col: string): boolean {
  if (isPostgrestSchemaError(error)) {
    const blob = [
      (error as { message?: string })?.message,
      (error as { details?: string })?.details,
      (error as { hint?: string })?.hint,
    ]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase())
      .join(' ');
    const c = col.toLowerCase();
    if (!blob || blob.includes(c)) return true;
  }
  const err = error as { code?: string; message?: string; details?: string; hint?: string };
  const blob = [err?.message, err?.details, err?.hint]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase())
    .join(' ');
  const c = col.toLowerCase();
  if (err?.code === '42703' && blob.includes(c)) return true;
  return (
    blob.includes(`could not find the '${c}' column`) ||
    blob.includes(`could not find the "${c}" column`) ||
    blob.includes(`column ${c} does not exist`) ||
    blob.includes(` '${c}' column`)
  );
}

export const JOB_QUOTES_SELECT_FULL =
  'id, proposal_number, quote_number, estimate_number, is_customer_estimate, created_at, sent_at, locked_for_editing, is_change_order_proposal, signed_version, customer_signed_at';

export const JOB_QUOTES_SELECT_LEGACY =
  'id, proposal_number, quote_number, is_customer_estimate, created_at, sent_at, locked_for_editing';

export const JOB_QUOTES_SELECT_MIN =
  'id, proposal_number, quote_number, created_at, sent_at';

export const QUOTE_CONTRACT_SELECT_FULL =
  'locked_for_editing, sent_at, signed_version, customer_signed_at';

export const QUOTE_CONTRACT_SELECT_MIN = 'sent_at';

export async function fetchJobQuotesForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ data: any[] | null; error: unknown }> {
  let result = await supabase
    .from('quotes')
    .select(JOB_QUOTES_SELECT_FULL)
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });
  if (result.error && isPostgrestSchemaError(result.error)) {
    result = await supabase
      .from('quotes')
      .select(JOB_QUOTES_SELECT_LEGACY)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });
  }
  if (result.error && isPostgrestSchemaError(result.error)) {
    result = await supabase
      .from('quotes')
      .select(JOB_QUOTES_SELECT_MIN)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });
  }
  if (result.error && isPostgrestSchemaError(result.error)) {
    result = await supabase
      .from('quotes')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });
  }
  return result;
}

const QUOTE_CONTRACT_SELECT_WITH_ID = `id, ${QUOTE_CONTRACT_SELECT_FULL}`;

export type QuoteContractFields = {
  id?: string;
  sent_at: string | null;
  locked_for_editing: boolean | null;
  signed_version?: unknown;
  customer_signed_at?: string | null;
};

export function normalizeQuoteContractFields(row: Record<string, unknown> | null): QuoteContractFields {
  return {
    id: row?.id != null ? String(row.id) : undefined,
    sent_at: (row?.sent_at as string | null) ?? null,
    locked_for_editing: (row?.locked_for_editing as boolean | null) ?? null,
    signed_version: row?.signed_version,
    customer_signed_at: (row?.customer_signed_at as string | null) ?? null,
  };
}

export async function fetchQuoteContractRowWithId(
  supabase: SupabaseClient,
  quoteId: string,
): Promise<{ data: QuoteContractFields | null; error: unknown }> {
  let result = await supabase
    .from('quotes')
    .select(QUOTE_CONTRACT_SELECT_WITH_ID)
    .eq('id', quoteId)
    .maybeSingle();
  if (result.error && isPostgrestSchemaError(result.error)) {
    result = await supabase
      .from('quotes')
      .select(`id, ${QUOTE_CONTRACT_SELECT_MIN}`)
      .eq('id', quoteId)
      .maybeSingle();
  }
  if (result.error && isPostgrestSchemaError(result.error)) {
    result = await supabase.from('quotes').select('id, sent_at').eq('id', quoteId).maybeSingle();
  }
  return {
    data: result.data ? normalizeQuoteContractFields(result.data as Record<string, unknown>) : null,
    error: result.error,
  };
}

/** Find or reference the job's change-order quote row with schema-tolerant selects. */
export async function fetchChangeOrderQuoteForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ data: QuoteContractFields[] | null; error: unknown }> {
  let result = await supabase
    .from('quotes')
    .select(QUOTE_CONTRACT_SELECT_WITH_ID)
    .eq('job_id', jobId)
    .eq('is_change_order_proposal', true)
    .limit(1);
  if (result.error && isPostgrestSchemaError(result.error)) {
    const all = await fetchJobQuotesForJob(supabase, jobId);
    if (all.error) return { data: null, error: all.error };
    const co = (all.data || []).filter((q: any) => q.is_change_order_proposal === true);
    return {
      data: co.map((row) => normalizeQuoteContractFields(row as Record<string, unknown>)),
      error: null,
    };
  }
  return {
    data: (result.data || []).map((row) =>
      normalizeQuoteContractFields(row as Record<string, unknown>),
    ),
    error: result.error,
  };
}

const NO_WORKBOOK_ID_COL_KEY = 'mb_custom_financial_row_items_no_workbook_id';
const NO_QUOTE_ID_COL_KEY = 'mb_custom_financial_row_items_no_quote_id';

export function shouldSkipCustomRowItemQuoteIdColumn(): boolean {
  try {
    if (sessionStorage.getItem(NO_QUOTE_ID_COL_KEY) === '1') return true;
    // Remote DBs missing workbook_id on custom_financial_row_items also lack quote_id.
    if (sessionStorage.getItem(NO_WORKBOOK_ID_COL_KEY) === '1') return true;
  } catch {
    return false;
  }
  return false;
}

export function markCustomRowItemsNoQuoteIdColumn(): void {
  try {
    sessionStorage.setItem(NO_QUOTE_ID_COL_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Skip workbook_id PostgREST filters after first 42703 on older DBs (per tab session). */
export function shouldSkipCustomRowItemWorkbookFilter(): boolean {
  try {
    return sessionStorage.getItem(NO_WORKBOOK_ID_COL_KEY) === '1';
  } catch {
    return false;
  }
}

export function markCustomRowItemsNoWorkbookIdColumn(): void {
  try {
    sessionStorage.setItem(NO_WORKBOOK_ID_COL_KEY, '1');
    sessionStorage.setItem(NO_QUOTE_ID_COL_KEY, '1');
  } catch {
    /* ignore quota / private mode */
  }
}

export async function fetchQuoteContractRow(
  supabase: SupabaseClient,
  quoteId: string,
): Promise<{ data: Record<string, unknown> | null; error: unknown }> {
  let result = await supabase
    .from('quotes')
    .select(QUOTE_CONTRACT_SELECT_FULL)
    .eq('id', quoteId)
    .maybeSingle();
  if (result.error && isPostgrestSchemaError(result.error)) {
    result = await supabase
      .from('quotes')
      .select(QUOTE_CONTRACT_SELECT_MIN)
      .eq('id', quoteId)
      .maybeSingle();
  }
  return result;
}
