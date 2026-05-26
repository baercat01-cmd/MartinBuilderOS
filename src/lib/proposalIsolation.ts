import type { SupabaseClient } from '@supabase/supabase-js';
import { jobHasMultipleFormalProposals } from '@/lib/quotesSchemaFallback';

export { jobHasMultipleFormalProposals };

/** True when the loaded workbook must not drive another proposal's panel. */
export function isWorkbookQuoteMismatch(
  workbookQuoteId: string | null | undefined,
  activeQuoteId: string | null | undefined,
  jobQuotes: { is_customer_estimate?: boolean }[],
): boolean {
  if (!activeQuoteId) return false;
  const wbq = workbookQuoteId != null ? String(workbookQuoteId).trim() : '';
  if (wbq && wbq === activeQuoteId) return false;
  if (jobHasMultipleFormalProposals(jobQuotes) && !wbq) return true;
  return !!wbq && wbq !== activeQuoteId;
}

export function filterLineItemsForActiveQuote<T extends { quote_id?: string | null }>(
  items: T[],
  activeQuoteId: string | null,
): T[] {
  if (!activeQuoteId) return items;
  return items.filter((row) => {
    const qid = row.quote_id != null ? String(row.quote_id).trim() : '';
    return !qid || qid === activeQuoteId;
  });
}

/**
 * Fix rows saved under another proposal's quote_id but stored on this proposal's sheets (bad clone / merge).
 * Best-effort; ignores tables/columns that do not exist.
 */
/** True when sheet_id belongs to a workbook owned by activeQuoteId. */
export async function sheetBelongsToQuote(
  supabase: SupabaseClient,
  sheetId: string,
  activeQuoteId: string,
): Promise<boolean> {
  const sid = String(sheetId ?? '').trim();
  const qid = String(activeQuoteId ?? '').trim();
  if (!sid || !qid) return false;
  const { data: row, error } = await supabase
    .from('material_sheets')
    .select('id, workbook_id, material_workbooks!inner(quote_id)')
    .eq('id', sid)
    .maybeSingle();
  if (error || !row) return false;
  const wbq = String((row as { material_workbooks?: { quote_id?: string | null } }).material_workbooks?.quote_id ?? '').trim();
  return wbq === qid;
}

export async function realignMisassignedSheetLineItems(
  supabase: SupabaseClient,
  quoteId: string,
): Promise<number> {
  const { data: wbs } = await supabase.from('material_workbooks').select('id').eq('quote_id', quoteId);
  const wbIds = (wbs || []).map((w) => w.id).filter(Boolean);
  if (wbIds.length === 0) return 0;

  const { data: sheets } = await supabase.from('material_sheets').select('id').in('workbook_id', wbIds);
  const sheetIds = (sheets || []).map((s) => s.id).filter(Boolean);
  if (sheetIds.length === 0) return 0;

  const { data: rows, error } = await supabase
    .from('custom_financial_row_items')
    .select('id, quote_id')
    .in('sheet_id', sheetIds)
    .is('row_id', null);
  if (error) return 0;

  const ids = (rows || [])
    .filter((r) => {
      const q = r.quote_id != null ? String(r.quote_id).trim() : '';
      return q && q !== quoteId;
    })
    .map((r) => r.id)
    .filter(Boolean);
  if (ids.length === 0) return 0;

  const { error: upErr } = await supabase
    .from('custom_financial_row_items')
    .update({ quote_id: quoteId })
    .in('id', ids);
  return upErr ? 0 : ids.length;
}
