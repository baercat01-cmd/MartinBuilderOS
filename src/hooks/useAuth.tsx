import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { UserProfile } from '@/types';

type AuthState = 'authenticated' | 'needs_pin_setup' | 'needs_login' | 'unauthenticated';

interface AuthContextType {
  profile: UserProfile | null;
  loading: boolean;
  authState: AuthState;
  /** Bumps on sign-out so the login screen remounts with a fresh user list. */
  userSelectKey: number;
  selectUser: (user: UserProfile) => void;
  clearUser: () => void;
  markAuthenticated: () => void;
  patchProfile: (updates: Partial<UserProfile>) => void;
}

// Initialize with default value to prevent undefined context errors
const AuthContext = createContext<AuthContextType>({
  profile: null,
  loading: true,
  authState: 'unauthenticated',
  userSelectKey: 0,
  selectUser: () => {},
  clearUser: () => {},
  markAuthenticated: () => {},
  patchProfile: () => {}
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState<AuthState>('unauthenticated');
  const [userSelectKey, setUserSelectKey] = useState(0);

  useEffect(() => {
    // Try to restore authenticated user from localStorage
    const storedUserId = localStorage.getItem('fieldtrack_user_id');
    const isAuthenticated = localStorage.getItem('fieldtrack_authenticated') === 'true';
    
    if (storedUserId) {
      loadUser(storedUserId, isAuthenticated);
    } else {
      setLoading(false);
    }
  }, []);

  async function loadUser(userId: string, isAuthenticated: boolean) {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      
      if (
        !data.role ||
        (data.role !== 'crew' &&
          data.role !== 'foreman' &&
          data.role !== 'office' &&
          data.role !== 'payroll' &&
          data.role !== 'shop' &&
          data.role !== 'driver')
      ) {
        throw new Error('Invalid user role');
      }
      
      setProfile(data);
      try {
        localStorage.setItem('mb_last_app_role', data.role);
      } catch { /* ignore */ }
      
      // Determine auth state based on PIN setup and authentication status
      if (!data.pin_hash) {
        // No PIN set - needs setup
        setAuthState('needs_pin_setup');
      } else if (!isAuthenticated) {
        // PIN set but not authenticated - needs login
        setAuthState('needs_login');
      } else {
        // Authenticated
        setAuthState('authenticated');
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error loading user:', error);
      }
      localStorage.removeItem('fieldtrack_user_id');
      localStorage.removeItem('fieldtrack_authenticated');
      try {
        localStorage.removeItem('mb_last_app_role');
      } catch { /* ignore */ }
      setProfile(null);
      setAuthState('unauthenticated');
    } finally {
      setLoading(false);
    }
  }

  function selectUser(user: UserProfile) {
    localStorage.setItem('fieldtrack_user_id', user.id);
    localStorage.removeItem('fieldtrack_authenticated'); // Require authentication
    try {
      localStorage.setItem('mb_last_app_role', user.role);
    } catch { /* ignore */ }
    setProfile(user);
    
    // Determine auth state
    if (!user.pin_hash) {
      setAuthState('needs_pin_setup');
    } else {
      setAuthState('needs_login');
    }
  }

  function clearUser() {
    localStorage.removeItem('fieldtrack_user_id');
    localStorage.removeItem('fieldtrack_authenticated');
    try {
      localStorage.removeItem('mb_last_app_role');
    } catch { /* ignore */ }
    // Clear user-specific data
    const userId = profile?.id;
    if (userId) {
      localStorage.removeItem(`fieldtrack_timers_${userId}`);
      localStorage.removeItem('fieldtrack_daily_log_draft');
      localStorage.removeItem('fieldtrack_photo_queue');
    }
    setProfile(null);
    setAuthState('unauthenticated');
    setUserSelectKey((k) => k + 1);
  }

  function markAuthenticated() {
    localStorage.setItem('fieldtrack_authenticated', 'true');
    setAuthState('authenticated');
  }

  function patchProfile(updates: Partial<UserProfile>) {
    setProfile((prev) => (prev ? { ...prev, ...updates } : prev));
  }

  return (
    <AuthContext.Provider
      value={{ profile, loading, authState, userSelectKey, selectUser, clearUser, markAuthenticated, patchProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  // Context should always exist now with default value
  return context;
}
