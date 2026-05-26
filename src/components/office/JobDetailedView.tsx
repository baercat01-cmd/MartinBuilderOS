import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { readPersistedOpenJobId, readPersistedOpenJobTab, persistOpenJobTab } from '@/lib/officeViewPersistence';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, Users, Calendar, ChevronDown, ChevronRight, TrendingUp, Target, Camera, FileText, AlertCircle, Package, Activity, Briefcase, Building2, MapPin, FileCheck, ArrowLeft, Edit, DollarSign, FileSpreadsheet, Mail, Printer, LayoutGrid, ShoppingCart, Key, StickyNote } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { MaterialsManagement } from './MaterialsManagement';
import { JobComponents } from './JobComponents';
import { JobSchedule } from './JobSchedule';
import { JobDocuments } from './JobDocuments';
import { JobPhotosView } from './JobPhotosView';
import { ProposalAndMaterialsView } from './ProposalAndMaterialsView';
import { CustomerPortalManagement } from './CustomerPortalManagement';
import { SubcontractorPortalJobPanel } from './SubcontractorPortalJobPanel';
import { SubcontractorEstimatesManagement } from './SubcontractorEstimatesManagement';
import { JobCommunications } from './JobCommunications';
import { JobZohoOrders } from './JobZohoOrders';
import { OfficeCrewOrders } from './OfficeCrewOrders';

import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { format } from 'date-fns';

import { useAuth } from '@/hooks/useAuth';
import { isQuoteContractFrozen } from '@/lib/quoteProposalLock';
import { fetchJobQuotesForJob } from '@/lib/quotesSchemaFallback';
import { loadProposalFinancialData } from '@/lib/loadProposalFinancialData';
import { computeProposalCostBudget } from '@/lib/proposalCostBudget';
import type { Job } from '@/types';
import { JobDetailProposalToolbarContext } from '@/contexts/JobDetailProposalToolbarContext';
import { JobDetailMaterialsToolbarSlotContext } from '@/contexts/JobDetailMaterialsToolbarContext';
import { ProposalSummaryProvider } from '@/contexts/ProposalSummaryContext';
import { JobProposalBudgetBreakdownPanel } from '@/components/office/JobProposalBudgetBreakdownPanel';

interface JobDetailedViewProps {
  job: Job;
  /** Job id to use for customer portal link creation. When set (from JobsView detail dialog), this is the single source of truth so the link is always for the job the user opened. */
  portalJobId?: string | null;
  /** Called at click time when creating a portal link; returns the current dialog job id so the link is never created for a stale job. */
  getPortalJobId?: () => string | null;
  onBack?: () => void;
  onEdit?: () => void;
  /** Refetch job from DB after nested edits (e.g. components, documents) so `job` prop stays in sync. */
  onJobUpdate?: () => void;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
}

interface ComponentWorkEntry {
  id: string;
  component_id: string;
  component_name: string;
  start_time: string;
  end_time: string;
  total_hours: number;
  crew_count: number;
  is_manual: boolean;
  notes: string | null;
  worker_names: string[] | null;
  user_name: string;
  photos: Array<{
    id: string;
    photo_url: string;
    caption: string | null;
  }>;
}

interface ComponentSummary {
  component_id: string;
  component_name: string;
  total_duration: number;
  total_man_hours: number;
  entry_count: number;
  entries: ComponentWorkEntry[];
}

interface DateGroup {
  date: string;
  total_man_hours: number;
  components: ComponentSummary[];
}

interface ComponentGroup {
  component_id: string | null;
  component_name: string;
  total_duration: number;
  total_man_hours: number;
  entry_count: number;
  dates: DateSummary[];
}

interface DateSummary {
  date: string;
  total_duration: number;
  total_man_hours: number;
  entries: ComponentWorkEntry[];
}

interface PersonGroup {
  user_name: string;
  total_duration: number;
  total_man_hours: number;
  entry_count: number;
  dates: DateSummary[];
  component_hours: number;
  clock_in_hours: number;
}

interface MaterialsPricingBreakdownProps {
  jobId: string;
}

