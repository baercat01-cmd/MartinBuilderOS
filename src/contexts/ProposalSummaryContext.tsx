import { createContext, useContext, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

export interface ProposalSummary {
  proposalNumber: string;
  materials: number;
  labor: number;
  subtotal: number;
  tax: number;
  grandTotal: number;
  /** Signed contract: job workbook materials extended sell; not part of proposal subtotal/grand total */
  jobWorkbookMaterials?: number | null;
  /** Signed contract: locked proposal workbook materials (workbook-only, same math as jobWorkbookMaterials) */
  proposalWorkbookMaterials?: number | null;
  /** Office-only rough pricing; hidden from customer portal until promoted */
  isCustomerEstimate?: boolean;
}

type SetProposalSummary = (summary: ProposalSummary | null) => void;

const ProposalSummaryContext = createContext<{
  summary: ProposalSummary | null;
  setSummary: SetProposalSummary;
} | null>(null);

export function ProposalSummaryProvider({ children }: { children: React.ReactNode }) {
  const [summary, setSummary] = useState<ProposalSummary | null>(null);
  const setSummaryStable = useCallback((s: ProposalSummary | null) => setSummary(s), []);
  return (
    <ProposalSummaryContext.Provider value={{ summary, setSummary: setSummaryStable }}>
      {children}
    </ProposalSummaryContext.Provider>
  );
}

export function useProposalSummary() {
  return useContext(ProposalSummaryContext);
}

/** Renders the proposal line (Proposal #, Materials, Labor, Subtotal, Tax, Grand Total) for the green header bar */
export function ProposalSummaryRow({ className }: { className?: string }) {
  const ctx = useProposalSummary();
  const s = ctx?.summary;
  if (!s) return null;
  const fmt = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs ${className ?? ''}`}>
      <span className="inline-flex items-baseline gap-1">
        <span
          className={cn(
            'font-semibold',
            s.isCustomerEstimate ? 'text-amber-100' : 'text-sky-100'
          )}
        >
          {s.isCustomerEstimate ? 'Estimate' : 'Proposal'}
        </span>
        <span
          className={cn(
            'font-mono font-bold tabular-nums tracking-tight',
            s.isCustomerEstimate ? 'text-amber-50' : 'text-yellow-100'
          )}
        >
          #{s.proposalNumber}
        </span>
      </span>
      {s.isCustomerEstimate ? (
        <>
          <span className="text-yellow-600/80">|</span>
          <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
            Rough pricing
          </span>
        </>
      ) : null}
      <span className="text-yellow-600/80">|</span>
      <span className="text-yellow-100/90">Materials:</span>
      <span className="font-semibold text-yellow-100">${fmt(s.materials)}</span>
      {typeof s.jobWorkbookMaterials === 'number' && (
        <>
          <span className="text-yellow-600/80">|</span>
          <span className="text-yellow-100/80" title="Internal job workbook — not in proposal total">
            Job WB:
          </span>
          <span className="font-semibold text-cyan-100">${fmt(s.jobWorkbookMaterials)}</span>
        </>
      )}
      <span className="text-yellow-100/90">Labor:</span>
      <span className="font-semibold text-yellow-100">${fmt(s.labor)}</span>
      <span className="text-yellow-600/80">|</span>
      <span className="text-yellow-100/90">Subtotal:</span>
      <span className="font-semibold text-yellow-100">${fmt(s.subtotal)}</span>
      {s.tax === 0 ? (
        <span className="font-medium text-amber-200">Tax exempt</span>
      ) : (
        <span className="text-yellow-100/90">Tax (7%): <span className="font-semibold text-amber-200">${fmt(s.tax)}</span></span>
      )}
      <span className="text-yellow-600/80">|</span>
      <span className="font-bold text-green-300">GRAND TOTAL: ${fmt(s.grandTotal)}</span>
    </div>
  );
}
