/**
 * READ-ONLY audit of proposal totals.
 *
 * For every quote it recomputes the correct totals from the line items using the app's own
 * `computeProposalTotals` (the single source of truth), compares them to the values currently
 * stored on the quote (`proposal_subtotal` / `proposal_tax` / `proposal_grand_total`), and
 * prints + writes a CSV of the differences. It does NOT write anything to the database.
 *
 * Why this exists: the on-screen/exported totals were inflated by a working-vs-locked workbook
 * double-count. This report shows exactly which jobs change, and by how much, BEFORE you apply
 * anything. Validate it against a job whose number you already know (e.g. Odell Shop should come
 * out near $84,411.71) before trusting the rest.
 *
 * Run:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/auditProposalTotals.ts
 * (A service-role key is needed so it can read every job regardless of row-level security.)
 *
 * Output: console table + ./proposal-totals-audit.csv
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { computeProposalTotals } from '../src/lib/proposalTotals';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    'Missing env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.\n' +
      'Example: SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... npx tsx scripts/auditProposalTotals.ts',
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function hasActiveContract(q: any): boolean {
  const sv = q?.signed_version;
  const signed = sv != null && String(sv).trim() !== '' && Number(sv) > 0;
  return !!(q?.customer_signed_at || signed);
}

function quoteState(q: any): string {
  if (hasActiveContract(q)) return 'signed';
  if (q?.locked_for_editing) return 'office-locked';
  if (q?.sent_at) return 'sent';
  return 'draft';
}

/**
 * Pick the workbook that prices the proposal, matching JobFinancials:
 * signed contracts read the `locked` snapshot (the second `working` row is the job workbook and
 * must be excluded); everything else uses its single working/locked row.
 */
async function selectProposalWorkbookId(jobId: string, quoteId: string, signed: boolean): Promise<string | null> {
  const { data: wbs } = await db
    .from('material_workbooks')
    .select('id, status, updated_at')
    .eq('job_id', jobId)
    .eq('quote_id', quoteId)
    .order('updated_at', { ascending: false });
  const rows = wbs || [];
  if (rows.length === 0) return null;
  if (signed) {
    const locked = rows.find((w: any) => w.status === 'locked');
    if (locked) return locked.id;
  }
  const working = rows.find((w: any) => w.status === 'working');
  return (working || rows[0]).id;
}

async function loadSheetsForWorkbook(workbookId: string): Promise<any[]> {
  const { data: sheetsData } = await db
    .from('material_sheets')
    .select('*')
    .eq('workbook_id', workbookId)
    .order('order_index');
  const sheets = sheetsData || [];
  if (sheets.length === 0) return [];

  const sheetIds = sheets.map((s: any) => s.id);
  for (const sheet of sheets) {
    const [{ data: items }, { data: laborRows }, { data: catMarkups }] = await Promise.all([
      db.from('material_items').select('*').eq('sheet_id', sheet.id).order('order_index'),
      db.from('material_sheet_labor').select('*').eq('sheet_id', sheet.id),
      db.from('material_category_markups').select('*').eq('sheet_id', sheet.id),
    ]);
    (sheet as any).items = items || [];
    (sheet as any).laborTotal = (laborRows || []).reduce(
      (s: number, l: any) => s + (l.total_labor_cost ?? (l.estimated_hours ?? 0) * (l.hourly_rate ?? 0)),
      0,
    );
    const catMarkupMap: Record<string, number> = {};
    (catMarkups || []).forEach((cm: any) => {
      catMarkupMap[cm.category_name] = cm.markup_percent ?? 10;
    });
    (sheet as any).categoryMarkups = catMarkupMap;
  }

  const { data: sheetLineItems } = await db
    .from('custom_financial_row_items')
    .select('*')
    .in('sheet_id', sheetIds)
    .is('row_id', null)
    .order('order_index');
  const bySheet: Record<string, any[]> = {};
  (sheetLineItems || []).forEach((item: any) => {
    if (item.sheet_id) (bySheet[item.sheet_id] ||= []).push(item);
  });
  sheets.forEach((sheet: any) => {
    (sheet as any).sheetLinkedItems = bySheet[sheet.id] || [];
  });
  return sheets;
}

async function loadCustomRows(jobId: string, quoteId: string): Promise<any[]> {
  const [forQuote, forJob] = await Promise.all([
    db.from('custom_financial_rows').select('*, custom_financial_row_items(*)').eq('quote_id', quoteId).order('order_index'),
    db.from('custom_financial_rows').select('*, custom_financial_row_items(*)').eq('job_id', jobId).is('quote_id', null).order('order_index'),
  ]);
  const quoteRowIds = new Set((forQuote.data || []).map((r: any) => r.id));
  return [...(forQuote.data || []), ...(forJob.data || []).filter((r: any) => !quoteRowIds.has(r.id))].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
  );
}