function MaterialsPricingBreakdown({ jobId }: MaterialsPricingBreakdownProps) {
  const [loading, setLoading] = useState(true);
  const [sheetBreakdowns, setSheetBreakdowns] = useState<any[]>([]);
  const [totals, setTotals] = useState({ totalCost: 0, totalPrice: 0, totalProfit: 0, profitMargin: 0 });

  useEffect(() => {
    loadMaterialsBreakdown();
  }, [jobId]);

  async function loadMaterialsBreakdown() {
    try {
      setLoading(true);

      // Get the working workbook for this job
      const { data: workbookData, error: workbookError } = await supabase
        .from('material_workbooks')
        .select('id')
        .eq('job_id', jobId)
        .eq('status', 'working')
        .maybeSingle();

      if (workbookError) throw workbookError;
      if (!workbookData) {
        setLoading(false);
        return;
      }

      // Get all sheets for this workbook
      const { data: sheetsData, error: sheetsError } = await supabase
        .from('material_sheets')
        .select('*')
        .eq('workbook_id', workbookData.id)
        .order('order_index');

      if (sheetsError) throw sheetsError;

      const sheetIds = (sheetsData || []).map(s => s.id);

      // Get all items for these sheets
      const { data: itemsData, error: itemsError } = await supabase
        .from('material_items')
        .select('*')
        .in('sheet_id', sheetIds);

      if (itemsError) throw itemsError;

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

        // Calculate totals per category
        const categories = Array.from(categoryMap.entries()).map(([categoryName, items]) => {
          const totalCost = items.reduce((sum, item) => {
            const cost = (item.cost_per_unit || 0) * (item.quantity || 0);
            return sum + cost;
          }, 0);

          const totalPrice = items.reduce((sum, item) => {
            const price = (item.price_per_unit || 0) * (item.quantity || 0);
            return sum + price;
          }, 0);

          const profit = totalPrice - totalCost;
          const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;

          return {
            name: categoryName,
            itemCount: items.length,
            totalCost,
            totalPrice,
            profit,
            margin,
          };
        }).sort((a, b) => a.name.localeCompare(b.name));

        // Calculate sheet totals
        const sheetTotalCost = categories.reduce((sum, cat) => sum + cat.totalCost, 0);
        const sheetTotalPrice = categories.reduce((sum, cat) => sum + cat.totalPrice, 0);
        const sheetProfit = sheetTotalPrice - sheetTotalCost;
        const sheetMargin = sheetTotalPrice > 0 ? (sheetProfit / sheetTotalPrice) * 100 : 0;

        return {
          sheetName: sheet.sheet_name,
          categories,
          totalCost: sheetTotalCost,
          totalPrice: sheetTotalPrice,
          profit: sheetProfit,
          margin: sheetMargin,
        };
      });

      setSheetBreakdowns(breakdowns);

      // Calculate grand totals
      const grandTotalCost = breakdowns.reduce((sum, sheet) => sum + sheet.totalCost, 0);
      const grandTotalPrice = breakdowns.reduce((sum, sheet) => sum + sheet.totalPrice, 0);
      const grandProfit = grandTotalPrice - grandTotalCost;
      const grandMargin = grandTotalPrice > 0 ? (grandProfit / grandTotalPrice) * 100 : 0;

      setTotals({
        totalCost: grandTotalCost,
        totalPrice: grandTotalPrice,
        totalProfit: grandProfit,
        profitMargin: grandMargin,
      });

    } catch (error: any) {
      console.error('Error loading materials breakdown:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading materials pricing...</p>
        </CardContent>
      </Card>
    );
  }

  if (sheetBreakdowns.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Materials Pricing Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-8 text-muted-foreground">
          No materials data available for this job
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2">
      <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b-2">
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-700" />
          Materials Pricing Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        {/* Grand Totals */}
        <div className="grid grid-cols-4 gap-4 p-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-lg">
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide mb-1">Total Cost</p>
            <p className="text-2xl font-bold">${totals.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide mb-1">Total Price</p>
            <p className="text-2xl font-bold">${totals.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide mb-1">Total Profit</p>
            <p className="text-2xl font-bold text-yellow-400">${totals.totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide mb-1">Profit Margin</p>
            <p className="text-2xl font-bold text-green-400">{totals.profitMargin.toFixed(1)}%</p>
          </div>
        </div>

        {/* Breakdown by Sheet */}
        {sheetBreakdowns.map((sheet, sheetIndex) => (
          <Collapsible key={sheetIndex} defaultOpen={sheetIndex === 0}>
            <div className="border-2 border-slate-200 rounded-lg overflow-hidden">
              <CollapsibleTrigger className="w-full">
                <div className="bg-gradient-to-r from-blue-100 to-blue-50 p-4 flex items-center justify-between hover:from-blue-200 hover:to-blue-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="w-5 h-5 text-blue-700" />
                    <h3 className="font-bold text-lg text-blue-900">{sheet.sheetName}</h3>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-xs text-blue-700">Cost</p>
                      <p className="font-bold text-blue-900">${sheet.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-blue-700">Price</p>
                      <p className="font-bold text-blue-900">${sheet.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-blue-700">Profit</p>
                      <p className="font-bold text-green-700">${sheet.profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-blue-700">Margin</p>
                      <p className="font-bold text-green-700">{sheet.margin.toFixed(1)}%</p>
                    </div>
                    <ChevronDown className="w-5 h-5 text-blue-700" />
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="p-4 bg-white">
                  <div className="space-y-3">
                    {sheet.categories.map((category: any, catIndex: number) => (
                      <div key={catIndex} className="border border-slate-200 rounded-lg overflow-hidden">
                        <div className="bg-slate-50 p-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            <h4 className="font-semibold text-slate-900">{category.name}</h4>
                            <Badge variant="outline" className="text-xs">{category.itemCount} items</Badge>
                          </div>
                          <div className="flex items-center gap-6 text-sm">
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">Cost</p>
                              <p className="font-semibold">${category.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">Price</p>
                              <p className="font-semibold">${category.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">Profit</p>
                              <p className="font-semibold text-green-700">${category.profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                            <div className="text-right min-w-[60px]">
                              <p className="text-xs text-muted-foreground">Margin</p>
                              <p className={`font-bold ${
                                category.margin >= 25 ? 'text-green-600' :
                                category.margin >= 15 ? 'text-yellow-600' :
                                'text-red-600'
                              }`}>
                                {category.margin.toFixed(1)}%
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </CardContent>
    </Card>
  );
}

interface DailyLog {
  id: string;
  log_date: string;
  weather: string | null;
  weather_details: any;
  crew_count: number | null;
  components_worked: any[];
  time_summary: any[];
  issues: any[];
  material_requests_structured: any[];
  client_summary: string | null;
  final_notes: string | null;
  user_name: string;
  created_at: string;
}

const PROPOSAL_MATERIALS_VIEW_MODE_KEY = 'jobDetailed.proposalMaterialsViewMode';

type ProposalMaterialsLayoutMode = 'split' | 'proposal' | 'materials';

function readStoredProposalMaterialsViewMode(): ProposalMaterialsLayoutMode {
  if (typeof window === 'undefined') return 'split';
  try {
    const v = window.localStorage.getItem(PROPOSAL_MATERIALS_VIEW_MODE_KEY);
    if (v === 'split' || v === 'proposal' || v === 'materials') return v;
  } catch {
    /* ignore */
  }
  return 'split';
}

export function JobDetailedView({ job, portalJobId, getPortalJobId, onBack, onEdit, onJobUpdate, initialTab = 'overview', onTabChange }: JobDetailedViewProps) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [proposalNumber, setProposalNumber] = useState<string | null>(null);
  const [dateGroups, setDateGroups] = useState<DateGroup[]>([]);
  const [componentGroups, setComponentGroups] = useState<ComponentGroup[]>([]);
  const [personGroups, setPersonGroups] = useState<PersonGroup[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [totalDuration, setTotalDuration] = useState(0);
  const [totalManHours, setTotalManHours] = useState(0);
  const [totalClockInHours, setTotalClockInHours] = useState(0);
  const [totalComponentHours, setTotalComponentHours] = useState(0);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(new Set());
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'date' | 'component' | 'person'>('date');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [photoCount, setPhotoCount] = useState(0);
  const [materialCount, setMaterialCount] = useState(0);
  const [issueCount, setIssueCount] = useState(0);
  const [crewMembers, setCrewMembers] = useState<string[]>([]);
  const [firstWorkDate, setFirstWorkDate] = useState<string | null>(null);
  const [lastWorkDate, setLastWorkDate] = useState<string | null>(null);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [crewOrdersCount, setCrewOrdersCount] = useState(0);
  const [emailStats, setEmailStats] = useState({ total: 0, customer: 0, vendor: 0, subcontractor: 0, unread: 0 });
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeTab, setActiveTab] = useState(() => {
    const persistedTab = readPersistedOpenJobId() === job.id ? readPersistedOpenJobTab() : null;
    const tab = persistedTab || initialTab;
    return tab === 'financials' || tab === 'materials' ? 'proposal-materials' : tab;
  });

  function handleActiveTabChange(tab: string) {
    setActiveTab(tab);
    persistOpenJobTab(tab);
    onTabChange?.(tab);
  }
  const [proposalToolbarContent, setProposalToolbarContent] = useState<React.ReactNode>(null);
  type ProposalViewMode = ProposalMaterialsLayoutMode;
  const [proposalViewMode, setProposalViewMode] = useState<ProposalViewMode>(() => readStoredProposalMaterialsViewMode());
  /** Shared proposal selection so Subcontractors tab and Proposal & Materials show the same proposal. */
  const [selectedProposalQuoteId, setSelectedProposalQuoteId] = useState<string | null>(null);
  /** False until the default quote for this job has been resolved (avoids flashing "no proposal" before quotes load). */
  const [proposalQuoteSelectionReady, setProposalQuoteSelectionReady] = useState(false);
  /** Stored proposal totals for the selected quote (same source as JobFinancials / customer portal RPC). */
  const [proposalBudget, setProposalBudget] = useState<{
    proposalLabel: string;
    subtotal: number;
    tax: number;
    grandTotal: number;
  } | null>(null);
  const [proposalBudgetLoading, setProposalBudgetLoading] = useState(false);
  /** Internal cost rollup for black header bar (same rules as Cost budget office page). */
  const [headerProposalCostTotal, setHeaderProposalCostTotal] = useState<number | null>(null);
  const [headerProposalCostLoading, setHeaderProposalCostLoading] = useState(false);
  const materialsToolbarSlotRef = useRef<HTMLDivElement>(null);
  const [materialsToolbarSlotReady, setMaterialsToolbarSlotReady] = useState(false);
  const [proposalPageNotesOpen, setProposalPageNotesOpen] = useState(false);
  const [proposalNotesDraft, setProposalNotesDraft] = useState('');
  const [savingProposalNotes, setSavingProposalNotes] = useState(false);
  /** `__clock_in__` or stringified component id — opens worker breakdown dialog on Overview */
  const [overviewComponentBreakdownKey, setOverviewComponentBreakdownKey] = useState<string | null>(null);

  async function saveProposalPageNotes() {
    if (profile?.role !== 'office') {
      toast.error('Only office staff can edit job notes');
      return;
    }
    setSavingProposalNotes(true);
    try {
      const { error } = await supabase
        .from('jobs')
        .update({
          notes: proposalNotesDraft.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      if (error) throw error;
      toast.success('Notes saved');
      onJobUpdate?.();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to save notes';
      toast.error(message);
    } finally {
      setSavingProposalNotes(false);
    }
  }

  function toggleDate(date: string) {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  }

  function toggleComponent(componentKey: string) {
    setExpandedComponents(prev => {
      const next = new Set(prev);
      if (next.has(componentKey)) {
        next.delete(componentKey);
      } else {
        next.add(componentKey);
      }
      return next;
    });
  }

  function toggleLog(logId: string) {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  }

  function expandAllComponents() {
    const allDates = new Set(dateGroups.map(g => g.date));
    const allComponents = new Set<string>();
    dateGroups.forEach(dateGroup => {
      dateGroup.components.forEach(comp => {
        allComponents.add(`${dateGroup.date}-${comp.component_id}`);
      });
    });
    setExpandedDates(allDates);
    setExpandedComponents(allComponents);
  }

  function collapseAllComponents() {
    setExpandedDates(new Set());
    setExpandedComponents(new Set());
  }

  function expandAllLogs() {
    setExpandedLogs(new Set(dailyLogs.map(l => l.id)));
  }

  function collapseAllLogs() {
    setExpandedLogs(new Set());
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(PROPOSAL_MATERIALS_VIEW_MODE_KEY, proposalViewMode);
    } catch {
      /* ignore */
    }
  }, [proposalViewMode]);

  // Keep shared proposal selection in sync with job quotes (same order as Proposal & Materials: highest proposal number first)
  useEffect(() => {
    if (!job?.id) {
      setSelectedProposalQuoteId(null);
      setProposalQuoteSelectionReady(true);
      setProposalBudget(null);
      setHeaderProposalCostTotal(null);
      return;
    }
    let mounted = true;
    setProposalQuoteSelectionReady(false);
    setProposalBudget(null);
    setHeaderProposalCostTotal(null);
    (async () => {
      try {
        const { data: quotes, error } = await fetchJobQuotesForJob(supabase, job.id);
        if (!mounted) return;
        if (error || !quotes?.length) {
          setSelectedProposalQuoteId(null);
          return;
        }
        const mainQuotes = (quotes || []).filter((q: any) => !q.is_change_order_proposal);
        const frozenMain = mainQuotes.filter((q: any) => isQuoteContractFrozen(q));

        // If this job has a contract-frozen main quote, default selection to it.
        // This prevents Materials from loading "No Material Workbook" when the locked workbook exists only for the contract quote.
        if (frozenMain.length > 0) {
          setSelectedProposalQuoteId((prev) => {
            if (prev && frozenMain.some((q: any) => q.id === prev)) return prev;
            return frozenMain[0]?.id ?? null; // quotes already sorted by created_at desc
          });
          return;
        }

        const sorted = [...quotes].sort((a: any, b: any) => {
          const na = (a.proposal_number || a.quote_number || '').toString();
          const nb = (b.proposal_number || b.quote_number || '').toString();
          return nb.localeCompare(na, undefined, { numeric: true });
        });
        setSelectedProposalQuoteId((prev) => {
          if (prev && sorted.some((q: any) => q.id === prev)) return prev;
          return sorted[0]?.id ?? null;
        });
      } finally {
        if (mounted) setProposalQuoteSelectionReady(true);
      }
    })();
    return () => { mounted = false; };
  }, [job?.id]);

  // Load proposal budget totals from stored quote fields (written by JobFinancials)
  useEffect(() => {
    if (!proposalQuoteSelectionReady) return;
    let cancelled = false;
    if (!selectedProposalQuoteId) {
      setProposalBudget(null);
      setProposalBudgetLoading(false);
      return;
    }
    setProposalBudgetLoading(true);
    (async () => {
      const [totalsRes, quoteRes] = await Promise.all([
        supabase.rpc('get_quote_proposal_totals', { p_quote_id: selectedProposalQuoteId }),
        supabase
          .from('quotes')
          .select('proposal_number, quote_number')
          .eq('id', selectedProposalQuoteId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const label =
        (quoteRes.data?.proposal_number ?? quoteRes.data?.quote_number)?.toString() || '—';
      if (totalsRes.error || !totalsRes.data?.length) {
        setProposalBudget(null);
      } else {
        const row = totalsRes.data[0] as { subtotal?: number | null; tax?: number | null; grand_total?: number | null };
        const sub = row.subtotal != null ? Number(row.subtotal) : NaN;
        const tax = row.tax != null ? Number(row.tax) : 0;
        const grand = row.grand_total != null ? Number(row.grand_total) : NaN;
        if (Number.isFinite(sub) && Number.isFinite(grand)) {
          setProposalBudget({
            proposalLabel: label,
            subtotal: sub,
            tax: Number.isFinite(tax) ? tax : 0,
            grandTotal: grand,
          });
        } else {
          setProposalBudget(null);
        }
      }
      setProposalBudgetLoading(false);
    })();
    return () => { cancelled = true; };
  }, [proposalQuoteSelectionReady, selectedProposalQuoteId]);

  // Header bar: internal cost total from workbook + financial rows (no sell markup)
  useEffect(() => {
    if (!proposalQuoteSelectionReady || !selectedProposalQuoteId || !job?.id) {
      setHeaderProposalCostTotal(null);
      setHeaderProposalCostLoading(false);
      return;
    }
    let cancelled = false;
    setHeaderProposalCostLoading(true);
    (async () => {
      try {
        const payload = await loadProposalFinancialData(job.id, selectedProposalQuoteId);
        if (cancelled) return;
        if (!payload) {
          setHeaderProposalCostTotal(null);
          return;
        }
        const costs = computeProposalCostBudget({
          materialSheets: payload.materialSheets,
          customRows: payload.customRows,
          subcontractorEstimates: payload.subcontractorEstimates,
          customRowLineItems: payload.customRowLineItems,
          subcontractorLineItems: payload.subcontractorLineItems,
        });
        setHeaderProposalCostTotal(costs.totalCost);
      } catch {
        if (!cancelled) setHeaderProposalCostTotal(null);
      } finally {
        if (!cancelled) setHeaderProposalCostLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [proposalQuoteSelectionReady, selectedProposalQuoteId, job?.id]);

  useEffect(() => {
    loadData();
    loadNotifications();
    loadProposalNumber();
    
    // Subscribe to new notifications
    const notificationsChannel = supabase
      .channel(`job_notifications_${job.id}`)
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'notifications',
          filter: `job_id=eq.${job.id}`
        }, 
        () => {
          loadNotifications();
        }
      )
      .subscribe();

    // Subscribe to crew orders (material changes).
    // Debounce so rapid item saves don't fire 5 stats queries back-to-back.
    let statsDebounce: ReturnType<typeof setTimeout> | null = null;
    const materialsChannel = supabase
      .channel(`job_materials_changes_${job.id}`)
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'materials',
          filter: `job_id=eq.${job.id}`
        },
        () => {
          if (statsDebounce) clearTimeout(statsDebounce);
          statsDebounce = setTimeout(() => loadJobStats(), 2000);
        }
      )
      .subscribe();

    return () => {
      if (statsDebounce) clearTimeout(statsDebounce);
      supabase.removeChannel(notificationsChannel);
      supabase.removeChannel(materialsChannel);
    };
  }, [job.id]);

  const overviewComponentTimeRows = useMemo(() => {
    return componentGroups
      .filter((g) => g.component_id != null)
      .map((g) => ({
        key: String(g.component_id),
        name: g.component_name,
        manHours: g.total_man_hours,
        wallHours: g.total_duration,
        entries: g.entry_count,
      }));
  }, [componentGroups]);

  const overviewComponentBreakdown = useMemo(() => {
    if (!overviewComponentBreakdownKey) return null;
    const group =
      overviewComponentBreakdownKey === '__clock_in__'
        ? componentGroups.find((g) => g.component_id == null) ?? null
        : componentGroups.find(
            (g) => g.component_id != null && String(g.component_id) === overviewComponentBreakdownKey
          ) ?? null;
    if (!group) return null;

    const byUser = new Map<string, { manHours: number; wallHours: number; entryCount: number }>();
    const allEntries: ComponentWorkEntry[] = [];
    for (const d of group.dates) {
      for (const e of d.entries) {
        allEntries.push(e);
        const uname = e.user_name;
        const mh = (e.total_hours || 0) * (e.crew_count || 1);
        const wh = e.total_hours || 0;
        if (!byUser.has(uname)) {
          byUser.set(uname, { manHours: 0, wallHours: 0, entryCount: 0 });
        }
        const u = byUser.get(uname)!;
        u.manHours += mh;
        u.wallHours += wh;
        u.entryCount += 1;
      }
    }
    allEntries.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
    const workers = Array.from(byUser.entries())
      .map(([userName, v]) => ({ userName, ...v }))
      .sort((a, b) => b.manHours - a.manHours);

    return {
      title: group.component_id == null ? 'Clock-in / not on a component' : group.component_name,
      workers,
      allEntries,
    };
  }, [overviewComponentBreakdownKey, componentGroups]);

  async function loadData() {
    setLoading(true);
    const timeout = window.setTimeout(() => {
      setLoading(false);
    }, 10000);
    try {
      await Promise.all([
        loadComponentWork(),
        loadDailyLogs(),
        loadJobStats(),
        loadRecentActivity(),
      ]);
    } catch (error) {
      console.error('Error loading job details:', error);
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function loadProposalNumber() {
    try {
      // Get the quote/proposal for this job
      const { data, error } = await supabase
        .from('quotes')
        .select('proposal_number, quote_number')
        .eq('job_id', job.id)
        .maybeSingle();

      if (!error && data) {
        setProposalNumber(data.proposal_number || data.quote_number);
      }
    } catch (error) {
      console.error('Error loading proposal number:', error);
    }
  }

  async function loadJobStats() {
    try {
      // Load photos count
      const { data: photosData } = await supabase
        .from('photos')
        .select('id')
        .eq('job_id', job.id);
      setPhotoCount(photosData?.length || 0);

      // Load materials count
      const { data: materialsData } = await supabase
        .from('materials')
        .select('id')
        .eq('job_id', job.id);
      setMaterialCount(materialsData?.length || 0);

      // Load crew orders count — pending field requests from material_items (new system)
      {
        const { data: wbs } = await supabase
          .from('material_workbooks')
          .select('id')
          .eq('job_id', job.id)
          .eq('status', 'working');
        const wbIds = (wbs || []).map((w: any) => w.id);
        if (wbIds.length) {
          const { data: shts } = await supabase
            .from('material_sheets')
            .select('id')
            .in('workbook_id', wbIds);
          const sheetIds = (shts || []).map((s: any) => s.id);
          if (sheetIds.length) {
            const { data: pending } = await supabase
              .from('material_items')
              .select('id')
              .in('sheet_id', sheetIds)
              .not('requested_by', 'is', null)
              .eq('status', 'not_ordered');
            setCrewOrdersCount(pending?.length || 0);
          }
        }
      }

      // Load issues from daily logs
      const { data: logsData } = await supabase
        .from('daily_logs')
        .select('issues')
        .eq('job_id', job.id);
      const totalIssues = (logsData || []).reduce((sum, log) => {
        return sum + (Array.isArray(log.issues) ? log.issues.length : 0);
      }, 0);
      setIssueCount(totalIssues);

      // Load email stats
      const { data: emailsData } = await supabase
        .from('job_emails')
        .select('entity_category, is_read')
        .eq('job_id', job.id);
      
      const total = emailsData?.length || 0;
      const customer = emailsData?.filter(e => e.entity_category === 'customer').length || 0;
      const vendor = emailsData?.filter(e => e.entity_category === 'vendor').length || 0;
      const subcontractor = emailsData?.filter(e => e.entity_category === 'subcontractor').length || 0;
      const unread = emailsData?.filter(e => !e.is_read && e.entity_category).length || 0;
      
      setEmailStats({ total, customer, vendor, subcontractor, unread });
    } catch (error) {
      console.error('Error loading job stats:', error);
    }
  }

  async function loadRecentActivity() {
    try {
      const activities: any[] = [];

      // Get recent time entries
      const { data: timeEntries } = await supabase
        .from('time_entries')
        .select(`
          *,
          components(name),
          user_profiles(username)
        `)
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(5);

      (timeEntries || []).forEach((entry: any) => {
        activities.push({
          type: 'time_entry',
          timestamp: entry.created_at,
          description: `${entry.user_profiles?.username || 'Unknown'} logged ${entry.total_hours?.toFixed(2)}h on ${entry.components?.name || 'Unknown'}`,
          icon: 'clock',
        });
      });

      // Get recent photos
      const { data: photos } = await supabase
        .from('photos')
        .select(`
          *,
          user_profiles(username)
        `)
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(3);

      (photos || []).forEach((photo: any) => {
        activities.push({
          type: 'photo',
          timestamp: photo.created_at,
          description: `${photo.user_profiles?.username || 'Unknown'} uploaded a photo`,
          icon: 'camera',
        });
      });

      // Get recent logs
      const { data: logs } = await supabase
        .from('daily_logs')
        .select(`
          *,
          user_profiles(username)
        `)
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(3);

      (logs || []).forEach((log: any) => {
        activities.push({
          type: 'daily_log',
          timestamp: log.created_at,
          description: `${log.user_profiles?.username || 'Unknown'} submitted daily log`,
          icon: 'file',
        });
      });

      // Sort by timestamp and take top 10
      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setRecentActivity(activities.slice(0, 10));
    } catch (error) {
      console.error('Error loading recent activity:', error);
    }
  }

  async function loadNotifications() {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setNotifications(data || []);
      setUnreadCount((data || []).filter(n => !n.is_read).length);
    } catch (error) {
      console.error('Error loading notifications:', error);
    }
  }

  async function handleNotificationClick(notification: any) {
    // Mark as read
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notification.id);

    loadNotifications();
  }

  async function loadComponentWork() {
    try {
      const { data, error } = await supabase
        .from('time_entries')
        .select(`
          *,
          components(name),
          user_profiles(username),
          photos:photos!time_entry_id(id, photo_url, caption)
        `)
        .eq('job_id', job.id)
        .order('start_time', { ascending: false });

      if (error) throw error;

      // Group by date, then by component (for date view)
      const dateMap = new Map<string, Map<string, ComponentSummary>>();
      // Group by component, then by date (for component view)
      const componentMap = new Map<string, Map<string, DateSummary>>();
      // Group by person, then by date (for person view)
      const personMap = new Map<string, Map<string, DateSummary>>();

      // Track totals for clock-in and component time
      let clockInManHours = 0;
      let componentManHours = 0;

      (data || []).forEach((entry: any) => {
        const date = new Date(entry.start_time).toISOString().split('T')[0];
        const componentId = entry.component_id;
        const componentName = entry.components?.name || 'Unknown Component';
        const userName = entry.user_profiles?.username || 'Unknown';
        const duration = entry.total_hours || 0;
        const crewCount = entry.crew_count || 1;
        const manHours = duration * crewCount;

        // Track clock-in vs component hours
        if (componentId === null) {
          clockInManHours += manHours;
        } else {
          componentManHours += manHours;
        }

        const workEntry: ComponentWorkEntry = {
          id: entry.id,
          component_id: componentId,
          component_name: componentName,
          start_time: entry.start_time,
          end_time: entry.end_time,
          total_hours: duration,
          crew_count: crewCount,
          is_manual: entry.is_manual,
          notes: entry.notes,
          worker_names: entry.worker_names,
          user_name: userName,
          photos: entry.photos || [],
        };

        // Date view grouping
        if (!dateMap.has(date)) {
          dateMap.set(date, new Map());
        }
        const componentsForDate = dateMap.get(date)!;
        if (componentsForDate.has(componentId)) {
          const existing = componentsForDate.get(componentId)!;
          existing.total_duration += duration;
          existing.total_man_hours += manHours;
          existing.entry_count += 1;
          existing.entries.push(workEntry);
        } else {
          componentsForDate.set(componentId, {
            component_id: componentId,
            component_name: componentName,
            total_duration: duration,
            total_man_hours: manHours,
            entry_count: 1,
            entries: [workEntry],
          });
        }

        // Component view grouping
        if (!componentMap.has(componentId)) {
          componentMap.set(componentId, new Map());
        }
        const datesForComponent = componentMap.get(componentId)!;
        if (datesForComponent.has(date)) {
          const existing = datesForComponent.get(date)!;
          existing.total_duration += duration;
          existing.total_man_hours += manHours;
          existing.entries.push(workEntry);
        } else {
          datesForComponent.set(date, {
            date,
            total_duration: duration,
            total_man_hours: manHours,
            entries: [workEntry],
          });
        }

        // Person view grouping
        if (!personMap.has(userName)) {
          personMap.set(userName, new Map());
        }
        const datesForPerson = personMap.get(userName)!;
        if (datesForPerson.has(date)) {
          const existing = datesForPerson.get(date)!;
          existing.total_duration += duration;
          existing.total_man_hours += manHours;
          existing.entries.push(workEntry);
        } else {
          datesForPerson.set(date, {
            date,
            total_duration: duration,
            total_man_hours: manHours,
            entries: [workEntry],
          });
        }
      });

      // Convert date view to array
      const dateGroupsArray: DateGroup[] = Array.from(dateMap.entries())
        .map(([date, componentsMap]) => {
          const components = Array.from(componentsMap.values()).sort(
            (a, b) => b.total_man_hours - a.total_man_hours
          );
          const total_man_hours = components.reduce((sum, c) => sum + c.total_man_hours, 0);
          return {
            date,
            total_man_hours,
            components,
          };
        })
        .sort((a, b) => b.date.localeCompare(a.date));

      setDateGroups(dateGroupsArray);

      // Convert component view to array
      const componentGroupsArray: ComponentGroup[] = Array.from(componentMap.entries())
        .map(([componentId, datesMap]) => {
          const dates = Array.from(datesMap.entries())
            .map(([date, summary]) => summary)
            .sort((a, b) => b.date.localeCompare(a.date));
          const total_duration = dates.reduce((sum, d) => sum + d.total_duration, 0);
          const total_man_hours = dates.reduce((sum, d) => sum + d.total_man_hours, 0);
          const entry_count = dates.reduce((sum, d) => sum + d.entries.length, 0);
          const componentName = dates[0]?.entries[0]?.component_name || 'Unknown';
          return {
            component_id: componentId,
            component_name: componentName,
            total_duration,
            total_man_hours,
            entry_count,
            dates,
          };
        })
        .sort((a, b) => b.total_man_hours - a.total_man_hours);

      setComponentGroups(componentGroupsArray);

      // Convert person view to array
      const personGroupsArray: PersonGroup[] = Array.from(personMap.entries())
        .map(([userName, datesMap]) => {
          const dates = Array.from(datesMap.entries())
            .map(([date, summary]) => summary)
            .sort((a, b) => b.date.localeCompare(a.date));
          const total_duration = dates.reduce((sum, d) => sum + d.total_duration, 0);
          const total_man_hours = dates.reduce((sum, d) => sum + d.total_man_hours, 0);
          const entry_count = dates.reduce((sum, d) => sum + d.entries.length, 0);
          
          // Calculate component vs clock-in hours for this user
          let component_hours = 0;
          let clock_in_hours = 0;
          dates.forEach(dateSummary => {
            dateSummary.entries.forEach(entry => {
              const entryManHours = entry.total_hours * entry.crew_count;
              if (entry.component_id === null) {
                clock_in_hours += entryManHours;
              } else {
                component_hours += entryManHours;
              }
            });
          });
          
          return {
            user_name: userName,
            total_duration,
            total_man_hours,
            entry_count,
            dates,
            component_hours,
            clock_in_hours,
          };
        })
        .sort((a, b) => b.total_man_hours - a.total_man_hours);

      setPersonGroups(personGroupsArray);
      
      const totalDur = dateGroupsArray.reduce(
        (sum, dg) => sum + dg.components.reduce((s, c) => s + c.total_duration, 0), 
        0
      );
      const totalMan = dateGroupsArray.reduce((sum, dg) => sum + dg.total_man_hours, 0);
      
      setTotalDuration(totalDur);
      setTotalManHours(totalMan);
      setTotalClockInHours(clockInManHours);
      setTotalComponentHours(componentManHours);

      // Extract crew members
      const uniqueUsers = new Set<string>();
      (data || []).forEach((entry: any) => {
        if (entry.user_profiles?.username) {
          uniqueUsers.add(entry.user_profiles.username);
        }
      });
      setCrewMembers(Array.from(uniqueUsers));

      // Get first and last work dates
      if (data && data.length > 0) {
        const dates = data.map((entry: any) => new Date(entry.start_time).getTime());
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        setFirstWorkDate(minDate.toISOString().split('T')[0]);
        setLastWorkDate(maxDate.toISOString().split('T')[0]);
      }
    } catch (error) {
      console.error('Error loading component work:', error);
    }
  }

  async function loadDailyLogs() {
    try {
      const { data, error } = await supabase
        .from('daily_logs')
        .select(`
          *,
          user_profiles(username)
        `)
        .eq('job_id', job.id)
        .order('log_date', { ascending: false });

      if (error) throw error;

      const logs: DailyLog[] = (data || []).map((log: any) => ({
        id: log.id,
        log_date: log.log_date,
        weather: log.weather,
        weather_details: log.weather_details,
        crew_count: log.crew_count,
        components_worked: log.components_worked || [],
        time_summary: log.time_summary || [],
        issues: log.issues || [],
        material_requests_structured: log.material_requests_structured || [],
        client_summary: log.client_summary,
        final_notes: log.final_notes,
        user_name: log.user_profiles?.username || 'Unknown',
        created_at: log.created_at,
      }));

      setDailyLogs(logs);
    } catch (error) {
      console.error('Error loading daily logs:', error);
    }
  }

  function formatDate(dateString: string): string {
    // Parse as local date by adding time component
    const date = new Date(dateString + 'T12:00:00');
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  }

  function formatTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true
    });
  }

  function formatTimeAgo(timestamp: string): string {
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    const diff = now - time;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return formatDate(timestamp.split('T')[0]);
  }

  function calculateDaysActive(): number {
    if (!firstWorkDate || !lastWorkDate) return 0;
    const start = new Date(firstWorkDate).getTime();
    const end = new Date(lastWorkDate).getTime();
    return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  }

  async function printJobHours() {
    setExporting(true);

    try {
      // Load all time entries for this job
      const { data: allEntries, error: entriesError } = await supabase
        .from('time_entries')
        .select(`
          *,
          components(name),
          user_profiles(username, email)
        `)
        .eq('job_id', job.id)
        .eq('is_active', false)
        .order('start_time', { ascending: true });

      if (entriesError) throw entriesError;

      if (!allEntries || allEntries.length === 0) {
        toast.error('No time entries to print');
        setExporting(false);
        return;
      }

      // Group entries by user
      const userMap = new Map<string, any>();
      
      allEntries.forEach(entry => {
        const userId = entry.user_id;
        const userName = entry.user_profiles?.username || entry.user_profiles?.email || 'Unknown User';
        
        if (!userMap.has(userId)) {
          userMap.set(userId, {
            userId,
            userName,
            totalHours: 0,
            entries: [],
          });
        }
        
        const userData = userMap.get(userId)!;
        userData.totalHours += entry.total_hours || 0;
        userData.entries.push({
          date: format(new Date(entry.start_time), 'MMM d, yyyy'),
          component: entry.components?.name || 'Clock In/Out',
          startTime: format(new Date(entry.start_time), 'h:mm a'),
          endTime: entry.end_time ? format(new Date(entry.end_time), 'h:mm a') : '-',
          hours: (entry.total_hours || 0).toFixed(2),
          crewCount: entry.crew_count || 1,
          notes: entry.notes || '',
          isManual: entry.is_manual,
        });
      });

      const users = Array.from(userMap.values()).sort((a, b) => 
        a.userName.localeCompare(b.userName)
      );

      const pdfData = {
        title: 'Job Hours Report',
        jobName: job.name,
        clientName: job.client_name,
        address: job.address,
        totalHours: totalManHours.toFixed(2),
        users,
      };

      const { data, error } = await supabase.functions.invoke('generate-pdf', {
        body: {
          type: 'job-hours',
          data: pdfData,
        },
      });

      if (error) {
        if (error instanceof FunctionsHttpError) {
          const errorText = await error.context.text();
          throw new Error(errorText || error.message);
        }
        throw error;
      }

      // Open HTML in new window with print dialog
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(data);
        printWindow.document.close();
      } else {
        toast.error('Please allow popups to print');
      }

      toast.success('Print dialog opened');
    } catch (error: any) {
      console.error('Print error:', error);
      toast.error(error.message || 'Failed to generate print preview');
    } finally {
      setExporting(false);
    }
  }

  function renderWorkEntry(entry: ComponentWorkEntry) {
    return (
      <div
        key={entry.id}
        className="bg-muted/50 rounded-md p-3 space-y-2"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {viewMode === 'person' && (
                <span className="font-medium text-sm">{entry.component_name}</span>
              )}
              {entry.is_manual && (
                <Badge variant="outline" className="text-xs">
                  Manual
                </Badge>
              )}
              {!entry.is_manual && (
                <span className="text-sm text-muted-foreground">
                  {formatTime(entry.start_time)} - {formatTime(entry.end_time)}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              By {entry.user_name}
            </p>
          </div>
          <div className="text-right">
            <p className="font-bold">{(entry.total_hours * entry.crew_count).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">man-hours</p>
            <p className="text-xs text-muted-foreground">{entry.crew_count} crew</p>
          </div>
        </div>

        {entry.worker_names && entry.worker_names.length > 0 && (
          <div className="pt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-1">Workers:</p>
            <div className="flex flex-wrap gap-1">
              {entry.worker_names.map((name, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  {name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {entry.photos && entry.photos.length > 0 && (
          <div className="pt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-2">Photos ({entry.photos.length}):</p>
            <div className="grid grid-cols-3 gap-2">
              {entry.photos.map((photo) => (
                <a
                  key={photo.id}
                  href={photo.photo_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aspect-square rounded-lg overflow-hidden border hover:opacity-80 transition-opacity"
                >
                  <img
                    src={photo.photo_url}
                    alt={photo.caption || 'Time entry photo'}
                    className="w-full h-full object-cover"
                  />
                </a>
              ))}
            </div>
          </div>
        )}

        {entry.notes && (
          <div className="pt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-1">Notes:</p>
            <p className="text-sm">{entry.notes}</p>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading job dashboard...</p>
        </CardContent>
      </Card>
    );
  }

  // Calculate progress using clock-in time only
  const estimatedHours = job.estimated_hours || 0;
  const actualHours = totalDuration;
  const actualManHours = totalManHours;
  const progressPercent = estimatedHours > 0 ? Math.min((totalClockInHours / estimatedHours) * 100, 100) : 0;
  const isOverBudget = totalClockInHours > estimatedHours && estimatedHours > 0;
  const remainingHours = Math.max(estimatedHours - totalClockInHours, 0);

  const headerBudgetProfit =
    proposalBudget != null && headerProposalCostTotal != null
      ? proposalBudget.grandTotal - headerProposalCostTotal
      : null;

  const fmtHeaderUsd = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const jobBudgetHeaderTitle =
    proposalBudgetLoading
      ? 'Loading proposal totals…'
      : proposalBudget
        ? [
            `Proposal #${proposalBudget.proposalLabel}. Sell (saved): ${fmtHeaderUsd(proposalBudget.grandTotal)}.`,
            headerProposalCostTotal != null ? ` Cost: ${fmtHeaderUsd(headerProposalCostTotal)}.` : '',
            headerBudgetProfit != null ? ` Profit: ${fmtHeaderUsd(headerBudgetProfit)}.` : '',
            ' Click for full breakdown.',
          ].join('')
        : 'Sell total appears when saved on the quote. Click for budget breakdown.';

  return (
    <JobDetailProposalToolbarContext.Provider value={setProposalToolbarContent}>
    <JobDetailMaterialsToolbarSlotContext.Provider value={{ ref: materialsToolbarSlotRef, ready: materialsToolbarSlotReady }}>
    <ProposalSummaryProvider>
    <div className="w-full min-h-0 bg-background">
      <Tabs
        value={activeTab}
        onValueChange={handleActiveTabChange}
        className={`w-full ${
          activeTab === 'proposal-materials'
            ? /* Fixed black (min-h-14) + green (h-8 row + py-1); slightly under old 6rem to remove gray gap */
              'pt-[calc(3.5rem+2.25rem)]'
            : 'pt-14'
        }`}
      >
        {/* Main Navigation Tabs - Black bar always at top; green bar below when on Proposal & Materials */}
        <div className="fixed top-0 left-0 right-0 z-50 border-b-4 border-yellow-600 shadow-2xl bg-black">
          <div className="flex items-center gap-2 px-4 py-1.5 min-h-14 bg-black">
            {onBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="text-yellow-100 hover:text-yellow-400 hover:bg-green-900/50 shrink-0"
              >
                <ArrowLeft className="w-5 h-5 mr-2" />
                Back to Jobs
              </Button>
            )}
            <h1 className="text-lg font-bold text-yellow-500 truncate shrink-0 max-w-[180px] sm:max-w-[240px]">
              {job.name}
            </h1>
            <button
              type="button"
              onClick={() => handleActiveTabChange('job-budget')}
              className="hidden md:inline-flex flex-row items-center gap-1.5 shrink-0 border-l border-yellow-600/50 pl-2.5 ml-1 py-0 max-w-[min(200px,22vw)] rounded-md hover:bg-yellow-950/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 transition-colors self-center"
              title={jobBudgetHeaderTitle}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-yellow-600 whitespace-nowrap">
                Budget
              </span>
              {proposalBudgetLoading ? (
                <span className="h-3.5 w-16 bg-yellow-900/50 animate-pulse rounded shrink-0" aria-hidden />
              ) : proposalBudget ? (
                <>
                  <span className="text-[10px] text-yellow-200/75 tabular-nums whitespace-nowrap">
                    #{proposalBudget.proposalLabel}
                  </span>
                  <span className="text-sm font-bold text-emerald-400 tabular-nums truncate leading-none">
                    {fmtHeaderUsd(proposalBudget.grandTotal)}
                  </span>
                </>
              ) : (
                <span className="text-[10px] text-yellow-200/65 leading-none whitespace-nowrap">
                  Set totals
                </span>
              )}
            </button>
            <TabsList className="flex-1 min-w-0 grid grid-cols-12 h-11 rounded-none bg-transparent p-0 gap-0 border-0 overflow-x-auto">
            <TabsTrigger 
              value="overview" 
              className="font-bold text-xs sm:text-sm text-yellow-100 hover:text-yellow-400 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-600 data-[state=active]:to-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-lg transition-all rounded-none py-2"
            >
              <Activity className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger 
              value="proposal-materials" 
              className="font-bold text-xs sm:text-sm text-yellow-100 hover:text-yellow-400 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-600 data-[state=active]:to-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-lg transition-all relative rounded-none py-2"
            >
              <DollarSign className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Proposal & Materials</span>
              {crewOrdersCount > 0 && (
                <Badge variant="destructive" className="ml-1 bg-red-600 text-white font-bold animate-pulse text-xs">
                  {crewOrdersCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="components" 
              className="font-bold text-xs sm:text-sm text-yellow-100 hover:text-yellow-400 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-600 data-[state=active]:to-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-lg transition-all rounded-none py-2"
            >
              <Target className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Components</span>
            </TabsTrigger>
            <TabsTrigger 
              value="schedule" 
              className="font-bold text-xs sm:text-sm text-yellow-100 hover:text-yellow-400 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-600 data-[state=active]:to-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-lg transition-all rounded-none py-2"
            >
              <Calendar className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Schedule</span>
            </TabsTrigger>
            <TabsTrigger 
              value="documents" 
              className="font-bold text-xs sm:text-sm text-yellow-100 hover:text-yellow-400 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-600 data-[state=active]:to-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-lg transition-all rounded-none py-2"
            >
              <FileText className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Documents</span>
            </TabsTrigger>
            <TabsTrigger 
              value="orders" 
              className="font-bold text-xs sm:text-sm text-yellow-100 hover:text-yellow-400 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-600 data-[state=active]:to-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-lg transition-all rounded-none py-2"
            >
              <FileSpreadsheet className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Orders</span>
            </TabsTrigger>
            <TabsTrigger 
              value="crew-orders" 
              className="font-bold text-xs sm:text-sm text-yellow-100 hover:text-yellow-400 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-600 data-[state=active]:to-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-lg transition-all rounded-none py-2 relative"
            >
              <ShoppingCart className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Crew Orders</span>
              {crewOrdersCount > 0 && (
                <Badge variant="destructive" className="ml-1 bg-orange-500 text-white font-bold animate-pulse text-xs">
                  {crewOrdersCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="photos" 
              className="font-bold text-xs sm:text-sm text-yellow-100 hover:text-yellow-400 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-600 data-[state=active]:to-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-lg transition-all rounded-none py-2"
            >
              <Camera className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Photos</span>
            </TabsTrigger>
            <TabsTrigger 
              value="subcontractors" 
              className="font-bold text-xs sm:text-sm text-yellow-100 hover:text-yellow-400 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-600 data-[state=active]:to-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-lg transition-all rounded-none py-2"
            >
              <Briefcase className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Subs</span>
            </TabsTrigger>
            <TabsTrigger 
              value="customer-portal" 
              className="font-bold text-xs sm:text-sm text-yellow-100 hover:text-yellow-400 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-600 data-[state=active]:to-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-lg transition-all rounded-none py-2"
            >
              <Users className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Portal</span>
            </TabsTrigger>
            <TabsTrigger 
              value="subcontractor-portal" 
              className="font-bold text-xs sm:text-sm text-yellow-100 hover:text-yellow-400 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-600 data-[state=active]:to-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-lg transition-all rounded-none py-2"
            >
              <Key className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Sub portal</span>
            </TabsTrigger>
            <TabsTrigger 
              value="communications" 
              className="font-bold text-xs sm:text-sm text-yellow-100 hover:text-yellow-400 data-[state=active]:bg-gradient-to-br data-[state=active]:from-yellow-600 data-[state=active]:to-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-lg transition-all rounded-none py-2"
            >
              <Mail className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Email</span>
            </TabsTrigger>
          </TabsList>
          </div>

          {/* Proposal & Materials: green bar below black bar */}
          {activeTab === 'proposal-materials' && (
            <div className="relative z-[1] border-t border-yellow-600/30 bg-green-900/95 text-xs shadow-sm">
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-1">
                <div className="flex items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 h-8 text-xs bg-green-700 hover:bg-green-600 text-yellow-100 border-yellow-600/40 px-2"
                      >
                        View
                        <ChevronDown className="w-3 h-3 opacity-80" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[200px] bg-slate-900 border-yellow-600/40">
                      <DropdownMenuItem
                        onClick={() => setProposalViewMode('split')}
                        className="text-yellow-100 focus:bg-green-800 focus:text-yellow-100 gap-2"
                      >
                        <LayoutGrid className="w-3 h-3" />
                        Split Proposal Materials
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setProposalViewMode('proposal')}
                        className="text-yellow-100 focus:bg-green-800 focus:text-yellow-100 gap-2"
                      >
                        <FileText className="w-3 h-3" />
                        Proposal
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setProposalViewMode('materials')}
                        className="text-yellow-100 focus:bg-green-800 focus:text-yellow-100 gap-2"
                      >
                        <Package className="w-3 h-3" />
                        Materials
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Popover
                  open={proposalPageNotesOpen}
                  onOpenChange={(open) => {
                    setProposalPageNotesOpen(open);
                    if (open) setProposalNotesDraft(job.notes ?? '');
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-8 text-xs bg-green-700 hover:bg-green-600 text-yellow-100 border-yellow-600/40 px-2 shrink-0"
                      aria-label={job.notes?.trim() ? 'Edit job page notes' : 'Open job page notes'}
                    >
                      <StickyNote className="w-3 h-3 shrink-0 opacity-90" />
                      Notes
                      {job.notes?.trim() ? (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0"
                          title="Has saved notes"
                          aria-hidden
                        />
                      ) : null}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={6}
                    className="w-[min(calc(100vw-1.5rem),28rem)] p-3 bg-slate-950 border border-yellow-600/40 text-yellow-50 shadow-xl"
                  >
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-semibold text-yellow-200/95">Job page notes</p>
                        <p className="text-[11px] text-yellow-100/55 mt-0.5">
                          Same notes as Overview and Edit Job. Scratchpad while you work here.
                        </p>
                      </div>
                      <Textarea
                        value={proposalNotesDraft}
                        onChange={(e) => setProposalNotesDraft(e.target.value)}
                        placeholder="Phone calls, follow-ups, pricing reminders…"
                        rows={9}
                        readOnly={profile?.role !== 'office'}
                        className="text-sm bg-green-950/40 border-yellow-600/35 text-yellow-50 placeholder:text-yellow-200/35 min-h-[180px] resize-y"
                      />
                      {profile?.role !== 'office' ? (
                        <p className="text-[11px] text-amber-200/80">Office role required to save changes.</p>
                      ) : null}
                      <div className="flex justify-end gap-2 pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-yellow-200/90 hover:text-yellow-100 hover:bg-green-900/60"
                          onClick={() => setProposalPageNotesOpen(false)}
                        >
                          Close
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 text-xs bg-yellow-600 text-black hover:bg-yellow-500"
                          disabled={profile?.role !== 'office' || savingProposalNotes}
                          onClick={() => void saveProposalPageNotes()}
                        >
                          {savingProposalNotes ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                {proposalToolbarContent && (
                  <>
                    <div className="h-6 w-px bg-yellow-600/40 flex-shrink-0" aria-hidden />
                    <div className="flex flex-wrap items-center gap-1">
                      {proposalToolbarContent}
                    </div>
                  </>
                )}
                {/* Workbook tabs on the right – directly above workbook panel */}
                <div
                  ref={(el) => {
                    (materialsToolbarSlotRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                    setMaterialsToolbarSlotReady(!!el);
                  }}
                  className="flex items-center gap-1 flex-1 min-w-0 justify-end"
                />
              </div>
            </div>
          )}
        </div>

        {/* Overview Tab */}
        <TabsContent value="overview" className="w-full">
          <div className="max-w-7xl mx-auto space-y-6 pt-4 px-4">
            {/* Job Header */}
            <Card className="border-2">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-slate-50 border-b-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-3xl font-bold mb-2 flex items-center gap-3">
                      <Building2 className="w-8 h-8 text-blue-600" />
                      {job.name}
                    </CardTitle>
                    <div className="space-y-1">
                      <p className="text-muted-foreground flex items-center gap-2">
                        <MapPin className="w-4 h-4" />
                        {job.address}
                      </p>
                      {((job as any).customer_email || (job as any).customer_phone) && (
                        <div className="flex gap-4 text-sm text-muted-foreground mt-2">
                          {(job as any).customer_email && (
                            <p className="flex items-center gap-2">
                              <Mail className="w-4 h-4" />
                              {(job as any).customer_email}
                            </p>
                          )}
                          {(job as any).customer_phone && (
                            <p className="flex items-center gap-2">
                              📞 {(job as any).customer_phone}
                            </p>
                          )}
                        </div>
                      )}
                      {job.description && (
                        <p className="text-muted-foreground">{job.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Badge variant={job.status === 'active' ? 'default' : 'secondary'} className="text-sm">
                      {job.status}
                    </Badge>
                    {onEdit && (
                      <Button variant="outline" size="sm" onClick={onEdit}>
                        <Edit className="w-4 h-4 mr-2" />
                        Edit Job
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Job budget from stored proposal totals (JobFinancials / quotes row) */}
            <Card className="border-2 border-emerald-200 bg-gradient-to-r from-emerald-50 to-slate-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-6 h-6 text-emerald-700" />
                  Job budget (from proposal)
                </CardTitle>
                <p className="text-sm text-muted-foreground font-normal">
                  Uses the saved proposal subtotal, tax, and grand total for the proposal selected on this job (same as Proposal & Materials when totals are stored).
                </p>
              </CardHeader>
              <CardContent>
                {!proposalQuoteSelectionReady || proposalBudgetLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin shrink-0" />
                    Loading proposal totals…
                  </div>
                ) : !selectedProposalQuoteId ? (
                  <p className="text-sm text-muted-foreground">No proposal is linked to this job yet.</p>
                ) : !proposalBudget ? (
                  <p className="text-sm text-muted-foreground">
                    No saved proposal totals for this quote yet. Open Proposal & Materials so the proposal can be calculated and totals saved to the quote.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Proposal</p>
                        <p className="text-lg font-semibold text-emerald-900 tabular-nums">#{proposalBudget.proposalLabel}</p>
                      </div>
                      <div className="sm:text-right">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Price (customer total)</p>
                        <p className="text-2xl font-bold text-emerald-800 tabular-nums">
                          {proposalBudget.grandTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">Saved grand total on the quote</p>
                      </div>
                      <div className="sm:text-right border-t sm:border-t-0 sm:border-l border-emerald-200 pt-3 sm:pt-0 sm:pl-4">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cost (internal)</p>
                        {headerProposalCostLoading ? (
                          <p className="text-sm text-muted-foreground mt-1">Loading…</p>
                        ) : headerProposalCostTotal != null ? (
                          <p className="text-xl font-semibold text-slate-800 tabular-nums mt-0.5">
                            {headerProposalCostTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground mt-1">—</p>
                        )}
                        {proposalBudget != null && headerProposalCostTotal != null && (
                          <>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mt-3">Profit (price − cost)</p>
                            <p
                              className={`text-xl font-bold tabular-nums ${
                                proposalBudget.grandTotal - headerProposalCostTotal >= 0
                                  ? 'text-emerald-700'
                                  : 'text-destructive'
                              }`}
                            >
                              {(proposalBudget.grandTotal - headerProposalCostTotal).toLocaleString('en-US', {
                                style: 'currency',
                                currency: 'USD',
                              })}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t text-sm">
                      <div>
                        <span className="text-muted-foreground">Subtotal </span>
                        <span className="font-medium tabular-nums">
                          {proposalBudget.subtotal.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Tax </span>
                        <span className="font-medium tabular-nums">
                          {proposalBudget.tax === 0 ? (
                            <span className="text-amber-800">Tax exempt</span>
                          ) : (
                            proposalBudget.tax.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {selectedProposalQuoteId && proposalQuoteSelectionReady && (
                  <div className="pt-4 mt-2 border-t border-emerald-200">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-emerald-600 text-emerald-900 hover:bg-emerald-100"
                      onClick={() => handleActiveTabChange('job-budget')}
                    >
                      Open full budget breakdown
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Email Communications Quick Access */}
            <Card className="border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="w-6 h-6 text-blue-600" />
                    Email Communications
                  </CardTitle>
                  <Button
                    onClick={() => setShowEmailDialog(true)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Open Email Center
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 gap-4">
                  <div className="text-center p-3 bg-white rounded-lg border">
                    <p className="text-2xl font-bold text-blue-600">{emailStats.total}</p>
                    <p className="text-xs text-muted-foreground mt-1">Total Emails</p>
                  </div>
                  <div className="text-center p-3 bg-white rounded-lg border">
                    <p className="text-2xl font-bold text-green-600">{emailStats.customer}</p>
                    <p className="text-xs text-muted-foreground mt-1">Customers</p>
                  </div>
                  <div className="text-center p-3 bg-white rounded-lg border">
                    <p className="text-2xl font-bold text-orange-600">{emailStats.vendor}</p>
                    <p className="text-xs text-muted-foreground mt-1">Vendors</p>
                  </div>
                  <div className="text-center p-3 bg-white rounded-lg border">
                    <p className="text-2xl font-bold text-blue-600">{emailStats.subcontractor}</p>
                    <p className="text-xs text-muted-foreground mt-1">Subcontractors</p>
                  </div>
                  <div className="text-center p-3 bg-white rounded-lg border">
                    <p className="text-2xl font-bold text-red-600">{emailStats.unread}</p>
                    <p className="text-xs text-muted-foreground mt-1">Unread</p>
                  </div>
                </div>
                {emailStats.unread > 0 && (
                  <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                    <p className="text-sm text-red-800 font-medium">
                      You have {emailStats.unread} unread {emailStats.unread === 1 ? 'message' : 'messages'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card 
                className="cursor-pointer hover:shadow-lg hover:border-blue-400 transition-all"
                onClick={printJobHours}
              >
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">Total Hours</p>
                      <p className="text-3xl font-bold">{totalManHours.toFixed(1)}</p>
                      <p className="text-xs text-muted-foreground mt-1">man-hours logged</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Clock className="w-10 h-10 text-blue-600" />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={exporting}
                        onClick={(e) => {
                          e.stopPropagation();
                          printJobHours();
                        }}
                        className="h-7 text-xs"
                      >
                        {exporting ? (
                          <>
                            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
                            Printing...
                          </>
                        ) : (
                          <>
                            <Printer className="w-3 h-3 mr-1" />
                            Print
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Crew Members</p>
                      <p className="text-3xl font-bold">{crewMembers.length}</p>
                      <p className="text-xs text-muted-foreground mt-1">active workers</p>
                    </div>
                    <Users className="w-10 h-10 text-green-600" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Photos</p>
                      <p className="text-3xl font-bold">{photoCount}</p>
                      <p className="text-xs text-muted-foreground mt-1">uploaded</p>
                    </div>
                    <Camera className="w-10 h-10 text-purple-600" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Daily Logs</p>
                      <p className="text-3xl font-bold">{dailyLogs.length}</p>
                      <p className="text-xs text-muted-foreground mt-1">submitted</p>
                    </div>
                    <FileText className="w-10 h-10 text-orange-600" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Time logged by component (from time entries) */}
            <Card className="border-2 border-slate-200">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <Briefcase className="w-5 h-5 text-slate-700" />
                      Components and time
                    </CardTitle>
                    <p className="text-sm text-muted-foreground font-normal">
                      Hours from field time entries: <span className="font-medium text-foreground">Man-hours</span> counts crew
                      (hours × crew). <span className="font-medium text-foreground">Clock hrs</span> is elapsed time per entry without multiplying by crew.
                      Click a row for each worker&apos;s totals and a dated entry log.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => handleActiveTabChange('components')}>
                    Components tab
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {overviewComponentTimeRows.length === 0 && totalClockInHours <= 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No time entries on this job yet. Crew time will appear here once logged and assigned to components where applicable.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Component</TableHead>
                        <TableHead className="text-right w-[120px]">Man-hours</TableHead>
                        <TableHead className="text-right w-[100px]">Clock hrs</TableHead>
                        <TableHead className="text-right w-[90px]">Entries</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overviewComponentTimeRows.map((row) => (
                        <TableRow
                          key={row.key}
                          role="button"
                          tabIndex={0}
                          className="cursor-pointer hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          onClick={() => setOverviewComponentBreakdownKey(row.key)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setOverviewComponentBreakdownKey(row.key);
                            }
                          }}
                        >
                          <TableCell className="font-medium">{row.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.manHours.toFixed(1)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {row.wallHours.toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{row.entries}</TableCell>
                        </TableRow>
                      ))}
                      {totalClockInHours > 0 ? (
                        <TableRow
                          role="button"
                          tabIndex={0}
                          className="bg-muted/40 cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          onClick={() => setOverviewComponentBreakdownKey('__clock_in__')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setOverviewComponentBreakdownKey('__clock_in__');
                            }
                          }}
                        >
                          <TableCell className="font-medium text-muted-foreground">
                            Clock-in / not on a component
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{totalClockInHours.toFixed(1)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                          <TableCell className="text-right text-muted-foreground">—</TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Progress Card */}
            {estimatedHours > 0 && (
              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    Project Progress
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Estimated Hours</p>
                      <p className="text-2xl font-bold">{estimatedHours.toFixed(1)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Actual Hours</p>
                      <p className="text-2xl font-bold">{totalClockInHours.toFixed(1)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Remaining</p>
                      <p className={`text-2xl font-bold ${isOverBudget ? 'text-red-600' : 'text-green-600'}`}>
                        {isOverBudget ? '+' : ''}{remainingHours.toFixed(1)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Progress</span>
                      <span className="text-sm font-medium">{progressPercent.toFixed(1)}%</span>
                    </div>
                    <Progress value={progressPercent} className="h-3" />
                  </div>
                  {isOverBudget && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                      <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                      <div>
                        <p className="font-semibold text-red-900">Over Budget</p>
                        <p className="text-sm text-red-700">
                          This job has exceeded the estimated hours by {Math.abs(remainingHours).toFixed(1)} hours
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Timeline Card */}
            {(firstWorkDate || lastWorkDate) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    Timeline
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">First Activity</p>
                      <p className="font-semibold">{firstWorkDate ? formatDate(firstWorkDate) : 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Latest Activity</p>
                      <p className="font-semibold">{lastWorkDate ? formatDate(lastWorkDate) : 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Days Active</p>
                      <p className="font-semibold">{calculateDaysActive()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {recentActivity.length > 0 ? (
                  <div className="space-y-3">
                    {recentActivity.map((activity, idx) => (
                      <div key={idx} className="flex items-start gap-3 pb-3 border-b last:border-0">
                        <div className="mt-1">
                          {activity.icon === 'clock' && <Clock className="w-4 h-4 text-blue-600" />}
                          {activity.icon === 'camera' && <Camera className="w-4 h-4 text-purple-600" />}
                          {activity.icon === 'file' && <FileText className="w-4 h-4 text-orange-600" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm">{activity.description}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatTimeAgo(activity.timestamp)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No recent activity</p>
                )}
              </CardContent>
            </Card>

            {/* Crew Members List */}
            {crewMembers.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Crew Members ({crewMembers.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {crewMembers.map((member, idx) => (
                      <Badge key={idx} variant="secondary" className="text-sm px-3 py-1">
                        {member}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Issues Alert */}
            {issueCount > 0 && (
              <Card className="border-2 border-yellow-200 bg-yellow-50">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-6 h-6 text-yellow-600 mt-1" />
                    <div className="flex-1">
                      <h3 className="font-semibold text-yellow-900">Active Issues</h3>
                      <p className="text-sm text-yellow-700 mt-1">
                        There are {issueCount} reported issues in daily logs that may need attention.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Notes */}
            {job.notes && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileCheck className="w-5 h-5" />
                    Job Notes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap">{job.notes}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="job-budget" className="w-full">
          <div className="max-w-5xl mx-auto space-y-4 pt-4 px-4 pb-12">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-foreground tracking-tight">Budget breakdown</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Uses the same proposal as the header and Proposal & Materials. Switch proposal there if you need a different version.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => handleActiveTabChange('overview')}>
                Back to overview
              </Button>
            </div>
            <JobProposalBudgetBreakdownPanel jobId={job.id} quoteId={selectedProposalQuoteId} />
          </div>
        </TabsContent>

        {/* forceMount keeps the panel alive across tab switches — data persists, no cold-restart */}
        <TabsContent
          forceMount
          value="proposal-materials"
          className="relative z-0 mt-0 flex h-[calc(100dvh-8.75rem)] w-full min-h-[400px] flex-col overflow-hidden data-[state=inactive]:hidden sm:min-h-[520px]"
        >
          <ProposalAndMaterialsView
              job={job}
              userId={profile?.id}
              viewMode={proposalViewMode}
              onViewModeChange={setProposalViewMode}
              controlledQuoteId={selectedProposalQuoteId}
              onQuoteChange={setSelectedProposalQuoteId}
            />
        </TabsContent>

        <TabsContent value="components" className="w-full">
          <div className="max-w-7xl mx-auto space-y-4 pt-4 px-4">
            <JobComponents job={job} onUpdate={() => onJobUpdate?.()} />
          </div>
        </TabsContent>

        <TabsContent value="schedule" className="w-full">
          <div className="max-w-7xl mx-auto space-y-4 pt-4 px-4">
            <JobSchedule job={job} />
          </div>
        </TabsContent>

        <TabsContent value="documents" className="w-full">
          <div className="max-w-7xl mx-auto space-y-4 pt-4 px-4">
            <JobDocuments job={job} onUpdate={() => onJobUpdate?.()} />
          </div>
        </TabsContent>

        <TabsContent value="photos" className="w-full">
          <div className="max-w-7xl mx-auto space-y-4 pt-4 px-4">
            <JobPhotosView job={job} />
          </div>
        </TabsContent>

        <TabsContent value="orders" className="w-full">
          <div className="max-w-7xl mx-auto space-y-4 pt-4 px-4">
            <JobZohoOrders jobId={job.id} />
          </div>
        </TabsContent>

        <TabsContent value="crew-orders" className="w-full">
          <div className="max-w-7xl mx-auto space-y-4 pt-4 px-4">
            <OfficeCrewOrders
              jobId={job.id}
              onCountChange={setCrewOrdersCount}
            />
          </div>
        </TabsContent>

        <TabsContent value="subcontractors" className="w-full">
          <div className="max-w-7xl mx-auto space-y-4 pt-4 px-4">
            <SubcontractorEstimatesManagement
              jobId={job.id}
              quoteId={selectedProposalQuoteId ?? undefined}
              onProposalChange={setSelectedProposalQuoteId}
            />
          </div>
        </TabsContent>

        <TabsContent value="customer-portal" className="w-full">
          <div className="max-w-7xl mx-auto space-y-4 pt-4 px-4">
            <CustomerPortalManagement key={portalJobId ?? job.id} job={job} portalJobId={portalJobId ?? job.id} getPortalJobId={getPortalJobId} />
          </div>
        </TabsContent>

        <TabsContent value="subcontractor-portal" className="w-full">
          <div className="max-w-7xl mx-auto space-y-4 pt-4 px-4">
            <SubcontractorPortalJobPanel jobId={portalJobId ?? job.id} jobName={job.name} />
          </div>
        </TabsContent>

        <TabsContent value="communications" className="w-full">
          <div className="max-w-7xl mx-auto space-y-4 pt-4 px-4">
            <JobCommunications job={job} />
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!overviewComponentBreakdownKey}
        onOpenChange={(open) => {
          if (!open) setOverviewComponentBreakdownKey(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[min(85vh,720px)] flex flex-col gap-0 p-0 overflow-hidden sm:max-w-2xl">
          <div className="p-6 pb-0 shrink-0">
            <DialogHeader>
              <DialogTitle>{overviewComponentBreakdown?.title ?? 'Time breakdown'}</DialogTitle>
              <DialogDescription className="text-left">
                Totals by worker (man-hours include crew). Below is every time entry for this scope, newest first.
              </DialogDescription>
            </DialogHeader>
          </div>
          {overviewComponentBreakdown ? (
            <div className="px-6 pb-6 flex flex-col gap-4 min-h-0 flex-1 overflow-hidden">
              <div className="shrink-0">
                <p className="text-sm font-semibold text-foreground mb-2">By worker</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Worker</TableHead>
                      <TableHead className="text-right w-[110px]">Man-hours</TableHead>
                      <TableHead className="text-right w-[100px]">Clock hrs</TableHead>
                      <TableHead className="text-right w-[80px]">Entries</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overviewComponentBreakdown.workers.map((w) => (
                      <TableRow key={w.userName}>
                        <TableCell className="font-medium">{w.userName}</TableCell>
                        <TableCell className="text-right tabular-nums">{w.manHours.toFixed(1)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {w.wallHours.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{w.entryCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-col min-h-0 flex-1 border rounded-md bg-muted/25">
                <p className="text-sm font-semibold text-foreground px-3 pt-3 pb-2 shrink-0 border-b bg-muted/40">
                  Entry log
                </p>
                <ul className="overflow-y-auto px-3 py-2 space-y-2 text-sm max-h-[min(40vh,280px)]">
                  {overviewComponentBreakdown.allEntries.map((e) => {
                    const man = (e.total_hours || 0) * (e.crew_count || 1);
                    return (
                      <li
                        key={e.id}
                        className="rounded-md border bg-background/80 px-3 py-2 space-y-1"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-medium">{e.user_name}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {format(new Date(e.start_time), 'MMM d, yyyy')}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                          <span className="tabular-nums font-medium text-foreground">{man.toFixed(1)} man-hrs</span>
                          <span className="tabular-nums">{(e.total_hours || 0).toFixed(2)} clock hrs</span>
                          {e.crew_count > 1 ? <span>{e.crew_count} crew</span> : null}
                          {e.is_manual ? (
                            <Badge variant="outline" className="text-xs">
                              Manual
                            </Badge>
                          ) : (
                            <span>
                              {formatTime(e.start_time)} – {e.end_time ? formatTime(e.end_time) : '—'}
                            </span>
                          )}
                        </div>
                        {e.notes ? <p className="text-xs text-muted-foreground pt-1">{e.notes}</p> : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : overviewComponentBreakdownKey ? (
            <div className="px-6 pb-6 text-sm text-muted-foreground">No entries found for this selection.</div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Email Communications Modal - Custom Implementation */}
      {showEmailDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowEmailDialog(false)} />
          
          {/* Modal Content */}
          <div className="relative bg-white rounded-lg shadow-2xl w-full max-w-[95vw] max-h-[95vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white px-6 py-4 border-b-4 border-blue-800 flex-shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Mail className="w-6 h-6" />
                  <div>
                    <h2 className="text-xl font-bold">Email Communications Center</h2>
                    <p className="text-blue-100 text-sm">{job.name}</p>
                  </div>
                </div>
                <Button onClick={() => setShowEmailDialog(false)} variant="ghost" className="text-white hover:bg-white/10">
                  ✕ Close
                </Button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto bg-slate-50 p-6">
              <JobCommunications job={job} />
            </div>
          </div>
        </div>
      )}
    </div>
    </ProposalSummaryProvider>
    </JobDetailMaterialsToolbarSlotContext.Provider>
    </JobDetailProposalToolbarContext.Provider>
  );
}
