import { supabase } from '@/lib/supabase';
import { isFieldRequestSheetName } from '@/lib/materialWorkbook';

export type SheetRow = {
  id: string;
  workbook_id?: string;
  sheet_name: string;
  order_index?: number | null;
  sheet_type?: string | null;
  is_option?: boolean | null;
  description?: string | null;
  change_order_seq?: number | null;
  category_order?: unknown;
  compare_to_sheet_id?: string | null;
};

function sheetMatchKey(sheet: Pick<SheetRow, 'sheet_name' | 'order_index' | 'sheet_type'>): string {
  return `${String(sheet.sheet_name ?? '').trim().toLowerCase()}\0${sheet.order_index ?? 0}\0${sheet.sheet_type ?? 'proposal'}`;
}

function isWorkbookLaborCategoryName(name: unknown): boolean {
  const n = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!n) return false;
  return (
    n === 'labor' ||
    n === 'labor & installation' ||
    n === 'labor and installation' ||
    n === 'installation labor' ||
    n === 'labor/installation'
  );
}

function lineItemBaseCost(item: Record<string, unknown>): number {
  const total = Number(item.total_cost);
  if (Number.isFinite(total) && total > 0) return total;
  return (Number(item.quantity) || 0) * (Number(item.unit_cost) || 0);
}

function laborTotalFromSheetLaborRows(rows: Record<string, unknown>[]): number {
  return rows.reduce((sum, row) => {
    const direct = Number(row.total_labor_cost);
    if (Number.isFinite(direct) && direct > 0) return sum + direct;
    return sum + (Number(row.estimated_hours) || 0) * (Number(row.hourly_rate) || 0);
  }, 0);
}

async function insertSheetWithFallback(
  payload: Record<string, unknown>,
): Promise<{ id: string } | null> {
  let insertPayload: Record<string, unknown> = { ...payload };
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabase
      .from('material_sheets')
      .insert(insertPayload)
      .select('id')
      .single();
    if (!error && data?.id) return data;
    const msg = String(error?.message ?? '').toLowerCase();
    if (msg.includes('change_order_seq') && 'change_order_seq' in insertPayload) {
      const { change_order_seq: _drop, ...next } = insertPayload as Record<string, unknown> & {
        change_order_seq?: unknown;
      };
      insertPayload = next;
      continue;
    }
    if (msg.includes('category_order') && 'category_order' in insertPayload) {
      const { category_order: _drop, ...next } = insertPayload as Record<string, unknown> & {
        category_order?: unknown;
      };
      insertPayload = next;
      continue;
    }
    if (msg.includes('compare_to_sheet_id') && 'compare_to_sheet_id' in insertPayload) {
      const { compare_to_sheet_id: _drop, ...next } = insertPayload as Record<string, unknown> & {
        compare_to_sheet_id?: unknown;
      };
      insertPayload = next;
      continue;
    }
    if (msg.includes('sheet_type') && 'sheet_type' in insertPayload) {
      const { sheet_type: _drop, ...next } = insertPayload as Record<string, unknown> & {
        sheet_type?: unknown;
      };
      insertPayload = next;
      continue;
    }
    if (msg.includes('description') && 'description' in insertPayload) {
      const { description: _drop, ...next } = insertPayload as Record<string, unknown> & {
        description?: unknown;
      };
      insertPayload = next;
      continue;
    }
    console.warn('insertSheetWithFallback failed:', error?.message);
    return null;
  }
  return null;
}

