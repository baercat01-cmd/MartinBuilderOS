/**
 * JobExportDialog — downloads all data connected to a job as a structured JSON package.
 *
 * Sections exported:
 *   job_info, proposals, materials (workbooks → sheets → items / labor / markups),
 *   financial_rows (custom rows + line items), subcontractors (estimates + line items),
 *   time_entries, daily_logs, photos, documents, tasks, calendar_events,
 *   customer_payments, components, job_assignments
 *
 * Plus: CSV files for time-entries and materials (useful for payroll / Smartbuild).
 */

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Download,
  FileJson,
  FileSpreadsheet,
  CheckCircle2,
  Loader2,
  Building2,
  DollarSign,
  Package,
  Clock,
  FileText,
  Camera,
  Calendar,
  Briefcase,
  Users,
  CreditCard,
  LayoutList,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Job } from '@/types';

/* ─── Types ──────────────────────────────────────────────────────────────── */

type ExportSection =
  | 'proposals'
  | 'materials'
  | 'financial_rows'
  | 'subcontractors'
  | 'time_entries'
  | 'daily_logs'
  | 'photos'
  | 'documents'
  | 'tasks'
  | 'calendar_events'
  | 'customer_payments'
  | 'components'
  | 'job_assignments';

interface SectionMeta {
  id: ExportSection;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
}

interface ExportState {
  step: 'idle' | 'fetching' | 'building' | 'done' | 'error';
  progress: number;            // 0–100
  currentLabel: string;
  errorMessage?: string;
  result?: ExportResult;
}

interface ExportResult {
  jsonFilename: string;
  jsonBlob: Blob;
  csvFiles: { filename: string; blob: Blob }[];
  stats: Record<ExportSection | 'job_info', number | null>;
}

/* ─── Section catalogue ────────────────────────────────────────────────── */

const SECTIONS: SectionMeta[] = [
  {
    id: 'proposals',
    label: 'Proposals & Quotes',
    description: 'All quotes, proposal numbers, totals, signed status, and snapshot versions',
    icon: DollarSign,
    color: 'text-emerald-600',
  },
  {
    id: 'materials',
    label: 'Materials Workbook',
    description: 'All workbooks → sheets → line items, labor rows, and category markups',
    icon: Package,
    color: 'text-blue-600',
  },
  {
    id: 'financial_rows',
    label: 'Financial Rows & Line Items',
    description: 'Custom financial rows (materials, labor, subcontractor) with individual line items',
    icon: LayoutList,
    color: 'text-violet-600',
  },
  {
    id: 'subcontractors',
    label: 'Subcontractor Estimates',
    description: 'Uploaded sub PDFs, extracted totals, scope, and per-estimate line items',
    icon: Briefcase,
    color: 'text-orange-600',
  },
  {
    id: 'time_entries',
    label: 'Time Entries',
    description: 'All clock-in/out records, component time, crew counts, and manual entries',
    icon: Clock,
    color: 'text-sky-600',
  },
  {
    id: 'daily_logs',
    label: 'Daily Logs',
    description: 'Field logs with weather, work summary, issues, material requests, and crew count',
    icon: FileText,
    color: 'text-amber-600',
  },
  {
    id: 'photos',
    label: 'Photos (metadata)',
    description: 'Photo URLs, GPS coordinates, timestamps, captions, and uploader info',
    icon: Camera,
    color: 'text-pink-600',
  },
  {
    id: 'documents',
    label: 'Documents',
    description: 'Job document list with categories, current versions, and download links',
    icon: FileText,
    color: 'text-slate-600',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    description: 'All job tasks with priority, status, assignee, and due dates',
    icon: CheckCircle2,
    color: 'text-teal-600',
  },
  {
    id: 'calendar_events',
    label: 'Calendar Events',
    description: 'Scheduled events linked to this job',
    icon: Calendar,
    color: 'text-indigo-600',
  },
  {
    id: 'customer_payments',
    label: 'Customer Payments',
    description: 'Recorded payments, dates, amounts, and methods',
    icon: CreditCard,
    color: 'text-green-600',
  },
  {
    id: 'components',
    label: 'Components',
    description: 'Assigned components and their completion status',
    icon: LayoutList,
    color: 'text-rose-600',
  },
  {
    id: 'job_assignments',
    label: 'Job Assignments',
    description: 'Which users (foremen) are assigned to this job',
    icon: Users,
    color: 'text-cyan-600',
  },
];

