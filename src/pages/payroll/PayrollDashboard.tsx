
import { useState, useEffect, Fragment } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { 
  Download, 
  Calendar, 
  Users, 
  Clock, 
  Plus,
  LogOut,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Edit,
  Trash2,
  CalendarDays,
  Briefcase,
  Search
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { UnavailableCalendar } from '@/components/foreman/UnavailableCalendar';
import { format } from 'date-fns';
import { ensureDefaultTimeEntryJobs, prioritizeDefaultJobs } from '@/lib/defaultJobs';
import type { Job } from '@/types';

// ⚠️ CRITICAL: ALL TIMES MUST DISPLAY IN EASTERN TIME (EST/EDT)
// This ensures payroll times match when employees actually clocked in/out
// DO NOT CHANGE THIS TIMEZONE - it must remain 'America/New_York'
const PAYROLL_TIMEZONE = 'America/New_York';

/** When stored start/end are missing or equal but hours > 0, extend end by reconcileHours for display. */
function formatPayrollClockDisplay(
  startIso: string,
  endIso: string | null,
  reconcileHours: number | null
): { startLabel: string; endLabel: string } {
  const fmt = (instantMs: number) =>
    new Date(instantMs).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: PAYROLL_TIMEZONE,
    });

  const startMs = new Date(startIso).getTime();
  if (!Number.isFinite(startMs)) {
    return { startLabel: '—', endLabel: '—' };
  }

  let endMs = endIso ? new Date(endIso).getTime() : NaN;
  const sameOrMissingEnd =
    !Number.isFinite(endMs) || Math.abs(endMs - startMs) < 60 * 1000;

  if (reconcileHours != null && reconcileHours > 0.01 && sameOrMissingEnd) {
    endMs = startMs + reconcileHours * 60 * 60 * 1000;
  }

  return {
    startLabel: fmt(startMs),
    endLabel: Number.isFinite(endMs) ? fmt(endMs) : '—',
  };
}

interface TimeEntryData {
  id: string;
  job_id: string;
  component_id: string | null;
  user_id: string;
  start_time: string;
  end_time: string | null;
  total_hours: number | null;
  crew_count: number;
  is_manual: boolean;
  notes: string | null;
  worker_names: string[];
  jobs?: { name: string; client_name: string };
  /** Present when loading a row for edit (join from components table) */
  components?: { name: string } | null;
}

interface DateEntryData {
  date: string;
  entries: {
    entryId: string;
    jobName: string;
    clientName: string;
    /** Set when time is logged to a job component (foreman breakdown); shown as a tag in payroll */
    componentName: string | null;
    startTime: string;
    endTime: string | null;
    /** Job-level shift hours when this row uses session clock (component breakdown); for display repair */
    jobShiftHoursForDisplay: number | null;
    totalHours: number;
    isManual: boolean;
    notes: string | null;
  }[]; 
  totalHours: number;
}

/**
 * Manual job + component breakdown saves one job-level row (component_id null) plus one row per component
 * with the same start_time. For payroll we show component lines with tags and omit the duplicate job total
 * so hours are not double-counted.
 */
function payrollSessionKey(entry: { user_id: string; job_id: string; start_time: string }) {
  return `${entry.user_id}|${entry.job_id}|${entry.start_time}`;
}

function groupTimeEntriesBySession(entries: any[]): Map<string, any[]> {
  const byKey = new Map<string, any[]>();
  for (const e of entries) {
    const key = payrollSessionKey(e);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(e);
  }
  return byKey;
}

/**
 * Job + component breakdown stores the crew's real clock-in/out on the job-level row only.
 * Component rows share start_time and use synthetic end_time; payroll should show the entered shift times.
 */
function buildSessionClockDisplayByKey(
  rawEntries: any[]
): Map<string, { start: string; end: string | null; jobTotalHours: number | null }> {
  const map = new Map<string, { start: string; end: string | null; jobTotalHours: number | null }>();
  for (const [key, group] of groupTimeEntriesBySession(rawEntries)) {
    const jobRow = group.find((row) => row.component_id == null);
    if (jobRow) {
      map.set(key, {
        start: jobRow.start_time,
        end: jobRow.end_time,
        jobTotalHours:
          jobRow.total_hours != null ? Number(jobRow.total_hours) : null,
      });
    }
  }
  return map;
}

function filterPayrollTimeEntries(entries: any[]): any[] {
  const out: any[] = [];
  for (const group of groupTimeEntriesBySession(entries).values()) {
    const hasComponent = group.some((row) => row.component_id != null);
    if (hasComponent) {
      out.push(...group.filter((row) => row.component_id != null));
    } else {
      out.push(...group);
    }
  }
  return out.sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );
}

function isMiscJobEntry(entryNotes: string | null): boolean {
  if (!entryNotes) return false;
  try {
    const data = JSON.parse(entryNotes);
    return data.type === 'misc_job';
  } catch {
    return false;
  }
}

function isGenericPayrollNote(note: string): boolean {
  const normalized = note.trim().toLowerCase();
  return normalized === 'manual entry' || normalized === 'shop - manual entry';
}

/** User-entered note text for display under the job name. */
function getPayrollEntryDisplayNote(entryNotes: string | null): string {
  if (!entryNotes) return '';
  try {
    const data = JSON.parse(entryNotes);
    if (data.type === 'misc_job') {
      const note = data.notes || '';
      return isGenericPayrollNote(note) ? '' : note;
    }
  } catch {
    return isGenericPayrollNote(entryNotes) ? '' : entryNotes;
  }
  return isGenericPayrollNote(entryNotes) ? '' : entryNotes;
}

function buildPayrollEntryNotesForSave(
  originalNotes: string | null,
  userNotes: string
): string | null {
  const trimmed = userNotes.trim();

  if (originalNotes) {
    try {
      const data = JSON.parse(originalNotes);
      if (data.type === 'misc_job') {
        return JSON.stringify({ ...data, notes: trimmed });
      }
    } catch {
      // fall through for plain-text notes
    }
  }

  return trimmed || null;
}

/** Misc jobs and internal crew jobs use a generic "Internal" client tag — omit it in payroll. */
function getPayrollEntryClientLabel(
  jobClientName: string,
  entryNotes: string | null
): string {
  if (isMiscJobEntry(entryNotes)) {
    return '';
  }
  if (jobClientName.trim().toLowerCase() === 'internal') {
    return '';
  }
  return jobClientName;
}

