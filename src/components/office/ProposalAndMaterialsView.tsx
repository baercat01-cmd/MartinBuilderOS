import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { fetchJobQuotesForJob } from '@/lib/quotesSchemaFallback';
import { isQuoteContractFrozen } from '@/lib/quoteProposalLock';
import type { Job } from '@/types';
import { DocumentPanelContext } from '@/contexts/DocumentPanelContext';
import { FloatingDocumentViewer } from './FloatingDocumentViewer';
import { JobFinancials } from './JobFinancials';
import type { BreakdownSheetPrice } from './MaterialsManagement';

export type ViewMode = 'split' | 'proposal' | 'materials';

// JobFinancials loaded statically so the proposal panel always loads (dynamic chunk was failing).
const MaterialsManagement = lazy(() => import('./MaterialsManagement').then((m) => ({ default: m.MaterialsManagement })));

const PanelFallback = () => (
  <div className="flex items-center justify-center min-h-[280px] bg-slate-50/80">
    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

interface ProposalAndMaterialsViewProps {
  job: Job;
  userId?: string;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  /** When set, proposal selection is controlled by parent (e.g. JobDetailedView) so it stays in sync with Subcontractors tab. */
  controlledQuoteId?: string | null;
  onQuoteChange?: (quoteId: string | null) => void;
}

export function ProposalAndMaterialsView({ job, userId: userIdProp, viewMode: viewModeProp, onViewModeChange, controlledQuoteId, onQuoteChange }: ProposalAndMaterialsViewProps) {
  const { profile } = useAuth();
  const userId = userIdProp ?? profile?.id ?? '';
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>('split');
  const viewMode = viewModeProp ?? internalViewMode;
  const setViewMode = onViewModeChange ?? setInternalViewMode;
  const [internalQuoteId, setInternalQuoteId] = useState<string | null>(null);
  const [linkedSheetId, setLinkedSheetId] = useState<string | null>(null);
  const [showDocumentsInPanel, setShowDocumentsInPanel] = useState(false);
  const [breakdownSheetPrices, setBreakdownSheetPrices] = useState<BreakdownSheetPrice[]>([]);
  const [materialsWorkbookView, setMaterialsWorkbookView] = useState<{ workbookId: string | null; status: 'working' | 'locked' | null } | null>(null);
  const [materialsWorkbookReady, setMaterialsWorkbookReady] = useState(true);
  const [materialsSyncGen, setMaterialsSyncGen] = useState(0);
  const [jobWorkbookMaterialsTotal, setJobWorkbookMaterialsTotal] = useState<number | null>(null);
  /** Session-only unlock; shared with JobFinancials + Materials so the proposal workbook matches the left panel lock. */
  const [historicalUnlockedQuoteId, setHistoricalUnlockedQuoteId] = useState<string | null>(null);
  /** JobFinancials already bumps syncGen via handleJobFinancialsQuoteChange — skip duplicate in selectedQuoteId effect. */
  const quoteChangeFromFinancialsRef = useRef(false);

  const isControlled = controlledQuoteId !== undefined;
  const selectedQuoteId = isControlled ? (controlledQuoteId ?? null) : internalQuoteId;
  const setSelectedQuoteId = isControlled ? (onQuoteChange ?? (() => {})) : setInternalQuoteId;

  const handleJobFinancialsQuoteChange = useCallback(
    (quoteId: string | null) => {
      quoteChangeFromFinancialsRef.current = true;
      setMaterialsWorkbookReady(false);
      setMaterialsWorkbookView(null);
      setBreakdownSheetPrices([]);
      setMaterialsSyncGen((g) => g + 1);
      if (isControlled) {
        onQuoteChange?.(quoteId);
      } else {
        setInternalQuoteId(quoteId);
      }
    },
    [isControlled, onQuoteChange],
  );

  useEffect(() => {
    if (quoteChangeFromFinancialsRef.current) {
      quoteChangeFromFinancialsRef.current = false;
      return;
    }
    setJobWorkbookMaterialsTotal(null);
    setHistoricalUnlockedQuoteId(null);
    setBreakdownSheetPrices([]);
    setMaterialsWorkbookView(null);
    setMaterialsWorkbookReady(false);
    setMaterialsSyncGen((g) => g + 1);
  }, [selectedQuoteId]);

  // When uncontrolled and job changes, set proposal to most recent only if we don't already have a valid selection for this job
  useEffect(() => {
    if (isControlled) return;
    let mounted = true;
    (async () => {
      const { data: quotes, error } = await fetchJobQuotesForJob(supabase, job.id);
      if (!mounted) return;
      if (error || !quotes?.length) {
        setInternalQuoteId(null);
        return;
      }

      // Prefer a signed/office-locked main proposal so Materials binds to the workbook that exists for contracts.
      // This fixes the "No Material Workbook" case when the most-recent proposal is not the frozen contract.
      const mainQuotes = (quotes || []).filter((q: any) => !q.is_change_order_proposal);
      const frozenMain = mainQuotes.filter((q: any) => isQuoteContractFrozen(q));
      if (frozenMain.length > 0) {
        setInternalQuoteId((prev) => {
          if (prev && frozenMain.some((q: any) => q.id === prev)) return prev;
          return frozenMain[0]?.id ?? null; // quotes are already sorted by created_at desc
        });
        return;
      }

      const sortKey = (q: any) => {
        if (q.is_customer_estimate === true) {
          return (q.estimate_number || q.quote_number || q.created_at || '').toString();
        }
        return (q.proposal_number || q.quote_number || '').toString();
      };
      const sorted = [...quotes].sort((a: any, b: any) => {
        const na = sortKey(a);
        const nb = sortKey(b);
        if (na === nb) return 0;
        return nb.localeCompare(na, undefined, { numeric: true });
      });
      setInternalQuoteId((prev) => {
        if (prev && sorted.some((q: any) => q.id === prev)) return prev;
        return sorted[0]?.id ?? null;
      });
    })();
    return () => { mounted = false; };
  }, [job.id, isControlled]);

  if (!userId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  const showProposal = viewMode === 'split' || viewMode === 'proposal';
  const showMaterials = viewMode === 'split' || viewMode === 'materials';
  const isSplit = viewMode === 'split';

  return (
    <DocumentPanelContext.Provider value={{ showDocumentsInPanel, setShowDocumentsInPanel }}>
      <div className="flex min-h-0 w-full flex-1 flex-col">
        {/* Row: explicit flex-row — avoid w-full on the second column in split mode or it can claim 100% of the row and hide the proposal panel */}
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          {/* Proposal panel — narrower in split so materials workbook has more room */}
          <div
            className={`flex min-h-0 min-w-0 flex-col overflow-auto bg-white transition-all ${
              isSplit ? 'w-2/5 min-w-[260px] shrink-0 border-r border-slate-200' : 'w-full'
            } ${showProposal ? '' : 'hidden'}`}
          >
            <div className="w-full max-w-full mx-auto space-y-2 pt-0 pb-2 px-3">
              <JobFinancials
                job={job}
                controlledQuoteId={selectedQuoteId ?? undefined}
                onQuoteChange={handleJobFinancialsQuoteChange}
                onSheetSelect={setLinkedSheetId}
                externalBreakdownSheetPrices={breakdownSheetPrices}
                externalMaterialsWorkbookView={materialsWorkbookView}
                externalJobWorkbookMaterialsTotal={jobWorkbookMaterialsTotal}
                historicalUnlockedQuoteId={historicalUnlockedQuoteId}
                onHistoricalUnlockedQuoteIdChange={setHistoricalUnlockedQuoteId}
                materialsPanelActive={showMaterials}
                materialsWorkbookReady={showMaterials ? materialsWorkbookReady : true}
                materialsSyncGen={materialsSyncGen}
              />
            </div>
          </div>

          {/* Materials panel — shows document viewer in same view when "Documents" is clicked from header */}
          <div
            className={`flex min-h-0 min-w-0 flex-col overflow-auto bg-slate-50 ${
              isSplit ? 'flex-1' : 'w-full flex-1'
            } ${showMaterials ? '' : 'hidden'}`}
          >
            {showDocumentsInPanel ? (
              <div className="flex flex-col h-full min-h-0 w-full p-2">
                <FloatingDocumentViewer
                  jobId={job.id}
                  open={true}
                  onClose={() => setShowDocumentsInPanel(false)}
                  embed
                  backLabel="Back to Workbook"
                />
              </div>
            ) : (
              <Suspense fallback={<PanelFallback />}>
                <MaterialsManagement
                  job={job}
                  userId={userId}
                  controlledQuoteId={selectedQuoteId ?? undefined}
                  onQuoteChange={handleJobFinancialsQuoteChange}
                  externalActiveSheetId={linkedSheetId}
                  onBreakdownPriceSync={setBreakdownSheetPrices}
                  onWorkbookViewSync={setMaterialsWorkbookView}
                  onWorkbookLoadSettled={() => setMaterialsWorkbookReady(true)}
                  onJobWorkbookMaterialsTotalSync={setJobWorkbookMaterialsTotal}
                  historicalUnlockedQuoteId={historicalUnlockedQuoteId}
                  jobWorkbookMaterialsTotalForStrip={
                    typeof jobWorkbookMaterialsTotal === 'number' ? jobWorkbookMaterialsTotal : undefined
                  }
                />
              </Suspense>
            )}
          </div>
        </div>
      </div>
    </DocumentPanelContext.Provider>
  );
}
