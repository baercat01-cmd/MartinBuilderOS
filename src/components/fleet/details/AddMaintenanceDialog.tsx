import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileText, Loader2, Plus, ScanLine, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { invokeMaintenanceReceiptExtract } from '@/lib/maintenanceReceiptExtract';
import {
  mergeExtractedIntoInvoiceGroups,
  mergeNormalizedInvoices,
  normalizeExtractedInvoices,
  sumNormalizedInvoiceParts,
} from '@/lib/maintenanceInvoiceNormalize';
import {
  formatPersistenceError,
  loadMaintenanceTicketArtifacts,
  saveMaintenanceTicketInvoices,
  uploadTempReceiptForScan,
} from '@/lib/maintenanceLogPersistence';
import {
  MAX_MAINTENANCE_RECEIPT_BYTES,
  RECEIPT_SCAN_URL_MIN_BYTES,
  formatReceiptSizeLimitMessage,
} from '@/lib/maintenanceReceiptLimits';

interface MaintenanceLogPart {
  id?: string;
  part_number: string;
  description: string;
  cost: string;
}

interface MaintenanceInvoiceGroup {
  clientKey: string;
  invoice_number: string;
  vendor: string;
  receiptFile?: File | null;
  receiptDocumentId?: string | null;
  receiptFileName?: string | null;
  receiptFilePath?: string | null;
  receiptFileType?: string | null;
  parts: MaintenanceLogPart[];
}

interface TicketReceipt {
  id?: string;
  fileName: string;
  filePath?: string | null;
  fileType?: string | null;
  file?: File | null;
  maintenanceLogPartId?: string | null;
}

interface AddMaintenanceDialogProps {
  open: boolean;
  onClose: () => void;
  vehicleId: string;
  vehicleType: string;
  onSuccess: () => void;
  onTicketSaved?: () => void;
  onLogCreated?: (logId: string) => void;
  editLogId?: string | null;
}

const INITIAL_FORM = {
  type: 'service',
  status: 'in_progress',
  title: '',
  date: new Date().toISOString().split('T')[0],
  mileage_hours: '',
  description: '',
};

function createEmptyPart(): MaintenanceLogPart {
  return { part_number: '', description: '', cost: '' };
}

function createEmptyInvoiceGroup(): MaintenanceInvoiceGroup {
  return {
    clientKey: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    invoice_number: '',
    vendor: '',
    receiptFile: null,
    parts: [createEmptyPart()],
  };
}

function flattenParts(invoices: MaintenanceInvoiceGroup[]): MaintenanceLogPart[] {
  return invoices.flatMap((inv) => inv.parts);
}

function sumInvoiceCosts(invoices: MaintenanceInvoiceGroup[]): number {
  return flattenParts(invoices).reduce((sum, part) => {
    const cost = parseFloat(part.cost);
    return sum + (Number.isFinite(cost) ? cost : 0);
  }, 0);
}

function formatPartNumbersFromInvoices(invoices: MaintenanceInvoiceGroup[]): string | null {
  const numbers = flattenParts(invoices).map((p) => p.part_number.trim()).filter(Boolean);
  return numbers.length > 0 ? numbers.join(', ') : null;
}

const RECEIPT_ACCEPT = '.pdf,application/pdf,image/jpeg,image/png,image/webp,image/gif';

function appendPendingReceipt(receipts: TicketReceipt[], file: File): TicketReceipt[] {
  const alreadyListed = receipts.some(
    (receipt) =>
      receipt.file === file ||
      (receipt.fileName === file.name && !receipt.id),
  );
  if (alreadyListed) return receipts;
  return [
    ...receipts,
    {
      fileName: file.name,
      fileType: file.type || null,
      file,
    },
  ];
}

function inferTicketTitle(
  title: string,
  receipts: TicketReceipt[],
  invoiceGroups: MaintenanceInvoiceGroup[],
): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed;

  const fromReceipt =
    receipts.find((receipt) => receipt.fileName)?.fileName ||
    invoiceGroups.find((inv) => inv.receiptFileName)?.receiptFileName ||
    invoiceGroups.find((inv) => inv.receiptFile)?.receiptFile?.name;

  if (fromReceipt) {
    return fromReceipt.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  }

  return 'Maintenance ticket';
}

function isReceiptFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isImageReceipt(fileType?: string | null, fileName?: string | null): boolean {
  if (fileType?.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(fileName || '');
}

function isPdfReceipt(fileType?: string | null, fileName?: string | null): boolean {
  if (fileType === 'application/pdf') return true;
  return (fileName || '').toLowerCase().endsWith('.pdf');
}

export function AddMaintenanceDialog({
  open,
  onClose,
  vehicleId,
  vehicleType,
  onSuccess,
  onTicketSaved,
  onLogCreated,
  editLogId,
}: AddMaintenanceDialogProps) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [loadingLog, setLoadingLog] = useState(false);
  const [activeLogId, setActiveLogId] = useState<string | null>(editLogId ?? null);
  const [extractingInvoiceIndex, setExtractingInvoiceIndex] = useState<number | null>(null);
  const [dragOverInvoiceIndex, setDragOverInvoiceIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [invoices, setInvoices] = useState<MaintenanceInvoiceGroup[]>([createEmptyInvoiceGroup()]);
  const [ticketReceipts, setTicketReceipts] = useState<TicketReceipt[]>([]);

  const isEditMode = Boolean(activeLogId);

  useEffect(() => {
    if (!open) return;
    setActiveLogId(editLogId ?? null);
    if (editLogId) {
      loadExistingLog(editLogId);
    } else {
      setFormData({ ...INITIAL_FORM, date: new Date().toISOString().split('T')[0] });
      setInvoices([createEmptyInvoiceGroup()]);
      setTicketReceipts([]);
    }
  }, [open, editLogId]);

  async function loadExistingLog(logId: string) {
    setLoadingLog(true);
    try {
      const { data: log, error: logError } = await supabase
        .from('maintenance_logs')
        .select('*')
        .eq('id', logId)
        .single();
      if (logError) throw logError;

      setFormData({
        type: log.type || 'service',
        status: log.status || 'in_progress',
        title: log.title || '',
        date: log.date || new Date().toISOString().split('T')[0],
        mileage_hours: log.mileage_hours != null ? String(log.mileage_hours) : '',
        description: log.description || '',
      });

      const { receipts, invoices: loadedInvoices } = await loadMaintenanceTicketArtifacts(
        vehicleId,
        logId,
        log.notes,
      );

      setTicketReceipts(
        receipts.map((doc) => ({
          id: doc.id,
          fileName: doc.fileName,
          filePath: doc.filePath,
          fileType: doc.fileType,
          maintenanceLogPartId: doc.maintenanceLogPartId,
        })),
      );

      if (loadedInvoices.length) {
        setInvoices(loadedInvoices);
      } else {
        setInvoices([createEmptyInvoiceGroup()]);
      }
    } catch (error: any) {
      console.error('Failed to load maintenance ticket', error);
      toast.error(error?.message || 'Failed to load maintenance ticket');
    } finally {
      setLoadingLog(false);
    }
  }

  function updateInvoice(invoiceIndex: number, updates: Partial<MaintenanceInvoiceGroup>) {
    setInvoices((prev) => prev.map((inv, i) => (i === invoiceIndex ? { ...inv, ...updates } : inv)));
  }

  function updatePart(invoiceIndex: number, partIndex: number, updates: Partial<MaintenanceLogPart>) {
    setInvoices((prev) =>
      prev.map((inv, i) =>
        i === invoiceIndex
          ? { ...inv, parts: inv.parts.map((part, j) => (j === partIndex ? { ...part, ...updates } : part)) }
          : inv,
      ),
    );
  }

  function addPartToInvoice(invoiceIndex: number) {
    setInvoices((prev) =>
      prev.map((inv, i) => (i === invoiceIndex ? { ...inv, parts: [...inv.parts, createEmptyPart()] } : inv)),
    );
  }

  function removePartFromInvoice(invoiceIndex: number, partIndex: number) {
    setInvoices((prev) =>
      prev.map((inv, i) => {
        if (i !== invoiceIndex) return inv;
        const nextParts = inv.parts.length <= 1 ? [createEmptyPart()] : inv.parts.filter((_, j) => j !== partIndex);
        return { ...inv, parts: nextParts };
      }),
    );
  }

  function addInvoice() {
    setInvoices((prev) => [...prev, createEmptyInvoiceGroup()]);
  }

  function removeInvoice(invoiceIndex: number) {
    setInvoices((prev) => (prev.length <= 1 ? [createEmptyInvoiceGroup()] : prev.filter((_, i) => i !== invoiceIndex)));
  }

  async function extractInvoicesFromReceipt(file: File): Promise<MaintenanceInvoiceGroup[]> {
    const mimeType = file.type || 'application/pdf';
    let invokeBody: { fileBase64?: string; fileUrl?: string; mimeType: string };

    if (file.size > RECEIPT_SCAN_URL_MIN_BYTES) {
      const publicUrl = await uploadTempReceiptForScan(vehicleId, file);
      invokeBody = { fileUrl: publicUrl, mimeType };
    } else {
      const base64 = await fileToBase64(file);
      invokeBody = { fileBase64: base64, mimeType };
    }

    const data = await invokeMaintenanceReceiptExtract(invokeBody);

    const extracted = normalizeExtractedInvoices(data?.invoices || []);
    if (!extracted.length) throw new Error('No invoices or parts found on this receipt');

    return extracted.map((inv) => ({
      clientKey: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      invoice_number: inv.invoice_number,
      vendor: inv.vendor,
      receiptFile: file,
      receiptFileName: file.name,
      receiptFileType: file.type || null,
      parts: inv.parts.length
        ? inv.parts
        : [createEmptyPart()],
    }));
  }

  async function persistTicket(options?: {
    invoicesOverride?: MaintenanceInvoiceGroup[];
    receiptsOverride?: TicketReceipt[];
    titleOverride?: string;
    closeOnSuccess?: boolean;
    quiet?: boolean;
    auto?: boolean;
  }): Promise<string | null> {
    const invoicesToSave = options?.invoicesOverride ?? invoices;
    const receiptsToSave = options?.receiptsOverride ?? ticketReceipts;
    const resolvedTitle = inferTicketTitle(
      options?.titleOverride ?? formData.title,
      receiptsToSave,
      invoicesToSave,
    );

    if (!formData.title.trim() && resolvedTitle !== formData.title) {
      setFormData((prev) => ({ ...prev, title: resolvedTitle }));
    }

    const setBusy = options?.auto ? setAutoSaving : setLoading;
    setBusy(true);

    try {
      const totalCost = sumInvoiceCosts(invoicesToSave);
      const logPayload = {
        vehicle_id: vehicleId,
        type: formData.type,
        status: formData.status,
        title: resolvedTitle,
        date: formData.date,
        mileage_hours: formData.mileage_hours ? parseFloat(formData.mileage_hours) : null,
        description: formData.description || null,
        part_numbers: formatPartNumbersFromInvoices(invoicesToSave),
        part_cost: totalCost > 0 ? totalCost : null,
      };

      const wasExisting = Boolean(activeLogId);
      let logId = activeLogId;

      if (logId) {
        const { error } = await supabase.from('maintenance_logs').update(logPayload).eq('id', logId);
        if (error) throw error;
      } else {
        const { data: logData, error } = await supabase
          .from('maintenance_logs')
          .insert({ ...logPayload, created_by: profile?.username || 'unknown' })
          .select('id')
          .single();
        if (error) throw error;
        logId = logData.id;
        setActiveLogId(logId);
        onLogCreated?.(logId);
      }

      if (!logId) throw new Error('Failed to save ticket');

      const savedReceipts = await saveMaintenanceTicketInvoices({
        vehicleId,
        logId,
        invoices: invoicesToSave,
        pendingReceipts: receiptsToSave,
        uploadedBy: profile?.username || 'unknown',
        isEditMode: wasExisting,
      });

      setTicketReceipts(
        savedReceipts.map((doc) => ({
          id: doc.id,
          fileName: doc.fileName,
          filePath: doc.filePath,
          fileType: doc.fileType,
          maintenanceLogPartId: doc.maintenanceLogPartId,
        })),
      );

      const docById = Object.fromEntries(savedReceipts.map((doc) => [doc.id, doc]));

      setInvoices(
        invoicesToSave.map((invoice) => {
          const doc = invoice.receiptDocumentId ? docById[invoice.receiptDocumentId] : null;
          return {
            ...invoice,
            receiptFile: null,
            receiptFileName: doc?.fileName ?? invoice.receiptFileName,
            receiptFilePath: doc?.filePath ?? invoice.receiptFilePath,
            receiptFileType: doc?.fileType ?? invoice.receiptFileType,
          };
        }),
      );

      if (!options?.quiet) {
        toast.success(
          options?.closeOnSuccess && formData.status === 'complete'
            ? wasExisting ? 'Ticket closed' : 'Ticket created and closed'
            : wasExisting ? 'Ticket saved' : 'Ticket opened',
        );
      }

      onTicketSaved?.();

      if (options?.closeOnSuccess) {
        onSuccess();
      }

      return logId;
    } catch (error: unknown) {
      if (!options?.quiet) {
        toast.error(formatPersistenceError(error));
      }
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function handleReceiptUpload(invoiceIndex: number, fileOrFiles: File | File[]) {
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    for (const file of files) {
      if (!isReceiptFile(file)) {
        toast.error(`${file.name}: please upload a PDF or image receipt`);
        return;
      }
      if (file.size > MAX_MAINTENANCE_RECEIPT_BYTES) {
        toast.error(formatReceiptSizeLimitMessage(file.name));
        return;
      }
    }

    let nextReceipts = ticketReceipts;
    let nextInvoices = invoices.map((inv) => ({ ...inv, parts: [...inv.parts] }));

    for (const file of files) {
      nextReceipts = appendPendingReceipt(nextReceipts, file);
      const current = nextInvoices[invoiceIndex];
      if (current) {
        nextInvoices[invoiceIndex] = {
          ...current,
          receiptFile: file,
          receiptFileName: file.name,
          receiptFileType: file.type || null,
        };
      }
    }

    setTicketReceipts(nextReceipts);
    setInvoices(nextInvoices);

    try {
      await persistTicket({
        invoicesOverride: nextInvoices,
        receiptsOverride: nextReceipts,
        quiet: true,
        auto: true,
      });
      toast.success(files.length > 1 ? `${files.length} receipts saved` : 'Receipt saved');
    } catch {
      return;
    }

    setExtractingInvoiceIndex(invoiceIndex);
    try {
      const batches: Array<{ file: File; normalized: ReturnType<typeof normalizeExtractedInvoices> }> = [];

      for (const file of files) {
        toast.info(files.length > 1 ? `Scanning ${file.name}...` : 'Scanning receipt...');
        const extractedInvoices = await extractInvoicesFromReceipt(file);
        batches.push({
          file,
          normalized: normalizeExtractedInvoices(
            extractedInvoices.map((inv) => ({
              invoice_number: inv.invoice_number,
              vendor: inv.vendor,
              parts: inv.parts.map((part) => ({
                part_number: part.part_number,
                description: part.description,
                cost: part.cost ? parseFloat(part.cost) : null,
              })),
            })),
          ),
        });
      }

      const normalized = mergeNormalizedInvoices(batches.flatMap((batch) => batch.normalized));
      if (!normalized.length) throw new Error('No invoices or parts found on this receipt');

      let scannedInvoices = nextInvoices;
      let insertAt = invoiceIndex;
      for (const batch of batches) {
        if (!batch.normalized.length) continue;
        scannedInvoices = mergeExtractedIntoInvoiceGroups(
          scannedInvoices,
          insertAt,
          batch.normalized,
          {
            file: batch.file,
            fileName: batch.file.name,
            fileType: batch.file.type || null,
          },
          (parts) => ({
            ...createEmptyInvoiceGroup(),
            parts: parts?.length ? parts : [createEmptyPart()],
          }),
        );
        insertAt = Math.min(insertAt + batch.normalized.length, scannedInvoices.length);
      }

      setInvoices(scannedInvoices);

      await persistTicket({
        invoicesOverride: scannedInvoices,
        receiptsOverride: nextReceipts,
        quiet: true,
        auto: true,
      });

      const invoiceCount = normalized.length;
      const partCount = normalized.reduce((n, inv) => n + inv.parts.length, 0);
      toast.success(
        invoiceCount === 1
          ? partCount === 1
            ? 'Receipt scanned — invoice and part details filled in'
            : `${partCount} line items added for invoice ${normalized[0].invoice_number || ''}`.trim()
          : `${invoiceCount} invoices separated (${partCount} line items total)`,
      );
    } catch (error: any) {
      toast.error(error?.message || 'Could not extract parts from receipt');
    } finally {
      setExtractingInvoiceIndex(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.title.trim() && !ticketReceipts.some((r) => r.file || r.id) && !invoices.some((i) => i.receiptFile)) {
      toast.error('Title is required');
      return;
    }

    try {
      await persistTicket({ closeOnSuccess: true });
    } catch {
      // persistTicket already toasts
    }
  }

  const totalPartsCost = sumInvoiceCosts(invoices);

  const visibleReceipts = useMemo(() => {
    const receipts: TicketReceipt[] = [...ticketReceipts];
    const seen = new Set(
      receipts.map((receipt) => receipt.id || `${receipt.fileName}:${receipt.filePath || 'pending'}`),
    );

    for (const invoice of invoices) {
      if (!invoice.receiptFile) continue;
      const key = `pending:${invoice.receiptFile.name}:${invoice.receiptFile.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      receipts.push({
        fileName: invoice.receiptFile.name,
        fileType: invoice.receiptFile.type || invoice.receiptFileType || null,
        file: invoice.receiptFile,
      });
    }

    return receipts;
  }, [ticketReceipts, invoices]);

  const receiptCards = useMemo(
    () =>
      visibleReceipts.map((receipt, index) => ({
        ...receipt,
        key: receipt.id || `receipt-${index}`,
        previewUrl: receipt.file ? URL.createObjectURL(receipt.file) : receipt.filePath || null,
      })),
    [visibleReceipts],
  );

  useEffect(() => {
    return () => {
      receiptCards.forEach((receipt) => {
        if (receipt.file && receipt.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(receipt.previewUrl);
        }
      });
    };
  }, [receiptCards]);

  function openReceipt(receipt: TicketReceipt & { previewUrl?: string | null }) {
    const url = receipt.previewUrl ?? (receipt.file ? URL.createObjectURL(receipt.file) : receipt.filePath);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  function getInvoiceReceiptPreview(invoice: MaintenanceInvoiceGroup): string | null {
    if (invoice.receiptDocumentId) {
      const match = receiptCards.find((receipt) => receipt.id === invoice.receiptDocumentId);
      if (match?.previewUrl) return match.previewUrl;
    }
    if (invoice.receiptFile) {
      const match = receiptCards.find((receipt) => receipt.file === invoice.receiptFile);
      return match?.previewUrl ?? null;
    }
    return invoice.receiptFilePath || null;
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="left-[50%] top-0 flex h-[100dvh] w-full max-w-xl -translate-x-1/2 translate-y-0 flex-col gap-0 overflow-hidden p-0 rounded-none border-x shadow-xl"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-4 pt-4 pb-3 border-b shrink-0 bg-white">
          <DialogTitle className="text-xl flex items-center gap-2">
            {isEditMode ? 'Maintenance Ticket' : 'New Maintenance Ticket'}
            {(loading || autoSaving) && (
              <span className="text-xs font-normal text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Saving…
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {loadingLog ? (
            <div className="flex-1 flex items-center justify-center py-12">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-yellow-600" />
                <p className="text-sm text-slate-600">Loading ticket...</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service">Service</SelectItem>
                    <SelectItem value="repair">Repair</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="complete">Complete</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Title <span className="text-red-500">*</span></Label>
              <Input
                placeholder="e.g., Oil Change, Brake Repair"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{vehicleType === 'heavy_equipment' ? 'Hours' : 'Mileage'}</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0"
                  value={formData.mileage_hours}
                  onChange={(e) => setFormData({ ...formData, mileage_hours: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Details about the work..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
              />
            </div>

            {visibleReceipts.length > 0 && (
              <div className="space-y-3">
                <Label>Receipts ({visibleReceipts.length})</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {receiptCards.map((receipt) => {
                    const showImage = receipt.previewUrl && isImageReceipt(receipt.fileType, receipt.fileName);
                    const showPdf = isPdfReceipt(receipt.fileType, receipt.fileName);

                    return (
                      <div
                        key={receipt.key}
                        className="border rounded-lg overflow-hidden bg-white shadow-sm"
                      >
                        <button
                          type="button"
                          onClick={() => openReceipt(receipt)}
                          className="w-full text-left"
                        >
                          <div className="aspect-[4/3] bg-slate-100 flex items-center justify-center overflow-hidden">
                            {showImage && receipt.previewUrl ? (
                              <img
                                src={receipt.previewUrl}
                                alt={receipt.fileName}
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <div className="flex flex-col items-center gap-2 p-4 text-slate-500">
                                <FileText className="w-10 h-10" />
                                <span className="text-xs font-medium uppercase">
                                  {showPdf ? 'PDF receipt' : 'Receipt file'}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="px-3 py-2 border-t bg-yellow-50/70">
                            <p className="text-sm font-medium truncate">{receipt.fileName}</p>
                            <p className="text-xs text-slate-500 mt-0.5">Click to open</p>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Invoices & Parts</Label>
                {totalPartsCost > 0 && (
                  <span className="text-xs font-medium text-slate-600">
                    Total: ${totalPartsCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {invoices.map((invoice, invoiceIndex) => (
                  <div key={invoice.clientKey} className="border-2 border-slate-200 rounded-lg p-3 space-y-3 bg-white">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                          {invoice.invoice_number.trim()
                            ? `Invoice ${invoiceIndex + 1} — #${invoice.invoice_number.trim()}`
                            : `Invoice ${invoiceIndex + 1}`}
                        </span>
                        {invoice.parts.some((p) => p.cost.trim()) && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            {invoice.parts.filter((p) => p.description.trim() || p.part_number.trim()).length} item
                            {invoice.parts.filter((p) => p.description.trim() || p.part_number.trim()).length === 1 ? '' : 's'}
                            {' · '}$
                            {sumNormalizedInvoiceParts({
                              invoice_number: invoice.invoice_number,
                              vendor: invoice.vendor,
                              parts: invoice.parts,
                            }).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="file"
                          id={`receipt-inv-${invoiceIndex}`}
                          accept={RECEIPT_ACCEPT}
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const selected = e.target.files;
                            if (selected?.length) {
                              handleReceiptUpload(invoiceIndex, [...selected]);
                            }
                            e.target.value = '';
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={extractingInvoiceIndex === invoiceIndex}
                          onClick={() => document.getElementById(`receipt-inv-${invoiceIndex}`)?.click()}
                        >
                          {extractingInvoiceIndex === invoiceIndex ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <ScanLine className="w-3 h-3" />
                          )}
                          Scan Receipt
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          title="Drag & drop a receipt PDF or photo"
                          className={`h-7 text-xs gap-1 shrink-0 ${
                            dragOverInvoiceIndex === invoiceIndex ? 'border-yellow-600 bg-yellow-50' : ''
                          }`}
                          disabled={extractingInvoiceIndex === invoiceIndex}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverInvoiceIndex(invoiceIndex);
                          }}
                          onDragLeave={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (dragOverInvoiceIndex === invoiceIndex) setDragOverInvoiceIndex(null);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverInvoiceIndex(null);
                            const dropped = [...e.dataTransfer.files].filter(isReceiptFile);
                            if (dropped.length) handleReceiptUpload(invoiceIndex, dropped);
                          }}
                          onClick={() => document.getElementById(`receipt-inv-${invoiceIndex}`)?.click()}
                        >
                          <Upload className="w-3 h-3" />
                          Drop
                        </Button>
                        {invoices.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                            onClick={() => removeInvoice(invoiceIndex)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        placeholder="Invoice number"
                        value={invoice.invoice_number}
                        onChange={(e) => updateInvoice(invoiceIndex, { invoice_number: e.target.value })}
                        className="h-8 text-sm"
                      />
                      <Input
                        placeholder="Vendor"
                        value={invoice.vendor}
                        onChange={(e) => updateInvoice(invoiceIndex, { vendor: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </div>

                    {(invoice.receiptFile || invoice.receiptFileName) && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs bg-yellow-50 border border-yellow-200 p-2 rounded">
                          <span className="flex items-center gap-1 min-w-0">
                            <FileText className="w-3 h-3 shrink-0" />
                            <span className="truncate">{invoice.receiptFile?.name || invoice.receiptFileName}</span>
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {(invoice.receiptFile || invoice.receiptFilePath) && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-5 text-xs px-1"
                                onClick={() =>
                                  openReceipt({
                                    fileName: invoice.receiptFile?.name || invoice.receiptFileName || 'Receipt',
                                    filePath: invoice.receiptFilePath,
                                    fileType: invoice.receiptFile?.type || invoice.receiptFileType,
                                    file: invoice.receiptFile,
                                    previewUrl: getInvoiceReceiptPreview(invoice),
                                  })
                                }
                              >
                                View
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0"
                              onClick={() =>
                                updateInvoice(invoiceIndex, {
                                  receiptFile: null,
                                  receiptFileName: null,
                                  receiptFilePath: null,
                                  receiptFileType: null,
                                  receiptDocumentId: null,
                                })
                              }
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 pl-2 border-l-2 border-yellow-200">
                      {invoice.parts.map((part, partIndex) => (
                        <div key={part.id || `part-${invoiceIndex}-${partIndex}`} className="border rounded-lg p-2 space-y-2 bg-slate-50/50">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-slate-500">Part {partIndex + 1}</span>
                            {invoice.parts.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-slate-400 hover:text-red-600"
                                onClick={() => removePartFromInvoice(invoiceIndex, partIndex)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              placeholder="Part number"
                              value={part.part_number}
                              onChange={(e) => updatePart(invoiceIndex, partIndex, { part_number: e.target.value })}
                              className="h-8 text-sm"
                            />
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="Cost"
                              value={part.cost}
                              onChange={(e) => updatePart(invoiceIndex, partIndex, { cost: e.target.value })}
                              className="h-8 text-sm"
                            />
                          </div>
                          <Input
                            placeholder="Description"
                            value={part.description}
                            onChange={(e) => updatePart(invoiceIndex, partIndex, { description: e.target.value })}
                            className="h-8 text-sm"
                          />
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full border-dashed text-xs"
                        onClick={() => addPartToInvoice(invoiceIndex)}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add Part to Invoice
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full border-dashed border-yellow-600 text-yellow-700 hover:bg-yellow-50"
                onClick={addInvoice}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Invoice
              </Button>
            </div>
              </div>

              <div className="shrink-0 border-t px-4 py-3 flex gap-2 bg-white">
                <Button type="button" variant="outline" onClick={() => onClose()} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={loading} className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-black">
                  {loading ? 'Saving...' : formData.status === 'complete' ? 'Save & Close Ticket' : isEditMode ? 'Save Ticket' : 'Open Ticket'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
