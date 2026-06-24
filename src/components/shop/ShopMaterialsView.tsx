import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Search, X, CheckCircle2, Package, ChevronDown, ChevronRight, Truck, Building2, FileSpreadsheet, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { TrimDrawingPreview, getCutLengthFromTrimConfig, formatLengthInches, type LineSegment } from '@/components/office/TrimDrawingPreview';
import { TrimDrawingFullScreenView } from '@/components/office/TrimDrawingFullScreenView';
import { extractFlatstockCutListSnippet } from '@/lib/flatstockCutListNotes';
import { dedupeMaterialBundleItemsForJob } from '@/lib/materialBundleRemap';
import {
  dispatchMaterialItemStatusUpdated,
  updateMaterialItemStatus,
} from '@/lib/materialPackageStatus';
import { isTrimSlittingPlanV1, type TrimSlittingPlanV1 } from '@/lib/trimFlatstockOptimize';

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

function normalizeDrawingSegments(raw: unknown): LineSegment[] {
  if (!raw) return [];
  try {
    let arr: unknown[] = typeof raw === 'string' ? JSON.parse(raw) : raw as unknown;
    if (arr && typeof arr === 'object' && !Array.isArray(arr) && 'segments' in arr) arr = (arr as { segments: unknown[] }).segments;
    if (!Array.isArray(arr) || arr.length === 0) return [];
    return arr.map((seg: any, index: number) => ({
      id: seg.id ?? `seg-${index}`,
      start: seg.start ? { x: toNum(seg.start.x), y: toNum(seg.start.y) } : { x: 0, y: 0 },
      end: seg.end ? { x: toNum(seg.end.x), y: toNum(seg.end.y) } : { x: 0, y: 0 },
      label: seg.label ?? String.fromCharCode(65 + index),
      hasHem: seg.hasHem === true,
      hemAtStart: seg.hemAtStart === true,
      hemSide: seg.hemSide === 'left' || seg.hemSide === 'right' ? seg.hemSide : 'right',
    }));
  } catch {
    return [];
  }
}

const TRIM_PREVIEW_SIZE = { width: 88, height: 48 };
const SHOP_EXPANDED_STORAGE_KEY = 'shop-materials-expanded';

function loadExpandedFromStorage(): Set<string> {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(SHOP_EXPANDED_STORAGE_KEY) : null;
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
    }
  } catch (_) {}
  return new Set();
}

function saveExpandedToStorage(set: Set<string>) {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SHOP_EXPANDED_STORAGE_KEY, JSON.stringify([...set]));
  } catch (_) {}
}

/** Small trim preview that fetches config by id then shows TrimDrawingPreview; click opens full screen. */
function LazyTrimPreview({
  trimConfigId,
  onOpenFullScreen,
}: {
  trimConfigId: string;
  onOpenFullScreen: (config: { name: string; drawing_segments: unknown }) => void;
}) {
  const [config, setConfig] = useState<{ name: string; drawing_segments: unknown } | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('trim_saved_configs')
      .select('id, name, drawing_segments')
      .eq('id', trimConfigId)
      .single()
      .then(({ data }) => {
        if (!cancelled && data?.drawing_segments != null) setConfig({ name: data.name ?? 'Trim', drawing_segments: data.drawing_segments });
      });
    return () => { cancelled = true; };
  }, [trimConfigId]);
  if (!config) {
    return (
      <div className="flex items-center justify-center flex-shrink-0" style={{ width: TRIM_PREVIEW_SIZE.width, height: TRIM_PREVIEW_SIZE.height }} title="Loading trim…">
        <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpenFullScreen(config)}
      title="View trim drawing (click to enlarge)"
      className="flex-shrink-0 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 rounded"
    >
      <TrimDrawingPreview segments={normalizeDrawingSegments(config.drawing_segments)} width={TRIM_PREVIEW_SIZE.width} height={TRIM_PREVIEW_SIZE.height} />
    </button>
  );
}

/** Load trim by material item id (when list didn't include trim_saved_config_id); shows preview if linked. */
function LazyTrimPreviewByMaterialItemId({
  materialItemId,
  onOpenFullScreen,
}: {
  materialItemId: string;
  onOpenFullScreen: (config: { name: string; drawing_segments: unknown }) => void;
}) {
  const [config, setConfig] = useState<{ name: string; drawing_segments: unknown } | null>(null);
  const [noTrim, setNoTrim] = useState(false);
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('material_items')
      .select('trim_saved_config_id')
      .eq('id', materialItemId)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        const configId = data?.trim_saved_config_id;
        if (!configId) {
          setNoTrim(true);
          return;
        }
        return supabase
          .from('trim_saved_configs')
          .select('id, name, drawing_segments')
          .eq('id', configId)
          .single();
      })
      .then((res: any) => {
        if (cancelled) return;
        if (res?.error || !res?.data?.drawing_segments) {
          setNoTrim(true);
          return;
        }
        setConfig({ name: res.data.name ?? 'Trim', drawing_segments: res.data.drawing_segments });
      });
    return () => { cancelled = true; };
  }, [materialItemId]);
  if (noTrim) return null;
  if (!config) {
    return (
      <div className="flex items-center justify-center flex-shrink-0" style={{ width: TRIM_PREVIEW_SIZE.width, height: TRIM_PREVIEW_SIZE.height }} title="Loading trim…">
        <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpenFullScreen(config)}
      title="View trim drawing (click to enlarge)"
      className="flex-shrink-0 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 rounded"
    >
      <TrimDrawingPreview segments={normalizeDrawingSegments(config.drawing_segments)} width={TRIM_PREVIEW_SIZE.width} height={TRIM_PREVIEW_SIZE.height} />
    </button>
  );
}

interface MaterialItem {
  id: string;
  sheet_id: string;
  category: string;
  material_name: string;
  quantity: number;
  length: string | null;
  color: string | null;
  usage: string | null;
  status: string;
  cost_per_unit: number | null;
  notes?: string | null;
  quantity_ready_for_job?: number;
  trim_saved_config_id?: string | null;
  trim_cut_state?: 'pending' | 'in_progress' | 'cut_complete' | null;
  trim_saved_configs?: { id: string; name: string; drawing_segments: unknown } | null;
  sheets: {
    sheet_name: string;
  };
}

interface BundleItem {
  id: string;
  bundle_id: string;
  material_item_id: string;
  material_items: MaterialItem;
}

interface MaterialBundle {
  id: string;
  job_id: string;
  name: string;
  description: string | null;
  status: string;
  bundle_items: BundleItem[];
  jobs: {
    name: string;
    client_name: string;
  };
}

// Supabase query response type (with arrays from joins)
interface SupabaseBundleResponse {
  id: string;
  job_id: string;
  name: string;
  description: string | null;
  status: string;
  jobs: Array<{
    name: string;
    client_name: string;
  }>;
  bundle_items: Array<{
    id: string;
    bundle_id: string;
    material_item_id: string;
    material_items: Array<{
      id: string;
      sheet_id: string;
      category: string;
      material_name: string;
      quantity: number;
      length: string | null;
      usage: string | null;
      status: string;
      cost_per_unit: number | null;
      sheets: Array<{
        sheet_name: string;
      }>;
    }>;
  }>;
}

interface JobGroup {
  jobId: string;
  jobName: string;
  clientName: string;
  packages: MaterialBundle[];
  /** Unbundled materials with pull_from_shop/ready_for_job, grouped by sheet (same flow as packages) */
  sheetGroups: MaterialBundle[];
}

interface ShopMaterialsViewProps {
  userId: string;
}

