import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, FileText, Plus, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { AddMaintenanceDialog } from './AddMaintenanceDialog';

interface MaintenanceLogPart {
  id: string;
  part_number: string | null;
  description: string | null;
  cost: number | null;
}

interface MaintenanceLogDocument {
  id: string;
  file_name: string;
  file_path: string;
  maintenance_log_part_id: string | null;
}

interface MaintenanceLog {
  id: string;
  type: string;
  status: string;
  title: string;
  date: string;
  mileage_hours: number | null;
  description: string | null;
  part_cost: number | null;
  service_checklist: any[];
  parts?: MaintenanceLogPart[];
  documents?: MaintenanceLogDocument[];
}

interface MaintenanceTabProps {
  vehicleId: string;
  vehicleType: string;
}

export function MaintenanceTab({ vehicleId, vehicleType }: MaintenanceTabProps) {
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editLogId, setEditLogId] = useState<string | null>(null);

  useEffect(() => {
    loadLogs();
  }, [vehicleId]);

  async function loadLogs() {
    try {
      const { data, error } = await supabase
        .from('maintenance_logs')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('date', { ascending: false });
      if (error) throw error;

      const logsData = data || [];
      const logIds = logsData.map((l) => l.id);
      let partsByLog: Record<string, MaintenanceLogPart[]> = {};
      let documentsByLog: Record<string, MaintenanceLogDocument[]> = {};

      if (logIds.length) {
        const { data: parts } = await supabase
          .from('maintenance_log_parts')
          .select('id, maintenance_log_id, part_number, description, cost')
          .in('maintenance_log_id', logIds)
          .order('order_index', { ascending: true });

        if (parts) {
          partsByLog = parts.reduce<Record<string, MaintenanceLogPart[]>>((acc, part) => {
            const key = part.maintenance_log_id;
            if (!acc[key]) acc[key] = [];
            acc[key].push(part);
            return acc;
          }, {});
        }

        const { data: docs } = await supabase
          .from('maintenance_log_documents')
          .select('id, maintenance_log_id, file_name, file_path, maintenance_log_part_id')
          .in('maintenance_log_id', logIds);

        if (docs) {
          documentsByLog = docs.reduce<Record<string, MaintenanceLogDocument[]>>((acc, doc) => {
            const key = doc.maintenance_log_id;
            if (!acc[key]) acc[key] = [];
            acc[key].push(doc);
            return acc;
          }, {});
        }
      }

      setLogs(
        logsData.map((log) => ({
          ...log,
          parts: partsByLog[log.id] || [],
          documents: documentsByLog[log.id] || [],
        })),
      );
    } catch (error) {
      toast.error('Failed to load maintenance tickets');
    } finally {
      setLoading(false);
    }
  }

  function openTicket(logId: string) {
    setEditLogId(logId);
    setShowAddDialog(true);
  }

  function closeDialog() {
    setShowAddDialog(false);
    setEditLogId(null);
  }

  function getTotalCost(log: MaintenanceLog): number | null {
    if (log.parts?.length) {
      const sum = log.parts.reduce((acc, p) => acc + (p.cost || 0), 0);
      return sum > 0 ? sum : null;
    }
    return log.part_cost;
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'complete': return 'bg-green-100 text-green-800 border-green-300';
      case 'in_progress': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    }
  }

  function getTypeColor(type: string): string {
    return type === 'service' ? 'bg-blue-500' : 'bg-orange-500';
  }

  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="w-8 h-8 border-4 border-yellow-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-600">Loading maintenance tickets...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-800">Maintenance Tickets</h3>
        <Button
          onClick={() => { setEditLogId(null); setShowAddDialog(true); }}
          size="sm"
          className="bg-yellow-600 hover:bg-yellow-700 text-black"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Ticket
        </Button>
      </div>

      {logs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Wrench className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-medium">No maintenance tickets</p>
            <p className="text-sm text-slate-500 mb-4">Open a ticket to track parts and receipts over time</p>
            <Button onClick={() => { setEditLogId(null); setShowAddDialog(true); }} variant="outline" className="border-2 border-yellow-600 text-yellow-700 hover:bg-yellow-50">
              <Plus className="w-4 h-4 mr-2" />
              Open First Ticket
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const totalCost = getTotalCost(log);
            const isOpen = log.status !== 'complete';
            return (
              <Card
                key={log.id}
                className={`cursor-pointer transition-shadow hover:shadow-md ${isOpen ? 'border-blue-300 ring-1 ring-blue-100' : ''}`}
                onClick={() => openTicket(log.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${getTypeColor(log.type)}`} />
                        <CardTitle className="text-base truncate">{log.title}</CardTitle>
                        {isOpen && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-300 text-blue-700 shrink-0">Open</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
                        <span>{new Date(log.date).toLocaleDateString()}</span>
                        {log.mileage_hours != null && (
                          <>
                            <span>•</span>
                            <span>{log.mileage_hours.toLocaleString()}{vehicleType === 'heavy_equipment' ? ' hrs' : ' mi'}</span>
                          </>
                        )}
                        {totalCost != null && (
                          <>
                            <span>•</span>
                            <span className="font-medium">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </>
                        )}
                        {log.parts && log.parts.length > 0 && (
                          <>
                            <span>•</span>
                            <span>{log.parts.length} part{log.parts.length === 1 ? '' : 's'}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={`border-2 ${getStatusColor(log.status)}`}>{log.status.replace('_', ' ')}</Badge>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>
                </CardHeader>
                {(log.description || (log.parts && log.parts.length > 0)) && (
                  <CardContent className="pt-0">
                    {log.description && <p className="text-sm text-slate-600 mb-2">{log.description}</p>}
                    {log.parts && log.parts.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-slate-700">Parts:</p>
                        {log.parts.slice(0, 3).map((part) => (
                          <div key={part.id} className="flex items-center justify-between text-xs text-slate-600">
                            <span className="truncate mr-2">
                              {part.part_number || part.description || 'Part'}
                              {part.description && part.part_number && <span className="text-slate-400"> — {part.description}</span>}
                            </span>
                            {part.cost != null && (
                              <span className="font-medium shrink-0">${part.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            )}
                          </div>
                        ))}
                        {log.parts.length > 3 && <p className="text-xs text-slate-400">+{log.parts.length - 3} more — click to open ticket</p>}
                      </div>
                    )}
                    {log.documents?.some((d) => d.maintenance_log_part_id) && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-yellow-700">
                        <FileText className="w-3 h-3" />
                        Receipts attached
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <AddMaintenanceDialog
        open={showAddDialog}
        onClose={closeDialog}
        vehicleId={vehicleId}
        vehicleType={vehicleType}
        editLogId={editLogId}
        onSuccess={() => { closeDialog(); loadLogs(); }}
      />
    </div>
  );
}
