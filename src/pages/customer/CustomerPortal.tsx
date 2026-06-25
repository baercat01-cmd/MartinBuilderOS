import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { 
  FileText, 
  DollarSign, 
  Calendar, 
  Image, 
  Download, 
  ExternalLink,
  CheckCircle,
  Clock,
  MapPin,
  Phone,
  Mail,
  FileSpreadsheet,
  ChevronRight,
  Briefcase,
  Send,
  MessageSquare,
  Inbox,
  Copy,
  LayoutDashboard,
  Printer,
  PenLine,
  ClipboardList,
  Package
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isFieldRequestSheetName } from '@/lib/materialWorkbook';
import { loadViewerLinksForJob } from '@/lib/viewer-links';
import { toast } from 'sonner';
import { PWAInstallButton } from '@/components/ui/pwa-install-button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { generateProposalHTML, generateChangeOrderDocumentHTML } from '@/components/office/ProposalPDFTemplate';
import { computeProposalTotals } from '@/lib/proposalTotals';
import { loadProposalDataForQuote } from '@/lib/loadProposalDataForQuote';
import { buildProposalHtmlForPortal } from '@/lib/proposalPortalHtml';
import { quoteHasActiveContract } from '@/lib/quoteProposalLock';
import { MartinBuilderContractSeal } from '@/components/customer/MartinBuilderContractSeal';
import { PortalMaterialItemsTable } from '@/components/customer/PortalMaterialItemsTable';
import { PortalMultilineText } from '@/components/customer/PortalMultilineText';
import {
  PortalSheetPricedLineItems,
  portalSheetLinkedItemSellingAmount,
} from '@/components/customer/PortalSheetPricedLineItems';
import {
  readEffectiveMaterialListVisibility,
  stripMaterialVisibilityMarker,
} from '@/lib/customerPortalMaterialListVisibility';
import { parseRpcJsonbArray, resolveLatestJobDocumentRevision } from '@/lib/portalRpcPayload';

interface Job {
  id: string;
  name: string;
  client_name: string;
  address: string;
  customer_phone?: string;
  description: string | null;
  notes: string | null;
  status: string;
  projected_start_date: string | null;
  projected_end_date: string | null;
  created_at: string;
}

interface JobSummary {
  job: Job;
  totalAmount: number;
  totalPaid: number;
  balance: number;
  photoCount: number;
  documentCount: number;
  scheduleEventCount: number;
}

// Full select; fallback used when show_line_item_prices column is missing (PGRST204 / migration not run)
const CUSTOMER_PORTAL_ACCESS_SELECT =
  'id,job_id,customer_identifier,access_token,customer_name,customer_email,customer_phone,is_active,expires_at,last_accessed_at,created_by,created_at,updated_at,show_proposal,show_payments,show_schedule,show_documents,show_photos,show_financial_summary,show_line_item_prices,show_material_items_no_prices,show_section_prices,visibility_by_quote,custom_message';
const CUSTOMER_PORTAL_ACCESS_SELECT_FALLBACK =
  'id,job_id,customer_identifier,access_token,customer_name,customer_email,customer_phone,is_active,expires_at,last_accessed_at,created_by,created_at,updated_at,show_proposal,show_payments,show_schedule,show_documents,show_photos,show_financial_summary,custom_message';

export const CUSTOMER_PORTAL_TOKEN_KEY = 'customer_portal_token';

