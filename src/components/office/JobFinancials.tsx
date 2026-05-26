import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, DollarSign, Clock, TrendingUp, Percent, Calculator, FileSpreadsheet, ChevronDown, ChevronLeft, ChevronRight, Briefcase, Edit, Upload, MoreVertical, List, Eye, EyeOff, Check, X, GripVertical, Download, History, Lock, LockOpen, Calendar, FileText, FilePlus, Settings, Printer, Send, CheckCircle, GitCompare, Link2, PauseCircle, PlayCircle, ArrowRightCircle } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/lib/supabase';
import {
  isQuoteContractFrozen,
  isProposalPanelReadOnly,
  isQuoteDefaultLockedForProposalPanel,
  quoteHasActiveContract,
} from '@/lib/quoteProposalLock';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { SubcontractorEstimatesManagement } from './SubcontractorEstimatesManagement';
import {
  BudgetMaterialCatalogLineItemPicker,
  BudgetMaterialCatalogManageDialog,
} from './BudgetMaterialCatalog';
import { generateProposalHTML } from './ProposalPDFTemplate';
import { FloatingDocumentViewer } from './FloatingDocumentViewer';
import { ProposalTemplateEditor } from './ProposalTemplateEditor';
import { BulkMaterialMover } from './BulkMaterialMover';
import { ProposalComparisonView } from './ProposalComparisonView';
import { useProposalToolbar } from '@/contexts/JobDetailProposalToolbarContext';
import { useProposalSummary } from '@/contexts/ProposalSummaryContext';
import { useDocumentPanel } from '@/contexts/DocumentPanelContext';
import { useUndo } from '@/contexts/UndoContext';
import type { Job } from '@/types';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { displayNumberForQuoteRow } from '@/lib/quoteDisplay';
import {
  fetchChangeOrderQuoteForJob,
  fetchQuoteContractRow,
  isMissingColumnError,
  markCustomRowItemsNoQuoteIdColumn,
  markCustomRowItemsNoWorkbookIdColumn,
  shouldSkipCustomRowItemQuoteIdColumn,
  shouldSkipCustomRowItemWorkbookFilter,
} from '@/lib/quotesSchemaFallback';
import {
  filterLineItemsForActiveQuote,
  jobHasMultipleFormalProposals,
  realignMisassignedSheetLineItems,
  sheetBelongsToQuote,
} from '@/lib/proposalIsolation';

interface CustomFinancialRow {
  id: string;
  job_id: string;
  category: string;
  description: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  markup_percent: number;
  selling_price: number;
  notes: string | null;
  order_index: number;
  taxable: boolean;
  created_at: string;
  updated_at: string;
  /** Standalone rows only: exclude from proposal totals when true */
  is_option?: boolean;
}

interface CustomRowLineItem {
  id: string;
  row_id: string;
  description: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  notes: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
  taxable: boolean;
  markup_percent?: number;
  item_type?: 'material' | 'labor';
  sheet_id?: string;
  quote_id?: string | null;
  workbook_id?: string | null;
  section_name?: string | null;
  hide_from_customer?: boolean;
}

/** Persisted price-list estimate row (separate from proposal workbook / custom_financial_rows). */
interface CustomerEstimateLineRow {
  id: string;
  job_id: string;
  anchor_quote_id: string;
  budget_material_catalog_id: string | null;
  description: string;
  quantity: number;
  unit_cost: number;
  markup_percent: number;
  taxable: boolean;
  notes: string | null;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

function estimateCatalogLineExtendedSell(r: CustomerEstimateLineRow): number {
  const qty = Number(r.quantity) || 0;
  const uc = Number(r.unit_cost) || 0;
  const mu = Number(r.markup_percent) || 0;
  return qty * uc * (1 + mu / 100);
}

interface LaborPricing {
  id: string;
  job_id: string;
  hourly_rate: number;
  markup_percent: number;
  billable_rate: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface MaterialsBreakdown {
  sheetBreakdowns: any[];
  totals: {
    totalCost: number;
    totalPrice: number;
    totalProfit: number;
    profitMargin: number;
  };
}

function toBool(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 't' || normalized === 'yes';
  }
  return false;
}

function isMissingSubcontractorOptionalColumnError(error: unknown): boolean {
  const msg = String((error as any)?.message || '').toLowerCase();
  return msg.includes('subcontractor_estimates') && msg.includes('is_option') && msg.includes('column');
}

function isMissingCustomerEstimateLinesTableError(error: unknown): boolean {
  const msg = String((error as any)?.message || '').toLowerCase();
  return msg.includes('customer_estimate_lines') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

function isMissingCustomRowItemColumnError(error: unknown, col: string): boolean {
  return isMissingColumnError(error, col);
}

function isMissingQuoteRemovedSectionsError(error: unknown): boolean {
  const msg = String((error as any)?.message || '').toLowerCase();
  const code = String((error as any)?.code || '');
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    (msg.includes('quote_removed_sections') &&
      (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('not found')))
  );
}

function getSubOptionalStorageKey(scopeId: string): string {
  return `jobfinancials_sub_optional_${scopeId}`;
}

function readSubOptionalStorage(scopeId: string): Record<string, boolean> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(getSubOptionalStorageKey(scopeId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, boolean> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([k, v]) => {
      out[k] = toBool(v);
    });
    return out;
  } catch {
    return {};
  }
}

function writeSubOptionalStorage(scopeId: string, value: Record<string, boolean>): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(getSubOptionalStorageKey(scopeId), JSON.stringify(value));
  } catch {
    // Ignore storage write errors (private mode/quota, etc.)
  }
}

function getSubOptionalUnsupportedKey(jobId: string): string {
  return `jobfinancials_sub_optional_unsupported_${jobId}`;
}

function readSubOptionalUnsupported(jobId: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return toBool(window.localStorage.getItem(getSubOptionalUnsupportedKey(jobId)));
  } catch {
    return false;
  }
}

function writeSubOptionalUnsupported(jobId: string, value: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(getSubOptionalUnsupportedKey(jobId), value ? '1' : '0');
  } catch {
    // Ignore storage write errors.
  }
}

interface JobFinancialsProps {
  job: Job;
  /** When provided (e.g. combined Proposal+Materials view), sync selected proposal with parent */
  controlledQuoteId?: string | null;
  /** Notify parent when user changes proposal so materials panel can stay in sync */
  onQuoteChange?: (quoteId: string | null) => void;
  /** Notify parent which sheet row is being interacted with (split-view sync). */
  onSheetSelect?: (sheetId: string | null) => void;
  /** Structured per-sheet category prices from right-panel Breakdown (source of truth). */
  externalBreakdownSheetPrices?: { sheetId: string; sheetName: string; categories: Record<string, number> }[];
  /** When split-view materials panel is viewing a locked workbook snapshot, mirror that here for pricing isolation. */
  externalMaterialsWorkbookView?: { workbookId: string | null; status: 'working' | 'locked' | null } | null;
  /** Signed contract: extended sell total of job workbook (`working` row), separate from proposal materials. */
  externalJobWorkbookMaterialsTotal?: number | null;
  /** Split view: lift session "unlock for editing" so Materials uses the same read-only gate as this panel. */
  historicalUnlockedQuoteId?: string | null;
  onHistoricalUnlockedQuoteIdChange?: (id: string | null) => void;
  /** When true, defer loadData until Materials finishes loadWorkbook for the active quote. */
  materialsPanelActive?: boolean;
  materialsWorkbookReady?: boolean;
  /** Incremented on each proposal switch in split view — gates loadData until Materials settles. */
  materialsSyncGen?: number;
}

/** Nested material_sheets select variants for cloning (most complete → oldest DBs). */
const MATERIAL_SHEETS_NESTED_SELECT_VARIANTS = [
  // 0: full
  `id, sheet_name, order_index, is_option, description, sheet_type, change_order_seq, category_order, compare_to_sheet_id,
  material_items (*),
  material_sheet_labor (*),
  material_category_markups (*)`,
  // 1: no change_order_seq
  `id, sheet_name, order_index, is_option, description, sheet_type, category_order, compare_to_sheet_id,
  material_items (*),
  material_sheet_labor (*),
  material_category_markups (*)`,
  // 2: no category_order (some DBs before migration)
  `id, sheet_name, order_index, is_option, description, sheet_type, change_order_seq, compare_to_sheet_id,
  material_items (*),
  material_sheet_labor (*),
  material_category_markups (*)`,
  // 3: neither change_order_seq nor category_order
  `id, sheet_name, order_index, is_option, description, sheet_type, compare_to_sheet_id,
  material_items (*),
  material_sheet_labor (*),
  material_category_markups (*)`,
  // 4: no compare_to_sheet_id
  `id, sheet_name, order_index, is_option, description, sheet_type,
  material_items (*),
  material_sheet_labor (*),
  material_category_markups (*)`,
  // 5: no sheet_type
  `id, sheet_name, order_index, is_option, description,
  material_items (*),
  material_sheet_labor (*),
  material_category_markups (*)`,
];

async function fetchMaterialWorkbooksFullForQuote(quoteId: string) {
  // `*` on workbook copies flatstock_width_inches, trim_flatstock_plan, etc. (not just id)
  let lastErr: { message: string } | null = null;
  for (const nested of MATERIAL_SHEETS_NESTED_SELECT_VARIANTS) {
    const q = `*, material_sheets (${nested})`;
    const res = await supabase.from('material_workbooks').select(q).eq('quote_id', quoteId);
    if (!res.error) return res;
    lastErr = res.error;
  }
  return { data: null, error: lastErr };
}

/** Pick one canonical workbook to clone (working preferred; labor + items break ties). */
function pickWorkbookForProposalClone(workbooks: any[]): any | null {
  if (!workbooks?.length) return null;
  const score = (wb: any) => {
    const sheets = ((wb.material_sheets as any[]) || []);
    let itemCount = 0;
    let laborCount = 0;
    sheets.forEach((s) => {
      itemCount += (s.material_items || []).length;
      laborCount += (s.material_sheet_labor || []).length;
    });
    const statusBoost =
      wb.status === 'working' ? 1_000_000 : wb.status === 'locked' ? 500_000 : 0;
    return statusBoost + laborCount * 10_000 + itemCount * 100 + sheets.length;
  };
  return workbooks.reduce((best, wb) => (score(wb) > score(best) ? wb : best));
}

function laborMapTotal(laborMap: Record<string, any>): number {
  return Object.values(laborMap).reduce((s: number, l: any) => {
    const direct = Number(l?.total_labor_cost);
    if (Number.isFinite(direct) && direct > 0) return s + direct;
    return s + Number(l?.estimated_hours || 0) * Number(l?.hourly_rate || 0);
  }, 0);
}

function normalizeLaborSheetName(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Resolve sheet-linked line items when map keys drift (locked vs working workbook sheet ids). */
function resolveCustomRowLineItemsForSheet(
  customRowLineItems: Record<string, CustomRowLineItem[]>,
  materialSheets: { id?: string; sheet_name?: string }[],
  sectionSheetId: string,
  sheetName?: string,
  breakdownSheets?: { sheetId?: string; sheetName?: string; id?: string; sheet_name?: string }[],
  sheetMetaById?: Record<string, string>,
): CustomRowLineItem[] {
  const direct = customRowLineItems[sectionSheetId];
  if (direct?.length) return direct;
  const targetName = normalizeLaborSheetName(sheetName);
  if (!targetName) return direct || [];
  const idToName = new Map<string, string>();
  materialSheets.forEach((s) => {
    const id = String(s?.id ?? '').trim();
    if (id) idToName.set(id, normalizeLaborSheetName(s?.sheet_name));
  });
  (breakdownSheets || []).forEach((s) => {
    const id = String(s?.sheetId ?? s?.id ?? '').trim();
    if (id && !idToName.has(id)) {
      idToName.set(id, normalizeLaborSheetName(s?.sheetName ?? s?.sheet_name));
    }
  });
  if (sheetMetaById) {
    Object.entries(sheetMetaById).forEach(([id, name]) => {
      const sid = String(id).trim();
      if (sid && !idToName.has(sid)) idToName.set(sid, normalizeLaborSheetName(name));
    });
  }
  for (const [sid, items] of Object.entries(customRowLineItems)) {
    if (sid === sectionSheetId || !items?.length) continue;
    const keyName =
      idToName.get(String(sid).trim()) ??
      normalizeLaborSheetName((items[0] as { section_name?: string })?.section_name);
    if (keyName === targetName) return items;
  }
  return direct || [];
}

function laborTotalFromLineItemsMap(map: Record<string, CustomRowLineItem[]>): number {
  return Object.values(map).flat().reduce((sum, item) => {
    if ((item.item_type || 'material') !== 'labor') return sum;
    return sum + (Number(item.total_cost) || Number(item.quantity || 0) * Number(item.unit_cost || 0));
  }, 0);
}

function extractSheetOnlyLineItems(
  map: Record<string, CustomRowLineItem[]>,
  rowIds: Set<string>,
): Record<string, CustomRowLineItem[]> {
  return Object.fromEntries(
    Object.entries(map).filter(([k, items]) => {
      if (rowIds.has(k)) return false;
      return !(items || []).some((it) => it.row_id);
    }),
  );
}

type LaborSheetRef = { id: string; sheet_name?: string; order_index?: number };

/** Map sheet-linked line items onto the workbook sheets currently displayed (match by sheet name). */
function rekeySheetLineItemsToDisplayedSheets(
  lineItemsMap: Record<string, CustomRowLineItem[]>,
  displayedSheets: LaborSheetRef[],
  sheetIdToName: Map<string, string>,
): Record<string, CustomRowLineItem[]> {
  const nativeDisplayedIds = new Set(
    displayedSheets.map((s) => String(s?.id ?? '').trim()).filter(Boolean),
  );
  const nameToDisplayedId = new Map<string, string>();
  displayedSheets.forEach((s) => {
    const id = String(s?.id ?? '').trim();
    const nk = normalizeLaborSheetName(s?.sheet_name);
    if (id && nk && !nameToDisplayedId.has(nk)) nameToDisplayedId.set(nk, id);
  });

  const out: Record<string, CustomRowLineItem[]> = {};
  const seenByTarget = new Map<string, Set<string>>();

  const push = (targetId: string, item: CustomRowLineItem) => {
    if (!targetId || !nativeDisplayedIds.has(targetId)) return;
    const iid = String(item?.id ?? '').trim();
    if (!out[targetId]) {
      out[targetId] = [];
      seenByTarget.set(targetId, new Set());
    }
    const seen = seenByTarget.get(targetId)!;
    if (iid && seen.has(iid)) return;
    if (iid) seen.add(iid);
    out[targetId].push({ ...item, sheet_id: targetId });
  };

  for (const [parentId, items] of Object.entries(lineItemsMap)) {
    if (items.some((item) => item.row_id)) {
      out[parentId] = items.slice();
      continue;
    }
    for (const item of items) {
      if (item.row_id) continue;
      const sid = String(item.sheet_id ?? parentId).trim();
      if (nativeDisplayedIds.has(sid)) {
        push(sid, item);
        continue;
      }
      const nameKey = normalizeLaborSheetName(
        sheetIdToName.get(sid) ?? sheetIdToName.get(String(parentId).trim()),
      );
      const targetId = nameKey ? nameToDisplayedId.get(nameKey) : undefined;
      if (targetId) push(targetId, item);
      else if (nativeDisplayedIds.has(String(parentId).trim())) push(String(parentId).trim(), item);
    }
  }
  Object.keys(out).forEach((k) => {
    out[k].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  });
  return out;
}

/** Re-key labor onto the sheets currently displayed (locked vs working clones use different sheet ids). */
function remapLaborPayloadToDisplayedSheets(
  displayedSheets: LaborSheetRef[],
  laborById: Record<string, any>,
  laborByName?: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = {};
  const effectiveTotal = (lab: any) => {
    const direct = Number(lab?.total_labor_cost);
    if (Number.isFinite(direct) && direct > 0) return direct;
    return Number(lab?.estimated_hours || 0) * Number(lab?.hourly_rate || 0);
  };

  displayedSheets.forEach((s) => {
    const sid = String(s?.id ?? '').trim();
    if (!sid) return;
    const nameKey = normalizeLaborSheetName(s?.sheet_name);

    let lab: any =
      laborById[sid] ??
      Object.entries(laborById).find(([k]) => String(k).trim() === sid)?.[1];
    if (!lab && nameKey && laborByName?.[nameKey]) {
      lab = laborByName[nameKey];
    }
    if (!lab || !(effectiveTotal(lab) > 0)) return;

    const sourceSid = String(lab.labor_source_sheet_id ?? lab.sheet_id ?? sid).trim();
    const remapped = {
      ...lab,
      sheet_id: sid,
      labor_source_sheet_id: sourceSid || sid,
    };
    if (sourceSid !== sid) remapped.labor_mergetrusted = true;
    out[sid] = remapped;
  });

  return out;
}

function agentDebugLog(payload: {
  runId?: string;
  hypothesisId?: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
}) {
  const body = { sessionId: '458a80', timestamp: Date.now(), ...payload };
  console.warn('[458a80]', body.message, body.data ?? {});
  try {
    const key = 'debug-458a80';
    const prev = JSON.parse(sessionStorage.getItem(key) || '[]') as unknown[];
    prev.push(body);
    if (prev.length > 100) prev.splice(0, prev.length - 100);
    sessionStorage.setItem(key, JSON.stringify(prev));
  } catch {
    // ignore
  }
  fetch('http://127.0.0.1:7264/ingest/38c719fd-41f2-436e-b178-2936be94ecc3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '458a80' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

/** Last resort: pull labor from every workbook/sheet for this quote onto displayed sections. */
async function mergeLaborFromAllQuoteWorkbooks(
  targetQuoteId: string,
  displayedSheets: { id: string; sheet_name?: string; order_index?: number }[],
  laborMap: Record<string, any>,
): Promise<void> {
  const normalizeSheetName = (v: unknown) =>
    String(v ?? '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  const displayedByName = new Map<string, string>();
  const displayedByOrder = new Map<number, string>();
  displayedSheets.forEach((s) => {
    const sid = String(s?.id ?? '').trim();
    if (!sid) return;
    const nameKey = normalizeSheetName(s.sheet_name);
    if (nameKey && !displayedByName.has(nameKey)) displayedByName.set(nameKey, sid);
    const oi = Number(s.order_index);
    if (Number.isFinite(oi) && !displayedByOrder.has(oi)) displayedByOrder.set(oi, sid);
  });
  const { data: wbs } = await supabase.from('material_workbooks').select('id').eq('quote_id', targetQuoteId);
  const wbIds = (wbs || []).map((w) => w.id).filter(Boolean);
  if (wbIds.length === 0) return;
  const { data: allSheets } = await supabase
    .from('material_sheets')
    .select('id, sheet_name, order_index')
    .in('workbook_id', wbIds);
  const allSheetRows = (allSheets || []) as { id: string; sheet_name?: string; order_index?: number }[];
  const allSheetIds = allSheetRows.map((s) => s.id).filter(Boolean);
  if (allSheetIds.length === 0) return;
  const { data: allLaborRows } = await supabase
    .from('material_sheet_labor')
    .select('*')
    .in('sheet_id', allSheetIds);
  const metaBySheetId = new Map(allSheetRows.map((s) => [String(s.id), s]));
  (allLaborRows || []).forEach((labor: any) => {
    const sid = String(labor.sheet_id ?? '').trim();
    const meta = metaBySheetId.get(sid);
    if (!meta) return;
    const byName = displayedByName.get(normalizeSheetName(meta.sheet_name));
    const oi = Number(meta.order_index);
    const byOrder = Number.isFinite(oi) ? displayedByOrder.get(oi) : undefined;
    const mappedSheetId = byName || byOrder;
    if (!mappedSheetId) return;
    const total =
      labor.total_labor_cost ??
      (Number(labor.estimated_hours || 0) * Number(labor.hourly_rate || 0));
    if (!(Number.isFinite(Number(total)) && Number(total) > 0)) return;
    const existing = laborMap[mappedSheetId];
    const existingTotal = existing ? laborMapTotal({ [mappedSheetId]: existing }) : 0;
    if (Number(total) <= existingTotal) return;
    laborMap[mappedSheetId] = {
      ...labor,
      sheet_id: mappedSheetId,
      total_labor_cost: total,
      labor_source_sheet_id: sid,
      labor_mergetrusted: true,
    };
  });
}

/** Map labor from job workbooks (quote-scoped or legacy null quote_id) onto displayed sheets by name/order. */
async function mergeLaborFromJobWorkbooksForQuote(
  jobId: string,
  targetQuoteId: string,
  displayedSheets: LaborSheetRef[],
  laborMap: Record<string, any>,
): Promise<void> {
  const normalizeSheetName = (v: unknown) =>
    String(v ?? '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  const displayedByName = new Map<string, string>();
  const displayedByOrder = new Map<number, string>();
  displayedSheets.forEach((s) => {
    const sid = String(s?.id ?? '').trim();
    if (!sid) return;
    const nameKey = normalizeSheetName(s.sheet_name);
    if (nameKey && !displayedByName.has(nameKey)) displayedByName.set(nameKey, sid);
    const oi = Number(s.order_index);
    if (Number.isFinite(oi) && !displayedByOrder.has(oi)) displayedByOrder.set(oi, sid);
  });
  const { data: jobWbs } = await supabase
    .from('material_workbooks')
    .select('id, quote_id')
    .eq('job_id', jobId);
  const allowedWbIds = (jobWbs || [])
    .filter((w: any) => {
      const qid = String(w?.quote_id ?? '').trim();
      return !qid || qid === targetQuoteId;
    })
    .map((w: any) => String(w?.id ?? '').trim())
    .filter(Boolean);
  if (allowedWbIds.length === 0) return;
  const { data: jobSheets } = await supabase
    .from('material_sheets')
    .select('id, sheet_name, order_index, workbook_id')
    .in('workbook_id', allowedWbIds);
  const sheetRows = (jobSheets || []) as {
    id: string;
    sheet_name?: string;
    order_index?: number;
    workbook_id?: string;
  }[];
  const sheetIds = sheetRows.map((s) => s.id).filter(Boolean);
  if (sheetIds.length === 0) return;
  const { data: laborRows } = await supabase
    .from('material_sheet_labor')
    .select('*')
    .in('sheet_id', sheetIds);
  const metaBySheetId = new Map(sheetRows.map((s) => [String(s.id), s]));
  (laborRows || []).forEach((labor: any) => {
    const sid = String(labor.sheet_id ?? '').trim();
    const meta = metaBySheetId.get(sid);
    if (!meta) return;
    const byName = displayedByName.get(normalizeSheetName(meta.sheet_name));
    const oi = Number(meta.order_index);
    const byOrder = Number.isFinite(oi) ? displayedByOrder.get(oi) : undefined;
    const mappedSheetId = byName || byOrder;
    if (!mappedSheetId) return;
    const total =
      labor.total_labor_cost ??
      (Number(labor.estimated_hours || 0) * Number(labor.hourly_rate || 0));
    if (!(Number.isFinite(Number(total)) && Number(total) > 0)) return;
    const existing = laborMap[mappedSheetId];
    const existingTotal = existing ? laborMapTotal({ [mappedSheetId]: existing }) : 0;
    if (Number(total) <= existingTotal) return;
    laborMap[mappedSheetId] = {
      ...labor,
      sheet_id: mappedSheetId,
      total_labor_cost: total,
      labor_source_sheet_id: sid,
      labor_mergetrusted: true,
    };
  });
}

/** Clone inserts must not keep source quote_id / workbook_id (would tie proposals together). */
function payloadForClonedLineItem(
  source: Record<string, unknown>,
  scope: {
    row_id: string | null;
    sheet_id: string | null;
    quote_id: string;
    workbook_id?: string | null;
    section_name?: string | null;
  },
): Record<string, unknown> {
  const {
    id: _id,
    row_id: _rid,
    sheet_id: _sid,
    quote_id: _qid,
    workbook_id: _wb,
    section_name: _sn,
    created_at: _ca,
    updated_at: _ua,
    ...rest
  } = source;
  const out: Record<string, unknown> = {
    ...rest,
    row_id: scope.row_id,
    sheet_id: scope.sheet_id,
    quote_id: scope.quote_id,
  };
  if (scope.workbook_id !== undefined) out.workbook_id = scope.workbook_id;
  if (scope.section_name !== undefined) out.section_name = scope.section_name;
  return out;
}

/** Internal / crew workbooks — not shown in the proposal section list but share the same quote workbook. */
const PROPOSAL_TOTALS_EXCLUDED_SHEET_NAMES = ['Field Request', 'Field Requests', 'Crew Orders'] as const;

function isInternalWorkbookSheetName(sheetName: unknown): boolean {
  const n = String(sheetName ?? '').trim();
  return (PROPOSAL_TOTALS_EXCLUDED_SHEET_NAMES as readonly string[]).includes(n);
}

/** Sections that contribute to sticky Materials / Labor / Subtotal (matches non-optional proposal workbook rows). */
function materialSheetCountsTowardProposalSubtotal(sheet: {
  sheetName?: string;
  sheetType?: string;
  isOptional?: boolean;
}): boolean {
  if ((sheet as any).isOptional) return false;
  if (((sheet as any).sheetType ?? 'proposal') === 'change_order') return false;
  if (isInternalWorkbookSheetName((sheet as any).sheetName)) return false;
  return true;
}

/** Linked subcontractor line items split by item_type (material vs labor) for section totals. */
function sumLinkedSubMaterialsFromSubs(
  linkedSubs: any[],
  subcontractorLineItems: Record<string, any[]>
): number {
  return linkedSubs.reduce((sum: number, sub: any) => {
    const lineItems = subcontractorLineItems[sub.id] || [];
    const materialTotal = lineItems
      .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'material')
      .reduce((itemSum: number, item: any) => itemSum + item.total_price, 0);
    const estMarkup = sub.markup_percent || 0;
    return sum + materialTotal * (1 + estMarkup / 100);
  }, 0);
}

function sumLinkedSubLaborFromSubs(
  linkedSubs: any[],
  subcontractorLineItems: Record<string, any[]>
): number {
  return linkedSubs.reduce((sum: number, sub: any) => {
    const lineItems = subcontractorLineItems[sub.id] || [];
    const laborTotal = lineItems
      .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'labor')
      .reduce((itemSum: number, item: any) => itemSum + item.total_price, 0);
    const estMarkup = sub.markup_percent || 0;
    return sum + laborTotal * (1 + estMarkup / 100);
  }, 0);
}

function normalizeMarkupKeyPart(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function lookupCategoryMarkup(
  categoryMarkups: Record<string, number>,
  sheetId: string,
  categoryName: unknown,
  defaultMarkup: number
): number {
  const rawName = String(categoryName ?? '');
  const exactKey = `${sheetId}_${rawName}`;
  if (categoryMarkups[exactKey] != null) return Number(categoryMarkups[exactKey]) || 0;

  // Fallback: match existing keys case-insensitively (handles "Trim" vs "trim", whitespace differences, etc.).
  const want = normalizeMarkupKeyPart(rawName);
  const prefix = `${sheetId}_`;
  for (const [k, v] of Object.entries(categoryMarkups)) {
    if (!k.startsWith(prefix)) continue;
    const suffix = k.slice(prefix.length);
    if (normalizeMarkupKeyPart(suffix) === want) return Number(v) || 0;
  }
  return Number(defaultMarkup) || 0;
}

/** Matches `sumLinkedRowTotals` / DB rows where total_cost is empty but quantity×unit_cost is set. */
function effectiveCustomRowLineItemBase(item: any): number {
  return (
    Number((item as any)?.total_price ?? (item as any)?.total_cost) ||
    (Number((item as any)?.quantity) || 0) * (Number((item as any)?.unit_cost) || 0)
  );
}

/** Detect when a server row is the persisted form of an optimistic row (avoid duplicate cards + undeletable ghosts). */
function lineItemOptimisticFingerprint(it: any): string {
  const base = effectiveCustomRowLineItemBase(it);
  return [
    String(it?.description ?? '').trim(),
    Number(it?.quantity) || 0,
    Number(it?.unit_cost) || 0,
    Math.round(base * 100) / 100,
    String(it?.item_type ?? 'material'),
    String(it?.notes ?? ''),
  ].join('\u241e');
}

/** Labor portion stored inside `notes` JSON for combined material+labor line items. */
function parseLineItemEmbeddedLabor(
  notes: string | null | undefined
): { hours: number; rate: number; markup: number } | null {
  if (!notes || typeof notes !== 'string') return null;
  const s = notes.trim();
  if (!s.startsWith('{')) return null;
  try {
    const o = JSON.parse(s) as { labor?: { hours?: unknown; rate?: unknown; markup?: unknown } };
    const L = o?.labor;
    if (!L || typeof L !== 'object') return null;
    const hours = Number(L.hours) || 0;
    const rate = Number(L.rate) || 0;
    if (hours <= 0 || rate <= 0) return null;
    return {
      hours,
      rate,
      markup: L.markup != null && L.markup !== '' ? Number(L.markup) || 0 : 0,
    };
  } catch {
    return null;
  }
}

function isCombinedMaterialLaborLineItem(lineItem: any): boolean {
  return (lineItem.item_type || 'material') !== 'labor' && parseLineItemEmbeddedLabor(lineItem.notes) != null;
}

/** Workbook category treated as section labor in the narrow Materials/Labor column (not material_sheet_labor). */
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

/**
 * `sheetLabor` can include rows merged from another workbook/sheet onto this section for display.
 * Those objects set `labor_source_sheet_id` to the DB row's real `material_sheets.id`.
 * Only native rows (source id === displayed sheet id) should show in the section, affect totals, or be edited in place.
 */
function isNativeMaterialSheetLabor(labor: any, displaySheetId: string): boolean {
  if (!labor || !displaySheetId) return false;
  const sid = String(displaySheetId).trim();
  const source = String(labor.labor_source_sheet_id ?? labor.sheet_id ?? '').trim();
  return source !== '' && source === sid;
}

/** Include labor in this section's totals/UI when it is native, or an intentional same-quote / fallback merge (not orphan job-sheet bleed). */
function sheetLaborCountsForDisplayedSection(labor: any, displaySheetId: string): boolean {
  if (!labor || !displaySheetId) return false;
  if (labor.labor_mergetrusted === true) return true;
  return isNativeMaterialSheetLabor(labor, displaySheetId);
}

/** Linked custom row totals split by item_type and per-line-item markup. */
function sumLinkedRowTotals(
  linkedRows: any[],
  customRowLineItems: Record<string, any[]>
): { materialTotal: number; laborTotal: number } {
  return linkedRows.reduce(
    (acc: { materialTotal: number; laborTotal: number }, row: any) => {
      const lineItems = customRowLineItems[row.id] || [];

      if (lineItems.length > 0) {
        for (const item of lineItems) {
          const itemCost = effectiveCustomRowLineItemBase(item);
          const itemMarkup = Number(item?.markup_percent ?? row?.markup_percent ?? 0) || 0;
          const itemPrice = itemCost * (1 + itemMarkup / 100);
          const itemType = (item?.item_type || 'material') === 'labor' ? 'labor' : 'material';
          if (itemType === 'labor') acc.laborTotal += itemPrice;
          else acc.materialTotal += itemPrice;
        }
      } else {
        const baseCost =
          Number(row?.total_cost) ||
          (Number(row?.quantity) || 0) * (Number(row?.unit_cost) || 0);
        const rowMarkup = Number(row?.markup_percent ?? 0) || 0;
        const price = baseCost * (1 + rowMarkup / 100);
        if (row.category === 'labor') acc.laborTotal += price;
        else acc.materialTotal += price;
      }

      return acc;
    },
    { materialTotal: 0, laborTotal: 0 }
  );
}

/** Linked custom-row material totals + taxable portion, matching section header math (per-line-item markup). */
function sumLinkedRowMaterialTotals(
  linkedRows: any[],
  customRowLineItems: Record<string, any[]>
): { materialTotal: number; materialTaxableOnly: number } {
  return linkedRows.reduce(
    (acc: { materialTotal: number; materialTaxableOnly: number }, row: any) => {
      const lineItems = customRowLineItems[row.id] || [];
      if (lineItems.length > 0) {
        for (const item of lineItems) {
          const itemType = (item?.item_type || 'material') === 'labor' ? 'labor' : 'material';
          if (itemType !== 'material') continue;
          const itemCost = effectiveCustomRowLineItemBase(item);
          const itemMarkup = Number(item?.markup_percent ?? row?.markup_percent ?? 0) || 0;
          const itemPrice = itemCost * (1 + itemMarkup / 100);
          acc.materialTotal += itemPrice;
          if (item?.taxable) acc.materialTaxableOnly += itemPrice;
        }
      } else if (row.category !== 'labor') {
        const baseCost = Number(row?.total_cost) || 0;
        const rowMarkup = Number(row?.markup_percent ?? 0) || 0;
        const price = baseCost * (1 + rowMarkup / 100);
        acc.materialTotal += price;
        if (row?.taxable) acc.materialTaxableOnly += price;
      }
      return acc;
    },
    { materialTotal: 0, materialTaxableOnly: 0 }
  );
}

// Sortable Row Component
function SortableRow({
  item,
  isReadOnly,
  quote,
  setOptionalCategoryOverlay = () => {},
  onOpenCopyToChangeOrder,
  changeOrderAlreadySent,
  onSendChangeOrdersToCustomer,
  sendingCoToCustomer,
  jobHasContract,
  ...props
}: any) {
  const setOptCatOverlay = setOptionalCategoryOverlay;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const {
    sheetMarkups,
    setSheetMarkups,
    categoryMarkups,
    setCategoryMarkups,
    customRowLineItems,
    sheetLabor,
    customRowLabor,
    subcontractorLineItems,
    linkedSubcontractors,
    editingRowName,
    editingRowNameType,
    tempRowName,
    setTempRowName,
    startEditingRowName,
    saveRowName,
    cancelEditingRowName,
    openSheetDescDialog,
    openLaborDialog,
    openAddDialog,
    openLineItemDialog,
    openSubcontractorDialog,
    openAddSubcontractorLineItemDialog,
    openEditSubcontractorLineItemDialog,
    deleteRow,
    deleteSheetLabor,
    toggleSubcontractorLineItem,
    toggleSubcontractorLineItemTaxable,
    toggleSubcontractorLineItemType,
    unlinkSubcontractor,
    toggleSubcontractorOptional = async () => {},
    toggleCustomRowOptional = async () => {},
    deleteSubcontractorSection = async () => {},
    updateSubcontractorMarkup,
    updateCustomRowMarkup,
    updateCustomRowBaseCost,
    updateLineItemCost,
    updateCombinedLineItemMaterialBase = async () => {},
    updateLineItemEmbeddedLaborMarkup = async () => {},
    deleteLineItem,
    loadMaterialsData,
    loadCustomRows,
    loadSubcontractorEstimates,
    customRows,
    savingMarkupsRef,
    materialSheets = [],
    sheetMetaById = {},
    emptyNotesById = {},
    setEmptyNotesById = () => {},
    emptyScopeById = {},
    setEmptyScopeById = () => {},
    setComparePickerSheetId = () => {},
    setShowComparePickerDialog = () => {},
    expandedComparisons = new Set(),
    setExpandedComparisons = () => {},
    materialsBreakdown = { sheetBreakdowns: [], totals: { totalCost: 0, totalPrice: 0, totalProfit: 0, profitMargin: 0 } },
    externalPriceLookup = new Map<string, Record<string, number>>(),
    onSheetSelect = () => {},
    setOptionalSheetOverlay = (() => {}) as React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
  } = props;

  const content = (() => {
    if (item.type === 'material') {
      const sheet = item.data;
      const sectionSheetId = String((sheet as any)?.sheetId ?? (sheet as any)?.id ?? '').trim();
      const sheetIdForMatch = sectionSheetId;
      const sheetNameForMatch = String((sheet as any)?.sheetName ?? (sheet as any)?.sheet_name ?? '').trim().toLowerCase();
      const breakdownSheet = materialsBreakdown.sheetBreakdowns.find((s: any) => String(s?.sheetId ?? s?.id ?? '').trim() === sheetIdForMatch)
        || materialsBreakdown.sheetBreakdowns.find((s: any) => String(s?.sheetName ?? s?.sheet_name ?? '').trim().toLowerCase() === sheetNameForMatch);
      const linkedRows = customRows.filter((r: any) => String(r.sheet_id ?? '').trim() === sectionSheetId);
      const linkedSubs = linkedSubcontractors[sectionSheetId] || [];
      
      const linkedRowTotals = sumLinkedRowTotals(linkedRows, customRowLineItems);
      
      // Linked subcontractors: materials vs labor (item_type), same as breakdown totals & sub UI
      const linkedSubsMaterialsTotal = sumLinkedSubMaterialsFromSubs(linkedSubs, subcontractorLineItems);
      const linkedSubsLaborTotal = sumLinkedSubLaborFromSubs(linkedSubs, subcontractorLineItems);
      
      // Sheet labor: tolerate map key mismatch; use hours×rate when total_labor_cost is missing/zero
      let sheetLaborRow: any;
      if (sectionSheetId) {
        sheetLaborRow = sheetLabor[sectionSheetId];
        if (!sheetLaborRow) {
          for (const k of Object.keys(sheetLabor)) {
            if (String(k).trim() === sectionSheetId) {
              sheetLaborRow = sheetLabor[k];
              break;
            }
          }
        }
      }
      const sheetLaborTotal =
        sheetLaborRow && sheetLaborCountsForDisplayedSection(sheetLaborRow, sectionSheetId)
          ? Number(sheetLaborRow.total_labor_cost) ||
            Number(sheetLaborRow.estimated_hours || 0) * Number(sheetLaborRow.hourly_rate || 0)
          : 0;
      
      // Calculate labor from sheet line items (with markup, same as line item display)
      const resolvedSheetLineItems = resolveCustomRowLineItemsForSheet(
        customRowLineItems,
        materialSheets,
        sectionSheetId,
        sheet.sheetName,
        materialsBreakdown?.sheetBreakdowns,
        sheetMetaById,
      );
      const sheetLaborItems = resolvedSheetLineItems.filter((item: any) => (item.item_type || 'material') === 'labor') || [];
      const sheetLaborLineItemsTotal = sheetLaborItems.reduce((sum: number, item: any) => {
        const itemMarkup = item.markup_percent ?? 0;
        return sum + effectiveCustomRowLineItemBase(item) * (1 + itemMarkup / 100);
      }, 0);

      // Sheet-level material line items (Add Material Row from section) — include in section total
      const sheetMaterialItems = resolvedSheetLineItems.filter((item: any) => (item.item_type || 'material') === 'material') || [];
      const sheetMaterialLineItemsTotal = sheetMaterialItems.reduce((sum: number, item: any) => {
        const itemMarkup = item.markup_percent ?? 0;
        return sum + effectiveCustomRowLineItemBase(item) * (1 + itemMarkup / 100);
      }, 0);
      
      const categorySource = ((breakdownSheet as any)?.categories?.length ? (breakdownSheet as any).categories : sheet.categories) || [];
      const normalizeCategoryName = (name: unknown) => String(name ?? '').trim().toLowerCase();
      const breakdownCategories = (((breakdownSheet as any)?.categories || []) as any[]);
      const breakdownCategoryPriceByName = new Map<string, number>(
        breakdownCategories.map((cat: any) => [normalizeCategoryName(cat?.name), Number(cat?.totalPrice) || 0])
      );
      const getCategoryBreakdownPrice = (cat: any) => {
        const catKey = normalizeCategoryName(cat?.name);

        // Primary source-of-truth: structured external prices from right-panel Breakdown.
        // Try matching by sheet ID first, then sheet name.
        const extBySheetId = externalPriceLookup.get(sheetIdForMatch);
        if (extBySheetId && Object.prototype.hasOwnProperty.call(extBySheetId, catKey)) {
          return Number(extBySheetId[catKey]) || 0;
        }
        const extBySheetName = externalPriceLookup.get(sheetNameForMatch);
        if (extBySheetName && Object.prototype.hasOwnProperty.call(extBySheetName, catKey)) {
          return Number(extBySheetName[catKey]) || 0;
        }

        // Fallback: compute from items in this category's own breakdown data.
        const itemsPrice = ((cat?.items || []) as any[]).reduce((sum: number, item: any) => {
          if (item?.extended_price != null && item.extended_price !== '') {
            return sum + (Number(item.extended_price) || 0);
          }
          return sum + ((Number(item?.quantity) || 0) * (Number(item?.price_per_unit) || 0));
        }, 0);
        if (itemsPrice > 0) return itemsPrice;

        const directTotalPrice = Number(cat?.totalPrice);
        if (Number.isFinite(directTotalPrice) && directTotalPrice > 0) return directTotalPrice;

        if (breakdownCategoryPriceByName.has(catKey)) return breakdownCategoryPriceByName.get(catKey) || 0;
        return 0;
      };

      // When `externalPriceLookup` provides a category total, treat it as the base category price
      // so the per-category markup % always affects the section "Price" column.
      const getCategoryDisplayPrice = (cat: any) => {
        const catKey = normalizeCategoryName(cat?.name);
        const extBySheetId = externalPriceLookup.get(sheetIdForMatch);
        if (extBySheetId && Object.prototype.hasOwnProperty.call(extBySheetId, catKey)) {
          return { price: Number(extBySheetId[catKey]) || 0, isFinal: false };
        }
        const extBySheetName = externalPriceLookup.get(sheetNameForMatch);
        if (extBySheetName && Object.prototype.hasOwnProperty.call(extBySheetName, catKey)) {
          return { price: Number(extBySheetName[catKey]) || 0, isFinal: false };
        }
        return { price: getCategoryBreakdownPrice(cat), isFinal: false };
      };

      // Materials vs labor: categories named "Labor" (common workbook layout) count in the Labor column, not Materials.
      const displayCategoriesForMaterialsSum =
        breakdownCategories.length > 0 ? breakdownCategories : categorySource;
      let materialsSubtotalFromCategories = 0;
      let laborSubtotalFromCategories = 0;
      for (const cat of displayCategoriesForMaterialsSum) {
        const catSheetId = String(sheet?.sheetId ?? sheet?.id ?? '').trim();
        const categoryMarkup = lookupCategoryMarkup(
          categoryMarkups,
          catSheetId,
          cat?.name,
          (sheet.markup_percent ?? 10)
        );
        const { price, isFinal } = getCategoryDisplayPrice(cat);
        const lineTotal = isFinal ? price : price * (1 + (Number(categoryMarkup) || 0) / 100);
        if (isWorkbookLaborCategoryName(cat?.name)) laborSubtotalFromCategories += lineTotal;
        else materialsSubtotalFromCategories += lineTotal;
      }
      const sheetFinalPrice =
        materialsSubtotalFromCategories +
        sheetMaterialLineItemsTotal +
        linkedRowTotals.materialTotal +
        linkedSubsMaterialsTotal;
      
      // Total labor: DB sheet labor + line items + linked rows/subs + workbook "Labor" category
      const totalLaborCost =
        sheetLaborTotal +
        sheetLaborLineItemsTotal +
        linkedRowTotals.laborTotal +
        linkedSubsLaborTotal +
        laborSubtotalFromCategories;
      const sectionTotal = sheetFinalPrice + totalLaborCost;

      return (
        <Collapsible
          className="border border-slate-300 rounded-lg bg-white py-2 px-3 shadow-sm"
          onClickCapture={() => onSheetSelect?.(sectionSheetId || null)}
        >
          <div className="flex items-start gap-2">
            {/* Drag Handle */}
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing py-1">
              <GripVertical className="w-4 h-4 text-slate-400" />
            </div>

            {/* Chevron */}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="p-0 h-auto hover:bg-transparent">
                <ChevronDown className="w-4 h-4 text-slate-600" />
              </Button>
            </CollapsibleTrigger>

            {/* Title */}
            <div className="flex-1 min-w-0">
              {editingRowName === sectionSheetId && editingRowNameType === 'sheet' ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={tempRowName}
                    onChange={(e) => setTempRowName(e.target.value)}
                    className="h-7 text-sm font-bold"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRowName();
                      if (e.key === 'Escape') cancelEditingRowName();
                    }}
                  />
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={saveRowName}>
                    <Check className="w-3 h-3 text-green-600" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={cancelEditingRowName}>
                    <X className="w-3 h-3 text-red-600" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  {(sheet as any).sheetType === 'change_order' && (sheet as any).changeOrderSeq != null && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-semibold bg-orange-100 text-orange-900 border border-orange-300">
                      CO-{String((sheet as any).changeOrderSeq).padStart(3, '0')}
                    </span>
                  )}
                  <h3
                    className={`text-base font-bold text-slate-900 truncate ${!isReadOnly ? 'cursor-text' : ''}`}
                    title={!isReadOnly ? 'Double-click to rename' : undefined}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (isReadOnly) {
                        toast.error('Cannot edit in historical view');
                        return;
                      }
                      startEditingRowName(sectionSheetId, 'sheet', sheet.sheetName);
                    }}
                  >
                    {sheet.sheetName}
                  </h3>
                  {(sheet as any).isOptional && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                      Optional
                    </span>
                  )}
                </div>
              )}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[14rem]">
                <DropdownMenuItem onClick={() => openSheetDescDialog(sectionSheetId, sheet.sheetDescription)}>
                  <Edit className="w-3 h-3 mr-2" />
                  Edit Description
                </DropdownMenuItem>
                {(sheet as any).sheetType === 'change_order' && onSendChangeOrdersToCustomer && (
                  <>
                    {changeOrderAlreadySent ? (
                      <DropdownMenuItem disabled className="opacity-80">
                        <CheckCircle className="w-3 h-3 mr-2 text-green-600" />
                        Change orders already sent to customer
                      </DropdownMenuItem>
                    ) : !jobHasContract ? (
                      <DropdownMenuItem disabled className="opacity-80">
                        <Lock className="w-3 h-3 mr-2 text-slate-500" />
                        Set main proposal as contract before sending
                      </DropdownMenuItem>
                    ) : isReadOnly ? (
                      <DropdownMenuItem disabled className="opacity-70">
                        <Send className="w-3 h-3 mr-2 text-slate-400" />
                        Send from live proposal (not historical view)
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.preventDefault();
                          void onSendChangeOrdersToCustomer();
                        }}
                        disabled={!!sendingCoToCustomer}
                        className="text-orange-800 focus:text-orange-900 focus:bg-orange-50"
                      >
                        <Send className="w-3 h-3 mr-2 text-orange-600" />
                        {sendingCoToCustomer ? 'Sending…' : 'Send change orders to customer'}
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                {onOpenCopyToChangeOrder &&
                  !isReadOnly &&
                  quote &&
                  !(quote as any).is_change_order_proposal &&
                  sheet.sheetType !== 'change_order' && (
                    <DropdownMenuItem
                      onClick={() => onOpenCopyToChangeOrder(sectionSheetId, sheet.sheetName || 'Section')}
                      className="text-orange-800 focus:text-orange-900 focus:bg-orange-50"
                    >
                      <Send className="w-3 h-3 mr-2 text-orange-600" />
                      Add section to change orders (for customer)
                    </DropdownMenuItem>
                  )}
                <DropdownMenuSeparator />
                {!isReadOnly && (
                  (sheet as any).isOptional ? (
                    <>
                      <DropdownMenuItem onClick={async () => {
                        setOptionalSheetOverlay(prev => ({ ...prev, [sectionSheetId]: false }));
                        // Always update is_option first (column is guaranteed to exist)
                        const { error } = await supabase.from('material_sheets').update({ is_option: false }).eq('id', sectionSheetId);
                        if (error) {
                          toast.error(error.message || 'Failed to update optional state');
                          return;
                        }
                        // Best-effort: clear comparison link (column may not exist on older DBs)
                        await supabase.from('material_sheets').update({ compare_to_sheet_id: null } as any).eq('id', sectionSheetId);
                        await loadMaterialsData(quote?.id ?? null, false);
                      }}>
                        <Check className="w-3 h-3 mr-2 text-green-600" />
                        Include in Total
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setComparePickerSheetId(sectionSheetId); setShowComparePickerDialog(true); }}>
                        <GitCompare className="w-3 h-3 mr-2 text-blue-600" />
                        {(sheet as any).compareToSheetId ? 'Change Comparison Section' : 'Compare with Section...'}
                      </DropdownMenuItem>
                      {(sheet as any).compareToSheetId && (
                        <DropdownMenuItem onClick={async () => {
                          await supabase.from('material_sheets').update({ compare_to_sheet_id: null } as any).eq('id', sectionSheetId);
                          await loadMaterialsData(quote?.id ?? null, false);
                        }}>
                          <X className="w-3 h-3 mr-2 text-slate-500" />
                          Clear Comparison
                        </DropdownMenuItem>
                      )}
                    </>
                  ) : (
                    <DropdownMenuItem onClick={async () => {
                      setOptionalSheetOverlay(prev => ({ ...prev, [sectionSheetId]: true }));
                      const { error } = await supabase.from('material_sheets').update({ is_option: true }).eq('id', sectionSheetId);
                      if (error) {
                        toast.error(error.message || 'Failed to update optional state');
                        return;
                      }
                      await loadMaterialsData(quote?.id ?? null, false);
                    }}>
                      <Eye className="w-3 h-3 mr-2 text-amber-600" />
                      Mark as Optional (exclude from total)
                    </DropdownMenuItem>
                  )
                )}
                <DropdownMenuItem onClick={() => openLineItemDialog(sectionSheetId, undefined, 'material', 'sheet')}>
                  <Plus className="w-3 h-3 mr-2" />
                  Add Material Row
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openLineItemDialog(sectionSheetId, undefined, 'labor', 'sheet')}>
                  <DollarSign className="w-3 h-3 mr-2" />
                  Add Labor
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openLineItemDialog(sectionSheetId, undefined, 'combined', 'sheet')}>
                  <Plus className="w-3 h-3 mr-2" />
                  Add Material + Labor
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openSubcontractorDialog(sectionSheetId, 'sheet')}>
                  <Briefcase className="w-3 h-3 mr-2" />
                  Add Subcontractor
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Two-column layout: Description + Pricing */}
          <div className="ml-2 flex gap-1.5 mt-1">
            {/* Description column (wide) */}
            <div className="flex-1 min-w-0">
              {sheet.sheetDescription ? (
                <Textarea
                  key={`sheet-desc-${sectionSheetId}-${sheet.sheetDescription}`}
                  defaultValue={sheet.sheetDescription || ''}
                  placeholder="Click to add description..."
                  className="text-sm text-slate-600 leading-tight border border-slate-200 hover:border-slate-300 focus:border-blue-400 p-1.5 bg-slate-50/50 hover:bg-slate-50 focus:bg-white rounded transition-colors focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-0"
                  rows={(() => {
                    const lines = sheet.sheetDescription.split('\n');
                    const lineCount = lines.length;
                    // Estimate wrapped lines (assume ~90 chars per line with current width)
                    const wrappedLines = lines.reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / 90)), 0);
                    return Math.max(2, wrappedLines);
                  })()}
                  onBlur={async (e) => {
                    if (isReadOnly) {
                      toast.error('Cannot edit in historical view');
                      e.target.value = sheet.sheetDescription || '';
                      return;
                    }
                    const newValue = e.target.value.trim();
                    if (newValue !== (sheet.sheetDescription || '')) {
                      try {
                        await supabase
                          .from('material_sheets')
                          .update({ description: newValue || null })
                          .eq('id', sectionSheetId);
                        await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
                      } catch (error) {
                        console.error('Error saving description:', error);
                      }
                    }
                  }}
                />
              ) : (
                <div 
                  className="text-xs text-muted-foreground italic cursor-pointer hover:text-foreground py-1"
                  onClick={() => openSheetDescDialog(sectionSheetId, '')}
                >
                  No description
                </div>
              )}
            </div>

            {/* Pricing column (compact — frees width for description) */}
            <div className="w-[78px] sm:w-[86px] flex-shrink-0 text-right leading-tight">
              {(sheet as any).isOptional && (
                <p className="text-[10px] text-amber-700 font-medium mb-0.5 leading-tight">Not in total</p>
              )}
              <p className="text-[10px] text-slate-500 leading-tight" title="Materials">Materials</p>
              <p className={`text-sm font-bold tabular-nums ${(sheet as any).isOptional ? 'text-amber-600 line-through decoration-amber-400' : 'text-blue-700'}`}>${sheetFinalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              {Number.isFinite(totalLaborCost) && totalLaborCost > 0 ? (
                <>
                  <p className="text-[10px] text-slate-500 mt-1 leading-tight">Labor</p>
                  <p className={`text-sm font-bold tabular-nums ${(sheet as any).isOptional ? 'text-amber-600 line-through decoration-amber-400' : 'text-amber-700'}`}>${totalLaborCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </>
              ) : null}
              {(sheet as any).isOptional && (
                <>
                  <p className="text-[10px] text-slate-500 mt-1">Sect. total</p>
                  <p className="text-xs font-bold text-amber-700 tabular-nums">
                    ${sectionTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </>
              )}
            </div>
          </div>

          <CollapsibleContent>
            <div className="mt-2 ml-2 space-y-3">
              {/* Material Items by Category (only required; optional categories appear in Options section below) */}
              {(() => {
                const displayCategories = breakdownCategories.length > 0 ? breakdownCategories : categorySource;
                return displayCategories.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Material Items</p>
                  {displayCategories.map((category: any, catIdx: number) => {
                    const categoryKey = `${sectionSheetId}_${category.name}`;
                    const categoryMarkup = categoryMarkups[categoryKey] ?? (sheet.markup_percent ?? 10);
                    const breakdownCategory = category;
                    const baseCategoryCost = (category.items || []).reduce((sum: number, item: any) => {
                      const extended = Number(item.extended_cost) || 0;
                      if (extended > 0) return sum + extended;
                      return sum + ((Number(item.cost_per_unit) || 0) * (Number(item.quantity) || 0));
                    }, 0) || (Number(category.totalCost) || 0);
                    const { price: categoryCostDisplay, isFinal: categoryCostIsFinal } = getCategoryDisplayPrice(breakdownCategory);
                    const categoryPriceWithMarkup = categoryCostIsFinal
                      ? categoryCostDisplay
                      : categoryCostDisplay * (1 + (Number(categoryMarkup) || 0) / 100);
                    
                    const categoryIsOptional = category.items?.every((i: any) => i.isOptional) ?? false;
                    return (
                      <div key={catIdx} className={`bg-slate-50 border rounded p-2 ${categoryIsOptional ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex-1 flex items-center gap-2 flex-wrap">
                            <p className="text-xs font-semibold text-slate-900">{category.name}</p>
                            <p className="text-xs text-slate-600">{category.itemCount} items</p>
                            {categoryIsOptional && (
                              <Badge variant="outline" className="text-amber-700 border-amber-400 bg-amber-50">Option</Badge>
                            )}
                            {!isReadOnly && (() => {
                              const handleOptionToggle = async (value: boolean) => {
                                const key = `${sectionSheetId}_${category.name}`;
                                setOptCatOverlay(prev => ({ ...prev, [key]: value }));
                                await loadMaterialsData(quote?.id ?? null, !!isReadOnly, { [key]: value });
                                try {
                                  const { error } = await supabase
                                    .from('material_category_options')
                                    .upsert(
                                      { sheet_id: sectionSheetId, category_name: category.name, is_optional: value },
                                      { onConflict: 'sheet_id,category_name' }
                                    );
                                  if (error) throw error;
                                  toast.success(value ? 'Section marked as option' : 'Section included in contract');
                                } catch {
                                  toast.info('Option saved locally');
                                }
                              };
                              return (
                                <div
                                  role="button"
                                  tabIndex={0}
                                  className="flex items-center gap-1.5 cursor-pointer text-slate-600 ml-auto sm:ml-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if ((e.target as HTMLElement).closest?.('button[role="checkbox"]')) return;
                                    handleOptionToggle(!categoryIsOptional);
                                  }}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOptionToggle(!categoryIsOptional); } }}
                                >
                                  <span className="pointer-events-none">
                                    <Checkbox
                                      checked={categoryIsOptional}
                                      onCheckedChange={(checked) => handleOptionToggle(!!checked)}
                                      className="pointer-events-auto"
                                    />
                                  </span>
                                  <span className="text-xs">Option</span>
                                </div>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <div className="text-right">
                              <p className="text-slate-500">Price</p>
                              <p className="font-semibold text-slate-900">${categoryCostDisplay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-slate-500">+</span>
                              <Input
                                type="number"
                                value={categoryMarkup}
                                onChange={async (e) => {
                                  const newMarkup = parseFloat(e.target.value) || 0;
                                  const categoryKey = `${sectionSheetId}_${category.name}`;
                                  
                                  // Update local state immediately for responsive UI
                                  setCategoryMarkups(prev => ({
                                    ...prev,
                                    [categoryKey]: newMarkup
                                  }));
                                  
                                  try {
                                    if (quote?.id && !(await sheetBelongsToQuote(supabase, sectionSheetId, quote.id))) {
                                      toast.error('Cannot save markup: section does not belong to the selected proposal.');
                                      return;
                                    }
                                    // Mark this markup as being saved
                                    savingMarkupsRef.current.add(categoryKey);
                                    
                                    console.log(`[MARKUP SAVE] Starting save: ${newMarkup}% for category "${category.name}" in sheet ${sectionSheetId}`);
                                    
                                    // Save to database with explicit conflict resolution
                                    const { data: upsertData, error: upsertError } = await supabase
                                      .from('material_category_markups')
                                      .upsert({
                                        sheet_id: sectionSheetId,
                                        category_name: category.name,
                                        markup_percent: newMarkup,
                                        updated_at: new Date().toISOString(),
                                      }, {
                                        onConflict: 'sheet_id,category_name',
                                        ignoreDuplicates: false,
                                      })
                                      .select();
                                    
                                    if (upsertError) {
                                      console.error('[MARKUP SAVE] Database error:', upsertError);
                                      throw upsertError;
                                    }
                                    
                                    console.log('[MARKUP SAVE] Database response:', upsertData);
                                    console.log('[MARKUP SAVE] ✅ Markup saved successfully');
                                    
                                    // Small delay for database replication
                                    await new Promise(resolve => setTimeout(resolve, 300));
                                    
                                    // Remove from saving set BEFORE reload
                                    savingMarkupsRef.current.delete(categoryKey);
                                    
                                    // Reload to get fresh data
                                    await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
                                    
                                    // Show success toast
                                    toast.success(`Markup updated to ${newMarkup}%`);
                                  } catch (error: any) {
                                    console.error('[MARKUP SAVE] Error updating category markup:', error);
                                    toast.error(`Failed to save markup: ${error.message || 'Unknown error'}`);
                                    // Remove from saving set
                                    savingMarkupsRef.current.delete(categoryKey);
                                    // Reload to get correct value from database
                                    await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
                                  }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onFocus={(e) => e.target.select()}
                                className="w-14 h-5 text-xs px-1 text-center"
                                step="1"
                                min="0"
                              />
                              <span className="text-slate-500">%</span>
                            </div>
                            <div className="text-right">
                              <p className="text-slate-500">Price</p>
                              <p className="font-bold text-blue-700">${categoryPriceWithMarkup.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
              })()}

              {linkedRows.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-2">
                    <List className="w-3 h-3" />
                    Line Items
                  </p>
                  {linkedRows.map((row: any) => {
                    const isLabor = row.category === 'labor';
                    const itemMarkup = row.markup_percent || 0;
                    const itemCost = row.total_cost;
                    const itemPrice = itemCost * (1 + itemMarkup / 100);
                    
                    return (
                      <div key={row.id} className={`rounded p-2 border ${isLabor ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-slate-900">{row.description}</p>
                            <p className="text-xs text-slate-600">
                              {isLabor 
                                ? `${row.quantity}h × $${row.unit_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr`
                                : `${row.quantity} × $${row.unit_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              }
                            </p>
                            {row.notes && (
                              <p className="text-xs text-slate-500 mt-1">{row.notes}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={isLabor ? 'secondary' : 'default'} className="text-xs h-5">
                              {isLabor ? '👷 Labor' : '📦 Material'}
                            </Badge>
                            {!isLabor && (
                              <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                key={`linked-row-cost-${row.id}-${itemCost}`}
                                defaultValue={itemCost}
                                onBlur={(e) => {
                                  if (isReadOnly) return;
                                  const raw = parseFloat(e.target.value);
                                  if (!Number.isFinite(raw) || raw < 0) return;
                                  const v = Math.round(raw * 100) / 100;
                                  if (Math.abs(v - itemCost) < 0.01) return;
                                  updateCustomRowBaseCost(row.id, v, 0);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-20 h-6 text-xs px-1.5 text-right tabular-nums"
                                step="0.01"
                                min="0"
                              />
                              <span className="text-xs text-slate-500">+</span>
                              <Input
                                type="number"
                                value={itemMarkup}
                                onChange={async (e) => {
                                  const newMarkup = parseFloat(e.target.value) || 0;
                                  try {
                                    const { error } = await supabase
                                      .from('custom_financial_rows')
                                      .update({ markup_percent: newMarkup })
                                      .eq('id', row.id);
                                    if (error) throw error;
                                    await loadCustomRows(quote?.id ?? null, !!isReadOnly);
                                    await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
                                  } catch (error: any) {
                                    console.error('Error updating markup:', error);
                                    toast.error('Failed to update markup');
                                  }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-14 h-5 text-xs px-1 text-center"
                                step="1"
                                min="0"
                              />
                              <span className="text-xs text-slate-500">%</span>
                              </div>
                            )}
                            <p className="text-xs font-bold text-blue-700">
                              ${itemPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 w-5 p-0"
                              onClick={() => openAddDialog(row)}
                            >
                              <Edit className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 w-5 p-0"
                              onClick={() => deleteRow(row.id)}
                            >
                              <Trash2 className="w-3 h-3 text-red-600" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Sheet-level Line Items (material + labor) - unified list so Add Labor appears in this section */}
              {(() => {
                const sheetLineItems = resolveCustomRowLineItemsForSheet(
                  customRowLineItems,
                  materialSheets,
                  sectionSheetId,
                  sheet.sheetName,
                  materialsBreakdown?.sheetBreakdowns,
                  sheetMetaById,
                )
                  .slice()
                  .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
                if (sheetLineItems.length === 0) return null;
                return (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-2">
                      <List className="w-3 h-3" />
                      Line Items
                    </p>
                    {sheetLineItems.map((lineItem: any) => {
                      if (isCombinedMaterialLaborLineItem(lineItem)) {
                        const embedded = parseLineItemEmbeddedLabor(lineItem.notes)!;
                        const matQty = Number(lineItem.quantity) || 0;
                        const matUnit = Number(lineItem.unit_cost) || 0;
                        const materialBase = Math.round(matQty * matUnit * 100) / 100;
                        const laborBase = Math.round(embedded.hours * embedded.rate * 100) / 100;
                        const matMarkup = lineItem.markup_percent || 0;
                        const labMarkup = embedded.markup || 0;
                        const matPrice = materialBase * (1 + matMarkup / 100);
                        const labPrice = laborBase * (1 + labMarkup / 100);
                        const combinedPrice = matPrice + labPrice;
                        let userNotesFromJson: string | null = null;
                        try {
                          const o = JSON.parse(lineItem.notes || '{}') as { notes?: unknown };
                          if (typeof o.notes === 'string' && o.notes.trim()) userNotesFromJson = o.notes.trim();
                        } catch {
                          /* ignore */
                        }
                        const money = (n: number) =>
                          n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        return (
                          <div key={lineItem.id} className="space-y-1">
                            <div className="rounded p-2 border bg-slate-50 border-slate-200">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-slate-900">{lineItem.description}</p>
                                  <p className="text-xs text-slate-600">
                                    {matQty} × ${money(matUnit)}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Badge variant="default" className="text-xs h-5">
                                    📦 Material
                                  </Badge>
                                  <div className="flex items-center gap-1">
                                    <Input
                                      type="number"
                                      key={`sheet-li-mat-${lineItem.id}-${materialBase}`}
                                      defaultValue={materialBase}
                                      onBlur={(e) => {
                                        if (isReadOnly) return;
                                        const raw = parseFloat(e.target.value);
                                        if (!Number.isFinite(raw) || raw < 0) return;
                                        const v = Math.round(raw * 100) / 100;
                                        if (Math.abs(v - materialBase) < 0.01) return;
                                        void updateCombinedLineItemMaterialBase(lineItem.id, v, lineItem);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-20 h-6 text-xs px-1.5 text-right tabular-nums"
                                      step="0.01"
                                      min="0"
                                    />
                                    <span className="text-xs text-slate-500">+</span>
                                    <Input
                                      type="number"
                                      value={matMarkup}
                                      onChange={async (e) => {
                                        const newMarkup = parseFloat(e.target.value) || 0;
                                        try {
                                          const { data, error } = await supabase
                                            .from('custom_financial_row_items')
                                            .update({ markup_percent: newMarkup })
                                            .eq('id', lineItem.id)
                                            .select('id');
                                          if (error) throw error;
                                          if (!data?.length) {
                                            toast.error('Could not update markup (permission or row missing).');
                                            return;
                                          }
                                          await loadCustomRows(quote?.id ?? null, !!isReadOnly);
                                          await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
                                        } catch (err: any) {
                                          console.error('Error updating markup:', err);
                                          toast.error('Failed to update markup');
                                        }
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-14 h-5 text-xs px-1 text-center"
                                      step="1"
                                      min="0"
                                    />
                                    <span className="text-xs text-slate-500">%</span>
                                  </div>
                                  <p className="text-xs font-bold text-blue-700">${money(matPrice)}</p>
                                </div>
                              </div>
                            </div>
                            <div className="rounded p-2 border bg-amber-50 border-amber-200">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-slate-900">{lineItem.description}</p>
                                  <p className="text-xs text-slate-600">
                                    {embedded.hours}h × ${money(embedded.rate)}/hr
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Badge variant="secondary" className="text-xs h-5">
                                    👷 Labor
                                  </Badge>
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs text-slate-500 w-20 text-right tabular-nums" title="Labor cost (edit in dialog)">
                                      ${money(laborBase)}
                                    </span>
                                    <span className="text-xs text-slate-500">+</span>
                                    <Input
                                      type="number"
                                      value={labMarkup}
                                      onChange={(e) => {
                                        const newMarkup = parseFloat(e.target.value) || 0;
                                        void updateLineItemEmbeddedLaborMarkup(lineItem.id, lineItem, newMarkup);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-14 h-5 text-xs px-1 text-center"
                                      step="1"
                                      min="0"
                                    />
                                    <span className="text-xs text-slate-500">%</span>
                                  </div>
                                  <p className="text-xs font-bold text-amber-800">${money(labPrice)}</p>
                                </div>
                              </div>
                            </div>
                            {userNotesFromJson ? (
                              <p className="text-xs text-slate-500 px-1">{userNotesFromJson}</p>
                            ) : null}
                            <div className="flex flex-wrap items-center justify-end gap-2 px-1">
                              <span className="text-xs text-slate-600">
                                Line total:{' '}
                                <span className="font-bold text-emerald-700">${money(combinedPrice)}</span>
                              </span>
                              {(lineItem as any).hide_from_customer && (
                                <span className="text-slate-400" title="Hidden from customer portal">
                                  <EyeOff className="w-3 h-3" />
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openLineItemDialog(sectionSheetId, lineItem, 'combined', 'sheet');
                                }}
                              >
                                <Edit className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void deleteLineItem(lineItem.id);
                                }}
                              >
                                <Trash2 className="w-3 h-3 text-red-600" />
                              </Button>
                            </div>
                          </div>
                        );
                      }

                      const isLabor = (lineItem.item_type || 'material') === 'labor';
                      const itemMarkup = lineItem.markup_percent || 0;
                      const itemCost = Number(lineItem.total_price ?? lineItem.total_cost) || 0;
                      const itemPrice = itemCost * (1 + itemMarkup / 100);
                      const notesStr = String(lineItem.notes || '');
                      const hideNotesLine =
                        notesStr.trim().startsWith('{') && notesStr.includes('"labor"');
                      return (
                        <div key={lineItem.id} className={`rounded p-2 border ${isLabor ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-slate-900">{lineItem.description}</p>
                              <p className="text-xs text-slate-600">
                                {isLabor
                                  ? `${lineItem.quantity}h × $${(lineItem.unit_cost ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr`
                                  : `${lineItem.quantity} × $${(lineItem.unit_cost ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                              </p>
                              {lineItem.notes && !hideNotesLine && (
                                <p className="text-xs text-slate-500 mt-0.5">{lineItem.notes}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={isLabor ? 'secondary' : 'default'} className="text-xs h-5">
                                {isLabor ? '👷 Labor' : '📦 Material'}
                              </Badge>
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  key={`sheet-li-cost-${lineItem.id}-${itemCost}`}
                                  defaultValue={itemCost}
                                  onBlur={(e) => {
                                    if (isReadOnly) return;
                                    const raw = parseFloat(e.target.value);
                                    if (!Number.isFinite(raw) || raw < 0) return;
                                    const v = Math.round(raw * 100) / 100;
                                    if (Math.abs(v - itemCost) < 0.01) return;
                                    updateLineItemCost(lineItem.id, v, Number(lineItem.quantity) || 1);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-20 h-6 text-xs px-1.5 text-right tabular-nums"
                                  step="0.01"
                                  min="0"
                                />
                                <span className="text-xs text-slate-500">+</span>
                                <Input
                                  type="number"
                                  value={itemMarkup}
                                  onChange={async (e) => {
                                    const newMarkup = parseFloat(e.target.value) || 0;
                                    try {
                                      const { data, error } = await supabase
                                        .from('custom_financial_row_items')
                                        .update({ markup_percent: newMarkup })
                                        .eq('id', lineItem.id)
                                        .select('id');
                                      if (error) throw error;
                                      if (!data?.length) {
                                        toast.error('Could not update markup (permission or row missing).');
                                        return;
                                      }
                                      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
                                      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
                                    } catch (err: any) {
                                      console.error('Error updating markup:', err);
                                      toast.error('Failed to update markup');
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-14 h-5 text-xs px-1 text-center"
                                  step="1"
                                  min="0"
                                />
                                <span className="text-xs text-slate-500">%</span>
                              </div>
                              <p className="text-xs font-bold text-blue-700">
                                ${itemPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                              {(lineItem as any).hide_from_customer && (
                                <span className="text-slate-400" title="Hidden from customer portal">
                                  <EyeOff className="w-3 h-3" />
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openLineItemDialog(
                                    sectionSheetId,
                                    lineItem,
                                    isLabor ? 'labor' : 'material',
                                    'sheet'
                                  );
                                }}
                              >
                                <Edit className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void deleteLineItem(lineItem.id);
                                }}
                              >
                                <Trash2 className="w-3 h-3 text-red-600" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Sheet-level material_sheet_labor (only when stored on this section — not merged from another sheet/workbook) */}
              {sheetLaborRow && sheetLaborCountsForDisplayedSection(sheetLaborRow, sectionSheetId) && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-slate-900">{sheetLaborRow.description}</p>
                      <p className="text-xs text-slate-600">
                        {sheetLaborRow.estimated_hours}h × ${sheetLaborRow.hourly_rate}/hr
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold text-slate-900">
                        ${(Number(sheetLaborRow.total_labor_cost) || Number(sheetLaborRow.estimated_hours || 0) * Number(sheetLaborRow.hourly_rate || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      {!isReadOnly && (
                        <>
                          <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => openLaborDialog(sectionSheetId)}>
                            <Edit className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => deleteSheetLabor(sheetLaborRow.id)}>
                            <Trash2 className="w-3 h-3 text-red-600" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {linkedSubs.map((sub: any) => {
                const lineItems = subcontractorLineItems[sub.id] || [];
                const included = lineItems.filter((item: any) => !item.excluded);
                const materialTotal = included
                  .filter((i: any) => (i.item_type || 'material') === 'material')
                  .reduce((sum: number, i: any) => sum + (i.total_price || 0), 0);
                const laborTotal = included
                  .filter((i: any) => (i.item_type || 'material') === 'labor')
                  .reduce((sum: number, i: any) => sum + (i.total_price || 0), 0);
                const markup = 1 + (sub.markup_percent || 0) / 100;
                const materialWithMarkup = materialTotal * markup;
                const laborWithMarkup = laborTotal * markup;
                const totalWithMarkup = materialWithMarkup + laborWithMarkup;

                return (
                  <Collapsible key={sub.id} className="bg-purple-50 border border-purple-300 rounded-md p-2.5 shadow-sm">
                    <div className="flex items-start gap-2">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="p-0 h-auto hover:bg-transparent">
                          <ChevronDown className="w-4 h-4 text-slate-600" />
                        </Button>
                      </CollapsibleTrigger>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-slate-900">{sub.company_name}</p>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 text-xs">
                              {materialTotal > 0 && <span className="text-slate-600">Material: ${materialWithMarkup.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                              {laborTotal > 0 && <span className="text-amber-700">Labor: ${laborWithMarkup.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                              {materialTotal === 0 && laborTotal === 0 && <span className="text-slate-500">$0.00</span>}
                              <span className="text-slate-500">+</span>
                              <Input
                                type="number"
                                value={sub.markup_percent || 0}
                                onChange={(e) => {
                                  const newMarkup = parseFloat(e.target.value) || 0;
                                  updateSubcontractorMarkup(sub.id, newMarkup);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-14 h-5 text-xs px-1 text-center"
                                step="1"
                                min="0"
                              />
                              <span className="text-slate-500">%</span>
                            </div>
                            <p className="text-xs font-bold text-slate-900">
                              ${totalWithMarkup.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            {sub.pdf_url && (
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => window.open(sub.pdf_url, '_blank')}>
                                <Eye className="w-3 h-3 text-blue-600" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => unlinkSubcontractor(sub.id)}>
                              <Trash2 className="w-3 h-3 text-red-600" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                    {sub.scope_of_work && (
                      <div className="ml-8 mt-1">
                        <p className="text-xs text-slate-600">{sub.scope_of_work}</p>
                      </div>
                    )}
                    <CollapsibleContent>
                      <div className="ml-8 mt-2 space-y-1">
                        {lineItems.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-2">
                              <List className="w-3 h-3" />
                              Line Items
                              <span className="text-slate-500">({lineItems.filter((item: any) => !item.excluded).length} of {lineItems.length} included)</span>
                            </p>
                            {lineItems.map((lineItem: any) => (
                              <div key={lineItem.id} className={`p-2 rounded mb-1 ${lineItem.excluded ? 'bg-red-50' : 'bg-slate-50'}`}>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={!lineItem.excluded}
                                    onChange={() => toggleSubcontractorLineItem(lineItem.id, lineItem.excluded)}
                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    title="Include in price"
                                  />
                                  <p className={`text-xs flex-1 ${lineItem.excluded ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                    {lineItem.description}
                                  </p>
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={`text-xs h-5 cursor-pointer hover:bg-slate-100 ${lineItem.excluded ? 'opacity-50' : ''}`}
                                      onClick={() => !lineItem.excluded && toggleSubcontractorLineItemType(lineItem.id, lineItem.item_type || 'material')}
                                      title="Click to toggle between Material and Labor"
                                    >
                                      {(lineItem.item_type || 'material') === 'labor' ? '👷 Labor' : '📦 Material'}
                                    </Badge>
                                    {(lineItem.item_type || 'material') === 'material' && (
                                      <>
                                        <Badge variant={lineItem.taxable ? 'default' : 'secondary'} className="text-xs h-5">
                                          {lineItem.taxable ? 'Tax' : 'No Tax'}
                                        </Badge>
                                        <input
                                          type="checkbox"
                                          checked={lineItem.taxable}
                                          onChange={() => toggleSubcontractorLineItemTaxable(lineItem.id, lineItem.taxable)}
                                          className="rounded border-slate-300 text-green-600 focus:ring-green-500"
                                          title="Taxable"
                                          disabled={lineItem.excluded}
                                        />
                                      </>
                                    )}
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs text-slate-500">+</span>
                                      <Input
                                        type="number"
                                        value={lineItem.markup_percent || 0}
                                        onChange={async (e) => {
                                          const newMarkup = parseFloat(e.target.value) || 0;
                                          try {
                                            const { error } = await supabase
                                              .from('subcontractor_estimate_line_items')
                                              .update({ markup_percent: newMarkup })
                                              .eq('id', lineItem.id);
                                            if (error) throw error;
                                            await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
                                          } catch (error: any) {
                                            console.error('Error updating line item markup:', error);
                                            toast.error('Failed to update markup');
                                          }
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-14 h-5 text-xs px-1 text-center"
                                        step="1"
                                        min="0"
                                        disabled={lineItem.excluded}
                                      />
                                      <span className="text-xs text-slate-500">%</span>
                                    </div>
                                    <p className={`text-xs font-semibold ${lineItem.excluded ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                      ${(lineItem.total_price * (1 + (lineItem.markup_percent || 0) / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                    {!isReadOnly && (
                                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-500 hover:text-slate-700" onClick={() => openEditSubcontractorLineItemDialog(lineItem)} title="Edit line item">
                                        <Edit className="w-3 h-3" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {!isReadOnly && (
                          <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => openAddSubcontractorLineItemDialog(sub.id)}>
                            <Plus className="w-3 h-3 mr-1" />Add line item
                          </Button>
                        )}
                        {sub.exclusions && (
                          <div className="mt-3 pt-3 border-t border-slate-200">
                            <p className="text-xs font-semibold text-red-700 mb-1">Exclusions</p>
                            <p className="text-xs text-slate-600">{sub.exclusions}</p>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>

            {/* Comparison panel — only for optional sections that have a comparison target */}
            {(sheet as any).isOptional && (sheet as any).compareToSheetId && (() => {
              const baseSheet = materialsBreakdown.sheetBreakdowns.find((s: any) => s.sheetId === (sheet as any).compareToSheetId);
              if (!baseSheet) return null;

              // Calculate base sheet price using same formula as sheetFinalPrice
              const baseLinkedRows = customRows.filter((r: any) => r.sheet_id === baseSheet.sheetId);
              const baseLinkedRowTotals = sumLinkedRowTotals(baseLinkedRows, customRowLineItems);
              const baseLinkedSubs = linkedSubcontractors[baseSheet.sheetId] || [];
              const baseLinkedSubsMaterialsTotal = sumLinkedSubMaterialsFromSubs(baseLinkedSubs, subcontractorLineItems);
              const baseLinkedSubsLaborTotal = sumLinkedSubLaborFromSubs(baseLinkedSubs, subcontractorLineItems);
              const baseCategoryTotals = (baseSheet.categories || []).reduce((sum: number, cat: any) => {
                const categoryKey = `${baseSheet.sheetId}_${cat.name}`;
                const markup = categoryMarkups[categoryKey] ?? 10;
                const baseCategoryCost = (cat.items || []).reduce((itemSum: number, item: any) => {
                  const extended = Number(item.extended_cost) || 0;
                  if (extended > 0) return itemSum + extended;
                  return itemSum + ((Number(item.cost_per_unit) || 0) * (Number(item.quantity) || 0));
                }, 0) || (Number(cat.totalCost) || 0);
                const categoryCostDisplay = baseCategoryCost * (1 + markup / 100);
                return sum + categoryCostDisplay;
              }, 0);
              const baseFinalPrice = baseCategoryTotals + baseLinkedRowTotals.materialTotal + baseLinkedSubsMaterialsTotal;

              // Base sheet labor (exclude merged-from-elsewhere rows)
              const baseSheetLaborRowCmp = sheetLabor[baseSheet.sheetId];
              const baseSheetLaborTotal =
                baseSheetLaborRowCmp && sheetLaborCountsForDisplayedSection(baseSheetLaborRowCmp, baseSheet.sheetId)
                  ? Number(baseSheetLaborRowCmp.total_labor_cost) ||
                    Number(baseSheetLaborRowCmp.estimated_hours || 0) * Number(baseSheetLaborRowCmp.hourly_rate || 0)
                  : 0;
              const baseSheetLaborLineItems = customRowLineItems[baseSheet.sheetId]?.filter((item: any) => (item.item_type || 'material') === 'labor') || [];
              const baseSheetLaborLineItemsTotal = baseSheetLaborLineItems.reduce((sum: number, item: any) => {
                const markup = item.markup_percent ?? 0;
                return sum + (item.total_cost * (1 + markup / 100));
              }, 0);
              const baseLaborCost =
                baseSheetLaborTotal +
                baseSheetLaborLineItemsTotal +
                baseLinkedRowTotals.laborTotal +
                baseLinkedSubsLaborTotal;

              const baseTotal = baseFinalPrice + baseLaborCost;
              const optionTotal = sheetFinalPrice + totalLaborCost;
              const priceDiff = optionTotal - baseTotal;
              const isExpanded = expandedComparisons.has(sectionSheetId);

              return (
                <div className="mt-3 border border-blue-200 rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 bg-blue-50 hover:bg-blue-100 transition-colors text-left"
                    onClick={() => {
                      const next = new Set(expandedComparisons);
                      if (next.has(sectionSheetId)) next.delete(sectionSheetId);
                      else next.add(sectionSheetId);
                      setExpandedComparisons(next);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <GitCompare className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-semibold text-blue-800">Price Comparison</span>
                      <span className="text-xs text-blue-600">vs {baseSheet.sheetName}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-bold ${priceDiff > 0 ? 'text-red-600' : priceDiff < 0 ? 'text-green-600' : 'text-slate-600'}`}>
                        {priceDiff > 0 ? '+' : ''}{priceDiff.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-blue-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="p-3 bg-white">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200">
                            <th className="text-left py-1.5 pr-3 text-slate-600 font-medium w-[35%]"></th>
                            <th className="text-right py-1.5 px-2 text-slate-700 font-semibold">{baseSheet.sheetName}</th>
                            <th className="text-right py-1.5 px-2 text-amber-800 font-semibold">{sheet.sheetName} <span className="text-xs font-normal">(option)</span></th>
                            <th className="text-right py-1.5 pl-2 text-slate-600 font-medium">Difference</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* Category rows */}
                          {(() => {
                            const allCatNames = Array.from(new Set([
                              ...(baseSheet.categories || []).map((c: any) => c.name),
                              ...(sheet.categories || []).map((c: any) => c.name),
                            ])).sort();
                            return allCatNames.map((catName: string) => {
                              const baseCat = (baseSheet.categories || []).find((c: any) => c.name === catName);
                              const optCat = (sheet.categories || []).find((c: any) => c.name === catName);
                              const baseCatMarkup = categoryMarkups[`${baseSheet.sheetId}_${catName}`] ?? 10;
                              const optCatMarkup = categoryMarkups[`${sectionSheetId}_${catName}`] ?? 10;
                              const baseCatCostDisplay = baseCat
                                ? (Number(baseCat.totalPrice) > 0
                                  ? Number(baseCat.totalPrice)
                                  : Number(baseCat.totalCost) * (1 + baseCatMarkup / 100))
                                : 0;
                              const optCatCostDisplay = optCat
                                ? (Number(optCat.totalPrice) > 0
                                  ? Number(optCat.totalPrice)
                                  : Number(optCat.totalCost) * (1 + optCatMarkup / 100))
                                : 0;
                              const baseCatPrice = baseCatCostDisplay * (1 + baseCatMarkup / 100);
                              const optCatPrice = optCatCostDisplay * (1 + optCatMarkup / 100);
                              const diff = optCatPrice - baseCatPrice;
                              return (
                                <tr key={catName} className="border-b border-slate-100">
                                  <td className="py-1.5 pr-3 text-slate-600">{catName}</td>
                                  <td className="text-right py-1.5 px-2 text-slate-800">{baseCatPrice > 0 ? '$' + baseCatPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                                  <td className="text-right py-1.5 px-2 text-amber-800">{optCatPrice > 0 ? '$' + optCatPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                                  <td className={`text-right py-1.5 pl-2 font-medium ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-green-600' : 'text-slate-400'}`}>
                                    {diff !== 0 ? (diff > 0 ? '+' : '') + '$' + diff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                          {/* Materials subtotal */}
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <td className="py-1.5 pr-3 font-medium text-slate-700">Materials Total</td>
                            <td className="text-right py-1.5 px-2 font-semibold text-blue-700">${baseFinalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className="text-right py-1.5 px-2 font-semibold text-amber-700">${sheetFinalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className={`text-right py-1.5 pl-2 font-semibold ${sheetFinalPrice - baseFinalPrice > 0 ? 'text-red-600' : sheetFinalPrice - baseFinalPrice < 0 ? 'text-green-600' : 'text-slate-400'}`}>
                              {sheetFinalPrice !== baseFinalPrice ? (sheetFinalPrice - baseFinalPrice > 0 ? '+' : '') + '$' + (sheetFinalPrice - baseFinalPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                            </td>
                          </tr>
                          {/* Labor row (only if either has labor) */}
                          {(baseLaborCost > 0 || totalLaborCost > 0) && (
                            <tr className="border-b border-slate-100">
                              <td className="py-1.5 pr-3 text-slate-600">Labor</td>
                              <td className="text-right py-1.5 px-2 text-slate-800">{baseLaborCost > 0 ? '$' + baseLaborCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                              <td className="text-right py-1.5 px-2 text-amber-800">{totalLaborCost > 0 ? '$' + totalLaborCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                              <td className={`text-right py-1.5 pl-2 font-medium ${totalLaborCost - baseLaborCost > 0 ? 'text-red-600' : totalLaborCost - baseLaborCost < 0 ? 'text-green-600' : 'text-slate-400'}`}>
                                {totalLaborCost !== baseLaborCost ? (totalLaborCost - baseLaborCost > 0 ? '+' : '') + '$' + (totalLaborCost - baseLaborCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                              </td>
                            </tr>
                          )}
                          {/* Grand total row */}
                          <tr className="bg-blue-50">
                            <td className="py-2 pr-3 font-bold text-slate-800">Section Total</td>
                            <td className="text-right py-2 px-2 font-bold text-blue-800 text-base">${baseTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className="text-right py-2 px-2 font-bold text-amber-800 text-base">${optionTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className={`text-right py-2 pl-2 font-bold text-base ${priceDiff > 0 ? 'text-red-600' : priceDiff < 0 ? 'text-green-600' : 'text-slate-400'}`}>
                              {priceDiff > 0 ? '+' : ''}{priceDiff.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      <p className="text-xs text-slate-400 mt-2">
                        {priceDiff > 0
                          ? `Choosing "${sheet.sheetName}" costs ${priceDiff.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} more than "${baseSheet.sheetName}".`
                          : priceDiff < 0
                          ? `Choosing "${sheet.sheetName}" saves ${Math.abs(priceDiff).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} compared to "${baseSheet.sheetName}".`
                          : `"${sheet.sheetName}" and "${baseSheet.sheetName}" have the same total price.`}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}
          </CollapsibleContent>
        </Collapsible>
      );
    } else if (item.type === 'custom') {
      const row = item.data;
      const lineItems = customRowLineItems[row.id] || [];
      const linkedSubs = linkedSubcontractors[row.id] || [];
      
      // Separate line items by type (use item_type, not taxable)
      const materialLineItems = lineItems.filter((item: any) => (item.item_type || 'material') === 'material');
      const laborLineItems = lineItems.filter((item: any) => (item.item_type || 'material') === 'labor');
      
      // Calculate material line items total WITH individual markups
      const materialLineItemsTotal = materialLineItems.reduce((sum: number, item: any) => {
        const itemMarkup = item.markup_percent || 0;
        return sum + (item.total_cost * (1 + itemMarkup / 100));
      }, 0);
      
      // Calculate labor line items total WITH individual markups
      const laborLineItemsTotal = laborLineItems.reduce((sum: number, item: any) => {
        const itemMarkup = item.markup_percent || 0;
        return sum + (item.total_cost * (1 + itemMarkup / 100));
      }, 0);
      
      const linkedSubsMaterialsTotal = sumLinkedSubMaterialsFromSubs(linkedSubs, subcontractorLineItems);
      const linkedSubsLaborTotal = sumLinkedSubLaborFromSubs(linkedSubs, subcontractorLineItems);
      
      // Calculate custom row labor
      const customLaborTotal = customRowLabor[row.id] 
        ? (customRowLabor[row.id].estimated_hours * customRowLabor[row.id].hourly_rate)
        : 0;
      
      // When line items exist, use their marked-up totals directly (NO row-level markup)
      // When no line items, use row total with row markup
      const finalPrice = lineItems.length > 0
        ? materialLineItemsTotal + linkedSubsMaterialsTotal
        : (row.total_cost + linkedSubsMaterialsTotal) * (1 + row.markup_percent / 100);
      
      // Base cost for display (without markup)
      const baseCost = lineItems.length > 0
        ? lineItems.reduce((sum: number, item: any) => sum + item.total_cost, 0) + linkedSubsMaterialsTotal
        : row.total_cost + linkedSubsMaterialsTotal;
      
      // Total labor for display (labor line items + custom labor + subcontractor labor lines)
      const totalLaborCost = laborLineItemsTotal + customLaborTotal + linkedSubsLaborTotal;

      return (
        <Collapsible className="border border-slate-300 rounded-lg bg-white py-2 px-3 shadow-sm">
          <div className="flex items-start gap-2">
            {/* Drag Handle */}
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing py-1">
              <GripVertical className="w-4 h-4 text-slate-400" />
            </div>

            {/* Chevron (only if has line items or linked subs) */}
            {(lineItems.length > 0 || linkedSubs.length > 0) && (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="p-0 h-auto hover:bg-transparent">
                  <ChevronDown className="w-4 h-4 text-slate-600" />
                </Button>
              </CollapsibleTrigger>
            )}

            {/* Title */}
            <div className="flex-1 min-w-0">
              {editingRowName === row.id && editingRowNameType === 'custom' ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={tempRowName}
                    onChange={(e) => setTempRowName(e.target.value)}
                    className="h-7 text-sm font-bold"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRowName();
                      if (e.key === 'Escape') cancelEditingRowName();
                    }}
                  />
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={saveRowName}>
                    <Check className="w-3 h-3 text-green-600" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={cancelEditingRowName}>
                    <X className="w-3 h-3 text-red-600" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <h3
                    className={`text-base font-bold text-slate-900 truncate ${!isReadOnly ? 'cursor-text' : ''}`}
                    title={!isReadOnly ? 'Double-click to rename' : undefined}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (isReadOnly) {
                        toast.error('Cannot edit in historical view');
                        return;
                      }
                      startEditingRowName(row.id, 'custom', row.description);
                    }}
                  >
                    {row.description}
                  </h3>
                  {toBool((row as any).is_option) && (
                    <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 border-amber-300">
                      Optional
                    </Badge>
                  )}
                  {row.category === 'labor' && <Badge variant="secondary" className="text-xs">Labor</Badge>}
                  {(lineItems.length > 0 || linkedSubs.length > 0) && (
                    <Badge variant="outline" className="text-xs">
                      {lineItems.length + linkedSubs.length} item{(lineItems.length + linkedSubs.length) !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[14rem]">
                  <DropdownMenuItem onClick={() => openAddDialog(row)}>
                  <Edit className="w-3 h-3 mr-2" />
                  Edit Description
                </DropdownMenuItem>
                {!isReadOnly && !(row as any).sheet_id && (
                  toBool((row as any).is_option) ? (
                    <DropdownMenuItem onSelect={() => toggleCustomRowOptional(row.id, false)}>
                      <Check className="w-3 h-3 mr-2 text-green-600" />
                      Include in Total
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => toggleCustomRowOptional(row.id, true)}>
                      <Eye className="w-3 h-3 mr-2 text-amber-600" />
                      Mark as Optional (exclude from total)
                    </DropdownMenuItem>
                  )
                )}
                {!isReadOnly && !(row as any).sheet_id && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => openLineItemDialog(row.id, undefined, 'material', 'row')}>
                  <Plus className="w-3 h-3 mr-2" />
                  Add Material Row
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openLineItemDialog(row.id, undefined, 'labor', 'row')}>
                  <DollarSign className="w-3 h-3 mr-2" />
                  Add Labor
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openLineItemDialog(row.id, undefined, 'combined', 'row')}>
                  <Plus className="w-3 h-3 mr-2" />
                  Add Material + Labor
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openSubcontractorDialog(row.id, 'row')}>
                  <Briefcase className="w-3 h-3 mr-2" />
                  Add Subcontractor
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => deleteRow(row.id)}>
                  <Trash2 className="w-3 h-3 mr-2" />
                  Delete Row
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Two-column layout: Description + Pricing */}
          <div className="ml-2 flex gap-1.5 mt-1">
            {/* Description column (full width, height fits content) */}
            <div className="flex-1 min-w-0">
              <Textarea
                key={`row-notes-${row.id}-${row.notes ?? ''}`}
                defaultValue={row.notes || ''}
                placeholder="Add description..."
                className="text-sm text-slate-600 leading-tight border border-slate-200 hover:border-slate-300 focus:border-blue-400 p-1.5 bg-slate-50/50 hover:bg-slate-50 focus:bg-white rounded transition-colors focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-0 placeholder:italic placeholder:text-muted-foreground w-full min-w-0 min-h-0 resize-none"
                rows={row.notes ? (() => {
                  const lines = row.notes.split('\n');
                  const wrappedLines = lines.reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / 90)), 0);
                  return Math.max(2, wrappedLines);
                })() : 2}
                onChange={(e) => setEmptyNotesById((prev) => ({ ...prev, [row.id]: e.target.value.trim() === '' }))}
                onBlur={async (e) => {
                  if (isReadOnly) {
                    toast.error('Cannot edit in historical view');
                    e.target.value = row.notes || '';
                    return;
                  }
                  const newValue = e.target.value.trim();
                  setEmptyNotesById((prev) => ({ ...prev, [row.id]: newValue === '' }));
                  if (newValue !== (row.notes || '')) {
                    try {
                      await supabase
                        .from('custom_financial_rows')
                        .update({ notes: newValue || null })
                        .eq('id', row.id);
                      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
                      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
                    } catch (error) {
                      console.error('Error saving notes:', error);
                    }
                  }
                }}
              />
            </div>

            {/* Pricing column (compact) */}
            <div className="w-[92px] sm:w-[100px] flex-shrink-0 text-right leading-tight">
              {/* Only show row-level markup if NO line items exist */}
              {lineItems.length === 0 && (
                <div className="flex items-center justify-end gap-0.5 text-[10px] text-slate-600 mb-0.5 flex-nowrap">
                  <span className="shrink-0">Base</span>
                  <Input
                    type="number"
                    key={`base-cost-${row.id}-${baseCost}`}
                    defaultValue={baseCost}
                    onBlur={(e) => {
                      if (isReadOnly) return;
                      const raw = parseFloat(e.target.value);
                      if (!Number.isFinite(raw) || raw < 0) return;
                      const newBase = Math.round(raw * 100) / 100;
                      if (Math.abs(newBase - baseCost) < 0.01) return;
                      updateCustomRowBaseCost(row.id, newBase, linkedSubsMaterialsTotal);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-[3.25rem] h-5 text-[10px] px-1 text-right tabular-nums"
                    step="0.01"
                    min="0"
                  />
                  <span className="shrink-0">+</span>
                  <Input
                    type="number"
                    value={row.markup_percent || 0}
                    onChange={(e) => {
                      const newMarkup = parseFloat(e.target.value) || 0;
                      updateCustomRowMarkup(row.id, newMarkup);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-9 h-5 text-[10px] px-0.5 text-center tabular-nums"
                    step="1"
                    min="0"
                  />
                  <span className="shrink-0">%</span>
                </div>
              )}
              <p className="text-[10px] text-slate-500 leading-tight" title="Materials">Materials</p>
              <p className={`text-sm font-bold tabular-nums ${toBool((row as any).is_option) ? 'text-amber-600 line-through decoration-amber-400' : 'text-blue-700'}`}>${finalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              {Number.isFinite(totalLaborCost) && totalLaborCost > 0 ? (
                <>
                  <p className="text-[10px] text-slate-500 mt-1 leading-tight">Labor</p>
                  <p className={`text-sm font-bold tabular-nums ${toBool((row as any).is_option) ? 'text-amber-600 line-through decoration-amber-400' : 'text-amber-700'}`}>${totalLaborCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </>
              ) : null}
            </div>
          </div>

          {/* Line Items & Linked Subcontractors */}
          {(lineItems.length > 0 || linkedSubs.length > 0) && (
            <CollapsibleContent>
              <div className="mt-2 ml-2 space-y-1">
                {lineItems.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-2">
                      <List className="w-3 h-3" />
                      Line Items
                    </p>
                    {lineItems.map((lineItem: any) => {
                      if (isCombinedMaterialLaborLineItem(lineItem)) {
                        const embedded = parseLineItemEmbeddedLabor(lineItem.notes)!;
                        const matQty = Number(lineItem.quantity) || 0;
                        const matUnit = Number(lineItem.unit_cost) || 0;
                        const materialBase = Math.round(matQty * matUnit * 100) / 100;
                        const laborBase = Math.round(embedded.hours * embedded.rate * 100) / 100;
                        const matMarkup = lineItem.markup_percent || 0;
                        const labMarkup = embedded.markup || 0;
                        const matPrice = materialBase * (1 + matMarkup / 100);
                        const labPrice = laborBase * (1 + labMarkup / 100);
                        const combinedPrice = matPrice + labPrice;
                        let userNotesFromJson: string | null = null;
                        try {
                          const o = JSON.parse(lineItem.notes || '{}') as { notes?: unknown };
                          if (typeof o.notes === 'string' && o.notes.trim()) userNotesFromJson = o.notes.trim();
                        } catch {
                          /* ignore */
                        }
                        const money = (n: number) =>
                          n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        return (
                          <div key={lineItem.id} className="space-y-1">
                            <div className="rounded p-2 border bg-slate-50 border-slate-200">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-slate-900">{lineItem.description}</p>
                                  <p className="text-xs text-slate-600">
                                    {matQty} × ${money(matUnit)}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Badge variant="default" className="text-xs h-5">
                                    📦 Material
                                  </Badge>
                                  <div className="flex items-center gap-1">
                                    <Input
                                      type="number"
                                      key={`row-li-mat-${lineItem.id}-${materialBase}`}
                                      defaultValue={materialBase}
                                      onBlur={(e) => {
                                        if (isReadOnly) return;
                                        const raw = parseFloat(e.target.value);
                                        if (!Number.isFinite(raw) || raw < 0) return;
                                        const v = Math.round(raw * 100) / 100;
                                        if (Math.abs(v - materialBase) < 0.01) return;
                                        void updateCombinedLineItemMaterialBase(lineItem.id, v, lineItem);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-20 h-6 text-xs px-1.5 text-right tabular-nums"
                                      step="0.01"
                                      min="0"
                                    />
                                    <span className="text-xs text-slate-500">+</span>
                                    <Input
                                      type="number"
                                      value={matMarkup}
                                      onChange={async (e) => {
                                        const newMarkup = parseFloat(e.target.value) || 0;
                                        try {
                                          const { data, error } = await supabase
                                            .from('custom_financial_row_items')
                                            .update({ markup_percent: newMarkup })
                                            .eq('id', lineItem.id)
                                            .select('id');
                                          if (error) throw error;
                                          if (!data?.length) {
                                            toast.error('Could not update markup (permission or row missing).');
                                            return;
                                          }
                                          await loadCustomRows(quote?.id ?? null, !!isReadOnly);
                                          await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
                                        } catch (err: any) {
                                          console.error('Error updating markup:', err);
                                          toast.error('Failed to update markup');
                                        }
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-14 h-5 text-xs px-1 text-center"
                                      step="1"
                                      min="0"
                                    />
                                    <span className="text-xs text-slate-500">%</span>
                                  </div>
                                  <p className="text-xs font-bold text-blue-700">${money(matPrice)}</p>
                                </div>
                              </div>
                            </div>
                            <div className="rounded p-2 border bg-amber-50 border-amber-200">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-slate-900">{lineItem.description}</p>
                                  <p className="text-xs text-slate-600">
                                    {embedded.hours}h × ${money(embedded.rate)}/hr
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Badge variant="secondary" className="text-xs h-5">
                                    👷 Labor
                                  </Badge>
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs text-slate-500 w-20 text-right tabular-nums" title="Labor cost (edit in dialog)">
                                      ${money(laborBase)}
                                    </span>
                                    <span className="text-xs text-slate-500">+</span>
                                    <Input
                                      type="number"
                                      value={labMarkup}
                                      onChange={(e) => {
                                        const newMarkup = parseFloat(e.target.value) || 0;
                                        void updateLineItemEmbeddedLaborMarkup(lineItem.id, lineItem, newMarkup);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-14 h-5 text-xs px-1 text-center"
                                      step="1"
                                      min="0"
                                    />
                                    <span className="text-xs text-slate-500">%</span>
                                  </div>
                                  <p className="text-xs font-bold text-amber-800">${money(labPrice)}</p>
                                </div>
                              </div>
                            </div>
                            {userNotesFromJson ? (
                              <p className="text-xs text-slate-500 px-1">{userNotesFromJson}</p>
                            ) : null}
                            <div className="flex flex-wrap items-center justify-end gap-2 px-1">
                              <span className="text-xs text-slate-600">
                                Line total:{' '}
                                <span className="font-bold text-emerald-700">${money(combinedPrice)}</span>
                              </span>
                              {(lineItem as any).hide_from_customer && (
                                <span className="text-slate-400" title="Hidden from customer portal">
                                  <EyeOff className="w-3 h-3" />
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openLineItemDialog(row.id, lineItem, 'combined', 'row');
                                }}
                              >
                                <Edit className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void deleteLineItem(lineItem.id);
                                }}
                              >
                                <Trash2 className="w-3 h-3 text-red-600" />
                              </Button>
                            </div>
                          </div>
                        );
                      }

                      const isLabor = (lineItem.item_type || 'material') === 'labor';
                      const itemMarkup = lineItem.markup_percent || 0;
                      const itemCost = Number(lineItem.total_price ?? lineItem.total_cost) || 0;
                      const itemPrice = itemCost * (1 + itemMarkup / 100);
                      const notesStr = String(lineItem.notes || '');
                      const hideNotesLine = notesStr.trim().startsWith('{') && notesStr.includes('"labor"');

                      return (
                        <div key={lineItem.id} className={`rounded p-2 border ${isLabor ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-slate-900">{lineItem.description}</p>
                              <p className="text-xs text-slate-600">
                                {isLabor
                                  ? `${lineItem.quantity}h × $${Number(lineItem.unit_cost ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr`
                                  : `${lineItem.quantity} × $${Number(lineItem.unit_cost ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                              </p>
                              {lineItem.notes && !hideNotesLine && (
                                <p className="text-xs text-slate-500 mt-1">{lineItem.notes}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={isLabor ? 'secondary' : 'default'} className="text-xs h-5">
                                {isLabor ? '👷 Labor' : '📦 Material'}
                              </Badge>
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  key={`row-li-cost-${lineItem.id}-${itemCost}`}
                                  defaultValue={itemCost}
                                  onBlur={(e) => {
                                    if (isReadOnly) return;
                                    const raw = parseFloat(e.target.value);
                                    if (!Number.isFinite(raw) || raw < 0) return;
                                    const v = Math.round(raw * 100) / 100;
                                    if (Math.abs(v - itemCost) < 0.01) return;
                                    updateLineItemCost(lineItem.id, v, Number(lineItem.quantity) || 1);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-20 h-6 text-xs px-1.5 text-right tabular-nums"
                                  step="0.01"
                                  min="0"
                                />
                                <span className="text-xs text-slate-500">+</span>
                                <Input
                                  type="number"
                                  value={itemMarkup}
                                  onChange={async (e) => {
                                    const newMarkup = parseFloat(e.target.value) || 0;
                                    try {
                                      const { data, error } = await supabase
                                        .from('custom_financial_row_items')
                                        .update({ markup_percent: newMarkup })
                                        .eq('id', lineItem.id)
                                        .select('id');
                                      if (error) throw error;
                                      if (!data?.length) {
                                        toast.error('Could not update markup (permission or row missing).');
                                        return;
                                      }
                                      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
                                      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
                                    } catch (error: any) {
                                      console.error('Error updating markup:', error);
                                      toast.error('Failed to update markup');
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-14 h-5 text-xs px-1 text-center"
                                  step="1"
                                  min="0"
                                />
                                <span className="text-xs text-slate-500">%</span>
                              </div>
                              <p className="text-xs font-bold text-blue-700">
                                ${itemPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                              {(lineItem as any).hide_from_customer && (
                                <span className="text-slate-400" title="Hidden from customer portal">
                                  <EyeOff className="w-3 h-3" />
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openLineItemDialog(row.id, lineItem, isLabor ? 'labor' : 'material', 'row');
                                }}
                              >
                                <Edit className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void deleteLineItem(lineItem.id);
                                }}
                              >
                                <Trash2 className="w-3 h-3 text-red-600" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                {linkedSubs.map((sub: any) => {
                  const subLineItems = subcontractorLineItems[sub.id] || [];
                  const included = subLineItems.filter((item: any) => !item.excluded);
                  const materialTotal = included
                    .filter((i: any) => (i.item_type || 'material') === 'material')
                    .reduce((sum: number, i: any) => sum + (i.total_price || 0), 0);
                  const laborTotal = included
                    .filter((i: any) => (i.item_type || 'material') === 'labor')
                    .reduce((sum: number, i: any) => sum + (i.total_price || 0), 0);
                  const markup = 1 + (sub.markup_percent || 0) / 100;
                  const materialWithMarkup = materialTotal * markup;
                  const laborWithMarkup = laborTotal * markup;
                  const totalWithMarkup = materialWithMarkup + laborWithMarkup;

                  return (
                    <Collapsible key={sub.id} className="bg-purple-50 border border-purple-300 rounded-md p-2.5 shadow-sm">
                      <div className="flex items-start gap-2">
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="p-0 h-auto hover:bg-transparent">
                            <ChevronDown className="w-4 h-4 text-slate-600" />
                          </Button>
                        </CollapsibleTrigger>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-slate-900">{sub.company_name}</p>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1 text-xs">
                                {materialTotal > 0 && <span className="text-slate-600">Material: ${materialWithMarkup.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                                {laborTotal > 0 && <span className="text-amber-700">Labor: ${laborWithMarkup.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                                {materialTotal === 0 && laborTotal === 0 && <span className="text-slate-500">$0.00</span>}
                                <span className="text-slate-500">+</span>
                                <Input
                                  type="number"
                                  value={sub.markup_percent || 0}
                                  onChange={(e) => {
                                    const newMarkup = parseFloat(e.target.value) || 0;
                                    updateSubcontractorMarkup(sub.id, newMarkup);
                                  }}
                                  className="w-14 h-5 text-xs px-1 text-center"
                                  step="1"
                                  min="0"
                                />
                                <span className="text-slate-500">%</span>
                              </div>
                              <p className="text-xs font-bold text-slate-900">
                                ${totalWithMarkup.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                              {sub.pdf_url && (
                                <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => window.open(sub.pdf_url, '_blank')}>
                                  <Eye className="w-3 h-3 text-blue-600" />
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => unlinkSubcontractor(sub.id)}>
                                <Trash2 className="w-3 h-3 text-red-600" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                      {sub.scope_of_work && (
                        <div className="ml-8 mt-1">
                          <p className="text-xs text-slate-600">{sub.scope_of_work}</p>
                        </div>
                      )}
                      <CollapsibleContent>
                        <div className="ml-8 mt-2 space-y-1">
                          {subLineItems.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-2">
                                <List className="w-3 h-3" />
                                Line Items
                                <span className="text-slate-500">({subLineItems.filter((item: any) => !item.excluded).length} of {subLineItems.length} included)</span>
                              </p>
                              {subLineItems.map((lineItem: any) => (
                                <div key={lineItem.id} className={`p-2 rounded mb-1 ${lineItem.excluded ? 'bg-red-50' : 'bg-slate-50'}`}>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={!lineItem.excluded}
                                      onChange={() => toggleSubcontractorLineItem(lineItem.id, lineItem.excluded)}
                                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                      title="Include in price"
                                    />
                                    <p className={`text-xs flex-1 ${lineItem.excluded ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                      {lineItem.description}
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <Badge
                                        variant="outline"
                                        className={`text-xs h-5 cursor-pointer hover:bg-slate-100 ${lineItem.excluded ? 'opacity-50' : ''}`}
                                        onClick={() => !lineItem.excluded && toggleSubcontractorLineItemType(lineItem.id, lineItem.item_type || 'material')}
                                        title="Click to toggle between Material and Labor"
                                      >
                                        {(lineItem.item_type || 'material') === 'labor' ? '👷 Labor' : '📦 Material'}
                                      </Badge>
                                      {(lineItem.item_type || 'material') === 'material' && (
                                        <>
                                          <Badge variant={lineItem.taxable ? 'default' : 'secondary'} className="text-xs h-5">
                                            {lineItem.taxable ? 'Tax' : 'No Tax'}
                                          </Badge>
                                          <input
                                            type="checkbox"
                                            checked={lineItem.taxable}
                                            onChange={() => toggleSubcontractorLineItemTaxable(lineItem.id, lineItem.taxable)}
                                            className="rounded border-slate-300 text-green-600 focus:ring-green-500"
                                            title="Taxable"
                                            disabled={lineItem.excluded}
                                          />
                                        </>
                                      )}
                                      <div className="flex items-center gap-1">
                                        <span className="text-xs text-slate-500">+</span>
                                        <Input
                                          type="number"
                                          value={lineItem.markup_percent || 0}
                                          onChange={async (e) => {
                                            const newMarkup = parseFloat(e.target.value) || 0;
                                            try {
                                              const { error } = await supabase
                                                .from('subcontractor_estimate_line_items')
                                                .update({ markup_percent: newMarkup })
                                                .eq('id', lineItem.id);
                                              if (error) throw error;
                                              await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
                                            } catch (error: any) {
                                              console.error('Error updating line item markup:', error);
                                              toast.error('Failed to update markup');
                                            }
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          className="w-14 h-5 text-xs px-1 text-center"
                                          step="1"
                                          min="0"
                                          disabled={lineItem.excluded}
                                        />
                                        <span className="text-xs text-slate-500">%</span>
                                      </div>
                                      <p className={`text-xs font-semibold ${lineItem.excluded ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                        ${(lineItem.total_price * (1 + (lineItem.markup_percent || 0) / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </p>
                                      {!isReadOnly && (
                                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-500 hover:text-slate-700" onClick={() => openEditSubcontractorLineItemDialog(lineItem)} title="Edit line item">
                                          <Edit className="w-3 h-3" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {!isReadOnly && (
                            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => openAddSubcontractorLineItemDialog(sub.id)}>
                              <Plus className="w-3 h-3 mr-1" />Add line item
                            </Button>
                          )}
                          {sub.exclusions && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                              <p className="text-xs font-semibold text-red-700 mb-1">Exclusions</p>
                              <p className="text-xs text-slate-600">{sub.exclusions}</p>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            </CollapsibleContent>
          )}
        </Collapsible>
      );
    } else if (item.type === 'subcontractor') {
      const est = item.data;
      const lineItems = subcontractorLineItems[est.id] || [];
      const included = lineItems.filter((item: any) => !item.excluded);
      const materialIncludedTotal = included
        .filter((i: any) => (i.item_type || 'material') === 'material')
        .reduce((sum: number, i: any) => sum + (i.total_price || 0), 0);
      const laborIncludedTotal = included
        .filter((i: any) => (i.item_type || 'material') === 'labor')
        .reduce((sum: number, i: any) => sum + (i.total_price || 0), 0);
      const includedTotal = materialIncludedTotal + laborIncludedTotal;
      const estMarkup = est.markup_percent || 0;
      const materialWithMarkup = materialIncludedTotal * (1 + estMarkup / 100);
      const laborWithMarkup = laborIncludedTotal * (1 + estMarkup / 100);
      const finalPrice = materialWithMarkup + laborWithMarkup;

      return (
        <Collapsible className="border border-slate-300 rounded-lg bg-white py-2 px-3 shadow-sm">
          <div className="flex items-start gap-2">
            {/* Drag Handle */}
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing py-1">
              <GripVertical className="w-4 h-4 text-slate-400" />
            </div>

            {/* Chevron */}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="p-0 h-auto hover:bg-transparent">
                <ChevronDown className="w-4 h-4 text-slate-600" />
              </Button>
            </CollapsibleTrigger>

            {/* Title */}
            <div className="flex-1 min-w-0">
              {editingRowName === est.id && editingRowNameType === 'subcontractor' ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={tempRowName}
                    onChange={(e) => setTempRowName(e.target.value)}
                    className="h-7 text-sm font-bold"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRowName();
                      if (e.key === 'Escape') cancelEditingRowName();
                    }}
                  />
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={saveRowName}>
                    <Check className="w-3 h-3 text-green-600" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={cancelEditingRowName}>
                    <X className="w-3 h-3 text-red-600" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <h3
                    className={`text-base font-bold text-slate-900 truncate ${!isReadOnly ? 'cursor-text' : ''}`}
                    title={!isReadOnly ? 'Double-click to rename' : undefined}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (isReadOnly) {
                        toast.error('Cannot edit in historical view');
                        return;
                      }
                      startEditingRowName(est.id, 'subcontractor', est.company_name);
                    }}
                  >
                    {est.company_name}
                  </h3>
                  {toBool((est as any).is_option) && (
                    <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 border-amber-300">
                      Optional
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {est.pdf_url && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => window.open(est.pdf_url, '_blank')}
              >
                <Eye className="w-4 h-4 text-blue-600" />
              </Button>
            )}

            {!isReadOnly && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!est.sheet_id && !est.row_id && (
                    toBool((est as any).is_option) ? (
                      <DropdownMenuItem onSelect={() => toggleSubcontractorOptional(est.id, false)}>
                        <Check className="w-3 h-3 mr-2 text-green-600" />
                        Include in Total
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => toggleSubcontractorOptional(est.id, true)}>
                        <Eye className="w-3 h-3 mr-2 text-amber-600" />
                        Mark as Optional (exclude from total)
                      </DropdownMenuItem>
                    )
                  )}
                  {!est.sheet_id && !est.row_id && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600"
                    onSelect={() => deleteSubcontractorSection(est.id)}
                  >
                    <Trash2 className="w-3 h-3 mr-2" />
                    Delete section
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Two-column layout: Description + Pricing */}
          <div className="ml-2 flex gap-1.5 mt-1">
            {/* Description column (full width, height fits content) */}
            <div className="flex-1 min-w-0">
              <Textarea
                key={`sub-scope-${est.id}-${est.scope_of_work ?? ''}`}
                defaultValue={est.scope_of_work || ''}
                placeholder="Add description..."
                className="text-sm text-slate-600 leading-tight border border-slate-200 hover:border-slate-300 focus:border-blue-400 p-1.5 bg-slate-50/50 hover:bg-slate-50 focus:bg-white rounded transition-colors focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-0 placeholder:italic placeholder:text-muted-foreground w-full min-w-0 min-h-0 resize-none"
                rows={est.scope_of_work ? (() => {
                  const lines = est.scope_of_work.split('\n');
                  const wrappedLines = lines.reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / 90)), 0);
                  return Math.max(2, wrappedLines);
                })() : 2}
                onChange={(e) => setEmptyScopeById((prev) => ({ ...prev, [est.id]: e.target.value.trim() === '' }))}
                onBlur={async (e) => {
                  if (isReadOnly) {
                    toast.error('Cannot edit in historical view');
                    e.target.value = est.scope_of_work || '';
                    return;
                  }
                  const newValue = e.target.value.trim();
                  setEmptyScopeById((prev) => ({ ...prev, [est.id]: newValue === '' }));
                  if (newValue !== (est.scope_of_work || '')) {
                    try {
                      await supabase
                        .from('subcontractor_estimates')
                        .update({ scope_of_work: newValue || null })
                        .eq('id', est.id);
                      await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
                    } catch (error) {
                      console.error('Error saving scope of work:', error);
                    }
                  }
                }}
              />
            </div>

            {/* Pricing column: Material (taxable) and Labor (non-taxable) split — compact */}
            <div className="w-[100px] sm:w-[112px] flex-shrink-0 text-right leading-tight">
              <div className="flex items-center justify-end gap-0.5 text-[10px] text-slate-600 mb-0.5">
                <span>+</span>
                <Input
                  type="number"
                  value={estMarkup || 0}
                  onChange={(e) => {
                    const newMarkup = parseFloat(e.target.value) || 0;
                    updateSubcontractorMarkup(est.id, newMarkup);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-9 h-5 text-[10px] px-0.5 text-center tabular-nums"
                  step="1"
                  min="0"
                />
                <span>%</span>
              </div>
              {materialIncludedTotal > 0 && (
                <div className="text-[10px] mb-0.5 tabular-nums leading-tight">
                  <span className="text-slate-500">Mat. </span>
                  <span className="font-medium">${materialWithMarkup.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              )}
              {laborIncludedTotal > 0 && (
                <div className="text-[10px] mb-0.5 tabular-nums leading-tight">
                  <span className="text-slate-500">Lab. </span>
                  <span className="font-medium text-amber-700">${laborWithMarkup.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              )}
              <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">Total</p>
              <p className="text-sm font-bold text-blue-700 tabular-nums">${finalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>

          <CollapsibleContent>
            <div className="mt-2 ml-2 space-y-1">
              {lineItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-2">
                    <List className="w-3 h-3" />
                    Line Items
                    <span className="text-slate-500">({lineItems.filter((item: any) => !item.excluded).length} of {lineItems.length} included)</span>
                  </p>
                  {lineItems.map((lineItem: any) => (
                    <div key={lineItem.id} className={`p-2 rounded mb-1 ${lineItem.excluded ? 'bg-red-50' : 'bg-slate-50'}`}>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!lineItem.excluded}
                          onChange={() => toggleSubcontractorLineItem(lineItem.id, lineItem.excluded)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          title="Include in price"
                        />
                        <p className={`text-xs flex-1 ${lineItem.excluded ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                          {lineItem.description}
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`text-xs h-5 cursor-pointer hover:bg-slate-100 ${lineItem.excluded ? 'opacity-50' : ''}`}
                            onClick={() => !lineItem.excluded && toggleSubcontractorLineItemType(lineItem.id, lineItem.item_type || 'material')}
                            title="Click to toggle between Material and Labor"
                          >
                            {(lineItem.item_type || 'material') === 'labor' ? '👷 Labor' : '📦 Material'}
                          </Badge>
                          {(lineItem.item_type || 'material') === 'material' && (
                            <>
                              <Badge variant={lineItem.taxable ? 'default' : 'secondary'} className="text-xs h-5">
                                {lineItem.taxable ? 'Tax' : 'No Tax'}
                              </Badge>
                              <input
                                type="checkbox"
                                checked={lineItem.taxable}
                                onChange={() => toggleSubcontractorLineItemTaxable(lineItem.id, lineItem.taxable)}
                                className="rounded border-slate-300 text-green-600 focus:ring-green-500"
                                title="Taxable"
                                disabled={lineItem.excluded}
                              />
                            </>
                          )}
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-500">+</span>
                            <Input
                              type="number"
                              value={lineItem.markup_percent || 0}
                              onChange={async (e) => {
                                const newMarkup = parseFloat(e.target.value) || 0;
                                try {
                                  const { error } = await supabase
                                    .from('subcontractor_estimate_line_items')
                                    .update({ markup_percent: newMarkup })
                                    .eq('id', lineItem.id);
                                  if (error) throw error;
                                  await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
                                } catch (error: any) {
                                  console.error('Error updating line item markup:', error);
                                  toast.error('Failed to update markup');
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-14 h-5 text-xs px-1 text-center"
                              step="1"
                              min="0"
                              disabled={lineItem.excluded}
                            />
                            <span className="text-xs text-slate-500">%</span>
                          </div>
                          <p className={`text-xs font-semibold ${lineItem.excluded ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                            ${(lineItem.total_price * (1 + (lineItem.markup_percent || 0) / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          {!isReadOnly && (
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-500 hover:text-slate-700" onClick={() => openEditSubcontractorLineItemDialog(lineItem)} title="Edit line item">
                              <Edit className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!isReadOnly && (
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => openAddSubcontractorLineItemDialog(est.id)}>
                  <Plus className="w-3 h-3 mr-1" />Add line item
                </Button>
              )}

              {est.exclusions && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <p className="text-xs font-semibold text-red-700 mb-1">Exclusions</p>
                  <p className="text-xs text-slate-600">{est.exclusions}</p>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      );
    }
    return null;
  })();

  return (
    <div ref={setNodeRef} style={style} className="group">
      {content}
    </div>
  );
}

const headerBtn = 'bg-white text-black hover:bg-slate-100 border-slate-400 text-xs h-8 px-2';

export function JobFinancials({
  job,
  controlledQuoteId,
  onQuoteChange,
  onSheetSelect,
  externalBreakdownSheetPrices,
  externalMaterialsWorkbookView,
  externalJobWorkbookMaterialsTotal,
  historicalUnlockedQuoteId: historicalUnlockedQuoteIdProp,
  onHistoricalUnlockedQuoteIdChange,
  materialsPanelActive = false,
  materialsWorkbookReady = true,
  materialsSyncGen = 0,
}: JobFinancialsProps) {
  const { profile } = useAuth();
  /** Always-fresh materials panel workbook view (loadMaterialsData runs async — closure would stay null after switch). */
  const externalMaterialsWorkbookViewRef = useRef(externalMaterialsWorkbookView);
  useEffect(() => {
    externalMaterialsWorkbookViewRef.current = externalMaterialsWorkbookView;
  }, [externalMaterialsWorkbookView]);
  const setProposalToolbar = useProposalToolbar();
  const proposalSummaryCtx = useProposalSummary();
  const undoApi = useUndo();
  const [loading, setLoading] = useState(true);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [customRows, setCustomRows] = useState<CustomFinancialRow[]>([]);
  const [customRowLineItems, setCustomRowLineItems] = useState<Record<string, CustomRowLineItem[]>>({});
  /** Sheet-linked line items (section labor) — never cleared on proposal switch; isolated from row-linked items. */
  const [sheetSectionLineItems, setSheetSectionLineItems] = useState<Record<string, CustomRowLineItem[]>>({});
  /** React state mirror of DB sheet labor — guarantees re-render when refs alone do not. */
  const [sheetLaborDisplayMap, setSheetLaborDisplayMap] = useState<Record<string, CustomRowLineItem[]>>({});
  const sheetLaborDisplayLiveRef = useRef<Record<string, CustomRowLineItem[]>>({});
  const [laborPricing, setLaborPricing] = useState<LaborPricing | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [customRowPanelPos, setCustomRowPanelPos] = useState({ x: 120, y: 72 });
  const customRowDialogRef = useRef<HTMLDivElement>(null);
  const customRowDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const customRowPanelPosInitialized = useRef(false);
  const [showSubUploadDialog, setShowSubUploadDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<CustomFinancialRow | null>(null);
  const savingMarkupsRef = useRef<Set<string>>(new Set());
  
  // Line item dialog state
  const [showLineItemDialog, setShowLineItemDialog] = useState(false);
  const [editingLineItem, setEditingLineItem] = useState<CustomRowLineItem | null>(null);
  const [savingLineItem, setSavingLineItem] = useState(false);
  const savingLineItemRef = useRef(false);
  const [lineItemParentRowId, setLineItemParentRowId] = useState<string | null>(null);
  const [lineItemParentType, setLineItemParentType] = useState<'sheet' | 'row' | null>(null);
  const [lineItemType, setLineItemType] = useState<'material' | 'labor' | 'combined'>('material');
  const [budgetCatalogManageOpen, setBudgetCatalogManageOpen] = useState(false);
  const [lineItemForm, setLineItemForm] = useState({
    description: '',
    quantity: '1',
    unit_cost: '0',
    notes: '',
    taxable: true,
    item_type: 'material' as 'material' | 'labor',
    markup_percent: '10',
    // Labor fields for combined items
    labor_hours: '0',
    labor_rate: '60',
    labor_markup_percent: '10',
    hide_from_customer: false,
  });
  
  // Individual row markups state
  const [sheetMarkups, setSheetMarkups] = useState<Record<string, number>>({});
  const [categoryMarkups, setCategoryMarkups] = useState<Record<string, number>>({});
  
  // Labor stats
  const [totalClockInHours, setTotalClockInHours] = useState(0);
  const [estimatedHours, setEstimatedHours] = useState(job.estimated_hours || 0);

  // Materials data
  const [materialsBreakdown, setMaterialsBreakdown] = useState<MaterialsBreakdown>({
    sheetBreakdowns: [],
    totals: { totalCost: 0, totalPrice: 0, totalProfit: 0, profitMargin: 0 }
  });
  
  // Material sheet description editing
  const [showSheetDescDialog, setShowSheetDescDialog] = useState(false);
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [sheetDescription, setSheetDescription] = useState('');
  const [materialSheets, setMaterialSheets] = useState<any[]>([]);
  const [activeWorkbookId, setActiveWorkbookId] = useState<string | null>(null);
  const [activeWorkbookStatus, setActiveWorkbookStatus] = useState<'working' | 'locked' | null>(null);
  const [sheetLabor, setSheetLabor] = useState<Record<string, any>>({});
  const [customRowLabor, setCustomRowLabor] = useState<Record<string, any>>({});

  // Row name editing state (for inline editing)
  const [editingRowName, setEditingRowName] = useState<string | null>(null);
  const [editingRowNameType, setEditingRowNameType] = useState<'sheet' | 'custom' | 'subcontractor' | null>(null);
  const [tempRowName, setTempRowName] = useState('');

  // Labor dialog state
  const [showLaborDialog, setShowLaborDialog] = useState(false);
  const [editingLaborSheetId, setEditingLaborSheetId] = useState<string | null>(null);
  const [editingLaborRowId, setEditingLaborRowId] = useState<string | null>(null);
  const [laborForm, setLaborForm] = useState({
    description: 'Labor & Installation',
    estimated_hours: 0,
    hourly_rate: 60,
    notes: '',
  });

  // Subcontractor estimates
  const [subcontractorEstimates, setSubcontractorEstimates] = useState<any[]>([]);
  const [subcontractorLineItems, setSubcontractorLineItems] = useState<Record<string, any[]>>({});
  const [linkedSubcontractors, setLinkedSubcontractors] = useState<Record<string, any[]>>({});
  const [subOptionalPersistenceUnsupported, setSubOptionalPersistenceUnsupported] = useState(() => readSubOptionalUnsupported(job.id));
  const [optionalSheetOverlay, setOptionalSheetOverlay] = useState<Record<string, boolean>>({});
  const [optionalSubOverlay, setOptionalSubOverlay] = useState<Record<string, boolean>>({});
  // Track empty description boxes so we can show narrow width (width of placeholder text)
  const [emptyNotesById, setEmptyNotesById] = useState<Record<string, boolean>>({});
  const [emptyScopeById, setEmptyScopeById] = useState<Record<string, boolean>>({});

  // Tax exempt: local state so the total updates immediately; optional DB persist when column exists
  const [taxExemptChecked, setTaxExemptChecked] = useState(false);
  // true = the current checked value is confirmed saved in the DB (visible to all users on reload)
  const [taxExemptSaved, setTaxExemptSaved] = useState(false);
  // Supabase Realtime broadcast channel for instant cross-user sync
  const taxExemptChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const quoteIdForSubsRef = useRef<string | null>(null);
  /**
   * Sibling-sheet remap (orphan_sheet_id → displayed_sheet_id) populated by
   * `loadMaterialsData` while computing the orphan-labor merge. Lets
   * `loadSubcontractorEstimates` and `loadCustomRows` re-attach subs/custom
   * rows whose `sheet_id` points to a sibling workbook's section to the
   * displayed sheet of the same name (or order_index). Without this, a
   * proposal version whose displayed workbook is missing the sub/row's
   * referenced sheet silently drops Cedar-Post-Changes-style cards from the
   * proposal totals — even though the data is still in the DB.
   */
  const siblingSheetRemapRef = useRef<Record<string, string>>({});
  /** Incremented on each full `loadData` so superseded async loads cannot overwrite materials/labor state. */
  const financialLoadCoopGenRef = useRef(0);
  const lastFinancialLoadSyncGenRef = useRef(-1);
  const isFinancialLoadStale = (gen?: number) =>
    gen != null && gen !== financialLoadCoopGenRef.current;
  /** True when async load still targets the proposal the user is viewing. */
  const isLoadForActiveProposal = (targetQuoteId: string | null | undefined) => {
    if (!targetQuoteId) return true;
    return (
      targetQuoteId === prevFinancialQuoteIdRef.current ||
      targetQuoteId === userSelectedQuoteIdRef.current
    );
  };
  const customRowsApplyAbortReason = (
    targetQuoteId: string | null | undefined,
    cooperativeGen?: number,
  ): 'staleGen' | 'wrongQuote' | null => {
    if (cooperativeGen != null && isFinancialLoadStale(cooperativeGen)) return 'staleGen';
    if (targetQuoteId && !isLoadForActiveProposal(targetQuoteId)) return 'wrongQuote';
    return null;
  };
  /** Last quote id applied to `customRowLineItems` — blocks optimistic merge across proposal switches. */
  const lastCustomRowsQuoteIdRef = useRef<string | null>(null);
  /** Last quote id applied to `sheetLabor` — blocks merging prior proposal labor on switch. */
  const lastSheetLaborQuoteIdRef = useRef<string | null>(null);
  /** Last successful sheetLabor payload per quote — recovers labor when a reload returns empty. */
  const sheetLaborByQuoteRef = useRef<Record<string, Record<string, any>>>({});
  /** Sheet-name index for per-quote labor cache (survives workbook/sheet id changes on reload). */
  const sheetLaborByNameByQuoteRef = useRef<Record<string, Record<string, any>>>({});
  /** Mirror of latest `sheetLabor` state for saving cache on proposal switch. */
  const sheetLaborLiveRef = useRef<Record<string, any>>({});
  /** Per-quote cache of sheet-linked line items (section labor lives here on legacy DBs). */
  const customRowLineItemsByQuoteRef = useRef<Record<string, Record<string, CustomRowLineItem[]>>>({});
  /** Authoritative per-quote sheet labor from DB prefetch — never cleared on proposal switch. */
  const prefetchedSheetLaborByQuoteRef = useRef<Record<string, Record<string, CustomRowLineItem[]>>>({});
  /** Mirror of latest `customRowLineItems` for cache on proposal switch. */
  const customRowLineItemsLiveRef = useRef<Record<string, CustomRowLineItem[]>>({});
  const sheetSectionLineItemsLiveRef = useRef<Record<string, CustomRowLineItem[]>>({});
  /** sheet_id → sheet_name for all sheets referenced by loaded line items (cross-proposal rekey). */
  const sheetMetaByIdRef = useRef<Record<string, string>>({});
  const [sheetMetaById, setSheetMetaById] = useState<Record<string, string>>({});
  /** Bumped when per-quote line-item cache updates without a React state write. */
  const [lineItemsCacheGen, setLineItemsCacheGen] = useState(0);
  const prevFinancialQuoteIdRef = useRef<string | null>(null);
  /** materials-workbook-updated fired during loadData — replay after load completes. */
  const pendingMaterialsWorkbookReloadRef = useRef(false);
  /** Last external locked workbook id we reloaded materials for (per quote). */
  const lastExternalLaborWbRef = useRef<{ quoteId: string; wbId: string } | null>(null);
  /** Workbook id resolved by the latest `loadMaterialsData` (for loadCustomRows before React re-renders). */
  const displayedWorkbookIdRef = useRef<string | null>(null);
  /** Labor total applied by the latest `loadMaterialsData` (for post-sync retry in loadData). */
  const lastMaterialsLaborTotalRef = useRef(0);
  /** True while `loadData` is in flight — blocks materials-workbook-updated from racing proposal switches. */
  const financialLoadInFlightRef = useRef(false);

  // Subcontractor dialog state
  const [copyCoDialogOpen, setCopyCoDialogOpen] = useState(false);
  const [copyCoSheetId, setCopyCoSheetId] = useState<string | null>(null);
  const [copyCoSheetName, setCopyCoSheetName] = useState('');
  const [copyCoRemoveFromProposal, setCopyCoRemoveFromProposal] = useState(true);
  const [copyCoRunning, setCopyCoRunning] = useState(false);
  const [sendingCoToCustomer, setSendingCoToCustomer] = useState(false);

  const [showSubcontractorDialog, setShowSubcontractorDialog] = useState(false);
  const [subcontractorParentId, setSubcontractorParentId] = useState<string | null>(null);
  const [subcontractorParentType, setSubcontractorParentType] = useState<'sheet' | 'row' | null>(null);
  const [subcontractorMode, setSubcontractorMode] = useState<'select' | 'upload'>('select');
  const [selectedExistingSubcontractor, setSelectedExistingSubcontractor] = useState<string>('');

  // Add line item to subcontractor section
  const [showAddSubcontractorLineItemDialog, setShowAddSubcontractorLineItemDialog] = useState(false);
  const [addSubcontractorLineItemEstimateId, setAddSubcontractorLineItemEstimateId] = useState<string | null>(null);
  const [subLineItemDescription, setSubLineItemDescription] = useState('');
  const [subLineItemQuantity, setSubLineItemQuantity] = useState('1');
  const [subLineItemUnitPrice, setSubLineItemUnitPrice] = useState('');
  const [subLineItemType, setSubLineItemType] = useState<'material' | 'labor'>('material');
  const [subLineItemTaxable, setSubLineItemTaxable] = useState(true);
  const [showEditSubcontractorLineItemDialog, setShowEditSubcontractorLineItemDialog] = useState(false);
  const [editingSubcontractorLineItemId, setEditingSubcontractorLineItemId] = useState<string | null>(null);

  // Remove tab state - this is now a single-view component (Proposal only)

  // Form state for custom rows
  const [category, setCategory] = useState('materials');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('60');
  const [markupPercent, setMarkupPercent] = useState('0');
  const [notes, setNotes] = useState('');
  const [taxable, setTaxable] = useState(true);
  const [linkedSheetId, setLinkedSheetId] = useState<string | null>(null);

  // Form state for labor pricing
  const [hourlyRate, setHourlyRate] = useState('60');
  
  // Export dialog state
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showLineItems, setShowLineItems] = useState(false); // Default to false - no row pricing by default
  const [exportViewType, setExportViewType] = useState<
    'customer' | 'office' | 'descriptions_only' | 'bid_spec'
  >('customer');
  const [exportTheme, setExportTheme] = useState<'default' | 'premium'>('default'); // default = black & white; premium = dark green + gold
  const [bidSpecDueDate, setBidSpecDueDate] = useState('');
  const [bidSpecInstructions, setBidSpecInstructions] = useState('');
  const [bidSpecShowQuantities, setBidSpecShowQuantities] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showPdfView, setShowPdfView] = useState(false);
  const [pdfViewHtml, setPdfViewHtml] = useState<string | null>(null);
  const [pdfViewFilename, setPdfViewFilename] = useState<string>('');
  const [pdfPrintUrl, setPdfPrintUrl] = useState<string | null>(null);
  const pdfIframeRef = useRef<HTMLIFrameElement>(null);

  // Proposal state - each proposal is independent
  const [currentProposal, setCurrentProposal] = useState<any>(null);
  const [allProposals, setAllProposals] = useState<any[]>([]);
  const [creatingNewProposal, setCreatingNewProposal] = useState(false);
  const [loadingProposalData, setLoadingProposalData] = useState(false);
  
  // Proposal/Quote state
  const [quote, setQuote] = useState<any>(null);
  const [allJobQuotes, setAllJobQuotes] = useState<any[]>([]); // All quotes for this job

  /** Change orders may only be created/sent after a main proposal is the contract (office or customer sign). */
  const jobHasContract = useMemo(
    () =>
      allJobQuotes.some((q: any) => {
        if (q.is_change_order_proposal) return false;
        const sv = q.signed_version;
        const hasSignedVersion = sv != null && sv !== '' && Number(sv) > 0;
        return hasSignedVersion || !!q.customer_signed_at;
      }),
    [allJobQuotes]
  );

  const formalJobQuotes = useMemo(
    () => allJobQuotes.filter((q: any) => q.is_customer_estimate !== true),
    [allJobQuotes]
  );
  /** Formal proposals excluding change-order rows — same set as scripts/renumber_job_proposals_newest_is_one.sql */
  const formalProposalsForRenumber = useMemo(
    () => formalJobQuotes.filter((q: any) => !q.is_change_order_proposal),
    [formalJobQuotes]
  );
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [proposalChangeNotes, setProposalChangeNotes] = useState('');
  const [showCreateProposalDialog, setShowCreateProposalDialog] = useState(false);
  const [showProposalComparison, setShowProposalComparison] = useState(false);
  const [showDeleteProposalConfirm, setShowDeleteProposalConfirm] = useState(false);
  const [deleteProposalQuoteId, setDeleteProposalQuoteId] = useState<string | null>(null);
  const [showRenumberProposalsDialog, setShowRenumberProposalsDialog] = useState(false);
  const [renumberingProposals, setRenumberingProposals] = useState(false);
  // Local overlay for optional categories when DB save fails (key = sheetId_categoryName)
  const [optionalCategoryOverlay, setOptionalCategoryOverlay] = useState<Record<string, boolean>>({});
  /** Price-list estimate UI: lines live in `customer_estimate_lines`, not a new quotes row. */
  const [estimateCatalogViewOpen, setEstimateCatalogViewOpen] = useState(false);
  const [customerEstimateLines, setCustomerEstimateLines] = useState<CustomerEstimateLineRow[]>([]);
  const [estimateLineDialogOpen, setEstimateLineDialogOpen] = useState(false);
  const [editingEstimateLine, setEditingEstimateLine] = useState<CustomerEstimateLineRow | null>(null);
  const [estimateLineForm, setEstimateLineForm] = useState({
    description: '',
    quantity: '1',
    unit_cost: '0',
    markup_percent: '10',
    taxable: true,
    notes: '',
  });
  const [savingEstimateLine, setSavingEstimateLine] = useState(false);
  const [templateQuoteIdForNewProposal, setTemplateQuoteIdForNewProposal] = useState<string | null>(null);
  const [recoveringProposal, setRecoveringProposal] = useState(false);
  const [showMarkAsSentManualDialog, setShowMarkAsSentManualDialog] = useState(false);
  const [markAsSentManualSql, setMarkAsSentManualSql] = useState('');

  // Optional section comparison state
  const [showComparePickerDialog, setShowComparePickerDialog] = useState(false);
  const [comparePickerSheetId, setComparePickerSheetId] = useState<string | null>(null); // optional sheet being set up
  const [expandedComparisons, setExpandedComparisons] = useState<Set<string>>(new Set());
  
  // Use ref to track user's selected quote ID (persists across re-renders)
  const userSelectedQuoteIdRef = useRef<string | null>(null);
  /** Skip duplicate onQuoteChange notifications after commitProposalSwitch. */
  const lastNotifiedQuoteIdRef = useRef<string | null | undefined>(undefined);
  /** Blocks loadData/loadCustomRows until commitProposalSwitch prefetch + restore finishes. */
  const proposalSwitchGateRef = useRef<Promise<void> | null>(null);
  async function waitForProposalSwitchGate() {
    if (proposalSwitchGateRef.current) {
      await proposalSwitchGateRef.current;
    }
  }
  // Track the last controlledQuoteId we synced so we only reload when the parent
  // actually changes the selection — not when allJobQuotes first populates.
  const lastSyncedControlledIdRef = useRef<string | null | undefined>(undefined);
  
  // Proposal versioning state
  const [proposalVersions, setProposalVersions] = useState<any[]>([]);
  const [viewingProposalNumber, setViewingProposalNumber] = useState<number | null>(null);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showCreateVersionDialog, setShowCreateVersionDialog] = useState(false);
  const [versionChangeNotes, setVersionChangeNotes] = useState('');
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [initializingVersions, setInitializingVersions] = useState(false);
  // When user explicitly unlocks a default-locked proposal for editing, allow edits until they lock again or switch proposal.
  // Parent may control this (split view) so Materials shares the same gate.
  const [internalHistoricalUnlockedQuoteId, setInternalHistoricalUnlockedQuoteId] = useState<string | null>(null);
  const historicalUnlockFromParent = typeof onHistoricalUnlockedQuoteIdChange === 'function';
  const effectiveHistoricalUnlockedQuoteId = historicalUnlockFromParent
    ? (historicalUnlockedQuoteIdProp ?? null)
    : internalHistoricalUnlockedQuoteId;
  const setEffectiveHistoricalUnlockedQuoteId = historicalUnlockFromParent
    ? onHistoricalUnlockedQuoteIdChange!
    : setInternalHistoricalUnlockedQuoteId;


  // Ref always holding the latest values needed by the materials-workbook-updated event handler,
  // so the handler never has stale closures regardless of when it was registered.
  const workbookUpdateCtxRef = useRef<{
    jobId: string;
    quoteId: string | null;
    allJobQuotesFirstId: string | undefined;
    historicalUnlockedQuoteId: string | null; // effective session unlock id (parent or internal)
    loadMaterialsData: (
      targetQuoteId: string | null,
      isHistorical?: boolean,
      overlayOverride?: Record<string, boolean>,
      cooperativeGen?: number,
    ) => void;
    loadSubcontractorEstimates: (targetQuoteId: string | null, isHistorical?: boolean) => Promise<void>;
  }>({
    jobId: job.id,
    quoteId: null,
    allJobQuotesFirstId: undefined,
    historicalUnlockedQuoteId: null,
    loadMaterialsData: () => {},
    loadSubcontractorEstimates: async () => {},
  });

  // First open: center the floating custom-row panel; later opens keep last position.
  useEffect(() => {
    if (!showAddDialog || typeof window === 'undefined') return;
    if (customRowPanelPosInitialized.current) return;
    customRowPanelPosInitialized.current = true;
    const w = Math.min(672, window.innerWidth - 32);
    setCustomRowPanelPos({
      x: Math.max(16, (window.innerWidth - w) / 2),
      y: Math.max(16, window.innerHeight * 0.08),
    });
  }, [showAddDialog]);

  // Clear session unlock when switching to a different proposal (internal state only; parent clears its own when controlled).
  useEffect(() => {
    if (historicalUnlockFromParent) return;
    setInternalHistoricalUnlockedQuoteId((prev) => {
      if (!quote?.id || prev == null) return prev;
      return quote.id !== prev ? null : prev;
    });
  }, [quote?.id, historicalUnlockFromParent]);

  // Optional-category overlay is per workbook/sheet keys — must not carry over to another proposal
  useEffect(() => {
    setOptionalCategoryOverlay({});
  }, [quote?.id]);

  const isDefaultLocked = isQuoteDefaultLockedForProposalPanel(quote, allJobQuotes);
  const isReadOnly = isProposalPanelReadOnly(quote, allJobQuotes, effectiveHistoricalUnlockedQuoteId);
  const isExternallyViewingLockedWorkbook = externalMaterialsWorkbookView?.status === 'locked';
  const isPriceIsolated = isReadOnly || isExternallyViewingLockedWorkbook;

  // Build a fast lookup from the structured Breakdown prices: (sheetId|sheetName) → categoryName → price.
  // Signed contract: only apply Materials-panel category sync when that panel reports the **locked** contract workbook.
  // If status is working, null (before sync), or anything other than locked, ignore external prices so the header
  // stays on DB-loaded locked snapshot totals instead of the job-tracking working copy (~$ mismatch while editing).
  const externalPriceLookup = useMemo(() => {
    if (quote && quoteHasActiveContract(quote as any) && externalMaterialsWorkbookView?.status !== 'locked') {
      return new Map<string, Record<string, number>>();
    }
    const map = new Map<string, Record<string, number>>();
    (externalBreakdownSheetPrices || []).forEach((sp) => {
      // Normalize category keys so lookups by lowercased names always work.
      const normalizedCategories: Record<string, number> = {};
      Object.entries(sp.categories || {}).forEach(([k, v]) => {
        const key = String(k ?? '').trim().toLowerCase();
        if (!key) return;
        normalizedCategories[key] = Number(v) || 0;
      });
      map.set(sp.sheetId, normalizedCategories);
      map.set(sp.sheetName.trim().toLowerCase(), normalizedCategories);
    });
    return map;
  }, [externalBreakdownSheetPrices, quote, externalMaterialsWorkbookView?.status]);
  
  // Document viewer state — Building Description is quote-level only (quotes.description), not job-level
  const [showDocumentViewer, setShowDocumentViewer] = useState(false);
  const documentPanel = useDocumentPanel();
  const openDocuments = () => {
    if (documentPanel) {
      documentPanel.setShowDocumentsInPanel(true);
    } else {
      setShowDocumentViewer(true);
    }
  };
  const [buildingDescription, setBuildingDescription] = useState((quote as any)?.description ?? '');
  const [editingDescription, setEditingDescription] = useState(false);
  
  // Template editor state
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  
  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const selectedQuote = await loadQuoteData();
      if (cancelled) return;
      setLoading(false);
      // Financial data loads via quote?.id effect after setQuote commits (runs after row-state clear).
    })();
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  useEffect(() => {
    sheetLaborLiveRef.current = sheetLabor;
  }, [sheetLabor]);

  useEffect(() => {
    customRowLineItemsLiveRef.current = customRowLineItems;
  }, [customRowLineItems]);

  useEffect(() => {
    sheetSectionLineItemsLiveRef.current = sheetSectionLineItems;
  }, [sheetSectionLineItems]);

  useEffect(() => {
    sheetLaborDisplayLiveRef.current = sheetLaborDisplayMap;
  }, [sheetLaborDisplayMap]);

  /** Store quote-native sheet labor keys; displayCustomRowLineItems rekeys onto the live breakdown. */
  function setSheetLaborDisplayMapSafe(
    map: Record<string, CustomRowLineItem[]>,
    source: string,
  ) {
    const labor = laborTotalFromLineItemsMap(map);
    const prevLabor = laborTotalFromLineItemsMap(sheetLaborDisplayLiveRef.current);
    if (labor <= 0 && prevLabor > 0) {
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H33-blockedDisplayWipe',
        location: 'JobFinancials.tsx:setSheetLaborDisplayMapSafe',
        message: 'blocked empty sheetLaborDisplayMap write — kept prior labor',
        data: { source, prevLabor, prevKeys: Object.keys(sheetLaborDisplayLiveRef.current) },
      });
      return;
    }
    if (labor <= 0) return;
    const copy = JSON.parse(JSON.stringify(map)) as Record<string, CustomRowLineItem[]>;
    sheetLaborDisplayLiveRef.current = copy;
    setSheetLaborDisplayMap(copy);
  }

  /** Keep sheet id → name across proposal switches so rekey can map prior proposal keys. */
  useEffect(() => {
    const patch: Record<string, string> = {};
    materialSheets.forEach((s: any) => {
      const id = String(s?.id ?? '').trim();
      if (id) patch[id] = String(s?.sheet_name ?? '');
    });
    (materialsBreakdown?.sheetBreakdowns || []).forEach((s: any) => {
      const id = String(s?.sheetId ?? '').trim();
      if (id) patch[id] = String(s?.sheetName ?? '');
    });
    if (Object.keys(patch).length === 0) return;
    sheetMetaByIdRef.current = { ...sheetMetaByIdRef.current, ...patch };
    setSheetMetaById((prev) => ({ ...prev, ...patch }));
  }, [quote?.id, materialSheets, materialsBreakdown?.sheetBreakdowns]);

  function pickBestLineItemsMap(
    candidates: Array<Record<string, CustomRowLineItem[]> | null | undefined>,
  ): Record<string, CustomRowLineItem[]> | null {
    let best: Record<string, CustomRowLineItem[]> | null = null;
    let bestLabor = 0;
    for (const map of candidates) {
      if (!map) continue;
      const labor = laborTotalFromLineItemsMap(map);
      if (labor > bestLabor) {
        bestLabor = labor;
        best = map;
      }
    }
    return best;
  }

  /** Best sheet-labor map for a quote — prefetched DB snapshot wins over stale React/cache state. */
  function pickBestSheetLaborForQuote(
    quoteId: string | null | undefined,
  ): Record<string, CustomRowLineItem[]> | null {
    if (!quoteId) return null;
    const prefetched = prefetchedSheetLaborByQuoteRef.current[quoteId];
    const cached = customRowLineItemsByQuoteRef.current[quoteId];
    return pickBestLineItemsMap([
      prefetched && laborTotalFromLineItemsMap(prefetched) > 0 ? prefetched : null,
      quoteId === prevFinancialQuoteIdRef.current &&
      laborTotalFromLineItemsMap(sheetLaborDisplayLiveRef.current) > 0
        ? sheetLaborDisplayLiveRef.current
        : null,
      laborTotalFromLineItemsMap(sheetSectionLineItemsLiveRef.current) > 0
        ? sheetSectionLineItemsLiveRef.current
        : null,
      laborTotalFromLineItemsMap(customRowLineItemsLiveRef.current) > 0
        ? customRowLineItemsLiveRef.current
        : null,
      cached && laborTotalFromLineItemsMap(cached) > 0 ? cached : null,
    ]);
  }

  function storeSheetLaborForQuote(quoteId: string, map: Record<string, CustomRowLineItem[]>) {
    const labor = laborTotalFromLineItemsMap(map);
    if (labor <= 0) return;
    prefetchedSheetLaborByQuoteRef.current[quoteId] = JSON.parse(JSON.stringify(map));
    saveQuoteLineItemsCache(quoteId, map);
  }

  function saveQuoteLineItemsCache(
    quoteId: string | null | undefined,
    map: Record<string, CustomRowLineItem[]>,
    opts?: { allowReduce?: boolean },
  ) {
    if (!quoteId) return;
    const newLabor = laborTotalFromLineItemsMap(map);
    const existing = customRowLineItemsByQuoteRef.current[quoteId];
    const existingLabor = existing ? laborTotalFromLineItemsMap(existing) : 0;
    const prefetchedLabor = laborTotalFromLineItemsMap(
      prefetchedSheetLaborByQuoteRef.current[quoteId] ?? {},
    );
    if (!opts?.allowReduce) {
      if (newLabor <= 0 && (existingLabor > 0 || prefetchedLabor > 0)) {
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H16-cacheWipe',
          location: 'JobFinancials.tsx:saveQuoteLineItemsCache:blocked',
          message: 'blocked cache write that would wipe labor',
          data: { quoteId, newLabor, existingLabor, prefetchedLabor },
        });
        return;
      }
      if (newLabor > 0 && newLabor < existingLabor) return;
      if (prefetchedLabor > 0 && newLabor > 0 && newLabor < prefetchedLabor) {
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H28-leavingDbSnapshot',
          location: 'JobFinancials.tsx:saveQuoteLineItemsCache:blockedBelowPrefetch',
          message: 'blocked cache write below DB-prefetched labor for quote',
          data: { quoteId, newLabor, prefetchedLabor },
        });
        return;
      }
    }
    customRowLineItemsByQuoteRef.current[quoteId] = JSON.parse(JSON.stringify(map));
    setLineItemsCacheGen((g) => g + 1);
  }

  function applySheetSectionLineItems(
    map: Record<string, CustomRowLineItem[]>,
    quoteId?: string | null,
    opts?: { allowReduce?: boolean },
  ) {
    const labor = laborTotalFromLineItemsMap(map);
    const activeQuoteId = prevFinancialQuoteIdRef.current;
    const userSelected = userSelectedQuoteIdRef.current;
    const isActiveQuote =
      !quoteId || quoteId === activeQuoteId || quoteId === userSelected;

    if (quoteId && labor > 0) {
      saveQuoteLineItemsCache(quoteId, map, opts);
    }

    if (!isActiveQuote) {
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H17-staleSectionApply',
        location: 'JobFinancials.tsx:applySheetSectionLineItems:cacheOnly',
        message: 'cached sheet line items for inactive quote — skipped live state write',
        data: { quoteId, activeQuoteId, labor },
      });
      return;
    }

    const prevLabor = laborTotalFromLineItemsMap(sheetSectionLineItemsLiveRef.current);
    if (!opts?.allowReduce && labor <= 0 && prevLabor > 0) {
      return;
    }
    if (!opts?.allowReduce && labor > 0 && labor < prevLabor) {
      return;
    }
    const copy = JSON.parse(JSON.stringify(map)) as Record<string, CustomRowLineItem[]>;
    sheetSectionLineItemsLiveRef.current = copy;
    setSheetSectionLineItems(copy);
  }

  function commitSheetLineItemsState(
    map: Record<string, CustomRowLineItem[]>,
    quoteId?: string | null,
    opts?: { allowReduce?: boolean },
  ) {
    const mapLabor = laborTotalFromLineItemsMap(map);
    const existingLabor = laborTotalFromLineItemsMap(
      pickBestLineItemsMap([
        quoteId ? customRowLineItemsByQuoteRef.current[quoteId] : null,
        sheetSectionLineItemsLiveRef.current,
        customRowLineItemsLiveRef.current,
      ]) ?? {},
    );
    if (mapLabor <= 0 && existingLabor > 0 && !opts?.allowReduce) {
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H19-emptyCommit',
        location: 'JobFinancials.tsx:commitSheetLineItemsState:blocked',
        message: 'blocked commit that would wipe visible sheet line item labor',
        data: { quoteId, mapLabor, existingLabor, activeQuoteId: prevFinancialQuoteIdRef.current },
      });
      return;
    }
    applySheetSectionLineItems(map, quoteId, opts);
    const copy = JSON.parse(JSON.stringify(map)) as Record<string, CustomRowLineItem[]>;
    customRowLineItemsLiveRef.current = copy;
    setCustomRowLineItems(copy);
  }

  function resolvedSheetLineItemLaborForQuote(quoteId: string | null | undefined): number {
    if (!quoteId) return 0;
    return laborTotalFromLineItemsMap(
      pickBestLineItemsMap([
        prefetchedSheetLaborByQuoteRef.current[quoteId],
        customRowLineItemsByQuoteRef.current[quoteId],
        sheetSectionLineItemsLiveRef.current,
        customRowLineItemsLiveRef.current,
      ]) ?? {},
    );
  }

  function rekeySheetLaborOntoBreakdown(
    map: Record<string, CustomRowLineItem[]>,
  ): Record<string, CustomRowLineItem[]> {
    const displayedSheets: LaborSheetRef[] = (
      materialsBreakdown?.sheetBreakdowns?.length
        ? materialsBreakdown.sheetBreakdowns
        : materialSheets
    )
      .map((s: any) => ({
        id: String(s?.sheetId ?? s?.id ?? '').trim(),
        sheet_name: s?.sheetName ?? s?.sheet_name,
        order_index: s?.orderIndex ?? s?.order_index,
      }))
      .filter((s) => s.id);
    if (displayedSheets.length === 0) return map;

    const sheetIdToName = new Map<string, string>();
    Object.entries(sheetMetaByIdRef.current).forEach(([id, name]) => sheetIdToName.set(id, name));
    Object.entries(sheetMetaById).forEach(([id, name]) => sheetIdToName.set(id, name));
    materialSheets.forEach((s: any) => {
      const id = String(s?.id ?? '').trim();
      if (id) sheetIdToName.set(id, String(s?.sheet_name ?? ''));
    });
    (materialsBreakdown?.sheetBreakdowns || []).forEach((s: any) => {
      const id = String(s?.sheetId ?? '').trim();
      if (id) sheetIdToName.set(id, String(s?.sheetName ?? ''));
    });

    const displayedIds = new Set(displayedSheets.map((s) => s.id));
    const hasOverlap = Object.keys(map).some((k) => displayedIds.has(String(k).trim()));
    if (hasOverlap) return map;

    const rekeyed = rekeySheetLineItemsToDisplayedSheets(map, displayedSheets, sheetIdToName);
    return laborTotalFromLineItemsMap(rekeyed) > 0 ? rekeyed : map;
  }

  function applyPrefetchedLaborForActiveQuote(source: string): number {
    const qid = quote?.id;
    if (!qid) return 0;
    const prefetched = prefetchedSheetLaborByQuoteRef.current[qid];
    if (!prefetched || laborTotalFromLineItemsMap(prefetched) <= 0) return 0;
    const map = JSON.parse(JSON.stringify(prefetched)) as Record<string, CustomRowLineItem[]>;
    const labor = laborTotalFromLineItemsMap(map);
    commitSheetLineItemsState(map, qid);
    setSheetLaborDisplayMapSafe(map, `applyPrefetchedLaborForActiveQuote:${source}`);
    agentDebugLog({
      runId: 'post-fix',
      hypothesisId: 'H31-breakdownSync',
      location: 'JobFinancials.tsx:applyPrefetchedLaborForActiveQuote',
      message: 'applied DB-prefetched sheet labor (native keys — display layer rekeys)',
      data: { qid, source, labor, sheetKeys: Object.keys(map) },
    });
    return labor;
  }
  /** Display layer: row-linked items from customRowLineItems; sheet labor from sheetSectionLineItems + cache + rekey. */
  const displayCustomRowLineItems = useMemo(() => {
    const qid = quote?.id;
    const customRowIds = new Set(customRows.map((r) => String(r.id ?? '').trim()).filter(Boolean));

    const rowLinkedOnly: Record<string, CustomRowLineItem[]> = {};
    Object.entries(customRowLineItems).forEach(([k, items]) => {
      if (customRowIds.has(k) || (items || []).some((it) => it.row_id)) {
        rowLinkedOnly[k] = items;
      }
    });

    const displayedSheets: LaborSheetRef[] = (
      materialsBreakdown?.sheetBreakdowns?.length
        ? materialsBreakdown.sheetBreakdowns
        : materialSheets
    )
      .map((s: any) => ({
        id: String(s?.sheetId ?? s?.id ?? '').trim(),
        sheet_name: s?.sheetName ?? s?.sheet_name,
        order_index: s?.orderIndex ?? s?.order_index,
      }))
      .filter((s) => s.id);

    const sheetIdToName = new Map<string, string>();
    Object.entries(sheetMetaById).forEach(([id, name]) => {
      const sid = String(id).trim();
      if (sid) sheetIdToName.set(sid, name);
    });
    Object.entries(sheetMetaByIdRef.current).forEach(([id, name]) => {
      const sid = String(id).trim();
      if (sid && !sheetIdToName.has(sid)) sheetIdToName.set(sid, name);
    });
    materialSheets.forEach((s: any) => {
      const id = String(s?.id ?? '').trim();
      if (id) sheetIdToName.set(id, String(s?.sheet_name ?? ''));
    });
    (materialsBreakdown?.sheetBreakdowns || []).forEach((s: any) => {
      const id = String(s?.sheetId ?? '').trim();
      if (id) sheetIdToName.set(id, String(s?.sheetName ?? ''));
    });

    const cached = qid ? customRowLineItemsByQuoteRef.current[qid] : null;
    const prefetchedForQuote = qid ? prefetchedSheetLaborByQuoteRef.current[qid] : null;
    const prefetchedLabor = prefetchedForQuote ? laborTotalFromLineItemsMap(prefetchedForQuote) : 0;
    const displayMapLabor = laborTotalFromLineItemsMap(sheetLaborDisplayMap);
    const sectionLabor = laborTotalFromLineItemsMap(sheetSectionLineItems);
    const cachedLabor = cached ? laborTotalFromLineItemsMap(cached) : 0;
    const stateSheetOnly = Object.fromEntries(
      Object.entries(customRowLineItems).filter(([k]) => !customRowIds.has(k)),
    );
    const stateSheetLabor = laborTotalFromLineItemsMap(stateSheetOnly);

    const sheetSource =
      pickBestLineItemsMap([
        prefetchedLabor > 0 ? prefetchedForQuote : null,
        displayMapLabor > 0 ? sheetLaborDisplayMap : null,
        cachedLabor > 0 ? cached : null,
        sectionLabor > 0 ? sheetSectionLineItems : null,
        stateSheetLabor > 0 ? stateSheetOnly : null,
      ]) ?? {};

    const sheetOnlySource = Object.fromEntries(
      Object.entries(sheetSource).filter(([k]) => !customRowIds.has(k)),
    );

    if (displayedSheets.length === 0) {
      return { ...rowLinkedOnly, ...sheetOnlySource };
    }

    let rekeyedSheets = rekeySheetLineItemsToDisplayedSheets(
      sheetOnlySource,
      displayedSheets,
      sheetIdToName,
    );
    let rekeyedLabor = laborTotalFromLineItemsMap(rekeyedSheets);
    const sourceLabor = laborTotalFromLineItemsMap(sheetOnlySource);

    if (rekeyedLabor <= 0 && sourceLabor > 0) {
      const displayedIds = new Set(displayedSheets.map((s) => String(s.id).trim()));
      const sourceOverlap = Object.keys(sheetOnlySource).some((k) => displayedIds.has(String(k).trim()));
      const fallbackOut: Record<string, CustomRowLineItem[]> = {};
      for (const ds of displayedSheets) {
        const targetName = normalizeLaborSheetName(ds.sheet_name);
        if (!targetName) continue;
        for (const [sid, items] of Object.entries(sheetOnlySource)) {
          if (!items?.length) continue;
          const srcName = normalizeLaborSheetName(sheetIdToName.get(String(sid).trim()));
          if (srcName === targetName) {
            fallbackOut[ds.id] = items.map((it) => ({ ...it, sheet_id: ds.id }));
            break;
          }
        }
      }
      const fallbackLabor = laborTotalFromLineItemsMap(fallbackOut);
      if (fallbackLabor > 0) {
        rekeyedSheets = fallbackOut;
        rekeyedLabor = fallbackLabor;
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H34-rekeyFallbackGap',
          location: 'JobFinancials.tsx:displayCustomRowLineItems:fallback',
          message: 'primary rekey returned zero — recovered labor via sheet-name fallback',
          data: {
            quoteId: qid,
            sourceLabor,
            displayMapLabor,
            prefetchedLabor,
            sourceOverlap,
            cachedLabor,
            sectionLabor,
            stateSheetLabor,
            fallbackLabor,
            sourceKeys: Object.keys(sheetOnlySource),
            displayedSheetIds: displayedSheets.map((s) => s.id),
          },
        });
      } else if (sourceLabor > 0) {
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H34-rekeyFallbackGap',
          location: 'JobFinancials.tsx:displayCustomRowLineItems:fallbackFailed',
          message: 'sheet labor in source but primary rekey AND name fallback both returned zero',
          data: {
            quoteId: qid,
            sourceLabor,
            displayMapLabor,
            prefetchedLabor,
            sourceKeys: Object.keys(sheetOnlySource),
            displayedSheetIds: displayedSheets.map((s) => s.id),
            sheetIdToNameSize: sheetIdToName.size,
          },
        });
      }
    }

    if (rekeyedLabor > 0 && rekeyedLabor > sectionLabor && sectionLabor > 0) {
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H15-displayLayer',
        location: 'JobFinancials.tsx:displayCustomRowLineItems',
        message: 'display rekey recovered labor not reachable via sheetSectionLineItems keys',
        data: {
          quoteId: qid,
          sectionLabor,
          rekeyedLabor,
          sectionKeys: Object.keys(sheetSectionLineItems),
          displayKeys: Object.keys(rekeyedSheets),
          displayedSheetIds: displayedSheets.map((s) => s.id),
        },
      });
    }

    return { ...rowLinkedOnly, ...rekeyedSheets };
  }, [
    quote?.id,
    customRowLineItems,
    sheetSectionLineItems,
    sheetLaborDisplayMap,
    customRows,
    materialsBreakdown,
    materialSheets,
    sheetMetaById,
    lineItemsCacheGen,
  ]);

  useEffect(() => {
    if (!quote?.id) return;
    const displayLabor = laborTotalFromLineItemsMap(displayCustomRowLineItems);
    const displayMapLabor = laborTotalFromLineItemsMap(sheetLaborDisplayMap);
    const sectionLabor = laborTotalFromLineItemsMap(sheetSectionLineItems);
    agentDebugLog({
      runId: 'post-fix',
      hypothesisId: 'H32-displaySnapshot',
      location: 'JobFinancials.tsx:displaySnapshot',
      message: 'display labor snapshot for active quote',
      data: {
        quoteId: quote.id,
        displayLabor,
        displayMapLabor,
        sectionLabor,
        displayMapKeys: Object.keys(sheetLaborDisplayMap),
        breakdownSheetIds: (materialsBreakdown?.sheetBreakdowns || []).map((s: any) => s?.sheetId),
      },
    });
  }, [
    quote?.id,
    displayCustomRowLineItems,
    sheetLaborDisplayMap,
    sheetSectionLineItems,
    materialsBreakdown?.sheetBreakdowns,
  ]);

  useEffect(() => {
    if (!quote?.id) return;
    const breakdownIds = (materialsBreakdown?.sheetBreakdowns || [])
      .map((s: any) => String(s?.sheetId ?? '').trim())
      .filter(Boolean);
    if (breakdownIds.length === 0) return;
    const stateLabor = laborTotalFromLineItemsMap(customRowLineItems);
    const sectionLabor = laborTotalFromLineItemsMap(sheetSectionLineItems);
    const displayLabor = laborTotalFromLineItemsMap(displayCustomRowLineItems);
    if (stateLabor <= 0 && sectionLabor <= 0 && displayLabor <= 0) return;
    let resolvedLabor = 0;
    for (const s of materialsBreakdown.sheetBreakdowns || []) {
      const sid = String((s as any)?.sheetId ?? '').trim();
      if (!sid) continue;
      const items = resolveCustomRowLineItemsForSheet(
        displayCustomRowLineItems,
        materialSheets,
        sid,
        (s as any)?.sheetName,
        materialsBreakdown.sheetBreakdowns,
        sheetMetaById,
      );
      resolvedLabor += items
        .filter((it) => (it.item_type || 'material') === 'labor')
        .reduce(
          (sum, it) =>
            sum + (Number(it.total_cost) || Number(it.quantity || 0) * Number(it.unit_cost || 0)),
          0,
        );
    }
    const stateKeys = Object.keys(customRowLineItems);
    const sectionKeys = Object.keys(sheetSectionLineItems);
    const keyOverlap = stateKeys.some((k) => breakdownIds.includes(String(k).trim()));
    if ((stateLabor > 0 || sectionLabor > 0 || displayLabor > 0) && resolvedLabor === 0) {
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H14-rekey',
        location: 'JobFinancials.tsx:laborRenderMismatch',
        message: 'line items have labor but section lookup resolves zero — key/sheet id mismatch',
        data: {
          quoteId: quote.id,
          stateLabor,
          sectionLabor,
          displayLabor,
          resolvedLabor,
          stateKeys,
          sectionKeys,
          breakdownIds,
          keyOverlap,
        },
      });
    }
  }, [
    quote?.id,
    customRowLineItems,
    sheetSectionLineItems,
    displayCustomRowLineItems,
    materialsBreakdown,
    materialSheets,
    sheetMetaById,
  ]);

  // Mirror visible sheet labor into per-quote cache so proposal switches never lose data the UI is showing.
  useEffect(() => {
    const qid = quote?.id;
    if (!qid) return;
    const rowIds = new Set(customRows.map((r) => String(r.id ?? '').trim()).filter(Boolean));
    const sheetMap = extractSheetOnlyLineItems(displayCustomRowLineItems, rowIds);
    const labor = laborTotalFromLineItemsMap(sheetMap);
    if (labor <= 0) return;
    const cachedLabor = laborTotalFromLineItemsMap(customRowLineItemsByQuoteRef.current[qid] ?? {});
    const sectionLabor = laborTotalFromLineItemsMap(sheetSectionLineItemsLiveRef.current);
    if (labor <= cachedLabor && labor <= sectionLabor) return;
    const rowPart = Object.fromEntries(
      Object.entries(customRowLineItems).filter(([k]) => rowIds.has(k)),
    );
    saveQuoteLineItemsCache(qid, { ...rowPart, ...sheetMap });
    if (labor > sectionLabor) {
      const copy = JSON.parse(JSON.stringify(sheetMap)) as Record<string, CustomRowLineItem[]>;
      sheetSectionLineItemsLiveRef.current = copy;
      setSheetSectionLineItems(copy);
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H23-displayCacheSync',
        location: 'JobFinancials.tsx:displayCacheSync',
        message: 'synced visible sheet labor into cache and sheetSectionLineItems',
        data: { qid, labor, sectionLabor, cachedLabor, sheetKeys: Object.keys(sheetMap) },
      });
    }
  }, [quote?.id, displayCustomRowLineItems, customRows, customRowLineItems]);

  // Synchronous proposal switch: invalidate in-flight loads BEFORE paint so stale P1 loadCustomRows
  // cannot apply after quote.id is already P2 (quote load effect may defer until materials panel is ready).
  useLayoutEffect(() => {
    const qid = quote?.id ?? null;
    if (!qid) return;
    const prev = prevFinancialQuoteIdRef.current;
    if (prev === qid) return;

    if (prev) {
      if (laborMapTotal(sheetLaborLiveRef.current) > 0) {
        sheetLaborByQuoteRef.current[prev] = { ...sheetLaborLiveRef.current };
      }
      const liveLabor = laborTotalFromLineItemsMap(customRowLineItemsLiveRef.current);
      const sectionLabor = laborTotalFromLineItemsMap(sheetSectionLineItemsLiveRef.current);
      const prevCachedLabor = laborTotalFromLineItemsMap(
        customRowLineItemsByQuoteRef.current[prev] ?? {},
      );
      const prefetchedPrevLabor = laborTotalFromLineItemsMap(
        prefetchedSheetLaborByQuoteRef.current[prev] ?? {},
      );
      const best = pickBestSheetLaborForQuote(prev);
      const bestLabor = best ? laborTotalFromLineItemsMap(best) : 0;
      if (best && bestLabor > 0) {
        saveQuoteLineItemsCache(prev, best);
      }
      financialLoadInFlightRef.current = false;
      const invalidatedGen = ++financialLoadCoopGenRef.current;
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H16-cacheWipe',
        location: 'JobFinancials.tsx:quoteSwitchLayout',
        message: 'quote switch — saved best line items cache (never empty over labor)',
        data: {
          fromQuoteId: prev,
          toQuoteId: qid,
          invalidatedGen,
          liveLabor,
          sectionLabor,
          prevCachedLabor,
          prefetchedPrevLabor,
          savedLabor: bestLabor,
        },
      });
    }

    prevFinancialQuoteIdRef.current = qid;
    lastCustomRowsQuoteIdRef.current = null;
    lastExternalLaborWbRef.current = null;

    const cachedLineItems = customRowLineItemsByQuoteRef.current[qid];
    const cachedLineLabor = cachedLineItems ? laborTotalFromLineItemsMap(cachedLineItems) : 0;
    const restoreFrom = pickBestSheetLaborForQuote(qid);
    const restoreLabor = restoreFrom ? laborTotalFromLineItemsMap(restoreFrom) : 0;
    const prefetchedLabor = laborTotalFromLineItemsMap(
      prefetchedSheetLaborByQuoteRef.current[qid] ?? {},
    );
    if (restoreFrom && restoreLabor > 0) {
      commitSheetLineItemsState(restoreFrom, qid);
      setSheetLaborDisplayMapSafe(restoreFrom, 'quoteSwitchLayout:restoreCache');
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H13-immediateSwitch',
        location: 'JobFinancials.tsx:quoteSwitchLayout:restoreCache',
        message: 'synchronous restore of line items cache on switch',
        data: {
          qid,
          laborTotal: restoreLabor,
          sheetKeyCount: Object.keys(restoreFrom).length,
          prefetchedLabor,
          cachedLineLabor,
          source:
            prefetchedLabor > 0 && restoreFrom === prefetchedSheetLaborByQuoteRef.current[qid]
              ? 'prefetch'
              : cachedLineLabor > 0 && restoreFrom === cachedLineItems
                ? 'cache'
                : 'live',
        },
      });
    }

    void refreshSheetSectionLineItemsForQuote(qid).then((labor) => {
      if (prevFinancialQuoteIdRef.current !== qid) return;
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H13-immediateSwitch',
        location: 'JobFinancials.tsx:quoteSwitchLayout:refresh',
        message: 'layout refresh of sheet section line items',
        data: { qid, labor },
      });
    });
  }, [quote?.id]);

  /** Direct DB fetch — section labor on legacy DBs lives in custom_financial_row_items keyed by sheet_id. */
  async function prefetchSheetLineItemsForQuote(quoteId: string): Promise<Record<string, CustomRowLineItem[]>> {
    const { data: wbRows } = await supabase
      .from('material_workbooks')
      .select('id, status, version_number')
      .eq('quote_id', quoteId);
    const wbs = (wbRows || []) as { id?: string; status?: string; version_number?: number }[];
    const wbIds = wbs.map((w) => w.id).filter(Boolean) as string[];
    if (wbIds.length === 0) return {};

    const hasLocked = wbs.some((w) => w.status === 'locked');
    const hasWorking = wbs.some((w) => w.status === 'working');
    let primaryWbId = '';
    if (hasLocked && hasWorking) {
      primaryWbId =
        wbs
          .filter((w) => w.status === 'locked')
          .sort((a, b) => (Number(b.version_number) || 0) - (Number(a.version_number) || 0))[0]?.id ?? '';
    } else if (hasWorking) {
      primaryWbId =
        wbs
          .filter((w) => w.status === 'working')
          .sort((a, b) => (Number(b.version_number) || 0) - (Number(a.version_number) || 0))[0]?.id ?? '';
    } else {
      primaryWbId =
        wbs
          .filter((w) => w.status === 'locked')
          .sort((a, b) => (Number(b.version_number) || 0) - (Number(a.version_number) || 0))[0]?.id ??
        wbs[0]?.id ??
        '';
    }

    const { data: sheetRows } = await supabase
      .from('material_sheets')
      .select('id, sheet_name, order_index, workbook_id')
      .in('workbook_id', wbIds)
      .order('order_index');
    const allSheets = sheetRows || [];
    const sheetIds = allSheets.map((s: { id?: string }) => String(s?.id ?? '').trim()).filter(Boolean);
    if (sheetIds.length === 0) return {};

    const sheetIdToName = new Map<string, string>();
    const metaPatch: Record<string, string> = {};
    allSheets.forEach((s: any) => {
      const id = String(s?.id ?? '').trim();
      const name = String(s?.sheet_name ?? '');
      if (id) {
        sheetIdToName.set(id, name);
        metaPatch[id] = name;
      }
    });
    if (Object.keys(metaPatch).length > 0) {
      sheetMetaByIdRef.current = { ...sheetMetaByIdRef.current, ...metaPatch };
      setSheetMetaById((prev) => ({ ...prev, ...metaPatch }));
    }

    const displayedSheets: LaborSheetRef[] = allSheets
      .filter((s: any) => String(s?.workbook_id ?? '').trim() === String(primaryWbId).trim())
      .map((s: any) => ({
        id: String(s.id),
        sheet_name: s.sheet_name,
        order_index: s.order_index,
      }));

    const { data: items, error } = await supabase
      .from('custom_financial_row_items')
      .select('*')
      .in('sheet_id', sheetIds)
      .is('row_id', null)
      .order('order_index');
    if (error) {
      console.error('prefetchSheetLineItemsForQuote:', error);
      return {};
    }
    const rawMap: Record<string, CustomRowLineItem[]> = {};
    (items || []).forEach((item: CustomRowLineItem) => {
      const sid = String(item.sheet_id ?? '').trim();
      if (!sid) return;
      if (!rawMap[sid]) rawMap[sid] = [];
      rawMap[sid].push(item);
    });
    const rekeyed = rekeySheetLineItemsToDisplayedSheets(rawMap, displayedSheets, sheetIdToName);
    const rawLabor = laborTotalFromLineItemsMap(rawMap);
    const rekeyedLabor = laborTotalFromLineItemsMap(rekeyed);
    const result = rekeyedLabor > 0 ? rekeyed : rawLabor > 0 ? rawMap : rekeyed;
    agentDebugLog({
      runId: 'post-fix',
      hypothesisId: 'H14-rekey',
      location: 'JobFinancials.tsx:prefetchSheetLineItemsForQuote',
      message: 'prefetch rekeyed sheet line items onto displayed workbook',
      data: {
        quoteId,
        primaryWbId,
        rawKeyCount: Object.keys(rawMap).length,
        rekeyedKeyCount: Object.keys(rekeyed).length,
        rawLabor,
        rekeyedLabor,
        resultLabor: laborTotalFromLineItemsMap(result),
        displayedSheetIds: displayedSheets.map((s) => s.id),
      },
    });
    if (laborTotalFromLineItemsMap(result) > 0) {
      storeSheetLaborForQuote(quoteId, result);
    }
    return result;
  }

  /** Sole loader for sheet-linked labor line items — bypasses loadCustomRows remapping. */
  async function refreshSheetSectionLineItemsForQuote(
    targetQuoteId: string,
    cooperativeGen?: number,
  ): Promise<number> {
    if (customRowsApplyAbortReason(targetQuoteId, cooperativeGen)) {
      return resolvedSheetLineItemLaborForQuote(targetQuoteId);
    }
    const prefetched = await prefetchSheetLineItemsForQuote(targetQuoteId);
    if (customRowsApplyAbortReason(targetQuoteId, cooperativeGen)) {
      return resolvedSheetLineItemLaborForQuote(targetQuoteId);
    }
    const labor = laborTotalFromLineItemsMap(prefetched);
    const existing = resolvedSheetLineItemLaborForQuote(targetQuoteId);
    const stored = prefetchedSheetLaborByQuoteRef.current[targetQuoteId];
    const storedLabor = stored ? laborTotalFromLineItemsMap(stored) : 0;
    if (labor <= 0 && storedLabor > 0) {
      applySheetSectionLineItems(stored!, targetQuoteId);
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H31-breakdownSync',
        location: 'JobFinancials.tsx:refreshSheetSectionLineItems:useStoredPrefetch',
        message: 'live prefetch empty — restored from stored DB snapshot for quote',
        data: { targetQuoteId, storedLabor, cooperativeGen },
      });
      return storedLabor;
    }
    if (labor <= 0 && existing > 0) {
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H31-rejectCrossProposalKeep',
        location: 'JobFinancials.tsx:refreshSheetSectionLineItems:rejectKeepExisting',
        message: 'prefetch empty and no stored snapshot — not keeping cross-proposal live state',
        data: { targetQuoteId, existing, storedLabor, cooperativeGen },
      });
      return storedLabor;
    }
    if (labor > 0) {
      applySheetSectionLineItems(prefetched, targetQuoteId);
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H22-dedicatedSheetLoad',
        location: 'JobFinancials.tsx:refreshSheetSectionLineItems:applied',
        message: 'applied sheet section line items from dedicated prefetch loader',
        data: {
          targetQuoteId,
          labor,
          sheetKeyCount: Object.keys(prefetched).length,
          cooperativeGen,
        },
      });
      return labor;
    }
    return existing;
  }

  // Single load path for proposal switches: runs after clear-on-switch effect, never races navigate handlers.
  const financialLoadForQuoteRef = useRef<string | null>(null);
  useEffect(() => {
    if (!quote?.id) return;
    if (materialsPanelActive && !materialsWorkbookReady) {
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H3-workbook',
        location: 'JobFinancials.tsx:quoteEffect:deferUntilMaterialsReady',
        message: 'defer loadData until materials panel finishes loadWorkbook',
        data: {
          quoteId: quote.id,
          proposalNumber: (quote as any)?.proposal_number ?? null,
          materialsSyncGen,
        },
      });
      return;
    }
    if (
      materialsPanelActive &&
      lastFinancialLoadSyncGenRef.current === materialsSyncGen &&
      financialLoadForQuoteRef.current === quote.id
    ) {
      return;
    }
    const qid = quote.id;
    const prev = prevFinancialQuoteIdRef.current;
    if (prev && prev !== qid && laborMapTotal(sheetLaborLiveRef.current) > 0) {
      sheetLaborByQuoteRef.current[prev] = { ...sheetLaborLiveRef.current };
    }
    if (prev && prev !== qid) {
      const best = pickBestSheetLaborForQuote(prev);
      if (best && laborTotalFromLineItemsMap(best) > 0) {
        saveQuoteLineItemsCache(prev, best);
      }
    }
    prevFinancialQuoteIdRef.current = qid;
    lastExternalLaborWbRef.current = null;

    const cachedLineItems = customRowLineItemsByQuoteRef.current[qid];
    const cachedLineLabor = cachedLineItems ? laborTotalFromLineItemsMap(cachedLineItems) : 0;
    const prefetchedLabor = laborTotalFromLineItemsMap(
      prefetchedSheetLaborByQuoteRef.current[qid] ?? {},
    );
    const restoreFrom = pickBestSheetLaborForQuote(qid);
    const restoreLabor = restoreFrom ? laborTotalFromLineItemsMap(restoreFrom) : 0;
    if (restoreFrom && restoreLabor > 0) {
      if (
        cachedLineLabor > 0 &&
        restoreLabor >= cachedLineLabor &&
        restoreFrom !== cachedLineItems
      ) {
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H38-quoteEffectCacheOverwrite',
          location: 'JobFinancials.tsx:quoteSwitch:restoreLineItemsCache',
          message: 'quote effect restore preferred prefetch/live over stale per-quote cache',
          data: {
            qid,
            restoreLabor,
            cachedLineLabor,
            prefetchedLabor,
            restoreKeys: Object.keys(restoreFrom),
            cacheKeys: Object.keys(cachedLineItems ?? {}),
          },
        });
      }
      commitSheetLineItemsState(restoreFrom, qid);
      setSheetLaborDisplayMapSafe(restoreFrom, 'quoteSwitch:restoreLineItemsCache');
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H9-sheetLineItems',
        location: 'JobFinancials.tsx:quoteSwitch:restoreLineItemsCache',
        message: 'restored sheet line items from best snapshot (prefetch > cache)',
        data: {
          qid,
          sheetKeyCount: Object.keys(restoreFrom).length,
          laborTotal: restoreLabor,
          cachedLineLabor,
          prefetchedLabor,
        },
      });
    } else if (cachedLineItems && cachedLineLabor > 0) {
      commitSheetLineItemsState(cachedLineItems, qid);
      setSheetLaborDisplayMapSafe(cachedLineItems, 'quoteSwitch:restoreLineItemsCacheFallback');
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H9-sheetLineItems',
        location: 'JobFinancials.tsx:quoteSwitch:restoreLineItemsCache',
        message: 'restored customRowLineItems from per-quote cache',
        data: {
          qid,
          sheetKeyCount: Object.keys(cachedLineItems).length,
          laborTotal: cachedLineLabor,
        },
      });
    }

    const cached = sheetLaborByQuoteRef.current[qid];
    const cachedByName = sheetLaborByNameByQuoteRef.current[qid];
    const displaySheetRefs = materialSheets.map((s: any) => ({
      id: String(s?.id ?? ''),
      sheet_name: s?.sheet_name,
      order_index: s?.order_index,
    }));
    const displayIds = new Set(displaySheetRefs.map((s) => String(s.id).trim()).filter(Boolean));
    const cacheKeyOverlap =
      cached &&
      Object.keys(cached).some((k) => displayIds.has(String(k).trim()));
    const remappedCache =
      cached && laborMapTotal(cached) > 0 && displaySheetRefs.length > 0
        ? remapLaborPayloadToDisplayedSheets(displaySheetRefs, cached, cachedByName)
        : null;
    if (remappedCache && laborMapTotal(remappedCache) > 0 && (cacheKeyOverlap || laborMapTotal(cachedByName ?? {}) > 0)) {
      setSheetLabor({ ...remappedCache });
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H6-cache-keys',
        location: 'JobFinancials.tsx:quoteSwitch:restoreCache',
        message: 'restored sheetLabor from per-quote cache (remapped to displayed sheets)',
        data: {
          qid,
          cacheKeyCount: Object.keys(cached ?? {}).length,
          cacheTotal: laborMapTotal(cached ?? {}),
          remappedKeyCount: Object.keys(remappedCache).length,
          remappedTotal: laborMapTotal(remappedCache),
          cacheKeyOverlap,
        },
      });
    } else {
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H4-double-load',
        location: 'JobFinancials.tsx:quoteSwitch:noCache',
        message: 'no per-quote labor cache — keeping prior sheetLabor until loadMaterialsData completes',
        data: { qid },
      });
    }

    financialLoadForQuoteRef.current = qid;
    if (materialsPanelActive) {
      lastFinancialLoadSyncGenRef.current = materialsSyncGen;
    }
    void (async () => {
      await waitForProposalSwitchGate();
      const refreshedLabor = await refreshSheetSectionLineItemsForQuote(qid);
      if (prevFinancialQuoteIdRef.current !== qid) return;
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H22-dedicatedSheetLoad',
        location: 'JobFinancials.tsx:quoteSwitch:preLoadRefresh',
        message: 'awaited sheet section refresh before loadData',
        data: { qid, refreshedLabor, cachedLineLabor },
      });
      if (prevFinancialQuoteIdRef.current !== qid) return;
      await loadData(true, quote);
      if (financialLoadForQuoteRef.current === qid) setInitialDataLoaded(true);
    })();
  }, [quote?.id, materialsPanelActive, materialsWorkbookReady, materialsSyncGen]);

  // Always DB-fetch sheet labor for the active quote once breakdown sheet ids are known.
  useEffect(() => {
    const qid = quote?.id;
    if (!qid) {
      setSheetLaborDisplayMap({});
      return;
    }
    const breakdownIds = (materialsBreakdown?.sheetBreakdowns || [])
      .map((s: any) => String(s?.sheetId ?? '').trim())
      .filter(Boolean);
    if (breakdownIds.length === 0) return;

    let cancelled = false;
    void (async () => {
      await waitForProposalSwitchGate();
      if (cancelled || quote?.id !== qid) return;

      let map = prefetchedSheetLaborByQuoteRef.current[qid];
      let labor = map ? laborTotalFromLineItemsMap(map) : 0;
      if (labor <= 0) {
        map = await prefetchSheetLineItemsForQuote(qid);
        labor = laborTotalFromLineItemsMap(map);
      }
      if (labor <= 0 || cancelled || quote?.id !== qid) {
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H32-prefetchMiss',
          location: 'JobFinancials.tsx:sheetLaborDisplayEffect',
          message: 'DB prefetch returned zero sheet labor for quote',
          data: { qid, breakdownIds },
        });
        return;
      }

      const nativeMap = JSON.parse(JSON.stringify(map)) as Record<string, CustomRowLineItem[]>;
      const nativeLabor = laborTotalFromLineItemsMap(nativeMap);
      if (nativeLabor <= 0 || cancelled || quote?.id !== qid) return;

      setSheetLaborDisplayMapSafe(nativeMap, 'sheetLaborDisplayEffect');
      commitSheetLineItemsState(nativeMap, qid);
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H32-sheetLaborState',
        location: 'JobFinancials.tsx:sheetLaborDisplayEffect',
        message: 'set sheetLaborDisplayMap from DB prefetch (native keys)',
        data: { qid, nativeLabor, sheetKeys: Object.keys(nativeMap), breakdownIds },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [quote?.id, materialsBreakdown?.sheetBreakdowns, materialsSyncGen]);

  /** Notify parent + local quote atomically so Materials resets before loadData runs. */
  async function commitProposalSwitch(nextQuote: { id: string }) {
    const runSwitch = async () => {
    const leavingId = quote?.id ?? null;
    const nextId = nextQuote.id;

    const metaPatch: Record<string, string> = {};
    materialSheets.forEach((s: any) => {
      const id = String(s?.id ?? '').trim();
      if (id) metaPatch[id] = String(s?.sheet_name ?? '');
    });
    if (Object.keys(metaPatch).length > 0) {
      sheetMetaByIdRef.current = { ...sheetMetaByIdRef.current, ...metaPatch };
      setSheetMetaById((prev) => ({ ...prev, ...metaPatch }));
    }

    if (leavingId && leavingId !== nextId) {
      const leavingPrefetched = await prefetchSheetLineItemsForQuote(leavingId);
      const leavingPrefetchedLabor = laborTotalFromLineItemsMap(leavingPrefetched);
      const best = pickBestLineItemsMap([
        leavingPrefetchedLabor > 0 ? leavingPrefetched : null,
        sheetSectionLineItemsLiveRef.current,
        customRowLineItemsLiveRef.current,
        customRowLineItemsByQuoteRef.current[leavingId],
      ]);
      const bestLabor = best ? laborTotalFromLineItemsMap(best) : 0;
      if (best && bestLabor > 0) {
        if (leavingPrefetchedLabor <= 0) {
          storeSheetLaborForQuote(leavingId, best);
        }
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H28-leavingDbSnapshot',
          location: 'JobFinancials.tsx:commitProposalSwitch:saveLeaving',
          message: 'saved leaving proposal sheet labor before navigate',
          data: {
            leavingId,
            nextId,
            bestLabor,
            leavingPrefetchedLabor,
            source: leavingPrefetchedLabor > 0 ? 'dbPrefetch' : 'liveOrCache',
          },
        });
      }
    }

    userSelectedQuoteIdRef.current = nextId;
    lastNotifiedQuoteIdRef.current = nextId;

    const prefetched = await prefetchSheetLineItemsForQuote(nextId);
    const prefetchedLabor = laborTotalFromLineItemsMap(prefetched);
    const cached = customRowLineItemsByQuoteRef.current[nextId];
    const cachedLabor = cached ? laborTotalFromLineItemsMap(cached) : 0;
    const storedPrefetched = prefetchedSheetLaborByQuoteRef.current[nextId];
    const storedPrefetchedLabor = storedPrefetched ? laborTotalFromLineItemsMap(storedPrefetched) : 0;
    agentDebugLog({
      runId: 'post-fix',
      hypothesisId: 'H25-prefetchBeforeSwitch',
      location: 'JobFinancials.tsx:commitProposalSwitch:prefetch',
      message: 'awaited DB prefetch of sheet labor before materials reset',
      data: { nextId, prefetchedLabor, cachedLabor, storedPrefetchedLabor, prefetchedKeys: Object.keys(prefetched) },
    });

    onQuoteChange?.(nextId);
    setQuote(nextQuote as any);

    const restoreMap =
      pickBestLineItemsMap([
        prefetchedLabor > 0 ? prefetched : null,
        storedPrefetchedLabor > 0 ? storedPrefetched : null,
        cachedLabor > 0 ? cached : null,
      ]);
    if (restoreMap && laborTotalFromLineItemsMap(restoreMap) > 0) {
      const nativeRestore = JSON.parse(JSON.stringify(restoreMap)) as Record<string, CustomRowLineItem[]>;
      const staleRekeyLabor = laborTotalFromLineItemsMap(
        rekeySheetLaborOntoBreakdown(JSON.parse(JSON.stringify(restoreMap))),
      );
      setSheetLaborDisplayMapSafe(nativeRestore, 'commitProposalSwitch:restoreTarget');
      commitSheetLineItemsState(nativeRestore, nextId);
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H24-syncNavigateSave',
        location: 'JobFinancials.tsx:commitProposalSwitch:restoreTarget',
        message: 'restored sheet line items after quote state commit (native keys)',
        data: {
          nextId,
          labor: laborTotalFromLineItemsMap(nativeRestore),
          staleRekeyLabor,
          sheetKeyCount: Object.keys(nativeRestore).length,
          source:
            prefetchedLabor > 0
              ? 'prefetch'
              : storedPrefetchedLabor > 0
                ? 'storedPrefetch'
                : 'cache',
        },
      });
    }
    };
    const gate = runSwitch();
    proposalSwitchGateRef.current = gate;
    try {
      await gate;
    } finally {
      if (proposalSwitchGateRef.current === gate) {
        proposalSwitchGateRef.current = null;
      }
    }
  }

  // Materials panel syncs workbook after proposal switch; reload labor when it arrives (initial load often runs with ext view null).
  useEffect(() => {
    if (!quote?.id) return;
    const wbId = externalMaterialsWorkbookView?.workbookId;
    const status = externalMaterialsWorkbookView?.status;
    if (!wbId || (status !== 'locked' && status !== 'working')) return;
    const wbIdStr = String(wbId).trim();
    const last = lastExternalLaborWbRef.current;
    if (last?.quoteId === quote.id && last.wbId === wbIdStr) return;
    if (financialLoadInFlightRef.current) {
      pendingMaterialsWorkbookReloadRef.current = true;
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H3-workbook',
        location: 'JobFinancials.tsx:externalWbSync:deferred',
        message: 'external locked workbook arrived during loadData — defer reload',
        data: { quoteId: quote.id, wbId: wbIdStr },
      });
      return;
    }
    lastExternalLaborWbRef.current = { quoteId: quote.id, wbId: wbIdStr };
    agentDebugLog({
      runId: 'post-fix',
      hypothesisId: 'H9-sheetLineItems',
      location: 'JobFinancials.tsx:externalWbSync:reload',
      message: 'external workbook synced — reload materials + sheet line items',
      data: { quoteId: quote.id, wbId: wbIdStr },
    });
    const syncGen = financialLoadCoopGenRef.current;
    void (async () => {
      await loadMaterialsData(quote.id, false, undefined, syncGen);
      if (!isFinancialLoadStale(syncGen)) {
        await loadCustomRows(quote.id, false, syncGen);
        await refreshSheetSectionLineItemsForQuote(quote.id, syncGen);
      }
    })();
  }, [quote?.id, externalMaterialsWorkbookView?.workbookId, externalMaterialsWorkbookView?.status]);

  // Load proposal versions when quote changes
  useEffect(() => {
    if (quote) {
      loadProposalVersions();
    } else {
      setProposalVersions([]);
    }
  }, [quote?.id]);

  // Sync building description from current quote only (quotes.description) — each proposal has its own
  useEffect(() => {
    setBuildingDescription((quote as any)?.description ?? '');
  }, [quote?.id, (quote as any)?.description]);

  // Sync tax exempt from quote when quote loads (persists after refresh: loadQuoteData merges tax_exempt from API or get_job_quotes_tax_exempt RPC)
  useEffect(() => {
    if (quote == null) {
      setTaxExemptChecked(false);
      setTaxExemptSaved(false);
      return;
    }
    const taxExempt = (quote as any).tax_exempt;
    setTaxExemptChecked(taxExempt === true);
    // Value was loaded from DB → it is saved
    setTaxExemptSaved(taxExempt === true);
  }, [quote?.id, (quote as any)?.tax_exempt]);

  // Keep optional sheet overlay scoped to the active quote.
  useEffect(() => {
    setOptionalSheetOverlay({});
  }, [quote?.id]);

  // Clear line-item / row state when switching proposals (materials breakdown is replaced by loadMaterialsData).
  // Do NOT clear sheetLabor here — loadData may already be in flight from the click handler; wiping labor
  // after loadMaterialsData completes is what makes labor vanish on P2 after P1→P2 navigation.
  useEffect(() => {
    // #region agent log
    agentDebugLog({
      runId: 'post-fix',
      hypothesisId: 'H1-clear',
      location: 'JobFinancials.tsx:clearOnQuoteSwitch',
      message: 'clearing row state on quote change (sheetLabor preserved until loadMaterialsData)',
      data: { quoteId: quote?.id ?? null, proposalNumber: (quote as any)?.proposal_number ?? null },
    });
    // #endregion
    savingMarkupsRef.current.clear();
    setCategoryMarkups({});
    setCustomRows([]);
    setSubcontractorEstimates([]);
    setSubcontractorLineItems({});
    setLinkedSubcontractors({});
  }, [quote?.id]);
  useEffect(() => {
    const scopeId = quote?.id ? `quote:${quote.id}` : `job:${job.id}`;
    setOptionalSubOverlay(readSubOptionalStorage(scopeId));
  }, [quote?.id, job.id]);

  // Real-time broadcast: sync tax exempt across all users who have this job open
  useEffect(() => {
    if (!job?.id) return;
    const channel = supabase
      .channel(`job-tax-exempt-${job.id}`)
      .on('broadcast', { event: 'tax_exempt' }, ({ payload }) => {
        const val: boolean = !!payload.value;
        setTaxExemptChecked(val);
        setTaxExemptSaved(true);
        setQuote((prev) => prev ? { ...prev, tax_exempt: val } : prev);
        setAllJobQuotes((prev) =>
          val
            ? prev.map((q: any) => ({ ...q, tax_exempt: true }))
            : prev.map((q: any) => q.id === payload.quote_id ? { ...q, tax_exempt: false } : q),
        );
      })
      .subscribe();
    taxExemptChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      taxExemptChannelRef.current = null;
    };
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  quoteIdForSubsRef.current = quote?.id ?? null;

  // Realtime: refetch subcontractor estimates when they change (e.g. "Add to proposal" from Subcontractors tab)
  useEffect(() => {
    if (!job?.id) return;
    const channel = supabase
      .channel(`job-subs-${job.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subcontractor_estimates', filter: `job_id=eq.${job.id}` }, () => {
        loadSubcontractorEstimates(quoteIdForSubsRef.current ?? undefined, false);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent when proposal changes (for combined Proposal+Materials view).
  useEffect(() => {
    const id = quote?.id ?? null;
    if (id !== lastNotifiedQuoteIdRef.current) {
      lastNotifiedQuoteIdRef.current = id;
      onQuoteChange?.(id);
    }
  }, [quote?.id, onQuoteChange]);

  // When parent controls quote
  // Guard with lastSyncedControlledIdRef so we only full-reload when the parent *changes* the selection,
  // not when allJobQuotes first populates after mount (which would double-load on every open).
  useEffect(() => {
    if (controlledQuoteId === undefined) return;
    if (!controlledQuoteId) {
      if (quote !== null) setQuote(null);
      lastSyncedControlledIdRef.current = controlledQuoteId;
      return;
    }
    const match = allJobQuotes.find((q) => q.id === controlledQuoteId);

    // Same proposal id as last parent sync: normally skip, but recover if local quote state desynced
    if (controlledQuoteId === lastSyncedControlledIdRef.current) {
      if (match && quote?.id !== match.id) {
        // Local quote already updated (e.g. "New Proposal" just created) but parent controlledQuoteId
        // has not re-rendered yet — do not revert to the previous proposal.
        if (quote != null && quote.id !== controlledQuoteId) {
          return;
        }
        userSelectedQuoteIdRef.current = match.id;
        setQuote(match);
      }
      return;
    }

    if (match && quote?.id !== match.id) {
      lastSyncedControlledIdRef.current = controlledQuoteId;
      userSelectedQuoteIdRef.current = match.id;
      // #region agent log
      fetch('http://127.0.0.1:7264/ingest/38c719fd-41f2-436e-b178-2936be94ecc3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'458a80'},body:JSON.stringify({sessionId:'458a80',runId:'post-fix',hypothesisId:'H4-double-load',location:'JobFinancials.tsx:controlledQuoteSync',message:'controlled quote switch (load via quote effect)',data:{fromQuoteId:quote?.id??null,toQuoteId:controlledQuoteId,proposalNumber:(match as any)?.proposal_number??null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setQuote(match);
    } else if (match && quote?.id === match.id) {
      lastSyncedControlledIdRef.current = controlledQuoteId;
    } else if (allJobQuotes.length === 0) {
      userSelectedQuoteIdRef.current = controlledQuoteId;
      lastSyncedControlledIdRef.current = controlledQuoteId;
    } else {
      lastSyncedControlledIdRef.current = controlledQuoteId;
      userSelectedQuoteIdRef.current = controlledQuoteId;
      let cancelled = false;
      supabase
        .from('quotes')
        .select('*')
        .eq('id', controlledQuoteId)
        .eq('job_id', job.id)
        .single()
        .then(({ data: fetched, error }) => {
          if (cancelled || error || !fetched) return;
          setAllJobQuotes((prev: any[]) => {
            if (prev.some((q: any) => q.id === fetched.id)) return prev;
            return [fetched, ...prev];
          });
          setQuote(fetched);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [controlledQuoteId, allJobQuotes.length, job.id]);

  useEffect(() => {
    if (!estimateCatalogViewOpen || !quote?.id) return;
    void loadCustomerEstimateLines(quote.id);
    // loadCustomerEstimateLines is stable (function declaration).
  }, [estimateCatalogViewOpen, quote?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the materials workbook saves a change, refresh materials (and thus proposal totals) in real time.
  // Registered once (dep = job.id only); reads fresh values from workbookUpdateCtxRef to avoid stale closures.
  useEffect(() => {
    const handler = (e: Event) => {
      const { jobId, quoteId } = (e as CustomEvent).detail ?? {};
      const ctx = workbookUpdateCtxRef.current;
      if (jobId != null && jobId !== ctx.jobId) return;
      if (quoteId != null && ctx.quoteId != null && quoteId !== ctx.quoteId) return;
      if (financialLoadInFlightRef.current) {
        pendingMaterialsWorkbookReloadRef.current = true;
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H3-workbook',
          location: 'JobFinancials.tsx:materialsWorkbookUpdated:deferred',
          message: 'materials-workbook-updated deferred — loadData in flight',
          data: { jobId, quoteId: quoteId ?? ctx.quoteId },
        });
        return;
      }
      const isHist = !!ctx.quoteId
        && ctx.allJobQuotesFirstId != null
        && ctx.quoteId !== ctx.allJobQuotesFirstId
        && ctx.quoteId !== ctx.historicalUnlockedQuoteId;
      ctx.loadMaterialsData(ctx.quoteId, isHist, undefined, financialLoadCoopGenRef.current);
      void ctx.loadSubcontractorEstimates(ctx.quoteId, isHist);
    };
    window.addEventListener('materials-workbook-updated', handler as EventListener);
    return () => window.removeEventListener('materials-workbook-updated', handler as EventListener);
  }, [job.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-create first proposal (with -1 suffix) for new jobs
  useEffect(() => {
    if (!loading && !quote) {
      // Small delay to ensure all data is loaded
      const timer = setTimeout(() => {
        autoCreateFirstProposal();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [loading, quote]);

  // This effect has been replaced by the simpler loading-based auto-create above

  async function initializeVersioning() {
    if (!quote) return;
    
    setInitializingVersions(true);
    try {
      console.log('🚀 Initializing versioning system for quote:', quote.id);
      
      // Create initial snapshot using Edge Function
      const { data, error } = await supabase.functions.invoke('create-proposal-version', {
        body: { quoteId: quote.id }
      });
      
      if (error) throw error;
      
      toast.success('Version 1 created successfully!');
      await loadProposalVersions();
    } catch (error: any) {
      console.error('Error initializing versioning:', error);
      toast.error('Failed to initialize versioning: ' + error.message);
    } finally {
      setInitializingVersions(false);
    }
  }

  async function loadProposalVersions() {
    if (!quote) return;
    
    try {
      const { data, error } = await supabase
        .from('proposal_versions')
        .select('*')
        .eq('quote_id', quote.id)
        .order('version_number', { ascending: false });
      
      if (error) throw error;
      setProposalVersions(data || []);
    } catch (error: any) {
      console.error('Error loading proposal versions:', error);
    }
  }

  async function createNewProposalVersion() {
    setCreatingVersion(true);
    try {
      // Build change notes
      let changeNotes = versionChangeNotes.trim();
      if (viewingProposalNumber !== null) {
        const baseNote = `Based on version ${viewingProposalNumber}`;
        changeNotes = changeNotes ? `${baseNote}. ${changeNotes}` : baseNote;
      }
      
      // Call database function with either quote_id OR job_id
      // If no quote exists, the function will create one automatically
      const { data, error } = await supabase.rpc('create_proposal_version', {
        p_quote_id: quote?.id || null,
        p_job_id: quote ? null : job.id,
        p_user_id: profile?.id || null,
        p_change_notes: changeNotes || null,
      });
      
      if (error) throw error;
      
      console.log('✅ Version created:', data);
      
      toast.success('Proposal version created successfully!');
      
      // If we just created the first quote/version, reload quote data
      if (!quote) {
        await loadQuoteData();
      }
      
      // Reset state and reload
      setShowCreateVersionDialog(false);
      setVersionChangeNotes('');
      setViewingProposalNumber(null);
      await loadProposalVersions();
    } catch (error: any) {
      console.error('Error creating proposal version:', error);
      toast.error('Failed to create version: ' + error.message);
    } finally {
      setCreatingVersion(false);
    }
  }

  async function signAndLockVersion(versionId: string) {
    if (!confirm('Sign and lock this version? This cannot be undone.')) return;
    
    try {
      const { error } = await supabase
        .from('proposal_versions')
        .update({
          is_signed: true,
          signed_at: new Date().toISOString(),
          signed_by: profile?.id
        })
        .eq('id', versionId);
      
      if (error) throw error;
      
      // Update quote to mark this version as signed
      const version = proposalVersions.find(v => v.id === versionId);
      if (version) {
        await supabase
          .from('quotes')
          .update({ signed_version: version.version_number })
          .eq('id', quote.id);
      }
      
      toast.success('Version signed and locked!');
      await loadProposalVersions();
      await loadQuoteData();
    } catch (error: any) {
      console.error('Error signing version:', error);
      toast.error('Failed to sign version');
    }
  }

  /** Build workbook + financial + sub snapshots from live DB for a quote (for proposal_versions rows). */
  async function buildLiveProposalSnapshotsForQuote(quoteId: string): Promise<{
    workbook_snapshot: Record<string, unknown> | null;
    financial_rows_snapshot: any[] | null;
    subcontractor_snapshot: any[] | null;
  }> {
    const { data: workbooksFull, error: wbFetchErr } = await fetchMaterialWorkbooksFullForQuote(quoteId);
    if (wbFetchErr) {
      console.warn('buildLiveProposalSnapshotsForQuote: workbook fetch', wbFetchErr);
    }
    const snapshotSheets: any[] = [];
    const snapshotCategoryMarkups: Record<string, number> = {};
    const snapshotSheetLabor: any[] = [];
    for (const wb of workbooksFull || []) {
      const oldSheets = ((wb as any).material_sheets || [])
        .slice()
        .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
      for (const sheet of oldSheets) {
        const items = (sheet.material_items || [])
          .slice()
          .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
        snapshotSheets.push({
          id: sheet.id,
          sheet_name: sheet.sheet_name,
          order_index: sheet.order_index,
          is_option: sheet.is_option,
          description: sheet.description,
          sheet_type: sheet.sheet_type ?? 'proposal',
          change_order_seq: sheet.change_order_seq ?? null,
          category_order: sheet.category_order ?? null,
          compare_to_sheet_id: sheet.compare_to_sheet_id ?? null,
          items,
        });
        (sheet.material_category_markups || []).forEach((m: any) => {
          snapshotCategoryMarkups[`${sheet.id}_${m.category_name}`] = m.markup_percent;
        });
        const labor = sheet.material_sheet_labor || [];
        labor.forEach((l: any) => snapshotSheetLabor.push({ ...l, sheet_id: sheet.id }));
      }
    }
    const workbook_snapshot =
      snapshotSheets.length > 0
        ? { sheets: snapshotSheets, category_markups: snapshotCategoryMarkups, sheet_labor: snapshotSheetLabor }
        : null;

    const { data: oldRows } = await supabase
      .from('custom_financial_rows')
      .select('*')
      .eq('quote_id', quoteId)
      .order('order_index');
    const snapshotFinancialRows: any[] = [];
    for (const row of oldRows || []) {
      const { data: rItems } = await supabase
        .from('custom_financial_row_items')
        .select('*')
        .eq('row_id', row.id)
        .order('order_index');
      snapshotFinancialRows.push({ ...row, line_items: rItems || [] });
    }
    const financial_rows_snapshot = snapshotFinancialRows.length > 0 ? snapshotFinancialRows : null;

    const { data: oldEstimates } = await supabase
      .from('subcontractor_estimates')
      .select('*')
      .eq('quote_id', quoteId)
      .order('order_index');
    const snapshotSubcontractors: any[] = [];
    for (const est of oldEstimates || []) {
      const { data: sItems } = await supabase
        .from('subcontractor_estimate_line_items')
        .select('*')
        .eq('estimate_id', est.id)
        .order('order_index');
      const { id: _eid, job_id: _jid, quote_id: _qid, created_at: _ca, updated_at: _ua, ...estRest } = est as any;
      snapshotSubcontractors.push({ ...estRest, id: est.id, line_items: sItems || [] });
    }
    const subcontractor_snapshot = snapshotSubcontractors.length > 0 ? snapshotSubcontractors : null;

    return { workbook_snapshot, financial_rows_snapshot, subcontractor_snapshot };
  }

  /** Set the active (current) proposal as contract. Creates a lightweight version row if none exist. */
  async function setActiveProposalAsContract() {
    if (!quote || (quote as any).signed_version) return;
    if (!confirm('Set this proposal as the contract? This will create a signed version that cannot be changed.')) return;
    try {
      // Always read from DB — UI list can be empty after load errors; avoids misusing create_proposal_version
      // (that RPC clones the whole proposal to a new quote and often times out → "Failed to fetch").
      const { data: dbVersions, error: verLoadErr } = await supabase
        .from('proposal_versions')
        .select('*')
        .eq('quote_id', quote.id)
        .order('version_number', { ascending: false });
      if (verLoadErr) throw verLoadErr;
      const versions = dbVersions || [];

      let versionToSign: any =
        versions.find((v: any) => v.version_number === (quote as any).current_version) ?? versions[0];

      if (!versionToSign) {
        const maxVer = versions.reduce((m, v) => Math.max(m, Number((v as any).version_number) || 0), 0);
        const nextVer = maxVer + 1;
        const q = quote as any;
        const snaps = await buildLiveProposalSnapshotsForQuote(quote.id);
        const { error: insErr } = await supabase.from('proposal_versions').insert({
          quote_id: quote.id,
          version_number: nextVer,
          customer_name: q.customer_name ?? null,
          customer_address: q.customer_address ?? null,
          customer_email: q.customer_email ?? null,
          customer_phone: q.customer_phone ?? null,
          project_name: q.project_name ?? null,
          width: q.width ?? 0,
          length: q.length ?? 0,
          estimated_price: q.estimated_price ?? null,
          workbook_snapshot: snaps.workbook_snapshot,
          financial_rows_snapshot: snaps.financial_rows_snapshot,
          subcontractor_snapshot: snaps.subcontractor_snapshot,
          change_notes: 'Set as contract',
          created_by: profile?.id ?? null,
        });
        if (insErr) throw insErr;
        const { data: created, error: fetchErr } = await supabase
          .from('proposal_versions')
          .select('*')
          .eq('quote_id', quote.id)
          .eq('version_number', nextVer)
          .maybeSingle();
        if (fetchErr) throw fetchErr;
        versionToSign = created;
      }

      if (!versionToSign) {
        toast.error('No version to sign');
        return;
      }
      const { error: signErr } = await supabase
        .from('proposal_versions')
        .update({ is_signed: true, signed_at: new Date().toISOString(), signed_by: profile?.id })
        .eq('id', versionToSign.id);
      if (signErr) throw signErr;
      const { error: quoteErr } = await supabase
        .from('quotes')
        .update({ signed_version: versionToSign.version_number })
        .eq('id', quote.id);
      if (quoteErr) throw quoteErr;

      // After setting contract snapshot workbook(s) to `locked` (proposal price), duplicate into a NEW `working` row
      // for shop/COS/job tracking only — JobFinancials continues to read the locked row for proposal totals.
      const ensureWorkingSnapshotFromLocked = async (quoteId: string) => {
        if (!profile?.id || !job?.id) return;

        const { data: wbStatuses, error: wbListErr } = await supabase
          .from('material_workbooks')
          .select('id, status')
          .eq('quote_id', quoteId);
        if (wbListErr) {
          console.warn('ensureWorkingSnapshotFromLocked list:', wbListErr);
          return;
        }
        const list = wbStatuses || [];
        const hasLocked = list.some((w: any) => w?.status === 'locked');
        const hasWorking = list.some((w: any) => w?.status === 'working');
        if (!hasLocked || hasWorking) return;

        const { data: lockedFull, error: lockedFetchErr } = await fetchMaterialWorkbooksFullForQuote(quoteId);
        if (lockedFetchErr) {
          console.warn('ensureWorkingSnapshotFromLocked fetch:', lockedFetchErr);
          return;
        }
        const lockedWorkbooks = (lockedFull || []).filter((w: any) => (w as any)?.status === 'locked');
        if (lockedWorkbooks.length === 0) return;

        const { data: maxWbRow } = await supabase
          .from('material_workbooks')
          .select('version_number')
          .eq('job_id', job.id)
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        let nextWbVersion = (maxWbRow?.version_number ?? 0) + 1;

        for (const wb of lockedWorkbooks) {
          const {
            id: _oldWbId,
            quote_id: _oldWbQuote,
            created_at: _wbCreated,
            updated_at: _wbUpdated,
            material_sheets: nestedSheets,
            ...workbookRest
          } = wb as Record<string, unknown> & { material_sheets?: unknown };

          let wbInsertPayload: Record<string, unknown> = {
            ...workbookRest,
            job_id: job.id,
            quote_id: quoteId,
            version_number: nextWbVersion++,
            status: 'working',
            created_by: profile.id,
            locked_at: null,
            locked_by: null,
          };
          let { data: newWb, error: wbErr } = await supabase
            .from('material_workbooks')
            .insert(wbInsertPayload as never)
            .select('id')
            .single();
          for (let attempt = 0; wbErr && attempt < 4; attempt++) {
            const msg = wbErr.message ?? '';
            let next: Record<string, unknown> | null = null;
            if (msg.includes('locked_at') && 'locked_at' in wbInsertPayload) {
              const { locked_at: _d, ...r } = wbInsertPayload;
              next = r;
            } else if (msg.includes('locked_by') && 'locked_by' in wbInsertPayload) {
              const { locked_by: _d, ...r } = wbInsertPayload;
              next = r;
            }
            if (!next) break;
            wbInsertPayload = next;
            const retry = await supabase
              .from('material_workbooks')
              .insert(wbInsertPayload as never)
              .select('id')
              .single();
            newWb = retry.data;
            wbErr = retry.error;
          }
          if (wbErr || !newWb?.id) {
            console.warn('ensureWorkingSnapshotFromLocked insert workbook:', wbErr);
            continue;
          }

          const sheetIdMap: Record<string, string> = {};
          const oldSheets = ((nestedSheets as any[]) || [])
            .slice()
            .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
          for (const sheet of oldSheets) {
            const sheetInsertBase: Record<string, unknown> = {
              workbook_id: newWb.id,
              sheet_name: sheet.sheet_name,
              order_index: sheet.order_index,
              is_option: sheet.is_option,
              description: sheet.description,
              sheet_type: sheet.sheet_type ?? 'proposal',
              change_order_seq: sheet.change_order_seq ?? null,
              category_order: sheet.category_order ?? null,
              compare_to_sheet_id: null,
            };
            let sheetInsertPayload: Record<string, unknown> = { ...sheetInsertBase };
            let { data: newSheet, error: shErr } = await supabase
              .from('material_sheets')
              .insert(sheetInsertPayload as never)
              .select('id')
              .single();
            for (let attempt = 0; shErr && attempt < 6; attempt++) {
              const msg = shErr.message ?? '';
              let next: Record<string, unknown> | null = null;
              if (msg.includes('change_order_seq') && 'change_order_seq' in sheetInsertPayload) {
                const { change_order_seq: _d, ...r } = sheetInsertPayload;
                next = r;
              } else if (msg.includes('category_order') && 'category_order' in sheetInsertPayload) {
                const { category_order: _d, ...r } = sheetInsertPayload;
                next = r;
              } else if (msg.includes('compare_to_sheet_id') && 'compare_to_sheet_id' in sheetInsertPayload) {
                const { compare_to_sheet_id: _d, ...r } = sheetInsertPayload;
                next = r;
              } else if (msg.includes('sheet_type') && 'sheet_type' in sheetInsertPayload) {
                const { sheet_type: _d, ...r } = sheetInsertPayload;
                next = r;
              }
              if (!next) break;
              sheetInsertPayload = next;
              const retry = await supabase
                .from('material_sheets')
                .insert(sheetInsertPayload as never)
                .select('id')
                .single();
              newSheet = retry.data;
              shErr = retry.error;
            }
            if (shErr || !newSheet?.id) {
              console.warn('ensureWorkingSnapshotFromLocked insert sheet:', shErr);
              continue;
            }
            sheetIdMap[String(sheet.id)] = newSheet.id;

            const items = (sheet.material_items || [])
              .slice()
              .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
            if (items.length) {
              const { error: iErr } = await supabase.from('material_items').insert(
                items.map(({ id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...r }: any) => ({
                  ...r,
                  sheet_id: newSheet.id,
                }))
              );
              if (iErr) console.warn('ensureWorkingSnapshotFromLocked insert items:', iErr);
            }

            const labor = sheet.material_sheet_labor || [];
            if (labor.length) {
              const { error: lErr } = await supabase.from('material_sheet_labor').insert(
                labor.map(({ id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...r }: any) => ({
                  ...r,
                  sheet_id: newSheet.id,
                }))
              );
              if (lErr) console.warn('ensureWorkingSnapshotFromLocked insert labor:', lErr);
            }

            const markups = sheet.material_category_markups || [];
            if (markups.length) {
              const { error: mErr } = await supabase.from('material_category_markups').insert(
                markups.map(({ id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...r }: any) => ({
                  ...r,
                  sheet_id: newSheet.id,
                }))
              );
              if (mErr) console.warn('ensureWorkingSnapshotFromLocked insert markups:', mErr);
            }
          }

          // Second pass: restore compare_to_sheet_id links within the cloned workbook.
          for (const sheet of oldSheets) {
            const newSid = sheetIdMap[String(sheet.id)];
            const oldCmp = sheet.compare_to_sheet_id;
            if (newSid && oldCmp && sheetIdMap[String(oldCmp)]) {
              const { error: cmpErr } = await supabase
                .from('material_sheets')
                .update({ compare_to_sheet_id: sheetIdMap[String(oldCmp)] })
                .eq('id', newSid);
              if (cmpErr) console.warn('ensureWorkingSnapshotFromLocked compare_to_sheet_id:', cmpErr.message);
            }
          }
        }
      };

      // Freeze materials workbook for this quote (status only — no sheet/item rows modified)
      const { error: wbLockErr } = await supabase
        .from('material_workbooks')
        .update({ status: 'locked', updated_at: new Date().toISOString() })
        .eq('quote_id', quote.id)
        .eq('status', 'working');
      if (wbLockErr) console.warn('Could not lock workbook after contract:', wbLockErr);
      await ensureWorkingSnapshotFromLocked(quote.id);
      if (job?.id) {
        window.dispatchEvent(
          new CustomEvent('materials-workbook-updated', { detail: { jobId: job.id, quoteId: quote.id } })
        );
      }
      toast.success('Version signed and locked!');
      await loadProposalVersions();
      await loadQuoteData();
    } catch (error: any) {
      console.error('Error setting as contract:', error);
      const msg = error?.message ?? String(error);
      if (msg === 'Failed to fetch' || /failed to fetch/i.test(msg) || error?.name === 'TypeError') {
        toast.error(
          'Could not reach the server (network timeout or offline). If you use “Create version” elsewhere, try creating a version first, then set as contract again.'
        );
      } else {
        toast.error(msg || 'Failed to set as contract');
      }
    }
  }

  /** After revoking contract only: clear office lock flag and restore latest workbook. Does not clear sent_at (send is permanent). */
  async function finalizeQuoteRevokeUnlock(quoteId: string) {
    try {
      await supabase
        .from('quotes')
        .update({
          locked_for_editing: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', quoteId);

      // Two-workbook model: keep the locked row as `locked` (proposal-price snapshot). Never flip it to `working`
      // just because it has a higher version_number — that would collapse snapshot + editable copy into one row.
      const { data: wbRows } = await supabase
        .from('material_workbooks')
        .select('id, version_number, status')
        .eq('quote_id', quoteId);
      const list = wbRows || [];
      const lockedRows = list.filter((w: any) => w.status === 'locked');
      const workingRows = list.filter((w: any) => w.status === 'working');
      if (lockedRows.length > 0 && workingRows.length > 0) {
        // Pair already exists: leave locked snapshot untouched; working copy stays editable.
        return;
      }
      const onlyLocked =
        lockedRows.length > 0 && workingRows.length === 0
          ? lockedRows.sort((a: any, b: any) => (b.version_number ?? 0) - (a.version_number ?? 0))[0]
          : null;
      if (onlyLocked?.id) {
        await supabase
          .from('material_workbooks')
          .update({ status: 'working', updated_at: new Date().toISOString() })
          .eq('id', onlyLocked.id);
      }
    } catch (e) {
      console.warn('finalizeQuoteRevokeUnlock:', e);
    }
  }

  /** Revoke contract (only with customer consent – confirmed in dialog). */
  async function revokeQuoteContract() {
    if (!quote) return;
    const hasCustomerSignature = !!(quote as any).customer_signed_at;
    const msg = hasCustomerSignature
      ? 'Only revoke with the customer\'s consent. Have you obtained the customer\'s consent to revoke this contract? This will clear the signed contract (not “Mark as sent” — that date stays) and allow editing again.'
      : 'Revoke this contract? This will clear the signed version and allow the proposal and materials to be edited again. “Mark as sent” is not undone.';
    if (!confirm(msg)) return;
    try {
      const { data, error } = await supabase.rpc('revoke_quote_contract', { p_quote_id: quote.id });
      const result = data as { ok?: boolean; error?: string } | null;
      const rpcMissing =
        !!error &&
        /could not find|function .* does not exist|schema cache/i.test(String(error.message || ''));

      if (error && !rpcMissing) throw error;

      if (result?.ok || rpcMissing) {
        if (rpcMissing) {
          console.warn('revoke_quote_contract RPC missing; applying client-side revoke');
          await supabase
            .from('quotes')
            .update({
              customer_signed_at: null,
              customer_signed_name: null,
              customer_signed_email: null,
              signed_version: null,
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', quote.id);
          await supabase
            .from('proposal_versions')
            .update({ is_signed: false, signed_at: null, signed_by: null })
            .eq('quote_id', quote.id);
        }

        await finalizeQuoteRevokeUnlock(quote.id);

        if (job?.id) {
          window.dispatchEvent(
            new CustomEvent('materials-workbook-updated', { detail: { jobId: job.id, quoteId: quote.id } })
          );
        }
        toast.success('Contract revoked. Proposal and materials can be edited again.');
        await loadProposalVersions();
        await loadQuoteData();
        await loadData(true);
      } else {
        toast.error(result?.error ?? 'Failed to revoke contract');
      }
    } catch (error: any) {
      console.error('Error revoking contract:', error);
      toast.error(error?.message ?? 'Failed to revoke contract');
    }
  }

  async function markProposalAsSent() {
    if (!quote || !profile) return;
    if ((quote as any).sent_at) {
      toast.info((quote as any).is_change_order_proposal ? 'This change order is already marked as sent.' : 'This proposal is already marked as sent.');
      return;
    }
    const isCo = !!(quote as any).is_change_order_proposal;
    if (isCo && !jobHasContract) {
      toast.error('Set the main proposal as contract (Set as Contract) before sending change orders to the customer.');
      return;
    }
    if (!confirm(isCo
      ? 'Send this change order to the customer? The date and time will be recorded (permanent). This will lock the proposal + materials workbook (read-only) until you unlock it or it becomes a signed contract.'
      : 'Record that this proposal was sent to the customer? The date and time will be saved permanently and cannot be cleared by “Revoke contract”. This will lock the proposal + materials workbook (read-only) until you unlock it or it becomes a signed contract.')) return;

    const onSuccess = async () => {
      toast.success(isCo ? 'Change order marked as sent. Customer can sign under Change orders in the portal.' : 'Proposal marked as sent. Date and time recorded.');
      await loadQuoteData();
      await loadData(true);
    };

    try {
      const { error: quoteErr } = await supabase
        .from('quotes')
        .update({
          sent_at: new Date().toISOString(),
          sent_by: profile.id,
          locked_for_editing: true,
        } as any)
        .eq('id', quote.id);

      if (!quoteErr) {
        // Sent => lock workbook (single-workbook model; no copy until signed contract)
        const { error: wbErr } = await supabase
          .from('material_workbooks')
          .update({ status: 'locked', updated_at: new Date().toISOString() })
          .eq('quote_id', quote.id)
          .eq('status', 'working');
        if (wbErr) console.warn('markProposalAsSent workbook lock:', wbErr.message);
        await onSuccess();
        return;
      }

      // Fallback: Edge Function (service role) locks sent + workbook atomically when RPC exists.
      const { data: fnRes, error: fnErr } = await supabase.functions.invoke('mark-proposal-as-sent', {
        body: { quote_id: quote.id, user_id: profile.id },
      });
      if (!fnErr && (fnRes as any)?.ok) {
        await onSuccess();
        return;
      }

      const manualSql = `-- Run in Supabase Dashboard → SQL Editor → New query → Paste → Run
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sent_at timestamptz, ADD COLUMN IF NOT EXISTS sent_by uuid;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS locked_for_editing boolean DEFAULT false;
UPDATE quotes SET sent_at = now(), sent_by = '${profile.id}', locked_for_editing = true WHERE id = '${quote.id}';
UPDATE material_workbooks SET status = 'locked', updated_at = now() WHERE quote_id = '${quote.id}' AND status = 'working';`;
      setMarkAsSentManualSql(manualSql);
      setShowMarkAsSentManualDialog(true);
      toast.error('Update failed. Copy the SQL from the dialog and run it in Supabase SQL Editor, then refresh.');
    } catch (error: any) {
      console.error('Error marking proposal as sent:', error);
      const manualSql = `-- Run in Supabase Dashboard → SQL Editor → New query → Paste → Run
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sent_at timestamptz, ADD COLUMN IF NOT EXISTS sent_by uuid;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS locked_for_editing boolean DEFAULT false;
UPDATE quotes SET sent_at = now(), sent_by = '${profile.id}', locked_for_editing = true WHERE id = '${quote.id}';
UPDATE material_workbooks SET status = 'locked', updated_at = now() WHERE quote_id = '${quote.id}' AND status = 'working';`;
      setMarkAsSentManualSql(manualSql);
      setShowMarkAsSentManualDialog(true);
      toast.error(error?.message || 'Mark as sent failed. Use the dialog to run the SQL manually.');
    }
  }

  /** Set sent_at on the change-order quote (same as toolbar “Send change order”; locks proposal + workbook). */
  async function sendChangeOrderProposalToCustomer() {
    if (!profile?.id) {
      toast.error('You must be signed in.');
      return;
    }
    if (isReadOnly) {
      toast.error('Open the current proposal view to send change orders.');
      return;
    }
    if (!jobHasContract) {
      toast.error('Set the main proposal as contract before sending change orders to the customer.');
      return;
    }
    const coQuote = allJobQuotes.find((q: any) => q.is_change_order_proposal);
    if (!coQuote) {
      toast.error('No change order proposal exists for this job yet.');
      return;
    }
    if (coQuote.sent_at) {
      toast.info('Change orders were already sent to the customer.');
      return;
    }
    if (
      !confirm(
        'Send all change orders to the customer now? The send date is recorded permanently. They can review and sign each section under Change orders in the customer portal. Workbooks stay editable until signed as a contract.'
      )
    ) {
      return;
    }

    const coQuoteId = coQuote.id;
    setSendingCoToCustomer(true);
    const onSuccess = async () => {
      toast.success('Change orders sent to the customer. They can sign in the portal under Change orders.');
      userSelectedQuoteIdRef.current = coQuoteId;
      onQuoteChange?.(coQuoteId);
      await loadQuoteData();
      await loadData(true);
    };

    try {
      const { error: quoteErr } = await supabase
        .from('quotes')
        .update({ sent_at: new Date().toISOString(), sent_by: profile.id, locked_for_editing: true } as any)
        .eq('id', coQuoteId);

      if (!quoteErr) {
        const { error: wbErr } = await supabase
          .from('material_workbooks')
          .update({ status: 'locked', updated_at: new Date().toISOString() })
          .eq('quote_id', coQuoteId)
          .eq('status', 'working');
        if (wbErr) console.warn('sendChangeOrderProposalToCustomer workbook lock:', wbErr.message);
        await onSuccess();
        return;
      }

      const manualSql = `-- Run in Supabase Dashboard → SQL Editor → New query → Paste → Run
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sent_at timestamptz, ADD COLUMN IF NOT EXISTS sent_by uuid;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS locked_for_editing boolean DEFAULT false;
UPDATE quotes SET sent_at = now(), sent_by = '${profile.id}', locked_for_editing = true WHERE id = '${coQuoteId}';
UPDATE material_workbooks SET status = 'locked', updated_at = now() WHERE quote_id = '${coQuoteId}' AND status = 'working';`;
      setMarkAsSentManualSql(manualSql);
      setShowMarkAsSentManualDialog(true);
      toast.error('Update failed. Copy the SQL from the dialog and run it in Supabase SQL Editor, then refresh.');
    } catch (error: any) {
      console.error('Error sending change orders:', error);
      const manualSql = `-- Run in Supabase Dashboard → SQL Editor → New query → Paste → Run
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sent_at timestamptz, ADD COLUMN IF NOT EXISTS sent_by uuid;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS locked_for_editing boolean DEFAULT false;
UPDATE quotes SET sent_at = now(), sent_by = '${profile.id}', locked_for_editing = true WHERE id = '${coQuoteId}';
UPDATE material_workbooks SET status = 'locked', updated_at = now() WHERE quote_id = '${coQuoteId}' AND status = 'working';`;
      setMarkAsSentManualSql(manualSql);
      setShowMarkAsSentManualDialog(true);
      toast.error(error?.message || 'Send failed. Use the dialog to run the SQL manually.');
    } finally {
      setSendingCoToCustomer(false);
    }
  }

  async function restoreJob26007FromSnapshot(quoteId: string) {
    const { data: version, error: verError } = await supabase
      .from('proposal_versions')
      .select('workbook_snapshot, financial_rows_snapshot, subcontractor_snapshot')
      .eq('quote_id', quoteId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (verError || !version) return;
    const hasWorkbook = version.workbook_snapshot && (version.workbook_snapshot as any).sheets?.length;
    const hasRows = Array.isArray(version.financial_rows_snapshot) && version.financial_rows_snapshot.length > 0;
    const hasSubs = Array.isArray(version.subcontractor_snapshot) && version.subcontractor_snapshot.length > 0;
    if (!hasWorkbook && !hasRows && !hasSubs) return;

    const wbSnapshot = version.workbook_snapshot as any;
    const rowsSnapshot = Array.isArray(version.financial_rows_snapshot) ? version.financial_rows_snapshot : [];
    const subsSnapshot = Array.isArray(version.subcontractor_snapshot) ? version.subcontractor_snapshot : [];

    const { data: existingRows } = await supabase.from('custom_financial_rows').select('id').eq('quote_id', quoteId);
    const rowIds = (existingRows || []).map((r: any) => r.id);
    if (rowIds.length > 0) {
      await supabase.from('custom_financial_row_items').delete().in('row_id', rowIds);
      await supabase.from('custom_financial_rows').delete().eq('quote_id', quoteId);
    }

    const { data: existingWbs } = await supabase.from('material_workbooks').select('id').eq('quote_id', quoteId);
    for (const wb of existingWbs || []) {
      const { data: sheets } = await supabase.from('material_sheets').select('id').eq('workbook_id', wb.id);
      for (const sh of sheets || []) {
        await supabase.from('material_items').delete().eq('sheet_id', sh.id);
        await supabase.from('material_sheet_labor').delete().eq('sheet_id', sh.id);
        await supabase.from('material_category_markups').delete().eq('sheet_id', sh.id);
      }
      if (sheets?.length) await supabase.from('material_sheets').delete().eq('workbook_id', wb.id);
    }
    if (existingWbs?.length) await supabase.from('material_workbooks').delete().eq('quote_id', quoteId);

    const { data: existingEsts } = await supabase.from('subcontractor_estimates').select('id').eq('quote_id', quoteId);
    const estIds = (existingEsts || []).map((e: any) => e.id);
    if (estIds.length > 0) {
      await supabase.from('subcontractor_estimate_line_items').delete().in('estimate_id', estIds);
      await supabase.from('subcontractor_estimates').delete().eq('quote_id', quoteId);
    }

    const sheetIdMap: Record<string, string> = {};
    const rowIdMap: Record<string, string> = {};

    if (wbSnapshot?.sheets?.length && profile?.id) {
      const { data: maxWb } = await supabase.from('material_workbooks').select('version_number').eq('job_id', job.id).order('version_number', { ascending: false }).limit(1).maybeSingle();
      const nextVer = (maxWb?.version_number ?? 0) + 1;
      const { data: newWb, error: wbErr } = await supabase.from('material_workbooks').insert({
        job_id: job.id, quote_id: quoteId, version_number: nextVer, status: 'working', created_by: profile.id,
      }).select('id').single();
      if (wbErr || !newWb) return;
      const sheets = (wbSnapshot.sheets || []).slice().sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
      for (const sh of sheets) {
        const { data: newSheet, error: shErr } = await supabase.from('material_sheets').insert({
          workbook_id: newWb.id,
          sheet_name: sh.sheet_name ?? 'Sheet',
          order_index: sh.order_index ?? 0,
          is_option: toBool(sh.is_option),
          description: sh.description ?? null,
          sheet_type: sh.sheet_type ?? 'proposal',
          change_order_seq: sh.change_order_seq ?? null,
          category_order: sh.category_order ?? null,
          compare_to_sheet_id: null,
        }).select('id').single();
        if (shErr || !newSheet) continue;
        sheetIdMap[sh.id] = newSheet.id;
        const items = (sh.items || []).slice().sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
        if (items.length) {
          await supabase.from('material_items').insert(items.map(({ id: _i, sheet_id: _s, created_at: _c, updated_at: _u, ...r }: any) => ({ ...r, sheet_id: newSheet.id })));
        }
      }
      for (const sh of sheets) {
        const newSid = sheetIdMap[sh.id];
        const oldCmp = sh.compare_to_sheet_id;
        if (newSid && oldCmp && sheetIdMap[oldCmp]) {
          await supabase.from('material_sheets').update({ compare_to_sheet_id: sheetIdMap[oldCmp] }).eq('id', newSid);
        }
      }
      const catMarkups = wbSnapshot.category_markups || {};
      for (const [key, pct] of Object.entries(catMarkups)) {
        const underscoreIdx = key.indexOf('_');
        const oldSheetId = underscoreIdx >= 0 ? key.slice(0, underscoreIdx) : key;
        const categoryName = underscoreIdx >= 0 ? key.slice(underscoreIdx + 1) : '';
        const newSheetId = sheetIdMap[oldSheetId];
        if (newSheetId != null && categoryName) {
          await supabase.from('material_category_markups').insert({ sheet_id: newSheetId, category_name: categoryName, markup_percent: Number(pct) });
        }
      }
      const sheetLabor = wbSnapshot.sheet_labor || [];
      for (const labor of sheetLabor) {
        const newSheetId = sheetIdMap[labor.sheet_id];
        if (newSheetId) {
          const { id: _i, sheet_id: _s, created_at: _c, updated_at: _u, ...r } = labor;
          await supabase.from('material_sheet_labor').insert({ ...r, sheet_id: newSheetId });
        }
      }
    }

    for (const row of rowsSnapshot) {
      const { id: _id, created_at: _c, updated_at: _u, line_items: lineItems, ...rowRest } = row;
      const newSheetId = row.sheet_id ? sheetIdMap[row.sheet_id] ?? null : null;
      const { data: newRow, error: rErr } = await supabase.from('custom_financial_rows').insert({
        job_id: job.id, quote_id: quoteId, ...rowRest, sheet_id: newSheetId,
      }).select('id').single();
      if (rErr || !newRow) continue;
      rowIdMap[row.id] = newRow.id;
      const items = row.line_items || [];
      if (items.length) {
        await supabase.from('custom_financial_row_items').insert(items.map(({ id: _i, row_id: _r, sheet_id: oldSid, created_at: _c2, updated_at: _u2, ...r }: any) => ({
          ...r, row_id: newRow.id, sheet_id: oldSid ? (sheetIdMap[oldSid] ?? null) : null,
        })));
      }
    }

    const sheetLinkedItems = rowsSnapshot.flatMap((r: any) => (r.line_items || []).filter((li: any) => li.sheet_id && !li.row_id));
    for (const item of sheetLinkedItems) {
      const newSheetId = item.sheet_id ? sheetIdMap[item.sheet_id] : null;
      if (newSheetId) {
        const { id: _i, row_id: _r, sheet_id: _s, created_at: _c, updated_at: _u, ...r } = item;
        await supabase.from('custom_financial_row_items').insert({ ...r, row_id: null, sheet_id: newSheetId });
      }
    }

    for (const est of subsSnapshot) {
      const { id: _i, line_items: lineItems, ...estRest } = est;
      const newSheetId = est.sheet_id ? sheetIdMap[est.sheet_id] ?? null : null;
      const newRowId = est.row_id ? rowIdMap[est.row_id] ?? null : null;
      const { data: newEst, error: eErr } = await supabase.from('subcontractor_estimates').insert({
        job_id: job.id, quote_id: quoteId, ...estRest, sheet_id: newSheetId, row_id: newRowId,
      }).select('id').single();
      if (eErr || !newEst) continue;
      const items = est.line_items || [];
      if (items.length) {
        await supabase.from('subcontractor_estimate_line_items').insert(items.map(({ id: _i2, estimate_id: _e, created_at: _c, updated_at: _u, ...r }: any) => ({ ...r, estimate_id: newEst.id })));
      }
    }

    toast.success('Proposal data for job #26007 restored from snapshot.');
  }

  /** Restores workbook + financial rows + subs from a proposal_versions row into the given quote. DELETES existing data for that quote. Only call after explicit user confirmation (e.g. "Restore from snapshot" dialog). */
  async function restoreSnapshotIntoQuote(versionRow: any, targetQuoteId: string) {
    const wbSnapshot = versionRow.workbook_snapshot as any;
    const rowsSnapshot = Array.isArray(versionRow.financial_rows_snapshot) ? versionRow.financial_rows_snapshot : [];
    const subsSnapshot = Array.isArray(versionRow.subcontractor_snapshot) ? versionRow.subcontractor_snapshot : [];
    if (!profile?.id) return;

    const { data: existingRows } = await supabase.from('custom_financial_rows').select('id').eq('quote_id', targetQuoteId);
    const rowIds = (existingRows || []).map((r: any) => r.id);
    if (rowIds.length > 0) {
      await supabase.from('custom_financial_row_items').delete().in('row_id', rowIds);
      await supabase.from('custom_financial_rows').delete().eq('quote_id', targetQuoteId);
    }
    const { data: existingWbs } = await supabase.from('material_workbooks').select('id').eq('quote_id', targetQuoteId);
    for (const wb of existingWbs || []) {
      const { data: sheets } = await supabase.from('material_sheets').select('id').eq('workbook_id', wb.id);
      for (const sh of sheets || []) {
        await supabase.from('material_items').delete().eq('sheet_id', sh.id);
        await supabase.from('material_sheet_labor').delete().eq('sheet_id', sh.id);
        await supabase.from('material_category_markups').delete().eq('sheet_id', sh.id);
      }
      if (sheets?.length) await supabase.from('material_sheets').delete().eq('workbook_id', wb.id);
    }
    if (existingWbs?.length) await supabase.from('material_workbooks').delete().eq('quote_id', targetQuoteId);
    const { data: existingEsts } = await supabase.from('subcontractor_estimates').select('id').eq('quote_id', targetQuoteId);
    const estIds = (existingEsts || []).map((e: any) => e.id);
    if (estIds.length > 0) {
      await supabase.from('subcontractor_estimate_line_items').delete().in('estimate_id', estIds);
      await supabase.from('subcontractor_estimates').delete().eq('quote_id', targetQuoteId);
    }

    const sheetIdMap: Record<string, string> = {};
    const rowIdMap: Record<string, string> = {};

    if (wbSnapshot?.sheets?.length) {
      const { data: maxWb } = await supabase.from('material_workbooks').select('version_number').eq('job_id', job.id).order('version_number', { ascending: false }).limit(1).maybeSingle();
      const nextVer = (maxWb?.version_number ?? 0) + 1;
      const { data: newWb, error: wbErr } = await supabase.from('material_workbooks').insert({
        job_id: job.id, quote_id: targetQuoteId, version_number: nextVer, status: 'working', created_by: profile.id,
      }).select('id').single();
      if (!wbErr && newWb) {
        const sheets = (wbSnapshot.sheets || []).slice().sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
        for (const sh of sheets) {
          const { data: newSheet, error: shErr } = await supabase.from('material_sheets').insert({
            workbook_id: newWb.id,
            sheet_name: sh.sheet_name ?? 'Sheet',
            order_index: sh.order_index ?? 0,
            is_option: toBool(sh.is_option),
            description: sh.description ?? null,
            sheet_type: sh.sheet_type ?? 'proposal',
            change_order_seq: sh.change_order_seq ?? null,
            category_order: sh.category_order ?? null,
            compare_to_sheet_id: null,
          }).select('id').single();
          if (shErr || !newSheet) continue;
          sheetIdMap[sh.id] = newSheet.id;
          const items = (sh.items || []).slice().sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
          if (items.length) await supabase.from('material_items').insert(items.map(({ id: _i, sheet_id: _s, created_at: _c, updated_at: _u, ...r }: any) => ({ ...r, sheet_id: newSheet.id })));
        }
        for (const sh of sheets) {
          const newSid = sheetIdMap[sh.id];
          const oldCmp = sh.compare_to_sheet_id;
          if (newSid && oldCmp && sheetIdMap[oldCmp]) {
            await supabase.from('material_sheets').update({ compare_to_sheet_id: sheetIdMap[oldCmp] }).eq('id', newSid);
          }
        }
        const catMarkups = wbSnapshot.category_markups || {};
        for (const [key, pct] of Object.entries(catMarkups)) {
          const idx = key.indexOf('_');
          const oldSheetId = idx >= 0 ? key.slice(0, idx) : key;
          const categoryName = idx >= 0 ? key.slice(idx + 1) : '';
          const newSheetId = sheetIdMap[oldSheetId];
          if (newSheetId != null && categoryName) await supabase.from('material_category_markups').insert({ sheet_id: newSheetId, category_name: categoryName, markup_percent: Number(pct) });
        }
        const sheetLabor = wbSnapshot.sheet_labor || [];
        for (const labor of sheetLabor) {
          const newSheetId = sheetIdMap[labor.sheet_id];
          if (newSheetId) {
            const { id: _i, sheet_id: _s, created_at: _c, updated_at: _u, ...r } = labor;
            await supabase.from('material_sheet_labor').insert({ ...r, sheet_id: newSheetId });
          }
        }
      }
    }

    for (const row of rowsSnapshot) {
      const { id: _id, created_at: _c, updated_at: _u, line_items: lineItems, ...rowRest } = row;
      const newSheetId = row.sheet_id ? sheetIdMap[row.sheet_id] ?? null : null;
      const { data: newRow, error: rErr } = await supabase.from('custom_financial_rows').insert({
        job_id: job.id, quote_id: targetQuoteId, ...rowRest, sheet_id: newSheetId,
      }).select('id').single();
      if (rErr || !newRow) continue;
      rowIdMap[row.id] = newRow.id;
      const items = row.line_items || [];
      if (items.length) await supabase.from('custom_financial_row_items').insert(items.map(({ id: _i, row_id: _r, sheet_id: oldSid, created_at: _c2, updated_at: _u2, ...r }: any) => ({ ...r, row_id: newRow.id, sheet_id: oldSid ? (sheetIdMap[oldSid] ?? null) : null })));
    }
    const sheetLinkedItems = rowsSnapshot.flatMap((r: any) => (r.line_items || []).filter((li: any) => li.sheet_id && !li.row_id));
    for (const item of sheetLinkedItems) {
      const newSheetId = item.sheet_id ? sheetIdMap[item.sheet_id] : null;
      if (newSheetId) {
        const { id: _i, row_id: _r, sheet_id: _s, created_at: _c, updated_at: _u, ...r } = item;
        await supabase.from('custom_financial_row_items').insert({ ...r, row_id: null, sheet_id: newSheetId });
      }
    }
    for (const est of subsSnapshot) {
      const { id: _i, line_items: lineItems, ...estRest } = est;
      const newSheetId = est.sheet_id ? sheetIdMap[est.sheet_id] ?? null : null;
      const newRowId = est.row_id ? rowIdMap[est.row_id] ?? null : null;
      const { data: newEst, error: eErr } = await supabase.from('subcontractor_estimates').insert({
        job_id: job.id, quote_id: targetQuoteId, ...estRest, sheet_id: newSheetId, row_id: newRowId,
      }).select('id').single();
      if (eErr || !newEst) continue;
      const items = est.line_items || [];
      if (items.length) await supabase.from('subcontractor_estimate_line_items').insert(items.map(({ id: _i2, estimate_id: _e, created_at: _c, updated_at: _u, ...r }: any) => ({ ...r, estimate_id: newEst.id })));
    }
  }

  /** Restore materials (and proposal data) for the current quote from the latest saved proposal snapshot for this job. */
  async function restoreMaterialsFromSnapshot() {
    if (!quote) {
      toast.error('Select or create a proposal first.');
      return;
    }
    if (!profile?.id) {
      toast.error('You must be signed in to restore.');
      return;
    }
    try {
      const { data: jobQuotes } = await supabase.from('quotes').select('id').eq('job_id', job.id);
      const quoteIds = (jobQuotes || []).map((q: any) => q.id);
      if (quoteIds.length === 0) {
        toast.error('No proposals found for this job.');
        return;
      }
      const { data: pvRows, error: pvErr } = await supabase
        .from('proposal_versions')
        .select('id, quote_id, financial_rows_snapshot, workbook_snapshot, subcontractor_snapshot')
        .in('quote_id', quoteIds)
        .order('created_at', { ascending: false })
        .limit(100);
      if (pvErr) throw pvErr;
      let withData: any = null;
      for (const r of pvRows || []) {
        const hasWb = r.workbook_snapshot && (r.workbook_snapshot as any).sheets?.length > 0;
        const hasRows = Array.isArray(r.financial_rows_snapshot) && r.financial_rows_snapshot.length > 0;
        if (hasWb || hasRows) {
          withData = r;
          break;
        }
      }
      if (!withData) {
        toast.error('No saved proposal snapshot with materials or data found for this job.');
        return;
      }
      await restoreSnapshotIntoQuote(withData, quote.id);
      await loadQuoteData();
      loadData(true, quote);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('material-workbook-restored', { detail: { quoteId: quote.id } }));
      }
      toast.success('Materials and proposal data restored from a saved snapshot.');
    } catch (e: any) {
      console.error('Restore materials failed:', e);
      toast.error('Restore failed: ' + (e?.message || 'see console'));
    }
  }

  /**
   * Policy: Proposal (quotes table) rows must never be deleted. Only child data (material_workbooks,
   * custom_financial_rows, subcontractor_estimates) may be replaced when restoring/copying into an existing quote.
   */

  /** Finds material workbooks for this job whose quote_id no longer exists (orphaned), creates a new proposal row, and reassigns those workbooks to it. Use when a proposal was accidentally deleted but materials remain. */
  async function recoverMissingProposal() {
    if (!profile?.id || !job?.id) {
      toast.error('You must be signed in to recover a proposal.');
      return;
    }
    setRecoveringProposal(true);
    try {
      const { data: jobQuotes, error: qErr } = await supabase.from('quotes').select('id').eq('job_id', job.id);
      if (qErr) throw qErr;
      const quoteIds = new Set((jobQuotes || []).map((q: any) => q.id));

      const { data: workbooks, error: wbErr } = await supabase
        .from('material_workbooks')
        .select('id, quote_id')
        .eq('job_id', job.id);
      if (wbErr) throw wbErr;

      const orphaned = (workbooks || []).filter((wb: any) => wb.quote_id && !quoteIds.has(wb.quote_id));
      if (orphaned.length === 0) {
        toast.info('No missing proposal data found. All workbooks are already linked to a proposal.');
        setRecoveringProposal(false);
        return;
      }

      const { data: rpcData, error: rpcErr } = await supabase.rpc('create_proposal_version', {
        p_quote_id: null,
        p_job_id: job.id,
        p_user_id: profile.id,
        p_change_notes: 'Recovered proposal (materials were orphaned)',
      });
      if (rpcErr) throw rpcErr;
      const newQuoteId = (rpcData as any)?.quote_id;
      if (!newQuoteId) throw new Error('No quote_id returned from create_proposal_version');

      const { error: updateErr } = await supabase
        .from('material_workbooks')
        .update({ quote_id: newQuoteId, updated_at: new Date().toISOString() })
        .in('id', orphaned.map((w: any) => w.id));
      if (updateErr) throw updateErr;

      await loadQuoteData();
      const newQuote = (await supabase.from('quotes').select('*').eq('id', newQuoteId).single()).data;
      if (newQuote) {
        setQuote(newQuote);
        userSelectedQuoteIdRef.current = newQuote.id;
        await loadData(false, newQuote);
      }
      toast.success(`Recovered proposal with ${orphaned.length} workbook(s). It appears as a new proposal in the list.`);
    } catch (e: any) {
      console.error('Recover proposal failed:', e);
      toast.error('Recover failed: ' + (e?.message || 'see console'));
    } finally {
      setRecoveringProposal(false);
    }
  }

  /** Deletes a proposal (quote) and all its data. Only allowed when job has more than one proposal. */
  async function deleteProposal(
    quoteIdToDelete: string,
    options?: { skipWindowConfirm?: boolean }
  ) {
    const deleting = allJobQuotes.find((x: any) => x.id === quoteIdToDelete);
    const deletingIsEstimate = (deleting as any)?.is_customer_estimate === true;
    if (!deletingIsEstimate && formalJobQuotes.length <= 1) {
      toast.error('Cannot delete the only formal proposal. A job must have at least one proposal.');
      return;
    }
    if (deletingIsEstimate && allJobQuotes.length <= 1) {
      toast.error('Cannot delete the only quote on this job.');
      return;
    }
    const q = allJobQuotes.find((x: any) => x.id === quoteIdToDelete);
    const label = q
      ? `${(q as any).is_customer_estimate ? 'Estimate' : 'Proposal'} #${displayNumberForQuoteRow(q, !!(q as any).is_customer_estimate)}`
      : 'This proposal';
    if (
      !options?.skipWindowConfirm &&
      !confirm(
        `Delete ${label}? All materials, financial rows, and subcontractor estimates for this proposal will be permanently removed.\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    try {
      // Prefer server RPC so delete works even with RLS (migration: 20250312000000_delete_proposal_rpc.sql)
      const { data: rpcData, error: rpcError } = await supabase.rpc('delete_proposal', { p_quote_id: quoteIdToDelete });
      if (!rpcError && rpcData?.ok === true) {
        const remaining = allJobQuotes.filter((x: any) => x.id !== quoteIdToDelete);
        setAllJobQuotes(remaining);
        const switchTo = remaining[0];
        setQuote(switchTo);
        userSelectedQuoteIdRef.current = switchTo.id;
        await loadQuoteData();
        await loadData(false, switchTo);
        onQuoteChange?.(switchTo?.id ?? null);
        toast.success('Proposal deleted.');
        return;
      }
      // Fallback: client-side deletes (if RPC missing or failed, e.g. permission)
      let err: any = rpcError || null;
      if (rpcError) console.warn('delete_proposal RPC failed, trying client-side deletes:', rpcError.message);

      err = (await supabase.from('proposal_versions').delete().eq('quote_id', quoteIdToDelete)).error;
      if (err) throw err;

      const { data: existingRows } = await supabase.from('custom_financial_rows').select('id').eq('quote_id', quoteIdToDelete);
      const rowIds = (existingRows || []).map((r: any) => r.id);
      if (rowIds.length > 0) {
        err = (await supabase.from('custom_financial_row_items').delete().in('row_id', rowIds)).error;
        if (err) throw err;
        err = (await supabase.from('custom_financial_rows').delete().eq('quote_id', quoteIdToDelete)).error;
        if (err) throw err;
      }

      const { data: existingWbs } = await supabase.from('material_workbooks').select('id').eq('quote_id', quoteIdToDelete);
      const wbIds = (existingWbs || []).map((x: any) => x.id);
      if (wbIds.length > 0) {
        const { data: allSheets } = await supabase.from('material_sheets').select('id').in('workbook_id', wbIds);
        const sheetIds = (allSheets || []).map((s: any) => s.id);
        if (sheetIds.length > 0) {
          err = (await supabase.from('material_items').delete().in('sheet_id', sheetIds)).error;
          if (err) throw err;
          err = (await supabase.from('material_sheet_labor').delete().in('sheet_id', sheetIds)).error;
          if (err) throw err;
          err = (await supabase.from('material_category_markups').delete().in('sheet_id', sheetIds)).error;
          if (err) throw err;
          err = (await supabase.from('custom_financial_row_items').delete().in('sheet_id', sheetIds)).error;
          if (err) throw err;
          err = (await supabase.from('material_sheets').delete().in('workbook_id', wbIds)).error;
          if (err) throw err;
        }
        err = (await supabase.from('material_workbooks').delete().eq('quote_id', quoteIdToDelete)).error;
        if (err) throw err;
      }

      const { data: existingEsts } = await supabase.from('subcontractor_estimates').select('id').eq('quote_id', quoteIdToDelete);
      const estIds = (existingEsts || []).map((e: any) => e.id);
      if (estIds.length > 0) {
        err = (await supabase.from('subcontractor_estimate_line_items').delete().in('estimate_id', estIds)).error;
        if (err) throw err;
        err = (await supabase.from('subcontractor_estimates').delete().eq('quote_id', quoteIdToDelete)).error;
        if (err) throw err;
      }

      err = (await supabase.from('quotes').delete().eq('id', quoteIdToDelete)).error;
      if (err) throw err;

      const remaining = allJobQuotes.filter((x: any) => x.id !== quoteIdToDelete);
      setAllJobQuotes(remaining);
      const switchTo = remaining[0];
      setQuote(switchTo);
      userSelectedQuoteIdRef.current = switchTo.id;
      await loadQuoteData();
      await loadData(false, switchTo);
      onQuoteChange?.(switchTo?.id ?? null);
      toast.success('Proposal deleted.');
    } catch (e: any) {
      console.error('Delete proposal failed:', e);
      const msg = e?.message || (e?.error_description) || String(e);
      toast.error(msg.includes('policy') || msg.includes('RLS') || msg.includes('row-level')
        ? 'Permission denied. You may not have permission to delete proposals.'
        : 'Failed to delete proposal: ' + msg);
    }
  }

  /** Copies all proposal data (workbook, sheets, items, financial rows, subs) from source quote to target. DELETES existing data for target quote. Only call after explicit user confirmation. */
  async function copyProposalDataFromQuoteToQuote(
    sourceQuoteId: string,
    targetJobId: string,
    targetQuoteId: string
  ) {
    if (!profile?.id) return;
    const sheetIdMap: Record<string, string> = {};
    const oldSheetIdToNewWorkbookId: Record<string, string> = {};
    const oldSheetIdToSectionName: Record<string, string> = {};
    const rowIdMap: Record<string, string> = {};

    const { data: existingRows } = await supabase.from('custom_financial_rows').select('id').eq('quote_id', targetQuoteId);
    const rowIds = (existingRows || []).map((r: any) => r.id);
    if (rowIds.length > 0) {
      await supabase.from('custom_financial_row_items').delete().in('row_id', rowIds);
      await supabase.from('custom_financial_rows').delete().eq('quote_id', targetQuoteId);
    }
    const { data: existingWbs } = await supabase.from('material_workbooks').select('id').eq('quote_id', targetQuoteId);
    for (const wb of existingWbs || []) {
      const { data: sheets } = await supabase.from('material_sheets').select('id').eq('workbook_id', wb.id);
      for (const sh of sheets || []) {
        await supabase.from('material_items').delete().eq('sheet_id', sh.id);
        await supabase.from('material_sheet_labor').delete().eq('sheet_id', sh.id);
        await supabase.from('material_category_markups').delete().eq('sheet_id', sh.id);
      }
      if (sheets?.length) await supabase.from('material_sheets').delete().eq('workbook_id', wb.id);
    }
    if (existingWbs?.length) await supabase.from('material_workbooks').delete().eq('quote_id', targetQuoteId);
    const { data: existingEsts } = await supabase.from('subcontractor_estimates').select('id').eq('quote_id', targetQuoteId);
    const estIds = (existingEsts || []).map((e: any) => e.id);
    if (estIds.length > 0) {
      await supabase.from('subcontractor_estimate_line_items').delete().in('estimate_id', estIds);
      await supabase.from('subcontractor_estimates').delete().eq('quote_id', targetQuoteId);
    }

    const { data: oldWorkbooks } = await supabase.from('material_workbooks').select('*').eq('quote_id', sourceQuoteId);
    const { data: maxWb } = await supabase.from('material_workbooks').select('version_number').eq('job_id', targetJobId).order('version_number', { ascending: false }).limit(1).maybeSingle();
    let nextWbVersion = (maxWb?.version_number ?? 0) + 1;

    for (const wb of oldWorkbooks || []) {
      const { data: newWb, error: wbErr } = await supabase.from('material_workbooks').insert({
        job_id: targetJobId, quote_id: targetQuoteId, version_number: nextWbVersion++, status: 'working', created_by: profile.id,
      }).select('id').single();
      if (wbErr || !newWb) continue;
      const { data: oldSheets } = await supabase.from('material_sheets').select('*').eq('workbook_id', wb.id).order('order_index');
      for (const sheet of oldSheets || []) {
        const { data: newSheet, error: shErr } = await supabase.from('material_sheets').insert({
          workbook_id: newWb.id, sheet_name: sheet.sheet_name, order_index: sheet.order_index, is_option: sheet.is_option, description: sheet.description, sheet_type: sheet.sheet_type ?? 'proposal',
        }).select('id').single();
        if (shErr || !newSheet) continue;
        sheetIdMap[sheet.id] = newSheet.id;
        oldSheetIdToNewWorkbookId[sheet.id] = newWb.id;
        oldSheetIdToSectionName[sheet.id] = String(sheet.sheet_name ?? '').trim() || null;
        const { data: items } = await supabase.from('material_items').select('*').eq('sheet_id', sheet.id).order('order_index');
        if (items?.length) await supabase.from('material_items').insert(items.map(({ id: _i, sheet_id: _s, created_at: _c, updated_at: _u, ...r }: any) => ({ ...r, sheet_id: newSheet.id })));
        const { data: labor } = await supabase.from('material_sheet_labor').select('*').eq('sheet_id', sheet.id);
        if (labor?.length) await supabase.from('material_sheet_labor').insert(labor.map(({ id: _i, sheet_id: _s, created_at: _c, updated_at: _u, ...r }: any) => ({ ...r, sheet_id: newSheet.id })));
        const { data: markups } = await supabase.from('material_category_markups').select('*').eq('sheet_id', sheet.id);
        if (markups?.length) await supabase.from('material_category_markups').insert(markups.map(({ id: _i, sheet_id: _s, created_at: _c, updated_at: _u, ...r }: any) => ({ ...r, sheet_id: newSheet.id })));
      }
    }

    const { data: oldRows } = await supabase.from('custom_financial_rows').select('*').eq('quote_id', sourceQuoteId).order('order_index');
    for (const row of oldRows || []) {
      const { data: newRow, error: rErr } = await supabase.from('custom_financial_rows').insert({
        job_id: targetJobId, quote_id: targetQuoteId, category: row.category, description: row.description,
        quantity: row.quantity, unit_cost: row.unit_cost, total_cost: row.total_cost, markup_percent: row.markup_percent,
        selling_price: row.selling_price, notes: row.notes, order_index: row.order_index, taxable: row.taxable,
        sheet_id: row.sheet_id ? (sheetIdMap[row.sheet_id] ?? null) : null,
        is_option: toBool((row as any).is_option),
      }).select('id').single();
      if (rErr || !newRow) continue;
      rowIdMap[row.id] = newRow.id;
      const { data: rItems } = await supabase.from('custom_financial_row_items').select('*').eq('row_id', row.id).order('order_index');
      if (rItems?.length) {
        await supabase.from('custom_financial_row_items').insert(
          rItems.map((item) => {
            const oldSid = item.sheet_id ? String(item.sheet_id) : null;
            const newSid = oldSid ? (sheetIdMap[oldSid] ?? null) : null;
            return payloadForClonedLineItem(item as Record<string, unknown>, {
              row_id: newRow.id,
              sheet_id: newSid,
              quote_id: targetQuoteId,
              workbook_id: newSid ? (oldSheetIdToNewWorkbookId[oldSid!] ?? null) : null,
              section_name: oldSid ? (oldSheetIdToSectionName[oldSid] ?? null) : null,
            });
          }),
        );
      }
    }
    const oldSheetIdList = Object.keys(sheetIdMap);
    if (oldSheetIdList.length > 0) {
      const { data: sItems } = await supabase.from('custom_financial_row_items').select('*').in('sheet_id', oldSheetIdList).is('row_id', null);
      if (sItems?.length) {
        await supabase.from('custom_financial_row_items').insert(
          sItems.map((item) => {
            const oldSid = item.sheet_id ? String(item.sheet_id) : null;
            const newSid = oldSid ? (sheetIdMap[oldSid] ?? null) : null;
            return payloadForClonedLineItem(item as Record<string, unknown>, {
              row_id: null,
              sheet_id: newSid,
              quote_id: targetQuoteId,
              workbook_id: oldSid ? (oldSheetIdToNewWorkbookId[oldSid] ?? null) : null,
              section_name: oldSid ? (oldSheetIdToSectionName[oldSid] ?? null) : null,
            });
          }),
        );
      }
    }

    const { data: oldEstimates } = await supabase.from('subcontractor_estimates').select('*').eq('quote_id', sourceQuoteId).order('order_index');
    for (const est of oldEstimates || []) {
      const { id: _i, job_id: _j, quote_id: _q, sheet_id: es, row_id: er, created_at: _c, updated_at: _u, ...rest } = est;
      const { data: newEst, error: eErr } = await supabase.from('subcontractor_estimates').insert({
        ...rest, job_id: targetJobId, quote_id: targetQuoteId,
        sheet_id: es ? (sheetIdMap[es] ?? null) : null, row_id: er ? (rowIdMap[er] ?? null) : null,
      }).select('id').single();
      if (eErr || !newEst) continue;
      const { data: slItems } = await supabase.from('subcontractor_estimate_line_items').select('*').eq('estimate_id', est.id).order('order_index');
      if (slItems?.length) await supabase.from('subcontractor_estimate_line_items').insert(slItems.map(({ id: _i2, estimate_id: _e, created_at: _c2, updated_at: _u2, ...r }: any) => ({ ...r, estimate_id: newEst.id })));
    }

    toast.success('Materials and proposal data restored from Proposal #26019-1.');
  }

  /** Dedicated change-order quote + working workbook (same logic as MaterialsManagement). */
  async function getOrCreateChangeOrderWorkbookLocal(): Promise<{
    quoteId: string;
    workbookId: string;
    quote: {
      sent_at: string | null;
      locked_for_editing: boolean | null;
      signed_version?: unknown;
      customer_signed_at?: string | null;
    };
  }> {
    const userId = profile?.id;
    if (!userId) throw new Error('Not signed in');
    const { data: changeOrderQuotes } = await fetchChangeOrderQuoteForJob(supabase, job.id);
    let quoteId: string;
    let q: {
      sent_at: string | null;
      locked_for_editing: boolean | null;
      signed_version?: unknown;
      customer_signed_at?: string | null;
    };
    if (changeOrderQuotes?.length) {
      quoteId = String(changeOrderQuotes[0].id ?? '');
      if (!quoteId) throw new Error('Change order quote is missing an id');
      q = {
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
      q = {
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
        .insert({
          job_id: job.id,
          quote_id: quoteId,
          version_number: nextVer,
          status: 'working',
          created_by: userId,
        })
        .select('id')
        .single();
      if (wbErr || !newWb) throw new Error(wbErr?.message ?? 'Failed to create change order workbook');
      workbookId = newWb.id;
    }
    return { quoteId, workbookId, quote: q };
  }

  async function deleteSourceMaterialSheetAfterCopy(sheetId: string, mainQuoteId: string) {
    const { data: rowIdsRows } = await supabase
      .from('custom_financial_rows')
      .select('id')
      .eq('quote_id', mainQuoteId)
      .eq('sheet_id', sheetId);
    const rowIds = (rowIdsRows || []).map((r: { id: string }) => r.id);
    for (const rid of rowIds) {
      const { data: estByRow } = await supabase.from('subcontractor_estimates').select('id').eq('row_id', rid);
      for (const e of estByRow || []) {
        await supabase.from('subcontractor_estimate_line_items').delete().eq('estimate_id', e.id);
        await supabase.from('subcontractor_estimates').delete().eq('id', e.id);
      }
      await supabase.from('custom_financial_row_items').delete().eq('row_id', rid);
      await supabase.from('custom_financial_rows').delete().eq('id', rid);
    }
    const { data: estSheet } = await supabase.from('subcontractor_estimates').select('id').eq('quote_id', mainQuoteId).eq('sheet_id', sheetId);
    for (const e of estSheet || []) {
      await supabase.from('subcontractor_estimate_line_items').delete().eq('estimate_id', e.id);
      await supabase.from('subcontractor_estimates').delete().eq('id', e.id);
    }
    await supabase.from('custom_financial_row_items').delete().eq('sheet_id', sheetId).is('row_id', null);
    await supabase.from('material_category_options').delete().eq('sheet_id', sheetId);
    await supabase.from('material_items').delete().eq('sheet_id', sheetId);
    await supabase.from('material_sheet_labor').delete().eq('sheet_id', sheetId);
    await supabase.from('material_category_markups').delete().eq('sheet_id', sheetId);
    await supabase.from('material_sheets').delete().eq('id', sheetId);
  }

  async function runCopySheetToCustomerChangeOrder(sourceSheetId: string, removeFromSource: boolean) {
      const mainQuoteId = quote?.id;
      if (!job?.id || !profile?.id || !mainQuoteId) {
        toast.error('Missing job or proposal.');
        return;
      }
      if ((quote as any)?.is_change_order_proposal) {
        toast.info('Switch to the main proposal to send a section as a change order.');
        return;
      }
      if (!jobHasContract) {
        toast.error('Set the main proposal as contract before adding work as a change order.');
        return;
      }
      setCopyCoRunning(true);
      try {
        const { data: srcSheet, error: srcErr } = await supabase
          .from('material_sheets')
          .select('*')
          .eq('id', sourceSheetId)
          .single();
        if (srcErr || !srcSheet) {
          toast.error('Section not found.');
          return;
        }
        const { data: wbRow } = await supabase
          .from('material_workbooks')
          .select('quote_id')
          .eq('id', (srcSheet as any).workbook_id)
          .maybeSingle();
        if (!wbRow || wbRow.quote_id !== mainQuoteId) {
          toast.error('This section belongs to another proposal.');
          return;
        }
        if ((srcSheet as any).sheet_type === 'change_order') {
          toast.info('This section is already a change order sheet.');
          return;
        }

        const co = await getOrCreateChangeOrderWorkbookLocal();
        if (isQuoteContractFrozen(co.quote as any)) {
          toast.error(
            'Change orders are under contract or office-locked. Revoke the contract or unlock the proposal before adding new change order sections.'
          );
          return;
        }

        type CoSheetOrderRow = { order_index: unknown; change_order_seq?: unknown };
        const coFull = await supabase
          .from('material_sheets')
          .select('order_index, change_order_seq')
          .eq('workbook_id', co.workbookId);
        let coSheets: CoSheetOrderRow[] | null = (coFull.data as CoSheetOrderRow[] | null) ?? null;
        if (coFull.error?.message?.includes('change_order_seq')) {
          const coFallback = await supabase
            .from('material_sheets')
            .select('order_index')
            .eq('workbook_id', co.workbookId);
          coSheets = (coFallback.data as CoSheetOrderRow[] | null) ?? null;
        } else if (coFull.error) {
          toast.error(coFull.error.message || 'Could not load change order sections');
          return;
        }
        const maxOrder = Math.max(-1, ...(coSheets || []).map((s: any) => Number(s.order_index) || 0));
        const maxSeq = Math.max(
          0,
          ...(coSheets || []).map((s: any) => Number(s.change_order_seq) || 0)
        );
        const nextSeq = maxSeq + 1;
        const nextOrder = maxOrder + 1;

        const coInsert: Record<string, unknown> = {
          workbook_id: co.workbookId,
          sheet_name: (srcSheet as any).sheet_name,
          description: (srcSheet as any).description ?? null,
          order_index: nextOrder,
          is_option: false,
          sheet_type: 'change_order',
          change_order_seq: nextSeq,
          compare_to_sheet_id: null,
        };
        let { data: newSheet, error: insShErr } = await supabase
          .from('material_sheets')
          .insert(coInsert as never)
          .select('id')
          .single();
        if (insShErr?.message?.includes('change_order_seq')) {
          const { change_order_seq: _c, ...withoutCo } = coInsert;
          const retry = await supabase.from('material_sheets').insert(withoutCo as never).select('id').single();
          newSheet = retry.data;
          insShErr = retry.error;
        }
        if (insShErr || !newSheet) {
          toast.error(insShErr?.message ?? 'Failed to create change order section');
          return;
        }
        const newSheetId = newSheet.id;
        const rowIdMap: Record<string, string> = {};

        const { data: items } = await supabase.from('material_items').select('*').eq('sheet_id', sourceSheetId).order('order_index');
        if (items?.length) {
          await supabase.from('material_items').insert(
            items.map(({ id: _i, sheet_id: _s, created_at: _c, updated_at: _u, ...r }: any) => ({
              ...r,
              sheet_id: newSheetId,
            }))
          );
        }
        const { data: labor } = await supabase.from('material_sheet_labor').select('*').eq('sheet_id', sourceSheetId);
        if (labor?.length) {
          await supabase.from('material_sheet_labor').insert(
            labor.map(({ id: _i, sheet_id: _s, created_at: _c, updated_at: _u, ...r }: any) => ({
              ...r,
              sheet_id: newSheetId,
            }))
          );
        }
        const { data: markups } = await supabase.from('material_category_markups').select('*').eq('sheet_id', sourceSheetId);
        if (markups?.length) {
          await supabase.from('material_category_markups').insert(
            markups.map(({ id: _i, sheet_id: _s, created_at: _c, updated_at: _u, ...r }: any) => ({
              ...r,
              sheet_id: newSheetId,
            }))
          );
        }
        const { data: catOpts } = await supabase.from('material_category_options').select('*').eq('sheet_id', sourceSheetId);
        if (catOpts?.length) {
          await supabase.from('material_category_options').insert(
            catOpts.map(({ sheet_id: _s, ...r }: any) => ({ ...r, sheet_id: newSheetId }))
          );
        }

        const { data: sheetRows } = await supabase
          .from('custom_financial_rows')
          .select('*')
          .eq('quote_id', mainQuoteId)
          .eq('sheet_id', sourceSheetId)
          .order('order_index');
        for (const row of sheetRows || []) {
          const { id: _rid, created_at: _c, updated_at: _u, quote_id: _q, sheet_id: _sid, ...rrest } = row as any;
          const { data: newRow, error: rErr } = await supabase
            .from('custom_financial_rows')
            .insert({
              ...rrest,
              job_id: job.id,
              quote_id: co.quoteId,
              sheet_id: newSheetId,
            })
            .select('id')
            .single();
          if (rErr || !newRow) continue;
          rowIdMap[row.id] = newRow.id;
          const { data: rItems } = await supabase.from('custom_financial_row_items').select('*').eq('row_id', row.id).order('order_index');
          if (rItems?.length) {
            await supabase.from('custom_financial_row_items').insert(
              rItems.map(({ id: _i, row_id: _r, sheet_id: _s, created_at: _c2, updated_at: _u2, ...r }: any) => ({
                ...r,
                row_id: newRow.id,
                sheet_id: newSheetId,
              }))
            );
          }
        }
        const { data: sOnlyItems } = await supabase
          .from('custom_financial_row_items')
          .select('*')
          .eq('sheet_id', sourceSheetId)
          .is('row_id', null)
          .order('order_index');
        if (sOnlyItems?.length) {
          await supabase.from('custom_financial_row_items').insert(
            sOnlyItems.map(({ id: _i, row_id: _r, sheet_id: _s, created_at: _c, updated_at: _u, ...r }: any) => ({
              ...r,
              row_id: null,
              sheet_id: newSheetId,
            }))
          );
        }

        const sheetRowIds = (sheetRows || []).map((r: any) => r.id);
        const { data: estBySheet } = await supabase
          .from('subcontractor_estimates')
          .select('*')
          .eq('quote_id', mainQuoteId)
          .eq('sheet_id', sourceSheetId)
          .order('order_index');
        const { data: estByRow } =
          sheetRowIds.length > 0
            ? await supabase
                .from('subcontractor_estimates')
                .select('*')
                .eq('quote_id', mainQuoteId)
                .in('row_id', sheetRowIds)
                .order('order_index')
            : { data: [] as any[] };
        const seenEst = new Set<string>();
        const allEsts = [...(estBySheet || []), ...(estByRow || [])].filter((e: any) => {
          if (seenEst.has(e.id)) return false;
          seenEst.add(e.id);
          return true;
        });
        for (const est of allEsts) {
          const { id: _eid, job_id: _j, quote_id: _q, sheet_id: _s, row_id: er, created_at: _c, updated_at: _u, ...erest } = est as any;
          const { data: newEst, error: eErr } = await supabase.from('subcontractor_estimates').insert({
            ...erest,
            job_id: job.id,
            quote_id: co.quoteId,
            sheet_id: newSheetId,
            row_id: er ? (rowIdMap[er] ?? null) : null,
          }).select('id').single();
          if (eErr || !newEst) continue;
          const { data: slItems } = await supabase
            .from('subcontractor_estimate_line_items')
            .select('*')
            .eq('estimate_id', est.id)
            .order('order_index');
          if (slItems?.length) {
            await supabase.from('subcontractor_estimate_line_items').insert(
              slItems.map(({ id: _i2, estimate_id: _e, created_at: _c2, updated_at: _u2, ...r }: any) => ({
                ...r,
                estimate_id: newEst.id,
              }))
            );
          }
        }

        if (removeFromSource) {
          await deleteSourceMaterialSheetAfterCopy(sourceSheetId, mainQuoteId);
        }

        setCopyCoDialogOpen(false);
        setCopyCoSheetId(null);
        toast.success(
          removeFromSource
            ? `Moved to change orders as CO-${String(nextSeq).padStart(3, '0')}. Send from the Change order proposal when ready.`
            : `Copied to change orders as CO-${String(nextSeq).padStart(3, '0')}. Send from the Change order proposal when ready.`
        );
        await loadMaterialsData(mainQuoteId, !!isReadOnly);
        await loadCustomRows(mainQuoteId, !!isReadOnly);
        await loadSubcontractorEstimates(mainQuoteId, !!isReadOnly);
        window.dispatchEvent(new CustomEvent('materials-workbook-updated', { detail: { jobId: job.id } }));
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || 'Failed to copy section to change orders');
      } finally {
        setCopyCoRunning(false);
      }
  }

  async function loadQuoteData(): Promise<any> {
    try {
      let quoteData: any = null;
      
      // Single query: load ALL quotes for this job (tax_exempt is in * when column exists)
      const { data: allQuotes, error: allQuotesError } = await supabase
        .from('quotes')
        .select('*')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false });
      
      if (allQuotesError) {
        console.error('Error loading all quotes:', allQuotesError);
        return undefined;
      }
      
      let quotesList: any[] = allQuotes || [];

      // Always merge tax_exempt from RPC so saved value persists (API may not expose column or may cache)
      if (quotesList.length > 0) {
        const { data: taxRows, error: taxErr } = await supabase.rpc('get_job_quotes_tax_exempt', { p_job_id: job.id });
        if (!taxErr && Array.isArray(taxRows) && taxRows.length > 0) {
          const byId = new Map((taxRows as { quote_id: string; tax_exempt: boolean }[]).map((r) => [r.quote_id, r.tax_exempt]));
          quotesList = quotesList.map((q: any) => (byId.has(q.id) ? { ...q, tax_exempt: byId.get(q.id) } : q));
        }
      }

      // Sort so highest proposal number is first (e.g. 26012-3 before 26012-2 before 26012-1) so job open shows latest proposal data
      quotesList.sort((a: any, b: any) => {
        const na = (a.proposal_number || a.quote_number || '').toString();
        const nb = (b.proposal_number || b.quote_number || '').toString();
        if (na === nb) return 0;
        return nb.localeCompare(na, undefined, { numeric: true });
      });

      setAllJobQuotes(quotesList);

      // When job already has quotes, use that list. Prefer user-selected; else default to first (highest proposal number).
      if (quotesList.length > 0) {
        if (userSelectedQuoteIdRef.current) {
          const selectedQuote = quotesList.find((q: any) => q.id === userSelectedQuoteIdRef.current);
          quoteData = selectedQuote ?? quotesList[0];
          if (!selectedQuote) userSelectedQuoteIdRef.current = quoteData.id;
        } else if (!quote) {
          quoteData = quotesList[0];
          userSelectedQuoteIdRef.current = quoteData.id;
        } else {
          const fromList = quotesList.find((q: any) => q.id === quote.id);
          quoteData = fromList ?? quote;
        }
        const formalsOnly = quotesList.filter((q: any) => q.is_customer_estimate !== true);
        if (quoteData && (quoteData as any).is_customer_estimate === true && formalsOnly.length > 0) {
          quoteData = formalsOnly[0];
          userSelectedQuoteIdRef.current = quoteData.id;
        }
        setQuote(quoteData);
        return quoteData;
      }

      // No quotes linked to job yet — try to find an unlinked quote to link
      {
        // Try 2: Exact customer name and address match
        const { data: exactMatches, error: exactError } = await supabase
          .from('quotes')
          .select('*')
          .eq('customer_name', job.client_name)
          .eq('customer_address', job.address)
          .order('created_at', { ascending: false })
          .limit(1);

        if (!exactError && exactMatches && exactMatches.length > 0) {
          quoteData = exactMatches[0];
          console.log('Found quote by exact match:', quoteData.id);
        } else {
          // Try 3: Case-insensitive partial match
          const { data: allQuotes, error: allError } = await supabase
            .from('quotes')
            .select('*')
            .is('job_id', null)
            .order('created_at', { ascending: false });

          if (!allError && allQuotes) {
            // Find best match by comparing customer names (case-insensitive)
            const normalizedJobName = job.client_name.toLowerCase().trim();
            const normalizedJobAddress = job.address.toLowerCase().trim();
            
            const match = allQuotes.find(q => {
              const qName = (q.customer_name || '').toLowerCase().trim();
              const qAddress = (q.customer_address || '').toLowerCase().trim();
              return qName === normalizedJobName && qAddress === normalizedJobAddress;
            });

            if (match) {
              quoteData = match;
              console.log('Found quote by case-insensitive match:', quoteData.id);
            } else {
              // Try 4: Match by customer name only (if unique)
              const nameMatches = allQuotes.filter(q => 
                (q.customer_name || '').toLowerCase().trim() === normalizedJobName
              );
              
              if (nameMatches.length === 1) {
                quoteData = nameMatches[0];
                console.log('Found quote by unique customer name:', quoteData.id);
              }
            }
          }
        }
        
        // If we found a match via fallback, link it to the job
        if (quoteData) {
          console.log('Linking quote', quoteData.id, 'to job', job.id);
          const { error: updateError } = await supabase
            .from('quotes')
            .update({ job_id: job.id })
            .eq('id', quoteData.id);
            
          if (updateError) {
            console.error('Error linking quote to job:', updateError);
          } else {
            console.log('Successfully linked quote to job');
          }
          setQuote(quoteData);
          userSelectedQuoteIdRef.current = quoteData.id;
        } else {
          setQuote(null);
          userSelectedQuoteIdRef.current = null;
        }
      }
      return quoteData;
    } catch (error: any) {
      console.error('Error loading quote data:', error);
      return undefined;
    }
  }

  async function setQuoteOnHoldForJob(nextOnHold: boolean) {
    if (!quote?.id || isReadOnly) return;
    try {
      const { error } = await supabase
        .from('quotes')
        .update({ on_hold: nextOnHold, updated_at: new Date().toISOString() })
        .eq('id', quote.id);
      if (error) throw error;
      toast.success(nextOnHold ? 'Proposal put on hold' : 'Proposal resumed');
      const fresh = await loadQuoteData();
      await loadData(false, fresh ?? undefined);
    } catch (e: any) {
      console.error('setQuoteOnHoldForJob', e);
      toast.error(e?.message || 'Failed to update proposal');
    }
  }

  /** Creates a new proposal (empty or cloned from a template). Existing proposals are never deleted or modified. */
  async function createNewProposal() {
    if (!profile) return;
    setCreatingProposal(true);

    const safetyTimeoutMs = 90000; // 90s max so loading never sticks forever
    const safetyTimer = setTimeout(() => {
      setCreatingProposal(false);
      toast.error('Proposal create took too long; you may need to refresh.');
    }, safetyTimeoutMs);

    try {
      // ── Start from blank: RPC creates new empty quote (no template) ──
      if (templateQuoteIdForNewProposal === null) {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('create_proposal_version', {
          p_quote_id: null,
          p_job_id: job.id,
          p_user_id: profile.id,
          p_change_notes: proposalChangeNotes || 'New proposal (empty)',
        });
        if (rpcErr) throw new Error(rpcErr.message);
        const newQuoteId = (rpcData as any)?.quote_id;
        if (!newQuoteId) throw new Error('No quote_id returned');
        const { data: newQuote, error: fetchError } = await supabase.from('quotes').select('*').eq('id', newQuoteId).single();
        if (fetchError) throw fetchError;
        // Keep job tax-exempt: if any existing quote for this job is tax exempt, set the new quote too
        const jobTaxExempt = allJobQuotes.some((q: any) => q.tax_exempt === true) || (quote?.tax_exempt === true);
        if (jobTaxExempt && !(newQuote as any).tax_exempt) {
          await supabase.from('quotes').update({ tax_exempt: true }).eq('id', newQuoteId);
          (newQuote as any).tax_exempt = true;
        }
        setQuote(newQuote);
        userSelectedQuoteIdRef.current = newQuote.id;
        toast.success(`New proposal ${newQuote.proposal_number} created. You can add materials and rows.`);
        setShowCreateProposalDialog(false);
        setProposalChangeNotes('');
        setTemplateQuoteIdForNewProposal(quote?.id ?? null);
        clearTimeout(safetyTimer);
        setCreatingProposal(false);
        await loadQuoteData();
        await loadData(false, newQuote);
        return;
      }

      // ── Use selected proposal as template (clone without affecting the template) ──
      const sourceQuote = allJobQuotes.find((q: any) => q.id === templateQuoteIdForNewProposal) ?? (quote?.id === templateQuoteIdForNewProposal ? quote : null);
      if (!sourceQuote) {
        toast.error('Selected template not found.');
        clearTimeout(safetyTimer);
        setCreatingProposal(false);
        return;
      }
      const oldQuoteId = templateQuoteIdForNewProposal;
      const isCloningCurrent = oldQuoteId === quote?.id;

      // Do not modify the template/source proposal: no persisting in-memory labor or other edits
      // back to the template. The new proposal is built from the last-saved DB state of the template only.

      // ── Step 1: Create the new quotes row (from template quote data) ──
      const quotePayload: Record<string, unknown> = {
        job_id: job.id,
        customer_name:    (sourceQuote as any).customer_name    ?? null,
        customer_address: (sourceQuote as any).customer_address ?? null,
        customer_email:   (sourceQuote as any).customer_email   ?? null,
        customer_phone:   (sourceQuote as any).customer_phone   ?? null,
        project_name:     (sourceQuote as any).project_name     ?? null,
        width:            (sourceQuote as any).width             ?? 0,
        length:           (sourceQuote as any).length            ?? 0,
        status:           'draft',
        created_by:       profile.id,
        estimated_price:  (sourceQuote as any).estimated_price   ?? null,
        tax_exempt:       (sourceQuote as any).tax_exempt === true,
        is_customer_estimate: (sourceQuote as any).is_customer_estimate === true,
      };
      const payloadWithDescription = { ...quotePayload, description: (sourceQuote as any).description ?? null };
      let result = await supabase.from('quotes').insert(payloadWithDescription).select().single();
      if (result.error && /description.*schema cache|column.*description/i.test(result.error.message)) {
        result = await supabase.from('quotes').insert(quotePayload).select().single();
      }
      if (result.error && /tax_exempt|schema cache|column.*tax_exempt/i.test(result.error.message)) {
        const { tax_exempt: _te, ...payloadWithoutTaxExempt } = quotePayload as Record<string, unknown>;
        result = await supabase.from('quotes').insert(payloadWithoutTaxExempt).select().single();
      }
      if (result.error && /is_customer_estimate|schema cache|column.*is_customer_estimate/i.test(result.error.message)) {
        const { is_customer_estimate: _ice, ...payloadWithoutIsEstimate } = quotePayload as Record<string, unknown>;
        const maybeWithDescription = { ...payloadWithoutIsEstimate, description: (sourceQuote as any).description ?? null };
        result = await supabase.from('quotes').insert(maybeWithDescription).select().single();
        if (result.error && /description.*schema cache|column.*description/i.test(result.error.message)) {
          result = await supabase.from('quotes').insert(payloadWithoutIsEstimate).select().single();
        }
      }
      const quoteErr = result.error;
      const newQuoteRow = result.data;
      if (quoteErr || !newQuoteRow) throw new Error(`Step 1 (create quote): ${quoteErr?.message ?? 'No data returned'}`);
      const newQuoteId: string = newQuoteRow.id;
      console.log('✅ Step 1 — new quote row created:', newQuoteRow.proposal_number);

      // ── Step 2: Copy material_workbooks → sheets → items / labor / markups (single snapshot, no further reads of source) ──
      const sheetIdMap: Record<string, string> = {};
      const oldSheetIdToNewWorkbookId: Record<string, string> = {};
      const oldSheetIdToSectionName: Record<string, string> = {};
      const snapshotSheets: any[]                          = [];
      const snapshotCategoryMarkups: Record<string, number> = {};
      const snapshotSheetLabor: any[]                      = [];

      const { data: oldWorkbooksFull, error: wbFetchErr } = await fetchMaterialWorkbooksFullForQuote(oldQuoteId);
      if (wbFetchErr) throw new Error(`Step 2 (fetch workbooks): ${wbFetchErr.message}`);

      const sourceWorkbook = pickWorkbookForProposalClone(oldWorkbooksFull || []);
      const workbooksToClone = sourceWorkbook ? [sourceWorkbook] : [];

      const { data: maxWbRow } = await supabase
        .from('material_workbooks')
        .select('version_number')
        .eq('job_id', job.id)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      let nextWbVersion = (maxWbRow?.version_number ?? 0) + 1;

      for (const wb of workbooksToClone) {
        const {
          id: _oldWbId,
          quote_id: _oldWbQuote,
          created_at: _wbCreated,
          updated_at: _wbUpdated,
          material_sheets: nestedSheets,
          ...workbookRest
        } = wb as Record<string, unknown> & { material_sheets?: unknown };
        const { data: newWb, error: wbErr } = await supabase
          .from('material_workbooks')
          .insert({
            ...workbookRest,
            job_id: job.id,
            quote_id: newQuoteId,
            version_number: nextWbVersion++,
            status: 'working',
            created_by: profile.id,
          } as never)
          .select('id')
          .single();
        if (wbErr) throw new Error(`Step 2 (insert workbook): ${wbErr.message}`);

        const oldSheets = ((nestedSheets as any[]) || []).slice().sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
        for (const sheet of oldSheets) {
          const sheetInsertBase: Record<string, unknown> = {
            workbook_id: newWb.id,
            sheet_name: sheet.sheet_name,
            order_index: sheet.order_index,
            is_option: sheet.is_option,
            description: sheet.description,
            sheet_type: sheet.sheet_type ?? 'proposal',
            change_order_seq: sheet.change_order_seq ?? null,
            category_order: sheet.category_order ?? null,
            compare_to_sheet_id: null,
          };
          let sheetInsertPayload: Record<string, unknown> = { ...sheetInsertBase };
          let { data: newSheet, error: shErr } = await supabase
            .from('material_sheets')
            .insert(sheetInsertPayload as never)
            .select('id')
            .single();
          // Retry without optional columns when DB is behind migrations (change_order_seq, category_order, etc.)
          for (let attempt = 0; shErr && attempt < 6; attempt++) {
            const msg = shErr.message ?? '';
            let next: Record<string, unknown> | null = null;
            if (msg.includes('change_order_seq') && 'change_order_seq' in sheetInsertPayload) {
              const { change_order_seq: _d, ...r } = sheetInsertPayload;
              next = r;
            } else if (msg.includes('category_order') && 'category_order' in sheetInsertPayload) {
              const { category_order: _d, ...r } = sheetInsertPayload;
              next = r;
            } else if (msg.includes('compare_to_sheet_id') && 'compare_to_sheet_id' in sheetInsertPayload) {
              const { compare_to_sheet_id: _d, ...r } = sheetInsertPayload;
              next = r;
            } else if (msg.includes('sheet_type') && 'sheet_type' in sheetInsertPayload) {
              const { sheet_type: _d, ...r } = sheetInsertPayload;
              next = r;
            }
            if (!next) break;
            sheetInsertPayload = next;
            const retry = await supabase
              .from('material_sheets')
              .insert(sheetInsertPayload as never)
              .select('id')
              .single();
            newSheet = retry.data;
            shErr = retry.error;
          }
          if (shErr) throw new Error(`Step 2 (insert sheet): ${shErr.message}`);
          sheetIdMap[sheet.id] = newSheet.id;
          oldSheetIdToNewWorkbookId[sheet.id] = newWb.id;
          oldSheetIdToSectionName[sheet.id] = String(sheet.sheet_name ?? '').trim() || null;

          const items = (sheet.material_items || []).slice().sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
          if (items.length) {
            const { error: iErr } = await supabase.from('material_items').insert(
              items.map(({ id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...r }) => ({ ...r, sheet_id: newSheet.id }))
            );
            if (iErr) throw new Error(`Step 2 (insert items): ${iErr.message}`);
          }

          const labor = sheet.material_sheet_labor || [];
          if (labor.length) {
            const { error: lErr } = await supabase.from('material_sheet_labor').insert(
              labor.map(({ id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...r }: any) => ({ ...r, sheet_id: newSheet.id }))
            );
            if (lErr) throw new Error(`Step 2 (insert labor): ${lErr.message}`);
            labor.forEach((l: any) => snapshotSheetLabor.push({ ...l, sheet_id: sheet.id }));
          }

          const markups = sheet.material_category_markups || [];
          if (markups.length) {
            const { error: mErr } = await supabase.from('material_category_markups').insert(
              markups.map(({ id: _id, sheet_id: _sid, created_at: _ca, updated_at: _ua, ...r }: any) => ({ ...r, sheet_id: newSheet.id }))
            );
            if (mErr) throw new Error(`Step 2 (insert markups): ${mErr.message}`);
            markups.forEach((m: any) => { snapshotCategoryMarkups[`${sheet.id}_${m.category_name}`] = m.markup_percent; });
          }

          snapshotSheets.push({
            id: sheet.id,
            sheet_name: sheet.sheet_name,
            order_index: sheet.order_index,
            is_option: sheet.is_option,
            description: sheet.description,
            sheet_type: sheet.sheet_type ?? 'proposal',
            change_order_seq: sheet.change_order_seq ?? null,
            category_order: sheet.category_order ?? null,
            compare_to_sheet_id: sheet.compare_to_sheet_id ?? null,
            items,
          });
        }
      }
      for (const wb of workbooksToClone) {
        const oldSheets = (((wb as any).material_sheets as any[]) || []).slice().sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
        for (const sheet of oldSheets) {
          const newSid = sheetIdMap[sheet.id];
          const oldCmp = sheet.compare_to_sheet_id;
          if (newSid && oldCmp && sheetIdMap[oldCmp]) {
            const { error: cmpErr } = await supabase
              .from('material_sheets')
              .update({ compare_to_sheet_id: sheetIdMap[oldCmp] })
              .eq('id', newSid);
            if (cmpErr) console.warn('Step 2 (compare_to_sheet_id):', cmpErr.message);
          }
        }
      }
      console.log(`✅ Step 2 — copied ${Object.keys(sheetIdMap).length} sheets`);

      // (No lock of source proposal — leave template proposal completely unchanged so all data stays intact.)

      // ── Step 3: Copy custom_financial_rows and their line items ──
      const rowIdMap: Record<string, string> = {};
      const snapshotFinancialRows: any[] = [];

      const { data: oldRows, error: rowFetchErr } = await supabase
        .from('custom_financial_rows').select('*').eq('quote_id', oldQuoteId).order('order_index');
      if (rowFetchErr) throw new Error(`Step 3 (fetch rows): ${rowFetchErr.message}`);

      for (const row of (oldRows || [])) {
        const {
          id: _oldRowId,
          job_id: _oldJob,
          quote_id: _oldQ,
          created_at: _rca,
          updated_at: _rua,
          sheet_id: oldRowSheetId,
          ...rowRest
        } = row as Record<string, unknown>;
        const { data: newRow, error: rErr } = await supabase
          .from('custom_financial_rows')
          .insert({
            ...rowRest,
            job_id: job.id,
            quote_id: newQuoteId,
            sheet_id: oldRowSheetId ? (sheetIdMap[String(oldRowSheetId)] ?? null) : null,
          } as never)
          .select('id')
          .single();
        if (rErr) throw new Error(`Step 3 (insert row): ${rErr.message}`);
        rowIdMap[row.id] = newRow.id;

        const { data: rItems, error: riFetchErr } = await supabase
          .from('custom_financial_row_items').select('*').eq('row_id', row.id).order('order_index');
        if (riFetchErr) throw new Error(`Step 3 (fetch row items): ${riFetchErr.message}`);
        if (rItems?.length) {
          const { error: riErr } = await supabase.from('custom_financial_row_items').insert(
            rItems.map((item) => {
              const oldSid = item.sheet_id ? String(item.sheet_id) : null;
              const newSid = oldSid ? (sheetIdMap[oldSid] ?? null) : null;
              return payloadForClonedLineItem(item as Record<string, unknown>, {
                row_id: newRow.id,
                sheet_id: newSid,
                quote_id: newQuoteId,
                workbook_id: oldSid ? (oldSheetIdToNewWorkbookId[oldSid] ?? null) : null,
                section_name: oldSid ? (oldSheetIdToSectionName[oldSid] ?? null) : null,
              });
            }),
          );
          if (riErr) throw new Error(`Step 3 (insert row items): ${riErr.message}`);
        }
        snapshotFinancialRows.push({ ...row, line_items: rItems || [] });
      }

      // Sheet-linked line items (row_id IS NULL, sheet_id IS NOT NULL)
      const oldSheetIdList = Object.keys(sheetIdMap);
      if (oldSheetIdList.length > 0) {
        const { data: sItems, error: siFetchErr } = await supabase
          .from('custom_financial_row_items').select('*').in('sheet_id', oldSheetIdList).is('row_id', null);
        if (siFetchErr) throw new Error(`Step 3 (fetch sheet items): ${siFetchErr.message}`);
        if (sItems?.length) {
          const { error: siErr } = await supabase.from('custom_financial_row_items').insert(
            sItems.map((item) => {
              const oldSid = item.sheet_id ? String(item.sheet_id) : null;
              const newSid = oldSid ? (sheetIdMap[oldSid] ?? null) : null;
              return payloadForClonedLineItem(item as Record<string, unknown>, {
                row_id: null,
                sheet_id: newSid,
                quote_id: newQuoteId,
                workbook_id: oldSid ? (oldSheetIdToNewWorkbookId[oldSid] ?? null) : null,
                section_name: oldSid ? (oldSheetIdToSectionName[oldSid] ?? null) : null,
              });
            }),
          );
          if (siErr) throw new Error(`Step 3 (insert sheet items): ${siErr.message}`);
        }
      }
      console.log(`✅ Step 3 — copied ${oldRows?.length ?? 0} financial rows`);

      // ── Step 4: Copy subcontractor_estimates and their line items ──
      const snapshotSubcontractors: any[] = [];
      const estimateIdMap: Record<string, string> = {};

      const { data: oldEstimates, error: estFetchErr } = await supabase
        .from('subcontractor_estimates').select('*').eq('quote_id', oldQuoteId).order('order_index');
      if (estFetchErr) throw new Error(`Step 4 (fetch estimates): ${estFetchErr.message}`);

      for (const est of (oldEstimates || [])) {
        const { id: _id, job_id: _jid, quote_id: _qid, sheet_id: estOldSheetId, row_id: estOldRowId, created_at: _ca, updated_at: _ua, ...estRest } = est;
        const { data: newEst, error: eErr } = await supabase
          .from('subcontractor_estimates')
          .insert({
            ...estRest,
            job_id: job.id, quote_id: newQuoteId,
            sheet_id: estOldSheetId ? (sheetIdMap[estOldSheetId] ?? null) : null,
            row_id:   estOldRowId   ? (rowIdMap[estOldRowId]     ?? null) : null,
          })
          .select('id').single();
        if (eErr) throw new Error(`Step 4 (insert estimate): ${eErr.message}`);
        estimateIdMap[_id] = newEst.id;

        const { data: sItems, error: slFetchErr } = await supabase
          .from('subcontractor_estimate_line_items').select('*').eq('estimate_id', est.id).order('order_index');
        if (slFetchErr) throw new Error(`Step 4 (fetch sub line items): ${slFetchErr.message}`);
        if (sItems?.length) {
          const { error: slErr } = await supabase.from('subcontractor_estimate_line_items').insert(
            sItems.map(({ id: _id, estimate_id: _eid, created_at: _ca, updated_at: _ua, ...r }) => ({ ...r, estimate_id: newEst.id }))
          );
          if (slErr) throw new Error(`Step 4 (insert sub line items): ${slErr.message}`);
        }
        snapshotSubcontractors.push({ ...estRest, id: est.id, line_items: sItems || [] });
      }
      console.log(`✅ Step 4 — copied ${oldEstimates?.length ?? 0} subcontractor estimates`);

      // ── Step 4b: Proposal-only "removed section" flags (same visibility as template) ──
      try {
        const { data: removedRows, error: remErr } = await supabase
          .from('quote_removed_sections')
          .select('*')
          .eq('quote_id', oldQuoteId);
        if (!remErr && removedRows?.length) {
          for (const rec of removedRows) {
            const st = (rec as any).section_type as string;
            const oldSid = String((rec as any).section_id);
            let newSectionId: string | null = null;
            if (st === 'custom_row') newSectionId = rowIdMap[oldSid] ?? null;
            else if (st === 'subcontractor_estimate') newSectionId = estimateIdMap[oldSid] ?? null;
            if (newSectionId) {
              const { error: insRem } = await supabase.from('quote_removed_sections').insert({
                quote_id: newQuoteId,
                section_type: st,
                section_id: newSectionId,
              } as never);
              if (insRem) console.warn('Step 4b (quote_removed_sections):', insRem.message);
            }
          }
        }
      } catch (e: any) {
        console.warn('Step 4b (quote_removed_sections skipped):', e?.message);
      }

      // ── Step 5: Save frozen snapshot only when cloning current proposal (not when using another as template) ──
      if (isCloningCurrent) {
        const nextVersion = (proposalVersions?.length ?? 0) + 1;
        const { error: snapErr } = await supabase.from('proposal_versions').insert({
          quote_id:                  oldQuoteId,
          version_number:            nextVersion,
          customer_name:             (quote as any).customer_name    ?? null,
          customer_address:          (quote as any).customer_address ?? null,
          customer_email:            (quote as any).customer_email   ?? null,
          customer_phone:            (quote as any).customer_phone   ?? null,
          project_name:              (quote as any).project_name     ?? null,
          width:                     (quote as any).width             ?? 0,
          length:                    (quote as any).length            ?? 0,
          estimated_price:           (quote as any).estimated_price  ?? null,
          workbook_snapshot:         { sheets: snapshotSheets, category_markups: snapshotCategoryMarkups, sheet_labor: snapshotSheetLabor },
          financial_rows_snapshot:   snapshotFinancialRows,
          subcontractor_snapshot:    snapshotSubcontractors,
          change_notes:              proposalChangeNotes || 'New proposal version',
          created_by:                profile.id,
        });
        if (snapErr) console.warn('⚠️ Snapshot save failed (non-fatal):', snapErr.message);
        else console.log('✅ Step 5 — snapshot saved to proposal_versions');
      }

      // ── Step 6: Reload and switch UI to the new proposal ──
      const { data: newQuote, error: fetchError } = await supabase
        .from('quotes').select('*').eq('id', newQuoteId).single();
      if (fetchError) throw new Error(`Step 6 (load new quote): ${fetchError.message}`);

      setQuote(newQuote);
      userSelectedQuoteIdRef.current = newQuote.id;
      toast.success(`New proposal ${newQuote.proposal_number} created with independent data`);
      setShowCreateProposalDialog(false);
      setProposalChangeNotes('');
      setTemplateQuoteIdForNewProposal(quote?.id ?? null);
      setCreatingProposal(false); // Clear loading so dialog/button don't hang if reload is slow

      // Reload quote list and financials in background (with timeout so we never hang indefinitely)
      const reloadTimeout = 30000; // 30s
      await Promise.race([
        (async () => {
          await loadQuoteData();
          await loadData(false, newQuote);
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Reload timeout')), reloadTimeout)),
      ]).catch((err) => {
        console.warn('Proposal created but reload failed or timed out:', err?.message);
        toast.error('Proposal created but data may need a refresh.');
        void loadQuoteData();
        void loadData(false, newQuote);
      });
    } catch (error: any) {
      console.error('❌ createNewProposal error:', error?.message);
      toast.error('Failed to create new proposal: ' + (error?.message ?? 'Unknown error'));
    } finally {
      clearTimeout(safetyTimer);
      setCreatingProposal(false);
    }
  }

  async function loadCustomerEstimateLines(anchorQuoteId: string) {
    try {
      const { data, error } = await supabase
        .from('customer_estimate_lines')
        .select('*')
        .eq('anchor_quote_id', anchorQuoteId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      setCustomerEstimateLines((data as CustomerEstimateLineRow[]) || []);
    } catch (e) {
      if (isMissingCustomerEstimateLinesTableError(e)) {
        toast.error('Estimate lines table is not installed. Apply migration 20260415120000_customer_estimate_lines.sql.');
      } else {
        toast.error((e as Error)?.message || 'Could not load estimate lines');
      }
      setCustomerEstimateLines([]);
    }
  }

  /** Opens the price-list estimate workspace for the current formal proposal (no new quotes row). */
  async function createNewCustomerEstimate() {
    const formal =
      quote &&
      (quote as any).is_customer_estimate !== true &&
      (quote as any).is_change_order_proposal !== true
        ? quote
        : formalJobQuotes.find((q: any) => !q.is_change_order_proposal) ?? formalJobQuotes[0];
    if (!formal?.id) {
      toast.error('Create or select a main proposal first, then open an estimate from the price list.');
      return;
    }
    if (quote?.id !== formal.id) {
      setQuote(formal);
      userSelectedQuoteIdRef.current = formal.id;
      await loadData(false, formal);
    }
    setEstimateCatalogViewOpen(true);
    await loadCustomerEstimateLines(formal.id);
    toast.success('Price-list estimate — lines are separate from the proposal workbook.');
  }

  function openEstimateLineDialog(existing: CustomerEstimateLineRow | null) {
    if (existing) {
      setEditingEstimateLine(existing);
      setEstimateLineForm({
        description: existing.description || '',
        quantity: String(existing.quantity ?? 1),
        unit_cost: String(existing.unit_cost ?? 0),
        markup_percent: String(existing.markup_percent ?? 0),
        taxable: existing.taxable !== false,
        notes: existing.notes || '',
      });
    } else {
      setEditingEstimateLine(null);
      setEstimateLineForm({
        description: '',
        quantity: '1',
        unit_cost: '0',
        markup_percent: '10',
        taxable: true,
        notes: '',
      });
    }
    setEstimateLineDialogOpen(true);
  }

  async function saveEstimateLineFromDialog() {
    if (!quote?.id || isReadOnly) return;
    const desc = estimateLineForm.description.trim();
    if (!desc) {
      toast.error('Enter a description');
      return;
    }
    const qty = parseFloat(estimateLineForm.quantity) || 0;
    const uc = parseFloat(estimateLineForm.unit_cost) || 0;
    const mu = parseFloat(estimateLineForm.markup_percent) || 0;
    setSavingEstimateLine(true);
    try {
      if (editingEstimateLine) {
        const { error } = await supabase
          .from('customer_estimate_lines')
          .update({
            description: desc,
            quantity: qty,
            unit_cost: uc,
            markup_percent: mu,
            taxable: estimateLineForm.taxable,
            notes: estimateLineForm.notes.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingEstimateLine.id);
        if (error) throw error;
        toast.success('Line updated');
      } else {
        const maxSort =
          customerEstimateLines.length > 0
            ? Math.max(...customerEstimateLines.map((r) => r.sort_order ?? 0))
            : -1;
        const { error } = await supabase.from('customer_estimate_lines').insert({
          job_id: job.id,
          anchor_quote_id: quote.id,
          description: desc,
          quantity: qty,
          unit_cost: uc,
          markup_percent: mu,
          taxable: estimateLineForm.taxable,
          notes: estimateLineForm.notes.trim() || null,
          sort_order: maxSort + 1,
        });
        if (error) throw error;
        toast.success('Line added');
      }
      setEstimateLineDialogOpen(false);
      setEditingEstimateLine(null);
      await loadCustomerEstimateLines(quote.id);
    } catch (e: any) {
      if (isMissingCustomerEstimateLinesTableError(e)) {
        toast.error('Run the customer_estimate_lines migration in Supabase.');
      } else {
        toast.error(e?.message || 'Could not save line');
      }
    } finally {
      setSavingEstimateLine(false);
    }
  }

  async function deleteCustomerEstimateLine(id: string) {
    if (!quote?.id || isReadOnly) return;
    if (!confirm('Remove this estimate line?')) return;
    try {
      const { error } = await supabase.from('customer_estimate_lines').delete().eq('id', id);
      if (error) throw error;
      await loadCustomerEstimateLines(quote.id);
      toast.success('Line removed');
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed');
    }
  }

  async function importEstimateCatalogLinesToProposal() {
    if (!quote?.id || isReadOnly) return;
    if ((quote as any).is_customer_estimate === true) {
      toast.info('Switch to a formal proposal to import lines.');
      return;
    }
    if (customerEstimateLines.length === 0) {
      toast.error('No estimate lines to import.');
      return;
    }
    if (
      !confirm(
        `Add ${customerEstimateLines.length} material row(s) from this price-list estimate into the proposal below?`
      )
    )
      return;
    try {
      const maxOrderIndex = customRows.length > 0 ? Math.max(...customRows.map((r) => r.order_index)) : -1;
      let idx = maxOrderIndex + 1;
      const sorted = [...customerEstimateLines].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      for (const line of sorted) {
        const qty = Number(line.quantity) || 1;
        const cost = Number(line.unit_cost) || 0;
        const markup = Number(line.markup_percent) || 0;
        const totalCost = qty * cost;
        const sellingPrice = totalCost * (1 + markup / 100);
        const { error } = await supabase.from('custom_financial_rows').insert([
          {
            job_id: job.id,
            quote_id: quote.id,
            category: 'materials',
            description: line.description,
            quantity: qty,
            unit_cost: cost,
            total_cost: totalCost,
            markup_percent: markup,
            selling_price: sellingPrice,
            notes: line.notes?.trim() || 'Imported from price-list estimate',
            taxable: line.taxable !== false,
            order_index: idx++,
            sheet_id: null,
            is_option: false,
          },
        ]);
        if (error) throw error;
      }
      toast.success('Imported into proposal financials.');
      await loadCustomRows(quote.id, !!isReadOnly);
      await loadMaterialsData(quote.id, !!isReadOnly);
      setEstimateCatalogViewOpen(false);
    } catch (e: any) {
      toast.error(e?.message || 'Import failed');
    }
  }

  async function convertEstimateToProposal() {
    if (!quote?.id || isReadOnly) return;
    if ((quote as any).is_customer_estimate !== true) return;
    if (
      !confirm(
        'Turn this estimate into a formal proposal? It can appear on the customer portal when you share a link.'
      )
    )
      return;
    try {
      const { data: convData, error: convErr } = await supabase.rpc('create_proposal_version', {
        p_quote_id: quote.id,
        p_job_id: null,
        p_user_id: profile?.id ?? null,
        p_change_notes: '__MB_CONVERT_FORMAL__',
      });
      if (convErr) throw new Error(convErr.message);
      const updatedRow = (convData as any)?.quote ?? convData;
      if (!updatedRow || typeof (updatedRow as any).id !== 'string') {
        throw new Error('Convert response missing quote row; redeploy create_proposal_version SQL from the repo.');
      }
      setQuote(updatedRow as any);
      userSelectedQuoteIdRef.current = String((updatedRow as any).id);
      toast.success('Converted to a formal proposal.');
      await loadQuoteData();
      await loadData(false, updatedRow as any);
    } catch (e: any) {
      toast.error(e?.message || 'Could not convert to proposal');
    }
  }

  function parseProposalNumberBase(q: any): string | null {
    const raw = String(q?.proposal_number || q?.quote_number || '').trim();
    const m = raw.match(/^([0-9]+)-[0-9]+$/);
    return m ? m[1] : null;
  }

  function tryOpenRenumberProposalsDialog() {
    if (isReadOnly) {
      toast.error('Cannot edit in historical view');
      return;
    }
    if ((quote as any).is_customer_estimate === true || showingCatalogOrLegacyEstimate) return;
    if (!parseProposalNumberBase(quote)) {
      toast.error('Proposal number must look like 26040-11 to renumber.');
      return;
    }
    setShowRenumberProposalsDialog(true);
  }

  async function confirmRenumberProposalsNewestIsOne() {
    if (!quote?.id || isReadOnly) return;
    if ((quote as any).is_customer_estimate === true || showingCatalogOrLegacyEstimate) {
      toast.error('Open a formal proposal to renumber.');
      return;
    }
    const base = parseProposalNumberBase(quote);
    if (!base) {
      toast.error('Could not read proposal base (expected format like 26040-11).');
      setShowRenumberProposalsDialog(false);
      return;
    }
    const rows = [...formalProposalsForRenumber].sort(
      (a: any, b: any) =>
        new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
    if (rows.length === 0) {
      toast.error('No formal proposals to renumber.');
      setShowRenumberProposalsDialog(false);
      return;
    }
    setRenumberingProposals(true);
    try {
      // Two-phase update: unique constraint on proposal_number would fail if we wrote e.g. 26040-1
      // while another row still holds 26040-1. Clear to unique temps first, then assign final labels.
      for (let i = 0; i < rows.length; i++) {
        const id = String((rows[i] as any).id);
        const tmp = `_mbtmp_${id.replace(/-/g, '')}`;
        const { error } = await supabase
          .from('quotes')
          .update({ proposal_number: tmp, quote_number: tmp })
          .eq('id', id);
        if (error) throw error;
      }
      for (let i = 0; i < rows.length; i++) {
        const label = `${base}-${i + 1}`;
        const { error } = await supabase
          .from('quotes')
          .update({ proposal_number: label, quote_number: label })
          .eq('id', (rows[i] as any).id);
        if (error) throw error;
      }
      const refreshed = await loadQuoteData();
      await loadData(false, refreshed ?? quote);
      toast.success(`Renumbered ${rows.length} proposal(s). Newest is now ${base}-1.`);
      setShowRenumberProposalsDialog(false);
    } catch (e: any) {
      toast.error(e?.message || 'Renumber failed');
    } finally {
      setRenumberingProposals(false);
    }
  }

  async function autoCreateFirstProposal() {
    // Only run if we don't have a quote yet
    if (quote) return;
    
    try {
      console.log('🔍 Auto-creating first proposal for job:', job.id);

      // Check if a quote already exists for this job
      const { data: existingQuote, error: fetchError } = await supabase
        .from('quotes')
        .select('*')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('❌ Error fetching existing quote:', fetchError);
        throw fetchError;
      }

      if (existingQuote) {
        console.log('✅ Found existing quote:', existingQuote.proposal_number);
        setQuote(existingQuote);
        return;
      }

      console.log('📝 Creating first proposal with -1 suffix...');

      // Create first proposal using the database function
      // This will auto-generate proposal number with -1 suffix
      const { data, error } = await supabase.rpc('create_proposal_version', {
        p_quote_id: null,
        p_job_id: job.id,
        p_user_id: profile?.id || null,
        p_change_notes: 'Initial proposal',
      });

      if (error) {
        console.error('❌ Error auto-creating first proposal:', error);
        throw error;
      }

      console.log('✅ Auto-created first proposal');
      
      // Reload quote data to get the newly created quote
      await loadQuoteData();
      
      toast.success('First proposal created automatically');
    } catch (error: any) {
      console.error('❌ Error in autoCreateFirstProposal:', error);
      // Silent failure - user can create manually if needed
      console.log('Will show manual create button instead');
    }
  }

  async function manuallyCreateQuote() {
    if (quote) {
      toast.info('Proposal number already exists');
      return;
    }

    try {
      // Double-check for existing quote before creating
      const { data: existingQuote } = await supabase
        .from('quotes')
        .select('*')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingQuote) {
        setQuote(existingQuote);
        toast.info(`Using existing proposal #${existingQuote.proposal_number}`);
        return;
      }

      const { data: newQuote, error: createError } = await supabase
        .from('quotes')
        .insert({
          job_id: job.id,
          customer_name: job.client_name,
          customer_address: job.address,
          project_name: job.name,
          status: 'draft',
          width: 0,
          length: 0,
          created_by: profile?.id,
        })
        .select()
        .single();

      if (createError) throw createError;

      setQuote(newQuote);
      setProposalVersions([]);
      
      toast.success(`Proposal #${newQuote.proposal_number} created!`);
    } catch (error: any) {
      console.error('Error creating quote:', error);
      toast.error('Failed to create proposal number');
    }
  }

  // Proposal navigation functions
  async function navigateToFirstProposal() {
    if (formalJobQuotes.length === 0) return;
    const firstQuote = formalJobQuotes[0];
    if (quote?.id === firstQuote.id) return;
    setEstimateCatalogViewOpen(false);
    await commitProposalSwitch(firstQuote);
  }

  async function navigateToPreviousProposal() {
    if (formalJobQuotes.length === 0) return;

    const currentIndex = formalJobQuotes.findIndex(q => q.id === quote?.id);
    if (currentIndex < formalJobQuotes.length - 1) {
      const olderQuote = formalJobQuotes[currentIndex + 1];
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H4-double-load',
        location: 'JobFinancials.tsx:navigateToPreviousProposal',
        message: 'proposal navigation',
        data: { from: quote?.id ?? null, to: olderQuote.id, proposalNumber: (olderQuote as any)?.proposal_number ?? null },
      });
      setEstimateCatalogViewOpen(false);
      await commitProposalSwitch(olderQuote);
    }
  }

  async function navigateToNextProposal() {
    if (formalJobQuotes.length === 0) return;
    
    const currentIndex = formalJobQuotes.findIndex(q => q.id === quote?.id);
    if (currentIndex > 0) {
      const newerQuote = formalJobQuotes[currentIndex - 1];
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H4-double-load',
        location: 'JobFinancials.tsx:navigateToNextProposal',
        message: 'proposal navigation',
        data: { from: quote?.id ?? null, to: newerQuote.id, proposalNumber: (newerQuote as any)?.proposal_number ?? null },
      });
      setEstimateCatalogViewOpen(false);
      await commitProposalSwitch(newerQuote);
    }
  }

  async function navigateToProposal(selectedQuote: any) {
    if (!selectedQuote || selectedQuote.id === quote?.id) return;
    setEstimateCatalogViewOpen(false);
    await commitProposalSwitch(selectedQuote);
  }

  /**
   * Align material_workbooks with office lock for single-workbook proposals only.
   * When a signed contract already has a locked snapshot + job-tracking working copy, do not mass-flip
   * statuses — that would corrupt the pair. Skip in those cases.
   */
  async function syncMaterialWorkbookLockForQuote(quoteId: string, workbookLocked: boolean) {
    const { data: wbs, error: listErr } = await supabase
      .from('material_workbooks')
      .select('id, status')
      .eq('quote_id', quoteId);
    if (listErr) {
      console.warn('syncMaterialWorkbookLockForQuote list:', listErr);
      return;
    }
    const list = wbs || [];
    const hasLocked = list.some((w: { status: string }) => w.status === 'locked');
    const hasWorking = list.some((w: { status: string }) => w.status === 'working');

    if (workbookLocked) {
      if (hasLocked) {
        // Contract snapshot already exists — keep working copy writable for shop/crew; quote.locked_for_editing still drives UI read-only.
        return;
      }
    } else {
      if (hasLocked && hasWorking) {
        // Do not convert contract snapshots to working when an ops copy already exists (would corrupt signed totals).
        return;
      }
    }

    const targetStatus = workbookLocked ? 'locked' : 'working';
    const fromStatus = workbookLocked ? 'working' : 'locked';
    const { error } = await supabase
      .from('material_workbooks')
      .update({ status: targetStatus, updated_at: new Date().toISOString() })
      .eq('quote_id', quoteId)
      .eq('status', fromStatus);
    if (error) {
      console.warn('syncMaterialWorkbookLockForQuote:', error);
      return;
    }
    if (job?.id) {
      window.dispatchEvent(
        new CustomEvent('materials-workbook-updated', { detail: { jobId: job.id, quoteId } })
      );
    }
  }

  async function unlockHistoricalForEditing() {
    if (!quote || !isDefaultLocked) return;
    await syncMaterialWorkbookLockForQuote(quote.id, false);
    setEffectiveHistoricalUnlockedQuoteId(quote.id);
    await loadData(false, quote, { forceLive: true });
    try {
      window.dispatchEvent(new CustomEvent('proposal-editing-unlocked', { detail: { quoteId: quote.id } }));
    } catch {
      // ignore
    }
    toast.success('Editing enabled for this proposal. Changes save to this proposal.');
  }

  function lockHistoricalAgain() {
    if (!quote) return;
    setEffectiveHistoricalUnlockedQuoteId(null);
    setTimeout(() => loadData(false, quote), 0);
    toast.info('Proposal locked. Viewing read-only.');
  }

  /** Copy customer portal URL with current proposal so portal total matches this GRAND TOTAL. */
  async function copyPortalLinkForThisProposal() {
    if (!job?.id || !quote?.id) return;
    if ((quote as any).is_customer_estimate === true || estimateCatalogViewOpen) {
      toast.info(
        'Estimates are hidden from the customer portal. Close the price-list estimate or convert a legacy estimate, then copy the portal link.'
      );
      return;
    }
    try {
      const { data: link } = await supabase
        .from('customer_portal_access')
        .select('access_token')
        .eq('job_id', job.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (!link?.access_token) {
        toast.error('Create a portal link in the Portal tab first.');
        return;
      }
      const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/customer-portal?token=${link.access_token}&quote=${quote.id}`;
      await navigator.clipboard.writeText(url);
      toast.success('Portal link copied. Customer will see this proposal and the same total.');
    } catch {
      toast.error('Could not copy link.');
    }
  }

  async function lockProposalForEditing() {
    if (!quote?.id) return;
    const { error } = await supabase
      .from('quotes')
      .update({ locked_for_editing: true })
      .eq('id', quote.id);
    if (error) {
      console.error('Error locking proposal:', error);
      toast.error('Failed to lock. If the column is missing, run in Supabase SQL Editor: ALTER TABLE quotes ADD COLUMN IF NOT EXISTS locked_for_editing boolean DEFAULT false;');
      return;
    }
    await syncMaterialWorkbookLockForQuote(quote.id, true);
    const refreshed = await loadQuoteData();
    await loadData(false, refreshed ?? quote);
    toast.success('Proposal locked for all users. Click Unlock to allow editing again.');
  }

  async function unlockProposalForEditing() {
    if (!quote?.id) return;
    const { error } = await supabase
      .from('quotes')
      .update({ locked_for_editing: false })
      .eq('id', quote.id);
    if (error) {
      console.error('Error unlocking proposal:', error);
      toast.error('Failed to unlock.');
      return;
    }
    await syncMaterialWorkbookLockForQuote(quote.id, false);
    const refreshed = await loadQuoteData();
    const qAfter = refreshed ?? quote;
    await loadData(false, qAfter);
    // Signed jobs stay "default locked" by contract flag alone; grant the same session edit pass as Unlock for historical
    // so one click clears office lock and enables the proposal workbook + left panel together.
    if (qAfter && quoteHasActiveContract(qAfter as any)) {
      setEffectiveHistoricalUnlockedQuoteId(qAfter.id);
    }
    try {
      window.dispatchEvent(new CustomEvent('proposal-editing-unlocked', { detail: { quoteId: quote.id } }));
    } catch {
      // ignore
    }
    toast.success('Proposal unlocked. Edits are allowed for all users.');
  }

  function handleLockUnlock() {
    if (!quote) return;
    if (isReadOnly) {
      // Allow unlock even after sent: DB lock applies to all users; otherwise session-only unlock
      if ((quote as any).locked_for_editing) {
        unlockProposalForEditing();
        return;
      }
      unlockHistoricalForEditing();
    } else {
      lockProposalForEditing();
    }
  }

  async function loadData(silent = false, targetQuote?: any, options?: { forceLive?: boolean }) {
    // targetQuote must be passed explicitly from navigation functions to avoid
    // the stale-closure bug: setQuote() is async, so `quote` state hasn't
    // committed by the time the load functions run. When undefined (polling),
    // we fall back to the current `quote` state — which is acceptable for
    // polling since no navigation is in flight.
    const effectiveQuote = targetQuote !== undefined ? targetQuote : quote;
    const targetQuoteId: string | null = effectiveQuote?.id ?? null;
    const contractFrozen = isQuoteContractFrozen(effectiveQuote as any);
    const officeLocked = !!(effectiveQuote as any)?.locked_for_editing;

    // When user has unlocked a historical proposal for editing, load live data for it (or forceLive for this load)
    const isHistorical = !options?.forceLive && !!effectiveQuote
      && allJobQuotes.length > 0
      && effectiveQuote.id !== allJobQuotes[0]?.id
      && effectiveQuote.id !== effectiveHistoricalUnlockedQuoteId;

    if (!silent) {
      setLoading(true);
    }
    financialLoadInFlightRef.current = true;
    const loadCoopGen = ++financialLoadCoopGenRef.current;
    try {
      await waitForProposalSwitchGate();
      // IMPORTANT: When a proposal is locked (either contract-frozen OR office-locked), `loadCustomRows` relies on the
      // currently displayed sheet IDs to fetch sheet-linked line items (Add Labor). Load materials first to avoid a
      // race where sheet IDs are empty and labor disappears from locked totals until a later refresh/unlock cycle.
      if (contractFrozen || officeLocked) {
        await loadMaterialsData(targetQuoteId, isHistorical, undefined, loadCoopGen);
        if (isFinancialLoadStale(loadCoopGen)) return;
        await Promise.all([
          loadCustomRows(targetQuoteId, isHistorical, loadCoopGen),
          loadLaborPricing(),
          loadLaborHours(),
          loadSubcontractorEstimates(targetQuoteId, isHistorical, loadCoopGen),
        ]);
      } else {
        // Even when editable, sheet-linked line items (Add Labor) can depend on workbook/sheet resolution.
        // Load materials first whenever a quote is active to prevent races when switching proposals.
        if (targetQuoteId) {
          await loadMaterialsData(targetQuoteId, isHistorical, undefined, loadCoopGen);
          if (isFinancialLoadStale(loadCoopGen)) return;
          await Promise.all([
            loadCustomRows(targetQuoteId, isHistorical, loadCoopGen),
            loadLaborPricing(),
            loadLaborHours(),
            loadSubcontractorEstimates(targetQuoteId, isHistorical, loadCoopGen),
          ]);
        } else {
          await Promise.all([
            loadCustomRows(targetQuoteId, isHistorical, loadCoopGen),
            loadLaborPricing(),
            loadLaborHours(),
            loadMaterialsData(targetQuoteId, isHistorical, undefined, loadCoopGen),
            loadSubcontractorEstimates(targetQuoteId, isHistorical, loadCoopGen),
          ]);
        }
      }

      // Materials panel syncs its workbook asynchronously after proposal switch. While loadCustomRows /
      // subs were loading, externalMaterialsWorkbookViewRef may now point at a different (often working) workbook
      // that holds section labor. Retry once when first pass had zero labor and the synced workbook differs.
      if (!isFinancialLoadStale(loadCoopGen) && targetQuoteId) {
        const extNow = externalMaterialsWorkbookViewRef.current;
        const extWbId = extNow?.workbookId ? String(extNow.workbookId).trim() : '';
        const loadedWbId = displayedWorkbookIdRef.current || '';
        const sheetLineItemLabor = resolvedSheetLineItemLaborForQuote(targetQuoteId);
        const laborZero =
          lastMaterialsLaborTotalRef.current === 0 && sheetLineItemLabor === 0;
        const pending = pendingMaterialsWorkbookReloadRef.current;
        pendingMaterialsWorkbookReloadRef.current = false;
        const shouldRetryMaterials =
          pending || (laborZero && !!extWbId && extWbId !== loadedWbId);

        if (shouldRetryMaterials) {
          agentDebugLog({
            runId: 'post-fix',
            hypothesisId: 'H3-workbook',
            location: 'JobFinancials.tsx:loadData:retryAfterExtSync',
            message: 'retry loadMaterialsData — materials workbook synced during loadData',
            data: {
              targetQuoteId,
              extWbId,
              loadedWbId,
              extStatus: extNow?.status ?? null,
              pending,
              laborZero,
              sheetLineItemLabor,
            },
          });
          await loadMaterialsData(targetQuoteId, isHistorical, undefined, loadCoopGen);
          if (!isFinancialLoadStale(loadCoopGen)) {
            await loadCustomRows(targetQuoteId, isHistorical, loadCoopGen);
            await refreshSheetSectionLineItemsForQuote(targetQuoteId, loadCoopGen);
          }
        }
      }
    } catch (error) {
      console.error('Error loading financial data:', error);
      if (!silent) {
        toast.error('Failed to load financial data');
      }
    } finally {
      financialLoadInFlightRef.current = false;
      if (!silent) {
        setLoading(false);
      }
    }
  }

  async function loadSubcontractorEstimates(
    targetQuoteId: string | null = null,
    isHistorical: boolean = false,
    cooperativeGen?: number
  ) {
    try {
      // Locked/historical proposals: always load live data so subcontractor rows and pricing always show
      if (isHistorical && targetQuoteId) {
        console.log('📝 Loading live subcontractors for locked/historical proposal');
        isHistorical = false;
      }
      if (false && isHistorical && targetQuoteId) {
        const { data: versionData, error: versionError } = await supabase
          .from('proposal_versions')
          .select('subcontractor_snapshot')
          .eq('quote_id', targetQuoteId)
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (versionError) {
          console.error('Error loading proposal version for subcontractors:', versionError);
          throw versionError;
        }
        
        if (!versionData || !versionData.subcontractor_snapshot) {
          isHistorical = false;
        } else {
        const snapshot = versionData.subcontractor_snapshot;
        const estimatesData = Array.isArray(snapshot) ? snapshot : [];
        
        if (JSON.stringify(estimatesData) !== JSON.stringify(subcontractorEstimates)) {
          setSubcontractorEstimates(estimatesData);
        }
        
        const linkedMap: Record<string, any[]> = {};
        const lineItemsMap: Record<string, any[]> = {};
        
        estimatesData.forEach((est: any) => {
          if (est.sheet_id) {
            if (!linkedMap[est.sheet_id]) linkedMap[est.sheet_id] = [];
            linkedMap[est.sheet_id].push(est);
          } else if (est.row_id) {
            if (!linkedMap[est.row_id]) linkedMap[est.row_id] = [];
            linkedMap[est.row_id].push(est);
          }
          if (est.line_items && Array.isArray(est.line_items)) {
            lineItemsMap[est.id] = est.line_items;
          }
        });
        
        setLinkedSubcontractors(linkedMap);
        setSubcontractorLineItems(lineItemsMap);
        console.log('✅ Loaded subcontractors from snapshot');
        return;
        }
      }
      
      // Live path: load estimates for this proposal OR job-level uploads (quote_id null) so subs
      // uploaded by another user or without a proposal selected appear in the proposal
      let rawData: any[] = [];
      if (targetQuoteId) {
        const [forQuote, forJob, removed] = await Promise.all([
          supabase.from('subcontractor_estimates').select('*, subcontractor_estimate_line_items(*)').eq('quote_id', targetQuoteId).order('order_index'),
          supabase.from('subcontractor_estimates').select('*, subcontractor_estimate_line_items(*)').eq('job_id', job.id).is('quote_id', null).order('order_index'),
          supabase.from('quote_removed_sections').select('section_id').eq('quote_id', targetQuoteId).eq('section_type', 'subcontractor_estimate'),
        ]);
        if (forQuote.error) throw forQuote.error;
        if (forJob.error) throw forJob.error;
        const removedEstIds = isMissingQuoteRemovedSectionsError(removed.error)
          ? new Set<string>()
          : new Set((removed.data || []).map((r: any) => r.section_id));
        const quoteIds = new Set((forQuote.data || []).map((e: any) => e.id));
        rawData = [...(forQuote.data || [])];
        if (!jobHasMultipleFormalProposals(allJobQuotes)) {
          const jobOnly = (forJob.data || []).filter((e: any) => !quoteIds.has(e.id) && !removedEstIds.has(e.id));
          rawData = [...rawData, ...jobOnly];
        }
      } else {
        const { data, error } = await supabase
          .from('subcontractor_estimates')
          .select('*, subcontractor_estimate_line_items(*)')
          .eq('job_id', job.id)
          .order('order_index');
        if (error) throw error;
        rawData = data || [];
      }

      if (isFinancialLoadStale(cooperativeGen)) return;

      // Strip the nested relation out so state only holds flat estimate objects
      const scopeId = targetQuoteId ? `quote:${targetQuoteId}` : `job:${job.id}`;
      const persistedSubOptional = readSubOptionalStorage(scopeId);
      const estimatesOnly = rawData.map((est: any) => {
        const { subcontractor_estimate_line_items: _items, ...estimateData } = est;
        const normalizedOptional = toBool(estimateData.is_option);
        const persistedOptional = Object.prototype.hasOwnProperty.call(persistedSubOptional, estimateData.id)
          ? !!persistedSubOptional[estimateData.id]
          : normalizedOptional;
        const overlaidOptional = Object.prototype.hasOwnProperty.call(optionalSubOverlay, estimateData.id)
          ? !!optionalSubOverlay[estimateData.id]
          : persistedOptional;
        return { ...estimateData, is_option: overlaidOptional };
      });

      if (JSON.stringify(estimatesOnly) !== JSON.stringify(subcontractorEstimates)) {
        setSubcontractorEstimates(estimatesOnly);
      }

      // Build linked-subcontractors map.
      // When a sub's `sheet_id` references a sibling workbook's sheet (e.g. the
      // sub was originally pinned to the locked contract workbook's Pavilion
      // sheet but the displayed proposal is the working workbook with a
      // different Pavilion sheet id), also alias the sub under the DISPLAYED
      // sheet id via siblingSheetRemapRef. Mirrors the orphan-labor merge in
      // loadMaterialsData so cards like "Cedar Post Changes" stop disappearing
      // whenever the chosen workbook flips between sibling versions.
      const linkedMap: Record<string, any[]> = {};
      const remap = siblingSheetRemapRef.current || {};
      const pushLinked = (key: string, est: any) => {
        if (!linkedMap[key]) linkedMap[key] = [];
        if (!linkedMap[key].some((e: any) => e?.id === est?.id)) {
          linkedMap[key].push(est);
        }
      };
      estimatesOnly.forEach((est: any) => {
        if (est.sheet_id) {
          pushLinked(String(est.sheet_id), est);
          const remapped = remap[String(est.sheet_id)];
          if (remapped && remapped !== String(est.sheet_id)) {
            pushLinked(remapped, est);
          }
        } else if (est.row_id) {
          pushLinked(String(est.row_id), est);
        }
      });
      setLinkedSubcontractors(linkedMap);

      // Build line-items map directly from the nested response
      const lineItemsMap: Record<string, any[]> = {};
      rawData.forEach((est: any) => {
        if (est.subcontractor_estimate_line_items?.length > 0) {
          lineItemsMap[est.id] = est.subcontractor_estimate_line_items;
        }
      });
      setSubcontractorLineItems(lineItemsMap);
    } catch (error: any) {
      console.error('Error loading subcontractor estimates:', error);
      if (subcontractorEstimates.length > 0) {
        setSubcontractorEstimates([]);
      }
    }
  }

  /** Copy a job's existing material workbook into this proposal so materials appear in the proposal by default. */
  async function copyJobWorkbookToQuote(jobId: string, quoteId: string): Promise<any | null> {
    if (!profile?.id) return null;
    // Only seed from a job-level workbook (quote_id null) — never clone another proposal's workbook.
    const { data: sourceWb, error: srcErr } = await supabase
      .from('material_workbooks')
      .select('id')
      .eq('job_id', jobId)
      .is('quote_id', null)
      .order('status', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (srcErr || !sourceWb) return null;

    const { data: fullWb, error: fullErr } = await supabase
      .from('material_workbooks')
      .select(`
        id,
        material_sheets (
          *,
          material_items (*),
          material_sheet_labor (*),
          material_category_markups (*)
        )
      `)
      .eq('id', sourceWb.id)
      .single();
    if (fullErr || !fullWb?.material_sheets?.length) return null;

    const { data: maxRow } = await supabase
      .from('material_workbooks')
      .select('version_number')
      .eq('job_id', jobId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxRow?.version_number ?? 0) + 1;

    const { data: newWb, error: insErr } = await supabase
      .from('material_workbooks')
      .insert({
        job_id: jobId,
        quote_id: quoteId,
        version_number: nextVersion,
        status: 'working',
        created_by: profile.id,
      })
      .select('id')
      .single();
    if (insErr || !newWb) return null;

    const sheetIdMap: Record<string, string> = {};
    const sheets = (fullWb.material_sheets || []).slice().sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));

    for (const sheet of sheets) {
      const { data: newSheet, error: shErr } = await supabase
        .from('material_sheets')
        .insert({
          workbook_id: newWb.id,
          sheet_name: sheet.sheet_name,
          order_index: sheet.order_index ?? 0,
          is_option: toBool(sheet.is_option),
          description: sheet.description ?? null,
        })
        .select('id')
        .single();
      if (shErr || !newSheet) continue;
      sheetIdMap[sheet.id] = newSheet.id;

      const items = (sheet.material_items || []).slice().sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
      if (items.length) {
        const itemRows = items.map(({ id: _id, sheet_id: _s, created_at: _ca, updated_at: _ua, ...r }: any) => ({ ...r, sheet_id: newSheet.id }));
        await supabase.from('material_items').insert(itemRows);
      }
      const labor = sheet.material_sheet_labor || [];
      if (labor.length) {
        const laborRows = labor.map(({ id: _id, sheet_id: _s, created_at: _ca, updated_at: _ua, ...r }: any) => ({ ...r, sheet_id: newSheet.id }));
        await supabase.from('material_sheet_labor').insert(laborRows);
      }
      const markups = sheet.material_category_markups || [];
      if (markups.length) {
        const markupRows = markups.map(({ id: _id, sheet_id: _s, created_at: _ca, updated_at: _ua, ...r }: any) => ({ ...r, sheet_id: newSheet.id }));
        await supabase.from('material_category_markups').insert(markupRows);
      }
    }

    const { data: created, error: fetchErr } = await supabase
      .from('material_workbooks')
      .select(`
        id,
        material_sheets (
          *,
          material_items (*),
          material_sheet_labor (*),
          material_category_markups (*)
        )
      `)
      .eq('id', newWb.id)
      .single();
    if (fetchErr || !created) return null;
    return created;
  }

  // Keep the ref current so the event handler always has fresh values (avoids stale closure bugs)
  workbookUpdateCtxRef.current = {
    jobId: job.id,
    quoteId: quote?.id ?? null,
    allJobQuotesFirstId: formalJobQuotes[0]?.id ?? allJobQuotes[0]?.id,
    historicalUnlockedQuoteId: effectiveHistoricalUnlockedQuoteId,
    loadMaterialsData,
    loadSubcontractorEstimates,
  };

  async function loadMaterialsData(
    targetQuoteId: string | null = null,
    isHistorical: boolean = false,
    overlayOverride?: Record<string, boolean>,
    cooperativeGen?: number
  ) {
    const wasHistoricalRequest = isHistorical;
    const extView = externalMaterialsWorkbookViewRef.current;
    // #region agent log
    agentDebugLog({
      runId: 'post-fix',
      hypothesisId: 'H3-workbook',
      location: 'JobFinancials.tsx:loadMaterialsData:start',
      message: 'loadMaterialsData invoked',
      data: {
        targetQuoteId,
        cooperativeGen,
        currentGen: financialLoadCoopGenRef.current,
        extWbIdRef: extView?.workbookId ?? null,
        extWbStatusRef: extView?.status ?? null,
        extWbIdClosure: externalMaterialsWorkbookView?.workbookId ?? null,
      },
    });
    // #endregion
    try {
      // Historical (locked/older) proposals: always load live data from DB so labor and materials
      // always show. Snapshots created when cloning can be incomplete and hide labor/subs.
      if (isHistorical && targetQuoteId) {
        console.log('📝 Loading live materials for locked/historical proposal so labor and rows show');
        isHistorical = false;
      }
      if (false && isHistorical && targetQuoteId) {
        const { data: versionData, error: versionError } = await supabase
          .from('proposal_versions')
          .select('workbook_snapshot')
          .eq('quote_id', targetQuoteId)
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (versionError) {
          console.error('Error loading proposal version:', versionError);
          throw versionError;
        }
        
        if (!versionData || !versionData.workbook_snapshot) {
          isHistorical = false;
        } else {
        // Parse and use the snapshot data
        const snapshot = versionData.workbook_snapshot;
        const sheetsData = snapshot.sheets || [];
        
        // Store sheets data
        setMaterialSheets(sheetsData);
        
        // Load category markups from snapshot
        const categoryMarkupsMap: Record<string, number> = {};
        if (snapshot.category_markups) {
          Object.entries(snapshot.category_markups).forEach(([key, value]) => {
            categoryMarkupsMap[key] = value as number;
          });
        }
        setCategoryMarkups(categoryMarkupsMap);
        
        // Load sheet labor from snapshot first
        const laborMap: Record<string, any> = {};
        if (snapshot.sheet_labor) {
          snapshot.sheet_labor.forEach((labor: any) => {
            laborMap[labor.sheet_id] = labor;
          });
        }
        // Supplement with live labor from DB so labor does not disappear when viewing a locked proposal
        const sheetIds = sheetsData.map((s: any) => s.id).filter(Boolean);
        if (sheetIds.length > 0) {
          const { data: liveLaborRows } = await supabase
            .from('material_sheet_labor')
            .select('*')
            .in('sheet_id', sheetIds);
          (liveLaborRows || []).forEach((labor: any) => {
            const total = labor.total_labor_cost ?? (Number(labor.estimated_hours || 0) * Number(labor.hourly_rate || 0));
            laborMap[labor.sheet_id] = { ...labor, total_labor_cost: total };
          });
        }
        setSheetLabor(laborMap);
        
        // Build materials breakdown from snapshot
        const breakdowns = sheetsData.map((sheet: any) => {
          const sheetItems = sheet.items || [];
          
          // Group by category
          const categoryMap = new Map<string, any[]>();
          sheetItems.forEach((item: any) => {
            const category = item.category || 'Uncategorized';
            if (!categoryMap.has(category)) {
              categoryMap.set(category, []);
            }
            categoryMap.get(category)!.push(item);
          });
          
          // Calculate totals per category from item-level prices (no category-level recalculation).
          const snapEffectivePrice = (item: any) =>
            (item.extended_price != null && item.extended_price !== '')
              ? Number(item.extended_price)
              : (Number(item.quantity) || 0) * (Number(item.price_per_unit) || 0);
          const categories = Array.from(categoryMap.entries()).map(([categoryName, items]) => {
            const totalCost = items
              .filter((item: any) => !toBool(item.is_optional))
              .reduce((sum, item) => {
                const extended = Number(item.extended_cost) || 0;
                if (extended > 0) return sum + extended;
                return sum + ((Number(item.cost_per_unit) || 0) * (Number(item.quantity) || 0));
              }, 0);
            const totalPrice = items
              .filter((item: any) => !toBool(item.is_optional))
              .reduce((sum, item) => sum + snapEffectivePrice(item), 0);
            
            const profit = totalPrice - totalCost;
            const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;
            
            return {
              name: categoryName,
              itemCount: items.length,
              items: items.map((item: any) => ({
                id: item.id,
                order_index: item.order_index ?? 0,
                isOptional: toBool(item.is_optional),
                material_name: item.material_name,
                sku: item.sku,
                quantity: item.quantity || 0,
                cost_per_unit: item.cost_per_unit || 0,
                price_per_unit: item.price_per_unit || 0,
                extended_cost: (item.extended_cost != null && item.extended_cost !== '')
                  ? Number(item.extended_cost)
                  : (Number(item.cost_per_unit) || 0) * (Number(item.quantity) || 0),
                extended_price: (item.extended_price != null && item.extended_price !== '')
                  ? Number(item.extended_price)
                  : (Number(item.quantity) || 0) * (Number(item.price_per_unit) || 0),
              })),
              totalCost,
              totalPrice,
              profit,
              margin,
            };
          }).sort((a, b) => {
            const categoryOrder = Array.isArray((sheet as any).category_order) ? (sheet as any).category_order as string[] : [];
            const orderMap = new Map(categoryOrder.map((name, idx) => [name, idx]));
            const ai = orderMap.has(a.name) ? orderMap.get(a.name)! : Infinity;
            const bi = orderMap.has(b.name) ? orderMap.get(b.name)! : Infinity;
            if (ai !== bi) return ai - bi;
            const aMinOrder = Math.min(...(a.items || []).map((it: any) => Number(it.order_index ?? Infinity)));
            const bMinOrder = Math.min(...(b.items || []).map((it: any) => Number(it.order_index ?? Infinity)));
            if (aMinOrder !== bMinOrder) return aMinOrder - bMinOrder;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
          });
          
          // Calculate sheet totals
          const sheetTotalCost = categories.reduce((sum, cat) => sum + cat.totalCost, 0);
          const sheetTotalPrice = categories.reduce((sum, cat) => sum + cat.totalPrice, 0);
          const sheetProfit = sheetTotalPrice - sheetTotalCost;
          const sheetMargin = sheetTotalPrice > 0 ? (sheetProfit / sheetTotalPrice) * 100 : 0;
          
          return {
            sheetId: sheet.id,
            sheetName: sheet.sheet_name,
            sheetDescription: sheet.description || '',
            orderIndex: sheet.order_index,
            isOptional: Object.prototype.hasOwnProperty.call(optionalSheetOverlay, sheet.id)
              ? !!optionalSheetOverlay[sheet.id]
              : toBool(sheet.is_option),
            compareToSheetId: sheet.compare_to_sheet_id ?? null,
            sheetType: sheet.sheet_type ?? 'proposal',
            changeOrderSeq: sheet.change_order_seq ?? null,
            categories,
            totalCost: sheetTotalCost,
            totalPrice: sheetTotalPrice,
            profit: sheetProfit,
            margin: sheetMargin,
          };
        });
        
        // Grand totals: exclude change_order sheets so proposal total stays separate
        const proposalBreakdownsSnap = breakdowns.filter((b: any) => {
          const s = sheetsData.find((sd: any) => sd.id === b.sheetId);
          return s?.sheet_type !== 'change_order';
        });
        const grandTotalCost = proposalBreakdownsSnap.reduce((sum, sheet) => sum + sheet.totalCost, 0);
        const grandTotalPrice = proposalBreakdownsSnap.reduce((sum, sheet) => sum + sheet.totalPrice, 0);
        const grandProfit = grandTotalPrice - grandTotalCost;
        const grandMargin = grandTotalPrice > 0 ? (grandProfit / grandTotalPrice) * 100 : 0;
        
        setMaterialsBreakdown({
          sheetBreakdowns: breakdowns,
          totals: {
            totalCost: grandTotalCost,
            totalPrice: grandTotalPrice,
            totalProfit: grandProfit,
            profitMargin: grandMargin,
          }
        });
        
        console.log('✅ Loaded materials from snapshot');
        return;
        }
      }
      
      // Air-gap: when a quote is active load ONLY by quote_id; fall back to job_id only when no quote.
      console.log('📝 Loading live materials data');
      // Reset the sibling remap before each fresh load so a previous proposal's
      // (orphan_sheet_id → displayed_sheet_id) entries can't bleed into this load.
      siblingSheetRemapRef.current = {};
      const hasQuote = targetQuoteId != null && targetQuoteId !== '';
      const isolateProposalsOnJob = jobHasMultipleFormalProposals(allJobQuotes);
      let workbookData: any = null;
      let workbookError: any = null;
      let usedFallbackWorkbook = false;
      let proposalWorkbookIdForLabor: string | null = null;

      if (hasQuote) {
        const wbSelect = `
          id,
          status,
          quote_id,
          material_sheets (
            *,
            material_items (*),
            material_sheet_labor (*),
            material_category_markups (*)
          )
        `;
        // Used later for empty-workbook fallback rules (must be outer scope).
        let contractFrozen = false;
        // If the split-view materials panel is explicitly viewing a workbook, mirror that here
        // so the proposal totals stay attached to the same snapshot (never influenced by a stale closure).
        if (extView?.workbookId && (extView.status === 'locked' || extView.status === 'working')) {
          const extWbId = String(extView.workbookId).trim();
          const { data: forcedWb, error: forcedErr } = await supabase
            .from('material_workbooks')
            .select(wbSelect)
            .eq('id', extWbId)
            .limit(1)
            .maybeSingle();
          if (forcedErr) throw forcedErr;
          const forcedQuoteId = String((forcedWb as { quote_id?: string | null })?.quote_id ?? '').trim();
          if (forcedWb && forcedQuoteId && forcedQuoteId === targetQuoteId) {
            workbookData = forcedWb;
            workbookError = null;
          }
        } else {
        const { data: quoteRowForMaterials } = await fetchQuoteContractRow(supabase, targetQuoteId);
        contractFrozen = isQuoteContractFrozen(quoteRowForMaterials as any);

        // Locked + working rows for the same quote = contract snapshot + job workbook. Proposal totals must always
        // read the locked row so edits on the job workbook never move Materials / GRAND TOTAL (even if quote contract
        // flags are missing or momentarily out of sync with the DB).
        const { data: wbPairProbe } = await supabase
          .from('material_workbooks')
          .select('status')
          .eq('quote_id', targetQuoteId);
        const pairStatuses = new Set((wbPairProbe || []).map((r: { status?: string }) => r.status));
        if (pairStatuses.has('locked') && pairStatuses.has('working')) {
          contractFrozen = true;
        }

        // Non–first-proposal tab: same workbook priority as MaterialsManagement (workingList[0] ?? lockedList[0]),
        // both sorted by version_number desc — NOT updated_at alone, or locking the working copy can surface an
        // older locked snapshot and change materials totals on the left panel.
        if (contractFrozen) {
          // Office lock OR signed contract: one `locked` workbook row holds the proposal materials total (no edits on a separate job workbook affect this).
          // When signed contract + working duplicate exists, this is always the locked snapshot; when office-locked only, it is the single flipped workbook.
          const { data: lockedRows, error: lockedErr } = await supabase
            .from('material_workbooks')
            .select(wbSelect)
            .eq('quote_id', targetQuoteId)
            .eq('status', 'locked')
            .order('version_number', { ascending: false });
          workbookError = lockedErr;
          workbookData =
            Array.isArray(lockedRows) && lockedRows.length > 0 ? lockedRows[0] : null;
          usedFallbackWorkbook = false;
          proposalWorkbookIdForLabor = null;
          if (!workbookData && !workbookError) {
            // Hard guarantee: do NOT fall back to working when this quote is frozen/locked.
            // Falling back would let working edits change locked proposal totals.
            toast.error('Locked proposal workbook not found. Create/restore the locked contract workbook to view locked totals.');
          }
        } else {
          // Draft: prefer the working workbook with the most labor/items (clone can create multiple working rows).
          const { data: workingRows, error: workingErr } = await supabase
            .from('material_workbooks')
            .select(wbSelect)
            .eq('quote_id', targetQuoteId)
            .eq('status', 'working')
            .order('version_number', { ascending: false });
          workbookData = pickWorkbookForProposalClone(workingRows || []) ?? null;
          workbookError = workingErr;

          if (!workbookData && !workbookError) {
            const { data: lockedRows, error: lockedErr } = await supabase
              .from('material_workbooks')
              .select(wbSelect)
              .eq('quote_id', targetQuoteId)
              .eq('status', 'locked')
              .order('version_number', { ascending: false });
            workbookData = pickWorkbookForProposalClone(lockedRows || []) ?? null;
            workbookError = lockedErr;
          }

          if (!workbookData && !workbookError) {
            const { data: anyRows, error: anyErr } = await supabase
              .from('material_workbooks')
              .select(wbSelect)
              .eq('quote_id', targetQuoteId)
              .order('version_number', { ascending: false })
              .order('updated_at', { ascending: false });
            workbookData = pickWorkbookForProposalClone(anyRows || []) ?? null;
            workbookError = anyErr;
          }
        }
        }

        if (!workbookData && hasQuote && !isolateProposalsOnJob) {
          const copied = await copyJobWorkbookToQuote(job.id, targetQuoteId);
          if (copied) workbookData = copied;
        }
        // If proposal workbook is empty (no sheets/items), use job-level workbook so a single-proposal job still shows prices.
        // NEVER borrow job-level (or any shared) workbook when multiple formal proposals exist — both would display and
        // edit the same sheet_ids, so changes on #26049-2 would alter #26049-1.
        const sheetsFromWb = workbookData?.material_sheets || [];
        const itemCount = sheetsFromWb.reduce((n: number, s: any) => n + ((s.material_items || []).length), 0);
        if (
          workbookData &&
          (sheetsFromWb.length === 0 || itemCount === 0) &&
          !isolateProposalsOnJob
        ) {
          if (contractFrozen) {
            usedFallbackWorkbook = false;
            proposalWorkbookIdForLabor = null;
          } else {
            proposalWorkbookIdForLabor = workbookData.id;
            const { data: jobLevelWbs } = await supabase
              .from('material_workbooks')
              .select(wbSelect)
              .eq('job_id', job.id)
              .is('quote_id', null)
              .order('updated_at', { ascending: false });
            for (const wb of jobLevelWbs || []) {
              const wbSheets = wb?.material_sheets || [];
              const wbItemCount = wbSheets.reduce((n: number, s: any) => n + ((s.material_items || []).length), 0);
              if (wbItemCount > 0) {
                workbookData = wb;
                usedFallbackWorkbook = true;
                break;
              }
            }
          }
        }
      } else {
        const { data, error } = await supabase
          .from('material_workbooks')
          .select(`
            id,
            material_sheets (
              *,
              material_items (*),
              material_sheet_labor (*),
              material_category_markups (*)
            )
          `)
          .eq('job_id', job.id)
          .eq('status', 'working')
          .maybeSingle();
        workbookData = data;
        workbookError = error;
      }

      if (workbookError) throw workbookError;

      if (workbookData && targetQuoteId) {
        const wbQuoteId = String((workbookData as any).quote_id ?? '').trim();
        if (wbQuoteId && wbQuoteId !== targetQuoteId) {
          console.warn(
            `[proposal-isolation] Rejected workbook ${workbookData.id} (quote_id=${wbQuoteId}) for proposal ${targetQuoteId}`,
          );
          workbookData = null;
        } else if (isolateProposalsOnJob && !wbQuoteId) {
          console.warn(
            `[proposal-isolation] Rejected legacy shared workbook ${workbookData.id} (quote_id null) for proposal ${targetQuoteId}`,
          );
          workbookData = null;
        }
      }

      // Air-gap: never load job-level workbook when a quote is active — each proposal stays isolated
      if (!workbookData) {
        if (isFinancialLoadStale(cooperativeGen)) return;
        setMaterialsBreakdown({
          sheetBreakdowns: [],
          totals: { totalCost: 0, totalPrice: 0, totalProfit: 0, profitMargin: 0 }
        });
        setMaterialSheets([]);
        setActiveWorkbookId(null);
        setActiveWorkbookStatus(null);
        const cachedById =
          targetQuoteId && sheetLaborByQuoteRef.current[targetQuoteId]
            ? sheetLaborByQuoteRef.current[targetQuoteId]
            : null;
        const cachedByName =
          targetQuoteId ? sheetLaborByNameByQuoteRef.current[targetQuoteId] : undefined;
        const priorSheetRefs = materialSheets.map((s: any) => ({
          id: String(s?.id ?? ''),
          sheet_name: s?.sheet_name,
          order_index: s?.order_index,
        }));
        const remappedCached =
          cachedById && priorSheetRefs.length > 0
            ? remapLaborPayloadToDisplayedSheets(priorSheetRefs, cachedById, cachedByName)
            : cachedById
              ? { ...cachedById }
              : null;
        if (remappedCached && laborMapTotal(remappedCached) > 0) {
          setSheetLabor(remappedCached);
        } else if (laborMapTotal(sheetLaborLiveRef.current) === 0) {
          setSheetLabor({});
        }
        setSheetMarkups({});
        return;
      }
      if (isFinancialLoadStale(cooperativeGen)) return;
      displayedWorkbookIdRef.current = String(workbookData.id ?? '') || null;
      setActiveWorkbookId(displayedWorkbookIdRef.current);
      setActiveWorkbookStatus((workbookData.status as any) ?? null);
      // #region agent log
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H3-workbook',
        location: 'JobFinancials.tsx:loadMaterialsData:workbookResolved',
        message: 'workbook picked for proposal',
        data: {
          targetQuoteId,
          workbookId: workbookData.id,
          wbStatus: workbookData.status,
          wbQuoteId: (workbookData as any).quote_id ?? null,
          sheetCount: (workbookData.material_sheets || []).length,
          nestedLaborCount: (workbookData.material_sheets || []).reduce(
            (n: number, s: any) => n + (s.material_sheet_labor || []).length,
            0,
          ),
          usedFallbackWorkbook,
          extWbIdRef: extView?.workbookId ?? null,
        },
      });
      // #endregion

      const sheetsData: any[] = (workbookData.material_sheets || [])
        .slice()
        .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));

      // Build flat sheet objects (strip nested children for state storage)
      const sheetsFlat = sheetsData.map(({ material_items: _i, material_sheet_labor: _l, material_category_markups: _m, ...s }: any) => s);
      if (JSON.stringify(sheetsFlat) !== JSON.stringify(materialSheets)) {
        if (!isFinancialLoadStale(cooperativeGen)) {
          setMaterialSheets(sheetsFlat);
        }
      }

      // Build labor map from nested data (include total_labor_cost so UI displays correctly)
      const laborMap: Record<string, any> = {};
      sheetsData.forEach((sheet: any) => {
        (sheet.material_sheet_labor || []).forEach((labor: any) => {
          const total = labor.total_labor_cost ?? (Number(labor.estimated_hours || 0) * Number(labor.hourly_rate || 0));
          const lk = String(labor.sheet_id ?? '').trim();
          if (lk) laborMap[lk] = { ...labor, total_labor_cost: total, sheet_id: lk, labor_source_sheet_id: lk };
        });
      });
      // For locked/sent proposals, nested material_sheet_labor may be missing; supplement from DB so labor always shows.
      // Do this per-sheet (not only when the whole map is empty) so partial nested loads don't hide labor.
      const sheetIdsForLabor = sheetsData.map((s: any) => s.id).filter(Boolean);
      if (sheetIdsForLabor.length > 0) {
        const { data: liveLaborRows } = await supabase
          .from('material_sheet_labor')
          .select('*')
          .in('sheet_id', sheetIdsForLabor);
        (liveLaborRows || []).forEach((labor: any) => {
          const total = labor.total_labor_cost ?? (Number(labor.estimated_hours || 0) * Number(labor.hourly_rate || 0));
          const lk = String(labor.sheet_id ?? '').trim();
          if (!lk) return;
          const prev = laborMap[lk];
          const prevTotal = prev
            ? Number(prev.total_labor_cost) ||
              Number(prev.estimated_hours || 0) * Number(prev.hourly_rate || 0)
            : 0;
          if (!prev || total > prevTotal) {
            laborMap[lk] = { ...labor, total_labor_cost: total, sheet_id: lk, labor_source_sheet_id: lk };
          }
        });
      }
      // When we displayed a fallback workbook (proposal had no sheets/items), labor was on the proposal's workbook;
      // fetch that labor and merge by sheet name so labor still shows on the right sections
      if (usedFallbackWorkbook && proposalWorkbookIdForLabor && hasQuote && !isolateProposalsOnJob) {
        const { data: proposalSheets } = await supabase
          .from('material_sheets')
          .select('id, sheet_name')
          .eq('workbook_id', proposalWorkbookIdForLabor);
        const proposalSheetIds = (proposalSheets || []).map((s: any) => s.id);
        if (proposalSheetIds.length > 0) {
          const { data: proposalLaborRows } = await supabase
            .from('material_sheet_labor')
            .select('*')
            .in('sheet_id', proposalSheetIds);
          const laborBySheetName = new Map<string, any>();
          (proposalSheets || []).forEach((s: any) => {
            const labor = (proposalLaborRows || []).find((l: any) => l.sheet_id === s.id);
            if (labor) {
              const total = labor.total_labor_cost ?? (Number(labor.estimated_hours || 0) * Number(labor.hourly_rate || 0));
              laborBySheetName.set(s.sheet_name || '', { ...labor, total_labor_cost: total });
            }
          });
          sheetsData.forEach((sheet: any) => {
            const name = sheet.sheet_name || '';
            if (laborBySheetName.has(name) && !laborMap[sheet.id]) {
              const labor = laborBySheetName.get(name)!;
              const sourceSid = String(labor.sheet_id ?? '').trim();
              laborMap[sheet.id] = {
                ...labor,
                sheet_id: sheet.id,
                total_labor_cost: labor.total_labor_cost,
                labor_source_sheet_id: sourceSid || String(sheet.id).trim(),
                labor_mergetrusted: true,
              };
            }
          });
        }
      }

      // Sheet-level labor often lives on a sibling workbook for the SAME quote (working vs locked,
      // or multiple working copies after clone). Merge onto displayed sheets by name / order_index.
      if (hasQuote && targetQuoteId && workbookData?.id) {
        try {
          const normalizeSheetName = (v: unknown) =>
            String(v ?? '')
              .toLowerCase()
              .trim()
              .replace(/\s+/g, ' ');
          const effectiveLaborTotal = (lab: any) => {
            const direct = Number(lab?.total_labor_cost);
            if (Number.isFinite(direct) && direct > 0) return direct;
            return Number(lab?.estimated_hours || 0) * Number(lab?.hourly_rate || 0);
          };
          const displayedByName = new Map<string, string>();
          const displayedByOrder = new Map<number, string>();
          sheetsData.forEach((s: any) => {
            const sid = String(s?.id ?? '').trim();
            if (!sid) return;
            const nameKey = normalizeSheetName(s?.sheet_name);
            if (nameKey && !displayedByName.has(nameKey)) displayedByName.set(nameKey, sid);
            const oi = Number(s?.order_index);
            if (Number.isFinite(oi) && !displayedByOrder.has(oi)) displayedByOrder.set(oi, sid);
          });

          const displayedWbId = String(workbookData.id ?? '').trim();
          const { data: quoteWbs } = await supabase.from('material_workbooks').select('id').eq('quote_id', targetQuoteId);
          const otherWbIds = (quoteWbs || [])
            .map((w: any) => String(w?.id ?? '').trim())
            .filter((id: string) => id && id !== displayedWbId);
          if (otherWbIds.length > 0) {
            const { data: otherSheets } = await supabase
              .from('material_sheets')
              .select('id, sheet_name, order_index')
              .in('workbook_id', otherWbIds);
            const otherSheetRows = (otherSheets || []) as { id: string; sheet_name?: string; order_index?: number }[];
            const otherIds = otherSheetRows.map((s) => s.id).filter(Boolean);
            if (otherIds.length > 0) {
              const { data: otherLaborRows } = await supabase
                .from('material_sheet_labor')
                .select('*')
                .in('sheet_id', otherIds);
              const metaBySheetId = new Map<string, { sheet_name?: string; order_index?: number }>();
              otherSheetRows.forEach((s) => {
                if (s.id) metaBySheetId.set(String(s.id), s);
              });
              (otherLaborRows || []).forEach((labor: any) => {
                const sid = String(labor.sheet_id ?? '').trim();
                const meta = metaBySheetId.get(sid);
                if (!meta) return;
                const byName = displayedByName.get(normalizeSheetName(meta.sheet_name));
                const oi = Number(meta.order_index);
                const byOrder = Number.isFinite(oi) ? displayedByOrder.get(oi) : undefined;
                const mappedSheetId = byName || byOrder;
                if (!mappedSheetId) return;
                const total =
                  labor.total_labor_cost ??
                  (Number(labor.estimated_hours || 0) * Number(labor.hourly_rate || 0));
                if (!(Number.isFinite(total) && total > 0)) return;
                const existing = laborMap[mappedSheetId];
                const existingTotal = existing ? effectiveLaborTotal(existing) : 0;
                if (total <= existingTotal) return;
                laborMap[mappedSheetId] = {
                  ...labor,
                  sheet_id: mappedSheetId,
                  total_labor_cost: total,
                  labor_source_sheet_id: sid,
                  labor_mergetrusted: true,
                };
              });
            }
          }
          agentDebugLog({
            runId: 'post-fix',
            hypothesisId: 'H5-sibling',
            location: 'JobFinancials.tsx:loadMaterialsData:siblingMerge',
            message: 'sibling workbook labor merge',
            data: {
              targetQuoteId,
              displayedWbId: String(workbookData.id ?? '').trim(),
              otherWbCount: otherWbIds.length,
              laborKeyCountAfter: Object.keys(laborMap).length,
              laborTotalAfter: laborMapTotal(laborMap),
            },
          });
        } catch (e) {
          console.warn('merge sibling workbook labor into locked view:', e);
        }
      }

      // Labor sometimes remains only on another workbook for the SAME quote (locked vs working).
      // When multiple formal proposals exist on the job, never merge labor from other quotes' sheets.
      const isolateProposals = jobHasMultipleFormalProposals(allJobQuotes);
      if (job?.id && sheetsData.length > 0 && !isolateProposals) {
        try {
          const normalizeSheetNameJl = (v: unknown) =>
            String(v ?? '')
              .toLowerCase()
              .trim()
              .replace(/\s+/g, ' ');
          const effectiveLaborTotalJl = (lab: any) => {
            const direct = Number(lab?.total_labor_cost);
            if (Number.isFinite(direct) && direct > 0) return direct;
            return Number(lab?.estimated_hours || 0) * Number(lab?.hourly_rate || 0);
          };
          const displayedByNameJl = new Map<string, string>();
          const displayedByOrderJl = new Map<number, string>();
          sheetsData.forEach((s: any) => {
            const sid = String(s?.id ?? '').trim();
            if (!sid) return;
            const nameKey = normalizeSheetNameJl(s?.sheet_name);
            if (nameKey && !displayedByNameJl.has(nameKey)) displayedByNameJl.set(nameKey, sid);
            const oi = Number(s?.order_index);
            if (Number.isFinite(oi) && !displayedByOrderJl.has(oi)) displayedByOrderJl.set(oi, sid);
          });
          const displayedIdSet = new Set(
            sheetsData.map((s: any) => String(s?.id ?? '').trim()).filter(Boolean)
          );
          const { data: jobWbList } = await supabase
            .from('material_workbooks')
            .select('id, quote_id')
            .eq('job_id', job.id);
          const jobWbIds = (jobWbList || [])
            .filter((w: any) => !w.quote_id || w.quote_id === targetQuoteId)
            .map((w: any) => String(w?.id ?? '').trim())
            .filter(Boolean);
          if (jobWbIds.length > 0) {
            const { data: jobSheetsAll } = await supabase
              .from('material_sheets')
              .select('id, sheet_name, order_index')
              .in('workbook_id', jobWbIds);
            const orphanSheets = ((jobSheetsAll || []) as { id: string; sheet_name?: string; order_index?: number }[]).filter(
              (s) => s?.id && !displayedIdSet.has(String(s.id).trim())
            );
            // Build the orphan→displayed remap and stash it in a ref so loadCustomRows
            // and loadSubcontractorEstimates (which run after this fn awaits) can
            // re-attach rows/subs whose sheet_id points at a sibling workbook's sheet.
            const remap: Record<string, string> = {};
            orphanSheets.forEach((s) => {
              const sid = String(s.id ?? '').trim();
              if (!sid) return;
              const byName = displayedByNameJl.get(normalizeSheetNameJl(s.sheet_name));
              const oi = Number(s.order_index);
              const byOrder = Number.isFinite(oi) ? displayedByOrderJl.get(oi) : undefined;
              const target = byName || byOrder;
              if (target && target !== sid) remap[sid] = target;
            });
            siblingSheetRemapRef.current = remap;
            const orphanIds = orphanSheets.map((s) => s.id).filter(Boolean);
            if (orphanIds.length > 0) {
              const { data: orphanLabor } = await supabase
                .from('material_sheet_labor')
                .select('*')
                .in('sheet_id', orphanIds);
              const metaBySheetIdJl = new Map<string, { sheet_name?: string; order_index?: number }>();
              orphanSheets.forEach((s) => {
                if (s.id) metaBySheetIdJl.set(String(s.id), s);
              });
              (orphanLabor || []).forEach((labor: any) => {
                const sid = String(labor.sheet_id ?? '').trim();
                const meta = metaBySheetIdJl.get(sid);
                if (!meta) return;
                const byName = displayedByNameJl.get(normalizeSheetNameJl(meta.sheet_name));
                const oi = Number(meta.order_index);
                const byOrder = Number.isFinite(oi) ? displayedByOrderJl.get(oi) : undefined;
                const mappedSheetId = byName || byOrder;
                if (!mappedSheetId) return;
                const total =
                  labor.total_labor_cost ??
                  (Number(labor.estimated_hours || 0) * Number(labor.hourly_rate || 0));
                if (!(Number.isFinite(total) && total > 0)) return;
                const existing = laborMap[mappedSheetId];
                const existingTotal = existing ? effectiveLaborTotalJl(existing) : 0;
                if (total <= existingTotal) return;
                laborMap[mappedSheetId] = {
                  ...labor,
                  sheet_id: mappedSheetId,
                  total_labor_cost: total,
                  labor_source_sheet_id: sid,
                  // Same trust model as the locked-workbook sibling merge above:
                  // matched by sheet name (or order_index) intentionally, so this
                  // labor belongs to the displayed section and must count in totals.
                  labor_mergetrusted: true,
                };
              });
            }
          }
        } catch (e) {
          console.warn('merge job-level workbook labor onto displayed sheets:', e);
        }
      }
      const displayedSheetRefsForLabor: LaborSheetRef[] = sheetsData.map((s: any) => ({
        id: String(s.id),
        sheet_name: s.sheet_name,
        order_index: s.order_index,
      }));
      if (targetQuoteId && displayedSheetRefsForLabor.length > 0) {
        try {
          await mergeLaborFromAllQuoteWorkbooks(
            targetQuoteId,
            displayedSheetRefsForLabor,
            laborMap,
          );
        } catch (e) {
          console.warn('mergeLaborFromAllQuoteWorkbooks:', e);
        }
        if (job?.id && laborMapTotal(laborMap) === 0) {
          try {
            await mergeLaborFromJobWorkbooksForQuote(
              job.id,
              targetQuoteId,
              displayedSheetRefsForLabor,
              laborMap,
            );
          } catch (e) {
            console.warn('mergeLaborFromJobWorkbooksForQuote:', e);
          }
        }
      }
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H5-sibling',
        location: 'JobFinancials.tsx:loadMaterialsData:afterLaborMerge',
        message: 'labor map built',
        data: {
          targetQuoteId,
          displayedWorkbookId: displayedWorkbookIdRef.current,
          laborKeyCount: Object.keys(laborMap).length,
          laborMapTotal: laborMapTotal(laborMap),
          mergedTrustedCount: Object.values(laborMap).filter((l: any) => l?.labor_mergetrusted).length,
        },
      });
      if (isFinancialLoadStale(cooperativeGen)) {
        // #region agent log
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H2-stale',
          location: 'JobFinancials.tsx:loadMaterialsData:staleBeforeSetLabor',
          message: 'aborted before setSheetLabor — stale cooperativeGen',
          data: {
            targetQuoteId,
            cooperativeGen,
            currentGen: financialLoadCoopGenRef.current,
            laborKeyCount: Object.keys(laborMap).length,
          },
        });
        // #endregion
        return;
      }
      const sheetLaborPayload: Record<string, any> = {};
      for (const [k, v] of Object.entries(laborMap)) {
        const nk = String(k).trim();
        if (nk) sheetLaborPayload[nk] = v;
      }
      const displayedSheetRefs: LaborSheetRef[] = sheetsData.map((s: any) => ({
        id: String(s?.id ?? ''),
        sheet_name: s?.sheet_name,
        order_index: s?.order_index,
      }));
      const displayIdSet = new Set(
        displayedSheetRefs.map((s) => String(s.id).trim()).filter(Boolean),
      );
      let finalLaborPayload = sheetLaborPayload;
      if (targetQuoteId && laborMapTotal(finalLaborPayload) === 0 && sheetLaborByQuoteRef.current[targetQuoteId]) {
        finalLaborPayload = remapLaborPayloadToDisplayedSheets(
          displayedSheetRefs,
          sheetLaborByQuoteRef.current[targetQuoteId],
          sheetLaborByNameByQuoteRef.current[targetQuoteId],
        );
      }
      if (targetQuoteId && laborMapTotal(finalLaborPayload) === 0 && sheetLaborByNameByQuoteRef.current[targetQuoteId]) {
        finalLaborPayload = remapLaborPayloadToDisplayedSheets(
          displayedSheetRefs,
          {},
          sheetLaborByNameByQuoteRef.current[targetQuoteId],
        );
      }
      const payloadKeysMismatch = Object.keys(finalLaborPayload).some(
        (k) => !displayIdSet.has(String(k).trim()),
      );
      if (payloadKeysMismatch && displayedSheetRefs.length > 0) {
        const remappedPayload = remapLaborPayloadToDisplayedSheets(
          displayedSheetRefs,
          finalLaborPayload,
          targetQuoteId ? sheetLaborByNameByQuoteRef.current[targetQuoteId] : undefined,
        );
        if (laborMapTotal(remappedPayload) > 0) {
          finalLaborPayload = remappedPayload;
        }
      }
      const sameQuoteReload =
        targetQuoteId != null &&
        targetQuoteId === lastSheetLaborQuoteIdRef.current &&
        laborMapTotal(finalLaborPayload) > 0;
      const extNowForLabor = externalMaterialsWorkbookViewRef.current;
      const deferEmptySheetLabor =
        controlledQuoteId !== undefined &&
        targetQuoteId != null &&
        laborMapTotal(finalLaborPayload) === 0 &&
        !extNowForLabor?.workbookId &&
        !sheetLaborByQuoteRef.current[targetQuoteId];

      if (deferEmptySheetLabor) {
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H3-workbook',
          location: 'JobFinancials.tsx:loadMaterialsData:deferEmptyLabor',
          message: 'defer empty sheetLabor — awaiting materials workbook sync',
          data: { targetQuoteId, displayedWorkbookId: displayedWorkbookIdRef.current },
        });
        lastMaterialsLaborTotalRef.current = laborMapTotal(sheetLaborLiveRef.current);
      } else if (laborMapTotal(finalLaborPayload) === 0) {
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H7-sameQuoteReload',
          location: 'JobFinancials.tsx:loadMaterialsData:skipEmptyApply',
          message: 'skip empty sheetLabor apply — would wipe visible labor',
          data: {
            targetQuoteId,
            lastAppliedQuoteId: lastSheetLaborQuoteIdRef.current,
            liveTotal: laborMapTotal(sheetLaborLiveRef.current),
            cooperativeGen,
          },
        });
        lastMaterialsLaborTotalRef.current = laborMapTotal(sheetLaborLiveRef.current);
      } else {
        setSheetLabor((prev) => {
          const next = { ...finalLaborPayload };
          if (sameQuoteReload && prev && typeof prev === 'object') {
            Object.keys(prev).forEach((sid) => {
              if (!(sid in next)) next[sid] = prev[sid];
            });
          }
          return next;
        });
        lastSheetLaborQuoteIdRef.current = targetQuoteId;
        if (targetQuoteId && laborMapTotal(finalLaborPayload) > 0) {
          sheetLaborByQuoteRef.current[targetQuoteId] = { ...finalLaborPayload };
          const byName: Record<string, any> = {};
          sheetsData.forEach((s: any) => {
            const sid = String(s?.id ?? '').trim();
            const nameKey = normalizeLaborSheetName(s?.sheet_name);
            if (sid && nameKey && finalLaborPayload[sid]) byName[nameKey] = finalLaborPayload[sid];
          });
          if (Object.keys(byName).length > 0) {
            sheetLaborByNameByQuoteRef.current[targetQuoteId] = byName;
          }
        }
        lastMaterialsLaborTotalRef.current = laborMapTotal(finalLaborPayload);
      }
      // #region agent log
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H4-double-load',
        location: 'JobFinancials.tsx:loadMaterialsData:setSheetLabor',
        message: 'applying sheetLabor state',
        data: {
          targetQuoteId,
          sameQuoteReload,
          deferEmptySheetLabor,
          payloadKeyCount: Object.keys(finalLaborPayload).length,
          payloadTotal: laborMapTotal(finalLaborPayload),
          appliedTotal: lastMaterialsLaborTotalRef.current,
          usedCache: laborMapTotal(sheetLaborPayload) === 0 && laborMapTotal(finalLaborPayload) > 0,
          payloadKeysMismatch,
          cooperativeGen,
          displayedWorkbookId: displayedWorkbookIdRef.current,
        },
      });
      // #endregion

      // Build category markups map, preserving any in-progress saves
      const freshMarkups: Record<string, number> = {};
      sheetsData.forEach((sheet: any) => {
        (sheet.material_category_markups || []).forEach((cm: any) => {
          freshMarkups[`${cm.sheet_id}_${cm.category_name}`] = cm.markup_percent;
        });
      });
      savingMarkupsRef.current.forEach(key => {
        if (categoryMarkups[key] !== undefined) freshMarkups[key] = categoryMarkups[key];
      });
      if (JSON.stringify(freshMarkups) !== JSON.stringify(categoryMarkups)) {
        if (!isFinancialLoadStale(cooperativeGen)) {
          setCategoryMarkups(freshMarkups);
        }
      }

      // itemsData is still needed for breakdown calculation below — collect from nested sheets
      const itemsData: any[] = sheetsData.flatMap((sheet: any) => sheet.material_items || []);

      // Optional-by-category: from DB and/or local overlay (works even if DB table missing or request fails)
      const sheetIds = (sheetsData || []).map((s: any) => s.id);
      let categoryOptionsRows: any[] = [];
      try {
        if (sheetIds.length > 0) {
          const res = await supabase.from('material_category_options').select('sheet_id, category_name, is_optional').in('sheet_id', sheetIds);
          categoryOptionsRows = res.data || [];
        }
      } catch {
        categoryOptionsRows = [];
      }
      const categoryOptionalMap = new Map<string, boolean>();
      categoryOptionsRows.forEach((r: any) => {
        categoryOptionalMap.set(`${r.sheet_id}_${r.category_name}`, !!r.is_optional);
      });
      const mergedOverlay = { ...optionalCategoryOverlay, ...(overlayOverride || {}) };
      Object.entries(mergedOverlay).forEach(([key, value]) => {
        categoryOptionalMap.set(key, value);
      });

      // Calculate breakdown by sheet and category
      const breakdowns = (sheetsData || []).map(sheet => {
        const sheetItems = (itemsData || []).filter(item => item.sheet_id === sheet.id);

        // Group by category
        const categoryMap = new Map<string, any[]>();
        sheetItems.forEach(item => {
          const category = item.category || 'Uncategorized';
          if (!categoryMap.has(category)) {
            categoryMap.set(category, []);
          }
          categoryMap.get(category)!.push(item);
        });

        // Calculate totals per category from item-level prices (no category-level recalculation).
        const itemEffectivePrice = (item: any) =>
          (item.extended_price != null && item.extended_price !== '')
            ? Number(item.extended_price)
            : (Number(item.quantity) || 0) * (Number(item.price_per_unit) || 0);
          const categories = Array.from(categoryMap.entries()).map(([categoryName, items]) => {
          const isCategoryOptional = categoryOptionalMap.get(`${sheet.id}_${categoryName}`) === true;
          const totalCost = isCategoryOptional ? 0 : items.reduce((sum, item) => {
            const extended = Number(item.extended_cost) || 0;
            if (extended > 0) return sum + extended;
            return sum + ((Number(item.cost_per_unit) || 0) * (Number(item.quantity) || 0));
          }, 0);
          const totalPrice = isCategoryOptional ? 0 : items.reduce((sum, item) => sum + itemEffectivePrice(item), 0);

          const profit = totalPrice - totalCost;
          const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;

          return {
            name: categoryName,
            itemCount: items.length,
            items: items.map((item: any) => ({
              id: item.id,
              order_index: item.order_index ?? 0,
              isOptional: isCategoryOptional,
              material_name: item.material_name,
              sku: item.sku,
              quantity: item.quantity || 0,
              cost_per_unit: item.cost_per_unit || 0,
              price_per_unit: item.price_per_unit || 0,
              extended_cost: (item.extended_cost != null && item.extended_cost !== '')
                ? Number(item.extended_cost)
                : (Number(item.cost_per_unit) || 0) * (Number(item.quantity) || 0),
              extended_price: (item.extended_price != null && item.extended_price !== '')
                ? Number(item.extended_price)
                : (Number(item.quantity) || 0) * (Number(item.price_per_unit) || 0),
            })),
            totalCost,
            totalPrice,
            profit,
            margin,
          };
        }).sort((a, b) => {
          const categoryOrder = Array.isArray((sheet as any).category_order) ? (sheet as any).category_order as string[] : [];
          const orderMap = new Map(categoryOrder.map((name, idx) => [name, idx]));
          const ai = orderMap.has(a.name) ? orderMap.get(a.name)! : Infinity;
          const bi = orderMap.has(b.name) ? orderMap.get(b.name)! : Infinity;
          if (ai !== bi) return ai - bi;
          const aMinOrder = Math.min(...(a.items || []).map((it: any) => Number(it.order_index ?? Infinity)));
          const bMinOrder = Math.min(...(b.items || []).map((it: any) => Number(it.order_index ?? Infinity)));
          if (aMinOrder !== bMinOrder) return aMinOrder - bMinOrder;
          return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        });

        // Calculate sheet totals
        const sheetTotalCost = categories.reduce((sum, cat) => sum + cat.totalCost, 0);
        const sheetTotalPrice = categories.reduce((sum, cat) => sum + cat.totalPrice, 0);
        const sheetProfit = sheetTotalPrice - sheetTotalCost;
        const sheetMargin = sheetTotalPrice > 0 ? (sheetProfit / sheetTotalPrice) * 100 : 0;

        return {
          sheetId: sheet.id,
          sheetName: sheet.sheet_name,
          sheetDescription: sheet.description || '',
          orderIndex: sheet.order_index,
          isOptional: Object.prototype.hasOwnProperty.call(optionalSheetOverlay, sheet.id)
            ? !!optionalSheetOverlay[sheet.id]
            : toBool(sheet.is_option),
          compareToSheetId: sheet.compare_to_sheet_id ?? null,
          sheetType: sheet.sheet_type ?? 'proposal',
          changeOrderSeq: sheet.change_order_seq ?? null,
          categories,
          totalCost: sheetTotalCost,
          totalPrice: sheetTotalPrice,
          profit: sheetProfit,
          margin: sheetMargin,
        };
      });

      // Grand totals for proposal: exclude change_order sheets so proposal total stays separate
      const proposalBreakdowns = breakdowns.filter((b: any) => {
        const s = sheetsData.find((sd: any) => sd.id === b.sheetId);
        return s?.sheet_type !== 'change_order';
      });
      const grandTotalCost = proposalBreakdowns.reduce((sum, sheet) => sum + sheet.totalCost, 0);
      const grandTotalPrice = proposalBreakdowns.reduce((sum, sheet) => sum + sheet.totalPrice, 0);
      const grandProfit = grandTotalPrice - grandTotalCost;
      const grandMargin = grandTotalPrice > 0 ? (grandProfit / grandTotalPrice) * 100 : 0;

      // Only update if data actually changed to prevent unnecessary re-renders
      const newBreakdown = {
        sheetBreakdowns: breakdowns,
        totals: {
          totalCost: grandTotalCost,
          totalPrice: grandTotalPrice,
          totalProfit: grandProfit,
          profitMargin: grandMargin,
        }
      };
      
      if (JSON.stringify(newBreakdown) !== JSON.stringify(materialsBreakdown)) {
        if (!isFinancialLoadStale(cooperativeGen)) {
          setMaterialsBreakdown(newBreakdown);
        }
      }
    } catch (error: any) {
      console.error('Error loading materials breakdown:', error);
      // Only update if not already empty
      if (materialsBreakdown.sheetBreakdowns.length > 0 || materialsBreakdown.totals.totalCost !== 0) {
        setMaterialsBreakdown({
          sheetBreakdowns: [],
          totals: { totalCost: 0, totalPrice: 0, totalProfit: 0, profitMargin: 0 }
        });
        setMaterialSheets([]);
      }
    }
  }

  // Normalize description for dedupe: collapse all whitespace to single space and trim.
  function normalizeDescription(description?: string | null): string {
    return (description ?? '').trim().replace(/\s+/g, ' ');
  }

  // Frontend dedupe: group by normalized description, keep single oldest (by created_at). Used so duplicate DB rows don't affect UI or totals.
  function dedupeRowsByDescription<T extends { description?: string; created_at?: string; id?: string; order_index?: number }>(rows: T[]): T[] {
    const byDesc = new Map<string, T>();
    rows.forEach(row => {
      const desc = normalizeDescription(row.description);
      const existing = byDesc.get(desc);
      const rowCreated = row.created_at ?? '';
      const existingCreated = existing?.created_at ?? '';
      if (!existing || rowCreated < existingCreated || (rowCreated === existingCreated && (row.id ?? '') < (existing.id ?? ''))) {
        byDesc.set(desc, row);
      }
    });
    return Array.from(byDesc.values()).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  }

  async function loadCustomRows(
    targetQuoteId: string | null = null,
    isHistorical: boolean = false,
    cooperativeGen?: number
  ) {
    // Locked/historical proposals: always load live data so labor and custom rows always show
    if (isHistorical && targetQuoteId) {
      console.log('📝 Loading live custom rows for locked/historical proposal');
      isHistorical = false;
    }
    if (targetQuoteId && jobHasMultipleFormalProposals(allJobQuotes)) {
      await realignMisassignedSheetLineItems(supabase, targetQuoteId);
    }
    await waitForProposalSwitchGate();
    if (false && isHistorical && targetQuoteId) {
      const { data: versionData, error: versionError } = await supabase
        .from('proposal_versions')
        .select('financial_rows_snapshot')
        .eq('quote_id', targetQuoteId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (versionError) {
        console.error('Error loading proposal version for custom rows:', versionError);
        return;
      }
      
      if (!versionData || !versionData.financial_rows_snapshot) {
        isHistorical = false;
      } else {
      const snapshot = versionData.financial_rows_snapshot;
      const rowsData = Array.isArray(snapshot) ? snapshot : [];
      const dedupedRows = dedupeRowsByDescription(rowsData);
      const descToRow = new Map<string, any>();
      dedupedRows.forEach((r: any) => descToRow.set(normalizeDescription(r.description), r));
      const duplicateToSurviving: Record<string, string> = {};
      rowsData.forEach((row: any) => {
        const surviving = descToRow.get(normalizeDescription(row.description));
        if (surviving) duplicateToSurviving[row.id] = surviving.id;
      });

      const laborMap: Record<string, any> = {};
      dedupedRows.forEach((row: any) => {
        if (row.notes) {
          try {
            const parsed = JSON.parse(row.notes);
            if (parsed.labor) laborMap[row.id] = parsed.labor;
          } catch { /* skip */ }
        }
      });

      const allLineItems: CustomRowLineItem[] = [];
      rowsData.forEach((row: any) => {
        if (row.line_items && Array.isArray(row.line_items)) {
          row.line_items.forEach((li: any) => allLineItems.push(li));
        }
      });
      const getEffectiveParentId = (item: CustomRowLineItem) => {
        if (item.row_id) return duplicateToSurviving[item.row_id] ?? item.row_id;
        return item.sheet_id ?? null;
      };
      const lineItemsMap: Record<string, CustomRowLineItem[]> = {};
      allLineItems.forEach(item => {
        const parentId = getEffectiveParentId(item);
        if (parentId) {
          if (!lineItemsMap[parentId]) lineItemsMap[parentId] = [];
          lineItemsMap[parentId].push(item);
        }
      });
      Object.keys(lineItemsMap).forEach(k => {
        lineItemsMap[k].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
      });

      const asCustomRows: CustomFinancialRow[] = dedupedRows.map((r: any) => ({
        id: r.id ?? '',
        job_id: r.job_id ?? '',
        category: r.category ?? '',
        description: r.description ?? '',
        quantity: r.quantity ?? 0,
        unit_cost: r.unit_cost ?? 0,
        total_cost: r.total_cost ?? 0,
        markup_percent: r.markup_percent ?? 0,
        selling_price: r.selling_price ?? 0,
        notes: r.notes ?? null,
        order_index: r.order_index ?? 0,
        taxable: r.taxable ?? false,
        created_at: r.created_at ?? '',
        updated_at: r.updated_at ?? '',
        is_option: toBool(r.is_option),
      }));
      if (JSON.stringify(asCustomRows) !== JSON.stringify(customRows)) setCustomRows(asCustomRows);
      setCustomRowLabor(laborMap);
      commitSheetLineItemsState(lineItemsMap, targetQuoteId);
      console.log('✅ Loaded custom rows from snapshot (deduped)');
      return;
      }
    }
    
    // Normal flow: fetch rows + their line items. When viewing a proposal, include both
    // quote-specific rows and job-level rows (quote_id null) so line items added by another
    // user or without a proposal selected appear in the proposal.
    let rawRows: any[] = [];
    if (targetQuoteId) {
      const [forQuote, forJob, removed] = await Promise.all([
        supabase.from('custom_financial_rows').select('*, custom_financial_row_items(*)').eq('quote_id', targetQuoteId).order('order_index'),
        supabase.from('custom_financial_rows').select('*, custom_financial_row_items(*)').eq('job_id', job.id).is('quote_id', null).order('order_index'),
        supabase.from('quote_removed_sections').select('section_id').eq('quote_id', targetQuoteId).eq('section_type', 'custom_row'),
      ]);
      if (forQuote.error) {
        console.error('Error loading custom rows (quote):', forQuote.error);
      }
      if (forJob.error) {
        console.error('Error loading custom rows (job):', forJob.error);
      }
      if (!forQuote.error) {
        const removedRowIds = isMissingQuoteRemovedSectionsError(removed.error)
          ? new Set<string>()
          : new Set((removed.data || []).map((r: any) => r.section_id));
        const quoteIds = new Set((forQuote.data || []).map((r: any) => r.id));
        rawRows = [...(forQuote.data || [])];
        if (!forJob.error && !jobHasMultipleFormalProposals(allJobQuotes)) {
          const jobOnly = (forJob.data || []).filter((r: any) => !quoteIds.has(r.id) && !removedRowIds.has(r.id));
          rawRows = [...rawRows, ...jobOnly];
        }
      }
    } else {
      const { data, error } = await supabase
        .from('custom_financial_rows')
        .select('*, custom_financial_row_items(*)')
        .eq('job_id', job.id)
        .order('order_index');
      if (error) {
        console.error('Error loading custom rows:', error);
        return;
      }
      rawRows = data || [];
    }

    if (isFinancialLoadStale(cooperativeGen)) return;

    // Strip nested line items out of the row objects for state
    const newData: CustomFinancialRow[] = rawRows.map((row: any) => {
      const { custom_financial_row_items: _items, ...rowData } = row;
      return rowData as CustomFinancialRow;
    });

    const dedupedRows = dedupeRowsByDescription(newData);
    const descToRow = new Map<string, CustomFinancialRow>();
    dedupedRows.forEach(r => descToRow.set(normalizeDescription(r.description), r));
    const duplicateToSurviving: Record<string, string> = {};
    newData.forEach(row => {
      const surviving = descToRow.get(normalizeDescription(row.description));
      if (surviving) duplicateToSurviving[row.id] = surviving.id;
    });

    // Only remove duplicates when loading a single proposal (targetQuoteId set). Never run when
    // loading by job_id or we would treat rows from all proposals as one set and delete valid data.
    const safeToDeleteDuplicates = !isHistorical && targetQuoteId && rawRows.length > dedupedRows.length;
    const maxAutoDelete = 50;
    if (safeToDeleteDuplicates) {
      const keepIds = new Set(dedupedRows.map(r => r.id));
      const duplicateIds = rawRows.map((r: any) => r.id).filter((id: string) => !keepIds.has(id));
      if (duplicateIds.length > 0 && duplicateIds.length <= maxAutoDelete) {
        try {
          await supabase.from('custom_financial_row_items').delete().in('row_id', duplicateIds);
          await supabase.from('custom_financial_rows').delete().in('id', duplicateIds);
          toast.success(`Removed ${duplicateIds.length} duplicate row(s).`);
        } catch (delErr: any) {
          console.error('Error removing duplicate rows:', delErr);
        }
      } else if (duplicateIds.length > maxAutoDelete) {
        console.warn(`Skipped auto-delete of ${duplicateIds.length} rows (cap is ${maxAutoDelete}). Duplicates may be in this proposal only; check that you are viewing one proposal.`);
      }
    }

    if (isFinancialLoadStale(cooperativeGen)) return;

    const applyAbort = customRowsApplyAbortReason(targetQuoteId, cooperativeGen);
    if (applyAbort) {
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H10-staleApply',
        location: 'JobFinancials.tsx:loadCustomRows:abortApply',
        message: 'aborted before applying custom row state',
        data: {
          targetQuoteId,
          activeQuoteId: prevFinancialQuoteIdRef.current,
          reason: applyAbort,
          cooperativeGen,
          currentGen: financialLoadCoopGenRef.current,
        },
      });
      return;
    }

    const laborMap: Record<string, any> = {};
    dedupedRows.forEach(row => {
      if (row.notes) {
        try {
          const parsed = JSON.parse(row.notes);
          if (parsed.labor) laborMap[row.id] = parsed.labor;
        } catch { /* skip */ }
      }
    });
    setCustomRowLabor(laborMap);

    if (JSON.stringify(dedupedRows) !== JSON.stringify(customRows)) {
      const mapped: CustomFinancialRow[] = dedupedRows.map((r: any) => ({
        id: r.id ?? '',
        job_id: r.job_id ?? '',
        category: r.category ?? '',
        description: r.description ?? '',
        quantity: r.quantity ?? 0,
        unit_cost: r.unit_cost ?? 0,
        total_cost: r.total_cost ?? 0,
        markup_percent: r.markup_percent ?? 0,
        selling_price: r.selling_price ?? 0,
        notes: r.notes ?? null,
        order_index: r.order_index ?? 0,
        taxable: r.taxable ?? false,
        created_at: r.created_at ?? '',
        updated_at: r.updated_at ?? '',
        is_option: toBool(r.is_option),
      }));
      setCustomRows(mapped);
    }

    // Collect row-linked line items from the nested response
    const rowLinkedItems: CustomRowLineItem[] = rawRows.flatMap((row: any) =>
      (row.custom_financial_row_items || []) as CustomRowLineItem[]
    );

    // Row-linked items only — sheet section labor uses refreshSheetSectionLineItemsForQuote (prefetch path).
    const rowLineItemsMap: Record<string, CustomRowLineItem[]> = {};
    rowLinkedItems.forEach((item) => {
      const rowId = item.row_id ? (duplicateToSurviving[item.row_id] ?? item.row_id) : null;
      if (!rowId) return;
      if (!rowLineItemsMap[rowId]) rowLineItemsMap[rowId] = [];
      const fp = lineItemOptimisticFingerprint(item);
      const isDup = rowLineItemsMap[rowId].some(
        (ex) =>
          (item.id && ex.id === item.id) ||
          lineItemOptimisticFingerprint(ex) === fp,
      );
      if (!isDup) rowLineItemsMap[rowId].push(item);
    });
    Object.keys(rowLineItemsMap).forEach((k) => {
      rowLineItemsMap[k].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    });
    const rowIds = new Set(dedupedRows.map((r) => r.id));

    if (targetQuoteId) {
      await refreshSheetSectionLineItemsForQuote(targetQuoteId, cooperativeGen);
    }

    const applyAbortAfterRefresh = customRowsApplyAbortReason(targetQuoteId, cooperativeGen);
    if (applyAbortAfterRefresh) {
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H10-staleApply',
        location: 'JobFinancials.tsx:loadCustomRows:abortAfterRefresh',
        message: 'aborted row line item apply after sheet refresh — stale or wrong quote',
        data: {
          targetQuoteId,
          activeQuoteId: prevFinancialQuoteIdRef.current,
          userSelectedQuoteId: userSelectedQuoteIdRef.current,
          reason: applyAbortAfterRefresh,
          cooperativeGen,
        },
      });
      return;
    }

    const sheetLaborSource =
      pickBestLineItemsMap([
        targetQuoteId &&
        targetQuoteId === userSelectedQuoteIdRef.current &&
        laborTotalFromLineItemsMap(sheetLaborDisplayLiveRef.current) > 0
          ? sheetLaborDisplayLiveRef.current
          : null,
        targetQuoteId ? prefetchedSheetLaborByQuoteRef.current[targetQuoteId] : null,
        targetQuoteId ? customRowLineItemsByQuoteRef.current[targetQuoteId] : null,
        sheetSectionLineItemsLiveRef.current,
        customRowLineItemsLiveRef.current,
      ]) ?? {};
    let sheetPart = extractSheetOnlyLineItems(sheetLaborSource, rowIds);
    if (targetQuoteId && laborTotalFromLineItemsMap(sheetPart) <= 0) {
      const pf = prefetchedSheetLaborByQuoteRef.current[targetQuoteId];
      const pfLabor = pf ? laborTotalFromLineItemsMap(pf) : 0;
      if (pfLabor > 0) {
        sheetPart = extractSheetOnlyLineItems(pf, rowIds);
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H35-prefetchFallback',
          location: 'JobFinancials.tsx:loadCustomRows:prefetchFallback',
          message: 'sheetPart empty after refresh — restored from DB-prefetched ref',
          data: { targetQuoteId, pfLabor, pfKeys: Object.keys(pf ?? {}) },
        });
      }
    }

    const displayedSheetsForMerge: LaborSheetRef[] = (
      materialsBreakdown?.sheetBreakdowns?.length
        ? materialsBreakdown.sheetBreakdowns
        : materialSheets
    )
      .map((s: any) => ({
        id: String(s?.sheetId ?? s?.id ?? '').trim(),
        sheet_name: s?.sheetName ?? s?.sheet_name,
        order_index: s?.orderIndex ?? s?.order_index,
      }))
      .filter((s) => s.id);
    if (displayedSheetsForMerge.length > 0 && laborTotalFromLineItemsMap(sheetPart) > 0) {
      const mergeIdToName = new Map<string, string>();
      Object.entries(sheetMetaByIdRef.current).forEach(([id, name]) => {
        mergeIdToName.set(id, name);
      });
      materialSheets.forEach((s: any) => {
        const id = String(s?.id ?? '').trim();
        if (id) mergeIdToName.set(id, String(s?.sheet_name ?? ''));
      });
      const rekeyed = rekeySheetLineItemsToDisplayedSheets(sheetPart, displayedSheetsForMerge, mergeIdToName);
      if (laborTotalFromLineItemsMap(rekeyed) > 0) {
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H25-crossProposalRekey',
          location: 'JobFinancials.tsx:loadCustomRows:mergeRekey',
          message: 'rekeyed sheet labor onto displayed sheets before row-only merge',
          data: {
            targetQuoteId,
            beforeKeys: Object.keys(sheetPart),
            afterKeys: Object.keys(rekeyed),
            labor: laborTotalFromLineItemsMap(rekeyed),
            displayedSheetIds: displayedSheetsForMerge.map((s) => s.id),
          },
        });
        sheetPart = rekeyed;
      }
    }

    setCustomRowLineItems((prev) => {
      const prevSheetOnly = extractSheetOnlyLineItems(prev, rowIds);
      const prevSheetLabor = laborTotalFromLineItemsMap(prevSheetOnly);
      let mergedSheet = sheetPart;
      if (laborTotalFromLineItemsMap(mergedSheet) <= 0 && prevSheetLabor > 0) {
        mergedSheet = prevSheetOnly;
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H38-monotonicSheetMerge',
          location: 'JobFinancials.tsx:loadCustomRows:keepPrevSheetOnly',
          message: 'loadCustomRows would wipe sheet labor — kept prior sheet keys',
          data: { targetQuoteId, prevSheetLabor, cooperativeGen },
        });
      } else if (laborTotalFromLineItemsMap(mergedSheet) <= 0 && targetQuoteId) {
        const pfBest = pickBestSheetLaborForQuote(targetQuoteId);
        const pfSheet = pfBest ? extractSheetOnlyLineItems(pfBest, rowIds) : {};
        if (laborTotalFromLineItemsMap(pfSheet) > 0) {
          mergedSheet = pfSheet;
          agentDebugLog({
            runId: 'post-fix',
            hypothesisId: 'H38-monotonicSheetMerge',
            location: 'JobFinancials.tsx:loadCustomRows:prefetchSheetMerge',
            message: 'merged sheet labor from authoritative prefetch snapshot',
            data: {
              targetQuoteId,
              labor: laborTotalFromLineItemsMap(pfSheet),
              cooperativeGen,
            },
          });
        }
      }
      const next: Record<string, CustomRowLineItem[]> = { ...mergedSheet, ...rowLineItemsMap };
      for (const parentId of Object.keys(prev || {})) {
        if (!rowIds.has(parentId)) continue;
        const prevItems = prev[parentId] || [];
        const optimistic = prevItems.filter((it: any) => String(it?.id || '').startsWith('optimistic_'));
        if (!optimistic.length) continue;
        const existingIds = new Set((next[parentId] || []).map((it: any) => String(it?.id || '')));
        const serverFp = new Set((next[parentId] || []).map((it: any) => lineItemOptimisticFingerprint(it)));
        const toAdd = optimistic.filter((it: any) => {
          if (existingIds.has(String(it?.id || ''))) return false;
          if (serverFp.has(lineItemOptimisticFingerprint(it))) return false;
          return true;
        });
        if (toAdd.length) next[parentId] = [...(next[parentId] || []), ...toAdd];
      }
      customRowLineItemsLiveRef.current = next;
      if (targetQuoteId && laborTotalFromLineItemsMap(mergedSheet) > 0) {
        saveQuoteLineItemsCache(targetQuoteId, next);
      }
      return next;
    });
    if (targetQuoteId && laborTotalFromLineItemsMap(sheetPart) > 0) {
      applySheetSectionLineItems(sheetPart, targetQuoteId);
      setSheetLaborDisplayMapSafe(sheetPart, 'loadCustomRows:rowsOnly');
    } else if (targetQuoteId) {
      const pfBest = pickBestSheetLaborForQuote(targetQuoteId);
      if (pfBest && laborTotalFromLineItemsMap(pfBest) > 0) {
        applySheetSectionLineItems(pfBest, targetQuoteId);
        setSheetLaborDisplayMapSafe(pfBest, 'loadCustomRows:rowsOnlyPrefetch');
      }
    }
    agentDebugLog({
      runId: 'post-fix',
      hypothesisId: 'H22-dedicatedSheetLoad',
      location: 'JobFinancials.tsx:loadCustomRows:rowsOnly',
      message: 'applied row-linked + sheet section line items after dedicated refresh',
      data: {
        targetQuoteId,
        rowKeyCount: Object.keys(rowLineItemsMap).length,
        sheetKeyCount: Object.keys(sheetPart).length,
        sheetLabor: laborTotalFromLineItemsMap(sheetPart),
        cooperativeGen,
      },
    });
    return;

    // Legacy sheet-linked fetch below (unreachable — kept for reference during migration).
    // Fetch sheet-linked items (row_id IS NULL).
    // NOTE: Sheet line items are proposal-scoped via (quote_id + section_name) and may optionally also have sheet_id.
    // We attach them to the currently displayed sheets by matching section_name (and fall back to sheet_id).
    let sheetLinkedItems: CustomRowLineItem[] = [];
    let sheetIds: string[] = [];
    /**
     * Workbook whose sheet IDs define the proposal column (locked contract vs working draft).
     * Do NOT seed from `activeWorkbookId`: after `await loadMaterialsData()` React has not re-rendered,
     * so that state is often still the previous quote/job and sheet-linked labor never maps onto sections.
     */
    let displayedWorkbookIdForLineItems: string | null = displayedWorkbookIdRef.current;
    if (displayedWorkbookIdForLineItems && targetQuoteId) {
      const { data: wbRow } = await supabase
        .from('material_workbooks')
        .select('quote_id')
        .eq('id', displayedWorkbookIdForLineItems)
        .maybeSingle();
      const wbQuoteId = String((wbRow as { quote_id?: string | null })?.quote_id ?? '').trim();
      if (wbQuoteId !== targetQuoteId) {
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H9-sheetLineItems',
          location: 'JobFinancials.tsx:loadCustomRows:rejectStaleWorkbook',
          message: 'displayedWorkbookIdRef belongs to another proposal — re-resolve for sheet line items',
          data: {
            targetQuoteId,
            staleWorkbookId: displayedWorkbookIdForLineItems,
            staleWorkbookQuoteId: wbQuoteId || null,
          },
        });
        displayedWorkbookIdForLineItems = null;
      }
    }
    const extViewForRows = externalMaterialsWorkbookViewRef.current;
    if (
      targetQuoteId &&
      !displayedWorkbookIdForLineItems &&
      extViewForRows?.workbookId &&
      (extViewForRows?.status === 'locked' || extViewForRows?.status === 'working')
    ) {
      const extWbId = String(extViewForRows.workbookId).trim();
      const { data: extWb } = await supabase
        .from('material_workbooks')
        .select('quote_id')
        .eq('id', extWbId)
        .maybeSingle();
      const extQuoteId = String((extWb as { quote_id?: string | null })?.quote_id ?? '').trim();
      if (extQuoteId && extQuoteId === targetQuoteId) {
        displayedWorkbookIdForLineItems = extWbId || null;
      }
    }

    if (targetQuoteId && !displayedWorkbookIdForLineItems) {
      const { data: quoteRowLineItems } = await fetchQuoteContractRow(supabase, targetQuoteId);
      let preferLockedWb = isQuoteContractFrozen(quoteRowLineItems as any);
      const { data: wbPairProbe } = await supabase
        .from('material_workbooks')
        .select('status')
        .eq('quote_id', targetQuoteId);
      const pairStatuses = new Set((wbPairProbe || []).map((r: { status?: string }) => r.status));
      if (pairStatuses.has('locked') && pairStatuses.has('working')) {
        preferLockedWb = true;
      }

      if (preferLockedWb) {
        const lockedTop = await supabase
          .from('material_workbooks')
          .select('id')
          .eq('quote_id', targetQuoteId)
          .eq('status', 'locked')
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        displayedWorkbookIdForLineItems = String((lockedTop.data as any)?.id ?? '').trim() || null;
        if (!displayedWorkbookIdForLineItems) {
          const workingTop = await supabase
            .from('material_workbooks')
            .select('id')
            .eq('quote_id', targetQuoteId)
            .eq('status', 'working')
            .order('version_number', { ascending: false })
            .limit(1)
            .maybeSingle();
          displayedWorkbookIdForLineItems = String((workingTop.data as any)?.id ?? '').trim() || null;
        }
      } else {
        const workingTop = await supabase
          .from('material_workbooks')
          .select('id')
          .eq('quote_id', targetQuoteId)
          .eq('status', 'working')
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        displayedWorkbookIdForLineItems = String((workingTop.data as any)?.id ?? '').trim() || null;
        if (!displayedWorkbookIdForLineItems) {
          const lockedTop = await supabase
            .from('material_workbooks')
            .select('id')
            .eq('quote_id', targetQuoteId)
            .eq('status', 'locked')
            .order('version_number', { ascending: false })
            .limit(1)
            .maybeSingle();
          displayedWorkbookIdForLineItems = String((lockedTop.data as any)?.id ?? '').trim() || null;
        }
      }
    }
    if (!targetQuoteId) {
      displayedWorkbookIdForLineItems = activeWorkbookId || displayedWorkbookIdRef.current || null;
    }
    const normalizeSheetName = (v: unknown) =>
      String(v ?? '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
    const displayedSheetNameToId = new Map<string, string>();
    const displayedSheetOrderToId = new Map<number, string>();
    let displayedLockedSheetIds: string[] = [];
    if (displayedWorkbookIdForLineItems) {
      const { data: liveDisplayedSheets } = await supabase
        .from('material_sheets')
        .select('id, sheet_name, order_index')
        .eq('workbook_id', displayedWorkbookIdForLineItems)
        .order('order_index');
      (liveDisplayedSheets || []).forEach((s: any) => {
        const id = String(s?.id ?? '').trim();
        if (!id) return;
        displayedLockedSheetIds.push(id);
        const nameKey = normalizeSheetName(s?.sheet_name);
        if (nameKey && !displayedSheetNameToId.has(nameKey)) displayedSheetNameToId.set(nameKey, id);
        const oi = Number(s?.order_index);
        if (Number.isFinite(oi) && !displayedSheetOrderToId.has(oi)) displayedSheetOrderToId.set(oi, id);
      });
    } else {
      materialSheets.forEach((s: any) => {
        const id = String(s?.id ?? '').trim();
        if (!id) return;
        const nameKey = normalizeSheetName(s?.sheet_name);
        if (nameKey && !displayedSheetNameToId.has(nameKey)) displayedSheetNameToId.set(nameKey, id);
        const oi = Number(s?.order_index);
        if (Number.isFinite(oi) && !displayedSheetOrderToId.has(oi)) displayedSheetOrderToId.set(oi, id);
      });
    }
    const workingSheetIdToDisplayedId = new Map<string, string>();
    const extraWorkingSheetIds: string[] = [];
    let quoteNativeSheetIds = new Set<string>();
    if (targetQuoteId) {
      const { data: quoteWbRows } = await supabase
        .from('material_workbooks')
        .select('id')
        .eq('quote_id', targetQuoteId);
      const quoteWbIdList = (quoteWbRows || []).map((w: { id?: string }) => String(w?.id ?? '').trim()).filter(Boolean);
      if (quoteWbIdList.length > 0) {
        const { data: nativeSheets } = await supabase
          .from('material_sheets')
          .select('id')
          .in('workbook_id', quoteWbIdList);
        quoteNativeSheetIds = new Set(
          (nativeSheets || []).map((s: { id?: string }) => String(s?.id ?? '').trim()).filter(Boolean),
        );
      }
    }
    const displayedSectionSheetIds = new Set(displayedLockedSheetIds.map((s) => String(s).trim()));
    // Map non-displayed workbook sheet_ids → displayed (contract) sheet_ids by section name / order.
    // Signed contract + locked proposal: labor line items may reference the job workbook or an older workbook row, not only `status=working`.
    if (targetQuoteId) {
      const anchorWbId = String(displayedWorkbookIdForLineItems ?? activeWorkbookId ?? '').trim();
      const { data: allQuoteWbs } = await supabase
        .from('material_workbooks')
        .select('id, material_sheets(id, sheet_name, order_index)')
        .eq('quote_id', targetQuoteId);
      (allQuoteWbs || []).forEach((wb: any) => {
        const wbid = String(wb?.id ?? '').trim();
        if (!wbid || (anchorWbId && wbid === anchorWbId)) return;
        const ws = ((wb?.material_sheets || []) as any[]) || [];
        ws.forEach((s: any) => {
          const wid = String(s?.id ?? '').trim();
          if (!wid) return;
          extraWorkingSheetIds.push(wid);
          const byName = displayedSheetNameToId.get(normalizeSheetName(s?.sheet_name));
          if (byName) {
            workingSheetIdToDisplayedId.set(wid, byName);
            return;
          }
          const byOrder = displayedSheetOrderToId.get(Number(s?.order_index));
          if (byOrder) workingSheetIdToDisplayedId.set(wid, byOrder);
        });
      });
    }
    let quoteSheetIds: string[] = [];
    if (targetQuoteId) {
      let quoteWb: any = null;
      let { data: wbData } = await supabase
        .from('material_workbooks')
        .select('id, material_sheets(id, material_items(id))')
        .eq('quote_id', targetQuoteId)
        .eq('status', 'working')
        .maybeSingle();
      quoteWb = wbData;
      if (!quoteWb) {
        const fallback = await supabase
          .from('material_workbooks')
          .select('id, material_sheets(id, material_items(id))')
          .eq('quote_id', targetQuoteId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        quoteWb = fallback.data;
      }
      const quoteSheets = (quoteWb as any)?.material_sheets || [];
      quoteSheetIds = quoteSheets.map((s: any) => s.id).filter(Boolean);
      const itemCount = quoteSheets.reduce((n: number, s: any) => n + ((s.material_items || []).length), 0);
      if (quoteSheetIds.length === 0 || itemCount === 0) {
        const { data: allQuoteWbs } = await supabase
          .from('material_workbooks')
          .select('id, material_sheets(id)')
          .eq('quote_id', targetQuoteId)
          .order('updated_at', { ascending: false });
        for (const wb of allQuoteWbs || []) {
          const sids = ((wb as any).material_sheets || []).map((s: any) => s.id).filter(Boolean);
          if (sids.length > 0) {
            quoteSheetIds = sids;
            break;
          }
        }
      }
      // Authoritative: only sheets on this proposal's workbooks (never stale P1 sheet ids).
      sheetIds = quoteNativeSheetIds.size > 0 ? Array.from(quoteNativeSheetIds) : Array.from(
        new Set([
          ...displayedLockedSheetIds,
          ...extraWorkingSheetIds,
          ...quoteSheetIds,
        ].filter(Boolean)),
      );
    } else {
      const { data: jobWb } = await supabase
        .from('material_workbooks')
        .select('id, material_sheets(id)')
        .eq('job_id', job.id)
        .eq('status', 'working')
        .maybeSingle();
      if (sheetIds.length === 0) sheetIds = ((jobWb as any)?.material_sheets || []).map((s: any) => s.id);
    }
    if (targetQuoteId) {
      const useLegacySheetLineItemsOnly = shouldSkipCustomRowItemQuoteIdColumn();
      let byQuoteErr: { code?: string; message?: string } | null = null;

      if (!useLegacySheetLineItemsOnly) {
        // Primary: proposal-scoped items (new behavior) when DB has quote_id column.
        const workbookIdsToLoad = new Set<string>();
        if (displayedWorkbookIdForLineItems) workbookIdsToLoad.add(displayedWorkbookIdForLineItems);
        const { data: workingWbForItems } = await supabase
          .from('material_workbooks')
          .select('id')
          .eq('quote_id', targetQuoteId)
          .eq('status', 'working')
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        const workingWbId = String((workingWbForItems as any)?.id ?? '').trim();
        if (workingWbId && workingWbId !== displayedWorkbookIdForLineItems) {
          workbookIdsToLoad.add(workingWbId);
        }

        let byQuoteQuery = supabase
          .from('custom_financial_row_items')
          .select('*')
          .eq('quote_id', targetQuoteId)
          .is('row_id', null)
          .order('order_index');
        const wbIds = Array.from(workbookIdsToLoad);
        const skipWorkbookFilter = shouldSkipCustomRowItemWorkbookFilter();
        if (wbIds.length > 0 && !skipWorkbookFilter) {
          byQuoteQuery = byQuoteQuery.or(`workbook_id.is.null,workbook_id.in.(${wbIds.join(',')})`);
        }
        let { data: byQuote, error: err } = await byQuoteQuery;
        byQuoteErr = err as typeof byQuoteErr;
        if (byQuoteErr && wbIds.length > 0 && isMissingCustomRowItemColumnError(byQuoteErr, 'workbook_id')) {
          markCustomRowItemsNoWorkbookIdColumn();
          const retryNoWb = await supabase
            .from('custom_financial_row_items')
            .select('*')
            .eq('quote_id', targetQuoteId)
            .is('row_id', null)
            .order('order_index');
          byQuote = retryNoWb.data;
          byQuoteErr = retryNoWb.error as typeof byQuoteErr;
        }
        if (byQuoteErr && isMissingCustomRowItemColumnError(byQuoteErr, 'quote_id')) {
          markCustomRowItemsNoQuoteIdColumn();
        } else if (!byQuoteErr) {
          sheetLinkedItems = (byQuote || []) as CustomRowLineItem[];
        }
      }

      if (useLegacySheetLineItemsOnly || byQuoteErr) {
        if (byQuoteErr) {
          const expectedSchemaGap =
            isMissingCustomRowItemColumnError(byQuoteErr, 'workbook_id') ||
            isMissingCustomRowItemColumnError(byQuoteErr, 'quote_id') ||
            isMissingCustomRowItemColumnError(byQuoteErr, 'section_name');
          if (!expectedSchemaGap) {
            console.error('Error loading quote-scoped sheet line items:', byQuoteErr);
          }
        }
        // Older DBs may not yet have quote_id/workbook_id/section_name columns. Fall back to legacy sheet_id-linked fetch.
        let legacySheetIds = sheetIds;
        if (legacySheetIds.length === 0 && quoteNativeSheetIds.size > 0) {
          legacySheetIds = Array.from(quoteNativeSheetIds);
        } else if (legacySheetIds.length === 0 && targetQuoteId) {
          try {
            const { data: wbRows } = await supabase
              .from('material_workbooks')
              .select('id')
              .eq('quote_id', targetQuoteId);
            const ids = (wbRows || []).map((w: any) => w.id).filter(Boolean);
            if (ids.length > 0) {
              const { data: sheetRows } = await supabase
                .from('material_sheets')
                .select('id')
                .in('workbook_id', ids);
              legacySheetIds = (sheetRows || []).map((s: any) => s.id).filter(Boolean);
            }
          } catch {
            // ignore; keep legacySheetIds as-is
          }
        }
        if (legacySheetIds.length > 0) {
          const { data: sheetItems, error: sheetItemsErr } = await supabase
            .from('custom_financial_row_items')
            .select('*')
            .in('sheet_id', legacySheetIds)
            .is('row_id', null)
            .order('order_index');
          if (sheetItemsErr) console.error('Error loading sheet-linked line items:', sheetItemsErr);
          const rawItems = (sheetItems || []) as CustomRowLineItem[];
          if (targetQuoteId && rawItems.length > 0) {
            const { data: sheetMetaRows } = await supabase
              .from('material_sheets')
              .select('id, material_workbooks!inner(quote_id)')
              .in('id', legacySheetIds);
            let allowedSheetIds = new Set(
              (sheetMetaRows || [])
                .filter(
                  (s: any) =>
                    String(s?.material_workbooks?.quote_id ?? '').trim() === targetQuoteId,
                )
                .map((s: any) => String(s?.id ?? '').trim())
                .filter(Boolean),
            );
            if (allowedSheetIds.size === 0 && quoteNativeSheetIds.size > 0) {
              allowedSheetIds = new Set(quoteNativeSheetIds);
              agentDebugLog({
                runId: 'post-fix',
                hypothesisId: 'H18-legacyJoinFallback',
                location: 'JobFinancials.tsx:loadCustomRows:legacyJoinFallback',
                message: 'workbook join returned no sheets — using quoteNativeSheetIds filter',
                data: {
                  targetQuoteId,
                  rawCount: rawItems.length,
                  nativeSheetCount: quoteNativeSheetIds.size,
                },
              });
            }
            if (allowedSheetIds.size === 0) {
              sheetLinkedItems = rawItems;
            } else {
              sheetLinkedItems = rawItems.filter((item) =>
                allowedSheetIds.has(String(item.sheet_id ?? '').trim()),
              );
            }
          } else {
            sheetLinkedItems = filterLineItemsForActiveQuote(rawItems, targetQuoteId);
          }
        } else {
          sheetLinkedItems = [];
        }
      }

      // Merge sheet_id rows only when quote-scoped query succeeded (DB has quote_id). Legacy-only path
      // already loaded all sheet-linked items — merging again duplicates line items across proposals.
      if (sheetIds.length > 0 && !useLegacySheetLineItemsOnly && !byQuoteErr) {
        const knownIds = new Set(
          sheetLinkedItems.map((i) => String(i?.id ?? '').trim()).filter(Boolean),
        );
        const knownFp = new Set(sheetLinkedItems.map((i) => lineItemOptimisticFingerprint(i)));
        const byQuoteSucceeded = true;
        const { data: bySheetRows, error: bySheetErr } = await supabase
          .from('custom_financial_row_items')
          .select('*')
          .in('sheet_id', sheetIds)
          .is('row_id', null)
          .order('order_index');
        if (bySheetErr) {
          console.error('Error loading sheet-linked line items (merge):', bySheetErr);
        } else {
          for (const row of (bySheetRows || []) as CustomRowLineItem[]) {
            const rid = String(row?.id ?? '').trim();
            const rowQuoteId = String((row as any)?.quote_id ?? '').trim() || null;
            if (rid && knownIds.has(rid)) continue;
            const fp = lineItemOptimisticFingerprint(row);
            if (knownFp.has(fp)) continue;
            if (byQuoteSucceeded && rowQuoteId) continue;
            if (rowQuoteId && rowQuoteId !== targetQuoteId) continue;
            if (rid) knownIds.add(rid);
            knownFp.add(fp);
            sheetLinkedItems.push(row);
          }
        }
      }
    } else if (sheetIds.length > 0) {
      const { data: sheetItems, error: sheetItemsErr } = await supabase
        .from('custom_financial_row_items')
        .select('*')
        .in('sheet_id', sheetIds)
        .is('row_id', null)
        .order('order_index');
      if (sheetItemsErr) console.error('Error loading sheet-linked line items:', sheetItemsErr);
      sheetLinkedItems = filterLineItemsForActiveQuote(
        (sheetItems || []) as CustomRowLineItem[],
        targetQuoteId,
      );
    }

    const allLineItems = [...rowLinkedItems, ...sheetLinkedItems];

    const sheetNameToId = new Map<string, string>();
    // Do not rely on React state being updated from loadMaterialsData() before loadCustomRows() runs.
    // Always prefer a direct read of the currently displayed workbook's sheets for stable mapping
    // from section_name -> sheet_id, so labor line items never "disappear" on first load/refresh.
    const workbookIdForSheetMap = displayedWorkbookIdForLineItems || activeWorkbookId;
    if (
      workbookIdForSheetMap &&
      workbookIdForSheetMap === displayedWorkbookIdForLineItems &&
      displayedSheetNameToId.size > 0
    ) {
      displayedSheetNameToId.forEach((id, nameKey) => {
        if (id && nameKey && !sheetNameToId.has(nameKey)) sheetNameToId.set(nameKey, id);
      });
    } else if (workbookIdForSheetMap) {
      const { data: liveSheets } = await supabase
        .from('material_sheets')
        .select('id, sheet_name, order_index')
        .eq('workbook_id', workbookIdForSheetMap)
        .order('order_index');
      (liveSheets || []).forEach((s: any) => {
        const id = String(s?.id ?? '').trim();
        const nameKey = normalizeSheetName(s?.sheet_name);
        if (id && nameKey && !sheetNameToId.has(nameKey)) sheetNameToId.set(nameKey, id);
      });
    } else {
      materialSheets.forEach((s: any) => {
        const id = String(s?.id ?? '').trim();
        const nameKey = normalizeSheetName(s?.sheet_name);
        if (id && nameKey && !sheetNameToId.has(nameKey)) sheetNameToId.set(nameKey, id);
      });
    }

    const getEffectiveParentId = (item: CustomRowLineItem) => {
      if (item.row_id) return duplicateToSurviving[item.row_id] ?? item.row_id;
      const sec = normalizeSheetName((item as any).section_name);
      if (sec && sheetNameToId.has(sec)) return sheetNameToId.get(sec) ?? null;
      const sid = item.sheet_id ?? null;
      if (!sid) return null;
      const sidStr = String(sid).trim();
      if (quoteNativeSheetIds.has(sidStr)) {
        if (displayedSectionSheetIds.has(sidStr)) return sidStr;
        const remapped = workingSheetIdToDisplayedId.get(sidStr);
        if (remapped) return remapped;
        return sidStr;
      }
      const remapped = workingSheetIdToDisplayedId.get(sidStr);
      if (remapped) return remapped;
      return sidStr;
    };
    let lineItemsMap: Record<string, CustomRowLineItem[]> = {};
    allLineItems.forEach(item => {
      const parentId = getEffectiveParentId(item);
      if (!parentId) return;
      if (!lineItemsMap[parentId]) lineItemsMap[parentId] = [];
      const fp = lineItemOptimisticFingerprint(item);
      const isDup = lineItemsMap[parentId].some(
        (ex) =>
          (item.id && ex.id === item.id) ||
          lineItemOptimisticFingerprint(ex) === fp,
      );
      if (!isDup) lineItemsMap[parentId].push(item);
    });
    Object.keys(lineItemsMap).forEach(k => {
      lineItemsMap[k].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    });

    const sheetIdToName = new Map<string, string>();
    displayedSheetNameToId.forEach((id, nameKey) => {
      const sid = String(id).trim();
      if (sid) sheetIdToName.set(sid, nameKey);
    });
    if (quoteNativeSheetIds.size > 0) {
      const { data: nativeMeta } = await supabase
        .from('material_sheets')
        .select('id, sheet_name')
        .in('id', Array.from(quoteNativeSheetIds));
      (nativeMeta || []).forEach((s: any) => {
        const id = String(s?.id ?? '').trim();
        if (id) sheetIdToName.set(id, String(s?.sheet_name ?? ''));
      });
    }
    const displayedSheetsForRekey: LaborSheetRef[] = displayedLockedSheetIds.map((id) => ({
      id: String(id),
      sheet_name: sheetIdToName.get(String(id)) ?? undefined,
    }));
    if (displayedSheetsForRekey.length > 0) {
      const rawLabor = laborTotalFromLineItemsMap(lineItemsMap);
      lineItemsMap = rekeySheetLineItemsToDisplayedSheets(
        lineItemsMap,
        displayedSheetsForRekey,
        sheetIdToName,
      );
      const metaPatch: Record<string, string> = {};
      sheetIdToName.forEach((name, id) => {
        metaPatch[id] = name;
      });
      if (Object.keys(metaPatch).length > 0) {
        sheetMetaByIdRef.current = { ...sheetMetaByIdRef.current, ...metaPatch };
        setSheetMetaById((prev) => ({ ...prev, ...metaPatch }));
      }
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H14-rekey',
        location: 'JobFinancials.tsx:loadCustomRows:rekey',
        message: 'rekeyed sheet line items onto displayed workbook sheets',
        data: {
          targetQuoteId,
          displayedWorkbookIdForLineItems,
          rawLabor,
          rekeyedLabor: laborTotalFromLineItemsMap(lineItemsMap),
          displayedSheetIds: displayedSheetsForRekey.map((s) => s.id),
          mappedKeys: Object.keys(lineItemsMap),
        },
      });
    }

    const laborLineItemTotal = laborTotalFromLineItemsMap(lineItemsMap);
    agentDebugLog({
      runId: 'post-fix',
      hypothesisId: 'H9-sheetLineItems',
      location: 'JobFinancials.tsx:loadCustomRows:done',
      message: 'sheet-linked line items mapped',
      data: {
        targetQuoteId,
        displayedWorkbookIdForLineItems,
        legacySheetIdCount: sheetIds.length,
        sheetLinkedCount: sheetLinkedItems.length,
        mappedSheetKeyCount: Object.keys(lineItemsMap).length,
        laborLineItemTotal,
        cooperativeGen,
      },
    });
    if (isFinancialLoadStale(cooperativeGen)) {
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H9-sheetLineItems',
        location: 'JobFinancials.tsx:loadCustomRows:staleAbort',
        message: 'aborted before setCustomRowLineItems — stale cooperativeGen',
        data: { targetQuoteId, cooperativeGen, currentGen: financialLoadCoopGenRef.current, laborLineItemTotal },
      });
      if (targetQuoteId && laborLineItemTotal > 0) {
        saveQuoteLineItemsCache(targetQuoteId, lineItemsMap);
      }
      return;
    }
    const lineItemsApplyAbort = customRowsApplyAbortReason(targetQuoteId, cooperativeGen);
    if (lineItemsApplyAbort === 'wrongQuote') {
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H10-staleApply',
        location: 'JobFinancials.tsx:loadCustomRows:abortLineItems',
        message: 'aborted setCustomRowLineItems — proposal switched during async load',
        data: {
          targetQuoteId,
          activeQuoteId: prevFinancialQuoteIdRef.current,
          laborLineItemTotal,
          cooperativeGen,
        },
      });
      return;
    }
    const quoteChanged = lastCustomRowsQuoteIdRef.current !== targetQuoteId;
    lastCustomRowsQuoteIdRef.current = targetQuoteId;

    const prevItems = customRowLineItemsLiveRef.current;
    const prevLabor = laborTotalFromLineItemsMap(prevItems);
    const next: Record<string, CustomRowLineItem[]> = { ...lineItemsMap };
    const cached = targetQuoteId ? customRowLineItemsByQuoteRef.current[targetQuoteId] : null;
    const cachedLabor = cached ? laborTotalFromLineItemsMap(cached) : 0;
    const sectionLaborLive = laborTotalFromLineItemsMap(sheetSectionLineItemsLiveRef.current);

    const rekeyIfNeeded = (map: Record<string, CustomRowLineItem[]>) => {
      if (displayedSheetsForRekey.length === 0) return map;
      const rekeyed = rekeySheetLineItemsToDisplayedSheets(map, displayedSheetsForRekey, sheetIdToName);
      return laborTotalFromLineItemsMap(rekeyed) > 0 ? rekeyed : map;
    };

    const pickKeepMap = () =>
      pickBestLineItemsMap([
        cachedLabor > 0 ? cached : null,
        prevLabor > 0 ? prevItems : null,
        sectionLaborLive > 0 ? sheetSectionLineItemsLiveRef.current : null,
      ]) ?? prevItems;

    let finalMap: Record<string, CustomRowLineItem[]> = next;

    if (quoteChanged) {
      const displayedIds = new Set(displayedLockedSheetIds.map((id) => String(id).trim()));
      const keyOverlap =
        displayedIds.size > 0 &&
        Object.keys(next).some((k) => displayedIds.has(String(k).trim()));
      if (laborLineItemTotal === 0 && (cachedLabor > 0 || prevLabor > 0 || sectionLaborLive > 0)) {
        finalMap = rekeyIfNeeded(JSON.parse(JSON.stringify(pickKeepMap())));
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H12-sameQuoteWipe',
          location: 'JobFinancials.tsx:loadCustomRows:keepCachedLineItems',
          message: 'proposal switch reload mapped zero labor — keeping cache/prev',
          data: { targetQuoteId, cachedLabor, prevLabor, sectionLaborLive },
        });
      } else if (laborLineItemTotal > 0 && !keyOverlap && (cachedLabor > 0 || prevLabor > 0 || sectionLaborLive > 0)) {
        finalMap = rekeyIfNeeded(JSON.parse(JSON.stringify(pickKeepMap())));
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H14-rekey',
          location: 'JobFinancials.tsx:loadCustomRows:keepCacheWrongKeys',
          message: 'mapped labor has no key overlap with displayed sheets — keeping cache/prev',
          data: {
            targetQuoteId,
            laborLineItemTotal,
            mappedKeys: Object.keys(next),
            displayedSheetIds: Array.from(displayedIds),
            cachedLabor,
            prevLabor,
            sectionLaborLive,
          },
        });
      } else if (targetQuoteId && laborLineItemTotal > 0) {
        saveQuoteLineItemsCache(targetQuoteId, next);
      }
    } else if (laborLineItemTotal === 0 && (prevLabor > 0 || cachedLabor > 0 || sectionLaborLive > 0)) {
      finalMap = rekeyIfNeeded(JSON.parse(JSON.stringify(pickKeepMap())));
      agentDebugLog({
        runId: 'post-fix',
        hypothesisId: 'H12-sameQuoteWipe',
        location: 'JobFinancials.tsx:loadCustomRows:keepPrevOnSameQuoteEmpty',
        message: 'same-quote reload mapped zero labor — keeping existing line items',
        data: { targetQuoteId, prevLabor, cachedLabor, sectionLaborLive, cooperativeGen },
      });
    } else {
      for (const parentId of Object.keys(prevItems || {})) {
        const prevParentItems = prevItems[parentId] || [];
        const optimistic = prevParentItems.filter((it: any) => String(it?.id || '').startsWith('optimistic_'));
        const realItems = prevParentItems.filter((it: any) => !String(it?.id || '').startsWith('optimistic_'));
        if (!next[parentId]?.length && realItems.length) {
          next[parentId] = [...realItems];
        }
        if (!optimistic.length) continue;
        const existingIds = new Set((next[parentId] || []).map((it: any) => String(it?.id || '')));
        const serverFp = new Set((next[parentId] || []).map((it: any) => lineItemOptimisticFingerprint(it)));
        const toAdd = optimistic.filter((it: any) => {
          if (existingIds.has(String(it?.id || ''))) return false;
          if (serverFp.has(lineItemOptimisticFingerprint(it))) return false;
          return true;
        });
        if (toAdd.length) next[parentId] = [...(next[parentId] || []), ...toAdd];
      }

      const mergedLabor = laborTotalFromLineItemsMap(next);
      if (mergedLabor < prevLabor && prevLabor > 0) {
        finalMap = rekeyIfNeeded(JSON.parse(JSON.stringify(pickKeepMap())));
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H12-sameQuoteWipe',
          location: 'JobFinancials.tsx:loadCustomRows:keepPrevOnLaborDrop',
          message: 'same-quote reload would reduce labor — keeping existing line items',
          data: { targetQuoteId, prevLabor, mergedLabor, cooperativeGen },
        });
      } else {
        finalMap = next;
        if (targetQuoteId && mergedLabor > 0) {
          saveQuoteLineItemsCache(targetQuoteId, next);
        }
      }
    }

    if (laborTotalFromLineItemsMap(finalMap) <= 0) {
      const fallback = pickKeepMap();
      const fallbackLabor = laborTotalFromLineItemsMap(fallback);
      if (fallbackLabor > 0) {
        finalMap = rekeyIfNeeded(JSON.parse(JSON.stringify(fallback)));
        agentDebugLog({
          runId: 'post-fix',
          hypothesisId: 'H19-emptyCommit',
          location: 'JobFinancials.tsx:loadCustomRows:finalFallback',
          message: 'mapped reload empty — restored from cache/live before commit',
          data: { targetQuoteId, fallbackLabor, cooperativeGen },
        });
      }
    }

    commitSheetLineItemsState(finalMap, targetQuoteId);
    agentDebugLog({
      runId: 'post-fix',
      hypothesisId: 'H9-sheetLineItems',
      location: 'JobFinancials.tsx:loadCustomRows:committed',
      message: 'committed sheet line items to state',
      data: {
        targetQuoteId,
        activeQuoteId: prevFinancialQuoteIdRef.current,
        finalLabor: laborTotalFromLineItemsMap(finalMap),
        quoteChanged,
        cooperativeGen,
      },
    });
  }

  async function loadLaborPricing() {
    const { data, error } = await supabase
      .from('labor_pricing')
      .select('*')
      .eq('job_id', job.id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error loading labor pricing:', error);
      return;
    }

    if (data) {
      if (JSON.stringify(data) !== JSON.stringify(laborPricing)) {
        setLaborPricing(data);
        setHourlyRate(data.hourly_rate.toString());
      }
    } else {
      if (hourlyRate !== '60') {
        setHourlyRate('60');
      }
    }
  }

  async function loadLaborHours() {
    const { data, error } = await supabase
      .from('time_entries')
      .select('total_hours, crew_count')
      .eq('job_id', job.id);

    if (error) {
      console.error('Error loading labor hours:', error);
      return;
    }

    const totalHours = (data || []).reduce((sum, entry) => {
      return sum + (entry.total_hours || 0) * (entry.crew_count || 1);
    }, 0);

    if (totalHours !== totalClockInHours) {
      setTotalClockInHours(totalHours);
    }
  }

  async function saveLaborPricing() {
    const rate = parseFloat(hourlyRate) || 60;
    const billable = rate;

    const pricingData = {
      job_id: job.id,
      hourly_rate: rate,
      markup_percent: 0,
      billable_rate: billable,
      notes: null,
    };

    try {
      if (laborPricing) {
        const { error } = await supabase
          .from('labor_pricing')
          .update(pricingData)
          .eq('id', laborPricing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('labor_pricing')
          .insert([pricingData]);

        if (error) throw error;
      }

      toast.success('Labor pricing saved');
      await loadLaborPricing();
    } catch (error: any) {
      console.error('Error saving labor pricing:', error);
      toast.error('Failed to save labor pricing');
    }
  }

  function openAddDialog(row?: CustomFinancialRow, sheetId?: string, categoryType?: 'materials' | 'labor') {
    if (row) {
      setEditingRow(row);
      setCategory(row.category);
      setDescription(row.description);
      setQuantity(row.quantity.toString());
      setUnitCost(row.unit_cost.toString());
      setMarkupPercent(row.markup_percent.toString());
      setNotes(row.notes || '');
      setTaxable(row.taxable !== undefined ? row.taxable : true);
      setLinkedSheetId((row as any).sheet_id || null);
    } else {
      resetForm();
      if (sheetId) {
        // If opening from a material sheet, pre-populate category and link
        const cat = categoryType || 'materials';
        setCategory(cat);
        setTaxable(cat === 'materials'); // Materials default to taxable, labor to non-taxable
        setLinkedSheetId(sheetId);
      }
    }
    setShowAddDialog(true);
  }

  function resetForm() {
    setEditingRow(null);
    setCategory('materials');
    setDescription('');
    setQuantity('1');
    setUnitCost('0'); // Default to 0 - user can add line items without base cost
    setMarkupPercent('0');
    setNotes('');
    setTaxable(true);
    setLinkedSheetId(null);
  }

  async function saveCustomRow() {
    if (isReadOnly) {
      toast.error('Cannot edit in historical view');
      return;
    }
    
    if (!description || !unitCost) {
      toast.error('Please fill in description and ' + (category === 'labor' ? 'hourly rate' : 'unit cost'));
      return;
    }

    const qty = parseFloat(quantity) || 1;
    const cost = parseFloat(unitCost) || 0;
    const markup = parseFloat(markupPercent) || 0;
    const totalCost = qty * cost;
    const sellingPrice = totalCost * (1 + markup / 100);

    try {
      // If category is subcontractor, create a subcontractor_estimate instead
      if (category === 'subcontractor' && !editingRow) {
        // Get max order_index for subcontractor estimates
        const maxOrderIndex = subcontractorEstimates.length > 0
          ? Math.max(...subcontractorEstimates.map(s => s.order_index))
          : -1;
        
        // Create subcontractor estimate
        const { data: estData, error: estError } = await supabase
          .from('subcontractor_estimates')
          .insert([{
            job_id: job.id,
            quote_id: quote?.id ?? null,
            company_name: description,
            total_amount: totalCost,
            markup_percent: markup,
            scope_of_work: notes || null,
            order_index: maxOrderIndex + 1,
            is_option: false,
            sheet_id: linkedSheetId || null,
            extraction_status: 'completed',
          }])
          .select()
          .single();

        if (estError) throw estError;

        // Create a single line item for the total
        const { error: lineError } = await supabase
          .from('subcontractor_estimate_line_items')
          .insert([{
            estimate_id: estData.id,
            description: description,
            quantity: qty,
            unit_price: cost,
            total_price: totalCost,
            taxable: taxable,
            excluded: false,
            order_index: 0,
          }]);

        if (lineError) throw lineError;

        toast.success('Subcontractor added');
        setShowAddDialog(false);
        resetForm();
        await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
        return;
      }

      // For all other categories (or editing existing custom row)
      let targetOrderIndex: number;

      if (editingRow) {
        targetOrderIndex = editingRow.order_index;
      } else {
        const maxOrderIndex = customRows.length > 0 
          ? Math.max(...customRows.map(r => r.order_index))
          : -1;
        targetOrderIndex = maxOrderIndex + 1;
      }

      const rowData = {
        job_id: job.id,
        quote_id: quote?.id ?? null,
        category,
        description,
        quantity: qty,
        unit_cost: cost,
        total_cost: totalCost,
        markup_percent: markup,
        selling_price: sellingPrice,
        notes: notes || null,
        taxable: taxable, // Use the taxable state from checkbox
        order_index: targetOrderIndex,
        sheet_id: linkedSheetId || null,
      };

      if (editingRow) {
        const { data, error } = await supabase
          .from('custom_financial_rows')
          .update(rowData)
          .eq('id', editingRow.id)
          .select();

        if (error) throw error;
        toast.success('Row updated');
      } else {
        const { data, error } = await supabase
          .from('custom_financial_rows')
          .insert([{ ...rowData, is_option: false }])
          .select();

        if (error) throw error;
        toast.success(category === 'labor' ? 'Labor row added' : 'Row added');
      }

      setShowAddDialog(false);
      resetForm();
      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error saving row:', error);
      toast.error(`Failed to save row: ${error.message || 'Unknown error'}`);
    }
  }

  function openSheetDescDialog(sheetId: string, currentDescription: string) {
    setEditingSheetId(sheetId);
    setSheetDescription(currentDescription || '');
    setShowSheetDescDialog(true);
  }

  async function saveSheetDescription() {
    if (!editingSheetId) return;

    try {
      const { error } = await supabase
        .from('material_sheets')
        .update({ description: sheetDescription || null })
        .eq('id', editingSheetId);

      if (error) throw error;

      toast.success('Description saved');
      setShowSheetDescDialog(false);
      setEditingSheetId(null);
      setSheetDescription('');
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error saving sheet description:', error);
      toast.error('Failed to save description');
    }
  }

  // Row name editing functions
  function startEditingRowName(id: string, type: 'sheet' | 'custom' | 'subcontractor', currentName: string) {
    setEditingRowName(id);
    setEditingRowNameType(type);
    setTempRowName(currentName);
  }

  function cancelEditingRowName() {
    setEditingRowName(null);
    setEditingRowNameType(null);
    setTempRowName('');
  }

  async function saveRowName() {
    if (!editingRowName || !editingRowNameType || !tempRowName.trim()) {
      toast.error('Please enter a name');
      return;
    }

    try {
      if (editingRowNameType === 'sheet') {
        const { error } = await supabase
          .from('material_sheets')
          .update({ sheet_name: tempRowName.trim() })
          .eq('id', editingRowName);

        if (error) throw error;
        await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
      } else if (editingRowNameType === 'custom') {
        const { error } = await supabase
          .from('custom_financial_rows')
          .update({ description: tempRowName.trim() })
          .eq('id', editingRowName);

        if (error) throw error;
        await loadCustomRows(quote?.id ?? null, !!isReadOnly);
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
      } else if (editingRowNameType === 'subcontractor') {
        const { error } = await supabase
          .from('subcontractor_estimates')
          .update({ company_name: tempRowName.trim() })
          .eq('id', editingRowName);

        if (error) throw error;
        await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
      }

      toast.success('Name updated');
      cancelEditingRowName();
    } catch (error: any) {
      console.error('Error updating name:', error);
      toast.error('Failed to update name');
    }
  }

  function openLaborDialog(sheetId?: string, rowId?: string) {
    if (sheetId) {
      const existingLabor = sheetLabor[sheetId];
      const nativeSheetLabor =
        existingLabor && isNativeMaterialSheetLabor(existingLabor, sheetId) ? existingLabor : null;
      setEditingLaborSheetId(sheetId);
      setEditingLaborRowId(null);
      
      if (nativeSheetLabor) {
        setLaborForm({
          description: nativeSheetLabor.description,
          estimated_hours: nativeSheetLabor.estimated_hours,
          hourly_rate: nativeSheetLabor.hourly_rate,
          notes: nativeSheetLabor.notes || '',
        });
      } else {
        setLaborForm({
          description: 'Labor & Installation',
          estimated_hours: 0,
          hourly_rate: 60,
          notes: '',
        });
      }
    } else if (rowId) {
      const existingLabor = customRowLabor[rowId];
      setEditingLaborRowId(rowId);
      setEditingLaborSheetId(null);
      
      if (existingLabor) {
        setLaborForm({
          description: existingLabor.description,
          estimated_hours: existingLabor.estimated_hours,
          hourly_rate: existingLabor.hourly_rate,
          notes: existingLabor.notes || '',
        });
      } else {
        setLaborForm({
          description: 'Labor & Installation',
          estimated_hours: 0,
          hourly_rate: 60,
          notes: '',
        });
      }
    }
    
    setShowLaborDialog(true);
  }

  async function saveSheetLabor() {
    if (editingLaborSheetId) {
      // Save material sheet labor
      const existingLabor = sheetLabor[editingLaborSheetId];
      const nativeExisting =
        existingLabor && isNativeMaterialSheetLabor(existingLabor, editingLaborSheetId)
          ? existingLabor
          : null;
      const laborData = {
        sheet_id: editingLaborSheetId,
        description: laborForm.description,
        estimated_hours: laborForm.estimated_hours,
        hourly_rate: laborForm.hourly_rate,
        notes: laborForm.notes || null,
      };

      try {
        if (nativeExisting?.id) {
          const { error } = await supabase
            .from('material_sheet_labor')
            .update(laborData)
            .eq('id', nativeExisting.id);

          if (error) throw error;
          toast.success('Labor updated');
          const total = (laborData.estimated_hours ?? 0) * (laborData.hourly_rate ?? 0);
          setSheetLabor(prev => ({
            ...prev,
            [editingLaborSheetId]: {
              ...nativeExisting,
              ...laborData,
              total_labor_cost: total,
              labor_source_sheet_id: String(editingLaborSheetId).trim(),
            },
          }));
        } else {
          const { data: inserted, error } = await supabase
            .from('material_sheet_labor')
            .insert([laborData])
            .select('id, sheet_id, description, estimated_hours, hourly_rate, notes')
            .single();

          if (error) throw error;
          toast.success('Labor added');
          const total = (laborData.estimated_hours ?? 0) * (laborData.hourly_rate ?? 0);
          if (inserted)
            setSheetLabor(prev => ({
              ...prev,
              [editingLaborSheetId]: {
                ...inserted,
                total_labor_cost: total,
                labor_source_sheet_id: String(inserted.sheet_id ?? editingLaborSheetId).trim(),
              },
            }));
        }

        setShowLaborDialog(false);
        setEditingLaborSheetId(null);
        // Brief delay so DB commit is visible to the next read; then reload to refresh totals and keep UI in sync
        await new Promise(r => setTimeout(r, 150));
        await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
      } catch (error: any) {
        console.error('Error saving labor:', error);
        const msg = error?.message || error?.error_description || 'Failed to save labor';
        toast.error(msg.length > 80 ? 'Failed to save labor' : msg);
      }
    } else if (editingLaborRowId) {
      // Save custom row labor (store in notes as JSON)
      try {
        const row = customRows.find(r => r.id === editingLaborRowId);
        if (!row) return;

        const laborData = {
          description: laborForm.description,
          estimated_hours: laborForm.estimated_hours,
          hourly_rate: laborForm.hourly_rate,
          notes: laborForm.notes || '',
        };

        const notesData = { labor: laborData };

        const { error } = await supabase
          .from('custom_financial_rows')
          .update({ notes: JSON.stringify(notesData) })
          .eq('id', editingLaborRowId);

        if (error) throw error;
        toast.success('Labor added');
        setShowLaborDialog(false);
        await loadCustomRows(quote?.id ?? null, !!isReadOnly);
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
      } catch (error: any) {
        console.error('Error saving labor:', error);
        toast.error('Failed to save labor');
      }
    }
  }

  async function deleteSheetLabor(laborId: string) {
    if (!confirm('Delete labor for this section?')) return;

    try {
      const { error } = await supabase
        .from('material_sheet_labor')
        .delete()
        .eq('id', laborId);

      if (error) throw error;
      toast.success('Labor deleted');
      
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error deleting labor:', error);
      toast.error('Failed to delete labor');
    }
  }

  async function deleteCustomRowLabor(rowId: string) {
    if (!confirm('Delete labor for this row?')) return;

    try {
      const { error } = await supabase
        .from('custom_financial_rows')
        .update({ notes: null })
        .eq('id', rowId);

      if (error) throw error;
      toast.success('Labor deleted');
      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error deleting labor:', error);
      toast.error('Failed to delete labor');
    }
  }

  async function deleteRow(id: string) {
    if (!confirm('Delete this financial row?')) return;

    try {
      const { data: row, error: fetchErr } = await supabase
        .from('custom_financial_rows')
        .select('id, quote_id')
        .eq('id', id)
        .maybeSingle();
      if (fetchErr || !row) {
        toast.error('Row not found');
        return;
      }
      const isJobLevel = row.quote_id == null;
      const isCurrentProposal = quote?.id && row.quote_id === quote.id;
      if (isJobLevel && quote?.id) {
        try {
          const { error: insertErr } = await supabase
            .from('quote_removed_sections')
            .upsert({ quote_id: quote.id, section_type: 'custom_row', section_id: id }, { onConflict: 'quote_id,section_type,section_id' });
          if (insertErr) throw insertErr;
          toast.success('Section removed from this proposal. It will still appear on previously sent proposals.');
        } catch (_) {
          const { error: delErr } = await supabase.from('custom_financial_rows').delete().eq('id', id);
          if (delErr) throw delErr;
          toast.success('Section removed. Run the migration "quote_removed_sections" to remove from this proposal only (keep on sent proposals) next time.');
        }
      } else if (isCurrentProposal || !isJobLevel) {
        const { error } = await supabase
          .from('custom_financial_rows')
          .delete()
          .eq('id', id);
        if (error) throw error;
        toast.success('Row deleted');
      } else {
        toast.error('Cannot delete this row from the current proposal');
        return;
      }
      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error deleting row:', error);
      toast.error(error?.message ?? 'Failed to delete row');
    }
  }

  // Line item functions
  function openLineItemDialog(
    parentId: string,
    lineItem?: CustomRowLineItem,
    itemType?: 'material' | 'labor' | 'combined',
    parentType?: 'sheet' | 'row'
  ) {
    setLineItemParentRowId(parentId);
    setLineItemParentType(parentType ?? (lineItem?.sheet_id ? 'sheet' : lineItem?.row_id ? 'row' : null));

    const numStr = (n: unknown, fallback: string) => {
      if (n == null || n === '') return fallback;
      const v = Number(n);
      return Number.isFinite(v) ? String(v) : fallback;
    };

    if (!lineItem) {
      setLineItemType(itemType || 'combined');
      setEditingLineItem(null);
      const defaultItemType = itemType === 'labor' ? 'labor' : 'material';
      setLineItemForm({
        description: '',
        quantity: '1',
        unit_cost: '0',
        notes: '',
        taxable: defaultItemType === 'material',
        item_type: defaultItemType,
        markup_percent: '10',
        labor_hours: '0',
        labor_rate: '60',
        labor_markup_percent: '10',
        hide_from_customer: false,
      });
      setShowLineItemDialog(true);
      return;
    }

    setEditingLineItem(lineItem);

    // Labor in JSON notes (combined lines); otherwise plain text stays in notes
    let laborData = { hours: 0, rate: 60, markup: 10 };
    let actualNotes = lineItem.notes || '';
    let laborFromNotesJson = false;

    if (lineItem.notes) {
      try {
        const parsed = JSON.parse(lineItem.notes);
        if (parsed && typeof parsed === 'object' && parsed.labor) {
          laborFromNotesJson = true;
          laborData = {
            hours: Number(parsed.labor.hours) || 0,
            rate: Number(parsed.labor.rate) || 60,
            markup:
              parsed.labor.markup != null && parsed.labor.markup !== ''
                ? Number(parsed.labor.markup)
                : 10,
          };
          actualNotes = typeof parsed.notes === 'string' ? parsed.notes : '';
        }
      } catch {
        // Not JSON, use as regular notes
      }
    }

    // Labor-only rows persist hours/rate in quantity & unit_cost (see saveLineItem); notes are often plain text
    const isLaborRow = itemType === 'labor' || lineItem.item_type === 'labor';
    if (isLaborRow && !laborFromNotesJson) {
      laborData = {
        hours: Number(lineItem.quantity) || 0,
        rate: Number(lineItem.unit_cost) || 60,
        markup: (() => {
          const raw = lineItem.markup_percent as number | string | null | undefined;
          if (raw == null || raw === '') return 10;
          const n = Number(raw);
          return Number.isFinite(n) ? n : 10;
        })(),
      };
    }

    const q = Number(lineItem.quantity) || 0;
    const uc = Number(lineItem.unit_cost) || 0;
    const hasMaterialPortion = !isLaborRow && (q * uc > 0 || q > 0 || uc > 0);
    let dialogType: 'material' | 'labor' | 'combined' = itemType || 'combined';
    if (laborFromNotesJson && hasMaterialPortion) {
      dialogType = 'combined';
    } else if (!itemType) {
      dialogType = lineItem.item_type === 'labor' ? 'labor' : 'material';
    }

    setLineItemType(dialogType);

    setLineItemForm({
      description: lineItem.description ?? '',
      quantity: numStr(lineItem.quantity, '1'),
      unit_cost: numStr(lineItem.unit_cost, '0'),
      notes: actualNotes,
      taxable: lineItem.taxable !== undefined ? lineItem.taxable : true,
      item_type: (lineItem as any).item_type || 'material',
      markup_percent: numStr(lineItem.markup_percent, '10'),
      labor_hours: numStr(laborData.hours, '0'),
      labor_rate: numStr(laborData.rate, '60'),
      labor_markup_percent: numStr(laborData.markup, '10'),
      hide_from_customer: !!(lineItem as any).hide_from_customer,
    });

    setShowLineItemDialog(true);
  }

  async function saveLineItem(keepDialogOpen = false) {
    if (!lineItemParentRowId || !lineItemForm.description) {
      toast.error('Please fill in description');
      return;
    }
    if (savingLineItemRef.current) return;
    savingLineItemRef.current = true;
    setSavingLineItem(true);

    // Determine if this is for a sheet or a custom row (sheet = line items under a material sheet, e.g. Add Labor from sheet dropdown)
    // Prefer the explicit parent type set when opening the dialog; the heuristic can be wrong while materials are still loading.
    const isSheet =
      lineItemParentType === 'sheet' ||
      (!!editingLineItem?.sheet_id && !editingLineItem?.row_id) ||
      materialSheets.some(s => s.id === lineItemParentRowId) ||
      materialsBreakdown.sheetBreakdowns.some((s: any) => s.sheetId === lineItemParentRowId);
    
    // Calculate costs based on line item type
    let totalCost = 0;
    let qty = 0;
    let cost = 0;
    let markup = 0;
    let actualItemType = lineItemForm.item_type;
    let notesData = lineItemForm.notes || null;
    
    if (lineItemType === 'labor') {
      // Labor-only item
      const laborHours = parseFloat(lineItemForm.labor_hours) || 0;
      const laborRate = parseFloat(lineItemForm.labor_rate) || 0;
      totalCost = laborHours * laborRate;
      qty = laborHours;
      cost = laborRate;
      markup = parseFloat(lineItemForm.labor_markup_percent) || 0;
      actualItemType = 'labor';
    } else if (lineItemType === 'combined') {
      // Combined material + labor
      const materialQty = parseFloat(lineItemForm.quantity) || 0;
      const materialCost = parseFloat(lineItemForm.unit_cost) || 0;
      const materialTotal = materialQty * materialCost;
      
      const laborHours = parseFloat(lineItemForm.labor_hours) || 0;
      const laborRate = parseFloat(lineItemForm.labor_rate) || 0;
      const laborTotal = laborHours * laborRate;
      
      totalCost = materialTotal + laborTotal;
      qty = materialQty;
      cost = materialCost;
      markup = parseFloat(lineItemForm.markup_percent) || 0;
      actualItemType = 'material'; // Combined items are primarily material
      
      // Store labor data in notes if present
      if (laborHours > 0) {
        notesData = JSON.stringify({
          labor: {
            hours: laborHours,
            rate: laborRate,
            markup: parseFloat(lineItemForm.labor_markup_percent) || 0,
          },
          notes: lineItemForm.notes || '',
        });
      }
    } else {
      // Material-only item
      qty = parseFloat(lineItemForm.quantity) || 0;
      cost = parseFloat(lineItemForm.unit_cost) || 0;
      totalCost = qty * cost;
      markup = parseFloat(lineItemForm.markup_percent) || 0;
      actualItemType = 'material';
    }
    
    // Sheet line items should always be proposal-scoped. In some races (fresh load / split view),
    // `activeWorkbookId` can be null even though a workbook exists; resolve one so inserts don't fail.
    let effectiveWorkbookId: string | null = isSheet ? (activeWorkbookId ?? null) : null;
    if (isSheet && !effectiveWorkbookId && quote?.id) {
      try {
        const { data: wb } = await supabase
          .from('material_workbooks')
          .select('id')
          .eq('quote_id', quote.id)
          .eq('status', 'working')
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        effectiveWorkbookId = wb?.id ?? null;
        if (!effectiveWorkbookId) {
          const { data: wb2 } = await supabase
            .from('material_workbooks')
            .select('id')
            .eq('quote_id', quote.id)
            .order('version_number', { ascending: false })
            .limit(1)
            .maybeSingle();
          effectiveWorkbookId = wb2?.id ?? null;
        }
      } catch {
        // non-blocking; keep null and let DB error surface
      }
    }

    // NOTE: Some deployments use `total_cost` while newer ones use `total_price`.
    // Build base payload without the total column, then try the right column name via retries.
    //
    // IMPORTANT: When the UI is showing the LOCKED contract workbook, `lineItemParentRowId` is a locked sheet_id.
    // On older DBs (no quote_id/section_name/workbook_id columns), persistence relies on `sheet_id`, so saving
    // against a locked sheet_id makes the row disappear when viewing the WORKING workbook (different sheet ids).
    // Resolve the canonical WORKING sheet_id by section name and persist against that whenever possible.
    let persistSheetId: string | null = isSheet ? lineItemParentRowId : null;
    const persistSectionName =
      isSheet
        ? (materialSheets.find((s: any) => s.id === lineItemParentRowId)?.sheet_name ??
            materialsBreakdown.sheetBreakdowns.find((s: any) => s.sheetId === lineItemParentRowId)?.sheetName ??
            null)
        : null;
    if (isSheet && quote?.id && persistSectionName) {
      try {
        const normalize = (v: unknown) =>
          String(v ?? '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ');
        const targetNameKey = normalize(persistSectionName);
        const { data: wb } = await supabase
          .from('material_workbooks')
          .select('id, material_sheets(id, sheet_name, order_index)')
          .eq('quote_id', quote.id)
          .eq('status', 'working')
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        const ws = (wb as any)?.material_sheets || [];
        const byName = (ws || []).find((s: any) => normalize(s?.sheet_name) === targetNameKey);
        if (byName?.id) persistSheetId = byName.id;
      } catch {
        // non-blocking: keep best-effort persistSheetId
      }
    }

    // Only send proposal-scope columns for sheet line items. Row-linked items use row_id; sending
    // quote_id/section_name/workbook_id as null still hits PostgREST "unknown column" on DBs that
    // never migrated those columns.
    const itemDataBase: Record<string, any> = {
      row_id: isSheet ? null : lineItemParentRowId,
      sheet_id: isSheet ? persistSheetId : null,
      description: lineItemForm.description,
      quantity: qty,
      unit_cost: cost,
      notes: notesData,
      taxable: actualItemType === 'labor' ? false : lineItemForm.taxable,
      item_type: actualItemType,
      markup_percent: markup,
      order_index: editingLineItem 
        ? editingLineItem.order_index 
        : (customRowLineItems[lineItemParentRowId]?.length || 0),
      hide_from_customer: lineItemForm.hide_from_customer,
    };
    if (isSheet) {
      itemDataBase.quote_id = quote?.id ?? null;
      itemDataBase.workbook_id = effectiveWorkbookId;
      itemDataBase.section_name = persistSectionName;
    }

    const isMissingColumnError = (err: any, col: string) => {
      const blob = [err?.message, err?.details, err?.hint]
        .filter(Boolean)
        .map((x) => String(x).toLowerCase())
        .join(' ');
      const c = col.toLowerCase();
      return (
        blob.includes(`could not find the '${c}' column`) ||
        blob.includes(`could not find the "${c}" column`) ||
        blob.includes(`column ${c} does not exist`) ||
        blob.includes(` '${c}' column`)
      );
    };
    const needsLegacyCustomRowItemPayload = (err: any) =>
      ['quote_id', 'section_name', 'workbook_id', 'hide_from_customer', 'total_price', 'total_cost'].some(
        (col) => isMissingColumnError(err, col),
      );
    const withTotalCost = (d: Record<string, any>) => ({ ...d, total_cost: totalCost });
    const withTotalPrice = (d: Record<string, any>) => ({ ...d, total_price: totalCost });
    const toLegacyTotalCost = (d: Record<string, any>) => {
      const legacy = { ...d };
      if ('total_price' in legacy) {
        legacy.total_cost = legacy.total_price;
        delete legacy.total_price;
      }
      return legacy;
    };
    const dropProposalScopeColumns = (d: Record<string, any>) => {
      const legacy = { ...d };
      delete legacy.quote_id;
      delete legacy.section_name;
      delete legacy.workbook_id;
      delete legacy.hide_from_customer;
      return legacy;
    };

    try {
      if (editingLineItem) {
        const { error } = await supabase
          .from('custom_financial_row_items')
          .update(withTotalCost(itemDataBase))
          .eq('id', editingLineItem.id)
          .limit(1);
        if (error && needsLegacyCustomRowItemPayload(error)) {
          let legacyData: Record<string, any> = dropProposalScopeColumns(itemDataBase);
          if (isMissingColumnError(error, 'total_cost')) {
            legacyData = withTotalPrice(legacyData);
          } else {
            legacyData = withTotalCost(legacyData);
          }
          const retry = await supabase
            .from('custom_financial_row_items')
            .update(legacyData)
            .eq('id', editingLineItem.id)
            .limit(1);
          if (retry.error) throw retry.error;
        } else if (error) {
          throw error;
        }
        toast.success('Line item updated');
      } else {
        // Labor: always insert so user can add multiple labor rows. Material: upsert by same parent+description+qty+cost to avoid duplicates.
        const isNewLabor = actualItemType === 'labor';
        if (isNewLabor) {
          const attempts: string[] = [];
          // Prefer legacy `total_cost` first to avoid schema-cache errors on older DBs.
          let { error } = await supabase
            .from('custom_financial_row_items')
            .insert([withTotalCost(itemDataBase)]);
          attempts.push('insert(total_cost)');
          if (error) {
            // If DB lacks total_cost, retry with total_price (newer schema).
            if (isMissingColumnError(error, 'total_cost')) {
              attempts.push('retry(insert total_price)');
              const retry = await supabase
                .from('custom_financial_row_items')
                .insert([withTotalPrice(itemDataBase)]);
              error = retry.error;
            }
          }
          if (error && needsLegacyCustomRowItemPayload(error)) {
            attempts.push('retry(insert legacy sheet_id)');
            const legacyBase = dropProposalScopeColumns(itemDataBase);
            let retry = await supabase.from('custom_financial_row_items').insert([withTotalCost(legacyBase)]);
            if (retry.error && isMissingColumnError(retry.error, 'total_cost')) {
              retry = await supabase.from('custom_financial_row_items').insert([withTotalPrice(legacyBase)]);
            }
            error = retry.error;
          }
          if (error) {
            console.warn('saveLineItem insert failed after retries:', { attempts, error });
            throw error;
          }
          toast.success('Line item added');
          // Always append an optimistic item so the user sees it immediately; a subsequent reload will reconcile.
          const optimistic = ({
            id: `optimistic_${Date.now()}`,
            ...withTotalCost(itemDataBase),
          }) as any;
          setCustomRowLineItems(prev => ({
            ...prev,
            [lineItemParentRowId]: [...(prev[lineItemParentRowId] || []), optimistic],
          }));
        } else {
          const parentCol = isSheet ? 'sheet_id' : 'row_id';
          const { data: existing } = await supabase
            .from('custom_financial_row_items')
            .select('id')
            .eq(parentCol, lineItemParentRowId)
            .eq('description', itemDataBase.description)
            .eq('quantity', itemDataBase.quantity)
            .eq('unit_cost', itemDataBase.unit_cost)
            .limit(1)
            .maybeSingle();

          if (existing?.id) {
            let { error: upErr } = await supabase
              .from('custom_financial_row_items')
              .update(withTotalCost(itemDataBase))
              .eq('id', existing.id);
            if (upErr && needsLegacyCustomRowItemPayload(upErr)) {
              let legacyData: Record<string, any> = dropProposalScopeColumns(itemDataBase);
              if (isMissingColumnError(upErr, 'total_cost')) {
                legacyData = withTotalPrice(legacyData);
              } else {
                legacyData = withTotalCost(legacyData);
              }
              const retry = await supabase
                .from('custom_financial_row_items')
                .update(legacyData)
                .eq('id', existing.id);
              upErr = retry.error;
            }
            if (upErr) throw upErr;
            toast.success('Line item updated');
          } else {
            const attempts: string[] = [];
            let { error } = await supabase
              .from('custom_financial_row_items')
              .insert([withTotalCost(itemDataBase)]);
            attempts.push('insert(total_cost)');
            if (error) {
              if (isMissingColumnError(error, 'total_cost')) {
                attempts.push('retry(insert total_price)');
                const retry = await supabase
                  .from('custom_financial_row_items')
                  .insert([withTotalPrice(itemDataBase)]);
                error = retry.error;
              }
            }
            if (error && needsLegacyCustomRowItemPayload(error)) {
              attempts.push('retry(insert legacy sheet_id)');
              const legacyBase = dropProposalScopeColumns(itemDataBase);
              let retry = await supabase.from('custom_financial_row_items').insert([withTotalCost(legacyBase)]);
              if (retry.error && isMissingColumnError(retry.error, 'total_cost')) {
                retry = await supabase.from('custom_financial_row_items').insert([withTotalPrice(legacyBase)]);
              }
              error = retry.error;
            }
            if (error) {
              console.warn('saveLineItem insert failed after retries:', { attempts, error });
              throw error;
            }
            toast.success('Line item added');
            setCustomRowLineItems(prev => ({
              ...prev,
              [lineItemParentRowId]: [
                ...(prev[lineItemParentRowId] || []),
                ({ id: `optimistic_${Date.now()}`, ...withTotalCost(itemDataBase) } as any),
              ],
            }));
          }
        }
      }

      await new Promise(r => setTimeout(r, 150));
      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);

      if (keepDialogOpen) {
        // Reset form for adding another item, keeping type (labor/material) and defaults
        const currentItemType = lineItemForm.item_type;
        const currentTaxable = lineItemForm.taxable;
        const currentMarkup = lineItemForm.markup_percent;
        const currentLaborRate = lineItemForm.labor_rate;
        const currentLaborMarkup = lineItemForm.labor_markup_percent;
        setLineItemForm({
          description: '',
          quantity: '1',
          unit_cost: '0',
          notes: '',
          taxable: currentItemType === 'labor' ? false : currentTaxable,
          item_type: currentItemType,
          markup_percent: currentMarkup,
          labor_hours: '0',
          labor_rate: currentLaborRate,
          labor_markup_percent: currentLaborMarkup,
          hide_from_customer: lineItemForm.hide_from_customer,
        });
        setEditingLineItem(null);
      } else {
        setShowLineItemDialog(false);
        setEditingLineItem(null);
        setLineItemParentRowId(null);
        setLineItemParentType(null);
      }
    } catch (error: any) {
      console.error('Error saving line item:', error);
      const msg =
        error?.message ||
        error?.error_description ||
        error?.details ||
        error?.hint ||
        'Failed to save line item';
      toast.error(msg.length > 140 ? 'Failed to save line item' : msg);
    } finally {
      savingLineItemRef.current = false;
      setSavingLineItem(false);
    }
  }

  async function deleteLineItem(id: string) {
    const cleanId = String(id ?? '').trim();
    if (!cleanId) {
      toast.error('Invalid line item');
      return;
    }
    if (!confirm('Delete this line item?')) return;

    const stripFromLocal = (matchId: string) => {
      setCustomRowLineItems(prev => {
        const next: Record<string, CustomRowLineItem[]> = {};
        for (const k of Object.keys(prev)) {
          const filtered = (prev[k] || []).filter((it: any) => String(it?.id) !== matchId);
          if (filtered.length) next[k] = filtered;
        }
        return next;
      });
    };

    try {
      if (cleanId.startsWith('optimistic_')) {
        stripFromLocal(cleanId);
        toast.success('Line item removed');
        return;
      }

      const { data, error } = await supabase
        .from('custom_financial_row_items')
        .delete()
        .eq('id', cleanId)
        .select('id');

      if (error) throw error;

      stripFromLocal(cleanId);

      if (!data?.length) {
        await loadCustomRows(quote?.id ?? null, !!isReadOnly);
        await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
        toast.error('Could not delete this line in the database. Try refreshing the page.');
        return;
      }

      toast.success('Line item deleted');
      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error deleting line item:', error);
      const msg =
        error?.message ||
        error?.error_description ||
        error?.details ||
        error?.hint ||
        'Failed to delete line item';
      toast.error(msg.length > 140 ? 'Failed to delete line item' : msg);
    }
  }

  async function toggleSubcontractorLineItem(lineItemId: string, currentExcluded: boolean) {
    try {
      const { error } = await supabase
        .from('subcontractor_estimate_line_items')
        .update({ excluded: !currentExcluded })
        .eq('id', lineItemId);

      if (error) throw error;
      await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error toggling line item:', error);
      toast.error('Failed to update line item');
    }
  }

  async function toggleSubcontractorLineItemTaxable(lineItemId: string, currentTaxable: boolean) {
    try {
      const { error } = await supabase
        .from('subcontractor_estimate_line_items')
        .update({ taxable: !currentTaxable })
        .eq('id', lineItemId);

      if (error) throw error;
      await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error toggling taxable status:', error);
      toast.error('Failed to update taxable status');
    }
  }

  async function toggleSubcontractorLineItemType(lineItemId: string, currentType: string) {
    try {
      const newType = currentType === 'material' ? 'labor' : 'material';
      const updates: any = { item_type: newType };
      
      // Labor is always non-taxable
      if (newType === 'labor') {
        updates.taxable = false;
      }
      
      const { error } = await supabase
        .from('subcontractor_estimate_line_items')
        .update(updates)
        .eq('id', lineItemId);

      if (error) throw error;
      await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error toggling item type:', error);
      toast.error('Failed to update item type');
    }
  }

  function openAddSubcontractorLineItemDialog(estimateId: string) {
    setAddSubcontractorLineItemEstimateId(estimateId);
    setSubLineItemDescription('');
    setSubLineItemQuantity('1');
    setSubLineItemUnitPrice('');
    setSubLineItemType('material');
    setSubLineItemTaxable(true);
    setShowAddSubcontractorLineItemDialog(true);
  }

  async function saveAddSubcontractorLineItem() {
    if (!addSubcontractorLineItemEstimateId || !subLineItemDescription.trim()) {
      toast.error('Enter a description');
      return;
    }
    const qty = parseFloat(subLineItemQuantity);
    const unitRaw = subLineItemUnitPrice.trim();
    const unitPrice = unitRaw === '' ? NaN : parseFloat(unitRaw);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Enter a valid quantity greater than zero');
      return;
    }
    if (!Number.isFinite(unitPrice)) {
      toast.error('Enter a valid unit price (use a negative amount for a discount)');
      return;
    }
    const totalPrice = qty * unitPrice;
    try {
      const existing = subcontractorLineItems[addSubcontractorLineItemEstimateId] || [];
      const maxOrder = existing.length > 0
        ? Math.max(...existing.map((i: any) => i.order_index ?? 0), -1)
        : -1;
      const { error } = await supabase
        .from('subcontractor_estimate_line_items')
        .insert({
          estimate_id: addSubcontractorLineItemEstimateId,
          description: subLineItemDescription.trim(),
          quantity: qty,
          unit_price: unitPrice,
          total_price: totalPrice,
          item_type: subLineItemType,
          taxable: subLineItemType === 'labor' ? false : subLineItemTaxable,
          excluded: false,
          order_index: maxOrder + 1,
          markup_percent: 0,
        });
      if (error) throw error;
      toast.success('Line item added');
      setShowAddSubcontractorLineItemDialog(false);
      setAddSubcontractorLineItemEstimateId(null);
      await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error adding subcontractor line item:', error);
      toast.error(error?.message || 'Failed to add line item');
    }
  }

  function openEditSubcontractorLineItemDialog(lineItem: any) {
    setSubLineItemDescription(lineItem.description ?? '');
    setSubLineItemQuantity(String(lineItem.quantity ?? 1));
    setSubLineItemUnitPrice(lineItem.unit_price != null ? String(lineItem.unit_price) : '');
    setSubLineItemType((lineItem.item_type || 'material') as 'material' | 'labor');
    setSubLineItemTaxable(lineItem.item_type === 'labor' ? false : (lineItem.taxable !== false));
    setEditingSubcontractorLineItemId(lineItem.id);
    setShowEditSubcontractorLineItemDialog(true);
  }

  async function saveEditSubcontractorLineItem() {
    if (!editingSubcontractorLineItemId || !subLineItemDescription.trim()) {
      toast.error('Enter a description');
      return;
    }
    const qty = parseFloat(subLineItemQuantity);
    const unitRaw = subLineItemUnitPrice.trim();
    const unitPrice = unitRaw === '' ? NaN : parseFloat(unitRaw);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Enter a valid quantity greater than zero');
      return;
    }
    if (!Number.isFinite(unitPrice)) {
      toast.error('Enter a valid unit price (use a negative amount for a discount)');
      return;
    }
    const totalPrice = qty * unitPrice;
    try {
      const { error } = await supabase
        .from('subcontractor_estimate_line_items')
        .update({
          description: subLineItemDescription.trim(),
          quantity: qty,
          unit_price: unitPrice,
          total_price: totalPrice,
          item_type: subLineItemType,
          taxable: subLineItemType === 'labor' ? false : subLineItemTaxable,
        })
        .eq('id', editingSubcontractorLineItemId);
      if (error) throw error;
      toast.success('Line item updated');
      setShowEditSubcontractorLineItemDialog(false);
      setEditingSubcontractorLineItemId(null);
      await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error updating subcontractor line item:', error);
      toast.error(error?.message || 'Failed to update line item');
    }
  }

  function openSubcontractorDialog(parentId: string, parentType: 'sheet' | 'row') {
    setSubcontractorParentId(parentId);
    setSubcontractorParentType(parentType);
    setSubcontractorMode('select');
    setSelectedExistingSubcontractor('');
    setShowSubcontractorDialog(true);
  }

  async function linkExistingSubcontractor() {
    if (!selectedExistingSubcontractor || !subcontractorParentId || !subcontractorParentType) {
      toast.error('Please select a subcontractor');
      return;
    }

    try {
      const updateData = subcontractorParentType === 'sheet'
        ? { sheet_id: subcontractorParentId, row_id: null }
        : { row_id: subcontractorParentId, sheet_id: null };

      const { error } = await supabase
        .from('subcontractor_estimates')
        .update(updateData)
        .eq('id', selectedExistingSubcontractor);

      if (error) throw error;
      toast.success('Subcontractor linked');
      setShowSubcontractorDialog(false);
      await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error linking subcontractor:', error);
      toast.error('Failed to link subcontractor');
    }
  }

  async function unlinkSubcontractor(estimateId: string) {
    if (!confirm('Unlink this subcontractor?')) return;

    try {
      const { error } = await supabase
        .from('subcontractor_estimates')
        .update({ sheet_id: null, row_id: null })
        .eq('id', estimateId);

      if (error) throw error;
      toast.success('Subcontractor unlinked');
      await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error unlinking subcontractor:', error);
      toast.error('Failed to unlink subcontractor');
    }
  }

  async function deleteSubcontractorSection(estimateId: string) {
    if (isReadOnly) {
      toast.error('Cannot delete in historical view');
      return;
    }
    if (!confirm('Delete this subcontractor section from the proposal? Line items will be removed.')) return;

    const est = subcontractorEstimates.find((e: any) => e.id === estimateId);
    const lineItems = (subcontractorLineItems[estimateId] || []).map((li: any) => ({ ...li }));
    const sectionLabel = est?.company_name || 'Subcontractor section';
    const isJobLevel = est?.quote_id == null;
    const isCurrentProposal = quote?.id && est?.quote_id === quote?.id;

    setSubcontractorEstimates((prev) => prev.filter((e: any) => e.id !== estimateId));
    setSubcontractorLineItems((prev) => {
      const next = { ...prev };
      delete next[estimateId];
      return next;
    });
    if (!(isJobLevel && quote?.id)) toast.success('Subcontractor section removed');

    try {
      if (isJobLevel && quote?.id) {
        try {
          const { error: insertErr } = await supabase
            .from('quote_removed_sections')
            .upsert({ quote_id: quote.id, section_type: 'subcontractor_estimate', section_id: estimateId }, { onConflict: 'quote_id,section_type,section_id' });
          if (insertErr) throw insertErr;
          toast.success('Section removed from this proposal. It will still appear on previously sent proposals.');
          await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
          window.dispatchEvent(new CustomEvent('proposal-updated', { detail: { quoteId: quote?.id, jobId: job.id } }));
          return;
        } catch (_) {
          const { error: lineErr } = await supabase.from('subcontractor_estimate_line_items').delete().eq('estimate_id', estimateId);
          if (lineErr) throw lineErr;
          const { error: delErr } = await supabase.from('subcontractor_estimates').delete().eq('id', estimateId);
          if (delErr) throw delErr;
          toast.success('Section removed. Run the migration "quote_removed_sections" to remove from this proposal only next time.');
          await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
          window.dispatchEvent(new CustomEvent('proposal-updated', { detail: { quoteId: quote?.id, jobId: job.id } }));
          return;
        }
      }
      if (!isCurrentProposal && !isJobLevel) {
        toast.error('Cannot delete this section from the current proposal');
        setSubcontractorEstimates((prev) => (est ? [...prev, est].sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0)) : prev));
        setSubcontractorLineItems((prev) => (lineItems.length > 0 ? { ...prev, [estimateId]: lineItems } : prev));
        return;
      }

      const { error: lineErr } = await supabase
        .from('subcontractor_estimate_line_items')
        .delete()
        .eq('estimate_id', estimateId);
      if (lineErr) throw lineErr;

      const { error } = await supabase
        .from('subcontractor_estimates')
        .delete()
        .eq('id', estimateId);

      if (error) throw error;

      undoApi.push({
        label: `Delete "${sectionLabel}"`,
        undo: async () => {
          const { id: _id, created_at: _ca, updated_at: _ua, ...estPayload } = est || {};
          const { data: newEst, error: insErr } = await supabase
            .from('subcontractor_estimates')
            .insert({
              quote_id: estPayload.quote_id ?? quote?.id ?? null,
              job_id: estPayload.job_id ?? job.id,
              company_name: estPayload.company_name ?? '',
              scope_of_work: estPayload.scope_of_work ?? null,
              markup_percent: estPayload.markup_percent ?? 0,
              order_index: estPayload.order_index ?? 0,
              sheet_id: estPayload.sheet_id ?? null,
              row_id: estPayload.row_id ?? null,
              pdf_url: estPayload.pdf_url ?? null,
            })
            .select('id')
            .single();
          if (insErr || !newEst?.id) throw new Error(insErr?.message || 'Failed to restore section');
          if (lineItems.length > 0) {
            const itemsPayload = lineItems.map((li: any) => {
              const { id: _i, estimate_id: _e, created_at: _c, updated_at: _u, ...rest } = li;
              return { ...rest, estimate_id: newEst.id };
            });
            const { error: itemsErr } = await supabase.from('subcontractor_estimate_line_items').insert(itemsPayload);
            if (itemsErr) throw itemsErr;
          }
          await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
          window.dispatchEvent(new CustomEvent('proposal-updated', { detail: { quoteId: quote?.id, jobId: job.id } }));
        },
      });

      await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
      window.dispatchEvent(new CustomEvent('proposal-updated', { detail: { quoteId: quote?.id, jobId: job.id } }));
    } catch (error: any) {
      console.error('Error deleting subcontractor section:', error);
      setSubcontractorEstimates((prev) => {
        if (est) return [...prev, est].sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
        return prev;
      });
      setSubcontractorLineItems((prev) => {
        if (lineItems.length > 0) return { ...prev, [estimateId]: lineItems };
        return prev;
      });
      toast.error(error?.message ?? 'Failed to delete subcontractor section');
    }
  }

  async function toggleSubcontractorOptional(estimateId: string, isOptional: boolean) {
    if (isReadOnly) {
      toast.error('Cannot edit in historical view');
      return;
    }
    // Optimistic UI update so section moves immediately between main/optional lists.
    setSubcontractorEstimates((prev) =>
      prev.map((est: any) => (est.id === estimateId ? { ...est, is_option: isOptional } : est))
    );
    const scopeId = quote?.id ? `quote:${quote.id}` : `job:${job.id}`;
    setOptionalSubOverlay((prev) => {
      const next = { ...prev, [estimateId]: isOptional };
      writeSubOptionalStorage(scopeId, next);
      return next;
    });
    // Older databases might not have subcontractor_estimates.is_option yet.
    // Keep local behavior and avoid repeated failing writes.
    if (subOptionalPersistenceUnsupported) {
      return;
    }
    try {
      const { error } = await supabase
        .from('subcontractor_estimates')
        .update({ is_option: isOptional } as any)
        .eq('id', estimateId);
      if (error) throw error;
      await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error updating subcontractor optional state:', error);
      if (isMissingSubcontractorOptionalColumnError(error)) {
        setSubOptionalPersistenceUnsupported(true);
        writeSubOptionalUnsupported(job.id, true);
        return;
      }
      // Keep local state if DB save fails for other reasons.
      toast.error(error?.message || 'Saved locally only. Run latest migration to persist optional state.');
    }
  }

  async function toggleCustomRowOptional(rowId: string, isOptional: boolean) {
    if (isReadOnly) {
      toast.error('Cannot edit in historical view');
      return;
    }
    const row = customRows.find((r) => r.id === rowId);
    if (!row || (row as any).sheet_id) return;

    const prevSnapshot = customRows;
    setCustomRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, is_option: isOptional } : r))
    );
    try {
      const { error } = await supabase
        .from('custom_financial_rows')
        .update({ is_option: isOptional } as any)
        .eq('id', rowId);
      if (error) throw error;
      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error updating custom row optional state:', error);
      setCustomRows(prevSnapshot);
      toast.error(error?.message || 'Failed to update optional state. Run DB migration if is_option column is missing.');
    }
  }

  async function updateSubcontractorMarkup(estimateId: string, newMarkup: number) {
    try {
      const { error } = await supabase
        .from('subcontractor_estimates')
        .update({ markup_percent: newMarkup })
        .eq('id', estimateId);

      if (error) throw error;
      await loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error updating markup:', error);
      toast.error('Failed to update markup');
    }
  }

  async function updateCustomRowMarkup(rowId: string, newMarkup: number) {
    try {
      const { error } = await supabase
        .from('custom_financial_rows')
        .update({ markup_percent: newMarkup })
        .eq('id', rowId);

      if (error) throw error;
      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error updating markup:', error);
      toast.error('Failed to update markup');
    }
  }

  async function updateCustomRowBaseCost(rowId: string, newTotalBase: number, linkedSubsTotal: number) {
    if (isReadOnly) return;
    const newRowCost = Math.max(0, newTotalBase - linkedSubsTotal);
    try {
      const { error } = await supabase
        .from('custom_financial_rows')
        .update({
          total_cost: newRowCost,
          quantity: 1,
          unit_cost: newRowCost,
        })
        .eq('id', rowId);

      if (error) throw error;
      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error updating base cost:', error);
      toast.error('Failed to update cost');
    }
  }

  async function updateLineItemCost(lineItemId: string, newTotalCost: number, quantity: number = 1) {
    if (isReadOnly) return;
    const value = Math.max(0, newTotalCost);
    const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    const unit = Math.round((value / qty) * 10000) / 10000;
    try {
      let { data, error } = await supabase
        .from('custom_financial_row_items')
        .update({
          total_price: value,
          quantity: qty,
          unit_cost: unit,
        })
        .eq('id', lineItemId)
        .select('id');
      // Backward compatibility: older DBs may not have total_price yet.
      if (error && String(error?.message || '').toLowerCase().includes("could not find the 'total_price' column")) {
        const retry = await supabase
          .from('custom_financial_row_items')
          .update({
            total_cost: value,
            quantity: qty,
            unit_cost: unit,
          })
          .eq('id', lineItemId)
          .select('id');
        data = retry.data;
        error = retry.error;
      }

      if (error) throw error;
      if (!data?.length) {
        toast.error('Could not update cost (permission or row missing).');
        return;
      }
      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error updating line item cost:', error);
      toast.error('Failed to update cost');
    }
  }

  /** Update material base cost for a combined row; keeps labor (from notes JSON) and total_cost in sync. */
  async function updateCombinedLineItemMaterialBase(lineItemId: string, newMaterialBase: number, lineItem: any) {
    if (isReadOnly) return;
    const embedded = parseLineItemEmbeddedLabor(lineItem.notes);
    if (!embedded) {
      await updateLineItemCost(lineItemId, newMaterialBase, Number(lineItem.quantity) || 1);
      return;
    }
    const matQty = Number(lineItem.quantity) || 0;
    if (matQty <= 0) return;
    const materialBase = Math.max(0, Math.round(newMaterialBase * 100) / 100);
    const laborBase = Math.round(embedded.hours * embedded.rate * 100) / 100;
    const totalCost = Math.round((materialBase + laborBase) * 100) / 100;
    const unitCost = Math.round((materialBase / matQty) * 10000) / 10000;
    try {
      let { data, error } = await supabase
        .from('custom_financial_row_items')
        .update({
          total_price: totalCost,
          quantity: matQty,
          unit_cost: unitCost,
        })
        .eq('id', lineItemId)
        .select('id');
      if (error && String(error?.message || '').toLowerCase().includes("could not find the 'total_price' column")) {
        const retry = await supabase
          .from('custom_financial_row_items')
          .update({
            total_cost: totalCost,
            quantity: matQty,
            unit_cost: unitCost,
          })
          .eq('id', lineItemId)
          .select('id');
        data = retry.data;
        error = retry.error;
      }
      if (error) throw error;
      if (!data?.length) {
        toast.error('Could not update cost (permission or row missing).');
        return;
      }
      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error updating combined line material cost:', error);
      toast.error('Failed to update cost');
    }
  }

  async function updateLineItemEmbeddedLaborMarkup(lineItemId: string, lineItem: any, newMarkup: number) {
    if (isReadOnly) return;
    const embedded = parseLineItemEmbeddedLabor(lineItem.notes);
    if (!embedded) return;
    let outer: Record<string, unknown> = {};
    try {
      outer = JSON.parse(lineItem.notes || '{}') as Record<string, unknown>;
    } catch {
      return;
    }
    outer.labor = {
      hours: embedded.hours,
      rate: embedded.rate,
      markup: newMarkup,
    };
    const notesStr = JSON.stringify(outer);
    try {
      const { data, error } = await supabase
        .from('custom_financial_row_items')
        .update({ notes: notesStr })
        .eq('id', lineItemId)
        .select('id');
      if (error) throw error;
      if (!data?.length) {
        toast.error('Could not update labor markup.');
        return;
      }
      await loadCustomRows(quote?.id ?? null, !!isReadOnly);
      await loadMaterialsData(quote?.id ?? null, !!isReadOnly);
    } catch (error: any) {
      console.error('Error updating labor markup:', error);
      toast.error('Failed to update labor markup');
    }
  }

  async function saveBuildingDescription() {
    if (!quote) {
      toast.error('No active proposal to save description to');
      return;
    }
    try {
      const { error } = await supabase
        .from('quotes')
        .update({ description: buildingDescription })
        .eq('id', quote.id);

      if (error) throw error;
      // Keep local quote object in sync without a full reload
      (quote as any).description = buildingDescription;
      toast.success('Building description saved');
      setEditingDescription(false);
    } catch (error: any) {
      console.error('Error saving description:', error);
      toast.error('Failed to save description');
    }
  }

  async function setQuoteTaxExempt(value: boolean) {
    if (!quote?.id || !job?.id || isReadOnly) return;

    // Optimistic UI update — always apply immediately so the checkbox responds
    setTaxExemptChecked(value);
    setTaxExemptSaved(false); // mark as pending until DB confirms
    setQuote((prev) => (prev ? { ...prev, tax_exempt: value } : prev));
    setAllJobQuotes(value
      ? allJobQuotes.map((q: any) => ({ ...q, tax_exempt: true }))
      : allJobQuotes.map((q) => (q.id === quote.id ? { ...q, tax_exempt: value } : q)),
    );

    const broadcastSuccess = () => {
      setTaxExemptSaved(true);
      taxExemptChannelRef.current?.send({
        type: 'broadcast',
        event: 'tax_exempt',
        payload: { value, quote_id: quote.id, job_id: job.id },
      });
    };

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (supabaseUrl) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? '';
        const res = await fetch(`${supabaseUrl}/functions/v1/set-job-tax-exempt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ job_id: job.id, quote_id: quote.id, value }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.ok) {
          toast.success(value ? 'Job marked tax exempt for all users.' : 'Tax applied to this proposal.');
          broadcastSuccess();
          await loadQuoteData();
          return;
        }
        if (res.status !== 200 || data?.error) {
          console.warn('Tax exempt Edge Function:', data?.error ?? res.statusText);
        }
      } catch (e) {
        console.warn('Tax exempt Edge Function request failed:', e);
      }
    }

    // Fallback 1: RPC (works when PostgREST schema cache has the function)
    const { error: rpcError } = await supabase.rpc('set_quote_tax_exempt', {
      p_job_id: job.id,
      p_quote_id: quote.id,
      p_value: value,
    });
    if (!rpcError) {
      toast.success(value ? 'Job marked tax exempt for all users.' : 'Tax applied to this proposal.');
      broadcastSuccess();
      await loadQuoteData();
      return;
    }

    // Fallback 2: direct PostgREST update (works when schema cache exposes tax_exempt)
    const { error: fallbackError } = value
      ? await supabase.from('quotes').update({ tax_exempt: true  }).eq('job_id', job.id)
      : await supabase.from('quotes').update({ tax_exempt: false }).eq('id', quote.id);

    if (!fallbackError) {
      toast.success(value ? 'Job marked tax exempt for all users.' : 'Tax applied to this proposal.');
      broadcastSuccess();
      await loadQuoteData();
      return;
    }

    // All paths failed
    console.warn('Tax exempt save failed. RPC:', rpcError?.message, '| Direct:', fallbackError?.message);
    const rpcMsg = rpcError?.message ?? 'unknown';
    const directMsg = fallbackError?.message ?? 'unknown';
    const schemaCacheError = /schema cache|Could not find the function|Could not find the.*column/i.test(rpcMsg + directMsg);
    toast.error(
      schemaCacheError
        ? `Tax exempt could not be saved. Deploy the Edge Function "set-job-tax-exempt" and run scripts/setup-tax-exempt-for-job.sql in Supabase. Optionally add DATABASE_URL secret to the function so it can save when the API schema is stale.`
        : `Tax exempt could not be saved. RPC: ${rpcMsg}. Direct update: ${directMsg}`,
      { duration: schemaCacheError ? 12000 : 20000 }
    );
  }

  /** Fetch print-ready HTML from the Edge Function for in-app PDF view. */
  async function fetchProposalPdfHtml(html: string, filename: string): Promise<string> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) throw new Error('Missing VITE_SUPABASE_URL');
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? '';
    const res = await fetch(`${supabaseUrl}/functions/v1/generate-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ html, filename }),
    });
    const htmlResult = await res.text();
    if (!res.ok) throw new Error(htmlResult || res.statusText || `HTTP ${res.status}`);
    return htmlResult;
  }

  /** Open preview with raw proposal HTML (no print instructions or auto-print). Preview shows the proposal only. */
  function openPdfViewInApp(proposalHtml: string, filename: string) {
    setPdfViewHtml(proposalHtml);
    setPdfViewFilename(filename);
    const blob = new Blob([proposalHtml], { type: 'text/html; charset=utf-8' });
    setPdfPrintUrl(URL.createObjectURL(blob));
    setShowPdfView(true);
  }

  function closePdfView() {
    setShowPdfView(false);
    setPdfViewHtml(null);
    setPdfViewFilename('');
    if (pdfPrintUrl) {
      URL.revokeObjectURL(pdfPrintUrl);
      setPdfPrintUrl(null);
    }
  }

  function openPrintDialog(forPdf: boolean) {
    if (!pdfViewHtml || !pdfViewFilename) return;
    try {
      const blob = new Blob([pdfViewHtml], { type: 'text/html; charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, '_blank');
      if (!win) {
        URL.revokeObjectURL(blobUrl);
        toast.error('Allow popups to print or save as PDF.');
        return;
      }
      win.focus();
      if (!forPdf) toast.info('Select your printer to print the proposal.');
      setTimeout(() => {
        try {
          if (!win.closed) win.print();
        } catch {
          toast.error('Could not open print dialog');
        }
        setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
      }, 600);
    } catch (err: any) {
      toast.error(err.message || 'Failed to open print dialog');
    }
  }

  /** Download PDF using the same print layout — opens print dialog; user chooses "Save as PDF" to get a file that matches the printout exactly. */
  function handleDownloadPdf() {
    if (!pdfViewHtml || !pdfViewFilename) return;
    openPrintDialog(true);
    toast.info('Choose "Save as PDF" in the dialog to download. The file will look exactly like the printout.', { duration: 6000 });
  }

  function handlePrintProposal() {
    openPrintDialog(false);
  }

  async function handleExportPDF() {
    setExporting(true);
    
    try {
      const isLegacyQuoteEstimate = (quote as any)?.is_customer_estimate === true;
      const isCustomerEstimateExport = isLegacyQuoteEstimate || estimateCatalogViewOpen;
      const proposalNumber = isLegacyQuoteEstimate
        ? displayNumberForQuoteRow(quote as any, true)
        : quote?.proposal_number || job.id.split('-')[0].toUpperCase();
      const isBidSpec = exportViewType === 'bid_spec';
      const includeLineItemsForPdf = showLineItems || (isBidSpec && bidSpecShowQuantities);

      // Prepare sections data for the template (required items first, then optional at end)
      const estimatePdfMaterialsTotal =
        Math.round(customerEstimateLines.reduce((s, r) => s + estimateCatalogLineExtendedSell(r), 0) * 100) / 100;
      const estimatePdfTaxable =
        Math.round(
          customerEstimateLines
            .filter((r) => r.taxable !== false)
            .reduce((s, r) => s + estimateCatalogLineExtendedSell(r), 0) * 100
        ) / 100;
      const estimatePdfTax = taxExemptChecked ? 0 : Math.round(estimatePdfTaxable * 0.07 * 100) / 100;
      const estimatePdfGrand = Math.round((estimatePdfMaterialsTotal + estimatePdfTax) * 100) / 100;

      const sections = estimateCatalogViewOpen
        ? (isBidSpec
            ? customerEstimateLines.map((r, i) => ({
                name: r.description || `Item ${i + 1}`,
                description: (r.notes || '').trim(),
                price: 0,
                optional: false,
                items: [
                  {
                    description: r.description,
                    quantity: Number(r.quantity) || 0,
                    unit: '',
                    price: 0,
                  },
                ],
              }))
            : [
                {
                  name: 'Price list (preliminary)',
                  description:
                    'Office price list — rough pricing only; not the formal proposal workbook.',
                  price: estimatePdfMaterialsTotal,
                  optional: false,
                  items: customerEstimateLines.map((r) => ({
                    description: r.description,
                    quantity: Number(r.quantity) || 0,
                    unit: '',
                    price: estimateCatalogLineExtendedSell(r),
                  })),
                },
              ])
        : allItemsUnsorted.map((item, index) => {
        if (item.type === 'material') {
          const sheet = item.data;
          const linkedRows = customRows.filter((r: any) => r.sheet_id === sheet.sheetId);
          const linkedSubs = linkedSubcontractors[sheet.sheetId] || [];
          
          const linkedRowTotals = sumLinkedRowTotals(linkedRows, displayCustomRowLineItems);
          
          const linkedSubsMaterialsTotal = sumLinkedSubMaterialsFromSubs(linkedSubs, subcontractorLineItems);
          
          const sheetBaseCost = sheet.totalPrice + linkedRowTotals.materialTotal + linkedSubsMaterialsTotal;
          const sheetMarkup = sheet.markup_percent || 10;
          const sheetFinalPrice = sheetBaseCost * (1 + sheetMarkup / 100);

          // Build comparison data for optional sections that have a linked base section
          let comparisonData: any = undefined;
          if (!isBidSpec && (sheet as any).isOptional && (sheet as any).compareToSheetId) {
            const baseSheetBd = materialsBreakdown.sheetBreakdowns.find((s: any) => s.sheetId === (sheet as any).compareToSheetId);
            if (baseSheetBd) {
              const baseLinkedRows2 = customRows.filter((r: any) => r.sheet_id === baseSheetBd.sheetId);
              const baseLinkedRowTotals2 = sumLinkedRowTotals(baseLinkedRows2, displayCustomRowLineItems);
              const baseLinkedSubs2 = linkedSubcontractors[baseSheetBd.sheetId] || [];
              const baseLinkedSubsTotal2 = sumLinkedSubMaterialsFromSubs(baseLinkedSubs2, subcontractorLineItems);
              const baseCatTotals2 = (baseSheetBd.categories || []).reduce((s2: number, cat: any) => {
                const sellingPrice = Number(cat.totalPrice);
                if (sellingPrice > 0) return s2 + sellingPrice;
                const mu = categoryMarkups[`${baseSheetBd.sheetId}_${cat.name}`] ?? 10;
                const baseCategoryCost = (cat.items || []).reduce((itemSum: number, item: any) => {
                  const extended = Number(item.extended_cost) || 0;
                  if (extended > 0) return itemSum + extended;
                  return itemSum + ((Number(item.cost_per_unit) || 0) * (Number(item.quantity) || 0));
                }, 0) || (Number(cat.totalCost) || 0);
                return s2 + baseCategoryCost * (1 + mu / 100);
              }, 0);
              const baseMaterialsPrice = baseCatTotals2 + baseLinkedRowTotals2.materialTotal + baseLinkedSubsTotal2;
              const baseSheetLaborData = sheetLabor[baseSheetBd.sheetId];
              const baseSheetLaborTotal2 =
                baseSheetLaborData && sheetLaborCountsForDisplayedSection(baseSheetLaborData, baseSheetBd.sheetId)
                  ? Number(baseSheetLaborData.total_labor_cost) ||
                    Number(baseSheetLaborData.estimated_hours || 0) * Number(baseSheetLaborData.hourly_rate || 0)
                  : 0;
              const baseSheetLaborLineItems2 = displayCustomRowLineItems[baseSheetBd.sheetId]?.filter((it: any) => (it.item_type || 'material') === 'labor') || [];
              const baseSheetLaborLineItemsTotal2 = baseSheetLaborLineItems2.reduce((s2: number, it: any) => s2 + (it.total_cost * (1 + (it.markup_percent || 0) / 100)), 0);
              const baseNonTaxable2 = baseLinkedSubs2.reduce((s2: number, sub: any) => {
                const li2 = subcontractorLineItems[sub.id] || [];
                const nt = li2.filter((it: any) => !it.excluded && !it.taxable).reduce((ss: number, it: any) => ss + it.total_price, 0);
                return s2 + (nt * (1 + (sub.markup_percent || 0) / 100));
              }, 0);
              const baseLaborPrice = baseSheetLaborTotal2 + baseSheetLaborLineItemsTotal2 + baseLinkedRowTotals2.laborTotal + baseNonTaxable2;

              // Option sheet labor
              const optSheetLaborData = sheetLabor[sheet.sheetId];
              const optSheetLaborTotal =
                optSheetLaborData && sheetLaborCountsForDisplayedSection(optSheetLaborData, sheet.sheetId)
                  ? Number(optSheetLaborData.total_labor_cost) ||
                    Number(optSheetLaborData.estimated_hours || 0) * Number(optSheetLaborData.hourly_rate || 0)
                  : 0;
              const optSheetLaborLineItems = displayCustomRowLineItems[sheet.sheetId]?.filter((it: any) => (it.item_type || 'material') === 'labor') || [];
              const optSheetLaborLineItemsTotal = optSheetLaborLineItems.reduce((s2: number, it: any) => s2 + (it.total_cost * (1 + (it.markup_percent || 0) / 100)), 0);
              const optLinkedSubs2 = linkedSubcontractors[sheet.sheetId] || [];
              const optSubLabor = sumLinkedSubLaborFromSubs(optLinkedSubs2, subcontractorLineItems);
              const optLaborPrice = optSheetLaborTotal + optSheetLaborLineItemsTotal + linkedRowTotals.laborTotal + optSubLabor;

              // Category-level comparison rows
              const allCatNames = Array.from(new Set([
                ...(baseSheetBd.categories || []).map((c: any) => c.name),
                ...(sheet.categories || []).map((c: any) => c.name),
              ])).sort();
              const categoryRows = allCatNames.map((catName: string) => {
                const baseCat = (baseSheetBd.categories || []).find((c: any) => c.name === catName);
                const optCat = (sheet.categories || []).find((c: any) => c.name === catName);
                const baseMu = categoryMarkups[`${baseSheetBd.sheetId}_${catName}`] ?? 10;
                const optMu = categoryMarkups[`${sheet.sheetId}_${catName}`] ?? 10;
                return {
                  name: catName,
                  basePrice: baseCat ? baseCat.totalCost * (1 + baseMu / 100) : 0,
                  optionPrice: optCat ? optCat.totalCost * (1 + optMu / 100) : 0,
                };
              });

              comparisonData = {
                baseName: baseSheetBd.sheetName,
                optionName: sheet.sheetName,
                baseMaterialsPrice,
                optionMaterialsPrice: sheetFinalPrice,
                baseLaborPrice,
                optionLaborPrice: optLaborPrice,
                baseTotal: baseMaterialsPrice + baseLaborPrice,
                optionTotal: sheetFinalPrice + optLaborPrice,
                categoryRows,
              };
            }
          }
          
          const sheetFinancialLineItems = displayCustomRowLineItems[String(sheet.sheetId)] || [];
          let materialPdfItems: Array<{
            description: string;
            quantity: number;
            unit: string;
            price: number;
          }> | undefined;
          if (includeLineItemsForPdf) {
            if (isBidSpec) {
              // Bid spec: proposal line items only — not workbook category / material rollups
              materialPdfItems =
                sheetFinancialLineItems.length > 0
                  ? sheetFinancialLineItems.map((li: any) => ({
                      description: li.description,
                      quantity: li.quantity,
                      unit: (li.item_type || 'material') === 'labor' ? 'hrs' : '',
                      price: li.total_cost,
                    }))
                  : undefined;
            } else {
              materialPdfItems = sheet.categories?.map((cat: any) => ({
                description: cat.name,
                quantity: cat.itemCount,
                unit: 'items',
                price: cat.totalPrice,
              }));
            }
          }

          const exportSheetLaborRow = sheetLabor[sheet.sheetId];
          const exportSheetLaborTotal =
            exportSheetLaborRow && sheetLaborCountsForDisplayedSection(exportSheetLaborRow, sheet.sheetId)
              ? Number(exportSheetLaborRow.total_labor_cost) ||
                Number(exportSheetLaborRow.estimated_hours || 0) * Number(exportSheetLaborRow.hourly_rate || 0)
              : 0;
          const exportLaborLineItems =
            displayCustomRowLineItems[sheet.sheetId]?.filter((it: any) => (it.item_type || 'material') === 'labor') || [];
          const exportSheetLaborLineItemsTotal = exportLaborLineItems.reduce(
            (s2: number, it: any) => s2 + effectiveCustomRowLineItemBase(it) * (1 + (it.markup_percent || 0) / 100),
            0
          );
          const exportLinkedSubsLabor = sumLinkedSubLaborFromSubs(linkedSubs, subcontractorLineItems);
          const totalLaborCost =
            exportSheetLaborTotal + exportSheetLaborLineItemsTotal + linkedRowTotals.laborTotal + exportLinkedSubsLabor;
          const sectionTotal = sheetFinalPrice + totalLaborCost;

          return {
            name: sheet.sheetName,
            description: sheet.sheetDescription || '',
            price: sheetFinalPrice,
            /** Optional sheets: PDF shows Materials / Labor / Sect. total like the proposal panel. */
            materialsPrice: sheetFinalPrice,
            laborPrice: totalLaborCost,
            sectionTotalPrice: sectionTotal,
            optional: (sheet as any).isOptional ?? false,
            comparisonData,
            items: materialPdfItems,
          };
        } else if (item.type === 'custom') {
          const row = item.data;
          const lineItems = customRowLineItems[row.id] || [];
          const linkedSubs = linkedSubcontractors[row.id] || [];
          
          const linkedSubsMaterialsTotal = sumLinkedSubMaterialsFromSubs(linkedSubs, subcontractorLineItems);
          
          const baseLineCost = lineItems.length > 0
            ? lineItems.reduce((itemSum: number, item: any) => itemSum + item.total_cost, 0)
            : row.total_cost;
          const baseCost = baseLineCost + linkedSubsMaterialsTotal;
          const finalPrice = baseCost * (1 + row.markup_percent / 100);
          
          return {
            name: row.description,
            description: row.notes || '',
            price: finalPrice,
            materialsPrice: finalPrice,
            laborPrice: 0,
            sectionTotalPrice: finalPrice,
            optional: toBool((row as any).is_option),
            items: includeLineItemsForPdf && lineItems.length > 0 ? lineItems.map((li: any) => ({
              description: li.description,
              quantity: li.quantity,
              unit: '',
              price: li.total_cost
            })) : undefined
          };
        } else if (item.type === 'subcontractor') {
          const est = item.data;
          const lineItems = subcontractorLineItems[est.id] || [];
          const includedTotal = lineItems
            .filter((item: any) => !item.excluded)
            .reduce((sum: number, item: any) => sum + item.total_price, 0);
          const estMarkup = est.markup_percent || 0;
          const finalPrice = includedTotal * (1 + estMarkup / 100);
          
          return {
            name: est.company_name,
            description: est.scope_of_work || '',
            price: finalPrice,
            materialsPrice: finalPrice,
            laborPrice: 0,
            sectionTotalPrice: finalPrice,
            optional: toBool((est as any).is_option),
            items: includeLineItemsForPdf ? lineItems
              .filter((item: any) => !item.excluded)
              .map((li: any) => ({
                description: li.description,
                quantity: li.quantity || 1,
                unit: li.unit_price ? '' : '',
                price: li.total_price
              })) : undefined
          };
        }
        return null;
      }).filter(Boolean);

      // Generate HTML using the template
      const isOfficeView = exportViewType === 'office';
      const descriptionsOnly = exportViewType === 'descriptions_only';
      const html = generateProposalHTML({
        proposalNumber,
        date: new Date().toLocaleDateString(),
        job: {
          client_name: job.client_name,
          address: job.address,
          name: job.name,
          customer_phone: job.customer_phone,
          description: buildingDescription,
        },
        sections,
        totals: estimateCatalogViewOpen
          ? {
              materials: estimatePdfMaterialsTotal,
              labor: 0,
              subtotal: estimatePdfMaterialsTotal,
              tax: estimatePdfTax,
              grandTotal: estimatePdfGrand,
            }
          : {
              materials: proposalMaterialsTotalWithSubcontractors,
              labor: proposalLaborPrice,
              subtotal: proposalSubtotal,
              tax: proposalTotalTax,
              grandTotal: proposalGrandTotal,
            },
        bidSpec: isBidSpec
          ? {
              bidDueDate: bidSpecDueDate.trim() || undefined,
              instructions: bidSpecInstructions.trim() || undefined,
              showQuantities: bidSpecShowQuantities,
            }
          : undefined,
        descriptionsOnly,
        showLineItems: descriptionsOnly ? false : isOfficeView ? true : showLineItems,
        showSectionPrices: descriptionsOnly ? false : isOfficeView ? false : showLineItems, // Customer version: controlled by checkbox, Office view: always false
        showInternalDetails: descriptionsOnly ? false : isOfficeView,
        theme: exportTheme,
        taxExempt: taxExemptChecked,
        documentKind: isCustomerEstimateExport ? 'estimate' : 'proposal',
      });

      console.log('Generating PDF with HTML');
      setShowExportDialog(false);
      // Open print dialog directly — user chooses "Save as PDF" to download
      const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, '_blank');
      if (!win) {
        URL.revokeObjectURL(blobUrl);
        toast.error('Allow popups to print or save as PDF.');
        return;
      }
      win.focus();
      toast.info('Choose "Save as PDF" in the print dialog to download.', { duration: 6000 });
      setTimeout(() => {
        try { if (!win.closed) win.print(); } catch { toast.error('Could not open print dialog'); }
        setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
      }, 600);
    } catch (error: any) {
      console.error('Error exporting PDF:', error);
      toast.error(`Failed to export PDF: ${error.message || 'Unknown error'}`);
    } finally {
      setExporting(false);
    }
  }

  // Calculate custom row total from line items (if any) or from quantity * unit_cost
  function getCustomRowTotal(row: CustomFinancialRow): number {
    const lineItems = customRowLineItems[row.id] || [];
    if (lineItems.length > 0) {
      // If has line items, sum their totals
      const itemsTotal = lineItems.reduce((sum, item) => sum + item.total_cost, 0);
      return itemsTotal * (1 + row.markup_percent / 100);
    } else {
      // Otherwise use the row's own selling price
      return row.selling_price;
    }
  }

  // Filter labor rows and calculate total labor hours
  const laborRows = customRows.filter((r) => r.category === 'labor');
  const totalLaborHours = laborRows.reduce((sum, r) => sum + r.quantity, 0);
  const nonLaborCustomRows = customRows.filter((r) => r.category !== 'labor');
  
  // Sort all rows by order_index for proper display order
  const sortedCustomRows = [...customRows].sort((a, b) => a.order_index - b.order_index);
  
  // Calculate totals (using line items where applicable)
  // IMPORTANT: labor rows are priced separately via totalLaborHours; do not double-count them here.
  const grandTotalCost = nonLaborCustomRows.reduce((sum, row) => {
    const lineItems = customRowLineItems[row.id] || [];
    if (lineItems.length > 0) {
      return sum + lineItems.reduce((itemSum, item) => itemSum + item.total_cost, 0);
    }
    return sum + row.total_cost;
  }, 0);

  const grandTotalPrice = nonLaborCustomRows.reduce((sum, row) => {
    return sum + getCustomRowTotal(row);
  }, 0);

  // Labor calculations (no markup) - use TOTAL LABOR HOURS from labor rows for pricing
  const laborRate = parseFloat(hourlyRate) || 60;
  const billableRate = laborRate;
  const laborCost = totalLaborHours * laborRate;
  const laborPrice = totalLaborHours * billableRate;
  const laborProfit = 0;

  // Overall totals (including materials)
  const totalCost = materialsBreakdown.totals.totalCost + grandTotalCost + laborCost;
  const totalPrice = materialsBreakdown.totals.totalPrice + grandTotalPrice + laborPrice;
  const totalProfit = totalPrice - totalCost;
  const profitMargin = totalPrice > 0 ? (totalProfit / totalPrice) * 100 : 0;

  // Proposal calculations with individual markups and tax
  const TAX_RATE = 0.07; // 7% tax
  
  // Helper function to calculate taxable and non-taxable portions of a custom row
  function getCustomRowTaxableAndNonTaxable(row: CustomFinancialRow) {
    const lineItems = customRowLineItems[row.id] || [];
    const linkedSubs = linkedSubcontractors[row.id] || [];
    
    let taxableTotal = 0;
    let nonTaxableTotal = 0;
    
    if (lineItems.length > 0) {
      // If has line items, separate by taxable status
      lineItems.forEach(item => {
        if (item.taxable) {
          taxableTotal += item.total_cost;
        } else {
          nonTaxableTotal += item.total_cost;
        }
      });
    } else {
      // No line items - use row's own cost and taxable setting
      if (row.taxable) {
        taxableTotal = row.total_cost;
      } else {
        nonTaxableTotal = row.total_cost;
      }
    }
    
    // Add linked subcontractors (taxable = taxable materials; rest is non-taxable incl. labor)
    linkedSubs.forEach((sub: any) => {
      const subLineItems = subcontractorLineItems[sub.id] || [];
      const subTaxableTotal = subLineItems
        .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'material' && item.taxable)
        .reduce((sum: number, item: any) => sum + item.total_price, 0);
      const subNonTaxableTotal = subLineItems
        .filter((item: any) => !item.excluded && (
          (item.item_type || 'material') === 'labor' ||
          ((item.item_type || 'material') === 'material' && !item.taxable)
        ))
        .reduce((sum: number, item: any) => sum + item.total_price, 0);
      const estMarkup = sub.markup_percent || 0;
      taxableTotal += subTaxableTotal * (1 + estMarkup / 100);
      nonTaxableTotal += subNonTaxableTotal * (1 + estMarkup / 100);
    });
    
    // Apply row markup to both portions
    const rowMarkup = 1 + (row.markup_percent / 100);
    return {
      taxable: taxableTotal * rowMarkup,
      nonTaxable: nonTaxableTotal * rowMarkup,
    };
  }
  
  // Get all custom rows that are NOT linked to sheets (standalone rows)
  const standaloneCustomRows = customRows.filter(r => !(r as any).sheet_id);
  
  // Calculate totals from standalone custom rows, splitting by material vs labor
  let customRowsMaterialsTotal = 0;
  let customRowsMaterialsTaxableOnly = 0;
  let customRowsLaborTotal = 0;
  
  standaloneCustomRows.forEach(row => {
    if (toBool((row as any).is_option)) return;
    const lineItems = customRowLineItems[row.id] || [];
    const linkedSubs = linkedSubcontractors[row.id] || [];
    const rowMarkupPct = Number(row.markup_percent) || 0;
    
    // Separate line items by type (use item_type, not taxable)
    const materialLineItems = lineItems.filter((item: any) => (item.item_type || 'material') === 'material');
    const laborLineItems = lineItems.filter((item: any) => (item.item_type || 'material') === 'labor');
    
    // Calculate material portions
    let rowMaterialsTotal = 0;
    let rowMaterialsTaxableOnly = 0;
    if (lineItems.length > 0) {
      // Sum material line items using per-item markup (fallback to row markup), matching section header math
      for (const item of materialLineItems) {
        const itemCost =
          Number(item?.total_cost) || (Number(item?.quantity) || 0) * (Number(item?.unit_cost) || 0);
        const itemMarkup = Number(item?.markup_percent ?? rowMarkupPct) || 0;
        const itemPrice = itemCost * (1 + itemMarkup / 100);
        rowMaterialsTotal += itemPrice;
        if (item?.taxable) rowMaterialsTaxableOnly += itemPrice;
      }
    } else if (row.category !== 'labor') {
      // No line items and not a labor row = material row
      const baseCost = Number(row.total_cost) || 0;
      const price = baseCost * (1 + rowMarkupPct / 100);
      rowMaterialsTotal = price;
      rowMaterialsTaxableOnly = row.taxable ? price : 0;
    }
    
    // Calculate labor portion - WITH MARKUP
    let rowLaborTotal = 0;
    if (lineItems.length > 0) {
      for (const item of laborLineItems) {
        const itemCost =
          Number(item?.total_cost) || (Number(item?.quantity) || 0) * (Number(item?.unit_cost) || 0);
        const itemMarkup = Number(item?.markup_percent ?? rowMarkupPct) || 0;
        rowLaborTotal += itemCost * (1 + itemMarkup / 100);
      }
    } else if (row.category === 'labor') {
      rowLaborTotal = (Number(row.total_cost) || 0) * (1 + rowMarkupPct / 100);
    }
    
    // Add linked subcontractors (separate materials from labor)
    linkedSubs.forEach((sub: any) => {
      const subLineItems = subcontractorLineItems[sub.id] || [];
      // Material items (can be taxable or non-taxable)
      const subMaterialsTotal = subLineItems
        .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'material')
        .reduce((sum: number, item: any) => sum + item.total_price, 0);
      const subMaterialsTaxableOnly = subLineItems
        .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'material' && item.taxable)
        .reduce((sum: number, item: any) => sum + item.total_price, 0);
      // Labor items (always non-taxable)
      const subLaborTotal = subLineItems
        .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'labor')
        .reduce((sum: number, item: any) => sum + item.total_price, 0);
      
      const estMarkup = sub.markup_percent || 0;
      // Standalone row markup applies to linked subs (consistent with row-level totals elsewhere in this component).
      const rowMu = 1 + rowMarkupPct / 100;
      rowMaterialsTotal += subMaterialsTotal * (1 + estMarkup / 100) * rowMu;
      rowMaterialsTaxableOnly += subMaterialsTaxableOnly * (1 + estMarkup / 100) * rowMu;
      rowLaborTotal += subLaborTotal * (1 + estMarkup / 100) * rowMu;
    });

    customRowsMaterialsTotal += rowMaterialsTotal;
    customRowsMaterialsTaxableOnly += rowMaterialsTaxableOnly;
    customRowsLaborTotal += rowLaborTotal;
  });
  
  // Build set of optional sheet IDs so they can be excluded from all totals
  const optionalSheetIds = new Set(
    materialsBreakdown.sheetBreakdowns.filter((s: any) => s.isOptional).map((s: any) => s.sheetId)
  );

  const getSheetCategoryPriceSplit = (sheet: any): { materials: number; labor: number } => {
    const sheetIdForMatch = String(sheet?.sheetId ?? sheet?.id ?? '').trim();
    const sheetNameForMatch = String(sheet?.sheetName ?? sheet?.sheet_name ?? '').trim().toLowerCase();
    const normalizeCategoryName = (name: unknown) => String(name ?? '').trim().toLowerCase();
    const breakdownSheet = materialsBreakdown.sheetBreakdowns.find(
      (s: any) => String(s?.sheetId ?? s?.id ?? '').trim() === sheetIdForMatch
    ) || materialsBreakdown.sheetBreakdowns.find(
      (s: any) => String(s?.sheetName ?? s?.sheet_name ?? '').trim().toLowerCase() === sheetNameForMatch
    );
    const breakdownCategories = (((breakdownSheet as any)?.categories || []) as any[]);
    const categorySource = ((breakdownSheet as any)?.categories?.length ? (breakdownSheet as any).categories : sheet.categories) || [];
    const displayCategories = breakdownCategories.length > 0 ? breakdownCategories : categorySource;
    const breakdownCategoryPriceByName = new Map<string, number>(
      breakdownCategories.map((cat: any) => [normalizeCategoryName(cat?.name), Number(cat?.totalPrice) || 0])
    );

    const getCategoryBreakdownPrice = (cat: any) => {
      const catKey = normalizeCategoryName(cat?.name);
      const extBySheetId = externalPriceLookup.get(sheetIdForMatch);
      if (extBySheetId && Object.prototype.hasOwnProperty.call(extBySheetId, catKey)) {
        return Number(extBySheetId[catKey]) || 0;
      }
      const extBySheetName = externalPriceLookup.get(sheetNameForMatch);
      if (extBySheetName && Object.prototype.hasOwnProperty.call(extBySheetName, catKey)) {
        return Number(extBySheetName[catKey]) || 0;
      }
      const itemsPrice = ((cat?.items || []) as any[]).reduce((sum: number, item: any) => {
        if (item?.extended_price != null && item.extended_price !== '') {
          return sum + (Number(item.extended_price) || 0);
        }
        return sum + ((Number(item?.quantity) || 0) * (Number(item?.price_per_unit) || 0));
      }, 0);
      if (itemsPrice > 0) return itemsPrice;
      // Fallback: if selling price fields are missing, use cost fields so category markup can still produce a price.
      // This fixes under-counting when rows have cost populated but price_per_unit / extended_price are blank.
      const itemsCost = ((cat?.items || []) as any[]).reduce((sum: number, item: any) => {
        if (item?.extended_cost != null && item.extended_cost !== '') {
          return sum + (Number(item.extended_cost) || 0);
        }
        return sum + ((Number(item?.quantity) || 0) * (Number(item?.cost_per_unit) || 0));
      }, 0);
      if (itemsCost > 0) return itemsCost;
      const directTotalPrice = Number(cat?.totalPrice);
      if (Number.isFinite(directTotalPrice) && directTotalPrice > 0) return directTotalPrice;
      if (breakdownCategoryPriceByName.has(catKey)) return breakdownCategoryPriceByName.get(catKey) || 0;
      return 0;
    };

    // If the Breakdown panel provides a category total, treat it as the base price so category markup applies.
    const getCategoryDisplayPrice = (cat: any) => {
      const catKey = normalizeCategoryName(cat?.name);
      const extBySheetId = externalPriceLookup.get(sheetIdForMatch);
      if (extBySheetId && Object.prototype.hasOwnProperty.call(extBySheetId, catKey)) {
        return { price: Number(extBySheetId[catKey]) || 0, isFinal: false };
      }
      const extBySheetName = externalPriceLookup.get(sheetNameForMatch);
      if (extBySheetName && Object.prototype.hasOwnProperty.call(extBySheetName, catKey)) {
        return { price: Number(extBySheetName[catKey]) || 0, isFinal: false };
      }
      return { price: getCategoryBreakdownPrice(cat), isFinal: false };
    };

    let materials = 0;
    let labor = 0;
    for (const cat of displayCategories) {
      const sheetId = String(sheet?.sheetId ?? sheet?.id ?? '').trim();
      const categoryMarkup = lookupCategoryMarkup(
        categoryMarkups,
        sheetId,
        cat?.name,
        ((sheet as any).markup_percent ?? 10)
      );
      const { price, isFinal } = getCategoryDisplayPrice(cat);
      const lineTotal = isFinal ? price : price * (1 + (Number(categoryMarkup) || 0) / 100);
      if (isWorkbookLaborCategoryName(cat?.name)) labor += lineTotal;
      else materials += lineTotal;
    }
    return { materials, labor };
  };

  // Materials: material sheets + custom material rows (ALL materials, not just taxable)
  // Also track taxable-only materials for tax calculation
  let materialSheetsPrice = 0;
  let materialSheetsTaxableOnly = 0;
  let materialSheetsCategoryLaborTotal = 0;

  materialsBreakdown.sheetBreakdowns.forEach(sheet => {
    // Same scope as visible proposal sections (excludes optional/C.O./Field Request workbooks)
    if (!materialSheetCountsTowardProposalSubtotal(sheet as any)) return;
    const ms = materialSheets.find((m: any) => m.id === sheet.sheetId);
    if (ms?.sheet_type === 'change_order') return;

    // Linked custom rows (materials) — match section header math (per-line-item markup; no extra rowMarkup multiplier)
    const linkedRows = customRows.filter(r => (r as any).sheet_id === sheet.sheetId);
    const linkedRowMat = sumLinkedRowMaterialTotals(linkedRows, displayCustomRowLineItems);
    let linkedRowsMaterialsTotal = linkedRowMat.materialTotal;
    let linkedRowsMaterialsTaxableOnly = linkedRowMat.materialTaxableOnly;
    // Linked subs attached to custom rows (materials only) — include subcontractor markup (section header behavior)
    linkedRows.forEach((row: any) => {
      const linkedSubs = linkedSubcontractors[row.id] || [];
      linkedSubs.forEach((sub: any) => {
        const subLineItems = subcontractorLineItems[sub.id] || [];
        const subMaterialsTotal = subLineItems
          .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'material')
          .reduce((sum: number, item: any) => sum + item.total_price, 0);
        const subMaterialsTaxableOnly = subLineItems
          .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'material' && item.taxable)
          .reduce((sum: number, item: any) => sum + item.total_price, 0);
        const estMarkup = sub.markup_percent || 0;
        linkedRowsMaterialsTotal += subMaterialsTotal * (1 + estMarkup / 100);
        linkedRowsMaterialsTaxableOnly += subMaterialsTaxableOnly * (1 + estMarkup / 100);
      });
    });
    
    // Calculate linked subcontractors (materials only, both taxable and non-taxable)
    const linkedSubs = linkedSubcontractors[sheet.sheetId] || [];
    let linkedSubsMaterialsTotal = 0;
    let linkedSubsMaterialsTaxableOnly = 0;
    linkedSubs.forEach(sub => {
      const lineItems = subcontractorLineItems[sub.id] || [];
      const materialsTotal = lineItems
        .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'material')
        .reduce((sum: number, item: any) => sum + item.total_price, 0);
      const materialsTaxableOnly = lineItems
        .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'material' && item.taxable)
        .reduce((sum: number, item: any) => sum + item.total_price, 0);
      const estMarkup = sub.markup_percent || 0;
      linkedSubsMaterialsTotal += materialsTotal * (1 + estMarkup / 100);
      linkedSubsMaterialsTaxableOnly += materialsTaxableOnly * (1 + estMarkup / 100);
    });

    // Sheet-level material line items (row_id null, sheet_id set) — same as section header total
    const sheetMatLineItems = (displayCustomRowLineItems[sheet.sheetId] || []).filter(
      (item: any) => (item.item_type || 'material') === 'material'
    );
    const sheetMatLinePrice = sheetMatLineItems.reduce((sum: number, item: any) => {
      const m = item.markup_percent ?? 0;
      return sum + item.total_cost * (1 + m / 100);
    }, 0);
    const sheetMatLineTaxable = sheetMatLineItems
      .filter((item: any) => item.taxable)
      .reduce((sum: number, item: any) => {
        const m = item.markup_percent ?? 0;
        return sum + item.total_cost * (1 + m / 100);
      }, 0);
    
    const { materials: categoryMaterialsTotals, labor: categoryLaborTotals } = getSheetCategoryPriceSplit(sheet);
    materialSheetsCategoryLaborTotal += categoryLaborTotals;
    // Category materials are treated as taxable by default in current model (labor categories excluded from materials).
    const categoryTaxableOnly = categoryMaterialsTotals;

    // Section-level markup (shown as "+ %") applies to non-category material totals in the UI
    // (sheet-level material line items + linked custom rows + linked subs). Categories already include markup.
    const sheetMuPct = Number((sheet as any).markup_percent ?? 10) || 0;
    const sheetMu = 1 + sheetMuPct / 100;
    const nonCategoryMaterials = sheetMatLinePrice + linkedRowsMaterialsTotal + linkedSubsMaterialsTotal;
    const nonCategoryTaxableOnly = sheetMatLineTaxable + linkedRowsMaterialsTaxableOnly + linkedSubsMaterialsTaxableOnly;
    
    // Final = non-labor categories (already marked-up) + (non-category materials × sheet markup)
    materialSheetsPrice += categoryMaterialsTotals + nonCategoryMaterials * sheetMu;
    materialSheetsTaxableOnly += categoryTaxableOnly + nonCategoryTaxableOnly * sheetMu;
  });

  // Optional sections are intentionally excluded from proposal totals.
  // They remain visible in the "Optional Items" block with their own section totals.

  const proposalMaterialsPrice = materialSheetsPrice + customRowsMaterialsTotal;
  const proposalMaterialsTaxableOnly = materialSheetsTaxableOnly + customRowsMaterialsTaxableOnly;
  
  // Subcontractors: only standalone estimates (not linked to sheets/rows)
  // Material type items go to materials, labor type items go to labor
  const standaloneSubcontractors = subcontractorEstimates.filter(
    est => !est.sheet_id && !est.row_id && !toBool((est as any).is_option)
  );
  let subcontractorMaterialsPrice = 0;
  let subcontractorMaterialsTaxableOnly = 0;
  let subcontractorLaborPrice = 0;
  
  standaloneSubcontractors.forEach(est => {
    const lineItems = subcontractorLineItems[est.id] || [];
    // All materials (taxable + non-taxable)
    const materialsTotal = lineItems
      .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'material')
      .reduce((sum: number, item: any) => sum + (item.total_price || 0), 0);
    // Taxable materials only
    const materialsTaxableOnly = lineItems
      .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'material' && item.taxable)
      .reduce((sum: number, item: any) => sum + (item.total_price || 0), 0);
    // Labor
    const laborTotal = lineItems
      .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'labor')
      .reduce((sum: number, item: any) => sum + (item.total_price || 0), 0);
    
    const estMarkup = est.markup_percent || 0;
    subcontractorMaterialsPrice += materialsTotal * (1 + estMarkup / 100);
    subcontractorMaterialsTaxableOnly += materialsTaxableOnly * (1 + estMarkup / 100);
    subcontractorLaborPrice += laborTotal * (1 + estMarkup / 100);
  });
  
  // Labor: sheet labor + sheet labor line items + custom row labor + custom rows labor + linked rows labor + subcontractor labor items
  // Use proposal sheet IDs only (exclude change_order and optional) so proposal total does not include change order labor
  const allSheetIds = Array.from(new Set([
    ...materialsBreakdown.sheetBreakdowns.map((s: any) => s.sheetId),
    ...materialSheets.map((s: any) => s.id),
  ])).filter(id => {
    if (!id || optionalSheetIds.has(id)) return false;
    const ms = materialSheets.find((m: any) => m.id === id);
    if (ms?.sheet_type === 'change_order') return false;
    const bd = materialsBreakdown.sheetBreakdowns.find((s: any) => s.sheetId === id);
    if (bd) return materialSheetCountsTowardProposalSubtotal(bd);
    if (ms && isInternalWorkbookSheetName(ms.sheet_name)) return false;
    return true;
  });
  const totalSheetLaborCost = allSheetIds.reduce((sum, sheetId) => {
    const labor = sheetLabor[sheetId];
    
    // Add labor from sheet line items (labor type) - same formula as section display (cost + markup)
    const msForSheet = materialSheets.find((m: any) => m.id === sheetId);
    const bdForSheet = materialsBreakdown.sheetBreakdowns.find((s: any) => s.sheetId === sheetId);
    const sheetLineItems = resolveCustomRowLineItemsForSheet(
      displayCustomRowLineItems,
      materialSheets,
      sheetId,
      bdForSheet?.sheetName ?? msForSheet?.sheet_name,
      materialsBreakdown.sheetBreakdowns,
      sheetMetaById,
    );
    const sheetLaborLineItems = sheetLineItems.filter((item: any) => (item.item_type || 'material') === 'labor');
    const sheetLaborLineItemsTotal = sheetLaborLineItems.reduce((itemSum: number, item: any) => {
      const itemMarkup = item.markup_percent || 0;
      return itemSum + effectiveCustomRowLineItemBase(item) * (1 + itemMarkup / 100);
    }, 0);
    
    // Add labor from linked custom rows (labor line items)
    const linkedRows = customRows.filter(r => (r as any).sheet_id === sheetId);
    const linkedRowsLaborTotal = linkedRows.reduce((rowSum, row) => {
      const lineItems = customRowLineItems[row.id] || [];
      const linkedSubs = linkedSubcontractors[row.id] || [];
      
      const laborLineItems = lineItems.filter((item: any) => (item.item_type || 'material') === 'labor');
      let rowLaborTotal = 0;
      if (lineItems.length > 0) {
        rowLaborTotal = laborLineItems.reduce((itemSum: number, item: any) => {
          const itemMarkup = item.markup_percent || 0;
          return itemSum + effectiveCustomRowLineItemBase(item) * (1 + itemMarkup / 100);
        }, 0);
      } else if (row.category === 'labor') {
        rowLaborTotal =
          Number(row.total_cost) || (Number(row.quantity) || 0) * (Number(row.unit_cost) || 0);
      }
      linkedSubs.forEach((sub: any) => {
        const subLineItems = subcontractorLineItems[sub.id] || [];
        const subLaborTotal = subLineItems
          .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'labor')
          .reduce((itemSum: number, item: any) => itemSum + item.total_price, 0);
        const estMarkup = sub.markup_percent || 0;
        rowLaborTotal += subLaborTotal * (1 + estMarkup / 100);
      });
      const rowMarkup = 1 + (row.markup_percent / 100);
      return rowSum + (rowLaborTotal * rowMarkup);
    }, 0);
    
    const linkedSubs = linkedSubcontractors[sheetId] || [];
    const linkedSubsLaborTotal = linkedSubs.reduce((subSum: number, sub: any) => {
      const subLineItems = subcontractorLineItems[sub.id] || [];
      const laborTotal = subLineItems
        .filter((item: any) => !item.excluded && (item.item_type || 'material') === 'labor')
        .reduce((itemSum: number, item: any) => itemSum + item.total_price, 0);
      const estMarkup = sub.markup_percent || 0;
      return subSum + (laborTotal * (1 + estMarkup / 100));
    }, 0);
    
    const sheetLaborDb =
      labor &&
      sheetLaborCountsForDisplayedSection(labor, sheetId) &&
      (Number(labor.total_labor_cost) ||
        Number(labor.estimated_hours || 0) * Number(labor.hourly_rate || 0));
    return sum + (sheetLaborDb || 0) + sheetLaborLineItemsTotal + linkedRowsLaborTotal + linkedSubsLaborTotal;
  }, 0);
  
  // Custom row labor (estimated_hours * rate) only for rows that don't already have labor line items,
  // so the top labor total equals the sum of labor shown in the section (no double-count, no under-count).
  // Also exclude rows that are linked to optional sheets.
  const totalCustomRowLaborCost = Object.entries(customRowLabor).reduce((sum: number, [rowId, labor]: [string, any]) => {
    const row = customRows.find(r => r.id === rowId);
    const rowSheetId = row ? (row as any).sheet_id : null;
    if (row && !rowSheetId && toBool((row as any).is_option)) return sum;
    if (rowSheetId) {
      if (optionalSheetIds.has(rowSheetId)) return sum;
      const bd = materialsBreakdown.sheetBreakdowns.find((s: any) => s.sheetId === rowSheetId);
      if (bd) {
        if (!materialSheetCountsTowardProposalSubtotal(bd)) return sum;
      } else {
        const ms = materialSheets.find((m: any) => m.id === rowSheetId);
        if (ms?.sheet_type === 'change_order') return sum;
        if (ms && isInternalWorkbookSheetName(ms.sheet_name)) return sum;
      }
    }
    const lineItems = customRowLineItems[rowId] || [];
    const hasLaborLineItems = lineItems.some((item: any) => (item.item_type || 'material') === 'labor');
    if (hasLaborLineItems) return sum;
    return sum + (labor.estimated_hours * labor.hourly_rate);
  }, 0);
  
  const proposalLaborPrice =
    totalSheetLaborCost +
    totalCustomRowLaborCost +
    customRowsLaborTotal +
    subcontractorLaborPrice +
    materialSheetsCategoryLaborTotal;
  
  // Combine materials with subcontractor materials for display
  const proposalMaterialsTotalWithSubcontractors = proposalMaterialsPrice + subcontractorMaterialsPrice;

  // Debug helper: show bucket totals in header when troubleshooting mismatches
  const debugTotalsEnabled =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debugTotals') === '1';
  const debugMaterialsBuckets = debugTotalsEnabled
    ? {
        materialSheetsPrice,
        customRowsMaterialsTotal,
        subcontractorMaterialsPrice,
        proposalMaterialsPrice,
        proposalMaterialsTotalWithSubcontractors,
      }
    : null;
  
  // Progress calculations - use total labor hours from labor rows
  const progressPercent = totalLaborHours > 0 ? Math.min((totalClockInHours / totalLaborHours) * 100, 100) : 0;
  const isOverBudget = totalClockInHours > totalLaborHours && totalLaborHours > 0;

  const categoryLabels: Record<string, string> = {
    line_items: 'Line Items',
    labor: 'Labor',
    subcontractor: 'Subcontractors',
    materials: 'Additional Materials',
    equipment: 'Equipment',
    other: 'Other Costs',
  };

  const categoryDescriptions: Record<string, string> = {
    line_items: 'Container for individual line items with their own pricing and markups',
    labor: 'Labor hours and installation work for this project',
    subcontractor: 'Third-party contractors and specialized services for this project',
    materials: 'Additional materials not included in the main material workbook',
    equipment: 'Rental equipment, tools, and machinery costs',
    other: 'Miscellaneous project costs and expenses',
  };

  // Create unified list: proposal workbook sections vs change orders (separate category; not mixed into contract scope)
  const isProposalSheet = (sheet: { sheetName: string; sheetType?: string }) =>
    !isInternalWorkbookSheetName(sheet.sheetName) && (sheet as any).sheetType !== 'change_order';
  const isChangeOrderSheet = (sheet: { sheetType?: string }) => (sheet as any).sheetType === 'change_order';

  const proposalSheetBreakdowns = materialsBreakdown.sheetBreakdowns.filter(isProposalSheet);
  const changeOrderSheetBreakdowns = materialsBreakdown.sheetBreakdowns.filter(isChangeOrderSheet);

  const allItemsUnsorted = [
    ...proposalSheetBreakdowns.map(sheet => ({
      type: 'material' as const,
      id: sheet.sheetId,
      orderIndex: sheet.orderIndex,
      data: sheet,
    })),
    ...customRows.filter(row => !(row as any).sheet_id).map(row => ({
      type: 'custom' as const,
      id: row.id,
      orderIndex: row.order_index,
      data: row,
    })),
    ...subcontractorEstimates.filter(est => !est.sheet_id && !est.row_id).map(est => ({
      type: 'subcontractor' as const,
      id: est.id,
      orderIndex: est.order_index,
      data: est,
    })),
  ].sort((a, b) => a.orderIndex - b.orderIndex);

  const changeOrderItemsUnsorted = changeOrderSheetBreakdowns.map(sheet => ({
    type: 'material' as const,
    id: sheet.sheetId,
    orderIndex: sheet.orderIndex,
    data: sheet,
  })).sort((a, b) => a.orderIndex - b.orderIndex);

  // Split into required (included in total) and optional (excluded from total) for separate rendering
  const allItems = allItemsUnsorted.filter(
    item =>
      !(
        (item.type === 'material' && (item.data as any).isOptional) ||
        (item.type === 'custom' && toBool((item.data as any).is_option)) ||
        (item.type === 'subcontractor' && toBool((item.data as any).is_option))
      )
  );
  const optionalItems = allItemsUnsorted.filter(
    item =>
      (item.type === 'material' && (item.data as any).isOptional) ||
      (item.type === 'custom' && toBool((item.data as any).is_option)) ||
      (item.type === 'subcontractor' && toBool((item.data as any).is_option))
  );

  // Sum of the per-section Materials totals shown on each section card (excluding optional sections).
  // - Sheets: card Materials number (categories + sheet material line items + linked rows + linked subs)
  // - Custom rows: card Materials number
  // - Subcontractors: card Material number only (not labor)
  const sumAllSectionBlueTotals = useMemo(() => {
    const bySheetId = new Map<string, any>();
    (materialsBreakdown.sheetBreakdowns || []).forEach((s: any) => {
      if (s?.sheetId) bySheetId.set(String(s.sheetId), s);
    });

    const sheetBlue = (sheet: any): number => {
      const sheetId = String(sheet?.sheetId ?? sheet?.id ?? '').trim();
      if (!sheetId) return 0;
      const sheetBd = bySheetId.get(sheetId) || sheet;

      const categoryMaterialsOnly = getSheetCategoryPriceSplit(sheetBd).materials;

      const sheetMaterialItems = resolveCustomRowLineItemsForSheet(
        displayCustomRowLineItems,
        materialSheets,
        sheetId,
        sheetBd?.sheetName ?? sheet?.sheetName,
        materialsBreakdown.sheetBreakdowns,
        sheetMetaById,
      ).filter(
        (item: any) => (item.item_type || 'material') === 'material'
      );
      const sheetMaterialLineItemsTotal = sheetMaterialItems.reduce((sum: number, item: any) => {
        const itemMarkup = item.markup_percent ?? 0;
        return sum + (Number(item.total_cost) || 0) * (1 + (Number(itemMarkup) || 0) / 100);
      }, 0);

      const linkedRows = customRows.filter((r: any) => (r as any).sheet_id === sheetId);
      const linkedRowTotals = sumLinkedRowTotals(linkedRows, displayCustomRowLineItems);
      const linkedSubs = linkedSubcontractors[sheetId] || [];
      const linkedSubsMaterialsTotal = sumLinkedSubMaterialsFromSubs(linkedSubs, subcontractorLineItems);

      return (Number(categoryMaterialsOnly) || 0) + sheetMaterialLineItemsTotal + (Number(linkedRowTotals.materialTotal) || 0) + (Number(linkedSubsMaterialsTotal) || 0);
    };

    const customRowBlue = (row: any): number => {
      const rowId = String(row?.id ?? '').trim();
      if (!rowId) return 0;
      const lineItems = customRowLineItems[rowId] || [];
      const linkedSubs = linkedSubcontractors[rowId] || [];
      const linkedSubsMaterialsTotal = sumLinkedSubMaterialsFromSubs(linkedSubs, subcontractorLineItems);

      const materialLineItems = lineItems.filter((item: any) => (item.item_type || 'material') === 'material');
      const materialLineItemsTotal = materialLineItems.reduce((sum: number, item: any) => {
        const itemMarkup = item.markup_percent || 0;
        return sum + (Number(item.total_cost) || 0) * (1 + (Number(itemMarkup) || 0) / 100);
      }, 0);

      // Matches the card logic: when line items exist, use marked-up line items directly; otherwise use row total_cost with row-level markup.
      if (lineItems.length > 0) return materialLineItemsTotal + linkedSubsMaterialsTotal;
      return ((Number((row as any).total_cost) || 0) + linkedSubsMaterialsTotal) * (1 + (Number((row as any).markup_percent) || 0) / 100);
    };

    const subcontractorBlue = (est: any): number => {
      const estId = String(est?.id ?? '').trim();
      if (!estId) return 0;
      const lineItems = subcontractorLineItems[estId] || [];
      const included = lineItems.filter((item: any) => !item.excluded);
      const materialIncludedTotal = included
        .filter((i: any) => (i.item_type || 'material') === 'material')
        .reduce((sum: number, i: any) => sum + (Number(i.total_price) || 0), 0);
      const estMarkup = Number(est?.markup_percent) || 0;
      const materialWithMarkup = materialIncludedTotal * (1 + estMarkup / 100);
      return materialWithMarkup;
    };

    const raw = allItems.reduce((sum: number, item: any) => {
      if (item.type === 'material') return sum + sheetBlue(item.data);
      if (item.type === 'custom') return sum + customRowBlue(item.data);
      if (item.type === 'subcontractor') return sum + subcontractorBlue(item.data);
      return sum;
    }, 0);
    return Math.round(raw * 100) / 100;
  }, [
    allItems,
    materialsBreakdown.sheetBreakdowns,
    displayCustomRowLineItems,
    customRows,
    linkedSubcontractors,
    subcontractorLineItems,
    categoryMarkups,
    categoryMarkups,
    materialSheets,
    externalPriceLookup,
  ]);

  // Calculate subtotals
  // Materials subtotal should match the sum of section Materials numbers (with markup),
  // so the header Subtotal equals (Materials + Labor) as shown in the sections list.
  const materialsSubtotal = sumAllSectionBlueTotals;
  const laborSubtotal = proposalLaborPrice;
  
  // Tax: use local checkbox state so total updates immediately when user checks "Tax exempt"
  const proposalTotalTaxRaw = ((Number(proposalMaterialsTaxableOnly) || 0) + (Number(subcontractorMaterialsTaxableOnly) || 0)) * TAX_RATE;
  const proposalTotalTax = taxExemptChecked ? 0 : proposalTotalTaxRaw;
  
  // Grand total: subtotal + tax (tax is 0 when tax exempt)
  const proposalSubtotal = (Number(materialsSubtotal) || 0) + (Number(laborSubtotal) || 0);
  const proposalGrandTotal = (Number(proposalSubtotal) || 0) + (Number(proposalTotalTax) || 0);

  const estimateCatalogMaterialsTotal = useMemo(() => {
    const raw = customerEstimateLines.reduce((s, r) => s + estimateCatalogLineExtendedSell(r), 0);
    return Math.round(raw * 100) / 100;
  }, [customerEstimateLines]);
  const estimateCatalogTaxableMaterials = useMemo(() => {
    const raw = customerEstimateLines
      .filter((r) => r.taxable !== false)
      .reduce((s, r) => s + estimateCatalogLineExtendedSell(r), 0);
    return Math.round(raw * 100) / 100;
  }, [customerEstimateLines]);
  const estimateCatalogTaxAmount = useMemo(() => {
    if (taxExemptChecked) return 0;
    return Math.round(estimateCatalogTaxableMaterials * 0.07 * 100) / 100;
  }, [taxExemptChecked, estimateCatalogTaxableMaterials]);
  const estimateCatalogGrandTotalFull = useMemo(() => {
    return Math.round((estimateCatalogMaterialsTotal + estimateCatalogTaxAmount) * 100) / 100;
  }, [estimateCatalogMaterialsTotal, estimateCatalogTaxAmount]);

  const financialBarMaterials = estimateCatalogViewOpen ? estimateCatalogMaterialsTotal : sumAllSectionBlueTotals;
  const financialBarLabor = estimateCatalogViewOpen ? 0 : proposalLaborPrice;
  const financialBarSubtotal = estimateCatalogViewOpen ? estimateCatalogMaterialsTotal : proposalSubtotal;
  const financialBarTax = estimateCatalogViewOpen ? estimateCatalogTaxAmount : proposalTotalTax;
  const financialBarGrand = estimateCatalogViewOpen ? estimateCatalogGrandTotalFull : proposalGrandTotal;
  const showingCatalogOrLegacyEstimate =
    estimateCatalogViewOpen || (quote as any)?.is_customer_estimate === true;

  // Optional categories (section-level options): list for the "Options" block at bottom of proposal
  const optionalCategoriesList: { sheetName: string; categoryName: string; totalCost: number; priceWithMarkup: number }[] = [];
  materialsBreakdown.sheetBreakdowns.forEach((sheet: any) => {
    if (isInternalWorkbookSheetName(sheet.sheetName)) return;
    (sheet.categories || []).forEach((cat: any) => {
      const isOptional = cat.items?.every((i: any) => i.isOptional) ?? false;
      if (!isOptional) return;
      const key = `${sheet.sheetId}_${cat.name}`;
      const markup = categoryMarkups[key] ?? (sheet.markup_percent ?? 10);
      const baseCategoryCost = (cat.items || []).reduce((itemSum: number, item: any) => {
        const extended = Number(item.extended_cost) || 0;
        if (extended > 0) return itemSum + extended;
        return itemSum + ((Number(item.cost_per_unit) || 0) * (Number(item.quantity) || 0));
      }, 0) || (Number(cat.totalCost) || 0);
      const priceWithMarkup = baseCategoryCost * (1 + markup / 100);
      optionalCategoriesList.push({
        sheetName: sheet.sheetName,
        categoryName: cat.name,
        totalCost: cat.totalCost || 0,
        priceWithMarkup,
      });
    });
  });

  // Handle drag end
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) return;
    
    // Prevent reordering in read-only mode
    if (isReadOnly) {
      toast.error('Cannot reorder in historical view');
      return;
    }

    const inMain = allItemsUnsorted.some(i => i.id === active.id);
    const inCo = changeOrderItemsUnsorted.some(i => i.id === active.id);
    if (inCo) {
      toast.error('Reorder change orders in the Change orders section below.');
      return;
    }
    const oldIndex = allItemsUnsorted.findIndex(item => item.id === active.id);
    const newIndex = allItemsUnsorted.findIndex(item => item.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Reorder items
    const reorderedItems = arrayMove(allItemsUnsorted, oldIndex, newIndex);

    // Update order_index for all affected items
    const updates = reorderedItems.map((item, index) => {
      if (item.type === 'material') {
        return supabase
          .from('material_sheets')
          .update({ order_index: index })
          .eq('id', item.id);
      } else if (item.type === 'custom') {
        return supabase
          .from('custom_financial_rows')
          .update({ order_index: index })
          .eq('id', item.id);
      } else if (item.type === 'subcontractor') {
        return supabase
          .from('subcontractor_estimates')
          .update({ order_index: index })
          .eq('id', item.id);
      }
      return null;
    }).filter(Boolean);

    try {
      await Promise.all(updates);
      toast.success('Order updated');
      await loadData(true);
    } catch (error: any) {
      console.error('Error updating order:', error);
      toast.error('Failed to update order');
    }
  }

  async function handleDragEndChangeOrders(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (isReadOnly) {
      toast.error('Cannot reorder in historical view');
      return;
    }
    const sorted = [...changeOrderItemsUnsorted].sort((a, b) => a.orderIndex - b.orderIndex);
    const oldIndex = sorted.findIndex((item) => item.id === active.id);
    const newIndex = sorted.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sorted, oldIndex, newIndex);
    const orderValues = sorted.map((s) => s.orderIndex).slice().sort((a, b) => a - b);
    try {
      await Promise.all(
        reordered.map((item, i) =>
          supabase.from('material_sheets').update({ order_index: orderValues[i] ?? i }).eq('id', item.id)
        )
      );
      toast.success('Change order order updated');
      await loadData(true);
    } catch (error: any) {
      console.error('Error updating change order order:', error);
      toast.error('Failed to update order');
    }
  }

  // When inside JobDetailView Proposal & Materials tab, register action buttons for the black header bar
  useEffect(() => {
    if (!setProposalToolbar) return;
    setProposalToolbar(
      <div className="flex flex-wrap items-center gap-1">
        {quote && (
          <>
            <Button size="sm" variant="outline" onClick={() => { setDeleteProposalQuoteId(quote.id); setShowDeleteProposalConfirm(true); }} className="h-8 w-8 p-0 bg-white/10 hover:bg-red-500/20 text-red-200 border-red-500/40 hover:border-red-400" title="Delete this proposal">
              <Trash2 className="w-2.5 h-2.5" />
            </Button>
            <div className="h-5 w-px bg-yellow-600/40 flex-shrink-0" aria-hidden />
          </>
        )}
        <Button onClick={() => setEditingDescription(true)} variant="outline" size="sm" className={headerBtn}>
          <Edit className="w-2.5 h-2.5 mr-0.5" />
          {buildingDescription ? 'Edit Description' : 'Add Description'}
        </Button>
        <Button size="sm" onClick={() => { if (quote) setShowCreateProposalDialog(true); else autoCreateFirstProposal(); }} disabled={creatingVersion || creatingProposal} className="bg-white hover:bg-slate-100 text-black border border-slate-400 h-8 text-xs px-2" title="Create a new proposal (allowed even when current proposal is locked)">
          {creatingVersion || creatingProposal ? <><span className="animate-spin mr-0.5">⏳</span>Creating...</> : <><Plus className="w-2.5 h-2.5 mr-0.5" />New Proposal</>}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { void createNewCustomerEstimate(); }}
          disabled={creatingVersion}
          className="bg-white/90 hover:bg-slate-100 text-black border border-slate-400 h-8 text-xs px-2"
          title="Price-list estimate for this proposal — separate lines from the workbook; not a new proposal row"
        >
          <FilePlus className="w-2.5 h-2.5 mr-0.5" />
          New estimate
        </Button>
        {estimateCatalogViewOpen && quote && !isReadOnly && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { void importEstimateCatalogLinesToProposal(); }}
              className="border-emerald-400 text-emerald-100 hover:bg-emerald-950/40 h-8 text-xs px-2"
              title="Append each line as a material row in the formal proposal below"
            >
              <ArrowRightCircle className="w-2.5 h-2.5 mr-0.5" />
              Import to proposal
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEstimateCatalogViewOpen(false)}
              className="h-8 text-xs px-2 border-slate-400 text-slate-100 hover:bg-white/10"
              title="Close price-list estimate view (proposal workbook totals return in the bar)"
            >
              Close estimate
            </Button>
          </>
        )}
        {quote && (quote as any).is_customer_estimate === true && !isReadOnly && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => { void convertEstimateToProposal(); }}
            className="border-emerald-400 text-emerald-100 hover:bg-emerald-950/40 h-8 text-xs px-2"
            title="Make this a formal proposal (visible on customer portal when shared)"
          >
            <ArrowRightCircle className="w-2.5 h-2.5 mr-0.5" />
            Convert to proposal
          </Button>
        )}
        {quote && !quoteHasActiveContract(quote) && (quote as any).is_customer_estimate !== true && (
          <Button size="sm" onClick={setActiveProposalAsContract} className="bg-white hover:bg-slate-100 text-black border border-slate-400 h-8 text-xs px-2">
            <Lock className="w-2.5 h-2.5 mr-0.5" />Set as Contract
          </Button>
        )}
        {quote && quoteHasActiveContract(quote) && (
          <Button size="sm" onClick={revokeQuoteContract} variant="outline" className="border-amber-400 text-amber-800 hover:bg-amber-50 h-8 text-xs px-2" title="Only with customer consent">
            <LockOpen className="w-2.5 h-2.5 mr-0.5" />Revoke contract
          </Button>
        )}
        {quote && (
          (quote as any).sent_at ? (
            <Button size="sm" disabled className="bg-emerald-50 text-emerald-800 border border-emerald-300 h-8 text-xs px-2 cursor-default" title="Sent to customer — see proposal header for date/time and time worked">
              <CheckCircle className="w-2.5 h-2.5 mr-0.5" />Sent
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={markProposalAsSent}
              disabled={isReadOnly || ((quote as any).is_change_order_proposal && !jobHasContract)}
              className="bg-white hover:bg-slate-100 text-black border border-slate-400 h-8 text-xs px-2"
              title={
                (quote as any).is_change_order_proposal
                  ? jobHasContract
                    ? 'Send change order to customer for portal signing'
                    : 'Set the main proposal as contract first'
                  : 'Record when this proposal was sent (permanent). Does not lock the workbook; revoke contract only undoes the signed contract.'
              }
            >
              <Send className="w-2.5 h-2.5 mr-0.5" />
              {(quote as any).is_change_order_proposal ? 'Send change order' : 'Mark as Sent'}
            </Button>
          )
        )}
        <Button onClick={() => setShowExportDialog(true)} size="sm" className="bg-white hover:bg-slate-100 text-black border border-slate-400 h-8 text-xs px-2">
          <Download className="w-2.5 h-2.5 mr-0.5" />Export PDF
        </Button>
        <Button onClick={() => openAddDialog()} variant="outline" size="sm" disabled={isReadOnly} className={headerBtn}>
          <Plus className="w-2.5 h-2.5 mr-0.5" />Add Row
        </Button>
        <Button onClick={() => setShowSubUploadDialog(true)} variant="outline" size="sm" disabled={isReadOnly} className={headerBtn}>
          <Upload className="w-2.5 h-2.5 mr-0.5" />Upload Sub
        </Button>
        {formalJobQuotes.length > 1 && (
          <Button onClick={() => setShowProposalComparison(true)} variant="outline" size="sm" className="bg-white hover:bg-slate-100 text-black border border-slate-400 h-8 text-xs px-2" title="Compare two proposals side by side">
            <GitCompare className="w-2.5 h-2.5 mr-0.5" />Compare 2
          </Button>
        )}
      </div>
    );
    return () => { setProposalToolbar(null); };
  }, [setProposalToolbar, quote?.id, quote?.sent_at, quote?.locked_for_editing, formalJobQuotes.length, buildingDescription, creatingVersion, creatingProposal, isReadOnly, isDefaultLocked, effectiveHistoricalUnlockedQuoteId, proposalVersions?.length, quote?.signed_version, (quote as any)?.customer_signed_at, (quote as any)?.is_customer_estimate, estimateCatalogViewOpen, jobHasContract, (quote as any)?.is_change_order_proposal, job.id, job.status]);

  // Sync proposal summary to green header bar (Proposal #, Materials, Labor, Grand Total)
  useEffect(() => {
    const setSummary = proposalSummaryCtx?.setSummary;
    if (!setSummary) return;
    if (!quote) {
      setSummary(null);
      return;
    }
    const isLegacyEst = (quote as any).is_customer_estimate === true;
    const showEstimateSummary = isLegacyEst || estimateCatalogViewOpen;
    setSummary({
      proposalNumber: displayNumberForQuoteRow(quote, isLegacyEst),
      materials: showEstimateSummary ? Number(estimateCatalogMaterialsTotal) || 0 : Number(proposalMaterialsTotalWithSubcontractors) || 0,
      labor: showEstimateSummary ? 0 : Number(proposalLaborPrice) || 0,
      subtotal: showEstimateSummary ? Number(estimateCatalogMaterialsTotal) || 0 : Number(proposalSubtotal) || 0,
      tax: showEstimateSummary ? Number(estimateCatalogTaxAmount) || 0 : Number(proposalTotalTax) || 0,
      grandTotal: showEstimateSummary ? Number(estimateCatalogGrandTotalFull) || 0 : Number(proposalGrandTotal) || 0,
      jobWorkbookMaterials:
        typeof externalJobWorkbookMaterialsTotal === 'number' ? externalJobWorkbookMaterialsTotal : null,
      isCustomerEstimate: showEstimateSummary,
    });
    return () => setSummary(null);
  }, [
    proposalSummaryCtx?.setSummary,
    quote,
    (quote as any)?.is_customer_estimate,
    estimateCatalogViewOpen,
    estimateCatalogMaterialsTotal,
    estimateCatalogTaxAmount,
    estimateCatalogGrandTotalFull,
    proposalMaterialsTotalWithSubcontractors,
    proposalLaborPrice,
    proposalSubtotal,
    proposalTotalTax,
    proposalGrandTotal,
    externalJobWorkbookMaterialsTotal,
  ]);

  // Sync proposal totals to quote so customer portal can display the same numbers (single source of truth)
  const lastSyncedTotalsRef = useRef<{ quoteId: string; sub: number; tax: number; grand: number } | null>(null);
  useEffect(() => {
    if (estimateCatalogViewOpen) return;
    if (!quote?.id || !Number.isFinite(proposalSubtotal) || !Number.isFinite(proposalGrandTotal)) return;
    const sub = Math.round(proposalSubtotal * 100) / 100;
    const tax = Math.round((proposalTotalTax ?? 0) * 100) / 100;
    const grand = Math.round(proposalGrandTotal * 100) / 100;
    const prev = lastSyncedTotalsRef.current;
    if (prev && prev.quoteId === quote.id && prev.sub === sub && prev.tax === tax && prev.grand === grand) return;
    lastSyncedTotalsRef.current = { quoteId: quote.id, sub, tax, grand };
    supabase
      .from('quotes')
      .update({
        proposal_subtotal: sub,
        proposal_tax: tax,
        proposal_grand_total: grand,
        proposal_totals_updated_at: new Date().toISOString(),
      })
      .eq('id', quote.id)
      .then(({ error }) => { if (error) console.warn('Sync proposal totals to quote:', error?.message); });
  }, [quote?.id, proposalSubtotal, proposalTotalTax, proposalGrandTotal, estimateCatalogViewOpen]);

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">Loading financials...</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {quote && (quote as any).on_hold && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-950 text-sm">
          <PauseCircle className="w-5 h-5 text-amber-700 shrink-0" aria-hidden />
          <span className="font-medium">This proposal is on hold.</span>
          <span className="text-amber-800/90 text-xs hidden sm:inline">
            Paused for follow-up — workflow status is unchanged.
          </span>
          {!isReadOnly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto sm:ml-0 border-amber-400 text-amber-950 hover:bg-amber-100"
              onClick={() => setQuoteOnHoldForJob(false)}
            >
              <PlayCircle className="w-4 h-4 mr-1" />
              Resume
            </Button>
          )}
        </div>
      )}

      {/* Sticky header: project totals stay visible when scrolling (does not move with content) */}
      {quote && setProposalToolbar && (
        <div className="sticky top-0 z-10 relative flex flex-wrap items-center gap-4 py-2.5 pl-4 pr-12 mb-0 bg-white border-b border-slate-200 shadow-sm text-sm">
          <div className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 overflow-hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={navigateToPreviousProposal}
              disabled={formalJobQuotes.length <= 1 || formalJobQuotes.findIndex((q: any) => q.id === quote.id) >= formalJobQuotes.length - 1}
              className="h-8 w-8 p-0 rounded-none text-slate-600 hover:bg-slate-200 disabled:opacity-40"
              title="Previous (older) proposal"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span
              className={cn(
                'min-w-[100px] px-2 py-1.5 text-center text-sm inline-flex items-center justify-center gap-1 rounded-md border',
                showingCatalogOrLegacyEstimate
                  ? 'bg-amber-50 border-amber-200 text-amber-950'
                  : 'bg-sky-50 border-sky-200 text-slate-900'
              )}
            >
              <span
                className={cn(
                  'font-semibold',
                  showingCatalogOrLegacyEstimate ? 'text-amber-900' : 'text-sky-900'
                )}
              >
                {showingCatalogOrLegacyEstimate ? 'Estimate' : 'Proposal'}
              </span>
              <span
                className={cn(
                  'font-mono font-bold tabular-nums tracking-tight',
                  showingCatalogOrLegacyEstimate ? 'text-amber-950' : 'text-slate-800',
                  !isReadOnly && !showingCatalogOrLegacyEstimate ? 'cursor-pointer hover:underline decoration-dotted underline-offset-2' : ''
                )}
                title={
                  !isReadOnly && !showingCatalogOrLegacyEstimate
                    ? 'Double-click: renumber proposals (newest becomes …-1)'
                    : undefined
                }
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  tryOpenRenumberProposalsDialog();
                }}
              >
                #{displayNumberForQuoteRow(quote, (quote as any).is_customer_estimate === true)}
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={navigateToNextProposal}
              disabled={formalJobQuotes.length <= 1 || formalJobQuotes.findIndex((q: any) => q.id === quote.id) <= 0}
              className="h-8 w-8 p-0 rounded-none text-slate-600 hover:bg-slate-200 disabled:opacity-40"
              title="Next (newer) proposal"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <span className="text-slate-300">|</span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-slate-200 bg-slate-50/90 px-2.5 py-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap">
              {showingCatalogOrLegacyEstimate ? 'Customer estimate' : 'Customer proposal'}
            </span>
            {showingCatalogOrLegacyEstimate ? (
              <>
                <span className="text-slate-300 hidden sm:inline">|</span>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-900">
                  Portal: hidden
                </span>
              </>
            ) : null}
            <span className="text-slate-300 hidden sm:inline">|</span>
            <span className="text-slate-600">Materials:</span>
            <span className="font-bold text-slate-900">
              ${financialBarMaterials.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            {debugMaterialsBuckets && !estimateCatalogViewOpen && (
              <span
                className="text-[11px] text-slate-500"
                title={JSON.stringify(debugMaterialsBuckets)}
              >
                (sheets ${materialSheetsPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, rows{' '}
                {customRowsMaterialsTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, subs{' '}
                {subcontractorMaterialsPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
              </span>
            )}
            <span className="text-slate-600">Labor:</span>
            <span className="font-bold text-slate-900">${financialBarLabor.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600">Subtotal:</span>
            <span className="font-semibold text-slate-900">${financialBarSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            {taxExemptChecked ? null : (
              <span className="text-slate-600">Tax (7%): <span className="font-semibold text-amber-700">${financialBarTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
            )}
            {!isReadOnly && (
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-600" title={taxExemptChecked && taxExemptSaved ? 'Saved — all users will see this job as tax exempt' : taxExemptChecked ? 'Not yet saved to database' : 'Mark this job as tax exempt'}>
                <Checkbox checked={taxExemptChecked} onCheckedChange={(c) => setQuoteTaxExempt(!!c)} />
                <span className="text-xs">Tax exempt</span>
                {taxExemptChecked && taxExemptSaved && (
                  <CheckCircle className="w-3 h-3 text-green-600" />
                )}
              </label>
            )}
            <span className="text-slate-300">|</span>
            <span
              className="text-base font-bold text-green-700"
              title={
                typeof externalJobWorkbookMaterialsTotal === 'number'
                  ? 'Signed contract / proposal workbook only. Job workbook total is shown above the materials workbook column — not included here.'
                  : showingCatalogOrLegacyEstimate
                    ? 'Price-list estimate — not on customer portal until you add lines to the formal proposal below'
                    : 'Customer proposal total'
              }
            >
              GRAND TOTAL: $
              {(Number.isFinite(financialBarGrand) ? financialBarGrand : 0).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          {quote && (
            <Button
              variant="ghost"
              size="sm"
              onClick={copyPortalLinkForThisProposal}
              className="h-8 w-8 p-0 shrink-0"
              title="Copy portal link for this proposal (customer will see this total)"
            >
              <Link2 className="w-4 h-4 text-slate-500" />
            </Button>
          )}
          {quote && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLockUnlock}
              className={isReadOnly ? 'absolute right-2 bottom-2 h-8 w-8 p-0 rounded-md border-amber-400 text-amber-600 bg-amber-50 hover:bg-amber-100 hover:border-amber-500' : 'absolute right-2 bottom-2 h-8 w-8 p-0 rounded-md border-slate-300 text-slate-600 hover:bg-slate-100'}
              title={isReadOnly ? 'Unlock to edit' : 'Lock proposal (read-only; does not mark as sent)'}
            >
              {isReadOnly ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
            </Button>
          )}
        </div>
      )}

      {/* Proposal Info Banner - Show if quote exists (hidden when summary is in green header bar) */}
      {quote && !setProposalToolbar && (
        <Card className="mb-4 border-blue-200 bg-blue-50">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              {/* Left: Current Proposal Info */}
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                <span
                  className={cn(
                    'text-sm font-semibold inline-flex items-center gap-1.5 flex-wrap rounded-md border px-2 py-0.5',
                    showingCatalogOrLegacyEstimate
                      ? 'text-amber-950 bg-amber-50 border-amber-200'
                      : 'text-sky-950 bg-sky-50 border-sky-200'
                  )}
                >
                  <span className={showingCatalogOrLegacyEstimate ? 'text-amber-900' : 'text-sky-900'}>
                    {showingCatalogOrLegacyEstimate ? 'Estimate' : 'Proposal'}
                  </span>
                  <span
                    className={cn(
                      'font-mono font-bold tabular-nums',
                      showingCatalogOrLegacyEstimate ? 'text-amber-950' : 'text-slate-800',
                      !isReadOnly && !showingCatalogOrLegacyEstimate ? 'cursor-pointer hover:underline decoration-dotted underline-offset-2' : ''
                    )}
                    title={
                      !isReadOnly && !showingCatalogOrLegacyEstimate
                        ? 'Double-click: renumber proposals (newest becomes …-1)'
                        : undefined
                    }
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      tryOpenRenumberProposalsDialog();
                    }}
                  >
                    #{displayNumberForQuoteRow(quote, (quote as any).is_customer_estimate === true)}
                  </span>
                </span>
                {(quote as any).sent_at && (() => {
                  const sentAt = new Date((quote as any).sent_at);
                  const createdAt = (quote as any).created_at ? new Date((quote as any).created_at) : null;
                  const timeSpentMs = createdAt ? sentAt.getTime() - createdAt.getTime() : 0;
                  const timeSpentStr = timeSpentMs > 0
                    ? (() => { const h = Math.floor(timeSpentMs / 3600000); const m = Math.round((timeSpentMs % 3600000) / 60000); return h > 0 ? `${h}h ${m}m` : `${m}m`; })()
                    : '';
                  const title = timeSpentStr
                    ? `Sent to customer: ${sentAt.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })} · Time on proposal: ${timeSpentStr}`
                    : `Sent to customer: ${sentAt.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}`;
                  return (
                    <Badge className="text-xs bg-emerald-100 border-emerald-300 text-emerald-900" title={title}>
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Sent {sentAt.toLocaleDateString(undefined, { dateStyle: 'medium' })} at {sentAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      {timeSpentStr && <span className="ml-1">· {timeSpentStr} on proposal</span>}
                    </Badge>
                  );
                })()}
                {isReadOnly && !(quote as any).sent_at && (
                  <Badge className="text-xs bg-amber-100 border-amber-300 text-amber-900">
                    {(quote as any).locked_for_editing ? 'Locked (read-only)' : 'Historical View'}
                  </Badge>
                )}
                {isDefaultLocked && (
                  isReadOnly ? (
                    <Button size="sm" variant="outline" onClick={unlockHistoricalForEditing} className="h-7 text-xs border-amber-400 text-amber-800 hover:bg-amber-50" title="Allow editing this proposal">
                      <LockOpen className="w-3 h-3 mr-1" />Unlock for editing
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={lockHistoricalAgain} className="h-7 text-xs border-slate-400 text-slate-700 hover:bg-slate-50" title="Switch back to read-only">
                      <Lock className="w-3 h-3 mr-1" />Lock (read-only)
                    </Button>
                  )
                )}
              </div>

              {/* Right: Navigation Controls (only show if multiple proposals exist) */}
              {formalJobQuotes.length > 1 && (
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={navigateToFirstProposal}
                    disabled={formalJobQuotes.findIndex(q => q.id === quote.id) === 0}
                    className="h-7 px-2 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                    title="Go to first proposal"
                  >
                    First
                  </Button>
                  <span className="text-xs text-blue-700 font-medium">
                    {formalJobQuotes.findIndex(q => q.id === quote.id) + 1} of {formalJobQuotes.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={navigateToPreviousProposal}
                      disabled={formalJobQuotes.findIndex(q => q.id === quote.id) === formalJobQuotes.length - 1}
                      className="h-7 w-7 p-0 border-blue-300 hover:bg-blue-100"
                      title="Previous Proposal (Older)"
                    >
                      <ChevronDown className="w-4 h-4 rotate-90" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={navigateToNextProposal}
                      disabled={formalJobQuotes.findIndex(q => q.id === quote.id) === 0}
                      className="h-7 w-7 p-0 border-blue-300 hover:bg-blue-100"
                      title="Next Proposal (Newer)"
                    >
                      <ChevronDown className="w-4 h-4 -rotate-90" />
                    </Button>
                  </div>
                </div>
              )}
              {formalJobQuotes.length > 1 && (
                <Button size="sm" variant="outline" onClick={() => setShowProposalComparison(true)} className="border-blue-300 text-blue-700 hover:bg-blue-50">
                  <GitCompare className="w-3 h-3 mr-1" />Compare proposals
                </Button>
              )}
              {quote && formalJobQuotes.length > 1 && (
                <Button size="sm" variant="outline" onClick={() => { setDeleteProposalQuoteId(quote.id); setShowDeleteProposalConfirm(true); }} className="h-8 w-8 p-0 border-red-300 text-red-700 hover:bg-red-50" title="Delete this proposal">
                  <Trash2 className="w-3 h-3" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="w-full">
        {/* When toolbar is in header (Proposal & Materials tab), hide the green row */}
        {!setProposalToolbar && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Proposal Builder</h2>
          <div className="flex gap-2 items-center">
              <Button onClick={() => setEditingDescription(true)} variant="outline" size="sm" className="border-amber-300 hover:bg-amber-50">
                <Edit className="w-4 h-4 mr-2" />
                {buildingDescription ? 'Edit Building Description' : 'Add Building Description'}
              </Button>
              <div className="h-6 w-px bg-border" />
              <Button size="sm" onClick={() => { if (quote) setShowCreateProposalDialog(true); else autoCreateFirstProposal(); }} disabled={creatingVersion || creatingProposal} className="bg-blue-600 hover:bg-blue-700" title="Create a new proposal (allowed even when current proposal is locked)">
                {creatingVersion || creatingProposal ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />Creating...</> : <><Plus className="w-3 h-3 mr-2" />New Proposal</>}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { void createNewCustomerEstimate(); }}
                disabled={creatingVersion}
                className="border-blue-200 bg-white text-blue-900 hover:bg-blue-50"
                title="Price-list estimate for this proposal — no new proposal row"
              >
                <FilePlus className="w-3 h-3 mr-2" />
                New estimate
              </Button>
              {estimateCatalogViewOpen && quote && !isReadOnly && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { void importEstimateCatalogLinesToProposal(); }}
                    className="border-emerald-500 text-emerald-800 hover:bg-emerald-50"
                    title="Append lines as material rows in the proposal below"
                  >
                    <ArrowRightCircle className="w-3 h-3 mr-2" />
                    Import to proposal
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEstimateCatalogViewOpen(false)}>
                    Close estimate
                  </Button>
                </>
              )}
              {quote && (quote as any).is_customer_estimate === true && !isReadOnly && (
                <Button size="sm" variant="outline" onClick={() => { void convertEstimateToProposal(); }} className="border-emerald-500 text-emerald-800 hover:bg-emerald-50">
                  <ArrowRightCircle className="w-3 h-3 mr-2" />
                  Convert to proposal
                </Button>
              )}
              {quote && !quoteHasActiveContract(quote) && (quote as any).is_customer_estimate !== true && (
                <Button size="sm" onClick={setActiveProposalAsContract} className="bg-emerald-600 hover:bg-emerald-700">
                  <Lock className="w-3 h-3 mr-2" />Set as Contract
                </Button>
              )}
              {quote && quoteHasActiveContract(quote) && (
                <Button size="sm" onClick={revokeQuoteContract} variant="outline" className="border-amber-400 text-amber-800 hover:bg-amber-50" title="Only with customer consent">
                  <LockOpen className="w-3 h-3 mr-2" />Revoke contract
                </Button>
              )}
              {quote && (
                (quote as any).sent_at ? (
                  <Button size="sm" disabled variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 cursor-default">
                    <CheckCircle className="w-3 h-3 mr-2" />Sent
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={markProposalAsSent}
                    disabled={isReadOnly || ((quote as any).is_change_order_proposal && !jobHasContract)}
                    variant="outline"
                    className="border-slate-400"
                    title={
                      (quote as any).is_change_order_proposal
                        ? jobHasContract
                          ? 'Send change order to customer for portal signing'
                          : 'Set the main proposal as contract first'
                        : 'Record when this proposal was sent (permanent). Does not lock the workbook; revoke contract only undoes the signed contract.'
                    }
                  >
                    <Send className="w-3 h-3 mr-2" />
                    {(quote as any).is_change_order_proposal ? 'Send change order' : 'Mark as Sent'}
                  </Button>
                )
              )}
              <div className="h-6 w-px bg-border" />
              <Button onClick={() => setShowTemplateEditor(true)} variant="outline" size="sm" className="bg-purple-50 border-purple-300 text-purple-700 hover:bg-purple-100">
                <Settings className="w-4 h-4 mr-2" />Edit Template
              </Button>
              <Button onClick={openDocuments} variant="outline" size="sm" className="bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100">
                <FileText className="w-4 h-4 mr-2" />View Documents
              </Button>
              <Button onClick={() => setShowExportDialog(true)} variant="default" size="sm">
                <Download className="w-4 h-4 mr-2" />Export PDF
              </Button>
              <Button onClick={() => openAddDialog()} variant="outline" size="sm" disabled={isReadOnly}>
                <Plus className="w-4 h-4 mr-2" />Add Row
              </Button>
              <Button onClick={() => setShowSubUploadDialog(true)} variant="outline" size="sm" disabled={isReadOnly}>
                <Upload className="w-4 h-4 mr-2" />Upload Subcontractor Estimate
              </Button>
            </div>
        </div>
        )}

        {/* Compact Project Total row above proposal (hidden when in green header bar) */}
        {!setProposalToolbar && (
        <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
          <div className="flex flex-wrap items-center gap-3 py-2 px-3 rounded-lg bg-gradient-to-r from-slate-100 to-slate-50 border border-slate-200">
            <span className="text-[10px] font-bold uppercase text-slate-500">
              {showingCatalogOrLegacyEstimate ? 'Customer estimate' : 'Customer proposal'}
            </span>
            <span className="text-slate-400">|</span>
            <span className="font-semibold text-slate-700">Materials:</span>
            <span className="font-bold text-slate-900">${financialBarMaterials.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            {(estimateCatalogViewOpen ? financialBarLabor > 0 : proposalLaborPrice > 0) && (
              <>
                <span className="font-semibold text-slate-700">Labor:</span>
                <span className="font-bold text-slate-900">${financialBarLabor.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </>
            )}
            <span className="text-slate-400">|</span>
            <span className="text-slate-600">Subtotal:</span>
            <span className="font-semibold">${financialBarSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            {taxExemptChecked ? null : (
              <span className="text-slate-600">Tax (7%): <span className="font-semibold text-amber-700">${financialBarTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
            )}
            <span className="text-slate-400">|</span>
            <span
              className="text-lg font-bold text-green-700"
              title={
                typeof externalJobWorkbookMaterialsTotal === 'number'
                  ? 'Signed contract workbook only — job workbook is separate'
                  : showingCatalogOrLegacyEstimate
                    ? 'Price-list estimate — not on customer portal'
                    : 'Customer proposal total'
              }
            >
              GRAND TOTAL: $
              {(Number.isFinite(financialBarGrand) ? financialBarGrand : 0).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          {typeof externalJobWorkbookMaterialsTotal === 'number' && (
            <div className="flex flex-wrap items-center gap-2 py-2 px-3 rounded-lg border-2 border-cyan-500/60 bg-cyan-50">
              <span className="text-[10px] font-bold uppercase text-cyan-900">Job workbook</span>
              <span className="text-cyan-900 text-xs">Materials (internal):</span>
              <span className="font-bold tabular-nums text-cyan-950">
                $
                {externalJobWorkbookMaterialsTotal.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span className="text-[10px] text-cyan-800/90">Not in GRAND TOTAL</span>
            </div>
          )}
        </div>
        )}

        {/* Proposal content — full width of container so it fits any screen */}
          <div className="w-full max-w-full mx-auto px-3 sm:px-4">
            <div className="w-full min-w-0">
              <div className="flex-1 min-w-0 space-y-4">
                {estimateCatalogViewOpen && quote && (quote as any).is_customer_estimate !== true && (
                  <Card className="border-amber-300 bg-amber-50/80">
                    <CardHeader className="py-3 pb-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base font-semibold text-amber-950">Price-list estimate</CardTitle>
                        <div className="flex flex-wrap gap-2">
                          <BudgetMaterialCatalogLineItemPicker
                            disabled={!!isReadOnly}
                            onApply={(patch) => {
                              setEstimateLineForm((prev) => ({
                                ...prev,
                                description: patch.description ?? prev.description,
                                quantity: patch.quantity ?? prev.quantity,
                                unit_cost: patch.unit_cost ?? prev.unit_cost,
                                markup_percent: patch.markup_percent ?? prev.markup_percent,
                                taxable: patch.taxable ?? prev.taxable,
                                notes: patch.notes ?? prev.notes,
                              }));
                              setEditingEstimateLine(null);
                              setEstimateLineDialogOpen(true);
                            }}
                          />
                          <Button type="button" variant="outline" size="sm" onClick={() => setBudgetCatalogManageOpen(true)}>
                            Manage price list
                          </Button>
                          <Button size="sm" onClick={() => openEstimateLineDialog(null)} disabled={!!isReadOnly}>
                            <Plus className="w-4 h-4 mr-1" /> Add line
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-amber-900/90 mt-1">
                        Stored separately from the materials workbook. Use Import to proposal to copy lines into formal material rows.
                      </p>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {customerEstimateLines.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">No lines yet — pick from the price list or add a line.</p>
                      ) : (
                        <div className="overflow-x-auto rounded-md border border-amber-200/80 bg-white">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-amber-100/60 text-left text-xs uppercase text-amber-950">
                                <th className="p-2">Description</th>
                                <th className="p-2 w-20">Qty</th>
                                <th className="p-2 w-24">Unit $</th>
                                <th className="p-2 w-20">Mkup %</th>
                                <th className="p-2 w-28 text-right">Extended</th>
                                <th className="p-2 w-16">Tax</th>
                                <th className="p-2 w-28 text-right"> </th>
                              </tr>
                            </thead>
                            <tbody>
                              {customerEstimateLines.map((row) => (
                                <tr key={row.id} className="border-b border-amber-100">
                                  <td className="p-2 font-medium">{row.description}</td>
                                  <td className="p-2 tabular-nums">{Number(row.quantity).toLocaleString()}</td>
                                  <td className="p-2 tabular-nums">${Number(row.unit_cost).toFixed(2)}</td>
                                  <td className="p-2 tabular-nums">{Number(row.markup_percent)}%</td>
                                  <td className="p-2 text-right tabular-nums">
                                    $
                                    {estimateCatalogLineExtendedSell(row).toLocaleString('en-US', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </td>
                                  <td className="p-2">{row.taxable !== false ? 'Yes' : 'No'}</td>
                                  <td className="p-2 text-right whitespace-nowrap">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-2"
                                      disabled={!!isReadOnly}
                                      onClick={() => openEstimateLineDialog(row)}
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-2 text-destructive"
                                      disabled={!!isReadOnly}
                                      onClick={() => void deleteCustomerEstimateLine(row.id)}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={allItemsUnsorted.map(item => item.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {allItems.map((item) => (
                      <SortableRow
                        key={item.id}
                        item={item}
                        sheetMarkups={sheetMarkups}
                        setSheetMarkups={setSheetMarkups}
                        categoryMarkups={categoryMarkups}
                        setCategoryMarkups={setCategoryMarkups}
                        customRowLineItems={displayCustomRowLineItems}
                        sheetLabor={sheetLabor}
                        customRowLabor={customRowLabor}
                        subcontractorLineItems={subcontractorLineItems}
                        linkedSubcontractors={linkedSubcontractors}
                        editingRowName={editingRowName}
                        editingRowNameType={editingRowNameType}
                        tempRowName={tempRowName}
                        setTempRowName={setTempRowName}
                        startEditingRowName={startEditingRowName}
                        saveRowName={saveRowName}
                        cancelEditingRowName={cancelEditingRowName}
                        openSheetDescDialog={openSheetDescDialog}
                        openLaborDialog={openLaborDialog}
                        openAddDialog={openAddDialog}
                        openLineItemDialog={openLineItemDialog}
                        openSubcontractorDialog={openSubcontractorDialog}
                        openAddSubcontractorLineItemDialog={openAddSubcontractorLineItemDialog}
                        openEditSubcontractorLineItemDialog={openEditSubcontractorLineItemDialog}
                        deleteRow={deleteRow}
                        deleteSheetLabor={deleteSheetLabor}
                        toggleSubcontractorLineItem={toggleSubcontractorLineItem}
                        toggleSubcontractorLineItemTaxable={toggleSubcontractorLineItemTaxable}
                        toggleSubcontractorLineItemType={toggleSubcontractorLineItemType}
                        unlinkSubcontractor={unlinkSubcontractor}
                        toggleSubcontractorOptional={toggleSubcontractorOptional}
                        toggleCustomRowOptional={toggleCustomRowOptional}
                        deleteSubcontractorSection={deleteSubcontractorSection}
                        updateSubcontractorMarkup={updateSubcontractorMarkup}
                        updateCustomRowMarkup={updateCustomRowMarkup}
                        updateCustomRowBaseCost={updateCustomRowBaseCost}
                        updateLineItemCost={updateLineItemCost}
                        updateCombinedLineItemMaterialBase={updateCombinedLineItemMaterialBase}
                        updateLineItemEmbeddedLaborMarkup={updateLineItemEmbeddedLaborMarkup}
                        deleteLineItem={deleteLineItem}
                        loadMaterialsData={loadMaterialsData}
                        loadCustomRows={loadCustomRows}
                        loadSubcontractorEstimates={loadSubcontractorEstimates}
                        customRows={customRows}
                        materialSheets={materialSheets}
                        sheetMetaById={sheetMetaById}
                        savingMarkupsRef={savingMarkupsRef}
                        emptyNotesById={emptyNotesById}
                        setEmptyNotesById={setEmptyNotesById}
                        emptyScopeById={emptyScopeById}
                        setEmptyScopeById={setEmptyScopeById}
                        isReadOnly={isReadOnly}
                        quote={quote}
                        setComparePickerSheetId={setComparePickerSheetId}
                        setShowComparePickerDialog={setShowComparePickerDialog}
                        expandedComparisons={expandedComparisons}
                        setExpandedComparisons={setExpandedComparisons}
                        materialsBreakdown={materialsBreakdown}
                        externalPriceLookup={externalPriceLookup}
                        setOptionalCategoryOverlay={setOptionalCategoryOverlay}
                        setOptionalSheetOverlay={setOptionalSheetOverlay}
                        onSheetSelect={onSheetSelect}
                        onOpenCopyToChangeOrder={
                          !isReadOnly && quote && !(quote as any).is_change_order_proposal && jobHasContract
                            ? (sheetId: string, sheetName: string) => {
                                setCopyCoSheetId(sheetId);
                                setCopyCoSheetName(sheetName);
                                setCopyCoRemoveFromProposal(true);
                                setCopyCoDialogOpen(true);
                              }
                            : undefined
                        }
                      />
                    ))}
                  </SortableContext>
                </DndContext>

                {/* Optional add-ons (categories marked as option) — at bottom of proposal, excluded from total */}
                {optionalCategoriesList.length > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center gap-2 py-2 px-3 mb-2 rounded-lg bg-amber-50 border border-amber-200">
                      <span className="text-sm font-semibold text-amber-800 uppercase tracking-wide">Options</span>
                      <span className="text-xs text-amber-600 font-normal">(not included in contract total)</span>
                    </div>
                    <div className="space-y-3">
                      {optionalCategoriesList.map((opt, idx) => (
                        <div
                          key={`${opt.sheetName}-${opt.categoryName}-${idx}`}
                          className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg border border-amber-200 bg-amber-50/50"
                        >
                          <span className="text-sm font-medium text-slate-800">
                            {opt.sheetName} — {opt.categoryName}
                          </span>
                          <span className="text-sm font-semibold text-amber-800">
                            ${opt.priceWithMarkup.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Optional Items Section (sections marked optional) */}
                {optionalItems.length > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center gap-2 py-2 px-3 mb-2 rounded-lg bg-amber-50 border border-amber-200">
                      <span className="text-sm font-semibold text-amber-800 uppercase tracking-wide">Optional Items</span>
                      <span className="text-xs text-amber-600 font-normal">(not included in proposal total)</span>
                    </div>
                    <div className="space-y-4">
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                      >
                        <SortableContext
                          items={optionalItems.map(item => item.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {optionalItems.map((item) => (
                            <SortableRow
                              key={item.id}
                              item={item}
                              sheetMarkups={sheetMarkups}
                              setSheetMarkups={setSheetMarkups}
                              categoryMarkups={categoryMarkups}
                              setCategoryMarkups={setCategoryMarkups}
                              customRowLineItems={displayCustomRowLineItems}
                              sheetLabor={sheetLabor}
                              customRowLabor={customRowLabor}
                              subcontractorLineItems={subcontractorLineItems}
                              linkedSubcontractors={linkedSubcontractors}
                              editingRowName={editingRowName}
                              editingRowNameType={editingRowNameType}
                              tempRowName={tempRowName}
                              setTempRowName={setTempRowName}
                              startEditingRowName={startEditingRowName}
                              saveRowName={saveRowName}
                              cancelEditingRowName={cancelEditingRowName}
                              openSheetDescDialog={openSheetDescDialog}
                              openLaborDialog={openLaborDialog}
                              openAddDialog={openAddDialog}
                              openLineItemDialog={openLineItemDialog}
                              openSubcontractorDialog={openSubcontractorDialog}
                              openAddSubcontractorLineItemDialog={openAddSubcontractorLineItemDialog}
                              openEditSubcontractorLineItemDialog={openEditSubcontractorLineItemDialog}
                              deleteRow={deleteRow}
                              deleteSheetLabor={deleteSheetLabor}
                              toggleSubcontractorLineItem={toggleSubcontractorLineItem}
                              toggleSubcontractorLineItemTaxable={toggleSubcontractorLineItemTaxable}
                              toggleSubcontractorLineItemType={toggleSubcontractorLineItemType}
                              unlinkSubcontractor={unlinkSubcontractor}
                              toggleSubcontractorOptional={toggleSubcontractorOptional}
                              toggleCustomRowOptional={toggleCustomRowOptional}
                              deleteSubcontractorSection={deleteSubcontractorSection}
                              updateSubcontractorMarkup={updateSubcontractorMarkup}
                              updateCustomRowMarkup={updateCustomRowMarkup}
                              updateCustomRowBaseCost={updateCustomRowBaseCost}
                              updateLineItemCost={updateLineItemCost}
                              updateCombinedLineItemMaterialBase={updateCombinedLineItemMaterialBase}
                              updateLineItemEmbeddedLaborMarkup={updateLineItemEmbeddedLaborMarkup}
                              deleteLineItem={deleteLineItem}
                              loadMaterialsData={loadMaterialsData}
                              loadCustomRows={loadCustomRows}
                              loadSubcontractorEstimates={loadSubcontractorEstimates}
                              customRows={customRows}
                              materialSheets={materialSheets}
                              sheetMetaById={sheetMetaById}
                              savingMarkupsRef={savingMarkupsRef}
                              emptyNotesById={emptyNotesById}
                              setEmptyNotesById={setEmptyNotesById}
                              emptyScopeById={emptyScopeById}
                              setEmptyScopeById={setEmptyScopeById}
                              isReadOnly={isReadOnly}
                              quote={quote}
                              setComparePickerSheetId={setComparePickerSheetId}
                              setShowComparePickerDialog={setShowComparePickerDialog}
                              expandedComparisons={expandedComparisons}
                              setExpandedComparisons={setExpandedComparisons}
                              materialsBreakdown={materialsBreakdown}
                              externalPriceLookup={externalPriceLookup}
                              setOptionalCategoryOverlay={setOptionalCategoryOverlay}
                              setOptionalSheetOverlay={setOptionalSheetOverlay}
                              onSheetSelect={onSheetSelect}
                              onOpenCopyToChangeOrder={
                          !isReadOnly && quote && !(quote as any).is_change_order_proposal && jobHasContract
                            ? (sheetId: string, sheetName: string) => {
                                setCopyCoSheetId(sheetId);
                                setCopyCoSheetName(sheetName);
                                setCopyCoRemoveFromProposal(true);
                                setCopyCoDialogOpen(true);
                              }
                            : undefined
                        }
                      />
                            ))}
                          </SortableContext>
                        </DndContext>
                    </div>
                  </div>
                )}

                {!jobHasContract && (
                  <div className="mt-4 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-800">
                    <strong className="text-slate-900">Change orders</strong> can only be{' '}
                    <strong>created</strong> and <strong>sent</strong> after the main proposal is the contract. On the
                    primary proposal, use toolbar <strong>Set as Contract</strong> (or the customer signs in the portal),
                    then add change orders and send them.
                  </div>
                )}

                {changeOrderItemsUnsorted.length > 0 && (
                  <div className="mt-4">
                    <div className="flex flex-wrap items-center gap-2 py-2 px-3 mb-2 rounded-lg bg-orange-50 border border-orange-200">
                      <span className="text-sm font-semibold text-orange-900 uppercase tracking-wide">Change orders</span>
                      <span className="text-xs text-orange-700 font-normal">
                        {jobHasContract
                          ? (
                            <>
                              Separate from the main contract. Use <strong className="font-semibold">⋮ → Send change orders to customer</strong> below, or{' '}
                              <strong className="font-semibold">Send change order</strong> in the toolbar on the Change order proposal.
                            </>
                          ) : (
                            <>Available after the main proposal is set as contract.</>
                          )}
                      </span>
                    </div>
                    <div className="space-y-4">
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEndChangeOrders}
                      >
                        <SortableContext
                          items={changeOrderItemsUnsorted.map((item) => item.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {changeOrderItemsUnsorted.map((item) => (
                            <SortableRow
                              key={item.id}
                              item={item}
                              changeOrderAlreadySent={!!allJobQuotes.find((q: any) => q.is_change_order_proposal)?.sent_at}
                              onSendChangeOrdersToCustomer={sendChangeOrderProposalToCustomer}
                              sendingCoToCustomer={sendingCoToCustomer}
                              jobHasContract={jobHasContract}
                              sheetMarkups={sheetMarkups}
                              setSheetMarkups={setSheetMarkups}
                              categoryMarkups={categoryMarkups}
                              setCategoryMarkups={setCategoryMarkups}
                              customRowLineItems={displayCustomRowLineItems}
                              sheetLabor={sheetLabor}
                              customRowLabor={customRowLabor}
                              subcontractorLineItems={subcontractorLineItems}
                              linkedSubcontractors={linkedSubcontractors}
                              editingRowName={editingRowName}
                              editingRowNameType={editingRowNameType}
                              tempRowName={tempRowName}
                              setTempRowName={setTempRowName}
                              startEditingRowName={startEditingRowName}
                              saveRowName={saveRowName}
                              cancelEditingRowName={cancelEditingRowName}
                              openSheetDescDialog={openSheetDescDialog}
                              openLaborDialog={openLaborDialog}
                              openAddDialog={openAddDialog}
                              openLineItemDialog={openLineItemDialog}
                              openSubcontractorDialog={openSubcontractorDialog}
                              openAddSubcontractorLineItemDialog={openAddSubcontractorLineItemDialog}
                              openEditSubcontractorLineItemDialog={openEditSubcontractorLineItemDialog}
                              deleteRow={deleteRow}
                              deleteSheetLabor={deleteSheetLabor}
                              toggleSubcontractorLineItem={toggleSubcontractorLineItem}
                              toggleSubcontractorLineItemTaxable={toggleSubcontractorLineItemTaxable}
                              toggleSubcontractorLineItemType={toggleSubcontractorLineItemType}
                              unlinkSubcontractor={unlinkSubcontractor}
                              toggleSubcontractorOptional={toggleSubcontractorOptional}
                              toggleCustomRowOptional={toggleCustomRowOptional}
                              deleteSubcontractorSection={deleteSubcontractorSection}
                              updateSubcontractorMarkup={updateSubcontractorMarkup}
                              updateCustomRowMarkup={updateCustomRowMarkup}
                              updateCustomRowBaseCost={updateCustomRowBaseCost}
                              updateLineItemCost={updateLineItemCost}
                              updateCombinedLineItemMaterialBase={updateCombinedLineItemMaterialBase}
                              updateLineItemEmbeddedLaborMarkup={updateLineItemEmbeddedLaborMarkup}
                              deleteLineItem={deleteLineItem}
                              loadMaterialsData={loadMaterialsData}
                              loadCustomRows={loadCustomRows}
                              loadSubcontractorEstimates={loadSubcontractorEstimates}
                              customRows={customRows}
                              materialSheets={materialSheets}
                              sheetMetaById={sheetMetaById}
                              savingMarkupsRef={savingMarkupsRef}
                              emptyNotesById={emptyNotesById}
                              setEmptyNotesById={setEmptyNotesById}
                              emptyScopeById={emptyScopeById}
                              setEmptyScopeById={setEmptyScopeById}
                              isReadOnly={isReadOnly}
                              quote={quote}
                              setComparePickerSheetId={setComparePickerSheetId}
                              setShowComparePickerDialog={setShowComparePickerDialog}
                              expandedComparisons={expandedComparisons}
                              setExpandedComparisons={setExpandedComparisons}
                              materialsBreakdown={materialsBreakdown}
                              externalPriceLookup={externalPriceLookup}
                              setOptionalCategoryOverlay={setOptionalCategoryOverlay}
                              setOptionalSheetOverlay={setOptionalSheetOverlay}
                              onSheetSelect={onSheetSelect}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
      </div>

      {/* Compare Picker Dialog — lets user choose which required section to compare an optional section against */}
      <Dialog open={showComparePickerDialog} onOpenChange={setShowComparePickerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Compare with Section</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Select the included section you want to compare this optional section against. The price difference will be shown side-by-side.
            </p>
            <div className="space-y-2">
              {allItems
                .filter(item => item.type === 'material')
                .map(item => {
                  const s = item.data as any;
                  return (
                    <button
                      key={s.sheetId}
                      className="w-full text-left px-3 py-2 rounded border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                      onClick={async () => {
                        if (!comparePickerSheetId) return;
                        await supabase.from('material_sheets').update({ compare_to_sheet_id: s.sheetId } as any).eq('id', comparePickerSheetId);
                        await loadMaterialsData(quote?.id ?? null, false);
                        // Auto-expand the comparison panel for this optional sheet
                        setExpandedComparisons(prev => new Set([...prev, comparePickerSheetId]));
                        setShowComparePickerDialog(false);
                        setComparePickerSheetId(null);
                      }}
                    >
                      <span className="font-medium text-slate-800">{s.sheetName}</span>
                      {s.sheetDescription && <span className="text-xs text-slate-500 ml-2">{s.sheetDescription.slice(0, 60)}</span>}
                    </button>
                  );
                })}
              {allItems.filter(item => item.type === 'material').length === 0 && (
                <p className="text-sm text-slate-400 italic">No included sections found. Add a required section first.</p>
              )}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => { setShowComparePickerDialog(false); setComparePickerSheetId(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialogs remain unchanged - copying from original */}
      {/* Sheet Description Dialog */}
      <Dialog open={showSheetDescDialog} onOpenChange={setShowSheetDescDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Description</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              value={sheetDescription}
              onChange={(e) => setSheetDescription(e.target.value)}
              placeholder="Enter description..."
              rows={4}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowSheetDescDialog(false)}>
                Cancel
              </Button>
              <Button onClick={saveSheetDescription}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mark as Sent — manual SQL fallback */}
      <Dialog open={showMarkAsSentManualDialog} onOpenChange={setShowMarkAsSentManualDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Mark as Sent — run this in Supabase</DialogTitle>
            <DialogDescription>
              Automatic mark-as-sent failed. Copy the SQL below, open Supabase Dashboard → SQL Editor, paste it, and click Run. Then refresh this page.
            </DialogDescription>
          </DialogHeader>
          <pre className="bg-slate-100 dark:bg-slate-800 p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap font-mono">{markAsSentManualSql}</pre>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(markAsSentManualSql);
                  toast.success('SQL copied to clipboard');
                } catch {
                  toast.error('Could not copy');
                }
              }}
            >
              Copy SQL
            </Button>
            <Button onClick={() => { setShowMarkAsSentManualDialog(false); loadQuoteData(); loadData(true); }}>
              Done / Refresh
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add line item to subcontractor */}
      <Dialog open={showAddSubcontractorLineItemDialog} onOpenChange={(open) => { if (!open) setAddSubcontractorLineItemEstimateId(null); setShowAddSubcontractorLineItemDialog(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add line item to subcontractor</DialogTitle>
            <DialogDescription>
              Add a custom material or labor line item. Use a negative unit price for a discount (e.g. quantity 1, unit price -500).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Description</Label>
              <Input
                value={subLineItemDescription}
                onChange={(e) => setSubLineItemDescription(e.target.value)}
                placeholder="e.g., Additional trim, Installation labor"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={subLineItemQuantity}
                  onChange={(e) => setSubLineItemQuantity(e.target.value)}
                />
              </div>
              <div>
                <Label>Unit price ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={subLineItemUnitPrice}
                  onChange={(e) => setSubLineItemUnitPrice(e.target.value)}
                  placeholder="0.00 or negative for discount"
                />
              </div>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={subLineItemType} onValueChange={(v: 'material' | 'labor') => { setSubLineItemType(v); if (v === 'labor') setSubLineItemTaxable(false); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="material">Material</SelectItem>
                  <SelectItem value="labor">Labor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {subLineItemType === 'material' && (
              <label className="flex items-center gap-2">
                <Checkbox checked={subLineItemTaxable} onCheckedChange={(c) => setSubLineItemTaxable(!!c)} />
                <span className="text-sm">Taxable</span>
              </label>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAddSubcontractorLineItemDialog(false)}>Cancel</Button>
              <Button onClick={saveAddSubcontractorLineItem}>Add line item</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit subcontractor line item */}
      <Dialog open={showEditSubcontractorLineItemDialog} onOpenChange={(open) => { if (!open) setEditingSubcontractorLineItemId(null); setShowEditSubcontractorLineItemDialog(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit line item</DialogTitle>
            <DialogDescription>
              Change description, quantity, or unit price. Negative unit prices are allowed for discounts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Description</Label>
              <Input
                value={subLineItemDescription}
                onChange={(e) => setSubLineItemDescription(e.target.value)}
                placeholder="e.g., Additional trim, Installation labor"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={subLineItemQuantity}
                  onChange={(e) => setSubLineItemQuantity(e.target.value)}
                />
              </div>
              <div>
                <Label>Unit price ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={subLineItemUnitPrice}
                  onChange={(e) => setSubLineItemUnitPrice(e.target.value)}
                  placeholder="0.00 or negative for discount"
                />
              </div>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={subLineItemType} onValueChange={(v: 'material' | 'labor') => { setSubLineItemType(v); if (v === 'labor') setSubLineItemTaxable(false); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="material">Material</SelectItem>
                  <SelectItem value="labor">Labor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {subLineItemType === 'material' && (
              <label className="flex items-center gap-2">
                <Checkbox checked={subLineItemTaxable} onCheckedChange={(c) => setSubLineItemTaxable(!!c)} />
                <span className="text-sm">Taxable</span>
              </label>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowEditSubcontractorLineItemDialog(false)}>Cancel</Button>
              <Button onClick={saveEditSubcontractorLineItem}>Save changes</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Labor Dialog */}
      <Dialog open={showLaborDialog} onOpenChange={setShowLaborDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLaborSheetId || editingLaborRowId ? 'Edit Labor' : 'Add Labor'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Description</Label>
              <Input
                value={laborForm.description}
                onChange={(e) => setLaborForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="e.g., Labor & Installation"
              />
            </div>
            <div>
              <Label>Estimated Hours</Label>
              <Input
                type="number"
                value={laborForm.estimated_hours}
                onChange={(e) => setLaborForm(prev => ({ ...prev, estimated_hours: parseFloat(e.target.value) || 0 }))}
                step="0.5"
                min="0"
              />
            </div>
            <div>
              <Label>Hourly Rate ($)</Label>
              <Input
                type="number"
                value={laborForm.hourly_rate}
                onChange={(e) => setLaborForm(prev => ({ ...prev, hourly_rate: parseFloat(e.target.value) || 60 }))}
                step="1"
                min="0"
              />
            </div>
            <div>
              <Label>Notes (Optional)</Label>
              <Textarea
                value={laborForm.notes}
                onChange={(e) => setLaborForm(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowLaborDialog(false)}>
                Cancel
              </Button>
              <Button onClick={saveSheetLabor}>
                Save Labor
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Custom Row Dialog — non-modal floating panel (draggable) */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog} modal={false}>
        <DialogContent
          ref={customRowDialogRef}
          floating
          overlayClassName="pointer-events-none bg-slate-950/20 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          showCloseButton={false}
          className={cn(
            'w-[min(42rem,calc(100vw-1.5rem))] max-w-2xl max-h-[min(88vh,900px)] shadow-2xl border-2 border-slate-300',
          )}
          style={{
            left: `${customRowPanelPos.x}px`,
            top: `${customRowPanelPos.y}px`,
            transform: 'none',
          }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div
            className="flex items-center gap-2 px-3 py-2.5 border-b bg-slate-100 cursor-grab active:cursor-grabbing select-none shrink-0 touch-none"
            onPointerDown={(e) => {
              const t = e.target as HTMLElement;
              if (t.closest('button')) return;
              customRowDragRef.current = {
                pointerId: e.pointerId,
                startClientX: e.clientX,
                startClientY: e.clientY,
                originX: customRowPanelPos.x,
                originY: customRowPanelPos.y,
              };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = customRowDragRef.current;
              if (!d || e.pointerId !== d.pointerId) return;
              const nx = d.originX + (e.clientX - d.startClientX);
              const ny = d.originY + (e.clientY - d.startClientY);
              const rect = customRowDialogRef.current?.getBoundingClientRect();
              const pw = rect?.width ?? 672;
              const ph = rect?.height ?? 480;
              const margin = 8;
              setCustomRowPanelPos({
                x: Math.max(margin, Math.min(window.innerWidth - pw - margin, nx)),
                y: Math.max(margin, Math.min(window.innerHeight - ph - margin, ny)),
              });
            }}
            onPointerUp={(e) => {
              const d = customRowDragRef.current;
              if (!d || e.pointerId !== d.pointerId) return;
              customRowDragRef.current = null;
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              } catch {
                /* already released */
              }
            }}
            onPointerCancel={() => {
              customRowDragRef.current = null;
            }}
          >
            <GripVertical className="w-4 h-4 text-slate-500 shrink-0 pointer-events-none" aria-hidden />
            <DialogTitle className="text-base font-semibold m-0 flex-1 pointer-events-none leading-tight">
              {editingRow ? 'Edit Row' : 'Add Custom Row'}
            </DialogTitle>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </DialogClose>
          </div>
          <div className="overflow-y-auto flex-1 min-h-0 p-6 space-y-4">
            <DialogDescription className="sr-only">
              Add or edit a custom proposal row: category, name, quantity, unit cost, and options.
            </DialogDescription>
            {!linkedSheetId && (
              <div>
                <Label>Category</Label>
                <Select 
                  value={category} 
                  onValueChange={(val) => {
                    setCategory(val);
                    // Auto-set fields based on category
                    if (val === 'materials') {
                      setTaxable(true);
                    } else if (val === 'labor') {
                      setTaxable(false);
                    } else if (val === 'line_items') {
                      // Line items container - no base cost
                      setQuantity('1');
                      setUnitCost('0');
                      setMarkupPercent('0');
                      setTaxable(true);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="line_items">📋 Line Items Container</SelectItem>
                    <SelectItem value="materials">Materials</SelectItem>
                    <SelectItem value="labor">Labor</SelectItem>
                    <SelectItem value="subcontractor">Subcontractor</SelectItem>
                    <SelectItem value="equipment">Equipment</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                {category === 'line_items' && (
                  <p className="text-xs text-blue-600 mt-2 bg-blue-50 border border-blue-200 rounded p-2">
                    <strong>Line Items Container:</strong> This row has no base cost. Add individual line items below, each with their own pricing, markup, and tax settings.
                  </p>
                )}
              </div>
            )}

            <div>
              <Label>Name</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Gutters, Electrical Work, Concrete"
              />
            </div>

            {category !== 'line_items' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      step="0.01"
                      min="0"
                    />
                  </div>
                  <div>
                    <Label>Unit Cost ($)</Label>
                    <Input
                      type="number"
                      value={unitCost}
                      onChange={(e) => setUnitCost(e.target.value)}
                      step="0.01"
                      min="0"
                    />
                  </div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded p-3">
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-medium">Base Cost:</span>
                      <span className="font-bold text-blue-700">
                        ${((parseFloat(quantity) || 0) * (parseFloat(unitCost) || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-2">
                      💡 <strong>Tip:</strong> Set Quantity or Unit Cost to $0 if you only want to use line items for this section.
                      The section can have a base cost AND line items, or just line items alone.
                    </p>
                  </div>
                </div>

                <div>
                  <Label>Markup %</Label>
                  <Input
                    type="number"
                    value={markupPercent}
                    onChange={(e) => setMarkupPercent(e.target.value)}
                    step="1"
                    min="0"
                  />
                </div>
              </>
            )}

            {category === 'line_items' && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <List className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="space-y-2 text-sm">
                    <p className="font-semibold text-blue-900">Line Items Only Section</p>
                    <p className="text-slate-700">This row serves as a container. After creating it, you can:</p>
                    <ul className="list-disc list-inside text-slate-600 space-y-1 ml-2">
                      <li>Add individual line items with their own pricing</li>
                      <li>Set different markup percentages for each item</li>
                      <li>Control taxable status per line item</li>
                      <li>Mix material and labor items in the same section</li>
                    </ul>
                    <p className="text-blue-700 font-medium mt-3">
                      ✓ No base cost • ✓ No row-level markup • ✓ Full line item control
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <Label>Description</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter detailed description of the work or materials..."
                rows={3}
              />
            </div>

            {category !== 'line_items' && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="row-taxable"
                  checked={taxable}
                  onChange={(e) => setTaxable(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <Label htmlFor="row-taxable" className="cursor-pointer">
                  Taxable
                </Label>
                <p className="text-xs text-muted-foreground ml-2">
                  {taxable 
                    ? 'Will be included in taxable subtotal (materials)' 
                    : 'Will be excluded from tax calculation (labor)'}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button onClick={saveCustomRow}>
                {editingRow ? 'Update' : 'Add'} Row
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Line Item Dialog */}
      <Dialog open={showLineItemDialog} onOpenChange={setShowLineItemDialog}>
        <DialogContent className={lineItemType === 'combined' ? "max-w-4xl" : "max-w-lg"}>
          <DialogHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0 space-y-1.5">
                <DialogTitle>
                  {editingLineItem ? 'Edit Line Item' : 'Add Line Item'}
                </DialogTitle>
                <DialogDescription>
                  {lineItemType === 'material' && 'Add material costs with markup and tax options'}
                  {lineItemType === 'labor' && 'Add labor hours and rates'}
                  {lineItemType === 'combined' && 'Add material costs, labor hours, or both in a single line item'}
                </DialogDescription>
              </div>
              {(lineItemType === 'material' || lineItemType === 'combined') && (
                <div className="flex flex-wrap gap-2 shrink-0">
                  <BudgetMaterialCatalogLineItemPicker
                    disabled={savingLineItem}
                    onApply={(patch) => {
                      setLineItemForm((prev) => ({ ...prev, ...patch }));
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setBudgetCatalogManageOpen(true)}
                  >
                    Manage price list
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Description</Label>
              <Input
                value={lineItemForm.description}
                onChange={(e) => setLineItemForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder={lineItemType === 'labor' ? "e.g., Installation Labor" : "e.g., Concrete Foundation with Installation"}
              />
            </div>

            {/* Conditional layout based on type */}
            {lineItemType === 'combined' ? (
              /* Two-column layout for Combined */
              <div className="grid grid-cols-2 gap-6">
                {/* Material Section */}
                <div className="space-y-4 border-r pr-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-blue-600" />
                    <h3 className="text-sm font-semibold text-blue-900">Material</h3>
                  </div>
                  
                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      value={lineItemForm.quantity}
                      onChange={(e) => setLineItemForm(prev => ({ ...prev, quantity: e.target.value }))}
                      step="0.01"
                      min="0"
                      placeholder="0"
                    />
                  </div>
                  
                  <div>
                    <Label>Unit Cost ($)</Label>
                    <Input
                      type="number"
                      value={lineItemForm.unit_cost}
                      onChange={(e) => setLineItemForm(prev => ({ ...prev, unit_cost: e.target.value }))}
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                    />
                  </div>
                  
                  <div>
                    <Label>Markup %</Label>
                    <Input
                      type="number"
                      value={lineItemForm.markup_percent}
                      onChange={(e) => setLineItemForm(prev => ({ ...prev, markup_percent: e.target.value }))}
                      step="1"
                      min="0"
                      placeholder="10"
                    />
                  </div>
                  
                  <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-600">Cost:</span>
                      <span className="font-semibold">
                        ${((parseFloat(lineItemForm.quantity) || 0) * (parseFloat(lineItemForm.unit_cost) || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-600">Markup:</span>
                      <span className="font-semibold">
                        ${(((parseFloat(lineItemForm.quantity) || 0) * (parseFloat(lineItemForm.unit_cost) || 0)) * (parseFloat(lineItemForm.markup_percent) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-blue-300">
                      <span className="font-bold text-blue-900">Material Price:</span>
                      <span className="font-bold text-blue-700">
                        ${(((parseFloat(lineItemForm.quantity) || 0) * (parseFloat(lineItemForm.unit_cost) || 0)) * (1 + (parseFloat(lineItemForm.markup_percent) || 0) / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="lineitem-taxable"
                      checked={lineItemForm.taxable}
                      onChange={(e) => setLineItemForm(prev => ({ ...prev, taxable: e.target.checked }))}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <Label htmlFor="lineitem-taxable" className="cursor-pointer text-xs">
                      Taxable (materials only)
                    </Label>
                  </div>
                </div>
                
                {/* Labor Section */}
                <div className="space-y-4 pl-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-amber-600" />
                    <h3 className="text-sm font-semibold text-amber-900">Labor</h3>
                  </div>
                  
                  <div>
                    <Label>Hours</Label>
                    <Input
                      type="number"
                      value={lineItemForm.labor_hours}
                      onChange={(e) => setLineItemForm(prev => ({ ...prev, labor_hours: e.target.value }))}
                      step="0.5"
                      min="0"
                      placeholder="0"
                    />
                  </div>
                  
                  <div>
                    <Label>Hourly Rate ($)</Label>
                    <Input
                      type="number"
                      value={lineItemForm.labor_rate}
                      onChange={(e) => setLineItemForm(prev => ({ ...prev, labor_rate: e.target.value }))}
                      step="1"
                      min="0"
                      placeholder="60"
                    />
                  </div>
                  
                  <div>
                    <Label>Markup %</Label>
                    <Input
                      type="number"
                      value={lineItemForm.labor_markup_percent}
                      onChange={(e) => setLineItemForm(prev => ({ ...prev, labor_markup_percent: e.target.value }))}
                      step="1"
                      min="0"
                      placeholder="10"
                    />
                  </div>
                  
                  <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs">
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-600">Cost:</span>
                      <span className="font-semibold">
                        ${((parseFloat(lineItemForm.labor_hours) || 0) * (parseFloat(lineItemForm.labor_rate) || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-600">Markup:</span>
                      <span className="font-semibold">
                        ${(((parseFloat(lineItemForm.labor_hours) || 0) * (parseFloat(lineItemForm.labor_rate) || 0)) * (parseFloat(lineItemForm.labor_markup_percent) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-amber-300">
                      <span className="font-bold text-amber-900">Labor Price:</span>
                      <span className="font-bold text-amber-700">
                        ${(((parseFloat(lineItemForm.labor_hours) || 0) * (parseFloat(lineItemForm.labor_rate) || 0)) * (1 + (parseFloat(lineItemForm.labor_markup_percent) || 0) / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                  
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    Labor is automatically non-taxable
                  </p>
                </div>
              </div>
            ) : lineItemType === 'labor' ? (
              /* Labor-only layout */
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-amber-600" />
                  <h3 className="text-sm font-semibold text-amber-900">Labor Details</h3>
                </div>
                
                <div>
                  <Label>Hours</Label>
                  <Input
                    type="number"
                    value={lineItemForm.labor_hours}
                    onChange={(e) => setLineItemForm(prev => ({ ...prev, labor_hours: e.target.value }))}
                    step="0.5"
                    min="0"
                    placeholder="0"
                  />
                </div>
                
                <div>
                  <Label>Hourly Rate ($)</Label>
                  <Input
                    type="number"
                    value={lineItemForm.labor_rate}
                    onChange={(e) => setLineItemForm(prev => ({ ...prev, labor_rate: e.target.value }))}
                    step="1"
                    min="0"
                    placeholder="60"
                  />
                </div>
                
                <div>
                  <Label>Markup %</Label>
                  <Input
                    type="number"
                    value={lineItemForm.labor_markup_percent}
                    onChange={(e) => setLineItemForm(prev => ({ ...prev, labor_markup_percent: e.target.value }))}
                    step="1"
                    min="0"
                    placeholder="10"
                  />
                </div>
                
                <div className="bg-amber-50 border border-amber-200 rounded p-3">
                  <div className="flex justify-between mb-1 text-sm">
                    <span className="text-slate-600">Cost:</span>
                    <span className="font-semibold">
                      ${((parseFloat(lineItemForm.labor_hours) || 0) * (parseFloat(lineItemForm.labor_rate) || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between mb-1 text-sm">
                    <span className="text-slate-600">Markup:</span>
                    <span className="font-semibold">
                      ${(((parseFloat(lineItemForm.labor_hours) || 0) * (parseFloat(lineItemForm.labor_rate) || 0)) * (parseFloat(lineItemForm.labor_markup_percent) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-amber-300">
                    <span className="font-bold text-amber-900">Total Labor Price:</span>
                    <span className="font-bold text-amber-700 text-lg">
                      ${(((parseFloat(lineItemForm.labor_hours) || 0) * (parseFloat(lineItemForm.labor_rate) || 0)) * (1 + (parseFloat(lineItemForm.labor_markup_percent) || 0) / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
                
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  Labor is automatically non-taxable
                </p>
              </div>
            ) : (
              /* Material-only layout */
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-blue-600" />
                  <h3 className="text-sm font-semibold text-blue-900">Material Details</h3>
                </div>
                
                <div>
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    value={lineItemForm.quantity}
                    onChange={(e) => setLineItemForm(prev => ({ ...prev, quantity: e.target.value }))}
                    step="0.01"
                    min="0"
                    placeholder="0"
                  />
                </div>
                
                <div>
                  <Label>Unit Cost ($)</Label>
                  <Input
                    type="number"
                    value={lineItemForm.unit_cost}
                    onChange={(e) => setLineItemForm(prev => ({ ...prev, unit_cost: e.target.value }))}
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                  />
                </div>
                
                <div>
                  <Label>Markup %</Label>
                  <Input
                    type="number"
                    value={lineItemForm.markup_percent}
                    onChange={(e) => setLineItemForm(prev => ({ ...prev, markup_percent: e.target.value }))}
                    step="1"
                    min="0"
                    placeholder="10"
                  />
                </div>
                
                <div className="bg-blue-50 border border-blue-200 rounded p-3">
                  <div className="flex justify-between mb-1 text-sm">
                    <span className="text-slate-600">Cost:</span>
                    <span className="font-semibold">
                      ${((parseFloat(lineItemForm.quantity) || 0) * (parseFloat(lineItemForm.unit_cost) || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between mb-1 text-sm">
                    <span className="text-slate-600">Markup:</span>
                    <span className="font-semibold">
                      ${(((parseFloat(lineItemForm.quantity) || 0) * (parseFloat(lineItemForm.unit_cost) || 0)) * (parseFloat(lineItemForm.markup_percent) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-blue-300">
                    <span className="font-bold text-blue-900">Total Material Price:</span>
                    <span className="font-bold text-blue-700 text-lg">
                      ${(((parseFloat(lineItemForm.quantity) || 0) * (parseFloat(lineItemForm.unit_cost) || 0)) * (1 + (parseFloat(lineItemForm.markup_percent) || 0) / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="lineitem-taxable"
                    checked={lineItemForm.taxable}
                    onChange={(e) => setLineItemForm(prev => ({ ...prev, taxable: e.target.checked }))}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <Label htmlFor="lineitem-taxable" className="cursor-pointer text-sm">
                    Taxable
                  </Label>
                </div>
              </div>
            )}
            
            {/* Combined Total - only show for combined type */}
            {lineItemType === 'combined' && (
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-green-900">Combined Total Price</p>
                    <p className="text-xs text-green-700">Material + Labor (with markups)</p>
                  </div>
                  <p className="text-2xl font-bold text-green-700">
                    ${(
                      (((parseFloat(lineItemForm.quantity) || 0) * (parseFloat(lineItemForm.unit_cost) || 0)) * (1 + (parseFloat(lineItemForm.markup_percent) || 0) / 100)) +
                      (((parseFloat(lineItemForm.labor_hours) || 0) * (parseFloat(lineItemForm.labor_rate) || 0)) * (1 + (parseFloat(lineItemForm.labor_markup_percent) || 0) / 100))
                    ).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            )}
            
            <div>
              <Label>Notes (Optional)</Label>
              <Textarea
                value={lineItemForm.notes}
                onChange={(e) => setLineItemForm(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
                placeholder="Additional details about this line item..."
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="lineitem-hide-from-customer"
                checked={lineItemForm.hide_from_customer}
                onChange={(e) => setLineItemForm(prev => ({ ...prev, hide_from_customer: e.target.checked }))}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <Label htmlFor="lineitem-hide-from-customer" className="cursor-pointer text-sm">
                Hide from customer portal
              </Label>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowLineItemDialog(false)}>
                Cancel
              </Button>
              {!editingLineItem && (
                <Button variant="outline" onClick={() => saveLineItem(true)} disabled={savingLineItem}>
                  <Plus className="w-4 h-4 mr-2" />
                  Save & Add Another
                </Button>
              )}
              <Button onClick={() => saveLineItem(false)} disabled={savingLineItem}>
                {editingLineItem ? 'Update' : 'Save'} Line Item
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <BudgetMaterialCatalogManageDialog open={budgetCatalogManageOpen} onOpenChange={setBudgetCatalogManageOpen} />

      <Dialog open={estimateLineDialogOpen} onOpenChange={setEstimateLineDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingEstimateLine ? 'Edit estimate line' : 'Add estimate line'}</DialogTitle>
            <DialogDescription>
              Lines use the office price list database (not the proposal materials workbook).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <BudgetMaterialCatalogLineItemPicker
              disabled={savingEstimateLine}
              onApply={(patch) => {
                setEstimateLineForm((prev) => ({
                  ...prev,
                  description: patch.description ?? prev.description,
                  quantity: patch.quantity ?? prev.quantity,
                  unit_cost: patch.unit_cost ?? prev.unit_cost,
                  markup_percent: patch.markup_percent ?? prev.markup_percent,
                  taxable: patch.taxable ?? prev.taxable,
                  notes: patch.notes ?? prev.notes,
                }));
              }}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => setBudgetCatalogManageOpen(true)}>
              Manage price list
            </Button>
          </div>
          <div className="space-y-3 pt-2">
            <div>
              <Label>Description</Label>
              <Input
                value={estimateLineForm.description}
                onChange={(e) => setEstimateLineForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="e.g., Roofing underlayment"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>Qty</Label>
                <Input
                  type="number"
                  value={estimateLineForm.quantity}
                  onChange={(e) => setEstimateLineForm((p) => ({ ...p, quantity: e.target.value }))}
                  step="0.01"
                  min="0"
                />
              </div>
              <div>
                <Label>Unit $</Label>
                <Input
                  type="number"
                  value={estimateLineForm.unit_cost}
                  onChange={(e) => setEstimateLineForm((p) => ({ ...p, unit_cost: e.target.value }))}
                  step="0.01"
                  min="0"
                />
              </div>
              <div>
                <Label>Markup %</Label>
                <Input
                  type="number"
                  value={estimateLineForm.markup_percent}
                  onChange={(e) => setEstimateLineForm((p) => ({ ...p, markup_percent: e.target.value }))}
                  step="0.1"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="est-line-tax"
                checked={estimateLineForm.taxable}
                onCheckedChange={(c) => setEstimateLineForm((p) => ({ ...p, taxable: !!c }))}
              />
              <Label htmlFor="est-line-tax" className="cursor-pointer text-sm">
                Taxable (7% when not tax exempt)
              </Label>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={estimateLineForm.notes}
                onChange={(e) => setEstimateLineForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEstimateLineDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void saveEstimateLineFromDialog()} disabled={savingEstimateLine}>
                {savingEstimateLine ? 'Saving…' : editingEstimateLine ? 'Save' : 'Add'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Subcontractor Upload Dialog */}
      {showSubUploadDialog && (
        <SubcontractorEstimatesManagement
          jobId={job.id}
          quoteId={quote?.id ?? undefined}
          onClose={() => {
            setShowSubUploadDialog(false);
            loadSubcontractorEstimates(quote?.id ?? null, !!isReadOnly);
          }}
        />
      )}

      {/* Export PDF Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {(quote as any)?.is_customer_estimate === true || estimateCatalogViewOpen
                ? 'Export estimate as PDF'
                : 'Export proposal as PDF'}
            </DialogTitle>
            <DialogDescription>
              {(quote as any)?.is_customer_estimate === true || estimateCatalogViewOpen
                ? estimateCatalogViewOpen
                  ? 'Exports price-list estimate lines only (rough pricing). For the full workbook, close the estimate view first.'
                  : 'Same sections and scope as a formal proposal. Wording and totals are labeled as a preliminary estimate (rough pricing), not a construction contract.'
                : 'Choose the version to export: customer proposal, office view, descriptions only, or a subcontractor bid specification PDF (no pricing).'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Export Version</Label>
              <Select
                value={exportViewType}
                onValueChange={(v) =>
                  setExportViewType(v as 'customer' | 'office' | 'descriptions_only' | 'bid_spec')
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">Customer Version</SelectItem>
                  <SelectItem value="office">Office View (Internal)</SelectItem>
                  <SelectItem value="descriptions_only">Descriptions only</SelectItem>
                  <SelectItem value="bid_spec">Bid spec (subcontractors)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {exportViewType !== 'bid_spec' && (
              <div>
                <Label className="mb-2 block">Style</Label>
                <Select value={exportTheme} onValueChange={(v) => setExportTheme(v as 'default' | 'premium')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default (black &amp; white)</SelectItem>
                    <SelectItem value="premium">Dark Green &amp; Gold</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Premium uses dark green and gold for a modern, polished look.</p>
              </div>
            )}

            {exportViewType === 'customer' && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="show-line-items"
                  checked={showLineItems}
                  onChange={(e) => setShowLineItems(e.target.checked)}
                  className="rounded"
                />
                <Label htmlFor="show-line-items">Show section prices</Label>
              </div>
            )}

            {exportViewType === 'bid_spec' && (
              <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/80 p-3">
                <div>
                  <Label htmlFor="bid-spec-due" className="text-xs font-medium">
                    Bid due (optional)
                  </Label>
                  <Input
                    id="bid-spec-due"
                    type="text"
                    placeholder="e.g. March 15, 2026 at 4:00 PM"
                    value={bidSpecDueDate}
                    onChange={(e) => setBidSpecDueDate(e.target.value)}
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <Label htmlFor="bid-spec-instructions" className="text-xs font-medium">
                    Instructions to bidders (optional)
                  </Label>
                  <Textarea
                    id="bid-spec-instructions"
                    placeholder="How to submit pricing, alternates, exclusions, walkthrough dates, etc."
                    value={bidSpecInstructions}
                    onChange={(e) => setBidSpecInstructions(e.target.value)}
                    rows={4}
                    className="mt-1 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="bid-spec-qty"
                    checked={bidSpecShowQuantities}
                    onChange={(e) => setBidSpecShowQuantities(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="bid-spec-qty">
                    Include line-item quantity tables (proposal line items — not workbook materials; no pricing)
                  </Label>
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
              {exportViewType === 'office' ? (
                <>
                  <p className="font-semibold text-blue-900 mb-1">Office View includes:</p>
                  <ul className="list-disc list-inside text-blue-800 space-y-0.5">
                    <li>All line items with individual unit prices and totals</li>
                    <li>Detailed breakdown for each section</li>
                    <li>No payment terms or signature sections</li>
                    <li>Internal use only - NOT for customer distribution</li>
                  </ul>
                </>
              ) : exportViewType === 'bid_spec' ? (
                <>
                  <p className="font-semibold text-blue-900 mb-1">Bid spec (subcontractors) includes:</p>
                  <ul className="list-disc list-inside text-blue-800 space-y-0.5">
                    <li>Job-first layout: project name, site address, customer, and phone (no contractor letterhead)</li>
                    <li>Reference # and date issued; optional bid-due and your instructions</li>
                    <li>Base scope and optional/alternate scope from this proposal (no prices)</li>
                    <li>Optional tables from proposal line items per section (not workbook material rows) — no pricing</li>
                    <li>No payment terms, acceptance block, or standard customer contract terms</li>
                  </ul>
                </>
              ) : exportViewType === 'descriptions_only' ? (
                <>
                  <p className="font-semibold text-blue-900 mb-1">Descriptions only includes:</p>
                  <ul className="list-disc list-inside text-blue-800 space-y-0.5">
                    <li>Section names and scope/description text only</li>
                    <li>No customer or job contact details, proposal number, or dates</li>
                    <li>No prices, totals, payment language, signatures, or terms</li>
                  </ul>
                </>
              ) : (
                <>
                  <p className="font-semibold text-blue-900 mb-1">Customer Version includes:</p>
                  <ul className="list-disc list-inside text-blue-800 space-y-0.5">
                    <li>Section descriptions without line item details</li>
                    <li>Optional section pricing</li>
                    <li>Payment terms and signature areas</li>
                    <li>Professional customer-facing format</li>
                  </ul>
                </>
              )}
            </div>
            
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowExportDialog(false)} disabled={exporting}>
                Cancel
              </Button>
              <Button onClick={handleExportPDF} disabled={exporting}>
                {exporting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Export{' '}
                    {exportViewType === 'office'
                      ? 'Office View'
                      : exportViewType === 'descriptions_only'
                        ? 'descriptions'
                        : exportViewType === 'bid_spec'
                          ? 'bid spec PDF'
                          : 'Customer PDF'}
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* In-app PDF viewer - proposal preview */}
      <Dialog open={showPdfView} onOpenChange={(open) => { if (!open) closePdfView(); }}>
        <DialogContent className="!max-w-[95vw] w-[95vw] !h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b bg-slate-50 shrink-0">
            <DialogTitle className="text-base font-semibold">Proposal Preview</DialogTitle>
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handlePrintProposal} disabled={!pdfViewHtml}>
                  <Printer className="w-4 h-4 mr-1" />Print
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={!pdfViewHtml} title="Opens print dialog — choose Save as PDF to download a file that looks exactly like the printout">
                  <Download className="w-4 h-4 mr-1" />Export PDF
                </Button>
                <Button variant="outline" size="sm" onClick={closePdfView}>
                  Close
                </Button>
              </div>
              <p className="text-xs text-muted-foreground hidden sm:block">PDF and print use the same layout. For Export PDF, choose &quot;Save as PDF&quot; in the dialog.</p>
            </div>
          </div>
          <div className="flex-1 min-h-[400px] relative bg-white overflow-hidden">
            {pdfPrintUrl ? (
              <iframe
                ref={pdfIframeRef}
                title="Proposal preview"
                src={pdfPrintUrl}
                className="absolute inset-0 w-full h-full border-0"
              />
            ) : pdfViewHtml ? (
              <iframe
                ref={pdfIframeRef}
                title="Proposal preview"
                srcDoc={pdfViewHtml}
                className="absolute inset-0 w-full h-full border-0"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-slate-500">Loading proposal...</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={copyCoDialogOpen}
        onOpenChange={(open) => {
          if (!open && copyCoRunning) return;
          setCopyCoDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send section as change order</DialogTitle>
            <DialogDescription>
              &quot;{copyCoSheetName}&quot; will be added to the change order workbook. Customers see it only under{' '}
              <strong>Change orders</strong> in the portal. Send the change order proposal from the office when you are
              ready.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 py-2">
            <Checkbox
              id="copy-co-remove"
              checked={copyCoRemoveFromProposal}
              onCheckedChange={(c) => setCopyCoRemoveFromProposal(!!c)}
              disabled={copyCoRunning}
            />
            <Label htmlFor="copy-co-remove" className="text-sm font-normal leading-snug cursor-pointer">
              Remove this section from the main proposal after copying (recommended so it is not double-counted)
            </Label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCopyCoDialogOpen(false)} disabled={copyCoRunning}>
              Cancel
            </Button>
            <Button
              className="bg-orange-600 hover:bg-orange-700"
              disabled={!copyCoSheetId || copyCoRunning}
              onClick={() => copyCoSheetId && runCopySheetToCustomerChangeOrder(copyCoSheetId, copyCoRemoveFromProposal)}
            >
              {copyCoRunning ? 'Working…' : 'Copy to change orders'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Link Subcontractor Dialog */}
      <Dialog open={showSubcontractorDialog} onOpenChange={setShowSubcontractorDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Subcontractor to Row</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Tabs value={subcontractorMode} onValueChange={(v) => setSubcontractorMode(v as 'select' | 'upload')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="select">Select Existing</TabsTrigger>
                <TabsTrigger value="upload">Upload New</TabsTrigger>
              </TabsList>
              
              <TabsContent value="select" className="space-y-4">
                <div>
                  <Label>Select Subcontractor</Label>
                  <Select value={selectedExistingSubcontractor} onValueChange={setSelectedExistingSubcontractor}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a subcontractor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {subcontractorEstimates.filter(s => !s.sheet_id && !s.row_id).map(sub => (
                        <SelectItem key={sub.id} value={sub.id}>
                          {sub.company_name} - ${(sub.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowSubcontractorDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={linkExistingSubcontractor}>
                    Link Subcontractor
                  </Button>
                </div>
              </TabsContent>
              
              <TabsContent value="upload">
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground mb-4">
                    Upload a new subcontractor estimate that will be automatically linked to this row.
                  </p>
                  <Button onClick={() => {
                    setShowSubcontractorDialog(false);
                    setShowSubUploadDialog(true);
                  }}>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Estimate
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create New Proposal Dialog */}
      <Dialog open={showCreateProposalDialog} onOpenChange={(open) => {
          if (open) setTemplateQuoteIdForNewProposal(quote?.id ?? null);
          if (!open) setProposalChangeNotes('');
          setShowCreateProposalDialog(open);
        }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Proposal</DialogTitle>
            <DialogDescription>
              Choose a proposal to use as a template. A new proposal will be created with its own materials and workbook; the template is not changed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Use as template</Label>
              <Select
                value={templateQuoteIdForNewProposal ?? '__blank__'}
                onValueChange={(v) => setTemplateQuoteIdForNewProposal(v === '__blank__' ? null : v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a proposal or start blank" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__blank__">Start from blank (empty proposal)</SelectItem>
                  {formalJobQuotes.map((q: any) => {
                    const isEst = !!q.is_customer_estimate;
                    return (
                      <SelectItem key={q.id} value={q.id}>
                        {isEst ? 'Estimate' : 'Proposal'} #{displayNumberForQuoteRow(q, isEst)}
                        {q.id === quote?.id ? ' (current)' : ''}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                The new proposal will be fully editable. The selected template is copied only; it is not locked or modified.
              </p>
            </div>
            <div className="bg-blue-50 border border-blue-300 rounded-lg p-3 text-sm">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-blue-900 mb-1">What happens:</p>
                  <ul className="text-blue-800 space-y-1 list-disc list-inside">
                    <li>A new proposal is created with an incremented number</li>
                    <li>If you chose a template, all materials, rows, and subcontractors are copied to the new proposal</li>
                    <li>The new proposal has its own independent workbook; edits do not affect the template or any other proposal</li>
                    <li>You will be switched to the new proposal to edit it</li>
                  </ul>
                </div>
              </div>
            </div>
            <div>
              <Label>Notes (Optional)</Label>
              <Textarea
                value={proposalChangeNotes}
                onChange={(e) => setProposalChangeNotes(e.target.value)}
                placeholder="e.g., Updated pricing per customer request, Added garage door options, Changed roof color..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Document what changed in this new proposal version
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCreateProposalDialog(false);
                    setProposalChangeNotes('');
                    setTemplateQuoteIdForNewProposal(quote?.id ?? null);
                  }}
                  disabled={creatingProposal}
                >
                  Cancel
                </Button>
                <Button onClick={createNewProposal} disabled={creatingProposal}>
                {creatingProposal ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Create New Proposal
                  </>
                )}
              </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Compare two proposals */}
      <Dialog open={showProposalComparison} onOpenChange={setShowProposalComparison}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <ProposalComparisonView
            job={job}
            quotes={formalJobQuotes.map((q: any) => ({
              id: q.id,
              proposal_number: q.proposal_number,
              quote_number: q.quote_number,
              estimate_number: q.estimate_number,
              is_customer_estimate: q.is_customer_estimate,
              is_change_order_proposal: q.is_change_order_proposal,
              created_at: q.created_at,
            }))}
            onClose={() => setShowProposalComparison(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete proposal — 2-step: trash opens this dialog; user must confirm */}
      <Dialog open={showDeleteProposalConfirm} onOpenChange={(open) => { if (!open) { setShowDeleteProposalConfirm(false); setDeleteProposalQuoteId(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Delete proposal?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete this proposal and its materials workbook. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowDeleteProposalConfirm(false); setDeleteProposalQuoteId(null); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (deleteProposalQuoteId) {
                  await deleteProposal(deleteProposalQuoteId, { skipWindowConfirm: true });
                  setShowDeleteProposalConfirm(false);
                  setDeleteProposalQuoteId(null);
                }
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showRenumberProposalsDialog}
        onOpenChange={(open) => {
          if (!open && !renumberingProposals) setShowRenumberProposalsDialog(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Renumber proposals?</DialogTitle>
            <DialogDescription>
              This only updates <span className="font-mono text-foreground">proposal_number</span> and{' '}
              <span className="font-mono text-foreground">quote_number</span>. Workbooks, materials, and financial rows
              stay on the same quote IDs.{' '}
              <strong>{formalProposalsForRenumber.length}</strong> formal proposal(s) on this job (change orders excluded)
              are renumbered newest-first: the newest becomes{' '}
              <strong className="font-mono text-foreground">
                {parseProposalNumberBase(quote) ?? '?'}-1
              </strong>
              , then <span className="font-mono">{parseProposalNumberBase(quote) ?? '?'}-2</span>, and so on.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 border rounded-md p-3 bg-muted/30">
            <p className="text-xs font-medium text-foreground">Remove proposals (newest first)</p>
            <p className="text-xs text-muted-foreground">
              You must keep at least one formal proposal. Deletes use the same permanent delete as the toolbar trash icon.
            </p>
            <ul className="max-h-44 overflow-y-auto space-y-1 text-sm">
              {[...formalProposalsForRenumber]
                .sort(
                  (a: any, b: any) =>
                    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
                )
                .map((qrow: any) => {
                  const num = displayNumberForQuoteRow(qrow, false);
                  const cannotDeleteFormal = formalJobQuotes.length <= 1;
                  return (
                    <li
                      key={qrow.id}
                      className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1.5"
                    >
                      <span className="font-mono truncate">{num}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 border-red-200 text-red-700 hover:bg-red-50"
                        disabled={renumberingProposals || cannotDeleteFormal}
                        title={
                          cannotDeleteFormal
                            ? 'Cannot delete the only formal proposal'
                            : 'Delete this proposal permanently'
                        }
                        onClick={() => {
                          setDeleteProposalQuoteId(qrow.id);
                          setShowRenumberProposalsDialog(false);
                          setShowDeleteProposalConfirm(true);
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </li>
                  );
                })}
            </ul>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowRenumberProposalsDialog(false)} disabled={renumberingProposals}>
              Cancel
            </Button>
            <Button onClick={() => void confirmRenumberProposalsNewestIsOne()} disabled={renumberingProposals}>
              {renumberingProposals ? 'Saving…' : 'Renumber'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Proposal Version History Dialog */}
      <Dialog open={showVersionHistory} onOpenChange={setShowVersionHistory}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Proposal Version History
            </DialogTitle>
            <DialogDescription>
              View all versions of this proposal. Signed versions are locked and cannot be modified.
            </DialogDescription>
          </DialogHeader>

          {loadingVersions ? (
            <div className="py-12 text-center">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading version history...</p>
            </div>
          ) : proposalVersions.length === 0 ? (
            <div className="py-12 text-center">
              <History className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-lg font-medium text-muted-foreground">No versions found</p>
              <p className="text-sm text-muted-foreground mt-2">
                Versions are automatically created when proposals are modified
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {proposalVersions.map((version) => (
                <Card key={version.id} className={version.is_signed ? 'border-emerald-300 bg-emerald-50' : ''}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">Version {version.version_number}</CardTitle>
                          {version.is_signed && (
                            <Badge className="bg-emerald-600">
                              <Lock className="w-3 h-3 mr-1" />
                              Signed
                            </Badge>
                          )}
                          {version.version_number === quote?.current_version && !version.is_signed && (
                            <Badge variant="outline" className="bg-blue-100 text-blue-700">
                              Current
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          <span>
                            {new Date(version.created_at).toLocaleDateString('en-US', {
                              month: 'long',
                              day: 'numeric',
                              year: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        {version.is_signed && version.signed_at && (
                          <div className="flex items-center gap-2 mt-1 text-sm text-emerald-700 font-medium">
                            <Lock className="w-3 h-3" />
                            <span>
                              Signed on {new Date(version.signed_at).toLocaleDateString('en-US', {
                                month: 'long',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {!version.is_signed && version.version_number === quote?.current_version && (
                          <Button
                            size="sm"
                            onClick={() => signAndLockVersion(version.id)}
                            className="bg-emerald-600 hover:bg-emerald-700"
                          >
                            <Lock className="w-3 h-3 mr-2" />
                            Sign & Lock
                          </Button>
                        )}
                        <Button size="sm" variant="outline">
                          <Eye className="w-3 h-3 mr-2" />
                          View Details
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">Customer</Label>
                        <p className="font-medium">{version.customer_name || 'N/A'}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Project</Label>
                        <p className="font-medium">{version.project_name || 'N/A'}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Size</Label>
                        <p className="font-medium">
                          {version.width}' × {version.length}'
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Estimated Price</Label>
                        <p className="font-medium text-green-700">
                          {version.estimated_price ? `$${version.estimated_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A'}
                        </p>
                      </div>
                    </div>
                    {version.change_notes && (
                      <div className="pt-3 border-t">
                        <Label className="text-xs text-muted-foreground">Notes</Label>
                        <p className="text-sm mt-1">{version.change_notes}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Floating Document Viewer — only when not using the materials-panel document view */}
      {!documentPanel && (
        <FloatingDocumentViewer
          jobId={job.id}
          open={showDocumentViewer}
          onClose={() => setShowDocumentViewer(false)}
        />
      )}

      {/* Template Editor */}
      <ProposalTemplateEditor
        open={showTemplateEditor}
        onClose={() => setShowTemplateEditor(false)}
      />

      {/* Building Description Dialog */}
      <Dialog open={editingDescription} onOpenChange={setEditingDescription}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Building Description</DialogTitle>
            <DialogDescription>
              Add a brief description of the building that will appear at the top of the proposal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Description</Label>
              <Textarea
                value={buildingDescription}
                onChange={(e) => setBuildingDescription(e.target.value)}
                placeholder="Enter building description...\n\nExample: 72' x 116' pole building with 20' sidewalls, 5:12 roof pitch, and 16' wide x 14' tall overhead doors."
                rows={6}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-2">
                This description will appear at the top of the proposal, inside the "Work to be Completed" section.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditingDescription(false);
                  setBuildingDescription((quote as any)?.description || '');
                }}
              >
                Cancel
              </Button>
              <Button onClick={saveBuildingDescription}>
                Save Description
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
