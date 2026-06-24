export type JobHoursPrintEntry = {
  date: string;
  component?: string;
  startTime: string;
  endTime: string;
  hours: string;
  crewCount?: number;
  notes?: string;
};

export type JobHoursPrintUser = {
  userName: string;
  totalHours: number;
  entries: JobHoursPrintEntry[];
};

export type JobHoursPrintData = {
  title: string;
  jobName: string;
  clientName: string;
  address: string;
  periodLabel?: string;
  totalHours: string;
  users: JobHoursPrintUser[];
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Condensed job-hours report body (shared with generate-pdf edge function layout). */
export function generateJobHoursHtml(data: JobHoursPrintData): string {
  const { title, jobName, clientName, address, periodLabel, totalHours, users } = data;

  return `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #1a1a1a;
        line-height: 1.25;
        max-width: 100%;
        margin: 0 auto;
      }
      .header {
        text-align: center;
        margin-bottom: 10px;
        padding-bottom: 6px;
        border-bottom: 2px solid #2d5f3f;
      }
      .header h1 {
        color: #2d5f3f;
        font-size: 16px;
        font-weight: 700;
        margin-bottom: 4px;
        letter-spacing: 0.02em;
      }
      .job-info {
        background: #f8f9fa;
        border-radius: 4px;
        padding: 5px 10px;
        margin: 0 auto;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 6px 14px;
        max-width: 100%;
        text-align: left;
      }
      .job-info-row {
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
        margin-bottom: 0;
        white-space: nowrap;
      }
      .job-info-label {
        font-size: 9px;
        color: #666;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      .job-info-value { font-size: 11px; color: #1a1a1a; }
      .total-hours {
        background: #2d5f3f;
        color: white;
        padding: 3px 10px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: bold;
        margin-top: 0;
        text-align: center;
        white-space: nowrap;
      }
      .user-section { margin-bottom: 8px; }
      .user-header {
        background: #f0f0f0;
        padding: 3px 8px;
        border-left: 3px solid #2d5f3f;
        margin-bottom: 2px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        min-height: 0;
      }
      .user-name { font-size: 11px; font-weight: 700; color: #1a1a1a; }
      .user-total { font-size: 11px; font-weight: 700; color: #2d5f3f; }
      .time-table { border: 1px solid #e0e0e0; border-radius: 3px; overflow: hidden; }
      .entries-table { width: 100%; border-collapse: collapse; }
      .entries-table th {
        background: #f5f5f5;
        padding: 2px 4px;
        text-align: left;
        font-size: 9px;
        font-weight: 600;
        color: #555;
        border-bottom: 1px solid #ddd;
      }
      .entries-table th:last-child { text-align: right; }
      .entries-table td {
        padding: 2px 4px;
        font-size: 10px;
        border-bottom: 1px solid #f0f0f0;
        vertical-align: top;
      }
      .entries-table tbody tr:last-child td { border-bottom: none; }
      .entries-table td:last-child { text-align: right; }
      .date-cell { font-weight: 500; font-size: 10px; white-space: nowrap; }
      .time-cell { font-size: 10px; white-space: nowrap; }
      .hours-cell { font-weight: 700; color: #2d5f3f; }
      .notes-row { background: #f9fafb; }
      .notes-cell {
        font-size: 9px;
        color: #666;
        font-style: italic;
        padding: 1px 4px 2px !important;
      }
      @media print {
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          max-width: 100%;
          margin: 0;
          padding: 0;
          line-height: 1.2;
        }
        .header { margin-bottom: 6px; padding-bottom: 4px; }
        .user-section { page-break-inside: avoid; margin-bottom: 5px; }
        .user-header { padding: 2px 6px; }
        .entries-table th, .entries-table td { padding: 1px 3px; font-size: 9px; }
      }
    </style>

    <div class="header">
      <h1>${escapeHtml(title)}</h1>
      <div class="job-info">
        <div class="job-info-row">
          <span class="job-info-label">Job</span>
          <span class="job-info-value"><strong>${escapeHtml(jobName)}</strong></span>
        </div>
        <div class="job-info-row">
          <span class="job-info-label">Client</span>
          <span class="job-info-value">${escapeHtml(clientName)}</span>
        </div>
        <div class="job-info-row">
          <span class="job-info-label">Address</span>
          <span class="job-info-value">${escapeHtml(address)}</span>
        </div>
        ${
          periodLabel
            ? `<div class="job-info-row">
          <span class="job-info-label">Period</span>
          <span class="job-info-value">${escapeHtml(periodLabel)}</span>
        </div>`
            : ''
        }
        <div class="total-hours">Total: ${escapeHtml(totalHours)}h</div>
      </div>
    </div>

    ${users
      .map(
        (user) => `
      <div class="user-section">
        <div class="user-header">
          <div class="user-name">${escapeHtml(user.userName)}</div>
          <div class="user-total">${user.totalHours.toFixed(2)}h</div>
        </div>
        <div class="time-table">
          <table class="entries-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Component</th>
                <th>Start</th>
                <th>End</th>
                <th>Crew</th>
                <th>Hours</th>
              </tr>
            </thead>
            <tbody>
              ${user.entries
                .map((entry) => {
                  const note = String(entry.notes ?? '').trim();
                  const hasUserNote =
                    note.length > 0 && note.toLowerCase() !== 'manual entry';
                  return `
                  <tr>
                    <td class="date-cell">${escapeHtml(entry.date)}</td>
                    <td>${escapeHtml(entry.component ?? '')}</td>
                    <td class="time-cell">${escapeHtml(entry.startTime)}</td>
                    <td class="time-cell">${escapeHtml(entry.endTime)}</td>
                    <td>${escapeHtml(entry.crewCount ?? 1)}</td>
                    <td class="hours-cell">${escapeHtml(entry.hours)}</td>
                  </tr>
                  ${
                    hasUserNote
                      ? `<tr class="notes-row">
                    <td colspan="6" class="notes-cell">Note: ${escapeHtml(note)}</td>
                  </tr>`
                      : ''
                  }`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>`,
      )
      .join('')}
  `;
}

/** Full printable HTML document with auto-print (matches generate-pdf edge function shell). */
export function wrapJobHoursPrintDocument(bodyHtml: string, filename: string): string {
  const safeTitle = escapeHtml(filename);
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>${safeTitle}</title>
    <style>
      @media print {
        @page { margin: 0.5in; size: letter; }
      }
      body { margin: 0; padding: 8px; }
      .print-instructions {
        background: #f0f7f0;
        border: 2px solid #2d5f3f;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 12px;
        text-align: center;
      }
      .print-instructions h2 { color: #2d5f3f; margin: 0 0 6px 0; font-size: 16px; }
      .print-instructions p { margin: 3px 0; color: #333; font-size: 12px; }
      .print-instructions button {
        background: #2d5f3f;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        margin-top: 8px;
      }
      .print-instructions button:hover { background: #1a3d28; }
      @media print { .print-instructions { display: none; } }
    </style>
    <script>
      function printPDF() { window.print(); }
      window.addEventListener('load', function() {
        setTimeout(function() { window.print(); }, 500);
      });
    </script>
  </head>
  <body>
    <div class="print-instructions">
      <h2>Save as PDF</h2>
      <p><strong>The print dialog will open automatically.</strong></p>
      <p>Select "Save as PDF" or "Microsoft Print to PDF" as your printer.</p>
      <button type="button" onclick="printPDF()">Open Print Dialog</button>
    </div>
    ${bodyHtml}
  </body>
</html>`;
}

export function buildJobHoursPrintDocument(data: JobHoursPrintData): string {
  const filename = `${data.jobName.replace(/[^a-zA-Z0-9-_\s]/g, '').replace(/\s+/g, '_')}_Hours.pdf`;
  return wrapJobHoursPrintDocument(generateJobHoursHtml(data), filename);
}