export default function CustomerPortal() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  // If an office device resumes a stale customer portal URL, force it back to Jobs home.
  // `portal_stay=1` allows intentional customer-portal preview/testing when needed.
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('portal_stay') === '1') return;
    } catch {
      return;
    }

    let lastRole: string | null = null;
    let hasOfficeSession = false;
    try {
      lastRole = localStorage.getItem('mb_last_app_role');
      hasOfficeSession =
        localStorage.getItem('fieldtrack_user_id') !== null || localStorage.getItem('mb_profile') !== null;
    } catch {
      return;
    }

    if (lastRole !== 'office' && !hasOfficeSession) return;
    window.location.replace(`${window.location.origin}/office?tab=jobs`);
  }, []);
  
  const [loading, setLoading] = useState(true);
  const [validToken, setValidToken] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<any>(null);
  const [jobData, setJobData] = useState<any>(null);
  /** Why access was denied, so we can show a clearer message */
  const [accessDeniedReason, setAccessDeniedReason] = useState<'no_token' | 'expired' | 'invalid' | 'network' | null>(null);
  /** Survives job data refresh so "Sign & use as contract" stays hidden after successful sign */
  const [portalSignPendingByQuote, setPortalSignPendingByQuote] = useState<Record<string, { name: string }>>({});
  const onPortalSignRecorded = useCallback((quoteId: string, name: string) => {
    setPortalSignPendingByQuote((p) => ({ ...p, [quoteId]: { name } }));
  }, []);
  const onPortalSignClearForQuote = useCallback((quoteId: string) => {
    setPortalSignPendingByQuote((p) => {
      const n = { ...p };
      delete n[quoteId];
      return n;
    });
  }, []);

  // Refetch portal visibility (payments, schedule, documents, etc.) so customer sees latest office toggles
  async function refetchPortalVisibility(accessToken: string) {
    if (!accessToken?.trim()) return;
    try {
      const { data: rpcRow, error: rpcError } = await supabase.rpc('get_customer_portal_access_by_token', {
        p_access_token: accessToken.trim(),
      });
      if (!rpcError && rpcRow != null) {
        let row: any = rpcRow;
        if (typeof row === 'string') {
          try { row = JSON.parse(row); } catch { row = null; }
        }
        if (Array.isArray(row) && row.length > 0) row = row[0];
        const fresh = row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
        if (fresh) {
          // Backfill from table in case RPC shape is stale/cached and omits newer visibility columns.
          let direct: { show_material_items_no_prices?: boolean; visibility_by_quote?: unknown } | null = null;
          if (fresh.id) {
            const { data: directRow } = await supabase
              .from('customer_portal_access')
              .select('show_material_items_no_prices, visibility_by_quote')
              .eq('id', fresh.id as string)
              .maybeSingle();
            if (directRow) direct = directRow as any;
          }
          setCustomerInfo((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              show_proposal: fresh.show_proposal ?? prev.show_proposal,
              show_payments: fresh.show_payments ?? prev.show_payments,
              show_schedule: fresh.show_schedule ?? prev.show_schedule,
              show_documents: fresh.show_documents ?? prev.show_documents,
              show_photos: fresh.show_photos ?? prev.show_photos,
              show_financial_summary: fresh.show_financial_summary ?? prev.show_financial_summary,
              show_line_item_prices: fresh.show_line_item_prices ?? prev.show_line_item_prices,
              show_material_items_no_prices:
                direct?.show_material_items_no_prices ??
                (fresh as { show_material_items_no_prices?: boolean }).show_material_items_no_prices ??
                prev.show_material_items_no_prices,
              show_section_prices: fresh.show_section_prices ?? prev.show_section_prices,
              visibility_by_quote: direct?.visibility_by_quote ?? fresh.visibility_by_quote ?? prev.visibility_by_quote,
            };
          });
        }
      }
    } catch {
      // Non-fatal; keep existing customerInfo
    }
  }

  /** Refresh quotes (includes customer_signed_at) — anon RLS often hides signature fields on direct SELECT */
  async function refetchPortalQuotes(accessToken: string, jobId: string) {
    if (!accessToken?.trim() || !jobId) return;
    try {
      const { data, error } = await supabase.rpc('get_quotes_for_customer_portal', {
        p_access_token: accessToken.trim(),
        p_job_id: jobId,
      });
      if (error || data == null) return;
      let arr: any = data;
      if (typeof arr === 'string') {
        try {
          arr = JSON.parse(arr);
        } catch {
          return;
        }
      }
      if (!Array.isArray(arr) || arr.length === 0) return;
      setJobData((prev) => {
        if (!prev?.job || prev.job.id !== jobId) return prev;
        return { ...prev, jobQuotes: arr, quote: arr[0] ?? prev.quote };
      });
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (token) {
      setAccessDeniedReason(null);
      validateAndLoadData();
    } else {
      setAccessDeniedReason('no_token');
      setLoading(false);
      toast.error('No access token provided');
    }
  }, [token]);

  // Refetch visibility when user returns to tab or periodically, so office toggles (payments/schedule/documents off) apply
  useEffect(() => {
    if (!validToken || !customerInfo) return;
    const t =
      typeof searchParams.get('token') === 'string' && searchParams.get('token')
        ? searchParams.get('token')
        : (typeof localStorage !== 'undefined' ? localStorage.getItem(CUSTOMER_PORTAL_TOKEN_KEY) : null);
    if (!t) return;

    const jobId = customerInfo.job_id as string;
    const refreshPortalData = async () => {
      await refetchPortalVisibility(t);
      if (jobId) await refetchPortalQuotes(t, jobId);
      await loadCustomerData(customerInfo, t);
    };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refreshPortalData().catch(() => {
          // Keep portal usable even if background refresh fails.
        });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const interval = setInterval(() => {
      refreshPortalData().catch(() => {
        // Keep portal usable even if background refresh fails.
      });
    }, 90_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, [validToken, customerInfo?.id]);

  // Live updates for portal messages so customer sees new replies without refreshing.
  useEffect(() => {
    if (!validToken || !customerInfo?.job_id) return;
    const t =
      typeof searchParams.get('token') === 'string' && searchParams.get('token')
        ? searchParams.get('token')
        : (typeof localStorage !== 'undefined' ? localStorage.getItem(CUSTOMER_PORTAL_TOKEN_KEY) : null);
    if (!t) return;

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        loadCustomerData(customerInfo, t).catch(() => {
          // Keep portal usable if live refresh fails.
        });
      }, 200);
    };

    const channel = supabase
      .channel(`customer-portal-job-messages-${customerInfo.job_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_messages',
          filter: `job_id=eq.${customerInfo.job_id}`,
        },
        () => {
          scheduleReload();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_documents',
          filter: `job_id=eq.${customerInfo.job_id}`,
        },
        () => {
          scheduleReload();
        }
      )
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [validToken, customerInfo?.id, customerInfo?.job_id, searchParams]);

  async function validateAndLoadData() {
    if (!token) return;

    try {
      // Prefer RPC so we always get full visibility settings regardless of RLS (customer portal reflects office settings)
      let accessData: any = null;
      const { data: rpcRow, error: rpcError } = await supabase.rpc('get_customer_portal_access_by_token', { p_access_token: token });
      if (!rpcError && rpcRow != null) {
        // Normalize: RPC can return single jsonb object, or array of one row, or stringified JSON
        let row: any = rpcRow;
        if (typeof row === 'string') {
          try { row = JSON.parse(row); } catch { row = null; }
        }
        if (Array.isArray(row) && row.length > 0) row = row[0];
        if (row && typeof row === 'object' && (row.job_id != null || row.id != null)) {
          accessData = {
            ...row,
            show_line_item_prices: row.show_line_item_prices ?? false,
            show_material_items_no_prices: row.show_material_items_no_prices,
          };
          // Some environments return stale RPC row shapes for newer visibility fields.
          // Backfill directly from table so Materials tab visibility resolves correctly.
          if (accessData.id) {
            const { data: directRow } = await supabase
              .from('customer_portal_access')
              .select('show_material_items_no_prices, visibility_by_quote')
              .eq('id', accessData.id)
              .maybeSingle();
            if (directRow) {
              if (typeof directRow.show_material_items_no_prices === 'boolean') {
                accessData.show_material_items_no_prices = directRow.show_material_items_no_prices;
              }
              if (directRow.visibility_by_quote != null) {
                accessData.visibility_by_quote = directRow.visibility_by_quote;
              }
            }
          }
          if ((accessData as { show_material_items_no_prices?: unknown }).show_material_items_no_prices === undefined) {
            // Fail-closed: column default is false; stale RPC shapes must not expose materials.
            accessData.show_material_items_no_prices = false;
          }
        }
      }
      if (!accessData) {
        let select = CUSTOMER_PORTAL_ACCESS_SELECT;
        let { data, error: accessError } = await supabase
          .from('customer_portal_access')
          .select(select)
          .eq('access_token', token)
          .eq('is_active', true)
          .maybeSingle();

        if (accessError && (accessError?.code === 'PGRST204' || (accessError?.message && /show_line_item_prices|show_section_prices|column.*exist/i.test(accessError.message)))) {
          select = CUSTOMER_PORTAL_ACCESS_SELECT_FALLBACK;
          const fallback = await supabase
            .from('customer_portal_access')
            .select(select)
            .eq('access_token', token)
            .eq('is_active', true)
            .maybeSingle();
          accessData = fallback.data;
          accessError = fallback.error;
        }
        if (accessError || !accessData) {
          setAccessDeniedReason(accessError && /connection|refused|fetch|network/i.test(String(accessError.message)) ? 'network' : 'invalid');
          toast.error('Invalid or expired access link');
          setLoading(false);
          return;
        }
        accessData = {
          ...accessData,
          show_line_item_prices: accessData.show_line_item_prices ?? false,
          show_material_items_no_prices: accessData.show_material_items_no_prices ?? false,
        };
      }

      // Check expiration
      if (accessData.expires_at && new Date(accessData.expires_at) < new Date()) {
        setAccessDeniedReason('expired');
        toast.error('This access link has expired');
        setLoading(false);
        return;
      }

      setValidToken(true);
      setCustomerInfo(accessData);
      try {
        localStorage.setItem(CUSTOMER_PORTAL_TOKEN_KEY, token);
      } catch { /* ignore */ }

      // Update last accessed time
      await supabase
        .from('customer_portal_access')
        .update({ last_accessed_at: new Date().toISOString() })
        .eq('id', accessData.id);

      // Load data for the customer (use job from link when set, else find by customer)
      await loadCustomerData(accessData, token);
    } catch (error: any) {
      console.error('Error validating token:', error);
      setAccessDeniedReason(/connection|refused|fetch|network/i.test(String(error?.message)) ? 'network' : 'invalid');
      toast.error('Failed to load portal data');
      setLoading(false);
    }
  }

  async function loadCustomerData(accessData: any, portalToken?: string | null) {
    try {
      // Always use job_id from the portal link row so we show the correct job (never guess by customer name)
      if (!accessData.job_id) {
        toast.error('This link is not associated with a project. Please use the link from your project manager.');
        setLoading(false);
        return;
      }
      const { data: jobRow, error: jobError } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', accessData.job_id)
        .maybeSingle();
      if (jobError || !jobRow) {
        toast.error('Project not found or access was revoked.');
        setLoading(false);
        return;
      }
      const job = jobRow;

      const portalTok =
        (portalToken && String(portalToken).trim()) ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem(CUSTOMER_PORTAL_TOKEN_KEY) : null);

      // Load quotes: prefer RPC so customer_signed_at / status are visible to anon portal users
      let jobQuotes: any[] = [];
      if (portalTok?.trim()) {
        const { data: rpcQuotes, error: rpcQuotesErr } = await supabase.rpc('get_quotes_for_customer_portal', {
          p_access_token: portalTok.trim(),
          p_job_id: job.id,
        });
        if (!rpcQuotesErr && rpcQuotes != null) {
          let arr: any = rpcQuotes;
          if (typeof arr === 'string') {
            try {
              arr = JSON.parse(arr);
            } catch {
              arr = null;
            }
          }
          if (Array.isArray(arr) && arr.length > 0) jobQuotes = arr;
        }
      }
      if (jobQuotes.length === 0) {
        const { data: quotesData } = await supabase
          .from('quotes')
          .select('*')
          .eq('job_id', job.id)
          .order('created_at', { ascending: false });
        jobQuotes = quotesData || [];
      }
      const quoteData = jobQuotes[0] ?? null;

      // Load payments
      const { data: paymentsData } = await supabase
        .from('customer_payments')
        .select('*')
        .eq('job_id', job.id)
        .order('payment_date', { ascending: false });

      // Load documents marked visible to customer portal (use RPC when token present so anon can see them despite RLS)
      let documentsData: any[] = [];
      const t = portalTok;
      if (t?.trim()) {
        const { data: rpcDocs, error: rpcErr } = await supabase.rpc('get_job_documents_for_customer_portal', {
          p_access_token: t.trim(),
          p_job_id: job.id,
        });
        if (!rpcErr) {
          documentsData = parseRpcJsonbArray(rpcDocs) as any[];
        } else {
          // Same payload shape as primary after migration 20260325120000 (jsonb + revisions); use when primary RPC errors.
          const { data: rpcDocsAny, error: rpcAnyErr } = await supabase.rpc('get_job_documents_for_customer_portal_any', {
            p_access_token: t.trim(),
            p_job_id: job.id,
          });
          if (!rpcAnyErr) {
            documentsData = parseRpcJsonbArray(rpcDocsAny) as any[];
          }
        }
      }
      if (documentsData.length === 0 && !t?.trim()) {
        const { data: directDocs } = await supabase
          .from('job_documents')
          .select(`*, job_document_revisions(*)`)
          .eq('job_id', job.id)
          .eq('visible_to_customer_portal', true);
        documentsData = directDocs ?? [];
      }

      // Load photos
      const { data: photosData } = await supabase
        .from('photos')
        .select('*')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(100);

      // Load schedule events
      const { data: scheduleData } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('job_id', job.id)
        .order('event_date', { ascending: true });

      // Load direct portal messages for this job (email-independent).
      let emailsData: any[] | null = null;
      if (t?.trim()) {
        const { data: rpcMessages, error: rpcErr } = await supabase.rpc('get_job_messages_for_customer_portal', {
          p_access_token: t.trim(),
          p_job_id: job.id,
        });
        if (!rpcErr && rpcMessages != null) {
          let rows: any[] = [];
          if (Array.isArray(rpcMessages)) rows = rpcMessages;
          else if (typeof rpcMessages === 'object' && !Array.isArray(rpcMessages)) rows = [rpcMessages];
          else if (typeof rpcMessages === 'string') {
            try {
              const parsed = JSON.parse(rpcMessages);
              rows = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
              rows = [];
            }
          }
          // Safety filter: hide soft-cleared rows even if RPC still returns them.
          rows = rows.filter((m: any) => !m?.hidden_at);
          // Keep existing UI shape for now.
          emailsData = rows.map((m: any) => ({
            id: m.id,
            subject: m.sender_role === 'customer' ? 'Message from You' : 'Message from Project Team',
            from_name: m.sender_name,
            from_email: m.sender_contact,
            body_text: m.message_text,
            body_html: null,
            email_date: m.created_at,
            direction: m.sender_role === 'team' ? 'sent' : 'inbound',
            is_read: m.is_read ?? false,
          }));
        }
      }
      if (emailsData == null) {
        let directMessages: any[] | null = null;
        const primary = await supabase
          .from('job_messages')
          .select('*')
          .eq('job_id', job.id)
          .is('hidden_at', null)
          .order('created_at', { ascending: false })
          .limit(200);
        if (!primary.error) {
          directMessages = primary.data || [];
        } else {
          // Backward compatibility for databases that do not yet have hidden_at.
          const fallback = await supabase
            .from('job_messages')
            .select('*')
            .eq('job_id', job.id)
            .order('created_at', { ascending: false })
            .limit(200);
          directMessages = fallback.data || [];
        }
        emailsData = (directMessages || []).map((m: any) => ({
          id: m.id,
          subject: m.sender_role === 'customer' ? 'Message from You' : 'Message from Project Team',
          from_name: m.sender_name,
          from_email: m.sender_contact,
          body_text: m.message_text,
          body_html: null,
          email_date: m.created_at,
          direction: m.sender_role === 'team' ? 'sent' : 'inbound',
          is_read: m.is_read ?? false,
        }));
      }

      // Proposal data is loaded per-quote in JobDetailView when customer selects a proposal
      const viewerLinks = await loadViewerLinksForJob(supabase, job.id);
      const totalPaid = (paymentsData || []).reduce((sum, p) => sum + parseFloat(p.amount.toString()), 0);

      // Ensure tax_exempt is available on quotes (in case PostgREST schema cache doesn't expose it)
      let quotesWithTax = jobQuotes;
      if (jobQuotes.length > 0 && jobQuotes.some((q: any) => q.tax_exempt === undefined)) {
        const { data: taxRows } = await supabase.rpc('get_job_quotes_tax_exempt', { p_job_id: job.id });
        const taxByQuote = new Map((taxRows || []).map((r: any) => [r.quote_id, r.tax_exempt]));
        quotesWithTax = jobQuotes.map((q: any) => ({ ...q, tax_exempt: taxByQuote.get(q.id) ?? false }));
      }

      setJobData({
        job,
        quote: quoteData,
        jobQuotes: quotesWithTax,
        payments: paymentsData || [],
        documents: documentsData || [],
        photos: photosData || [],
        scheduleEvents: scheduleData || [],
        emails: emailsData || [],
        viewerLinks,
        totalPaid,
      });

      setLoading(false);
    } catch (error: any) {
      console.error('Error loading customer data:', error);
      toast.error('Failed to load your project');
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-lg text-slate-600">Loading your project portal...</p>
        </div>
      </div>
    );
  }

  if (!validToken || !customerInfo) {
    const reason = accessDeniedReason;
    const title = reason === 'no_token' ? 'No portal link' : 'Access denied';
    const message =
      reason === 'no_token'
        ? 'Open the full link from your project manager (email or message). The link must include the full URL, e.g. …/customer-portal?token=…. Do not bookmark the page without the token.'
        : reason === 'expired'
          ? 'This access link has expired. Please contact your project manager for a new link.'
          : reason === 'network'
            ? 'We couldn\'t reach the server. Check your internet connection and try again. If you use a VPN or corporate network, it may be blocking the connection.'
            : 'The access link is invalid or was deactivated. Use the full link from your project manager, or ask for a new link.';
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-center text-2xl text-destructive">{title}</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              {message}
            </p>
            <p className="text-sm text-muted-foreground">
              If you were sent a new link, open it in this browser. If the problem continues, contact your project manager.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!jobData) {
    return null; // Still loading
  }

  // Show job detail view directly (pass searchParams so portal can open with same proposal as office)
  return (
    <JobDetailView
      jobData={jobData}
      customerInfo={customerInfo}
      searchParams={searchParams}
      onRefreshJobData={async () => { if (customerInfo) await loadCustomerData(customerInfo); }}
      portalSignPendingByQuote={portalSignPendingByQuote}
      onPortalSignRecorded={onPortalSignRecorded}
      onPortalSignClearForQuote={onPortalSignClearForQuote}
    />
  );
}

// Job Detail View Component
function JobDetailView({
  jobData,
  customerInfo,
  searchParams,
  onRefreshJobData,
  portalSignPendingByQuote = {},
  onPortalSignRecorded,
  onPortalSignClearForQuote,
}: {
  jobData: any;
  customerInfo: any;
  searchParams?: URLSearchParams;
  onRefreshJobData?: () => Promise<void>;
  portalSignPendingByQuote?: Record<string, { name: string }>;
  onPortalSignRecorded?: (quoteId: string, name: string) => void;
  onPortalSignClearForQuote?: (quoteId: string) => void;
}) {
  const { job, quote, jobQuotes = [], payments, documents, photos, scheduleEvents, emails, viewerLinks = [], totalPaid } = jobData;
  const [activeTab, setActiveTab] = useState('overview');
  const messageThreadRef = useRef<HTMLDivElement | null>(null);
  const [hasPortalUpdates, setHasPortalUpdates] = useState(false);
  const notificationSnapshotRef = useRef<string | null>(null);
  const previousUnreadTeamMessagesRef = useRef(0);
  const portalMessageSeenKey = useMemo(
    () => `customer_portal_last_seen_message_at_${job?.id ?? 'unknown'}_${customerInfo?.id ?? 'anon'}`,
    [job?.id, customerInfo?.id]
  );
  const [lastSeenTeamMessageAt, setLastSeenTeamMessageAt] = useState<number>(0);

  /** Main contract proposals only — change order is its own quote and portal tab */
  const proposalQuotes = useMemo(
    () => (jobQuotes as any[]).filter((q: any) => !q.is_change_order_proposal),
    [jobQuotes]
  );
  const changeOrderQuote = useMemo(
    () => (jobQuotes as any[]).find((q: any) => q.is_change_order_proposal) ?? null,
    [jobQuotes]
  );

  // Default: latest proposal first (newest created/sent/highest proposal number).
  const defaultQuoteId = (() => {
    if (!proposalQuotes.length) return quote && !(quote as any).is_change_order_proposal ? quote.id : null;
    const list = proposalQuotes as any[];
    const sorted = [...list].sort((a: any, b: any) => {
      const aSent = new Date(a.sent_at || 0).getTime();
      const bSent = new Date(b.sent_at || 0).getTime();
      if (aSent !== bSent) return bSent - aSent;
      const aCreated = new Date(a.created_at || 0).getTime();
      const bCreated = new Date(b.created_at || 0).getTime();
      if (aCreated !== bCreated) return bCreated - aCreated;
      const aN = parseInt((a.proposal_number || a.quote_number || '0').toString().split('-').pop() || '0', 10);
      const bN = parseInt((b.proposal_number || b.quote_number || '0').toString().split('-').pop() || '0', 10);
      return bN - aN;
    });
    return sorted[0]?.id ?? proposalQuotes[0]?.id ?? null;
  })();

  // If URL has ?quote=uuid and it's a main proposal for this job, use it (never the change-order quote here)
  const quoteIdFromUrl = searchParams?.get('quote') ?? null;
  const coQuoteIdFromUrl = searchParams?.get('change_order') === '1';
  const tabFromUrl = searchParams?.get('tab') ?? null;
  /** Full-page material list (no prices): /customer-portal?token=…&sheet=<sheetId>[&quote=…|&change_order=1] */
  const sheetIdFromUrl = searchParams?.get('sheet') ?? null;
  const materialSheetPageIsCo = searchParams?.get('change_order') === '1';
  const initialQuoteId =
    quoteIdFromUrl && proposalQuotes.some((q: any) => q.id === quoteIdFromUrl)
      ? quoteIdFromUrl
      : defaultQuoteId;

  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(initialQuoteId);
  const selectedQuote =
    proposalQuotes.find((q: any) => q.id === selectedQuoteId) ?? proposalQuotes[0] ?? null;

  /** Show proposal body when office clicked "Mark as Sent" OR set a contract (customer sign / signed_version). */
  const proposalVisibleInPortal = useMemo(() => {
    if (!selectedQuote) return false;
    const q = selectedQuote as any;
    if (q.sent_at) return true;
    return quoteHasActiveContract(q);
  }, [selectedQuote]);

  useEffect(() => {
    if (searchParams?.get('change_order') === '1' && changeOrderQuote) {
      setActiveTab('change-orders');
    }
  }, [searchParams, changeOrderQuote?.id]);

  useEffect(() => {
    if (!selectedQuoteId || !proposalQuotes.some((q: any) => q.id === selectedQuoteId)) {
      const fallback = defaultQuoteId ?? proposalQuotes[0]?.id ?? null;
      if (fallback && fallback !== selectedQuoteId) setSelectedQuoteId(fallback);
    }
  }, [proposalQuotes, selectedQuoteId]);
  const [proposalData, setProposalData] = useState<any>(null);
  const [proposalDataLoading, setProposalDataLoading] = useState(false);
  const proposalDataCacheRef = useRef<Record<string, any>>({});
  /** Totals from get_quote_proposal_totals RPC (written by JobFinancials) so Overview matches office exactly */
  const [quoteStoredTotals, setQuoteStoredTotals] = useState<{ subtotal: number; tax: number; grandTotal: number } | null>(null);
  // Visibility: use link-level columns as source-of-truth for core toggles.
  // Per-quote JSON is only used for section-level map overrides.
  const perQuoteVis = selectedQuoteId && customerInfo?.visibility_by_quote && typeof customerInfo.visibility_by_quote === 'object' && !Array.isArray(customerInfo.visibility_by_quote)
    ? (customerInfo.visibility_by_quote as Record<string, any>)[selectedQuoteId]
    : null;
  const perQuoteVisObj = perQuoteVis && typeof perQuoteVis === 'object' ? (perQuoteVis as Record<string, unknown>) : null;
  const readPerQuoteBool = (key: string, fallback: boolean): boolean => {
    if (perQuoteVisObj && key in perQuoteVisObj) return perQuoteVisObj[key] === true;
    return fallback;
  };
  const showFinancial = readPerQuoteBool('show_financial_summary', customerInfo?.show_financial_summary === true);
  const showLineItemPrices = readPerQuoteBool('show_line_item_prices', customerInfo?.show_line_item_prices === true);
  const showSectionPrices: Record<string, boolean> | null =
    perQuoteVisObj && typeof perQuoteVisObj.show_section_prices === 'object' && perQuoteVisObj.show_section_prices !== null && !Array.isArray(perQuoteVisObj.show_section_prices)
      ? (perQuoteVisObj.show_section_prices as Record<string, boolean>)
      : (typeof customerInfo?.show_section_prices === 'object' && customerInfo?.show_section_prices !== null && !Array.isArray(customerInfo?.show_section_prices)
          ? (customerInfo.show_section_prices as Record<string, boolean>)
          : null);
  const showPriceForSection = (_sectionId: string) => showFinancial && showLineItemPrices;
  const readSectionTotal = (entity: any, fallback = 0) => {
    const candidates = [
      entity?._computedTotal,
      entity?.section_total,
      entity?.total,
      entity?.total_price,
      entity?.price,
      fallback,
    ];
    for (const c of candidates) {
      const n = Number(c);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  };
  const showMaterialItemsNoPrices = readEffectiveMaterialListVisibility(customerInfo, selectedQuoteId);
  const showProposal = customerInfo?.show_proposal === true;
  const showPayments = customerInfo?.show_payments === true;
  const showSchedule = customerInfo?.show_schedule === true;
  const showDocuments = customerInfo?.show_documents === true;
  const showPhotos = customerInfo?.show_photos === true;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(portalMessageSeenKey);
      const n = raw ? Number(raw) : 0;
      setLastSeenTeamMessageAt(Number.isFinite(n) ? n : 0);
    } catch {
      setLastSeenTeamMessageAt(0);
    }
  }, [portalMessageSeenKey]);
  const unreadTeamMessages = useMemo(
    () =>
      emails.filter((e: any) => {
        if (e.direction !== 'sent') return false;
        const ts = new Date(e.email_date).getTime();
        return Number.isFinite(ts) && ts > lastSeenTeamMessageAt;
      }).length,
    [emails, lastSeenTeamMessageAt]
  );
  const markPortalMessagesSeen = useCallback(() => {
    const newestTeamMessageTs = emails
      .filter((e: any) => e.direction === 'sent')
      .reduce((max: number, e: any) => {
        const ts = new Date(e.email_date).getTime();
        return Number.isFinite(ts) && ts > max ? ts : max;
      }, Date.now());
    setLastSeenTeamMessageAt(newestTeamMessageTs);
    try {
      localStorage.setItem(portalMessageSeenKey, String(newestTeamMessageTs));
    } catch {
      // ignore storage errors
    }
  }, [emails, portalMessageSeenKey]);
  const messageDayKey = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const messageDayLabel = (iso: string) =>
    new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const threadMessages = useMemo(
    () =>
      [...emails].sort(
        (a: any, b: any) => new Date(a.email_date).getTime() - new Date(b.email_date).getTime()
      ),
    [emails]
  );
  useEffect(() => {
    if (activeTab !== 'emails') return;
    if (!messageThreadRef.current) return;
    messageThreadRef.current.scrollTop = messageThreadRef.current.scrollHeight;
  }, [activeTab, threadMessages.length]);
  useEffect(() => {
    if (activeTab === 'emails') {
      markPortalMessagesSeen();
    }
  }, [activeTab, markPortalMessagesSeen]);
  const notificationSnapshot = useMemo(() => {
    const latest = (rows: any[], key: string) =>
      rows.reduce((max: number, row: any) => {
        const value = row?.[key];
        const ts = value ? new Date(value).getTime() : 0;
        return Number.isFinite(ts) && ts > max ? ts : max;
      }, 0);
    return JSON.stringify({
      quoteCount: jobQuotes.length,
      latestQuote: latest(jobQuotes, 'updated_at'),
      paymentCount: payments.length,
      latestPayment: latest(payments, 'updated_at'),
      documentCount: documents.length,
      latestDocument: latest(documents, 'updated_at'),
      photoCount: photos.length,
      latestPhoto: latest(photos, 'updated_at'),
      scheduleCount: scheduleEvents.length,
      latestSchedule: latest(scheduleEvents, 'updated_at'),
      messageCount: emails.length,
      latestMessage: latest(emails, 'email_date'),
      portalUpdatedAt: customerInfo?.updated_at ? new Date(customerInfo.updated_at).getTime() : 0,
    });
  }, [jobQuotes, payments, documents, photos, scheduleEvents, emails, customerInfo?.updated_at]);
  useEffect(() => {
    if (!job?.id) return;
    if (notificationSnapshotRef.current == null) {
      notificationSnapshotRef.current = notificationSnapshot;
      previousUnreadTeamMessagesRef.current = unreadTeamMessages;
      return;
    }

    const unreadIncreased = unreadTeamMessages > previousUnreadTeamMessagesRef.current;
    if (unreadIncreased) {
      const diff = unreadTeamMessages - previousUnreadTeamMessagesRef.current;
      toast.info(
        diff === 1
          ? 'You have a new message from your project team.'
          : `You have ${diff} new messages from your project team.`
      );
      setHasPortalUpdates(true);
    }

    if (notificationSnapshotRef.current !== notificationSnapshot && !unreadIncreased) {
      toast.info('Your portal has new project updates.');
      setHasPortalUpdates(true);
    }

    notificationSnapshotRef.current = notificationSnapshot;
    previousUnreadTeamMessagesRef.current = unreadTeamMessages;
  }, [job?.id, notificationSnapshot, unreadTeamMessages]);
  useEffect(() => {
    if (activeTab === 'emails' || activeTab === 'overview') {
      setHasPortalUpdates(false);
    }
  }, [activeTab]);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSentInDialog, setEmailSentInDialog] = useState(false);
  const [emailSendError, setEmailSendError] = useState<string | null>(null);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [signing, setSigning] = useState(false);

  const changeOrderQuoteId = changeOrderQuote?.id ?? null;
  const [changeOrderProposalData, setChangeOrderProposalData] = useState<any>(null);
  const [changeOrderDataLoading, setChangeOrderDataLoading] = useState(false);
  const [coQuoteStoredTotals, setCoQuoteStoredTotals] = useState<{
    subtotal: number;
    tax: number;
    grandTotal: number;
  } | null>(null);
  const [coSignerName, setCoSignerName] = useState('');
  const [coSignerEmail, setCoSignerEmail] = useState('');
  const [coAgreeBySheet, setCoAgreeBySheet] = useState<Record<string, boolean>>({});
  const [coSigningSheetId, setCoSigningSheetId] = useState<string | null>(null);

  const coQuoteVis =
    changeOrderQuoteId && customerInfo?.visibility_by_quote && typeof customerInfo.visibility_by_quote === 'object' && !Array.isArray(customerInfo.visibility_by_quote)
      ? (customerInfo.visibility_by_quote as Record<string, any>)[changeOrderQuoteId]
      : null;
  const coVis = coQuoteVis && typeof coQuoteVis === 'object' ? coQuoteVis : customerInfo;
  const showFinancialCo = coVis?.show_financial_summary === true || customerInfo?.show_financial_summary === true;
  const showLineItemPricesCo = coVis?.show_line_item_prices === true || customerInfo?.show_line_item_prices === true;
  const showSectionPricesCo: Record<string, boolean> | null =
    typeof coVis?.show_section_prices === 'object' && coVis?.show_section_prices !== null && !Array.isArray(coVis?.show_section_prices)
      ? coVis.show_section_prices
      : null;
  const showPriceForCoSection = (_sectionId: string) =>
    showFinancialCo && showLineItemPricesCo;
  const showMaterialItemsNoPricesCo = changeOrderQuoteId
    ? readEffectiveMaterialListVisibility(customerInfo, changeOrderQuoteId)
    : false;

  useEffect(() => {
    if (!job?.id || !changeOrderQuoteId) {
      setChangeOrderProposalData(null);
      setChangeOrderDataLoading(false);
      return;
    }
    let cancelled = false;
    setChangeOrderDataLoading(true);
    loadProposalDataForQuote(job.id, changeOrderQuoteId, !!(changeOrderQuote as any)?.tax_exempt, {
      forChangeOrderDocument: true,
    }).then((data) => {
      if (cancelled) return;
      setChangeOrderProposalData(data);
      setChangeOrderDataLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [job?.id, changeOrderQuoteId, (changeOrderQuote as any)?.tax_exempt]);

  useEffect(() => {
    if (!changeOrderQuoteId) {
      setCoQuoteStoredTotals(null);
      return;
    }
    let cancelled = false;
    supabase.rpc('get_quote_proposal_totals', { p_quote_id: changeOrderQuoteId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data || !Array.isArray(data) || data.length === 0) {
        setCoQuoteStoredTotals(null);
        return;
      }
      const row = data[0] as { subtotal?: number | null; tax?: number | null; grand_total?: number | null };
      const sub = row?.subtotal != null ? Number(row.subtotal) : NaN;
      const tax = row?.tax != null ? Number(row.tax) : 0;
      const grand = row?.grand_total != null ? Number(row.grand_total) : NaN;
      if (Number.isFinite(sub) && Number.isFinite(grand)) {
        setCoQuoteStoredTotals({ subtotal: sub, tax: Number.isFinite(tax) ? tax : 0, grandTotal: grand });
      } else {
        setCoQuoteStoredTotals(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [changeOrderQuoteId]);

  useEffect(() => {
    if (customerInfo && changeOrderQuote && !(changeOrderQuote as any).customer_signed_at) {
      setCoSignerName(customerInfo.customer_name ?? '');
      setCoSignerEmail(customerInfo.customer_email ?? '');
    }
  }, [customerInfo?.customer_name, customerInfo?.customer_email, changeOrderQuote?.id, (changeOrderQuote as any)?.customer_signed_at]);

  const portalToken =
    searchParams?.get('token') ??
    customerInfo?.access_token ??
    (typeof localStorage !== 'undefined' ? localStorage.getItem(CUSTOMER_PORTAL_TOKEN_KEY) : null);

  const buildMaterialSheetFullUrl = useCallback(
    (sheetId: string, opts: { changeOrder: boolean }) => {
      if (!portalToken || typeof window === 'undefined') return '#';
      const u = new URL(`${window.location.origin}/customer-portal`);
      u.searchParams.set('token', portalToken);
      u.searchParams.set('sheet', sheetId);
      if (opts.changeOrder) u.searchParams.set('change_order', '1');
      else if (selectedQuoteId) u.searchParams.set('quote', selectedQuoteId);
      return u.toString();
    },
    [portalToken, selectedQuoteId]
  );
  const openAndPrintMaterialSheet = useCallback(
    (sheetId: string, opts: { changeOrder: boolean }) => {
      const url = buildMaterialSheetFullUrl(sheetId, opts);
      if (!url || url === '#') {
        toast.error('Material sheet link is not available yet.');
        return;
      }
      try {
        const u = new URL(url);
        u.searchParams.set('print', '1');
        const win = window.open(u.toString(), '_blank');
        if (!win) {
          toast.error('Allow popups to print material sheets.');
          return;
        }
        toast.info('Opening print view for this material sheet…');
      } catch {
        toast.error('Could not open material sheet print view.');
      }
    },
    [buildMaterialSheetFullUrl]
  );

  const buildPortalUrlWithoutSheet = useCallback(
    (opts?: { openChangeOrdersTab?: boolean }) => {
      if (!portalToken || typeof window === 'undefined') return '/customer-portal';
      const u = new URL(`${window.location.origin}/customer-portal`);
      u.searchParams.set('token', portalToken);
      if (opts?.openChangeOrdersTab) u.searchParams.set('change_order', '1');
      else if (selectedQuoteId) u.searchParams.set('quote', selectedQuoteId);
      return u.toString();
    },
    [portalToken, selectedQuoteId]
  );

  // Prefill signer from portal access when proposal is sent and not yet signed
  useEffect(() => {
    if (customerInfo && !(selectedQuote as any)?.customer_signed_at) {
      setSignerName(customerInfo.customer_name ?? '');
      setSignerEmail(customerInfo.customer_email ?? '');
    }
  }, [customerInfo?.customer_name, customerInfo?.customer_email, selectedQuote?.id]);

  /** Office "Set as Contract" sets signed_version — pre-check agreement so portal matches office contract state */
  useEffect(() => {
    const q = selectedQuote as any;
    if (!q || q.customer_signed_at) return;
    const sv = q.signed_version;
    const n = Number(sv);
    const officeMarkedContract = sv != null && sv !== '' && Number.isFinite(n) && n > 0;
    setAgreeToTerms(officeMarkedContract);
  }, [selectedQuoteId, (selectedQuote as any)?.signed_version, (selectedQuote as any)?.customer_signed_at]);

  const pendingSignForQuote = selectedQuoteId ? portalSignPendingByQuote[selectedQuoteId] : null;
  useEffect(() => {
    if (
      (selectedQuote as any)?.customer_signed_at &&
      selectedQuoteId &&
      pendingSignForQuote &&
      onPortalSignClearForQuote
    ) {
      onPortalSignClearForQuote(selectedQuoteId);
    }
  }, [(selectedQuote as any)?.customer_signed_at, selectedQuoteId, pendingSignForQuote, onPortalSignClearForQuote]);

  async function handleSignProposal(e?: React.MouseEvent) {
    e?.preventDefault();
    if (!portalToken || !selectedQuoteId) {
      toast.error('Session or proposal missing. Please refresh the page and try again.');
      return;
    }
    if (!signerName.trim() || !signerEmail.trim()) {
      toast.error('Please enter your full name and email.');
      return;
    }
    if (!agreeToTerms) {
      toast.error('Please confirm you agree to the terms and authorize the work.');
      return;
    }
    setSigning(true);
    try {
      const { data, error } = await supabase.rpc('customer_sign_proposal', {
        p_access_token: portalToken,
        p_quote_id: selectedQuoteId,
        p_signer_name: signerName.trim(),
        p_signer_email: signerEmail.trim(),
      });
      const result = data as { ok?: boolean; error?: string } | null;
      if (error) {
        console.error('Sign proposal RPC error:', error);
        throw error;
      }
      if (result?.ok) {
        onPortalSignRecorded?.(selectedQuoteId, signerName.trim());
        toast.success('Contract saved. This proposal is now your signed contract. The project team will see it in the job.');
        await onRefreshJobData?.();
      } else {
        const errMsg = result?.error ?? 'Could not sign proposal';
        console.error('Sign proposal RPC returned not ok:', result);
        toast.error(errMsg);
      }
    } catch (e: any) {
      console.error('Sign proposal error:', e);
      const msg = e?.message ?? 'Failed to sign proposal';
      const isRpcMissing = /function.*does not exist|42883|PGRST202/i.test(String(msg));
      toast.error(isRpcMissing
        ? 'Signing is not available yet. Your administrator needs to run the database migration for customer signing.'
        : msg,
        { duration: isRpcMissing ? 8000 : 5000 }
      );
    } finally {
      setSigning(false);
    }
  }

  async function handleSignChangeOrderSheet(sheetId: string, e?: React.MouseEvent) {
    e?.preventDefault();
    if (!portalToken) {
      toast.error('Session missing. Please refresh the page.');
      return;
    }
    if (!coSignerName.trim() || !coSignerEmail.trim()) {
      toast.error('Please enter your full name and email.');
      return;
    }
    if (!coAgreeBySheet[sheetId]) {
      toast.error('Please check the agreement box for this change order.');
      return;
    }
    setCoSigningSheetId(sheetId);
    try {
      const { data, error } = await supabase.rpc('customer_sign_change_order_sheet', {
        p_access_token: portalToken,
        p_sheet_id: sheetId,
        p_signer_name: coSignerName.trim(),
        p_signer_email: coSignerEmail.trim(),
      });
      const result = data as { ok?: boolean; error?: string } | null;
      if (error) throw error;
        if (result?.ok) {
        toast.success('Change order signed. Your contractor will proceed with this item.');
        await onRefreshJobData?.();
      } else {
        const err = result?.error ?? 'Could not sign';
        const missing = /function.*does not exist|42883|PGRST202/i.test(String(err));
        toast.error(
          missing
            ? 'Signing change orders requires a database update. Ask your administrator to run the latest Supabase migration (change_order_seq_and_sheet_signatures).'
            : err,
          { duration: missing ? 9000 : 5000 }
        );
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to sign');
    } finally {
      setCoSigningSheetId(null);
    }
  }

  function openChangeOrderDocument(sheet: any, coLabel: string) {
    if (!job) return;
    const raw = (changeOrderQuote as any)?.change_order_signatures;
    const sigs =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
    const sig = sigs[sheet.id] as { signed_name?: string; signed_at?: string } | undefined;
    const lineItems: Array<{ description: string; amount?: number }> = [];
    (sheet.sheetLinkedItems || [])
      .filter((item: any) => !item.hide_from_customer)
      .forEach((item: any) => {
        const amt = portalSheetLinkedItemSellingAmount(item, sheet);
        lineItems.push({
          description: item.description || 'Line item',
          amount: amt > 0 ? amt : undefined,
        });
      });
    const sheetMat = sheet._computedMaterials ?? 0;
    const sheetLab = sheet._computedLabor ?? 0;
    const subtotal = sheetMat + sheetLab;
    const taxExempt = !!(changeOrderQuote as any)?.tax_exempt;
    const tax = taxExempt ? 0 : sheetMat * 0.07;
    const grand = subtotal + tax;
    const showPrices = showFinancialCo && showLineItemPricesCo;
    const html = generateChangeOrderDocumentHTML({
      changeOrderNumber: coLabel,
      date: new Date().toLocaleDateString('en-US', { dateStyle: 'long' }),
      job: {
        client_name: job.client_name,
        address: job.address || '',
        name: job.name,
      },
      scopeTitle: sheet.sheet_name || 'Change order',
      scopeDescription: sheet.description || '',
      lineItems,
      materialsTotal: sheetMat,
      laborTotal: sheetLab,
      subtotal,
      tax,
      grandTotal: grand,
      showPrices,
      taxExempt,
      signedName: sig?.signed_name,
      signedAt: sig?.signed_at ? new Date(sig.signed_at).toLocaleDateString('en-US', { dateStyle: 'medium' }) : undefined,
    });
    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, '_blank');
    if (!win) {
      URL.revokeObjectURL(blobUrl);
      toast.error('Allow popups to view the document.');
      return;
    }
    win.focus();
    toast.info('Use Print or Save as PDF in your browser.');
    setTimeout(() => {
      try {
        if (!win.closed) win.print();
      } catch {
        /* ignore */
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
    }, 400);
  }

  async function sendEmailToJob() {
    setEmailSendError(null);
    if (!emailBody.trim()) {
      toast.error('Please enter a message');
      setEmailSendError('Please enter a message.');
      return;
    }
    if (!job?.id) {
      toast.error('Project not found. Please refresh the page.');
      setEmailSendError('Project not found. Please refresh the page.');
      return;
    }

    setSendingEmail(true);
    try {
      const body = emailBody.trim();
      const insertDirectPortalMessage = async (): Promise<{ ok: boolean; errorMessage?: string }> => {
        const { error: insertErr } = await supabase.from('job_messages').insert({
          job_id: job.id,
          sender_role: 'customer',
          sender_name: (customerInfo?.customer_name || 'Customer').trim() || 'Customer',
          sender_contact: (customerInfo?.customer_email || '').trim() || null,
          message_text: body,
          is_read: false,
        });
        if (insertErr) {
          return { ok: false, errorMessage: insertErr.message || 'Failed to send message' };
        }
        toast.success('Message sent to your project team.');
        setEmailBody('');
        setEmailSentInDialog(true);
        await onRefreshJobData?.();
        return { ok: true };
      };

      const effectivePortalToken =
        (typeof portalToken === 'string' ? portalToken.trim() : '') ||
        (typeof customerInfo?.access_token === 'string' ? customerInfo.access_token.trim() : '') ||
        (typeof localStorage !== 'undefined' ? (localStorage.getItem(CUSTOMER_PORTAL_TOKEN_KEY) || '').trim() : '');

      if (effectivePortalToken) {
        const { error: rpcError } = await supabase.rpc('create_job_message_from_customer_portal', {
          p_access_token: effectivePortalToken,
          p_job_id: job.id,
          p_message_text: body,
        });

        if (rpcError) {
          const msg = rpcError.message || 'Failed to send message';
          // Always fall back to direct communication write when RPC errors.
          const direct = await insertDirectPortalMessage();
          if (direct.ok) return;
          const fallbackMsg = direct.errorMessage || msg;
          toast.error(`Failed to send message: ${fallbackMsg}`, { duration: 8000 });
          setEmailSendError(`Failed to send message: ${fallbackMsg}`);
          return;
        }
      } else {
        // No token available in URL/session: try direct insert path instead of hard-failing.
        const direct = await insertDirectPortalMessage();
        if (direct.ok) return;
        const fallbackMsg = direct.errorMessage || 'Session token missing and direct message write failed';
        toast.error(`Failed to send message: ${fallbackMsg}`, { duration: 8000 });
        setEmailSendError(`Failed to send message: ${fallbackMsg}`);
        return;
      }

      // RPC succeeded (saved to in-app job communications feed)
      toast.success('Message sent to your project team.');
      setEmailBody('');
      setEmailSentInDialog(true);
      await onRefreshJobData?.();
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast.error(error?.message ?? 'Failed to send message');
      setEmailSendError(error?.message ?? 'Failed to send message');
    } finally {
      setSendingEmail(false);
    }
  }


  useEffect(() => {
    if (!job?.id) {
      setProposalData(null);
      return;
    }
    let cancelled = false;
    setProposalDataLoading(true);
    const quoteIdForMaterials =
      selectedQuoteId ??
      proposalQuotes[0]?.id ??
      ((quote as any)?.is_change_order_proposal ? null : (quote as any)?.id ?? null);
    const taxExempt = quoteIdForMaterials
      ? !!(proposalQuotes.find((q: any) => q.id === quoteIdForMaterials)?.tax_exempt)
      : false;
    loadProposalDataForQuote(job.id, quoteIdForMaterials, taxExempt).then((data) => {
      if (cancelled) return;
      proposalDataCacheRef.current[quoteIdForMaterials ?? ''] = data;
      setProposalData(data);
      setProposalDataLoading(false);
    });
    return () => { cancelled = true; };
  }, [job?.id, selectedQuoteId, selectedQuote?.tax_exempt, proposalQuotes, quote]);

  // Fetch proposal totals from RPC so Overview matches JobFinancials (bypasses PostgREST/RLS column visibility)
  useEffect(() => {
    if (!selectedQuoteId) {
      setQuoteStoredTotals(null);
      return;
    }
    let cancelled = false;
    supabase
      .rpc('get_quote_proposal_totals', { p_quote_id: selectedQuoteId })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data || !Array.isArray(data) || data.length === 0) {
          setQuoteStoredTotals(null);
          return;
        }
        const row = data[0] as { subtotal?: number | null; tax?: number | null; grand_total?: number | null };
        const sub = row?.subtotal != null ? Number(row.subtotal) : NaN;
        const tax = row?.tax != null ? Number(row.tax) : 0;
        const grand = row?.grand_total != null ? Number(row.grand_total) : NaN;
        if (Number.isFinite(sub) && Number.isFinite(grand)) {
          setQuoteStoredTotals({ subtotal: sub, tax: Number.isFinite(tax) ? tax : 0, grandTotal: grand });
        } else {
          setQuoteStoredTotals(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedQuoteId]);

  /** CO quote workbook sheets + any CO-typed sheets on the main workbook (must be above standalone sheet resolver). */
  const proposalCoSheets = useMemo(() => {
    const fromBundle = ((proposalData?.changeOrderSheets ?? []) as any[]).filter(
      (s: any) => s.sheet_type === 'change_order'
    );
    const mainCo = ((proposalData?.materialSheets ?? []) as any[]).filter(
      (s: any) => !isFieldRequestSheetName(s.sheet_name) && s.sheet_type === 'change_order'
    );
    const seen = new Set<string>();
    const out: any[] = [];
    for (const s of [...fromBundle, ...mainCo]) {
      if (!s?.id || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
    out.sort((a: any, b: any) => {
      const sa = Number(a.change_order_seq) || 0;
      const sb = Number(b.change_order_seq) || 0;
      if (sa !== sb) return sa - sb;
      return (a.order_index ?? 0) - (b.order_index ?? 0);
    });
    return out;
  }, [proposalData]);

  const standaloneMaterialSheet = useMemo(() => {
    if (!sheetIdFromUrl) return null;
    if (materialSheetPageIsCo) {
      const fromDedicated = (changeOrderProposalData?.materialSheets || []).filter(
        (s: any) => !isFieldRequestSheetName(s.sheet_name) && s.sheet_type === 'change_order'
      );
      const hitDedicated = fromDedicated.find((s: any) => s.id === sheetIdFromUrl);
      if (hitDedicated) return hitDedicated;
      return proposalCoSheets.find((s: any) => s.id === sheetIdFromUrl) ?? null;
    }
    const sheets = (proposalData?.materialSheets || []).filter(
      (s: any) => !isFieldRequestSheetName(s.sheet_name)
    );
    return sheets.find((s: any) => s.id === sheetIdFromUrl) ?? null;
  }, [sheetIdFromUrl, materialSheetPageIsCo, changeOrderProposalData, proposalData, proposalCoSheets]);

  const mainMaterialSheetsForTab = useMemo(
    () =>
      (proposalData?.materialSheets || []).filter(
        (s: any) => !isFieldRequestSheetName(s.sheet_name) && s.sheet_type !== 'change_order'
      ),
    [proposalData]
  );
  const [activeMaterialSheetId, setActiveMaterialSheetId] = useState<string | null>(null);
  const didInitTabFromUrlRef = useRef(false);
  useEffect(() => {
    if (!mainMaterialSheetsForTab.length) {
      setActiveMaterialSheetId(null);
      return;
    }
    if (!activeMaterialSheetId || !mainMaterialSheetsForTab.some((s: any) => s.id === activeMaterialSheetId)) {
      setActiveMaterialSheetId(mainMaterialSheetsForTab[0].id);
    }
  }, [mainMaterialSheetsForTab, activeMaterialSheetId]);

  const changeOrderMaterialSheetsForTab = useMemo(() => {
    const raw = changeOrderProposalData?.materialSheets;
    if (!raw?.length) return [];
    let sheets = (raw as any[]).filter(
      (s: any) => !isFieldRequestSheetName(s.sheet_name) && s.sheet_type === 'change_order'
    );
    sheets = [...sheets].sort((a: any, b: any) => {
      const sa = Number(a.change_order_seq) || 0;
      const sb = Number(b.change_order_seq) || 0;
      if (sa !== sb) return sa - sb;
      return (a.order_index ?? 0) - (b.order_index ?? 0);
    });
    return sheets;
  }, [changeOrderProposalData]);

  const portalCoMaterialSheetsList =
    changeOrderMaterialSheetsForTab.length > 0 ? changeOrderMaterialSheetsForTab : proposalCoSheets;

  const hasChangeOrderPortal = proposalCoSheets.length > 0 || !!changeOrderQuote;

  const effectiveCoPortalBundle = useMemo(() => {
    const coSent = changeOrderQuote ? !!(changeOrderQuote as any).sent_at : true;
    if (changeOrderQuote && !coSent) return null;
    if (changeOrderQuote && coSent) {
      if (changeOrderProposalData) return changeOrderProposalData;
      if (proposalCoSheets.length > 0 && proposalData) {
        const taxEx = !!(changeOrderQuote as any)?.tax_exempt;
        const sub = proposalCoSheets.reduce((acc, sh) => acc + (Number(sh._computedTotal) || 0), 0);
        const tax = taxEx
          ? 0
          : proposalCoSheets.reduce((acc, sh) => acc + (Number(sh._computedMaterials) || 0) * 0.07, 0);
        return {
          ...proposalData,
          materialSheets: proposalCoSheets,
          totals: { subtotal: sub, tax, grandTotal: sub + tax },
        };
      }
      return null;
    }
    if (!proposalCoSheets.length || !proposalData) return null;
    const taxEx = !!(selectedQuote as any)?.tax_exempt;
    const sub = proposalCoSheets.reduce((acc, sh) => acc + (Number(sh._computedTotal) || 0), 0);
    const tax = taxEx
      ? 0
      : proposalCoSheets.reduce((acc, sh) => acc + (Number(sh._computedMaterials) || 0) * 0.07, 0);
    return {
      ...proposalData,
      materialSheets: proposalCoSheets,
      totals: { subtotal: sub, tax, grandTotal: sub + tax },
    };
  }, [changeOrderQuote, changeOrderProposalData, proposalCoSheets, proposalData, selectedQuote]);

  const showMaterialsTab = showMaterialItemsNoPrices;
  const showCoMaterialsInMaterialsTab =
    (!!changeOrderQuote && showMaterialItemsNoPricesCo && !!(changeOrderQuote as any)?.sent_at) ||
    (!changeOrderQuote && proposalCoSheets.length > 0 && showMaterialItemsNoPrices);
  const isOptionalFlag = (value: any) => value === true || value === 'true' || value === 1;
  const optionalProposalSheets = ((proposalData?.materialSheets || []) as any[]).filter(
    (s: any) =>
      !isFieldRequestSheetName(s.sheet_name) && s.sheet_type !== 'change_order' && isOptionalFlag(s.is_option)
  );
  const optionalStandaloneSubs = ((proposalData?.subcontractorEstimates || []) as any[]).filter(
    (est: any) => !est.sheet_id && !est.row_id && isOptionalFlag(est.is_option)
  );
  const hasOptionsTab = showProposal && (optionalProposalSheets.length > 0 || optionalStandaloneSubs.length > 0);

  const proposalNumber = selectedQuote?.proposal_number || selectedQuote?.quote_number || 'N/A';
  const portalUrl = typeof window !== 'undefined' ? window.location.href : '';

  async function copyPortalUrl() {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      toast.success('Portal link copied to clipboard');
    } catch {
      toast.error('Could not copy link');
    }
  }

  /** Open print dialog with proposal HTML that matches the office Export Customer PDF (Proposal-26012-5 style). */
  function handlePrintProposal() {
    if (!proposalData || !job) return;
    const html = buildProposalHtmlForPortal({
      job,
      quote: selectedQuote,
      proposalData,
      showFinancial,
      showLineItemPrices,
      showSectionPrices,
      // "Print proposal" should always print the proposal document view, not material-sheet mode.
      showMaterialItemsNoPrices: false,
      quoteStoredTotals: quoteStoredTotals ?? undefined,
    });

    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, '_blank');
    if (!win) {
      URL.revokeObjectURL(blobUrl);
      toast.error('Allow popups to print.');
      return;
    }
    win.focus();
    toast.info('Choose your printer or "Save as PDF" in the print dialog.');
    setTimeout(() => {
      try {
        if (!win.closed) win.print();
      } catch {
        toast.error('Could not open print dialog');
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
    }, 500);
  }

  const viewOptions = [
    { value: 'overview', label: 'Overview', icon: LayoutDashboard },
    ...(hasOptionsTab ? [{ value: 'options' as const, label: 'Options', icon: ClipboardList }] : []),
    ...(showProposal && hasChangeOrderPortal
      ? [{ value: 'change-orders' as const, label: 'Change orders', icon: ClipboardList }]
      : []),
    ...(showMaterialsTab
      ? [{ value: 'materials' as const, label: 'Materials', icon: Package }]
      : []),
    ...(showPayments ? [{ value: 'payments' as const, label: 'Payments', icon: DollarSign }] : []),
    ...(showSchedule ? [{ value: 'schedule' as const, label: 'Schedule', icon: Calendar }] : []),
    ...(showDocuments ? [{ value: 'documents' as const, label: 'Documents', icon: FileSpreadsheet }] : []),
    ...(showPhotos ? [{ value: 'photos' as const, label: 'Photos', icon: Image }] : []),
    { value: 'emails' as const, label: 'Messages', icon: Mail },
  ];

  // When office turns off a tab, switch away if customer was on it
  useEffect(() => {
    const allowed = new Set(viewOptions.map((o) => o.value));
    if (!allowed.has(activeTab)) setActiveTab('overview');
  }, [
    showPayments,
    showSchedule,
    showDocuments,
    showPhotos,
    showProposal,
    showMaterialItemsNoPrices,
    changeOrderQuote?.id,
    hasChangeOrderPortal,
    activeTab,
  ]);

  // Deep-link + refresh persistence for portal tabs (e.g. ?tab=materials).
  useEffect(() => {
    if (didInitTabFromUrlRef.current) return;
    didInitTabFromUrlRef.current = true;
    if (!tabFromUrl) return;
    const allowed = new Set(viewOptions.map((o) => o.value));
    if (allowed.has(tabFromUrl) && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl, viewOptions, activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined' || sheetIdFromUrl) return;
    const url = new URL(window.location.href);
    if (activeTab === 'overview') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', activeTab);
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [activeTab, sheetIdFromUrl]);

  useEffect(() => {
    if (activeTab === 'change-orders' && !hasChangeOrderPortal) setActiveTab('overview');
  }, [activeTab, hasChangeOrderPortal]);
  const shouldAutoPrintSheet = searchParams?.get('print') === '1';
  useEffect(() => {
    if (!sheetIdFromUrl || !shouldAutoPrintSheet) return;
    const timer = setTimeout(() => {
      try {
        window.print();
      } catch {
        // ignore
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [sheetIdFromUrl, shouldAutoPrintSheet, standaloneMaterialSheet?.id]);

  /** Dedicated page: material name / qty / usage only (same visibility as “Material list (no prices)”) */
  if (sheetIdFromUrl) {
    const standaloneLoading = materialSheetPageIsCo
      ? changeOrderQuoteId
        ? changeOrderDataLoading
        : proposalDataLoading
      : proposalDataLoading;
    const standaloneAllowed = materialSheetPageIsCo
      ? changeOrderQuoteId
        ? showMaterialItemsNoPricesCo
        : showMaterialItemsNoPrices
      : showMaterialItemsNoPrices;
    const backHref = materialSheetPageIsCo
      ? buildPortalUrlWithoutSheet({ openChangeOrdersTab: true })
      : buildPortalUrlWithoutSheet();

    if (standaloneLoading) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-8">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p>Loading material sheet…</p>
          </div>
        </div>
      );
    }

    if (!standaloneAllowed) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
          <div className="max-w-lg mx-auto px-4 py-16 text-center space-y-4">
            <p className="text-lg font-medium text-slate-800">Material list not available</p>
            <p className="text-sm text-muted-foreground">This view is turned off for your portal link.</p>
            <Button asChild variant="outline">
              <a href={backHref}>Back to project</a>
            </Button>
          </div>
        </div>
      );
    }

    if (!standaloneMaterialSheet || isFieldRequestSheetName(standaloneMaterialSheet.sheet_name)) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
          <div className="max-w-lg mx-auto px-4 py-16 text-center space-y-4">
            <p className="text-lg font-medium text-slate-800">Sheet not found</p>
            <p className="text-sm text-muted-foreground">The link may be outdated or the proposal was updated.</p>
            <Button asChild variant="outline">
              <a href={backHref}>Back to project</a>
            </Button>
          </div>
        </div>
      );
    }

    const sh = standaloneMaterialSheet;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 print:bg-white">
        <div className="bg-gradient-to-r from-zinc-900 via-emerald-950 to-zinc-900 text-white shadow-xl border-b-2 border-amber-500/40 print:hidden">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Button asChild variant="ghost" className="text-amber-200 hover:text-white hover:bg-white/10 -ml-2 h-9 px-2">
                <a href={backHref}>← Back to project</a>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-amber-400/50 text-amber-200 bg-transparent hover:bg-white/10 hover:text-white"
                onClick={() => window.print()}
              >
                <Printer className="w-4 h-4 mr-2" />
                Print this page
              </Button>
            </div>
            <div>
              <p className="text-emerald-100/90 text-sm">{job.client_name}</p>
              <h1 className="text-2xl sm:text-3xl font-bold text-amber-400 mt-1">{job.name}</h1>
              <p className="text-emerald-200/90 text-sm mt-2 flex items-center gap-1">
                <FileSpreadsheet className="w-4 h-4 shrink-0 text-amber-400/90" />
                {materialSheetPageIsCo ? 'Change order — ' : ''}
                {sh.sheet_name}
              </p>
            </div>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4 print:py-0">
          <div className="hidden print:block">
            <h1 className="text-xl font-semibold text-black">{sh.sheet_name}</h1>
            {sh.description?.trim() && (
              <p className="text-sm text-black/80 mt-1">
                <PortalMultilineText text={sh.description} />
              </p>
            )}
          </div>
          {sh.description?.trim() && (
            <p className="text-sm text-muted-foreground print:hidden">
              <PortalMultilineText text={sh.description} />
            </p>
          )}
          <PortalMaterialItemsTable items={sh.items} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header: black, gold, dark green – matches portal settings preview */}
      <div className="bg-gradient-to-r from-zinc-900 via-emerald-950 to-zinc-900 text-white shadow-xl border-b-2 border-amber-500/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-bold text-amber-400">{job.name}</h1>
                {proposalQuotes.length > 1 ? (
                  <Select value={selectedQuoteId ?? ''} onValueChange={(v) => setSelectedQuoteId(v || null)}>
                    <SelectTrigger className="w-[180px] bg-amber-500/20 text-amber-300 border-amber-500/50">
                      <SelectValue placeholder="Select proposal" />
                    </SelectTrigger>
                    <SelectContent>
                      {proposalQuotes.map((q: any) => (
                        <SelectItem key={q.id} value={q.id}>
                          #{q.proposal_number || q.quote_number || q.id.slice(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline" className="bg-amber-500/20 text-amber-300 border-amber-500/50">
                    #{proposalNumber}
                  </Badge>
                )}
              </div>
              <p className="text-emerald-100/90 mt-1">{job.client_name}</p>
              {job.address && (
                <p className="text-emerald-200/80 text-sm mt-1 flex items-center gap-1">
                  <MapPin className="w-4 h-4 shrink-0 text-amber-400/90" />
                  {job.address}
                </p>
              )}
              {(hasPortalUpdates || unreadTeamMessages > 0) && (
                <div className="mt-3">
                  <Badge className="bg-amber-500/15 text-amber-100 border-amber-300/40">
                    {unreadTeamMessages > 0
                      ? `${unreadTeamMessages} new message${unreadTeamMessages === 1 ? '' : 's'}`
                      : 'New project updates'}
                  </Badge>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <PWAInstallButton alwaysVisible />
              <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/40 px-4 py-2">
                Customer Portal
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Content – all visibility-controlled sections from portal settings */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            {/* Horizontal tab bar – matches the office preview exactly */}
            <TabsList
              className="grid w-full mb-6"
              style={{ gridTemplateColumns: `repeat(${viewOptions.length}, 1fr)` }}
            >
              {viewOptions.map((opt) => {
                const Icon = opt.icon;
                const unread = opt.value === 'emails' ? unreadTeamMessages : 0;
                return (
                  <TabsTrigger key={opt.value} value={opt.value} className="flex items-center gap-1 text-xs sm:text-sm">
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{opt.label}</span>
                    {unread > 0 && (
                      <Badge variant="destructive" className="ml-1 shrink-0 text-[10px] px-1 py-0">
                        {unread}
                      </Badge>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

          {/* Overview Tab – order matches portal settings: custom message, drawings, proposal */}
          <TabsContent value="overview" className="space-y-6">
            {/* Custom welcome message (from Portal settings) */}
            {stripMaterialVisibilityMarker(customerInfo?.custom_message).cleanText.trim() && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="pt-6">
                  <p className="text-slate-800">
                    <PortalMultilineText text={stripMaterialVisibilityMarker(customerInfo.custom_message).cleanText} />
                  </p>
                </CardContent>
              </Card>
            )}
            {!showFinancial && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="pt-6">
                  <p className="text-slate-700">Pricing and final amount will be shared when ready. You can review the proposal scope and drawings below and send messages with any questions.</p>
                </CardContent>
              </Card>
            )}
            {/* Drawings & 3D Views (viewer links) — gated by Documents visibility */}
            {showDocuments && viewerLinks.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ExternalLink className="w-5 h-5" />
                    Drawings & 3D Views
                  </CardTitle>
                  <p className="text-sm text-muted-foreground font-normal">Open the links below to view plans and 3D models.</p>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {viewerLinks.map((link: any) => (
                      <Button
                        key={link.id}
                        variant="outline"
                        className="flex items-center gap-2"
                        onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
                      >
                        <ExternalLink className="w-4 h-4" />
                        {link.label}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Project Proposal: visible after "Mark as Sent" and/or office contract (matches office workflow) */}
            {showProposal && (
              <>
                {!proposalVisibleInPortal ? (
                  <Card className="border-slate-200 bg-slate-50/50">
                    <CardContent className="py-8 text-center text-muted-foreground">
                      <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 opacity-50" />
                      <p className="font-medium text-slate-600">Your proposal is not ready yet</p>
                      <p className="text-sm mt-1">
                        It will appear here once your project manager marks it as sent or records it as your contract in the office.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                <>
                <style>{`
                  @media print {
                    body * { visibility: hidden; }
                    .portal-proposal-print-area, .portal-proposal-print-area * { visibility: visible; }
                    .portal-proposal-print-area { position: absolute; left: 0; top: 0; width: 100%; max-width: 100%; box-shadow: none; }
                  }
                `}</style>
                <Card id="portal-proposal-print" className="portal-proposal-print-area border-emerald-200/60">
                  <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-emerald-900">
                        <FileSpreadsheet className="w-5 h-5" />
                        Project Proposal
                      </CardTitle>
                      {!showFinancial && (
                        <p className="text-sm text-muted-foreground font-normal mt-1">Pricing will be shared when ready. Below is the scope and description.</p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 print:hidden"
                      onClick={handlePrintProposal}
                    >
                      <Printer className="w-4 h-4 mr-2" />
                      Print proposal
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {proposalDataLoading && !proposalData ? (
                      <div className="flex items-center justify-center py-8 text-muted-foreground">
                        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mr-2" />
                        Loading proposal…
                      </div>
                    ) : proposalData ? (
                      <>
                        {/* Summary line (Materials | Labor | Subtotal | Tax | GRAND TOTAL) is shown only in the office preview, not to the customer in the portal link. */}
                        {/* Proposal sections only (exclude change order sheets); change orders shown in separate card below.
                            Include every material sheet (including labor-only sheets with no material items) and both
                            standalone and sheet-linked custom rows so section order matches the office proposal. */}
                        {(() => {
                          const materialListNoPrices = showMaterialItemsNoPrices;
                          const proposalSheets = (proposalData.materialSheets || []).filter(
                            (s: any) =>
                              !isFieldRequestSheetName(s.sheet_name) && s.sheet_type !== 'change_order'
                          );
                          const requiredSheetIds = new Set(
                            proposalSheets
                              .filter((s: any) => !isOptionalFlag(s.is_option))
                              .map((s: any) => s.id)
                          );
                          const requiredProposalSheets = proposalSheets.filter((s: any) => requiredSheetIds.has(s.id));
                          const customRows = proposalData.customRows || [];
                          const standaloneCustomRows = customRows.filter((row: any) => !row.sheet_id);
                          // Build sections: each material sheet (sheet-linked line items are shown inside the sheet card), then linked custom rows, then standalone custom rows and subcontractors.
                          const sheetSections: Array<{ type: 'material' | 'custom' | 'subcontractor'; id: string; orderIndex: number; data: any }> = [];
                          requiredProposalSheets.forEach((sheet: any) => {
                            const sheetOrder = sheet.order_index ?? 0;
                            sheetSections.push({
                              type: 'material' as const,
                              id: sheet.id,
                              orderIndex: sheetOrder * 1000,
                              data: sheet,
                            });
                            const linkedToSheet = customRows
                              .filter((r: any) => r.sheet_id === sheet.id)
                              .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
                            linkedToSheet.forEach((row: any, idx: number) => {
                              sheetSections.push({
                                type: 'custom' as const,
                                id: row.id,
                                orderIndex: sheetOrder * 1000 + 100 + (row.order_index ?? idx),
                                data: row,
                              });
                            });
                          });
                          const allSections: Array<{ type: 'material' | 'custom' | 'subcontractor'; id: string; orderIndex: number; data: any }> = [
                            ...sheetSections,
                            ...standaloneCustomRows.map((row: any) => ({
                              type: 'custom' as const,
                              id: row.id,
                              orderIndex: (row.order_index ?? 0) * 1000,
                              data: row,
                            })),
                            ...(proposalData.subcontractorEstimates || [])
                              .filter((est: any) => !est.sheet_id && !est.row_id && !isOptionalFlag(est.is_option))
                              .map((est: any) => ({
                                type: 'subcontractor' as const,
                                id: est.id,
                                orderIndex: (est.order_index ?? 0) * 1000,
                                data: est,
                              })),
                          ].sort((a, b) => a.orderIndex - b.orderIndex);

                          return allSections.map((section) => {
                            if (section.type === 'material') {
                              const sheet = section.data;
                              const linkedSubs = (proposalData.subcontractorEstimates || []).filter((e: any) => e.sheet_id === sheet.id);
                              const sheetMaterials = sheet._computedMaterials ?? 0;
                              const sheetLabor = sheet._computedLabor ?? 0;
                              const sheetTotal = readSectionTotal(sheet, sheetMaterials + sheetLabor);
                              const isOptional = sheet.is_option === true || sheet.is_option === 'true' || sheet.is_option === 1;
                              const showPrice = showPriceForSection(sheet.id);
                              const showSheetBreakdown =
                                showPrice && !materialListNoPrices && (sheetMaterials > 0 || sheetLabor > 0);
                              const showSheetTotal = showPrice;
                              return (
                                <div key={sheet.id} className="border rounded-lg px-4 py-3 flex items-start justify-between gap-4">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h3 className="font-semibold text-base">{sheet.sheet_name}</h3>
                                      {isOptional && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                                          Optional
                                        </span>
                                      )}
                                    </div>
                                    {sheet.description && (
                                      <p className="text-sm text-muted-foreground mt-1">
                                        <PortalMultilineText text={sheet.description} />
                                      </p>
                                    )}
                                    {linkedSubs.map((est: any) => (
                                      <div key={est.id} className="mt-2">
                                        {est.scope_of_work && (
                                          <p className="text-sm text-muted-foreground">
                                            <PortalMultilineText text={est.scope_of_work} />
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                  {(showSheetBreakdown || showSheetTotal) && (
                                    <div className="w-[100px] flex-shrink-0 text-right">
                                      {showSheetBreakdown && sheetMaterials > 0 && (
                                        <>
                                          <p className="text-sm text-slate-500">Materials</p>
                                          <p className="text-base font-bold text-blue-700">${sheetMaterials.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                        </>
                                      )}
                                      {showSheetBreakdown && sheetLabor > 0 && (
                                        <>
                                          <p className="text-sm text-slate-500 mt-2">Labor</p>
                                          <p className="text-base font-bold text-amber-700">${sheetLabor.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                        </>
                                      )}
                                      {showSheetTotal && (
                                        <>
                                          <p className={`text-[11px] text-slate-500 ${showSheetBreakdown ? 'mt-2' : ''}`}>Section total</p>
                                          <p className="text-sm font-bold text-emerald-700">
                                            ${sheetTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </p>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            if (section.type === 'custom') {
                              const row = section.data;
                              const title = row.description || row.category || 'Custom';
                              const descriptionParts: string[] = [];
                              if (row.notes?.trim()) descriptionParts.push(row.notes.trim());
                              if (row.description?.trim() && row.description.trim() !== title.trim()) descriptionParts.push(row.description.trim());
                              const descriptionText = descriptionParts.join('\n\n');
                              return (
                                <div key={row.id} className="border rounded-lg px-4 py-3 flex items-start justify-between gap-4">
                                  <div className="min-w-0 flex-1">
                                    <h3 className="font-semibold text-base">{title}</h3>
                                    {descriptionText && (
                                      <p className="text-sm text-muted-foreground mt-1">
                                        <PortalMultilineText text={descriptionText} />
                                      </p>
                                    )}
                                  </div>
                                  {showPriceForSection(row.id) && (
                                    <p className="text-base font-bold text-emerald-700 shrink-0">
                                      ${readSectionTotal(row).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                  )}
                                </div>
                              );
                            }
                            // subcontractor
                            const est = section.data;
                            return (
                              <div key={est.id} className="border rounded-lg px-4 py-3 flex items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                  <h3 className="font-semibold text-base">{est.company_name}</h3>
                                  {est.scope_of_work && (
                                    <p className="text-sm text-muted-foreground mt-1">{est.scope_of_work}</p>
                                  )}
                                </div>
                                {showPriceForSection(est.id) && (
                                  <p className="text-base font-bold text-emerald-700 shrink-0">
                                    ${readSectionTotal(est).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                )}
                              </div>
                            );
                          });
                        })()}

                        {hasChangeOrderPortal && proposalCoSheets.length > 0 && (
                          <div className="border border-orange-200 bg-orange-50/40 rounded-lg p-4 space-y-3">
                            <div className="flex items-start gap-2">
                              <ClipboardList className="w-5 h-5 text-orange-800 shrink-0 mt-0.5" />
                              <div className="min-w-0 space-y-2">
                                <h4 className="font-semibold text-orange-950">Change orders</h4>
                                <p className="text-sm text-slate-700">
                                  {changeOrderQuote && !(changeOrderQuote as any)?.sent_at
                                    ? 'Your contractor is preparing a change order. It will appear in the Change orders tab once it has been sent to you.'
                                    : 'This project includes additional scope priced as change orders. Open the Change orders tab to review line items, totals, and sign.'}
                                </p>
                                <ul className="text-sm text-slate-600 list-disc pl-5 space-y-0.5">
                                  {proposalCoSheets.slice(0, 6).map((s: any) => (
                                    <li key={s.id}>{s.sheet_name || 'Change order'}</li>
                                  ))}
                                </ul>
                                {proposalCoSheets.length > 6 && (
                                  <p className="text-xs text-muted-foreground">
                                    +{proposalCoSheets.length - 6} more in Change orders
                                  </p>
                                )}
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="border-orange-300 text-orange-900"
                                  onClick={() => setActiveTab('change-orders')}
                                >
                                  Open Change orders
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Totals — only shown when showFinancial is enabled. Prefer proposalData.totals; fall back to RPC/quote when proposalData not yet loaded. */}
                        {showFinancial && (() => {
                          const displayTotals =
                            (proposalData?.totals != null ? proposalData.totals : null) ??
                            quoteStoredTotals ??
                            ((selectedQuote && Number.isFinite(Number(selectedQuote.proposal_grand_total)) && Number.isFinite(Number(selectedQuote.proposal_subtotal))
                              ? {
                                  subtotal: Number(selectedQuote.proposal_subtotal),
                                  tax: Number(selectedQuote.proposal_tax) || 0,
                                  grandTotal: Number(selectedQuote.proposal_grand_total),
                                }
                              : null));
                          if (!displayTotals) return null;
                          return (
                            <div className="border-t-2 pt-4 space-y-2">
                              <div className="flex justify-between text-lg">
                                <span className="font-medium">Subtotal:</span>
                                <span>${displayTotals.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </div>
                              {selectedQuote?.tax_exempt ? (
                                <div className="flex items-center gap-2 text-lg text-amber-700">
                                  <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                                  <span className="font-medium">Tax exempt</span>
                                </div>
                              ) : (
                                <div className="flex justify-between text-lg">
                                  <span className="font-medium">Tax (7%):</span>
                                  <span>${displayTotals.tax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                              )}
                              <div className="flex justify-between items-center text-2xl font-bold pt-2 border-t">
                                <span>Grand Total:</span>
                                <span className="text-emerald-700">
                                  ${displayTotals.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Contract: seal replaces sign button once signed (customer e-sign, office “Set as Contract”, or pending confirm) */}
                        {(selectedQuote as any)?.customer_signed_at ? (
                          <div className="border-t-2 pt-4 mt-4 space-y-3">
                            <h4 className="font-semibold text-slate-800 flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                              This proposal is your signed contract
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              {`Signed on ${(new Date((selectedQuote as any).customer_signed_at)).toLocaleDateString('en-US', { dateStyle: 'medium' })}${(selectedQuote as any).customer_signed_name ? ` by ${(selectedQuote as any).customer_signed_name}` : ''}.`}
                            </p>
                            <div className="space-y-2 pt-1">
                              <MartinBuilderContractSeal />
                            </div>
                          </div>
                        ) : selectedQuoteId && portalSignPendingByQuote[selectedQuoteId] ? (
                          <div className="border-t-2 pt-4 mt-4 space-y-3">
                            <h4 className="font-semibold text-slate-800 flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                              This proposal is your signed contract
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              Signed by {portalSignPendingByQuote[selectedQuoteId].name}. Your acceptance is on file.
                            </p>
                            <div className="space-y-2 pt-1">
                              <MartinBuilderContractSeal />
                            </div>
                          </div>
                        ) : (selectedQuote as any)?.sent_at &&
                          Number((selectedQuote as any)?.signed_version) > 0 ? (
                          <div className="border-t-2 pt-4 mt-4 space-y-3">
                            <h4 className="font-semibold text-slate-800 flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                              This proposal is your signed contract
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              Martin Builder has recorded this proposal as your signed contract.
                            </p>
                            <div className="space-y-2 pt-1">
                              <MartinBuilderContractSeal />
                            </div>
                          </div>
                        ) : proposalVisibleInPortal ? (
                          <div className="border-t-2 pt-4 mt-4 space-y-3">
                            <h4 className="font-semibold text-slate-800 flex items-center gap-2">
                              <PenLine className="w-4 h-4" />
                              Use this proposal as contract
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              By signing below, you accept this proposal and authorize the work as specified. This will serve as your contract.
                            </p>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1.5">
                                <Label htmlFor="signer-name">Your full name *</Label>
                                <Input
                                  id="signer-name"
                                  value={signerName}
                                  onChange={(e) => setSignerName(e.target.value)}
                                  placeholder="Full name"
                                  className="bg-white"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="signer-email">Your email *</Label>
                                <Input
                                  id="signer-email"
                                  type="email"
                                  value={signerEmail}
                                  onChange={(e) => setSignerEmail(e.target.value)}
                                  placeholder="email@example.com"
                                  className="bg-white"
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id="agree-terms"
                                checked={agreeToTerms}
                                onChange={(e) => setAgreeToTerms(e.target.checked)}
                                className="rounded border-slate-300"
                              />
                              <Label htmlFor="agree-terms" className="text-sm font-normal cursor-pointer">
                                I agree to the terms and authorize the work as specified in this proposal.
                              </Label>
                            </div>
                            <div className="space-y-2">
                              {!agreeToTerms && (
                                <p className="text-xs text-amber-700">Check the agreement box above to enable signing.</p>
                              )}
                              <Button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleSignProposal(e);
                                }}
                                disabled={signing || !agreeToTerms || !signerName.trim() || !signerEmail.trim()}
                                className="bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {signing ? (
                                  <>
                                    <span className="animate-spin mr-2 inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                                    Signing…
                                  </>
                                ) : (
                                  <>
                                    <PenLine className="w-4 h-4 mr-2" />
                                    Sign & use as contract
                                  </>
                                )}
                              </Button>
                              {agreeToTerms && (!signerEmail.trim() || !signerName.trim()) && (
                                <p className="text-xs text-amber-700">Enter your full name and email above to sign.</p>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </CardContent>
                </Card>
              </>
            )}
            </>
          )}

          </TabsContent>

          <TabsContent value="options" className="space-y-6">
            <Card className="border-amber-200/60">
              <CardHeader>
                <CardTitle className="text-emerald-800">Optional Add-Ons</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!showFinancial && (
                  <p className="text-sm text-muted-foreground">
                    Optional sections are shown below. Pricing is hidden in this portal view.
                  </p>
                )}
                {proposalDataLoading ? (
                  <div className="text-sm text-muted-foreground">Loading options...</div>
                ) : !proposalData ? (
                  <div className="text-sm text-muted-foreground">No proposal data available.</div>
                ) : (optionalProposalSheets.length === 0 && optionalStandaloneSubs.length === 0) ? (
                  <div className="text-sm text-muted-foreground">No optional sections for this proposal.</div>
                ) : (
                  <>
                    {optionalProposalSheets
                      .slice()
                      .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
                      .map((sheet: any) => {
                        const linkedSubs = (proposalData.subcontractorEstimates || []).filter((e: any) => e.sheet_id === sheet.id);
                        const sheetMaterials = sheet._computedMaterials ?? 0;
                        const sheetLabor = sheet._computedLabor ?? 0;
                        const sheetTotal = readSectionTotal(sheet, sheetMaterials + sheetLabor);
                        const showPrice = showPriceForSection(sheet.id);
                        const showSheetBreakdown =
                          showPrice && !showMaterialItemsNoPrices && (sheetMaterials > 0 || sheetLabor > 0);
                        return (
                          <div key={sheet.id} className="border rounded-lg px-4 py-3 flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold text-base">{sheet.sheet_name}</h3>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                                  Optional
                                </span>
                              </div>
                              {sheet.description && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  <PortalMultilineText text={sheet.description} />
                                </p>
                              )}
                              {linkedSubs.map((est: any) => (
                                <div key={est.id} className="mt-2">
                                  {est.scope_of_work && (
                                    <p className="text-sm text-muted-foreground">
                                      <PortalMultilineText text={est.scope_of_work} />
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                            {showPrice && (
                              <div className="w-[120px] flex-shrink-0 text-right">
                                <p className="text-xs text-amber-700 font-medium mb-0.5">Not in total</p>
                                {showSheetBreakdown && sheetMaterials > 0 && (
                                  <>
                                    <p className="text-sm text-slate-500">Materials</p>
                                    <p className="text-base font-bold text-blue-700">${sheetMaterials.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                  </>
                                )}
                                {showSheetBreakdown && sheetLabor > 0 && (
                                  <>
                                    <p className="text-sm text-slate-500 mt-2">Labor</p>
                                    <p className="text-base font-bold text-amber-700">${sheetLabor.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                  </>
                                )}
                                <p className={`text-[11px] text-slate-500 ${showSheetBreakdown ? 'mt-2' : ''}`}>Section total</p>
                                <p className="text-sm font-bold text-emerald-700">
                                  ${sheetTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    {optionalStandaloneSubs
                      .slice()
                      .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
                      .map((est: any) => (
                        <div key={est.id} className="border rounded-lg px-4 py-3 flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-base">{est.company_name}</h3>
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                                Optional
                              </span>
                            </div>
                            {est.scope_of_work && (
                              <p className="text-sm text-muted-foreground mt-1">
                                <PortalMultilineText text={est.scope_of_work} />
                              </p>
                            )}
                          </div>
                          {showPriceForSection(est.id) && (
                            <div className="w-[120px] flex-shrink-0 text-right">
                              <p className="text-xs text-amber-700 font-medium mb-0.5">Not in total</p>
                              <p className="text-[11px] text-slate-500">Section total</p>
                              <p className="text-sm font-bold text-emerald-700">
                                ${readSectionTotal(est).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="change-orders" className="space-y-6">
            {!hasChangeOrderPortal ? null : changeOrderQuote && !(changeOrderQuote as any)?.sent_at ? (
                <Card className="border-orange-200 bg-orange-50/30">
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-50 text-orange-700" />
                    <p className="font-medium text-slate-700">No change order sent yet</p>
                    <p className="text-sm mt-1">When your project manager sends a change order, it will appear here for you to review and sign.</p>
                  </CardContent>
                </Card>
            ) : changeOrderQuote && (changeOrderQuote as any).sent_at && changeOrderDataLoading && !effectiveCoPortalBundle ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mr-2" />
                  Loading change orders…
                </div>
            ) : !effectiveCoPortalBundle ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No change order line items yet.</p>
            ) : (
                <div className="space-y-6">
                  {changeOrderQuote && (changeOrderQuote as any).sent_at ? (
                  <Card className="border-orange-100 bg-orange-50/50">
                    <CardContent className="pt-6 space-y-4">
                      <p className="text-sm text-slate-700">
                        <strong>Change orders</strong> are separate from your main proposal. Each one has its own number and printable document. Sign only the change orders you authorize.
                      </p>
                      {!showFinancialCo && (
                        <p className="text-sm text-muted-foreground">Pricing appears when your contractor shares it.</p>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="co-signer-name-all">Your full name (for signing) *</Label>
                          <Input
                            id="co-signer-name-all"
                            value={coSignerName}
                            onChange={(e) => setCoSignerName(e.target.value)}
                            placeholder="Full name"
                            className="bg-white"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="co-signer-email-all">Your email *</Label>
                          <Input
                            id="co-signer-email-all"
                            type="email"
                            value={coSignerEmail}
                            onChange={(e) => setCoSignerEmail(e.target.value)}
                            placeholder="email@example.com"
                            className="bg-white"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  ) : (
                  <Card className="border-orange-100 bg-orange-50/50">
                    <CardContent className="pt-6">
                      <p className="text-sm text-slate-700">
                        <strong>Change orders</strong> — additional scope and pricing for this project.
                      </p>
                      {!showFinancial && (
                        <p className="text-sm text-muted-foreground mt-2">Pricing appears when your contractor shares it.</p>
                      )}
                    </CardContent>
                  </Card>
                  )}
                    {(() => {
                      const coData = effectiveCoPortalBundle;
                      const showMatNoPricesTab = changeOrderQuoteId ? showMaterialItemsNoPricesCo : showMaterialItemsNoPrices;
                      const showFinCoTab = changeOrderQuoteId ? showFinancialCo : showFinancial;
                      const showLineCoTab = changeOrderQuoteId ? showLineItemPricesCo : showLineItemPrices;
                      const showPriceCoTab = (_sectionId: string) => showFinCoTab && showLineCoTab;
                      const showCoSectionTotals = showFinCoTab && !showMatNoPricesTab;
                      const rawSigs = (changeOrderQuote as any)?.change_order_signatures;
                      const coSigs: Record<string, { signed_at?: string; signed_name?: string }> =
                        rawSigs && typeof rawSigs === 'object' && !Array.isArray(rawSigs) ? rawSigs : {};
                      let sheets = (coData.materialSheets || []).filter(
                        (s: any) =>
                          !isFieldRequestSheetName(s.sheet_name) && s.sheet_type === 'change_order'
                      );
                      sheets = [...sheets].sort((a: any, b: any) => {
                        const sa = Number(a.change_order_seq) || 0;
                        const sb = Number(b.change_order_seq) || 0;
                        if (sa !== sb) return sa - sb;
                        return (a.order_index ?? 0) - (b.order_index ?? 0);
                      });
                      if (sheets.length === 0) {
                        return (
                          <p className="text-sm text-muted-foreground py-4 text-center">
                            No change order line items yet.
                          </p>
                        );
                      }
                      const taxExForCoTotals = changeOrderQuote
                        ? !!(changeOrderQuote as any)?.tax_exempt
                        : !!(selectedQuote as any)?.tax_exempt;
                      const displayTotals = (() => {
                        const sub = sheets.reduce((acc, sh) => acc + (Number(sh._computedTotal) || 0), 0);
                        const tax = taxExForCoTotals
                          ? 0
                          : sheets.reduce((acc, sh) => acc + (Number(sh._computedMaterials) || 0) * 0.07, 0);
                        return { subtotal: sub, tax, grandTotal: sub + tax };
                      })();
                      return (
                        <>
                          {sheets.map((sheet: any, idx: number) => {
                            const seq = Number(sheet.change_order_seq) || idx + 1;
                            const coLabel = `CO-${String(seq).padStart(3, '0')}`;
                            const sig = coSigs[sheet.id];
                            const linkedSubs = (coData.subcontractorEstimates || []).filter(
                              (e: any) => e.sheet_id === sheet.id
                            );
                            const linkedRows = (coData.customRows || [])
                              .filter((r: any) => r.sheet_id === sheet.id)
                              .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
                            const sheetMat = sheet._computedMaterials ?? 0;
                            const sheetLab = sheet._computedLabor ?? 0;
                            const taxEx = changeOrderQuote
                              ? !!(changeOrderQuote as any)?.tax_exempt
                              : !!(selectedQuote as any)?.tax_exempt;
                            const lineTax = taxEx ? 0 : sheetMat * 0.07;
                            const lineGrand = sheetMat + sheetLab + lineTax;
                            const signed = !!(sig?.signed_at);
                            return (
                              <Card key={sheet.id} className="border-orange-200 overflow-hidden">
                                <CardHeader className="bg-orange-50/80 border-b border-orange-100 flex flex-row flex-wrap items-start justify-between gap-3">
                                  <div className="space-y-1">
                                    <Badge variant="outline" className="text-orange-900 border-orange-400 bg-white font-mono">
                                      {coLabel}
                                    </Badge>
                                    <CardTitle className="text-lg text-orange-950 pt-1">{sheet.sheet_name}</CardTitle>
                                  </div>
                                  {changeOrderQuote ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0 border-orange-300"
                                    onClick={() => openChangeOrderDocument(sheet, coLabel)}
                                  >
                                    <Printer className="w-4 h-4 mr-2" />
                                    View document
                                  </Button>
                                  ) : null}
                                </CardHeader>
                                <CardContent className="pt-4 space-y-4">
                                  <div className="flex flex-col sm:flex-row gap-4 items-start">
                                    <div className="min-w-0 flex-1 space-y-4">
                                      {sheet.description && (
                                        <p className="text-sm text-muted-foreground">
                                          <PortalMultilineText text={sheet.description} />
                                        </p>
                                      )}
                                      {showMatNoPricesTab && (
                                        <div className="mt-2">
                                          <a
                                            href={buildMaterialSheetFullUrl(sheet.id, { changeOrder: true })}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 text-sm font-medium text-orange-800 hover:underline"
                                          >
                                            <ExternalLink className="w-4 h-4 shrink-0" />
                                            Open full material list (new page)
                                          </a>
                                          <p className="text-xs text-muted-foreground mt-1.5">
                                            Opens in a new tab — name, quantity, and usage only.
                                          </p>
                                        </div>
                                      )}
                                      {showPriceCoTab(sheet.id) &&
                                        !showMatNoPricesTab &&
                                        ((sheet.items || []).length > 0 || (sheet.laborRows || []).length > 0) && (
                                          <PortalSheetPricedLineItems sheet={sheet} variant="changeOrder" />
                                        )}
                                      {(() => {
                                        const linkedVisible = (sheet.sheetLinkedItems || [])
                                          .filter((item: any) => !item.hide_from_customer)
                                          .filter((item: any) => {
                                            if ((item.item_type || 'material') === 'labor' && (sheet.laborRows || []).length > 0) {
                                              return false;
                                            }
                                            return true;
                                          });
                                        if (linkedVisible.length === 0) return null;
                                        return (
                                          <ul className="text-sm space-y-1 border-t border-orange-100 pt-3">
                                            {linkedVisible.map((item: any) => {
                                              const lineAmt = portalSheetLinkedItemSellingAmount(item, sheet);
                                              return (
                                                <li key={item.id} className="flex justify-between gap-2">
                                                  <span>{item.description || 'Line'}</span>
                                                  {showCoSectionTotals && lineAmt > 0 && (
                                                    <span className="font-medium tabular-nums">
                                                      ${lineAmt.toLocaleString('en-US', {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                      })}
                                                    </span>
                                                  )}
                                                </li>
                                              );
                                            })}
                                          </ul>
                                        );
                                      })()}
                                      {linkedRows.map((row: any) => (
                                        <div key={row.id} className="border-t border-orange-50 pt-2">
                                          <p className="font-medium text-sm">{row.description || row.category}</p>
                                          {row.notes?.trim() && (
                                            <p className="text-sm text-muted-foreground">
                                              <PortalMultilineText text={row.notes} />
                                            </p>
                                          )}
                                          {showCoSectionTotals && (row._computedTotal ?? 0) > 0 && (
                                            <p className="text-sm font-semibold text-orange-800 mt-1">
                                              $
                                              {(row._computedTotal as number).toLocaleString('en-US', {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                              })}
                                            </p>
                                          )}
                                        </div>
                                      ))}
                                      {linkedSubs.map((est: any) => (
                                        <div
                                          key={est.id}
                                          className="text-sm flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 border-t border-orange-50 pt-2"
                                        >
                                          <div className="text-muted-foreground min-w-0">
                                            {est.scope_of_work && (
                                              <p>
                                                <PortalMultilineText text={est.scope_of_work} />
                                              </p>
                                            )}
                                          </div>
                                          {showCoSectionTotals && (Number(est._computedTotal) || 0) > 0 && (
                                            <p className="font-semibold text-orange-800 tabular-nums shrink-0">
                                              $
                                              {Number(est._computedTotal).toLocaleString('en-US', {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                              })}
                                            </p>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                    {showCoSectionTotals && (
                                      <div className="w-full sm:w-[120px] flex-shrink-0 sm:text-right border-t sm:border-t-0 border-orange-100 pt-3 sm:pt-0 space-y-0 text-sm">
                                        {sheetMat + sheetLab > 0 && (
                                          <>
                                            <p className="text-sm text-slate-500">Subtotal</p>
                                            <p className="text-base font-bold text-emerald-800">
                                              $
                                              {(sheetMat + sheetLab).toLocaleString('en-US', {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                              })}
                                            </p>
                                          </>
                                        )}
                                        {!taxEx && lineTax > 0 && (
                                          <>
                                            <p
                                              className={`text-sm text-slate-500 ${sheetMat + sheetLab > 0 ? 'mt-2' : ''}`}
                                            >
                                              Tax (est.)
                                            </p>
                                            <p className="font-semibold text-slate-700">
                                              $
                                              {lineTax.toLocaleString('en-US', {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                              })}
                                            </p>
                                          </>
                                        )}
                                        <p
                                          className={`text-[11px] text-slate-500 ${
                                            sheetMat + sheetLab > 0 || (!taxEx && lineTax > 0) ? 'mt-2' : ''
                                          }`}
                                        >
                                          Section total
                                        </p>
                                        <p className="text-sm font-bold text-orange-900">
                                          $
                                          {lineGrand.toLocaleString('en-US', {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          })}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground font-normal mt-1">{coLabel}</p>
                                      </div>
                                    )}
                                  </div>
                                  {changeOrderQuote ? (
                                    signed ? (
                                      <div className="border-t pt-4 space-y-2">
                                        <div className="flex items-center gap-2 text-emerald-800 font-medium">
                                          <CheckCircle className="w-5 h-5 shrink-0" />
                                          Signed — {coLabel}
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                          {sig.signed_name ? `${sig.signed_name} · ` : ''}
                                          {sig.signed_at
                                            ? new Date(sig.signed_at).toLocaleDateString('en-US', {
                                                dateStyle: 'medium',
                                              })
                                            : ''}
                                        </p>
                                        <MartinBuilderContractSeal />
                                      </div>
                                    ) : (
                                      <div className="border-t pt-4 space-y-3">
                                        <p className="text-sm font-medium text-slate-800">Sign to authorize {coLabel}</p>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            id={`co-agree-${sheet.id}`}
                                            checked={!!coAgreeBySheet[sheet.id]}
                                            onChange={(e) =>
                                              setCoAgreeBySheet((p) => ({
                                                ...p,
                                                [sheet.id]: e.target.checked,
                                              }))
                                            }
                                            className="rounded border-slate-300"
                                          />
                                          <Label htmlFor={`co-agree-${sheet.id}`} className="text-sm font-normal cursor-pointer">
                                            I authorize this change order ({coLabel}) and agree to the price shown.
                                          </Label>
                                        </div>
                                        <Button
                                          type="button"
                                          onClick={(e) => handleSignChangeOrderSheet(sheet.id, e)}
                                          disabled={
                                            coSigningSheetId === sheet.id ||
                                            !coAgreeBySheet[sheet.id] ||
                                            !coSignerName.trim() ||
                                            !coSignerEmail.trim()
                                          }
                                          className="bg-orange-700 hover:bg-orange-800"
                                        >
                                          {coSigningSheetId === sheet.id ? 'Signing…' : `Sign ${coLabel}`}
                                        </Button>
                                      </div>
                                    )
                                  )
                                  : null}
                                </CardContent>
                              </Card>
                            );
                          })}
                          {showFinCoTab && (
                            <Card className="border-slate-200 bg-slate-50/50">
                              <CardContent className="pt-4 text-sm text-muted-foreground">
                                <span className="font-medium text-slate-700">All change orders combined: </span>
                                $
                                {(displayTotals.grandTotal ?? 0).toLocaleString('en-US', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                (job total; each document above shows its own scope and price)
                              </CardContent>
                            </Card>
                          )}
                        </>
                      );
                    })()}
                </div>
            )}
          </TabsContent>

          {/* Materials (no prices) — same visibility as office "Material list (no prices)" */}
          <TabsContent value="materials" className="space-y-6">
            <Card className="border-emerald-200/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-emerald-900">
                  <Package className="w-5 h-5" />
                  Material list
                </CardTitle>
                <p className="text-sm text-muted-foreground font-normal">
                  Item names, quantities, and usage only — pricing is not shown.
                </p>
              </CardHeader>
              <CardContent className="space-y-8">
                {proposalDataLoading && !proposalData ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mr-2" />
                    Loading materials…
                  </div>
                ) : !proposalData ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Proposal data is not available yet.</p>
                ) : mainMaterialSheetsForTab.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No material sheets on this proposal.</p>
                ) : (
                  <Tabs
                    value={activeMaterialSheetId ?? mainMaterialSheetsForTab[0]?.id}
                    onValueChange={setActiveMaterialSheetId}
                    className="w-full"
                  >
                    <TabsList
                      className="grid w-full mb-4 h-auto bg-slate-100/90 border border-slate-300 p-0 rounded-md"
                      style={{ gridTemplateColumns: `repeat(${mainMaterialSheetsForTab.length}, minmax(0, 1fr))` }}
                    >
                      {mainMaterialSheetsForTab.map((sheet: any, idx: number) => (
                        <TabsTrigger
                          key={sheet.id}
                          value={sheet.id}
                          className={`h-auto min-h-10 px-3 py-2 text-xs sm:text-sm font-semibold text-center leading-snug whitespace-normal break-words rounded-none data-[state=inactive]:text-slate-700 data-[state=active]:bg-white data-[state=active]:text-emerald-900 data-[state=active]:shadow-sm ${
                            idx < mainMaterialSheetsForTab.length - 1 ? 'border-r border-slate-300' : ''
                          } ${idx === 0 ? 'rounded-l-md' : ''} ${idx === mainMaterialSheetsForTab.length - 1 ? 'rounded-r-md' : ''}`}
                        >
                          {sheet.sheet_name}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {mainMaterialSheetsForTab.map((sheet: any) => (
                      <TabsContent key={sheet.id} value={sheet.id}>
                        <div className="border rounded-lg p-4 space-y-3 bg-card">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="font-semibold text-base text-slate-900">{sheet.sheet_name}</h3>
                              {sheet.description?.trim() && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  <PortalMultilineText text={sheet.description} />
                                </p>
                              )}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="shrink-0 print:hidden"
                              onClick={() => openAndPrintMaterialSheet(sheet.id, { changeOrder: false })}
                            >
                              <Printer className="w-4 h-4 mr-2" />
                              Print page
                            </Button>
                          </div>
                          <div className="print:hidden">
                            <a
                              href={buildMaterialSheetFullUrl(sheet.id, { changeOrder: false })}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800 hover:underline"
                            >
                              <ExternalLink className="w-4 h-4 shrink-0" />
                              Open full material list (new page)
                            </a>
                          </div>
                          <PortalMaterialItemsTable items={sheet.items} />
                        </div>
                      </TabsContent>
                    ))}
                  </Tabs>
                )}
              </CardContent>
            </Card>

            {showCoMaterialsInMaterialsTab && (
              <Card className="border-orange-200 bg-orange-50/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-orange-950">
                    <ClipboardList className="w-5 h-5" />
                    Change order materials
                  </CardTitle>
                  <p className="text-sm text-muted-foreground font-normal">
                    Same quantity / usage view for items on your change order (no prices).
                  </p>
                </CardHeader>
                <CardContent className="space-y-6">
                  {changeOrderQuoteId && changeOrderDataLoading && !changeOrderProposalData ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mr-2" />
                      Loading change order materials…
                    </div>
                  ) : portalCoMaterialSheetsList.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No material sheets on the change order.</p>
                  ) : (
                    portalCoMaterialSheetsList.map((sheet: any) => (
                      <div key={sheet.id} className="border border-orange-200 rounded-lg p-4 space-y-3 bg-white">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-base text-orange-950">{sheet.sheet_name}</h3>
                            {sheet.description?.trim() && (
                              <p className="text-sm text-muted-foreground mt-1">
                                <PortalMultilineText text={sheet.description} />
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0 print:hidden"
                            onClick={() => openAndPrintMaterialSheet(sheet.id, { changeOrder: true })}
                          >
                            <Printer className="w-4 h-4 mr-2" />
                            Print page
                          </Button>
                        </div>
                        <div className="print:hidden">
                          <a
                            href={buildMaterialSheetFullUrl(sheet.id, { changeOrder: true })}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-medium text-orange-800 hover:underline"
                          >
                            <ExternalLink className="w-4 h-4 shrink-0" />
                            Open full material list (new page)
                          </a>
                        </div>
                        <PortalMaterialItemsTable items={sheet.items} />
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Payment History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {payments.length > 0 ? (
                  <div className="space-y-3">
                    {payments.map((payment: any) => (
                      <div key={payment.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <p className="font-medium">
                            {new Date(payment.payment_date).toLocaleDateString()}
                          </p>
                          {payment.payment_method && (
                            <p className="text-sm text-muted-foreground">{payment.payment_method}</p>
                          )}
                          {payment.payment_notes && (
                            <p className="text-sm text-muted-foreground mt-1">{payment.payment_notes}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-green-600">
                            ${parseFloat(payment.amount.toString()).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          {payment.receipt_url && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => window.open(payment.receipt_url, '_blank')}
                              className="mt-1"
                            >
                              <Download className="w-4 h-4 mr-1" />
                              Receipt
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No payments recorded yet</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Schedule Tab */}
          <TabsContent value="schedule">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Project Schedule
                </CardTitle>
              </CardHeader>
              <CardContent>
                {scheduleEvents.length > 0 ? (
                  <div className="space-y-3">
                    {scheduleEvents.map((event: any) => (
                      <div key={event.id} className="flex items-start gap-4 p-4 border rounded-lg">
                        <div className="text-center bg-blue-50 rounded-lg p-3 min-w-[80px]">
                          <p className="text-sm text-muted-foreground">
                            {new Date(event.event_date).toLocaleDateString('en-US', { month: 'short' })}
                          </p>
                          <p className="text-2xl font-bold text-blue-600">
                            {new Date(event.event_date).getDate()}
                          </p>
                        </div>
                        <div className="flex-1">
                          <h3 className="font-bold text-lg">{event.title}</h3>
                          {event.description && (
                            <p className="text-muted-foreground mt-1">
                              <PortalMultilineText text={event.description} />
                            </p>
                          )}
                          <Badge variant="outline" className="mt-2">
                            {event.event_type}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No scheduled events</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Project Documents
                </CardTitle>
              </CardHeader>
              <CardContent>
                {documents.length > 0 ? (
                  <div className="space-y-3">
                    {documents.map((doc: any) => {
                      const latestRevision = resolveLatestJobDocumentRevision(doc);
                      return (
                        <div key={doc.id} className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="flex items-center gap-3">
                            <FileText className="w-8 h-8 text-blue-600" />
                            <div>
                              <p className="font-medium">{doc.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {doc.category} • Version {doc.current_version}
                              </p>
                            </div>
                          </div>
                          {latestRevision && (
                            <Button
                              onClick={() => window.open(latestRevision.file_url, '_blank')}
                              variant="outline"
                            >
                              <Download className="w-4 h-4 mr-2" />
                              Download
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No documents available</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Photos Tab */}
          <TabsContent value="photos">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Image className="w-5 h-5" />
                  Project Photos
                </CardTitle>
              </CardHeader>
              <CardContent>
                {photos.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {photos.map((photo: any) => (
                      <div key={photo.id} className="group relative">
                        <img
                          src={photo.photo_url}
                          alt={photo.caption || 'Project photo'}
                          className="w-full h-48 object-cover rounded-lg cursor-pointer hover:opacity-90 transition"
                          onClick={() => window.open(photo.photo_url, '_blank')}
                        />
                        {photo.caption && (
                          <p className="text-sm text-muted-foreground mt-2">{photo.caption}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {new Date(photo.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No photos available</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Emails Tab */}
          <TabsContent value="emails">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  Project Messages
                </CardTitle>
                <Button type="button" onClick={() => { setEmailSentInDialog(false); setShowEmailDialog(true); }}>
                  <Send className="w-4 h-4 mr-2" />
                  New Message
                </Button>
              </CardHeader>
              <CardContent>
                {threadMessages.length > 0 ? (
                  <div
                    ref={messageThreadRef}
                    className="rounded-xl border bg-[#efeae2] p-2 sm:p-3 max-h-[65vh] overflow-y-auto space-y-1.5"
                  >
                    {threadMessages.map((email: any, idx: number) => {
                      const prev = idx > 0 ? threadMessages[idx - 1] : null;
                      const showDayBreak = !prev || messageDayKey(prev.email_date) !== messageDayKey(email.email_date);
                      return (
                        <div key={email.id} className="space-y-1.5">
                          {showDayBreak && (
                            <div className="flex justify-center py-1">
                              <span className="rounded-full border border-slate-300/70 bg-white/80 px-2 py-0.5 text-[11px] text-slate-600">
                                {messageDayLabel(email.email_date)}
                              </span>
                            </div>
                          )}
                          <div
                            className={`flex ${email.direction === 'sent' ? 'justify-start' : 'justify-end'}`}
                          >
                            <div
                              className={`max-w-[88%] sm:max-w-[72%] rounded-2xl px-3 py-2 shadow-sm border ${
                                email.direction === 'sent'
                                  ? 'bg-white border-slate-300/60 rounded-tl-sm'
                                  : 'bg-[#d9fdd3] border-emerald-300/50 rounded-tr-sm'
                              }`}
                            >
                              <div className="text-sm leading-relaxed">
                                {email.body_html ? (
                                  <div
                                    className="prose prose-sm max-w-none"
                                    dangerouslySetInnerHTML={{ __html: email.body_html }}
                                  />
                                ) : (
                                  <PortalMultilineText text={email.body_text} />
                                )}
                              </div>
                              <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-slate-500">
                                <span>{new Date(email.email_date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                                {email.direction === 'sent' && !email.is_read && (
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" title="New message" />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <MessageSquare className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground mb-4">No messages yet</p>
                    <Button type="button" onClick={() => { setEmailSentInDialog(false); setShowEmailDialog(true); }}>
                      <Send className="w-4 h-4 mr-2" />
                      Send Your First Message
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Send Email Dialog */}
      <Dialog
        open={showEmailDialog}
        onOpenChange={(open) => {
          if (!open) {
            setEmailSentInDialog(false);
            setEmailSendError(null);
          }
          setShowEmailDialog(open);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {emailSentInDialog ? (
                <>
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  Sent
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Send Message to Project Team
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {emailSentInDialog ? (
            <div className="py-6 text-center space-y-4">
              <p className="text-muted-foreground">Your message was sent to the project team. They may reply here in Messages.</p>
              <Button type="button" onClick={() => { setEmailSentInDialog(false); setShowEmailDialog(false); }}>
                Done
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="email-body">Message</Label>
                <Textarea
                  id="email-body"
                  value={emailBody}
                  onChange={(e) => {
                    setEmailBody(e.target.value);
                    if (emailSendError) setEmailSendError(null);
                  }}
                  placeholder="Type your message here..."
                  rows={8}
                  className="mt-2"
                />
              </div>
              {emailSendError && (
                <p className="text-sm text-red-600">{emailSendError}</p>
              )}
              <div className="flex gap-2 pt-4">
                <Button
                  type="button"
                  onClick={() => sendEmailToJob().catch((err) => { console.error(err); toast.error(err?.message ?? 'Failed to send message'); })}
                  disabled={sendingEmail}
                  className="flex-1"
                >
                  {sendingEmail ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send Message
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowEmailDialog(false)}
                  disabled={sendingEmail}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
