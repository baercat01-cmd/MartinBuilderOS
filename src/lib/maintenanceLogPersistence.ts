import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type MaintenanceLogPartRow = {
  id?: string;
  part_number: string;
  description: string;
  cost: string;
};

export type MaintenanceInvoiceSaveGroup = {
  clientKey: string;
  invoice_number: string;
  vendor: string;
  receiptFile?: File | null;
  receiptDocumentId?: string | null;
  receiptFileName?: string | null;
  receiptFilePath?: string | null;
  receiptFileType?: string | null;
  parts: MaintenanceLogPartRow[];
};

export type PendingTicketReceipt = {
  id?: string;
  fileName: string;
  filePath?: string | null;
  fileType?: string | null;
  file?: File | null;
};

export type SavedTicketReceipt = {
  id: string;
  fileName: string;
  filePath: string;
  fileType: string | null;
  maintenanceLogPartId?: string | null;
};

type MaintenanceNotesPayload = {
  __maintenance_v1: true;
  invoices: Array<{
    clientKey: string;
    invoice_number: string;
    vendor: string;
    parts: MaintenanceLogPartRow[];
    receiptDocumentIds?: string[];
  }>;
  orphanReceiptIds?: string[];
};

export type MaintenancePersistenceMode = 'native' | 'legacy';

export type MaintenancePersistenceCapabilities = {
  mode: MaintenancePersistenceMode;
  partsTable: boolean;
  documentsTable: boolean;
};

const STORAGE_BUCKETS = ['vehicle-documents', 'job-files'] as const;

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message || '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('could not find the table')
  );
}

function isStoragePolicyError(error: { message?: string; statusCode?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message || '').toLowerCase();
  return (
    error.statusCode === '403' ||
    message.includes('row-level security') ||
    message.includes('policy') ||
    message.includes('not found')
  );
}

function maintenanceLogDescription(logId: string, suffix?: string): string {
  return suffix ? `maintenance_log:${logId}:${suffix}` : `maintenance_log:${logId}`;
}

function encodeNotesPayload(payload: MaintenanceNotesPayload): string {
  return JSON.stringify(payload);
}

export function decodeMaintenanceNotesPayload(notes: string | null | undefined): MaintenanceNotesPayload | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as MaintenanceNotesPayload;
    return parsed?.__maintenance_v1 ? parsed : null;
  } catch {
    return null;
  }
}

let cachedCapabilities: MaintenancePersistenceCapabilities | null = null;

export async function getMaintenancePersistenceCapabilities(
  client: SupabaseClient = supabase,
): Promise<MaintenancePersistenceCapabilities> {
  if (cachedCapabilities) return cachedCapabilities;

  const partsProbe = await client.from('maintenance_log_parts').select('id').limit(1);
  const partsTable = !isMissingTableError(partsProbe.error);

  const docsProbe = await client.from('maintenance_log_documents').select('id').limit(1);
  const documentsTable = !isMissingTableError(docsProbe.error);

  cachedCapabilities = {
    mode: partsTable && documentsTable ? 'native' : 'legacy',
    partsTable,
    documentsTable,
  };
  return cachedCapabilities;
}

export function clearMaintenancePersistenceCache(): void {
  cachedCapabilities = null;
}

async function uploadFileToMaintenanceStorage(relativePath: string, file: File): Promise<string> {
  let lastError: Error | null = null;
  for (const bucket of STORAGE_BUCKETS) {
    const storagePath = bucket === 'job-files' ? `fleet-maintenance/${relativePath}` : relativePath;
    const { error } = await clientUpload(bucket, storagePath, file);
    if (!error) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
      return data.publicUrl;
    }
    lastError = new Error(error.message);
    if (!isStoragePolicyError(error)) break;
  }
  throw lastError || new Error('Could not upload receipt file to storage');
}

async function uploadReceiptToStorage(
  vehicleId: string,
  logId: string,
  file: File,
  partId: string | null,
): Promise<string> {
  const pathSegment = partId ? `parts/${partId}` : `invoices/${Date.now()}`;
  const relativePath = `${vehicleId}/maintenance-logs/${logId}/${pathSegment}/${Date.now()}-${file.name}`;
  return uploadFileToMaintenanceStorage(relativePath, file);
}

export async function uploadTempReceiptForScan(vehicleId: string, file: File): Promise<string> {
  const relativePath = `${vehicleId}/maintenance-logs/temp-receipts/${Date.now()}-${file.name}`;
  const publicUrl = await uploadFileToMaintenanceStorage(relativePath, file);
  return publicUrl;
}

async function clientUpload(bucket: string, path: string, file: File) {
  return supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
}

