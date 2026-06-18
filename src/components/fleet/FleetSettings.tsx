import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Building2, Wrench, Truck, X } from 'lucide-react';
import { UserManagementTab } from './settings/UserManagementTab';
import { VendorManagementTab } from './settings/VendorManagementTab';
import { ChecklistManagementTab } from './settings/ChecklistManagementTab';
import { VehicleManagementTab } from './settings/VehicleManagementTab';
import { Button } from '@/components/ui/button';

interface FleetSettingsProps {
  company?: { id: string; name: string } | null;
  onClose: () => void;
  onLogout: () => void;
}

export function FleetSettings({ company = null, onClose, onLogout }: FleetSettingsProps) {
  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClose}
          className="border-slate-300 text-slate-800"
        >
          <X className="w-4 h-4 mr-1.5" />
          Exit settings
        </Button>
      </div>
      <Tabs defaultValue="vehicles" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto min-h-12 bg-slate-200 gap-1 p-1">
          <TabsTrigger value="vehicles" className="font-bold data-[state=active]:bg-yellow-600 data-[state=active]:text-black">
            <Truck className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
            Vehicles
          </TabsTrigger>
          <TabsTrigger value="users" className="font-bold data-[state=active]:bg-yellow-600 data-[state=active]:text-black">
            <Users className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
            Users
          </TabsTrigger>
          <TabsTrigger value="vendors" className="font-bold data-[state=active]:bg-yellow-600 data-[state=active]:text-black text-xs sm:text-sm px-2 sm:px-3">
            <Building2 className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
            <span className="truncate">Vehicle vendors</span>
          </TabsTrigger>
          <TabsTrigger value="checklist" className="font-bold data-[state=active]:bg-yellow-600 data-[state=active]:text-black">
            <Wrench className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
            <span className="truncate">Checklist Items</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="vehicles" className="mt-4">
          <VehicleManagementTab company={company} />
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <UserManagementTab />
        </TabsContent>

        <TabsContent value="vendors" className="mt-4">
          <VendorManagementTab />
        </TabsContent>

        <TabsContent value="checklist" className="mt-4">
          <ChecklistManagementTab />
        </TabsContent>
      </Tabs>

      <div className="mt-6 pt-6 border-t">
        <Button
          onClick={onLogout}
          variant="destructive"
          className="w-full"
        >
          Sign Out
        </Button>
      </div>
    </div>
  );
}
