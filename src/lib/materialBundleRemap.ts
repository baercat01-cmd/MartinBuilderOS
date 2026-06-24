import { supabase } from '@/lib/supabase';

export async function countMaterialItemsForWorkbook(workbookId: string): Promise<number> {
  const { data: sh } = await supabase.from('material_sheets').select('id').eq('workbook_id', workbookId);
  const ids = (sh || []).map((s) => s.id);
  if (ids.length === 0) return 0;
  const { count, error } = await supabase
    .from('material_items')
    .select('*', { count: 'exact', head: true })
    .in('sheet_id', ids);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Resolve the editable job workbook id for package pickers / shop tracking.
 * Never returns a locked proposal snapshot when a working copy exists or is required.
 */
export async function resolveJobWorkbookIdForQuote(
  jobId: string,
  quoteId: string | null,
  opts?: { preferWorkbookId?: string | null; allowLegacyNullQuote?: boolean },
): Promise<string | null> {
  if (opts?.preferWorkbookId) {
    const { data: preferred } = await supabase
      .from('material_workbooks')
      .select('id, status, job_id')
      .eq('id', opts.preferWorkbookId)
      .eq('job_id', jobId)
      .maybeSingle();
    if (preferred?.status === 'working') {
      return preferred.id;
    }
  }

  const { data: allWbs, error } = await supabase
    .from('material_workbooks')
    .select('id, status, version_number, quote_id')
    .eq('job_id', jobId)
    .order('version_number', { ascending: false });
  if (error) throw error;

  const matchQuote = (w: { quote_id?: string | null }) =>
    quoteId ? w.quote_id === quoteId : !w.quote_id;

  const workingRows = (allWbs || [])
    .filter((w) => w.status === 'working' && matchQuote(w))
    .sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0));
  const hasLocked = (allWbs || []).some((w) => matchQuote(w) && w.status === 'locked');

  for (const candidate of workingRows) {
    const count = await countMaterialItemsForWorkbook(candidate.id);
    if (count > 0) return candidate.id;
  }
  if (workingRows.length > 0) return workingRows[0]!.id;

  if (quoteId && opts?.allowLegacyNullQuote !== false) {
    const legacyWorking = (allWbs || [])
      .filter((w) => w.status === 'working' && !w.quote_id)
      .sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0));
    for (const candidate of legacyWorking) {
      const count = await countMaterialItemsForWorkbook(candidate.id);
      if (count > 0) return candidate.id;
    }
    if (legacyWorking.length > 0) return legacyWorking[0]!.id;
  }

  // Signed contract pair expected — do not fall back to locked proposal rows.
  if (hasLocked) return null;

  return workingRows[0]?.id ?? null;
}

/** Repoint package line items from old material_item ids to new ids (after workbook clone). */
export async function remapMaterialBundleItemsForJob(
  jobId: string,
  itemIdMap: Record<string, string>,
): Promise<number> {
  const entries = Object.entries(itemIdMap).filter(([oldId, newId]) => oldId && newId && oldId !== newId);
  if (entries.length === 0) return 0;

  const oldIds = entries.map(([oldId]) => oldId);
  const { data: bundles, error: bundleErr } = await supabase
    .from('material_bundles')
    .select('id')
    .eq('job_id', jobId);
  if (bundleErr) throw bundleErr;
  if (!bundles?.length) return 0;

  const { data: bundleItems, error: itemsErr } = await supabase
    .from('material_bundle_items')
    .select('id, material_item_id, bundle_id')
    .in('bundle_id', bundles.map((b) => b.id))
    .in('material_item_id', oldIds);
  if (itemsErr) throw itemsErr;
  if (!bundleItems?.length) return 0;

  let updated = 0;
  for (const row of bundleItems) {
    const newId = itemIdMap[row.material_item_id];
    if (!newId || newId === row.material_item_id) continue;
    const { error } = await supabase
      .from('material_bundle_items')
      .update({ material_item_id: newId })
      .eq('id', row.id);
    if (!error) updated += 1;
  }
  return updated;
}