interface UserTimeData {
  userId: string;
  userName: string;
  totalHours: number;
  dateEntries: DateEntryData[];
}

interface WeekData {
  weekStart: string;
  weekEnd: string;
  users: UserTimeData[];
}

type PeriodType = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

function resolvePeriodBounds(
  periodType: PeriodType,
  selectedPeriod: string,
  customStartDate: string,
  customEndDate: string
): { start: string; end: string } | null {
  let periodStart: Date;
  let periodEnd: Date;

  if (periodType === 'custom') {
    if (!customStartDate || !customEndDate) return null;
    periodStart = new Date(customStartDate);
    periodEnd = new Date(customEndDate);
  } else {
    if (!selectedPeriod) return null;
    periodStart = new Date(selectedPeriod);
    periodEnd = new Date(periodStart);

    if (periodType === 'weekly') {
      periodEnd.setDate(periodStart.getDate() + 6);
    } else if (periodType === 'biweekly') {
      periodEnd.setDate(periodStart.getDate() + 13);
    } else if (periodType === 'monthly') {
      periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0);
    } else if (periodType === 'quarterly') {
      periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 3, 0);
    } else if (periodType === 'yearly') {
      periodEnd = new Date();
    }
  }

  return {
    start: periodStart.toISOString().split('T')[0],
    end: periodEnd.toISOString().split('T')[0],
  };
}

function applyPayrollFilters(
  users: UserTimeData[],
  selectedUserId: string,
  customerSearch: string
): UserTimeData[] {
  const baseUsers =
    selectedUserId === 'all'
      ? users
      : users.filter((user) => user.userId === selectedUserId);

  const query = customerSearch.trim().toLowerCase();
  if (!query) return baseUsers;

  return baseUsers
    .map((user) => {
      const dateEntries = user.dateEntries
        .map((dateEntry) => {
          const entries = dateEntry.entries.filter(
            (entry) =>
              entry.clientName.toLowerCase().includes(query) ||
              entry.jobName.toLowerCase().includes(query)
          );
          const totalHours = entries.reduce(
            (sum, entry) =>
              sum + (entry.entryId.startsWith('timeoff-') ? 0 : entry.totalHours),
            0
          );
          return { ...dateEntry, entries, totalHours };
        })
        .filter((dateEntry) => dateEntry.entries.length > 0);

      const totalHours = dateEntries.reduce(
        (sum, dateEntry) => sum + dateEntry.totalHours,
        0
      );

      return { ...user, dateEntries, totalHours };
    })
    .filter((user) => user.dateEntries.length > 0);
}

export type PayrollDashboardProps = {
  /** When true, hides the standalone payroll header (logout). Used inside Office dashboard. */
  embed?: boolean;
};

