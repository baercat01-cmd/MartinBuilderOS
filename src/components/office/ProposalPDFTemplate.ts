// PDF Template for Proposal Export

function escapeHtmlBid(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Sell total for one PDF section = materials + labor (matches program section total). */
function pdfSectionLineTotal(section: {
  price?: number;
  materialsPrice?: number;
  laborPrice?: number;
  sectionTotalPrice?: number;
}): number {
  const hasMat = section.materialsPrice != null && !isNaN(Number(section.materialsPrice));
  const hasLab = section.laborPrice != null && !isNaN(Number(section.laborPrice));
  // Prefer explicit split when present so labor is never dropped from the header price.
  if (hasMat || hasLab) {
    return (hasMat ? Number(section.materialsPrice) : 0) + (hasLab ? Number(section.laborPrice) : 0);
  }
  if (section.sectionTotalPrice != null && !isNaN(Number(section.sectionTotalPrice))) {
    return Number(section.sectionTotalPrice);
  }
  return Number(section.price || 0);
}

function renderBidSpecScopeSection(
  section: {
    name: string;
    description: string;
    optional?: boolean;
    items?: Array<{ description: string; quantity?: number; unit?: string }>;
  },
  showQuantities: boolean
): string {
  let qtyBlock = '';
  if (showQuantities && section.items && section.items.length > 0) {
    const rows = section.items
      .map((item) => {
        const qty = item.quantity ?? 1;
        const unit = item.unit ? String(item.unit) : '—';
        return `<tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${item.description}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center; white-space: nowrap;">${qty}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${unit}</td>
        </tr>`;
      })
      .join('');
    qtyBlock = `<table class="items-table" style="margin-top: 8px;"><thead><tr>
      <th style="width: 58%;">Item / scope detail</th>
      <th style="width: 14%; text-align: center;">Qty</th>
      <th style="width: 28%;">Unit / notes</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  }
  return `<div class="section-wrapper">
    <div class="section-title" style="display: block; margin-top: 0;">${section.name}</div>
    ${section.description ? `<div class="section-content">${section.description}</div>` : ''}
    ${qtyBlock}
  </div>`;
}

function buildBidSpecBody(params: {
  proposalNumber: string;
  date: string;
  bidDueDate?: string;
  instructions?: string;
  showQuantities: boolean;
  job: {
    client_name: string;
    address: string;
    name: string;
    customer_phone?: string;
    description?: string;
  };
  sections: Array<{
    name: string;
    description: string;
    optional?: boolean;
    items?: Array<{ description: string; quantity?: number; unit?: string }>;
  }>;
  bodyFontSize: number;
}): string {
  const { proposalNumber, date, bidDueDate, instructions, showQuantities, job, sections, bodyFontSize } = params;

  const requiredSections = sections.filter((s) => !s.optional);
  const optionalSections = sections.filter((s) => s.optional);

  const instructionsBlock =
    instructions && instructions.trim()
      ? `<div class="intro-box" style="margin-top: 14px;">
          <div class="box-header">Instructions to bidders</div>
          <div style="padding: 12px 14px; font-size: ${bodyFontSize}pt; line-height: 1.55;">
            ${escapeHtmlBid(instructions.trim()).replace(/\n/g, '<br/>')}
          </div>
        </div>`
      : '';

  const overviewBlock =
    job.description && String(job.description).trim()
      ? `<div class="intro-box" style="margin-top: 14px;">
          <div class="box-header">Project overview</div>
          <div style="padding: 12px 14px; font-size: ${bodyFontSize}pt; line-height: 1.55; white-space: pre-wrap;">${job.description}</div>
        </div>`
      : '';

  const baseScopeInner =
    requiredSections.length > 0
      ? requiredSections.map((s) => renderBidSpecScopeSection(s, showQuantities)).join('')
      : `<p style="padding: 12px 14px; margin: 0; color: #555; font-size: ${bodyFontSize}pt;">No base-scope sections are defined on this proposal. Add materials sheets or custom rows in Job Financials, or export after building scope.</p>`;

  const optionalBlock =
    optionalSections.length > 0
      ? `<div class="intro-box" style="margin-top: 14px;">
          <div class="box-header">Optional / alternate scope <span style="font-size: 9pt; font-weight: normal;">(bid separately unless noted)</span></div>
          <div style="padding: 12px 14px 14px 14px;">
            ${optionalSections.map((s) => renderBidSpecScopeSection(s, showQuantities)).join('')}
          </div>
        </div>`
      : '';

  const infoTableRows = bidDueDate
    ? `<tr><th>Date issued</th><th>Reference #</th><th>Bid due</th></tr>
       <tr><td>${date}</td><td>${proposalNumber}</td><td>${escapeHtmlBid(bidDueDate)}</td></tr>`
    : `<tr><th>Date issued</th><th>Reference #</th></tr>
       <tr><td>${date}</td><td>${proposalNumber}</td></tr>`;

  return `
        <header style="border-bottom: 2px solid #111; padding-bottom: 14px; margin-bottom: 18px;">
          <p style="margin: 0 0 6px 0; font-size: ${Math.max(bodyFontSize - 1, 9)}pt; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #444;">
            Bid specification
          </p>
          <h1 style="margin: 0; font-size: 22pt; font-weight: 700; line-height: 1.2; color: #0a0a0a;">
            ${job.name}
          </h1>
        </header>

        <div class="intro-box" style="margin-top: 0; margin-bottom: 16px;">
          <div class="box-header">Job information</div>
          <div style="padding: 12px 14px; font-size: ${bodyFontSize}pt; line-height: 1.55;">
            <p style="margin: 0 0 10px 0;">
              <strong style="display: block; font-size: ${Math.max(bodyFontSize - 1, 9)}pt; color: #333; margin-bottom: 2px;">Site address</strong>
              ${job.address || '—'}
            </p>
            <p style="margin: 0 0 10px 0;">
              <strong style="display: block; font-size: ${Math.max(bodyFontSize - 1, 9)}pt; color: #333; margin-bottom: 2px;">Customer / owner</strong>
              ${job.client_name || '—'}
            </p>
            <p style="margin: 0;">
              <strong style="display: block; font-size: ${Math.max(bodyFontSize - 1, 9)}pt; color: #333; margin-bottom: 2px;">Phone</strong>
              ${job.customer_phone || '—'}
            </p>
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <table class="proposal-info-table" style="margin-left: 0;">${infoTableRows}</table>
        </div>

        <p style="margin: 0 0 18px 0; font-size: ${bodyFontSize}pt; line-height: 1.5; color: #333;">
          Scope and quantities for estimating only. <strong>No pricing</strong> appears in this document.
        </p>

        ${overviewBlock}
        ${instructionsBlock}

        <div class="intro-box" style="margin-top: 14px;">
          <div class="box-header">Base bid scope</div>
          <div style="padding: 4px 14px 14px 14px;">${baseScopeInner}</div>
        </div>

        ${optionalBlock}

        <div style="margin-top: 22px; padding: 14px; border: 1px solid #94a3b8; background: #f8fafc; font-size: ${Math.max(bodyFontSize - 1, 9)}pt; line-height: 1.5; color: #334155;">
          <p style="margin: 0 0 8px 0;"><strong>Submission &amp; attachments</strong></p>
          <p style="margin: 0;">Pricing is intentionally omitted. Use attached drawings, portal documents, and site visits as applicable. Submit bids and questions per your invitation from the general contractor.</p>
        </div>
      `;
}

export function generateProposalHTML(data: {
  proposalNumber: string;
  date: string;
  job: {
    client_name: string;
    address: string;
    name: string;
    customer_phone?: string;
    description?: string;
  };
  sections: Array<{
    name: string;
    description: string;
    price?: number;
    /** Materials sell total for this section (program Materials column). */
    materialsPrice?: number;
    /** Labor sell total for this section (program Labor column). */
    laborPrice?: number;
    /** materialsPrice + laborPrice — preferred section header amount. */
    sectionTotalPrice?: number;
    optional?: boolean;
    comparisonData?: {
      baseName: string;
      optionName: string;
      baseMaterialsPrice: number;
      optionMaterialsPrice: number;
      baseLaborPrice: number;
      optionLaborPrice: number;
      baseTotal: number;
      optionTotal: number;
      categoryRows: Array<{ name: string; basePrice: number; optionPrice: number }>;
    };
    items?: Array<{ description: string; price?: number; quantity?: number; unit?: string }>;
  }>;
  totals: {
    materials: number;
    labor: number;
    subtotal: number;
    tax: number;
    grandTotal: number;
  };
  showLineItems: boolean;
  showSectionPrices?: boolean;
  showInternalDetails?: boolean;
  /** Scope text only: section titles + descriptions. No customer/job info, pricing, totals, payment, signatures, or terms. */
  descriptionsOnly?: boolean;
  /** Subcontractor-facing bid package: job + scope + optional quantities; no pricing, terms, or signatures. */
  bidSpec?: {
    bidDueDate?: string;
    instructions?: string;
    showQuantities?: boolean;
  };
  templateSettings?: any; // Template customization settings
  theme?: 'default' | 'premium'; // premium = dark green + gold modern look
  taxExempt?: boolean; // when true, show "Tax Exempt" on printout and tax amount is 0
  /** estimate = rough pricing wording & labels; proposal = formal building quote (sections data is the same). */
  documentKind?: 'proposal' | 'estimate';
}): string {
  const {
    proposalNumber,
    date,
    job,
    sections,
    totals,
    showLineItems,
    showSectionPrices = false,
    showInternalDetails = false,
    descriptionsOnly = false,
    bidSpec,
    templateSettings,
    theme = 'default',
    taxExempt = false,
    documentKind = 'proposal',
  } = data;
  const isPremium = theme === 'premium';
  const isEstimate = documentKind === 'estimate';
  const docTitle = isEstimate ? 'Estimate' : 'Proposal';

  // Apply template settings or use defaults
  const t = templateSettings || {};
  const pageMarginTop = t.page_margin_top ?? 0.75;
  const pageMarginBottom = t.page_margin_bottom ?? 2;
  const pageMarginLeft = t.page_margin_left ?? 0.5;
  const pageMarginRight = t.page_margin_right ?? 0.5;
  const bodyPaddingTop = t.body_padding_top ?? 50;
  const bodyPaddingBottom = t.body_padding_bottom ?? 60;
  const bodyPaddingLeft = t.body_padding_left ?? 30;
  const bodyPaddingRight = t.body_padding_right ?? 30;
  const bodyFontSize = t.body_font_size ?? 11;
  const bodyLineHeight = t.body_line_height ?? 1.3;
  const sectionMarginTop = t.section_margin_top ?? 6;
  const sectionMarginBottom = t.section_margin_bottom ?? 3;
  const sectionPaddingBottom = t.section_padding_bottom ?? 2;
  const sectionMinHeight = t.section_min_height ?? 40;
  const proposalTitleSize = t.proposal_title_size ?? 32;
  const sectionTitleSize = t.section_title_size ?? 12;
  const defaultProposalIntro =
    'We hereby submit specifications and estimates for: Thanks for requesting a Martin Builder building quotation. We propose to furnish material, labor and equipment as described below:';
  const defaultEstimateIntro =
    'The sections and descriptions below use the same structure as our formal building proposals. Dollar amounts are rough estimated pricing for planning and discussion only—not a detailed quote or construction contract. A formal proposal is prepared for building.';
  const introText = isEstimate
    ? (t.estimate_intro_text ?? defaultEstimateIntro)
    : (t.intro_text ?? defaultProposalIntro);
  const hasOptionalSections =
    !bidSpec && !descriptionsOnly && sections.some((s: any) => s.optional);
  const pdfOptionalSubtotal = hasOptionalSections
    ? sections.filter((s: any) => s.optional).reduce((acc, s) => acc + pdfSectionLineTotal(s), 0)
    : 0;
  const showPdfOptionalPricing =
    hasOptionalSections &&
    (showInternalDetails ||
      showSectionPrices ||
      sections.some((s: any) => pdfSectionLineTotal(s) > 0.005));
  // Contract Subtotal / Tax / Grand Total always match the program (base scope).
  // Optional section dollars may be listed separately but never inflate those totals.
  const pdfContractSubtotal = Number(totals.subtotal) || 0;
  const pdfContractGrandTotal = Number(totals.grandTotal) || 0;
  const paymentText = t.payment_text ?? 'Payment to be made as follows: 20% Down, 60% COD, 20% Final';
  const defaultAcceptanceProposal =
    'The above prices, specifications and conditions are satisfactory and are hereby accepted. You are authorized to do the work as specified. Payment will be made as outlined above.';
  const defaultAcceptanceEstimate =
    'The customer acknowledges receipt of this preliminary estimate. It is for budgeting and discussion only and does not authorize construction; a formal proposal and agreement will follow.';
  const acceptanceText = isEstimate
    ? (t.estimate_acceptance_text ?? defaultAcceptanceEstimate)
    : (t.acceptance_text ?? defaultAcceptanceProposal);
  const companyName = t.company_name ?? 'Martin Builder';
  const companyAddress1 = t.company_address_1 ?? '27608-A CR 36';
  const companyAddress2 = t.company_address_2 ?? 'Goshen, IN 46526';
  const companyPhone = t.company_phone ?? '574-862-4448';
  const companyFax = t.company_fax ?? '574-862-1548';
  const companyEmail = t.company_email ?? 'office@martinbuilder.net';
  const companyLogoUrl = t.company_logo_url ?? 'https://cdn-ai.onspace.ai/onspace/files/4ZzeFr2RKnB7oAxZwNpsZR/MB_Logo_Green_192x64_12.9kb.png';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>${bidSpec ? 'Bid-spec' : docTitle}-${proposalNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: Arial, sans-serif;
            line-height: ${bodyLineHeight};
            color: #000;
            max-width: 940px;
            margin: 0 auto;
            padding: ${bodyPaddingTop}px ${bodyPaddingRight}px ${bodyPaddingBottom}px ${bodyPaddingLeft}px;
            font-size: ${bodyFontSize}pt;
          }
          ${isPremium ? `
          /* Premium theme: dark green + gold */
          body.theme-premium { color: #1a1a1a; }
          .theme-premium .proposal-title { color: #1a3d2e; font-size: 28pt; letter-spacing: 0.02em; }
          .theme-premium .proposal-info-table { border: 2px solid #1a3d2e; }
          .theme-premium .proposal-info-table th { background: #1a3d2e; color: #fff; border-color: #1a3d2e; padding: 10px 18px; }
          .theme-premium .proposal-info-table td { border-color: #2d5a45; color: #1a1a1a; }
          .theme-premium .info-box { border: 1px solid #2d5a45; }
          .theme-premium .box-header { background: #1a3d2e; color: #f5e6c8; border-bottom-color: #1a3d2e; padding: 8px 12px; font-weight: 600; }
          .theme-premium .intro-box { border: 2px solid #2d5a45; }
          .theme-premium .intro-box .box-header { background: linear-gradient(135deg, #1a3d2e 0%, #2d5a45 100%); color: #f5e6c8; }
          .theme-premium .section-title span:first-child { color: #1a3d2e; }
          .theme-premium .section-price { color: #b8860b; font-weight: 700; }
          .theme-premium .section-content { color: #333; }
          .theme-premium .items-table { border-color: #2d5a45; }
          .theme-premium .items-table thead tr { background: #1a3d2e; border-bottom-color: #1a3d2e; }
          .theme-premium .items-table th { color: #f5e6c8; }
          .theme-premium .items-table .total-row { border-top-color: #b8860b; background: #faf8f3; }
          .theme-premium .items-table .total-row td { color: #1a3d2e; font-weight: 700; }
          .theme-premium .terms-header { border-bottom-color: #1a3d2e; }
          .theme-premium .terms-title { color: #1a3d2e; }
          .theme-premium .terms-section-title { color: #1a3d2e; }
          .theme-premium .print-header { color: #1a3d2e; }
          .theme-premium .grand-total-amount { color: #b8860b; font-weight: 700; }
          .theme-premium .summary-table-total { border-top: 2px solid #b8860b; }
          /* Premium: header/footer with triangular twist (3 colors: dark green, gold, cream) */
          .premium-header-wrapper {
            margin: -${bodyPaddingTop}px -${bodyPaddingRight}px 0 -${bodyPaddingLeft}px;
            overflow: hidden;
          }
          .premium-header-twist {
            height: 12px;
            background: linear-gradient(115deg,
              #1a3d2e 0%, #1a3d2e 28%,
              #b8860b 28%, #b8860b 56%,
              #f5e6c8 56%, #f5e6c8 84%,
              #1a3d2e 84%, #1a3d2e 100%);
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .premium-header {
            background: #1a3d2e;
            color: #f5e6c8;
            padding: 14px ${bodyPaddingLeft}px 14px ${bodyPaddingRight}px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 12px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .premium-header-brand { display: flex; flex-direction: column; gap: 4px; }
          .premium-header-company { font-size: 18pt; font-weight: 700; color: #f5e6c8; letter-spacing: 0.02em; }
          .premium-header-contact { font-size: ${bodyFontSize - 1}pt; color: #f5e6c8; line-height: 1.4; opacity: 0.95; }
          .premium-header-logo-wrap { display: flex; align-items: center; }
          .premium-header-logo { height: 48px; width: auto; max-width: 180px; object-fit: contain; }
          .premium-header-accent { height: 4px; background: linear-gradient(90deg, #1a3d2e, #b8860b 50%, #1a3d2e); margin: 0 -${bodyPaddingRight}px 20px -${bodyPaddingLeft}px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .premium-footer-twist {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: 12px;
            background: linear-gradient(245deg,
              #1a3d2e 0%, #1a3d2e 28%,
              #b8860b 28%, #b8860b 56%,
              #f5e6c8 56%, #f5e6c8 84%,
              #1a3d2e 84%, #1a3d2e 100%);
            z-index: 9998;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .premium-footer {
            position: fixed;
            bottom: 12px;
            left: 0;
            right: 0;
            height: 6px;
            background: #1a3d2e;
            z-index: 9997;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .theme-premium .header-row .logo-section { display: none; }
          .theme-premium .header-row { margin-bottom: 10px; }
          .theme-premium .proposal-header { margin-left: 0; }
          ` : ''}
          
          .header-row { 
            display: flex; 
            justify-content: space-between; 
            align-items: flex-start; 
            margin-bottom: 15px;
          }
          
          .logo-section { flex: 1; }
          
          .company-logo { 
            width: 192px; 
            height: auto; 
            margin-bottom: 10px; 
          }
          
          .company-address { font-size: ${bodyFontSize}pt; margin-bottom: 3px; }
          .company-contact { font-size: ${bodyFontSize - 1}pt; margin-bottom: 2px; }
          
          .proposal-header { text-align: right; }
          .proposal-title { font-size: ${proposalTitleSize}pt; font-weight: bold; margin-bottom: 5px; }
          
          .proposal-info-table { 
            border: 1px solid #000; 
            border-collapse: collapse; 
            margin-left: auto; 
          }
          
          .proposal-info-table th, 
          .proposal-info-table td { 
            border: 1px solid #000; 
            padding: 8px 15px; 
            text-align: center; 
            font-size: ${bodyFontSize}pt;
          }
          
          .proposal-info-table th { font-weight: bold; }
          
          .customer-section { margin: 15px 0; }
          
          .info-box { 
            border: 1px solid #000; 
            padding: 10px; 
            margin-bottom: 10px; 
          }
          
          .box-header { 
            background: #f0f0f0; 
            border-bottom: 1px solid #000; 
            padding: 5px 10px; 
            margin: -10px -10px 10px -10px; 
            font-weight: bold; 
          }
          
          .customer-row { display: flex; gap: 10px; }
          .customer-left { flex: 1; }
          .customer-right { width: 300px; }
          
          .intro-box { 
            border: 2px solid #000; 
            padding: 0;
            margin: 15px 0; 
          }
          
          .section-title { 
            font-weight: bold; 
            font-size: ${sectionTitleSize}pt;
            margin-top: ${sectionMarginTop}px; 
            margin-bottom: ${sectionMarginBottom}px;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            /* Pin title to its description — never orphan the heading at page bottom */
            page-break-after: avoid;
            break-after: avoid;
          }
          
          .section-wrapper:first-child .section-title {
            margin-top: 0;
          }
          
          .section-content { 
            margin-left: 0; 
            margin-bottom: 8px; 
            white-space: pre-wrap;
            line-height: 1.5;
            color: #333;
            /* Allow long descriptions to continue on the next page */
            page-break-before: avoid;
            break-before: avoid;
          }
          
          .section-wrapper {
            margin-bottom: 4px;
            min-height: ${sectionMinHeight}px;
            padding-bottom: ${sectionPaddingBottom}px;
            /* Push the whole section to the next page rather than splitting it.
               display:table is a widely-supported trick to make break-inside: avoid
               reliable in Chrome even inside flex/block containers. */
            display: table;
            width: 100%;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          
          .section-price {
            font-weight: bold;
            color: #000;
            margin-left: 20px;
          }

          .items-table {
            width: 100%;
            margin: 10px 0;
            border-collapse: collapse;
            font-size: 9.5pt;
            border: 1px solid #ddd;
          }

          .items-table thead tr {
            border-bottom: 2px solid #333;
            background: #e8f4e8;
          }

          .items-table th {
            text-align: left;
            padding: 10px 8px;
            font-weight: bold;
            color: #2d5f3f;
            font-size: 9pt;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .items-table tbody tr {
            border-bottom: 1px solid #e0e0e0;
          }

          .items-table tbody tr:hover {
            background: #f9f9f9;
          }

          .items-table td {
            padding: 8px;
            vertical-align: top;
          }

          .items-table .total-row {
            border-top: 3px double #2d5f3f;
            font-weight: bold;
            background: #e8f4e8;
          }

          .items-table .total-row td {
            padding: 12px 8px;
          }
          
          .footer { margin-top: 30px; font-size: 9pt; }
          .signature-section { margin-top: 20px; }
          .proposal-number-signing-page {
            margin-top: 32px;
            text-align: right;
            font-size: 9pt;
            color: #555;
            font-weight: 600;
            font-family: Arial, sans-serif;
          }
          .signature-line { 
            border-top: 1px solid #000; 
            width: 250px; 
            margin-top: 30px; 
          }
          
          /* Terms and Conditions Page — named page so @page can suppress the running header */
          .terms-page {
            page-break-before: always;
            padding-top: 40px;
          }
          
          .terms-header {
            text-align: center;
            margin-bottom: 25px;
            border-bottom: 2px solid #2d5f3f;
            padding-bottom: 15px;
          }
          
          .terms-title {
            font-size: 20pt;
            font-weight: bold;
            color: #2d5f3f;
            margin-bottom: 15px;
          }
          
          .terms-reference {
            font-size: 10pt;
            color: #666;
            margin-bottom: 3px;
          }
          
          .terms-content {
            font-size: 10pt;
            line-height: 1.6;
            color: #333;
          }
          
          .terms-section {
            margin-bottom: 15px;
          }
          
          .terms-section-title {
            font-weight: bold;
            color: #2d5f3f;
            margin-bottom: 6px;
            font-size: 10pt;
          }
          
          .terms-section-text {
            margin-left: 0;
            text-align: justify;
          }
          
          .terms-signature-section {
            margin-top: 30px;
          }
          
          .terms-signature-intro {
            margin-bottom: 25px;
            font-size: 10pt;
            font-weight: 600;
          }
          
          .terms-signature-line {
            border-top: 1px solid #333;
            width: 300px;
            margin-top: 40px;
          }
          
          .terms-signature-row {
            display: flex;
            justify-content: space-between;
            margin-top: 35px;
          }
          
          .terms-signature-block {
            width: 45%;
          }
          
          .terms-signature-label {
            font-size: 10pt;
            margin-bottom: 5px;
            font-weight: 600;
          }
          
          table { width: 100%; }

          @page {
            margin: ${pageMarginTop}in ${pageMarginRight}in ${pageMarginBottom}in ${pageMarginLeft}in;
            size: letter;
          }

          /* Keep hereby text + subtotal + tax + grand total on same page; if no room, move block to next page */
          .financial-summary-block {
            page-break-inside: avoid;
            break-inside: avoid;
            margin-top: 32px;
          }
          
          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .premium-footer, .premium-footer-twist { display: block !important; position: fixed !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .premium-footer-twist { bottom: 0 !important; }
            .premium-footer { bottom: 12px !important; }
          }
          
        </style>
      </head>
      <body class="${bidSpec ? '' : isPremium ? 'theme-premium' : ''}">
        ${
          bidSpec
            ? buildBidSpecBody({
                proposalNumber,
                date,
                bidDueDate: bidSpec.bidDueDate,
                instructions: bidSpec.instructions,
                showQuantities: bidSpec.showQuantities !== false,
                job,
                sections,
                bodyFontSize,
              })
            : descriptionsOnly
            ? sections
                .map((section: any) => {
                  const optSuffix = section.optional
                    ? ' <span style="font-weight: 400; font-size: 10pt; color: #666;">(Optional)</span>'
                    : '';
                  return `<div class="section-wrapper" style="display: block; width: 100%; page-break-inside: avoid; margin-bottom: 16px;">
            <div class="section-title" style="display: block; margin-top: 0;">${section.name}${optSuffix}</div>
            ${section.description ? `<div class="section-content">${section.description}</div>` : ''}
          </div>`;
                })
                .join('')
            : `
        ${isPremium ? `
        <!-- Premium theme: header with triangular twist (green, gold, cream) and clear structure -->
        <div class="premium-header-wrapper">
          <div class="premium-header-twist" aria-hidden="true"></div>
          <div class="premium-header">
            <div class="premium-header-brand">
              <span class="premium-header-company">${companyName.toUpperCase()}</span>
              <div class="premium-header-contact">
                Office: ${companyPhone} | Fax: ${companyFax}<br/>${companyEmail}
              </div>
            </div>
            <div class="premium-header-logo-wrap">
              <img src="${companyLogoUrl}" alt="${companyName}" class="premium-header-logo" />
            </div>
          </div>
          <div class="premium-header-accent" aria-hidden="true"></div>
        </div>
        ` : ''}
        ${isPremium ? '<div class="premium-footer" aria-hidden="true"></div><div class="premium-footer-twist" aria-hidden="true"></div>' : ''}

        <!-- Main Content -->
        <div class="header-row">
          <div class="logo-section">
            <img src="${companyLogoUrl}" alt="${companyName}" class="company-logo" />
            <div class="company-address">${companyAddress1}, ${companyAddress2}</div>
            <div class="company-contact">Phone: ${companyPhone}</div>
            <div class="company-contact">Email: ${companyEmail}</div>
          </div>
          
          <div class="proposal-header">
            <div class="proposal-title">${docTitle}</div>
            <table class="proposal-info-table">
              <tr>
                <th>Date</th>
                <th>${isEstimate ? 'Estimate #' : 'Proposal #'}</th>
              </tr>
              <tr>
                <td>${date}</td>
                <td>${proposalNumber}</td>
              </tr>
            </table>
          </div>
        </div>

        ${
          isEstimate
            ? `<div style="margin: 14px 0; padding: 12px 14px; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 6px; font-size: ${bodyFontSize}pt; line-height: 1.55; color: #78350f;">
            <strong>Preliminary estimate.</strong> Section titles and scope descriptions follow the same layout as a formal proposal. Dollar totals are <strong>rough pricing</strong> for planning only—not shop drawings, takeoffs, or a construction contract.
          </div>`
            : ''
        }
        
        <div class="customer-section">
          <div class="customer-row">
            <div class="customer-left">
              <div class="info-box">
                <div class="box-header">Name / Address</div>
                <div>${job.client_name}</div>
                <div>${job.address}</div>
                <div style="margin-top: 8px;">${job.customer_phone || 'N/A'}</div>
              </div>
            </div>
            
            <div class="customer-right">
              <div class="info-box">
                <div class="box-header">Project</div>
                <div>${job.name}</div>
              </div>
            </div>
          </div>
        </div>
        
        <p style="margin: 20px 0; font-size: ${bodyFontSize}pt; line-height: 1.6;">
          ${introText}
        </p>
        
        <div class="intro-box" style="margin-top: 10px;">
          <div class="box-header">Work to be Completed</div>
          <div style="padding: 6px 10px 10px 10px;">
            ${sections.filter((s: any) => !s.optional).map((section: any, sectionIndex: number) => {
              const isFirstSection = sectionIndex === 0;
              const sectionTitleMargin = isFirstSection ? '0' : '8px';
              let content = '<div class="section-wrapper">';
              // Required header = Materials + Labor (same as program section total). Hide when $0.
              const sectionTotalDisplay = pdfSectionLineTotal(section);
              const showPrice = sectionTotalDisplay > 0.005;
              
              if (showInternalDetails) {
                content += '<div class="section-title" style="margin-top: ' + sectionTitleMargin + ';">';
                content += '<span style="font-weight: bold; font-size: ' + (sectionTitleSize + 1) + 'pt;">' + section.name + '</span>';
                if (showPrice) {
                  content += '<span class="section-price" style="font-weight: bold; font-size: ' + (sectionTitleSize + 1) + 'pt;">$' + sectionTotalDisplay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</span>';
                }
                content += '</div>';
                
                if (section.description) {
                  content += '<div class="section-content" style="margin: 6px 0 8px 0; padding: 10px; background: #f9f9f9; border-left: 3px solid #2d5f3f;">' + section.description + '</div>';
                }
                
                if (section.items && section.items.length > 0) {
                  content += '<div style="margin: 10px 0 20px 0;">';
                  content += '<p style="font-size: 10pt; font-weight: 600; color: #666; margin-bottom: 8px;">LINE ITEM BREAKDOWN:</p>';
                  content += '<table class="items-table"><thead><tr>';
                  content += '<th style="width: 45%;">Item Description</th>';
                  content += '<th style="width: 15%; text-align: center;">Quantity</th>';
                  content += '<th style="width: 20%; text-align: right;">Unit Price</th>';
                  content += '<th style="width: 20%; text-align: right;">Total Price</th>';
                  content += '</tr></thead><tbody>';
                  
                  section.items.forEach((item: any) => {
                    const qty = item.quantity || 1;
                    const totalPrice = item.price || 0;
                    const unitPrice = qty > 0 ? totalPrice / qty : totalPrice;
                    content += '<tr>';
                    content += '<td style="padding: 8px;">' + item.description + '</td>';
                    content += '<td style="text-align: center; padding: 8px;">' + qty + (item.unit ? ' ' + item.unit : '') + '</td>';
                    content += '<td style="text-align: right; padding: 8px;">$' + unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>';
                    content += '<td style="text-align: right; padding: 8px; font-weight: 600;">$' + totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>';
                    content += '</tr>';
                  });
                  
                  content += '<tr class="total-row">';
                  content += '<td colspan="3" style="text-align: right; font-weight: bold; padding: 10px 8px; background: #f0f0f0;">Section Total:</td>';
                  content += '<td style="text-align: right; font-weight: bold; padding: 10px 8px; background: #f0f0f0; font-size: ' + bodyFontSize + 'pt;">$' + sectionTotalDisplay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>';
                  content += '</tr>';
                  content += '</tbody></table>';
                  content += '</div>';
                }
              } else {
                if (showSectionPrices && showPrice) {
                  content += '<div class="section-title" style="margin-top: ' + sectionTitleMargin + ';">';
                  content += '<span>' + section.name + '</span>';
                  content += '<span class="section-price">$' + sectionTotalDisplay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</span>';
                  content += '</div>';
                } else {
                  content += '<div class="section-title" style="display: block; margin-top: ' + sectionTitleMargin + ';">' + section.name + '</div>';
                }
                
                if (section.description) {
                  content += '<div class="section-content">' + section.description + '</div>';
                }
              }
              
              content += '</div>';
              return content;
            }).join('')}
          </div>
        </div>

        ${
          hasOptionalSections && showPdfOptionalPricing
            ? `<div style="margin-top: 12px; padding: 10px 14px; border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <strong style="font-size: ${bodyFontSize}pt;">Subtotal (base scope — excludes optional items)</strong>
            <strong style="font-size: ${bodyFontSize}pt;">$${(Number(totals.subtotal) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>`
            : ''
        }

        ${sections.some((s: any) => s.optional) ? `
        <div class="intro-box" style="margin-top: 10px;">
          <div class="box-header">Optional items <span style="font-size: 9pt; font-weight: normal;">${isEstimate ? '(not included in estimated total above)' : '(not included in base contract total above)'}</span></div>
          <div style="padding: 15px 10px 10px 10px;">
            ${sections.filter((s: any) => s.optional).map((section: any, sectionIndex: number) => {
              const isFirstSection = sectionIndex === 0;
              const sectionTitleMargin = isFirstSection ? '0' : '8px';
              let content = '<div class="section-wrapper">';
              
              if (showInternalDetails) {
                const optTot = pdfSectionLineTotal(section);
                content += '<div class="section-title" style="margin-top: ' + sectionTitleMargin + ';">';
                content += '<span style="font-weight: bold; font-size: ' + (sectionTitleSize + 1) + 'pt;">' + section.name + '</span>';
                if (optTot > 0.005) {
                  content +=
                    '<span class="section-price" style="font-weight: bold; font-size: ' +
                    (sectionTitleSize + 1) +
                    'pt;">$' +
                    optTot.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
                    '</span>';
                }
                content += '</div>';

                if (section.description) {
                  content += '<div class="section-content" style="margin: 6px 0 8px 0; padding: 10px; background: #f9f9f9; border-left: 3px solid #2d5f3f;">' + section.description + '</div>';
                }
                
                if (section.items && section.items.length > 0) {
                  content += '<div style="margin: 10px 0 20px 0;">';
                  content += '<p style="font-size: 10pt; font-weight: 600; color: #666; margin-bottom: 8px;">LINE ITEM BREAKDOWN:</p>';
                  content += '<table class="items-table"><thead><tr>';
                  content += '<th style="width: 45%;">Item Description</th>';
                  content += '<th style="width: 15%; text-align: center;">Quantity</th>';
                  content += '<th style="width: 20%; text-align: right;">Unit Price</th>';
                  content += '<th style="width: 20%; text-align: right;">Total Price</th>';
                  content += '</tr></thead><tbody>';
                  
                  section.items.forEach((item: any) => {
                    const qty = item.quantity || 1;
                    const totalPrice = item.price || 0;
                    const unitPrice = qty > 0 ? totalPrice / qty : totalPrice;
                    content += '<tr>';
                    content += '<td style="padding: 8px;">' + item.description + '</td>';
                    content += '<td style="text-align: center; padding: 8px;">' + qty + (item.unit ? ' ' + item.unit : '') + '</td>';
                    content += '<td style="text-align: right; padding: 8px;">$' + unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>';
                    content += '<td style="text-align: right; padding: 8px; font-weight: 600;">$' + totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>';
                    content += '</tr>';
                  });
                  
                  content += '<tr class="total-row">';
                  content += '<td colspan="3" style="text-align: right; font-weight: bold; padding: 10px 8px; background: #f0f0f0;">Section Total:</td>';
                  content +=
                    '<td style="text-align: right; font-weight: bold; padding: 10px 8px; background: #f0f0f0; font-size: ' +
                    bodyFontSize +
                    'pt;">$' +
                    (optTot > 0 ? optTot : section.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
                    '</td>';
                  content += '</tr>';
                  content += '</tbody></table>';
                  content += '</div>';
                }
              } else {
                const tot = pdfSectionLineTotal(section);
                const optShowCustomerPricing = tot > 0.005;

                if (optShowCustomerPricing) {
                  content += '<div class="section-title" style="margin-top: ' + sectionTitleMargin + '; display: flex; justify-content: space-between; align-items: baseline; gap: 8px;">';
                  content += '<span>' + section.name + '</span>';
                  content +=
                    '<span class="section-price">$' +
                    tot.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
                    '</span>';
                  content += '</div>';
                } else {
                  content += '<div class="section-title" style="display: block; margin-top: ' + sectionTitleMargin + ';">' + section.name + '</div>';
                }
                
                if (section.description) {
                  content += '<div class="section-content">' + section.description + '</div>';
                }
              }

              // Comparison table (optional sections with a base section linked)
              if (section.comparisonData) {
                const cd = section.comparisonData;
                const diff = cd.optionTotal - cd.baseTotal;
                const diffStr = (diff > 0 ? '+' : '') + '$' + Math.abs(diff).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (diff > 0 ? ' more' : diff < 0 ? ' less' : ' same');
                const diffColor = diff > 0 ? '#dc2626' : diff < 0 ? '#16a34a' : '#64748b';
                content += '<div style="margin: 10px 0 6px 0; border: 1px solid #bfdbfe; border-radius: 6px; overflow: hidden;">';
                content += '<div style="background: #eff6ff; padding: 6px 10px; font-weight: 700; font-size: 9pt; color: #1e40af; border-bottom: 1px solid #bfdbfe;">Price Comparison</div>';
                content += '<table style="width:100%; border-collapse:collapse; font-size:9pt;">';
                content += '<thead><tr style="border-bottom:1px solid #e2e8f0;">';
                content += '<th style="text-align:left; padding:5px 8px; color:#64748b; font-weight:600; width:35%;"></th>';
                content += '<th style="text-align:right; padding:5px 8px; color:#1e40af; font-weight:700;">' + cd.baseName + ' <span style="font-size:8pt; font-weight:normal;">(included)</span></th>';
                content += '<th style="text-align:right; padding:5px 8px; color:#1d4ed8; font-weight:700;">' + cd.optionName + ' <span style="font-size:8pt; font-weight:normal;">(option)</span></th>';
                content += '<th style="text-align:right; padding:5px 8px; color:#64748b; font-weight:600;">Difference</th>';
                content += '</tr></thead><tbody>';
                cd.categoryRows.forEach((row: any) => {
                  const rowDiff = row.optionPrice - row.basePrice;
                  const rowDiffColor = rowDiff > 0 ? '#dc2626' : rowDiff < 0 ? '#16a34a' : '#94a3b8';
                  content += '<tr style="border-bottom:1px solid #f1f5f9;">';
                  content += '<td style="padding:4px 8px; color:#475569;">' + row.name + '</td>';
                  content += '<td style="text-align:right; padding:4px 8px; color:#1e3a8a;">' + (row.basePrice > 0 ? '$' + row.basePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—') + '</td>';
                  content += '<td style="text-align:right; padding:4px 8px; color:#1e40af;">' + (row.optionPrice > 0 ? '$' + row.optionPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—') + '</td>';
                  content += '<td style="text-align:right; padding:4px 8px; font-weight:600; color:' + rowDiffColor + ';">' + (rowDiff !== 0 ? (rowDiff > 0 ? '+' : '') + '$' + Math.abs(rowDiff).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—') + '</td>';
                  content += '</tr>';
                });
                if (cd.baseLaborPrice > 0 || cd.optionLaborPrice > 0) {
                  const laborDiff = cd.optionLaborPrice - cd.baseLaborPrice;
                  content += '<tr style="border-bottom:1px solid #e2e8f0;">';
                  content += '<td style="padding:4px 8px; color:#475569;">Labor</td>';
                  content += '<td style="text-align:right; padding:4px 8px; color:#1e3a8a;">' + (cd.baseLaborPrice > 0 ? '$' + cd.baseLaborPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—') + '</td>';
                  content += '<td style="text-align:right; padding:4px 8px; color:#1e40af;">' + (cd.optionLaborPrice > 0 ? '$' + cd.optionLaborPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—') + '</td>';
                  content += '<td style="text-align:right; padding:4px 8px; font-weight:600; color:' + (laborDiff > 0 ? '#dc2626' : laborDiff < 0 ? '#16a34a' : '#94a3b8') + ';">' + (laborDiff !== 0 ? (laborDiff > 0 ? '+' : '') + '$' + Math.abs(laborDiff).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—') + '</td>';
                  content += '</tr>';
                }
                content += '<tr style="background:#eff6ff;">';
                content += '<td style="padding:6px 8px; font-weight:700; color:#1e293b;">Total</td>';
                content += '<td style="text-align:right; padding:6px 8px; font-weight:700; color:#1e40af; font-size:10pt;">$' + cd.baseTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>';
                content += '<td style="text-align:right; padding:6px 8px; font-weight:700; color:#1d4ed8; font-size:10pt;">$' + cd.optionTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>';
                content += '<td style="text-align:right; padding:6px 8px; font-weight:700; font-size:10pt; color:' + diffColor + ';">' + diffStr + '</td>';
                content += '</tr>';
                content += '</tbody></table>';
                content += '</div>';
              }
              
              content += '</div>';
              return content;
            }).join('')}
            ${
              hasOptionalSections && showPdfOptionalPricing
                ? `<div style="margin-top: 14px; padding: 10px 14px; border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <strong style="font-size: ${bodyFontSize}pt;">Subtotal (optional items only)</strong>
            <strong style="font-size: ${bodyFontSize}pt;">$${pdfOptionalSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>`
                : ''
            }
          </div>
        </div>
        ` : ''}
        
        ${showInternalDetails ? `
          <!-- Office View - Summary Only (kept together on same page) -->
          <div class="financial-summary-block" style="margin-top: 30px; padding: 20px; background: #f5f5f5; border: 2px solid #333; border-radius: 8px;">
            <h3 style="margin: 0 0 15px 0; font-size: 14pt;">${docTitle} Summary - Office View</h3>
            <table style="width: 100%;">
              ${totals.materials > 0 ? `
                <tr>
                  <td style="text-align: right; padding: 5px;"><strong>Materials & Subcontractors:</strong></td>
                  <td style="text-align: right; width: 150px; padding: 5px;">$${totals.materials.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              ` : ''}
              ${totals.labor > 0 ? `
                <tr>
                  <td style="text-align: right; padding: 5px;"><strong>Labor:</strong></td>
                  <td style="text-align: right; padding: 5px;">$${totals.labor.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              ` : ''}
              <tr>
                <td style="text-align: right; padding: 5px;"><strong>Subtotal:</strong></td>
                <td style="text-align: right; padding: 5px;">$${pdfContractSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              ${
                hasOptionalSections && pdfOptionalSubtotal > 0.005
                  ? `<tr>
                <td style="text-align: right; padding: 5px;"><strong>Optional items (not included in total):</strong></td>
                <td style="text-align: right; padding: 5px;">$${pdfOptionalSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>`
                  : ''
              }
              <tr>
                <td style="text-align: right; padding: 5px;"><strong>${taxExempt ? 'Tax:' : 'Sales Tax (7%):'}</strong></td>
                <td style="text-align: right; padding: 5px;">${taxExempt ? 'Tax Exempt' : '$' + totals.tax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              <tr class="summary-table-total" style="border-top: 2px solid #333;">
                <td style="text-align: right; padding: 10px 5px 5px 5px;"><strong style="font-size: 12pt;">${
                  isEstimate ? 'ESTIMATED TOTAL (non-binding):' : 'GRAND TOTAL:'
                }</strong></td>
                <td class="grand-total-amount" style="text-align: right; padding: 10px 5px 5px 5px;"><strong style="font-size: 14pt;">$${pdfContractGrandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
              </tr>
            </table>
          </div>
          
          <div class="terms-page">
            <div class="terms-header">
              <div class="terms-title">Standard Terms and Conditions</div>
              <div class="terms-reference">${docTitle} #${proposalNumber} | ${job.name} | ${job.client_name}</div>
              <div class="terms-reference">${isEstimate ? 'Estimated amount (non-binding)' : 'Contract Amount'}: $${pdfContractGrandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div class="terms-content">
              <div class="terms-section">
                <div class="terms-section-title">Change Orders:</div>
                <div class="terms-section-text">Any additions or deviations from the original scope involving extra costs for labor or materials will be executed only upon a written Change Order, signed by both ${companyName} and the Customer.</div>
              </div>
              <div class="terms-section">
                <div class="terms-section-title">Site Conditions:</div>
                <div class="terms-section-text">The contract price assumes normal soil conditions. If subsurface obstructions (e.g., rock, utilities, high water) are encountered, the Customer is responsible for additional excavation costs.</div>
              </div>
              <div class="terms-section">
                <div class="terms-section-title">Permits:</div>
                <div class="terms-section-text">Unless otherwise noted, the Customer is responsible for all building permits, zoning fees, and utility hookups.</div>
              </div>
              <div class="terms-section">
                <div class="terms-section-title">Payment Schedule:</div>
                <div class="terms-section-text">${paymentText}</div>
              </div>
              <div class="terms-section">
                <div class="terms-section-title">Site Access:</div>
                <div class="terms-section-text">Customer must provide clear, unobstructed access for heavy equipment and delivery trucks to the build site.</div>
              </div>
              <div class="terms-section">
                <div class="terms-section-title">Insurance:</div>
                <div class="terms-section-text">${companyName} carries General Liability and Workers' Comp. Customer is responsible for 'Course of Construction' insurance once materials are delivered.</div>
              </div>
              <div class="terms-section">
                <div class="terms-section-title">Workmanship Warranty:</div>
                <div class="terms-section-text">${companyName} warrants workmanship for one (1) year. Manufacturer warranties apply to steel panels, doors, and hardware.</div>
              </div>
              <div class="terms-signature-section">
                <div class="terms-signature-intro">
                  By signing below, the Customer acknowledges having read, understood, and agreed to these Standard Terms and Conditions as part of ${docTitle} #${proposalNumber}.
                </div>
                <div class="terms-signature-row">
                  <div class="terms-signature-block">
                    <div class="terms-signature-label">Customer Signature</div>
                    <div class="terms-signature-line"></div>
                  </div>
                  <div class="terms-signature-block">
                    <div class="terms-signature-label">Date</div>
                    <div class="terms-signature-line"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ` : `
          <!-- Customer Version - hereby + subtotal + tax + grand total kept together on same page -->
          <div class="financial-summary-block">
            <p style="margin-top: 30px; margin-bottom: 10px;">${
              isEstimate
                ? 'The following is our <strong>rough estimated</strong> investment for the scope described above (same section structure as a formal proposal). This is preliminary pricing only—not a detailed quote for construction:'
                : 'We Propose hereby to furnish material and labor, complete in accordance with the above specifications, for sum of:'
            }</p>
            
            <table style="margin-top: 15px;">
              <tr>
                <td style="text-align: right;"><strong>Subtotal:</strong></td>
                <td style="text-align: right; width: 150px;">$${pdfContractSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              ${
                hasOptionalSections && pdfOptionalSubtotal > 0.005
                  ? `<tr>
                <td style="text-align: right;"><strong>Optional items (not included in total):</strong></td>
                <td style="text-align: right; width: 150px;">$${pdfOptionalSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>`
                  : ''
              }
              <tr>
                <td style="text-align: right;"><strong>${taxExempt ? 'Tax:' : 'Sales Tax (7%):'}</strong></td>
                <td style="text-align: right;">${taxExempt ? 'Tax Exempt' : '$' + totals.tax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              <tr class="summary-table-total">
                <td style="text-align: right; padding-top: 10px;"><strong>${
                  isEstimate ? 'ESTIMATED TOTAL (non-binding):' : 'GRAND TOTAL:'
                }</strong></td>
                <td class="grand-total-amount" style="text-align: right; padding-top: 10px; font-size: 14pt;"><strong>$${pdfContractGrandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
              </tr>
            </table>
          </div>
          
          <div class="footer">
            ${
              isEstimate
                ? `<p style="margin-bottom: 10px; color: #92400e; font-size: 10pt;"><em>Payment terms below apply to the formal proposal; this estimate is for discussion only.</em></p><p style="margin-bottom: 10px;">${paymentText}</p>`
                : `<p style="margin-bottom: 10px;">${paymentText}</p>`
            }
            <p style="margin-bottom: 15px;"><strong>Note:</strong> ${
              isEstimate
                ? 'This estimate is subject to change and does not obligate either party. A formal proposal will be issued before construction.'
                : 'This proposal may be withdrawn by us if not accepted within 30 days.'
            }</p>
            <div class="signature-section">
              <p style="margin-bottom: 5px;"><strong>${isEstimate ? 'Acknowledgment of estimate' : 'Acceptance of Proposal'}</strong></p>
              <p style="margin-bottom: 20px;">${acceptanceText}</p>
              <div style="display: flex; justify-content: space-between; margin-top: 40px;">
                <div>
                  <p>Authorized Signature</p>
                  <div class="signature-line"></div>
                </div>
                <div>
                  <p>Date of Acceptance</p>
                  <div class="signature-line"></div>
                </div>
              </div>
              <div class="proposal-number-signing-page">${docTitle} #${proposalNumber}</div>
            </div>
          </div>
          
          <div class="terms-page">
            <div class="terms-header">
              <div class="terms-title">Standard Terms and Conditions</div>
              <div class="terms-reference">${docTitle} #${proposalNumber} | ${job.name} | ${job.client_name}</div>
              <div class="terms-reference">${isEstimate ? 'Estimated amount (non-binding)' : 'Contract Amount'}: $${pdfContractGrandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div class="terms-content">
              <div class="terms-section">
                <div class="terms-section-title">Change Orders:</div>
                <div class="terms-section-text">Any additions or deviations from the original scope involving extra costs for labor or materials will be executed only upon a written Change Order, signed by both ${companyName} and the Customer.</div>
              </div>
              <div class="terms-section">
                <div class="terms-section-title">Site Conditions:</div>
                <div class="terms-section-text">The contract price assumes normal soil conditions. If subsurface obstructions (e.g., rock, utilities, high water) are encountered, the Customer is responsible for additional excavation costs.</div>
              </div>
              <div class="terms-section">
                <div class="terms-section-title">Permits:</div>
                <div class="terms-section-text">Unless otherwise noted, the Customer is responsible for all building permits, zoning fees, and utility hookups.</div>
              </div>
              <div class="terms-section">
                <div class="terms-section-title">Payment Schedule:</div>
                <div class="terms-section-text">${paymentText}</div>
              </div>
              <div class="terms-section">
                <div class="terms-section-title">Site Access:</div>
                <div class="terms-section-text">Customer must provide clear, unobstructed access for heavy equipment and delivery trucks to the build site.</div>
              </div>
              <div class="terms-section">
                <div class="terms-section-title">Insurance:</div>
                <div class="terms-section-text">${companyName} carries General Liability and Workers' Comp. Customer is responsible for 'Course of Construction' insurance once materials are delivered.</div>
              </div>
              <div class="terms-section">
                <div class="terms-section-title">Workmanship Warranty:</div>
                <div class="terms-section-text">${companyName} warrants workmanship for one (1) year. Manufacturer warranties apply to steel panels, doors, and hardware.</div>
              </div>
              <div class="terms-signature-section">
                <div class="terms-signature-intro">
                  By signing below, the Customer acknowledges having read, understood, and agreed to these Standard Terms and Conditions as part of ${docTitle} #${proposalNumber}.
                </div>
                <div class="terms-signature-row">
                  <div class="terms-signature-block">
                    <div class="terms-signature-label">Customer Signature</div>
                    <div class="terms-signature-line"></div>
                  </div>
                  <div class="terms-signature-block">
                    <div class="terms-signature-label">Date</div>
                    <div class="terms-signature-line"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `}
        `
        }
      </body>
    </html>
  `;
}

/** Single change order document (print / save as PDF) — one sheet = one numbered change order */
export function generateChangeOrderDocumentHTML(data: {
  changeOrderNumber: string;
  date: string;
  job: { client_name: string; address: string; name: string };
  scopeTitle: string;
  scopeDescription: string;
  lineItems: Array<{ description: string; amount?: number }>;
  materialsTotal: number;
  laborTotal: number;
  subtotal: number;
  tax: number;
  grandTotal: number;
  showPrices: boolean;
  taxExempt?: boolean;
  signedName?: string;
  signedAt?: string;
}): string {
  const {
    changeOrderNumber,
    date,
    job,
    scopeTitle,
    scopeDescription,
    lineItems,
    materialsTotal,
    laborTotal,
    subtotal,
    tax,
    grandTotal,
    showPrices,
    taxExempt = false,
    signedName,
    signedAt,
  } = data;
  const money = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines =
    lineItems.length > 0
      ? lineItems
          .map((li) => {
            const desc = li.description || '—';
            const amt =
              li.amount != null && li.amount > 0 ? money(li.amount) : '—';
            return showPrices
              ? `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${desc}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">${amt}</td></tr>`
              : `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${desc}</td></tr>`;
          })
          .join('')
      : `<tr><td colspan="${showPrices ? 2 : 1}" style="padding:8px;color:#64748b;">No line-item detail.</td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Change Order ${changeOrderNumber}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 0 auto; padding: 28px; color: #1e293b; font-size: 11pt; line-height: 1.45; }
  h1 { font-size: 22pt; color: #9a3412; margin: 0 0 6px 0; }
  .sub { color: #64748b; font-size: 10pt; margin-bottom: 20px; }
  .box { border: 2px solid #ea580c; padding: 14px 16px; margin: 16px 0; background: #fff7ed; }
  .box h2 { margin: 0 0 8px 0; font-size: 13pt; color: #9a3412; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; padding: 8px; border-bottom: 2px solid #ea580c; color: #7c2d12; }
  .totals { margin-top: 18px; text-align: right; }
  .totals div { margin: 4px 0; }
  .grand { font-size: 16pt; font-weight: bold; color: #9a3412; margin-top: 10px; }
  .sig { margin-top: 28px; padding-top: 16px; border-top: 1px solid #cbd5e1; font-size: 10pt; color: #475569; }
</style></head><body>
  <h1>Change Order ${changeOrderNumber}</h1>
  <p class="sub">Martin Builder · ${date}</p>
  <p><strong>Project:</strong> ${job.name}<br/>
  <strong>Customer:</strong> ${job.client_name}<br/>
  <strong>Site:</strong> ${job.address || '—'}</p>
  <div class="box">
    <h2>Scope of work</h2>
    <p style="margin:0;font-weight:600;">${scopeTitle}</p>
    ${scopeDescription ? `<p style="margin:10px 0 0 0;white-space:pre-wrap;">${scopeDescription}</p>` : ''}
  </div>
  ${showPrices ? `<table>
    <thead><tr><th>Description</th><th style="text-align:right;width:120px;">Amount</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <div class="totals">
    ${subtotal > 0 ? `<div><strong>Subtotal:</strong> ${money(subtotal)}</div>` : ''}
    ${taxExempt ? '<div>Tax exempt</div>' : `<div>Tax (7%): ${money(tax)}</div>`}
    <div class="grand">Total: ${money(grandTotal)}</div>
  </div>` : `<table><thead><tr><th>Description</th></tr></thead><tbody>${lines}</tbody></table><p style="color:#64748b;margin-top:12px;">Pricing omitted — contact your project manager for the amount.</p>`}
  ${signedName && signedAt ? `<div class="sig"><strong>Authorized by customer:</strong> ${signedName}<br/>Signed: ${signedAt}</div>` : `<div class="sig"><strong>Customer authorization</strong> — sign in the customer portal to accept this change order.</div>`}
  <p style="margin-top:32px;font-size:9pt;color:#94a3b8;">This document is separate from your main building proposal. Change order ${changeOrderNumber}.</p>
</body></html>`;
}

/** One material line on the customer material list. */
export interface MaterialListRow {
  material_name: string;
  usage?: string;
  length?: string;
  quantity: number;
  color?: string;
  pricePerUnit: number;
  total: number;
  /** Category the line belongs to, used to group the breakdown within a section. */
  category?: string;
}

/** One material-list page = one workbook sheet/section. Rendered on its own PDF page. */
export interface MaterialListPage {
  sheetName: string;
  description?: string;
  optional?: boolean;
  rows: MaterialListRow[];
  subtotal: number;
}

/**
 * Customer-facing comprehensive material list (for customers who buy only the building
 * materials). Same header as the proposal, then each material sheet/section is rendered on
 * its own PDF page with columns: Material, Usage, Length, Qty, Color, Price/Unit, Total.
 */
export function generateMaterialListHTML(data: {
  proposalNumber: string;
  date: string;
  job: { client_name: string; address: string; name: string; customer_phone?: string };
  pages: MaterialListPage[];
  totals: { materials: number; taxable: number; tax: number; grandTotal: number };
  taxExempt?: boolean;
  templateSettings?: any;
}): string {
  const { proposalNumber, date, job, pages, totals, taxExempt = false } = data;
  const t = data.templateSettings || {};
  const companyName = t.company_name ?? 'Martin Builder';
  const companyAddress1 = t.company_address_1 ?? '27608-A CR 36';
  const companyAddress2 = t.company_address_2 ?? 'Goshen, IN 46526';
  const companyPhone = t.company_phone ?? '574-862-4448';
  const companyEmail = t.company_email ?? 'office@martinbuilder.net';
  const companyLogoUrl =
    t.company_logo_url ??
    'https://cdn-ai.onspace.ai/onspace/files/4ZzeFr2RKnB7oAxZwNpsZR/MB_Logo_Green_192x64_12.9kb.png';

  const money = (n: number) =>
    `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const qtyFmt = (n: number) => {
    const v = Number(n) || 0;
    return Number.isInteger(v) ? String(v) : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };
  const cell = (s: unknown) => {
    const v = s == null ? '' : String(s).trim();
    return v === '' ? '—' : escapeHtmlBid(v);
  };

  const renderPage = (page: MaterialListPage, index: number) => {
    // Group the section's lines by category (preserving incoming order) so each section shows a
    // clean breakdown: a category header, its material lines, then a category subtotal.
    const groups: { category: string; rows: MaterialListRow[]; subtotal: number }[] = [];
    for (const r of page.rows) {
      const cat = (r.category ?? '').trim() || 'Other';
      let g = groups.length && groups[groups.length - 1].category === cat ? groups[groups.length - 1] : null;
      if (!g) {
        g = { category: cat, rows: [], subtotal: 0 };
        groups.push(g);
      }
      g.rows.push(r);
      g.subtotal += Number(r.total) || 0;
    }
    const showCatSubtotals = groups.length > 1;

    const renderRow = (r: MaterialListRow) => `<tr>
                <td class="mat">${cell(r.material_name)}</td>
                <td>${cell(r.usage)}</td>
                <td class="center">${cell(r.length)}</td>
                <td class="center">${qtyFmt(r.quantity)}</td>
                <td>${cell(r.color)}</td>
                <td class="right">${money(r.pricePerUnit)}</td>
                <td class="right">${money(r.total)}</td>
              </tr>`;

    const rows =
      page.rows.length > 0
        ? groups
            .map((g) => {
              const header = `<tr class="cat-row"><td colspan="7" class="cat-cell">${escapeHtmlBid(
                g.category,
              )}</td></tr>`;
              const lines = g.rows.map(renderRow).join('');
              const sub = showCatSubtotals
                ? `<tr class="cat-subtotal"><td colspan="6" class="right">${escapeHtmlBid(
                    g.category,
                  )} subtotal</td><td class="right">${money(g.subtotal)}</td></tr>`
                : '';
              return header + lines + sub;
            })
            .join('')
        : `<tr><td colspan="7" class="empty">No materials listed for this section.</td></tr>`;

    return `<section class="sheet-page${index === 0 ? ' first' : ''}">
      <div class="sheet-title">${escapeHtmlBid(page.sheetName)}${
        page.optional ? ' <span class="opt">(Optional)</span>' : ''
      }</div>
      ${page.description ? `<div class="sheet-desc">${escapeHtmlBid(page.description)}</div>` : ''}
      <table class="mat-table">
        <thead>
          <tr>
            <th style="width: 26%;">Material</th>
            <th style="width: 16%;">Usage</th>
            <th style="width: 9%;" class="center">Length</th>
            <th style="width: 7%;" class="center">Qty</th>
            <th style="width: 13%;">Color</th>
            <th style="width: 13%;" class="right">Price / Unit</th>
            <th style="width: 16%;" class="right">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="6" class="right subtotal-label">Section subtotal</td>
            <td class="right subtotal-value">${money(page.subtotal)}</td>
          </tr>
        </tfoot>
      </table>
    </section>`;
  };

  const summaryRows = `
    <tr><td>Materials subtotal</td><td class="right">${money(totals.materials)}</td></tr>
    ${
      taxExempt
        ? `<tr><td>Tax</td><td class="right">Tax Exempt</td></tr>`
        : `<tr><td>Tax (7% on taxable materials)</td><td class="right">${money(totals.tax)}</td></tr>`
    }
    <tr class="grand"><td>Grand total</td><td class="right">${money(totals.grandTotal)}</td></tr>`;

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Material list-${proposalNumber}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      @page { size: letter; margin: 0.5in; }
      body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 10pt; line-height: 1.35; }
      .header-row { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2d5f3f; padding-bottom: 12px; margin-bottom: 14px; }
      .company-logo { height: 52px; width: auto; max-width: 200px; object-fit: contain; margin-bottom: 6px; }
      .company-address, .company-contact { font-size: 9pt; color: #374151; }
      .doc-header { text-align: right; }
      .doc-title { font-size: 22pt; font-weight: 700; color: #2d5f3f; letter-spacing: 0.5px; }
      .doc-sub { font-size: 9pt; color: #6b7280; margin-top: 2px; }
      .info-table { border-collapse: collapse; margin-top: 8px; margin-left: auto; }
      .info-table th, .info-table td { border: 1px solid #cbd5e1; padding: 4px 10px; font-size: 9pt; text-align: center; }
      .info-table th { background: #f1f5f9; }
      .customer-row { display: flex; gap: 14px; margin-bottom: 16px; }
      .info-box { flex: 1; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px 10px; }
      .box-header { font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #2d5f3f; letter-spacing: 0.5px; margin-bottom: 4px; }
      .intro { font-size: 9.5pt; color: #4b5563; margin-bottom: 16px; }
      .sheet-page { page-break-before: always; }
      .sheet-page.first { page-break-before: avoid; }
      .sheet-title { font-size: 13pt; font-weight: 700; color: #2d5f3f; border-bottom: 2px solid #2d5f3f; padding-bottom: 4px; margin-bottom: 6px; }
      .sheet-title .opt { font-size: 9pt; font-weight: 400; color: #6b7280; }
      .sheet-desc { font-size: 9pt; color: #4b5563; margin-bottom: 8px; white-space: pre-wrap; }
      .mat-table { width: 100%; border-collapse: collapse; }
      .mat-table th { background: #2d5f3f; color: #fff; font-size: 8.5pt; text-align: left; padding: 6px 8px; }
      .mat-table td { border-bottom: 1px solid #e5e7eb; padding: 5px 8px; font-size: 9pt; vertical-align: top; }
      .mat-table tbody tr:nth-child(even) { background: #f8faf9; }
      .mat-table .cat-row td { background: #eef3ef; border-bottom: 1px solid #cdddd3; }
      .mat-table .cat-cell { font-weight: 700; font-size: 8.5pt; letter-spacing: .03em; text-transform: uppercase; color: #2d5f3f; padding: 5px 8px; }
      .mat-table .cat-subtotal td { background: #fff; border-bottom: 1px solid #cdddd3; font-style: italic; font-weight: 600; color: #374151; }
      .mat-table .mat { font-weight: 600; }
      .mat-table .center { text-align: center; }
      .mat-table .right { text-align: right; white-space: nowrap; }
      .mat-table .empty { text-align: center; color: #9ca3af; padding: 12px; }
      .mat-table tfoot td { border-top: 2px solid #2d5f3f; font-weight: 700; padding-top: 6px; }
      .subtotal-label { color: #374151; }
      .subtotal-value { color: #2d5f3f; }
      .summary { margin-top: 22px; page-break-inside: avoid; }
      .summary-title { font-size: 11pt; font-weight: 700; color: #2d5f3f; margin-bottom: 6px; }
      .summary-table { width: 280px; margin-left: auto; border-collapse: collapse; }
      .summary-table td { padding: 5px 10px; font-size: 10pt; border-bottom: 1px solid #e5e7eb; }
      .summary-table .right { text-align: right; }
      .summary-table .grand td { border-top: 2px solid #2d5f3f; border-bottom: none; font-weight: 700; font-size: 11pt; color: #2d5f3f; }
      .foot-note { margin-top: 18px; font-size: 8pt; color: #9ca3af; }
    </style>
  </head>
  <body>
    <div class="header-row">
      <div>
        <img src="${companyLogoUrl}" alt="${escapeHtmlBid(companyName)}" class="company-logo" />
        <div class="company-address">${escapeHtmlBid(companyAddress1)}, ${escapeHtmlBid(companyAddress2)}</div>
        <div class="company-contact">Phone: ${escapeHtmlBid(companyPhone)}</div>
        <div class="company-contact">Email: ${escapeHtmlBid(companyEmail)}</div>
      </div>
      <div class="doc-header">
        <div class="doc-title">Material List</div>
        <div class="doc-sub">Building materials</div>
        <table class="info-table">
          <tr><th>Date</th><th>Proposal #</th></tr>
          <tr><td>${escapeHtmlBid(date)}</td><td>${escapeHtmlBid(proposalNumber)}</td></tr>
        </table>
      </div>
    </div>

    <div class="customer-row">
      <div class="info-box">
        <div class="box-header">Name / Address</div>
        <div>${escapeHtmlBid(job.client_name || '—')}</div>
        <div>${escapeHtmlBid(job.address || '')}</div>
        <div style="margin-top: 6px;">${escapeHtmlBid(job.customer_phone || 'N/A')}</div>
      </div>
      <div class="info-box">
        <div class="box-header">Project</div>
        <div>${escapeHtmlBid(job.name || '—')}</div>
      </div>
    </div>

    <div class="intro">Comprehensive list of building materials, organized by section. Each section begins on its own page.</div>

    ${pages.map((p, i) => renderPage(p, i)).join('')}

    <div class="summary">
      <div class="summary-title">Material Summary</div>
      <table class="summary-table">${summaryRows}</table>
    </div>

    <div class="foot-note">${escapeHtmlBid(companyName)} — Material list for ${escapeHtmlBid(job.name || '')} (#${escapeHtmlBid(proposalNumber)}). Materials only; labor and installation are not included on this list.</div>
  </body>
</html>`;
}
