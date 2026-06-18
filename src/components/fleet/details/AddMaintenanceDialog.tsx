import { useEffect, useState } from 'react';
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
  receiptFile?: File | null;
  receiptDocumentId?: string | null;
  receiptFileName?: string | null;
  receiptFilePath?: string | null;
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
  return { part_number: '', description: '', cost: '', receiptFile: null };
}

const RECEIPT_ACCEPT = '.pdf,application/pdf,image/jpeg,image/png,image/webp,image/gif';

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

function sumPartCosts(parts: MaintenanceLogPart[]): number {
  return parts.reduce((sum, part) => {
    const cost = parseFloat(part.cost);
    return sum + (Number.isFinite(cost) ? cost : 0);
  }, 0);
}

function formatPartNumbers(parts: MaintenanceLogPart[]): string | null {
  const numbers = parts.map((p) => p.part_number.trim()).filter(Boolean);
  return numbers.length > 0 ? numbers.join(', ') : null;
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
  const [extractingPartIndex, setExtractingPartIndex] = useState<number | null>(null);
  const [dragOverPartIndex, setDragOverPartIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [parts, setParts] = useState<MaintenanceLogPart[]>([createEmptyPart()]);

  const isEditMode = Boolean(editLogId);

  useEffect(() => {
    if (!open) return;
    if (editLogId) {
      loadExistingLog(editLogId);
    } else {
      setFormData({ ...INITIAL_FORM, date: new Date().toISOString().split('T')[0] });
      setParts([createEmptyPart()]);
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

      const { data: existingParts, error: partsError } = await supabase
        .from('maintenance_log_parts')
        .select(`
          id, part_number, description, cost, receipt_document_id,
          maintenance_log_documents:receipt_document_id ( id, file_name, file_path )
        `)
        .eq('maintenance_log_id', logId)
        .order('order_index', { ascending: true });

      if (partsError) {
        setParts([createEmptyPart()]);
      } else if (existingParts?.length) {
        setParts(
          existingParts.map((part: any) => ({
            id: part.id,
            part_number: part.part_number || '',
            description: part.description || '',
            cost: part.cost != null ? String(part.cost) : '',
            receiptDocumentId: part.receipt_document_id,
            receiptFileName: part.maintenance_log_documents?.file_name || null,
            receiptFilePath: part.maintenance_log_documents?.file_path || null,
          })),
        );
      } else {
        setParts([createEmptyPart()]);
      }
    } catch (error: any) {
      toast.error('Failed to load maintenance ticket');
    } finally {
      setLoadingLog(false);
    }
  }

  function updatePart(index: number, updates: Partial<MaintenanceLogPart>) {
    setParts((prev) => prev.map((part, i) => (i === index ? { ...part, ...updates } : part)));
  }

  function addPart() {
    setParts((prev) => [...prev, createEmptyPart()]);
  }

  function removePart(index: number) {
    setParts((prev) => (prev.length <= 1 ? [createEmptyPart()] : prev.filter((_, i) => i !== index)));
  }

  async function extractPartsFromReceipt(file: File): Promise<MaintenanceLogPart[]> {
    const base64 = await fileToBase64(file);
    const { data, error } = await supabase.functions.invoke('extract-maintenance-receipt', {
      body: { fileBase64: base64, mimeType: file.type || 'application/pdf' },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    const extracted = (data?.parts || []) as Array<{ part_number?: string; description?: string; cost?: number | null }>;
    if (!extracted.length) throw new Error('No parts found on this receipt');

    return extracted.map((item) => ({
      part_number: item.part_number || '',
      description: item.description || '',
      cost: item.cost != null ? String(item.cost) : '',
      receiptFile: file,
    }));
  }

  async function handleReceiptUpload(index: number, file: File) {
    if (!isReceiptFile(file)) {
      toast.error('Please upload a PDF or image receipt');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(`${file.name} must be less than 10MB`);
      return;
    }

    setExtractingPartIndex(index);
    try {
      toast.info('Scanning receipt...');
      const extractedParts = await extractPartsFromReceipt(file);
      setParts((prev) => {
        const next = [...prev];
        next.splice(index, 1, ...extractedParts);
        return next;
      });
      toast.success(
        extractedParts.length === 1
          ? 'Receipt scanned — part details filled in'
          : `${extractedParts.length} parts added from receipt`,
      );
    } catch (error: any) {
      toast.error(error?.message || 'Could not extract parts from receipt');
      updatePart(index, { receiptFile: file, receiptFileName: file.name });
    } finally {
      setExtractingPartIndex(null);
    }
  }

  async function uploadPartReceipt(logId: string, partId: string, file: File): Promise<string> {
    const fileName = `${vehicleId}/maintenance-logs/${logId}/parts/${partId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('vehicle-documents').upload(fileName, file);
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('vehicle-documents').getPublicUrl(fileName);
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

  async function saveParts(logId: string, partsToSave: MaintenanceLogPart[]) {
    const meaningfulParts = partsToSave.filter(
      (p) => p.part_number.trim() || p.description.trim() || p.cost.trim() || p.receiptFile || p.receiptDocumentId,
    );

    if (isEditMode && editLogId) {
      const { data: existing } = await supabase.from('maintenance_log_parts').select('id').eq('maintenance_log_id', logId);
      const existingIds = new Set((existing || []).map((p) => p.id));
      const keptIds = new Set(meaningfulParts.filter((p) => p.id).map((p) => p.id!));
      const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
      if (toDelete.length) await supabase.from('maintenance_log_parts').delete().in('id', toDelete);
    }

    for (let i = 0; i < meaningfulParts.length; i++) {
      const part = meaningfulParts[i];
      const payload = {
        maintenance_log_id: logId,
        part_number: part.part_number.trim() || null,
        description: part.description.trim() || null,
        cost: part.cost ? parseFloat(part.cost) : null,
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
      }

      if (part.receiptFile && partId) {
        const docId = await uploadPartReceipt(logId, partId, part.receiptFile);
        await supabase.from('maintenance_log_parts').update({ receipt_document_id: docId }).eq('id', partId);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.title.trim()) {
      toast.error('Title is required');
      return;
    }

    setLoading(true);
    try {
      const totalCost = sumPartCosts(parts);
      const logPayload = {
        vehicle_id: vehicleId,
        type: formData.type,
        status: formData.status,
        title: formData.title,
        date: formData.date,
        mileage_hours: formData.mileage_hours ? parseFloat(formData.mileage_hours) : null,
        description: formData.description || null,
        part_numbers: formatPartNumbers(parts),
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

      try {
        await saveParts(logId, parts);
      } catch (partsError: any) {
        if (parts.some((p) => p.part_number || p.description || p.cost || p.receiptFile)) {
          toast.error(partsError?.message || 'Could not save parts — run the database migration');
        }
      }

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

  const totalPartsCost = sumPartCosts(parts);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Maintenance Ticket' : 'New Maintenance Ticket'}</DialogTitle>
        </DialogHeader>

        {loadingLog ? (
          <div className="py-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-yellow-600" />
            <p className="text-sm text-slate-600">Loading ticket...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
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

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Parts</Label>
                {totalPartsCost > 0 && (
                  <span className="text-xs font-medium text-slate-600">
                    Total: ${totalPartsCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {parts.map((part, index) => (
                  <div key={part.id || `part-${index}`} className="border rounded-lg p-3 space-y-2 bg-slate-50/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-500">Part {index + 1}</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="file"
                          id={`receipt-${index}`}
                          accept={RECEIPT_ACCEPT}
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleReceiptUpload(index, file);
                            e.target.value = '';
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={extractingPartIndex === index}
                          onClick={() => document.getElementById(`receipt-${index}`)?.click()}
                        >
                          {extractingPartIndex === index ? (
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
                            dragOverPartIndex === index ? 'border-yellow-600 bg-yellow-50' : ''
                          }`}
                          disabled={extractingPartIndex === index}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverPartIndex(index);
                          }}
                          onDragLeave={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (dragOverPartIndex === index) setDragOverPartIndex(null);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverPartIndex(null);
                            const file = e.dataTransfer.files?.[0];
                            if (file) handleReceiptUpload(index, file);
                          }}
                          onClick={() => document.getElementById(`receipt-${index}`)?.click()}
                        >
                          <Upload className="w-3 h-3" />
                          Drop
                        </Button>
                        {parts.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                            onClick={() => removePart(index)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        placeholder="Part number"
                        value={part.part_number}
                        onChange={(e) => updatePart(index, { part_number: e.target.value })}
                        className="h-8 text-sm"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Cost"
                        value={part.cost}
                        onChange={(e) => updatePart(index, { cost: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </div>
                    <Input
                      placeholder="Description"
                      value={part.description}
                      onChange={(e) => updatePart(index, { description: e.target.value })}
                      className="h-8 text-sm"
                    />
                    {(part.receiptFile || part.receiptFileName) && (
                      <div className="flex items-center justify-between text-xs bg-yellow-50 border border-yellow-200 p-2 rounded">
                        <span className="flex items-center gap-1 min-w-0">
                          <FileText className="w-3 h-3 shrink-0" />
                          <span className="truncate">{part.receiptFile?.name || part.receiptFileName}</span>
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {part.receiptFilePath && (
                            <Button type="button" variant="ghost" size="sm" className="h-5 text-xs px-1" onClick={() => window.open(part.receiptFilePath!, '_blank')}>
                              View
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0"
                            onClick={() => updatePart(index, { receiptFile: null, receiptFileName: null, receiptFilePath: null, receiptDocumentId: null })}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <Button type="button" variant="outline" size="sm" className="w-full border-dashed border-yellow-600 text-yellow-700 hover:bg-yellow-50" onClick={addPart}>
                <Plus className="w-4 h-4 mr-2" />
                Add Part
              </Button>
              <p className="text-xs text-slate-500">
                Use Scan Receipt or drag a file onto Drop. Leave status as In Progress to add more later.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onClose()} className="flex-1">Cancel</Button>
              <Button type="submit" disabled={loading} className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-black">
                {loading ? 'Saving...' : formData.status === 'complete' ? 'Save & Close Ticket' : isEditMode ? 'Save Ticket' : 'Open Ticket'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
