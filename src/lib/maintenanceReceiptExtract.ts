/**
 * Receipt OCR for maintenance tickets via Supabase Edge Function extract-maintenance-receipt.
 */

export type MaintenanceReceiptExtractBody = {
  fileBase64?: string;
  fileUrl?: string;
  mimeType: string;
};

export type ExtractedMaintenanceInvoice = {
  invoice_number?: string;
  vendor?: string;
  parts?: Array<{ part_number?: string; description?: string; cost?: number | null }>;
};

export type MaintenanceReceiptExtractResult = {
  success?: boolean;
  error?: string;
  invoices?: ExtractedMaintenanceInvoice[];
  total_amount?: number | null;
};

function anonKey(): string | null {
  const fnOrigin = String(import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ?? '').trim();
  const fnKey = String(import.meta.env.VITE_SUPABASE_FUNCTIONS_ANON_KEY ?? '').trim();
  if (fnOrigin && fnKey) return fnKey;

  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

export function maintenanceReceiptExtractUrl(): string | null {
  const fnOrigin = String(import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ?? '')
    .trim()
    .replace(/\/$/, '');
  const api = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  const origin = fnOrigin || api;
  if (!origin) return null;
  return `${origin}/functions/v1/extract-maintenance-receipt`;
}

export async function invokeMaintenanceReceiptExtract(
  body: MaintenanceReceiptExtractBody,
): Promise<MaintenanceReceiptExtractResult> {
  const url = maintenanceReceiptExtractUrl();
  if (!url) {
    throw new Error('Missing VITE_SUPABASE_URL for receipt scanning.');
  }

  const key = anonKey();
  if (!key) {
    throw new Error('Missing VITE_SUPABASE_ANON_KEY');
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: MaintenanceReceiptExtractResult;
  try {
    parsed = JSON.parse(text) as MaintenanceReceiptExtractResult;
  } catch {
    throw new Error(`Receipt scan invalid response (HTTP ${res.status}): ${text.slice(0, 240)}`);
  }

  if (!res.ok) {
    throw new Error(parsed?.error || `Receipt scan failed (HTTP ${res.status})`);
  }
  if (parsed?.error) {
    throw new Error(parsed.error);
  }

  return parsed;
}