function materialFingerprint(m: {
  material_name?: string | null;
  sku?: string | null;
  quantity?: number | null;
  usage?: string | null;
  length?: string | null;
  order_index?: number | null;
  sheet_name?: string | null;
}): string {
  return [
    m.sheet_name ?? '',
    m.material_name ?? '',
    m.sku ?? '',
    m.quantity ?? 0,
    m.usage ?? '',
    m.length ?? '',
    m.order_index ?? 0,
  ].join('\0');
}

/**
 * Remove duplicate bundle lines: same locked+working item pair, or identical fingerprints in one package.
 * Prefers material_item ids on the job workbook when provided.
 */
export async function dedupeMaterialBundleItemsForJob(
  jobId: string,
  options?: { quoteId?: string | null; jobWorkbookId?: string | null },
): Promise<number> {
  const itemIdMap = options?.quoteId
    ? await buildLockedToWorkingItemIdMap(jobId, options.quoteId)
    : {};

  let jobItemIds: Set<string> | null = null;
  if (options?.jobWorkbookId) {
    const { data: sheets } = await supabase
      .from('material_sheets')
      .select('id')
      .eq('workbook_id', options.jobWorkbookId);
    const sheetIds = (sheets || []).map((s) => s.id);
    if (sheetIds.length > 0) {
      const { data: items } = await supabase.from('material_items').select('id').in('sheet_id', sheetIds);
      jobItemIds = new Set((items || []).map((i) => i.id));
    }
  }

  const { data: bundles } = await supabase.from('material_bundles').select('id').eq('job_id', jobId);
  if (!bundles?.length) return 0;

  let removed = 0;

  for (const bundle of bundles) {
    const { data: bundleRows } = await supabase
      .from('material_bundle_items')
      .select('id, material_item_id')
      .eq('bundle_id', bundle.id);
    if (!bundleRows?.length || bundleRows.length <= 1) continue;

    const materialIds = bundleRows.map((r) => r.material_item_id);
    const { data: materials } = await supabase
      .from('material_items')
      .select('id, material_name, sku, quantity, usage, length, order_index, material_sheets(sheet_name)')
      .in('id', materialIds);

    const materialById = new Map((materials || []).map((m: any) => {
      const sheet = Array.isArray(m.material_sheets) ? m.material_sheets[0] : m.material_sheets;
      return [
        m.id,
        {
          ...m,
          sheet_name: sheet?.sheet_name ?? '',
        },
      ] as const;
    }));

    const canonicalId = (materialId: string) => itemIdMap[materialId] ?? materialId;

    const keepScore = (materialId: string) => {
      let score = 0;
      if (jobItemIds?.has(materialId)) score += 100;
      if (!Object.prototype.hasOwnProperty.call(itemIdMap, materialId)) score += 10;
      return score;
    };

    const toDelete = new Set<string>();

    const pickDuplicates = (rows: typeof bundleRows) => {
      if (rows.length <= 1) return;
      const sorted = [...rows].sort(
        (a, b) => keepScore(b.material_item_id) - keepScore(a.material_item_id),
      );
      for (let i = 1; i < sorted.length; i++) toDelete.add(sorted[i]!.id);
    };

    const byCanonical = new Map<string, typeof bundleRows>();
    for (const row of bundleRows) {
      const canon = canonicalId(row.material_item_id);
      const list = byCanonical.get(canon) ?? [];
      list.push(row);
      byCanonical.set(canon, list);
    }
    for (const rows of byCanonical.values()) pickDuplicates(rows);

    const remaining = bundleRows.filter((r) => !toDelete.has(r.id));
    const byFingerprint = new Map<string, typeof bundleRows>();
    for (const row of remaining) {
      const mat = materialById.get(row.material_item_id);
      const fp = mat ? materialFingerprint(mat) : row.material_item_id;
      const list = byFingerprint.get(fp) ?? [];
      list.push(row);
      byFingerprint.set(fp, list);
    }
    for (const rows of byFingerprint.values()) pickDuplicates(rows);

    if (toDelete.size === 0) continue;

    const { error } = await supabase.from('material_bundle_items').delete().in('id', [...toDelete]);
    if (!error) removed += toDelete.size;
  }

  return removed;
}

