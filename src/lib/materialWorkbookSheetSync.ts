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

export type SyncMissingWorkingSheetsResult = {
  addedSheetCount: number;
  itemIdMap: Record<string, string>;
};

/**
 * Adds proposal/locked workbook sheets that are missing from the job/working workbook.
 * Existing working sheets (matched by name + order + type) are left unchanged.
 */
export async function syncMissingWorkingSheetsFromLocked(opts: {
  lockedWorkbookId: string;
  workingWorkbookId: string;
}): Promise<SyncMissingWorkingSheetsResult> {
  const { lockedWorkbookId, workingWorkbookId } = opts;
  if (lockedWorkbookId === workingWorkbookId) {
    return { addedSheetCount: 0, itemIdMap: {} };
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

  return { addedSheetCount, itemIdMap };
}
