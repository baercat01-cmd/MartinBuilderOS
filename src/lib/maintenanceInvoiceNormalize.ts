import type { ExtractedMaintenanceInvoice } from '@/lib/maintenanceReceiptExtract';

export type NormalizedPart = {
  part_number: string;
  description: string;
  cost: string;
};

export type NormalizedInvoice = {
  invoice_number: string;
  vendor: string;
  parts: NormalizedPart[];
};

const SUMMARY_LINE =
  /^(subtotal|sub-total|total|tax|sales tax|amount due|balance due|grand total|invoice total|total due|shipping|freight|discount|payment|paid|balance)$/i;

function normalizePartNumber(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeDescription(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeCost(value: unknown): string {
  if (value == null || value === '') return '';
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : String(value).trim();
}

function isSummaryLine(description: string, partNumber: string): boolean {
  const desc = description.trim();
  if (!desc) return false;
  if (SUMMARY_LINE.test(desc)) return true;
  return /^(total|tax)$/i.test(partNumber);
}

function invoiceKey(invoiceNumber: string, vendor: string): string {
  const num = invoiceNumber.trim().toLowerCase();
  const vend = vendor.trim().toLowerCase();
  if (num) return `num:${num}`;
  if (vend) return `vendor:${vend}`;
  return '';
}

function toNormalizedPart(raw: {
  part_number?: string | null;
  description?: string | null;
  cost?: number | string | null;
}): NormalizedPart | null {
  const part_number = normalizePartNumber(raw.part_number);
  const description = normalizeDescription(raw.description);
  const cost = normalizeCost(raw.cost);
  if (isSummaryLine(description, part_number)) return null;
  if (!part_number && !description && !cost) return null;
  return { part_number, description, cost };
}

/** Group and dedupe extracted invoices by invoice number (and vendor when number is missing). */
export function normalizeExtractedInvoices(
  raw: ExtractedMaintenanceInvoice[],
): NormalizedInvoice[] {
  const groups = new Map<string, NormalizedInvoice>();

  const addToGroup = (invoiceNumber: string, vendor: string, part: NormalizedPart) => {
    const key = invoiceKey(invoiceNumber, vendor) || `__ungrouped_${groups.size}`;
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

  for (const inv of raw) {
    const invNum = inv.invoice_number?.trim() || '';
    const vendor = inv.vendor?.trim() || '';

    for (const rawPart of inv.parts || []) {
      const partInvNum =
        (rawPart as { invoice_number?: string }).invoice_number?.trim() || invNum;
      const partVendor = (rawPart as { vendor?: string }).vendor?.trim() || vendor;
      const part = toNormalizedPart(rawPart);
      if (part) addToGroup(partInvNum, partVendor, part);
    }
  }

  return [...groups.values()].filter((inv) => inv.parts.length > 0);
}

export function sumNormalizedInvoiceParts(invoice: NormalizedInvoice): number {
  return invoice.parts.reduce((sum, part) => {
    const cost = parseFloat(part.cost);
    return sum + (Number.isFinite(cost) ? cost : 0);
  }, 0);
}

export function mergeNormalizedInvoices(invoices: NormalizedInvoice[]): NormalizedInvoice[] {
  return normalizeExtractedInvoices(
    invoices.map((inv) => ({
      invoice_number: inv.invoice_number,
      vendor: inv.vendor,
      parts: inv.parts.map((part) => ({
        part_number: part.part_number,
        description: part.description,
        cost: part.cost ? parseFloat(part.cost) : null,
      })),
    })),
  );
}

function isEmptyInvoiceGroup(invoice: {
  invoice_number: string;
  vendor: string;
  receiptFile?: File | null;
  receiptDocumentId?: string | null;
  parts: Array<{ part_number: string; description: string; cost: string }>;
}): boolean {
  const hasMeta =
    invoice.invoice_number.trim() ||
    invoice.vendor.trim() ||
    invoice.receiptFile ||
    invoice.receiptDocumentId;
  const hasParts = invoice.parts.some(
    (part) => part.part_number.trim() || part.description.trim() || part.cost.trim(),
  );
  return !hasMeta && !hasParts;
}

/** Merge scanned invoices into existing groups, matching by invoice number when possible. */
export function mergeExtractedIntoInvoiceGroups<
  T extends {
    clientKey: string;
    invoice_number: string;
    vendor: string;
    receiptFile?: File | null;
    receiptFileName?: string | null;
    receiptFileType?: string | null;
    parts: NormalizedPart[];
  },
>(
  existing: T[],
  startIndex: number,
  extracted: NormalizedInvoice[],
  receiptMeta: { file: File; fileName: string; fileType: string | null },
  createGroup: (parts?: NormalizedPart[]) => T,
): T[] {
  if (!extracted.length) return existing;

  const pending = extracted.map((inv) => ({
    ...inv,
    receiptFile: receiptMeta.file,
    receiptFileName: receiptMeta.fileName,
    receiptFileType: receiptMeta.fileType,
  }));

  const next = [...existing];
  const usedPending = new Set<number>();

  for (let i = 0; i < next.length; i++) {
    const group = next[i];
    const key = invoiceKey(group.invoice_number, group.vendor);
    if (!key) continue;

    const matchIndex = pending.findIndex(
      (inv, idx) => !usedPending.has(idx) && invoiceKey(inv.invoice_number, inv.vendor) === key,
    );
    if (matchIndex < 0) continue;

    usedPending.add(matchIndex);
    const scanned = pending[matchIndex];
    next[i] = {
      ...group,
      invoice_number: scanned.invoice_number || group.invoice_number,
      vendor: scanned.vendor || group.vendor,
      receiptFile: scanned.receiptFile,
      receiptFileName: scanned.receiptFileName,
      receiptFileType: scanned.receiptFileType,
      parts: scanned.parts.length ? scanned.parts : group.parts,
    };
  }

  const remaining = pending.filter((_, idx) => !usedPending.has(idx));
  if (!remaining.length) return next;

  const insertAt = Math.min(Math.max(startIndex, 0), next.length);
  const slot = next[insertAt];
  const slotIsEmpty = slot && isEmptyInvoiceGroup(slot);

  if (remaining.length === 1 && slotIsEmpty) {
    const scanned = remaining[0];
    next[insertAt] = {
      ...slot,
      invoice_number: scanned.invoice_number,
      vendor: scanned.vendor,
      receiptFile: scanned.receiptFile,
      receiptFileName: scanned.receiptFileName,
      receiptFileType: scanned.receiptFileType,
      parts: scanned.parts.length ? scanned.parts : slot.parts,
    };
    return next;
  }

  const newGroups = remaining.map((inv) => {
    const group = createGroup(inv.parts);
    return {
      ...group,
      invoice_number: inv.invoice_number,
      vendor: inv.vendor,
      receiptFile: inv.receiptFile,
      receiptFileName: inv.receiptFileName,
      receiptFileType: inv.receiptFileType,
      parts: inv.parts.length ? inv.parts : group.parts,
    };
  });

  if (slotIsEmpty) {
    next.splice(insertAt, 1, ...newGroups);
  } else {
    next.splice(insertAt + 1, 0, ...newGroups);
  }

  return next.filter((group) => {
    if (next.length <= 1) return true;
    return !isEmptyInvoiceGroup(group);
  });
}