/** True if bundle already contains this material or a locked/working equivalent. */
export async function bundleContainsEquivalentMaterial(
  bundleId: string,
  materialItemId: string,
  itemIdMap: Record<string, string> = {},
): Promise<boolean> {
  const canonical = itemIdMap[materialItemId] ?? materialItemId;
  const legacyIds = Object.entries(itemIdMap)
    .filter(([, newId]) => newId === materialItemId || newId === canonical)
    .map(([oldId]) => oldId);
  const idsToCheck = [...new Set([materialItemId, canonical, ...legacyIds])];

  const { count, error } = await supabase
    .from('material_bundle_items')
    .select('*', { count: 'exact', head: true })
    .eq('bundle_id', bundleId)
    .in('material_item_id', idsToCheck);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Map locked/proposal workbook material_item ids → job workbook (`working`) ids for the same quote.
 * Does not write to the database.
 */
export async function buildLockedToWorkingItemIdMap(
  jobId: string,
  quoteId: string,
): Promise<Record<string, string>> {
  const { data: wbs, error: wbErr } = await supabase
    .from('material_workbooks')
    .select('id, status, version_number')
    .eq('job_id', jobId)
    .eq('quote_id', quoteId);
  if (wbErr) throw wbErr;

  const locked = (wbs || [])
    .filter((w) => w.status === 'locked')
    .sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0))[0];
  const working = (wbs || [])
    .filter((w) => w.status === 'working')
    .sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0))[0];
  if (!locked?.id || !working?.id) return {};

  const [{ data: lockedSheets }, { data: workingSheets }] = await Promise.all([
    supabase
      .from('material_sheets')
      .select('id, sheet_name, order_index, sheet_type')
      .eq('workbook_id', locked.id)
      .order('order_index'),
    supabase
      .from('material_sheets')
      .select('id, sheet_name, order_index, sheet_type')
      .eq('workbook_id', working.id)
      .order('order_index'),
  ]);

  const workingSheetByKey = new Map<string, string>();
  for (const s of workingSheets || []) {
    const key = `${s.sheet_name}\0${s.order_index ?? 0}\0${s.sheet_type ?? 'proposal'}`;
    workingSheetByKey.set(key, s.id);
  }

  const itemIdMap: Record<string, string> = {};

  for (const lockedSheet of lockedSheets || []) {
    const key = `${lockedSheet.sheet_name}\0${lockedSheet.order_index ?? 0}\0${lockedSheet.sheet_type ?? 'proposal'}`;
    const workingSheetId = workingSheetByKey.get(key);
    if (!workingSheetId) continue;

    const [{ data: lockedItems }, { data: workingItems }] = await Promise.all([
      supabase
        .from('material_items')
        .select('id, material_name, sku, quantity, order_index')
        .eq('sheet_id', lockedSheet.id)
        .order('order_index'),
      supabase
        .from('material_items')
        .select('id, material_name, sku, quantity, order_index')
        .eq('sheet_id', workingSheetId)
        .order('order_index'),
    ]);

    const workingByKey = new Map<string, string>();
    for (const w of workingItems || []) {
      const itemKey = `${w.order_index ?? 0}\0${w.material_name}\0${w.sku ?? ''}\0${w.quantity ?? 0}`;
      workingByKey.set(itemKey, w.id);
    }

    for (const oldItem of lockedItems || []) {
      const itemKey = `${oldItem.order_index ?? 0}\0${oldItem.material_name}\0${oldItem.sku ?? ''}\0${oldItem.quantity ?? 0}`;
      const newId = workingByKey.get(itemKey);
      if (newId && newId !== oldItem.id) {
        itemIdMap[oldItem.id] = newId;
      }
    }
  }

  return itemIdMap;
}

/**
 * After contract sign, packages must reference the job workbook (`working`), not the locked proposal copy.
 * Builds old→new item map by matching sheets/items between locked and working workbooks for a quote.
 */
export async function remapMaterialBundleItemsForQuote(
  jobId: string,
  quoteId: string,
): Promise<number> {
  const itemIdMap = await buildLockedToWorkingItemIdMap(jobId, quoteId);
  const updated = await remapMaterialBundleItemsForJob(jobId, itemIdMap);
  const workingId = await resolveJobWorkbookIdForQuote(jobId, quoteId);
  await dedupeMaterialBundleItemsForJob(jobId, { quoteId, jobWorkbookId: workingId });
  return updated;
}