async function loadSubs(jobId: string, quoteId: string): Promise<any[]> {
  const [forQuote, forJob] = await Promise.all([
    db.from('subcontractor_estimates').select('*, subcontractor_estimate_line_items(*)').eq('quote_id', quoteId).order('order_index'),
    db.from('subcontractor_estimates').select('*, subcontractor_estimate_line_items(*)').eq('job_id', jobId).is('quote_id', null).order('order_index'),
  ]);
  const quoteSubIds = new Set((forQuote.data || []).map((r: any) => r.id));
  return [...(forQuote.data || []), ...(forJob.data || []).filter((r: any) => !quoteSubIds.has(r.id))].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
  );
}

type AuditRow = {
  job: string;
  proposal: string;
  state: string;
  storedSubtotal: number;
  newSubtotal: number;
  storedTax: number;
  newTax: number;
  storedGrand: number;
  newGrand: number;
  grandDelta: number;
};

async function main() {
  const { data: quotes, error } = await db
    .from('quotes')
    .select(
      'id, job_id, proposal_number, tax_exempt, customer_signed_at, signed_version, locked_for_editing, sent_at, proposal_subtotal, proposal_tax, proposal_grand_total, is_customer_estimate',
    );
  if (error) {
    console.error('Failed to read quotes:', error.message);
    process.exit(1);
  }

  const jobIds = [...new Set((quotes || []).map((q: any) => q.job_id).filter(Boolean))];
  const jobNameById = new Map<string, string>();
  for (let i = 0; i < jobIds.length; i += 200) {
    const { data: jobs } = await db.from('jobs').select('id, name').in('id', jobIds.slice(i, i + 200));
    (jobs || []).forEach((j: any) => jobNameById.set(j.id, j.name || j.id));
  }

  const results: AuditRow[] = [];
  for (const q of quotes || []) {
    if (q.is_customer_estimate === true) continue; // estimates price differently; out of scope
    if (!q.job_id) continue;

    const signed = hasActiveContract(q);
    const workbookId = await selectProposalWorkbookId(q.job_id, q.id, signed);
    const materialSheets = workbookId ? await loadSheetsForWorkbook(workbookId) : [];
    const customRows = await loadCustomRows(q.job_id, q.id);
    const subcontractorEstimates = await loadSubs(q.job_id, q.id);

    const customRowLineItems: Record<string, any[]> = {};
    customRows.forEach((row: any) => (customRowLineItems[row.id] = row.custom_financial_row_items || []));
    const subcontractorLineItems: Record<string, any[]> = {};
    subcontractorEstimates.forEach((est: any) => (subcontractorLineItems[est.id] = est.subcontractor_estimate_line_items || []));

    const categoryMarkups: Record<string, number> = {};
    materialSheets.forEach((sheet: any) =>
      Object.entries(sheet.categoryMarkups || {}).forEach(([cat, mk]) => {
        if (categoryMarkups[cat] === undefined) categoryMarkups[cat] = mk as number;
      }),
    );

    const t = computeProposalTotals({
      materialSheets,
      customRows,
      subcontractorEstimates,
      customRowLineItems,
      subcontractorLineItems,
      categoryMarkups,
      taxRate: 0.07,
      taxExempt: !!q.tax_exempt,
    });

    const storedGrand = round2(q.proposal_grand_total);
    const newGrand = round2(t.grandTotal);
    results.push({
      job: jobNameById.get(q.job_id) || q.job_id,
      proposal: q.proposal_number || q.id.slice(0, 8),
      state: quoteState(q),
      storedSubtotal: round2(q.proposal_subtotal),
      newSubtotal: round2(t.subtotal),
      storedTax: round2(q.proposal_tax),
      newTax: round2(t.tax),
      storedGrand,
      newGrand,
      grandDelta: round2(newGrand - storedGrand),
    });
  }

  results.sort((a, b) => Math.abs(b.grandDelta) - Math.abs(a.grandDelta));

  const changed = results.filter((r) => Math.abs(r.grandDelta) >= 0.01);
  console.log(`\nQuotes audited: ${results.length}   |   Totals that would change: ${changed.length}\n`);
  console.table(
    changed.map((r) => ({
      Job: r.job,
      Proposal: r.proposal,
      State: r.state,
      'Stored grand': r.storedGrand.toFixed(2),
      'Correct grand': r.newGrand.toFixed(2),
      Delta: r.grandDelta.toFixed(2),
    })),
  );

  const header = 'job,proposal,state,stored_subtotal,new_subtotal,stored_tax,new_tax,stored_grand,new_grand,grand_delta';
  const csv = [
    header,
    ...results.map((r) =>
      [
        `"${String(r.job).replace(/"/g, '""')}"`,
        `"${String(r.proposal).replace(/"/g, '""')}"`,
        r.state,
        r.storedSubtotal,
        r.newSubtotal,
        r.storedTax,
        r.newTax,
        r.storedGrand,
        r.newGrand,
        r.grandDelta,
      ].join(','),
    ),
  ].join('\n');
  writeFileSync('proposal-totals-audit.csv', csv);
  console.log('\nFull report written to proposal-totals-audit.csv (every quote, not just changed ones).');
  console.log('NOTHING was written to the database. Review the CSV, validate a known job, then decide on applying.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
