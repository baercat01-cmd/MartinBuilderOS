import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MapPin, Clock, Gauge, Plus, FileText, Wrench, Image } from 'lucide-react';
import { toast } from 'sonner';
import { VehicleDetailsDialog } from './VehicleDetailsDialog';
import { AddMaintenanceDialog } from './details/AddMaintenanceDialog';

interface Vehicle {
  id: string;
  vehicle_name: string;
  year: number | null;
  make: string | null;
  model: string | null;
  type: string;
  status: string;
  current_mileage: number | null;
  engine_hours: number | null;
  image_url: string | null;
  address: string | null;
  location_name: string | null;
  last_location_update: string | null;
}

interface VehicleListProps {
  companyId: string;
  vehicleType: string;
  statusFilter: string;
  /** Mobile tab layout: opens add-vehicle dialog for this section. */
  onAddVehicle?: () => void;
  onVehicleUpdated: () => void | Promise<void>;
}

export function VehicleList({
  companyId,
  vehicleType,
  statusFilter,
  onAddVehicle,
  onVehicleUpdated,
}: VehicleListProps) {
  const { profile } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [serviceVehicleId, setServiceVehicleId] = useState<string | null>(null);
  const [serviceVehicleType, setServiceVehicleType] = useState<string>('');
  const [serviceEditLogId, setServiceEditLogId] = useState<string | null>(null);
  const [openTicketByVehicle, setOpenTicketByVehicle] = useState<Record<string, string>>({});

  useEffect(() => {
    loadVehicles();
  }, [companyId, vehicleType, statusFilter]);

  async function loadVehicles() {
    try {
      let query = supabase
        .from('vehicles')
        .select('*')
        .eq('company_id', companyId)
        .eq('type', vehicleType)
        .eq('archived', false)
        .order('vehicle_name');

      if (statusFilter !== 'All') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      const list = data || [];
      setVehicles(list);

      const vehicleIds = list.map((v) => v.id);
      if (vehicleIds.length === 0) {
        setOpenTicketByVehicle({});
      } else {
        const { data: openLogs, error: openError } = await supabase
          .from('maintenance_logs')
          .select('id, vehicle_id, date')
          .in('vehicle_id', vehicleIds)
          .neq('status', 'complete')
          .order('date', { ascending: false });

        if (openError) throw openError;

        const byVehicle: Record<string, string> = {};
        for (const log of openLogs || []) {
          if (!byVehicle[log.vehicle_id]) {
            byVehicle[log.vehicle_id] = log.id;
          }
        }
        setOpenTicketByVehicle(byVehicle);
      }
    } catch (error) {
      console.error('Error loading vehicles:', error);
      toast.error('Failed to load vehicles');
    } finally {
      setLoading(false);
    }
  }

  async function updateVehicleStatus(vehicleId: string, newStatus: string) {
    try {
      const { error } = await supabase
        .from('vehicles')
        .update({ status: newStatus })
        .eq('id', vehicleId);

      if (error) throw error;

      toast.success('Status updated');
      loadVehicles();
      onVehicleUpdated();
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status');
    }
  }

  function formatDate(dateString: string | null): string {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'Active':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'Maintenance':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'Out of Service':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'Sold':
        return 'bg-slate-100 text-slate-800 border-slate-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  }

  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="w-8 h-8 border-4 border-yellow-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-600">Loading vehicles...</p>
      </div>
    );
  }

  if (vehicles.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-3">
          <Plus className="w-8 h-8 text-slate-400" />
        </div>
        <p className="text-slate-600 font-medium mb-2">No vehicles found</p>
        <p className="text-sm text-slate-500">
          {statusFilter !== 'All'
            ? `No ${statusFilter.toLowerCase()} vehicles in this category`
            : 'Use the + in the section header above to add a vehicle'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {vehicles.map((vehicle) => (
          <Card
            key={vehicle.id}
            className="hover:shadow-lg transition-all border-2 cursor-pointer"
            onClick={() => setSelectedVehicle(vehicle)}
          >
            <CardHeader className="pb-2 pt-3 px-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base font-bold truncate">
                    {vehicle.vehicle_name}
                  </CardTitle>
                  <p className="text-xs text-slate-600 truncate">
                    {vehicle.year && `${vehicle.year} `}
                    {vehicle.make && `${vehicle.make} `}
                    {vehicle.model}
                  </p>
                </div>
                <Select
                  value={vehicle.status}
                  onValueChange={(value) => {
                    updateVehicleStatus(vehicle.id, value);
                  }}
                >
                  <SelectTrigger
                    className={`w-32 h-7 text-xs font-semibold border-2 ${getStatusColor(vehicle.status)}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Maintenance">Maintenance</SelectItem>
                    <SelectItem value="Out of Service">Out of Service</SelectItem>
                    <SelectItem value="Sold">Sold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-3 pb-3 space-y-2">
              {vehicle.image_url && (
                <div className="aspect-video rounded-lg overflow-hidden bg-slate-100">
                  <img
                    src={vehicle.image_url}
                    alt={vehicle.vehicle_name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {/* Mileage or Hours */}
              <div className="flex items-center gap-2 text-sm">
                {vehicleType === 'heavy_equipment' ? (
                  <>
                    <Clock className="w-4 h-4 text-slate-500" />
                    <span className="font-semibold">
                      {vehicle.engine_hours?.toLocaleString() || '0'} hrs
                    </span>
                  </>
                ) : (
                  <>
                    <Gauge className="w-4 h-4 text-slate-500" />
                    <span className="font-semibold">
                      {vehicle.current_mileage?.toLocaleString() || '0'} mi
                    </span>
                  </>
                )}
              </div>

              {/* Location */}
              {(vehicle.address || vehicle.location_name) && (
                <div className="flex items-start gap-2 text-xs">
                  <MapPin className="w-3 h-3 text-slate-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{vehicle.location_name || vehicle.address}</p>
                    {vehicle.last_location_update && (
                      <p className="text-slate-500">
                        Updated {formatDate(vehicle.last_location_update)}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Service Button */}
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  setServiceVehicleId(vehicle.id);
                  setServiceVehicleType(vehicle.type);
                  setServiceEditLogId(openTicketByVehicle[vehicle.id] ?? null);
                }}
                className="w-full bg-yellow-600 hover:bg-yellow-700 text-black font-semibold"
                size="sm"
              >
                <Wrench className="w-4 h-4 mr-2" />
                {openTicketByVehicle[vehicle.id] ? 'Open Ticket' : 'Add Service/Repair'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedVehicle && (
        <VehicleDetailsDialog
          vehicle={selectedVehicle}
          onClose={() => setSelectedVehicle(null)}
          onVehicleUpdated={() => {
            loadVehicles();
            onVehicleUpdated();
          }}
        />
      )}

      {serviceVehicleId && (
        <AddMaintenanceDialog
          open={true}
          onClose={() => {
            setServiceVehicleId(null);
            setServiceVehicleType('');
            setServiceEditLogId(null);
          }}
          vehicleId={serviceVehicleId}
          vehicleType={serviceVehicleType}
          editLogId={serviceEditLogId}
          onSuccess={() => {
            setServiceVehicleId(null);
            setServiceVehicleType('');
            setServiceEditLogId(null);
            loadVehicles();
            onVehicleUpdated();
          }}
        />
      )}
    </>
  );
}