async function copySheetContents(
  sourceSheetId: string,
  targetSheetId: string,
): Promise<Record<string, string>> {
  const itemIdMap: Record<string, string> = {};

  const { data: oldItems } = await supabase
    .from('material_items')
    .select('*')
    .eq('sheet_id', sourceSheetId)
    .order('order_index');
  if (oldItems?.length) {
    const rows = oldItems.map((item: Record<string, unknown>) => {
      const { id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...rest } = item;
      return { ...rest, sheet_id: targetSheetId };
    });
    const { data: insertedItems, error: itErr } = await supabase
      .from('material_items')
      .insert(rows)
      .select('id');
    if (itErr) throw itErr;
    oldItems.forEach((item: { id: string }, idx: number) => {
      const newId = insertedItems?.[idx]?.id;
      if (newId) itemIdMap[item.id] = newId;
    });
  }

  const { data: oldMarkups } = await supabase
    .from('material_category_markups')
    .select('*')
    .eq('sheet_id', sourceSheetId);
  if (oldMarkups?.length) {
    const { error: mErr } = await supabase.from('material_category_markups').insert(
      oldMarkups.map((m: Record<string, unknown>) => ({
        sheet_id: targetSheetId,
        category_name: m.category_name,
        markup_percent: m.markup_percent,
      })),
    );
    if (mErr) throw mErr;
  }

  const { data: laborRows } = await supabase
    .from('material_sheet_labor')
    .select('*')
    .eq('sheet_id', sourceSheetId);
  for (const oldLabor of laborRows || []) {
    const { id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...lr } = oldLabor;
    const { error: lErr } = await supabase
      .from('material_sheet_labor')
      .insert({ ...lr, sheet_id: targetSheetId });
    if (lErr) throw lErr;
  }

  return itemIdMap;
}

/** Copy sheet labor rows when the target sheet has none or less than the locked source. */
async function copyMissingLaborRows(sourceSheetId: string, targetSheetId: string): Promise<number> {
  const { data: sourceRows } = await supabase
    .from('material_sheet_labor')
    .select('*')
    .eq('sheet_id', sourceSheetId);
  if (!sourceRows?.length) return 0;

  const sourceTotal = laborTotalFromSheetLaborRows(sourceRows as Record<string, unknown>[]);
  if (!(sourceTotal > 0)) return 0;

  const { data: targetRows } = await supabase
    .from('material_sheet_labor')
    .select('*')
    .eq('sheet_id', targetSheetId);
  const targetTotal = laborTotalFromSheetLaborRows((targetRows || []) as Record<string, unknown>[]);
  if (targetTotal >= sourceTotal) return 0;

  if (targetRows?.length) {
    const { error: delErr } = await supabase
      .from('material_sheet_labor')
      .delete()
      .eq('sheet_id', targetSheetId);
    if (delErr) throw delErr;
  }

  let copied = 0;
  for (const oldLabor of sourceRows) {
    const { id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...lr } = oldLabor;
    const { error: lErr } = await supabase
      .from('material_sheet_labor')
      .insert({ ...lr, sheet_id: targetSheetId });
    if (lErr) throw lErr;
    copied += 1;
  }
  return copied;
}

/** Copy sheet-linked labor line items from locked/working sibling sheets. */
async function copyMissingSheetLinkedLineItems(
  sourceSheetId: string,
  targetSheetId: string,
): Promise<number> {
  const { data: sourceItems } = await supabase
    .from('custom_financial_row_items')
    .select('*')
    .eq('sheet_id', sourceSheetId)
    .is('row_id', null)
    .order('order_index');
  if (!sourceItems?.length) return 0;

  const sourceLaborItems = sourceItems.filter(
    (it) => (it.item_type || 'material') === 'labor' && lineItemBaseCost(it) > 0,
  );
  if (!sourceLaborItems.length) return 0;

  const { data: targetItems } = await supabase
    .from('custom_financial_row_items')
    .select('*')
    .eq('sheet_id', targetSheetId)
    .is('row_id', null);

  const targetLaborTotal = (targetItems || [])
    .filter((it) => (it.item_type || 'material') === 'labor')
    .reduce((sum, it) => sum + lineItemBaseCost(it), 0);
  const sourceLaborTotal = sourceLaborItems.reduce((sum, it) => sum + lineItemBaseCost(it), 0);
  if (targetLaborTotal >= sourceLaborTotal) return 0;

  if (targetLaborTotal > 0) {
    const laborIds = (targetItems || [])
      .filter((it) => (it.item_type || 'material') === 'labor')
      .map((it) => it.id)
      .filter(Boolean);
    if (laborIds.length) {
      const { error: delErr } = await supabase
        .from('custom_financial_row_items')
        .delete()
        .in('id', laborIds);
      if (delErr) throw delErr;
    }
  }

  const dedupeKey = (sheetId: string, it: Record<string, unknown>) =>
    `${sheetId}|${String(it.description ?? '').trim().toLowerCase()}|${it.item_type ?? 'material'}|${Number(it.quantity) || 0}|${Number(it.unit_cost) || 0}`;
  const existing = new Set(
    (targetItems || []).map((it) => dedupeKey(targetSheetId, it as Record<string, unknown>)),
  );

  let copied = 0;
  for (const item of sourceLaborItems) {
    const key = dedupeKey(targetSheetId, item as Record<string, unknown>);
    if (existing.has(key)) continue;
    const { id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...rest } = item;
    const { error } = await supabase
      .from('custom_financial_row_items')
      .insert({ ...rest, sheet_id: targetSheetId });
    if (error) throw error;
    existing.add(key);
    copied += 1;
  }
  return copied;
}

