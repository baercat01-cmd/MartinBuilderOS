// Interactive Customer Portal Preview Component
// This component renders a full-featured preview of what customers will see in their portal

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isFieldRequestSheetName } from '@/lib/materialWorkbook';
import { 
  Building2, 
  MapPin, 
  ChevronRight, 
  FileText, 
  DollarSign, 
  Calendar, 
  Image, 
  Download,
  CheckCircle,
  Clock,
  ExternalLink,
  ClipboardList,
  Package
} from 'lucide-react';
import { PortalMaterialItemsTable } from '@/components/customer/PortalMaterialItemsTable';
import { PortalMultilineText } from '@/components/customer/PortalMultilineText';
import { PortalSheetPricedLineItems } from '@/components/customer/PortalSheetPricedLineItems';

interface CustomerPortalPreviewProps {
  customerName: string;
  jobs: any[];
  visibilitySettings: any;
  customMessage?: string | null;
  /** When provided (office preview), the proposal for this quote is shown so preview matches "Visibility for proposal" selection. */
  initialQuoteId?: string | null;
}

export function CustomerPortalPreview({ customerName, jobs, visibilitySettings, customMessage, initialQuoteId }: CustomerPortalPreviewProps) {
  const [selectedJob, setSelectedJob] = useState<any>(null);

  // When previewing a single job (e.g. from Create dialog), open straight to its detail view
  useEffect(() => {
    if (jobs.length === 1) setSelectedJob(jobs[0]);
    else if (jobs.length === 0) setSelectedJob(null);
  }, [jobs]);

  if (selectedJob) {
    return (
      <JobDetailPreview
        jobData={selectedJob}
        onBack={() => setSelectedJob(null)}
        visibilitySettings={visibilitySettings}
        initialQuoteId={initialQuoteId}
      />
    );
  }

  return (
    <div className="min-h-full">
      {/* Header: black, gold, dark green */}
      <div className="bg-gradient-to-r from-zinc-900 via-emerald-950 to-zinc-900 text-white shadow-xl border-b-2 border-amber-500/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-amber-400">Your Projects</h1>
              <p className="text-emerald-100/90 mt-1">Welcome back, {customerName}</p>
            </div>
            <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/40 px-4 py-2">
              Customer Portal
            </Badge>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Custom Message */}
        {customMessage && (
          <div className="bg-amber-50/80 border-2 border-amber-200/60 rounded-lg p-4 mb-6">
            <p className="text-slate-800">{customMessage}</p>
          </div>
        )}

        <div className="space-y-4">
          <h2 className="text-2xl font-bold mb-4">All Projects ({jobs.length})</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {jobs.map((jobData: any) => {
              const { totalPaid, estimatedPrice, remainingBalance, documents, photos, scheduleEvents } = jobData;
              
              return (
                <Card 
                  key={jobData.id} 
                  className="hover:shadow-lg transition-shadow cursor-pointer border-2"
                  onClick={() => setSelectedJob(jobData)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="flex items-center gap-2">
                          <Building2 className="w-5 h-5 text-emerald-600" />
                          {jobData.name}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          <MapPin className="w-3 h-3 inline mr-1" />
                          {jobData.address}
                        </p>
                      </div>
                      <Badge variant={jobData.status === 'active' ? 'default' : 'secondary'}>
                        {jobData.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Financial Summary - Only if enabled */}
                    {visibilitySettings?.show_financial_summary && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 bg-slate-50 rounded-lg">
                        <div className="text-center">
                          <p className="text-xs text-muted-foreground">Quote Total</p>
                          <p className="font-bold text-sm text-emerald-700">${estimatedPrice.toLocaleString()}</p>
                        </div>
                        {(jobData.quote?.status === 'accepted' || jobData.quote?.status === 'signed') && (
                          <>
                            <div className="text-center">
                              <p className="text-xs text-muted-foreground">Paid</p>
                              <p className="font-bold text-sm text-green-600">${totalPaid.toLocaleString()}</p>
                            </div>
                            <div className="text-center">
                              <p className="text-xs text-muted-foreground">Balance</p>
                              <p className="font-bold text-sm text-amber-600">${remainingBalance.toLocaleString()}</p>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Quick Stats - Only show enabled sections */}
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      {visibilitySettings?.show_photos && (
                        <div className="flex items-center gap-1">
                          <Image className="w-4 h-4" />
                          <span>{photos?.length || 0} photos</span>
                        </div>
                      )}
                      {visibilitySettings?.show_documents && (
                        <div className="flex items-center gap-1">
                          <FileText className="w-4 h-4" />
                          <span>{documents?.length || 0} docs</span>
                        </div>
                      )}
                      {visibilitySettings?.show_schedule && (
                        <div className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          <span>{scheduleEvents?.length || 0} events</span>
                        </div>
                      )}
                    </div>

                    <Button variant="outline" className="w-full">
                      View Details
                      <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Job Detail Preview Component - Shows individual job with all tabs
function JobDetailPreview({ jobData, onBack, visibilitySettings, initialQuoteId }: any) {
  const jobQuotes = jobData.jobQuotes || (jobData.quote ? [jobData.quote] : []);
  const proposalQuotes = jobQuotes.filter((q: any) => !q.is_change_order_proposal);
  const changeOrderQuote = jobData.changeOrderQuote ?? null;
  const changeOrderProposalData = jobData.changeOrderProposalData ?? null;
  const showProposalTab = !!visibilitySettings?.show_proposal;
  /** Declare before effects — `useEffect` below reads `showMaterialsTab` (TDZ if defined later). */
  const previewMaterialListNoPrices = visibilitySettings?.show_material_items_no_prices === true;
  const showMaterialsTab = showProposalTab && previewMaterialListNoPrices;

  const [activeTab, setActiveTab] = useState(() => (showProposalTab ? 'proposal' : 'overview'));

  const proposalDataByQuoteId = jobData.proposalDataByQuoteId || {};
  const defaultQuoteId = proposalQuotes[0]?.id ?? null;
  const validInitial =
    initialQuoteId != null && proposalQuotes.some((q: any) => q.id === initialQuoteId) ? initialQuoteId : null;
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(validInitial ?? defaultQuoteId);
  useEffect(() => {
    if (validInitial != null) setSelectedQuoteId(validInitial);
  }, [validInitial]);
  useEffect(() => {
    if (selectedQuoteId && !proposalQuotes.some((q: any) => q.id === selectedQuoteId)) {
      setSelectedQuoteId(defaultQuoteId);
    }
  }, [proposalQuotes, selectedQuoteId, defaultQuoteId]);

  const selectedQuote =
    proposalQuotes.find((q: any) => q.id === selectedQuoteId) ?? proposalQuotes[0] ?? jobData.quote;
  const proposalData =
    selectedQuoteId && proposalDataByQuoteId[selectedQuoteId]
      ? proposalDataByQuoteId[selectedQuoteId]
      : jobData.proposalData;

  const proposalCoSheetsPreview = useMemo(() => {
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

  const hasChangeOrderTab = showProposalTab && (!!changeOrderQuote || proposalCoSheetsPreview.length > 0);

  useEffect(() => {
    if (showProposalTab && activeTab === 'overview') setActiveTab('proposal');
    if (!showProposalTab && activeTab === 'proposal') setActiveTab('overview');
    if (activeTab === 'change-orders' && !hasChangeOrderTab) setActiveTab(showProposalTab ? 'proposal' : 'overview');
    if (activeTab === 'materials' && !showMaterialsTab) setActiveTab(showProposalTab ? 'proposal' : 'overview');
  }, [showProposalTab, hasChangeOrderTab, showMaterialsTab, activeTab]);

  const isOptionalFlag = (value: any) => value === true || value === 'true' || value === 1;
  const optionalProposalSheets = ((proposalData?.materialSheets || []) as any[]).filter(
    (s: any) => s.sheet_type !== 'change_order' && !isFieldRequestSheetName(s.sheet_name) && isOptionalFlag(s.is_option)
  );
  const optionalStandaloneSubs = ((proposalData?.subcontractorEstimates || []) as any[]).filter(
    (est: any) => !est.sheet_id && !est.row_id && isOptionalFlag(est.is_option)
  );
  const hasOptionsTab = showProposalTab && (optionalProposalSheets.length > 0 || optionalStandaloneSubs.length > 0);
  const { payments, documents, photos, scheduleEvents, viewerLinks = [] } = jobData;
  const totalPaid = payments?.reduce((sum: number, p: any) => sum + parseFloat(p.amount || '0'), 0) || 0;
  const balance = (proposalData?.totals?.grandTotal || 0) - totalPaid;
  const isSignedContract = selectedQuote?.status === 'accepted' || selectedQuote?.status === 'signed';
  const proposalNumber = selectedQuote?.proposal_number || selectedQuote?.quote_number || 'N/A';

  const previewMainMaterialSheets = useMemo(
    () =>
      (proposalData?.materialSheets || []).filter(
        (s: any) => s.sheet_type !== 'change_order' && !isFieldRequestSheetName(s.sheet_name)
      ),
    [proposalData]
  );
  const [activeMaterialSheetId, setActiveMaterialSheetId] = useState<string | null>(null);
  useEffect(() => {
    if (!previewMainMaterialSheets.length) {
      setActiveMaterialSheetId(null);
      return;
    }
    if (!activeMaterialSheetId || !previewMainMaterialSheets.some((s: any) => s.id === activeMaterialSheetId)) {
      setActiveMaterialSheetId(previewMainMaterialSheets[0].id);
    }
  }, [previewMainMaterialSheets, activeMaterialSheetId]);

  const previewCoMaterialSheets = useMemo(() => {
    const co = changeOrderProposalData;
    if (!co?.materialSheets?.length) return [];
    let sheets = (co.materialSheets as any[]).filter(
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

  const previewShowCoMaterials =
    hasChangeOrderTab &&
    previewMaterialListNoPrices &&
    (!!changeOrderQuote ? !!(changeOrderQuote as any)?.sent_at : proposalCoSheetsPreview.length > 0);

  const previewPortalCoMaterialSheets =
    previewCoMaterialSheets.length > 0 ? previewCoMaterialSheets : proposalCoSheetsPreview;

  const visibleTabs = [
    ...(showProposalTab
      ? [{ value: 'proposal', label: 'Proposal', show: true as boolean }]
      : [{ value: 'overview', label: 'Overview', show: true as boolean }]),
    ...(hasOptionsTab ? [{ value: 'options', label: 'Options', show: true as boolean }] : []),
    ...(hasChangeOrderTab ? [{ value: 'change-orders', label: 'Change orders', show: true as boolean }] : []),
    ...(showMaterialsTab ? [{ value: 'materials', label: 'Materials', show: true as boolean }] : []),
    { value: 'payments', label: 'Payments', show: visibilitySettings?.show_payments },
    { value: 'schedule', label: 'Schedule', show: visibilitySettings?.show_schedule },
    { value: 'documents', label: 'Documents', show: visibilitySettings?.show_documents },
    { value: 'photos', label: 'Photos', show: visibilitySettings?.show_photos },
  ].filter((tab) => tab.show);

  useEffect(() => {
    if (activeTab === 'options' && !hasOptionsTab) setActiveTab(showProposalTab ? 'proposal' : 'overview');
  }, [activeTab, hasOptionsTab, showProposalTab]);

  return (
    <div className="min-h-full">
      {/* Header: black, gold, dark green – project name, proposal #, client, address */}
      <div className="bg-gradient-to-r from-zinc-900 via-emerald-950 to-zinc-900 text-white shadow-xl border-b-2 border-amber-500/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4 flex-wrap">
              <Button variant="ghost" size="sm" onClick={onBack} className="text-white hover:bg-white/10 shrink-0">
                ← Back to Projects
              </Button>
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-3xl font-bold text-amber-400">{jobData.name}</h1>
                  {proposalQuotes.length > 1 ? (
                    <Select value={selectedQuoteId ?? ''} onValueChange={(v) => setSelectedQuoteId(v || null)}>
                      <SelectTrigger className="w-[180px] bg-amber-500/10 border-amber-500/50 text-amber-200">
                        <SelectValue placeholder="Select proposal" />
                      </SelectTrigger>
                      <SelectContent>
                        {proposalQuotes.map((q: any) => (
                          <SelectItem key={q.id} value={q.id}>
                            Proposal #{q.proposal_number || q.quote_number || q.id.slice(0, 8)}
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
                <p className="text-emerald-100/90 mt-1">{jobData.client_name}</p>
                {jobData.address && (
                  <p className="text-emerald-200/80 text-sm mt-1 flex items-center gap-1">
                    <MapPin className="w-4 h-4 shrink-0 text-amber-400/90" />
                    {jobData.address}
                  </p>
                )}
              </div>
            </div>
            <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/40 px-4 py-2">
              Project Details
            </Badge>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className={`grid w-full mb-6`} style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, 1fr)` }}>
            {visibleTabs.map(tab => (
              <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
            ))}
          </TabsList>

          {/* Proposal tab — contract proposal only (matches customer portal Proposal / overview flow) */}
          <TabsContent value="proposal" className="space-y-6">
            {visibilitySettings?.custom_message && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="pt-6">
                  <p className="text-slate-800">
                    <PortalMultilineText text={visibilitySettings.custom_message} />
                  </p>
                </CardContent>
              </Card>
            )}
            {visibilitySettings?.show_proposal && (
              <Card className="border-emerald-200/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-emerald-900">
                    <FileText className="w-5 h-5" />
                    Project Proposal
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(() => {
                    const baseShowPrice = !!(visibilitySettings?.show_financial_summary && visibilitySettings?.show_line_item_prices);
                    const sp: Record<string, boolean> | null =
                      typeof visibilitySettings?.show_section_prices === 'object' &&
                      visibilitySettings?.show_section_prices !== null &&
                      !Array.isArray(visibilitySettings?.show_section_prices)
                        ? visibilitySettings.show_section_prices
                        : null;
                    const showPriceForSection = (sectionId?: string) =>
                      !!sectionId && baseShowPrice && (sp == null || sp[sectionId] !== false);
                    // Build sections: material sheets (section totals only), linked custom rows, standalone rows/subs
                    const proposalSheets = (proposalData?.materialSheets || []).filter(
                      (s: any) => s.sheet_type !== 'change_order' && !isFieldRequestSheetName(s.sheet_name) && !isOptionalFlag(s.is_option)
                    );
                    const customRows = proposalData?.customRows || [];
                    const standaloneCustomRows = customRows.filter((r: any) => !r.sheet_id);
                    const sheetSections: Array<{ type: 'material' | 'custom' | 'subcontractor'; id: string; orderIndex: number; data: any }> = [];
                    proposalSheets.forEach((sheet: any) => {
                      const sheetOrder = sheet.order_index ?? 0;
                      sheetSections.push({ type: 'material' as const, id: sheet.id, orderIndex: sheetOrder * 1000, data: sheet });
                      customRows.filter((r: any) => r.sheet_id === sheet.id).sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0)).forEach((row: any, idx: number) => {
                        sheetSections.push({ type: 'custom' as const, id: row.id, orderIndex: sheetOrder * 1000 + 100 + (row.order_index ?? idx), data: row });
                      });
                    });
                    const allSections: Array<{ type: 'material' | 'custom' | 'subcontractor'; id: string; orderIndex: number; data: any }> = [
                      ...sheetSections,
                      ...standaloneCustomRows.map((r: any) => ({ type: 'custom' as const, id: r.id, orderIndex: (r.order_index ?? 0) * 1000, data: r })),
                      ...(proposalData?.subcontractorEstimates || [])
                        .filter((e: any) => !e.sheet_id && !e.row_id && !isOptionalFlag(e.is_option))
                        .map((e: any) => ({ type: 'subcontractor' as const, id: e.id, orderIndex: (e.order_index ?? 0) * 1000, data: e })),
                    ].sort((a, b) => a.orderIndex - b.orderIndex);

                    return (
                      <>
                        {allSections.map((section) => {
                      const showPrice = showPriceForSection(section.id);
                      if (section.type === 'material') {
                        const sheet = section.data;
                        const sheetMaterials = sheet._computedMaterials ?? 0;
                        const sheetLabor = sheet._computedLabor ?? 0;
                        const sectionTotal = sheetMaterials + sheetLabor;
                        return (
                          <div key={sheet.id} className="border rounded-lg p-4 flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <h3 className="font-bold text-lg">{sheet.sheet_name}</h3>
                              {sheet.description && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  <PortalMultilineText text={sheet.description} />
                                </p>
                              )}
                            </div>
                            {showPrice && (
                              <div className="w-[140px] shrink-0 text-right">
                                <p className="text-xs text-slate-500">Section total</p>
                                <p className="text-xl font-bold text-emerald-700">
                                  ${sectionTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      }
                      if (section.type === 'custom') {
                        const row = section.data;
                        const total = row._computedTotal ?? 0;
                        const title = row.description || row.category || 'Custom';
                        const descriptionParts: string[] = [];
                        if (row.notes?.trim()) descriptionParts.push(row.notes.trim());
                        if (row.description?.trim() && row.description.trim() !== title.trim()) descriptionParts.push(row.description.trim());
                        const descriptionText = descriptionParts.join('\n\n');
                        return (
                          <div key={row.id} className="border rounded-lg p-4 flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <h3 className="font-bold text-lg">{title}</h3>
                              {descriptionText && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  <PortalMultilineText text={descriptionText} />
                                </p>
                              )}
                            </div>
                            {showPrice && <p className="text-xl font-bold text-emerald-700 shrink-0">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>}
                          </div>
                        );
                      }
                      const est = section.data;
                      const total = est._computedTotal ?? 0;
                      return (
                        <div key={est.id} className="border rounded-lg p-4 flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-bold text-lg">{est.company_name}</h3>
                            {est.scope_of_work && <p className="text-sm text-muted-foreground mt-1">{est.scope_of_work}</p>}
                          </div>
                          {showPrice && <p className="text-xl font-bold text-emerald-700 shrink-0">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>}
                        </div>
                      );
                    })}
                      </>
                    );
                  })()}

                  {/* Final price at bottom is controlled by "Show final price". */}
                  {visibilitySettings?.show_financial_summary && (
                    <div className="border-t-2 pt-4 space-y-2">
                      <div className="flex justify-between text-lg">
                        <span className="font-medium">Price before tax:</span>
                        <span>
                          ${(proposalData?.totals?.subtotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex justify-between text-lg">
                        <span className="font-medium">Tax:</span>
                        <span>
                          ${(proposalData?.totals?.tax ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex justify-between text-2xl font-bold pt-2 border-t">
                        <span>Final Price (after tax):</span>
                        <span className="text-emerald-700">
                          ${(proposalData?.totals?.grandTotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {hasOptionsTab && (
            <TabsContent value="options" className="space-y-6">
              <Card className="border-amber-200/70 bg-amber-50/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-amber-900">
                    <ClipboardList className="w-5 h-5" />
                    Optional Add-Ons
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(() => {
                    const baseShowPrice = !!(visibilitySettings?.show_financial_summary && visibilitySettings?.show_line_item_prices);
                    const sp: Record<string, boolean> | null =
                      typeof visibilitySettings?.show_section_prices === 'object' &&
                      visibilitySettings?.show_section_prices !== null &&
                      !Array.isArray(visibilitySettings?.show_section_prices)
                        ? visibilitySettings.show_section_prices
                        : null;
                    const showPriceForSection = (sectionId?: string) =>
                      !!sectionId && baseShowPrice && (sp == null || sp[sectionId] !== false);

                    return (
                      <>
                        {optionalProposalSheets
                          .slice()
                          .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
                          .map((sheet: any) => {
                            const sheetMaterials = sheet._computedMaterials ?? 0;
                            const sheetLabor = sheet._computedLabor ?? 0;
                            const sectionTotal = sheetMaterials + sheetLabor;
                            const showPrice = showPriceForSection(sheet.id);
                            return (
                              <div key={sheet.id} className="border rounded-lg p-4 flex items-start justify-between gap-4 bg-white">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="font-bold text-lg">{sheet.sheet_name}</h3>
                                    <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 border-amber-300">Optional</Badge>
                                  </div>
                                  {sheet.description && (
                                    <p className="text-sm text-muted-foreground mt-1">
                                      <PortalMultilineText text={sheet.description} />
                                    </p>
                                  )}
                                </div>
                                {showPrice && (
                                  <div className="w-[120px] shrink-0 text-right">
                                    <p className="text-xs text-amber-700 font-medium mb-1">Not in total</p>
                                    <p className="text-xs text-slate-500">Section total</p>
                                    <p className="text-xl font-bold text-emerald-700">
                                      ${sectionTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        {optionalStandaloneSubs
                          .slice()
                          .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
                          .map((est: any) => {
                            const total = est._computedTotal ?? 0;
                            const showPrice = showPriceForSection(est.id);
                            return (
                              <div key={est.id} className="border rounded-lg p-4 flex items-start justify-between gap-4 bg-white">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="font-bold text-lg">{est.company_name}</h3>
                                    <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 border-amber-300">Optional</Badge>
                                  </div>
                                  {est.scope_of_work && <p className="text-sm text-muted-foreground mt-1">{est.scope_of_work}</p>}
                                </div>
                                {showPrice && (
                                  <div className="w-[120px] shrink-0 text-right">
                                    <p className="text-xs text-amber-700 font-medium mb-1">Not in total</p>
                                    <p className="text-xs text-slate-500">Section total</p>
                                    <p className="text-xl font-bold text-emerald-700">
                                      ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* Overview when proposal tab is hidden — welcome + drawings only */}
          <TabsContent value="overview" className="space-y-6">
            {visibilitySettings?.custom_message && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="pt-6">
                  <p className="text-slate-800">
                    <PortalMultilineText text={visibilitySettings.custom_message} />
                  </p>
                </CardContent>
              </Card>
            )}
            {visibilitySettings?.show_documents && viewerLinks.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ExternalLink className="w-5 h-5" />
                    Drawings & 3D Views
                  </CardTitle>
                  <p className="text-sm text-muted-foreground font-normal">Also available under the Documents tab.</p>
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
            {!visibilitySettings?.custom_message && (!viewerLinks.length || !visibilitySettings?.show_documents) && (
              <p className="text-sm text-muted-foreground text-center py-8">Enable Proposal or Documents in portal settings to see more here.</p>
            )}
          </TabsContent>

          {/* Change orders — separate from main proposal */}
          {hasChangeOrderTab && (
            <TabsContent value="change-orders" className="space-y-6">
              <Card className="border-orange-200/80 bg-orange-50/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-orange-900">
                    <ClipboardList className="w-5 h-5" />
                    Change order
                  </CardTitle>
                  <p className="text-sm text-muted-foreground font-normal">
                    Separate from the main contract proposal. Customer reviews and signs this in the Change orders tab in the live portal.
                  </p>
                  {(changeOrderQuote as any)?.sent_at && (
                    <Badge className="w-fit bg-orange-100 text-orange-900 border-orange-300">Sent to customer</Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {(() => {
                    const coFallback =
                      proposalCoSheetsPreview.length > 0 && proposalData
                        ? (() => {
                            const taxEx = !!(selectedQuote as any)?.tax_exempt;
                            const sub = proposalCoSheetsPreview.reduce(
                              (acc, sh) => acc + (Number(sh._computedTotal) || 0),
                              0
                            );
                            const tax = taxEx
                              ? 0
                              : proposalCoSheetsPreview.reduce(
                                  (acc, sh) => acc + (Number(sh._computedMaterials) || 0) * 0.07,
                                  0
                                );
                            return {
                              ...proposalData,
                              materialSheets: proposalCoSheetsPreview,
                              totals: { subtotal: sub, tax, grandTotal: sub + tax },
                            };
                          })()
                        : null;
                    const co = changeOrderProposalData ?? coFallback;
                    if (!co) {
                      return (
                        <p className="text-sm text-muted-foreground py-4">Loading change order…</p>
                      );
                    }
                    const baseShowPrice = !!(visibilitySettings?.show_financial_summary && visibilitySettings?.show_line_item_prices);
                    const sp: Record<string, boolean> | null =
                      typeof visibilitySettings?.show_section_prices === 'object' &&
                      visibilitySettings?.show_section_prices !== null &&
                      !Array.isArray(visibilitySettings?.show_section_prices)
                        ? visibilitySettings.show_section_prices
                        : null;
                    const showPriceForSection = (sectionId: string) => baseShowPrice && (sp == null || sp[sectionId] !== false);
                    const coNum =
                      (changeOrderQuote as any)?.proposal_number ||
                      (changeOrderQuote as any)?.quote_number ||
                      (selectedQuote as any)?.proposal_number ||
                      (selectedQuote as any)?.quote_number ||
                      'Change order';
                    const sheets = (co.materialSheets || []).filter(
                      (s: any) => !isFieldRequestSheetName(s.sheet_name) && s.sheet_type === 'change_order'
                    );
                    const taxExCoPreview = changeOrderQuote
                      ? !!(changeOrderQuote as any)?.tax_exempt
                      : !!(selectedQuote as any)?.tax_exempt;
                    const totals = (() => {
                      const sub = sheets.reduce((acc, sh) => acc + (Number(sh._computedTotal) || 0), 0);
                      const tax = taxExCoPreview
                        ? 0
                        : sheets.reduce((acc, sh) => acc + (Number(sh._computedMaterials) || 0) * 0.07, 0);
                      return { subtotal: sub, tax, grandTotal: sub + tax };
                    })();
                    const customRows = co.customRows || [];
                    const sheetSections: Array<{ type: 'material' | 'custom' | 'subcontractor'; id: string; orderIndex: number; data: any }> = [];
                    sheets.forEach((sheet: any) => {
                      const sheetOrder = sheet.order_index ?? 0;
                      sheetSections.push({ type: 'material' as const, id: sheet.id, orderIndex: sheetOrder * 1000, data: sheet });
                      customRows
                        .filter((r: any) => r.sheet_id === sheet.id)
                        .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))
                        .forEach((row: any, idx: number) => {
                          sheetSections.push({
                            type: 'custom' as const,
                            id: row.id,
                            orderIndex: sheetOrder * 1000 + 100 + (row.order_index ?? idx),
                            data: row,
                          });
                        });
                    });
                    const allSections = [...sheetSections].sort((a, b) => a.orderIndex - b.orderIndex);

                    if (allSections.length === 0) {
                      return (
                        <p className="text-sm text-muted-foreground py-6 text-center">
                          No change order line items yet. Add sheets on the change order proposal in the office, then send to the customer.
                        </p>
                      );
                    }

                    return (
                      <>
                        {visibilitySettings?.show_financial_summary && totals && (
                          <div className="text-sm font-medium text-orange-950/90 border-b border-orange-200 pb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>#{coNum}</span>
                            <span className="text-slate-400">|</span>
                            <span>Subtotal: ${(totals.subtotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            <span className="text-slate-400">|</span>
                            <span>Tax: ${(totals.tax ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            <span className="text-slate-400">|</span>
                            <span className="font-bold text-orange-800">
                              TOTAL: ${(totals.grandTotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}
                        {allSections.map((section) => {
                          const showPrice = showPriceForSection(section.id);
                          if (section.type === 'material') {
                            const sheet = section.data;
                            const sheetMaterials = sheet._computedMaterials ?? 0;
                            const sheetLabor = sheet._computedLabor ?? 0;
                            const taxEx = changeOrderQuote
                              ? !!(changeOrderQuote as any)?.tax_exempt
                              : !!(selectedQuote as any)?.tax_exempt;
                            const lineTax = taxEx ? 0 : sheetMaterials * 0.07;
                            const lineGrand = sheetMaterials + sheetLabor + lineTax;
                            const showFinPreview = !!visibilitySettings?.show_financial_summary;
                            const showLinePreview = !!visibilitySettings?.show_line_item_prices;
                            const showSheetBreakdown =
                              showFinPreview && !previewMaterialListNoPrices && sheetMaterials + sheetLabor > 0;
                            const showSheetTotal = showFinPreview && !previewMaterialListNoPrices;
                            return (
                              <div
                                key={sheet.id}
                                className="border border-orange-200 rounded-lg p-4 flex items-start justify-between gap-4 bg-white"
                              >
                                <div className="min-w-0 flex-1">
                                  <h3 className="font-bold text-lg text-orange-950">{sheet.sheet_name}</h3>
                                  {sheet.description && (
                                    <p className="text-sm text-muted-foreground mt-1">
                                      <PortalMultilineText text={sheet.description} />
                                    </p>
                                  )}
                                  {showFinPreview &&
                                    showLinePreview &&
                                    !previewMaterialListNoPrices &&
                                    ((sheet.items || []).length > 0 || (sheet.laborRows || []).length > 0) && (
                                      <PortalSheetPricedLineItems sheet={sheet} variant="changeOrder" />
                                    )}
                                  {previewMaterialListNoPrices && (
                                    <div className="mt-3 rounded-md border border-dashed border-orange-400/60 bg-orange-50/80 px-3 py-2 text-sm flex items-start gap-2">
                                      <ExternalLink className="w-4 h-4 shrink-0 text-orange-900 mt-0.5" />
                                      <div>
                                        <span className="font-medium text-orange-950">Open full material list (new page)</span>
                                        <p className="text-xs text-muted-foreground mt-1">Live portal opens the list in a new tab.</p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {(showSheetBreakdown || showSheetTotal) && (
                                  <div className="w-[120px] flex-shrink-0 text-right">
                                    {showSheetBreakdown && sheetMaterials + sheetLabor > 0 && (
                                      <>
                                        <p className="text-sm text-slate-500">Subtotal</p>
                                        <p className="text-base font-bold text-emerald-800">
                                          $
                                          {(sheetMaterials + sheetLabor).toLocaleString('en-US', {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          })}
                                        </p>
                                      </>
                                    )}
                                    {!taxEx && lineTax > 0 && (
                                      <>
                                        <p
                                          className={`text-sm text-slate-500 ${
                                            showSheetBreakdown && sheetMaterials + sheetLabor > 0 ? 'mt-2' : ''
                                          }`}
                                        >
                                          Tax (est.)
                                        </p>
                                        <p className="text-base font-bold text-slate-700">
                                          ${lineTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </p>
                                      </>
                                    )}
                                    <p
                                      className={`text-[11px] text-slate-500 ${
                                        showSheetBreakdown || (!taxEx && lineTax > 0) ? 'mt-2' : ''
                                      }`}
                                    >
                                      Section total
                                    </p>
                                    <p className="text-sm font-bold text-orange-800">
                                      ${lineGrand.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          }
                          if (section.type === 'custom') {
                            const row = section.data;
                            const total = row._computedTotal ?? 0;
                            const title = row.description || row.category || 'Custom';
                            return (
                              <div key={row.id} className="border border-orange-200 rounded-lg p-4 flex items-start justify-between gap-4 bg-white">
                                <div className="min-w-0 flex-1">
                                  <h3 className="font-bold text-lg">{title}</h3>
                                  {row.notes?.trim() && (
                                    <p className="text-sm text-muted-foreground mt-1">
                                      <PortalMultilineText text={row.notes} />
                                    </p>
                                  )}
                                </div>
                                {showPrice && total > 0 && (
                                  <p className="text-xl font-bold text-orange-700 shrink-0">
                                    ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                )}
                              </div>
                            );
                          }
                          const est = section.data;
                          const total = est._computedTotal ?? 0;
                          return (
                            <div key={est.id} className="border border-orange-200 rounded-lg p-4 flex items-start justify-between gap-4 bg-white">
                              <div className="min-w-0 flex-1">
                                <h3 className="font-bold text-lg">{est.company_name}</h3>
                                {est.scope_of_work && (
                                  <p className="text-sm text-muted-foreground mt-1">{est.scope_of_work}</p>
                                )}
                              </div>
                              {showPrice && total > 0 && (
                                <p className="text-xl font-bold text-orange-700 shrink-0">
                                  ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                              )}
                            </div>
                          );
                        })}
                        {visibilitySettings?.show_financial_summary && (
                          <div className="border-t-2 border-orange-200 pt-4 space-y-2">
                            <div className="flex justify-between text-lg">
                              <span className="font-medium">Subtotal:</span>
                              <span>
                                ${(co.totals?.subtotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="flex justify-between text-lg">
                              <span className="font-medium">Tax (7%):</span>
                              <span>
                                ${(co.totals?.tax ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="flex justify-between text-2xl font-bold pt-2 border-t border-orange-200">
                              <span>Change order total:</span>
                              <span className="text-orange-800">
                                ${(co.totals?.grandTotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {showMaterialsTab && (
            <TabsContent value="materials" className="space-y-6">
              <Card className="border-emerald-200/70">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-emerald-900">
                    <Package className="w-5 h-5" />
                    Material list
                  </CardTitle>
                  <p className="text-sm text-muted-foreground font-normal">
                    Item names, quantities, and usage only — matches the live portal when “Material list (no prices)” is on.
                  </p>
                </CardHeader>
                <CardContent className="space-y-8">
                  {!proposalData ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Load proposal data to preview materials.</p>
                  ) : previewMainMaterialSheets.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No material sheets on this proposal.</p>
                  ) : (
                    <Tabs
                      value={activeMaterialSheetId ?? previewMainMaterialSheets[0]?.id}
                      onValueChange={setActiveMaterialSheetId}
                      className="w-full"
                    >
                      <TabsList
                        className="grid w-full mb-4 h-auto bg-slate-100/90 border border-slate-300 p-0 rounded-md"
                        style={{ gridTemplateColumns: `repeat(${previewMainMaterialSheets.length}, minmax(0, 1fr))` }}
                      >
                        {previewMainMaterialSheets.map((sheet: any, idx: number) => (
                          <TabsTrigger
                            key={sheet.id}
                            value={sheet.id}
                            className={`h-auto min-h-10 px-3 py-2 text-xs sm:text-sm font-semibold text-center leading-snug whitespace-normal break-words rounded-none data-[state=inactive]:text-slate-700 data-[state=active]:bg-white data-[state=active]:text-emerald-900 data-[state=active]:shadow-sm ${
                              idx < previewMainMaterialSheets.length - 1 ? 'border-r border-slate-300' : ''
                            } ${idx === 0 ? 'rounded-l-md' : ''} ${idx === previewMainMaterialSheets.length - 1 ? 'rounded-r-md' : ''}`}
                          >
                            {sheet.sheet_name}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                      {previewMainMaterialSheets.map((sheet: any) => (
                        <TabsContent key={sheet.id} value={sheet.id}>
                          <div className="border rounded-lg p-4 space-y-3 bg-card">
                            <div>
                              <h3 className="font-semibold text-base">{sheet.sheet_name}</h3>
                              {sheet.description?.trim() && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  <PortalMultilineText text={sheet.description} />
                                </p>
                              )}
                            </div>
                            <PortalMaterialItemsTable items={sheet.items} />
                            <p className="text-xs text-muted-foreground">
                              Mirrors workbook grouping and order; pricing hidden.
                            </p>
                          </div>
                        </TabsContent>
                      ))}
                    </Tabs>
                  )}
                </CardContent>
              </Card>

              {previewShowCoMaterials && (
                <Card className="border-orange-200 bg-orange-50/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-orange-950">
                      <ClipboardList className="w-5 h-5" />
                      Change order materials
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {previewPortalCoMaterialSheets.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No material sheets on the change order.</p>
                    ) : (
                      previewPortalCoMaterialSheets.map((sheet: any) => (
                        <div key={sheet.id} className="border border-orange-200 rounded-lg p-4 space-y-3 bg-white">
                          <div>
                            <h3 className="font-semibold text-base text-orange-950">{sheet.sheet_name}</h3>
                            {sheet.description?.trim() && (
                              <p className="text-sm text-muted-foreground mt-1">
                                <PortalMultilineText text={sheet.description} />
                              </p>
                            )}
                          </div>
                          <PortalMaterialItemsTable items={sheet.items} />
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}

          {/* Payments Tab */}
          {visibilitySettings?.show_payments && (
            <TabsContent value="payments">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="w-5 h-5" />
                    Payment History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {payments && payments.length > 0 ? (
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
                          <p className="text-xl font-bold text-green-600">
                            ${parseFloat(payment.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">No payments recorded yet</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* Schedule, Documents, and Photos tabs similarly structured */}
          {visibilitySettings?.show_schedule && (
            <TabsContent value="schedule">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    Project Schedule
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {scheduleEvents && scheduleEvents.length > 0 ? (
                    <div className="space-y-3">
                      {scheduleEvents.map((event: any) => (
                        <div key={event.id} className="flex items-start gap-4 p-4 border rounded-lg">
                          <div className="text-center bg-emerald-50 rounded-lg p-3 min-w-[80px]">
                            <p className="text-sm text-muted-foreground">
                              {new Date(event.event_date).toLocaleDateString('en-US', { month: 'short' })}
                            </p>
                            <p className="text-2xl font-bold text-emerald-700">
                              {new Date(event.event_date).getDate()}
                            </p>
                          </div>
                          <div className="flex-1">
                            <h3 className="font-bold text-lg">{event.title}</h3>
                            {event.description && (
                              <p className="text-muted-foreground mt-1">{event.description}</p>
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
          )}

          {visibilitySettings?.show_documents && (
            <TabsContent value="documents" className="space-y-6">
              {viewerLinks.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ExternalLink className="w-5 h-5" />
                      Drawings & 3D Views
                    </CardTitle>
                    <p className="text-sm text-muted-foreground font-normal">Plans and models shared for this project.</p>
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
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Project Documents
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {documents && documents.length > 0 ? (
                    <div className="space-y-3">
                      {documents.map((doc: any) => (
                        <div key={doc.id} className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="flex items-center gap-3">
                            <FileText className="w-8 h-8 text-emerald-600" />
                            <div>
                              <p className="font-medium">{doc.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {doc.category}
                              </p>
                            </div>
                          </div>
                          <Button variant="outline" size="sm">
                            <Download className="w-4 h-4 mr-2" />
                            Download
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">No documents available</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {visibilitySettings?.show_photos && (
            <TabsContent value="photos">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Image className="w-5 h-5" />
                    Project Photos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {photos && photos.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {photos.map((photo: any) => (
                        <div key={photo.id} className="group relative">
                          <img
                            src={photo.photo_url}
                            alt={photo.caption || 'Project photo'}
                            className="w-full h-48 object-cover rounded-lg cursor-pointer hover:opacity-90 transition"
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
          )}
        </Tabs>
      </div>
    </div>
  );
}
