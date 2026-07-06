import { Component, ReactNode, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, AuthProvider } from '@/hooks/useAuth';
import { UserSelectPage } from '@/pages/UserSelectPage';
import { LoginPage } from '@/pages/LoginPage';
import { PinSetupPage } from '@/pages/PinSetupPage';
import { ForemanDashboard } from '@/pages/foreman/ForemanDashboard';
import { OfficeDashboard } from '@/pages/office/OfficeDashboard';
import { DailyReportPage } from '@/pages/office/DailyReportPage';
import { PayrollDashboard } from '@/pages/payroll/PayrollDashboard';
import { ShopDashboard } from '@/pages/shop/ShopDashboard';
import { QuoteIntakePage } from '@/pages/office/QuoteIntakePage';
import BuildingEstimatorPage from '@/pages/office/BuildingEstimatorPage';
import EstimatorHomePage from '@/pages/office/EstimatorHomePage';
import ZohoSettingsPage from '@/pages/office/ZohoSettingsPage';
import { FleetDashboard } from '@/pages/fleet/FleetDashboard';
import { VendorPricingForm } from '@/pages/VendorPricingForm';
import CustomerPortal from '@/pages/customer/CustomerPortal';
import SubcontractorPortal from '@/pages/SubcontractorPortal';
import PlanShare from '@/pages/PlanShare';
import { Toaster } from '@/components/ui/sonner';
import { UndoProvider } from '@/contexts/UndoContext';
import { enableStaffAnalytics, disableStaffAnalytics } from '@/lib/analytics';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';


// Error Boundary to catch runtime errors
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('App Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6 text-center space-y-4">
              <AlertTriangle className="w-12 h-12 mx-auto text-destructive" />
              <h2 className="text-xl font-bold">Something went wrong</h2>
              <p className="text-sm text-muted-foreground">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
              <Button
                onClick={() => {
                  // Clear cache and reload
                  if ('caches' in window) {
                    caches.keys().then((names) => {
                      names.forEach((name) => caches.delete(name));
                    });
                  }
                  window.location.reload();
                }}
                className="w-full"
              >
                Reload App
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

function AppContent() {
  const { profile, loading, selectUser, clearUser, authState, userSelectKey } = useAuth();

  // Internal-usage analytics: capture only for authenticated staff on the
  // internal role-apps. Never runs on the public portal routes (they mount
  // outside AuthProvider) and analytics.ts independently refuses portal paths.
  useEffect(() => {
    if (authState === 'authenticated' && profile) {
      enableStaffAnalytics(profile);
    } else {
      disableStaffAnalytics();
    }
  }, [authState, profile]);


  // Debug logging in development only
  if (import.meta.env.DEV) {
    console.log('🔍 AppContent rendering...', { profile: profile?.username, loading });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center max-w-sm mx-auto px-4">
          <img
            src="https://cdn-ai.onspace.ai/onspace/files/EvPiYskzE4vCidikEdjr5Z/MB_Logo_Green_192x64_12.9kb.png"
            alt="Martin Builder OS"
            className="h-12 mx-auto mb-6"
          />
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground font-medium">Loading Martin Builder OS...</p>
        </div>
      </div>
    );
  }

  // Authentication flow based on state
  if (!profile) {
    return <UserSelectPage key={userSelectKey} onSelectUser={selectUser} />;
  }

  // User selected but needs to set up PIN
  if (authState === 'needs_pin_setup') {
    return <PinSetupPage user={profile} onComplete={() => {}} onBack={clearUser} />;
  }

  // User selected but needs to login
  if (authState === 'needs_login') {
    return <LoginPage user={profile} onSuccess={() => {}} onBack={clearUser} />;
  }

  // Critical: Role-based routing using profile.role from database
  // DO NOT use auth.user metadata - always check profile.role
  
  // Crew users: limited field interface (Jobs, Timer, Photos, Logs)
  // Legacy: 'foreman' is treated as 'crew'
  if (profile.role === 'crew' || profile.role === 'foreman') {
    return <ForemanDashboard />;
  }

  // Driver users: fleet-focused interface
  if (profile.role === 'driver') {
    // Let drivers pick any company (e.g. TriCounty or Martin Builder)
    return <FleetDashboard />;
  }

  // Office users: full admin dashboard (Jobs, Components, Logs, Time, Photos, Settings)
  if (profile.role === 'office') {
    return (
      <Routes>
        <Route path="/" element={<Navigate to="/office?tab=jobs" replace />} />
        <Route path="/office" element={<OfficeDashboard />} />
        <Route path="/office/quotes/new" element={<QuoteIntakePage />} />
        <Route path="/office/quotes/:quoteId" element={<QuoteIntakePage />} />
        <Route path="/office/estimator" element={<EstimatorHomePage />} />
        <Route path="/office/estimator/build" element={<BuildingEstimatorPage />} />
        <Route path="/office/zoho-settings" element={<ZohoSettingsPage />} />
        <Route path="/office/daily-report" element={<DailyReportPage />} />
        <Route path="*" element={<Navigate to="/office?tab=jobs" replace />} />
      </Routes>
    );
  }

  // Payroll users: time tracking and export for payroll processing
  if (profile.role === 'payroll') {
    return <PayrollDashboard />;
  }

  // Shop users: material processing and shop tasks
  if (profile.role === 'shop') {
    return <ShopDashboard />;
  }

  // Fallback: role not recognized - show error and force logout
  console.error('Invalid or missing user role:', profile.role);
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-4">
          <AlertTriangle className="w-12 h-12 mx-auto text-destructive" />
          <h2 className="text-xl font-bold">Account Not Configured</h2>
          <p className="text-sm text-muted-foreground">
            Your account role is not set up correctly. Please contact your administrator.
          </p>
          <Button onClick={() => window.location.reload()} className="w-full">
            Reload
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    // Prevent double-tap zoom on mobile
    let lastTouchEnd = 0;
    const handleTouchEnd = (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    };
    
    document.addEventListener('touchend', handleTouchEnd, false);

    // Check for service worker updates
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New service worker available
                console.log('[PWA] New version available');
                if (confirm('New version available! Reload to update?')) {
                  newWorker.postMessage({ type: 'SKIP_WAITING' });
                  window.location.reload();
                }
              }
            });
          }
        });

        // Check for updates every hour
        const updateInterval = setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);

        return () => {
          document.removeEventListener('touchend', handleTouchEnd);
          clearInterval(updateInterval);
        };
      });
    }
  }, []);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* Public vendor pricing form - no authentication required */}
          <Route path="/vendor-pricing/:token" element={<VendorPricingForm />} />
          {/* Public customer portal - no authentication required */}
          <Route path="/customer-portal" element={<CustomerPortal />} />
          {/* Public subcontractor portal - no-login shared link via ?sub=... */}
          <Route path="/subcontractor-portal" element={<SubcontractorPortal />} />
          {/* Public building plan share link - no-login via ?token=... */}
          <Route path="/plan" element={<PlanShare />} />
          
          {/* All other routes use main app authentication */}
          <Route path="/*" element={
            <AuthProvider>
              <UndoProvider>
                <AppContent />
                <Toaster position="top-center" richColors />
              </UndoProvider>
            </AuthProvider>
          } />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