/* ─── CSV helpers ───────────────────────────────────────────────────────── */

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };
  const header = keys.map(escape).join(',');
  const body = rows.map((row) => keys.map((k) => escape(row[k])).join(',')).join('\n');
  return `${header}\n${body}`;
}

function timeEntriesToCsvRows(entries: any[]): Record<string, unknown>[] {
  return entries.map((e) => ({
    date: e.start_time ? new Date(e.start_time).toISOString().split('T')[0] : '',
    start_time: e.start_time ?? '',
    end_time: e.end_time ?? '',
    total_hours: e.total_hours ?? '',
    crew_count: e.crew_count ?? 1,
    man_hours: ((e.total_hours ?? 0) * (e.crew_count ?? 1)).toFixed(2),
    user_id: e.user_id ?? '',
    user_name: e.user_name ?? '',
    component_id: e.component_id ?? '',
    component_name: e.component_name ?? '',
    is_manual: e.is_manual ? 'yes' : 'no',
    notes: e.notes ?? '',
  }));
}

function materialItemsToCsvRows(items: any[]): Record<string, unknown>[] {
  return items.map((it) => ({
    workbook_version: it._workbook_version ?? '',
    sheet_name: it._sheet_name ?? '',
    category: it.category ?? '',
    sku: it.sku ?? '',
    material_name: it.material_name ?? '',
    quantity: it.quantity ?? '',
    length: it.length ?? '',
    cost_per_unit: it.cost_per_unit ?? '',
    price_per_unit: it.price_per_unit ?? '',
    extended_cost: it.extended_cost ?? '',
    extended_price: it.extended_price ?? '',
    status: it.status ?? '',
    color: it.color ?? '',
    taxable: it.taxable ? 'yes' : 'no',
    notes: it.notes ?? '',
  }));
}

/* ─── Main fetch logic ──────────────────────────────────────────────────── */