export function ShopMaterialsView({ userId }: ShopMaterialsViewProps) {
  const [packages, setPackages] = useState<MaterialBundle[]>([]);
  /** Unbundled materials (pull_from_shop / ready_for_job) grouped by job + sheet, same shape as packages */
  const [sheetGroups, setSheetGroups] = useState<MaterialBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterJob, setFilterJob] = useState('all');
  const [jobs, setJobs] = useState<any[]>([]);
  const [expandedPackages, setExpandedPackages] = useState<Set<string>>(loadExpandedFromStorage);
  const [processingMaterials, setProcessingMaterials] = useState<Set<string>>(new Set());
  const [viewingTrimConfig, setViewingTrimConfig] = useState<{ name: string; drawing_segments: unknown } | null>(null);
  const [loadingTrimId, setLoadingTrimId] = useState<string | null>(null);
  /** For partial mark-ready: material_item_id -> input value string */
  const [partialQtyInput, setPartialQtyInput] = useState<Record<string, string>>({});

  /** Shared trim slitting plan per workbook (loaded from material_workbooks.trim_flatstock_plan). */
  const [trimPlansByWorkbookId, setTrimPlansByWorkbookId] = useState<Record<string, TrimSlittingPlanV1>>({});
  /** For each trim material item, which other trim items must be cut_complete first. */
  const [trimDepsByItemId, setTrimDepsByItemId] = useState<Record<string, string[]>>({});
  /** Live trim cut state for gating + UI. */
  const [trimCutStateById, setTrimCutStateById] = useState<Record<string, 'pending' | 'in_progress' | 'cut_complete'>>({});
  /** Shared computed cut list snippet per item (used when notes haven't been applied yet). */
  const [trimCutSnippetByItemId, setTrimCutSnippetByItemId] = useState<Record<string, string>>({});

  async function openTrimDrawing(trimConfigId: string) {
    if (!trimConfigId || loadingTrimId) return;
    setLoadingTrimId(trimConfigId);
    try {
      const { data, error } = await supabase
        .from('trim_saved_configs')
        .select('id, name, drawing_segments')
        .eq('id', trimConfigId)
        .single();
      if (error) throw error;
      if (data?.drawing_segments != null)
        setViewingTrimConfig({ name: data.name ?? 'Trim', drawing_segments: data.drawing_segments });
      else
        toast.error('No drawing saved for this trim.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not load trim drawing.');
    } finally {
      setLoadingTrimId(null);
    }
  }

  // Persist expanded state so refresh / reload keeps last opened sections
  useEffect(() => {
    saveExpandedToStorage(expandedPackages);
  }, [expandedPackages]);

  useEffect(() => {
    loadPackages();
    loadJobs();
    
    // Subscribe to package changes
    const bundlesChannel = supabase
      .channel('shop_bundles_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'material_bundles' },
        () => {
          loadPackages();
        }
      )
      .subscribe();

    // Subscribe to material item changes
    const itemsChannel = supabase
      .channel('shop_items_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'material_items' },
        () => {
          loadPackages();
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(bundlesChannel);
      supabase.removeChannel(itemsChannel);
    };
  }, []);

  async function loadJobs() {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, name, client_name, status')
        .order('name');

      if (error) throw error;
      setJobs(data || []);
    } catch (error: any) {
      console.error('Error loading jobs:', error);
    }
  }

  async function loadPackages() {
    try {
      setLoading(true);
      
      console.log('🔍 SHOP VIEW: Loading packages with materials that need to be pulled from shop...');

      const bundleSelectFull = `
          id,
          job_id,
          name,
          description,
          status,
          jobs!inner (
            id,
            name,
            client_name
          ),
          bundle_items:material_bundle_items (
            id,
            bundle_id,
            material_item_id,
            material_items!inner (
              id,
              sheet_id,
              category,
              material_name,
              quantity,
              length,
              color,
              usage,
              status,
              cost_per_unit,
              trim_saved_config_id,
              quantity_ready_for_job,
              sheets:material_sheets(sheet_name)
            )
          )
        `;
      const bundleSelectMinimal = `
          id,
          job_id,
          name,
          description,
          status,
          jobs!inner (
            id,
            name,
            client_name
          ),
          bundle_items:material_bundle_items (
            id,
            bundle_id,
            material_item_id,
            material_items!inner (
              id,
              sheet_id,
              category,
              material_name,
              quantity,
              length,
              color,
              usage,
              status,
              cost_per_unit,
              sheets:material_sheets(sheet_name)
            )
          )
        `;

      let allBundles: any[] | null = null;
      let bundlesError: any = null;

      const res = await supabase.from('material_bundles').select(bundleSelectFull).order('name');
      bundlesError = res.error;
      allBundles = res.data;

      if (bundlesError && /schema cache|could not find|column.*does not exist|quantity_ready_for_job|trim_saved_config_id/i.test(bundlesError.message)) {
        console.warn('⚠️ Retrying without trim_saved_config_id/quantity_ready_for_job:', bundlesError.message);
        const fallback = await supabase.from('material_bundles').select(bundleSelectMinimal).order('name');
        if (!fallback.error) {
          allBundles = fallback.data;
          bundlesError = null;
        } else {
          bundlesError = fallback.error;
        }
      }

      if (bundlesError) {
        console.error('❌ Error loading bundles:', bundlesError);
        toast.error('Failed to load packages: ' + bundlesError.message);
        throw bundlesError;
      }
      
      console.log(`📦 SHOP VIEW: Loaded ${allBundles?.length || 0} total bundles from database`);
      console.log('📦 SHOP VIEW: Looking for materials with status: pull_from_shop OR ready_for_job');
      
      if (!allBundles || allBundles.length === 0) {
        console.log('❌ SHOP VIEW: No bundles found in database');
        setPackages([]);
        setSheetGroups([]);
        setLoading(false);
        return;
      }

      const jobIds = [...new Set(allBundles.map((b: { job_id: string }) => b.job_id).filter(Boolean))];
      for (const jid of jobIds) {
        try {
          await dedupeMaterialBundleItemsForJob(jid);
        } catch (dedupeErr) {
          console.warn('ShopMaterialsView dedupe:', dedupeErr);
        }
      }

      // Re-fetch after dedupe so bundle_items reflect cleanup
      const refetch = await supabase.from('material_bundles').select(bundleSelectFull).order('name');
      if (!refetch.error && refetch.data) {
        allBundles = refetch.data;
      }
      
      console.log('📦 SHOP VIEW: Sample bundle structure:', JSON.stringify(allBundles[0], null, 2));
      console.log('📦 SHOP VIEW: All bundles:', allBundles.map(b => ({ id: b.id, name: b.name, itemCount: b.bundle_items?.length || 0 })));
      
      // Transform Supabase response to match our interface with better error handling
      const transformedPackages: MaterialBundle[] = (allBundles || []).map((pkg: any) => {
        console.log(`🔧 Processing bundle "${pkg.name}":`, {
          bundleId: pkg.id,
          jobsType: typeof pkg.jobs,
          jobsIsArray: Array.isArray(pkg.jobs),
          jobsValue: pkg.jobs,
          bundleItemsCount: pkg.bundle_items?.length || 0
        });
        
        // Safely access nested data - Supabase returns objects not arrays for single relations
        const job = pkg.jobs || { name: 'Unknown Job', client_name: '' };
        
        const bundleItems = (pkg.bundle_items || []).map(item => {
          // Supabase may return nested relation as array (one element) or object; normalize to object
          const raw = item.material_items;
          const materialItem = Array.isArray(raw) ? raw[0] : raw;
          
          if (!materialItem) {
            console.warn('⚠️ Bundle item missing material_items:', item);
            return null;
          }
          
          const sheet = materialItem.sheets || (Array.isArray(materialItem.sheets) ? materialItem.sheets[0] : materialItem.sheets) || { sheet_name: 'Unknown Sheet' };
          
          return {
            ...item,
            material_items: {
              ...materialItem,
              sheets: sheet,
            },
          };
        }).filter(Boolean); // Remove null items

        const seenMaterialIds = new Set<string>();
        const seenFingerprints = new Set<string>();
        const dedupedBundleItems = (bundleItems as any[]).filter((item) => {
          const mid = item.material_item_id;
          if (seenMaterialIds.has(mid)) return false;
          seenMaterialIds.add(mid);
          const mi = item.material_items;
          const fp = [
            mi?.sheets?.sheet_name ?? '',
            mi?.material_name ?? '',
            mi?.sku ?? '',
            mi?.quantity ?? 0,
            mi?.usage ?? '',
            mi?.length ?? '',
          ].join('|');
          if (seenFingerprints.has(fp)) return false;
          seenFingerprints.add(fp);
          return true;
        });
        
        console.log(`✅ Transformed bundle "${pkg.name}":`, {
          job: job.name,
          itemCount: dedupedBundleItems.length
        });
        
        return {
          ...pkg,
          jobs: job,
          bundle_items: dedupedBundleItems as any,
        };
      });
      
      console.log('🔄 SHOP VIEW: Transformed', transformedPackages.length, 'packages');

      // Enrich with trim_saved_config_id when main query used minimal select (no trim column)
      const bundleMaterialIds = [...new Set((transformedPackages || []).flatMap((pkg: any) =>
        (pkg.bundle_items || []).map((bi: any) => bi.material_items?.id).filter(Boolean)
      ))];
      let trimIdByMaterialId = new Map<string, string>();
      if (bundleMaterialIds.length > 0) {
        const { data: trimLinks, error: trimLinkErr } = await supabase
          .from('material_items')
          .select('id, trim_saved_config_id')
          .in('id', bundleMaterialIds);
        if (!trimLinkErr && trimLinks?.length) {
          trimLinks.forEach((r: any) => {
            if (r.trim_saved_config_id) trimIdByMaterialId.set(r.id, r.trim_saved_config_id);
          });
        }
      }
      const packagesWithTrimId: MaterialBundle[] = transformedPackages.map((pkg: any) => ({
        ...pkg,
        bundle_items: (pkg.bundle_items || []).map((item: any) => {
          const mi = item.material_items;
          const trimId = mi?.trim_saved_config_id ?? (mi?.id ? trimIdByMaterialId.get(mi.id) : null);
          return { ...item, material_items: { ...mi, trim_saved_config_id: trimId ?? mi?.trim_saved_config_id } };
        }),
      }));

      // Fetch trim configs for linked trim and attach to material items
      const bundleTrimIds = [...new Set((packagesWithTrimId || []).flatMap((pkg: any) =>
        (pkg.bundle_items || []).map((bi: any) => bi.material_items?.trim_saved_config_id).filter(Boolean)
      ))];
      const trimConfigMap = new Map<string, { id: string; name: string; drawing_segments: unknown }>();
      if (bundleTrimIds.length > 0) {
        const { data: trimConfigs } = await supabase
          .from('trim_saved_configs')
          .select('id, name, drawing_segments')
          .in('id', bundleTrimIds);
        (trimConfigs || []).forEach((c: any) => trimConfigMap.set(c.id, c));
      }
      const packagesWithTrimAttached: MaterialBundle[] = packagesWithTrimId.map((pkg: any) => ({
        ...pkg,
        bundle_items: (pkg.bundle_items || []).map((item: any) => {
          const rawMi = item.material_items;
          const mi = Array.isArray(rawMi) ? rawMi[0] : rawMi;
          const trimConfig = mi?.trim_saved_config_id ? trimConfigMap.get(mi.trim_saved_config_id) : null;
          return {
            ...item,
            material_items: {
              ...mi,
              trim_saved_configs: trimConfig || null,
            },
          };
        }),
      }));
      
      // Filter to only include packages that have materials with 'pull_from_shop' status
      const packagesWithShopMaterials = packagesWithTrimAttached.filter(pkg => {
        if (!pkg.bundle_items || pkg.bundle_items.length === 0) {
          console.log(`⚠️ SHOP VIEW: Package "${pkg.name}" has NO bundle_items`);
          return false;
        }
        
        const shopMaterials = pkg.bundle_items.filter(item => 
          item && item.material_items && (item.material_items.status === 'pull_from_shop' || item.material_items.status === 'ready_for_job')
        );
        
        const hasShopMaterials = shopMaterials.length > 0;
        
        if (hasShopMaterials) {
          console.log(`✅ SHOP VIEW: Package "${pkg.name}" (Job: ${pkg.jobs?.name}) has ${shopMaterials.length} materials to process:`,   
            shopMaterials.map(item => ({
              id: item.material_items.id,
              material: item.material_items.material_name,
              status: item.material_items.status,
              qty: item.material_items.quantity
            }))
          );
        } else {
          console.log(`⏭️ SHOP VIEW: Package "${pkg.name}" has NO pull_from_shop materials`);
        }
        
        return hasShopMaterials;
      });
      
      console.log(`✅ SHOP VIEW: Found ${packagesWithShopMaterials.length} packages with materials to pull`);
      
      if (packagesWithShopMaterials.length === 0) {
        console.warn('⚠️ SHOP VIEW: NO PACKAGES WITH PULL FROM SHOP MATERIALS FOUND!');
        console.warn('⚠️ Total packages checked:', transformedPackages.length);
        console.warn('⚠️ This might mean all materials have been processed or none have pull_from_shop status');
      }
      
      setPackages(packagesWithShopMaterials);

      // Load unbundled material_items (pull_from_shop / ready_for_job) — drive by materials so we include all such items regardless of workbook status
      const { data: bundledItemIds } = await supabase
        .from('material_bundle_items')
        .select('material_item_id');
      const bundledSet = new Set((bundledItemIds || []).map((r: any) => r.material_item_id));

      const unbundledSelectFull = `id, sheet_id, category, material_name, quantity, length, color, usage, status, cost_per_unit, trim_saved_config_id, quantity_ready_for_job, trim_cut_state, notes`;
      // Minimal fallback for environments that have not run trim cut-state migration yet.
      const unbundledSelectMinimal = `id, sheet_id, category, material_name, quantity, length, color, usage, status, cost_per_unit, notes`;
      const unbundledRes = await supabase
        .from('material_items')
        .select(unbundledSelectFull)
        .in('status', ['pull_from_shop', 'ready_for_job']);
      let unbundledRows: any[] | null = unbundledRes.data ?? null;
      if (unbundledRes.error && /schema cache|could not find|column.*does not exist|quantity_ready_for_job|trim_saved_config_id|trim_cut_state/i.test(unbundledRes.error.message)) {
        const fallback = await supabase.from('material_items').select(unbundledSelectMinimal).in('status', ['pull_from_shop', 'ready_for_job']);
        if (!fallback.error) unbundledRows = fallback.data ?? null;
      }
      if (unbundledRes.error && unbundledRows === null) {
        throw new Error(unbundledRes.error.message);
      }

      let unbundledItems = (unbundledRows || []).filter((r: any) => !bundledSet.has(r.id));
      if (unbundledItems.length === 0) {
        setSheetGroups([]);
        setExpandedPackages(new Set());
        setLoading(false);
        return;
      }

      // Enrich unbundled with trim_saved_config_id (needed when minimal select was used; otherwise reinforces from DB)
      const unbundledIds = unbundledItems.map((i: any) => i.id);
      const { data: unbundledTrimLinks, error: unbundledTrimLinkErr } = await supabase
        .from('material_items')
        .select('id, trim_saved_config_id')
        .in('id', unbundledIds);
      const trimIdByUnbundledId = new Map<string, string>();
      if (!unbundledTrimLinkErr && unbundledTrimLinks?.length) {
        unbundledTrimLinks.forEach((r: any) => {
          if (r.trim_saved_config_id) trimIdByUnbundledId.set(r.id, r.trim_saved_config_id);
        });
      }
      unbundledItems = unbundledItems.map((i: any) => ({
        ...i,
        trim_saved_config_id: unbundledTrimLinkErr ? (i.trim_saved_config_id ?? null) : (trimIdByUnbundledId.get(i.id) ?? i.trim_saved_config_id ?? null),
      }));

      const unbundledTrimIds = [...new Set(unbundledItems.map((i: any) => i.trim_saved_config_id).filter(Boolean))];
      const unbundledTrimMap = new Map<string, { id: string; name: string; drawing_segments: unknown }>();
      if (unbundledTrimIds.length > 0) {
        const { data: trimConfigs } = await supabase
          .from('trim_saved_configs')
          .select('id, name, drawing_segments')
          .in('id', unbundledTrimIds);
        (trimConfigs || []).forEach((c: any) => unbundledTrimMap.set(c.id, c));
      }

      const sheetIdsFromItems = [...new Set(unbundledItems.map((i: any) => i.sheet_id))];
      const { data: sheetsData } = await supabase
        .from('material_sheets')
        .select('id, sheet_name, workbook_id')
        .in('id', sheetIdsFromItems);
      const sheetMap = new Map((sheetsData || []).map((s: any) => [s.id, s]));

      const workbookIdsFromSheets = [...new Set((sheetsData || []).map((s: any) => s.workbook_id))];
      const { data: workbookJobs } = await supabase
        .from('material_workbooks')
        .select('id, job_id, trim_flatstock_plan')
        .in('id', workbookIdsFromSheets);
      const wbToJob = new Map((workbookJobs || []).map((w: any) => [w.id, w.job_id]));

      // Load shared trim slitting plans (if present) so shop sees the same cut order/cutoffs as office.
      const planByWorkbookId: Record<string, TrimSlittingPlanV1> = {};
      const planMaterialItemIds = new Set<string>();
      for (const wb of workbookJobs || []) {
        if (wb?.trim_flatstock_plan && isTrimSlittingPlanV1(wb.trim_flatstock_plan)) {
          planByWorkbookId[wb.id] = wb.trim_flatstock_plan as TrimSlittingPlanV1;
          for (const sh of wb.trim_flatstock_plan.sheets || []) {
            for (const st of sh.strips || []) {
              if (st?.materialItemId) planMaterialItemIds.add(st.materialItemId);
            }
          }
        }
      }

      setTrimPlansByWorkbookId(planByWorkbookId);

      // Fetch cut state for any trim item referenced by the plan(s), so gating is consistent.
      const cutStateById: Record<string, 'pending' | 'in_progress' | 'cut_complete'> = {};
      const depsByItemId: Record<string, string[]> = {};
      const snippetByItemId: Record<string, string> = {};
      if (planMaterialItemIds.size > 0) {
        const { data: planItems } = await supabase
          .from('material_items')
          .select('id, trim_cut_state')
          .in('id', [...planMaterialItemIds]);
        for (const r of planItems || []) {
          const v = r?.trim_cut_state;
          if (v === 'pending' || v === 'in_progress' || v === 'cut_complete') {
            cutStateById[r.id] = v;
          }
        }

        for (const planWbId of Object.keys(planByWorkbookId)) {
          const plan = planByWorkbookId[planWbId];
          const strips = (plan.sheets || []).flatMap((sh) => sh.strips || []);
          const byInstance = new Map<string, any>(strips.map((s: any) => [s.stripInstanceId, s]));
          const itemIds = [...new Set(strips.map((s: any) => s.materialItemId).filter(Boolean))] as string[];

          // Instance lines for displaying the shared cut list even when notes haven't been applied yet.
          const instancesByItem: Record<string, string[]> = {};
          const materialNameByItem: Record<string, string> = {};
          const W = plan.flatstockWidthInches;
          const stickFt = plan.stickLengthInches / 12;
          for (const sh of plan.sheets || []) {
            for (const st of sh.strips || []) {
              if (!st?.materialItemId) continue;
              const cutoffBeforeRounded = Math.round(st.cutoffBeforeWidthInches * 100) / 100;
              const line = `Sheet ${sh.sheetIndex}, strip #${st.cutOrder}: use ${cutoffBeforeRounded}" cutoff to cut ${st.stretchOutInches.toFixed(2)}" strip (${stickFt}' long), then cut trim piece to ${st.pieceLengthInches.toFixed(2)}" length.`;
              if (!instancesByItem[st.materialItemId]) instancesByItem[st.materialItemId] = [];
              instancesByItem[st.materialItemId].push(line);
              materialNameByItem[st.materialItemId] = st.materialName ?? materialNameByItem[st.materialItemId] ?? st.materialItemId;
            }
          }

          for (const itemId of itemIds) {
            const deps = new Set<string>();
            const starts = strips.filter((s: any) => s.materialItemId === itemId);
            for (const start of starts) {
              let cur = start;
              while (cur?.usesCutoffFromStripInstanceId) {
                const parent = byInstance.get(cur.usesCutoffFromStripInstanceId);
                if (!parent) break;
                if (parent.materialItemId && parent.materialItemId !== itemId) deps.add(parent.materialItemId);
                cur = parent;
              }
            }
            depsByItemId[itemId] = [...deps];

            const instances = instancesByItem[itemId] ?? [];
            const materialName = materialNameByItem[itemId] ?? itemId;
            snippetByItemId[itemId] = [
              `Coil width: ${W}" (${stickFt}' slitting strips)`,
              `Material: ${materialName}`,
              `Planned strips: ${instances.length}`,
              ...(instances.length
                ? ['Instances (cut order, widest-first):', ...instances.map((x) => `- ${x}`)]
                : ['Instances: none in current plan.']),
            ].join('\n');
          }
        }
      }

      setTrimCutStateById(cutStateById);
      setTrimDepsByItemId(depsByItemId);
      setTrimCutSnippetByItemId(snippetByItemId);

      const { data: jobsData } = await supabase
        .from('jobs')
        .select('id, name, client_name')
        .in('id', [...new Set(unbundledItems.map((i: any) => {
          const sh = sheetMap.get(i.sheet_id);
          return sh ? wbToJob.get(sh.workbook_id) : null;
        }).filter(Boolean))]);
      const jobMap = new Map((jobsData || []).map((j: any) => [j.id, j]));

      const byJobSheet = new Map<string, any[]>();
      for (const item of unbundledItems) {
        const sheet = sheetMap.get(item.sheet_id);
        const jobId = sheet ? wbToJob.get(sheet.workbook_id) : null;
        if (!jobId || !sheet) continue;
        const key = `${jobId}|${item.sheet_id}`;
        if (!byJobSheet.has(key)) byJobSheet.set(key, []);
        const trimConfig = item.trim_saved_config_id ? unbundledTrimMap.get(item.trim_saved_config_id) : null;
        byJobSheet.get(key)!.push({
          ...item,
          sheets: { sheet_name: sheet.sheet_name },
          trim_saved_configs: trimConfig || null,
        });
      }

      const builtSheetGroups: MaterialBundle[] = [];
      for (const [key, items] of byJobSheet) {
        const [jobId, sheetId] = key.split('|');
        const job = jobMap.get(jobId) || { name: 'Unknown', client_name: '' };
        const sheet = sheetMap.get(sheetId);
        const sheetName = sheet?.sheet_name || 'Unknown Sheet';
        const bundleItems = items.map((m: any) => ({
          id: m.id,
          bundle_id: `unbundled-${jobId}-${sheetId}`,
          material_item_id: m.id,
          material_items: m,
        }));
        builtSheetGroups.push({
          id: `unbundled-${jobId}-${sheetId}`,
          job_id: jobId,
          name: sheetName,
          description: null,
          status: 'pull_from_shop',
          jobs: job,
          bundle_items: bundleItems,
        });
      }
      setSheetGroups(builtSheetGroups);
    } catch (error: any) {
      console.error('❌ Error loading packages:', error);
      const msg = error?.message || String(error);
      toast.error(msg ? `Failed to load packages: ${msg}` : 'Failed to load packages. Check console for details.');
    } finally {
      setLoading(false);
    }
  }

  async function updateTrimCutState(materialItemId: string, newState: 'pending' | 'in_progress' | 'cut_complete') {
    if (processingMaterials.has(materialItemId)) return;
    setProcessingMaterials((prev) => new Set(prev).add(materialItemId));
    try {
      const { error } = await supabase
        .from('material_items')
        .update({ trim_cut_state: newState, updated_at: new Date().toISOString() })
        .eq('id', materialItemId);
      if (error) throw error;

      setTrimCutStateById((prev) => ({
        ...prev,
        [materialItemId]: newState,
      }));
      toast.success(`Trim marked: ${String(newState).replace(/_/g, ' ')}`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update trim cut state');
    } finally {
      setProcessingMaterials((prev) => {
        const next = new Set(prev);
        next.delete(materialItemId);
        return next;
      });
    }
  }

  async function updateMaterialStatus(materialId: string, bundleId: string, currentStatus: string, newStatus: 'ready_for_job' | 'at_job') {
    if (processingMaterials.has(materialId)) return;

    setProcessingMaterials(prev => new Set(prev).add(materialId));

    try {
      const jobId = packages.find((p) => p.id === bundleId)?.job_id
        ?? sheetGroups.find((p) => p.id === bundleId)?.job_id;

      const { packageIds, packageStatuses } = await updateMaterialItemStatus(
        supabase,
        materialId,
        newStatus,
        { syncPackageStatus: !bundleId.startsWith('unbundled-') },
      );

      dispatchMaterialItemStatusUpdated({
        jobId,
        materialItemIds: [materialId],
        newStatus,
        packageIds: bundleId.startsWith('unbundled-') ? [] : packageIds,
        packageStatuses: bundleId.startsWith('unbundled-') ? undefined : packageStatuses,
      });

      toast.success(`Material marked as ${newStatus === 'ready_for_job' ? 'Ready for Job' : 'At Job'}`);

      loadPackages();
    } catch (error: any) {
      console.error('Error updating material:', error);
      toast.error(`Failed to update material: ${error.message || 'Unknown error'}`);
    } finally {
      setProcessingMaterials(prev => {
        const newSet = new Set(prev);
        newSet.delete(materialId);
        return newSet;
      });
    }
  }

  async function updateBundleStatusIfFirstReady(bundleId: string) {
    if (bundleId.startsWith('unbundled-')) return;
    try {
      const { data: bundleItems, error } = await supabase
        .from('material_bundle_items')
        .select('material_item_id, material_items!inner(status)')
        .eq('bundle_id', bundleId);
      if (error || !bundleItems?.length) return;
      const readyCount = bundleItems.filter(
        (item: any) => item.material_items?.status === 'ready_for_job' || item.material_items?.status === 'at_job'
      ).length;
      if (readyCount === 1) {
        await supabase
          .from('material_bundles')
          .update({ status: 'delivered', updated_at: new Date().toISOString() })
          .eq('id', bundleId);
      }
    } catch (_) { /* ignore */ }
  }

  async function markPartialReady(materialId: string, bundleId: string, qtyToMark: number, currentReady: number, totalQty: number) {
    if (processingMaterials.has(materialId) || qtyToMark <= 0 || currentReady >= totalQty) return;
    const capped = Math.min(qtyToMark, totalQty - currentReady);
    setProcessingMaterials(prev => new Set(prev).add(materialId));
    setPartialQtyInput(prev => ({ ...prev, [materialId]: '' }));
    try {
      const { error } = await supabase.rpc('mark_material_partial_ready', {
        p_material_item_id: materialId,
        p_quantity_to_mark: capped,
      });
      if (error) {
        if (/schema cache|could not find the function/i.test(error.message)) {
          const newReady = currentReady + capped;
          const { error: updateErr } = await supabase
            .from('material_items')
            .update({
              quantity_ready_for_job: newReady,
              ...(newReady >= totalQty ? { status: 'ready_for_job' } : {}),
            })
            .eq('id', materialId);
          if (updateErr) {
            if (/quantity_ready_for_job|schema cache|could not find.*column/i.test(updateErr.message)) {
              toast.error(
                'Partial "Mark ready" requires a database update. In Supabase Dashboard → SQL Editor, run the script: supabase/migrations/RUN_THIS_FOR_PARTIAL_READY.sql',
                { duration: 8000 }
              );
              return;
            }
            throw updateErr;
          }
        } else {
          throw error;
        }
      }
      toast.success(`Marked ${capped} as ready for job${capped >= totalQty - currentReady ? ' (all remaining)' : ''}.`);
      await updateBundleStatusIfFirstReady(bundleId);
      loadPackages();
    } catch (e: any) {
      const msg = e?.message || '';
      if (/quantity_ready_for_job|schema cache|could not find the function/i.test(msg)) {
        toast.error(
          'Partial "Mark ready" requires a database update. In Supabase Dashboard → SQL Editor, run: supabase/migrations/RUN_THIS_FOR_PARTIAL_READY.sql',
          { duration: 8000 }
        );
      } else {
        toast.error(msg || 'Failed to mark partial ready');
      }
    } finally {
      setProcessingMaterials(prev => { const n = new Set(prev); n.delete(materialId); return n; });
    }
  }

  function togglePackageExpanded(packageId: string) {
    const newSet = new Set(expandedPackages);
    if (newSet.has(packageId)) {
      newSet.delete(packageId);
    } else {
      newSet.add(packageId);
    }
    setExpandedPackages(newSet);
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'pull_from_shop':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'ready_for_job':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'at_job':
        return 'bg-teal-100 text-teal-800 border-gray-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'pull_from_shop': return 'Pull from Shop';
      case 'ready_for_job': return 'Ready for Job';
      case 'at_job': return 'At Job';
      default: return status;
    }
  }

  const filterOne = (pkg: MaterialBundle) => {
    const matchesSearch = searchTerm === '' ||
      pkg.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pkg.jobs.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pkg.jobs.client_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pkg.bundle_items.some(item =>
        item.material_items.material_name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    const matchesJob = filterJob === 'all' || pkg.job_id === filterJob;
    return matchesSearch && matchesJob;
  };

  const filteredPackages = packages.filter(filterOne);
  const filteredSheetGroups = sheetGroups.filter(filterOne);

  // Count items with status pull_from_shop (used to hide empty sheets)
  const pullFromShopCount = (pkg: MaterialBundle) =>
    pkg.bundle_items.filter((item: any) => item.material_items?.status === 'pull_from_shop').length;

  // Group by job: both packages and sheet groups; exclude any row with 0 to pull (all checked off)
  const packagesByJob = [...filteredPackages, ...filteredSheetGroups].reduce((acc, pkg) => {
    if (pullFromShopCount(pkg) === 0) return acc;
    const jobId = pkg.job_id;
    if (!acc[jobId]) {
      acc[jobId] = {
        jobId,
        jobName: pkg.jobs.name,
        clientName: pkg.jobs.client_name,
        packages: [],
        sheetGroups: [],
      };
    }
    if (pkg.id.startsWith('unbundled-')) {
      acc[jobId].sheetGroups.push(pkg);
    } else {
      acc[jobId].packages.push(pkg);
    }
    return acc;
  }, {} as Record<string, JobGroup>);

  const jobGroups = Object.values(packagesByJob);

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">Loading packages...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Material Packages Grouped by Job */}
      {jobGroups.length > 0 && (
        <div className="space-y-4">
          {jobGroups.map(jobGroup => {
            const isJobExpanded = expandedPackages.has(`job-${jobGroup.jobId}`);
            const countFrom = (list: MaterialBundle[]) => list.reduce(
              (sum, pkg) => sum + pkg.bundle_items.filter(
                item => item.material_items.status === 'pull_from_shop'
              ).length,
              0
            );
            const totalMaterialsInJob = countFrom(jobGroup.packages) + countFrom(jobGroup.sheetGroups);
            
            return (
              <Card key={jobGroup.jobId} className="border-2 border-blue-200">
                <Collapsible 
                  open={isJobExpanded} 
                  onOpenChange={() => togglePackageExpanded(`job-${jobGroup.jobId}`)}
                >
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer bg-gradient-to-r from-blue-50 to-blue-100/50 hover:from-blue-100 hover:to-blue-200/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {isJobExpanded ? (
                            <ChevronDown className="w-6 h-6 text-blue-600" />
                          ) : (
                            <ChevronRight className="w-6 h-6 text-blue-600" />
                          )}
                          <div>
                            <CardTitle className="text-xl flex items-center gap-2">
                              <Building2 className="w-5 h-5 text-blue-600" />
                              {jobGroup.jobName}
                            </CardTitle>
                            <p className="text-sm text-muted-foreground mt-1">
                              Client: {jobGroup.clientName}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="outline" className="font-semibold bg-white">
                            {jobGroup.packages.length + jobGroup.sheetGroups.length} group{jobGroup.packages.length + jobGroup.sheetGroups.length !== 1 ? 's' : ''}
                            {jobGroup.packages.length > 0 && ` (${jobGroup.packages.length} pkg)`}
                            {jobGroup.sheetGroups.length > 0 && ` (${jobGroup.sheetGroups.length} sheet)`}
                          </Badge>
                          <Badge className="bg-purple-100 text-purple-800 border-purple-300">
                            {totalMaterialsInJob} materials to pull
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="p-2 sm:p-4 space-y-3">
                      {jobGroup.packages.map(pkg => {
                        const isPackageExpanded = expandedPackages.has(pkg.id);
                        const pullFromShopItems = pkg.bundle_items.filter(
                          item => item.material_items.status === 'pull_from_shop'
                        );
                        
                        return (
                          <Card key={pkg.id} className="border border-purple-200">
                            <Collapsible open={isPackageExpanded} onOpenChange={() => togglePackageExpanded(pkg.id)}>
                              <CollapsibleTrigger asChild>
                                <CardHeader className="cursor-pointer bg-gradient-to-r from-purple-50 to-purple-100/50 hover:from-purple-100 hover:to-purple-200/50 transition-colors py-3">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      {isPackageExpanded ? (
                                        <ChevronDown className="w-5 h-5 text-purple-600" />
                                      ) : (
                                        <ChevronRight className="w-5 h-5 text-purple-600" />
                                      )}
                                      <div>
                                        <CardTitle className="text-base flex items-center gap-2">
                                          <Package className="w-4 h-4 text-purple-600" />
                                          {pkg.name}
                                        </CardTitle>
                                        {pkg.description && (
                                          <p className="text-xs text-muted-foreground mt-1">
                                            {pkg.description}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                    <Badge variant="outline" className="font-semibold bg-white text-xs">
                                      {pullFromShopItems.length} to pull
                                    </Badge>
                                  </div>
                                </CardHeader>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <CardContent className="p-2 sm:p-3">
                                  <div className="space-y-2">
                                    {pullFromShopItems.map((item) => (
                                      <div 
                                        key={item.id} 
                                        className="bg-white border rounded-lg p-3 hover:bg-muted/30 transition-colors"
                                      >
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                          <div className="flex-1 min-w-0">
                                            <h4 className="font-semibold text-sm leading-tight mb-2">
                                              {item.material_items.material_name}
                                            </h4>
                                            
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                                              <div>
                                                <span className="text-muted-foreground">Qty:</span>
                                                <p className="font-semibold text-base">
                                                  {Math.max(0, item.material_items.quantity - (item.material_items.quantity_ready_for_job ?? 0))} to pull
                                                  {(item.material_items.quantity_ready_for_job ?? 0) > 0 && (
                                                    <span className="text-muted-foreground font-normal"> — {item.material_items.quantity_ready_for_job} ready</span>
                                                  )}
                                                </p>
                                              </div>
                                              
                                              <div>
                                                <span className="text-muted-foreground">Color:</span>
                                                <p className="font-medium">
                                                  {item.material_items.color || '-'}
                                                </p>
                                              </div>
                                              
                                              <div>
                                                <span className="text-muted-foreground">Length:</span>
                                                <p className="font-medium">
                                                  {item.material_items.length || '-'}
                                                </p>
                                              </div>
                                              {item.material_items.trim_saved_configs?.drawing_segments && (
                                                <div>
                                                  <span className="text-muted-foreground">Cut length:</span>
                                                  <p className="font-medium">
                                                    {formatLengthInches(getCutLengthFromTrimConfig(item.material_items.trim_saved_configs))}
                                                    <span className="text-muted-foreground text-xs font-normal block">total lineal in. including hem</span>
                                                  </p>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                          {(() => {
                                            const cutSnippetFromNotes = extractFlatstockCutListSnippet(item.material_items.notes);
                                            const cutSnippet = cutSnippetFromNotes ?? trimCutSnippetByItemId[item.material_items.id];
                                            const isTrimMaterial =
                                              item.material_items.category === 'Trim' ||
                                              !!item.material_items.trim_saved_config_id ||
                                              !!cutSnippet;
                                            return (
                                              <>
                                                {cutSnippet && (
                                                  <div className="mt-2 text-[11px] whitespace-pre-wrap bg-indigo-50 border border-indigo-100 rounded p-2 text-indigo-950/80">
                                                    {cutSnippet}
                                                  </div>
                                                )}
                                                {isTrimMaterial && (
                                                  <div className="mt-2">
                                                    <div className="text-[11px] text-muted-foreground mb-1">Trim cut state</div>
                                                    <Select
                                                      value={
                                                        trimCutStateById[item.material_items.id] ??
                                                        (item.material_items.trim_cut_state as any) ??
                                                        'pending'
                                                      }
                                                      onValueChange={(v) => {
                                                        const desired = v as 'pending' | 'in_progress' | 'cut_complete';
                                                        const deps = trimDepsByItemId[item.material_items.id] ?? [];
                                                        const canMark =
                                                          desired === 'pending' ||
                                                          deps.every((depId) => trimCutStateById[depId] === 'cut_complete');
                                                        if (!canMark) {
                                                          toast.error('Cut wider trims first (dependency not complete).');
                                                          return;
                                                        }
                                                        void updateTrimCutState(item.material_items.id, desired);
                                                      }}
                                                    >
                                                      <SelectTrigger className="h-7 text-[11px] w-[130px]">
                                                        <SelectValue />
                                                      </SelectTrigger>
                                                      <SelectContent>
                                                        <SelectItem value="pending">Pending</SelectItem>
                                                        <SelectItem value="in_progress">In progress</SelectItem>
                                                        <SelectItem value="cut_complete">Cut</SelectItem>
                                                      </SelectContent>
                                                    </Select>
                                                  </div>
                                                )}
                                              </>
                                            );
                                          })()}
                                          
                                          <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto flex-shrink-0 items-stretch sm:items-center">
                                            {(item.material_items.trim_saved_configs?.drawing_segments || item.material_items.trim_saved_config_id || item.material_items.category === 'Trim') && (
                                              item.material_items.trim_saved_configs?.drawing_segments ? (
                                                <button
                                                  type="button"
                                                  onClick={() => setViewingTrimConfig({
                                                    name: item.material_items.trim_saved_configs!.name,
                                                    drawing_segments: item.material_items.trim_saved_configs!.drawing_segments,
                                                  })}
                                                  title="View trim drawing (click to enlarge)"
                                                  className="flex-shrink-0 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 rounded"
                                                >
                                                  <TrimDrawingPreview
                                                    segments={normalizeDrawingSegments(item.material_items.trim_saved_configs.drawing_segments)}
                                                    width={TRIM_PREVIEW_SIZE.width}
                                                    height={TRIM_PREVIEW_SIZE.height}
                                                  />
                                                </button>
                                              ) : item.material_items.trim_saved_config_id ? (
                                                <LazyTrimPreview
                                                  trimConfigId={item.material_items.trim_saved_config_id}
                                                  onOpenFullScreen={setViewingTrimConfig}
                                                />
                                              ) : (
                                                <LazyTrimPreviewByMaterialItemId
                                                  materialItemId={item.material_items.id}
                                                  onOpenFullScreen={setViewingTrimConfig}
                                                />
                                              )
                                            )}
                                            {item.material_items.status === 'pull_from_shop' && (
                                              <>
                                                {item.material_items.quantity > 1 ? (
                                                  <div className="flex items-center gap-1">
                                                    <Input
                                                      type="number"
                                                      min={1}
                                                      max={Math.max(1, item.material_items.quantity - (item.material_items.quantity_ready_for_job ?? 0))}
                                                      className="w-14 h-9 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                      value={partialQtyInput[item.material_items.id] ?? String(Math.max(0, item.material_items.quantity - (item.material_items.quantity_ready_for_job ?? 0)))}
                                                      onChange={(e) => setPartialQtyInput(prev => ({ ...prev, [item.material_items.id]: e.target.value }))}
                                                      onFocus={(e) => e.target.select()}
                                                    />
                                                    <Button
                                                      size="sm"
                                                      disabled={processingMaterials.has(item.material_items.id)}
                                                      onClick={() => {
                                                        const ready = item.material_items.quantity_ready_for_job ?? 0;
                                                        const total = item.material_items.quantity;
                                                        const remaining = total - ready;
                                                        const raw = partialQtyInput[item.material_items.id] ?? String(remaining);
                                                        const v = Math.min(Math.max(parseInt(raw, 10) || 0, 1), remaining);
                                                        if (v > 0 && ready < total) markPartialReady(item.material_items.id, pkg.id, v, ready, total);
                                                      }}
                                                      className="bg-emerald-600 hover:bg-emerald-700 h-9"
                                                      title="Mark this many as ready for job"
                                                    >
                                                      {processingMaterials.has(item.material_items.id) ? (
                                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                      ) : (
                                                        'Mark ready'
                                                      )}
                                                    </Button>
                                                  </div>
                                                ) : (
                                                  <Button
                                                    size="sm"
                                                    disabled={processingMaterials.has(item.material_items.id)}
                                                    className="bg-emerald-600 hover:bg-emerald-700 h-10 w-10 p-0"
                                                    title="Mark as Ready for Job"
                                                    onClick={(e) => {
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      updateMaterialStatus(item.material_items.id, pkg.id, item.material_items.status, 'ready_for_job');
                                                    }}
                                                  >
                                                    {processingMaterials.has(item.material_items.id) ? (
                                                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                    ) : (
                                                      <CheckCircle2 className="w-5 h-5" />
                                                    )}
                                                  </Button>
                                                )}
                                              </>
                                            )}
                                            
                                            {/* Mark as At Job */}
                                            {item.material_items.status === 'ready_for_job' && (
                                              <Button
                                                size="sm"
                                                onClick={(e) => {
                                                  console.log('🖱️ SHOP Ready for Job button clicked for material:', item.material_items.id);
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  updateMaterialStatus(item.material_items.id, pkg.id, item.material_items.status, 'at_job');
                                                }}
                                                disabled={processingMaterials.has(item.material_items.id)}
                                                className="bg-teal-600 hover:bg-teal-700 h-10 w-10 p-0"
                                                title="Mark as At Job"
                                              >
                                                {processingMaterials.has(item.material_items.id) ? (
                                                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                ) : (
                                                  <Truck className="w-5 h-5" />
                                                )}
                                              </Button>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </CardContent>
                              </CollapsibleContent>
                            </Collapsible>
                          </Card>
                        );
                      })}
                      {/* Unbundled materials by sheet — same flow as packages */}
                      {jobGroup.sheetGroups.map(sg => {
                        const isSheetExpanded = expandedPackages.has(sg.id);
                        const pullFromShopItems = sg.bundle_items.filter(
                          item => item.material_items.status === 'pull_from_shop'
                        );
                        return (
                          <Card key={sg.id} className="border border-indigo-200">
                            <Collapsible open={isSheetExpanded} onOpenChange={() => togglePackageExpanded(sg.id)}>
                              <CollapsibleTrigger asChild>
                                <CardHeader className="cursor-pointer bg-gradient-to-r from-indigo-50 to-indigo-100/50 hover:from-indigo-100 hover:to-indigo-200/50 transition-colors py-3">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      {isSheetExpanded ? (
                                        <ChevronDown className="w-5 h-5 text-indigo-600" />
                                      ) : (
                                        <ChevronRight className="w-5 h-5 text-indigo-600" />
                                      )}
                                      <div>
                                        <CardTitle className="text-base flex items-center gap-2">
                                          <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                                          Sheet: {sg.name}
                                        </CardTitle>
                                        <p className="text-xs text-muted-foreground mt-1">
                                          Individual materials (not in a package)
                                        </p>
                                      </div>
                                    </div>
                                    <Badge variant="outline" className="font-semibold bg-white text-xs">
                                      {pullFromShopItems.length} to pull
                                    </Badge>
                                  </div>
                                </CardHeader>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <CardContent className="p-2 sm:p-3">
                                  <div className="space-y-2">
                                    {pullFromShopItems.map((item) => {
                                      const cutSnippetFromNotes = extractFlatstockCutListSnippet(item.material_items.notes);
                                      const cutSnippet = cutSnippetFromNotes ?? trimCutSnippetByItemId[item.material_items.id];
                                      const isTrimMaterial =
                                        item.material_items.category === 'Trim' ||
                                        !!item.material_items.trim_saved_config_id ||
                                        !!cutSnippet;
                                      const currentTrimState =
                                        trimCutStateById[item.material_items.id] ??
                                        (item.material_items.trim_cut_state as any) ??
                                        'pending';
                                      const deps = trimDepsByItemId[item.material_items.id] ?? [];
                                      const canMarkCut = (desired: 'pending' | 'in_progress' | 'cut_complete') => {
                                        if (desired === 'pending') return true;
                                        return deps.every((depId) => trimCutStateById[depId] === 'cut_complete');
                                      };
                                      return (
                                      <div
                                        key={item.id}
                                        className="bg-white border rounded-lg p-3 hover:bg-muted/30 transition-colors"
                                      >
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                          <div className="flex-1 min-w-0">
                                            <h4 className="font-semibold text-sm leading-tight mb-2">
                                              {item.material_items.material_name}
                                            </h4>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                                              <div>
                                                <span className="text-muted-foreground">Qty:</span>
                                                <p className="font-semibold text-base">
                                                  {Math.max(0, item.material_items.quantity - (item.material_items.quantity_ready_for_job ?? 0))} to pull
                                                  {(item.material_items.quantity_ready_for_job ?? 0) > 0 && (
                                                    <span className="text-muted-foreground font-normal"> — {item.material_items.quantity_ready_for_job} ready</span>
                                                  )}
                                                </p>
                                              </div>
                                              <div>
                                                <span className="text-muted-foreground">Color:</span>
                                                <p className="font-medium">{item.material_items.color || '-'}</p>
                                              </div>
                                              <div>
                                                <span className="text-muted-foreground">Length:</span>
                                                <p className="font-medium">{item.material_items.length || '-'}</p>
                                              </div>
                                              {item.material_items.trim_saved_configs?.drawing_segments && (
                                                <div>
                                                  <span className="text-muted-foreground">Cut length:</span>
                                                  <p className="font-medium">
                                                    {formatLengthInches(getCutLengthFromTrimConfig(item.material_items.trim_saved_configs))}
                                                    <span className="text-muted-foreground text-xs font-normal block">total lineal in. including hem</span>
                                                  </p>
                                                </div>
                                              )}
                                          </div>
                                          {cutSnippet && (
                                            <div className="mt-2 text-[11px] whitespace-pre-wrap bg-indigo-50 border border-indigo-100 rounded p-2 text-indigo-950/80">
                                              {cutSnippet}
                                            </div>
                                          )}
                                          {isTrimMaterial && (
                                            <div className="mt-2">
                                              <div className="text-[11px] text-muted-foreground mb-1">
                                                Trim cut state
                                              </div>
                                              <Select
                                                value={currentTrimState}
                                                onValueChange={(v) => {
                                                  const desired = v as 'pending' | 'in_progress' | 'cut_complete';
                                                  if (!canMarkCut(desired)) {
                                                    toast.error('Cut wider trims first (dependency not complete).');
                                                    return;
                                                  }
                                                  void updateTrimCutState(item.material_items.id, desired);
                                                }}
                                              >
                                                <SelectTrigger className="h-7 text-[11px] w-[130px]">
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="pending">Pending</SelectItem>
                                                  <SelectItem value="in_progress">In progress</SelectItem>
                                                  <SelectItem value="cut_complete">Cut</SelectItem>
                                                </SelectContent>
                                              </Select>
                                            </div>
                                          )}
                                          </div>
                                          <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto flex-shrink-0 items-stretch sm:items-center">
                                            {(item.material_items.trim_saved_configs?.drawing_segments || item.material_items.trim_saved_config_id || item.material_items.category === 'Trim') && (
                                              item.material_items.trim_saved_configs?.drawing_segments ? (
                                                <button
                                                  type="button"
                                                  onClick={() => setViewingTrimConfig({
                                                    name: item.material_items.trim_saved_configs!.name,
                                                    drawing_segments: item.material_items.trim_saved_configs!.drawing_segments,
                                                  })}
                                                  title="View trim drawing (click to enlarge)"
                                                  className="flex-shrink-0 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 rounded"
                                                >
                                                  <TrimDrawingPreview
                                                    segments={normalizeDrawingSegments(item.material_items.trim_saved_configs.drawing_segments)}
                                                    width={TRIM_PREVIEW_SIZE.width}
                                                    height={TRIM_PREVIEW_SIZE.height}
                                                  />
                                                </button>
                                              ) : item.material_items.trim_saved_config_id ? (
                                                <LazyTrimPreview
                                                  trimConfigId={item.material_items.trim_saved_config_id}
                                                  onOpenFullScreen={setViewingTrimConfig}
                                                />
                                              ) : (
                                                <LazyTrimPreviewByMaterialItemId
                                                  materialItemId={item.material_items.id}
                                                  onOpenFullScreen={setViewingTrimConfig}
                                                />
                                              )
                                            )}
                                            {item.material_items.status === 'pull_from_shop' && (
                                              <>
                                                {item.material_items.quantity > 1 ? (
                                                  <div className="flex items-center gap-1">
                                                    <Input
                                                      type="number"
                                                      min={1}
                                                      max={Math.max(1, item.material_items.quantity - (item.material_items.quantity_ready_for_job ?? 0))}
                                                      className="w-14 h-9 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                      value={partialQtyInput[item.material_items.id] ?? String(Math.max(0, item.material_items.quantity - (item.material_items.quantity_ready_for_job ?? 0)))}
                                                      onChange={(e) => setPartialQtyInput(prev => ({ ...prev, [item.material_items.id]: e.target.value }))}
                                                      onFocus={(e) => e.target.select()}
                                                    />
                                                    <Button
                                                      size="sm"
                                                      disabled={processingMaterials.has(item.material_items.id)}
                                                      onClick={() => {
                                                        const ready = item.material_items.quantity_ready_for_job ?? 0;
                                                        const total = item.material_items.quantity;
                                                        const remaining = total - ready;
                                                        const raw = partialQtyInput[item.material_items.id] ?? String(remaining);
                                                        const v = Math.min(Math.max(parseInt(raw, 10) || 0, 1), remaining);
                                                        if (v > 0 && ready < total) markPartialReady(item.material_items.id, sg.id, v, ready, total);
                                                      }}
                                                      className="bg-emerald-600 hover:bg-emerald-700 h-9"
                                                      title="Mark this many as ready for job"
                                                    >
                                                      {processingMaterials.has(item.material_items.id) ? (
                                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                      ) : (
                                                        'Mark ready'
                                                      )}
                                                    </Button>
                                                  </div>
                                                ) : (
                                                  <Button
                                                    size="sm"
                                                    disabled={processingMaterials.has(item.material_items.id)}
                                                    className="bg-emerald-600 hover:bg-emerald-700 h-10 w-10 p-0"
                                                    title="Mark as Ready for Job"
                                                    onClick={(e) => {
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      updateMaterialStatus(item.material_items.id, sg.id, item.material_items.status, 'ready_for_job');
                                                    }}
                                                  >
                                                    {processingMaterials.has(item.material_items.id) ? (
                                                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                    ) : (
                                                      <CheckCircle2 className="w-5 h-5" />
                                                    )}
                                                  </Button>
                                                )}
                                              </>
                                            )}
                                            {item.material_items.status === 'ready_for_job' && (
                                              <Button
                                                size="sm"
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  updateMaterialStatus(item.material_items.id, sg.id, item.material_items.status, 'at_job');
                                                }}
                                                disabled={processingMaterials.has(item.material_items.id)}
                                                className="bg-teal-600 hover:bg-teal-700 h-10 w-10 p-0"
                                                title="Mark as At Job"
                                              >
                                                {processingMaterials.has(item.material_items.id) ? (
                                                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                ) : (
                                                  <Truck className="w-5 h-5" />
                                                )}
                                              </Button>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                      );
                                    })}
                                  </div>
                                </CardContent>
                              </CollapsibleContent>
                            </Collapsible>
                          </Card>
                        );
                      })}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {jobGroups.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              {searchTerm || filterJob !== 'all' 
                ? 'No packages found matching your filters' 
                : 'No packages to process'}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Packages with materials that have "Pull from Shop" status will appear here
            </p>
          </CardContent>
        </Card>
      )}

      {/* Trim drawing full-screen view */}
      {viewingTrimConfig && (
        <TrimDrawingFullScreenView
          title={viewingTrimConfig.name}
          segments={normalizeDrawingSegments(viewingTrimConfig.drawing_segments)}
          onClose={() => setViewingTrimConfig(null)}
        />
      )}
    </div>
  );
}
