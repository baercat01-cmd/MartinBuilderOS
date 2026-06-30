import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, MapPin, FileText, Clock, Camera, BarChart3, Archive, ArchiveRestore, Edit, FileCheck, Calendar, AlertTriangle, MoreVertical, DollarSign, TrendingUp, TrendingDown, ScrollText, Mail, Reply, Send, PauseCircle, PlayCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import type { Job } from '@/types';
import { CreateJobDialog } from './CreateJobDialog';
import { EditJobDialog } from './EditJobDialog';
import { JobDocuments } from './JobDocuments';
import { JobComponents } from './JobComponents';
import { JobTimeEntries } from './JobTimeEntries';
import { JobDetailedView } from './JobDetailedView';
import { MaterialsManagement } from './MaterialsManagement';
import { JobPhotosView } from './JobPhotosView';
import { JobSchedule } from './JobSchedule';
import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package, Calendar as CalendarIcon } from 'lucide-react';
import { TodayTasksSidebar } from './TodayTasksSidebar';
import { ShopMaterialsDialog } from './ShopMaterialsDialog';
import { Warehouse, ShoppingCart } from 'lucide-react';
import { JobBudgetManagement } from './JobBudgetManagement';
import { MaterialOrdersManagement } from './MaterialOrdersManagement';
import { isAbortLikeError } from '@/lib/error-handler';
import {
  readPersistedOpenJobId,
  readPersistedOpenJobTab,
  persistOpenJob,
  agentLog,
} from '@/lib/officeViewPersistence';
import { isVisibleJobCard } from '@/lib/defaultJobs';

interface JobsViewProps {
  showArchived?: boolean;
  selectedJobId?: string | null;
  openMaterialsTab?: boolean; // New prop to auto-open materials tab
  onAddTask?: () => void; // Callback to open task creation dialog
  onOpenJobChange?: (jobId: string | null) => void;
  /** When false, hide the job dialog but keep internal state (e.g. user switched office tabs). */
  jobsTabActive?: boolean;
  /** When true, hide the jobs list UI but keep the detail dialog mountable. */
  hideJobList?: boolean;
  /** Parent owns the fullscreen job dialog (OfficeDashboard). */
  delegateJobDialog?: boolean;
  onRequestOpenJob?: (job: Job, tab?: string) => void;
  onRequestCloseJob?: () => void;
}

