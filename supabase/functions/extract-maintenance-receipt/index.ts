import { corsHeaders } from '../_shared/cors.ts';

const EXTRACTION_PROMPT = `Extract maintenance or auto parts receipt data from this PDF or image.
Return a JSON object:
{
  "invoices": [
    {
      "invoice_number": "Invoice or receipt number as printed",
      "vendor": "Store or supplier name",
      "parts": [
        {
          "part_number": "SKU or part number if visible, otherwise null",
          "description": "Item description",
          "cost": 12.34
        }
      ]
    }
  ],
  "total_amount": 123.45
}

Rules:
- If the document contains MULTIPLE invoices or receipts, return one object per invoice in "invoices".
- Each invoice's "parts" must only include line items belonging to that invoice number.
- "cost" is the line total for that item.
- Use null for part_number when not printed.
- Exclude tax/subtotal rows from "parts".
- If invoice_number is missing, use null. If vendor is missing, use null.
- Return ONLY the JSON object.`;

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

    type RawPart = { part_number?: string; description?: string; cost?: number | null };
    type RawInvoice = { invoice_number?: string | null; vendor?: string | null; parts?: RawPart[] };

    const normalizeParts = (items: RawPart[] = []) =>
      items
        .filter((item) => item.description || item.part_number || item.cost != null)
        .map((item) => ({
          part_number: item.part_number || '',
          description: item.description || '',
          cost: item.cost != null ? Number(item.cost) : null,
        }));

    let invoices: Array<{ invoice_number: string; vendor: string; parts: ReturnType<typeof normalizeParts> }> = [];

    if (Array.isArray(extractedData.invoices) && extractedData.invoices.length > 0) {
      invoices = (extractedData.invoices as RawInvoice[])
        .map((inv) => ({
          invoice_number: inv.invoice_number?.trim() || '',
          vendor: inv.vendor?.trim() || '',
          parts: normalizeParts(inv.parts),
        }))
        .filter((inv) => inv.parts.length > 0 || inv.invoice_number || inv.vendor);
    }

    // Legacy single-list shape
    if (invoices.length === 0 && Array.isArray(extractedData.parts)) {
      const parts = normalizeParts(extractedData.parts);
      if (parts.length > 0) {
        invoices = [{
          invoice_number: extractedData.invoice_number?.trim() || '',
          vendor: extractedData.vendor?.trim() || '',
          parts,
        }];
      }
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
