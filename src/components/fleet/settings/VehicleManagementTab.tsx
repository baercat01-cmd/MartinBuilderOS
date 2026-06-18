import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { canManageFleetVehicleRecords } from '@/lib/fleetVehiclePermissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Archive, ArchiveRestore, Box, Construction, Trash2, Truck, Wrench } from 'lucide-react';
import { toast } from 'sonner';

interface VehicleManagementTabProps {
  company: { id: string; name: string } | null;
}

interface Vehicle {
  id: string;
  vehicle_name: string;
  year: number | null;
  make: string | null;
  model: string | null;
  type: string;
  status: string;
  archived: boolean;
  company_id: string;
}

type ArchiveFilter = 'active' | 'archived' | 'all';

type VehicleType = 'truck' | 'heavy_equipment' | 'small_engine' | 'trailer';

const VEHICLE_TYPE_SECTIONS: {
  type: VehicleType;
  label: string;
  icon: typeof Truck;
}[] = [
  { type: 'truck', label: 'Trucks', icon: Truck },
  { type: 'heavy_equipment', label: 'Heavy Equipment', icon: Construction },
  { type: 'small_engine', label: 'Small Engines', icon: Wrench },
  { type: 'trailer', label: 'Trailers', icon: Box },
];

async function deleteVehicleAndRelatedData(vehicleId: string) {
  const { data: logs } = await supabase
    .from('maintenance_logs')
    .select('id')
    .eq('vehicle_id', vehicleId);

  const logIds = (logs || []).map((log) => log.id);

  if (logIds.length) {
    await supabase.from('maintenance_log_documents').delete().in('maintenance_log_id', logIds);
    await supabase.from('maintenance_log_parts').delete().in('maintenance_log_id', logIds);
    await supabase.from('maintenance_logs').delete().eq('vehicle_id', vehicleId);
  }

  await supabase.from('vehicle_documents').delete().eq('vehicle_id', vehicleId);
  await supabase.from('location_history').delete().eq('vehicle_id', vehicleId);

  const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId);
  if (error) throw error;
}