async function fetchAllJobData(
  job: Job,
  selectedSections: Set<ExportSection>,
  onProgress: (pct: number, label: string) => void,
) {
  const data: Record<string, unknown> = {
    export_meta: {
      exported_at: new Date().toISOString(),
      job_id: job.id,
      job_name: job.name,
      client_name: job.client_name,
      sections_included: [...selectedSections].sort(),
    },
    job_info: { ...job },
  };

  const stats: Record<string, number | null> = { job_info: 1 };
  const steps = selectedSections.size;
  let done = 0;

  const tick = (label: string) => {
    done++;
    onProgress(Math.round((done / steps) * 90), label);
  };

  /* ── Proposals ── */
  if (selectedSections.has('proposals')) {
    tick('Loading proposals…');
    const { data: quotes } = await supabase
      .from('quotes')
      .select('*')
      .eq('job_id', job.id)
      .order('created_at', { ascending: false });

    const quotesWithVersions: any[] = [];
    for (const q of quotes || []) {
      const { data: versions } = await supabase
        .from('proposal_versions')
        .select('id, version_number, is_signed, signed_at, created_at, change_notes, customer_name, estimated_price')
        .eq('quote_id', q.id)
        .order('version_number', { ascending: false });
      quotesWithVersions.push({ ...q, versions: versions || [] });
    }
    data.proposals = quotesWithVersions;
    stats.proposals = quotesWithVersions.length;
  }

  /* ── Materials ── */
  if (selectedSections.has('materials')) {
    tick('Loading materials workbooks…');
    const { data: wbs } = await supabase
      .from('material_workbooks')
      .select('*')
      .eq('job_id', job.id)
      .order('version_number', { ascending: true });

    const fullWbs: any[] = [];
    for (const wb of wbs || []) {
      const { data: sheets } = await supabase
        .from('material_sheets')
        .select('*')
        .eq('workbook_id', wb.id)
        .order('order_index');

      const fullSheets: any[] = [];
      for (const sh of sheets || []) {
        const [items, labor, markups] = await Promise.all([
          supabase.from('material_items').select('*').eq('sheet_id', sh.id).order('order_index'),
          supabase.from('material_sheet_labor').select('*').eq('sheet_id', sh.id),
          supabase.from('material_category_markups').select('*').eq('sheet_id', sh.id),
        ]);
        fullSheets.push({
          ...sh,
          items: items.data || [],
          labor: labor.data || [],
          category_markups: markups.data || [],
        });
      }
      fullWbs.push({ ...wb, sheets: fullSheets });
    }
    data.materials = { workbooks: fullWbs };
    const itemCount = fullWbs
      .flatMap((w) => w.sheets)
      .flatMap((s) => s.items).length;
    stats.materials = itemCount;
  }

  /* ── Financial rows ── */
  if (selectedSections.has('financial_rows')) {
    tick('Loading financial rows…');
    const { data: rows } = await supabase
      .from('custom_financial_rows')
      .select('*')
      .eq('job_id', job.id)
      .order('order_index');

    const rowsWithItems: any[] = [];
    for (const row of rows || []) {
      const { data: items } = await supabase
        .from('custom_financial_row_items')
        .select('*')
        .eq('row_id', row.id)
        .order('order_index');
      rowsWithItems.push({ ...row, line_items: items || [] });
    }
    data.financial_rows = rowsWithItems;
    stats.financial_rows = rowsWithItems.length;
  }

  /* ── Subcontractors ── */
  if (selectedSections.has('subcontractors')) {
    tick('Loading subcontractor estimates…');
    const { data: ests } = await supabase
      .from('subcontractor_estimates')
      .select('*')
      .eq('job_id', job.id)
      .order('order_index');

    const estsWithItems: any[] = [];
    for (const est of ests || []) {
      const { data: items } = await supabase
        .from('subcontractor_estimate_line_items')
        .select('*')
        .eq('estimate_id', est.id)
        .order('order_index');
      estsWithItems.push({ ...est, line_items: items || [] });
    }
    data.subcontractors = estsWithItems;
    stats.subcontractors = estsWithItems.length;
  }

  /* ── Time entries ── */
  if (selectedSections.has('time_entries')) {
    tick('Loading time entries…');
    const { data: entries } = await supabase
      .from('time_entries')
      .select(`
        *,
        components(name),
        user_profiles(username, email)
      `)
      .eq('job_id', job.id)
      .order('start_time', { ascending: false });

    const enriched = (entries || []).map((e: any) => ({
      ...e,
      component_name: e.components?.name ?? null,
      user_name: e.user_profiles?.username ?? e.user_profiles?.email ?? null,
      components: undefined,
      user_profiles: undefined,
    }));
    data.time_entries = enriched;
    stats.time_entries = enriched.length;
  }

  /* ── Daily logs ── */
  if (selectedSections.has('daily_logs')) {
    tick('Loading daily logs…');
    const { data: logs } = await supabase
      .from('daily_logs')
      .select(`
        *,
        user_profiles(username)
      `)
      .eq('job_id', job.id)
      .order('log_date', { ascending: false });

    const enriched = (logs || []).map((l: any) => ({
      ...l,
      user_name: l.user_profiles?.username ?? null,
      user_profiles: undefined,
    }));
    data.daily_logs = enriched;
    stats.daily_logs = enriched.length;
  }

  /* ── Photos ── */
  if (selectedSections.has('photos')) {
    tick('Loading photos…');
    const { data: photos } = await supabase
      .from('photos')
      .select(`
        *,
        user_profiles(username)
      `)
      .eq('job_id', job.id)
      .order('photo_date', { ascending: false });

    const enriched = (photos || []).map((p: any) => ({
      ...p,
      uploader_name: p.user_profiles?.username ?? null,
      user_profiles: undefined,
    }));
    data.photos = enriched;
    stats.photos = enriched.length;
  }

  /* ── Documents ── */
  if (selectedSections.has('documents')) {
    tick('Loading documents…');
    const { data: docs } = await supabase
      .from('job_documents')
      .select(`
        *,
        job_document_revisions(*)
      `)
      .eq('job_id', job.id)
      .order('created_at', { ascending: false });

    data.documents = docs || [];
    stats.documents = (docs || []).length;
  }

  /* ── Tasks ── */
  if (selectedSections.has('tasks')) {
    tick('Loading tasks…');
    const { data: tasks } = await supabase
      .from('job_tasks')
      .select(`
        *,
        assignee:user_profiles!job_tasks_assigned_to_fkey(username),
        creator:user_profiles!job_tasks_created_by_fkey(username)
      `)
      .eq('job_id', job.id)
      .order('created_at', { ascending: false });

    const enriched = (tasks || []).map((t: any) => ({
      ...t,
      assigned_to_name: t.assignee?.username ?? null,
      created_by_name: t.creator?.username ?? null,
      assignee: undefined,
      creator: undefined,
    }));
    data.tasks = enriched;
    stats.tasks = enriched.length;
  }

  /* ── Calendar events ── */
  if (selectedSections.has('calendar_events')) {
    tick('Loading calendar events…');
    const { data: events } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('job_id', job.id)
      .order('event_date', { ascending: false });

    data.calendar_events = events || [];
    stats.calendar_events = (events || []).length;
  }

  /* ── Customer payments ── */
  if (selectedSections.has('customer_payments')) {
    tick('Loading customer payments…');
    const { data: payments } = await supabase
      .from('customer_payments')
      .select('*')
      .eq('job_id', job.id)
      .order('payment_date', { ascending: false });

    data.customer_payments = payments || [];
    stats.customer_payments = (payments || []).length;
  }

  /* ── Components ── */
  if (selectedSections.has('components')) {
    tick('Loading components…');
    const jobComponents: any[] = Array.isArray((job as any).components)
      ? (job as any).components
      : [];
    const compIds = jobComponents.map((c: any) => c.id).filter(Boolean);

    let components: any[] = [];
    if (compIds.length) {
      const { data: comps } = await supabase
        .from('components')
        .select('*')
        .in('id', compIds);
      components = (comps || []).map((c) => {
        const meta = jobComponents.find((jc: any) => jc.id === c.id) || {};
        return { ...c, job_meta: meta };
      });
    }

    const { data: completed } = await supabase
      .from('completed_tasks')
      .select('*')
      .eq('job_id', job.id);

    data.components = { components, completed_tasks: completed || [] };
    stats.components = components.length;
  }

  /* ── Job assignments ── */
  if (selectedSections.has('job_assignments')) {
    tick('Loading job assignments…');
    const { data: assignments } = await supabase
      .from('job_assignments')
      .select(`
        *,
        user:user_profiles!job_assignments_user_id_fkey(username, role)
      `)
      .eq('job_id', job.id);

    const enriched = (assignments || []).map((a: any) => ({
      ...a,
      user_name: a.user?.username ?? null,
      user_role: a.user?.role ?? null,
      user: undefined,
    }));
    data.job_assignments = enriched;
    stats.job_assignments = enriched.length;
  }

  onProgress(95, 'Building CSV files…');

  /* ── Build CSV exports ── */
  const csvFiles: { filename: string; blob: Blob }[] = [];
  const safeName = job.name.replace(/[^a-z0-9]/gi, '_').slice(0, 40);

  if (selectedSections.has('time_entries') && (data.time_entries as any[])?.length) {
    const rows = timeEntriesToCsvRows(data.time_entries as any[]);
    const csv = toCsv(rows);
    csvFiles.push({
      filename: `${safeName}_time_entries.csv`,
      blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    });
  }

  if (selectedSections.has('materials')) {
    const allItems: any[] = ((data.materials as any)?.workbooks ?? []).flatMap((wb: any) =>
      wb.sheets.flatMap((sh: any) =>
        sh.items.map((it: any) => ({
          ...it,
          _workbook_version: wb.version_number,
          _sheet_name: sh.sheet_name,
        })),
      ),
    );
    if (allItems.length) {
      const rows = materialItemsToCsvRows(allItems);
      const csv = toCsv(rows);
      csvFiles.push({
        filename: `${safeName}_materials.csv`,
        blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      });
    }
  }

  onProgress(98, 'Packaging…');

  const json = JSON.stringify(data, null, 2);
  const jsonBlob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  return {
    jsonFilename: `${safeName}_export_${timestamp}.json`,
    jsonBlob,
    csvFiles,
    stats: stats as ExportResult['stats'],
  };
}

