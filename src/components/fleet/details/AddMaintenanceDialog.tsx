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

function invoiceGroupKey(invoice_number: string, vendor: string): string {
  return `${invoice_number.trim().toLowerCase()}::${vendor.trim().toLowerCase()}`;
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

/** Matches Supabase storage bucket limit (50MiB in config.toml). */
const MAX_RECEIPT_BYTES = 50 * 1024 * 1024;

/** Above this size, upload to storage and pass a signed URL (avoids edge function body limits). */
const RECEIPT_BASE64_MAX_BYTES = 8 * 1024 * 1024;

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
  editLogId,
}: AddMaintenanceDialogProps) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loadingLog, setLoadingLog] = useState(false);
  const [extractingInvoiceIndex, setExtractingInvoiceIndex] = useState<number | null>(null);
  const [dragOverInvoiceIndex, setDragOverInvoiceIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [invoices, setInvoices] = useState<MaintenanceInvoiceGroup[]>([createEmptyInvoiceGroup()]);
  const [ticketReceipts, setTicketReceipts] = useState<TicketReceipt[]>([]);

  const isEditMode = Boolean(editLogId);

  useEffect(() => {
    if (!open) return;
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

      const { data: allDocs, error: docsError } = await supabase
        .from('maintenance_log_documents')
        .select('id, file_name, file_path, file_type, maintenance_log_part_id')
        .eq('maintenance_log_id', logId)
        .order('uploaded_at', { ascending: true });

      if (docsError) throw docsError;

      const docById = Object.fromEntries((allDocs || []).map((doc) => [doc.id, doc]));

      setTicketReceipts(
        (allDocs || []).map((doc) => ({
          id: doc.id,
          fileName: doc.file_name,
          filePath: doc.file_path,
          fileType: doc.file_type,
          maintenanceLogPartId: doc.maintenance_log_part_id,
        })),
      );

      const { data: existingParts, error: partsError } = await supabase
        .from('maintenance_log_parts')
        .select('id, part_number, description, cost, receipt_document_id, invoice_number, vendor')
        .eq('maintenance_log_id', logId)
        .order('order_index', { ascending: true });

      if (partsError) {
        setInvoices([createEmptyInvoiceGroup()]);
      } else if (existingParts?.length) {
        const groupMap = new Map<string, MaintenanceInvoiceGroup>();

        for (const part of existingParts) {
          const invNum = part.invoice_number || '';
          const vendor = part.vendor || '';
          const key = invoiceGroupKey(invNum, vendor) || `__ungrouped__${part.id}`;

          const linkedDoc =
            (part.receipt_document_id ? docById[part.receipt_document_id] : null) ||
            (allDocs || []).find((doc) => doc.maintenance_log_part_id === part.id) ||
            null;

          if (!groupMap.has(key)) {
            groupMap.set(key, {
              clientKey: `inv-${part.id}`,
              invoice_number: invNum,
              vendor,
              receiptDocumentId: linkedDoc?.id || part.receipt_document_id || null,
              receiptFileName: linkedDoc?.file_name || null,
              receiptFilePath: linkedDoc?.file_path || null,
              receiptFileType: linkedDoc?.file_type || null,
              receiptFile: null,
              parts: [],
            });
          }

          const group = groupMap.get(key)!;
          if (!group.receiptDocumentId && linkedDoc) {
            group.receiptDocumentId = linkedDoc.id;
            group.receiptFileName = linkedDoc.file_name;
            group.receiptFilePath = linkedDoc.file_path;
            group.receiptFileType = linkedDoc.file_type;
          }

          group.parts.push({
            id: part.id,
            part_number: part.part_number || '',
            description: part.description || '',
            cost: part.cost != null ? String(part.cost) : '',
          });
        }

        setInvoices([...groupMap.values()]);
      } else {
        setInvoices([createEmptyInvoiceGroup()]);
      }
    } catch (error: any) {
      toast.error('Failed to load maintenance ticket');
    } finally {
      setLoadingLog(false);
    }
  }

  function registerPendingReceipt(file: File) {
    setTicketReceipts((prev) => {
      const alreadyListed = prev.some(
        (receipt) =>
          receipt.file === file ||
          (receipt.fileName === file.name && !receipt.id),
      );
      if (alreadyListed) return prev;
      return [
        ...prev,
        {
          fileName: file.name,
          fileType: file.type || null,
          file,
        },
      ];
    });
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

    if (file.size > RECEIPT_BASE64_MAX_BYTES) {
      const tempPath = `${vehicleId}/maintenance-logs/temp-receipts/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from('vehicle-documents').upload(tempPath, file);
      if (uploadError) throw uploadError;

      const { data: signed, error: signError } = await supabase.storage
        .from('vehicle-documents')
        .createSignedUrl(tempPath, 3600);
      if (signError || !signed?.signedUrl) {
        throw signError || new Error('Could not prepare receipt for scanning');
      }
      invokeBody = { fileUrl: signed.signedUrl, mimeType };
    } else {
      const base64 = await fileToBase64(file);
      invokeBody = { fileBase64: base64, mimeType };
    }

    const { data, error } = await supabase.functions.invoke('extract-maintenance-receipt', {
      body: invokeBody,
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    const extracted = (data?.invoices || []) as Array<{
      invoice_number?: string;
      vendor?: string;
      parts?: Array<{ part_number?: string; description?: string; cost?: number | null }>;
    }>;

    if (!extracted.length) throw new Error('No invoices or parts found on this receipt');

    return extracted.map((inv) => ({
      clientKey: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      invoice_number: inv.invoice_number || '',
      vendor: inv.vendor || '',
      receiptFile: file,
      receiptFileName: file.name,
      receiptFileType: file.type || null,
      parts: (inv.parts || []).length
        ? (inv.parts || []).map((item) => ({
            part_number: item.part_number || '',
            description: item.description || '',
            cost: item.cost != null ? String(item.cost) : '',
          }))
        : [createEmptyPart()],
    }));
  }

  async function handleReceiptUpload(invoiceIndex: number, file: File) {
    if (!isReceiptFile(file)) {
      toast.error('Please upload a PDF or image receipt');
      return;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      toast.error(`${file.name} must be less than 50MB`);
      return;
    }

    setExtractingInvoiceIndex(invoiceIndex);
    try {
      toast.info('Scanning receipt...');
      const extractedInvoices = await extractInvoicesFromReceipt(file);
      registerPendingReceipt(file);

      setInvoices((prev) => {
        const next = [...prev];
        if (extractedInvoices.length === 1) {
          const scanned = extractedInvoices[0];
          const current = next[invoiceIndex];
          next[invoiceIndex] = {
            ...current,
            invoice_number: scanned.invoice_number || current.invoice_number,
            vendor: scanned.vendor || current.vendor,
            receiptFile: file,
            receiptFileName: file.name,
            receiptFileType: file.type || null,
            parts: scanned.parts,
          };
        } else {
          next.splice(invoiceIndex, 1, ...extractedInvoices);
        }
        return next;
      });

      const partCount = extractedInvoices.reduce((n, inv) => n + inv.parts.length, 0);
      toast.success(
        extractedInvoices.length === 1
          ? partCount === 1
            ? 'Receipt scanned — invoice and part details filled in'
            : `${partCount} parts added from invoice`
          : `${extractedInvoices.length} invoices separated (${partCount} parts total)`,
      );
    } catch (error: any) {
      toast.error(error?.message || 'Could not extract parts from receipt');
      registerPendingReceipt(file);
      updateInvoice(invoiceIndex, {
        receiptFile: file,
        receiptFileName: file.name,
        receiptFileType: file.type || null,
      });
    } finally {
      setExtractingInvoiceIndex(null);
    }
  }

  async function uploadInvoiceReceipt(
    logId: string,
    file: File,
    partId: string | null,
  ): Promise<string> {
    const pathSegment = partId
      ? `parts/${partId}`
      : `invoices/${Date.now()}`;
    const storagePath = `${vehicleId}/maintenance-logs/${logId}/${pathSegment}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('vehicle-documents').upload(storagePath, file);
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('vehicle-documents').getPublicUrl(storagePath);
    const { data: doc, error: dbError } = await supabase
      .from('maintenance_log_documents')
      .insert({
        maintenance_log_id: logId,
        maintenance_log_part_id: partId,
        file_name: file.name,
        file_path: publicUrl,
        file_size: file.size,
        file_type: file.type || 'application/pdf',
        uploaded_by: profile?.username || 'unknown',
      })
      .select('id')
      .single();
    if (dbError) throw dbError;
    return doc.id;
  }

  async function saveInvoices(logId: string, invoicesToSave: MaintenanceInvoiceGroup[]) {
    const rows: Array<{ part: MaintenanceLogPart; invoice: MaintenanceInvoiceGroup }> = [];

    for (const invoice of invoicesToSave) {
      const invoiceHasMeta =
        invoice.invoice_number.trim() ||
        invoice.vendor.trim() ||
        invoice.receiptFile ||
        invoice.receiptDocumentId;

      for (const part of invoice.parts) {
        if (
          part.part_number.trim() ||
          part.description.trim() ||
          part.cost.trim() ||
          invoiceHasMeta
        ) {
          rows.push({ part, invoice });
        }
      }

      // Receipt-only invoice with no part lines yet — still persist a placeholder part row.
      if (invoiceHasMeta && invoice.parts.every((p) => !p.part_number.trim() && !p.description.trim() && !p.cost.trim())) {
        rows.push({ part: invoice.parts[0] ?? createEmptyPart(), invoice });
      }
    }

    if (isEditMode && editLogId) {
      const { data: existing } = await supabase.from('maintenance_log_parts').select('id').eq('maintenance_log_id', logId);
      const existingIds = new Set((existing || []).map((p) => p.id));
      const keptIds = new Set(rows.filter((r) => r.part.id).map((r) => r.part.id!));
      const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
      if (toDelete.length) await supabase.from('maintenance_log_parts').delete().in('id', toDelete);
    }

    const firstPartIdByInvoice = new Map<string, string>();
    const receiptUploadedForInvoice = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const { part, invoice } = rows[i];
      const payload = {
        maintenance_log_id: logId,
        part_number: part.part_number.trim() || null,
        description: part.description.trim() || null,
        cost: part.cost ? parseFloat(part.cost) : null,
        invoice_number: invoice.invoice_number.trim() || null,
        vendor: invoice.vendor.trim() || null,
        order_index: i,
      };

      let partId = part.id;
      if (partId) {
        const { error } = await supabase.from('maintenance_log_parts').update(payload).eq('id', partId);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase.from('maintenance_log_parts').insert(payload).select('id').single();
        if (error) throw error;
        partId = inserted.id;
        part.id = partId;
      }

      if (!firstPartIdByInvoice.has(invoice.clientKey)) {
        firstPartIdByInvoice.set(invoice.clientKey, partId);
      }
    }

    for (const invoice of invoicesToSave) {
      if (!invoice.receiptFile || receiptUploadedForInvoice.has(invoice.clientKey)) continue;

      const partId = firstPartIdByInvoice.get(invoice.clientKey) ?? null;
      const docId = await uploadInvoiceReceipt(logId, invoice.receiptFile, partId);

      if (partId) {
        await supabase
          .from('maintenance_log_parts')
          .update({ receipt_document_id: docId })
          .eq('id', partId);
      }

      invoice.receiptDocumentId = docId;
      invoice.receiptFile = null;
      receiptUploadedForInvoice.add(invoice.clientKey);
    }

    const { data: refreshedDocs } = await supabase
      .from('maintenance_log_documents')
      .select('id, file_name, file_path, file_type, maintenance_log_part_id')
      .eq('maintenance_log_id', logId)
      .order('uploaded_at', { ascending: true });

    setTicketReceipts(
      (refreshedDocs || []).map((doc) => ({
        id: doc.id,
        fileName: doc.file_name,
        filePath: doc.file_path,
        fileType: doc.file_type,
        maintenanceLogPartId: doc.maintenance_log_part_id,
      })),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.title.trim()) {
      toast.error('Title is required');
      return;
    }

    setLoading(true);
    try {
      const totalCost = sumInvoiceCosts(invoices);
      const logPayload = {
        vehicle_id: vehicleId,
        type: formData.type,
        status: formData.status,
        title: formData.title,
        date: formData.date,
        mileage_hours: formData.mileage_hours ? parseFloat(formData.mileage_hours) : null,
        description: formData.description || null,
        part_numbers: formatPartNumbersFromInvoices(invoices),
        part_cost: totalCost > 0 ? totalCost : null,
      };

      let logId = editLogId;
      if (isEditMode && editLogId) {
        const { error } = await supabase.from('maintenance_logs').update(logPayload).eq('id', editLogId);
        if (error) throw error;
      } else {
        const { data: logData, error } = await supabase
          .from('maintenance_logs')
          .insert({ ...logPayload, created_by: profile?.username || 'unknown' })
          .select('id')
          .single();
        if (error) throw error;
        logId = logData.id;
      }

      if (!logId) throw new Error('Failed to save ticket');

      await saveInvoices(logId, invoices);

      toast.success(
        formData.status === 'complete'
          ? isEditMode ? 'Ticket closed' : 'Ticket created and closed'
          : isEditMode ? 'Ticket saved' : 'Ticket opened',
      );
      onSuccess();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save ticket');
    } finally {
      setLoading(false);
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
          <DialogTitle className="text-xl">
            {isEditMode ? 'Maintenance Ticket' : 'New Maintenance Ticket'}
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
                      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                        Invoice {invoiceIndex + 1}
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="file"
                          id={`receipt-inv-${invoiceIndex}`}
                          accept={RECEIPT_ACCEPT}
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleReceiptUpload(invoiceIndex, file);
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
                            const file = e.dataTransfer.files?.[0];
                            if (file) handleReceiptUpload(invoiceIndex, file);
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