/** Copy workbook "Labor" category material lines when the working sheet has none. */
async function copyMissingLaborCategoryItems(
  sourceSheetId: string,
  targetSheetId: string,
): Promise<number> {
  const { data: sourceItems } = await supabase
    .from('material_items')
    .select('*')
    .eq('sheet_id', sourceSheetId)
    .order('order_index');
  const sourceLaborItems = (sourceItems || []).filter((it) =>
    isWorkbookLaborCategoryName(it.category),
  );
  if (!sourceLaborItems.length) return 0;

  const { data: targetItems } = await supabase
    .from('material_items')
    .select('*')
    .eq('sheet_id', targetSheetId);
  const targetLaborItems = (targetItems || []).filter((it) =>
    isWorkbookLaborCategoryName(it.category),
  );
  const sourceTotal = sourceLaborItems.reduce((sum, it) => {
    const price = Number(it.extended_price);
    if (Number.isFinite(price) && price > 0) return sum + price;
    return sum + (Number(it.quantity) || 0) * (Number(it.price_per_unit) || 0);
  }, 0);
  const targetTotal = targetLaborItems.reduce((sum, it) => {
    const price = Number(it.extended_price);
    if (Number.isFinite(price) && price > 0) return sum + price;
    return sum + (Number(it.quantity) || 0) * (Number(it.price_per_unit) || 0);
  }, 0);
  if (sourceTotal <= 0 || targetTotal >= sourceTotal) return 0;

  if (targetLaborItems.length) {
    const ids = targetLaborItems.map((it) => it.id).filter(Boolean);
    if (ids.length) {
      const { error: delErr } = await supabase.from('material_items').delete().in('id', ids);
      if (delErr) throw delErr;
    }
  }

  let copied = 0;
  for (const item of sourceLaborItems) {
    const { id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...rest } = item;
    const { error } = await supabase
      .from('material_items')
      .insert({ ...rest, sheet_id: targetSheetId });
    if (error) throw error;
    copied += 1;
  }
  return copied;
}

export type SyncMissingWorkingSheetsResult = {
  addedSheetCount: number;
  itemIdMap: Record<string, string>;
  backfilledDescriptionCount: number;
  copiedLaborRowCount: number;
  copiedSheetLineItemCount: number;
  copiedLaborCategoryItemCount: number;
};

/**
 * Syncs proposal/locked workbook sheets into the job/working workbook.
 * Adds missing sheets and backfills descriptions + sheet labor on matched sections.
 */