/* ─── Component ─────────────────────────────────────────────────────────── */

interface JobExportDialogProps {
  job: Job;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JobExportDialog({ job, open, onOpenChange }: JobExportDialogProps) {
  const [selected, setSelected] = useState<Set<ExportSection>>(
    new Set(SECTIONS.map((s) => s.id)),
  );
  const [state, setState] = useState<ExportState>({
    step: 'idle',
    progress: 0,
    currentLabel: '',
  });

  const toggleSection = (id: ExportSection) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(SECTIONS.map((s) => s.id)));
  const clearAll = () => setSelected(new Set());

  const handleExport = async () => {
    if (selected.size === 0) {
      toast.error('Select at least one section to export.');
      return;
    }

    setState({ step: 'fetching', progress: 5, currentLabel: 'Starting export…' });

    try {
      const result = await fetchAllJobData(job, selected, (pct, label) => {
        setState((prev) => ({ ...prev, progress: pct, currentLabel: label }));
      });

      setState({
        step: 'done',
        progress: 100,
        currentLabel: 'Export ready!',
        result,
      });
    } catch (err: any) {
      console.error('Export error:', err);
      setState({
        step: 'error',
        progress: 0,
        currentLabel: '',
        errorMessage: err?.message || 'Unknown error',
      });
    }
  };

