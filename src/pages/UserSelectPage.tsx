import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Settings, User } from 'lucide-react';
import { InstallButton } from '@/components/ui/install-button';
import type { UserProfile } from '@/types';
import { AdminSetup } from './AdminSetup';
import { UserSelectCard } from '@/components/shared/UserSelectCard';
import { MAIN_APP_ROLE_SECTIONS, groupUsersByRole } from '@/lib/userRoleSections';

interface UserSelectPageProps {
  onSelectUser: (user: UserProfile) => void;
}

export function UserSelectPage({ onSelectUser }: UserSelectPageProps) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mainListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    mainListRef.current?.scrollTo({ top: 0 });
  }, [users]);

  async function loadUsers() {
    setLoadError(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.from('user_profiles').select('*');

      if (error) throw error;
      setUsers(data || []);
    } catch (error: unknown) {
      console.error('Error loading users:', error);
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: string }).message)
          : 'Could not load users from the database.';
      setLoadError(message);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  if (showAdmin) {
    return (
      <AdminSetup
        onBack={() => {
          setShowAdmin(false);
          loadUsers();
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-muted/30 overflow-hidden">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading users...</p>
        </div>
      </div>
    );
  }

  const usersByRole = groupUsersByRole(users);
  const mainSectionsWithUsers = MAIN_APP_ROLE_SECTIONS.filter(({ role }) => usersByRole[role].length > 0);

  return (
    <div className="h-[100dvh] flex flex-col bg-muted/30 p-2 sm:p-4 overflow-hidden sm:items-center sm:justify-center">
      <Card className="w-full max-w-2xl shadow-xl flex flex-col flex-1 min-h-0 sm:flex-initial sm:max-h-[calc(100dvh-2rem)]">
        <CardHeader className="shrink-0 text-center space-y-2 sm:space-y-4 pb-3 sm:pb-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0" />
            <div className="flex justify-center flex-1 min-w-0">
              <img
                src="https://cdn-ai.onspace.ai/onspace/files/EvPiYskzE4vCidikEdjr5Z/MB_Logo_Green_192x64_12.9kb.png"
                alt="Martin Builder OS"
                className="h-10 sm:h-16 w-auto"
              />
            </div>
            <div className="flex-1 flex justify-end min-w-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdmin(true)}
                className="text-muted-foreground hover:text-foreground h-8 sm:h-9 px-2 sm:px-3"
                aria-label="Manage Users"
              >
                <Settings className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Manage Users</span>
              </Button>
            </div>
          </div>
          <div>
            <CardTitle className="text-xl sm:text-2xl font-bold">Martin Builder OS</CardTitle>
            <CardDescription className="text-sm">Select Your Name to Continue</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col flex-1 min-h-0 pt-0 pb-3 sm:pb-6">
          <div className="shrink-0 flex justify-center mb-3 sm:mb-4">
            <InstallButton />
          </div>

          {loadError ? (
            <Alert variant="destructive" className="shrink-0 mb-3 text-left">
              <AlertTitle>Could not load users</AlertTitle>
              <AlertDescription className="space-y-2 mt-2">
                <p className="text-sm">{loadError}</p>
                <p className="text-xs opacity-90">
                  Check the browser console (F12) for details. Confirm{' '}
                  <code className="rounded bg-background px-1">VITE_SUPABASE_URL</code> and{' '}
                  <code className="rounded bg-background px-1">VITE_SUPABASE_ANON_KEY</code> match your Supabase
                  project, and that Row Level Security on <code className="rounded bg-background px-1">user_profiles</code>{' '}
                  allows <code className="rounded bg-background px-1">SELECT</code> for the{' '}
                  <code className="rounded bg-background px-1">anon</code> role.
                </p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => loadUsers()}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {users.length === 0 && !loadError ? (
            <div className="flex flex-1 min-h-0 items-center justify-center text-center py-4">
              <div>
                <User className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground mb-2">No users available</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Add crew, office, and payroll users in Manage Users.
                </p>
                <Button onClick={() => setShowAdmin(true)} className="gradient-primary">
                  <Settings className="w-4 h-4 mr-2" />
                  Manage Users
                </Button>
              </div>
            </div>
          ) : users.length > 0 ? (
            <div
              ref={mainListRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 sm:space-y-5 pr-1 -mr-1"
            >
              {mainSectionsWithUsers.map(({ role, title }) => (
                <section key={role}>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2 px-1 sticky top-0 bg-card py-1 z-[1]">
                    {title}
                  </h3>
                  <div className="grid gap-2">
                    {usersByRole[role].map((user) => (
                      <UserSelectCard key={user.id} user={user} onSelect={onSelectUser} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
