import { corsHeaders } from '../_shared/cors.ts';

const EXTRACTION_PROMPT = `You are extracting structured data from auto repair / fleet maintenance receipts (PDF or image).

Return ONLY a JSON object in this exact shape:
{
  "invoices": [
    {
      "invoice_number": "12345",
      "vendor": "Supplier name",
      "parts": [
        {
          "part_number": "SKU123 or null",
          "description": "Line item description",
          "cost": 12.34
        }
      ]
    }
  ],
  "total_amount": 123.45
}

CRITICAL RULES:
1. If the document has MULTIPLE invoices or receipts (different invoice numbers, separate receipt sections, or multiple pages each with its own invoice header), you MUST return one object in "invoices" for EACH distinct invoice number.
2. Each invoice's "parts" array must contain EVERY line item (parts, labor, materials, fees) that belongs ONLY to that invoice number — never mix items across invoices.
3. "cost" is the line total for that row (quantity × unit price when shown as one amount).
4. Include ALL line items with a dollar amount. Do not summarize multiple items into one row.
5. Exclude summary rows from "parts": subtotal, tax, total, amount due, balance, payment received.
6. Use null for part_number when not printed on the receipt.
7. Use null for invoice_number or vendor only when truly not visible on that invoice section.
8. If one PDF page shows invoice #A with 3 items and another page shows invoice #B with 5 items, return two invoice objects with 3 and 5 parts respectively.
9. Return ONLY valid JSON — no markdown, no commentary.`;

type RawPart = {
  part_number?: string | null;
  description?: string | null;
  cost?: number | string | null;
  invoice_number?: string | null;
  vendor?: string | null;
};

type RawInvoice = {
  invoice_number?: string | null;
  vendor?: string | null;
  parts?: RawPart[];
};

type NormalizedPart = {
  part_number: string;
  description: string;
  cost: number | null;
};

type NormalizedInvoice = {
  invoice_number: string;
  vendor: string;
  parts: NormalizedPart[];
};

const SUMMARY_LINE =
  /^(subtotal|sub-total|total|tax|sales tax|amount due|balance due|grand total|invoice total|total due|shipping|freight|discount|payment|paid|balance)$/i;

function isSummaryLine(description: string, partNumber: string): boolean {
  const desc = description.trim();
  if (!desc) return false;
  if (SUMMARY_LINE.test(desc)) return true;
  return /^(total|tax)$/i.test(partNumber.trim());
}

function normalizePart(raw: RawPart): NormalizedPart | null {
  const part_number = (raw.part_number ?? '').toString().trim();
  const description = (raw.description ?? '').toString().trim();
  let cost: number | null = null;
  if (raw.cost != null && raw.cost !== '') {
    const parsed = Number(raw.cost);
    cost = Number.isFinite(parsed) ? parsed : null;
  }
  if (isSummaryLine(description, part_number)) return null;
  if (!part_number && !description && cost == null) return null;
  return { part_number, description, cost };
}

function invoiceGroupKey(invoiceNumber: string, vendor: string): string {
  const num = invoiceNumber.trim().toLowerCase();
  if (num) return `num:${num}`;
  const vend = vendor.trim().toLowerCase();
  if (vend) return `vendor:${vend}`;
  return '';
}

function consolidateInvoices(rawInvoices: RawInvoice[]): NormalizedInvoice[] {
  const groups = new Map<string, NormalizedInvoice>();

  const addPart = (invoiceNumber: string, vendor: string, raw: RawPart) => {
    const part = normalizePart(raw);
    if (!part) return;

    const key = invoiceGroupKey(invoiceNumber, vendor) || `__ungrouped_${groups.size}`;
    const existing = groups.get(key) ?? {
      invoice_number: invoiceNumber.trim(),
      vendor: vendor.trim(),
      parts: [],
    };
    if (!existing.invoice_number && invoiceNumber.trim()) {
      existing.invoice_number = invoiceNumber.trim();
    }
    if (!existing.vendor && vendor.trim()) {
      existing.vendor = vendor.trim();
    }
    existing.parts.push(part);
    groups.set(key, existing);
  };

  for (const inv of rawInvoices) {
    const invNum = inv.invoice_number?.trim() || '';
    const vendor = inv.vendor?.trim() || '';
    for (const part of inv.parts || []) {
      const partInvNum = part.invoice_number?.trim() || invNum;
      const partVendor = part.vendor?.trim() || vendor;
      addPart(partInvNum, partVendor, part);
    }
  }

  return [...groups.values()].filter((inv) => inv.parts.length > 0);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { fileUrl, fileBase64, mimeType } = await req.json();
    if (!fileUrl && !fileBase64) throw new Error('fileUrl or fileBase64 is required');

    const onspaceApiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const onspaceBaseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
    if (!onspaceApiKey) throw new Error('ONSPACE_AI_API_KEY not configured');
    if (!onspaceBaseUrl) throw new Error('ONSPACE_AI_BASE_URL not configured');

    let dataUrl: string;
    if (fileBase64) {
      dataUrl = `data:${mimeType || 'application/pdf'};base64,${fileBase64}`;
    } else {
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) throw new Error(`Failed to fetch file: ${fileResponse.statusText}`);
      const blob = await fileResponse.blob();
      const base64 = await blobToBase64(blob);
      dataUrl = `data:${mimeType || blob.type || 'application/pdf'};base64,${base64}`;
    }

    const aiResponse = await fetch(`${onspaceBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${onspaceApiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
        max_tokens: 8192,
        temperature: 0,
      }),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI error (${aiResponse.status}): ${await aiResponse.text()}`);
    }

    const aiData = await aiResponse.json();
    const extractedText = aiData.choices?.[0]?.message?.content ?? '';
    const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
    const extractedData = JSON.parse(jsonMatch ? jsonMatch[0] : extractedText);

    let invoices: NormalizedInvoice[] = [];

    if (Array.isArray(extractedData.invoices) && extractedData.invoices.length > 0) {
      invoices = consolidateInvoices(extractedData.invoices as RawInvoice[]);
    }

    // Legacy flat parts list — group by per-line invoice_number when present
    if (invoices.length === 0 && Array.isArray(extractedData.parts)) {
      invoices = consolidateInvoices([{
        invoice_number: extractedData.invoice_number ?? null,
        vendor: extractedData.vendor ?? null,
        parts: extractedData.parts as RawPart[],
      }]);
    }

    if (invoices.length === 0) {
      throw new Error('No invoices or line items found on this receipt');
    }

    return new Response(
      JSON.stringify({
        success: true,
        invoices,
        total_amount: extractedData.total_amount ?? null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
