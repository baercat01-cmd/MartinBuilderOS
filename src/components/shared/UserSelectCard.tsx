import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Briefcase, DollarSign, HardHat, Package, Shield, Truck } from 'lucide-react';
import type { UserProfile } from '@/types';
import { getRoleBadgeLabel, getRoleMemberLabel } from '@/lib/userRoleSections';

interface UserSelectCardProps {
  user: UserProfile;
  onSelect: (user: UserProfile) => void;
}

function RoleIcon({ role }: { role: UserProfile['role'] }) {
  switch (role) {
    case 'office':
      return <Shield className="w-6 h-6 text-primary" />;
    case 'payroll':
      return <DollarSign className="w-6 h-6 text-primary" />;
    case 'shop':
      return <Package className="w-6 h-6 text-primary" />;
    case 'foreman':
      return <HardHat className="w-6 h-6 text-primary" />;
    case 'driver':
      return <Truck className="w-6 h-6 text-primary" />;
    case 'crew':
    default:
      return <Briefcase className="w-6 h-6 text-primary" />;
  }
}

export function UserSelectCard({ user, onSelect }: UserSelectCardProps) {
  const role = user.role;

  return (
    <Button
      type="button"
      variant="outline"
      className="h-auto p-4 justify-start hover:bg-primary/10 hover:border-primary transition-all"
      onClick={() => onSelect(user)}
    >
      <div className="flex items-center gap-3 w-full">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <RoleIcon role={role} />
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="font-semibold text-lg truncate">{user.username || 'Unnamed User'}</p>
          <p className="text-sm text-muted-foreground">{getRoleMemberLabel(role)}</p>
        </div>
        <Badge
          variant={role === 'office' ? 'default' : role === 'payroll' ? 'outline' : 'secondary'}
          className="shrink-0"
        >
          {getRoleBadgeLabel(role)}
        </Badge>
      </div>
    </Button>
  );
}
