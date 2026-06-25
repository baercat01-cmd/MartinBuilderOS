/** One proposal line for CSV / internal PDF breakdown exports. */
export interface ProposalLineBreakdownRow {
  section: string;
  lineType: string;
  category: string;
  description: string;
  sku: string;
  quantity: number;
  unit: string;
  unitCost: number;
  baseAmount: number;
  markupPct: number;
  linePrice: number;
  optional: boolean;
  notes: string;
}

export interface ProposalLineBreakdownSectionMeta {
  description?: string;
  optional: boolean;
}

export interface ProposalLineBreakdownExportData {
  proposalNumber: string;
  date: string;
  job: {
    name: string;
    client_name: string;
    address: string;
  };
  rows: ProposalLineBreakdownRow[];
  sectionMeta: Record<string, ProposalLineBreakdownSectionMeta>;
  totals: {
    materials: number;
    labor: number;
    subtotal: number;
    tax: number;
    grandTotal: number;
  };
  taxExempt?: boolean;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: number): string {
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Flat CSV with fixed column order. */
export function proposalLineBreakdownRowsToCsv(rows: ProposalLineBreakdownRow[]): string {
  const csvColumns = [
    'Section',
    'Line Type',
    'Category',
    'Description',
    'SKU',
    'Quantity',
    'Unit',
    'Unit Cost',
    'Base Amount',
    'Markup %',
    'Line Price',
    'Optional',
    'Notes',
  ];
  const escapeCsvCell = (value: string) => {
    const v = String(value ?? '');
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const toCsvRow = (row: ProposalLineBreakdownRow): Record<string, string> => ({
    Section: row.section,
    'Line Type': row.lineType,
    Category: row.category,
    Description: row.description,
    SKU: row.sku,
    Quantity: fmtQty(row.quantity),
    Unit: row.unit,
    'Unit Cost': row.unitCost.toFixed(2),
    'Base Amount': row.baseAmount.toFixed(2),
    'Markup %': String(row.markupPct),
    'Line Price': row.linePrice.toFixed(2),
    Optional: row.optional ? 'Yes' : 'No',
    Notes: row.notes,
  });
  return [
    csvColumns.join(','),
    ...rows.map((row) => csvColumns.map((col) => escapeCsvCell(toCsvRow(row)[col] || '')).join(',')),
  ].join('\n');
}

/** Internal PDF: proposal scope + every line with base, markup %, and sell price — no terms or signatures. */
export function generateProposalLineBreakdownHTML(data: ProposalLineBreakdownExportData): string {
  const { proposalNumber, date, job, rows, sectionMeta, totals, taxExempt = false } = data;

  const sectionOrder: string[] = [];
  const rowsBySection = new Map<string, ProposalLineBreakdownRow[]>();
  for (const row of rows) {
    if (!rowsBySection.has(row.section)) {
      rowsBySection.set(row.section, []);
      sectionOrder.push(row.section);
    }
    rowsBySection.get(row.section)!.push(row);
  }

  const sectionsHtml = sectionOrder
    .map((sectionName) => {
      const sectionRows = rowsBySection.get(sectionName) || [];
      const meta = sectionMeta[sectionName] || { optional: false };
      const sectionTotal = sectionRows.reduce((sum, r) => sum + (Number(r.linePrice) || 0), 0);
      const optBadge = meta.optional
        ? ' <span style="font-size:9pt;font-weight:600;color:#b45309;">(Optional)</span>'
        : '';

      const tableRows = sectionRows
        .map((row) => {
          const qtyCell =
            row.quantity > 0
              ? `${fmtQty(row.quantity)}${row.unit ? ` ${escapeHtml(row.unit)}` : ''}`
              : '—';
          return `<tr>
            <td>${escapeHtml(row.category || '—')}</td>
            <td>${escapeHtml(row.lineType)}</td>
            <td>${escapeHtml(row.description || '—')}</td>
            <td>${escapeHtml(row.sku || '—')}</td>
            <td style="text-align:center;">${qtyCell}</td>
            <td style="text-align:right;">${money(row.unitCost)}</td>
            <td style="text-align:right;">${money(row.baseAmount)}</td>
            <td style="text-align:center;">${row.markupPct}%</td>
            <td style="text-align:right;font-weight:600;">${money(row.linePrice)}</td>
          </tr>`;
        })
        .join('');

      const descBlock =
        meta.description && meta.description.trim()
          ? `<div class="section-desc">${escapeHtml(meta.description.trim()).replace(/\n/g, '<br/>')}</div>`
          : '';

      return `<div class="section-block">
        <h2 class="section-heading">${escapeHtml(sectionName)}${optBadge}</h2>
        ${descBlock}
        <table class="lines-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Type</th>
              <th>Description</th>
              <th>SKU</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Unit cost</th>
              <th style="text-align:right;">Base</th>
              <th style="text-align:center;">Markup</th>
              <th style="text-align:right;">Line price</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="8" style="text-align:right;font-weight:700;padding-top:10px;">Section total</td>
              <td style="text-align:right;font-weight:700;padding-top:10px;">${money(sectionTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
    })
    .join('');

  const lineCount = rows.length;
  const allLinesTotal = rows.reduce((sum, r) => sum + (Number(r.linePrice) || 0), 0);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Proposal Line Breakdown ${escapeHtml(proposalNumber)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10pt;
      line-height: 1.35;
      color: #111;
      max-width: 980px;
      margin: 0 auto;
      padding: 28px 32px 40px;
    }
    .doc-header {
      border-bottom: 2px solid #1a3d2e;
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .doc-title {
      font-size: 20pt;
      font-weight: 700;
      color: #1a3d2e;
      margin-bottom: 4px;
    }
    .doc-sub {
      font-size: 9pt;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 600;
    }
    .job-box {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px 24px;
      margin-bottom: 20px;
      padding: 12px 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      font-size: 9.5pt;
    }
    .job-box strong { display: block; font-size: 8pt; color: #64748b; text-transform: uppercase; margin-bottom: 2px; }
    .section-block {
      margin-bottom: 22px;
      page-break-inside: avoid;
    }
    .section-heading {
      font-size: 12pt;
      font-weight: 700;
      color: #1a3d2e;
      margin-bottom: 6px;
      page-break-after: avoid;
    }
    .section-desc {
      font-size: 9.5pt;
      color: #334155;
      margin-bottom: 8px;
      padding: 8px 10px;
      background: #f1f5f9;
      border-left: 3px solid #2d5a45;
      white-space: pre-wrap;
    }
    .lines-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
    }
    .lines-table th {
      text-align: left;
      padding: 7px 6px;
      background: #e8f4e8;
      border-bottom: 2px solid #2d5f3f;
      color: #1a3d2e;
      font-size: 7.5pt;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .lines-table td {
      padding: 6px;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: top;
    }
    .lines-table tbody tr:nth-child(even) { background: #fafafa; }
    .lines-table tfoot td {
      border-top: 2px solid #2d5f3f;
      background: #f0fdf4;
    }
    .summary {
      margin-top: 24px;
      padding: 16px 18px;
      border: 2px solid #333;
      border-radius: 6px;
      background: #f5f5f5;
      page-break-inside: avoid;
    }
    .summary h3 { font-size: 12pt; margin-bottom: 10px; color: #1a3d2e; }
    .summary table { width: 100%; max-width: 360px; margin-left: auto; }
    .summary td { padding: 4px 8px; }
    .summary .grand td { font-size: 12pt; font-weight: 700; border-top: 2px solid #333; padding-top: 10px; }
    .footer-note {
      margin-top: 20px;
      font-size: 8pt;
      color: #64748b;
      text-align: center;
    }
    @page { margin: 0.6in; size: letter landscape; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="doc-header">
    <div class="doc-sub">Internal use only — not for customer distribution</div>
    <h1 class="doc-title">Proposal line breakdown</h1>
    <p style="margin-top:6px;font-size:10pt;">Proposal #${escapeHtml(proposalNumber)} · ${escapeHtml(date)} · ${lineCount} lines</p>
  </div>

  <div class="job-box">
    <div><strong>Project</strong>${escapeHtml(job.name || '—')}</div>
    <div><strong>Customer</strong>${escapeHtml(job.client_name || '—')}</div>
    <div><strong>Site</strong>${escapeHtml(job.address || '—')}</div>
    <div><strong>Line items total</strong>${money(allLinesTotal)}</div>
  </div>

  ${sectionsHtml}

  <div class="summary">
    <h3>Proposal totals</h3>
    <table>
      ${totals.materials > 0 ? `<tr><td style="text-align:right;"><strong>Materials &amp; subcontractors</strong></td><td style="text-align:right;width:120px;">${money(totals.materials)}</td></tr>` : ''}
      ${totals.labor > 0 ? `<tr><td style="text-align:right;"><strong>Labor</strong></td><td style="text-align:right;">${money(totals.labor)}</td></tr>` : ''}
      <tr><td style="text-align:right;"><strong>Subtotal</strong></td><td style="text-align:right;">${money(totals.subtotal)}</td></tr>
      <tr><td style="text-align:right;"><strong>${taxExempt ? 'Tax' : 'Sales tax (7%)'}</strong></td><td style="text-align:right;">${taxExempt ? 'Tax exempt' : money(totals.tax)}</td></tr>
      <tr class="grand"><td style="text-align:right;"><strong>Grand total</strong></td><td style="text-align:right;">${money(totals.grandTotal)}</td></tr>
    </table>
  </div>

  <p class="footer-note">Every line shows base amount, markup %, and sell price as shown in the proposal panel.</p>
</body>
</html>`;
}
