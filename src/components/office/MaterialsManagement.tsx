import { useState, useEffect, useRef, Fragment, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
  fetchChangeOrderQuoteForJob,
  fetchJobQuotesForJob,
  fetchQuoteContractRowWithId,
} from '@/lib/quotesSchemaFallback';
import { isWorkbookQuoteMismatch } from '@/lib/proposalIsolation';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useMaterialsToolbarSlot } from '@/contexts/JobDetailMaterialsToolbarContext';

// Module-level cache: survives component unmount/remount (e.g. tab switches).
// Key: `${jobId}:${quoteId|null}`, value: { workbook, categories, cachedAt }
interface WorkbookCacheEntry {
  workbook: any;
  categories: string[];
  cachedAt: number;
}
const workbookCache = new Map<string, WorkbookCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** When DB has no `flatstock_width_inches` column, persist 41/42 per workbook in this browser only. */
const FLATSTOCK_WIDTH_LS_PREFIX = 'mb_flatstock_width:';
/** When DB has no `trim_flatstock_plan` column, persist per workbook in this browser only. */
const TRIM_PLAN_LS_PREFIX = 'mb_trim_plan:';
function readFlatstockLocalOverride(workbookId: string): number | null {
  try {
    const v = localStorage.getItem(FLATSTOCK_WIDTH_LS_PREFIX + workbookId);
    if (v === '41') return 41;
    if (v === '42') return 42;
    return null;
  } catch {
    return null;
  }
}
function writeFlatstockLocalOverride(workbookId: string, width: number | null) {
  try {
    const k = FLATSTOCK_WIDTH_LS_PREFIX + workbookId;
    if (width === 41 || width === 42) localStorage.setItem(k, String(width));
    else localStorage.removeItem(k);
  } catch {
    /* ignore quota / private mode */
  }
}
function mergeFlatstockWidthForWorkbook(wb: any): any {
  if (!wb?.id) return wb;
  const dbFlat = wb.flatstock_width_inches;
  if (dbFlat === 41 || dbFlat === 42) return wb;
  const local = readFlatstockLocalOverride(wb.id);
  if (local === 41 || local === 42) return { ...wb, flatstock_width_inches: local };
  return wb;
}
function readTrimPlanLocalOverride(workbookId: string): unknown | null {
  try {
    const raw = localStorage.getItem(TRIM_PLAN_LS_PREFIX + workbookId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function writeTrimPlanLocalOverride(workbookId: string, plan: unknown | null) {
  try {
    const key = TRIM_PLAN_LS_PREFIX + workbookId;
    if (plan == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(plan));
  } catch {
    /* ignore localStorage unavailability */
  }
}
function mergeTrimPlanForWorkbook(wb: any): any {
  if (!wb?.id) return wb;
  if (wb.trim_flatstock_plan != null) return wb;
  const localPlan = readTrimPlanLocalOverride(wb.id);
  if (localPlan == null) return wb;
  return { ...wb, trim_flatstock_plan: localPlan };
}
function mergeWorkbookLocalOverrides(wb: any): any {
  return mergeTrimPlanForWorkbook(mergeFlatstockWidthForWorkbook(wb));
}
function isFlatstockColumnMissingError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('flatstock_width_inches') &&
    (m.includes('schema cache') || m.includes('could not find'))
  );
}

async function fetchJobQuotesForMaterials(jobId: string) {
  return fetchJobQuotesForJob(supabase, jobId);
}
/** Long “add DB column” warning only once per tab session so switching 41″/42″ isn’t noisy. */
const FLATSTOCK_SCHEMA_WARN_SESSION_KEY = 'mb_flatstock_schema_warn_shown_v1';
function hasShownFlatstockSchemaWarningThisSession(): boolean {
  try {
    return sessionStorage.getItem(FLATSTOCK_SCHEMA_WARN_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}
function markFlatstockSchemaWarningShownThisSession() {
  try {
    sessionStorage.setItem(FLATSTOCK_SCHEMA_WARN_SESSION_KEY, '1');
  } catch {
    /* ignore */
  }
}
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  parseTrimDrawingSegmentsFromStored,
  downloadTrimWorkbookPdf,
  sanitizeTrimPdfFilenameBase,
  type TrimPdfPageInput,
} from '@/lib/trimDrawingPdfExport';
import { formatQuoteScopeLabel } from '@/lib/quoteDisplay';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  Edit,
  Trash2,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Upload,
  FileSpreadsheet,
  MoveHorizontal,
  Percent,
  Image as ImageIcon,
  Package,
  CheckSquare,
  Square,
  CheckCircle,
  ShoppingCart,
  FileText,
  RefreshCw,
  AlertCircle,
  MoreVertical,
  Download,
  ArrowUp,
  ArrowDown,
  ListOrdered,
  GripVertical,
  Pencil,
  Ruler,
  Lock,
  LockOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Job } from '@/types';
import { ExtrasManagement } from './ExtrasManagement';
import { OfficeCrewOrders } from './OfficeCrewOrders';
import { MaterialWorkbookManager } from './MaterialWorkbookManager';
import { MaterialItemPhotos } from './MaterialItemPhotos';
import { PhotoRecoveryTool } from './PhotoRecoveryTool';
import { MaterialPackages } from './MaterialPackages';
import { ZohoOrderConfirmationDialog } from './ZohoOrderConfirmationDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FloatingDocumentViewer } from './FloatingDocumentViewer';
import {
  getTotalInchesFromTrimConfig,
  getCutLengthFromTrimConfig,
  computeFlatstockSticksNeeded,
  FLATSTOCK_STICK_LENGTH_INCHES,
} from './TrimDrawingPreview';
import {
  buildTrimSlittingPlan,
  isTrimSlittingPlanV1,
  type TrimSlittingPlanV1,
} from '@/lib/trimFlatstockOptimize';
import {
  FLATSTOCK_CUT_LIST_DELIM_END,
  FLATSTOCK_CUT_LIST_DELIM_START,
  extractFlatstockCutListSnippet,
  upsertFlatstockCutListNotes,
} from '@/lib/flatstockCutListNotes';
import { cn } from '@/lib/utils';
import {
  isQuoteContractFrozen,
  isProposalPanelReadOnly,
  quoteHasActiveContract,
  sortQuotesLikeJobFinancials,
} from '@/lib/quoteProposalLock';

type ContractQuoteFields = Pick<JobQuote, 'sent_at' | 'locked_for_editing' | 'signed_version' | 'customer_signed_at'>;

/** Merge list row with authoritatively fetched contract fields (avoids stale jobQuotes vs JobFinancials). */
function buildQuoteForContract(
  jobQuotes: JobQuote[],
  effectiveQuoteId: string | null | undefined,
  fields: ContractQuoteFields | null,
): JobQuote | undefined {
  if (!effectiveQuoteId) return undefined;
  const base = jobQuotes.find((q) => q.id === effectiveQuoteId);
  if (fields && base) return { ...base, ...fields };
  if (fields && !base) {
    return {
      id: effectiveQuoteId,
      proposal_number: null,
      quote_number: null,
      created_at: '',
      is_change_order_proposal: false,
      ...fields,
    } as JobQuote;
  }
  return base;
}

interface MaterialItem {
  id: string;
  sheet_id: string;
  category: string;
  usage: string | null;
  sku: string | null;
  material_name: string;
  quantity: number;
  length: string | null;
  color: string | null;
  cost_per_unit: number | null;
  markup_percent: number | null;
  price_per_unit: number | null;
  extended_cost: number | null;
  extended_price: number | null;
  taxable: boolean;
  trim_saved_config_id?: string | null;
  trim_cut_state?: 'pending' | 'in_progress' | 'cut_complete' | null;
  notes: string | null;
  order_index: number;
  status: string;
  created_at: string;
  updated_at: string;
  sheets: {
    sheet_name: string;
  };
}

interface MaterialSheet {
  id: string;
  workbook_id: string;
  sheet_name: string;
  order_index: number;
  sheet_type?: 'proposal' | 'change_order';
  category_order: string[] | null;
  items: MaterialItem[];
  created_at: string;
}

interface MaterialWorkbook {
  id: string;
  job_id: string;
  quote_id?: string | null;
  version_number: number;
  status: 'working' | 'locked';
  sheets: MaterialSheet[];
  flatstock_width_inches?: number | null;
  /** Width-only slitting plan JSON (v1); see trimFlatstockOptimize */
  trim_flatstock_plan?: unknown;
}

interface JobQuote {
  id: string;
  proposal_number: string | null;
  quote_number: string | null;
  estimate_number?: string | null;
  is_customer_estimate?: boolean;
  created_at: string;
  sent_at: string | null;
  locked_for_editing: boolean | null;
  is_change_order_proposal?: boolean;
  signed_version?: number | null;
  customer_signed_at?: string | null;
}

export interface BreakdownSheetPrice {
  sheetId: string;
  sheetName: string;
  /** Per-category totals = sum of getDisplayExtended(item).price — same green "Price" as Breakdown by Category cards */
  categories: Record<string, number>;
}

interface MaterialsManagementProps {
  job: Job;
  userId: string;
  proposalNumber?: string | null;
  /** When provided, proposal selection is controlled by parent (e.g. combined Proposal+Materials view) */
  controlledQuoteId?: string | null;
  /** Called when user selects a different proposal in the dropdown */
  onQuoteChange?: (quoteId: string | null) => void;
  /** Optional sheet sync from split-view proposal panel */
  externalActiveSheetId?: string | null;
  /** Sync breakdown prices to parent for proposal-side source-of-truth display. */
  onBreakdownPriceSync?: (prices: BreakdownSheetPrice[]) => void;
  /** Sync which workbook (working vs locked) the materials panel is currently viewing. */
  onWorkbookViewSync?: (view: { workbookId: string | null; status: 'working' | 'locked' | null }) => void;
  /** Fired when the outermost loadWorkbook finishes (success or failure) for the active quote. */
  onWorkbookLoadSettled?: () => void;
  /** Signed contract: extended sell total of the job workbook (`working` row) for display separate from proposal materials. */
  onJobWorkbookMaterialsTotalSync?: (total: number | null) => void;
  /** Session unlock from split-view parent — matches JobFinancials read-only so the proposal workbook locks with the left panel. */
  historicalUnlockedQuoteId?: string | null;
  /** Split view: show job-workbook materials total on the same top row as legacy proposal-workbook controls. */
  jobWorkbookMaterialsTotalForStrip?: number;
}

interface CategoryGroup {
  category: string;
  items: MaterialItem[];
}

function isTrimMaterialCategory(category: string) {
  return category.trim().toLowerCase() === 'trim';
}

export function MaterialsManagement({
  job,
  userId,
  proposalNumber,
  controlledQuoteId,
  onQuoteChange,
  externalActiveSheetId,
  onBreakdownPriceSync,
  onWorkbookViewSync,
  onWorkbookLoadSettled,
  onJobWorkbookMaterialsTotalSync,
  historicalUnlockedQuoteId = null,
  jobWorkbookMaterialsTotalForStrip,
}: MaterialsManagementProps) {
  const normalizeSyncKeyPart = (value: unknown) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  const [jobQuotes, setJobQuotes] = useState<JobQuote[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const isControlled = controlledQuoteId !== undefined;
  const effectiveQuoteId = isControlled ? controlledQuoteId : selectedQuoteId;
  const [workbook, setWorkbook] = useState<MaterialWorkbook | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'manage' | 'breakdown' | 'packages' | 'crew-orders' | 'trim-flatstock' | 'upload'>('manage');
  const [pendingCrewCount, setPendingCrewCount] = useState(0);
  const [activeSheetId, setActiveSheetId] = useState<string>('');
  /** Step 2 of sheet delete: which sheet id is showing Cancel / Delete (only for active tab). */
  const [sheetDeleteConfirmId, setSheetDeleteConfirmId] = useState<string | null>(null);
  const activeSheetIdRef = useRef<string>('');
  const lastAppliedExternalSheetIdRef = useRef<string | null>(null);
  /** Nested loadWorkbook calls (e.g. repair → createWorking → loadWorkbook) — only outermost runs empty-working repair */
  const workbookLoadDepthRef = useRef(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [movingItem, setMovingItem] = useState<MaterialItem | null>(null);
  const [openPhotosForItem, setOpenPhotosForItem] = useState<{ id: string; materialName: string } | null>(null);
  const [moveToSheetId, setMoveToSheetId] = useState<string>('');
  const [moveToCategory, setMoveToCategory] = useState<string>('');
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [editingCell, setEditingCell] = useState<{ itemId: string; field: string } | null>(null);
  const [cellValue, setCellValue] = useState('');
  const [categoryFootPriceEdit, setCategoryFootPriceEdit] = useState<{ category: string; costPerFoot: string; pricePerFoot: string } | null>(null);
  const [categoryNameEdit, setCategoryNameEdit] = useState<{
    sheetId: string;
    oldName: string;
    value: string;
  } | null>(null);
  const [savingCategoryRename, setSavingCategoryRename] = useState(false);
  const categoryNameEditRef = useRef(categoryNameEdit);
  categoryNameEditRef.current = categoryNameEdit;
  const skipCategoryRenameBlurRef = useRef(false);
  const categoryRenameInFlightRef = useRef(false);
  const [sheetNameEdit, setSheetNameEdit] = useState<{
    sheetId: string;
    oldName: string;
    value: string;
  } | null>(null);
  const [savingSheetRename, setSavingSheetRename] = useState(false);
  const sheetNameEditRef = useRef(sheetNameEdit);
  sheetNameEditRef.current = sheetNameEdit;
  const skipSheetRenameBlurRef = useRef(false);
  const sheetRenameInFlightRef = useRef(false);
  const [metalCatalogBySku, setMetalCatalogBySku] = useState<Record<string, { purchase_cost: number; unit_price: number }>>({});
  const scrollPositionRef = useRef<number>(0);

  // Keep ref in sync so loadWorkbook (called from realtime/subscription) always sees latest selection
  useEffect(() => {
    activeSheetIdRef.current = activeSheetId;
  }, [activeSheetId]);

  useEffect(() => {
    setSheetDeleteConfirmId(null);
  }, [activeSheetId]);

  useEffect(() => {
    setCategoryNameEdit(null);
    setSheetNameEdit(null);
  }, [activeSheetId]);

  // Split view sync: when left panel selects a sheet, mirror it in Materials tabs/selectors.
  useEffect(() => {
    if (!externalActiveSheetId || !workbook?.sheets?.length) return;
    const exists = workbook.sheets.some((s) => s.id === externalActiveSheetId);
    if (!exists) return;
    // Only apply when the external sheet selection actually changes.
    // This prevents clobbering manual sheet changes in the right-panel dropdown.
    if (lastAppliedExternalSheetIdRef.current === externalActiveSheetId) return;
    lastAppliedExternalSheetIdRef.current = externalActiveSheetId;
    if (activeSheetId !== externalActiveSheetId) setActiveSheetId(externalActiveSheetId);
  }, [externalActiveSheetId, workbook, activeSheetId]);
  
  // Sheet type filter
  const [sheetTypeFilter, setSheetTypeFilter] = useState<'all' | 'proposal' | 'change_order'>('proposal');

  // Add material dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addToCategory, setAddToCategory] = useState<string>('');
  const [newMaterialName, setNewMaterialName] = useState('');
  const [newUsage, setNewUsage] = useState('');
  const [newSku, setNewSku] = useState('');
  const [newQuantity, setNewQuantity] = useState('1');
  const [newLength, setNewLength] = useState('');
  const [newColor, setNewColor] = useState('');
  const [newCostPerUnit, setNewCostPerUnit] = useState('');
  const [newPricePerUnit, setNewPricePerUnit] = useState(''); // Price from Zoho Books
  const [newMarkup, setNewMarkup] = useState(''); // Display only - calculated from Zoho prices
  const [newNotes, setNewNotes] = useState('');
  const [saving, setSaving] = useState(false);
  
  // Database search state for add dialog
  const [showDatabaseSearch, setShowDatabaseSearch] = useState(false);
  const [addMaterialDialogMode, setAddMaterialDialogMode] = useState<'search' | 'custom'>('search');
  const [catalogMaterials, setCatalogMaterials] = useState<any[]>([]);
  const [catalogSearchQuery, setCatalogSearchQuery] = useState('');
  const [catalogSearchCategory, setCatalogSearchCategory] = useState<string>('all');
  const [catalogSearchPage, setCatalogSearchPage] = useState(0);
  const [catalogCategories, setCatalogCategories] = useState<string[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [selectedCatalogMaterials, setSelectedCatalogMaterials] = useState<any[]>([]);
  const [addingCatalogBatch, setAddingCatalogBatch] = useState(false);
  const [catalogAddQuantity, setCatalogAddQuantity] = useState('1');
  const [catalogAddColor, setCatalogAddColor] = useState('');
  
  // Package state
  const [packages, setPackages] = useState<any[]>([]);
  
  // Package selection mode in workbook
  const [packageSelectionMode, setPackageSelectionMode] = useState(false);
  const [selectedMaterialsForPackageAdd, setSelectedMaterialsForPackageAdd] = useState<Set<string>>(new Set());
  const [showAddToPackageDialog, setShowAddToPackageDialog] = useState(false);
  const [targetPackageId, setTargetPackageId] = useState('');
  const [addingMaterialsToPackage, setAddingMaterialsToPackage] = useState(false);

  // Bulk move mode in workbook
  const [bulkMoveMode, setBulkMoveMode] = useState(false);
  const [selectedMaterialsForMove, setSelectedMaterialsForMove] = useState<Set<string>>(new Set());
  const [showBulkMoveDialog, setShowBulkMoveDialog] = useState(false);
  const [bulkMoveTargetSheetId, setBulkMoveTargetSheetId] = useState('');
  const [bulkMoveTargetCategory, setBulkMoveTargetCategory] = useState('');
  const [movingBulkMaterials, setMovingBulkMaterials] = useState(false);

  // Zoho order state
  const [showZohoOrderDialog, setShowZohoOrderDialog] = useState(false);
  const [selectedMaterialsForOrder, setSelectedMaterialsForOrder] = useState<MaterialItem[]>([]);

  // Document viewer state
  const [showDocumentViewer, setShowDocumentViewer] = useState(false);

  // Link trim drawing to material item
  const [openLinkTrimForItem, setOpenLinkTrimForItem] = useState<{ id: string; materialName: string; currentTrimConfigId?: string | null } | null>(null);
  const [savedTrimConfigs, setSavedTrimConfigs] = useState<{ id: string; name: string; drawing_segments?: unknown }[]>([]);
  const [loadingTrimConfigs, setLoadingTrimConfigs] = useState(false);
  const [linkingTrimConfigId, setLinkingTrimConfigId] = useState<string | null>(null);
  const [trimConfigSearchQuery, setTrimConfigSearchQuery] = useState('');
  const [trimFlatstockConfigMap, setTrimFlatstockConfigMap] = useState<
    Record<
      string,
      { name: string; totalInches: number; stretchOutInches: number; drawing_segments?: unknown }
    >
  >({});
  const [loadingTrimFlatstock, setLoadingTrimFlatstock] = useState(false);
  const [showTrimPdfExportDialog, setShowTrimPdfExportDialog] = useState(false);
  const [trimPdfExportSelectedIds, setTrimPdfExportSelectedIds] = useState<Set<string>>(() => new Set());
  const [trimPdfExporting, setTrimPdfExporting] = useState(false);
  const [savingFlatstockWidth, setSavingFlatstockWidth] = useState(false);
  const [savingTrimSlittingPlan, setSavingTrimSlittingPlan] = useState(false);
  const [savingTrimCutListToNotes, setSavingTrimCutListToNotes] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!openLinkTrimForItem) return;
    setTrimConfigSearchQuery('');
    setLoadingTrimConfigs(true);
    supabase
      .from('trim_saved_configs')
      .select('id, name, drawing_segments')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          toast.error('Failed to load trim configs');
          setSavedTrimConfigs([]);
        } else {
          setSavedTrimConfigs(data || []);
        }
        setLoadingTrimConfigs(false);
      });
  }, [openLinkTrimForItem]);

  // Load materials_catalog for Metal category SKUs (e.g. OMNI) so lineal ft price shows from material database
  useEffect(() => {
    if (!workbook?.sheets?.length) {
      setMetalCatalogBySku({});
      return;
    }
    const metalItems = workbook.sheets.flatMap((s: MaterialSheet) => (s.items || []).filter((i: MaterialItem) => i.category === 'Metal' && i.sku));
    const skus = [...new Set(metalItems.map((i: MaterialItem) => i.sku!))];
    if (skus.length === 0) {
      setMetalCatalogBySku({});
      return;
    }
    supabase
      .from('materials_catalog')
      .select('sku, purchase_cost, unit_price')
      .in('sku', skus)
      .then(({ data, error }) => {
        if (error || !data?.length) {
          setMetalCatalogBySku({});
          return;
        }
        const map: Record<string, { purchase_cost: number; unit_price: number }> = {};
        data.forEach((r: { sku: string; purchase_cost: number | null; unit_price: number | null }) => {
          map[r.sku] = {
            purchase_cost: Number(r.purchase_cost) || 0,
            unit_price: Number(r.unit_price) || 0,
          };
        });
        setMetalCatalogBySku(map);
      });
  }, [workbook]);

  // Fill Metal rows that have no workbook $/ft yet from materials_catalog (import). Never overwrite custom/workbook pricing.
  useEffect(() => {
    if (!workbook?.sheets?.length || Object.keys(metalCatalogBySku).length === 0) return;
    const metalItems: MaterialItem[] = [];
    workbook.sheets.forEach((s: MaterialSheet) => {
      s.items.forEach((i: MaterialItem) => {
        if (i.category === 'Metal' && i.sku && metalCatalogBySku[i.sku]) metalItems.push(i);
      });
    });
    if (metalItems.length === 0) return;
    let synced = 0;
    const run = async () => {
      for (const item of metalItems) {
        const cat = metalCatalogBySku[item.sku!];
        const catalogCost = cat.purchase_cost;
        const catalogPrice = cat.unit_price;
        const noWorkbookPlf = item.cost_per_unit == null && item.price_per_unit == null;
        if (!noWorkbookPlf) continue;
        const lengthFeet = parseLengthToFeet(item.length) ?? 0;
        const qty = Number(item.quantity) || 1;
        const mult = lengthFeet > 0 ? lengthFeet * qty : qty;
        const extended_cost = catalogCost > 0 ? Math.round(catalogCost * mult * 10000) / 10000 : null;
        const extended_price = catalogPrice > 0 ? Math.round(catalogPrice * mult * 10000) / 10000 : null;
        const safeMarkup = catalogCost > 0 && catalogPrice > 0
          ? Math.round(((catalogPrice - catalogCost) / catalogCost) * 100 * 10000) / 10000
          : null;
        const { error } = await supabase
          .from('material_items')
          .update({
            cost_per_unit: catalogCost,
            price_per_unit: catalogPrice,
            markup_percent: safeMarkup,
            extended_cost,
            extended_price,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        if (!error) synced++;
      }
      if (synced > 0) {
        workbookCache.delete(`${job.id}:${effectiveQuoteId ?? null}`);
        loadWorkbook(true);
        window.dispatchEvent(new CustomEvent('materials-workbook-updated', { detail: { quoteId: effectiveQuoteId ?? null, jobId: job.id } }));
      }
    };
    run();
  }, [workbook, metalCatalogBySku, job.id, effectiveQuoteId]);

  // Load trim configs whenever the workbook references saved trim (workbook + PDF export + flatstock tab)
  useEffect(() => {
    if (!workbook?.sheets) {
      setTrimFlatstockConfigMap({});
      return;
    }
    const configIds = new Set<string>();
    workbook.sheets.forEach((s: MaterialSheet) => {
      s.items.forEach((i: MaterialItem) => {
        if (i.trim_saved_config_id) configIds.add(i.trim_saved_config_id);
      });
    });
    if (configIds.size === 0) {
      setTrimFlatstockConfigMap({});
      return;
    }
    setLoadingTrimFlatstock(true);
    supabase
      .from('trim_saved_configs')
      .select('id, name, inches, drawing_segments')
      .in('id', Array.from(configIds))
      .then(({ data, error }) => {
        if (error) {
          setTrimFlatstockConfigMap({});
        } else {
          const map: Record<
            string,
            { name: string; totalInches: number; stretchOutInches: number; drawing_segments?: unknown }
          > = {};
          (data || []).forEach((row: any) => {
            const totalInches = getTotalInchesFromTrimConfig(row);
            const stretchOutInches =
              getCutLengthFromTrimConfig(row) || totalInches || 0;
            map[row.id] = {
              name: row.name ?? 'Trim',
              totalInches,
              stretchOutInches,
              drawing_segments: row.drawing_segments,
            };
          });
          setTrimFlatstockConfigMap(map);
        }
        setLoadingTrimFlatstock(false);
      });
  }, [workbook?.sheets]);

  function openTrimPdfExportDialog() {
    if (!workbook?.sheets) return;
    const ids = new Set<string>();
    workbook.sheets.forEach((s) => {
      s.items.forEach((i) => {
        if (isTrimMaterialCategory(i.category)) ids.add(i.id);
      });
    });
    setTrimPdfExportSelectedIds(ids);
    setShowTrimPdfExportDialog(true);
  }

  function toggleTrimPdfExportItem(id: string) {
    setTrimPdfExportSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAllTrimPdfExportSelected(select: boolean) {
    if (!workbook?.sheets) return;
    if (!select) {
      setTrimPdfExportSelectedIds(new Set());
      return;
    }
    const ids = new Set<string>();
    workbook.sheets.forEach((s) => {
      s.items.forEach((i) => {
        if (isTrimMaterialCategory(i.category)) ids.add(i.id);
      });
    });
    setTrimPdfExportSelectedIds(ids);
  }

  function formatTrimLineLengthDisplay(item: MaterialItem): string {
    const raw = item.length != null && item.length !== '' ? String(item.length).trim() : '';
    const unitLike = /^(pcs|pc|bag|bags|lf|ft|piece|pieces|ea|each|units?|linear\s*ft)$/i;
    const isLength = raw && !unitLike.test(raw);
    return isLength ? raw : '—';
  }

  async function handleDownloadTrimWorkbookPdf() {
    if (!workbook?.sheets) return;
    if (trimPdfExportSelectedIds.size === 0) {
      toast.error('Select at least one trim line.');
      return;
    }
    const pages: TrimPdfPageInput[] = [];
    for (const sheet of workbook.sheets) {
      for (const item of sheet.items) {
        if (!trimPdfExportSelectedIds.has(item.id) || !isTrimMaterialCategory(item.category)) continue;
        const config = item.trim_saved_config_id
          ? trimFlatstockConfigMap[item.trim_saved_config_id]
          : undefined;
        const segments =
          config?.drawing_segments != null
            ? parseTrimDrawingSegmentsFromStored(config.drawing_segments)
            : [];
        const cutW =
          config && Number.isFinite(config.stretchOutInches)
            ? `${config.stretchOutInches.toFixed(2)}"`
            : '—';
        const trimTitle =
          config?.name && config.name.trim()
            ? `${item.material_name} (${config.name})`
            : item.material_name;
        pages.push({
          title: trimTitle,
          sheetLabel: `Sheet: ${sheet.sheet_name}`,
          qtyDisplay: String(item.quantity ?? ''),
          lengthDisplay: formatTrimLineLengthDisplay(item),
          colorDisplay: item.color?.trim() ? item.color : '—',
          cutWidthDisplay: cutW,
          segments,
        });
      }
    }
    if (pages.length === 0) {
      toast.error('No trim lines match your selection.');
      return;
    }
    setTrimPdfExporting(true);
    try {
      const base = sanitizeTrimPdfFilenameBase(`${job.name || 'Job'}-Trim-Pack`);
      await downloadTrimWorkbookPdf(`${base}.pdf`, pages, { reportTitle: job.name ?? undefined });
      toast.success('Trim pack PDF downloaded.');
      setShowTrimPdfExportDialog(false);
    } catch (e) {
      console.error(e);
      toast.error('Failed to build trim PDF.');
    } finally {
      setTrimPdfExporting(false);
    }
  }

  const workbookTrimLinesForPdfExport = useMemo(() => {
    if (!workbook?.sheets) return [];
    const rows: { item: MaterialItem; sheetName: string }[] = [];
    for (const sheet of workbook.sheets) {
      for (const item of sheet.items) {
        if (isTrimMaterialCategory(item.category)) {
          rows.push({ item, sheetName: sheet.sheet_name });
        }
      }
    }
    return rows;
  }, [workbook?.sheets]);

  async function setFlatstockWidthInches(width: number | null) {
    if (!workbook?.id) return;
    if (isWorkbookReadOnlyRef.current) {
      toast.error('Cannot change flatstock while the proposal is locked (read-only).');
      return;
    }
    const next =
      width === null || Number.isNaN(Number(width))
        ? null
        : Number(width);
    if (next != null && next !== 41 && next !== 42) {
      toast.error('Choose 41" or 42" flatstock width.');
      return;
    }
    const previous = workbook.flatstock_width_inches ?? null;
    setWorkbook((prev) => (prev ? { ...prev, flatstock_width_inches: next } : null));
    setSavingFlatstockWidth(true);
    try {
      const { error } = await supabase
        .from('material_workbooks')
        .update({ flatstock_width_inches: next })
        .eq('id', workbook.id);
      if (error) {
        const rawMsg = error.message || '';
        if (isFlatstockColumnMissingError(rawMsg)) {
          writeFlatstockLocalOverride(workbook.id, next);
          for (const key of workbookCache.keys()) {
            if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
          }
          if (!hasShownFlatstockSchemaWarningThisSession()) {
            markFlatstockSchemaWarningShownThisSession();
            toast.warning(
              'Flatstock width is saved on this browser only. Add column material_workbooks.flatstock_width_inches to your database (SQL in supabase/migrations/20250344000000_ensure_material_workbooks_flatstock_width.sql or run supabase db push) so the team shares one setting.',
              { duration: 12000 }
            );
          } else {
            toast.info(`Flatstock width set to ${next}" (this browser only until the database column exists).`);
          }
          return;
        }
        setWorkbook((prev) =>
          prev ? { ...prev, flatstock_width_inches: previous } : null
        );
        toast.error(rawMsg || 'Failed to save flatstock width');
        return;
      }
      writeFlatstockLocalOverride(workbook.id, null);
      for (const key of workbookCache.keys()) {
        if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
      }
      toast.success('Flatstock width saved');
    } finally {
      setSavingFlatstockWidth(false);
    }
  }

  async function saveTrimSlittingPlanFromDemands(
    demands: { materialItemId: string; materialName: string; sku: string | null; stretchOutInches: number; pieceLengthInches: number; qty: number }[],
    flatstockW: number
  ) {
    if (!workbook?.id) return;
    if (!canUseShopTrimAndZohoOnThisWorkbook) {
      toast.error('Slitting plan can only be saved on the job workbook or the proposal workbook.');
      return;
    }
    const plan = buildTrimSlittingPlan(demands, flatstockW, FLATSTOCK_STICK_LENGTH_INCHES);
    setSavingTrimSlittingPlan(true);
    try {
      const { error } = await supabase
        .from('material_workbooks')
        .update({ trim_flatstock_plan: plan as unknown as Record<string, unknown> })
        .eq('id', workbook.id);
      if (error) {
        const m = (error.message || '').toLowerCase();
        if (m.includes('trim_flatstock_plan') && (m.includes('schema cache') || m.includes('could not find'))) {
          writeTrimPlanLocalOverride(workbook.id, plan);
          setWorkbook((prev) => (prev ? { ...prev, trim_flatstock_plan: plan } : null));
          for (const key of workbookCache.keys()) {
            if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
          }
          toast.warning(
            'Database missing material_workbooks.trim_flatstock_plan. Plan saved in this browser only. Run migration 20250345000000_add_trim_flatstock_plan_and_cut_state.sql (or supabase db push) for shared persistence.',
            { duration: 12000 }
          );
        } else {
          toast.error(error.message || 'Failed to save slitting plan');
        }
        return;
      }
      writeTrimPlanLocalOverride(workbook.id, null);
      setWorkbook((prev) => (prev ? { ...prev, trim_flatstock_plan: plan } : null));
      for (const key of workbookCache.keys()) {
        if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
      }
      toast.success(`Slitting plan saved (${plan.totalSheets} sheet${plan.totalSheets === 1 ? '' : 's'})`);
    } finally {
      setSavingTrimSlittingPlan(false);
    }
  }

  async function applyTrimSlittingPlanToNotes(
    plan: TrimSlittingPlanV1,
    itemsWithTrim: { item: MaterialItem; stretchOutInches: number }[]
  ) {
    if (!workbook?.id) return;
    if (!canUseShopTrimAndZohoOnThisWorkbook) {
      toast.error('Trim cut list can only be applied on the job workbook or the proposal workbook.');
      return;
    }

    setSavingTrimCutListToNotes(true);
    try {
      const W = plan.flatstockWidthInches;
      const stripByInstanceId = new Map<string, (typeof plan.sheets)[number]['strips'][number]>();
      for (const sh of plan.sheets) {
        for (const st of sh.strips) {
          if (st.stripInstanceId) stripByInstanceId.set(st.stripInstanceId, st);
        }
      }

      const statsByItemId = new Map<
        string,
        {
          stripsPlanned: number;
          fullWidthCuts: number;
          fromOtherTrimCutoffs: number;
          fromOtherBySource: Map<string, number>;
        }
      >();
      for (const sh of plan.sheets) {
        for (const st of sh.strips) {
          const current = statsByItemId.get(st.materialItemId) ?? {
            stripsPlanned: 0,
            fullWidthCuts: 0,
            fromOtherTrimCutoffs: 0,
            fromOtherBySource: new Map<string, number>(),
          };
          current.stripsPlanned += 1;
          const isFromCutoff = !!st.usesCutoffFromStripInstanceId || st.role === 'from_cutoff';
          if (!isFromCutoff) {
            current.fullWidthCuts += 1;
          } else {
            const src = st.usesCutoffFromStripInstanceId
              ? stripByInstanceId.get(st.usesCutoffFromStripInstanceId)
              : null;
            if (src && src.materialItemId !== st.materialItemId) {
              current.fromOtherTrimCutoffs += 1;
              const srcName = src.materialName || 'Unknown trim';
              current.fromOtherBySource.set(srcName, (current.fromOtherBySource.get(srcName) ?? 0) + 1);
            }
          }
          statsByItemId.set(st.materialItemId, current);
        }
      }

      for (const row of itemsWithTrim) {
        const item = row.item;
        const stats = statsByItemId.get(item.id) ?? {
          stripsPlanned: 0,
          fullWidthCuts: 0,
          fromOtherTrimCutoffs: 0,
          fromOtherBySource: new Map<string, number>(),
        };
        const skuPart = item.sku ? ` (${item.sku})` : '';
        const materialPart = `${item.material_name}${skuPart}`;
        const sourceBreakdown = Array.from(stats.fromOtherBySource.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([name, count]) => `${name} (${count})`)
          .join(', ');

        const blockLines = [
          FLATSTOCK_CUT_LIST_DELIM_START,
          `Coil width: ${W}" (${plan.stickLengthInches / 12}' slitting strips)`,
          `Material: ${materialPart}`,
          `Full-width cuts for this trim: ${stats.fullWidthCuts}`,
          `From other trim cutoffs: ${stats.fromOtherTrimCutoffs}`,
          `Cutoff sources: ${sourceBreakdown || 'None'}`,
          FLATSTOCK_CUT_LIST_DELIM_END,
        ];
        const newBlock = blockLines.join('\n');
        const newNotes = upsertFlatstockCutListNotes(item.notes ?? null, newBlock);

        const { error } = await supabase.from('material_items').update({ notes: newNotes }).eq('id', item.id);
        if (error) {
          toast.error(error.message || 'Failed to apply cut list to notes');
          return;
        }
      }

      // Update local workbook state so the user immediately sees the updated notes.
      setWorkbook((prev) => {
        if (!prev?.sheets) return prev;
        const itemsById = new Map(itemsWithTrim.map((r) => [r.item.id, r.item]));
        return {
          ...prev,
          sheets: prev.sheets.map((sh) => ({
            ...sh,
            items: sh.items.map((i) => {
              if (!itemsById.has(i.id)) return i;
              const stats = statsByItemId.get(i.id) ?? {
                stripsPlanned: 0,
                fullWidthCuts: 0,
                fromOtherTrimCutoffs: 0,
                fromOtherBySource: new Map<string, number>(),
              };
              const skuPart = i.sku ? ` (${i.sku})` : '';
              const materialPart = `${i.material_name}${skuPart}`;
              const sourceBreakdown = Array.from(stats.fromOtherBySource.entries())
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([name, count]) => `${name} (${count})`)
                .join(', ');
              const blockLines = [
                FLATSTOCK_CUT_LIST_DELIM_START,
                `Coil width: ${W}" (${plan.stickLengthInches / 12}' slitting strips)`,
                `Material: ${materialPart}`,
                `Full-width cuts for this trim: ${stats.fullWidthCuts}`,
                `From other trim cutoffs: ${stats.fromOtherTrimCutoffs}`,
                `Cutoff sources: ${sourceBreakdown || 'None'}`,
                FLATSTOCK_CUT_LIST_DELIM_END,
              ];
              const newBlock = blockLines.join('\n');
              const newNotes = upsertFlatstockCutListNotes(i.notes ?? null, newBlock);
              return { ...i, notes: newNotes };
            }),
          })),
        };
      });

      toast.success('Cut list applied to trim line notes');
    } finally {
      setSavingTrimCutListToNotes(false);
    }
  }

  async function updateMaterialItemTrimCutState(
    itemId: string,
    state: 'pending' | 'in_progress' | 'cut_complete'
  ) {
    if (!workbook?.id) return;
    if (!canUseShopTrimAndZohoOnThisWorkbook) {
      toast.error('Cut status can only be updated on the job workbook or the proposal workbook.');
      return;
    }
    const { error } = await supabase.from('material_items').update({ trim_cut_state: state }).eq('id', itemId);
    if (error) {
      const m = (error.message || '').toLowerCase();
      if (m.includes('trim_cut_state') && (m.includes('schema cache') || m.includes('could not find'))) {
        toast.error(
          'Database missing material_items.trim_cut_state. Run supabase migration 20250345000000_add_trim_flatstock_plan_and_cut_state.sql (or supabase db push).'
        );
      } else {
        toast.error(error.message || 'Failed to update cut status');
      }
      return;
    }
    setWorkbook((prev) => {
      if (!prev?.sheets) return prev;
      return {
        ...prev,
        sheets: prev.sheets.map((sh) => ({
          ...sh,
          items: sh.items.map((i) => (i.id === itemId ? { ...i, trim_cut_state: state } : i)),
        })),
      };
    });
  }

  async function setMaterialItemTrimConfig(itemId: string, trimConfigId: string | null) {
    const { error: rpcError } = await supabase.rpc('set_material_item_trim_config', {
      p_material_item_id: itemId,
      p_trim_saved_config_id: trimConfigId,
    });
    if (!rpcError) return;
    const msg = (rpcError?.message || '').toLowerCase();
    if (msg.includes('schema cache') || msg.includes('could not find the function')) {
      const { error: updateError } = await supabase
        .from('material_items')
        .update({ trim_saved_config_id: trimConfigId })
        .eq('id', itemId);
      if (updateError) throw updateError;
      return;
    }
    throw rpcError;
  }

  async function linkTrimConfigToItem(configId: string) {
    if (!openLinkTrimForItem) return;
    if (isWorkbookReadOnlyRef.current) {
      toast.error('Cannot link trim while the proposal is locked (read-only).');
      return;
    }
    setLinkingTrimConfigId(configId);
    try {
      await setMaterialItemTrimConfig(openLinkTrimForItem.id, configId);
      toast.success(`Trim drawing linked to "${openLinkTrimForItem.materialName}". Shop will see it in the pull form.`);
      setOpenLinkTrimForItem(null);
      await loadWorkbook(true);
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg.includes('set_material_item_trim_config') && msg.toLowerCase().includes('schema cache')) {
        toast.error('Trim link failed: run the SQL in supabase/migrations/20250319000001_set_material_item_trim_config_rpc.sql in your Supabase SQL Editor, then try again.');
      } else {
        toast.error(msg || 'Failed to link trim');
      }
    } finally {
      setLinkingTrimConfigId(null);
    }
  }

  async function unlinkTrimFromItem() {
    if (!openLinkTrimForItem) return;
    if (isWorkbookReadOnlyRef.current) {
      toast.error('Cannot unlink trim while the proposal is locked (read-only).');
      return;
    }
    setLinkingTrimConfigId('unlink');
    try {
      await setMaterialItemTrimConfig(openLinkTrimForItem.id, null);
      toast.success('Trim drawing unlinked.');
      setOpenLinkTrimForItem(null);
      await loadWorkbook(true);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to unlink');
    } finally {
      setLinkingTrimConfigId(null);
    }
  }

  // Sheet management state
  const [showAddSheetDialog, setShowAddSheetDialog] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');
  const [newSheetType, setNewSheetType] = useState<'proposal' | 'change_order'>('proposal');
  const [addingSheet, setAddingSheet] = useState(false);

  // Sort categories dialog state
  const [showSortCategoriesDialog, setShowSortCategoriesDialog] = useState(false);
  const [sortCategoriesOrder, setSortCategoriesOrder] = useState<string[]>([]);
  const [savingSortOrder, setSavingSortOrder] = useState(false);
  const [draggedCatIndex, setDraggedCatIndex] = useState<number | null>(null);
  const [dragOverCatIndex, setDragOverCatIndex] = useState<number | null>(null);

  // Zoho sync state
  const [syncingZoho, setSyncingZoho] = useState(false);
  const [showSyncResults, setShowSyncResults] = useState(false);

  // Export XLSX state
  const [exportingXLSX, setExportingXLSX] = useState(false);
  const [syncResults, setSyncResults] = useState<any>(null);
  const [syncChangeDetailsView, setSyncChangeDetailsView] = useState<'inserted' | 'updated' | 'vendors' | null>(null);
  const [refreshingWorkbookPrices, setRefreshingWorkbookPrices] = useState(false);

  // Locked snapshot view (view a specific locked workbook; null = show working/edit view)
  const [snapshotWorkbookId, setSnapshotWorkbookId] = useState<string | null>(null);
  const [lockedSnapshotsMeta, setLockedSnapshotsMeta] = useState<{ id: string; version_number: number; locked_at: string | null }[]>([]);
  const [creatingWorkingFromLocked, setCreatingWorkingFromLocked] = useState(false);
  /** True when this quote has at least one `working` material_workbook row (even if UI is viewing a locked snapshot). */
  const [hasWorkingWorkbookForQuote, setHasWorkingWorkbookForQuote] = useState(false);
  /** Bumps when materials save so proposal panel can refresh job-workbook total while viewing signed workbook. */
  const [jobWbMaterialsRefreshSeq, setJobWbMaterialsRefreshSeq] = useState(0);
  /** Auto-manage locked snapshot + working copy for signed contracts (no manual Lock workbook). */
  const [ensuringContractWorkbookPair, setEnsuringContractWorkbookPair] = useState(false);
  /** Fresh sent/signed/office-lock fields for the selected quote (Materials jobQuotes can lag JobFinancials). */
  const [contractQuoteFields, setContractQuoteFields] = useState<ContractQuoteFields | null>(null);
  /** Mirrors `isWorkbookReadOnly` for async callbacks (e.g. loadWorkbook → backfill) that close over stale renders. */
  const isWorkbookReadOnlyRef = useRef(false);
  /** Latest workbook row status for `proposal-editing-unlocked` (avoid effect deps flipping on each load). */
  const proposalUnlockListenerWorkbookStatusRef = useRef<string | null>(null);

  // Load job quotes (proposals) so we can scope materials per proposal
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await fetchJobQuotesForMaterials(job.id);
      if (!mounted) return;
      if (error) {
        console.error('Error loading job quotes:', error);
        setJobQuotes([]);
        if (!isControlled) setSelectedQuoteId(null);
        return;
      }
      const quotes = (data || []) as JobQuote[];
      setJobQuotes(quotes);
      if (!isControlled) {
        setSelectedQuoteId(prev => {
          if (quotes.length === 0) return null;
          if (!prev || !quotes.some(q => q.id === prev)) {
            const defaultQuote = quotes.find(q => !q.is_change_order_proposal) ?? quotes[0];
            return defaultQuote.id;
          }
          return prev;
        });
      }
    })();
    return () => { mounted = false; };
  }, [job.id, isControlled]);

  // When parent selects a proposal that's not in our list yet (e.g. just created), refetch quotes so the new proposal appears
  useEffect(() => {
    if (!isControlled || !effectiveQuoteId || jobQuotes.some((q: any) => q.id === effectiveQuoteId)) return;
    let mounted = true;
    (async () => {
      const { data, error } = await fetchJobQuotesForMaterials(job.id);
      if (!mounted) return;
      if (error) return;
      const quotes = (data || []) as JobQuote[];
      setJobQuotes(quotes);
    })();
    return () => { mounted = false; };
  }, [isControlled, effectiveQuoteId, job.id, jobQuotes]);

  const jobHasContract = useMemo(
    () =>
      jobQuotes.some((q) => {
        if (q.is_change_order_proposal) return false;
        const sv = q.signed_version;
        const hasSigned = sv != null && String(sv).trim() !== '' && Number(sv) > 0;
        return hasSigned || !!q.customer_signed_at;
      }),
    [jobQuotes]
  );

  // Authoritative contract flags for the selected proposal (matches JobFinancials "Revoke contract" / Sent logic).
  useEffect(() => {
    let cancelled = false;
    if (!effectiveQuoteId) {
      setContractQuoteFields(null);
      return;
    }
    (async () => {
      const { data, error } = await fetchQuoteContractRowWithId(supabase, effectiveQuoteId);
      if (cancelled) return;
      if (error || !data) {
        setContractQuoteFields(null);
        return;
      }
      setContractQuoteFields({
        sent_at: (data.sent_at as string | null) ?? null,
        locked_for_editing: (data.locked_for_editing as boolean | null) ?? null,
        signed_version: (data.signed_version as number | null) ?? null,
        customer_signed_at: (data.customer_signed_at as string | null) ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveQuoteId]);

  useEffect(() => {
    if (!job.id || !effectiveQuoteId) return;
    const ch = supabase
      .channel(`materials-quote-contract-${job.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'quotes', filter: `job_id=eq.${job.id}` },
        (payload: { new?: Record<string, unknown> }) => {
          const row = payload.new;
          if (!row || row.id !== effectiveQuoteId) return;
          setContractQuoteFields({
            sent_at: (row.sent_at as string | null) ?? null,
            locked_for_editing: (row.locked_for_editing as boolean | null) ?? null,
            signed_version: (row.signed_version as number | null) ?? null,
            customer_signed_at: (row.customer_signed_at as string | null) ?? null,
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [job.id, effectiveQuoteId]);

  // When job or quote changes, reset active sheet so the first sheet in the workbook is shown
  useEffect(() => {
    setActiveSheetId('');
    // Snapshot view is quote-specific; clear it when proposal changes so we don't keep showing
    // a locked workbook from a different quote.
    setSnapshotWorkbookId(null);
    setWorkbook(null);
    for (const key of workbookCache.keys()) {
      if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
    }
  }, [job.id, effectiveQuoteId ?? null]);

  // Load workbook once we know which quote to use.
  // In uncontrolled mode, wait until jobQuotes has loaded so we use the real quote ID
  // rather than firing a wasted load with null then reloading again immediately after.
  // In controlled mode, the parent provides a real ID (never null thanks to ?? undefined).
  useEffect(() => {
    if (!isControlled && jobQuotes.length === 0) return;
    loadWorkbook();
  }, [job.id, effectiveQuoteId, isControlled, jobQuotes.length]);

  // Load packages once per job; subscribe to package changes (already filtered by job_id)
  useEffect(() => {
    loadPackages();
    const packagesChannel = supabase
      .channel(`material_bundles_changes_${job.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'material_bundles', filter: `job_id=eq.${job.id}` },
        () => { loadPackages(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(packagesChannel); };
  }, [job.id]);

  // Real-time: reload workbook when any material_item or material_sheet changes so newest crew
  // orders appear in the Field Request workbook immediately (invalidate cache so we don't show stale data).
  useEffect(() => {
    const ch = supabase
      .channel(`mgmt_items_${job.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_items' },
        () => {
          for (const key of workbookCache.keys()) {
            if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
          }
          loadWorkbook(true);
        }
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'material_sheets' },
        () => {
          for (const key of workbookCache.keys()) {
            if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
          }
          loadWorkbook(true);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [job.id]);

  // When proposal/materials are restored from snapshot (JobFinancials), refetch workbook for this quote
  useEffect(() => {
    const handler = (e: CustomEvent<{ quoteId: string }>) => {
      if (e.detail?.quoteId && e.detail.quoteId === effectiveQuoteId) loadWorkbook(false);
    };
    window.addEventListener('material-workbook-restored', handler as EventListener);
    return () => window.removeEventListener('material-workbook-restored', handler as EventListener);
  }, [effectiveQuoteId]);

  // When office locks/unlocks or contract is set (JobFinancials), workbook + quote rows change — refetch all of it.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ quoteId?: string | null; jobId?: string }>).detail;
      if (!detail || detail.jobId !== job.id) return;
      if (detail.quoteId != null && detail.quoteId !== effectiveQuoteId) return;
      for (const key of workbookCache.keys()) {
        if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
      }
      void (async () => {
        const { data: jq, error } = await fetchJobQuotesForMaterials(job.id);
        if (!error && jq) setJobQuotes(jq as JobQuote[]);
        await loadWorkbook(true);
        setJobWbMaterialsRefreshSeq((s) => s + 1);
      })();
    };
    window.addEventListener('materials-workbook-updated', handler as EventListener);
    return () => window.removeEventListener('materials-workbook-updated', handler as EventListener);
  }, [job.id, effectiveQuoteId]);

  async function loadPackages() {
    try {
      const { data, error } = await supabase
        .from('material_bundles')
        .select(`
          id,
          name,
          description,
          status,
          bundle_items:material_bundle_items(material_item_id)
        `)
        .eq('job_id', job.id)
        .order('name');

      if (error) {
        console.warn('Packages load failed (non-blocking):', error.message);
        setPackages([]);
        return;
      }
      setPackages(data || []);
    } catch (error: any) {
      console.warn('Packages load failed (non-blocking):', error?.message || error);
      setPackages([]);
    }
  }

  /**
   * For items that have a SKU but are missing cost_per_unit, price_per_unit, or length,
   * fetch materials_catalog and merge cost/price/length (part_length from books) into the items in memory.
   * Used so the first paint shows cost/price/length without waiting for DB backfill.
   */
  async function enrichItemsWithCatalogPrices(items: any[]): Promise<any[]> {
    const needsEnrich = items.filter(
      (i: any) => i.sku && (
        i.cost_per_unit == null ||
        i.price_per_unit == null ||
        (i.length == null || i.length === '')
      )
    );
    if (needsEnrich.length === 0) return items;

    const skus = [...new Set(needsEnrich.map((i: any) => i.sku as string))];
    let catalogRows: any[] | null = null;
    try {
      const { data, error } = await supabase
        .from('materials_catalog')
        .select('sku, purchase_cost, unit_price, part_length')
        .in('sku', skus);
      if (error) throw error;
      catalogRows = data ?? null;
    } catch (e) {
      console.warn('Enrich items from catalog failed (non-fatal):', e);
      return items;
    }

    if (!catalogRows || catalogRows.length === 0) return items;

    const catalogMap = new Map(catalogRows.map((r: any) => [r.sku, r]));

    return items.map((item: any) => {
      if (!item.sku) return item;
      const cat = catalogMap.get(item.sku);
      if (!cat) return item;

      const cost = Number(cat.purchase_cost) || 0;
      const price = Number(cat.unit_price) || 0;
      const rawPartLength = cat.part_length != null && String(cat.part_length).trim() !== '' ? String(cat.part_length).trim() : null;
      const unitOnly = /^(pcs|pc|bag|bags|lf|ft|piece|pieces|ea|each|units?|linear\s*ft)$/i;
      const catalogLength = rawPartLength && !unitOnly.test(rawPartLength) ? rawPartLength : null;
      if (cost === 0 && price === 0 && !catalogLength) return item;

      const safeCost = cost > 0 ? Math.round(cost * 10000) / 10000 : null;
      const safePrice = price > 0 ? Math.round(price * 10000) / 10000 : null;
      const safeMarkup =
        safeCost && safePrice && safeCost > 0
          ? Math.round(((safePrice - safeCost) / safeCost) * 100 * 10000) / 10000
          : null;
      const qty = Number(item.quantity) || 1;
      const rawItemLength = (item.length != null && item.length !== '') ? String(item.length).trim() : null;
      const itemLengthIsUnit = rawItemLength && unitOnly.test(rawItemLength);
      const mergedLength = !itemLengthIsUnit && rawItemLength ? rawItemLength : catalogLength;
      const mult = getEffectiveMultiplierForExtended(item, mergedLength ?? null, qty);

      return {
        ...item,
        length: mergedLength ?? null,
        cost_per_unit: item.cost_per_unit == null ? safeCost : item.cost_per_unit,
        price_per_unit: item.price_per_unit == null ? safePrice : item.price_per_unit,
        markup_percent: item.markup_percent == null ? safeMarkup : item.markup_percent,
        extended_cost:
          item.extended_cost == null && safeCost
            ? Math.round(safeCost * mult * 10000) / 10000
            : item.extended_cost,
        extended_price:
          item.extended_price == null && safePrice
            ? Math.round(safePrice * mult * 10000) / 10000
            : item.extended_price,
      };
    });
  }

  /**
   * For any material_items that have a SKU but are missing cost_per_unit or price_per_unit,
   * look up the catalog and patch the DB values in the background.
   * Does NOT block the render; triggers a silent reload if any rows were updated.
   */
  async function backfillMissingPricesFromCatalog(items: any[]) {
    try {
      if (isWorkbookReadOnlyRef.current) return;
      const needsPrice = items.filter(
        (i: any) => i.sku && (i.cost_per_unit == null || i.price_per_unit == null)
      );
      if (needsPrice.length === 0) return;

      const skus = [...new Set(needsPrice.map((i: any) => i.sku as string))];
      const { data: catalogRows } = await supabase
        .from('materials_catalog')
        .select('sku, purchase_cost, unit_price')
        .in('sku', skus);

      if (!catalogRows || catalogRows.length === 0) return;

      const catalogMap = new Map(catalogRows.map((r: any) => [r.sku, r]));

      let patched = 0;
      for (const item of needsPrice) {
        const cat = catalogMap.get(item.sku);
        if (!cat) continue;

        const cost  = Number(cat.purchase_cost) || 0;
        const price = Number(cat.unit_price)    || 0;
        if (cost === 0 && price === 0) continue;

        const safeCost  = cost  > 0 ? Math.round(cost  * 10000) / 10000 : null;
        const safePrice = price > 0 ? Math.round(price * 10000) / 10000 : null;
        const safeMarkup = safeCost && safePrice && safeCost > 0
          ? Math.round(((safePrice - safeCost) / safeCost) * 100 * 10000) / 10000
          : null;
        const qty = Number(item.quantity) || 1;
        const backfillMult = getEffectiveMultiplierForExtended(item, item.length, qty);

        await supabase
          .from('material_items')
          .update({
            cost_per_unit:  item.cost_per_unit  == null ? safeCost  : undefined,
            price_per_unit: item.price_per_unit == null ? safePrice : undefined,
            markup_percent: item.markup_percent == null ? safeMarkup : undefined,
            extended_cost:  (item.extended_cost  == null && safeCost)  ? Math.round(safeCost  * backfillMult * 10000) / 10000 : undefined,
            extended_price: (item.extended_price == null && safePrice) ? Math.round(safePrice * backfillMult * 10000) / 10000 : undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);

        patched++;
      }

      if (patched > 0) {
        // Invalidate cache so the reload gets fresh data from DB with persisted cost/price
        for (const key of workbookCache.keys()) {
          if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
        }
        loadWorkbook(true);
      }
    } catch (err) {
      // Non-critical — log but don't surface to the user
      console.warn('backfillMissingPricesFromCatalog error:', err);
    }
  }

  /** Refresh cost/price/length for all material_items in the current workbook from materials_catalog (Zoho Books source). */
  async function refreshWorkbookPricesFromCatalog() {
    if (!canUseShopTrimAndZohoOnThisWorkbook) {
      toast.error('Refresh prices is only available on the job workbook or the proposal workbook.');
      return;
    }
    if (!workbook?.sheets?.length) return;
    setRefreshingWorkbookPrices(true);
    try {
      const allItems: any[] = workbook.sheets.flatMap((s: any) => (s.items || []).filter((i: any) => i.sku));
      if (allItems.length === 0) {
        toast.info('No materials with SKUs in this workbook to refresh.');
        return;
      }
      const skus = [...new Set(allItems.map((i: any) => i.sku as string))];
      const { data: catalogRows } = await supabase
        .from('materials_catalog')
        .select('sku, purchase_cost, unit_price, part_length')
        .in('sku', skus);
      if (!catalogRows?.length) {
        toast.warning('No catalog data found for these SKUs. Sync from Zoho Books first.');
        return;
      }
      const unitOnly = /^(pcs|pc|bag|bags|lf|ft|piece|pieces|ea|each|units?|linear\s*ft)$/i;
      const catalogMap = new Map(catalogRows.map((r: any) => [
        r.sku,
        {
          cost: Number(r.purchase_cost) || 0,
          price: Number(r.unit_price) || 0,
          length: r.part_length != null && String(r.part_length).trim() !== '' && !unitOnly.test(String(r.part_length).trim())
            ? String(r.part_length).trim()
            : null,
        },
      ]));
      let updated = 0;
      for (const item of allItems) {
        const cat = catalogMap.get(item.sku);
        if (!cat || (cat.cost === 0 && cat.price === 0)) continue;
        const qty = Number(item.quantity) || 1;
        const refreshLength = item.length ?? cat.length ?? null;
        const refreshMult = getEffectiveMultiplierForExtended(item, refreshLength, qty);
        const safeCost = cat.cost > 0 ? Math.round(cat.cost * 10000) / 10000 : null;
        const safePrice = cat.price > 0 ? Math.round(cat.price * 10000) / 10000 : null;
        const safeMarkup = safeCost && safePrice && safeCost > 0
          ? Math.round(((safePrice - safeCost) / safeCost) * 100 * 10000) / 10000
          : null;
        const updatePayload: Record<string, unknown> = {
          cost_per_unit: safeCost,
          price_per_unit: safePrice,
          markup_percent: safeMarkup,
          extended_cost: safeCost != null ? Math.round(safeCost * refreshMult * 10000) / 10000 : null,
          extended_price: safePrice != null ? Math.round(safePrice * refreshMult * 10000) / 10000 : null,
          updated_at: new Date().toISOString(),
        };
        if (cat.length != null) updatePayload.length = cat.length;
        const { error } = await supabase.from('material_items').update(updatePayload).eq('id', item.id);
        if (!error) updated++;
      }
      for (const key of workbookCache.keys()) {
        if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
      }
      await loadWorkbook(true);
      toast.success(`Refreshed prices from catalog for ${updated} material(s) in this workbook.`);
    } catch (err: any) {
      console.error('refreshWorkbookPricesFromCatalog error:', err);
      toast.error(err?.message || 'Failed to refresh prices from catalog.');
    } finally {
      setRefreshingWorkbookPrices(false);
    }
  }

  async function countMaterialItemsForWorkbook(workbookId: string): Promise<number> {
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

  /** Remove a workbook and all sheets/items (for replacing an empty working copy). */
  async function deleteMaterialWorkbookCascade(workbookId: string) {
    const { data: sheets } = await supabase.from('material_sheets').select('id').eq('workbook_id', workbookId);
    const sheetIds = (sheets || []).map((s) => s.id);
    if (sheetIds.length > 0) {
      await supabase.from('material_items').delete().in('sheet_id', sheetIds);
      await supabase.from('material_sheet_labor').delete().in('sheet_id', sheetIds);
      await supabase.from('material_category_markups').delete().in('sheet_id', sheetIds);
      await supabase.from('material_category_options').delete().in('sheet_id', sheetIds);
      await supabase.from('material_sheets').delete().eq('workbook_id', workbookId);
    }
    const { error: wbErr } = await supabase.from('material_workbooks').delete().eq('id', workbookId);
    if (wbErr) throw wbErr;
  }

  /** Whether the load ended on an editable (non-snapshot) working workbook — used after leaving locked snapshot view. */
  async function loadWorkbook(
    silent = false,
    overrideQuoteId?: string | null,
    snapshotIdOverride?: string | null,
    opts?: { preferWorking?: boolean }
  ): Promise<{ landedOnEditableWorking: boolean } | undefined> {
    workbookLoadDepthRef.current += 1;
    const loadDepth = workbookLoadDepthRef.current;
    let workbookForViewSync: { id?: string; status?: string; quote_id?: string | null } | null | undefined;
    let quoteIdForSettled: string | null = null;
    try {
      const quoteIdForLoad = overrideQuoteId !== undefined ? overrideQuoteId : (effectiveQuoteId ?? null);
      quoteIdForSettled = quoteIdForLoad;
      let snapActive: string | null;
      if (snapshotIdOverride === null) snapActive = null;
      else if (typeof snapshotIdOverride === 'string') snapActive = snapshotIdOverride;
      else snapActive = snapshotWorkbookId;
      const cacheKey = `${job.id}:${quoteIdForLoad ?? 'none'}:${snapActive ?? 'edit'}`;

      // Serve from cache immediately (stale-while-revalidate pattern)
      const cached = workbookCache.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        const sheetsC = cached.workbook?.sheets ?? [];
        const totalCached = sheetsC.reduce((n, s: any) => n + (s.items?.length ?? 0), 0);
        const emptyWorkingCached =
          totalCached === 0 &&
          !!quoteIdForLoad &&
          !snapActive &&
          (cached.workbook as MaterialWorkbook)?.status === 'working';
        if (!emptyWorkingCached) {
          setWorkbook(mergeWorkbookLocalOverrides(cached.workbook));
          setAllCategories(cached.categories);
          const sheets = sheetsC;
          const current = activeSheetIdRef.current;
          if (sheets.length > 0 && (!current || !sheets.some((s: any) => s.id === current))) {
            setActiveSheetId(sheets[0].id);
          }
          // Refresh in background without showing the loading spinner
          silent = true;
        } else {
          workbookCache.delete(cacheKey);
        }
      } else if (!silent) {
        setLoading(true);
      }

      // Fetch workbooks + authoritative quote contract fields together (React `contractQuoteFields` often lags
      // right after “Set as contract” if realtime is off — without DB read, we never default to the locked snapshot
      // or run signed-contract workbook pairing).
      const wbQuery = supabase
        .from('material_workbooks')
        .select('*')
        .eq('job_id', job.id)
        .order('updated_at', { ascending: false });
      const quoteFreshPromise = quoteIdForLoad
        ? fetchQuoteContractRowWithId(supabase, quoteIdForLoad)
        : Promise.resolve({ data: null as any, error: null as any });

      const [{ data: allWorkbooks, error: wbError }, { data: fqRow }] = await Promise.all([wbQuery, quoteFreshPromise]);

      if (wbError) throw wbError;

      const wbs = allWorkbooks || [];
      const freshContractFields: ContractQuoteFields | null =
        fqRow && quoteIdForLoad
          ? {
              sent_at: fqRow.sent_at ?? null,
              locked_for_editing: fqRow.locked_for_editing ?? null,
              signed_version: fqRow.signed_version ?? null,
              customer_signed_at: fqRow.customer_signed_at ?? null,
            }
          : null;
      if (freshContractFields && quoteIdForLoad === effectiveQuoteId) {
        setContractQuoteFields(freshContractFields);
      }

      const matchQuote = (w: (typeof wbs)[0]) =>
        quoteIdForLoad ? w.quote_id === quoteIdForLoad : !w.quote_id;
      const selectedQuote = quoteIdForLoad
        ? jobQuotes.find((q) => q.id === quoteIdForLoad) ?? null
        : null;
      const fieldsForContract =
        freshContractFields ?? (quoteIdForLoad === effectiveQuoteId ? contractQuoteFields : null);
      const selectedQuoteForDefaultView = quoteIdForLoad
        ? buildQuoteForContract(jobQuotes, quoteIdForLoad, fieldsForContract) ?? selectedQuote
        : null;
      // Draft: default to working (price + edits). Signed contract: default to locked snapshot (proposal price).
      // Office-only lock: still one row — usually `locked` only; working-first ordering still resolves to that row.
      const shouldDefaultToLockedWorkbook = quoteHasActiveContract(selectedQuoteForDefaultView as any);
      /** Left panel "Unlock for editing" / office unlock on signed jobs — keep job/working copy across reloads (saves, events, realtime). */
      const preferWorkingForSessionUnlock =
        !!quoteIdForLoad &&
        !!historicalUnlockedQuoteId &&
        historicalUnlockedQuoteId === quoteIdForLoad;
      const lockedList = wbs
        .filter((w) => matchQuote(w) && w.status === 'locked')
        .sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0));
      const workingList = wbs
        .filter((w) => matchQuote(w) && w.status === 'working')
        .sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0));
      setHasWorkingWorkbookForQuote(workingList.length > 0);

      let workbookData: (typeof wbs)[0] | null = null;
      if (snapActive) {
        // Snapshot must belong to the currently selected proposal scope.
        workbookData = wbs.find((w) => w.id === snapActive && w.status === 'locked' && matchQuote(w)) ?? null;
        if (!workbookData) setSnapshotWorkbookId(null);
      }
      if (!workbookData) {
        // User explicitly left signed-contract snapshot / chose "working copy" — must land on working, not locked-first.
        if (opts?.preferWorking && workingList.length > 0) {
          workbookData = workingList[0];
        } else if (
          shouldDefaultToLockedWorkbook &&
          preferWorkingForSessionUnlock &&
          workingList.length > 0
        ) {
          workbookData = workingList[0];
        } else {
          workbookData = shouldDefaultToLockedWorkbook
            ? (lockedList[0] ?? workingList[0] ?? null)
            : (workingList[0] ?? lockedList[0] ?? null);
        }
      }
      if (!workbookData && quoteIdForLoad) {
        // Strict per-proposal binding: only workbooks owned by this quote_id (never sibling proposals).
        const forQuote = (status: string) =>
          wbs.find((w) => w.quote_id === quoteIdForLoad && w.status === status) ?? null;
        workbookData =
          shouldDefaultToLockedWorkbook && preferWorkingForSessionUnlock
            ? (forQuote('working') ?? forQuote('locked'))
            : shouldDefaultToLockedWorkbook
              ? (forQuote('locked') ?? forQuote('working'))
              : (forQuote('working') ?? forQuote('locked'));
        // Single-proposal jobs only: legacy job-level workbook (quote_id null).
        if (!workbookData && jobQuotes.filter((q) => q.is_customer_estimate !== true).length <= 1) {
          workbookData =
            wbs.find((w) => !w.quote_id && w.status === 'working') ??
            wbs.find((w) => !w.quote_id && w.status === 'locked') ??
            null;
        }
      }
      if (!workbookData && !quoteIdForLoad) {
        workbookData = wbs.find((w) => w.status === 'working') ?? wbs[0] ?? null;
      }
      if (!workbookData && wbs.length > 0 && !quoteIdForLoad) {
        workbookData = wbs[0];
      }

      // When viewing a contract-frozen proposal and we're landing on a locked workbook,
      // prefer the newest locked workbook that actually has material_items.
      // This avoids showing an empty "latest locked" created during an earlier failed clone.
      if (
        loadDepth === 1 &&
        quoteIdForLoad &&
        !snapActive &&
        workbookData?.status === 'locked' &&
        lockedList.length > 1
      ) {
        for (const candidate of lockedList) {
          const cnt = await countMaterialItemsForWorkbook(candidate.id);
          if (cnt > 0) {
            workbookData = candidate;
            break;
          }
        }
      }

      if (workbookData && quoteIdForLoad && isWorkbookQuoteMismatch(workbookData.quote_id, quoteIdForLoad, jobQuotes)) {
        console.warn(
          `[proposal-isolation] Materials rejected workbook ${workbookData.id} for proposal ${quoteIdForLoad}`,
        );
        workbookData = null;
      }

      if (!workbookData) {
        workbookForViewSync = null;
        setWorkbook(null);
        setLockedSnapshotsMeta([]);
        if (!silent) setLoading(false);
        return { landedOnEditableWorking: false };
      }

      // Keep the "contract snapshot toggle" consistent with the workbook we actually selected:
      // if we picked a later non-empty locked candidate (or the user is in a snapshot view),
      // ensure it's first in the meta list so the UI label matches the data shown.
      const lockedListForMeta =
        workbookData?.status === 'locked'
          ? (() => {
              const primary = lockedList.find((l) => l.id === workbookData.id);
              if (!primary) return lockedList;
              return [primary, ...lockedList.filter((l) => l.id !== primary.id)];
            })()
          : lockedList;

      setLockedSnapshotsMeta(
        lockedListForMeta.map((w) => ({
          id: w.id,
          version_number: w.version_number ?? 0,
          locked_at: w.locked_at ?? null,
        }))
      );

      let sheetsData: any[] = [];
      let itemsData: any[] = [];

      if (!workbookData) {
        setWorkbook(null);
        setLockedSnapshotsMeta([]);
        setHasWorkingWorkbookForQuote(false);
        if (!silent) setLoading(false);
        return { landedOnEditableWorking: false };
      }

      const { data: sheetsRows, error: sheetsError } = await supabase
        .from('material_sheets')
        .select('*')
        .eq('workbook_id', workbookData.id)
        .order('order_index');
      if (sheetsError) throw sheetsError;
      sheetsData = sheetsRows || [];
      const sheetIds = sheetsData.map((s: any) => s.id);
      if (sheetIds.length > 0) {
        const { data: itemsRes, error: itemsError } = await supabase
          .from('material_items')
          .select('*')
          .in('sheet_id', sheetIds)
          .order('order_index');
        if (itemsError) throw itemsError;
        itemsData = itemsRes || [];
      }

      const isSnapshotView = !!snapActive && workbookData.id === snapActive;
      const workingWbForQuote = workingList[0];

      // Field Request / Crew Orders: only on the working workbook for this proposal (not locked snapshots, not other quotes' workbooks).
      if (!isSnapshotView && workbookData.status === 'working' && workingWbForQuote?.id === workbookData.id) {
        const frWbId = workbookData.id;
        const existingSheetIds = new Set(sheetsData.map((s: any) => s.id));

        const { data: allCrewSheets } = await supabase
          .from('material_sheets')
          .select('*')
          .eq('workbook_id', frWbId)
          .in('sheet_name', ['Field Request', 'Field Requests', 'Crew Orders'])
          .order('created_at', { ascending: true });

        if ((allCrewSheets || []).length > 0) {
          const allCrewItems: Record<string, any[]> = {};
          for (const cs of allCrewSheets!) {
            const { data: csItems } = await supabase
              .from('material_items')
              .select('*')
              .eq('sheet_id', cs.id)
              .order('order_index');
            allCrewItems[cs.id] = csItems || [];
          }

          const canonical = [...allCrewSheets!].sort(
            (a, b) => (allCrewItems[b.id]?.length ?? 0) - (allCrewItems[a.id]?.length ?? 0)
          )[0];

          const wbSheetIdList = sheetsData.map((s: any) => s.id);
          let wrongSheetItems: { id: string }[] | null = null;
          if (wbSheetIdList.length > 0) {
            const { data } = await supabase
              .from('material_items')
              .select('id')
              .not('requested_by', 'is', null)
              .in('sheet_id', wbSheetIdList)
              .neq('sheet_id', canonical.id);
            wrongSheetItems = data;
          }
          if ((wrongSheetItems?.length ?? 0) > 0) {
            const ids = wrongSheetItems!.map((r: { id: string }) => r.id);
            await supabase
              .from('material_items')
              .update({ sheet_id: canonical.id, updated_at: new Date().toISOString() })
              .in('id', ids);
            const { data: canonicalItems } = await supabase
              .from('material_items')
              .select('*')
              .eq('sheet_id', canonical.id)
              .order('order_index');
            allCrewItems[canonical.id] = canonicalItems ?? [];
          }

          if (existingSheetIds.has(canonical.id)) {
            itemsData = itemsData.filter((i: any) => i.sheet_id !== canonical.id).concat(allCrewItems[canonical.id] ?? []);
          } else {
            const emptyCrewIdx = sheetsData.findIndex(
              (s: any) =>
                (s.sheet_name === 'Field Request' || s.sheet_name === 'Field Requests' || s.sheet_name === 'Crew Orders') &&
                (allCrewItems[s.id]?.length ?? itemsData.filter((i: any) => i.sheet_id === s.id).length) === 0
            );
            if (emptyCrewIdx !== -1) {
              const removedId = sheetsData[emptyCrewIdx].id;
              sheetsData.splice(emptyCrewIdx, 1);
              itemsData = itemsData.filter((i: any) => i.sheet_id !== removedId);
            }
            sheetsData.push(canonical);
            itemsData.push(...allCrewItems[canonical.id]);
          }
        }
      }

      // Enrich items that have a SKU but missing cost/price with values from materials_catalog
      // so the sheet shows cost and price on first paint when the catalog has them.
      itemsData = await enrichItemsWithCatalogPrices(itemsData);

      // Sort: proposal sheets first, then change order sheets (each group by order_index)
      sheetsData.sort((a: any, b: any) => {
        const typeA = a.sheet_type === 'change_order' ? 1 : 0;
        const typeB = b.sheet_type === 'change_order' ? 1 : 0;
        if (typeA !== typeB) return typeA - typeB;
        return (a.order_index ?? 0) - (b.order_index ?? 0);
      });

      const sheets: MaterialSheet[] = sheetsData.map((sheet: any) => ({
        ...sheet,
        items: itemsData.filter((item: any) => item.sheet_id === sheet.id),
      }));

      const totalItemsCount = sheets.reduce((n, s) => n + s.items.length, 0);
      if (
        loadDepth === 1 &&
        quoteIdForLoad &&
        !snapActive &&
        workbookData.status === 'working' &&
        lockedList.length > 0 &&
        totalItemsCount === 0
      ) {
        try {
          const lockedCnt = await countMaterialItemsForWorkbook(lockedList[0].id);
          if (lockedCnt > 0) {
            if (!silent) toast.info('Job workbook was empty — cloning line items from the signed workbook…');
            await deleteMaterialWorkbookCascade(workbookData.id);
            for (const key of workbookCache.keys()) {
              if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
            }
            await createWorkingFromLatestLocked({ silent: true });
            return { landedOnEditableWorking: true };
          }
        } catch (reErr: any) {
          console.error('repair empty working workbook:', reErr);
          if (!silent) toast.error(reErr?.message || 'Could not rebuild job workbook from the signed workbook.');
        }
      }

      const uniqueCategories = new Set<string>();
      itemsData.forEach((item: any) => { if (item.category) uniqueCategories.add(item.category); });
      const categories = Array.from(uniqueCategories).sort();
      setAllCategories(categories);

      const fullWorkbook = mergeWorkbookLocalOverrides({ ...workbookData, sheets });
      setWorkbook(fullWorkbook);
      workbookForViewSync = workbookData;

      // Write to cache so the next visit is instant
      workbookCache.set(cacheKey, { workbook: fullWorkbook, categories, cachedAt: Date.now() });

      // Background: backfill cost/price from catalog for any item that has a SKU but no price.
      // Runs silently; if it patches any rows it triggers a silent reload so the user sees prices.
      backfillMissingPricesFromCatalog(itemsData);

      // Only set active sheet to first when current selection is empty or not in the new list.
      // Use ref so realtime/subscription callbacks (stale closure) don't overwrite user's choice.
      const current = activeSheetIdRef.current;
      if (sheets.length > 0 && (!current || !sheets.some((s: any) => s.id === current))) {
        setActiveSheetId(sheets[0].id);
      }

      return {
        landedOnEditableWorking: !isSnapshotView && workbookData.status === 'working',
      };
    } catch (error: any) {
      console.error('Error loading workbook:', error);
      workbookForViewSync = null;
      const msg = error?.message || error?.error_description || String(error);
      const short = msg.length > 120 ? msg.slice(0, 117) + '…' : msg;
      toast.error(short ? `Failed to load materials: ${short}` : 'Failed to load materials');
      return undefined;
    } finally {
      workbookLoadDepthRef.current -= 1;
      setLoading(false);
      if (workbookLoadDepthRef.current === 0) {
        if (workbookForViewSync !== undefined) {
          const qid = quoteIdForSettled;
          if (workbookForViewSync && qid && !isWorkbookQuoteMismatch(workbookForViewSync.quote_id, qid, jobQuotes)) {
            onWorkbookViewSync?.({
              workbookId: workbookForViewSync.id ?? null,
              status: (workbookForViewSync.status as 'working' | 'locked') ?? null,
            });
          } else {
            onWorkbookViewSync?.({ workbookId: null, status: null });
          }
        }
        onWorkbookLoadSettled?.();
      }
    }
  }

  async function openLockedSnapshotView(wbId: string) {
    setSnapshotWorkbookId(wbId);
    await loadWorkbook(false, undefined, wbId);
  }

  async function exitLockedSnapshotView() {
    setSnapshotWorkbookId(null);
    const res = await loadWorkbook(false, undefined, null, { preferWorking: true });
    // Without a `working` row, preferWorking still falls back to `locked` → UI stays read-only. Create a working copy from the snapshot.
    if (res && !res.landedOnEditableWorking && effectiveQuoteId) {
      await createWorkingFromLatestLocked({ silent: true });
    }
  }

  proposalUnlockListenerWorkbookStatusRef.current = workbook?.status ?? null;

  // When the proposal is unlocked for editing from the left panel (JobFinancials),
  // automatically switch Materials out of the locked snapshot view and into the working copy.
  // The locked workbook remains the proposal-price source of truth; edits happen on working.
  useEffect(() => {
    const handler = (e: Event) => {
      const { quoteId } = (e as CustomEvent).detail ?? {};
      if (!quoteId || !effectiveQuoteId || quoteId !== effectiveQuoteId) return;
      const viewingLocked =
        !!snapshotWorkbookId || proposalUnlockListenerWorkbookStatusRef.current === 'locked';
      if (!viewingLocked) return;
      // Always attempt to exit locked view when proposal unlocks.
      // If no working workbook exists yet, loadWorkbook will keep the best available view.
      void exitLockedSnapshotView();
    };
    window.addEventListener('proposal-editing-unlocked', handler as EventListener);
    return () => window.removeEventListener('proposal-editing-unlocked', handler as EventListener);
  }, [effectiveQuoteId, snapshotWorkbookId]);

  async function createWorkingFromLatestLocked(opts?: { silent?: boolean; _retriedAfterEmptyPurge?: boolean }) {
    const silent = !!opts?.silent;
    const qid = effectiveQuoteId;
    if (!qid) {
      if (!silent) toast.error('Select a proposal first.');
      return;
    }
    setCreatingWorkingFromLocked(true);
    try {
      const { data: allWbs, error } = await supabase.from('material_workbooks').select('*').eq('job_id', job.id);
      if (error) throw error;
      const wbs = allWbs || [];
      const workingRows = wbs
        .filter((w: any) => w.quote_id === qid && w.status === 'working')
        .sort((a: any, b: any) => (b.version_number ?? 0) - (a.version_number ?? 0));
      const lockedRows = wbs
        .filter((w: any) => w.quote_id === qid && w.status === 'locked')
        .sort((a: any, b: any) => (b.version_number ?? 0) - (a.version_number ?? 0));
      const topWorking = workingRows[0];
      const topLocked = lockedRows[0];

      if (topWorking && !opts?._retriedAfterEmptyPurge) {
        const wCount = await countMaterialItemsForWorkbook(topWorking.id);
        const lCount = topLocked ? await countMaterialItemsForWorkbook(topLocked.id) : 0;
        if (wCount === 0 && lCount > 0) {
          await deleteMaterialWorkbookCascade(topWorking.id);
          for (const key of workbookCache.keys()) {
            if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
          }
          return createWorkingFromLatestLocked({ ...opts, silent, _retriedAfterEmptyPurge: true });
        }
        if (wCount > 0) {
          if (!silent) toast.info('A job workbook already exists for this proposal.');
          for (const key of workbookCache.keys()) {
            if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
          }
          await loadWorkbook(true, undefined, null, { preferWorking: true });
          return;
        }
        // Empty working + empty locked materials: still replace with a proper clone (sheets/structure from locked)
        if (wCount === 0 && lCount === 0 && topLocked) {
          await deleteMaterialWorkbookCascade(topWorking.id);
          for (const key of workbookCache.keys()) {
            if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
          }
          return createWorkingFromLatestLocked({ ...opts, silent, _retriedAfterEmptyPurge: true });
        }
        if (wCount === 0 && !topLocked) {
          if (!silent) toast.error('No locked workbook found to copy from.');
          return;
        }
      }

      const locked = wbs
        .filter((w: any) => w.quote_id === qid && w.status === 'locked')
        .sort((a: any, b: any) => (b.version_number ?? 0) - (a.version_number ?? 0));

      // Prefer the newest locked workbook that actually has material items.
      // Some environments can end up with an empty "latest locked" after a partial clone attempt.
      let source: (typeof locked)[number] | null = null;
      for (const candidate of locked) {
        const cnt = await countMaterialItemsForWorkbook(candidate.id);
        if (cnt > 0) {
          source = candidate;
          break;
        }
      }
      if (!source) {
        if (!silent) toast.error('No locked workbook with materials found for this proposal.');
        return;
      }
      const { data: maxWb } = await supabase
        .from('material_workbooks')
        .select('version_number')
        .eq('job_id', job.id)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVer = (maxWb?.version_number ?? 0) + 1;
      const { data: newWb, error: insErr } = await supabase
        .from('material_workbooks')
        .insert({
          job_id: job.id,
          quote_id: qid,
          version_number: nextVer,
          status: 'working',
          created_by: userId,
        })
        .select()
        .single();
      if (insErr || !newWb) throw new Error(insErr?.message ?? 'Failed to create workbook');

      const { data: oldSheets } = await supabase
        .from('material_sheets')
        .select('*')
        .eq('workbook_id', source.id)
        .order('order_index');

      const sheetIdMap: Record<string, string> = {};
      const orderedOldSheets = oldSheets || [];

      for (const oldSheet of orderedOldSheets) {
        const insPayload: Record<string, unknown> = {
          workbook_id: newWb.id,
          sheet_name: oldSheet.sheet_name,
          order_index: oldSheet.order_index ?? 0,
          is_option: (oldSheet as any).is_option ?? false,
          sheet_type: (oldSheet as any).sheet_type ?? 'proposal',
          description: (oldSheet as any).description ?? null,
          change_order_seq: (oldSheet as any).change_order_seq ?? null,
          compare_to_sheet_id: null,
        };

        // Backward-compatible insert: some deployments may not yet have newer optional columns.
        let newSheet: any = null;
        let shErr: any = null;
        let insertPayload: Record<string, unknown> = { ...insPayload };
        for (let attempt = 0; attempt < 4; attempt++) {
          const res = await supabase.from('material_sheets').insert(insertPayload).select().single();
          newSheet = res.data;
          shErr = res.error;
          if (!shErr && newSheet) break;
          const msg = String(shErr?.message || '').toLowerCase();
          if (msg.includes('change_order_seq')) {
            const { change_order_seq: _drop, ...next } = insertPayload as Record<string, unknown> & { change_order_seq?: unknown };
            insertPayload = next;
            continue;
          }
          if (msg.includes('sheet_type')) {
            const { sheet_type: _drop, ...next } = insertPayload as Record<string, unknown> & { sheet_type?: unknown };
            insertPayload = next;
            continue;
          }
          if (msg.includes('description')) {
            const { description: _drop, ...next } = insertPayload as Record<string, unknown> & { description?: unknown };
            insertPayload = next;
            continue;
          }
          if (msg.includes('compare_to_sheet_id')) {
            const { compare_to_sheet_id: _drop, ...next } = insertPayload as Record<string, unknown> & { compare_to_sheet_id?: unknown };
            insertPayload = next;
            continue;
          }
          break;
        }
        if (shErr || !newSheet) throw new Error(shErr?.message ?? 'Failed to copy sheet');
        sheetIdMap[oldSheet.id] = newSheet.id;

        const { data: oldItems } = await supabase.from('material_items').select('*').eq('sheet_id', oldSheet.id);
        if (oldItems?.length) {
          const rows = oldItems.map((item: any) => {
            const { id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...rest } = item;
            return { ...rest, sheet_id: newSheet.id };
          });
          const { error: itErr } = await supabase.from('material_items').insert(rows);
          if (itErr) throw itErr;
        }

        const { data: oldMarkups } = await supabase
          .from('material_category_markups')
          .select('*')
          .eq('sheet_id', oldSheet.id);
        if (oldMarkups?.length) {
          const { error: mErr } = await supabase.from('material_category_markups').insert(
            oldMarkups.map((m: any) => ({
              sheet_id: newSheet.id,
              category_name: m.category_name,
              markup_percent: m.markup_percent,
            }))
          );
          if (mErr) throw mErr;
        }

        const { data: laborRows } = await supabase
          .from('material_sheet_labor')
          .select('*')
          .eq('sheet_id', oldSheet.id);
        for (const oldLabor of laborRows || []) {
          const { id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...lr } = oldLabor;
          const { error: lErr } = await supabase.from('material_sheet_labor').insert({ ...lr, sheet_id: newSheet.id });
          if (lErr) throw lErr;
        }
      }

      for (const oldSheet of orderedOldSheets) {
        const newSid = sheetIdMap[oldSheet.id];
        const oldCmp = (oldSheet as any).compare_to_sheet_id;
        if (newSid && oldCmp && sheetIdMap[oldCmp]) {
          const { error: uErr } = await supabase
            .from('material_sheets')
            .update({ compare_to_sheet_id: sheetIdMap[oldCmp] })
            .eq('id', newSid);
          if (uErr) throw uErr;
        }
      }

      for (const key of workbookCache.keys()) {
        if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
      }
      if (!silent) {
        toast.success('Job workbook created. Field requests and internal edits use this copy; proposal snapshots stay unchanged.');
      }
      setSnapshotWorkbookId(null);
      await loadWorkbook(false, undefined, null, { preferWorking: true });
      window.dispatchEvent(new CustomEvent('materials-workbook-updated', { detail: { jobId: job.id, quoteId: qid } }));
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to create job workbook.');
    } finally {
      setCreatingWorkingFromLocked(false);
    }
  }

  /**
   * Contract-frozen proposal should behave as a clean pair:
   * exactly one locked contract snapshot + one working copy.
   * Prunes extra workbook rows for this quote.
   */
  async function pruneContractWorkbookPair(quoteId: string, allForQuote?: any[]) {
    const rows: any[] =
      allForQuote ??
      (
        await supabase
          .from('material_workbooks')
          .select('*')
          .eq('job_id', job.id)
          .eq('quote_id', quoteId)
      ).data ??
      [];
    if (rows.length <= 2) return;

    const lockedRows = rows
      .filter((w: any) => w.status === 'locked')
      .sort((a: any, b: any) => (b.version_number ?? 0) - (a.version_number ?? 0));
    const workingRows = rows
      .filter((w: any) => w.status === 'working')
      .sort((a: any, b: any) => (b.version_number ?? 0) - (a.version_number ?? 0));

    let keepLocked: any | null = null;
    for (const w of lockedRows) {
      const cnt = await countMaterialItemsForWorkbook(w.id);
      if (cnt > 0) {
        keepLocked = w;
        break;
      }
    }
    if (!keepLocked) keepLocked = lockedRows[0] ?? null;

    let keepWorking: any | null = null;
    for (const w of workingRows) {
      const cnt = await countMaterialItemsForWorkbook(w.id);
      if (cnt > 0) {
        keepWorking = w;
        break;
      }
    }
    if (!keepWorking) keepWorking = workingRows[0] ?? null;

    const keepIds = new Set<string>([keepLocked?.id, keepWorking?.id].filter(Boolean) as string[]);
    const deleteRows = rows.filter((w: any) => !keepIds.has(w.id));
    for (const w of deleteRows) {
      await deleteMaterialWorkbookCascade(w.id);
      if (snapshotWorkbookId === w.id) {
        setSnapshotWorkbookId(null);
      }
    }

    if (deleteRows.length > 0) {
      for (const key of workbookCache.keys()) {
        if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
      }
    }
  }

  /**
   * Only a signed contract (customer sign and/or signed_version) gets the locked + working workbook pair.
   * Office-only proposal lock keeps a single workbook row; it must not auto-clone a job-tracking copy.
   */
  const signedContractWorkbookPairKey = useMemo(() => {
    const q = buildQuoteForContract(jobQuotes, effectiveQuoteId, contractQuoteFields);
    if (!q || !effectiveQuoteId || !quoteHasActiveContract(q as any)) return null;
    return `${q.id}|${q.signed_version ?? ''}|${q.customer_signed_at ?? ''}`;
  }, [jobQuotes, effectiveQuoteId, contractQuoteFields]);

  // Signed contract: ensure locked (proposal price) + working (job/COS only, not tied to proposal total).
  useEffect(() => {
    if (!signedContractWorkbookPairKey || !effectiveQuoteId) return;
    const qid = effectiveQuoteId;
    let cancelled = false;
    (async () => {
      const { data: allWbs, error } = await supabase
        .from('material_workbooks')
        .select('id, quote_id, status, version_number')
        .eq('job_id', job.id);
      if (cancelled || error) return;
      let wbsForQ = (allWbs || []).filter((w: any) => w.quote_id === qid);
      if (wbsForQ.length === 0) return;

      let hasWorking = wbsForQ.some((w: any) => w.status === 'working');
      let hasLocked = wbsForQ.some((w: any) => w.status === 'locked');
      if (hasWorking && hasLocked) return;

      setEnsuringContractWorkbookPair(true);
      try {
        if (hasWorking && !hasLocked) {
          const sorted = [...wbsForQ]
            .filter((w: any) => w.status === 'working')
            .sort((a: any, b: any) => (b.version_number ?? 0) - (a.version_number ?? 0));
          const top = sorted[0];
          if (top?.id) {
            const { error: uErr } = await supabase
              .from('material_workbooks')
              .update({ status: 'locked', updated_at: new Date().toISOString() })
              .eq('id', top.id)
              .eq('status', 'working');
            if (uErr) throw uErr;
          }
          const { data: allWbs2, error: e2 } = await supabase
            .from('material_workbooks')
            .select('id, quote_id, status, version_number')
            .eq('job_id', job.id);
          if (cancelled || e2) return;
          wbsForQ = (allWbs2 || []).filter((w: any) => w.quote_id === qid);
          hasWorking = wbsForQ.some((w: any) => w.status === 'working');
          hasLocked = wbsForQ.some((w: any) => w.status === 'locked');
        }

        if (hasLocked && !hasWorking) {
          await createWorkingFromLatestLocked({ silent: true });
        }

        // Re-read and prune to a clean "locked + working" pair for this signed contract.
        const { data: allWbs3, error: e3 } = await supabase
          .from('material_workbooks')
          .select('*')
          .eq('job_id', job.id)
          .eq('quote_id', qid);
        if (cancelled || e3) return;
        await pruneContractWorkbookPair(qid, allWbs3 || []);
      } catch (e: any) {
        console.error('ensureContractWorkbookPair:', e);
        toast.error(e?.message || 'Could not prepare signed-contract workbooks.');
      } finally {
        if (!cancelled) setEnsuringContractWorkbookPair(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- createWorkingFromLatestLocked/loadWorkbook are stable for this intent; avoid re-running on every render
  }, [signedContractWorkbookPairKey, effectiveQuoteId, job.id]);

  function handleSheetChange(sheetId: string) {
    setActiveSheetId(sheetId);
  }

  function togglePackageSelectionMode() {
    setPackageSelectionMode(!packageSelectionMode);
    setSelectedMaterialsForPackageAdd(new Set());
  }

  function toggleBulkMoveMode() {
    setBulkMoveMode(!bulkMoveMode);
    setSelectedMaterialsForMove(new Set());
  }

  function toggleMaterialForMove(materialId: string) {
    const newSet = new Set(selectedMaterialsForMove);
    if (newSet.has(materialId)) {
      newSet.delete(materialId);
    } else {
      newSet.add(materialId);
    }
    setSelectedMaterialsForMove(newSet);
  }

  /**
   * Toggle every material in a section/category for the bulk-move selection.
   * If at least one item in the category is unselected, this selects ALL of
   * them; otherwise it deselects all of them. Used by the "Select all" button
   * in each category header when bulk-move mode is on.
   */
  function toggleCategoryForMove(catGroup: CategoryGroup) {
    const ids = catGroup.items.map((i) => i.id);
    if (ids.length === 0) return;
    const newSet = new Set(selectedMaterialsForMove);
    const allSelected = ids.every((id) => newSet.has(id));
    if (allSelected) {
      ids.forEach((id) => newSet.delete(id));
    } else {
      ids.forEach((id) => newSet.add(id));
    }
    setSelectedMaterialsForMove(newSet);
  }

  function openBulkMoveDialog() {
    if (selectedMaterialsForMove.size === 0) {
      toast.error('Please select at least one material');
      return;
    }
    setBulkMoveTargetSheetId(activeSheetId || '');
    setBulkMoveTargetCategory('');
    setShowBulkMoveDialog(true);
  }

  async function bulkMoveMaterials() {
    if (isWorkbookReadOnly) {
      toast.error('This workbook is read-only.');
      return;
    }
    if (!bulkMoveTargetSheetId) {
      toast.error('Please select a target sheet');
      return;
    }

    if (!bulkMoveTargetCategory.trim()) {
      toast.error('Please enter a category');
      return;
    }

    if (selectedMaterialsForMove.size === 0) {
      toast.error('No materials selected');
      return;
    }

    setMovingBulkMaterials(true);

    try {
      // Save current scroll position
      scrollPositionRef.current = window.scrollY;

      const materialIds = Array.from(selectedMaterialsForMove);

      const { error } = await supabase
        .from('material_items')
        .update({
          sheet_id: bulkMoveTargetSheetId,
          category: bulkMoveTargetCategory.trim(),
          updated_at: new Date().toISOString(),
        })
        .in('id', materialIds);

      if (error) throw error;

      toast.success(`Moved ${materialIds.length} material${materialIds.length !== 1 ? 's' : ''} successfully`);
      setShowBulkMoveDialog(false);
      setBulkMoveMode(false);
      setSelectedMaterialsForMove(new Set());
      
      // Reload to reflect changes
      await loadWorkbook();

      // Restore scroll position after reload
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollPositionRef.current, behavior: 'instant' });
      });
    } catch (error: any) {
      console.error('Error moving materials:', error);
      toast.error(`Failed to move materials: ${error.message || 'Unknown error'}`);
    } finally {
      setMovingBulkMaterials(false);
    }
  }

  function toggleMaterialForPackageAdd(materialId: string) {
    const newSet = new Set(selectedMaterialsForPackageAdd);
    if (newSet.has(materialId)) {
      newSet.delete(materialId);
    } else {
      newSet.add(materialId);
    }
    setSelectedMaterialsForPackageAdd(newSet);
  }

  function openAddToPackageDialog() {
    if (selectedMaterialsForPackageAdd.size === 0) {
      toast.error('Please select at least one material');
      return;
    }
    setTargetPackageId('');
    setShowAddToPackageDialog(true);
  }

  async function addSelectedMaterialsToSelectedPackage() {
    if (isWorkbookReadOnly) {
      toast.error('This workbook is read-only.');
      return;
    }
    if (!targetPackageId) {
      toast.error('Please select a package');
      return;
    }

    if (selectedMaterialsForPackageAdd.size === 0) {
      toast.error('No materials selected');
      return;
    }

    setAddingMaterialsToPackage(true);

    try {
      console.log('Adding materials to package:', {
        packageId: targetPackageId,
        materialCount: selectedMaterialsForPackageAdd.size,
      });
      
      // Get existing materials in the target package
      const targetPackage = packages.find(p => p.id === targetPackageId);
      const existingMaterialIds = new Set(
        targetPackage?.bundle_items?.map((item: any) => item.material_item_id) || []
      );

      // Filter out materials already in the package
      const materialsToAdd = Array.from(selectedMaterialsForPackageAdd).filter(
        id => !existingMaterialIds.has(id)
      );

      console.log('Materials to add after filtering:', materialsToAdd.length);

      if (materialsToAdd.length === 0) {
        toast.error('All selected materials are already in this package');
        setAddingMaterialsToPackage(false);
        return;
      }

      // Add materials to package
      const bundleItems = materialsToAdd.map(materialId => ({
        bundle_id: targetPackageId,
        material_item_id: materialId,
      }));

      const { error } = await supabase
        .from('material_bundle_items')
        .insert(bundleItems);

      if (error) {
        console.error('Error inserting bundle items:', error);
        throw error;
      }
      
      console.log('Successfully added materials to package');

      toast.success(`Added ${materialsToAdd.length} material${materialsToAdd.length !== 1 ? 's' : ''} to package`);
      setShowAddToPackageDialog(false);
      setPackageSelectionMode(false);
      setSelectedMaterialsForPackageAdd(new Set());
      await loadPackages();
    } catch (error: any) {
      console.error('Error adding materials to package:', error);
      toast.error(`Failed to add materials to package: ${error.message || 'Unknown error'}`);
    } finally {
      setAddingMaterialsToPackage(false);
    }
  }

  async function addMaterialToPackage(materialId: string, packageId: string) {
    if (isWorkbookReadOnly) {
      toast.error('This workbook is read-only.');
      return;
    }
    try {
      // Save current scroll position
      scrollPositionRef.current = window.scrollY;

      // Check if already in package
      const targetPackage = packages.find(p => p.id === packageId);
      const existingMaterialIds = new Set(
        targetPackage?.bundle_items?.map((item: any) => item.material_item_id) || []
      );

      if (existingMaterialIds.has(materialId)) {
        toast.error('Material is already in this package');
        return;
      }

      const { error } = await supabase
        .from('material_bundle_items')
        .insert({
          bundle_id: packageId,
          material_item_id: materialId,
        });

      if (error) throw error;

      toast.success('Added to package');
      await loadPackages();

      // Restore scroll position
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollPositionRef.current, behavior: 'instant' });
      });
    } catch (error: any) {
      console.error('Error adding material to package:', error);
      toast.error('Failed to add to package');
    }
  }

  async function removeMaterialFromPackage(materialId: string, packageId: string) {
    if (isWorkbookReadOnly) {
      toast.error('This workbook is read-only.');
      return;
    }
    try {
      // Save current scroll position
      scrollPositionRef.current = window.scrollY;

      const { error } = await supabase
        .from('material_bundle_items')
        .delete()
        .eq('bundle_id', packageId)
        .eq('material_item_id', materialId);

      if (error) throw error;

      toast.success('Removed from package');
      await loadPackages();

      // Restore scroll position
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollPositionRef.current, behavior: 'instant' });
      });
    } catch (error: any) {
      console.error('Error removing material from package:', error);
      toast.error('Failed to remove from package');
    }
  }

  /**
   * Parse length string to decimal feet for lineal-foot pricing (e.g. metal/Omni panels).
   * Supports: "27' 11\"", "27.9167", "12' 6\"", "12'", "10".
   * Returns null if not parseable or not a feet/inches value.
   */
  function parseLengthToFeet(length: string | null | undefined): number | null {
    if (length == null || String(length).trim() === '') return null;
    const s = String(length).trim();
    // Feet and inches: 27' 11" or 12' 6" or 27'
    const ftInMatch = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*[""]?\s*)?$/);
    if (ftInMatch) {
      const feet = parseFloat(ftInMatch[1]);
      const inches = ftInMatch[2] != null ? parseFloat(ftInMatch[2]) : 0;
      if (!Number.isFinite(feet)) return null;
      return feet + (Number.isFinite(inches) ? inches / 12 : 0);
    }
    // Plain decimal (already in feet)
    const num = parseFloat(s);
    if (Number.isFinite(num) && num >= 0) return num;
    return null;
  }

  /**
   * For extended cost/price: total = piece price × quantity.
   * Metal (lineal-foot): piece = price_per_unit × length, so multiplier = length × quantity.
   * Other items with length (e.g. trim): piece price is price_per_unit, so multiplier = quantity only.
   * Items without length: multiplier = quantity.
   */
  function getEffectiveMultiplierForExtended(item: MaterialItem, lengthOverride?: string | null, quantityOverride?: number): number {
    const len = lengthOverride !== undefined ? lengthOverride : item.length;
    const lengthFeet = parseLengthToFeet(len);
    const qty = quantityOverride !== undefined ? quantityOverride : item.quantity;
    const nq = Number(qty) || 1;
    if (lengthFeet != null && lengthFeet > 0) {
      // Metal (lineal-foot): total = (price per ft × length) × qty → multiplier = length × qty
      if (item.category === 'Metal') return lengthFeet * nq;
      // Trim / other with length: piece price = price_per_unit; total = piece × qty → multiplier = qty
      return nq;
    }
    return nq;
  }

  /** Display extended cost/price = piece × quantity (so totals match the table). Metal: workbook $/ft overrides catalog. */
  function getDisplayExtended(item: MaterialItem): { cost: number; price: number } {
    const qty = Number(item.quantity) || 1;
    const lengthFeetMetal = item.category === 'Metal' ? parseLengthToFeet(item.length) : null;
    let pieceCost: number | null = null;
    let piecePrice: number | null = null;

    if (item.category === 'Metal' && lengthFeetMetal != null && lengthFeetMetal > 0) {
      const cFt = getMetalCostPerFootDisplay(item);
      const pFt = getMetalPricePerFootDisplay(item);
      if (cFt != null) pieceCost = cFt * lengthFeetMetal;
      if (pFt != null) piecePrice = pFt * lengthFeetMetal;
    } else {
      // Non-metal rows are piece-priced: per-piece cost/price is the unit value, and totals are unit × quantity.
      pieceCost = item.cost_per_unit != null ? item.cost_per_unit : null;
      piecePrice = item.price_per_unit != null ? item.price_per_unit : null;
    }
    return {
      cost: pieceCost != null ? pieceCost * qty : (item.extended_cost ?? 0),
      price: piecePrice != null ? piecePrice * qty : (item.extended_price ?? 0),
    };
  }

  function isMaterialInAnyPackage(materialId: string): boolean {
    return packages.some(pkg => 
      pkg.bundle_items?.some((item: any) => item.material_item_id === materialId)
    );
  }

  function getMaterialPackageNames(materialId: string): string[] {
    return packages
      .filter(pkg => 
        pkg.bundle_items?.some((item: any) => item.material_item_id === materialId)
      )
      .map(pkg => pkg.name);
  }

  function groupByCategory(items: MaterialItem[], categoryOrder?: string[] | null): CategoryGroup[] {
    // Map: category name → { items, minOrderIndex }
    const categoryMap = new Map<string, { items: MaterialItem[]; minOrderIndex: number }>();

    items.forEach(item => {
      const category = item.category || 'Uncategorized';
      if (!categoryMap.has(category)) {
        categoryMap.set(category, { items: [], minOrderIndex: item.order_index ?? Infinity });
      }
      const entry = categoryMap.get(category)!;
      entry.items.push(item);
      // Track the earliest order_index so we can sort categories in workbook order
      entry.minOrderIndex = Math.min(entry.minOrderIndex, item.order_index ?? Infinity);
    });

    const groups = Array.from(categoryMap.entries())
      .map(([category, { items, minOrderIndex }]) => ({
        category,
        items: items.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
        minOrderIndex,
      }));

    if (categoryOrder && categoryOrder.length > 0) {
      // User-defined order: known categories first (in their saved order), unknowns appended by minOrderIndex
      const orderMap = new Map(categoryOrder.map((name, idx) => [name, idx]));
      return groups.sort((a, b) => {
        const ai = orderMap.has(a.category) ? orderMap.get(a.category)! : Infinity;
        const bi = orderMap.has(b.category) ? orderMap.get(b.category)! : Infinity;
        if (ai !== bi) return ai - bi;
        // Both unknown → fall back to workbook order
        return (a as any).minOrderIndex - (b as any).minOrderIndex;
      });
    }

    // Default: sort categories by the position they first appear in the workbook
    return groups.sort((a, b) => (a as any).minOrderIndex - (b as any).minOrderIndex);
  }

  /** Group by package name (priority) or sheet name for unbundled. Package takes priority; no package = group under sheet name. */
  function groupByPackageOrSheet(items: MaterialItem[], sheetName: string): CategoryGroup[] {
    const groupMap = new Map<string, MaterialItem[]>();
    const fallbackGroup = sheetName || 'Sheet';

    items.forEach(item => {
      const packageNames = getMaterialPackageNames(item.id);
      const key = packageNames.length > 0 ? packageNames[0]! : fallbackGroup;
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(item);
    });

    const groups = Array.from(groupMap.entries())
      .map(([category, items]) => ({
        category,
        items: items.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
      }));

    // Package groups first (alphabetically), then the sheet-name group (unbundled) last
    return groups.sort((a, b) => {
      const aIsSheet = a.category === fallbackGroup;
      const bIsSheet = b.category === fallbackGroup;
      if (aIsSheet && !bIsSheet) return 1;
      if (!aIsSheet && bIsSheet) return -1;
      return a.category.localeCompare(b.category);
    });
  }

  function calculateMarkupPercent(cost: number | null, price: number | null): number {
    if (!cost || !price || cost === 0) return 0;
    return ((price - cost) / cost) * 100;
  }

  /** True if this category has items priced by lineal foot (have length). */
  function categoryHasLinealFootPricing(catGroup: CategoryGroup): boolean {
    return catGroup.items.some((i) => parseLengthToFeet(i.length) != null && parseLengthToFeet(i.length)! > 0);
  }

  /** Get cost/price per foot for category header. Metal: prefer workbook (item) per-ft when set; else materials_catalog by SKU. */
  function getCategoryFootPrice(catGroup: CategoryGroup): { costPerFoot: number | null; pricePerFoot: number | null } {
    const linealItems = catGroup.items.filter((i) => {
      const feet = parseLengthToFeet(i.length);
      return feet != null && feet > 0;
    });
    const withLength = linealItems[0];
    if (!withLength) return { costPerFoot: null, pricePerFoot: null };

    if (catGroup.category === 'Metal') {
      const fromItem = linealItems.find((i) => i.cost_per_unit != null || i.price_per_unit != null);
      if (fromItem && (fromItem.cost_per_unit != null || fromItem.price_per_unit != null)) {
        return {
          costPerFoot: fromItem.cost_per_unit ?? null,
          pricePerFoot: fromItem.price_per_unit ?? null,
        };
      }
      if (withLength.sku && metalCatalogBySku[withLength.sku]) {
        const cat = metalCatalogBySku[withLength.sku];
        return {
          costPerFoot: cat.purchase_cost > 0 ? cat.purchase_cost : null,
          pricePerFoot: cat.unit_price > 0 ? cat.unit_price : null,
        };
      }
    }
    const hasItemPrices = withLength.cost_per_unit != null || withLength.price_per_unit != null;
    if (hasItemPrices) {
      return {
        costPerFoot: withLength.cost_per_unit ?? null,
        pricePerFoot: withLength.price_per_unit ?? null,
      };
    }
    return {
      costPerFoot: withLength.cost_per_unit ?? null,
      pricePerFoot: withLength.price_per_unit ?? null,
    };
  }

  /**
   * Catalog PLF for Metal when the row has no per-ft price on the item (import-only).
   * If cost_per_unit / price_per_unit are set on the item, returns null so UI uses workbook values and allows edits when unlocked.
   */
  function getMetalPlf(item: MaterialItem): { costPerFoot: number; pricePerFoot: number } | null {
    if (item.category !== 'Metal' || !item.sku) return null;
    if (item.cost_per_unit != null || item.price_per_unit != null) return null;
    const cat = metalCatalogBySku[item.sku];
    if (!cat || (cat.purchase_cost === 0 && cat.unit_price === 0)) return null;
    return {
      costPerFoot: cat.purchase_cost,
      pricePerFoot: cat.unit_price,
    };
  }

  /** Effective $/ft for display (workbook overrides catalog when present). */
  function getMetalCostPerFootDisplay(item: MaterialItem): number | null {
    if (item.category !== 'Metal') return null;
    if (item.cost_per_unit != null) return Number(item.cost_per_unit);
    return getMetalPlf(item)?.costPerFoot ?? null;
  }

  function getMetalPricePerFootDisplay(item: MaterialItem): number | null {
    if (item.category !== 'Metal') return null;
    if (item.price_per_unit != null) return Number(item.price_per_unit);
    return getMetalPlf(item)?.pricePerFoot ?? null;
  }

  /** Apply new cost/price per foot to all lineal-foot items in this category; persist and update workbook. Metal: if only cost is entered, default price = cost + $0.10; if only price, default cost = price − $0.10; if both entered, use both. */
  async function applyCategoryFootPrice(catGroup: CategoryGroup, costPerFoot: number | null, pricePerFoot: number | null) {
    if (isWorkbookReadOnly) {
      toast.error('This workbook is read-only.');
      return;
    }
    const linealItems = catGroup.items.filter((i) => {
      const feet = parseLengthToFeet(i.length);
      return feet != null && feet > 0;
    });
    if (linealItems.length === 0) return;
    const current = getCategoryFootPrice(catGroup);
    const explicitCost = costPerFoot != null && Number.isFinite(costPerFoot);
    const explicitPrice = pricePerFoot != null && Number.isFinite(pricePerFoot);
    let safeCost =
      explicitCost
        ? Math.round(costPerFoot! * 10000) / 10000
        : (current.costPerFoot != null ? Math.round(current.costPerFoot * 10000) / 10000 : null);
    let safePrice =
      explicitPrice
        ? Math.round(pricePerFoot! * 10000) / 10000
        : (current.pricePerFoot != null ? Math.round(current.pricePerFoot * 10000) / 10000 : null);
    if (catGroup.category === 'Metal') {
      if (explicitCost && !explicitPrice && safeCost != null) {
        safePrice = Math.round((safeCost + 0.1) * 10000) / 10000;
      } else if (!explicitCost && explicitPrice && safePrice != null) {
        safeCost = Math.round((safePrice - 0.1) * 10000) / 10000;
      }
    }
    if (safeCost == null && safePrice == null) {
      toast.error('Enter cost and/or price per lineal foot.');
      return;
    }
    const safeMarkup =
      safeCost != null && safePrice != null && safeCost > 0
        ? Math.round(((safePrice - safeCost) / safeCost) * 100 * 10000) / 10000
        : null;
    const updates: Array<{ id: string; extended_cost: number | null; extended_price: number | null }> = [];
    for (const item of linealItems) {
      const lengthFeet = parseLengthToFeet(item.length) ?? 0;
      const qty = Number(item.quantity) || 1;
      const mult = catGroup.category === 'Metal' ? lengthFeet * qty : getEffectiveMultiplierForExtended(item);
      const extended_cost = safeCost != null && mult ? Math.round(mult * safeCost * 10000) / 10000 : null;
      const extended_price = safePrice != null && mult ? Math.round(mult * safePrice * 10000) / 10000 : null;
      updates.push({ id: item.id, extended_cost, extended_price });
      const { error } = await supabase
        .from('material_items')
        .update({
          cost_per_unit: safeCost,
          price_per_unit: safePrice,
          markup_percent: safeMarkup,
          extended_cost,
          extended_price,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id);
      if (error) {
        toast.error(`Failed to update ${item.material_name}: ${error.message}`);
        return;
      }
    }
    setCategoryFootPriceEdit(null);
    if (workbook) {
      const updatedWorkbook = {
        ...workbook,
        sheets: workbook.sheets.map((sheet) => ({
          ...sheet,
          items: sheet.items.map((i) => {
            const u = updates.find((x) => x.id === i.id);
            if (!u) return i;
            return {
              ...i,
              cost_per_unit: safeCost,
              price_per_unit: safePrice,
              markup_percent: safeMarkup,
              extended_cost: u.extended_cost,
              extended_price: u.extended_price,
            };
          }),
        })),
      };
      setWorkbook(updatedWorkbook);
      const cacheKey = `${job.id}:${effectiveQuoteId ?? null}`;
      const existing = workbookCache.get(cacheKey);
      if (existing) workbookCache.set(cacheKey, { ...existing, workbook: updatedWorkbook, cachedAt: Date.now() });
    }
    toast.success(`Updated ${updates.length} metal panel(s) to $${safeCost?.toFixed(2) ?? '—'}/ft cost, $${safePrice?.toFixed(2) ?? '—'}/ft price.`);
    window.dispatchEvent(
      new CustomEvent('materials-workbook-updated', { detail: { quoteId: effectiveQuoteId ?? null, jobId: job.id } })
    );
  }

  function startCellEdit(itemId: string, field: string, currentValue: any) {
    if (isWorkbookReadOnly) return;
    setEditingCell({ itemId, field });
    setCellValue(currentValue?.toString() || '');
  }

  async function saveCellEdit(item: MaterialItem) {
    if (!editingCell) return;
    if (!workbook || isWorkbookQuoteMismatch(workbook.quote_id, effectiveQuoteId, jobQuotes)) {
      toast.error('Cannot save: materials workbook does not match the selected proposal.');
      cancelCellEdit();
      return;
    }

    try {
      const { field } = editingCell;
      let value: any = cellValue;

      if (['quantity', 'cost_per_unit', 'price_per_unit'].includes(field)) {
        value = parseFloat(cellValue) || null;
      } else if (field === 'usage' || field === 'length' || field === 'color') {
        value = (typeof cellValue === 'string' ? cellValue.trim() : cellValue) || null;
      } else if (field === 'markup_percent') {
        const percentValue = parseFloat(cellValue);
        if (isNaN(percentValue)) {
          toast.error('Please enter a valid number');
          cancelCellEdit();
          return;
        }
        const decimalValue = percentValue / 100;
        if (decimalValue > 9.9999) {
          toast.error('Markup cannot exceed 999.99%');
          cancelCellEdit();
          return;
        }
        value = decimalValue;
      }

      const updateData: any = {
        [field]: value,
        updated_at: new Date().toISOString(),
      };

      // After-edit values for quantity, length, cost, price (for recalc)
      const newQty = field === 'quantity' ? value : item.quantity;
      const newLength = field === 'length' ? value : item.length;
      const newCost = field === 'cost_per_unit' ? value : item.cost_per_unit;
      const newPrice = field === 'price_per_unit' ? value : item.price_per_unit;
      let mult = getEffectiveMultiplierForExtended(item, newLength, newQty);
      if (item.category === 'Metal') {
        const lengthFeet = parseLengthToFeet(newLength);
        if (lengthFeet != null && lengthFeet > 0) mult = lengthFeet * (Number(newQty) || 1);
      }

      // Recalc both extended cost and extended price whenever any of quantity, length, cost/price per unit change (so cost and price stay in sync for lineal-foot items)
      const recalcExtended = ['quantity', 'cost_per_unit', 'price_per_unit', 'length'].includes(field);
      if (recalcExtended) {
        updateData.extended_cost = newCost != null && mult ? Math.round(mult * newCost * 10000) / 10000 : null;
        updateData.extended_price = newPrice != null && mult ? Math.round(mult * newPrice * 10000) / 10000 : null;
      }

      if (field === 'markup_percent') {
        const baseCost =
          item.cost_per_unit != null && item.cost_per_unit > 0
            ? Number(item.cost_per_unit)
            : item.category === 'Metal'
              ? getMetalPlf(item)?.costPerFoot ?? null
              : null;
        if (baseCost != null && baseCost > 0) {
          const newPricePerUnit = baseCost * (1 + value);
          updateData.price_per_unit = newPricePerUnit;
          if (item.category === 'Metal' && item.cost_per_unit == null) {
            updateData.cost_per_unit = baseCost;
          }
          updateData.extended_price = newPricePerUnit != null && mult ? Math.round(mult * newPricePerUnit * 10000) / 10000 : null;
          updateData.extended_cost = mult ? Math.round(mult * baseCost * 10000) / 10000 : null;
        }
      }

      scrollPositionRef.current = window.scrollY;
      setEditingCell(null);
      setCellValue('');

      // Optimistic update — apply to local state and cache immediately
      if (workbook) {
        const updatedWorkbook = {
          ...workbook,
          sheets: workbook.sheets.map(sheet => ({
            ...sheet,
            items: sheet.items.map(i => i.id === item.id ? { ...i, ...updateData } : i),
          })),
        };
        setWorkbook(updatedWorkbook);
        // Keep cache in sync so switching away and back shows current data
        const cacheKey = `${job.id}:${effectiveQuoteId ?? null}`;
        const existing = workbookCache.get(cacheKey);
        if (existing) {
          workbookCache.set(cacheKey, { ...existing, workbook: updatedWorkbook, cachedAt: Date.now() });
        }
      }

      const { error } = await supabase
        .from('material_items')
        .update(updateData)
        .eq('id', item.id);

      if (error) {
        toast.error(`Failed to update ${field}: ${error.message}`);
        // Reload on error to revert optimistic update
        workbookCache.delete(`${job.id}:${effectiveQuoteId ?? null}`);
        await loadWorkbook();
      } else {
        // Notify proposal panel to refresh totals in real time
        window.dispatchEvent(new CustomEvent('materials-workbook-updated', { detail: { quoteId: effectiveQuoteId ?? null, jobId: job.id } }));
      }

      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollPositionRef.current, behavior: 'instant' });
      });

    } catch (error: any) {
      console.error('Error in saveCellEdit:', error);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
      toast.error(`Failed to save: ${error?.message || 'Unknown error'}`);
      await loadWorkbook();
    }
  }

  function cancelCellEdit() {
    setEditingCell(null);
    setCellValue('');
  }

  async function updateStatus(itemId: string, newStatus: string) {
    if (isWorkbookReadOnly) {
      toast.error('Cannot update order status while this workbook is read-only.');
      return;
    }
    try {
      // Save current scroll position
      scrollPositionRef.current = window.scrollY;

      // Optimistic update
      if (workbook) {
        const updatedWorkbook = {
          ...workbook,
          sheets: workbook.sheets.map(sheet => ({
            ...sheet,
            items: sheet.items.map(i => 
              i.id === itemId 
                ? { ...i, status: newStatus, updated_at: new Date().toISOString() }
                : i
            ),
          })),
        };
        setWorkbook(updatedWorkbook);
      }

      const { error } = await supabase
        .from('material_items')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId);

      if (error) throw error;

      // Restore scroll position
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollPositionRef.current, behavior: 'instant' });
      });
    } catch (error: any) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status');
      await loadWorkbook();
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'ordered':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'received':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'pull_from_shop':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'ready_for_job':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'at_job':
        return 'bg-teal-100 text-teal-800 border-gray-200';
      case 'not_ordered':
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  }

  function formatStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      not_ordered: 'Not ordered',
      ordered: 'Ordered',
      received: 'Received',
      pull_from_shop: 'Pull from shop',
      ready_for_job: 'Ready for job',
      at_job: 'At job',
    };
    return labels[status] || status.replace(/_/g, ' ');
  }

  async function deleteItem(itemId: string) {
    if (isWorkbookReadOnly) {
      toast.error('This workbook is read-only.');
      return;
    }
    if (!confirm('Delete this material?')) return;

    try {
      // Save current scroll position
      scrollPositionRef.current = window.scrollY;

      // Optimistic update
      if (workbook) {
        const updatedWorkbook = {
          ...workbook,
          sheets: workbook.sheets.map(sheet => ({
            ...sheet,
            items: sheet.items.filter(i => i.id !== itemId),
          })),
        };
        setWorkbook(updatedWorkbook);
      }

      const { error } = await supabase
        .from('material_items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;
      toast.success('Material deleted');
      window.dispatchEvent(new CustomEvent('materials-workbook-updated', { detail: { quoteId: effectiveQuoteId ?? null, jobId: job.id } }));

      // Restore scroll position
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollPositionRef.current, behavior: 'instant' });
      });
    } catch (error: any) {
      console.error('Error deleting item:', error);
      toast.error('Failed to delete material');
      await loadWorkbook();
    }
  }

  function openMoveItem(item: MaterialItem) {
    setMovingItem(item);
    setMoveToSheetId(item.sheet_id);
    setMoveToCategory(item.category);
    setShowMoveDialog(true);
  }

  async function moveItem() {
    if (!movingItem) return;

    try {
      // Save current scroll position
      scrollPositionRef.current = window.scrollY;

      const { error } = await supabase
        .from('material_items')
        .update({
          sheet_id: moveToSheetId,
          category: moveToCategory,
          updated_at: new Date().toISOString(),
        })
        .eq('id', movingItem.id);

      if (error) throw error;
      toast.success('Material moved');
      setShowMoveDialog(false);
      setMovingItem(null);
      window.dispatchEvent(new CustomEvent('materials-workbook-updated', { detail: { quoteId: effectiveQuoteId ?? null, jobId: job.id } }));
      
      // Reload to reflect move across sheets
      await loadWorkbook();

      // Restore scroll position after reload
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollPositionRef.current, behavior: 'instant' });
      });
    } catch (error: any) {
      console.error('Error moving item:', error);
      toast.error('Failed to move material');
    }
  }

  async function loadCatalogMaterials() {
    try {
      setLoadingCatalog(true);
      
      const { data, error } = await supabase
        .from('materials_catalog')
        .select('*')
        .order('category')
        .order('material_name');

      if (error) throw error;

      setCatalogMaterials(data || []);
      
      // Extract unique categories
      const uniqueCategories = [...new Set(data?.map(m => m.category).filter(Boolean))] as string[];
      setCatalogCategories(uniqueCategories.sort());
    } catch (error: any) {
      console.error('Error loading catalog:', error);
      toast.error('Failed to load materials catalog');
    } finally {
      setLoadingCatalog(false);
    }
  }

  function catalogItemKey(item: any) {
    return `${item.sku ?? ''}|${item.material_name ?? ''}`;
  }

  /** Read cost (purchase) and price (selling) from Zoho/catalog. Cost → cost_per_unit, price → price_per_unit.
   * When only one value exists, use it for both so the workbook gets both columns. */
  function getCatalogCostAndPrice(item: any): { cost: number; price: number } {
    if (!item) return { cost: 0, price: 0 };
    const raw = item.raw_metadata ?? item;
    const num = (v: any) => {
      const n = Number(v);
      return typeof n === 'number' && !isNaN(n) ? n : 0;
    };
    // Cost: purchase_cost / purchase_rate / cost_price / cost (from Zoho Books)
    let cost = num(item.purchase_cost) || num(raw.purchase_cost) || num(raw.purchase_rate) || num(raw.cost_price) || num(raw.cost);
    // Price: unit_price / rate / selling_price / sales_rate / price (from Zoho Books)
    let price = num(item.unit_price) || num(raw.unit_price) || num(raw.rate) || num(raw.selling_price) || num(raw.sales_rate) || num(raw.price);
    // When only one value is present, use it for both
    if (cost > 0 && price === 0) price = cost;
    if (price > 0 && cost === 0) cost = price;
    return { cost, price };
  }

  function toggleCatalogMaterialSelection(catalogItem: any) {
    const key = catalogItemKey(catalogItem);
    setSelectedCatalogMaterials(prev => {
      const exists = prev.some(p => catalogItemKey(p) === key);
      if (exists) return prev.filter(p => catalogItemKey(p) !== key);
      return [...prev, catalogItem];
    });
  }

  function isCatalogMaterialSelected(catalogItem: any) {
    const key = catalogItemKey(catalogItem);
    return selectedCatalogMaterials.some(p => catalogItemKey(p) === key);
  }

  async function addMaterialsFromCatalogSelection() {
    if (isWorkbookReadOnly) {
      toast.error('This workbook is read-only.');
      return;
    }
    if (selectedCatalogMaterials.length === 0) {
      toast.error('Select at least one material');
      return;
    }
    if (!activeSheetId) {
      toast.error('No sheet selected');
      return;
    }
    if (!addToCategory.trim()) {
      toast.error('Choose an "Add to category" for the materials');
      return;
    }
    setAddingCatalogBatch(true);
    try {
      let orderIndex = 0;
      const { data: maxData } = await supabase
        .from('material_items')
        .select('order_index')
        .eq('sheet_id', activeSheetId)
        .eq('category', addToCategory.trim())
        .order('order_index', { ascending: false })
        .limit(1)
        .maybeSingle();
      orderIndex = (maxData?.order_index ?? -1) + 1;

      const quantity = Math.max(0.01, parseFloat(catalogAddQuantity) || 1);
      const colorValue = catalogAddColor.trim() || null;

      for (const item of selectedCatalogMaterials) {
        const { cost, price } = getCatalogCostAndPrice(item);
        const costNum = typeof cost === 'number' && !isNaN(cost) ? cost : null;
        const priceNum = typeof price === 'number' && !isNaN(price) ? price : null;
        const markupDecimal = (costNum != null && costNum > 0 && priceNum != null)
          ? (priceNum - costNum) / costNum
          : 0;
        const partLengthFeet = parseLengthToFeet(item.part_length ?? null);
        const catalogMult = partLengthFeet != null && partLengthFeet > 0 ? partLengthFeet : quantity;
        const extendedCost = costNum != null ? Math.round(costNum * catalogMult * 10000) / 10000 : null;
        const extendedPrice = priceNum != null ? Math.round(priceNum * catalogMult * 10000) / 10000 : null;

        const { error } = await supabase
          .from('material_items')
          .insert({
            sheet_id: activeSheetId,
            category: addToCategory.trim(),
            usage: null,
            sku: item.sku ?? null,
            material_name: item.material_name ?? 'Unnamed',
            quantity,
            length: item.part_length ?? null,
            color: colorValue,
            cost_per_unit: costNum,
            markup_percent: markupDecimal,
            price_per_unit: priceNum,
            extended_cost: extendedCost,
            extended_price: extendedPrice,
            taxable: true,
            notes: null,
            order_index: orderIndex++,
            status: 'not_ordered',
            trim_saved_config_id: item.default_trim_saved_config_id ?? null,
          });
        if (error) throw error;
      }

      toast.success(`Added ${selectedCatalogMaterials.length} material(s) to ${activeSheet?.sheet_name}`);
      setSelectedCatalogMaterials([]);
      setCatalogAddQuantity('1');
      setCatalogAddColor('');
      window.dispatchEvent(new CustomEvent('materials-workbook-updated', { detail: { quoteId: effectiveQuoteId ?? null, jobId: job.id } }));
      await loadWorkbook();
      setShowAddDialog(false);
    } catch (error: any) {
      console.error('Error adding materials from catalog:', error);
      toast.error('Failed to add materials: ' + (error?.message ?? 'Unknown error'));
    } finally {
      setAddingCatalogBatch(false);
    }
  }

  function selectMaterialFromCatalog(catalogItem: any) {
    // Auto-fill form with catalog data - use Zoho Books cost/price (correct columns: cost → cost_per_unit, price → price_per_unit)
    const { cost, price } = getCatalogCostAndPrice(catalogItem);
    
    // Calculate markup percentage from Zoho Books prices (for display/reference only)
    let calculatedMarkup = '';
    if (cost > 0 && price > 0) {
      const markupPercent = ((price - cost) / cost) * 100;
      calculatedMarkup = markupPercent.toFixed(1);
    }

    setNewMaterialName(catalogItem.material_name);
    setNewSku(catalogItem.sku || '');
    setNewLength(catalogItem.part_length || '');
    setNewColor(''); // Color not in catalog, user can enter manually
    setNewCostPerUnit(cost.toString());
    setNewPricePerUnit(price.toString()); // Use Zoho Books price directly
    setNewMarkup(calculatedMarkup); // Display calculated markup (reference only)
    setAddToCategory(catalogItem.category || addToCategory);
    
    setAddMaterialDialogMode('custom'); // Switch to custom form so user can edit and click Add Material
    setShowDatabaseSearch(true);
    setCatalogSearchQuery('');
    toast.success(`Material "${catalogItem.material_name}" loaded — edit if needed and click Add Material`);
  }

  function openZohoOrderDialogForMaterial(item: MaterialItem) {
    if (!canUseShopTrimAndZohoOnThisWorkbook) {
      toast.error('Zoho orders are only available on the job workbook or the proposal workbook.');
      return;
    }
    setSelectedMaterialsForOrder([item]);
    setShowZohoOrderDialog(true);
  }

  function openZohoOrderDialogForCategory(categoryItems: MaterialItem[]) {
    if (!canUseShopTrimAndZohoOnThisWorkbook) {
      toast.error('Zoho orders are only available on the job workbook or the proposal workbook.');
      return;
    }
    if (categoryItems.length === 0) {
      toast.error('No materials to order');
      return;
    }
    setSelectedMaterialsForOrder(categoryItems);
    setShowZohoOrderDialog(true);
  }

  function openAddDialog(categoryName?: string) {
    setAddToCategory(categoryName || '');
    setNewMaterialName('');
    setNewUsage('');
    setNewSku('');
    setNewQuantity('1');
    setNewLength('');
    setNewColor('');
    setNewCostPerUnit('');
    setNewPricePerUnit(''); // Reset price from catalog
    setNewMarkup(''); // Reset markup (no default)
    setNewNotes('');
    setAddMaterialDialogMode('search'); // Default: Search Database
    setShowDatabaseSearch(true);
    setCatalogSearchQuery('');
    setCatalogSearchCategory('all');
    setSelectedCatalogMaterials([]);
    setCatalogAddQuantity('1');
    setCatalogAddColor('');
    setShowAddDialog(true);
    loadCatalogMaterials();
  }

  /** Get or create the dedicated change order proposal (quote + workbook) for this job. */
  async function getOrCreateChangeOrderWorkbook(): Promise<{
    quoteId: string;
    workbookId: string;
    quote: {
      sent_at: string | null;
      locked_for_editing: boolean | null;
      signed_version?: unknown;
      customer_signed_at?: string | null;
    };
  }> {
    const { data: changeOrderQuotes } = await fetchChangeOrderQuoteForJob(supabase, job.id);
    let quoteId: string;
    let quote: {
      sent_at: string | null;
      locked_for_editing: boolean | null;
      signed_version?: unknown;
      customer_signed_at?: string | null;
    };
    if (changeOrderQuotes?.length) {
      quoteId = String(changeOrderQuotes[0].id ?? '');
      if (!quoteId) throw new Error('Change order quote is missing an id');
      quote = {
        sent_at: changeOrderQuotes[0].sent_at ?? null,
        locked_for_editing: changeOrderQuotes[0].locked_for_editing ?? null,
        signed_version: changeOrderQuotes[0].signed_version,
        customer_signed_at: (changeOrderQuotes[0] as any).customer_signed_at ?? null,
      };
    } else {
      const { data: newQuote, error: quoteErr } = await supabase
        .from('quotes')
        .insert({
          job_id: job.id,
          is_change_order_proposal: true,
          created_by: userId,
        } as Record<string, unknown>)
        .select('id, sent_at')
        .single();
      if (quoteErr || !newQuote) throw new Error(quoteErr?.message ?? 'Failed to create change order proposal');
      quoteId = newQuote.id;
      const { data: freshCo } = await fetchChangeOrderQuoteForJob(supabase, job.id);
      const coRow = freshCo?.[0];
      quote = {
        sent_at: coRow?.sent_at ?? newQuote.sent_at ?? null,
        locked_for_editing: coRow?.locked_for_editing ?? null,
        signed_version: coRow?.signed_version,
        customer_signed_at: coRow?.customer_signed_at ?? null,
      };
    }
    const { data: workbooks } = await supabase
      .from('material_workbooks')
      .select('id')
      .eq('quote_id', quoteId)
      .eq('status', 'working')
      .order('updated_at', { ascending: false })
      .limit(1);
    let workbookId: string;
    if (workbooks?.length) {
      workbookId = workbooks[0].id;
    } else {
      const { data: maxWb } = await supabase
        .from('material_workbooks')
        .select('version_number')
        .eq('job_id', job.id)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVer = (maxWb?.version_number ?? 0) + 1;
      const { data: newWb, error: wbErr } = await supabase
        .from('material_workbooks')
        .insert({ job_id: job.id, quote_id: quoteId, version_number: nextVer, status: 'working', created_by: userId })
        .select('id')
        .single();
      if (wbErr || !newWb) throw new Error(wbErr?.message ?? 'Failed to create change order workbook');
      workbookId = newWb.id;
    }
    return { quoteId, workbookId, quote };
  }

  async function addNewSheet() {
    const isChangeOrder = newSheetType === 'change_order';
    if (isChangeOrder && !jobHasContract) {
      toast.error('Set the main proposal as contract before adding change order sheets.');
      return;
    }
    if (!isChangeOrder) {
      if (isWorkbookReadOnly) {
        toast.error('This workbook is read-only.');
        return;
      }
      if (!workbook) {
        toast.error('Cannot add sheets until the workbook is loaded.');
        return;
      }
    }
    if (!newSheetName.trim()) {
      toast.error('Please enter a sheet name');
      return;
    }

    setAddingSheet(true);

    try {
      let targetWorkbookId: string;
      let orderIndex: number;
      let changeOrderQuoteId: string | null = null;

      if (isChangeOrder) {
        const co = await getOrCreateChangeOrderWorkbook();
        if (isQuoteContractFrozen(co.quote as any)) {
          toast.error('The change order is under contract or office-locked and cannot be edited.');
          return;
        }
        targetWorkbookId = co.workbookId;
        changeOrderQuoteId = co.quoteId;
        const { data: existingSheets } = await supabase
          .from('material_sheets')
          .select('id')
          .eq('workbook_id', targetWorkbookId)
          .order('order_index');
        orderIndex = (existingSheets?.length ?? 0);
      } else {
        targetWorkbookId = workbook!.id;
        const proposalSheets = workbook!.sheets.filter((s: any) => s.sheet_type !== 'change_order');
        orderIndex = proposalSheets.length > 0 ? Math.max(...proposalSheets.map((s: any) => (s.order_index ?? 0)), -1) + 1 : 0;
      }

      const payload: Record<string, unknown> = {
        workbook_id: targetWorkbookId,
        sheet_name: newSheetName.trim(),
        order_index: orderIndex,
      };
      payload.sheet_type = isChangeOrder ? 'change_order' : 'proposal';

      let { data: newSheet, error } = await supabase
        .from('material_sheets')
        .insert(payload)
        .select()
        .single();

      if (error && typeof error.message === 'string' && /sheet_type|does not exist|unknown column/i.test(error.message)) {
        const { sheet_type: _st, ...payloadWithoutType } = payload as Record<string, unknown> & { sheet_type?: string };
        const res = await supabase.from('material_sheets').insert(payloadWithoutType).select().single();
        newSheet = res.data;
        error = res.error;
        if (!error && isChangeOrder) {
          toast.info('Sheet added. Run the migration that adds sheet_type to material_sheets (see Supabase SQL) to use change order sheets.');
        }
      }

      if (error) throw error;

      if (isChangeOrder && newSheet?.id) {
        try {
          const { data: coSheets } = await supabase
            .from('material_sheets')
            .select('id, change_order_seq')
            .eq('workbook_id', targetWorkbookId)
            .eq('sheet_type', 'change_order');
          const others = (coSheets || []).filter((s: any) => s.id !== newSheet.id);
          const maxSeq = others.reduce((m: number, s: any) => Math.max(m, Number(s.change_order_seq) || 0), 0);
          await supabase.from('material_sheets').update({ change_order_seq: maxSeq + 1 }).eq('id', newSheet.id);
        } catch {
          /* change_order_seq column may not exist until migration */
        }
      }

      toast.success(`Sheet "${newSheetName}" added successfully`);
      setShowAddSheetDialog(false);
      setNewSheetName('');
      setNewSheetType('proposal');

      if (isChangeOrder && changeOrderQuoteId) {
        workbookCache.delete(`${job.id}:${changeOrderQuoteId}`);
        const { data: quotes } = await fetchJobQuotesForMaterials(job.id);
        if (quotes?.length) setJobQuotes(quotes as JobQuote[]);
        onQuoteChange?.(changeOrderQuoteId);
        setSelectedQuoteId(changeOrderQuoteId);
        await loadWorkbook(false, changeOrderQuoteId);
        if (newSheet) setActiveSheetId(newSheet.id);
      } else {
        await loadWorkbook();
        if (newSheet) setActiveSheetId(newSheet.id);
      }
    } catch (error: any) {
      console.error('Error adding sheet:', error);
      const msg = error?.message ? `Failed to add sheet: ${error.message}` : 'Failed to add sheet';
      toast.error(msg);
    } finally {
      setAddingSheet(false);
    }
  }

  async function syncMaterialsFromZoho() {
    setSyncingZoho(true);

    try {
      console.log('🔄 Starting Zoho Books material sync (chunked)...');
      await supabase.functions.invoke('zoho-sync', { body: { action: 'warm' } });
      let page = 1;
      let data: any = null;
      let totalSynced = 0;
      let totalInserted = 0;
      let totalUpdated = 0;
      let totalSkipped = 0;

      do {
        const { data: pageData, error } = await supabase.functions.invoke('zoho-sync', {
          body: { action: 'sync_materials', syncPage: page },
        });

        if (error) {
          let message = error.message;
          if (error instanceof FunctionsHttpError && error.context) {
            try {
              const raw = await error.context.text();
              if (raw) {
                try {
                  const body = JSON.parse(raw);
                  if (body?.error) {
                    message = body.details ? `${body.error}: ${body.details}` : body.error;
                  } else {
                    message = raw || message;
                  }
                } catch {
                  message = raw || message;
                }
              }
            } catch {
              /* keep message */
            }
          }
          throw new Error(message);
        }

        data = pageData;
        totalSynced += data?.itemsSynced ?? 0;
        totalInserted += data?.itemsInserted ?? 0;
        totalUpdated += data?.itemsUpdated ?? 0;
        totalSkipped += data?.itemsSkipped ?? 0;

        if (data?.hasMore && data?.nextPage) {
          page = data.nextPage;
          toast.loading(`Syncing materials... (page ${page})`, { id: 'zoho-sync' });
        }
      } while (data?.hasMore && data?.nextPage);

      toast.dismiss('zoho-sync');
      console.log('✅ Sync completed:', data);

      setSyncResults({
        ...data,
        itemsSynced: totalSynced,
        itemsInserted: totalInserted,
        itemsUpdated: totalUpdated,
        itemsSkipped: totalSkipped,
      });
      setShowSyncResults(true);

      await loadCatalogMaterials();

      toast.success(`✅ Synced ${totalSynced} materials from Zoho Books`);
    } catch (error: any) {
      console.error('❌ Sync error:', error);
      let msg = error?.message || 'Unknown error';
      const isTimeout = /WorkerRequestCancelled|cancelled by supervisor|timeout/i.test(msg);
      if (isTimeout) {
        msg = 'Sync timed out (too many materials in one request). The sync runs in chunks—please try again; it may complete on retry.';
      } else {
        const isGeneric = /non-2xx|status code/i.test(msg);
        if (isGeneric) {
          try {
            const { data: zohoSettings } = await supabase
              .from('zoho_integration_settings')
              .select('sync_error')
              .limit(1)
              .maybeSingle();
            if (zohoSettings?.sync_error) {
              msg = zohoSettings.sync_error;
            }
          } catch {
            /* ignore */
          }
        }
      }
      toast.error(`Failed to sync materials: ${msg}`, { duration: 10000 });
    } finally {
      setSyncingZoho(false);
    }
  }

  async function deleteSheet(sheet: MaterialSheet) {
    if (isWorkbookReadOnly) {
      setSheetDeleteConfirmId(null);
      toast.error('This workbook is read-only.');
      return;
    }
    if (!workbook) {
      setSheetDeleteConfirmId(null);
      toast.error('Cannot delete sheets until the workbook is loaded.');
      return;
    }

    if (workbook.sheets.length === 1) {
      setSheetDeleteConfirmId(null);
      toast.error('Cannot delete the last sheet. Workbooks must have at least one sheet.');
      return;
    }

    try {
      setSheetDeleteConfirmId(null);
      // Save current scroll position
      scrollPositionRef.current = window.scrollY;

      const { error } = await supabase
        .from('material_sheets')
        .delete()
        .eq('id', sheet.id);

      if (error) throw error;

      toast.success(`Sheet "${sheet.sheet_name}" deleted`);
      
      // Reload workbook
      await loadWorkbook();
      
      // Set active sheet to first available sheet if current one was deleted
      if (activeSheetId === sheet.id && workbook.sheets.length > 0) {
        const firstAvailableSheet = workbook.sheets.find(s => s.id !== sheet.id);
        if (firstAvailableSheet) {
          setActiveSheetId(firstAvailableSheet.id);
        }
      }

      // Restore scroll position
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollPositionRef.current, behavior: 'instant' });
      });
    } catch (error: any) {
      console.error('Error deleting sheet:', error);
      toast.error('Failed to delete sheet');
      setSheetDeleteConfirmId(null);
    }
  }

  /** Open the Sort Categories dialog for the currently active sheet */
  function openSortCategoriesDialog() {
    if (!activeSheet) return;
    // Build the full list of unique categories for this sheet, in current display order
    const currentGroups = groupByCategory(activeSheet.items, activeSheet.category_order);
    const allCats = currentGroups.map(g => g.category);
    setSortCategoriesOrder(allCats);
    setShowSortCategoriesDialog(true);
  }

  /** Persist the new category order to the database.
   *  Tries the category_order column first (requires migration).
   *  Falls back to re-encoding the order into items' order_index values — works without any migration.
   */
  async function saveSortOrder() {
    if (!activeSheet) return;
    if (isWorkbookReadOnly) {
      toast.error('This workbook is read-only.');
      return;
    }
    setSavingSortOrder(true);

    const invalidateCache = () => {
      for (const key of workbookCache.keys()) {
        if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
      }
    };

    try {
      // Attempt 1: save to category_order column (only works if migration has been run)
      const { error: colError } = await supabase
        .from('material_sheets')
        .update({ category_order: sortCategoriesOrder })
        .eq('id', activeSheet.id);

      if (!colError) {
        setWorkbook(prev => prev ? {
          ...prev,
          sheets: prev.sheets.map(s =>
            s.id === activeSheet.id ? { ...s, category_order: sortCategoriesOrder } : s
          ),
        } : prev);
        invalidateCache();
        toast.success('Category order saved');
        setShowSortCategoriesDialog(false);
        return;
      }

      // Attempt 2 (fallback): re-encode the desired order into items' order_index values.
      // Each category gets a block of 10 000 indices; items within a category
      // keep their relative position within that block.
      const updates: { id: string; order_index: number }[] = [];
      sortCategoriesOrder.forEach((catName, catIdx) => {
        const base = catIdx * 10000;
        const catItems = activeSheet.items
          .filter(i => (i.category || 'Uncategorized') === catName)
          .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
        catItems.forEach((item, itemIdx) => {
          updates.push({ id: item.id, order_index: base + itemIdx });
        });
      });

      // Run updates in parallel
      const results = await Promise.all(
        updates.map(upd =>
          supabase.from('material_items').update({ order_index: upd.order_index }).eq('id', upd.id)
        )
      );
      const firstErr = results.find(r => r.error);
      if (firstErr?.error) throw firstErr.error;

      // Patch local state so the UI reorders immediately
      const orderMap = new Map(updates.map(u => [u.id, u.order_index]));
      setWorkbook(prev => prev ? {
        ...prev,
        sheets: prev.sheets.map(s =>
          s.id === activeSheet.id
            ? { ...s, items: s.items.map(i => ({ ...i, order_index: orderMap.get(i.id) ?? i.order_index })) }
            : s
        ),
      } : prev);
      invalidateCache();
      toast.success('Category order saved');
      setShowSortCategoriesDialog(false);
    } catch (err: any) {
      console.error('Failed to save category order:', err);
      toast.error('Failed to save category order');
    } finally {
      setSavingSortOrder(false);
    }
  }

  /** Move a category up or down in the sort dialog list */
  function moveSortCategory(index: number, direction: 'up' | 'down') {
    const next = [...sortCategoriesOrder];
    const swap = direction === 'up' ? index - 1 : index + 1;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    setSortCategoriesOrder(next);
  }

  async function exportMaterialWorkbookToXLSX() {
    if (!workbook || workbook.sheets.length === 0) {
      toast.error('No workbook or sheets to export');
      return;
    }
    setExportingXLSX(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const headers = [
        'Category',
        'Usage',
        'SKU',
        'Material',
        'Qty',
        'Length',
        'Color',
        'Cost Per Unit',
        'Mark Up',
        'Price Per Unit',
        'Extended Cost',
        'Extended Price',
        'Taxable',
        'Notes',
        'Status',
      ];
      for (const sheet of workbook.sheets) {
        const rows: (string | number | null | boolean)[][] = [headers];
        for (const item of sheet.items) {
          const markupDisplay = item.markup_percent != null ? (item.markup_percent * 100).toFixed(2) : '';
          rows.push([
            item.category ?? '',
            item.usage ?? '',
            item.sku ?? '',
            item.material_name ?? '',
            item.quantity ?? 0,
            item.length ?? '',
            item.color ?? '',
            item.cost_per_unit ?? '',
            markupDisplay,
            item.price_per_unit ?? '',
            item.extended_cost ?? '',
            item.extended_price ?? '',
            item.taxable ?? false,
            item.notes ?? '',
            item.status ?? '',
          ]);
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const sheetName = (sheet.sheet_name || 'Sheet').replace(/[:\\/?*\[\]]/g, ' ').slice(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }
      const safeName = (job.name || 'MaterialWorkbook').replace(/[^a-z0-9_-]/gi, '_');
      const filename = `${safeName}_Material_Workbook_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success('Workbook exported to XLSX');
    } catch (error: any) {
      console.error('Export XLSX error:', error);
      toast.error('Failed to export workbook: ' + (error?.message || 'Unknown error'));
    } finally {
      setExportingXLSX(false);
    }
  }

  async function addMaterial() {
    if (!newMaterialName.trim()) {
      toast.error('Please enter a material name');
      return;
    }

    if (!addToCategory.trim()) {
      toast.error('Please enter a category');
      return;
    }

    if (!activeSheetId) {
      toast.error('No active sheet selected');
      return;
    }

    setSaving(true);

    try {
      const quantity = parseFloat(newQuantity) || 1;
      const costPerUnit = parseFloat(newCostPerUnit) || null;
      const lengthFeet = parseLengthToFeet(newLength.trim() || null);
      const isMetal = addToCategory.trim() === 'Metal';
      const addMult =
        lengthFeet != null && lengthFeet > 0
          ? isMetal
            ? lengthFeet * quantity
            : lengthFeet
          : quantity;

      // Use price from Zoho Books if available, otherwise calculate from markup
      let pricePerUnit: number | null = null;
      let markupDecimal = 0;

      if (newPricePerUnit) {
        // Price from Zoho Books - use as-is
        pricePerUnit = parseFloat(newPricePerUnit) || null;
        // Calculate markup for storage (reference only)
        if (costPerUnit && pricePerUnit && costPerUnit > 0) {
          markupDecimal = (pricePerUnit - costPerUnit) / costPerUnit;
        }
      } else {
        // Manual entry - calculate from markup
        const markup = parseFloat(newMarkup) || 0;
        markupDecimal = markup / 100;
        pricePerUnit = costPerUnit ? costPerUnit * (1 + markupDecimal) : null;
      }

      const extendedCost = costPerUnit ? Math.round(costPerUnit * addMult * 10000) / 10000 : null;
      const extendedPrice = pricePerUnit ? Math.round(pricePerUnit * addMult * 10000) / 10000 : null;

      // Get max order_index for current sheet and category
      const { data: maxData } = await supabase
        .from('material_items')
        .select('order_index')
        .eq('sheet_id', activeSheetId)
        .eq('category', addToCategory.trim())
        .order('order_index', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextOrderIndex = (maxData?.order_index || -1) + 1;

      // If SKU is set, check catalog for default trim drawing to attach
      let defaultTrimConfigId: string | null = null;
      const skuTrim = newSku.trim();
      if (skuTrim) {
        const { data: catalogRow } = await supabase
          .from('materials_catalog')
          .select('default_trim_saved_config_id')
          .eq('sku', skuTrim)
          .maybeSingle();
        defaultTrimConfigId = catalogRow?.default_trim_saved_config_id ?? null;
      }

      // Insert new material
      const { error } = await supabase
        .from('material_items')
        .insert({
          sheet_id: activeSheetId,
          category: addToCategory.trim(),
          usage: newUsage.trim() || null,
          sku: skuTrim || null,
          material_name: newMaterialName.trim(),
          quantity,
          length: newLength.trim() || null,
          color: newColor.trim() || null,
          cost_per_unit: costPerUnit,
          markup_percent: markupDecimal,
          price_per_unit: pricePerUnit,
          extended_cost: extendedCost,
          extended_price: extendedPrice,
          taxable: true,
          notes: newNotes.trim() || null,
          order_index: nextOrderIndex,
          status: 'not_ordered',
          trim_saved_config_id: defaultTrimConfigId,
        });

      if (error) throw error;

      toast.success('Material added');
      setShowAddDialog(false);
      window.dispatchEvent(new CustomEvent('materials-workbook-updated', { detail: { quoteId: effectiveQuoteId ?? null, jobId: job.id } }));
      
      // Reload workbook to show new material
      await loadWorkbook();

      // Restore scroll position
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollPositionRef.current, behavior: 'instant' });
      });
    } catch (error: any) {
      console.error('Error adding material:', error);
      toast.error('Failed to add material');
    } finally {
      setSaving(false);
    }
  }

  const activeSheet = workbook?.sheets.find(s => s.id === activeSheetId);
  const filteredItems = activeSheet?.items.filter(item =>
    searchTerm === '' ||
    item.material_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.category && item.category.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (item.usage && item.usage.toLowerCase().includes(searchTerm.toLowerCase()))
  ) || [];

  // Group by workbook category, using user-defined order when present
  const categoryGroups = groupByCategory(filteredItems, activeSheet?.category_order);

  useEffect(() => {
    const qid = effectiveQuoteId ?? null;
    const wbQuoteId = (workbook as { quote_id?: string | null } | null)?.quote_id ?? null;
    const quoteMismatch = isWorkbookQuoteMismatch(wbQuoteId, qid, jobQuotes);

    if (!workbook?.sheets?.length || quoteMismatch) {
      onBreakdownPriceSync?.([]);
      return;
    }
    // Signed contract + internal working copy: do not push category prices to the proposal panel (customer totals).
    const signedContract = quoteHasActiveContract(
      buildQuoteForContract(jobQuotes, effectiveQuoteId, contractQuoteFields) as any
    );
    if (signedContract && workbook.status === 'working' && !snapshotWorkbookId) {
      return;
    }

    const sheetPrices: BreakdownSheetPrice[] = workbook.sheets.map((sheet) => {
      const allCategoryGroups = groupByCategory(sheet.items || [], sheet.category_order);
      const categories: Record<string, number> = {};
      allCategoryGroups.forEach((catGroup) => {
        const key = String(catGroup.category || '').trim().toLowerCase();
        // Must match breakdown tab math exactly: catGroup.items reduce getDisplayExtended(item).price
        categories[key] = (catGroup.items || []).reduce((sum, item) => sum + getDisplayExtended(item).price, 0);
      });
      return { sheetId: sheet.id, sheetName: sheet.sheet_name || '', categories };
    });

    onBreakdownPriceSync?.(sheetPrices);
  }, [workbook, onBreakdownPriceSync, jobQuotes, effectiveQuoteId, contractQuoteFields, snapshotWorkbookId]);

  useEffect(() => {
    const qid = effectiveQuoteId ?? null;
    const wbQuoteId = (workbook as { quote_id?: string | null } | null)?.quote_id ?? null;
    const quoteMismatch = isWorkbookQuoteMismatch(wbQuoteId, qid, jobQuotes);

    if (!workbook || quoteMismatch) {
      onWorkbookViewSync?.({ workbookId: null, status: null });
      return;
    }
    onWorkbookViewSync?.({ workbookId: workbook.id ?? null, status: (workbook.status as any) ?? null });
  }, [workbook, effectiveQuoteId, onWorkbookViewSync]);

  const selectedQuote = jobQuotes.find(q => q.id === effectiveQuoteId);
  const quoteForContractUi = buildQuoteForContract(jobQuotes, effectiveQuoteId, contractQuoteFields);
  const labelQuote = selectedQuote ?? quoteForContractUi;
  const proposalLabel = labelQuote ? formatQuoteScopeLabel(labelQuote as JobQuote) : proposalNumber || 'Proposal';

  const quoteContractFrozen = isQuoteContractFrozen(quoteForContractUi as any);
  const quoteHasSignedContract = quoteHasActiveContract(quoteForContractUi as any);

  // Push job-workbook extended sell total to the proposal panel and in-card display (signed contract only).
  useEffect(() => {
    let cancelled = false;

    async function fetchWorkingWorkbookExtendedSellTotal(quoteId: string): Promise<number | null> {
      const { data: allWorkbooks, error } = await supabase
        .from('material_workbooks')
        .select('id, quote_id, status, version_number')
        .eq('job_id', job.id)
        .order('updated_at', { ascending: false });
      if (error || !allWorkbooks?.length) return null;
      const workingList = allWorkbooks
        .filter((w: { quote_id?: string | null; status?: string }) => w.quote_id === quoteId && w.status === 'working')
        .sort((a: { version_number?: number }, b: { version_number?: number }) => (b.version_number ?? 0) - (a.version_number ?? 0));
      const wbRow = workingList[0];
      if (!wbRow) return null;
      const { data: sheetsRows, error: sheetsErr } = await supabase
        .from('material_sheets')
        .select('*')
        .eq('workbook_id', (wbRow as { id: string }).id)
        .order('order_index');
      if (sheetsErr) return null;
      const sheets = sheetsRows || [];
      const sheetIds = sheets.map((s: { id: string }) => s.id);
      let itemsData: any[] = [];
      if (sheetIds.length > 0) {
        const { data: itemsRes, error: itemsErr } = await supabase
          .from('material_items')
          .select('*')
          .in('sheet_id', sheetIds)
          .order('order_index');
        if (itemsErr) return null;
        itemsData = itemsRes || [];
      }
      itemsData = await enrichItemsWithCatalogPrices(itemsData);
      sheets.sort((a: any, b: any) => {
        const typeA = a.sheet_type === 'change_order' ? 1 : 0;
        const typeB = b.sheet_type === 'change_order' ? 1 : 0;
        if (typeA !== typeB) return typeA - typeB;
        return (a.order_index ?? 0) - (b.order_index ?? 0);
      });
      const sheetsWithItems: MaterialSheet[] = sheets.map((sheet: any) => ({
        ...sheet,
        items: itemsData.filter((item: any) => item.sheet_id === sheet.id),
      }));
      let sum = 0;
      for (const sheet of sheetsWithItems) {
        const groups = groupByCategory(sheet.items || [], sheet.category_order);
        for (const cg of groups) {
          for (const item of cg.items || []) {
            sum += getDisplayExtended(item).price;
          }
        }
      }
      return sum;
    }

    function pushTotal(value: number | null) {
      if (cancelled) return;
      onJobWorkbookMaterialsTotalSync?.(value);
    }

    async function run() {
      // Any quote with both a locked snapshot row and a working row uses the working row for this total only;
      // do not require contract flags (they can lag) so the materials-column strip + JobFinancials stay in sync.
      if (!effectiveQuoteId || !hasWorkingWorkbookForQuote || lockedSnapshotsMeta.length === 0) {
        pushTotal(null);
        return;
      }
      if (workbook?.status === 'working' && !snapshotWorkbookId && workbook.sheets) {
        let sum = 0;
        for (const sheet of workbook.sheets) {
          const groups = groupByCategory(sheet.items || [], sheet.category_order);
          for (const cg of groups) {
            for (const item of cg.items || []) {
              sum += getDisplayExtended(item).price;
            }
          }
        }
        pushTotal(sum);
        return;
      }
      const total = await fetchWorkingWorkbookExtendedSellTotal(effectiveQuoteId);
      pushTotal(total);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    onJobWorkbookMaterialsTotalSync,
    hasWorkingWorkbookForQuote,
    lockedSnapshotsMeta.length,
    effectiveQuoteId,
    job.id,
    workbook?.id,
    workbook?.status,
    snapshotWorkbookId,
    workbook?.sheets,
    jobWbMaterialsRefreshSeq,
  ]); // eslint-disable-line react-hooks/exhaustive-deps -- getDisplayExtended/groupByCategory/enrichItems; sheets + refresh capture edits

  // Mirror the same locked logic used in JobFinancials. Put change order proposal last; then sort regular quotes by proposal_number descending.
  const sortedQuotes = [...jobQuotes].sort((a, b) => {
    if (a.is_change_order_proposal && !b.is_change_order_proposal) return 1;
    if (!a.is_change_order_proposal && b.is_change_order_proposal) return -1;
    const na = (a.proposal_number || a.quote_number || '').toString();
    const nb = (b.proposal_number || b.quote_number || '').toString();
    if (na === nb) return 0;
    return nb.localeCompare(na, undefined, { numeric: true });
  });
  const latestQuoteId = sortedQuotes.find(q => !q.is_change_order_proposal)?.id ?? sortedQuotes[0]?.id;
  // Same read-only gate as JobFinancials (contract, office lock, older proposal, minus session unlock).
  const jobQuotesSortedLikeFinancials = useMemo(() => sortQuotesLikeJobFinancials(jobQuotes), [jobQuotes]);
  const proposalPanelReadOnly = useMemo(
    () =>
      quoteForContractUi
        ? isProposalPanelReadOnly(quoteForContractUi as any, jobQuotesSortedLikeFinancials, historicalUnlockedQuoteId)
        : false,
    [quoteForContractUi, jobQuotesSortedLikeFinancials, historicalUnlockedQuoteId],
  );
  /** Signed-contract job workbook (working row): shop/COS/field edits allowed even when the proposal panel is read-only. */
  const isViewingSignedContractJobWorkbook =
    quoteHasSignedContract && workbook?.status === 'working' && !snapshotWorkbookId;
  /** Same read-only rules as JobFinancials (office lock, contract, older proposal, session unlock) for every grid row. */
  const isWorkbookReadOnly = proposalPanelReadOnly && !isViewingSignedContractJobWorkbook;
  isWorkbookReadOnlyRef.current = isWorkbookReadOnly;
  const materialsWorkbookLocked = isWorkbookReadOnly;

  async function finalizeCategoryRename() {
    const edit = categoryNameEditRef.current;
    if (!edit || savingCategoryRename || categoryRenameInFlightRef.current) return;
    if (isWorkbookReadOnly) {
      setCategoryNameEdit(null);
      return;
    }
    const trimmed = edit.value.trim();
    if (trimmed === edit.oldName) {
      setCategoryNameEdit(null);
      return;
    }
    if (!trimmed) {
      toast.error('Category name cannot be empty');
      setCategoryNameEdit(null);
      return;
    }
    const sheet = workbook?.sheets.find((s) => s.id === edit.sheetId);
    if (!sheet) {
      setCategoryNameEdit(null);
      return;
    }
    const normalizedOld = edit.oldName;
    const normalizedNew = trimmed;
    const catsInSheet = new Set(sheet.items.map((i) => i.category || 'Uncategorized'));
    if (catsInSheet.has(normalizedNew)) {
      toast.error('A category with that name already exists');
      return;
    }
    const itemIds = sheet.items
      .filter((i) => (i.category || 'Uncategorized') === normalizedOld)
      .map((i) => i.id);
    if (itemIds.length === 0) {
      setCategoryNameEdit(null);
      return;
    }

    categoryRenameInFlightRef.current = true;
    setSavingCategoryRename(true);
    try {
      const now = new Date().toISOString();
      const { error: itemsErr } = await supabase
        .from('material_items')
        .update({ category: normalizedNew, updated_at: now })
        .in('id', itemIds);
      if (itemsErr) throw itemsErr;

      if (sheet.category_order?.length) {
        const nextOrder = sheet.category_order.map((c) => (c === normalizedOld ? normalizedNew : c));
        const { error: ordErr } = await supabase
          .from('material_sheets')
          .update({ category_order: nextOrder })
          .eq('id', edit.sheetId);
        if (ordErr) console.warn('category_order rename:', ordErr);
      }

      await supabase
        .from('material_category_markups')
        .update({ category_name: normalizedNew })
        .eq('sheet_id', edit.sheetId)
        .eq('category_name', normalizedOld);

      const { error: optErr } = await supabase
        .from('material_category_options')
        .update({ category_name: normalizedNew })
        .eq('sheet_id', edit.sheetId)
        .eq('category_name', normalizedOld);
      if (optErr) console.warn('material_category_options rename:', optErr);

      setCategoryFootPriceEdit((prev) =>
        prev && prev.category === normalizedOld ? { ...prev, category: normalizedNew } : prev
      );

      setWorkbook((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sheets: prev.sheets.map((s) => {
            if (s.id !== edit.sheetId) return s;
            const newCatOrder =
              s.category_order?.length != null
                ? s.category_order.map((c) => (c === normalizedOld ? normalizedNew : c))
                : s.category_order;
            return {
              ...s,
              category_order: newCatOrder,
              items: s.items.map((i) =>
                (i.category || 'Uncategorized') === normalizedOld
                  ? { ...i, category: normalizedNew, updated_at: now }
                  : i
              ),
            };
          }),
        };
      });

      for (const key of workbookCache.keys()) {
        if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
      }

      setCategoryNameEdit(null);
      toast.success(`Renamed category to "${normalizedNew}"`);
      window.dispatchEvent(
        new CustomEvent('materials-workbook-updated', {
          detail: { quoteId: effectiveQuoteId ?? null, jobId: job.id },
        })
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to rename category';
      console.error(e);
      toast.error(msg);
    } finally {
      categoryRenameInFlightRef.current = false;
      setSavingCategoryRename(false);
    }
  }

  async function finalizeSheetRename() {
    const edit = sheetNameEditRef.current;
    if (!edit || savingSheetRename || sheetRenameInFlightRef.current) return;
    if (isWorkbookReadOnly) {
      setSheetNameEdit(null);
      return;
    }
    const trimmed = edit.value.trim();
    if (trimmed === edit.oldName) {
      setSheetNameEdit(null);
      return;
    }
    if (!trimmed) {
      toast.error('Sheet name cannot be empty');
      setSheetNameEdit(null);
      return;
    }
    const sheet = workbook?.sheets.find((s) => s.id === edit.sheetId);
    if (!sheet) {
      setSheetNameEdit(null);
      return;
    }
    // Block name collisions inside the same workbook (case-insensitive) so the
    // category-rename style "two tabs with the same name" never happens here.
    const collides = workbook?.sheets.some(
      (s) => s.id !== edit.sheetId && s.sheet_name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (collides) {
      toast.error('A sheet with that name already exists in this workbook');
      return;
    }

    sheetRenameInFlightRef.current = true;
    setSavingSheetRename(true);
    try {
      const now = new Date().toISOString();
      let { error } = await supabase
        .from('material_sheets')
        .update({ sheet_name: trimmed, updated_at: now })
        .eq('id', edit.sheetId);
      // Some older DBs don't have material_sheets.updated_at — retry without it
      // so the rename still succeeds instead of being silently rejected.
      if (
        error &&
        typeof (error as { message?: string }).message === 'string' &&
        /column .*updated_at.* does not exist/i.test((error as { message: string }).message)
      ) {
        const retry = await supabase
          .from('material_sheets')
          .update({ sheet_name: trimmed })
          .eq('id', edit.sheetId);
        error = retry.error;
      }
      if (error) throw error;

      setWorkbook((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sheets: prev.sheets.map((s) =>
            s.id === edit.sheetId ? { ...s, sheet_name: trimmed } : s
          ),
        };
      });

      for (const key of workbookCache.keys()) {
        if (key.startsWith(`${job.id}:`)) workbookCache.delete(key);
      }

      setSheetNameEdit(null);
      toast.success(`Renamed sheet to "${trimmed}"`);
      // Same broadcast as category rename so JobFinancials' sibling-sheet
      // remap (which keys on sheet_name) rebuilds with the new name and
      // labor / subs stay attached on the proposal totals panel.
      window.dispatchEvent(
        new CustomEvent('materials-workbook-updated', {
          detail: { quoteId: effectiveQuoteId ?? null, jobId: job.id },
        })
      );
    } catch (e: unknown) {
      // Supabase / Postgrest errors aren't Error instances — they're plain
      // objects with `message`, `details`, `hint`, `code`. The previous
      // `e instanceof Error` check always missed them, so the toast just
      // showed the generic fallback. Surface whatever we get so the actual
      // cause (RLS, missing column, schema cache, etc.) shows up to the user.
      const errObj = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
      const msg =
        (typeof errObj?.message === 'string' && errObj.message) ||
        (typeof errObj?.details === 'string' && errObj.details) ||
        (typeof errObj?.hint === 'string' && errObj.hint) ||
        (e instanceof Error ? e.message : '') ||
        'Failed to rename sheet';
      console.error('Sheet rename failed:', e);
      toast.error(`Failed to rename sheet: ${msg}`);
    } finally {
      sheetRenameInFlightRef.current = false;
      setSavingSheetRename(false);
    }
  }

  /** Shop / trim / Zoho / workbook-level mutations — only when the visible grid is editable. */
  const canUseShopTrimAndZohoOnThisWorkbook =
    !isWorkbookReadOnly &&
    (workbook?.status === 'working' || (workbook?.status === 'locked' && quoteHasSignedContract));
  const showShopOrderControls = canUseShopTrimAndZohoOnThisWorkbook;
  /** Unsigned / draft proposals: optional manual lock. Sent or signed contracts auto-manage locked + working copies. */
  const showManualLockWorkbook =
    !!workbook && workbook.status === 'working' && !quoteContractFrozen && !isWorkbookReadOnly;
  /** Signed contract only: two workbook rows (price snapshot vs job-tracking working copy). */
  const showContractWorkingToggle = quoteHasSignedContract && lockedSnapshotsMeta.length > 0;
  /** User manually locked while still editable — keep older “view snapshot” row. */
  const showLegacyLockedSnapshotButtons =
    !quoteContractFrozen && workbook?.status === 'working' && lockedSnapshotsMeta.length > 0;
  /** Viewing a locked snapshot overlay while a job/working row exists — Job workbook switch lives in the top strip. */
  const showSnapshotExitToJobWorkbook = !!snapshotWorkbookId && hasWorkingWorkbookForQuote;

  const materialsSlot = useMaterialsToolbarSlot();
  const portalTarget = materialsSlot?.ready && materialsSlot?.ref?.current ? materialsSlot.ref.current : null;

  const viewingSignedContractWorkbook =
    !!snapshotWorkbookId ||
    (!!workbook?.id &&
      workbook.status === 'locked' &&
      lockedSnapshotsMeta.some((l) => l.id === workbook.id));
  const viewingWorkingCopy =
    !!workbook &&
    workbook.status === 'working' &&
    !snapshotWorkbookId &&
    hasWorkingWorkbookForQuote;
  const workingCopyToggleDisabled = !hasWorkingWorkbookForQuote;
  /** Snapshot exit button is redundant when the signed-contract Job | Proposal toggle is shown. */
  const showSnapshotExitJobWbButton = showSnapshotExitToJobWorkbook && !showContractWorkingToggle;
  /** Signed contract pair: which workbook the grid is showing (proposal-priced vs internal job copy). */
  const workbookLocationIndicator =
    showContractWorkingToggle && workbook ? (
      <div
        className="flex flex-col gap-0.5 shrink-0 min-w-0"
        role="status"
        aria-label={
          viewingWorkingCopy
            ? 'You are viewing the job workbook'
            : 'You are viewing the proposal workbook'
        }
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-cyan-950/70 whitespace-nowrap">
          You are viewing
        </span>
        <div className="inline-flex rounded-lg border-2 border-cyan-800/30 bg-white/80 p-0.5 gap-0.5 shadow-sm">
          <span
            className={cn(
              'rounded-md px-2 py-1 text-[10px] sm:text-[11px] font-bold whitespace-nowrap transition-colors',
              viewingSignedContractWorkbook
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-600 bg-transparent',
            )}
          >
            Proposal workbook
          </span>
          <span
            className={cn(
              'rounded-md px-2 py-1 text-[10px] sm:text-[11px] font-bold whitespace-nowrap transition-colors',
              viewingWorkingCopy
                ? 'bg-cyan-800 text-white shadow-sm'
                : 'text-slate-600 bg-transparent',
            )}
          >
            Job workbook
          </span>
        </div>
      </div>
    ) : null;

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">Loading materials...</p>
      </div>
    );
  }

  /** Readable on both the dark portaled job bar and light inline headers */
  const contractWorkbookViewToggle =
    showContractWorkingToggle && lockedSnapshotsMeta[0] ? (
      <div
        className="flex flex-col gap-0.5 shrink-0"
        role="group"
        aria-label="Switch between proposal workbook and job workbook"
      >
        <div className="inline-flex rounded-md border-2 border-amber-600 bg-white/95 dark:bg-slate-900/90 p-0.5 shadow-sm">
          <button
            type="button"
            disabled={workingCopyToggleDisabled}
            onClick={() => {
              if (workingCopyToggleDisabled) return;
              void exitLockedSnapshotView();
            }}
            className={cn(
              'rounded px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] font-bold transition-colors whitespace-nowrap',
              viewingWorkingCopy
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-amber-950 hover:bg-amber-50',
              workingCopyToggleDisabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
            )}
            title={
              workingCopyToggleDisabled
                ? ensuringContractWorkbookPair
                  ? 'Creating job workbook…'
                  : 'Job workbook is being prepared for this signed contract'
                : 'Job workbook — internal only. Does not change customer proposal totals (left follows proposal workbook).'
            }
          >
            Job workbook
          </button>
          <button
            type="button"
            onClick={() => {
              void openLockedSnapshotView(lockedSnapshotsMeta[0].id);
            }}
            className={cn(
              'rounded px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] font-bold transition-colors whitespace-nowrap',
              viewingSignedContractWorkbook
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-amber-950 hover:bg-amber-50',
            )}
            title="Proposal workbook (signed contract snapshot) — drives customer materials total on the left"
          >
            Proposal workbook{' '}
            <span className="opacity-90 font-semibold">v{lockedSnapshotsMeta[0].version_number}</span>
          </button>
        </div>
      </div>
    ) : null;

  // Action buttons that appear in the top bar (Move / Package / Add Material, etc.).
  // Only when Workbook tab is active and a workbook exists.
  const workbookActionButtons = activeTab === 'manage' && workbook ? (
    <div className="flex gap-0.5 flex-shrink-0 flex-wrap">
      {packageSelectionMode ? (
        <>
          <Button onClick={openAddToPackageDialog} size="sm" disabled={selectedMaterialsForPackageAdd.size === 0}
            className="h-6 text-[10px] bg-green-600 hover:bg-green-700 whitespace-nowrap px-1.5">
            <Package className="w-2.5 h-2.5 mr-0.5" />
            Add to Pkg ({selectedMaterialsForPackageAdd.size})
          </Button>
          <Button onClick={togglePackageSelectionMode} size="sm" variant="outline"
            className="h-6 text-[10px] whitespace-nowrap px-1.5">
            <X className="w-2.5 h-2.5 mr-0.5" />Cancel
          </Button>
        </>
      ) : bulkMoveMode ? (
        <>
          <Button onClick={openBulkMoveDialog} size="sm" disabled={selectedMaterialsForMove.size === 0}
            className="h-6 text-[10px] bg-orange-600 hover:bg-orange-700 whitespace-nowrap px-1.5">
            <MoveHorizontal className="w-2.5 h-2.5 mr-0.5" />
            Move ({selectedMaterialsForMove.size})
          </Button>
          <Button onClick={toggleBulkMoveMode} size="sm" variant="outline"
            className="h-6 text-[10px] whitespace-nowrap px-1.5">
            <X className="w-2.5 h-2.5 mr-0.5" />Cancel
          </Button>
        </>
      ) : (
        <>
          {showShopOrderControls && (
            <>
              {workbook.sheets.length > 1 && (
                <Button onClick={toggleBulkMoveMode} size="sm" variant="outline"
                  className="h-6 text-[10px] whitespace-nowrap px-1.5 bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100">
                  <MoveHorizontal className="w-2.5 h-2.5 mr-0.5" />Move
                </Button>
              )}
              {packages.length > 0 && (
                <Button onClick={togglePackageSelectionMode} size="sm" variant="outline"
                  className="h-6 text-[10px] whitespace-nowrap px-1.5 bg-purple-50 border-purple-300 text-purple-700 hover:bg-purple-100">
                  <Package className="w-2.5 h-2.5 mr-0.5" />Package
                </Button>
              )}
              {activeSheet && activeSheet.items.length > 0 && (
                <Button onClick={openSortCategoriesDialog} size="sm" variant="outline"
                  className="h-6 text-[10px] whitespace-nowrap px-1.5 bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100"
                  title="Change the display order of categories for this sheet">
                  <ListOrdered className="w-2.5 h-2.5 mr-0.5" />Sort Categories
                </Button>
              )}
              <Button onClick={refreshWorkbookPricesFromCatalog} size="sm" variant="outline"
                disabled={refreshingWorkbookPrices}
                className="h-6 text-[10px] whitespace-nowrap px-1.5 bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                title="Update cost and price for all materials in this workbook from the catalog (Zoho Books).">
                {refreshingWorkbookPrices ? (
                  <><div className="w-2.5 h-2.5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mr-0.5" />Refreshing…</>
                ) : (
                  <><RefreshCw className="w-2.5 h-2.5 mr-0.5" />Refresh prices</>
                )}
              </Button>
            </>
          )}
          {!materialsWorkbookLocked && (
            <Button onClick={() => openAddDialog()} size="sm"
              className="h-6 text-[10px] gradient-primary whitespace-nowrap px-1.5">
              <Plus className="w-2.5 h-2.5 mr-0.5" />Add Material
            </Button>
          )}
        </>
      )}
    </div>
  ) : null;

  // Documents and Export XLSX — shown on the far right of the workbook toolbar with a gap from other buttons.
  const workbookActionButtonsRight =
    activeTab === 'manage' ? (
      <div className="flex gap-0.5 flex-shrink-0 flex-wrap">
        <Button
          onClick={() => setShowDocumentViewer(true)}
          size="sm"
          variant="outline"
          className="h-6 text-[10px] whitespace-nowrap px-1.5 bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100"
        >
          <FileText className="w-2.5 h-2.5 mr-0.5" />
          Documents
        </Button>
        {workbook ? (
          <Button
            onClick={exportMaterialWorkbookToXLSX}
            size="sm"
            variant="outline"
            disabled={exportingXLSX}
            className="h-6 text-[10px] whitespace-nowrap px-1.5 bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
          >
            <Download className="w-2.5 h-2.5 mr-0.5" />
            {exportingXLSX ? 'Exporting…' : 'Export XLSX'}
          </Button>
        ) : null}
      </div>
    ) : null;

  const materialsToolbarContent = (
    <div className="flex items-center gap-2 flex-wrap text-xs justify-end min-w-0">
      <TabsList className="flex flex-wrap items-center gap-1 h-8 p-0 bg-transparent border-0">
        <TabsTrigger
          value="manage"
          className="flex items-center gap-1 h-8 text-xs px-2 rounded-md border border-yellow-600/40 bg-white/10 hover:bg-white/20 text-yellow-100 data-[state=active]:bg-white data-[state=active]:text-slate-800 data-[state=active]:border-slate-300 data-[state=active]:shadow-sm"
        >
          <FileSpreadsheet className="w-3 h-3" />
          <span>Workbook</span>
        </TabsTrigger>
        <TabsTrigger
          value="breakdown"
          className="flex items-center gap-1 h-8 text-xs px-2 rounded-md border border-yellow-600/40 bg-white/10 hover:bg-white/20 text-yellow-100 data-[state=active]:bg-white data-[state=active]:text-slate-800 data-[state=active]:border-slate-300 data-[state=active]:shadow-sm"
        >
          <DollarSign className="w-3 h-3" />
          <span>Breakdown</span>
        </TabsTrigger>
        <TabsTrigger
          value="packages"
          className="flex items-center gap-1 h-8 text-xs px-2 rounded-md border border-yellow-600/40 bg-white/10 hover:bg-white/20 text-yellow-100 data-[state=active]:bg-white data-[state=active]:text-slate-800 data-[state=active]:border-slate-300 data-[state=active]:shadow-sm"
        >
          <Package className="w-3 h-3" />
          <span>Packages</span>
        </TabsTrigger>
        <TabsTrigger
          value="crew-orders"
          className="flex items-center gap-1 h-8 text-xs px-2 rounded-md border border-yellow-600/40 bg-white/10 hover:bg-white/20 text-yellow-100 data-[state=active]:bg-white data-[state=active]:text-slate-800 data-[state=active]:border-slate-300 data-[state=active]:shadow-sm relative"
        >
          <ShoppingCart className="w-3 h-3" />
          <span>Crew Orders</span>
          {pendingCrewCount > 0 && (
            <Badge className="ml-0.5 bg-orange-500 text-white text-[10px] font-bold px-0.5 py-0 leading-none animate-pulse">
              {pendingCrewCount}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger
          value="trim-flatstock"
          className="flex items-center gap-1 h-8 text-xs px-2 rounded-md border border-yellow-600/40 bg-white/10 hover:bg-white/20 text-yellow-100 data-[state=active]:bg-white data-[state=active]:text-slate-800 data-[state=active]:border-slate-300 data-[state=active]:shadow-sm"
        >
          <Ruler className="w-3 h-3" />
          <span>Trim / Flatstock</span>
        </TabsTrigger>
        <TabsTrigger
          value="upload"
          className="flex items-center gap-1 h-8 text-xs px-2 rounded-md border border-yellow-600/40 bg-white/10 hover:bg-white/20 text-yellow-100 data-[state=active]:bg-white data-[state=active]:text-slate-800 data-[state=active]:border-slate-300 data-[state=active]:shadow-sm"
        >
          <Upload className="w-3 h-3" />
          <span>Upload</span>
        </TabsTrigger>
      </TabsList>
      {(activeTab === 'manage' || activeTab === 'breakdown') && !workbook && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowDocumentViewer(true)}
          className="h-8 text-xs px-2 border-blue-400/60 bg-blue-950/30 text-yellow-100 hover:bg-blue-900/40 hover:text-white"
        >
          <FileText className="w-3 h-3 mr-1.5" />
          PDFs &amp; documents
        </Button>
      )}
    </div>
  );

  return (
    <div className="w-full min-w-0 px-2 flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-1 flex flex-col flex-1 min-h-0 min-w-0">
        {portalTarget && createPortal(materialsToolbarContent, portalTarget)}
        {!portalTarget && (
          <div className="bg-gradient-to-r from-slate-50 to-slate-100 p-2 rounded-lg border border-slate-200">
            {jobQuotes.length > 1 ? (
              /* Multi-proposal: proposal selector + action buttons on the SAME row */
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Proposal</Label>
                <Select
                  value={effectiveQuoteId ?? ''}
                  onValueChange={(v) => {
                    const id = v || null;
                    onQuoteChange?.(id);
                    setSelectedQuoteId(id);
                  }}
                >
                  <SelectTrigger className="w-[160px] h-8 bg-white border text-xs">
                    <SelectValue placeholder="Select proposal" />
                  </SelectTrigger>
                  <SelectContent>
                    {jobQuotes.map((q) => (
                      <SelectItem key={q.id} value={q.id}>
                        {formatQuoteScopeLabel(q as JobQuote)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex-1" />
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {workbookActionButtons}
                </div>
              </div>
            ) : null}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-0">
                <TabsList className="grid w-full grid-cols-6 h-9 bg-white shadow-sm">
                  <TabsTrigger value="manage" className="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1 text-xs font-semibold py-1">
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Workbook</span>
                  </TabsTrigger>
                  <TabsTrigger value="breakdown" className="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1 text-xs font-semibold py-1">
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Breakdown</span>
                  </TabsTrigger>
                  <TabsTrigger value="packages" className="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1 text-xs font-semibold py-1">
                    <Package className="w-3.5 h-3.5" />
                    <span>Packages</span>
                  </TabsTrigger>
                  <TabsTrigger value="crew-orders" className="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1 text-xs font-semibold py-1 relative">
                    <ShoppingCart className="w-3.5 h-3.5" />
                    <span>Crew Orders</span>
                    {pendingCrewCount > 0 && (
                      <Badge className="ml-1 bg-orange-500 text-white text-[10px] font-bold px-1 py-0 leading-none animate-pulse">
                        {pendingCrewCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="trim-flatstock" className="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1 text-xs font-semibold py-1">
                    <Ruler className="w-3.5 h-3.5" />
                    <span>Trim / Flatstock</span>
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1 text-xs font-semibold py-1">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload</span>
                  </TabsTrigger>
                </TabsList>
              </div>
              {/* Single/no proposal: toggle + buttons beside the tab strip */}
              {jobQuotes.length <= 1 && (
                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  {workbookActionButtons}
                </div>
              )}
            </div>
          </div>
        )}

        {quoteHasSignedContract && ensuringContractWorkbookPair && (
          <div className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-950 mb-2 flex items-center gap-2">
            <div className="w-3.5 h-3.5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin shrink-0" />
            <span>Preparing job workbook for shop, crew orders, and field edits…</span>
          </div>
        )}

        {(typeof jobWorkbookMaterialsTotalForStrip === 'number' ||
          showLegacyLockedSnapshotButtons ||
          showSnapshotExitJobWbButton ||
          showContractWorkingToggle) && (
          <div
            className={cn(
              'sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0',
              (typeof jobWorkbookMaterialsTotalForStrip === 'number' ||
                showSnapshotExitJobWbButton ||
                showContractWorkingToggle) &&
                'border-b-2 border-cyan-600 bg-gradient-to-r from-cyan-50 via-sky-50 to-cyan-50 px-3 py-2 shadow-sm',
              typeof jobWorkbookMaterialsTotalForStrip !== 'number' &&
                !showSnapshotExitJobWbButton &&
                !showContractWorkingToggle &&
                showLegacyLockedSnapshotButtons &&
                'justify-end',
            )}
          >
            {workbookLocationIndicator}
            {typeof jobWorkbookMaterialsTotalForStrip === 'number' && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 flex-1 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-900 whitespace-nowrap">
                  Job workbook total
                </span>
                <span className="text-slate-400 hidden sm:inline">|</span>
                <span className="font-bold tabular-nums text-cyan-950 text-base">
                  $
                  {jobWorkbookMaterialsTotalForStrip.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            )}
            {showContractWorkingToggle && contractWorkbookViewToggle && (
              <div className="shrink-0">{contractWorkbookViewToggle}</div>
            )}
            {(showLegacyLockedSnapshotButtons || showSnapshotExitJobWbButton) && (
              <div
                className={cn(
                  'flex flex-wrap items-center gap-2 shrink-0',
                  (typeof jobWorkbookMaterialsTotalForStrip === 'number' ||
                    showSnapshotExitJobWbButton ||
                    showContractWorkingToggle) &&
                    'ml-auto',
                )}
              >
                {showSnapshotExitJobWbButton ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-9 text-xs font-semibold"
                    onClick={() => exitLockedSnapshotView()}
                    title="Switch to the job workbook (internal only). Does not unlock or replace the proposal workbook."
                  >
                    <LockOpen className="w-3.5 h-3.5 mr-1.5" />
                    Job workbook
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 text-xs font-semibold bg-amber-100 border-2 border-amber-400 text-amber-950 hover:bg-amber-200 shadow-sm"
                    onClick={() => openLockedSnapshotView(lockedSnapshotsMeta[0].id)}
                    title="Open the proposal workbook (locked snapshot)"
                  >
                    <Lock className="w-3.5 h-3.5 mr-1.5" />
                    Proposal workbook
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {workbook &&
          quoteHasSignedContract &&
          workbook.status === 'locked' &&
          !snapshotWorkbookId &&
          !hasWorkingWorkbookForQuote &&
          !ensuringContractWorkbookPair && (
            <div className="rounded-lg border p-3 px-3 flex flex-col gap-2 text-sm border-amber-300 bg-amber-50 text-amber-950 mb-2">
              <div className="flex flex-wrap items-center gap-2">
                <Lock className="w-4 h-4 shrink-0" />
                <span className="font-semibold">Proposal workbook — add a job workbook</span>
                <Badge variant="outline" className="bg-white/80">
                  v{workbook.version_number}
                </Badge>
              </div>
              <p className="text-xs opacity-90 pl-6">
                If automatic setup did not finish, add a job workbook for shop and crew (internal only — customer pricing stays on this proposal workbook).
              </p>
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs w-fit gradient-primary"
                disabled={creatingWorkingFromLocked}
                onClick={() => createWorkingFromLatestLocked()}
              >
                {creatingWorkingFromLocked ? 'Creating…' : 'Create job workbook'}
              </Button>
            </div>
          )}

        {workbook &&
          !quoteContractFrozen &&
          !snapshotWorkbookId &&
          workbook.status === 'locked' && (
            <div className="rounded-lg border p-3 px-3 flex flex-col gap-2 text-sm border-amber-300 bg-amber-50 text-amber-950 mb-2">
              <div className="flex flex-wrap items-center gap-2">
                <Lock className="w-4 h-4 shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-wide text-amber-800 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded">
                  Proposal workbook only
                </span>
                <span className="font-semibold">No job workbook yet</span>
                <Badge variant="outline" className="bg-white/80">
                  v{workbook.version_number}
                </Badge>
              </div>
              <p className="text-xs opacity-90 pl-6">
                Add a job workbook for crew orders, shop status, and field edits — internal only; this proposal workbook stays the customer pricing source.
              </p>
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs w-fit gradient-primary"
                disabled={creatingWorkingFromLocked}
                onClick={() => createWorkingFromLatestLocked()}
              >
                {creatingWorkingFromLocked ? 'Creating…' : 'Create job workbook from proposal workbook'}
              </Button>
            </div>
          )}

        <TabsContent value="manage" className="space-y-3 flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
          {!workbook ? (
            showDocumentViewer ? (
              <div className="flex-1 min-h-0 flex flex-col min-h-[min(70vh,560px)] rounded-lg border border-slate-200 overflow-hidden bg-slate-50 shadow-sm">
                <FloatingDocumentViewer
                  jobId={job.id}
                  open={true}
                  onClose={() => setShowDocumentViewer(false)}
                  embed
                  backLabel="Back"
                />
              </div>
            ) : (
              <Card className="w-full">
                <CardContent className="py-12 text-center">
                  <FileSpreadsheet className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-semibold mb-2">No Material Workbook</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    There is no workbook yet for this job{jobQuotes.length > 1 && effectiveQuoteId ? ' and proposal' : ''}. Workbooks are stored per job (and per proposal when you have multiple).
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Open <strong>PDFs &amp; drawings</strong> from job documents here, or go to the <strong>Upload</strong> tab to create a workbook.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowDocumentViewer(true)}
                      className="border-blue-300 text-blue-800 hover:bg-blue-50"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      View PDFs &amp; documents
                    </Button>
                    <Button onClick={() => setActiveTab('upload')} className="gradient-primary">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Workbook
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          ) : showDocumentViewer ? (
            <div className="flex-1 min-h-0 flex flex-col min-h-[min(70vh,560px)] rounded-lg border border-slate-200 overflow-hidden bg-slate-50 shadow-sm">
              <FloatingDocumentViewer
                jobId={job.id}
                open={true}
                onClose={() => setShowDocumentViewer(false)}
                embed
                backLabel="Back to Workbook"
              />
            </div>
          ) : (
            <>
              <Card className="border-2 w-full flex-1 min-h-0 flex flex-col overflow-hidden">
                <CardContent className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
                  {/* Sheets + workbook actions in one white toolbar (sheet tabs sit with Move / Sort / etc.) */}
                  <div className="p-1.5 bg-white border-b flex flex-col gap-1.5 min-w-0">
                    <div className="flex items-center gap-1 min-h-[28px] overflow-x-auto overflow-y-hidden pb-0.5 border-b border-slate-200/80">
                      {workbook.sheets.map((sheet, idx) => {
                        const isChangeOrder = sheet.sheet_type === 'change_order';
                        const prevIsProposal = idx > 0 && workbook.sheets[idx - 1].sheet_type !== 'change_order';
                        return (
                        <Fragment key={sheet.id}>
                          {isChangeOrder && prevIsProposal && (
                            <span className="flex-shrink-0 px-2 py-1 text-[10px] font-semibold text-amber-700 bg-amber-50 rounded border border-amber-200">
                              Change orders
                            </span>
                          )}
                        <div className="group/tab relative flex-shrink-0 pr-1 border-r border-slate-300/80 last:border-r-0 flex items-center gap-1">
                          {sheetNameEdit?.sheetId === sheet.id ? (
                            <Input
                              autoFocus
                              disabled={savingSheetRename}
                              className="h-7 min-w-[120px] max-w-[min(280px,40vw)] text-sm font-bold text-slate-900 border-primary/60 ring-1 ring-primary/20 bg-white px-2"
                              value={sheetNameEdit.value}
                              onChange={(e) =>
                                setSheetNameEdit((p) => (p ? { ...p, value: e.target.value } : null))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  skipSheetRenameBlurRef.current = true;
                                  void finalizeSheetRename();
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  skipSheetRenameBlurRef.current = true;
                                  setSheetNameEdit(null);
                                }
                              }}
                              onBlur={() => {
                                if (skipSheetRenameBlurRef.current) {
                                  skipSheetRenameBlurRef.current = false;
                                  return;
                                }
                                void finalizeSheetRename();
                              }}
                            />
                          ) : (
                            <Button
                              variant={activeSheetId === sheet.id ? 'default' : 'ghost'}
                              size="sm"
                              onClick={() => handleSheetChange(sheet.id)}
                              onDoubleClick={(e) => {
                                if (workbook.status !== 'working' || isWorkbookReadOnly) return;
                                e.stopPropagation();
                                e.preventDefault();
                                if (activeSheetId !== sheet.id) handleSheetChange(sheet.id);
                                setSheetDeleteConfirmId(null);
                                setSheetNameEdit({
                                  sheetId: sheet.id,
                                  oldName: sheet.sheet_name,
                                  value: sheet.sheet_name,
                                });
                              }}
                              title={
                                workbook.status === 'working' && !isWorkbookReadOnly
                                  ? `${sheet.sheet_name} — double-click to rename`
                                  : sheet.sheet_name
                              }
                              className={`flex items-center gap-1 min-w-[100px] max-w-[min(280px,40vw)] justify-start h-7 px-2.5 text-sm leading-tight ${
                                activeSheetId === sheet.id
                                  ? 'font-bold text-slate-900 bg-slate-100 shadow-sm border-2 border-primary/90 ring-1 ring-primary/20 hover:bg-slate-100'
                                  : 'font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100/80 border border-transparent'
                              }`}
                            >
                              <span className="truncate">{sheet.sheet_name}</span>
                            </Button>
                          )}
                          {workbook.status === 'working' && activeSheetId === sheet.id && sheetNameEdit?.sheetId !== sheet.id && (
                            sheetDeleteConfirmId === sheet.id ? (
                              <div className="flex items-center gap-0.5 shrink-0 animate-in fade-in duration-150">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-[10px]"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSheetDeleteConfirmId(null);
                                  }}
                                  title="Cancel deletion"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  className="h-7 px-2 text-[10px]"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void deleteSheet(sheet);
                                  }}
                                  title={`Permanently delete "${sheet.sheet_name}" and ${sheet.items.length} material line(s)`}
                                >
                                  Delete
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-0.5 shrink-0 opacity-0 transition-opacity duration-150 group-hover/tab:opacity-100 focus-within:opacity-100">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSheetDeleteConfirmId(null);
                                    setSheetNameEdit({
                                      sheetId: sheet.id,
                                      oldName: sheet.sheet_name,
                                      value: sheet.sheet_name,
                                    });
                                  }}
                                  className="h-7 w-7 p-0 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-md shadow-sm"
                                  title="Rename this sheet"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSheetDeleteConfirmId(sheet.id);
                                  }}
                                  className="h-7 w-7 p-0 bg-red-500 hover:bg-red-600 text-white rounded-md shadow-sm"
                                  title="Delete this sheet — click, then confirm Delete"
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            )
                          )}
                        </div>
                        </Fragment>
                      ); })}

                      {workbook.status === 'working' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (sheetTypeFilter === 'change_order' && !jobHasContract) {
                              toast.error('Set the main proposal as contract before adding change orders.');
                              return;
                            }
                            setNewSheetType(sheetTypeFilter === 'change_order' ? 'change_order' : 'proposal');
                            setShowAddSheetDialog(true);
                          }}
                          className="flex-shrink-0 border border-dashed border-blue-400 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold min-w-[90px] h-7 text-xs"
                        >
                          <Plus className="w-3 h-3 mr-0.5" />
                          Add {sheetTypeFilter === 'change_order' ? 'Change Order' : 'Sheet'}
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap bg-white text-right min-w-0">
                      <div className="relative w-48 max-w-[200px] flex-shrink-0">
                        <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Search materials..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-7 pr-7 h-7 text-xs"
                        />
                        {searchTerm && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSearchTerm('')}
                            className="absolute right-0.5 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                      {workbookActionButtons}
                      <div className="flex-1 min-w-4" />
                      {workbookActionButtonsRight}
                    </div>
                  </div>



                  <div className="overflow-x-auto flex-1 min-h-0">
                    {categoryGroups.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        <FileSpreadsheet className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>No materials in this sheet</p>
                      </div>
                    ) : (
                      <div className="w-full text-xs">
                        <table className="border-collapse w-full">
                        <thead className="bg-gradient-to-r from-slate-800 to-slate-700 text-white sticky top-0 z-10">
                          <tr>
                            {(packageSelectionMode || bulkMoveMode) && (
                              <th className="text-center p-1 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap w-6">
                                <CheckSquare className="w-3 h-3 mx-auto" />
                              </th>
                            )}
                            <th className="text-center p-1 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap w-16 max-w-[4rem]">Pkg</th>
                            <th className="text-left p-1 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap">SKU</th>
                            <th className="text-left p-1 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap">Material</th>
                            <th className="text-center p-1 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap w-12">Usage</th>
                            <th className="text-center p-1 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap w-12">Length</th>
                            <th className="text-center p-1 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap w-10">Qty</th>
                            <th className="text-center p-1 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap w-14">Color</th>
                            <th className="text-right p-1 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap w-14">Cost/Unit</th>
                            <th className="text-center p-0.5 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap w-12">Markup %</th>
                            <th className="text-right p-1 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap w-16">Price/Unit</th>
                            <th className="text-right p-1 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap w-16">Total</th>
                            <th className="text-center p-1 text-[10px] font-bold border-r border-slate-600 whitespace-nowrap w-14">Status</th>
                            <th className="text-center p-1 text-[10px] font-bold whitespace-nowrap w-14">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {categoryGroups.map((catGroup, catIndex) => (
                            <>
                              <tr key={`cat-${catIndex}`} className="bg-gradient-to-r from-indigo-100 to-indigo-50 border-y border-indigo-300">
                                <td colSpan={packageSelectionMode ? 14 : 13} className="p-1">
                                  {(() => {
                                    const footPrice = getCategoryFootPrice(catGroup);
                                    return (
                                  <div className="flex items-center justify-between flex-wrap gap-1">
                                    <div className="flex items-center gap-1">
                                      <FileSpreadsheet className="w-3 h-3 text-indigo-700" />
                                      {categoryNameEdit?.sheetId === activeSheet?.id &&
                                      categoryNameEdit.oldName === catGroup.category ? (
                                        <Input
                                          autoFocus
                                          disabled={savingCategoryRename}
                                          className="h-6 w-[min(12rem,100%)] min-w-[6rem] text-xs font-bold text-indigo-900 border-indigo-400"
                                          value={categoryNameEdit.value}
                                          onChange={(e) =>
                                            setCategoryNameEdit((p) =>
                                              p ? { ...p, value: e.target.value } : null
                                            )
                                          }
                                          onBlur={() => {
                                            if (skipCategoryRenameBlurRef.current) {
                                              skipCategoryRenameBlurRef.current = false;
                                              return;
                                            }
                                            void finalizeCategoryRename();
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              void finalizeCategoryRename();
                                            } else if (e.key === 'Escape') {
                                              e.preventDefault();
                                              skipCategoryRenameBlurRef.current = true;
                                              setCategoryNameEdit(null);
                                            }
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                        />
                                      ) : (
                                        <h3
                                          className={`font-bold text-xs text-indigo-900 ${
                                            materialsWorkbookLocked
                                              ? ''
                                              : 'cursor-pointer hover:underline decoration-indigo-600/60'
                                          }`}
                                          title={
                                            materialsWorkbookLocked
                                              ? undefined
                                              : 'Click to rename category'
                                          }
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (materialsWorkbookLocked || !activeSheet) return;
                                            setCategoryFootPriceEdit(null);
                                            setCategoryNameEdit({
                                              sheetId: activeSheet.id,
                                              oldName: catGroup.category,
                                              value: catGroup.category,
                                            });
                                          }}
                                        >
                                          {catGroup.category}
                                        </h3>
                                      )}
                                      <Badge variant="outline" className="bg-white text-[10px] px-1">
                                        {catGroup.items.length} items
                                      </Badge>
                                      {bulkMoveMode && catGroup.items.length > 0 && (() => {
                                        const ids = catGroup.items.map((i) => i.id);
                                        const selectedInCat = ids.filter((id) => selectedMaterialsForMove.has(id)).length;
                                        const allSelected = selectedInCat === ids.length;
                                        const someSelected = selectedInCat > 0 && !allSelected;
                                        return (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleCategoryForMove(catGroup);
                                            }}
                                            className={`h-6 text-[10px] px-2 border-orange-400 ${
                                              allSelected
                                                ? 'bg-orange-500 text-white hover:bg-orange-600'
                                                : someSelected
                                                ? 'bg-orange-100 text-orange-900 hover:bg-orange-200'
                                                : 'bg-white text-orange-800 hover:bg-orange-50'
                                            }`}
                                            title={
                                              allSelected
                                                ? `Deselect all ${ids.length} items in ${catGroup.category}`
                                                : `Select all ${ids.length} items in ${catGroup.category}`
                                            }
                                          >
                                            {allSelected ? (
                                              <CheckSquare className="w-3 h-3 mr-1" />
                                            ) : (
                                              <Square className="w-3 h-3 mr-1" />
                                            )}
                                            {allSelected
                                              ? `Deselect all`
                                              : someSelected
                                              ? `Select all (${selectedInCat}/${ids.length})`
                                              : `Select all`}
                                          </Button>
                                        );
                                      })()}
                                    </div>
                                    {catGroup.category === 'Metal' && categoryHasLinealFootPricing(catGroup) && (
                                      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                                        <span className="text-[10px] font-medium text-indigo-800 whitespace-nowrap">Lineal ft:</span>
                                        {categoryFootPriceEdit?.category === catGroup.category ? (
                                          <>
                                            <div className="flex items-center gap-1">
                                              <Label className="text-[10px] text-indigo-700 whitespace-nowrap">Cost $</Label>
                                              <Input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                className="h-6 w-16 text-[10px] px-1"
                                                value={categoryFootPriceEdit.costPerFoot}
                                                onChange={(e) => {
                                                  const v = e.target.value;
                                                  setCategoryFootPriceEdit((prev) => {
                                                    if (!prev) return null;
                                                    const next = { ...prev, costPerFoot: v };
                                                    if (catGroup.category === 'Metal') {
                                                      const c = parseFloat(v);
                                                      if (Number.isFinite(c)) next.pricePerFoot = (c + 0.1).toFixed(2);
                                                    }
                                                    return next;
                                                  });
                                                }}
                                                onBlur={() => {
                                                  const cost = parseFloat(categoryFootPriceEdit?.costPerFoot ?? '');
                                                  const price = parseFloat(categoryFootPriceEdit?.pricePerFoot ?? '');
                                                  if (Number.isFinite(cost) || Number.isFinite(price)) {
                                                    applyCategoryFootPrice(catGroup, Number.isFinite(cost) ? cost : null, Number.isFinite(price) ? price : null);
                                                  }
                                                }}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    const cost = parseFloat(categoryFootPriceEdit?.costPerFoot ?? '');
                                                    const price = parseFloat(categoryFootPriceEdit?.pricePerFoot ?? '');
                                                    applyCategoryFootPrice(catGroup, Number.isFinite(cost) ? cost : null, Number.isFinite(price) ? price : null);
                                                  }
                                                }}
                                              />
                                              <span className="text-[10px] text-indigo-600">/ft</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                              <Label className="text-[10px] text-indigo-700 whitespace-nowrap">Price $</Label>
                                              <Input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                className="h-6 w-16 text-[10px] px-1"
                                                value={categoryFootPriceEdit.pricePerFoot}
                                                onChange={(e) => setCategoryFootPriceEdit((prev) => (prev ? { ...prev, pricePerFoot: e.target.value } : null))}
                                                onBlur={() => {
                                                  const cost = parseFloat(categoryFootPriceEdit?.costPerFoot ?? '');
                                                  const price = parseFloat(categoryFootPriceEdit?.pricePerFoot ?? '');
                                                  if (Number.isFinite(cost) || Number.isFinite(price)) {
                                                    applyCategoryFootPrice(catGroup, Number.isFinite(cost) ? cost : null, Number.isFinite(price) ? price : null);
                                                  }
                                                }}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    const cost = parseFloat(categoryFootPriceEdit?.costPerFoot ?? '');
                                                    const price = parseFloat(categoryFootPriceEdit?.pricePerFoot ?? '');
                                                    applyCategoryFootPrice(catGroup, Number.isFinite(cost) ? cost : null, Number.isFinite(price) ? price : null);
                                                  }
                                                }}
                                              />
                                              <span className="text-[10px] text-indigo-600">/ft</span>
                                            </div>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="h-6 text-[10px] px-1.5"
                                              onClick={() => {
                                                const cost = parseFloat(categoryFootPriceEdit?.costPerFoot ?? '');
                                                const price = parseFloat(categoryFootPriceEdit?.pricePerFoot ?? '');
                                                applyCategoryFootPrice(catGroup, Number.isFinite(cost) ? cost : null, Number.isFinite(price) ? price : null);
                                              }}
                                            >
                                              Apply
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              className="h-6 text-[10px] px-1"
                                              onClick={() => setCategoryFootPriceEdit(null)}
                                            >
                                              <X className="w-3 h-3" />
                                            </Button>
                                          </>
                                        ) : (
                                          <span
                                            className={`text-[10px] text-indigo-700 flex items-center gap-1.5 ${
                                              materialsWorkbookLocked && catGroup.category === 'Metal'
                                                ? 'cursor-default'
                                                : 'hover:text-indigo-900 hover:underline cursor-pointer'
                                            }`}
                                            onClick={() => {
                                              if (materialsWorkbookLocked) return;
                                              const { costPerFoot, pricePerFoot } = getCategoryFootPrice(catGroup);
                                              setCategoryFootPriceEdit({
                                                category: catGroup.category,
                                                costPerFoot: costPerFoot != null ? String(costPerFoot) : '',
                                                pricePerFoot: pricePerFoot != null ? String(pricePerFoot) : '',
                                              });
                                            }}
                                            title={
                                              catGroup.category === 'Metal'
                                                ? materialsWorkbookLocked
                                                  ? 'Metal PLF from SKU (import); locked workbook — open job workbook to edit'
                                                  : 'Click to edit lineal ft cost/price for all Metal items'
                                                : undefined
                                            }
                                          >
                                            <DollarSign className="w-3 h-3" />
                                            Cost {footPrice.costPerFoot != null ? `$${footPrice.costPerFoot.toFixed(2)}` : '—'}/ft
                                            <span className="text-slate-400">|</span>
                                            Price {footPrice.pricePerFoot != null ? `$${footPrice.pricePerFoot.toFixed(2)}` : '—'}/ft
                                            {!materialsWorkbookLocked && <Pencil className="w-2.5 h-2.5" />}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    <div className="flex gap-1">
                                      {showShopOrderControls && (
                                        <Button
                                          size="sm"
                                          onClick={() => openZohoOrderDialogForCategory(catGroup.items)}
                                          className="h-6 text-[10px] bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white px-2"
                                        >
                                          <ShoppingCart className="w-2.5 h-2.5 mr-0.5" />
                                          Order All
                                        </Button>
                                      )}
                                      {isTrimMaterialCategory(catGroup.category) &&
                                        workbookTrimLinesForPdfExport.length > 0 && (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={openTrimPdfExportDialog}
                                            className="h-6 text-[10px] px-2 border-indigo-300 bg-white hover:bg-indigo-50 text-indigo-900"
                                          >
                                            <Download className="w-2.5 h-2.5 mr-0.5" />
                                            Export trim PDF
                                          </Button>
                                        )}
                                      <Button
                                        size="sm"
                                        onClick={() => openAddDialog(catGroup.category)}
                                        className="h-6 text-[10px] bg-indigo-600 hover:bg-indigo-700 px-2"
                                        disabled={materialsWorkbookLocked}
                                      >
                                        <Plus className="w-2.5 h-2.5 mr-0.5" />
                                        Add to {catGroup.category}
                                      </Button>
                                    </div>
                                  </div>
                                    );
                                  })()}
                                </td>
                              </tr>
                              {catGroup.items.map((item, itemIndex) => {
                                const markupPercent = (() => {
                                  if (item.category === 'Metal') {
                                    const c = getMetalCostPerFootDisplay(item);
                                    const p = getMetalPricePerFootDisplay(item);
                                    if (c != null && p != null && c > 0) return calculateMarkupPercent(c, p);
                                  }
                                  return calculateMarkupPercent(item.cost_per_unit, item.price_per_unit);
                                })();
                                const isEven = itemIndex % 2 === 0;
                                const isEditingThisCell = (field: string) => 
                                  editingCell?.itemId === item.id && editingCell?.field === field;
                                const materialPackageNames = getMaterialPackageNames(item.id);
                                
                                return (
                                  <tr
                                    key={item.id}
                                    className={`border-b transition-colors ${
                                      packageSelectionMode && selectedMaterialsForPackageAdd.has(item.id)
                                        ? 'bg-blue-100 hover:bg-blue-200'
                                        : bulkMoveMode && selectedMaterialsForMove.has(item.id)
                                        ? 'bg-orange-100 hover:bg-orange-200'
                                        : `hover:bg-blue-50 ${isEven ? 'bg-white' : 'bg-slate-50/50'}`
                                    }`}
                                  >
                                    {packageSelectionMode && (
                                      <td className="p-1 border-r whitespace-nowrap">
                                        <div className="flex items-center justify-center">
                                          <Checkbox
                                            checked={selectedMaterialsForPackageAdd.has(item.id)}
                                            onCheckedChange={() => toggleMaterialForPackageAdd(item.id)}
                                            disabled={isMaterialInAnyPackage(item.id)}
                                          />
                                        </div>
                                      </td>
                                    )}
                                    {bulkMoveMode && (
                                      <td className="p-1 border-r whitespace-nowrap">
                                        <div className="flex items-center justify-center">
                                          <Checkbox
                                            checked={selectedMaterialsForMove.has(item.id)}
                                            onCheckedChange={() => toggleMaterialForMove(item.id)}
                                          />
                                        </div>
                                      </td>
                                    )}
                                    <td className="p-1 border-r whitespace-nowrap w-20 max-w-[5rem]">
                                      <div className="min-w-0">
                                        <Select
                                          value=""
                                          onValueChange={(value) => {
                                            if (value.startsWith('remove-')) {
                                              const packageId = value.replace('remove-', '');
                                              removeMaterialFromPackage(item.id, packageId);
                                            } else {
                                              addMaterialToPackage(item.id, value);
                                            }
                                          }}
                                        >
                                          <SelectTrigger className="h-6 text-[10px] border bg-white w-full max-w-[4rem] [&>svg]:hidden justify-start">
                                            <span className="truncate min-w-0 block text-left">
                                              {materialPackageNames.length > 0 ? materialPackageNames.join(', ') : '–'}
                                            </span>
                                          </SelectTrigger>
                                          <SelectContent>
                                            {materialPackageNames.length > 0 && (
                                              <>
                                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                                  Current Packages:
                                                </div>
                                                {packages
                                                  .filter(pkg => 
                                                    pkg.bundle_items?.some((bundleItem: any) => bundleItem.material_item_id === item.id)
                                                  )
                                                  .map(pkg => (
                                                    <SelectItem 
                                                      key={`remove-${pkg.id}`} 
                                                      value={`remove-${pkg.id}`}
                                                      className="text-red-600"
                                                    >
                                                      <div className="flex items-center gap-2">
                                                        <X className="w-3 h-3" />
                                                        Remove from {pkg.name}
                                                      </div>
                                                    </SelectItem>
                                                  ))
                                                }
                                                <div className="h-px bg-border my-1" />
                                              </>
                                            )}
                                            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                              Add to Package:
                                            </div>
                                            {packages
                                              .filter(pkg => 
                                                !pkg.bundle_items?.some((bundleItem: any) => bundleItem.material_item_id === item.id)
                                              )
                                              .map(pkg => (
                                                <SelectItem key={pkg.id} value={pkg.id}>
                                                  <div className="flex items-center gap-2">
                                                    <Package className="w-3 h-3" />
                                                    {pkg.name}
                                                  </div>
                                                </SelectItem>
                                              ))
                                            }
                                            {packages.length === 0 && (
                                              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                                                No packages created yet
                                              </div>
                                            )}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </td>
                                    <td className="p-1 border-r whitespace-nowrap">
                                      <div className="font-mono text-xs text-muted-foreground p-1 min-h-[24px]">
                                        {item.sku || '–'}
                                      </div>
                                    </td>
                                    <td className="p-1 border-r whitespace-nowrap">
                                      {isEditingThisCell('material_name') ? (
                                        <Input
                                          value={cellValue}
                                          onChange={(e) => setCellValue(e.target.value)}
                                          onBlur={() => saveCellEdit(item)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveCellEdit(item);
                                            if (e.key === 'Escape') cancelCellEdit();
                                          }}
                                          autoFocus
                                          className="h-7 text-sm"
                                        />
                                      ) : (
                                        <div 
                                          onClick={() => startCellEdit(item.id, 'material_name', item.material_name)}
                                          className="font-medium text-sm cursor-pointer hover:bg-blue-100 p-1 rounded min-h-[24px] max-w-[360px]"
                                        >
                                          {item.material_name}
                                          {item.notes && (
                                            <div className="text-xs text-muted-foreground mt-0.5">{item.notes}</div>
                                          )}
                                        </div>
                                      )}
                                    </td>

                                    <td className="p-1 border-r whitespace-nowrap">
                                      {isEditingThisCell('usage') ? (
                                        <Input
                                          value={cellValue}
                                          onChange={(e) => setCellValue(e.target.value)}
                                          onBlur={() => saveCellEdit(item)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveCellEdit(item);
                                            if (e.key === 'Escape') cancelCellEdit();
                                          }}
                                          autoFocus
                                          className="h-6 text-xs text-center"
                                          placeholder="pcs, Bag, etc."
                                        />
                                      ) : (
                                        <div
                                          onClick={() => startCellEdit(item.id, 'usage', item.usage ?? '')}
                                          className="text-center text-xs cursor-pointer hover:bg-blue-100 p-1 rounded min-h-[24px]"
                                        >
                                          {item.usage || '–'}
                                        </div>
                                      )}
                                    </td>

                                    <td className="p-1 border-r whitespace-nowrap">
                                      {isEditingThisCell('length') ? (
                                        <Input
                                          value={cellValue}
                                          onChange={(e) => setCellValue(e.target.value)}
                                          onBlur={() => saveCellEdit(item)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveCellEdit(item);
                                            if (e.key === 'Escape') cancelCellEdit();
                                          }}
                                          autoFocus
                                          className="h-6 text-xs text-center"
                                        />
                                      ) : (
                                        <div
                                          onClick={() => startCellEdit(item.id, 'length', item.length)}
                                          className="text-center text-xs cursor-pointer hover:bg-blue-100 p-1 rounded min-h-[24px]"
                                        >
                                          {(() => {
                                            const raw = item.length != null && item.length !== '' ? String(item.length).trim() : '';
                                            const unitLike = /^(pcs|pc|bag|bags|lf|ft|piece|pieces|ea|each|units?|linear\s*ft)$/i;
                                            const isLength = raw && !unitLike.test(raw);
                                            return isLength ? raw : '-';
                                          })()}
                                        </div>
                                      )}
                                    </td>

                                    <td className="p-1 border-r whitespace-nowrap">
                                      {isEditingThisCell('quantity') ? (
                                        <Input
                                          type="number"
                                          value={cellValue}
                                          onChange={(e) => setCellValue(e.target.value)}
                                          onBlur={() => saveCellEdit(item)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveCellEdit(item);
                                            if (e.key === 'Escape') cancelCellEdit();
                                          }}
                                          autoFocus
                                          onFocus={(e) => e.target.select()}
                                          className="h-6 text-xs text-center min-w-[3rem] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                      ) : (
                                        <div
                                          onClick={() => startCellEdit(item.id, 'quantity', item.quantity)}
                                          className="text-center font-semibold text-xs cursor-pointer hover:bg-blue-100 p-1 rounded min-h-[24px]"
                                        >
                                          {item.quantity}
                                        </div>
                                      )}
                                    </td>

                                    <td className="p-1 border-r whitespace-nowrap">
                                      {isEditingThisCell('color') ? (
                                        <Input
                                          value={cellValue}
                                          onChange={(e) => setCellValue(e.target.value)}
                                          onBlur={() => saveCellEdit(item)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveCellEdit(item);
                                            if (e.key === 'Escape') cancelCellEdit();
                                          }}
                                          autoFocus
                                          className="h-6 text-xs text-center"
                                        />
                                      ) : (
                                        <div
                                          onClick={() => startCellEdit(item.id, 'color', item.color)}
                                          className="text-center text-xs cursor-pointer hover:bg-blue-100 p-1 rounded min-h-[24px]"
                                        >
                                          {item.color || '-'}
                                        </div>
                                      )}
                                    </td>

                                    <td className="p-1 border-r whitespace-nowrap">
                                      {isEditingThisCell('cost_per_unit') ? (
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={cellValue}
                                          onChange={(e) => setCellValue(e.target.value)}
                                          onBlur={() => saveCellEdit(item)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveCellEdit(item);
                                            if (e.key === 'Escape') cancelCellEdit();
                                          }}
                                          autoFocus
                                          onFocus={(e) => e.target.select()}
                                          className="h-6 text-xs text-right min-w-[4rem] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                      ) : (
                                        <div
                                          onClick={() => {
                                            if (materialsWorkbookLocked && item.category === 'Metal' && getMetalPlf(item)) return;
                                            const seed =
                                              item.category === 'Metal'
                                                ? (item.cost_per_unit ?? getMetalPlf(item)?.costPerFoot)
                                                : item.cost_per_unit;
                                            startCellEdit(item.id, 'cost_per_unit', seed);
                                          }}
                                          className={`text-right font-mono text-xs p-1 rounded min-h-[24px] ${
                                            item.category === 'Metal' && getMetalPlf(item) && materialsWorkbookLocked
                                              ? 'cursor-default'
                                              : 'cursor-pointer hover:bg-blue-100'
                                          }`}
                                          title={
                                            item.category === 'Metal' && getMetalPlf(item) && materialsWorkbookLocked
                                              ? 'Cost per piece from SKU (cost/ft × length); locked workbook'
                                              : item.category === 'Metal' && parseLengthToFeet(item.length) != null
                                                ? 'Cost per piece (cost/ft × length); click to edit $/ft'
                                                : undefined
                                          }
                                        >
                                          {(() => {
                                            const lengthFeet = item.category === 'Metal' ? parseLengthToFeet(item.length) : null;
                                            const costFt = getMetalCostPerFootDisplay(item);
                                            if (item.category === 'Metal' && costFt != null && lengthFeet != null && lengthFeet > 0) {
                                              return `$${(costFt * lengthFeet).toFixed(2)}`;
                                            }
                                            if (item.cost_per_unit != null) {
                                              const perPiece = lengthFeet != null && lengthFeet > 0 ? item.cost_per_unit * lengthFeet : item.cost_per_unit;
                                              return `$${perPiece.toFixed(2)}`;
                                            }
                                            return '-';
                                          })()}
                                        </div>
                                      )}
                                    </td>

                                    <td className="p-0.5 border-r whitespace-nowrap">
                                      {isEditingThisCell('markup_percent') ? (
                                        <div className="flex items-center gap-0.5 px-1">
                                          <Input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            max="999"
                                            value={cellValue}
                                            onChange={(e) => setCellValue(e.target.value)}
                                            onBlur={() => saveCellEdit(item)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') { e.preventDefault(); saveCellEdit(item); }
                                              if (e.key === 'Escape') { e.preventDefault(); cancelCellEdit(); }
                                            }}
                                            autoFocus
                                            onFocus={(e) => e.target.select()}
                                            className="h-6 text-xs text-center min-w-[3.5rem] w-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            placeholder="0"
                                          />
                                          <span className="text-[10px] text-muted-foreground shrink-0">%</span>
                                        </div>
                                      ) : (
                                        <div
                                          onClick={() => {
                                            if (item.category === 'Metal' && getMetalPlf(item) && materialsWorkbookLocked) return;
                                            const displayMarkup =
                                              item.category === 'Metal' &&
                                              getMetalCostPerFootDisplay(item) != null &&
                                              getMetalPricePerFootDisplay(item) != null &&
                                              (getMetalCostPerFootDisplay(item) ?? 0) > 0
                                                ? calculateMarkupPercent(
                                                    getMetalCostPerFootDisplay(item)!,
                                                    getMetalPricePerFootDisplay(item)!,
                                                  )
                                                : item.cost_per_unit != null && item.cost_per_unit > 0 && item.price_per_unit != null
                                                  ? calculateMarkupPercent(item.cost_per_unit, item.price_per_unit)
                                                  : item.markup_percent != null
                                                    ? item.markup_percent * 100
                                                    : 0;
                                            startCellEdit(item.id, 'markup_percent', displayMarkup.toFixed(1));
                                          }}
                                          className={`py-0.5 px-1 rounded min-h-[22px] flex items-center justify-center text-xs ${
                                            item.category === 'Metal' && getMetalPlf(item) && materialsWorkbookLocked
                                              ? 'cursor-default'
                                              : 'cursor-pointer hover:bg-blue-100'
                                          }`}
                                          title={
                                            item.category === 'Metal' && getMetalPlf(item) && materialsWorkbookLocked
                                              ? 'Markup from SKU (import); locked workbook'
                                              : 'Click to edit markup %'
                                          }
                                        >
                                          {(item.cost_per_unit != null && item.cost_per_unit > 0 && item.price_per_unit != null) || (item.markup_percent != null && item.markup_percent > 0) || markupPercent > 0 ? (
                                            <Badge variant="outline" className="font-semibold text-xs px-2 py-0.5 border-slate-200 bg-slate-50 text-slate-700">
                                              <Percent className="w-3 h-3 mr-1" />
                                              {(() => {
                                                const cFt = getMetalCostPerFootDisplay(item);
                                                const pFt = getMetalPricePerFootDisplay(item);
                                                const val =
                                                  cFt != null && pFt != null && cFt > 0
                                                    ? calculateMarkupPercent(cFt, pFt)
                                                    : item.cost_per_unit != null && item.cost_per_unit > 0 && item.price_per_unit != null
                                                      ? markupPercent
                                                      : item.markup_percent != null
                                                        ? item.markup_percent * 100
                                                        : markupPercent;
                                                return val % 1 === 0 ? val.toFixed(0) : val.toFixed(1);
                                              })()}
                                            </Badge>
                                          ) : (
                                            <span className="text-[10px] text-muted-foreground">Set</span>
                                          )}
                                        </div>
                                      )}
                                    </td>

                                    <td className="p-1 border-r whitespace-nowrap">
                                      {isEditingThisCell('price_per_unit') ? (
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={cellValue}
                                          onChange={(e) => setCellValue(e.target.value)}
                                          onBlur={() => saveCellEdit(item)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveCellEdit(item);
                                            if (e.key === 'Escape') cancelCellEdit();
                                          }}
                                          autoFocus
                                          onFocus={(e) => e.target.select()}
                                          className="h-6 text-xs text-right min-w-[4rem] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                      ) : (
                                        <div
                                          onClick={() => {
                                            if (materialsWorkbookLocked && item.category === 'Metal' && getMetalPlf(item)) return;
                                            const seed =
                                              item.category === 'Metal'
                                                ? (item.price_per_unit ?? getMetalPlf(item)?.pricePerFoot)
                                                : item.price_per_unit;
                                            startCellEdit(item.id, 'price_per_unit', seed);
                                          }}
                                          className={`text-right font-mono text-xs p-1 rounded min-h-[24px] ${
                                            item.category === 'Metal' && getMetalPlf(item) && materialsWorkbookLocked
                                              ? 'cursor-default'
                                              : 'cursor-pointer hover:bg-blue-100'
                                          }`}
                                          title={
                                            item.category === 'Metal' && getMetalPlf(item) && materialsWorkbookLocked
                                              ? 'Price per piece from SKU (price/ft × length); locked workbook'
                                              : item.category === 'Metal' && parseLengthToFeet(item.length) != null
                                                ? 'Price per piece (price/ft × length); click to edit $/ft'
                                                : undefined
                                          }
                                        >
                                          {(() => {
                                            const lengthFeet = item.category === 'Metal' ? parseLengthToFeet(item.length) : null;
                                            const priceFt = getMetalPricePerFootDisplay(item);
                                            if (item.category === 'Metal' && priceFt != null && lengthFeet != null && lengthFeet > 0) {
                                              return `$${(priceFt * lengthFeet).toFixed(2)}`;
                                            }
                                            if (item.price_per_unit != null) {
                                              const perPiece = lengthFeet != null && lengthFeet > 0 ? item.price_per_unit * lengthFeet : item.price_per_unit;
                                              return `$${perPiece.toFixed(2)}`;
                                            }
                                            return '-';
                                          })()}
                                        </div>
                                      )}
                                    </td>

                                    <td className="p-1 text-right border-r">
                                      <div className="font-bold text-xs text-green-700">
                                        {(() => {
                                          const { price } = getDisplayExtended(item);
                                          return price !== 0 ? `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';
                                        })()}
                                      </div>
                                    </td>

                                    <td className="p-1 border-r whitespace-nowrap">
                                      {showShopOrderControls ? (
                                        <Select
                                          value={item.status || 'not_ordered'}
                                          onValueChange={(value) => updateStatus(item.id, value)}
                                        >
                                          <SelectTrigger className={`h-6 text-[10px] font-semibold border ${getStatusColor(item.status || 'not_ordered')}`}>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="not_ordered">Not Ordered</SelectItem>
                                            <SelectItem value="ordered">Ordered</SelectItem>
                                            <SelectItem value="received">Received</SelectItem>
                                            <SelectItem value="pull_from_shop">Pull from Shop</SelectItem>
                                            <SelectItem value="ready_for_job">Ready for Job</SelectItem>
                                            <SelectItem value="at_job">At Job</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      ) : (
                                        <div
                                          className={`h-6 text-[10px] font-semibold border rounded-md px-2 flex items-center justify-center ${getStatusColor(item.status || 'not_ordered')}`}
                                          title="Shop status is only editable on the job workbook"
                                        >
                                          {formatStatusLabel(item.status || 'not_ordered')}
                                        </div>
                                      )}
                                    </td>

                                    <td className="p-0.5">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Actions">
                                            <MoreVertical className="w-4 h-4" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          {showShopOrderControls && (
                                            <DropdownMenuItem onClick={() => openZohoOrderDialogForMaterial(item)}>
                                              <ShoppingCart className="w-3.5 h-3.5 mr-2" />
                                              Create Zoho Order
                                            </DropdownMenuItem>
                                          )}
                                          <DropdownMenuItem onClick={() => setOpenPhotosForItem({ id: item.id, materialName: item.material_name })}>
                                            <ImageIcon className="w-3.5 h-3.5 mr-2" />
                                            Photos
                                          </DropdownMenuItem>
                                          <DropdownMenuItem onClick={() => setOpenLinkTrimForItem({ id: item.id, materialName: item.material_name, currentTrimConfigId: item.trim_saved_config_id ?? null })}>
                                            <Pencil className="w-3.5 h-3.5 mr-2" />
                                            {item.trim_saved_config_id ? 'View / change trim drawing' : 'Link trim drawing'}
                                          </DropdownMenuItem>
                                          <DropdownMenuItem onClick={() => openMoveItem(item)}>
                                            <MoveHorizontal className="w-3.5 h-3.5 mr-2" />
                                            Move
                                          </DropdownMenuItem>
                                          {!materialsWorkbookLocked && (
                                            <DropdownMenuItem
                                              onClick={() => deleteItem(item.id)}
                                              className="text-destructive focus:text-destructive"
                                            >
                                              <Trash2 className="w-3.5 h-3.5 mr-2" />
                                              Delete
                                            </DropdownMenuItem>
                                          )}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </td>
                                  </tr>
                                );
                              })}
                            </>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="breakdown" className="space-y-2">
          {!workbook ? (
            showDocumentViewer ? (
              <div className="flex-1 min-h-0 flex flex-col min-h-[min(70vh,560px)] rounded-lg border border-slate-200 overflow-hidden bg-slate-50 shadow-sm">
                <FloatingDocumentViewer
                  jobId={job.id}
                  open={true}
                  onClose={() => setShowDocumentViewer(false)}
                  embed
                  backLabel="Back"
                />
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <DollarSign className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-semibold mb-2">No Material Workbook</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create or upload a workbook on the <strong>Upload</strong> tab to view cost breakdown. You can still open job PDFs and documents below.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowDocumentViewer(true)}
                      className="border-blue-300 text-blue-800 hover:bg-blue-50"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      View PDFs &amp; documents
                    </Button>
                    <Button onClick={() => setActiveTab('upload')} className="gradient-primary">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Workbook
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          ) : (
            <Card className="border-2">
              <CardHeader className="bg-gradient-to-r from-slate-100 to-slate-50 border-b-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="w-6 h-6" />
                    Cost Breakdown
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-semibold">Sheet:</Label>
                    <Select value={activeSheetId} onValueChange={setActiveSheetId}>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {workbook.sheets.map(sheet => (
                          <SelectItem key={sheet.id} value={sheet.id}>
                            {sheet.sheet_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {(() => {
                  const sheet = workbook.sheets.find(s => s.id === activeSheetId);
                  if (!sheet || sheet.items.length === 0) {
                    return (
                      <div className="text-center py-12 text-muted-foreground">
                        <FileSpreadsheet className="w-16 h-16 mx-auto mb-3 opacity-50" />
                        <p>No materials in this sheet</p>
                      </div>
                    );
                  }

                  const totalCost = sheet.items.reduce((sum, item) => sum + getDisplayExtended(item).cost, 0);
                  const totalPrice = sheet.items.reduce((sum, item) => sum + getDisplayExtended(item).price, 0);
                  const totalProfit = totalPrice - totalCost;
                  const profitMargin = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
                  const categoryGroups = groupByCategory(sheet.items, sheet.category_order);

                  return (
                    <div className="space-y-6">
                      {/* Overall Totals */}
                      <div>
                        <h3 className="text-lg font-bold text-slate-900 mb-4">Overall Totals - {sheet.sheet_name}</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="bg-white rounded-lg p-6 border-2 border-slate-300 shadow-sm">
                            <div className="text-xs font-semibold text-muted-foreground mb-2">Total Cost</div>
                            <div className="text-3xl font-bold text-red-600">
                              ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                          <div className="bg-white rounded-lg p-6 border-2 border-green-500 shadow-sm">
                            <div className="text-xs font-semibold text-muted-foreground mb-2">Total Price</div>
                            <div className="text-3xl font-bold text-green-700">
                              ${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                          <div className="bg-white rounded-lg p-6 border-2 border-blue-500 shadow-sm">
                            <div className="text-xs font-semibold text-muted-foreground mb-2">Total Profit</div>
                            <div className="text-3xl font-bold text-blue-700">
                              ${totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                          <div className="bg-white rounded-lg p-6 border-2 border-purple-500 shadow-sm">
                            <div className="text-xs font-semibold text-muted-foreground mb-2">Profit Margin</div>
                            <div className="text-3xl font-bold text-purple-700 flex items-center gap-2">
                              <Percent className="w-6 h-6" />
                              {profitMargin.toFixed(1)}%
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Category Breakdown */}
                      <div>
                        <h4 className="text-lg font-bold text-slate-900 mb-4">Breakdown by Category</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {categoryGroups.map((catGroup) => {
                            const catCost = catGroup.items.reduce((sum, item) => sum + getDisplayExtended(item).cost, 0);
                            const catPrice = catGroup.items.reduce((sum, item) => sum + getDisplayExtended(item).price, 0);
                            const catProfit = catPrice - catCost;
                            const catMargin = catCost > 0 ? (catProfit / catCost) * 100 : 0;

                            return (
                              <div key={catGroup.category} className="border-2 rounded-lg p-4 bg-gradient-to-br from-white to-slate-50 shadow-sm hover:shadow-md transition-shadow">
                                <div className="flex items-center gap-2 mb-3">
                                  <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
                                  <div className="font-bold text-base text-slate-900">{catGroup.category}</div>
                                  <Badge variant="outline" className="ml-auto">
                                    {catGroup.items.length} items
                                  </Badge>
                                </div>
                                <div className="space-y-2 text-sm">
                                  <div className="flex justify-between items-center py-1">
                                    <span className="text-muted-foreground">Cost:</span>
                                    <span className="font-bold text-red-600">
                                      ${catCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center py-1">
                                    <span className="text-muted-foreground">Price:</span>
                                    <span className="font-bold text-green-600">
                                      ${catPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center py-1">
                                    <span className="text-muted-foreground">Profit:</span>
                                    <span className="font-bold text-blue-600">
                                      ${catProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center py-1 pt-2 border-t-2">
                                    <span className="font-semibold text-slate-700">Margin:</span>
                                    <span className="font-bold text-lg text-purple-600 flex items-center gap-1">
                                      <Percent className="w-4 h-4" />
                                      {catMargin.toFixed(1)}%
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="packages" className="space-y-2">
          <MaterialPackages jobId={job.id} userId={userId} workbook={workbook} job={job} />
        </TabsContent>

        <TabsContent value="crew-orders" className="space-y-2">
          <OfficeCrewOrders jobId={job.id} onCountChange={setPendingCrewCount} />
        </TabsContent>

        <TabsContent value="trim-flatstock" className="space-y-2 flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
          <Card className="border-2">
            <CardHeader className="pb-2 border-b">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Ruler className="w-5 h-5" />
                Trim &amp; flatstock order
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Counts are based on each trim piece: stretch-out determines strips across coil width, and trim piece length determines pieces cut per 10&apos; strip.
                The final column shows how many 10&apos; flatstock sticks to order per line.
              </p>
            </CardHeader>
            <CardContent className="pt-4">
              {!workbook ? (
                <p className="text-muted-foreground text-sm">No workbook. Upload or create one first.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <Label htmlFor="flatstock-width" className="text-sm font-medium">Flatstock width</Label>
                    <Select
                      value={
                        Number(workbook.flatstock_width_inches) === 41 ? '41' : '42'
                      }
                      onValueChange={(v) => {
                        const n = v === '' ? null : Number.parseInt(v, 10);
                        void setFlatstockWidthInches(Number.isFinite(n) ? n : null);
                      }}
                      disabled={savingFlatstockWidth}
                    >
                      <SelectTrigger id="flatstock-width" className="w-[140px]">
                        <SelectValue placeholder="Width" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="41">41&quot; wide</SelectItem>
                        <SelectItem value="42">42&quot; wide</SelectItem>
                      </SelectContent>
                    </Select>
                    {savingFlatstockWidth && (
                      <span className="text-xs text-muted-foreground">Saving…</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-4 max-w-3xl">
                    Wider coil fits more trim strips side-by-side (stretch-out ÷ width). Switch between 41&quot; and 42&quot; to match what you are ordering.
                  </p>
                  {loadingTrimFlatstock ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      Loading trim data…
                    </div>
                  ) : (() => {
                const flatstockW = workbook.flatstock_width_inches ?? 42;
                const trimPieceLengthInches = (item: MaterialItem): number => {
                  const ft = parseLengthToFeet(item.length);
                  if (ft != null && ft > 0) return Math.round(ft * 12 * 10000) / 10000;
                  return FLATSTOCK_STICK_LENGTH_INCHES;
                };
                const itemsWithTrim: {
                  item: MaterialItem;
                  configName: string;
                  stretchOutInches: number;
                }[] = [];
                workbook.sheets?.forEach((s: MaterialSheet) => {
                  s.items.forEach((i: MaterialItem) => {
                    if (!i.trim_saved_config_id) return;
                    const config = trimFlatstockConfigMap[i.trim_saved_config_id];
                    if (!config) return;
                    itemsWithTrim.push({
                      item: i,
                      configName: config.name,
                      stretchOutInches: config.stretchOutInches,
                    });
                  });
                });
                if (itemsWithTrim.length === 0) {
                  return (
                    <p className="text-muted-foreground text-sm">
                      No trim with drawings on this job. Link trim drawings to material lines in the Workbook tab.
                    </p>
                  );
                }
                const q = (n: number) => Number(n) || 0;
                type RowCalc = {
                  item: MaterialItem;
                  configName: string;
                  stretchOutInches: number;
                  pieceLenIn: number;
                  qty: number;
                  nest: ReturnType<typeof computeFlatstockSticksNeeded>;
                };
                const lineCalcs: RowCalc[] = itemsWithTrim.map(
                  ({ item, configName, stretchOutInches }) => {
                    const pieceLenIn = trimPieceLengthInches(item);
                    const qty = q(item.quantity);
                    const nest =
                      qty <= 0
                        ? {
                            stripsAcross: 0,
                            piecesAlongStick: 0,
                            capacityPerStick: 0,
                            sticksNeeded: 0,
                            stretchOutWiderThanSheet: false,
                          }
                        : computeFlatstockSticksNeeded({
                            flatstockWidthInches: flatstockW,
                            stickLengthInches: FLATSTOCK_STICK_LENGTH_INCHES,
                            stretchOutInches,
                            pieceLengthInches: pieceLenIn,
                            pieceCount: qty,
                          });
                    return {
                      item,
                      configName,
                      stretchOutInches,
                      pieceLenIn,
                      qty,
                      nest,
                    };
                  }
                );

                const totalFlatstockPieces = lineCalcs.reduce((sum, r) => sum + r.nest.sticksNeeded, 0);
                const savedPlan = isTrimSlittingPlanV1(workbook.trim_flatstock_plan)
                  ? (workbook.trim_flatstock_plan as TrimSlittingPlanV1)
                  : null;
                const totalFlatstockPiecesOptimized = savedPlan
                  ? savedPlan.totalSheets
                  : totalFlatstockPieces;
                const hasExtendedPlanFields = savedPlan
                  ? savedPlan.sheets.every((sh) => sh.strips.every((st: any) => Number.isFinite(st?.cutoffBeforeWidthInches) && Number.isFinite(st?.pieceLengthInches)))
                  : false;
                const stripByInstanceId = savedPlan
                  ? (() => {
                      const map = new Map<string, { sheetIndex: number; strip: any }>();
                      for (const sh of savedPlan.sheets) {
                        for (const st of sh.strips) {
                          if (st?.stripInstanceId) {
                            map.set(st.stripInstanceId, { sheetIndex: sh.sheetIndex, strip: st });
                          }
                        }
                      }
                      return map;
                    })()
                  : null;
                const canEditTrimSlitting = workbook.status === 'working';
                const demandsForPlan = itemsWithTrim.map(({ item, stretchOutInches }) => ({
                  materialItemId: item.id,
                  materialName: item.material_name,
                  sku: item.sku ?? null,
                  stretchOutInches,
                  pieceLengthInches: trimPieceLengthInches(item),
                  qty: q(item.quantity),
                }));
                return (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!canEditTrimSlitting || savingTrimSlittingPlan}
                        onClick={() => void saveTrimSlittingPlanFromDemands(demandsForPlan, flatstockW)}
                      >
                        {savingTrimSlittingPlan ? 'Saving plan…' : 'Generate & save slitting plan'}
                      </Button>
                      {savedPlan && (
                        <span className="text-xs text-muted-foreground">
                          Saved layout: {savedPlan.totalSheets} sheet{savedPlan.totalSheets === 1 ? '' : 's'} (vs{' '}
                          {savedPlan.legacyIndependentSheetsSum} if each line counted alone)
                        </span>
                      )}
                      {savedPlan && savedPlan.sheets.length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canEditTrimSlitting || savingTrimCutListToNotes}
                          onClick={() => void applyTrimSlittingPlanToNotes(savedPlan, itemsWithTrim.map(({ item, stretchOutInches }) => ({ item, stretchOutInches })))}
                        >
                          {savingTrimCutListToNotes ? 'Applying…' : 'Apply cut list to notes'}
                        </Button>
                      )}
                    </div>
                    <div className="rounded-md border overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="text-left p-2 font-semibold">Material</th>
                            <th className="text-left p-2 font-semibold">SKU</th>
                            <th className="text-left p-2 font-semibold">Trim drawing</th>
                            <th className="text-right p-2 font-semibold">Stretch-out</th>
                            <th className="text-right p-2 font-semibold">Trim piece len</th>
                            <th className="text-right p-2 font-semibold">Trim pieces</th>
                            <th
                              className="text-right p-2 font-semibold"
                              title={`Trim strips that fit across a ${flatstockW}" wide coil`}
                            >
                              Across {flatstockW}&quot;
                            </th>
                            <th
                              className="text-right p-2 font-semibold"
                              title={`How many ${FLATSTOCK_STICK_LENGTH_INCHES / 12}' × ${flatstockW}" flatstock sticks to order for this trim line`}
                            >
                              Order sticks
                              <span className="block text-[10px] font-normal text-muted-foreground normal-case">
                                ({FLATSTOCK_STICK_LENGTH_INCHES / 12}&apos; × {flatstockW}&quot;)
                              </span>
                            </th>
                            <th className="text-left p-2 font-semibold min-w-[140px]">Cut status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lineCalcs.map(({ item, configName, stretchOutInches, pieceLenIn, qty, nest }) => {
                            const lenFt = parseLengthToFeet(item.length);
                            const usedDefaultLen = lenFt == null || lenFt <= 0;
                            return (
                              <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30">
                                <td className="p-2">{item.material_name}</td>
                                <td className="p-2 font-mono text-xs">{item.sku ?? '–'}</td>
                                <td className="p-2">{configName}</td>
                                <td className="p-2 text-right" title="Profile width on coil (drawing + hems)">
                                  {stretchOutInches.toFixed(2)}&quot;
                                </td>
                                <td
                                  className="p-2 text-right"
                                  title={usedDefaultLen ? 'No length on line — assumed full 10′ sheet' : ''}
                                >
                                  {usedDefaultLen && pieceLenIn >= FLATSTOCK_STICK_LENGTH_INCHES - 0.01
                                    ? `10′ (default)`
                                    : `${pieceLenIn.toFixed(2)}″`}
                                </td>
                                <td className="p-2 text-right">{qty}</td>
                                <td className="p-2 text-right">
                                  {nest.stretchOutWiderThanSheet ? (
                                    <span className="text-amber-700" title="Stretch-out wider than coil — verify with shop">
                                      1*
                                    </span>
                                  ) : (
                                    nest.stripsAcross
                                  )}
                                </td>
                                <td
                                  className="p-2 text-right font-semibold tabular-nums text-base"
                                  title={`${qty} trim piece(s) at ${pieceLenIn.toFixed(2)}", ${nest.stripsAcross} strip(s) across, ${nest.piecesAlongStick} piece(s) per strip`}
                                >
                                  {nest.sticksNeeded}
                                </td>
                                <td className="p-2 align-top">
                                  <Select
                                    value={item.trim_cut_state ?? 'pending'}
                                    onValueChange={(v) => {
                                      if (
                                        v === 'pending' ||
                                        v === 'in_progress' ||
                                        v === 'cut_complete'
                                      ) {
                                        void updateMaterialItemTrimCutState(item.id, v);
                                      }
                                    }}
                                    disabled={!canEditTrimSlitting}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="pending">Pending</SelectItem>
                                      <SelectItem value="in_progress">In progress</SelectItem>
                                      <SelectItem value="cut_complete">Cut</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-muted/40 border-t-2 font-semibold">
                            <td colSpan={7} className="p-2 text-right">
                              Total flatstock pieces ({FLATSTOCK_STICK_LENGTH_INCHES / 12}&apos; × {flatstockW}&quot;)
                            </td>
                            <td className="p-2 text-right tabular-nums text-base">{totalFlatstockPiecesOptimized}</td>
                            <td className="p-2" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    {savedPlan && savedPlan.sheets.length > 0 && hasExtendedPlanFields && (
                      <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                        <p className="text-sm font-semibold">Width slitting cut list (full {savedPlan.stickLengthInches / 12}&apos; strips)</p>
                        <p className="text-xs text-muted-foreground">
                          Cut widest first (order #). Coil {savedPlan.flatstockWidthInches}&quot; wide. Regenerate after qty or width changes.
                        </p>
                        <div className="space-y-1">
                          {savedPlan.sheets.map((sh) => (
                            <Collapsible key={sh.sheetIndex} defaultOpen={sh.sheetIndex === 1}>
                              <CollapsibleTrigger className="flex w-full items-center gap-2 text-left text-sm font-medium py-1 hover:bg-muted/50 rounded px-1">
                                <ChevronDown className="h-4 w-4 shrink-0 transition-transform [[data-state=open]_&]:rotate-180" />
                                Sheet {sh.sheetIndex} — {sh.strips.length} strip{sh.strips.length === 1 ? '' : 's'}
                                {sh.scrapWidthInches > 0.001
                                  ? ` (${sh.scrapWidthInches.toFixed(2)}" scrap width)`
                                  : ''}
                              </CollapsibleTrigger>
                              <CollapsibleContent className="pl-6 pb-2 text-sm space-y-1">
                                {sh.strips.map((st: any) => {
                                  const parent = st?.usesCutoffFromStripInstanceId && stripByInstanceId
                                    ? stripByInstanceId.get(st.usesCutoffFromStripInstanceId) ?? null
                                    : null;

                                  return (
                                    <div key={`${sh.sheetIndex}-${st.cutOrder}-${st.materialItemId}`}>
                                      <span className="tabular-nums text-muted-foreground mr-2">#{st.cutOrder}</span>
                                      {st.materialName}
                                      {st.sku ? (
                                        <span className="font-mono text-xs ml-1">({st.sku})</span>
                                      ) : null}
                                      {' — '}
                                      {st.stretchOutInches.toFixed(2)}&quot; strip
                                      <span className="block text-[11px] text-muted-foreground">
                                        Remainder consumed: {Math.round(st.cutoffBeforeWidthInches * 100) / 100}&quot; cutoff; cut length {st.pieceLengthInches.toFixed(2)}&quot;
                                      </span>
                                      {parent ? (
                                        <span className="block text-[11px] text-muted-foreground">
                                          Derived from cutoff after strip #{parent.strip.cutOrder} ({parent.strip.materialName})
                                        </span>
                                      ) : (
                                        <span className="block text-[11px] text-muted-foreground">(primary cut: creates the remainder for later strips)</span>
                                      )}
                                      {st.stretchWiderThanCoil ? (
                                        <span className="text-amber-700 text-xs ml-1">(wider than coil — verify)</span>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </CollapsibleContent>
                            </Collapsible>
                          ))}
                        </div>
                      </div>
                    )}
                    {savedPlan && savedPlan.sheets.length > 0 && !hasExtendedPlanFields && (
                      <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
                        Saved plan is from an older format. Click <b>Generate &amp; save slitting plan</b> again to regenerate cutoff cut list.
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      *Stretch-out exceeds selected coil width — layout assumes one strip; confirm with shop.
                    </p>
                  </div>
                );
              })()}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upload" className="space-y-2">
          <MaterialWorkbookManager
            jobId={job.id}
            quoteId={effectiveQuoteId ?? undefined}
            onWorkbookCreated={loadWorkbook}
            onWorkbookView={(wb) => {
              setActiveTab('manage');
              if (wb.status === 'locked') {
                void openLockedSnapshotView(wb.id);
              } else {
                void exitLockedSnapshotView();
              }
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Add Material Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[96vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Add Material to {activeSheet?.sheet_name}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={syncMaterialsFromZoho}
                  disabled={syncingZoho}
                  className="border-purple-500 text-purple-700 hover:bg-purple-50"
                  title="Sync materials from Zoho Books"
                >
                  {syncingZoho ? (
                    <>
                      <div className="w-4 h-4 border-2 border-purple-700 border-t-transparent rounded-full animate-spin mr-2" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Sync Zoho
                    </>
                  )}
                </Button>
                {addMaterialDialogMode === 'search' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAddMaterialDialogMode('custom')}
                    className="border-slate-500 text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Custom Material
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAddMaterialDialogMode('search')}
                    className="border-blue-500 text-blue-700 hover:bg-blue-50"
                  >
                    <Search className="w-4 h-4 mr-2" />
                    Search Database
                  </Button>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Search Database (default) */}
            {addMaterialDialogMode === 'search' && (
              <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Search className="w-5 h-5 text-blue-700" />
                  <h3 className="font-semibold text-blue-900">Search Materials Database</h3>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <Input
                      placeholder="Search by name, SKU, or category..."
                      value={catalogSearchQuery}
                      onChange={(e) => { setCatalogSearchQuery(e.target.value); setCatalogSearchPage(0); }}
                      className="pl-9"
                    />
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  </div>
                  
                  <Select value={catalogSearchCategory} onValueChange={(v) => { setCatalogSearchCategory(v); setCatalogSearchPage(0); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {catalogCategories.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-sm font-medium text-blue-900">Add to category:</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={allCategories.includes(addToCategory) ? addToCategory : '__other__'}
                      onValueChange={(v) => setAddToCategory(v === '__other__' ? addToCategory : v)}
                    >
                      <SelectTrigger className="w-[200px] bg-white">
                        <SelectValue placeholder="Select or type below..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__other__">Other (type below)</SelectItem>
                        {allCategories.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={addToCategory}
                      onChange={(e) => setAddToCategory(e.target.value)}
                      placeholder="Category name"
                      className="w-[180px] bg-white"
                    />
                    {addToCategory && (
                      <span className="text-xs text-muted-foreground">Adding to &quot;{addToCategory}&quot;</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-blue-900">Quantity (for selected items)</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={catalogAddQuantity}
                      onChange={(e) => setCatalogAddQuantity(e.target.value)}
                      placeholder="1"
                      className="bg-white max-w-[120px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-blue-900">Color (optional)</Label>
                    <Input
                      value={catalogAddColor}
                      onChange={(e) => setCatalogAddColor(e.target.value)}
                      placeholder="e.g., Red, White"
                      className="bg-white max-w-[180px]"
                    />
                  </div>
                </div>

                {/* Search Results */}
                <div className="max-h-[60vh] overflow-y-auto border rounded-lg bg-white">
                  {(() => {
                    const filtered = catalogMaterials.filter(material => {
                      const matchesSearch = catalogSearchQuery === '' || 
                        material.material_name.toLowerCase().includes(catalogSearchQuery.toLowerCase()) ||
                        material.sku.toLowerCase().includes(catalogSearchQuery.toLowerCase()) ||
                        (material.category && material.category.toLowerCase().includes(catalogSearchQuery.toLowerCase()));
                      
                      const matchesCategory = catalogSearchCategory === 'all' || material.category === catalogSearchCategory;
                      
                      return matchesSearch && matchesCategory;
                    });

                    if (loadingCatalog) {
                      return (
                        <div className="text-center py-8">
                          <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                          <p className="text-xs text-muted-foreground">Loading...</p>
                        </div>
                      );
                    }

                    if (filtered.length === 0) {
                      return (
                        <div className="text-center py-8">
                          <p className="text-sm text-muted-foreground">No materials found</p>
                        </div>
                      );
                    }

                    const PAGE_SIZE = 10;
                    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
                    const safePage = Math.min(catalogSearchPage, totalPages - 1);
                    const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

                    return (
                      <div className="divide-y">
                        {pageItems.map((material) => {
                          const selected = isCatalogMaterialSelected(material);
                          const { cost, price } = getCatalogCostAndPrice(material);
                          return (
                            <button
                              key={catalogItemKey(material)}
                              type="button"
                              onClick={() => toggleCatalogMaterialSelection(material)}
                              className={`w-full text-left p-3 transition-colors flex items-center gap-3 group ${selected ? 'bg-blue-100 border-l-4 border-blue-600' : 'hover:bg-blue-50'}`}
                            >
                              <Checkbox checked={selected} onCheckedChange={() => toggleCatalogMaterialSelection(material)} onClick={e => e.stopPropagation()} />
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm truncate">{material.material_name}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-muted-foreground font-mono">{material.sku}</span>
                                  {material.category && (
                                    <Badge variant="outline" className="text-xs">
                                      {material.category}
                                    </Badge>
                                  )}
                                  {material.part_length && (
                                    <span className="text-xs text-muted-foreground">{material.part_length}</span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right ml-4 flex flex-col items-end gap-0.5">
                                {price > 0 && (
                                  <>
                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Price</p>
                                    <p className="text-sm font-semibold">${price.toFixed(2)}</p>
                                  </>
                                )}
                                {cost > 0 && price === 0 && (
                                  <>
                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Cost</p>
                                    <p className="text-sm font-semibold">${cost.toFixed(2)}</p>
                                  </>
                                )}
                                <span className="text-xs text-blue-600">{selected ? 'Selected' : 'Click to select'}</span>
                              </div>
                            </button>
                          );
                        })}
                        {totalPages > 1 && (
                          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-t">
                            <button
                              onClick={() => setCatalogSearchPage(p => Math.max(0, p - 1))}
                              disabled={safePage === 0}
                              className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed px-2 py-1 rounded hover:bg-slate-200 transition-colors"
                            >
                              ← Prev
                            </button>
                            <p className="text-xs text-muted-foreground">
                              {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} results
                            </p>
                            <button
                              onClick={() => setCatalogSearchPage(p => Math.min(totalPages - 1, p + 1))}
                              disabled={safePage >= totalPages - 1}
                              className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed px-2 py-1 rounded hover:bg-slate-200 transition-colors"
                            >
                              Next →
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {selectedCatalogMaterials.length > 0 && (
                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-blue-300">
                    <span className="text-sm font-medium text-blue-900">
                      {selectedCatalogMaterials.length} material(s) selected
                    </span>
                    <Button
                      onClick={addMaterialsFromCatalogSelection}
                      disabled={addingCatalogBatch || !activeSheetId || !addToCategory.trim()}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {addingCatalogBatch ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                          Adding...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-2" />
                          Add {selectedCatalogMaterials.length} to {activeSheet?.sheet_name ?? 'sheet'}
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
            {/* Custom material form (optional) */}
            {addMaterialDialogMode === 'custom' && (
            <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-material-name">Material Name *</Label>
                <Input
                  id="add-material-name"
                  value={newMaterialName}
                  onChange={(e) => setNewMaterialName(e.target.value)}
                  placeholder="e.g., 2x4 Lumber, Roofing Nails..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="add-category">Category *</Label>
                <Select value={addToCategory} onValueChange={setAddToCategory}>
                  <SelectTrigger id="add-category">
                    <SelectValue placeholder="Select or type new..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allCategories.map(category => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={addToCategory}
                  onChange={(e) => setAddToCategory(e.target.value)}
                  placeholder="Or type new category"
                  className="mt-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-usage">Usage</Label>
                <Input
                  id="add-usage"
                  value={newUsage}
                  onChange={(e) => setNewUsage(e.target.value)}
                  placeholder="e.g., Main building, Porch..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="add-sku">SKU</Label>
                <Input
                  id="add-sku"
                  value={newSku}
                  onChange={(e) => setNewSku(e.target.value)}
                  placeholder="Part number or SKU"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-quantity">Quantity *</Label>
                <Input
                  id="add-quantity"
                  type="number"
                  min="0"
                  step="0.01"
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="add-length">Length</Label>
                <Input
                  id="add-length"
                  value={newLength}
                  onChange={(e) => setNewLength(e.target.value)}
                  placeholder="e.g., 8', 10', 12'..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="add-color">Color</Label>
                <Input
                  id="add-color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  placeholder="e.g., Red, Blue, White..."
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-cost">Cost/Unit ($)</Label>
                <Input
                  id="add-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={newCostPerUnit}
                  onChange={(e) => {
                    setNewCostPerUnit(e.target.value);
                    // If manually editing cost and we have a price, recalculate markup
                    if (newPricePerUnit) {
                      const cost = parseFloat(e.target.value) || 0;
                      const price = parseFloat(newPricePerUnit) || 0;
                      if (cost > 0 && price > 0) {
                        const markup = ((price - cost) / cost) * 100;
                        setNewMarkup(markup.toFixed(1));
                      }
                    }
                  }}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-price">Price/Unit ($) {newPricePerUnit && <span className="text-xs text-muted-foreground">(from Zoho Books)</span>}</Label>
                <Input
                  id="add-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={newPricePerUnit}
                  onChange={(e) => {
                    setNewPricePerUnit(e.target.value);
                    // Recalculate markup when price changes
                    if (newCostPerUnit) {
                      const cost = parseFloat(newCostPerUnit) || 0;
                      const price = parseFloat(e.target.value) || 0;
                      if (cost > 0 && price > 0) {
                        const markup = ((price - cost) / cost) * 100;
                        setNewMarkup(markup.toFixed(1));
                      }
                    }
                  }}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-markup">Markup (%) {newPricePerUnit && <span className="text-xs text-muted-foreground">(calculated from Zoho Books prices - reference only)</span>}</Label>
              <Input
                id="add-markup"
                type="number"
                min="0"
                step="0.1"
                value={newMarkup}
                onChange={(e) => {
                  setNewMarkup(e.target.value);
                  // If manually changing markup and no catalog price, calculate new price
                  if (!newPricePerUnit && newCostPerUnit) {
                    const cost = parseFloat(newCostPerUnit) || 0;
                    const markup = parseFloat(e.target.value) || 0;
                    if (cost > 0) {
                      const price = cost * (1 + markup / 100);
                      setNewPricePerUnit(price.toFixed(2));
                    }
                  }
                }}
                placeholder="Enter markup %"
              />
              {newPricePerUnit && (
                <p className="text-xs text-blue-600">
                  💡 Price is from Zoho Books. Markup shown for reference only.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-notes">Notes</Label>
              <Textarea
                id="add-notes"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Optional notes or special instructions..."
                rows={3}
              />
            </div>

            {/* Preview */}
            {newCostPerUnit && newQuantity && (
              <div className="bg-green-50 p-4 rounded-lg border border-green-200 space-y-2">
                <h4 className="font-semibold text-green-900">
                  Price Preview {newPricePerUnit && <span className="text-xs font-normal text-muted-foreground">(Using Zoho Books Prices)</span>}
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Cost/Unit:</span>
                    <span className="ml-2 font-semibold">${parseFloat(newCostPerUnit).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Price/Unit:</span>
                    <span className="ml-2 font-semibold text-green-700">
                      ${newPricePerUnit 
                        ? parseFloat(newPricePerUnit).toFixed(2)
                        : (parseFloat(newCostPerUnit) * (1 + (parseFloat(newMarkup) || 0) / 100)).toFixed(2)
                      }
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Extended Cost:</span>
                    <span className="ml-2 font-semibold">
                      ${(parseFloat(newCostPerUnit) * parseFloat(newQuantity)).toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Extended Price:</span>
                    <span className="ml-2 font-bold text-green-700">
                      ${newPricePerUnit
                        ? (parseFloat(newPricePerUnit) * parseFloat(newQuantity)).toFixed(2)
                        : (parseFloat(newCostPerUnit) * parseFloat(newQuantity) * (1 + (parseFloat(newMarkup) || 0) / 100)).toFixed(2)
                      }
                    </span>
                  </div>
                  {newMarkup && (
                    <div className="col-span-2 pt-2 border-t border-green-300">
                      <span className="text-muted-foreground">Markup:</span>
                      <span className="ml-2 font-semibold text-green-700">
                        {parseFloat(newMarkup).toFixed(1)}%
                        {newPricePerUnit && <span className="text-xs text-muted-foreground ml-1">(from Zoho Books)</span>}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t">
              <Button
                onClick={addMaterial}
                disabled={saving}
                className="flex-1"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Material
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAddDialog(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
            </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Move Material Dialog */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move Material</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Move <strong>{movingItem?.material_name}</strong> to a different sheet or category
            </p>

            <div className="space-y-2">
              <Label htmlFor="move-sheet">Sheet</Label>
              <Select value={moveToSheetId} onValueChange={setMoveToSheetId}>
                <SelectTrigger id="move-sheet">
                  <SelectValue placeholder="Select sheet" />
                </SelectTrigger>
                <SelectContent>
                  {workbook?.sheets.map(sheet => (
                    <SelectItem key={sheet.id} value={sheet.id}>
                      {sheet.sheet_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="move-category">Category</Label>
              <Select value={moveToCategory} onValueChange={setMoveToCategory}>
                <SelectTrigger id="move-category">
                  <SelectValue placeholder="Select or enter category" />
                </SelectTrigger>
                <SelectContent>
                  {allCategories.map(category => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={moveToCategory}
                onChange={(e) => setMoveToCategory(e.target.value)}
                placeholder="Or type new category name"
                className="mt-2"
              />
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button onClick={moveItem} className="flex-1">
                <MoveHorizontal className="w-4 h-4 mr-2" />
                Move Material
              </Button>
              <Button variant="outline" onClick={() => setShowMoveDialog(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Sheet Dialog */}
      <Dialog open={showAddSheetDialog} onOpenChange={(open) => { setShowAddSheetDialog(open); if (!open) setNewSheetType('proposal'); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Add New Sheet
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="sheet-type"
                    checked={newSheetType === 'proposal'}
                    onChange={() => setNewSheetType('proposal')}
                    className="rounded-full"
                  />
                  <span className="text-sm font-medium">Proposal sheet</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="sheet-type"
                    checked={newSheetType === 'change_order'}
                    onChange={() => setNewSheetType('change_order')}
                    className="rounded-full"
                  />
                  <span className="text-sm font-medium">Change order</span>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {newSheetType === 'change_order' ? 'Change order sheets appear below the proposal and have separate totals. Customers see them in the Change orders section.' : 'Proposal sheets are part of the main proposal total.'}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sheet-name">Sheet Name *</Label>
              <Input
                id="sheet-name"
                value={newSheetName}
                onChange={(e) => setNewSheetName(e.target.value)}
                placeholder={newSheetType === 'change_order' ? 'e.g., Change order #1, Addition...' : 'e.g., Porch, Garage, Interior...'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !addingSheet && newSheetName.trim()) {
                    addNewSheet();
                  }
                }}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="sheet-type">Sheet Type *</Label>
              <Select value={newSheetType} onValueChange={(v: 'proposal' | 'change_order') => setNewSheetType(v)}>
                <SelectTrigger id="sheet-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="proposal">
                    <div className="flex flex-col">
                      <span className="font-medium">Proposal Sheet</span>
                      <span className="text-xs text-muted-foreground">Included in main proposal total</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="change_order">
                    <div className="flex flex-col">
                      <span className="font-medium">Change Order</span>
                      <span className="text-xs text-muted-foreground">Additional work, shown separately</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button
                onClick={addNewSheet}
                disabled={addingSheet || !newSheetName.trim()}
                className="flex-1"
              >
                {addingSheet ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    {newSheetType === 'change_order' ? 'Add Change Order' : 'Add Sheet'}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddSheetDialog(false);
                  setNewSheetName('');
                  setNewSheetType('proposal');
                }}
                disabled={addingSheet}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add to Package Dialog */}
      <Dialog open={showAddToPackageDialog} onOpenChange={setShowAddToPackageDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Materials to Package</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Adding {selectedMaterialsForPackageAdd.size} material{selectedMaterialsForPackageAdd.size !== 1 ? 's' : ''} to a package
            </p>

            <div className="space-y-2">
              <Label htmlFor="target-package">Select Package *</Label>
              <Select value={targetPackageId} onValueChange={setTargetPackageId}>
                <SelectTrigger id="target-package">
                  <SelectValue placeholder="Choose a package..." />
                </SelectTrigger>
                <SelectContent>
                  {packages.map((pkg) => (
                    <SelectItem key={pkg.id} value={pkg.id}>
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4" />
                        {pkg.name}
                        <Badge variant="secondary" className="ml-2">
                          {pkg.bundle_items?.length || 0} items
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button
                onClick={addSelectedMaterialsToSelectedPackage}
                disabled={addingMaterialsToPackage || !targetPackageId}
                className="flex-1"
              >
                {addingMaterialsToPackage ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Adding...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Add to Package
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAddToPackageDialog(false)}
                disabled={addingMaterialsToPackage}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showTrimPdfExportDialog} onOpenChange={setShowTrimPdfExportDialog}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Export trim PDF</DialogTitle>
            <p className="text-sm text-muted-foreground font-normal pt-1">
              Portrait PDF with several trims per page as table rows: length, color, cut width (stretch-out), and a
              compact profile image when a drawing is linked. Uncheck lines to omit them.
            </p>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2 py-2 border-b">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setAllTrimPdfExportSelected(true)}
            >
              Select all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setAllTrimPdfExportSelected(false)}
            >
              Clear
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              {trimPdfExportSelectedIds.size} of {workbookTrimLinesForPdfExport.length} selected
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-1">
            {workbookTrimLinesForPdfExport.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No trim lines in this workbook.</p>
            ) : (
              workbookTrimLinesForPdfExport.map(({ item, sheetName }) => (
                <label
                  key={item.id}
                  className="flex items-start gap-3 rounded-md border border-transparent hover:border-slate-200 hover:bg-slate-50/80 px-2 py-2 cursor-pointer"
                >
                  <Checkbox
                    checked={trimPdfExportSelectedIds.has(item.id)}
                    onCheckedChange={() => toggleTrimPdfExportItem(item.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-tight">{item.material_name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {sheetName}
                      {item.trim_saved_config_id ? '' : ' · no trim drawing linked'}
                    </div>
                  </div>
                </label>
              ))
            )}
          </div>
          <div className="flex gap-2 justify-end pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowTrimPdfExportDialog(false)}
              disabled={trimPdfExporting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleDownloadTrimWorkbookPdf()}
              disabled={trimPdfExporting || trimPdfExportSelectedIds.size === 0}
            >
              {trimPdfExporting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Building…
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Zoho Order Confirmation Dialog */}
      <ZohoOrderConfirmationDialog
        open={showZohoOrderDialog}
        onOpenChange={setShowZohoOrderDialog}
        jobName={job.name}
        materials={selectedMaterialsForOrder}
        metalCatalogBySku={metalCatalogBySku}
      />

      {/* Bulk Move Materials Dialog */}
      <Dialog open={showBulkMoveDialog} onOpenChange={setShowBulkMoveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move {selectedMaterialsForMove.size} Material{selectedMaterialsForMove.size !== 1 ? 's' : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Move selected materials to a different sheet and category
            </p>

            <div className="space-y-2">
              <Label htmlFor="bulk-move-sheet">Target Sheet *</Label>
              <Select value={bulkMoveTargetSheetId} onValueChange={setBulkMoveTargetSheetId}>
                <SelectTrigger id="bulk-move-sheet">
                  <SelectValue placeholder="Select sheet" />
                </SelectTrigger>
                <SelectContent>
                  {workbook?.sheets.map(sheet => (
                    <SelectItem key={sheet.id} value={sheet.id}>
                      {sheet.sheet_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bulk-move-category">Target Category *</Label>
              <Select value={bulkMoveTargetCategory} onValueChange={setBulkMoveTargetCategory}>
                <SelectTrigger id="bulk-move-category">
                  <SelectValue placeholder="Select or enter category" />
                </SelectTrigger>
                <SelectContent>
                  {allCategories.map(category => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={bulkMoveTargetCategory}
                onChange={(e) => setBulkMoveTargetCategory(e.target.value)}
                placeholder="Or type new category name"
                className="mt-2"
              />
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded p-3">
              <p className="text-sm font-semibold text-orange-900">
                {selectedMaterialsForMove.size} material{selectedMaterialsForMove.size !== 1 ? 's' : ''} will be moved
              </p>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button
                onClick={bulkMoveMaterials}
                disabled={movingBulkMaterials || !bulkMoveTargetSheetId || !bulkMoveTargetCategory.trim()}
                className="flex-1"
              >
                {movingBulkMaterials ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Moving...
                  </>
                ) : (
                  <>
                    <MoveHorizontal className="w-4 h-4 mr-2" />
                    Move Materials
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowBulkMoveDialog(false)}
                disabled={movingBulkMaterials}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Floating viewer when not embedded in Workbook / Breakdown panels */}
      {showDocumentViewer &&
        !(
          activeTab === 'manage' ||
          (activeTab === 'breakdown' && !workbook)
        ) && (
          <FloatingDocumentViewer
            jobId={job.id}
            open={true}
            onClose={() => setShowDocumentViewer(false)}
          />
        )}

      {/* Zoho Sync Results Dialog */}
      <Dialog open={showSyncResults} onOpenChange={setShowSyncResults}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="w-6 h-6 text-green-600" />
              Zoho Books Sync Complete
            </DialogTitle>
          </DialogHeader>
          
          {syncResults && (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-4">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Total Synced</div>
                  <div className="text-2xl font-bold text-blue-700">{syncResults.itemsSynced || 0}</div>
                </div>
                <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">New Materials</div>
                  <div className="text-2xl font-bold text-green-700">{syncResults.itemsInserted || 0}</div>
                </div>
                <div className="bg-orange-50 border-2 border-orange-300 rounded-lg p-4">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Updated</div>
                  <div className="text-2xl font-bold text-orange-700">{syncResults.itemsUpdated || 0}</div>
                </div>
                <div className="bg-slate-50 border-2 border-slate-300 rounded-lg p-4">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Skipped</div>
                  <div className="text-2xl font-bold text-slate-700">{syncResults.itemsSkipped || 0}</div>
                </div>
              </div>

              {/* Success Message */}
              {syncResults.message && (
                <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="font-semibold text-green-900 mb-1">Sync Summary</h4>
                      <p className="text-sm text-green-800">{syncResults.message}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Skipped Items Warning */}
              {syncResults.skippedItems && syncResults.skippedItems.length > 0 && (
                <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-yellow-900 mb-2">Skipped Materials (No SKU)</h4>
                      <p className="text-sm text-yellow-800 mb-3">
                        The following {syncResults.skippedItems.length} material{syncResults.skippedItems.length !== 1 ? 's were' : ' was'} skipped because they don't have a valid SKU in Zoho Books:
                      </p>
                      <div className="bg-white rounded border border-yellow-200 p-3 max-h-40 overflow-y-auto">
                        <ul className="text-sm space-y-1">
                          {syncResults.skippedItems.slice(0, 20).map((item: string, idx: number) => (
                            <li key={idx} className="flex items-center gap-2">
                              <X className="w-3 h-3 text-yellow-600 flex-shrink-0" />
                              <span className="text-yellow-900">{item}</span>
                            </li>
                          ))}
                          {syncResults.skippedItems.length > 20 && (
                            <li className="text-xs text-yellow-700 pt-2 border-t border-yellow-200">
                              ... and {syncResults.skippedItems.length - 20} more
                            </li>
                          )}
                        </ul>
                      </div>
                      <p className="text-xs text-yellow-700 mt-2">
                        💡 To sync these materials, add SKUs to them in Zoho Books and run the sync again.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* What Changed */}
              <div className="border-2 rounded-lg p-4">
                <h4 className="font-semibold text-slate-900 mb-3">What Changed?</h4>
                <p className="text-xs text-muted-foreground mb-2">Click a line to see what was changed.</p>
                <div className="space-y-2 text-sm">
                  {syncResults.itemsInserted > 0 && (
                    <button
                      type="button"
                      onClick={() => setSyncChangeDetailsView('inserted')}
                      className="w-full flex items-center gap-2 text-green-700 hover:bg-green-50 rounded p-2 -m-2 text-left transition-colors cursor-pointer"
                    >
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                      <span><strong>{syncResults.itemsInserted}</strong> new material{syncResults.itemsInserted !== 1 ? 's' : ''} added to catalog</span>
                      <span className="text-green-500 ml-1">View details →</span>
                    </button>
                  )}
                  {syncResults.itemsUpdated > 0 && (
                    <button
                      type="button"
                      onClick={() => setSyncChangeDetailsView('updated')}
                      className="w-full flex items-start gap-2 text-orange-700 hover:bg-orange-50 rounded p-2 -m-2 text-left transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <div><strong>{syncResults.itemsUpdated}</strong> material{syncResults.itemsUpdated !== 1 ? 's' : ''} updated with latest Zoho Books data</div>
                        <div className="text-xs text-orange-600 mt-1">
                          ℹ️ Updated fields: Name, Category, Prices (unit_price, purchase_cost), Length/Unit, and Metadata
                        </div>
                        <span className="text-orange-500 text-xs mt-1 inline-block">View list →</span>
                      </div>
                    </button>
                  )}
                  {syncResults.vendorsSynced > 0 && (
                    <button
                      type="button"
                      onClick={() => setSyncChangeDetailsView('vendors')}
                      className="w-full flex items-center gap-2 text-blue-700 hover:bg-blue-50 rounded p-2 -m-2 text-left transition-colors cursor-pointer"
                    >
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                      <span><strong>{syncResults.vendorsSynced}</strong> vendor{syncResults.vendorsSynced !== 1 ? 's' : ''} synced</span>
                      <span className="text-blue-500 ml-1">View details →</span>
                    </button>
                  )}
                </div>
              </div>

              {/* What Changed — details dialog */}
              <Dialog open={syncChangeDetailsView !== null} onOpenChange={(open) => !open && setSyncChangeDetailsView(null)}>
                <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                  <DialogHeader>
                    <DialogTitle>
                      {syncChangeDetailsView === 'inserted' && 'New materials added to catalog'}
                      {syncChangeDetailsView === 'updated' && 'Materials updated from Zoho Books'}
                      {syncChangeDetailsView === 'vendors' && 'Vendors synced'}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="flex-1 min-h-0 overflow-y-auto pr-2">
                    {syncChangeDetailsView === 'inserted' && (
                      <>
                        <p className="text-sm text-muted-foreground mb-3">
                          These materials were added to your catalog from Zoho Books. Fields set: Name, Category, Prices, Length/Unit, Metadata.
                        </p>
                        <ul className="space-y-1.5 text-sm">
                          {(syncResults.insertedItems || []).map((row: { sku: string; name: string }, idx: number) => (
                            <li key={idx} className="flex items-center gap-2 py-1 border-b border-slate-100">
                              <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                              <span className="font-medium text-slate-900">{row.name}</span>
                              <span className="text-muted-foreground">({row.sku})</span>
                            </li>
                          ))}
                        </ul>
                        {syncResults.itemsInserted > (syncResults.insertedItems?.length || 0) && (
                          <p className="text-xs text-muted-foreground mt-2">
                            … and {syncResults.itemsInserted - (syncResults.insertedItems?.length || 0)} more (list capped at 500).
                          </p>
                        )}
                      </>
                    )}
                    {syncChangeDetailsView === 'updated' && (
                      <>
                        <p className="text-sm text-muted-foreground mb-3">
                          These materials were updated from Zoho Books. Updated fields: Name, Category, unit_price, purchase_cost, Length/Unit, Metadata.
                        </p>
                        <ul className="space-y-1.5 text-sm">
                          {(syncResults.updatedItems || []).map((row: { sku: string; name: string }, idx: number) => (
                            <li key={idx} className="flex items-center gap-2 py-1 border-b border-slate-100">
                              <RefreshCw className="w-4 h-4 text-orange-600 flex-shrink-0" />
                              <span className="font-medium text-slate-900">{row.name}</span>
                              <span className="text-muted-foreground">({row.sku})</span>
                            </li>
                          ))}
                        </ul>
                        {syncResults.itemsUpdated > (syncResults.updatedItems?.length || 0) && (
                          <p className="text-xs text-muted-foreground mt-2">
                            … and {syncResults.itemsUpdated - (syncResults.updatedItems?.length || 0)} more (list capped at 500).
                          </p>
                        )}
                      </>
                    )}
                    {syncChangeDetailsView === 'vendors' && (
                      <p className="text-sm text-slate-700">
                        Vendor names and contact information (contact person, phone, email) were synced from Zoho Books. 
                        A total of <strong>{syncResults.vendorsSynced}</strong> vendor{syncResults.vendorsSynced !== 1 ? 's' : ''} were updated in your database.
                        The sync does not return a per-vendor list; you can review vendors in your Vendors or Zoho settings.
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end pt-3 border-t">
                    <Button onClick={() => setSyncChangeDetailsView(null)}>Close</Button>
                  </div>
                </DialogContent>
              </Dialog>

              {/* Info Box */}
              <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <FileText className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-900">
                    <h5 className="font-semibold mb-1">Zoho Books is Now the Source of Truth</h5>
                    <p className="text-blue-800">
                      All material information (names, categories, prices, SKUs) has been updated to match Zoho Books. 
                      Any price changes or material updates in Zoho Books will be reflected here after syncing.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t">
                <Button onClick={() => setShowSyncResults(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Sort Categories Dialog */}
      <Dialog open={showSortCategoriesDialog} onOpenChange={(open) => {
        if (!open) { setDraggedCatIndex(null); setDragOverCatIndex(null); }
        setShowSortCategoriesDialog(open);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListOrdered className="w-4 h-4 text-violet-600" />
              Sort Categories — {activeSheet?.sheet_name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground mb-3">
            Drag rows to reorder categories for this sheet. Order is saved per sheet and applies to all users.
          </p>
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1 pb-1">
            {sortCategoriesOrder.map((cat, idx) => (
              <div
                key={cat}
                draggable
                onDragStart={(e) => {
                  setDraggedCatIndex(idx);
                  e.dataTransfer.effectAllowed = 'move';
                  // Required for Firefox
                  e.dataTransfer.setData('text/plain', String(idx));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (draggedCatIndex !== null && draggedCatIndex !== idx) {
                    setDragOverCatIndex(idx);
                  }
                }}
                onDragLeave={() => setDragOverCatIndex(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedCatIndex === null || draggedCatIndex === idx) return;
                  const next = [...sortCategoriesOrder];
                  const [removed] = next.splice(draggedCatIndex, 1);
                  next.splice(idx, 0, removed);
                  setSortCategoriesOrder(next);
                  setDraggedCatIndex(null);
                  setDragOverCatIndex(null);
                }}
                onDragEnd={() => {
                  setDraggedCatIndex(null);
                  setDragOverCatIndex(null);
                }}
                className={[
                  'flex items-center gap-2 rounded-lg px-3 py-2.5 border select-none transition-all duration-100',
                  draggedCatIndex === idx
                    ? 'opacity-40 bg-slate-100 border-slate-300 shadow-none'
                    : dragOverCatIndex === idx
                      ? 'border-violet-500 bg-violet-50 shadow-lg ring-1 ring-violet-400'
                      : 'bg-white border-slate-200 shadow-sm hover:border-slate-300 hover:shadow',
                ].join(' ')}
              >
                <GripVertical className="w-4 h-4 text-slate-400 flex-shrink-0 cursor-grab active:cursor-grabbing" />
                <span className="w-5 text-center text-xs font-bold text-slate-400">
                  {idx + 1}
                </span>
                <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                <span className="flex-1 text-sm font-medium text-slate-800 truncate">{cat}</span>
                <div className="flex gap-0.5 flex-shrink-0">
                  <Button
                    variant="ghost" size="sm" disabled={idx === 0}
                    onClick={() => moveSortCategory(idx, 'up')}
                    className="h-6 w-6 p-0 text-slate-400 hover:text-slate-900 disabled:opacity-20"
                    title="Move up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="sm" disabled={idx === sortCategoriesOrder.length - 1}
                    onClick={() => moveSortCategory(idx, 'down')}
                    className="h-6 w-6 p-0 text-slate-400 hover:text-slate-900 disabled:opacity-20"
                    title="Move down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center mt-4 pt-3 border-t gap-2">
            <Button
              variant="outline" size="sm" className="text-xs"
              onClick={() => {
                if (!activeSheet) return;
                const natural = groupByCategory(activeSheet.items);
                setSortCategoriesOrder(natural.map(g => g.category));
              }}
            >
              Reset to workbook order
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowSortCategoriesDialog(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-xs bg-violet-600 hover:bg-violet-700 text-white"
                disabled={savingSortOrder}
                onClick={saveSortOrder}
              >
                {savingSortOrder ? 'Saving…' : 'Save Order'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {openPhotosForItem && (
        <MaterialItemPhotos
          key={openPhotosForItem.id}
          materialItemId={openPhotosForItem.id}
          materialName={openPhotosForItem.materialName}
          trigger="none"
          open={true}
          onOpenChange={(open) => !open && setOpenPhotosForItem(null)}
        />
      )}

      {/* Link trim drawing to this material item */}
      <Dialog open={!!openLinkTrimForItem} onOpenChange={(open) => !open && setOpenLinkTrimForItem(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5" />
              Trim drawing for &quot;{openLinkTrimForItem?.materialName}&quot;
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto pr-1">
            {openLinkTrimForItem?.currentTrimConfigId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full border-amber-500 text-amber-700"
                disabled={linkingTrimConfigId === 'unlink'}
                onClick={unlinkTrimFromItem}
              >
                Unlink current drawing
              </Button>
            )}
            <p className="text-sm text-muted-foreground">Link a saved trim so the shop can see the drawing when pulling this item:</p>
            <div className="relative">
              <Input
                value={trimConfigSearchQuery}
                onChange={(e) => setTrimConfigSearchQuery(e.target.value)}
                placeholder="Search saved trims by name..."
                className="pl-9"
              />
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
            {loadingTrimConfigs ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Loading saved trims…</div>
            ) : savedTrimConfigs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved trim configurations yet. Draw one below, then come back and link it.</p>
            ) : (
              <div className="max-h-[55vh] overflow-y-auto space-y-2">
                {savedTrimConfigs
                  .filter((config) =>
                    trimConfigSearchQuery.trim() === ''
                      ? true
                      : (config.name || '').toLowerCase().includes(trimConfigSearchQuery.toLowerCase())
                  )
                  .map((config) => (
                  <div key={config.id} className="flex items-center justify-between gap-2 rounded border p-2">
                    <span className="font-medium text-sm truncate">{config.name}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={linkingTrimConfigId === config.id}
                      onClick={() => linkTrimConfigToItem(config.id)}
                    >
                      {linkingTrimConfigId === config.id ? 'Linking…' : 'Link'}
                    </Button>
                  </div>
                ))}
                {savedTrimConfigs.length > 0 &&
                  savedTrimConfigs.filter((config) =>
                    trimConfigSearchQuery.trim() === ''
                      ? true
                      : (config.name || '').toLowerCase().includes(trimConfigSearchQuery.toLowerCase())
                  ).length === 0 && (
                    <div className="py-6 text-center text-sm text-muted-foreground">No trims match your search.</div>
                  )}
              </div>
            )}
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-2">Draw a new trim below; when you save, it will be linked to this material so the shop can see the drawing.</p>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="w-full"
                onClick={() => {
                  const materialItemId = openLinkTrimForItem?.id ?? '';
                  setOpenLinkTrimForItem(null);
                  navigate(`/office?tab=trim-calculator&linkToMaterialItem=${materialItemId}`, { replace: true });
                }}
              >
                Open Trim Calculator to draw new trim
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