  const downloadJson = () => {
    if (!state.result) return;
    const url = URL.createObjectURL(state.result.jsonBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.result.jsonFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const downloadCsv = (file: { filename: string; blob: Blob }) => {
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const handleClose = (open: boolean) => {
    if (state.step === 'fetching') return; // block accidental close while loading
    if (!open) {
      setState({ step: 'idle', progress: 0, currentLabel: '' });
    }
    onOpenChange(open);
  };

  const isBusy = state.step === 'fetching' || state.step === 'building';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* Header */}
        <div className="shrink-0 bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-5">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white flex items-center gap-3">
              <Download className="w-6 h-6 text-yellow-400" />
              Export Job Data
            </DialogTitle>
            <DialogDescription className="text-slate-300 mt-1">
              <span className="font-semibold text-yellow-200">{job.name}</span> —{' '}
              {job.client_name} · {job.address}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5 bg-white">

          {/* Idle: section selector */}
          {state.step === 'idle' && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">
                  Choose which sections to include in the export.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll}>All</Button>
                  <Button variant="outline" size="sm" onClick={clearAll}>None</Button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SECTIONS.map((sec) => {
                  const Icon = sec.icon;
                  const checked = selected.has(sec.id);
                  return (
                    <label
                      key={sec.id}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        checked
                          ? 'border-slate-400 bg-slate-50'
                          : 'border-slate-200 bg-white hover:bg-slate-50/60'
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleSection(sec.id)}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 shrink-0 ${sec.color}`} />
                          <span className="text-sm font-semibold text-slate-900">{sec.label}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 leading-snug">{sec.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 space-y-1">
                <p className="font-semibold">What you get</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>
                    <strong>JSON file</strong> — full structured export of all selected sections (job info always included)
                  </li>
                  <li>
                    <strong>Time entries CSV</strong> — ready for payroll or analysis (when section selected)
                  </li>
                  <li>
                    <strong>Materials CSV</strong> — all line items flat for Smartbuild / Excel (when section selected)
                  </li>
                </ul>
              </div>
            </>
          )}

          {/* In-progress */}
          {isBusy && (
            <div className="py-8 flex flex-col items-center gap-6">
              <Loader2 className="w-12 h-12 animate-spin text-yellow-600" />
              <div className="w-full space-y-2 text-center">
                <p className="text-base font-semibold text-slate-800">{state.currentLabel}</p>
                <Progress value={state.progress} className="h-2.5 w-full max-w-xs mx-auto" />
                <p className="text-sm text-slate-500">{state.progress}% complete</p>
              </div>
            </div>
          )}

          {/* Done */}
          {state.step === 'done' && state.result && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
                <div>
                  <p className="font-bold text-emerald-900 text-base">Export ready!</p>
                  <p className="text-sm text-emerald-700">
                    Click below to download your files.
                  </p>
                </div>
              </div>

              {/* JSON download */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <FileJson className="w-8 h-8 text-blue-600 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{state.result.jsonFilename}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Full structured export — all selected sections
                    </p>
                  </div>
                </div>
                <Button onClick={downloadJson} className="bg-blue-600 hover:bg-blue-700 shrink-0">
                  <Download className="w-4 h-4 mr-2" />
                  Download JSON
                </Button>
              </div>

              {/* CSV downloads */}
              {state.result.csvFiles.map((f) => (
                <div
                  key={f.filename}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="w-8 h-8 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-900 text-sm">{f.filename}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {f.filename.includes('time') ? 'Payroll-ready time entries' : 'Flat material items table'}
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => downloadCsv(f)}
                    variant="outline"
                    className="border-emerald-400 text-emerald-800 hover:bg-emerald-50 shrink-0"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download CSV
                  </Button>
                </div>
              ))}

              {/* Stats */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Export summary
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SECTIONS.filter((s) => selected.has(s.id)).map((s) => {
                    const count = state.result!.stats[s.id];
                    const Icon = s.icon;
                    return (
                      <div key={s.id} className="flex items-center gap-2 text-sm">
                        <Icon className={`w-4 h-4 shrink-0 ${s.color}`} />
                        <span className="text-slate-600 truncate">{s.label}</span>
                        <Badge variant="secondary" className="ml-auto shrink-0 text-xs font-mono">
                          {count ?? '—'}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {state.step === 'error' && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <AlertCircle className="w-12 h-12 text-red-500" />
              <div>
                <p className="font-bold text-red-900 text-base">Export failed</p>
                <p className="text-sm text-red-700 mt-1">{state.errorMessage}</p>
              </div>
              <Button
                variant="outline"
                onClick={() => setState({ step: 'idle', progress: 0, currentLabel: '' })}
              >
                Try again
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t px-6 py-4 flex justify-between items-center bg-slate-50">
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={isBusy}
          >
            {state.step === 'done' ? 'Close' : 'Cancel'}
          </Button>

          {(state.step === 'idle' || state.step === 'error') && (
            <Button
              onClick={handleExport}
              disabled={selected.size === 0}
              className="bg-yellow-600 hover:bg-yellow-700 text-black font-bold"
            >
              <Download className="w-4 h-4 mr-2" />
              Export {selected.size} section{selected.size !== 1 ? 's' : ''}
            </Button>
          )}

          {state.step === 'done' && (
            <Button
              variant="outline"
              onClick={() => setState({ step: 'idle', progress: 0, currentLabel: '' })}
            >
              Export again
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