export async function syncMissingWorkingSheetsFromLocked(opts: {
  lockedWorkbookId: string;
  workingWorkbookId: string;
}): Promise<SyncMissingWorkingSheetsResult> {
  const { lockedWorkbookId, workingWorkbookId } = opts;
  if (lockedWorkbookId === workingWorkbookId) {
    return {
      addedSheetCount: 0,
      itemIdMap: {},
      backfilledDescriptionCount: 0,
      copiedLaborRowCount: 0,
      copiedSheetLineItemCount: 0,
      copiedLaborCategoryItemCount: 0,
    };
  }

  const [{ data: lockedSheets }, { data: workingSheets }] = await Promise.all([
    supabase
      .from('material_sheets')
      .select('*')
      .eq('workbook_id', lockedWorkbookId)
      .order('order_index'),
    supabase
      .from('material_sheets')
      .select('*')
      .eq('workbook_id', workingWorkbookId)
      .order('order_index'),
  ]);

  const workingByKey = new Map<string, string>();
  for (const sheet of (workingSheets || []) as SheetRow[]) {
    workingByKey.set(sheetMatchKey(sheet), sheet.id);
  }

  const lockedIdToWorkingId = new Map<string, string>();
  for (const sheet of (lockedSheets || []) as SheetRow[]) {
    const key = sheetMatchKey(sheet);
    const existingId = workingByKey.get(key);
    if (existingId) lockedIdToWorkingId.set(sheet.id, existingId);
  }

  const itemIdMap: Record<string, string> = {};
  let addedSheetCount = 0;
  let backfilledDescriptionCount = 0;
  let copiedLaborRowCount = 0;
  let copiedSheetLineItemCount = 0;
  let copiedLaborCategoryItemCount = 0;
  const workingById = new Map<string, SheetRow>(
    ((workingSheets || []) as SheetRow[]).map((s) => [s.id, s]),
  );

  for (const lockedSheet of (lockedSheets || []) as SheetRow[]) {
    if (isFieldRequestSheetName(lockedSheet.sheet_name)) continue;
    const workingId = lockedIdToWorkingId.get(lockedSheet.id);
    if (!workingId) continue;

    const workingSheet = workingById.get(workingId);
    const lockedDesc = String(lockedSheet.description ?? '').trim();
    const workingDesc = String(workingSheet?.description ?? '').trim();
    if (lockedDesc && !workingDesc) {
      const { error: descErr } = await supabase
        .from('material_sheets')
        .update({ description: lockedDesc })
        .eq('id', workingId);
      if (!descErr) {
        backfilledDescriptionCount += 1;
        if (workingSheet) workingSheet.description = lockedDesc;
      }
    }

    copiedLaborRowCount += await copyMissingLaborRows(lockedSheet.id, workingId);
    copiedSheetLineItemCount += await copyMissingSheetLinkedLineItems(lockedSheet.id, workingId);
    copiedLaborCategoryItemCount += await copyMissingLaborCategoryItems(lockedSheet.id, workingId);
  }

  for (const oldSheet of (lockedSheets || []) as SheetRow[]) {
    if (isFieldRequestSheetName(oldSheet.sheet_name)) continue;
    if (lockedIdToWorkingId.has(oldSheet.id)) continue;

    const newSheet = await insertSheetWithFallback({
      workbook_id: workingWorkbookId,
      sheet_name: oldSheet.sheet_name,
      order_index: oldSheet.order_index ?? 0,
      is_option: oldSheet.is_option ?? false,
      sheet_type: oldSheet.sheet_type ?? 'proposal',
      description: oldSheet.description ?? null,
      change_order_seq: oldSheet.change_order_seq ?? null,
      category_order: oldSheet.category_order ?? null,
      compare_to_sheet_id: null,
    });
    if (!newSheet?.id) continue;

    lockedIdToWorkingId.set(oldSheet.id, newSheet.id);
    addedSheetCount += 1;

    const copiedItemMap = await copySheetContents(oldSheet.id, newSheet.id);
    Object.assign(itemIdMap, copiedItemMap);
  }

  for (const oldSheet of (lockedSheets || []) as SheetRow[]) {
    const newSid = lockedIdToWorkingId.get(oldSheet.id);
    const oldCmp = oldSheet.compare_to_sheet_id;
    if (!newSid || !oldCmp) continue;
    const mappedCmp = lockedIdToWorkingId.get(oldCmp);
    if (!mappedCmp) continue;
    await supabase
      .from('material_sheets')
      .update({ compare_to_sheet_id: mappedCmp })
      .eq('id', newSid);
  }

  return {
    addedSheetCount,
    itemIdMap,
    backfilledDescriptionCount,
    copiedLaborRowCount,
    copiedSheetLineItemCount,
    copiedLaborCategoryItemCount,
  };
}
