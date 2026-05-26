import { useState, useEffect, useLayoutEffect } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogOut, Briefcase, Clock, Camera, Settings, Users, Download, Eye, Archive, Calendar, ListTodo, FileText, Truck, Package, Box, Plus, Calculator, DollarSign, Mail, Receipt, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { JobsView } from '@/components/office/JobsView';
import { TimeEntriesView } from '@/components/office/TimeEntriesView';
import { DailyLogsView } from '@/components/office/DailyLogsView';
import { PhotosView } from '@/components/office/PhotosView';
import { ComponentsManagement } from '@/components/office/ComponentsManagement';
import { UserManagement } from '@/components/office/UserManagement';
import { WorkerManagement } from '@/components/office/WorkerManagement';
import { InternalJobsManagement } from '@/components/office/InternalJobsManagement';
import { DataExport } from '@/components/office/DataExport';
import { NotificationsCenter } from '@/components/office/NotificationsCenter';
import { NotificationBell } from '@/components/office/NotificationBell';
import { JobsCalendar } from '@/components/office/JobsCalendar';
import { MasterCalendar } from '@/components/office/MasterCalendar';
import { SubcontractorManagement } from '@/components/office/SubcontractorManagement';
import { EnhancedScheduleView } from '@/components/office/EnhancedScheduleView';
import { JobGanttChart } from '@/components/office/JobGanttChart';
import { ShopTasksManagement } from '@/components/office/ShopTasksManagement';
import { QuotesView } from '@/components/office/QuotesView';
import { QuoteConfigManagement } from '@/components/office/QuoteConfigManagement';
import { MaterialInventory } from '@/components/office/MaterialInventory';
import { ContactsManagement } from '@/components/office/ContactsManagement';
import { TrimPricingCalculator } from '@/components/office/TrimPricingCalculator';
import { EmailCenterView } from '@/components/office/EmailCenterView';

import { AllJobsTaskManagement } from '@/components/office/AllJobsTaskManagement';
import { FinancialDashboard } from '@/components/office/FinancialDashboard';
import { JobProposalCostBudgetPage } from '@/components/office/JobProposalCostBudgetPage';
import { useNavigate } from 'react-router-dom';
import { ForemanDashboard } from '@/pages/foreman/ForemanDashboard';
import { FleetDashboard } from '@/pages/fleet/FleetDashboard';
import { EmailSettings } from '@/components/office/EmailSettings';
import { PortalManagement } from '@/components/office/PortalManagement';
import { SubcontractorHubManagement } from '@/components/office/SubcontractorHubManagement';
import { QuickTimeEntry } from '@/components/foreman/QuickTimeEntry';
import { PWAInstallButton } from '@/components/ui/pwa-install-button';
import { Database } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PayrollDashboard } from '@/pages/payroll/PayrollDashboard';
import { readPersistedOpenJobId, readPersistedOpenJobTab, persistOpenJob, persistOpenJobTab, flushAgentDebugLogs, agentLog } from '@/lib/officeViewPersistence';
import { OfficeOpenJobDialog } from '@/components/office/OfficeOpenJobDialog';
import type { Job } from '@/types';

function readInitialOpenJobState() {
  if (typeof window === 'undefined') return { id: null as string | null, tab: 'overview' };
  const params = new URLSearchParams(window.location.search);
  return {
    id: params.get('jobId') || readPersistedOpenJobId(),
    tab: params.get('jobTab') || readPersistedOpenJobTab() || 'overview',
  };
}