export function JobsView({
  showArchived = false,
  selectedJobId,
  openMaterialsTab = false,
  onAddTask,
  onOpenJobChange,
  jobsTabActive = true,
  hideJobList = false,
  delegateJobDialog = false,
  onRequestOpenJob,
  onRequestCloseJob,
}: JobsViewProps) {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  /** Single source of truth for which job the detail dialog is for. Used for portal link so it never points at the wrong job. */
  const initialOpenJobId = (() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('jobId') || readPersistedOpenJobId();
  })();
  const [detailDialogJobId, setDetailDialogJobId] = useState<string | null>(initialOpenJobId);
  /** Ref set synchronously when dialog opens so portal "Save & create link" always uses the job the user opened (avoids stale state). */
  const portalJobIdRef = useRef<string | null>(initialOpenJobId);
  const [selectedTab, setSelectedTab] = useState(() => {
    if (typeof window === 'undefined') return 'overview';
    const params = new URLSearchParams(window.location.search);
    return params.get('jobTab') || readPersistedOpenJobTab() || 'overview';
  });
  const restoredJobRef = useRef(false);
  const selectedJobRef = useRef<Job | null>(null);
  const jobsRef = useRef(jobs);
  const loadingRef = useRef(loading);
  const selectedTabRef = useRef(selectedTab);
  const detailDialogJobIdRef = useRef(detailDialogJobId);
  const searchParamsRef = useRef(searchParams);
  selectedJobRef.current = selectedJob;
  jobsRef.current = jobs;
  loadingRef.current = loading;
  selectedTabRef.current = selectedTab;
  detailDialogJobIdRef.current = detailDialogJobId;
  searchParamsRef.current = searchParams;

  function syncJobToUrl(jobId: string | null, tab?: string | null) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (jobId) {
        next.set('jobId', jobId);
        if (tab) next.set('jobTab', tab);
      } else {
        next.delete('jobId');
        next.delete('jobTab');
      }
      return next;
    }, { replace: true });
  }

  function tryRestoreOpenJob(source: string) {
    if (selectedJobRef.current) {
      agentLog({ location: 'JobsView.tsx:tryRestoreOpenJob', message: 'skip: selectedJob set', data: { source }, hypothesisId: 'H' });
      return false;
    }
    if (loadingRef.current) {
      agentLog({ location: 'JobsView.tsx:tryRestoreOpenJob', message: 'skip: still loading', data: { source }, hypothesisId: 'H' });
      return false;
    }
    if (jobsRef.current.length === 0) {
      agentLog({ location: 'JobsView.tsx:tryRestoreOpenJob', message: 'skip: no jobs', data: { source }, hypothesisId: 'H' });
      return false;
    }
    const urlJobId = searchParamsRef.current.get('jobId');
    const persistedId = urlJobId || selectedJobId || readPersistedOpenJobId() || detailDialogJobIdRef.current;
    if (!persistedId) {
      agentLog({ location: 'JobsView.tsx:tryRestoreOpenJob', message: 'skip: no persisted id', data: { source, urlJobId }, hypothesisId: 'H' });
      return false;
    }
    const job = jobsRef.current.find((j) => j.id === persistedId);
    if (!job) {
      agentLog({ location: 'JobsView.tsx:tryRestoreOpenJob', message: 'skip: job not in list', data: { source, persistedId }, hypothesisId: 'H' });
      return false;
    }
    const tab =
      searchParamsRef.current.get('jobTab') ||
      readPersistedOpenJobTab() ||
      (openMaterialsTab ? 'proposal-materials' : 'overview');
    setSelectedTab(tab);
    openJobDetail(job, tab);
    agentLog({
      location: 'JobsView.tsx:tryRestoreOpenJob',
      message: 'restored persisted job',
      data: { source, jobId: persistedId, tab, urlJobId },
      hypothesisId: 'F',
      runId: 'post-fix',
    });
    return true;
  }

  function handleJobDialogOpenChange(open: boolean) {
    agentLog({
      location: 'JobsView.tsx:handleJobDialogOpenChange',
      message: 'dialog onOpenChange',
      data: {
        open,
        visibility: document.visibilityState,
        persistedJobId: readPersistedOpenJobId(),
        detailDialogJobId: detailDialogJobIdRef.current,
        hasSelectedJob: !!selectedJobRef.current,
      },
      hypothesisId: 'E',
      runId: 'post-fix',
    });
    if (open) return;
  }

  function openJobDetail(job: Job, tab?: string) {
    const effectiveTab = tab ?? selectedTab;
    if (delegateJobDialog && onRequestOpenJob) {
      setSelectedTab(effectiveTab);
      onRequestOpenJob(job, effectiveTab);
      agentLog({ location: 'JobsView.tsx:openJobDetail', message: 'delegated openJobDetail', data: { jobId: job.id, tab: effectiveTab }, hypothesisId: 'J' });
      return;
    }
    portalJobIdRef.current = job.id;
    setSelectedJob(job);
    setDetailDialogJobId(job.id);
    setSelectedTab(effectiveTab);
    persistOpenJob(job.id, effectiveTab);
    syncJobToUrl(job.id, effectiveTab);
    onOpenJobChange?.(job.id);
    agentLog({ location: 'JobsView.tsx:openJobDetail', message: 'openJobDetail', data: { jobId: job.id, tab: effectiveTab }, hypothesisId: 'F' });
  }
  function closeJobDetail() {
    if (delegateJobDialog && onRequestCloseJob) {
      onRequestCloseJob();
      agentLog({ location: 'JobsView.tsx:closeJobDetail', message: 'delegated closeJobDetail', data: {}, hypothesisId: 'J' });
      return;
    }
    portalJobIdRef.current = null;
    setSelectedJob(null);
    setDetailDialogJobId(null);
    persistOpenJob(null);
    syncJobToUrl(null);
    onOpenJobChange?.(null);
    agentLog({ location: 'JobsView.tsx:closeJobDetail', message: 'closeJobDetail', data: { visibility: document.visibilityState }, hypothesisId: 'B' });
  }
  const [stats, setStats] = useState<Record<string, any>>({});
  const [statusFilter, setStatusFilter] = useState<'active' | 'quoting' | 'on_hold'>('active');
  const [crewOrderCounts, setCrewOrderCounts] = useState<Record<string, number>>({});
  const [showShopMaterialsDialog, setShowShopMaterialsDialog] = useState(false);
  const [showOrdersDialog, setShowOrdersDialog] = useState(false);
  const [jobBudgets, setJobBudgets] = useState<Record<string, any>>({});
  /** Figured labor hours per job, derived from the proposal's sheet labor. Used as the
   *  "time figured" fallback for the progress bar when a job has no manual Estimated Hours. */
  const [jobFiguredHours, setJobFiguredHours] = useState<Record<string, number>>({});
  const [showBudgetDialog, setShowBudgetDialog] = useState(false);
  const [budgetJobId, setBudgetJobId] = useState<string | null>(null);
  const [jobQuotes, setJobQuotes] = useState<Record<string, any>>({});
  /** Primary proposal is on hold (quote row) — board shows these in On Hold alongside job.status === 'on_hold' */
  const isPrimaryProposalOnHold = (jobId: string) => !!jobQuotes[jobId]?.on_hold;
  /** Combined on-hold state for menu labels: the per-proposal flag OR job-level on-hold fallback. */
  const isJobOnHoldForBoard = (job: any) =>
    !!job && (isPrimaryProposalOnHold(job.id) || job.status === 'on_hold');

  /**
   * Labor progress bar (time clocked vs. figured) shared by the quoting / on-hold / other
   * job columns. "Time figured" prefers manual Estimated Hours, else the proposal's figured
   * labor hours. Renders nothing when there are no figured hours to compare against.
   */
  const renderJobLaborBar = (job: any) => {
    const jobStats = stats[job.id] || {};
    const figuredHours =
      job.estimated_hours && job.estimated_hours > 0
        ? job.estimated_hours
        : jobFiguredHours[job.id] || 0;
    if (!(figuredHours > 0)) return null;
    const clockInHours = Number(jobStats.totalClockInHours) || 0;
    const pct = (clockInHours / figuredHours) * 100;
    const overBudget = clockInHours > figuredHours;
    return (
      <div className="space-y-1.5 pt-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Progress (Clock-In)</span>
          <span className="font-bold">{pct.toFixed(0)}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${overBudget ? 'bg-destructive' : 'bg-primary'}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{jobStats.totalHours || '0'} / {figuredHours} hrs</span>
          {overBudget && <span className="text-destructive font-medium">Over Budget</span>}
        </div>
      </div>
    );
  };
  const [recentMessages, setRecentMessages] = useState<Array<{ id: string; job_id: string; subject: string; from_name: string | null; from_email: string | null; body_text: string | null; email_date: string; direction?: string; jobs: { id: string; name: string } | null }>>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showReplyDialog, setShowReplyDialog] = useState(false);
  const [replyToMessage, setReplyToMessage] = useState<typeof recentMessages[0] | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [showNewMessageDialog, setShowNewMessageDialog] = useState(false);
  const [newMessageJobId, setNewMessageJobId] = useState<string>('');
  const [newMessageSubject, setNewMessageSubject] = useState('');
  const [newMessageBody, setNewMessageBody] = useState('');
  const [sendingNewMessage, setSendingNewMessage] = useState(false);
  const [customerMessagesOpen, setCustomerMessagesOpen] = useState(false);
  const [lastSeenCustomerMessageAt, setLastSeenCustomerMessageAt] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('office_customer_messages_last_seen_at');
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  });

  const customerMessageThreads = useMemo(() => {
    const byJob = new Map<string, (typeof recentMessages)>();
    for (const msg of recentMessages) {
      const key = msg.job_id || 'unknown';
      if (!byJob.has(key)) byJob.set(key, []);
      byJob.get(key)!.push(msg);
    }
    return Array.from(byJob.entries())
      .map(([jobId, msgs]) => {
        const sortedDesc = [...msgs].sort(
          (a, b) => new Date(b.email_date).getTime() - new Date(a.email_date).getTime()
        );
        const sortedAsc = [...msgs].sort(
          (a, b) => new Date(a.email_date).getTime() - new Date(b.email_date).getTime()
        );
        const latest = sortedDesc[0];
        const latestInbound = sortedDesc.find((m) => m.direction === 'inbound') ?? null;
        return {
          jobId,
          latest,
          latestInbound,
          messages: sortedAsc,
          jobName: latest?.jobs?.name ?? 'Unknown job',
          customerName:
            (latestInbound?.from_name || latestInbound?.from_email || latest?.from_name || latest?.from_email || 'Customer') as string,
        };
      })
      .sort((a, b) => new Date(b.latest.email_date).getTime() - new Date(a.latest.email_date).getTime());
  }, [recentMessages]);
  const unreadCustomerMessageCount = useMemo(
    () =>
      recentMessages.filter(
        (m) =>
          m.direction === 'inbound' &&
          new Date(m.email_date).getTime() > lastSeenCustomerMessageAt
      ).length,
    [recentMessages, lastSeenCustomerMessageAt]
  );

  function markCustomerMessagesSeen() {
    const nowTs = Date.now();
    setLastSeenCustomerMessageAt(nowTs);
    try {
      localStorage.setItem('office_customer_messages_last_seen_at', String(nowTs));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadJobs();
    loadCrewOrderCounts();
    loadJobBudgets();
    loadJobQuotes();
    loadJobFiguredHours();
    if (!showArchived) loadRecentMessages();

    // Subscribe to material changes to update crew order counts in real-time
    const materialsChannel = supabase
      .channel('materials_changes_for_counts')
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'materials'
        },
        () => {
          loadCrewOrderCounts(); // Reload counts when materials change
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(materialsChannel);
    };
  }, []);

  // #region agent log
  useEffect(() => {
    agentLog({
      location: 'JobsView.tsx:mount',
      message: 'JobsView mounted',
      data: {
        initialOpenJobId,
        jobsTabActive,
        persistedJobId: readPersistedOpenJobId(),
        url: typeof window !== 'undefined' ? window.location.search : '',
      },
      hypothesisId: 'H',
    });
  }, []);
  // #endregion

  // Keep dialog job id in sync when parent sets selectedJobId (e.g. after app resume).
  useEffect(() => {
    if (delegateJobDialog) return;
    if (!selectedJobId) return;
    if (detailDialogJobId !== selectedJobId) {
      setDetailDialogJobId(selectedJobId);
      portalJobIdRef.current = selectedJobId;
      const tab = searchParams.get('jobTab') || readPersistedOpenJobTab() || selectedTab;
      persistOpenJob(selectedJobId, tab);
      syncJobToUrl(selectedJobId, tab);
    }
  }, [selectedJobId, detailDialogJobId, searchParams, selectedTab]);

  // Hydrate selectedJob when jobs list loads and we already know which job should be open.
  useEffect(() => {
    if (delegateJobDialog) return;
    if (selectedJob || !detailDialogJobId || jobs.length === 0) return;
    const job = jobs.find((j) => j.id === detailDialogJobId);
    if (job) {
      setSelectedJob(job);
      agentLog({
        location: 'JobsView.tsx:hydrateSelectedJob',
        message: 'hydrated selectedJob from detailDialogJobId',
        data: { jobId: detailDialogJobId },
        hypothesisId: 'H',
      });
    }
  }, [jobs, selectedJob, detailDialogJobId]);

  // Restore open job after reload/remount or when URL has jobId but dialog is closed.
  useEffect(() => {
    if (delegateJobDialog) return;
    if (restoredJobRef.current && selectedJob) return;
    if (tryRestoreOpenJob('mount-or-url')) restoredJobRef.current = true;
  }, [jobs, loading, selectedJob, selectedJobId, openMaterialsTab, searchParams]);

  // Re-open from URL if dialog was lost while app was backgrounded.
  useEffect(() => {
    if (delegateJobDialog) return;
    const urlJobId = searchParams.get('jobId');
    if (!urlJobId || selectedJob || loading || jobs.length === 0) return;
    tryRestoreOpenJob('url-watch');
  }, [searchParams, jobs, loading, selectedJob]);

  // Snapshot on hide; restore on visible if the dialog was lost while backgrounded.
  useEffect(() => {
    if (delegateJobDialog) return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        const jobId = detailDialogJobIdRef.current || portalJobIdRef.current;
        if (jobId) persistOpenJob(jobId, readPersistedOpenJobTab() || selectedTabRef.current);
        agentLog({ location: 'JobsView.tsx:visibility:hidden', message: 'snapshot open job', data: { jobId }, hypothesisId: 'E', runId: 'post-fix' });
        return;
      }
      agentLog({
        location: 'JobsView.tsx:visibility:visible',
        message: 'attempt restore',
        data: { persistedJobId: readPersistedOpenJobId(), hasSelectedJob: !!selectedJobRef.current },
        hypothesisId: 'E',
        runId: 'post-fix',
      });
      tryRestoreOpenJob('visibility');
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [selectedJobId, openMaterialsTab]);

  // #region agent log
  useEffect(() => {
    if (delegateJobDialog) return;
    const onPageShow = (e: PageTransitionEvent) => {
      agentLog({
        location: 'JobsView.tsx:pageshow',
        message: 'pageshow',
        data: { persisted: e.persisted, persistedJobId: readPersistedOpenJobId(), hasSelectedJob: !!selectedJob },
        hypothesisId: 'B',
      });
      if (e.persisted) tryRestoreOpenJob('pageshow');
    };
    window.addEventListener('pageshow', onPageShow as EventListener);
    return () => window.removeEventListener('pageshow', onPageShow as EventListener);
  }, [selectedJob]);
  // #endregion

  // When dialog is closed, open the job for selectedJobId (e.g. from notification or calendar).
  // When dialog is already open, do NOT overwrite selectedJob — otherwise the detail view would
  // switch to another job (e.g. last created) and "Save & create link" would create for the wrong job.
  useEffect(() => {
    if (!selectedJobId) return;
    const job = jobs.find((j) => j.id === selectedJobId);
    if (!job) return;
    if (selectedJob?.id === selectedJobId) return;
    if (selectedJob) return;
    const tab =
      searchParams.get('jobTab') ||
      readPersistedOpenJobTab() ||
      (openMaterialsTab ? 'proposal-materials' : selectedTab);
    openJobDetail(job, tab);
    setTimeout(() => {
      const element = document.getElementById(`job-${selectedJobId}`);
      if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }, [selectedJobId, jobs, openMaterialsTab, selectedJob, searchParams, selectedTab]);

  async function loadJobs() {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setJobs(data || []);
      
      for (const job of data || []) {
        loadJobStats(job.id);
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error('Error loading jobs:', error);
    } finally {
      setLoading(false);
    }
  }

  async function toggleArchiveJob(jobId: string, currentStatus: string) {
    try {
      // Default to 'active' if status is undefined/null
      const effectiveStatus = currentStatus || 'active';
      const newStatus = effectiveStatus === 'archived' ? 'active' : 'archived';
      
      console.log('Archiving job:', { jobId, currentStatus: effectiveStatus, newStatus });
      
      const { data, error } = await supabase
        .from('jobs')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .select();

      if (error) {
        console.error('Database error:', error);
        throw error;
      }
      
      console.log('Archive result:', data);

      toast.success(newStatus === 'archived' ? 'Job archived' : 'Job restored');
      loadJobs();
    } catch (error: any) {
      console.error('Error toggling job archive:', error);
      toast.error(`Failed to update job status: ${error.message || 'Unknown error'}`);
    }
  }

  async function toggleJobStatus(jobId: string, currentStatus: string) {
    try {
      const newStatus = currentStatus === 'quoting' ? 'active' : 'quoting';
      
      const { error } = await supabase
        .from('jobs')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', jobId);

      if (error) throw error;

      toast.success(newStatus === 'active' ? 'Job activated - now visible to crew' : 'Job set to quoting - hidden from crew');
      loadJobs();
    } catch (error: any) {
      console.error('Error toggling job status:', error);
      toast.error('Failed to update job status');
    }
  }

  async function setJobOnHold(jobId: string) {
    try {
      const { error } = await supabase
        .from('jobs')
        .update({ status: 'on_hold', updated_at: new Date().toISOString() })
        .eq('id', jobId);

      if (error) throw error;

      toast.success('Job put on hold - hidden from crew');
      loadJobs();
    } catch (error: any) {
      console.error('Error setting job on hold:', error);
      toast.error('Failed to update job status');
    }
  }

  async function setJobQuoting(jobId: string) {
    try {
      const { error } = await supabase
        .from('jobs')
        .update({ status: 'quoting', updated_at: new Date().toISOString() })
        .eq('id', jobId);

      if (error) throw error;

      toast.success('Job moved to Quoting');
      loadJobs();
    } catch (error: any) {
      console.error('Error moving job to quoting:', error);
      toast.error('Failed to update job status');
    }
  }

  async function setJobPrepping(jobId: string) {
    try {
      // Get the current job to check if it needs a job number
      const { data: currentJob } = await supabase
        .from('jobs')
        .select('job_number, status')
        .eq('id', jobId)
        .single();

      // If moving from 'quoting' to 'prepping' and no job number, it will get one automatically via trigger
      const { error } = await supabase
        .from('jobs')
        .update({ status: 'prepping', updated_at: new Date().toISOString() })
        .eq('id', jobId);

      if (error) throw error;

      if (currentJob?.status === 'quoting') {
        toast.success('Job moved to Prepping and assigned a job number!');
      } else {
        toast.success('Job set to prepping - hidden from crew');
      }
      loadJobs();
    } catch (error: any) {
      console.error('Error setting job to prepping:', error);
      toast.error('Failed to update job status');
    }
  }

  async function activateJob(jobId: string) {
    try {
      // Get the current job to check if it needs a job number
      const { data: currentJob } = await supabase
        .from('jobs')
        .select('job_number, status')
        .eq('id', jobId)
        .single();

      // If moving from 'quoting' to 'active' and no job number, it will get one automatically via trigger
      const { error } = await supabase
        .from('jobs')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', jobId);

      if (error) throw error;

      if (currentJob?.status === 'quoting') {
        toast.success('Job activated and assigned a job number!');
      } else {
        toast.success('Job activated - now visible to crew');
      }
      loadJobs();
    } catch (error: any) {
      console.error('Error activating job:', error);
      toast.error('Failed to update job status');
    }
  }

  async function loadJobStats(jobId: string) {
    const [clockInData, photosData] = await Promise.all([
      // Only load CLOCK-IN hours (component_id IS NULL) for progress calculation
      supabase
        .from('time_entries')
        .select('total_hours, crew_count')
        .eq('job_id', jobId)
        .is('component_id', null) // Only clock-in hours
        .not('total_hours', 'is', null),
      supabase.from('photos').select('id').eq('job_id', jobId),
    ]);

    // Calculate total clock-in man-hours (hours × crew count)
    const totalClockInHours = clockInData.data?.reduce((sum, entry) => {
      const hours = entry.total_hours || 0;
      const crewCount = entry.crew_count || 1;
      return sum + (hours * crewCount);
    }, 0) || 0;

    setStats((prev) => ({
      ...prev,
      [jobId]: {
        totalHours: totalClockInHours.toFixed(2),
        totalClockInHours: totalClockInHours,
        photosCount: photosData.data?.length || 0,
      },
    }));
  }

  async function loadCrewOrderCounts() {
    try {
      // Count pending crew orders (not yet processed by office)
      const { data, error } = await supabase
        .from('materials')
        .select('job_id')
        .in('import_source', ['field_catalog', 'field_custom'])
        .eq('status', 'not_ordered'); // Pending orders that haven't been approved yet

      if (error) throw error;

      // Count crew orders by job
      const counts: Record<string, number> = {};
      (data || []).forEach((material: any) => {
        counts[material.job_id] = (counts[material.job_id] || 0) + 1;
      });

      setCrewOrderCounts(counts);
    } catch (error: any) {
      if (!isAbortLikeError(error)) console.error('Error loading crew order counts:', error);
    }
  }

  async function loadJobBudgets() {
    try {
      const { data, error } = await supabase
        .from('job_budgets')
        .select('*');

      if (error) throw error;

      const budgetsMap: Record<string, any> = {};
      (data || []).forEach(budget => {
        budgetsMap[budget.job_id] = budget;
      });

      setJobBudgets(budgetsMap);
    } catch (error: any) {
      if (!isAbortLikeError(error)) console.error('Error loading job budgets:', error);
    }
  }

  /**
   * Sum the figured labor hours per job from the proposal's sheet labor so the progress
   * bar can show a "time figured" value even when nobody typed Estimated Hours into the
   * Edit Job dialog. A job can have several workbooks (one per proposal copy); summing all
   * of them would double-count, so we take the fullest single workbook per job — the same
   * "pick the most complete workbook" heuristic used elsewhere for proposals.
   */
  async function loadJobFiguredHours() {
    const DEFAULT_LABOR_RATE = 60;
    try {
      const [sheetLaborRes, laborLineItemsRes, sheetsRes, workbooksRes, rowsRes, quotesRes, ratesRes] =
        await Promise.all([
          // Crew labor entered as a sheet-labor row (hours, or a lump-sum cost we convert to hours).
          supabase
            .from('material_sheet_labor')
            .select('estimated_hours, total_labor_cost, hourly_rate, sheet_id'),
          // Crew labor entered as line items (item_type='labor' → quantity is hours).
          supabase
            .from('custom_financial_row_items')
            .select('quantity, sheet_id, row_id')
            .eq('item_type', 'labor'),
          supabase.from('material_sheets').select('id, workbook_id'),
          supabase.from('material_workbooks').select('id, job_id, quote_id'),
          supabase.from('custom_financial_rows').select('id, job_id, quote_id'),
          // quote_id -> job_id, so we can still attribute labor when a workbook only carries quote_id.
          supabase.from('quotes').select('id, job_id').not('job_id', 'is', null),
          supabase.from('labor_pricing').select('job_id, hourly_rate'),
        ]);

      if (sheetLaborRes.error) throw sheetLaborRes.error;

      const quoteToJob: Record<string, string> = {};
      (quotesRes.data || []).forEach((q: any) => {
        if (q?.id && q?.job_id) quoteToJob[q.id] = q.job_id;
      });
      const sheetToWorkbook: Record<string, string> = {};
      (sheetsRes.data || []).forEach((s: any) => {
        if (s?.id && s?.workbook_id) sheetToWorkbook[s.id] = s.workbook_id;
      });
      const workbookById: Record<string, any> = {};
      (workbooksRes.data || []).forEach((w: any) => {
        if (w?.id) workbookById[w.id] = w;
      });
      const rowById: Record<string, any> = {};
      (rowsRes.data || []).forEach((r: any) => {
        if (r?.id) rowById[r.id] = r;
      });
      const jobRate: Record<string, number> = {};
      (ratesRes.data || []).forEach((r: any) => {
        if (r?.job_id && Number(r.hourly_rate) > 0) jobRate[r.job_id] = Number(r.hourly_rate);
      });
      const rateForJob = (jobId: string) => jobRate[jobId] || DEFAULT_LABOR_RATE;

      // Resolve a sheet/row to its owning job and a per-proposal "scope" key, so multiple
      // proposal copies (different quotes) don't get summed — we take the fullest copy.
      const scopeForSheet = (sheetId?: string | null) => {
        if (!sheetId) return null;
        const wbId = sheetToWorkbook[sheetId];
        const wb = wbId ? workbookById[wbId] : undefined;
        if (!wb) return null;
        const jobId = wb.job_id || (wb.quote_id ? quoteToJob[wb.quote_id] : undefined);
        if (!jobId) return null;
        return { jobId, scope: wb.quote_id ? `q:${wb.quote_id}` : `w:${wbId}` };
      };
      const scopeForRow = (rowId?: string | null) => {
        if (!rowId) return null;
        const row = rowById[rowId];
        if (!row) return null;
        const jobId = row.job_id || (row.quote_id ? quoteToJob[row.quote_id] : undefined);
        if (!jobId) return null;
        return { jobId, scope: row.quote_id ? `q:${row.quote_id}` : `r:${rowId}` };
      };

      // job_id -> (proposal scope -> summed figured crew hours)
      const byJobScope: Record<string, Record<string, number>> = {};
      const addHours = (jobId: string, scope: string, hours: number) => {
        if (!jobId || !(hours > 0)) return;
        if (!byJobScope[jobId]) byJobScope[jobId] = {};
        byJobScope[jobId][scope] = (byJobScope[jobId][scope] || 0) + hours;
      };

      (sheetLaborRes.data || []).forEach((row: any) => {
        const sc = scopeForSheet(row.sheet_id);
        if (!sc) return;
        const rate = Number(row.hourly_rate) > 0 ? Number(row.hourly_rate) : rateForJob(sc.jobId);
        const eh = Number(row.estimated_hours) || 0;
        const cost = Number(row.total_labor_cost) || 0;
        // Prefer explicit hours; otherwise back out hours from the figured labor cost.
        const hours = eh > 0 ? eh : rate > 0 ? cost / rate : 0;
        addHours(sc.jobId, sc.scope, hours);
      });

      (laborLineItemsRes.data || []).forEach((li: any) => {
        const sc = li.sheet_id ? scopeForSheet(li.sheet_id) : scopeForRow(li.row_id);
        if (!sc) return;
        addHours(sc.jobId, sc.scope, Number(li.quantity) || 0);
      });

      const figured: Record<string, number> = {};
      Object.entries(byJobScope).forEach(([jobId, scopes]) => {
        const totals = Object.values(scopes);
        figured[jobId] = totals.length ? Math.max(...totals) : 0;
      });

      setJobFiguredHours(figured);
    } catch (error: any) {
      if (!isAbortLikeError(error)) console.error('Error loading job figured hours:', error);
    }
  }

  async function loadJobQuotes() {
    try {
      const { data, error } = await supabase
        .from('quotes')
        .select('*')
        .not('job_id', 'is', null);

      if (error) throw error;

      /** One entry per job: prefer main proposal (not a change order), else newest by created_at */
      const byJob: Record<string, any[]> = {};
      (data || []).forEach((quote: any) => {
        const j = quote.job_id;
        if (!j) return;
        if (!byJob[j]) byJob[j] = [];
        byJob[j].push(quote);
      });
      const quotesMap: Record<string, any> = {};
      Object.entries(byJob).forEach(([jobId, quotes]) => {
        // Pick the SAME "primary" quote that togglePrimaryQuoteOnHold updates: newest
        // non-change-order, else newest overall. Sorting first (instead of relying on row
        // order) keeps the displayed on_hold state in sync with the row the toggle writes.
        const byNewest = [...quotes].sort(
          (a: any, b: any) =>
            new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        );
        const main =
          byNewest.find((q: any) => !q.is_change_order_proposal) ?? byNewest[0];
        if (main) quotesMap[jobId] = main;
      });

      setJobQuotes(quotesMap);
    } catch (error: any) {
      console.error('Error loading job quotes:', error);
    }
  }

  /**
   * Move a job's primary proposal in/out of "On Hold".
   *
   * Preferred storage is the per-proposal `quotes.on_hold` flag. If that column doesn't exist
   * on this database yet (some OnSpace deployments are missing the migration), we fall back to
   * the job-level on-hold (`jobs.status = 'on_hold'`) that the On Hold column already reads, so
   * the card still moves and the change persists/syncs across users without any schema change.
   */
  async function togglePrimaryQuoteOnHold(jobId: string) {
    const job = jobs.find((j: any) => j.id === jobId);
    const currentlyOnHold = isJobOnHoldForBoard(job);
    const next = !currentlyOnHold;
    try {
      // Resolve the primary proposal using only columns guaranteed to exist on every DB.
      const { data: rows, error } = await supabase
        .from('quotes')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const list = rows || [];
      const main = list.find((q: any) => !q.is_change_order_proposal) ?? list[0];

      // Preferred path: per-proposal on_hold flag (when the column exists).
      if (main) {
        const { error: uErr } = await supabase
          .from('quotes')
          .update({ on_hold: next, updated_at: new Date().toISOString() })
          .eq('id', main.id);
        if (!uErr) {
          toast.success(next ? 'Proposal put on hold' : 'Proposal resumed');
          await loadJobQuotes();
          loadJobs();
          return;
        }
        const msg = String(uErr.message || '');
        const missingColumn =
          uErr.code === '42703' || (/on_hold/i.test(msg) && /column|does not exist|schema/i.test(msg));
        if (!missingColumn) throw uErr;
        // else: column not present — fall through to the job-status fallback below.
      }

      // Fallback: use the existing job-level on-hold so the card still moves to On Hold.
      const fallbackStatus = next ? 'on_hold' : 'quoting';
      const { error: jErr } = await supabase
        .from('jobs')
        .update({ status: fallbackStatus, updated_at: new Date().toISOString() })
        .eq('id', jobId);
      if (jErr) throw jErr;
      toast.success(next ? 'Proposal put on hold' : 'Proposal resumed');
      await loadJobQuotes();
      loadJobs();
    } catch (error: any) {
      console.error('Error toggling proposal on hold:', error);
      toast.error(String(error?.message || '') || 'Failed to update proposal');
    }
  }

  async function loadRecentMessages() {
    setLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from('job_emails')
        .select('id, job_id, subject, from_name, from_email, body_text, email_date, direction, jobs(id, name)')
        .order('email_date', { ascending: false })
        .limit(25);

      if (error) throw error;
      const { data: directMessages } = await supabase
        .from('job_messages')
        .select('id, job_id, sender_role, sender_name, sender_contact, message_text, created_at')
        .is('hidden_at', null)
        .order('created_at', { ascending: false })
        .limit(25);
      const directJobIds = [...new Set((directMessages || []).map((m: any) => m.job_id).filter(Boolean))];
      let directJobNameById = new Map<string, string>();
      if (directJobIds.length > 0) {
        const { data: directJobs } = await supabase
          .from('jobs')
          .select('id, name')
          .in('id', directJobIds);
        directJobNameById = new Map((directJobs || []).map((j: any) => [j.id, j.name || 'Unknown job']));
      }
      const mappedDirect = (directMessages || []).map((m: any) => ({
        id: `msg-${m.id}`,
        job_id: m.job_id,
        subject: m.sender_role === 'customer' ? 'Message from customer' : 'Message from project team',
        from_name: m.sender_name,
        from_email: m.sender_contact,
        body_text: m.message_text,
        email_date: m.created_at,
        direction: m.sender_role === 'customer' ? 'inbound' : 'sent',
        jobs: m.job_id ? { id: m.job_id, name: directJobNameById.get(m.job_id) || 'Unknown job' } : undefined,
      }));
      const merged = ([...(data || []), ...mappedDirect] as any[]).sort(
        (a, b) => new Date(b.email_date).getTime() - new Date(a.email_date).getTime()
      );
      setRecentMessages(merged.slice(0, 25) as any);
    } catch (error: any) {
      if (!isAbortLikeError(error)) {
        console.error('Error loading recent messages:', error);
        setRecentMessages([]);
      }
    } finally {
      setLoadingMessages(false);
    }
  }

  async function openJobCommunications(jobId: string) {
    let job = jobs.find((j) => j.id === jobId);
    if (!job) {
      const { data, error } = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle();
      if (error || !data) {
        toast.error('Job not found');
        return;
      }
      job = data as Job;
    }
    setSelectedTab('communications');
    openJobDetail(job);
  }

  function openBudgetDialog(jobId: string) {
    setBudgetJobId(jobId);
    setShowBudgetDialog(true);
  }

  function openReplyDialog(msg: (typeof recentMessages)[0]) {
    setReplyToMessage(msg);
    setReplyBody('');
    setShowReplyDialog(true);
  }

  async function sendReplyToCustomer() {
    if (!replyToMessage || !replyBody.trim()) {
      toast.error('Please enter a message');
      return;
    }
    setSendingReply(true);
    try {
      const { error } = await supabase.from('job_messages').insert({
        job_id: replyToMessage.job_id,
        sender_role: 'team',
        sender_name: profile?.user_metadata?.full_name ?? profile?.email ?? 'Project Team',
        sender_contact: profile?.email ?? null,
        message_text: replyBody.trim(),
        is_read: false,
      });
      if (error) throw error;
      toast.success('Message sent. Customer will see it in their portal.');
      setShowReplyDialog(false);
      setReplyToMessage(null);
      setReplyBody('');
      await loadRecentMessages();
    } catch (err: any) {
      console.error('Send reply error:', err);
      toast.error(err?.message ?? 'Failed to send message');
    } finally {
      setSendingReply(false);
    }
  }

  function openNewMessageDialog() {
    setNewMessageJobId('');
    setNewMessageSubject('');
    setNewMessageBody('');
    setShowNewMessageDialog(true);
  }

  async function sendNewMessageToCustomer() {
    if (!newMessageJobId || !newMessageBody.trim()) {
      toast.error('Select a job and enter a message');
      return;
    }
    const job = jobs.find((j) => j.id === newMessageJobId);
    if (!job) {
      toast.error('Job not found');
      return;
    }
    setSendingNewMessage(true);
    try {
      const { error } = await supabase.from('job_messages').insert({
        job_id: job.id,
        sender_role: 'team',
        sender_name: profile?.user_metadata?.full_name ?? profile?.email ?? 'Project Team',
        sender_contact: profile?.email ?? null,
        message_text: newMessageBody.trim(),
        is_read: false,
      });
      if (error) throw error;
      toast.success('Message sent. Customer will see it in their portal.');
      setShowNewMessageDialog(false);
      setNewMessageJobId('');
      setNewMessageSubject('');
      setNewMessageBody('');
      await loadRecentMessages();
    } catch (err: any) {
      console.error('Send new message error:', err);
      toast.error(err?.message ?? 'Failed to send message');
    } finally {
      setSendingNewMessage(false);
    }
  }

  async function reloadSelectedJob() {
    const id = detailDialogJobId ?? selectedJob?.id;
    if (!id) return;

    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      if (data) {
        setJobs((prev) => prev.map((j) => (j.id === data.id ? data : j)));
        openJobDetail(data);
      }
    } catch (error) {
      console.error('Error reloading job:', error);
    }
  }

  return (
    <>
    <div className={hideJobList ? 'hidden' : 'flex flex-col lg:flex-row gap-3 sm:gap-6'} aria-hidden={hideJobList}>
      {/* Left Sidebar - Today's Tasks */}
      {!showArchived && (
        <div className="w-full lg:w-80 flex-shrink-0 overflow-hidden relative max-h-[400px] lg:max-h-[calc(100vh-12rem)]">
          {/* Gold accent border on the right */}
          <div className="absolute top-0 right-0 w-1 h-full bg-gradient-to-b from-yellow-500 via-yellow-600 to-yellow-700 opacity-80 rounded-full"></div>
          <TodayTasksSidebar 
            onJobSelect={(jobId) => {
              const j = jobs.find((j) => j.id === jobId) || null;
              if (j) openJobDetail(j, 'proposal-materials');
            }}
            onAddTask={onAddTask}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 space-y-3 sm:space-y-4 overflow-y-auto pr-1 sm:pr-2 pl-1 sm:pl-2">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white rounded-lg p-3 sm:p-4 shadow-lg border border-yellow-600/20">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{showArchived ? 'Archived Jobs' : 'Jobs'}</h2>
            <p className="text-xs sm:text-sm text-slate-300">
              {showArchived ? 'View and restore archived jobs' : 'Manage job sites, documents, and assignments'}
            </p>
          </div>
          {!showArchived && (
            <div className="flex gap-2 w-full sm:w-auto">
              <Button 
                onClick={() => setShowShopMaterialsDialog(true)} 
                size="sm"
                variant="outline"
                className="flex-1 sm:flex-initial bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white"
              >
                <Warehouse className="w-4 h-4 mr-2" />
                Shop Materials
              </Button>
              <Button 
                onClick={() => setShowOrdersDialog(true)} 
                size="sm"
                variant="outline"
                className="flex-1 sm:flex-initial bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white"
              >
                <ShoppingCart className="w-4 h-4 mr-2" />
                Orders
              </Button>
              <Button 
                asChild
                size="sm"
                variant="outline"
                className="flex-1 sm:flex-initial bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white"
              >
                <Link to="/office/daily-report" className="flex items-center gap-1.5">
                  <ScrollText className="w-4 h-4" />
                  Daily Report
                </Link>
              </Button>
              <Button 
                onClick={() => setShowCreateDialog(true)} 
                size="sm"
                className="flex-1 sm:flex-initial bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-black font-semibold shadow-lg border-2 border-yellow-400"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Job
              </Button>
              {!showArchived && (
                <Popover
                  open={customerMessagesOpen}
                  onOpenChange={(open) => {
                    setCustomerMessagesOpen(open);
                    if (open) markCustomerMessagesSeen();
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="relative flex-1 sm:flex-initial bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white min-w-[2.5rem]"
                      title="Customer messages"
                    >
                      <Mail className="w-4 h-4" />
                      {unreadCustomerMessageCount > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                          {unreadCustomerMessageCount > 25 ? '25+' : unreadCustomerMessageCount}
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-96 max-h-80 overflow-hidden flex flex-col p-0" align="end">
                    <div className="p-3 border-b bg-muted/30">
                      <p className="font-medium text-sm">Customer messages</p>
                      <p className="text-xs text-muted-foreground">Click a message to open that job&apos;s Communications tab.</p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="mt-2 w-full"
                        onClick={openNewMessageDialog}
                      >
                        <Send className="w-3.5 h-3.5 mr-1.5" />
                        Start a conversation
                      </Button>
                    </div>
                    <div className="overflow-y-auto flex-1 min-h-0">
                      {loadingMessages ? (
                        <p className="p-3 text-sm text-muted-foreground">Loading...</p>
                      ) : customerMessageThreads.length === 0 ? (
                        <p className="p-3 text-sm text-muted-foreground">No customer messages yet.</p>
                      ) : (
                        <ul className="p-2 space-y-1">
                          {customerMessageThreads.map((thread) => (
                            <li key={thread.jobId} className="rounded-lg border p-2.5 space-y-2">
                              <button
                                type="button"
                                onClick={() => {
                                  markCustomerMessagesSeen();
                                  openJobCommunications(thread.jobId);
                                }}
                                className="w-full text-left"
                              >
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div className="min-w-0 flex-1">
                                    <span className="font-medium text-foreground text-sm">{thread.jobName}</span>
                                    <span className="text-muted-foreground text-xs ml-1">{thread.customerName}</span>
                                  </div>
                                  <span className="text-[10px] text-muted-foreground shrink-0">
                                    {new Date(thread.latest.email_date).toLocaleDateString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </div>
                                <div className="space-y-1">
                                  {thread.messages.slice(-3).map((m) => (
                                    <div key={m.id} className={`flex ${m.direction === 'sent' ? 'justify-end' : 'justify-start'}`}>
                                      <div
                                        className={`max-w-[85%] rounded-xl px-2 py-1.5 text-xs ${
                                          m.direction === 'sent'
                                            ? 'bg-emerald-100 text-emerald-900'
                                            : 'bg-slate-100 text-slate-800'
                                        }`}
                                      >
                                        <p className="line-clamp-2">{m.body_text || m.subject || 'Message'}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </button>
                              {thread.latestInbound && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs self-end"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openReplyDialog(thread.latestInbound as (typeof recentMessages)[0]);
                                  }}
                                >
                                  <Reply className="w-3 h-3 mr-1" />
                                  Reply (sends to customer portal)
                                </Button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Loading jobs...
            </CardContent>
          </Card>
        ) : jobs.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No jobs found. Create your first job to get started.
            </CardContent>
          </Card>
        ) : showArchived ? (
          <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {jobs
              .filter((job) => job.status === 'archived')
              .filter((job) => isVisibleJobCard(job))
              .map((job) => {
              const jobStats = stats[job.id] || {};
              // "Time figured" for the progress bar: manual Estimated Hours wins, else fall
              // back to the proposal's figured labor hours so the bar shows like other jobs.
              const figuredHours =
                job.estimated_hours && job.estimated_hours > 0
                  ? job.estimated_hours
                  : jobFiguredHours[job.id] || 0;
              
              // Calculate scheduling status
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const startDate = job.projected_start_date ? new Date(job.projected_start_date + 'T00:00:00') : null;
              const endDate = job.projected_end_date ? new Date(job.projected_end_date + 'T00:00:00') : null;
              
              const isNotStarted = startDate && startDate > today;
              const isInProgress = startDate && startDate <= today && (!endDate || endDate >= today);
              const isOverdue = endDate && endDate < today && job.status !== 'completed';
              
              return (
                <Card
                  id={`job-${job.id}`}
                  key={job.id}
                  className={`hover:shadow-md transition-all ${
                    selectedJobId === job.id ? 'ring-2 ring-primary shadow-lg' : ''
                  } ${
                    isOverdue ? 'border-destructive border-2' : ''
                  }`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 cursor-pointer" onClick={() => {
                        openJobDetail(job);
                        setSelectedTab('proposal-materials');
                      }}>
                        <CardTitle className="text-lg">{job.name}</CardTitle>
                        <p className="text-sm font-medium text-muted-foreground mt-1">
                          {job.client_name}
                        </p>
                        {/* Scheduling Status Badges */}
                        {(startDate || endDate) && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {isNotStarted && (
                              <Badge variant="secondary" className="text-xs">
                                <Calendar className="w-3 h-3 mr-1" />
                                Starts {startDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </Badge>
                            )}
                            {isInProgress && startDate && (
                              <Badge variant="default" className="text-xs">
                                <Calendar className="w-3 h-3 mr-1" />
                                In Progress
                              </Badge>
                            )}
                            {isOverdue && (
                              <Badge variant="destructive" className="text-xs">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                Overdue
                              </Badge>
                            )}
                            {endDate && !isOverdue && (
                              <Badge variant="outline" className="text-xs">
                                Due {endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <Badge variant={
                          job.status === 'active' ? 'default' : 
                          job.status === 'quoting' ? 'secondary' : 
                          'outline'
                        }>
                          {job.status === 'quoting' ? 'Quoting' : job.status}
                        </Badge>
                        <div className="flex flex-col gap-1">
                          {/* On Hold button - show for active, quoting, and on_hold jobs */}
                          {(job.status === 'active' || job.status === 'quoting' || job.status === 'on_hold') && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (job.status === 'on_hold') {
                                  activateJob(job.id);
                                } else {
                                  setJobOnHold(job.id);
                                }
                              }}
                              className="h-7 px-2 justify-start"
                            >
                              {job.status === 'on_hold' ? (
                                <>
                                  <FileCheck className="w-3 h-3 mr-1" />
                                  <span className="text-xs">Activate</span>
                                </>
                              ) : (
                                <>
                                  <AlertTriangle className="w-3 h-3 mr-1" />
                                  <span className="text-xs">Hold</span>
                                </>
                              )}
                            </Button>
                          )}
                          {/* Archive button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleArchiveJob(job.id, job.status);
                            }}
                            className="h-7 px-2 justify-start"
                          >
                            {job.status === 'archived' ? (
                              <>
                                <ArchiveRestore className="w-3 h-3 mr-1" />
                                <span className="text-xs">Restore</span>
                              </>
                            ) : (
                              <>
                                <Archive className="w-3 h-3 mr-1" />
                                <span className="text-xs">Archive</span>
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="cursor-pointer" onClick={() => {
                      openJobDetail(job);
                      setSelectedTab('overview');
                    }}>
                      <div className="flex items-start text-sm">
                        <MapPin className="w-4 h-4 mr-2 mt-0.5 text-muted-foreground flex-shrink-0" />
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {job.address}
                        </a>
                      </div>
                      {job.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {job.description}
                        </p>
                      )}
                    </div>

                    {/* Progress Bar - Clock-In Hours Only */}
                    {figuredHours > 0 && (
                      <div className="space-y-1.5 pt-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Progress (Clock-In)</span>
                          <span className="font-bold">
                            {((jobStats.totalClockInHours || 0) / figuredHours * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-500 ${
                              (jobStats.totalClockInHours || 0) > figuredHours
                                ? 'bg-destructive'
                                : 'bg-primary'
                            }`}
                            style={{ 
                              width: `${Math.min(((jobStats.totalClockInHours || 0) / figuredHours * 100), 100)}%` 
                            }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{jobStats.totalHours || '0'} / {figuredHours} hrs</span>
                          {(jobStats.totalClockInHours || 0) > figuredHours && (
                            <span className="text-destructive font-medium">Over Budget</span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            openJobDetail(job);
                            setSelectedTab('proposal-materials');
                          }}
                        >
                          <Package className="w-3 h-3 sm:mr-1" />
                          <span className="hidden sm:inline">Materials</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            openJobDetail(job);
                            setSelectedTab('schedule');
                          }}
                        >
                          <CalendarIcon className="w-3 h-3 sm:mr-1" />
                          <span className="hidden sm:inline">Schedule</span>
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          openJobDetail(job);
                          setSelectedTab('photos');
                        }}
                      >
                        <Camera className="w-3 h-3 mr-1" />
                        {jobStats.photosCount || 0}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
            {/* Active Column */}
            <div className="flex flex-col min-w-0">
              <div className="bg-gradient-to-r from-green-100 to-green-50 border-2 border-green-200 rounded-lg p-2 sm:p-3 mb-2 sm:mb-3">
                <h3 className="text-base sm:text-lg font-bold text-green-900 flex items-center gap-2">
                  Active
                  <Badge variant="secondary" className="bg-green-200 text-green-900">
                    {jobs.filter(j => j.status === 'active' && isVisibleJobCard(j) && !isPrimaryProposalOnHold(j.id)).length}
                  </Badge>
                </h3>
              </div>
              <div className="space-y-2 sm:space-y-3">
                {jobs
                  .filter((job) => job.status === 'active' && isVisibleJobCard(job) && !isPrimaryProposalOnHold(job.id))
                  .map((job) => {
                    const jobStats = stats[job.id] || {};
                    // "Time figured" for the progress bar: manual Estimated Hours wins, else
                    // fall back to the proposal's figured labor hours so the bar shows.
                    const figuredHours =
                      job.estimated_hours && job.estimated_hours > 0
                        ? job.estimated_hours
                        : jobFiguredHours[job.id] || 0;
                    
                    // Calculate scheduling status
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const startDate = job.projected_start_date ? new Date(job.projected_start_date + 'T00:00:00') : null;
                    const endDate = job.projected_end_date ? new Date(job.projected_end_date + 'T00:00:00') : null;
                    
                    const isNotStarted = startDate && startDate > today;
                    const isInProgress = startDate && startDate <= today && (!endDate || endDate >= today);
                    const isOverdue = endDate && endDate < today && job.status !== 'completed';
                    
                    return (
                      <Card
                        id={`job-${job.id}`}
                        key={job.id}
                        className={`hover:shadow-md transition-all ${
                          selectedJobId === job.id ? 'ring-2 ring-primary shadow-lg' : ''
                        } ${
                          isOverdue ? 'border-destructive border-2' : ''
                        }`}
                      >
                        <CardHeader className="pb-1.5 pt-2 px-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 cursor-pointer min-w-0" onClick={() => {
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}>
                              <div className="flex items-center gap-1.5">
                                <CardTitle className="text-base leading-tight flex-1">
                                  {/* Show quote number for quoting status, job number for active/prepping */}
                                  {job.status === 'quoting' ? (
                                    job.quote_number ? (
                                      <span className="text-xs font-mono text-yellow-700 font-bold mr-1.5">#{ job.quote_number}</span>
                                    ) : null
                                  ) : (
                                    job.job_number ? (
                                      <span className="text-xs font-mono text-gray-600 font-bold mr-1.5">#{job.job_number}</span>
                                    ) : null
                                  )}
                                  {job.name}
                                </CardTitle>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-xs flex-shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openJobDetail(job);
                                    setSelectedTab('photos');
                                  }}
                                >
                                  <Camera className="w-3 h-3 mr-0.5" />
                                  {jobStats.photosCount || 0}
                                </Button>
                              </div>
                              <p className="text-xs font-medium text-muted-foreground mt-0.5">
                                {job.client_name}
                              </p>
                              {/* Scheduling Status Badges */}
                              {(startDate || endDate) && (
                                <div className="flex flex-wrap gap-0.5 mt-1">
                                  {isNotStarted && (
                                    <Badge variant="secondary" className="text-[10px] py-0 h-4 px-1.5">
                                      <Calendar className="w-2.5 h-2.5 mr-0.5" />
                                      {startDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </Badge>
                                  )}
                                  {isInProgress && startDate && (
                                    <Badge variant="default" className="text-[10px] py-0 h-4 px-1.5">
                                      In Progress
                                    </Badge>
                                  )}
                                  {isOverdue && (
                                    <Badge variant="destructive" className="text-[10px] py-0 h-4 px-1.5">
                                      <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                                      Overdue
                                    </Badge>
                                  )}
                                  {endDate && !isOverdue && (
                                    <Badge variant="outline" className="text-[10px] py-0 h-4 px-1.5">
                                      {endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-6 w-6 p-0 flex-shrink-0"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setJobOnHold(job.id);
                                  }}
                                >
                                  <AlertTriangle className="w-4 h-4 mr-2" />
                                  Put On Hold
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleArchiveJob(job.id, job.status);
                                  }}
                                >
                                  <Archive className="w-4 h-4 mr-2" />
                                  Archive
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-1.5 px-3 pb-2 space-y-1.5">
                          <div className="cursor-pointer" onClick={() => {
                            openJobDetail(job);
                            setSelectedTab('overview');
                          }}>
                            <div className="flex items-start text-xs">
                              <MapPin className="w-3 h-3 mr-1 mt-0.5 text-muted-foreground flex-shrink-0" />
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline leading-tight"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {job.address}
                              </a>
                            </div>
                          </div>

                          {/* Progress Bar - Clock-In Hours Only */}
                          {figuredHours > 0 && (
                            <div className="space-y-0.5">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-muted-foreground">Progress</span>
                                <span className="font-bold">
                                  {((jobStats.totalClockInHours || 0) / figuredHours * 100).toFixed(0)}%
                                </span>
                              </div>
                              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                <div 
                                  className={`h-full transition-all duration-500 ${
                                    (jobStats.totalClockInHours || 0) > figuredHours
                                      ? 'bg-destructive'
                                      : 'bg-primary'
                                  }`}
                                  style={{ 
                                    width: `${Math.min(((jobStats.totalClockInHours || 0) / figuredHours * 100), 100)}%` 
                                  }}
                                />
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                <span>{jobStats.totalHours || '0'} / {figuredHours} hrs</span>
                                {(jobStats.totalClockInHours || 0) > figuredHours && (
                                  <span className="text-destructive font-medium">Over</span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Financial Summary */}
                          {jobBudgets[job.id] && (
                            <div 
                              className="p-2 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded cursor-pointer hover:shadow-sm transition-shadow"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                  <DollarSign className="w-3 h-3 text-green-700" />
                                  <span className="text-[10px] font-semibold text-green-900">Budget</span>
                                </div>
                                <div className="text-[10px] font-bold text-green-700">
                                  ${jobBudgets[job.id].total_quoted_price.toLocaleString()}
                                </div>
                              </div>
                              {(() => {
                                const budget = jobBudgets[job.id];
                                const costs = (budget.total_labor_budget || 0) + (budget.total_materials_budget || 0) + 
                                            (budget.total_subcontractor_budget || 0) + (budget.total_equipment_budget || 0) + 
                                            (budget.other_costs || 0);
                                const profit = budget.total_quoted_price - costs - (budget.overhead_allocation || 0);
                                const margin = budget.total_quoted_price > 0 ? (profit / budget.total_quoted_price) * 100 : 0;
                                return (
                                  <div className="flex items-center justify-between mt-0.5">
                                    <span className="text-[9px] text-green-700">Margin</span>
                                    <div className="flex items-center gap-0.5">
                                      {margin >= 15 ? (
                                        <TrendingUp className="w-2.5 h-2.5 text-green-600" />
                                      ) : margin >= 10 ? (
                                        <TrendingUp className="w-2.5 h-2.5 text-yellow-600" />
                                      ) : (
                                        <TrendingDown className="w-2.5 h-2.5 text-red-600" />
                                      )}
                                      <span className={`text-[9px] font-semibold ${
                                        margin >= 15 ? 'text-green-600' : 
                                        margin >= 10 ? 'text-yellow-600' : 
                                        'text-red-600'
                                      }`}>
                                        {margin.toFixed(1)}%
                                      </span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* Quick Action Buttons */}
                          <div className="flex gap-0.5 pt-1 border-t">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] flex-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}
                            >
                              <ScrollText className="w-2.5 h-2.5 sm:mr-0.5" />
                              <span className="hidden sm:inline">Proposal</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] flex-1 relative"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}
                            >
                              <Package className="w-2.5 h-2.5 sm:mr-0.5" />
                              <span className="hidden sm:inline">Materials</span>
                              {crewOrderCounts[job.id] > 0 && (
                                <Badge variant="secondary" className="ml-1 bg-orange-500 text-white text-[8px] py-0 px-1 h-3.5 leading-none">
                                  {crewOrderCounts[job.id]}
                                </Badge>
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] flex-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('schedule');
                              }}
                            >
                              <CalendarIcon className="w-2.5 h-2.5 sm:mr-0.5" />
                              <span className="hidden sm:inline">Schedule</span>
                            </Button>
                          </div>

                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            </div>

            {/* Prepping Column */}
            <div className="flex flex-col min-w-0">
              <div className="bg-gradient-to-r from-blue-100 to-blue-50 border-2 border-blue-200 rounded-lg p-2 sm:p-3 mb-2 sm:mb-3">
                <h3 className="text-base sm:text-lg font-bold text-blue-900 flex items-center gap-2">
                  Prepping
                  <Badge variant="secondary" className="bg-blue-200 text-blue-900">
                    {jobs.filter(j => j.status === 'prepping' && isVisibleJobCard(j) && !isPrimaryProposalOnHold(j.id)).length}
                  </Badge>
                </h3>
              </div>
              <div className="space-y-2 sm:space-y-3">
                {jobs
                  .filter((job) => job.status === 'prepping' && isVisibleJobCard(job) && !isPrimaryProposalOnHold(job.id))
                  .map((job) => {
                    const jobStats = stats[job.id] || {};
                    
                    return (
                      <Card
                        id={`job-${job.id}`}
                        key={job.id}
                        className={`hover:shadow-md transition-all ${
                          selectedJobId === job.id ? 'ring-2 ring-primary shadow-lg' : ''
                        }`}
                      >
                        <CardHeader className="pb-1.5 pt-2 px-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 cursor-pointer min-w-0" onClick={() => {
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}>
                              <div className="flex items-center gap-1.5">
                                <CardTitle className="text-base leading-tight flex-1">
                                  {/* Show quote number for quoting status, job number for active/prepping */}
                                  {job.status === 'quoting' ? (
                                    job.quote_number ? (
                                      <span className="text-xs font-mono text-yellow-700 font-bold mr-1.5">#{ job.quote_number}</span>
                                    ) : null
                                  ) : (
                                    job.job_number ? (
                                      <span className="text-xs font-mono text-gray-600 font-bold mr-1.5">#{job.job_number}</span>
                                    ) : null
                                  )}
                                  {job.name}
                                </CardTitle>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-xs flex-shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openJobDetail(job);
                                    setSelectedTab('photos');
                                  }}
                                >
                                  <Camera className="w-3 h-3 mr-0.5" />
                                  {jobStats.photosCount || 0}
                                </Button>
                              </div>
                              <p className="text-xs font-medium text-muted-foreground mt-0.5">
                                {job.client_name}
                              </p>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-6 w-6 p-0 flex-shrink-0"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    activateJob(job.id);
                                  }}
                                >
                                  <FileCheck className="w-4 h-4 mr-2" />
                                  Activate
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setJobOnHold(job.id);
                                  }}
                                >
                                  <AlertTriangle className="w-4 h-4 mr-2" />
                                  Put On Hold
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleArchiveJob(job.id, job.status);
                                  }}
                                >
                                  <Archive className="w-4 h-4 mr-2" />
                                  Archive
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-1.5 px-3 pb-2 space-y-1.5">
                          <div className="cursor-pointer" onClick={() => {
                            openJobDetail(job);
                            setSelectedTab('overview');
                          }}>
                            <div className="flex items-start text-xs">
                              <MapPin className="w-3 h-3 mr-1 mt-0.5 text-muted-foreground flex-shrink-0" />
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline leading-tight"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {job.address}
                              </a>
                            </div>
                          </div>

                          {/* Labor progress: time clocked vs. figured */}
                          {renderJobLaborBar(job)}

                          {/* Financial Summary */}
                          {jobBudgets[job.id] && (
                            <div 
                              className="p-2 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded cursor-pointer hover:shadow-sm transition-shadow"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                  <DollarSign className="w-3 h-3 text-green-700" />
                                  <span className="text-[10px] font-semibold text-green-900">Budget</span>
                                </div>
                                <div className="text-[10px] font-bold text-green-700">
                                  ${jobBudgets[job.id].total_quoted_price.toLocaleString()}
                                </div>
                              </div>
                              {(() => {
                                const budget = jobBudgets[job.id];
                                const costs = (budget.total_labor_budget || 0) + (budget.total_materials_budget || 0) + 
                                            (budget.total_subcontractor_budget || 0) + (budget.total_equipment_budget || 0) + 
                                            (budget.other_costs || 0);
                                const profit = budget.total_quoted_price - costs - (budget.overhead_allocation || 0);
                                const margin = budget.total_quoted_price > 0 ? (profit / budget.total_quoted_price) * 100 : 0;
                                return (
                                  <div className="flex items-center justify-between mt-0.5">
                                    <span className="text-[9px] text-green-700">Margin</span>
                                    <div className="flex items-center gap-0.5">
                                      {margin >= 15 ? (
                                        <TrendingUp className="w-2.5 h-2.5 text-green-600" />
                                      ) : margin >= 10 ? (
                                        <TrendingUp className="w-2.5 h-2.5 text-yellow-600" />
                                      ) : (
                                        <TrendingDown className="w-2.5 h-2.5 text-red-600" />
                                      )}
                                      <span className={`text-[9px] font-semibold ${
                                        margin >= 15 ? 'text-green-600' : 
                                        margin >= 10 ? 'text-yellow-600' : 
                                        'text-red-600'
                                      }`}>
                                        {margin.toFixed(1)}%
                                      </span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* Quick Action Buttons */}
                          <div className="flex gap-0.5 pt-1 border-t">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] flex-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}
                            >
                              <ScrollText className="w-2.5 h-2.5 sm:mr-0.5" />
                              <span className="hidden sm:inline">Proposal</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] flex-1 relative"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}
                            >
                              <Package className="w-2.5 h-2.5 sm:mr-0.5" />
                              <span className="hidden sm:inline">Materials</span>
                              {crewOrderCounts[job.id] > 0 && (
                                <Badge variant="secondary" className="ml-1 bg-orange-500 text-white text-[8px] py-0 px-1 h-3.5 leading-none">
                                  {crewOrderCounts[job.id]}
                                </Badge>
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] flex-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('schedule');
                              }}
                            >
                              <CalendarIcon className="w-2.5 h-2.5 sm:mr-0.5" />
                              <span className="hidden sm:inline">Schedule</span>
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            </div>

            {/* Quoting Column */}
            <div className="flex flex-col min-w-0">
              <div className="bg-gradient-to-r from-yellow-100 to-yellow-50 border-2 border-yellow-200 rounded-lg p-2 sm:p-3 mb-2 sm:mb-3">
                <h3 className="text-base sm:text-lg font-bold text-yellow-900 flex items-center gap-2">
                  Quoting
                  <Badge variant="secondary" className="bg-yellow-200 text-yellow-900">
                    {jobs.filter(j => j.status === 'quoting' && isVisibleJobCard(j) && !isPrimaryProposalOnHold(j.id)).length}
                  </Badge>
                </h3>
              </div>
              <div className="space-y-2 sm:space-y-3">
                {jobs
                  .filter((job) => job.status === 'quoting' && isVisibleJobCard(job) && !isPrimaryProposalOnHold(job.id))
                  .map((job) => {
                    const jobStats = stats[job.id] || {};
                    
                    return (
                      <Card
                        id={`job-${job.id}`}
                        key={job.id}
                        className={`hover:shadow-md transition-all ${
                          selectedJobId === job.id ? 'ring-2 ring-primary shadow-lg' : ''
                        }`}
                      >
                        <CardHeader className="pb-1.5 pt-2 px-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 cursor-pointer min-w-0" onClick={() => {
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}>
                              <div className="flex items-center gap-1.5">
                                <CardTitle className="text-base leading-tight flex-1">
                                  {/* Show quote number for quoting status, job number for active/prepping */}
                                  {job.status === 'quoting' ? (
                                    job.quote_number ? (
                                      <span className="text-xs font-mono text-yellow-700 font-bold mr-1.5">#{ job.quote_number}</span>
                                    ) : null
                                  ) : (
                                    job.job_number ? (
                                      <span className="text-xs font-mono text-gray-600 font-bold mr-1.5">#{job.job_number}</span>
                                    ) : null
                                  )}
                                  {job.name}
                                </CardTitle>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-xs flex-shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openJobDetail(job);
                                    setSelectedTab('photos');
                                  }}
                                >
                                  <Camera className="w-3 h-3 mr-0.5" />
                                  {jobStats.photosCount || 0}
                                </Button>
                              </div>
                              <p className="text-xs font-medium text-muted-foreground mt-0.5">
                                {job.client_name}
                              </p>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-6 w-6 p-0 flex-shrink-0"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void togglePrimaryQuoteOnHold(job.id);
                                  }}
                                >
                                  {isJobOnHoldForBoard(job) ? (
                                    <>
                                      <PlayCircle className="w-4 h-4 mr-2" />
                                      Resume proposal
                                    </>
                                  ) : (
                                    <>
                                      <PauseCircle className="w-4 h-4 mr-2" />
                                      Put proposal on hold
                                    </>
                                  )}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setJobPrepping(job.id);
                                  }}
                                >
                                  <FileCheck className="w-4 h-4 mr-2" />
                                  Set to Prepping
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleArchiveJob(job.id, job.status);
                                  }}
                                >
                                  <Archive className="w-4 h-4 mr-2" />
                                  Archive
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-1.5 px-3 pb-2 space-y-1.5">
                          <div className="cursor-pointer" onClick={() => {
                            openJobDetail(job);
                            setSelectedTab('overview');
                          }}>
                            <div className="flex items-start text-xs">
                              <MapPin className="w-3 h-3 mr-1 mt-0.5 text-muted-foreground flex-shrink-0" />
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline leading-tight"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {job.address}
                              </a>
                            </div>

                          </div>

                          {/* Labor progress: time clocked vs. figured */}
                          {renderJobLaborBar(job)}

                          {/* Financial Summary */}
                          {jobBudgets[job.id] && (
                            <div 
                              className="p-2 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded cursor-pointer hover:shadow-sm transition-shadow"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                  <DollarSign className="w-3 h-3 text-green-700" />
                                  <span className="text-[10px] font-semibold text-green-900">Budget</span>
                                </div>
                                <div className="text-[10px] font-bold text-green-700">
                                  ${jobBudgets[job.id].total_quoted_price.toLocaleString()}
                                </div>
                              </div>
                              {(() => {
                                const budget = jobBudgets[job.id];
                                const costs = (budget.total_labor_budget || 0) + (budget.total_materials_budget || 0) + 
                                            (budget.total_subcontractor_budget || 0) + (budget.total_equipment_budget || 0) + 
                                            (budget.other_costs || 0);
                                const profit = budget.total_quoted_price - costs - (budget.overhead_allocation || 0);
                                const margin = budget.total_quoted_price > 0 ? (profit / budget.total_quoted_price) * 100 : 0;
                                return (
                                  <div className="flex items-center justify-between mt-0.5">
                                    <span className="text-[9px] text-green-700">Margin</span>
                                    <div className="flex items-center gap-0.5">
                                      {margin >= 15 ? (
                                        <TrendingUp className="w-2.5 h-2.5 text-green-600" />
                                      ) : margin >= 10 ? (
                                        <TrendingUp className="w-2.5 h-2.5 text-yellow-600" />
                                      ) : (
                                        <TrendingDown className="w-2.5 h-2.5 text-red-600" />
                                      )}
                                      <span className={`text-[9px] font-semibold ${
                                        margin >= 15 ? 'text-green-600' : 
                                        margin >= 10 ? 'text-yellow-600' : 
                                        'text-red-600'
                                      }`}>
                                        {margin.toFixed(1)}%
                                      </span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* Quick Action Buttons */}
                          <div className="flex gap-0.5 pt-1 border-t">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] flex-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}
                            >
                              <ScrollText className="w-2.5 h-2.5 sm:mr-0.5" />
                              <span className="hidden sm:inline">Proposal</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] flex-1 relative"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}
                            >
                              <Package className="w-2.5 h-2.5 sm:mr-0.5" />
                              <span className="hidden sm:inline">Materials</span>
                              {crewOrderCounts[job.id] > 0 && (
                                <Badge variant="secondary" className="ml-1 bg-orange-500 text-white text-[8px] py-0 px-1 h-3.5 leading-none">
                                  {crewOrderCounts[job.id]}
                                </Badge>
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] flex-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('schedule');
                              }}
                            >
                              <CalendarIcon className="w-2.5 h-2.5 sm:mr-0.5" />
                              <span className="hidden sm:inline">Schedule</span>
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            </div>

            {/* On Hold Column */}
            <div className="flex flex-col min-w-0">
              <div className="bg-gradient-to-r from-orange-100 to-orange-50 border-2 border-orange-200 rounded-lg p-2 sm:p-3 mb-2 sm:mb-3">
                <h3 className="text-base sm:text-lg font-bold text-orange-900 flex items-center gap-2">
                  On Hold
                  <Badge variant="secondary" className="bg-orange-200 text-orange-900">
                    {jobs.filter(j => isVisibleJobCard(j) && j.status !== 'archived' && j.status !== 'completed' && (j.status === 'on_hold' || isPrimaryProposalOnHold(j.id))).length}
                  </Badge>
                </h3>
              </div>
              <div className="space-y-2 sm:space-y-3">
                {jobs
                  .filter((job) => isVisibleJobCard(job) && job.status !== 'archived' && job.status !== 'completed' && (job.status === 'on_hold' || isPrimaryProposalOnHold(job.id)))
                  .map((job) => {
                    const jobStats = stats[job.id] || {};
                    
                    return (
                      <Card
                        id={`job-${job.id}`}
                        key={job.id}
                        className={`hover:shadow-md transition-all ${
                          selectedJobId === job.id ? 'ring-2 ring-primary shadow-lg' : ''
                        }`}
                      >
                        <CardHeader className="pb-1.5 pt-2 px-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 cursor-pointer min-w-0" onClick={() => {
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}>
                              <div className="flex items-center gap-1.5">
                                <CardTitle className="text-base leading-tight flex-1">
                                  {/* Show quote number for quoting status, job number for active/prepping */}
                                  {job.status === 'quoting' ? (
                                    job.quote_number ? (
                                      <span className="text-xs font-mono text-yellow-700 font-bold mr-1.5">#{ job.quote_number}</span>
                                    ) : null
                                  ) : (
                                    job.job_number ? (
                                      <span className="text-xs font-mono text-gray-600 font-bold mr-1.5">#{job.job_number}</span>
                                    ) : null
                                  )}
                                  {job.name}
                                </CardTitle>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-xs flex-shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openJobDetail(job);
                                    setSelectedTab('photos');
                                  }}
                                >
                                  <Camera className="w-3 h-3 mr-0.5" />
                                  {jobStats.photosCount || 0}
                                </Button>
                              </div>
                              <p className="text-xs font-medium text-muted-foreground mt-0.5">
                                {job.client_name}
                              </p>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-6 w-6 p-0 flex-shrink-0"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setJobQuoting(job.id);
                                  }}
                                >
                                  <FileText className="w-4 h-4 mr-2" />
                                  Move to Quoting
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void togglePrimaryQuoteOnHold(job.id);
                                  }}
                                >
                                  {isJobOnHoldForBoard(job) ? (
                                    <>
                                      <PlayCircle className="w-4 h-4 mr-2" />
                                      Resume proposal
                                    </>
                                  ) : (
                                    <>
                                      <PauseCircle className="w-4 h-4 mr-2" />
                                      Put proposal on hold
                                    </>
                                  )}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setJobPrepping(job.id);
                                  }}
                                >
                                  <FileCheck className="w-4 h-4 mr-2" />
                                  Set to Prepping
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleArchiveJob(job.id, job.status);
                                  }}
                                >
                                  <Archive className="w-4 h-4 mr-2" />
                                  Archive
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-1.5 px-3 pb-2 space-y-1.5">
                          <div className="cursor-pointer" onClick={() => {
                            openJobDetail(job);
                            setSelectedTab('overview');
                          }}>
                            <div className="flex items-start text-xs">
                              <MapPin className="w-3 h-3 mr-1 mt-0.5 text-muted-foreground flex-shrink-0" />
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline leading-tight"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {job.address}
                              </a>
                            </div>

                          </div>

                          {/* Labor progress: time clocked vs. figured */}
                          {renderJobLaborBar(job)}

                          {/* Financial Summary */}
                          {jobBudgets[job.id] && (
                            <div 
                              className="p-2 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded cursor-pointer hover:shadow-sm transition-shadow"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                  <DollarSign className="w-3 h-3 text-green-700" />
                                  <span className="text-[10px] font-semibold text-green-900">Budget</span>
                                </div>
                                <div className="text-[10px] font-bold text-green-700">
                                  ${jobBudgets[job.id].total_quoted_price.toLocaleString()}
                                </div>
                              </div>
                              {(() => {
                                const budget = jobBudgets[job.id];
                                const costs = (budget.total_labor_budget || 0) + (budget.total_materials_budget || 0) + 
                                            (budget.total_subcontractor_budget || 0) + (budget.total_equipment_budget || 0) + 
                                            (budget.other_costs || 0);
                                const profit = budget.total_quoted_price - costs - (budget.overhead_allocation || 0);
                                const margin = budget.total_quoted_price > 0 ? (profit / budget.total_quoted_price) * 100 : 0;
                                return (
                                  <div className="flex items-center justify-between mt-0.5">
                                    <span className="text-[9px] text-green-700">Margin</span>
                                    <div className="flex items-center gap-0.5">
                                      {margin >= 15 ? (
                                        <TrendingUp className="w-2.5 h-2.5 text-green-600" />
                                      ) : margin >= 10 ? (
                                        <TrendingUp className="w-2.5 h-2.5 text-yellow-600" />
                                      ) : (
                                        <TrendingDown className="w-2.5 h-2.5 text-red-600" />
                                      )}
                                      <span className={`text-[9px] font-semibold ${
                                        margin >= 15 ? 'text-green-600' : 
                                        margin >= 10 ? 'text-yellow-600' : 
                                        'text-red-600'
                                      }`}>
                                        {margin.toFixed(1)}%
                                      </span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* Quick Action Buttons */}
                          <div className="flex gap-0.5 pt-1 border-t">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] flex-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}
                            >
                              <ScrollText className="w-2.5 h-2.5 sm:mr-0.5" />
                              <span className="hidden sm:inline">Proposal</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] flex-1 relative"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('proposal-materials');
                              }}
                            >
                              <Package className="w-2.5 h-2.5 sm:mr-0.5" />
                              <span className="hidden sm:inline">Materials</span>
                              {crewOrderCounts[job.id] > 0 && (
                                <Badge variant="secondary" className="ml-1 bg-orange-500 text-white text-[8px] py-0 px-1 h-3.5 leading-none">
                                  {crewOrderCounts[job.id]}
                                </Badge>
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] flex-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                openJobDetail(job);
                                setSelectedTab('schedule');
                              }}
                            >
                              <CalendarIcon className="w-2.5 h-2.5 sm:mr-0.5" />
                              <span className="hidden sm:inline">Schedule</span>
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            </div>
          </div>
        )}
      </div>

      <CreateJobDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onSuccess={() => {
          setShowCreateDialog(false);
          loadJobs();
        }}
      />

      <EditJobDialog
        open={showEditDialog}
        job={detailDialogJobId ? (jobs.find(j => j.id === detailDialogJobId) ?? selectedJob) : selectedJob}
        onClose={() => setShowEditDialog(false)}
        onSuccess={() => {
          setShowEditDialog(false);
          loadJobs();
          reloadSelectedJob();
        }}
      />

      {/* Shop Materials Dialog */}
      <ShopMaterialsDialog
        open={showShopMaterialsDialog}
        onClose={() => setShowShopMaterialsDialog(false)}
        onJobSelect={(jobId) => {
          const job = jobs.find(j => j.id === jobId);
          if (job) {
            openJobDetail(job);
            setSelectedTab('proposal-materials');
          }
        }}
      />

      {/* Material Orders Dialog */}
      <Dialog open={showOrdersDialog} onOpenChange={setShowOrdersDialog}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              Material Orders
            </DialogTitle>
          </DialogHeader>
          <MaterialOrdersManagement />
        </DialogContent>
      </Dialog>

      {/* Budget Management Dialog */}
      <Dialog open={showBudgetDialog} onOpenChange={setShowBudgetDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {budgetJobId && jobs.find(j => j.id === budgetJobId)?.name} - Budget
            </DialogTitle>
          </DialogHeader>
          {budgetJobId && (
            <div className="mt-4">
              <JobBudgetManagement 
                onUpdate={() => {
                  loadJobBudgets();
                  loadJobs();
                }}
                jobIdFilter={budgetJobId}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Start a conversation (new message to customer) */}
      <Dialog
        open={showNewMessageDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowNewMessageDialog(false);
            setNewMessageJobId('');
            setNewMessageSubject('');
            setNewMessageBody('');
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              Start a conversation
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Send a message to a customer. They&apos;ll see it in their portal under Messages.
            </p>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Job</Label>
              <Select value={newMessageJobId} onValueChange={setNewMessageJobId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a job" />
                </SelectTrigger>
                <SelectContent>
                  {jobs
                    .filter((j) => isVisibleJobCard(j) && j.status !== 'archived')
                    .map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.name} {j.client_name ? `(${j.client_name})` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="new-msg-subject">Subject (optional)</Label>
              <Input
                id="new-msg-subject"
                value={newMessageSubject}
                onChange={(e) => setNewMessageSubject(e.target.value)}
                placeholder="Message from project team"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="new-msg-body">Message</Label>
              <Textarea
                id="new-msg-body"
                value={newMessageBody}
                onChange={(e) => setNewMessageBody(e.target.value)}
                placeholder="Type your message..."
                rows={4}
                className="mt-1"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowNewMessageDialog(false);
                  setNewMessageJobId('');
                  setNewMessageSubject('');
                  setNewMessageBody('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={sendNewMessageToCustomer}
                disabled={sendingNewMessage || !newMessageJobId || !newMessageBody.trim()}
              >
                {sendingNewMessage ? 'Sending...' : (
                  <>
                    <Send className="w-4 h-4 mr-1" />
                    Send
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reply to customer (portal) */}
      <Dialog open={showReplyDialog} onOpenChange={(open) => { if (!open) { setShowReplyDialog(false); setReplyToMessage(null); setReplyBody(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reply to customer</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {replyToMessage?.jobs?.name ? `Job: ${replyToMessage.jobs.name}` : ''} — Customer will see this in their portal.
            </p>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="reply-body">Message</Label>
              <Textarea
                id="reply-body"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Type your message..."
                rows={4}
                className="mt-1"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { setShowReplyDialog(false); setReplyToMessage(null); setReplyBody(''); }}>
                Cancel
              </Button>
              <Button type="button" onClick={sendReplyToCustomer} disabled={sendingReply || !replyBody.trim()}>
                {sendingReply ? 'Sending...' : (
                  <>
                    <Send className="w-4 h-4 mr-1" />
                    Send
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>

      {/* Job Details Dialog - Full Screen (archived / internal only; main jobs tab uses OfficeOpenJobDialog) */}
      {!delegateJobDialog && (() => {
        const dialogJob = detailDialogJobId
          ? (jobs.find(j => j.id === detailDialogJobId) ?? selectedJob)
          : selectedJob;
        const dialogOpen = !!detailDialogJobId && jobsTabActive;
        return (
          <Dialog open={dialogOpen} onOpenChange={handleJobDialogOpenChange}>
            <DialogContent
              className="h-screen w-screen max-w-none flex flex-col p-0 m-0 rounded-none"
              showCloseButton={false}
              onInteractOutside={(e) => e.preventDefault()}
              onPointerDownOutside={(e) => e.preventDefault()}
              onEscapeKeyDown={() => closeJobDetail()}
            >
              <DialogHeader className="px-2 pt-2 pb-2 border-b shrink-0 bg-white">
                <div className="flex items-center justify-between">
                  <DialogTitle className="text-xl">
                    {dialogJob?.name}
                  </DialogTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowEditDialog(true);
                    }}
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Job
                  </Button>
                </div>
              </DialogHeader>
              {dialogJob ? (
                <div className="flex-1 overflow-y-auto w-full">
                  <JobDetailedView
                    job={dialogJob}
                    portalJobId={detailDialogJobId}
                    getPortalJobId={() => portalJobIdRef.current ?? detailDialogJobId}
                    onBack={() => closeJobDetail()}
                    onEdit={() => {
                      setShowEditDialog(true);
                    }}
                    onJobUpdate={reloadSelectedJob}
                    initialTab={selectedTab}
                    onTabChange={(tab) => {
                      setSelectedTab(tab);
                      const jobId = portalJobIdRef.current ?? detailDialogJobId;
                      if (jobId) syncJobToUrl(jobId, tab);
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Loading job…
                </div>
              )}
            </DialogContent>
          </Dialog>
        );
      })()}
    </>
  );
}
