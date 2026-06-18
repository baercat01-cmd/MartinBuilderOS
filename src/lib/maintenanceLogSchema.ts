import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type MaintenanceSchemaStatus = {
  ready: boolean;
  partsTable: boolean;
  documentsTable: boolean;
  rpcAvailable: boolean;
};

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

function isMissingRpcError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message || '').toLowerCase();
  return (
    error.code === 'PGRST202' ||
    message.includes('could not find the function') ||
    message.includes('ensure_maintenance_log_schema_json')
  );
}

export async function probeMaintenanceLogSchema(
  client: SupabaseClient = supabase,
): Promise<MaintenanceSchemaStatus> {
  const partsProbe = await client.from('maintenance_log_parts').select('id').limit(1);
  const partsTable = !partsProbe.error || !isMissingTableError(partsProbe.error);

  const docsProbe = await client.from('maintenance_log_documents').select('id').limit(1);
  const documentsTable = !docsProbe.error || !isMissingTableError(docsProbe.error);

  const rpcProbe = await client.rpc('ensure_maintenance_log_schema_json', {
    p_payload: { probe_only: true },
  });
  const rpcAvailable = !isMissingRpcError(rpcProbe.error);

  return {
    ready: partsTable && documentsTable,
    partsTable,
    documentsTable,
    rpcAvailable,
  };
}

/** Ensures maintenance parts/documents tables exist (via Supabase RPC migration). */
export async function ensureMaintenanceLogSchema(
  client: SupabaseClient = supabase,
): Promise<{ ok: boolean; error?: string; status?: MaintenanceSchemaStatus }> {
  const { data, error } = await client.rpc('ensure_maintenance_log_schema_json', { p_payload: {} });

  if (error) {
    if (isMissingRpcError(error)) {
      return {
        ok: false,
        error:
          'Run supabase/migrations/20260618160000 and 20260618170000 in the Supabase SQL editor, then reload the app.',
      };
    }
    return { ok: false, error: error.message };
  }

  const row = data as { ok?: boolean; error?: string } | null;
  if (!row?.ok) {
    return { ok: false, error: row?.error || 'Schema setup failed' };
  }

  const status = await probeMaintenanceLogSchema(client);
  return { ok: status.ready, status, error: status.ready ? undefined : 'Tables still missing after setup' };
}
