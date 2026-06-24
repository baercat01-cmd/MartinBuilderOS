import type { SupabaseClient } from '@supabase/supabase-js';

export type PackageAssignment = {
  packageId: string;
  packageName: string;
  status: string;
};

export type PackageLike = {
  id: string;
  name: string;
  status?: string | null;
  bundle_items?: Array<{ material_item_id: string }>;
};

export function resolveDisplayedMaterialId(
  materialId: string,
  displayedItemIds: Set<string>,
  proposalToJobItemIdMap: Record<string, string> = {},
): string | null {
  if (displayedItemIds.has(materialId)) return materialId;
  const mapped = proposalToJobItemIdMap[materialId];
  if (mapped && displayedItemIds.has(mapped)) return mapped;
  return null;
}

/** First matching package wins when a material appears in multiple bundles. */
export function buildMaterialPackageAssignmentMap(
  packages: PackageLike[],
  displayedItemIds: Set<string>,
  proposalToJobItemIdMap: Record<string, string> = {},
): Map<string, PackageAssignment> {
  const map = new Map<string, PackageAssignment>();
  for (const pkg of packages) {
    const status = pkg.status ?? 'not_ordered';
    for (const bundleItem of pkg.bundle_items ?? []) {
      const resolvedId = resolveDisplayedMaterialId(
        bundleItem.material_item_id,
        displayedItemIds,
        proposalToJobItemIdMap,
      );
      if (!resolvedId || map.has(resolvedId)) continue;
      map.set(resolvedId, {
        packageId: pkg.id,
        packageName: pkg.name,
        status,
      });
    }
  }
  return map;
}

export async function updatePackageStatusAndMaterials(
  supabase: SupabaseClient,
  packageId: string,
  newStatus: string,
  materialItemIds: string[],
): Promise<void> {
  const { error: bundleError } = await supabase
    .from('material_bundles')
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', packageId);

  if (bundleError) throw bundleError;

  if (materialItemIds.length === 0) return;

  const { error: updateError } = await supabase
    .from('material_items')
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .in('id', materialItemIds);

  if (updateError) throw updateError;
}

export async function syncMaterialsToPackageStatus(
  supabase: SupabaseClient,
  materialItemIds: string[],
  packageStatus: string,
): Promise<void> {
  if (materialItemIds.length === 0) return;

  const { error } = await supabase
    .from('material_items')
    .update({
      status: packageStatus,
      updated_at: new Date().toISOString(),
    })
    .in('id', materialItemIds);

  if (error) throw error;
}

export const MATERIAL_PACKAGE_STATUS_UPDATED_EVENT = 'material-package-status-updated';

export const MATERIAL_ITEM_STATUS_UPDATED_EVENT = 'material-item-status-updated';

export function dispatchMaterialPackageStatusUpdated(detail: {
  packageId: string;
  newStatus: string;
  materialItemIds: string[];
}) {
  window.dispatchEvent(
    new CustomEvent(MATERIAL_PACKAGE_STATUS_UPDATED_EVENT, { detail }),
  );
}

export function dispatchMaterialItemStatusUpdated(detail: {
  jobId?: string | null;
  quoteId?: string | null;
  materialItemIds: string[];
  newStatus: string;
  packageIds?: string[];
  packageStatuses?: Record<string, string>;
}) {
  window.dispatchEvent(
    new CustomEvent(MATERIAL_ITEM_STATUS_UPDATED_EVENT, { detail }),
  );
}

const STATUS_WORKFLOW_ORDER = [
  'not_ordered',
  'ordered',
  'received',
  'pull_from_shop',
  'ready_for_job',
  'at_job',
] as const;

/** When all lines share a status use it; otherwise use the earliest workflow stage present. */
export function derivePackageStatusFromMaterialStatuses(statuses: string[]): string {
  if (statuses.length === 0) return 'not_ordered';
  const normalized = statuses.map((s) => s || 'not_ordered');
  const unique = [...new Set(normalized)];
  if (unique.length === 1) return unique[0]!;
  return normalized.reduce((min, status) => {
    const si = STATUS_WORKFLOW_ORDER.indexOf(status as (typeof STATUS_WORKFLOW_ORDER)[number]);
    const mi = STATUS_WORKFLOW_ORDER.indexOf(min as (typeof STATUS_WORKFLOW_ORDER)[number]);
    if (si < 0) return min;
    if (mi < 0) return status;
    return si < mi ? status : min;
  }, normalized[0]!);
}

export async function syncPackageStatusFromMaterialItems(
  supabase: SupabaseClient,
  packageId: string,
): Promise<string | null> {
  const { data: bundleItems, error: itemsError } = await supabase
    .from('material_bundle_items')
    .select('material_item_id')
    .eq('bundle_id', packageId);
  if (itemsError) throw itemsError;
  if (!bundleItems?.length) return null;

  const materialIds = bundleItems.map((row) => row.material_item_id);
  const { data: materials, error: matError } = await supabase
    .from('material_items')
    .select('status')
    .in('id', materialIds);
  if (matError) throw matError;

  const derived = derivePackageStatusFromMaterialStatuses(
    (materials || []).map((row) => row.status ?? 'not_ordered'),
  );

  const { error: bundleError } = await supabase
    .from('material_bundles')
    .update({
      status: derived,
      updated_at: new Date().toISOString(),
    })
    .eq('id', packageId);
  if (bundleError) throw bundleError;

  return derived;
}

/** Update one material line and optionally realign its package summary status. */
export async function updateMaterialItemStatus(
  supabase: SupabaseClient,
  materialItemId: string,
  newStatus: string,
  options?: { syncPackageStatus?: boolean },
): Promise<{ packageIds: string[]; packageStatuses: Record<string, string> }> {
  const { error } = await supabase
    .from('material_items')
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', materialItemId);

  if (error) throw error;

  const packageIds: string[] = [];
  const packageStatuses: Record<string, string> = {};
  if (options?.syncPackageStatus !== false) {
    const { data: bundleLinks, error: linkError } = await supabase
      .from('material_bundle_items')
      .select('bundle_id')
      .eq('material_item_id', materialItemId);
    if (linkError) throw linkError;

    for (const link of bundleLinks || []) {
      if (!link.bundle_id || packageIds.includes(link.bundle_id)) continue;
      packageIds.push(link.bundle_id);
      const derived = await syncPackageStatusFromMaterialItems(supabase, link.bundle_id);
      if (derived) packageStatuses[link.bundle_id] = derived;
    }
  }

  return { packageIds, packageStatuses };
}