function VehicleRow({
  vehicle,
  canManage,
  deletingId,
  onArchive,
  onRestore,
  onDelete,
}: {
  vehicle: Vehicle;
  canManage: boolean;
  deletingId: string | null;
  onArchive: (id: string, name: string) => void;
  onRestore: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h4 className="font-bold truncate">{vehicle.vehicle_name}</h4>
              {vehicle.archived && (
                <Badge variant="outline" className="text-xs">
                  Archived
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {vehicle.status}
              </Badge>
            </div>
            <p className="text-sm text-slate-600 truncate">
              {vehicle.year && `${vehicle.year} `}
              {vehicle.make && `${vehicle.make} `}
              {vehicle.model}
            </p>
          </div>

          {canManage && (
            <div className="flex items-center gap-2 shrink-0">
              {vehicle.archived ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRestore(vehicle.id, vehicle.vehicle_name)}
                  className="border-green-600 text-green-700 hover:bg-green-50"
                >
                  <ArchiveRestore className="w-4 h-4 mr-1" />
                  Restore
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onArchive(vehicle.id, vehicle.vehicle_name)}
                >
                  <Archive className="w-4 h-4 mr-1" />
                  Archive
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDelete(vehicle.id, vehicle.vehicle_name)}
                disabled={deletingId === vehicle.id}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                {deletingId === vehicle.id ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function VehicleManagementTab({ company }: VehicleManagementTabProps) {
  const { profile } = useAuth();
  const canManage = canManageFleetVehicleRecords(profile);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>('active');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const showAllCategories = !company?.name.toLowerCase().includes('tri county');
  const visibleSections = showAllCategories
    ? VEHICLE_TYPE_SECTIONS
    : VEHICLE_TYPE_SECTIONS.filter((s) => s.type === 'truck');

  useEffect(() => {
    if (!company?.id) {
      setVehicles([]);
      setLoading(false);
      return;
    }
    loadVehicles();
  }, [company?.id, archiveFilter]);

  async function loadVehicles() {
    if (!company?.id) return;

    setLoading(true);
    try {
      let query = supabase
        .from('vehicles')
        .select('id, vehicle_name, year, make, model, type, status, archived, company_id')
        .eq('company_id', company.id)
        .order('vehicle_name');

      if (archiveFilter === 'active') {
        query = query.eq('archived', false);
      } else if (archiveFilter === 'archived') {
        query = query.eq('archived', true);
      }

      const { data, error } = await query;
      if (error) throw error;
      setVehicles(data || []);
    } catch (error) {
      console.error('Error loading vehicles:', error);
      toast.error('Failed to load vehicles');
    } finally {
      setLoading(false);
    }
  }

  async function handleArchive(id: string, name: string) {
    if (!confirm(`Archive "${name}"? It will be hidden from the fleet list but can be restored later.`)) return;

    try {
      const { error } = await supabase.from('vehicles').update({ archived: true }).eq('id', id);
      if (error) throw error;
      toast.success('Vehicle archived');
      loadVehicles();
    } catch (error) {
      console.error('Error archiving vehicle:', error);
      toast.error('Failed to archive vehicle');
    }
  }

  async function handleRestore(id: string, name: string) {
    if (!confirm(`Restore "${name}"?`)) return;

    try {
      const { error } = await supabase.from('vehicles').update({ archived: false }).eq('id', id);
      if (error) throw error;
      toast.success('Vehicle restored');
      loadVehicles();
    } catch (error) {
      console.error('Error restoring vehicle:', error);
      toast.error('Failed to restore vehicle');
    }
  }

  async function handleDelete(id: string, name: string) {
    if (
      !confirm(
        `Permanently delete "${name}"?\n\nThis removes the vehicle and all maintenance logs, documents, and location history. This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingId(id);
    try {
      await deleteVehicleAndRelatedData(id);
      toast.success('Vehicle deleted');
      loadVehicles();
    } catch (error: any) {
      console.error('Error deleting vehicle:', error);
      toast.error(error?.message || 'Failed to delete vehicle');
    } finally {
      setDeletingId(null);
    }
  }

  const vehiclesByType = useMemo(() => {
    const grouped: Record<string, Vehicle[]> = {};
    for (const section of visibleSections) {
      grouped[section.type] = [];
    }
    for (const vehicle of vehicles) {
      if (grouped[vehicle.type]) {
        grouped[vehicle.type].push(vehicle);
      }
    }
    return grouped;
  }, [vehicles, visibleSections]);

  if (!company) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Truck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Select a company first</p>
          <p className="text-sm text-slate-500 mt-1">
            Open a company fleet, then return to settings to manage its vehicles.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading && vehicles.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="w-8 h-8 border-4 border-yellow-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-600">Loading vehicles...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">
            Manage vehicles for{' '}
            <span className="font-semibold text-slate-900">{company.name}</span>. Archive to hide
            from the fleet board, or delete permanently.
          </p>
        </div>
        <Select value={archiveFilter} onValueChange={(v) => setArchiveFilter(v as ArchiveFilter)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="archived">Archived only</SelectItem>
            <SelectItem value="all">All vehicles</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {vehicles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Truck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-medium">No vehicles found for {company.name}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {visibleSections.map(({ type, label, icon: Icon }) => {
            const sectionVehicles = vehiclesByType[type] || [];
            if (sectionVehicles.length === 0) return null;

            return (
              <div key={type} className="space-y-2">
                <div className="flex items-center gap-2 p-3 bg-yellow-600 text-black rounded-lg font-bold">
                  <Icon className="w-5 h-5 shrink-0" />
                  <span>{label}</span>
                  <Badge variant="secondary" className="ml-auto bg-white text-xs">
                    {sectionVehicles.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {sectionVehicles.map((vehicle) => (
                    <VehicleRow
                      key={vehicle.id}
                      vehicle={vehicle}
                      canManage={canManage}
                      deletingId={deletingId}
                      onArchive={handleArchive}
                      onRestore={handleRestore}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