export function PayrollDashboard({ embed = false }: PayrollDashboardProps) {
  const { profile, clearUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [periodType, setPeriodType] = useState<PeriodType>('weekly');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [periodOptions, setPeriodOptions] = useState<{ value: string; label: string }[]>([]);
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [weekData, setWeekData] = useState<WeekData | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [customerSearch, setCustomerSearch] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [editingEntry, setEditingEntry] = useState<TimeEntryData | null>(null);
  const [editForm, setEditForm] = useState({
    hours: '0',
    minutes: '0',
    notes: '',
  });
  const [activeTab, setActiveTab] = useState<'time-entries' | 'time-off' | 'job-hours'>('time-entries');
  
  // Job hours state
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [jobHoursData, setJobHoursData] = useState<any[]>([]);
  const [loadingJobHours, setLoadingJobHours] = useState(false);
  const [exportingJobHours, setExportingJobHours] = useState(false);
  const [payrollUsers, setPayrollUsers] = useState<{ id: string; username: string | null; email?: string | null }[]>([]);
  const [showAddTimeDialog, setShowAddTimeDialog] = useState(false);
  const [savingAddTime, setSavingAddTime] = useState(false);
  const [addTimeForm, setAddTimeForm] = useState({
    userId: '',
    jobId: '',
    date: new Date().toISOString().split('T')[0],
    startTime: '',
    endTime: '',
    notes: '',
  });

  useEffect(() => {
    generatePeriodOptions();
    loadJobs();
    loadPayrollUsers();
  }, [periodType]);

  useEffect(() => {
    if (periodType === 'custom') {
      if (customStartDate && customEndDate) {
        loadPeriodData();
      }
    } else if (selectedPeriod) {
      loadPeriodData();
    }
  }, [selectedPeriod, customStartDate, customEndDate]);

  useEffect(() => {
    if (selectedJobId) {
      loadJobHours();
    }
  }, [selectedJobId]);

  async function loadJobs() {
    try {
      const defaultJobs = await ensureDefaultTimeEntryJobs(profile?.id);

      const { data, error } = await supabase
        .from('jobs')
        .select('id, name, client_name, address')
        .order('name');

      if (error) throw error;
      setJobs(prioritizeDefaultJobs((data || []) as Job[], defaultJobs));
    } catch (error: any) {
      console.error('Error loading jobs:', error);
    }
  }

  async function loadPayrollUsers() {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, username, email')
        .order('username');

      if (error) throw error;
      setPayrollUsers(data || []);
    } catch (error: any) {
      console.error('Error loading payroll users:', error);
    }
  }

  async function addTimeEntryForUser() {
    if (!addTimeForm.userId || !addTimeForm.jobId || !addTimeForm.date || !addTimeForm.startTime || !addTimeForm.endTime) {
      toast.error('Please complete all required fields');
      return;
    }

    const startDateTime = new Date(`${addTimeForm.date}T${addTimeForm.startTime}`);
    const endDateTime = new Date(`${addTimeForm.date}T${addTimeForm.endTime}`);
    const totalHours = (endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60 * 60);

    if (totalHours <= 0) {
      toast.error('End time must be after start time');
      return;
    }

    setSavingAddTime(true);
    try {
      const { error } = await supabase
        .from('time_entries')
        .insert({
          user_id: addTimeForm.userId,
          job_id: addTimeForm.jobId,
          component_id: null, // Payroll should create clock-in style entries
          start_time: startDateTime.toISOString(),
          end_time: endDateTime.toISOString(),
          total_hours: totalHours,
          crew_count: 1,
          worker_names: null,
          notes: addTimeForm.notes.trim() || null,
          is_manual: true,
          is_active: false,
        });

      if (error) throw error;

      toast.success('Time entry added');
      setShowAddTimeDialog(false);
      setAddTimeForm({
        userId: '',
        jobId: '',
        date: new Date().toISOString().split('T')[0],
        startTime: '',
        endTime: '',
        notes: '',
      });
      loadPeriodData();
    } catch (error: any) {
      console.error('Error adding time entry:', error);
      toast.error(error.message || 'Failed to add time entry');
    } finally {
      setSavingAddTime(false);
    }
  }

  async function loadJobHours() {
    if (!selectedJobId) return;

    setLoadingJobHours(true);
    try {
      const { data: timeEntries, error } = await supabase
        .from('time_entries')
        .select(`
          *,
          components(name),
          user_profiles(username, email)
        `)
        .eq('job_id', selectedJobId)
        .eq('is_active', false)
        .order('start_time', { ascending: true });

      if (error) throw error;

      // Group by user
      const userMap = new Map<string, any>();
      
      (timeEntries || []).forEach(entry => {
        const userId = entry.user_id;
        const userName = entry.user_profiles?.username || entry.user_profiles?.email || 'Unknown User';
        
        if (!userMap.has(userId)) {
          userMap.set(userId, {
            userId,
            userName,
            totalHours: 0,
            entries: [],
          });
        }
        
        const userData = userMap.get(userId)!;
        userData.totalHours += entry.total_hours || 0;
        userData.entries.push({
          date: format(new Date(entry.start_time), 'MMM d, yyyy'),
          component: entry.components?.name || 'Clock In/Out',
          startTime: format(new Date(entry.start_time), 'h:mm a'),
          endTime: entry.end_time ? format(new Date(entry.end_time), 'h:mm a') : '-',
          hours: (entry.total_hours || 0).toFixed(2),
          crewCount: entry.crew_count || 1,
          notes: entry.notes || '',
          isManual: entry.is_manual,
        });
      });

      const users = Array.from(userMap.values()).sort((a, b) => 
        a.userName.localeCompare(b.userName)
      );

      setJobHoursData(users);
    } catch (error: any) {
      console.error('Error loading job hours:', error);
      toast.error('Failed to load job hours');
    } finally {
      setLoadingJobHours(false);
    }
  }

  async function printJobHours() {
    if (!selectedJobId || jobHoursData.length === 0) {
      toast.error('No job hours to print');
      return;
    }

    setExportingJobHours(true);

    try {
      const job = jobs.find(j => j.id === selectedJobId);
      if (!job) {
        toast.error('Job not found');
        return;
      }

      const totalHours = jobHoursData.reduce((sum, user) => sum + user.totalHours, 0);

      const pdfData = {
        title: 'Job Hours Report',
        jobName: job.name,
        clientName: job.client_name,
        address: job.address,
        totalHours: totalHours.toFixed(2),
        users: jobHoursData,
      };

      const { data, error } = await supabase.functions.invoke('generate-pdf', {
        body: {
          type: 'job-hours',
          data: pdfData,
        },
      });

      if (error) {
        if (error instanceof FunctionsHttpError) {
          const errorText = await error.context.text();
          throw new Error(errorText || error.message);
        }
        throw error;
      }

      // Open HTML in new window with print dialog
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(data);
        printWindow.document.close();
      } else {
        toast.error('Please allow popups to print');
      }

      toast.success('Print dialog opened');
    } catch (error: any) {
      console.error('Print error:', error);
      toast.error(error.message || 'Failed to generate print preview');
    } finally {
      setExportingJobHours(false);
    }
  }

  function generatePeriodOptions() {
    const periods: { value: string; label: string }[] = [];
    const today = new Date();
    
    if (periodType === 'weekly') {
      // Generate last 12 weeks (Monday to Sunday)
      for (let i = 0; i < 12; i++) {
        const weekStart = new Date(today);
        // Calculate days to subtract to get to Monday
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // If Sunday, go back 6 days; otherwise go back to Monday
        weekStart.setDate(today.getDate() - daysToMonday - (i * 7)); // Monday
        weekStart.setHours(0, 0, 0, 0);
        
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6); // Sunday (end of week)
        weekEnd.setHours(23, 59, 59, 999);
        
        const value = weekStart.toISOString().split('T')[0];
        const label = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        
        periods.push({ value, label });
      }
    } else if (periodType === 'biweekly') {
      // Generate last 12 biweekly periods (Monday to Sunday)
      for (let i = 0; i < 12; i++) {
        const periodStart = new Date(today);
        // Calculate days to subtract to get to Monday
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // If Sunday, go back 6 days; otherwise go back to Monday
        periodStart.setDate(today.getDate() - daysToMonday - (i * 14)); // Monday
        periodStart.setHours(0, 0, 0, 0);
        
        const periodEnd = new Date(periodStart);
        periodEnd.setDate(periodStart.getDate() + 13); // 2 weeks (ending on Sunday)
        periodEnd.setHours(23, 59, 59, 999);
        
        const value = periodStart.toISOString().split('T')[0];
        const label = `${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        
        periods.push({ value, label });
      }
    } else if (periodType === 'monthly') {
      // Generate last 12 months
      for (let i = 0; i < 12; i++) {
        const monthStart = new Date(today.getFullYear(), today.getMonth() - i, 1);
        monthStart.setHours(0, 0, 0, 0);
        
        const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
        monthEnd.setHours(23, 59, 59, 999);
        
        const value = monthStart.toISOString().split('T')[0];
        const label = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        
        periods.push({ value, label });
      }
    } else if (periodType === 'quarterly') {
      // Generate last 8 quarters
      for (let i = 0; i < 8; i++) {
        const currentQuarter = Math.floor(today.getMonth() / 3);
        const quarterYear = today.getFullYear() - Math.floor(i / 4);
        const quarter = (currentQuarter - i % 4 + 4) % 4;
        
        const quarterStart = new Date(quarterYear, quarter * 3, 1);
        quarterStart.setHours(0, 0, 0, 0);
        
        const quarterEnd = new Date(quarterYear, (quarter + 1) * 3, 0);
        quarterEnd.setHours(23, 59, 59, 999);
        
        const value = quarterStart.toISOString().split('T')[0];
        const label = `Q${quarter + 1} ${quarterYear} (${quarterStart.toLocaleDateString('en-US', { month: 'short' })} - ${quarterEnd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})`;
        
        periods.push({ value, label });
      }
    } else if (periodType === 'yearly') {
      // Year-to-date: Jan 1 of current calendar year through today
      const year = today.getFullYear();
      const yearStart = new Date(year, 0, 1);
      yearStart.setHours(0, 0, 0, 0);
      const value = yearStart.toISOString().split('T')[0];
      const label = `YTD ${year} (${yearStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`;
      periods.push({ value, label });
    }
    
    setPeriodOptions(periods);
    if (periods.length > 0 && periodType !== 'custom') {
      setSelectedPeriod(periods[0].value);
    }
  }

  async function loadPeriodData() {
    let periodStart: Date;
    let periodEnd: Date;

    if (periodType === 'custom') {
      if (!customStartDate || !customEndDate) return;
      periodStart = new Date(customStartDate);
      periodEnd = new Date(customEndDate);
    } else {
      if (!selectedPeriod) return;
      periodStart = new Date(selectedPeriod);
      
      // Calculate end date based on period type
      periodEnd = new Date(periodStart);
      if (periodType === 'weekly') {
        periodEnd.setDate(periodStart.getDate() + 6);
      } else if (periodType === 'biweekly') {
        periodEnd.setDate(periodStart.getDate() + 13);
      } else if (periodType === 'monthly') {
        periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0);
      } else if (periodType === 'quarterly') {
        periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 3, 0);
      } else if (periodType === 'yearly') {
        periodEnd = new Date();
      }
    }
    
    periodStart.setHours(0, 0, 0, 0);
    periodEnd.setHours(23, 59, 59, 999);
    
    setLoading(true);
    
    try {
      const weekStart = periodStart;
      const weekEnd = periodEnd;
      
      const { data: rawTimeEntries, error: timeError } = await supabase
        .from('time_entries')
        .select(`
          *,
          jobs(name, client_name),
          components(name)
        `)
        .gte('start_time', weekStart.toISOString())
        .lte('start_time', weekEnd.toISOString())
        .eq('is_active', false)
        .not('total_hours', 'is', null)
        .order('start_time', { ascending: true });

      if (timeError) throw timeError;

      const rawList = rawTimeEntries || [];
      const sessionClockByKey = buildSessionClockDisplayByKey(rawList);
      const timeEntries = filterPayrollTimeEntries(rawList);

      // Load time off dates that overlap with this week
      const { data: timeOffDates, error: timeOffError } = await supabase
        .from('user_unavailable_dates')
        .select('user_id, start_date, end_date, reason')
        .lte('start_date', weekEnd.toISOString().split('T')[0])
        .gte('end_date', weekStart.toISOString().split('T')[0]);

      if (timeOffError) throw timeOffError;

      // Load all users
      const { data: users, error: usersError } = await supabase
        .from('user_profiles')
        .select('id, username')
        .order('username');

      if (usersError) throw usersError;

      // Group entries by user, then by date
      const userMap = new Map<string, UserTimeData>();
      
      users.forEach(user => {
        userMap.set(user.id, {
          userId: user.id,
          userName: user.username || 'Unknown User',
          totalHours: 0,
          dateEntries: [],
        });
      });

      // Add time entries (include Saturday; exclude Sunday only)
      (timeEntries || []).forEach((entry: any) => {
        const userData = userMap.get(entry.user_id);
        if (userData) {
          // Get date string (YYYY-MM-DD) in LOCAL timezone
          const date = new Date(entry.start_time);
          const dayOfWeek = date.getDay();
          
          // Skip Sunday (0)
          if (dayOfWeek === 0) {
            return;
          }
          
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          
          // Find or create date entry
          let dateData = userData.dateEntries.find(d => d.date === dateStr);
          if (!dateData) {
            dateData = {
              date: dateStr,
              entries: [],
              totalHours: 0,
            };
            userData.dateEntries.push(dateData);
          }
          
          const sk = payrollSessionKey(entry);
          const sessionClock = sessionClockByKey.get(sk);
          const useEnteredShiftClock =
            entry.component_id != null && sessionClock != null;

          // Add entry to date
          dateData.entries.push({
            entryId: entry.id,
            jobName: entry.jobs?.name || 'Unknown Job',
            clientName: getPayrollEntryClientLabel(
              entry.jobs?.client_name || '',
              entry.notes
            ),
            componentName: entry.components?.name ?? null,
            startTime: useEnteredShiftClock ? sessionClock.start : entry.start_time,
            endTime: useEnteredShiftClock ? sessionClock.end : entry.end_time,
            jobShiftHoursForDisplay:
              useEnteredShiftClock && sessionClock.jobTotalHours != null
                ? sessionClock.jobTotalHours
                : null,
            totalHours: entry.total_hours || 0,
            isManual: entry.is_manual,
            notes: entry.notes,
          });
          
          dateData.totalHours += entry.total_hours || 0;
          userData.totalHours += entry.total_hours || 0;
        }
      });

      // Add time off entries for users who have time off but no time entries (exclude Sunday only)
      (timeOffDates || []).forEach((timeOff: any) => {
        const userData = userMap.get(timeOff.user_id);
        if (!userData) return;

        // Get all days in the time off range that fall within the week
        const start = new Date(Math.max(new Date(timeOff.start_date).getTime(), weekStart.getTime()));
        const end = new Date(Math.min(new Date(timeOff.end_date).getTime(), weekEnd.getTime()));

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dayOfWeek = d.getDay();
          
          // Skip Sunday (0)
          if (dayOfWeek === 0) {
            continue;
          }
          
          // Format date in local timezone
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          
          // Find or create date entry
          let dateData = userData.dateEntries.find(d => d.date === dateStr);
          if (!dateData) {
            dateData = {
              date: dateStr,
              entries: [],
              totalHours: 0,
            };
            userData.dateEntries.push(dateData);
          }

          const alreadyHasTimeOff = dateData.entries.some((entry) =>
            entry.entryId.startsWith('timeoff-')
          );

          if (!alreadyHasTimeOff) {
            // Add time off entry (use a special ID pattern to identify it)
            dateData.entries.push({
              entryId: `timeoff-${timeOff.user_id}-${dateStr}`,
              jobName: 'Time Off',
              clientName: timeOff.reason || 'Time Off',
              componentName: null,
              startTime: dateStr,
              endTime: null,
              jobShiftHoursForDisplay: null,
              totalHours: 0,
              isManual: false,
              notes: timeOff.reason,
            });
          }
        }
      });

      // Convert to array and filter out users with no hours OR time off, sort dates within each user
      const usersWithTime = Array.from(userMap.values())
        .filter(u => u.totalHours > 0 || u.dateEntries.length > 0)
        .map(u => ({
          ...u,
          dateEntries: u.dateEntries.sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            return dateA - dateB; // Ascending: oldest to newest
          }),
        }))
        .sort((a, b) => a.userName.localeCompare(b.userName));

      setWeekData({
        weekStart: periodStart.toISOString(),
        weekEnd: periodEnd.toISOString(),
        users: usersWithTime,
      });
    } catch (error: any) {
      console.error('Error loading week data:', error);
      toast.error('Failed to load time data');
    } finally {
      setLoading(false);
    }
  }

  function toggleUserExpanded(userId: string) {
    const newExpanded = new Set(expandedUsers);
    if (newExpanded.has(userId)) {
      newExpanded.delete(userId);
    } else {
      newExpanded.add(userId);
    }
    setExpandedUsers(newExpanded);
  }

  async function exportWeekToPDF() {
    if (!weekData) return;

    setLoading(true);
    
    try {
      const usersToExport = applyPayrollFilters(
        weekData.users,
        selectedUser,
        customerSearch
      );

      let periodLabel = '';
      if (periodType === 'custom') {
        const start = new Date(customStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const end = new Date(customEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        periodLabel = `${start} - ${end}`;
      } else {
        periodLabel = periodOptions.find(p => p.value === selectedPeriod)?.label || 'period';
      }
      
      // Calculate exact date range for PDF
      let startDate: Date;
      let endDate: Date;
      
      if (periodType === 'custom') {
        startDate = new Date(customStartDate);
        endDate = new Date(customEndDate);
      } else {
        startDate = new Date(selectedPeriod);
        endDate = new Date(weekData.weekEnd);
      }

      const startDateStr = startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const endDateStr = endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      // Prepare data for PDF - keep the same date-based structure as the display
      const pdfData = {
        title: 'Payroll Report',
        periodLabel,
        startDate: startDateStr,
        endDate: endDateStr,
        users: usersToExport.map(user => ({
          name: user.userName,
          totalHours: user.totalHours,
          dateEntries: user.dateEntries.map(dateEntry => {
            // Parse date in local timezone to avoid UTC offset issues
            const [year, month, day] = dateEntry.date.split('-').map(Number);
            const localDate = new Date(year, month - 1, day);
            
            return {
              date: localDate.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              }),
              totalHours: dateEntry.totalHours,
              hasMultipleJobs: dateEntry.entries.filter(e => !e.entryId.startsWith('timeoff-')).length > 1,
              entries: dateEntry.entries.map(entry => {
                const isTimeOff = entry.entryId.startsWith('timeoff-');
                const reconcileCandidate = entry.jobShiftHoursForDisplay ?? entry.totalHours;
                const reconcile =
                  !isTimeOff && reconcileCandidate > 0.01 ? reconcileCandidate : null;
                const clock = isTimeOff
                  ? { startLabel: '-', endLabel: '-' }
                  : formatPayrollClockDisplay(entry.startTime, entry.endTime, reconcile);
                return {
                  jobName: entry.jobName,
                  clientName: entry.clientName,
                  displayNote: isTimeOff ? '' : getPayrollEntryDisplayNote(entry.notes),
                  componentName: entry.componentName,
                  startTime: clock.startLabel,
                  endTime: clock.endLabel,
                  hours: isTimeOff ? '-' : entry.totalHours.toFixed(2),
                  isTimeOff: isTimeOff,
                };
              }),
            };
          }),
        })),
      };

      // Call Edge Function to generate PDF-ready HTML
      const { data, error } = await supabase.functions.invoke('generate-pdf', {
        body: {
          type: 'payroll',
          data: pdfData,
        },
      });

      if (error) {
        if (error instanceof FunctionsHttpError) {
          const errorText = await error.context.text();
          throw new Error(errorText || error.message);
        }
        throw error;
      }

      // Open HTML in new window with print dialog
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(data);
        printWindow.document.close();
      } else {
        toast.error('Please allow popups to export PDF');
      }

      toast.success('PDF print dialog opened');
    } catch (error: any) {
      console.error('PDF export error:', error);
      toast.error(error.message || 'Failed to export PDF');
    } finally {
      setLoading(false);
    }
  }



  const filteredUsers = applyPayrollFilters(
    weekData?.users || [],
    selectedUser,
    customerSearch
  );

  const filteredJobs = jobs.filter(job => {
    const query = jobSearch.trim().toLowerCase();
    if (!query) return true;
    return (
      (job.client_name || '').toLowerCase().includes(query) ||
      (job.name || '').toLowerCase().includes(query)
    );
  });

  const totalWeekHours = filteredUsers.reduce((sum, u) => sum + u.totalHours, 0);
  const totalEntries = filteredUsers.reduce((sum, u) => 
    sum + u.dateEntries.reduce((dateSum, d) => dateSum + d.entries.length, 0), 0
  );
  const hasActiveFilters = Boolean(customerSearch.trim()) || selectedUser !== 'all';

  async function openEditDialog(entryId: string) {
    // Don't allow editing time off entries
    if (entryId.startsWith('timeoff-')) {
      toast.error('Time off entries cannot be edited from payroll');
      return;
    }

    try {
      // Fetch the full entry details
      const { data, error } = await supabase
        .from('time_entries')
        .select('*, components(name)')
        .eq('id', entryId)
        .single();

      if (error) throw error;

      const hours = Math.floor(data.total_hours || 0);
      const minutes = Math.round(((data.total_hours || 0) - hours) * 60);

      setEditForm({
        hours: hours.toString(),
        minutes: minutes.toString(),
        notes: getPayrollEntryDisplayNote(data.notes),
      });
      setEditingEntry(data);
    } catch (error: any) {
      console.error('Error loading entry:', error);
      toast.error('Failed to load entry details');
    }
  }

  async function saveEdit() {
    if (!editingEntry) return;

    const totalHours = parseInt(editForm.hours) + parseInt(editForm.minutes) / 60;

    if (totalHours <= 0) {
      toast.error('Total hours must be greater than 0');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('time_entries')
        .update({
          total_hours: Math.round(totalHours * 4) / 4, // Round to nearest 0.25
          notes: buildPayrollEntryNotesForSave(editingEntry.notes, editForm.notes),
        })
        .eq('id', editingEntry.id);

      if (error) throw error;

      toast.success('Time entry updated');
      setEditingEntry(null);
      loadPeriodData(); // Reload data
    } catch (error: any) {
      console.error('Error updating time entry:', error);
      toast.error('Failed to update time entry');
    } finally {
      setLoading(false);
    }
  }

  async function deleteEntry(entryId: string) {
    // Don't allow deleting time off entries
    if (entryId.startsWith('timeoff-')) {
      toast.error('Time off entries cannot be deleted from payroll');
      return;
    }

    if (!confirm('Are you sure you want to delete this time entry?')) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('time_entries')
        .delete()
        .eq('id', entryId);

      if (error) throw error;

      toast.success('Time entry deleted');
      loadPeriodData(); // Reload data
    } catch (error: any) {
      console.error('Error deleting time entry:', error);
      toast.error('Failed to delete time entry');
    } finally {
      setLoading(false);
    }
  }

  const periodBounds = resolvePeriodBounds(
    periodType,
    selectedPeriod,
    customStartDate,
    customEndDate
  );

  return (
    <div className={embed ? 'min-h-0' : 'min-h-screen bg-muted/30'}>
      {!embed && (
        <header className="border-b bg-card sticky top-0 z-10 shadow-sm">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold">Payroll Dashboard</h1>
                  <p className="text-sm text-muted-foreground">{profile?.username}</p>
                </div>
              </div>
              <Button variant="outline" onClick={() => {
                clearUser();
                window.location.reload();
              }}>
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </header>
      )}

      <main className={embed ? 'w-full space-y-6' : 'container mx-auto px-4 py-6 space-y-6'}>
        {/* Tab Navigation */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'time-entries' | 'time-off' | 'job-hours')} className="w-full">
          <TabsList className="grid w-full max-w-2xl grid-cols-3">
            <TabsTrigger value="time-entries" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Time Entries
            </TabsTrigger>
            <TabsTrigger value="time-off" className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4" />
              Time Off Log
            </TabsTrigger>
            <TabsTrigger value="job-hours" className="flex items-center gap-2">
              <Briefcase className="w-4 h-4" />
              Job Hours
            </TabsTrigger>
          </TabsList>

          <TabsContent value="time-entries" className="space-y-6 mt-6">
        {/* Week Selector & Summary */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary" />
                Time Entries by Period
              </CardTitle>
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={periodType} onValueChange={(v) => setPeriodType(v as PeriodType)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Biweekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                
                {periodType === 'custom' ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="w-[150px]"
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-[150px]"
                    />
                  </div>
                ) : (
                  <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                    <SelectTrigger className="w-[280px]">
                      <SelectValue placeholder="Select period" />
                    </SelectTrigger>
                    <SelectContent>
                      {periodOptions.map(period => (
                        <SelectItem key={period.value} value={period.value}>
                          {period.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Users className="w-4 h-4" />
                  <span className="text-sm">{hasActiveFilters ? 'Filtered Employees' : 'Employees'}</span>
                </div>
                <p className="text-3xl font-bold">
                  {loading ? '-' : filteredUsers.length}
                </p>
              </div>
              <div className="p-4 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Clock className="w-4 h-4" />
                  <span className="text-sm">{hasActiveFilters ? 'Filtered Total Hours' : 'Total Hours'}</span>
                </div>
                <p className="text-3xl font-bold">
                  {loading ? '-' : totalWeekHours.toFixed(2)}
                </p>
              </div>
              <div className="p-4 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Calendar className="w-4 h-4" />
                  <span className="text-sm">{hasActiveFilters ? 'Filtered Entries' : 'Entries'}</span>
                </div>
                <p className="text-3xl font-bold">
                  {loading ? '-' : totalEntries}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Filter & Export */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4 items-end">
              <div className="flex-1">
                <Label htmlFor="customer-search">Search by Customer</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="customer-search"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search customer or job name..."
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="flex-1">
                <Label htmlFor="user-filter">Filter by Employee</Label>
                <Select value={selectedUser} onValueChange={setSelectedUser}>
                  <SelectTrigger id="user-filter">
                    <SelectValue placeholder="All employees" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Employees</SelectItem>
                    {(weekData?.users || []).map(user => (
                      <SelectItem key={user.userId} value={user.userId}>
                        {user.userName} - {user.totalHours.toFixed(2)}h across {user.dateEntries.length} day{user.dateEntries.length !== 1 ? 's' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowAddTimeDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Time Entry
                </Button>
                <Button
                  onClick={exportWeekToPDF}
                  disabled={loading || !weekData || filteredUsers.length === 0}
                  className="gradient-primary"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export to PDF
                </Button>
              </div>
            </div>
            {hasActiveFilters && !loading && weekData && (
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg bg-primary/10 px-4 py-3">
                <div className="text-sm text-muted-foreground">
                  {customerSearch.trim() ? (
                    <>
                      Matching <span className="font-medium text-foreground">"{customerSearch.trim()}"</span>
                    </>
                  ) : (
                    <>Filtered by employee</>
                  )}
                  {' '}in this period
                  <span className="block sm:inline sm:ml-2">
                    · {filteredUsers.length} employee{filteredUsers.length !== 1 ? 's' : ''}
                    · {totalEntries} entr{totalEntries !== 1 ? 'ies' : 'y'}
                  </span>
                </div>
                <p className="text-2xl font-bold text-primary shrink-0">
                  {totalWeekHours.toFixed(2)}h
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Time Entries List */}
        {loading ? (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading time entries...</p>
            </CardContent>
          </Card>
        ) : !weekData || filteredUsers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                {hasActiveFilters
                  ? customerSearch.trim()
                    ? `No time entries matching "${customerSearch.trim()}" for this period`
                    : 'No time entries found for the selected employee in this period'
                  : 'No time entries found for this period'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredUsers.map(user => (
              <Card key={user.userId}>
                <CardHeader
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleUserExpanded(user.userId)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {expandedUsers.has(user.userId) ? (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                      )}
                      <div>
                        <CardTitle className="text-xl font-bold">{user.userName}</CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          {user.dateEntries.length} day{user.dateEntries.length !== 1 ? 's' : ''} worked
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-bold text-primary">{user.totalHours.toFixed(2)}h</p>
                      <p className="text-xs text-muted-foreground">Total Hours</p>
                    </div>
                  </div>
                </CardHeader>
                
                {expandedUsers.has(user.userId) && (
                  <CardContent className="pt-0">
                    <div className="border-t pt-4">
                      {/* Table with date on left side */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/20">
                              <th className="text-left p-2 font-semibold w-32">Date</th>
                              <th className="text-left p-2 font-semibold">Customer</th>
                              <th className="text-left p-2 font-semibold w-20">Start</th>
                              <th className="text-left p-2 font-semibold w-20">End</th>
                              <th className="text-right p-2 font-semibold w-20">Hours</th>
                              <th className="text-center p-2 font-semibold w-20">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {user.dateEntries.map((dateEntry, dateIdx) => {
                              const hasMultipleJobs = dateEntry.entries.length > 1;
                              return (
                                <Fragment key={`date-${dateIdx}`}>
                                  {dateEntry.entries.map((entry, entryIdx) => {
                                    const isTimeOff = entry.entryId.startsWith('timeoff-');
                                    const isFirstEntryOfDay = entryIdx === 0;
                                    const rowsForThisDay = dateEntry.entries.length;
                                    const reconcileCandidate =
                                      entry.jobShiftHoursForDisplay ?? entry.totalHours;
                                    const reconcile =
                                      !isTimeOff && reconcileCandidate > 0.01
                                        ? reconcileCandidate
                                        : null;
                                    const clock = isTimeOff
                                      ? { startLabel: '-', endLabel: '-' }
                                      : formatPayrollClockDisplay(
                                          entry.startTime,
                                          entry.endTime,
                                          reconcile
                                        );
                                    const displayNote = isTimeOff
                                      ? ''
                                      : getPayrollEntryDisplayNote(entry.notes);

                                    return (
                                      <tr 
                                        key={`${dateIdx}-${entryIdx}`}
                                        className={`border-b transition-colors ${
                                          isTimeOff ? 'bg-amber-50/50' : 'hover:bg-muted/20'
                                        }`}
                                      >
                                        {/* Date column - show only for first entry of the day */}
                                        {isFirstEntryOfDay ? (
                                          <td className="p-2 align-top font-medium" rowSpan={rowsForThisDay}>
                                            <div className="text-sm">
                                              {(() => {
                                                const [year, month, day] = dateEntry.date.split('-').map(Number);
                                                const date = new Date(year, month - 1, day);
                                                return date.toLocaleDateString('en-US', {
                                                  weekday: 'short',
                                                  month: 'short',
                                                  day: 'numeric',
                                                });
                                              })()}
                                            </div>
                                          </td>
                                        ) : null}
                                        
                                        <td className={`p-2 ${isTimeOff ? 'font-semibold text-amber-700' : ''}`}>
                                          <div>
                                            <div className={`font-medium ${isTimeOff ? 'text-amber-700' : ''}`}>
                                              {entry.clientName || entry.jobName}
                                            </div>
                                            {entry.clientName && entry.jobName && (
                                              <div className="text-xs text-muted-foreground">{entry.jobName}</div>
                                            )}
                                            {displayNote && (
                                              <div className="text-xs text-muted-foreground">
                                                {displayNote}
                                              </div>
                                            )}
                                            {!isTimeOff && entry.componentName && (
                                              <Badge variant="secondary" className="mt-1 text-xs font-normal">
                                                {entry.componentName}
                                              </Badge>
                                            )}
                                          </div>
                                        </td>
                                        <td className="p-2 font-mono text-xs">{clock.startLabel}</td>
                                        <td className="p-2 font-mono text-xs">{clock.endLabel}</td>
                                        <td className={`p-2 text-right font-bold ${
                                          isTimeOff ? 'text-amber-600' : 'text-primary'
                                        }`}>
                                          {isTimeOff ? '-' : entry.totalHours.toFixed(2)}
                                        </td>
                                        <td className="p-2">
                                          {!isTimeOff && (
                                            <div className="flex items-center justify-center gap-1">
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => openEditDialog(entry.entryId)}
                                                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                              >
                                                <Edit className="w-3.5 h-3.5" />
                                              </Button>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => deleteEntry(entry.entryId)}
                                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </Button>
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  {/* Daily Total Row - only show if multiple jobs worked that day */}
                                  {hasMultipleJobs && (
                                    <tr className="bg-primary/5 border-b-2">
                                      <td className="p-2"></td>
                                      <td className="p-2"></td>
                                      <td className="p-2 text-right font-semibold text-sm" colSpan={2}>
                                        Daily Total:
                                      </td>
                                      <td className="p-2 text-right font-bold text-primary">
                                        {dateEntry.totalHours.toFixed(2)}
                                      </td>
                                      <td className="p-2"></td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Overall Total */}
                      <div className="flex items-center justify-between bg-primary/10 px-4 py-3 rounded-md mt-4">
                        <span className="font-bold text-lg">Period Total</span>
                        <span className="font-bold text-2xl text-primary">{user.totalHours.toFixed(2)}h</span>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
          </TabsContent>

          <TabsContent value="time-off" className="mt-6">
            <UnavailableCalendar
              userId={profile?.id || ''}
              variant="log"
              periodStart={periodBounds?.start}
              periodEnd={periodBounds?.end}
            />
          </TabsContent>

          <TabsContent value="job-hours" className="space-y-6 mt-6">
            {/* Job Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-primary" />
                  Job Hours Report
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-4">
                  <div className="flex-1">
                    <Label htmlFor="job-select">Select Job</Label>
                    <div className="space-y-2">
                      <Input
                        id="job-select-search"
                        value={jobSearch}
                        onChange={(e) => setJobSearch(e.target.value)}
                        placeholder="Search by customer or job..."
                      />
                      <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                        <SelectTrigger id="job-select">
                          <SelectValue placeholder="Choose a job..." />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredJobs.map(job => (
                            <SelectItem key={job.id} value={job.id}>
                              <div className="flex flex-col items-start">
                                <span>{job.client_name || job.name}</span>
                                {job.client_name && (
                                  <span className="text-xs text-muted-foreground">{job.name}</span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button
                    onClick={printJobHours}
                    disabled={!selectedJobId || exportingJobHours || jobHoursData.length === 0}
                    className="gradient-primary"
                  >
                    {exportingJobHours ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                        Preparing...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-2" />
                        Print Job Hours
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Job Hours Display */}
            {selectedJobId && (
              <>
                {loadingJobHours ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                      <p className="text-muted-foreground">Loading job hours...</p>
                    </CardContent>
                  </Card>
                ) : jobHoursData.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        No time entries found for this job
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {/* Summary Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Card>
                        <CardContent className="pt-6">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm text-muted-foreground">Total Employees</p>
                              <p className="text-3xl font-bold">{jobHoursData.length}</p>
                            </div>
                            <Users className="w-10 h-10 text-green-600" />
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm text-muted-foreground">Total Hours</p>
                              <p className="text-3xl font-bold">
                                {jobHoursData.reduce((sum, user) => sum + user.totalHours, 0).toFixed(2)}
                              </p>
                            </div>
                            <Clock className="w-10 h-10 text-blue-600" />
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm text-muted-foreground">Total Entries</p>
                              <p className="text-3xl font-bold">
                                {jobHoursData.reduce((sum, user) => sum + user.entries.length, 0)}
                              </p>
                            </div>
                            <Calendar className="w-10 h-10 text-purple-600" />
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Employee Hours List */}
                    <div className="space-y-4">
                      {jobHoursData.map(user => (
                        <Card key={user.userId}>
                          <CardHeader>
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-xl font-bold">{user.userName}</CardTitle>
                              <div className="text-right">
                                <p className="text-3xl font-bold text-primary">{user.totalHours.toFixed(2)}h</p>
                                <p className="text-xs text-muted-foreground">
                                  {user.entries.length} {user.entries.length === 1 ? 'entry' : 'entries'}
                                </p>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b bg-muted/20">
                                    <th className="text-left p-2 font-semibold">Date</th>
                                    <th className="text-left p-2 font-semibold">Component</th>
                                    <th className="text-left p-2 font-semibold w-20">Start</th>
                                    <th className="text-left p-2 font-semibold w-20">End</th>
                                    <th className="text-right p-2 font-semibold w-20">Hours</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {user.entries.map((entry: any, idx: number) => (
                                    <tr key={idx} className="border-b hover:bg-muted/20">
                                      <td className="p-2">{entry.date}</td>
                                      <td className="p-2">
                                        {entry.component}
                                        {entry.isManual && (
                                          <Badge variant="outline" className="ml-2 text-xs">Manual</Badge>
                                        )}
                                      </td>
                                      <td className="p-2 font-mono text-xs">{entry.startTime}</td>
                                      <td className="p-2 font-mono text-xs">{entry.endTime}</td>
                                      <td className="p-2 text-right font-bold text-primary">{entry.hours}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={showAddTimeDialog} onOpenChange={setShowAddTimeDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Time Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Employee *</Label>
              <Select
                value={addTimeForm.userId}
                onValueChange={(value) => setAddTimeForm(prev => ({ ...prev, userId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {payrollUsers.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.username || user.email || 'Unknown User'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Job *</Label>
              <Input
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                placeholder="Search by customer or job..."
              />
              <Select
                value={addTimeForm.jobId}
                onValueChange={(value) => setAddTimeForm(prev => ({ ...prev, jobId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select job" />
                </SelectTrigger>
                <SelectContent>
                  {filteredJobs.map(job => (
                    <SelectItem key={job.id} value={job.id}>
                      <div className="flex flex-col items-start">
                        <span>{job.client_name || job.name}</span>
                        {job.client_name && (
                          <span className="text-xs text-muted-foreground">{job.name}</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={addTimeForm.date}
                  onChange={(e) => setAddTimeForm(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Start *</Label>
                <Input
                  type="time"
                  value={addTimeForm.startTime}
                  onChange={(e) => setAddTimeForm(prev => ({ ...prev, startTime: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>End *</Label>
                <Input
                  type="time"
                  value={addTimeForm.endTime}
                  onChange={(e) => setAddTimeForm(prev => ({ ...prev, endTime: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Textarea
                value={addTimeForm.notes}
                onChange={(e) => setAddTimeForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Reason or payroll note"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddTimeDialog(false)} disabled={savingAddTime}>
              Cancel
            </Button>
            <Button onClick={addTimeEntryForUser} disabled={savingAddTime}>
              {savingAddTime ? 'Saving...' : 'Add Time'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingEntry} onOpenChange={() => setEditingEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Time Entry</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {editingEntry && (
              <>
                <div>
                  <Label className="text-muted-foreground">Date</Label>
                  <p className="font-medium">
                    {new Date(editingEntry.start_time).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>

                {editingEntry.components?.name && (
                  <div>
                    <Label className="text-muted-foreground">Component</Label>
                    <div className="mt-1">
                      <Badge variant="secondary">{editingEntry.components.name}</Badge>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Time Worked</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="edit-hours" className="text-xs">
                        Hours
                      </Label>
                      <Select
                        value={editForm.hours}
                        onValueChange={(value) =>
                          setEditForm({ ...editForm, hours: value })
                        }
                      >
                        <SelectTrigger id="edit-hours">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[200px]">
                          {[...Array(25)].map((_, i) => (
                            <SelectItem key={i} value={i.toString()}>
                              {i}h
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-minutes" className="text-xs">
                        Minutes
                      </Label>
                      <Select
                        value={editForm.minutes}
                        onValueChange={(value) =>
                          setEditForm({ ...editForm, minutes: value })
                        }
                      >
                        <SelectTrigger id="edit-minutes">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[200px]">
                          {[0, 15, 30, 45].map((min) => (
                            <SelectItem key={min} value={min.toString()}>
                              {min}m
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="bg-primary/10 rounded p-2 text-center">
                    <p className="text-sm font-bold text-primary">
                      Total: {(parseInt(editForm.hours) + parseInt(editForm.minutes) / 60).toFixed(2)} hours
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-notes">Notes (Optional)</Label>
                  <Textarea
                    id="edit-notes"
                    value={editForm.notes}
                    onChange={(e) =>
                      setEditForm({ ...editForm, notes: e.target.value })
                    }
                    placeholder="Add notes..."
                    rows={3}
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEntry(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