export function OfficeDashboard() {
  const { profile, clearUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(() => {
    // Always default to 'jobs' tab for office users (ignore localStorage on initial load)
    return tabParam || 'jobs';
  });

  const initialOpenJob = readInitialOpenJobState();
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(initialOpenJob.id);
  const [openJobTab, setOpenJobTab] = useState(initialOpenJob.tab);

  function syncOpenJob(jobId: string | null, tab?: string) {
    const effectiveTab = tab ?? openJobTab;
    setSelectedJobId(jobId);
    if (jobId) setOpenJobTab(effectiveTab);
    persistOpenJob(jobId, jobId ? effectiveTab : null);
    agentLog({
      location: 'OfficeDashboard.tsx:syncOpenJob',
      message: 'syncOpenJob',
      data: { jobId, tab: effectiveTab },
      hypothesisId: 'J',
    });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (jobId) {
        next.set('jobId', jobId);
        next.set('jobTab', effectiveTab);
      } else {
        next.delete('jobId');
        next.delete('jobTab');
      }
      return next;
    }, { replace: true });
  }

  function handleOpenJobFromList(job: Job, tab?: string) {
    const effectiveTab = tab ?? openJobTab;
    setActiveTab('jobs');
    syncOpenJob(job.id, effectiveTab);
  }

  // On load: if localStorage has an open job but URL was reset (PWA start_url), restore URL params.
  useLayoutEffect(() => {
    if (!initialOpenJob.id) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('jobId')) return;
    agentLog({
      location: 'OfficeDashboard.tsx:mount-sync',
      message: 'restoring jobId to URL from storage',
      data: { jobId: initialOpenJob.id, tab: initialOpenJob.tab },
      hypothesisId: 'J',
    });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('jobId', initialOpenJob.id!);
      next.set('jobTab', initialOpenJob.tab);
      return next;
    }, { replace: true });
    persistOpenJob(initialOpenJob.id, initialOpenJob.tab);
  }, []);

  // Before paint: default to jobs only when URL has no explicit tab.
  // Preserve jobId, jobTab, and other params when adding tab=jobs.
  useLayoutEffect(() => {
    if (location.pathname !== '/office') return;
    if (tabParam) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', 'jobs');
      return next;
    }, { replace: true });
    setActiveTab('jobs');
  }, [location.pathname, tabParam, setSearchParams]);

  // #region agent log
  useEffect(() => {
    flushAgentDebugLogs();
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        if (selectedJobId) persistOpenJob(selectedJobId, openJobTab);
        return;
      }
      const jobId = readPersistedOpenJobId();
      if (jobId) {
        const tab = readPersistedOpenJobTab() || openJobTab;
        setSelectedJobId(jobId);
        setOpenJobTab(tab);
        persistOpenJob(jobId, tab);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('jobId', jobId);
          next.set('jobTab', tab);
          return next;
        }, { replace: true });
      }
      agentLog({
        location: 'OfficeDashboard.tsx:visibility',
        message: 'visibilitychange',
        data: {
          state: document.visibilityState,
          persistedJobId: readPersistedOpenJobId(),
          selectedJobId,
          activeTab,
          url: typeof window !== 'undefined' ? window.location.search : '',
        },
        hypothesisId: 'G',
      });
    };
    document.addEventListener('visibilitychange', onVis);
    const onPageHide = () => {
      if (selectedJobId) persistOpenJob(selectedJobId, openJobTab);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [selectedJobId, activeTab, openJobTab]);
  // #endregion

  // Keep localStorage in sync when URL carries jobId (survives PWA reload to start_url).
  useEffect(() => {
    const urlJobId = searchParams.get('jobId');
    if (!urlJobId) return;
    persistOpenJob(urlJobId, searchParams.get('jobTab'));
  }, [searchParams]);

  // When the URL tab changes (deep link, back/forward), sync state. Do NOT depend on `activeTab`:
  // after a tab click, `activeTab` updates before `tabParam`, and the old effect would reset the tab
  // to the previous URL value — rapid flashing between views.
  useEffect(() => {
    if (!tabParam) return;
    setActiveTab((prev) => (prev === tabParam ? prev : tabParam));
  }, [tabParam]);
  const [openMaterialsTab, setOpenMaterialsTab] = useState(false);
  const [materialsCount, setMaterialsCount] = useState(0);
  const [viewMode, setViewMode] = useState<'office' | 'field'>('office');
  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);

  // Save view state to localStorage and update URL
  // CRITICAL: Use replace: true to prevent scroll reset on URL changes
  // Background state sync - never causes page reload
  useEffect(() => {
    localStorage.setItem('office-active-tab', activeTab);
    // Silent URL update without triggering navigation/reload (preserve other params e.g. linkToMaterialItem)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', activeTab);
      return next;
    }, { replace: true });
  }, [activeTab, setSearchParams]);

  useEffect(() => {
    localStorage.setItem('office-view-mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    loadUnreadCount();
    loadMaterialsCount();
    
    // Subscribe to notification changes
    const channel = supabase
      .channel('notifications_count')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        () => {
          loadUnreadCount();
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
  
  async function loadUnreadCount() {
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false);
      
      if (error) throw error;
      setUnreadCount(count || 0);
    } catch (error) {
      console.error('Error loading unread count:', error);
    }
  }

  async function loadMaterialsCount() {
    try {
      const { count, error } = await supabase
        .from('materials_catalog')
        .select('*', { count: 'exact', head: true });
      
      if (error) throw error;
      setMaterialsCount(count || 0);
    } catch (error) {
      console.error('Error loading materials count:', error);
    }
  }

  const handleSignOut = () => {
    clearUser();
  };

  // If in field view mode, render the foreman dashboard
  if (viewMode === 'field') {
    return (
      <div className="min-h-screen bg-slate-50">
        {/* Header with view switcher */}
        <header className="bg-white border-b-2 border-slate-300 shadow-sm">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img 
                src="https://cdn-ai.onspace.ai/onspace/files/EvPiYskzE4vCidikEdjr5Z/MB_Logo_Green_192x64_12.9kb.png" 
                alt="Martin Builder OS" 
                className="h-10 w-auto"
              />
              <div className="border-l border-slate-300 pl-4">
                <h1 className="text-lg font-bold text-green-900 tracking-tight">Martin Builder OS</h1>
                <p className="text-xs text-black">Field View Preview</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="rounded-none border-slate-300 bg-white text-black hover:bg-slate-100">
                    <Eye className="w-4 h-4 mr-2" />
                    Field View
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-none border-slate-300">
                  <DropdownMenuItem onClick={() => setViewMode('office')} className="rounded-none">
                    Switch to Office View
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="text-right">
                <p className="text-sm font-bold text-black">{profile?.username || profile?.email}</p>
                <p className="text-xs text-black capitalize">{profile?.role}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={handleSignOut} className="rounded-none text-black hover:bg-slate-100">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </header>
        {/* Render the Foreman Dashboard */}
        <ForemanDashboard hideHeader={true} />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] md:min-h-screen bg-slate-50 overflow-x-hidden">
      {/* Header with Navigation - mobile: larger touch targets and padding; desktop: unchanged */}
      <header className="bg-white border-b-4 border-yellow-500 shadow-lg sticky top-0 z-50">
        <div className="w-full px-3 py-2 flex items-center justify-between gap-2 md:px-2 md:py-3 md:gap-4">
          {/* Logo - mobile: compact; desktop: unchanged */}
          <img 
            src="https://cdn-ai.onspace.ai/onspace/files/EvPiYskzE4vCidikEdjr5Z/MB_Logo_Green_192x64_12.9kb.png" 
            alt="Martin Builder OS" 
            className="h-8 w-auto flex-shrink-0 sm:h-10"
          />

          {/* Navigation Tabs - mobile: 44px touch targets, smooth scroll; desktop: unchanged */}
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-hide overflow-y-hidden py-1 -my-1 md:gap-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden touch-pan-x [&>button]:min-h-[44px] [&>button]:min-w-[44px] md:[&>button]:min-h-0 md:[&>button]:min-w-0">
            <Button
              variant={activeTab === 'jobs' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('jobs')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'jobs'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Briefcase className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Jobs</span>
            </Button>
            <Button
              variant={activeTab === 'quotes' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('quotes')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'quotes'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <FileText className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Quotes</span>
            </Button>
            <Button
              variant={activeTab === 'schedule' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('schedule')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'schedule'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Calendar className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Schedule</span>
            </Button>
            <Button
              variant={activeTab === 'calendar' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('calendar')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'calendar'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Calendar className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Calendar</span>
            </Button>
            <Button
              variant={activeTab === 'settings' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('settings')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'settings'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Settings className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
            <Button
              variant={activeTab === 'fleet' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('fleet')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'fleet'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Truck className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Fleet</span>
            </Button>
            <Button
              variant={activeTab === 'materials' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('materials')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'materials'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Package className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Materials</span>
            </Button>
            <Button
              variant={activeTab === 'trim-calculator' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('trim-calculator')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'trim-calculator'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Calculator className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Trim Calculator</span>
            </Button>
            <Button
              variant={activeTab === 'financials' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('financials')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'financials'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <DollarSign className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Financials</span>
            </Button>
            <Button
              variant={activeTab === 'proposal-cost-budget' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('proposal-cost-budget')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'proposal-cost-budget'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Scale className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Cost budget</span>
            </Button>
            <Button
              variant={activeTab === 'payroll' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('payroll')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'payroll'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Receipt className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Payroll</span>
            </Button>
            <Button
              variant={activeTab === 'email' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('email')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'email'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Mail className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Email</span>
            </Button>
            <Button
              variant={activeTab === 'contacts' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('contacts')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'contacts'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Users className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Contacts</span>
            </Button>
            <Button
              variant={activeTab === 'sub-hub' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('sub-hub')}
              className={`rounded-none h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0 ${
                activeTab === 'sub-hub'
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold hover:from-yellow-600 hover:to-yellow-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Users className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Sub Hub</span>
            </Button>

          </div>

          {/* Right Side Actions */}
          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            {/* Quick Time Clock for Office Users */}
            <div className="hidden sm:block">
              <QuickTimeEntry 
                userId={profile?.id || ''} 
                userRole={profile?.role}
                onSuccess={() => {
                  toast.success('Time logged successfully');
                }}
              />
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-none border-green-800 bg-white text-green-900 hover:bg-green-800 hover:text-white font-semibold h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm">
                  <Eye className="w-4 h-4 mr-1.5" />
                  <span className="hidden md:inline">Office View</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-none border-green-800 bg-white">
                <DropdownMenuItem onClick={() => setViewMode('field')} className="rounded-none hover:bg-green-800 hover:text-white">
                  Switch to Field View
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            <NotificationBell
              onNotificationClick={(notification) => {
                // Navigate based on notification type
                console.log('Notification clicked:', notification);
                
                // Set the job context if needed
                if (notification.job_id) {
                  setSelectedJobId(notification.job_id);
                }
                
                // Switch to appropriate tab
                switch (notification.type) {
                  case 'daily_log':
                    setActiveTab('logs');
                    break;
                  case 'time_entry':
                    setActiveTab('payroll');
                    break;
                  case 'photos':
                    setActiveTab('photos');
                    break;
                  case 'material_request':
                  case 'material_status':
                    // Navigate to the job with materials tab (crew orders)
                    setActiveTab('jobs');
                    setOpenMaterialsTab(true);
                    // Reset after navigation
                    setTimeout(() => setOpenMaterialsTab(false), 1000);
                    break;
                  case 'document_revision':
                    setActiveTab('jobs');
                    break;
                  default:
                    setActiveTab('notifications');
                }
              }}
              onViewAll={() => setActiveTab('notifications')}
            />
            
            <div className="text-right hidden lg:block">
              <p className="text-sm font-bold text-slate-900">{profile?.username || profile?.email}</p>
              <p className="text-xs text-slate-600 capitalize">{profile?.role}</p>
            </div>
            
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="rounded-none text-slate-900 hover:bg-green-800 hover:text-white h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm">
              <LogOut className="w-4 h-4 mr-1.5" />
              <span className="hidden md:inline">Sign Out</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Task Creation Dialog - Hidden component that only renders the dialog */}
      <AllJobsTaskManagement
        showCreateDialog={showCreateTaskDialog}
        onCloseCreateDialog={() => setShowCreateTaskDialog(false)}
      />

      {/* Main Content - mobile: more padding for thumbs; desktop: unchanged */}
      <main className="w-full px-4 py-4 md:px-2 md:py-6">
      {/* JobsView stays mounted (dialog uses portal). Only hide calendar when not on Jobs tab. */}
      <JobsView 
        delegateJobDialog
        onRequestOpenJob={handleOpenJobFromList}
        onRequestCloseJob={() => syncOpenJob(null)}
        hideJobList={activeTab !== 'jobs'}
        selectedJobId={selectedJobId} 
        openMaterialsTab={openMaterialsTab}
        onAddTask={() => setShowCreateTaskDialog(true)}
      />
      <div className={activeTab === 'jobs' ? 'space-y-6' : 'hidden'} aria-hidden={activeTab !== 'jobs'}>
            <MasterCalendar 
              onJobSelect={(jobId) => {
                syncOpenJob(jobId, openJobTab);
                setActiveTab('jobs');
              }} 
            />
      </div>

        {activeTab === 'quotes' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-slate-900 via-black to-slate-900 text-white rounded-lg p-4 shadow-lg border-2 border-yellow-500">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Quotes & Estimating</h2>
              <p className="text-yellow-400">Manage customer quotes and 3D building configurations</p>
            </div>
            
            {/* Quick Access Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => navigate('/office/estimator')}
                className="group bg-white border-2 border-blue-500 rounded-lg p-6 hover:border-blue-600 hover:shadow-xl transition-all text-left"
              >
                <div className="flex items-center gap-4 mb-3">
                  <div className="bg-blue-500 text-white rounded-lg p-3 group-hover:bg-blue-600 transition-colors">
                    <Box className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">3D Building Estimator</h3>
                    <p className="text-sm text-slate-600">Configure structures & calculate materials</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Design post-frame buildings in 3D, automatically calculate materials, and generate quotes
                </p>
              </button>
              
              <button
                onClick={() => {/* Navigate to quote intake */}}
                className="group bg-white border-2 border-green-600 rounded-lg p-6 hover:border-green-700 hover:shadow-xl transition-all text-left"
              >
                <div className="flex items-center gap-4 mb-3">
                  <div className="bg-green-600 text-white rounded-lg p-3 group-hover:bg-green-700 transition-colors">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Quote Management</h3>
                    <p className="text-sm text-slate-600">View and manage all quotes</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Track quote status, convert to jobs, and manage customer proposals
                </p>
              </button>
            </div>
            
            <QuotesView />
          </div>
        )}

        {activeTab === 'schedule' && (
          <EnhancedScheduleView />
        )}

        {activeTab === 'calendar' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-slate-900 via-black to-slate-900 text-white rounded-lg p-4 shadow-lg border-2 border-yellow-500">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Project Timeline</h2>
              <p className="text-yellow-400">Gantt chart view of all active projects</p>
            </div>
            <JobGanttChart onJobSelect={(jobId) => {
              setSelectedJobId(jobId);
              setActiveTab('jobs');
            }} />
          </div>
        )}

        {activeTab === 'fleet' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-slate-900 via-black to-slate-900 text-white rounded-lg p-4 shadow-lg border-2 border-yellow-500">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Fleet Management</h2>
              <p className="text-yellow-400">Manage vehicles, maintenance, and equipment tracking</p>
            </div>
            <FleetDashboard hideHeader={true} />
          </div>
        )}

        {activeTab === 'materials' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-slate-900 via-black to-slate-900 text-white rounded-lg p-4 shadow-lg border-2 border-yellow-500">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Material Inventory</h2>
              <p className="text-yellow-400">Manage your master materials catalog</p>
            </div>
            <MaterialInventory />
          </div>
        )}

        {activeTab === 'trim-calculator' && (
          <TrimPricingCalculator />
        )}

        {activeTab === 'financials' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-slate-900 via-black to-slate-900 text-white rounded-lg p-4 shadow-lg border-2 border-yellow-500">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Financial Management</h2>
              <p className="text-yellow-400">Track overhead, job budgets, and profitability</p>
            </div>
            <FinancialDashboard />
          </div>
        )}

        {activeTab === 'proposal-cost-budget' && <JobProposalCostBudgetPage />}

        {activeTab === 'payroll' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-slate-900 via-black to-slate-900 text-white rounded-lg p-4 shadow-lg border-2 border-yellow-500">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Payroll & Job Time</h2>
              <p className="text-yellow-400">
                Period reports, time off, job hours, and PDF export (same tools as the payroll login)
              </p>
            </div>
            <PayrollDashboard embed />
          </div>
        )}

        {activeTab === 'email' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-slate-900 via-black to-slate-900 text-white rounded-lg p-4 shadow-lg border-2 border-yellow-500">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Email Communications Center</h2>
              <p className="text-yellow-400">Manage all job communications in one place</p>
            </div>
            <EmailCenterView />
          </div>
        )}

        {activeTab === 'contacts' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-slate-900 via-black to-slate-900 text-white rounded-lg p-4 shadow-lg border-2 border-yellow-500">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Contacts Management</h2>
              <p className="text-yellow-400">Manage customers, vendors, and sub-contractors</p>
            </div>
            <ContactsManagement />
          </div>
        )}

        {activeTab === 'sub-hub' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-slate-900 via-black to-slate-900 text-white rounded-lg p-4 shadow-lg border-2 border-yellow-500">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Subcontractor Hub</h2>
              <p className="text-yellow-400">Manage all subcontractors and job visibility from one place</p>
            </div>
            <SubcontractorHubManagement />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-slate-900 via-black to-slate-900 text-white rounded-lg p-4 shadow-lg border-2 border-yellow-500">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Settings</h2>
              <p className="text-yellow-400">Manage system configuration, users, and data export</p>
            </div>
            
            <Tabs defaultValue="export" className="w-full">
              <TabsList className="flex flex-wrap w-full bg-black border-2 border-yellow-500 rounded-none shadow-lg">
                <TabsTrigger value="export" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </TabsTrigger>
                <TabsTrigger value="time" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Clock className="w-4 h-4 mr-2" />
                  Time
                </TabsTrigger>
                <TabsTrigger value="photos" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Camera className="w-4 h-4 mr-2" />
                  Photos
                </TabsTrigger>
                <TabsTrigger value="components" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Settings className="w-4 h-4 mr-2" />
                  Components
                </TabsTrigger>
                <TabsTrigger value="workers" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Users className="w-4 h-4 mr-2" />
                  Workers
                </TabsTrigger>
                <TabsTrigger value="subcontractors" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Users className="w-4 h-4 mr-2" />
                  Subs
                </TabsTrigger>
                <TabsTrigger value="internal" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Briefcase className="w-4 h-4 mr-2" />
                  Internal
                </TabsTrigger>
                <TabsTrigger value="users" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Users className="w-4 h-4 mr-2" />
                  Users
                </TabsTrigger>
                <TabsTrigger value="archived" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Archive className="w-4 h-4 mr-2" />
                  Archived
                </TabsTrigger>
                <TabsTrigger value="shop-tasks" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <ListTodo className="w-4 h-4 mr-2" />
                  Shop Tasks
                </TabsTrigger>
                <TabsTrigger value="office-tasks" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <ListTodo className="w-4 h-4 mr-2" />
                  Office Tasks
                </TabsTrigger>
                <TabsTrigger value="quote-config" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Settings className="w-4 h-4 mr-2" />
                  Quote Config
                </TabsTrigger>
                <TabsTrigger value="materials" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Settings className="w-4 h-4 mr-2" />
                  Materials
                </TabsTrigger>
                <TabsTrigger value="contacts" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Users className="w-4 h-4 mr-2" />
                  Contacts
                </TabsTrigger>
                <TabsTrigger value="email-settings" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Settings className="w-4 h-4 mr-2" />
                  Email Settings
                </TabsTrigger>
                <TabsTrigger value="portal-management" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Users className="w-4 h-4 mr-2" />
                  Portals
                </TabsTrigger>
                <TabsTrigger value="sub-hub" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Users className="w-4 h-4 mr-2" />
                  Sub Hub
                </TabsTrigger>
                <TabsTrigger value="zoho-integration" className="rounded-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-800 data-[state=active]:to-green-900 data-[state=active]:text-white data-[state=active]:font-bold text-white hover:bg-green-900/20">
                  <Database className="w-4 h-4 mr-2" />
                  Zoho Integration
                </TabsTrigger>
              </TabsList>

              <TabsContent value="export" className="mt-6">
                <DataExport />
              </TabsContent>

              <TabsContent value="time" className="mt-6">
                <TimeEntriesView />
              </TabsContent>

              <TabsContent value="photos" className="mt-6">
                <PhotosView />
              </TabsContent>

              <TabsContent value="components" className="mt-6">
                <ComponentsManagement />
              </TabsContent>

              <TabsContent value="workers" className="mt-6">
                <WorkerManagement />
              </TabsContent>

              <TabsContent value="subcontractors" className="mt-6">
                <SubcontractorManagement />
              </TabsContent>

              <TabsContent value="internal" className="mt-6">
                <InternalJobsManagement userId={profile?.id || ''} />
              </TabsContent>

              <TabsContent value="users" className="mt-6">
                <UserManagement />
              </TabsContent>

              <TabsContent value="archived" className="mt-6">
                <JobsView showArchived={true} />
              </TabsContent>

              <TabsContent value="shop-tasks" className="mt-6">
                <ShopTasksManagement userId={profile?.id || ''} />
              </TabsContent>

              <TabsContent value="office-tasks" className="mt-6">
                <div className="space-y-4">
                  {/* Header with New Task Button */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Office Tasks Management</h3>
                      <p className="text-sm text-slate-600">Create and manage tasks for all jobs</p>
                    </div>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setShowCreateTaskDialog(true)}
                      className="rounded-none bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold h-9 px-4 text-sm border-2 border-blue-800 shadow-md"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      New Task
                    </Button>
                  </div>
                  
                  {/* View All Task Calendar Button */}
                  <Button
                    variant="outline"
                    onClick={() => setActiveTab('calendar')}
                    className="rounded-none border-2 border-slate-300 hover:bg-slate-100 w-full sm:w-auto"
                  >
                    <Calendar className="w-4 h-4 mr-2" />
                    View All Task Calendar
                  </Button>
                  
                  {/* All Jobs Task Management */}
                  <AllJobsTaskManagement />
                </div>
              </TabsContent>

              <TabsContent value="quote-config" className="mt-6">
                <QuoteConfigManagement />
              </TabsContent>

              <TabsContent value="materials" className="mt-6">
                <MaterialInventory />
              </TabsContent>

              <TabsContent value="contacts" className="mt-6">
                <ContactsManagement />
              </TabsContent>

              <TabsContent value="email-settings" className="mt-6">
                <EmailSettings />
              </TabsContent>

              <TabsContent value="portal-management" className="mt-6">
                <PortalManagement />
              </TabsContent>

              <TabsContent value="sub-hub" className="mt-6">
                <SubcontractorHubManagement />
              </TabsContent>

              <TabsContent value="zoho-integration" className="mt-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Zoho Books Integration</h3>
                    <p className="text-sm text-slate-600">Connect to Zoho Books to sync vendors and materials from COUNTYWIDE organization</p>
                  </div>
                  <Button
                    variant="default"
                    onClick={() => navigate('/office/zoho-settings')}
                    className="rounded-none bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold"
                  >
                    <Database className="w-4 h-4 mr-2" />
                    Configure Zoho Integration
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>

      <OfficeOpenJobDialog
        jobId={selectedJobId}
        jobTab={openJobTab}
        visible
        onClose={() => syncOpenJob(null)}
        onTabChange={(tab) => {
          setOpenJobTab(tab);
          persistOpenJobTab(tab);
          if (selectedJobId) {
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.set('jobTab', tab);
              return next;
            }, { replace: true });
          }
        }}
      />

      {/* PWA Install Button */}
      <PWAInstallButton />
    </div>
  );
}
