import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Info, Wrench, FileText } from 'lucide-react';
import { VehicleInfoTab } from './details/VehicleInfoTab';
import { MaintenanceTab } from './details/MaintenanceTab';
import { DocumentsTab } from './details/DocumentsTab';

interface Vehicle {
  id: string;
  vehicle_name: string;
  [key: string]: any;
}

interface VehicleDetailsDialogProps {
  vehicle: Vehicle;
  onClose: () => void;
  onVehicleUpdated: () => void;
}

export function VehicleDetailsDialog({
  vehicle,
  onClose,
  onVehicleUpdated,
}: VehicleDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState('info');

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="h-screen w-screen max-w-none flex flex-col p-0 m-0 rounded-none"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-4 pt-4 pb-3 border-b shrink-0 bg-white">
          <DialogTitle className="text-xl">{vehicle.vehicle_name}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <TabsList className="grid w-full grid-cols-3 mx-4 mt-3 shrink-0 bg-slate-200">
            <TabsTrigger value="info" className="font-semibold data-[state=active]:bg-yellow-600 data-[state=active]:text-black">
              <Info className="w-4 h-4 mr-1" />
              Info
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="font-semibold data-[state=active]:bg-yellow-600 data-[state=active]:text-black">
              <Wrench className="w-4 h-4 mr-1" />
              Maintenance
            </TabsTrigger>
            <TabsTrigger value="documents" className="font-semibold data-[state=active]:bg-yellow-600 data-[state=active]:text-black">
              <FileText className="w-4 h-4 mr-1" />
              Documents
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            <TabsContent value="info" className="mt-0">
              <VehicleInfoTab vehicle={vehicle} onVehicleUpdated={onVehicleUpdated} />
            </TabsContent>

            <TabsContent value="maintenance" className="mt-0">
              <MaintenanceTab vehicleId={vehicle.id} vehicleType={vehicle.type} />
            </TabsContent>

            <TabsContent value="documents" className="mt-0">
              <DocumentsTab vehicleId={vehicle.id} />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