async function insertDocumentRecord(
  capabilities: MaintenancePersistenceCapabilities,
  params: {
    vehicleId: string;
    logId: string;
    partId: string | null;
    file: File;
    publicUrl: string;
    uploadedBy: string;
    invoiceClientKey?: string;
  },
): Promise<string> {
  const { vehicleId, logId, partId, file, publicUrl, uploadedBy, invoiceClientKey } = params;

  if (capabilities.documentsTable) {
    const { data, error } = await supabase
      .from('maintenance_log_documents')
      .insert({
        maintenance_log_id: logId,
        maintenance_log_part_id: partId,
        file_name: file.name,
        file_path: publicUrl,
        file_size: file.size,
        file_type: file.type || 'application/pdf',
        uploaded_by: uploadedBy,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  const { data, error } = await supabase
    .from('vehicle_documents')
    .insert({
      vehicle_id: vehicleId,
      file_name: file.name,
      file_path: publicUrl,
      file_size: file.size,
      file_type: file.type || 'application/pdf',
      uploaded_by: uploadedBy,
      description: maintenanceLogDescription(logId, invoiceClientKey),
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function uploadReceiptFile(
  capabilities: MaintenancePersistenceCapabilities,
  params: {
    vehicleId: string;
    logId: string;
    file: File;
    partId: string | null;
    uploadedBy: string;
    invoiceClientKey?: string;
  },
): Promise<string> {
  const publicUrl = await uploadReceiptToStorage(params.vehicleId, params.logId, params.file, params.partId);
  return insertDocumentRecord(capabilities, { ...params, publicUrl });
}

async function loadLegacyDocuments(vehicleId: string, logId: string) {
  const { data, error } = await supabase
    .from('vehicle_documents')
    .select('id, file_name, file_path, file_type, description, uploaded_at')
    .eq('vehicle_id', vehicleId)
    .like('description', `${maintenanceLogDescription(logId)}%`)
    .order('uploaded_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function loadMaintenanceTicketArtifacts(
  vehicleId: string,
  logId: string,
  notes: string | null | undefined,
): Promise<{
  receipts: SavedTicketReceipt[];
  invoices: MaintenanceInvoiceSaveGroup[];
}> {
  const capabilities = await getMaintenancePersistenceCapabilities();

  if (capabilities.mode === 'native') {
    const { data: docs, error: docsError } = await supabase
      .from('maintenance_log_documents')
      .select('id, file_name, file_path, file_type, maintenance_log_part_id')
      .eq('maintenance_log_id', logId)
      .order('uploaded_at', { ascending: true });
    if (docsError) throw docsError;

    const { data: parts, error: partsError } = await supabase
      .from('maintenance_log_parts')
      .select('id, part_number, description, cost, receipt_document_id, invoice_number, vendor')
      .eq('maintenance_log_id', logId)
      .order('order_index', { ascending: true });
    if (partsError) throw partsError;

    const docById = Object.fromEntries((docs || []).map((doc) => [doc.id, doc]));
    const groupMap = new Map<string, MaintenanceInvoiceSaveGroup>();

    for (const part of parts || []) {
      const invNum = part.invoice_number || '';
      const vendor = part.vendor || '';
      const key = `${invNum.trim().toLowerCase()}::${vendor.trim().toLowerCase()}` || `__ungrouped__${part.id}`;

      const linkedDoc =
        (part.receipt_document_id ? docById[part.receipt_document_id] : null) ||
        (docs || []).find((doc) => doc.maintenance_log_part_id === part.id) ||
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

    return {
      receipts: (docs || []).map((doc) => ({
        id: doc.id,
        fileName: doc.file_name,
        filePath: doc.file_path,
        fileType: doc.file_type,
        maintenanceLogPartId: doc.maintenance_log_part_id,
      })),
      invoices: groupMap.size ? [...groupMap.values()] : [],
    };
  }

  const legacyDocs = await loadLegacyDocuments(vehicleId, logId);
  const payload = decodeMaintenanceNotesPayload(notes);
  const docById = Object.fromEntries(legacyDocs.map((doc) => [doc.id, doc]));

  const invoices: MaintenanceInvoiceSaveGroup[] = (payload?.invoices || []).map((inv) => {
    const receiptIds = inv.receiptDocumentIds || [];
    const linkedDoc = receiptIds.map((id) => docById[id]).find(Boolean) || null;
    return {
      clientKey: inv.clientKey,
      invoice_number: inv.invoice_number,
      vendor: inv.vendor,
      receiptDocumentId: linkedDoc?.id || receiptIds[0] || null,
      receiptFileName: linkedDoc?.file_name || null,
      receiptFilePath: linkedDoc?.file_path || null,
      receiptFileType: linkedDoc?.file_type || null,
      receiptFile: null,
      parts: inv.parts.map((part) => ({
        part_number: part.part_number || '',
        description: part.description || '',
        cost: part.cost || '',
      })),
    };
  });

  const receipts: SavedTicketReceipt[] = legacyDocs.map((doc) => ({
    id: doc.id,
    fileName: doc.file_name,
    filePath: doc.file_path,
    fileType: doc.file_type,
    maintenanceLogPartId: null,
  }));

  return { receipts, invoices };
}

export async function saveMaintenanceTicketInvoices(params: {
  vehicleId: string;
  logId: string;
  invoices: MaintenanceInvoiceSaveGroup[];
  pendingReceipts: PendingTicketReceipt[];
  uploadedBy: string;
  isEditMode: boolean;
}): Promise<SavedTicketReceipt[]> {
  const { vehicleId, logId, invoices, pendingReceipts, uploadedBy, isEditMode } = params;
  const capabilities = await getMaintenancePersistenceCapabilities();

  if (capabilities.mode === 'native') {
    return saveNativeInvoices({ vehicleId, logId, invoices, pendingReceipts, uploadedBy, isEditMode, capabilities });
  }

  return saveLegacyInvoices({ vehicleId, logId, invoices, pendingReceipts, uploadedBy, capabilities });
}

async function saveNativeInvoices(params: {
  vehicleId: string;
  logId: string;
  invoices: MaintenanceInvoiceSaveGroup[];
  pendingReceipts: PendingTicketReceipt[];
  uploadedBy: string;
  isEditMode: boolean;
  capabilities: MaintenancePersistenceCapabilities;
}): Promise<SavedTicketReceipt[]> {
  const { logId, invoices, pendingReceipts, uploadedBy, isEditMode, capabilities } = params;
  const rows: Array<{ part: MaintenanceLogPartRow; invoice: MaintenanceInvoiceSaveGroup }> = [];

  for (const invoice of invoices) {
    const invoiceHasMeta =
      invoice.invoice_number.trim() ||
      invoice.vendor.trim() ||
      invoice.receiptFile ||
      invoice.receiptDocumentId;

    for (const part of invoice.parts) {
      if (part.part_number.trim() || part.description.trim() || part.cost.trim() || invoiceHasMeta) {
        rows.push({ part, invoice });
      }
    }

    if (invoiceHasMeta && invoice.parts.every((p) => !p.part_number.trim() && !p.description.trim() && !p.cost.trim())) {
      rows.push({ part: invoice.parts[0] ?? { part_number: '', description: '', cost: '' }, invoice });
    }
  }

  if (isEditMode) {
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

  for (const invoice of invoices) {
    if (!invoice.receiptFile || receiptUploadedForInvoice.has(invoice.clientKey)) continue;
    const partId = firstPartIdByInvoice.get(invoice.clientKey) ?? null;
    const docId = await uploadReceiptFile(capabilities, {
      vehicleId: params.vehicleId,
      logId,
      file: invoice.receiptFile,
      partId,
      uploadedBy,
      invoiceClientKey: invoice.clientKey,
    });
    if (partId) {
      await supabase.from('maintenance_log_parts').update({ receipt_document_id: docId }).eq('id', partId);
    }
    invoice.receiptDocumentId = docId;
    invoice.receiptFile = null;
    receiptUploadedForInvoice.add(invoice.clientKey);
  }

  await uploadOrphanPendingReceipts({
    capabilities,
    vehicleId: params.vehicleId,
    logId,
    pendingReceipts,
    uploadedBy,
    alreadyUploadedIds: new Set(
      invoices.map((inv) => inv.receiptDocumentId).filter(Boolean) as string[],
    ),
    skipFiles: invoices.map((inv) => inv.receiptFile).filter(Boolean) as File[],
  });

  const { data: refreshedDocs } = await supabase
    .from('maintenance_log_documents')
    .select('id, file_name, file_path, file_type, maintenance_log_part_id')
    .eq('maintenance_log_id', logId)
    .order('uploaded_at', { ascending: true });

  return (refreshedDocs || []).map((doc) => ({
    id: doc.id,
    fileName: doc.file_name,
    filePath: doc.file_path,
    fileType: doc.file_type,
    maintenanceLogPartId: doc.maintenance_log_part_id,
  }));
}

async function saveLegacyInvoices(params: {
  vehicleId: string;
  logId: string;
  invoices: MaintenanceInvoiceSaveGroup[];
  pendingReceipts: PendingTicketReceipt[];
  uploadedBy: string;
  capabilities: MaintenancePersistenceCapabilities;
}): Promise<SavedTicketReceipt[]> {
  const { vehicleId, logId, invoices, pendingReceipts, uploadedBy, capabilities } = params;
  const notesPayload: MaintenanceNotesPayload = {
    __maintenance_v1: true,
    invoices: [],
    orphanReceiptIds: [],
  };

  for (const invoice of invoices) {
    const receiptDocumentIds: string[] = [];
    if (invoice.receiptDocumentId) {
      receiptDocumentIds.push(invoice.receiptDocumentId);
    }
    if (invoice.receiptFile) {
      const docId = await uploadReceiptFile(capabilities, {
        vehicleId,
        logId,
        file: invoice.receiptFile,
        partId: null,
        uploadedBy,
        invoiceClientKey: invoice.clientKey,
      });
      receiptDocumentIds.push(docId);
      invoice.receiptDocumentId = docId;
      invoice.receiptFile = null;
    }

    const hasContent =
      invoice.invoice_number.trim() ||
      invoice.vendor.trim() ||
      receiptDocumentIds.length ||
      invoice.parts.some((p) => p.part_number.trim() || p.description.trim() || p.cost.trim());

    if (!hasContent) continue;

    notesPayload.invoices.push({
      clientKey: invoice.clientKey,
      invoice_number: invoice.invoice_number,
      vendor: invoice.vendor,
      parts: invoice.parts.map((part) => ({
        part_number: part.part_number,
        description: part.description,
        cost: part.cost,
      })),
      receiptDocumentIds,
    });
  }

  const orphanIds = await uploadOrphanPendingReceipts({
    capabilities,
    vehicleId,
    logId,
    pendingReceipts,
    uploadedBy,
    alreadyUploadedIds: new Set(
      notesPayload.invoices.flatMap((inv) => inv.receiptDocumentIds || []),
    ),
    skipFiles: invoices.map((inv) => inv.receiptFile).filter(Boolean) as File[],
  });
  notesPayload.orphanReceiptIds = orphanIds;

  const { error: notesError } = await supabase
    .from('maintenance_logs')
    .update({ notes: encodeNotesPayload(notesPayload) })
    .eq('id', logId);
  if (notesError) throw notesError;

  const legacyDocs = await loadLegacyDocuments(vehicleId, logId);
  return legacyDocs.map((doc) => ({
    id: doc.id,
    fileName: doc.file_name,
    filePath: doc.file_path,
    fileType: doc.file_type,
    maintenanceLogPartId: null,
  }));
}

async function uploadOrphanPendingReceipts(params: {
  capabilities: MaintenancePersistenceCapabilities;
  vehicleId: string;
  logId: string;
  pendingReceipts: PendingTicketReceipt[];
  uploadedBy: string;
  alreadyUploadedIds: Set<string>;
  skipFiles?: File[];
}): Promise<string[]> {
  const uploadedIds: string[] = [];
  const seenFiles = new Set<string>();

  for (const file of params.skipFiles || []) {
    seenFiles.add(`${file.name}:${file.size}:${file.lastModified}`);
  }

  for (const receipt of params.pendingReceipts) {
    if (receipt.id) {
      if (!params.alreadyUploadedIds.has(receipt.id)) uploadedIds.push(receipt.id);
      continue;
    }
    if (!receipt.file) continue;

    const dedupeKey = `${receipt.file.name}:${receipt.file.size}:${receipt.file.lastModified}`;
    if (seenFiles.has(dedupeKey)) continue;
    seenFiles.add(dedupeKey);

    const docId = await uploadReceiptFile(params.capabilities, {
      vehicleId: params.vehicleId,
      logId: params.logId,
      file: receipt.file,
      partId: null,
      uploadedBy: params.uploadedBy,
      invoiceClientKey: 'orphan',
    });
    uploadedIds.push(docId);
  }

  return uploadedIds;
}

export function formatPersistenceError(error: unknown): string {
  if (error instanceof TypeError && /failed to fetch/i.test(error.message)) {
    return 'Network error while saving files. Check your connection, or run public/sql/maintenance-log-supabase-complete.sql in the database SQL editor.';
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: string }).message || '');
    if (/file too large/i.test(message)) {
      return 'Receipt exceeds the 50MB storage limit on your database. Run scripts/maintenance-storage-size-limit-onspace.sql in the SQL editor to allow files up to 200MB.';
    }
    if (message.toLowerCase().includes('row-level security')) {
      return 'Storage upload blocked by database policy. Run public/sql/maintenance-log-supabase-complete.sql in the SQL editor to enable receipt uploads.';
    }
    return message;
  }
  return 'Failed to save ticket';
}
