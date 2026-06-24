import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

function generateJobHoursHTML(data: any): string {
  const { title, jobName, clientName, address, periodLabel, totalHours, users } = data;
  
  return `
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
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
      
      .job-info-value {
        font-size: 11px;
        color: #1a1a1a;
      }
      
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
      
      .user-section {
        margin-bottom: 8px;
      }
      
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
      
      .user-name {
        font-size: 11px;
        font-weight: 700;
        color: #1a1a1a;
      }
      
      .user-total {
        font-size: 11px;
        font-weight: 700;
        color: #2d5f3f;
      }
      
      .time-table {
        border: 1px solid #e0e0e0;
        border-radius: 3px;
        overflow: hidden;
      }
      
      .entries-table {
        width: 100%;
        border-collapse: collapse;
      }
      
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
      
      .entries-table tbody tr:last-child td {
        border-bottom: none;
      }
      
      .entries-table td:last-child { text-align: right; }
      
      .date-cell {
        font-weight: 500;
        font-size: 10px;
        white-space: nowrap;
      }
      
      .component-cell {
        font-weight: 400;
      }
      
      .time-cell {
        font-size: 10px;
        white-space: nowrap;
      }
      
      .hours-cell {
        font-weight: 700;
        color: #2d5f3f;
      }
      
      .notes-row {
        background: #f9fafb;
      }
      
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
        
        .header {
          margin-bottom: 6px;
          padding-bottom: 4px;
        }

        .user-section {
          page-break-inside: avoid;
          margin-bottom: 5px;
        }

        .user-header {
          padding: 2px 6px;
        }

        .entries-table th,
        .entries-table td {
          padding: 1px 3px;
          font-size: 9px;
        }
      }
    </style>
    
    <div class="header">
      <h1>${title}</h1>
      <div class="job-info">
        <div class="job-info-row">
          <span class="job-info-label">Job</span>
          <span class="job-info-value"><strong>${jobName}</strong></span>
        </div>
        <div class="job-info-row">
          <span class="job-info-label">Client</span>
          <span class="job-info-value">${clientName}</span>
        </div>
        <div class="job-info-row">
          <span class="job-info-label">Address</span>
          <span class="job-info-value">${address}</span>
        </div>
        ${periodLabel ? `
        <div class="job-info-row">
          <span class="job-info-label">Period</span>
          <span class="job-info-value">${periodLabel}</span>
        </div>
        ` : ''}
        <div class="total-hours">
          Total: ${totalHours}h
        </div>
      </div>
    </div>
    
    ${users.map((user: any, userIdx: number) => `
      <div class="user-section">
        <div class="user-header">
          <div class="user-name">${user.userName}</div>
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
              ${user.entries.map((entry: any) => {
                // Filter out system-generated notes like "manual entry"
                const hasUserNote = entry.notes && 
                  entry.notes.toLowerCase().trim() !== 'manual entry' && 
                  entry.notes.trim() !== '';
                
                return `
                  <tr>
                    <td class="date-cell">${entry.date}</td>
                    <td class="component-cell">${entry.component}</td>
                    <td class="time-cell">${entry.startTime}</td>
                    <td class="time-cell">${entry.endTime}</td>
                    <td>${entry.crewCount}</td>
                    <td class="hours-cell">${entry.hours}</td>
                  </tr>
                  ${hasUserNote ? `
                    <tr class="notes-row">
                      <td colspan="6" class="notes-cell">Note: ${entry.notes}</td>
                    </tr>
                  ` : ''}
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `).join('')}
  `;
}

function generatePayrollHTML(data: any): string {
  const { title, periodLabel, startDate, endDate, users } = data;
  
  return `
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #1a1a1a;
        line-height: 1.5;
        max-width: 900px;
        margin: 0 auto;
      }
      
      .header {
        text-align: center;
        margin-bottom: 30px;
        padding-bottom: 15px;
        border-bottom: 3px solid #2d5f3f;
      }
      
      .header h1 {
        color: #2d5f3f;
        font-size: 28px;
        margin-bottom: 8px;
      }
      
      .header .subtitle {
        color: #666;
        font-size: 14px;
        margin-bottom: 8px;
      }
      
      .period-info {
        background: #f8f9fa;
        border-radius: 6px;
        padding: 10px 20px;
        margin: 12px auto 0;
        display: inline-block;
      }
      
      .period-info .period-label {
        font-size: 13px;
        color: #666;
        margin-bottom: 4px;
      }
      
      .period-info .period-dates {
        font-size: 15px;
        font-weight: 600;
        color: #2d5f3f;
      }
      
      .user-section {
        margin-bottom: 40px;
        page-break-inside: avoid;
      }
      
      .user-section.page-break {
        page-break-after: always;
      }
      
      .user-period-info {
        background: #f8f9fa;
        border-radius: 6px;
        padding: 8px 16px;
        margin-bottom: 12px;
        text-align: center;
        border: 1px solid #e0e0e0;
      }
      
      .user-period-info .period-label {
        font-size: 11px;
        color: #666;
        margin-bottom: 2px;
      }
      
      .user-period-info .period-dates {
        font-size: 13px;
        font-weight: 600;
        color: #2d5f3f;
      }
      
      .user-header {
        background: #f8f9fa;
        padding: 12px 15px;
        border-left: 4px solid #2d5f3f;
        margin-bottom: 15px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .user-name {
        font-size: 20px;
        font-weight: bold;
        color: #1a1a1a;
      }
      
      .user-total {
        font-size: 24px;
        font-weight: bold;
        color: #2d5f3f;
      }
      
      .time-table {
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        overflow: hidden;
      }
      
      .entries-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      
      .entries-table th {
        background: #f0f0f0;
        padding: 8px;
        text-align: left;
        font-size: 11px;
        font-weight: 600;
        color: #555;
        border-bottom: 2px solid #ddd;
      }
      
      .entries-table th:nth-child(1) { width: 18%; } /* Date */
      .entries-table th:nth-child(2) { width: 35%; } /* Job */
      .entries-table th:nth-child(3) { width: 15%; } /* Start */
      .entries-table th:nth-child(4) { width: 15%; } /* End */
      .entries-table th:nth-child(5) { width: 17%; text-align: right; } /* Hours */
      
      .entries-table td {
        padding: 6px 8px;
        font-size: 12px;
        border-bottom: 1px solid #f0f0f0;
        vertical-align: top;
      }
      
      .entries-table tbody tr:last-child td {
        border-bottom: none;
      }
      
      .time-off-row {
        background: rgba(251, 191, 36, 0.1);
      }
      
      .time-off-row .job-cell {
        font-weight: 600;
        color: #b45309;
      }
      
      .entries-table td:nth-child(5) { text-align: right; }
      
      .date-cell {
        font-weight: 500;
        font-size: 12px;
      }
      
      .job-cell {
        font-weight: 500;
      }
      
      .client-name {
        font-size: 11px;
        color: #666;
        margin-top: 2px;
      }
      
      .component-tag {
        display: inline-block;
        margin-top: 4px;
        padding: 2px 8px;
        font-size: 10px;
        font-weight: 600;
        color: #374151;
        background: #e5e7eb;
        border-radius: 4px;
      }
      
      .time-cell {
        font-family: 'Courier New', monospace;
        font-size: 11px;
      }
      
      .hours-cell {
        font-weight: bold;
        color: #2d5f3f;
      }
      
      .daily-total-row {
        background: rgba(45, 95, 63, 0.05);
        border-bottom: 2px solid #e0e0e0 !important;
      }
      
      .daily-total-row td {
        padding: 8px;
        font-weight: 600;
        font-size: 12px;
      }
      
      .period-total {
        background: rgba(45, 95, 63, 0.1);
        padding: 12px 16px;
        border-radius: 6px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 15px;
      }
      
      .period-total-label {
        font-weight: bold;
        font-size: 16px;
      }
      
      .period-total-value {
        font-weight: bold;
        font-size: 20px;
        color: #2d5f3f;
      }
      
      @media print {
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          max-width: 100%;
          margin: 0;
          padding: 20px;
        }
        
        .user-section {
          page-break-inside: avoid;
        }
      }
    </style>
    
    <div class="header">
      <h1>${title}</h1>
      <p class="subtitle">Time & Payroll Report</p>
      <div class="period-info">
        <div class="period-label">Report Period</div>
        <div class="period-dates">${startDate} - ${endDate}</div>
      </div>
    </div>
    
    ${users.map((user: any, userIdx: number) => `
      <div class="user-section${userIdx < users.length - 1 ? ' page-break' : ''}">
        <div class="user-period-info">
          <div class="period-label">Report Period</div>
          <div class="period-dates">${startDate} - ${endDate}</div>
        </div>
        
        <div class="user-header">
          <div class="user-name">${user.name}</div>
          <div class="user-total">${user.totalHours.toFixed(2)}h</div>
        </div>
        
        <div class="time-table">
          <table class="entries-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Job</th>
                <th>Start</th>
                <th>End</th>
                <th>Hours</th>
              </tr>
            </thead>
            <tbody>
              ${user.dateEntries.map((dateEntry: any) => {
                const entries = dateEntry.entries.map((entry: any, idx: number) => {
                  const isFirst = idx === 0;
                  const isTimeOff = entry.isTimeOff || false;
                  return `
                    <tr${isTimeOff ? ' class="time-off-row"' : ''}>
                      ${isFirst ? `<td class="date-cell" rowspan="${dateEntry.entries.length}">${dateEntry.date}</td>` : ''}
                      <td class="job-cell">
                        <div>${entry.clientName || entry.jobName}</div>
                        ${entry.clientName && entry.jobName ? `<div class="client-name">${entry.jobName}</div>` : ''}
                        ${entry.displayNote && !isTimeOff ? `<div class="client-name">${String(entry.displayNote).replace(/</g, '&lt;')}</div>` : ''}
                        ${entry.componentName && !isTimeOff ? `<div><span class="component-tag">${String(entry.componentName).replace(/</g, '&lt;')}</span></div>` : ''}
                      </td>
                      <td class="time-cell">${entry.startTime}</td>
                      <td class="time-cell">${entry.endTime}</td>
                      <td class="hours-cell">${entry.hours}</td>
                    </tr>
                  `;
                }).join('');
                
                const dailyTotal = dateEntry.hasMultipleJobs ? `
                  <tr class="daily-total-row">
                    <td></td>
                    <td></td>
                    <td></td>
                    <td style="text-align: right; padding-right: 8px;">Daily Total:</td>
                    <td class="hours-cell">${dateEntry.totalHours.toFixed(2)}</td>
                  </tr>
                ` : '';
                
                return entries + dailyTotal;
              }).join('')}
            </tbody>
          </table>
        </div>
        
        <div class="period-total">
          <span class="period-total-label">Period Total</span>
          <span class="period-total-value">${user.totalHours.toFixed(2)}h</span>
        </div>
      </div>
    `).join('')}
  `;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { html, filename, type, data } = body;

    // If type is payroll or job-hours, generate HTML from data
    let finalHtml = html;
    let finalFilename = filename || 'report.pdf';

    if (type === 'payroll' && data) {
      console.log('📊 Generating payroll PDF from structured data');
      finalHtml = generatePayrollHTML(data);
      finalFilename = data.title.replace(/[^a-zA-Z0-9-_\s]/g, '').replace(/\s+/g, '_') + '.pdf';
    } else if (type === 'job-hours' && data) {
      console.log('📊 Generating job hours PDF from structured data');
      finalHtml = generateJobHoursHTML(data);
      finalFilename = `${data.jobName.replace(/[^a-zA-Z0-9-_\s]/g, '').replace(/\s+/g, '_')}_Hours.pdf`;
    } else if (!finalHtml) {
      return new Response(
        JSON.stringify({ error: 'HTML content or data is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('📄 PDF generation requested for:', finalFilename);
    console.log('📊 HTML length:', finalHtml?.length || 0);

    // Proposal HTML is a full document with its own @page and footer; return it unchanged
    // so the template's bottom margin and "Proposal # / Page N" footer print correctly.
    const isProposalDoc = typeof finalHtml === 'string' && finalHtml.trimStart().startsWith('<!DOCTYPE html>');
    if (isProposalDoc) {
      console.log('✅ Returning proposal HTML as-is (preserves @page and footer)');
      return new Response(finalHtml, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    // For payroll/job-hours: wrap in print-optimized shell (no @page override so content can control layout)
    const printOptimizedHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>${finalFilename}</title>
          <style>
            @media print {
              @page {
                margin: 0.5in;
                size: letter;
              }
            }
            body {
              margin: 0;
              padding: 8px;
            }
            .print-instructions {
              background: #f0f7f0;
              border: 2px solid #2d5f3f;
              border-radius: 8px;
              padding: 12px;
              margin-bottom: 12px;
              text-align: center;
            }
            .print-instructions h2 {
              color: #2d5f3f;
              margin: 0 0 6px 0;
              font-size: 16px;
            }
            .print-instructions p {
              margin: 3px 0;
              color: #333;
              font-size: 12px;
            }
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
            .print-instructions button:hover {
              background: #1a3d28;
            }
            @media print {
              .print-instructions {
                display: none;
              }
            }
          </style>
          <script>
            function printPDF() {
              window.print();
            }
            
            // Auto-trigger print dialog after page loads
            window.addEventListener('load', function() {
              // Small delay to ensure page is fully rendered
              setTimeout(function() {
                window.print();
              }, 500);
            });
          </script>
        </head>
        <body>
          <div class="print-instructions">
            <h2>🖨️ Save as PDF</h2>
            <p><strong>The print dialog will open automatically.</strong></p>
            <p>In the print dialog, select "Save as PDF" or "Microsoft Print to PDF" as your printer.</p>
            <p>If it didn't open automatically, click the button below:</p>
            <button onclick="printPDF()">Open Print Dialog</button>
          </div>
          ${finalHtml}
        </body>
      </html>
    `;

    console.log('✅ Print-optimized HTML prepared');

    return new Response(printOptimizedHtml, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
      },
    });

  } catch (error: any) {
    console.error('❌ Error preparing PDF:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to prepare PDF', details: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
