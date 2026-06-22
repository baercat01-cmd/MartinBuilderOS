
import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  LogIn,
  LogOut,
  Clock,
  Users,
  ArrowLeft,
  X,
  Briefcase,
  MapPin,
  FileText,
  Package,
  CalendarIcon,
  ChevronsUpDown,
  Check,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Job, Component } from '@/types';
import { ensureDefaultTimeEntryJobs, prioritizeDefaultJobs } from '@/lib/defaultJobs';

function getJobSearchLabel(job: Job): string {
  return `${job.client_name || ''} ${job.name}`.trim();
}

function getJobDisplayPrimary(job: Job): string {
  const client = job.client_name?.trim();
  if (client && client.toLowerCase() !== 'internal') return client;
  return job.name;
}

function getJobDisplaySecondary(job: Job): string | null {
  const client = job.client_name?.trim();
  if (client && client.toLowerCase() !== 'internal') return job.name;
  return null;
}

/** Round duration to nearest 15 minutes for payroll. Returns hours in quarter-hour increments (.25, .5, .75, .00). */
function roundToQuarterHours(exactMinutes: number): number {
  const roundedMinutes = Math.round(exactMinutes / 15) * 15;
  return roundedMinutes / 60;
}

interface TimeDropdownPickerProps {
  value: string; // "HH:MM" format
  onChange: (value: string) => void;
  label: string;
}

function TimeDropdownPicker({ value, onChange, label }: TimeDropdownPickerProps) {
  const [hour24, minute] = value.split(':');
  
  // Convert 24-hour to 12-hour format
  const hour24Int = parseInt(hour24);
  const isPM = hour24Int >= 12;
  const hour12 = hour24Int === 0 ? 12 : hour24Int > 12 ? hour24Int - 12 : hour24Int;
  const period = isPM ? 'PM' : 'AM';

  const hours = Array.from({ length: 12 }, (_, i) => (i + 1).toString());
  const minutes = ['00', '15', '30', '45'];

  const handleHourChange = (h: string) => {
    const hour12Int = parseInt(h);
    let hour24Int = hour12Int;
    
    if (period === 'PM' && hour12Int !== 12) {
      hour24Int = hour12Int + 12;
    } else if (period === 'AM' && hour12Int === 12) {
      hour24Int = 0;
    }
    
    onChange(`${hour24Int.toString().padStart(2, '0')}:${minute}`);
  };

  const handleMinuteChange = (m: string) => {
    onChange(`${hour24.padStart(2, '0')}:${m}`);
  };

  const handlePeriodChange = (p: string) => {
    let newHour24 = hour24Int;
    
    if (p === 'PM' && hour24Int < 12) {
      newHour24 = hour24Int + 12;
    } else if (p === 'AM' && hour24Int >= 12) {
      newHour24 = hour24Int - 12;
    }
    
    onChange(`${newHour24.toString().padStart(2, '0')}:${minute}`);
  };

  return (
    <div className="space-y-2">
      <Label className="text-base font-bold text-yellow-600 flex items-center gap-2">
        <Clock className="w-4 h-4" />
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Select value={hour12.toString()} onValueChange={handleHourChange}>
            <SelectTrigger className="h-12 text-xl font-mono font-bold border-2 border-black bg-white shadow-sm hover:border-yellow-600 hover:shadow-md transition-all">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hours.map((h) => (
                <SelectItem key={h} value={h} className="text-lg font-mono py-2">
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="text-2xl font-bold text-yellow-600">:</div>

        <div className="flex-1">
          <Select value={minute} onValueChange={handleMinuteChange}>
            <SelectTrigger className="h-12 text-xl font-mono font-bold border-2 border-black bg-white shadow-sm hover:border-yellow-600 hover:shadow-md transition-all">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {minutes.map((m) => (
                <SelectItem key={m} value={m} className="text-lg font-mono py-2">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-24">
          <Select value={period} onValueChange={handlePeriodChange}>
            <SelectTrigger className="h-12 text-xl font-mono font-bold border-2 border-black bg-white shadow-sm hover:border-yellow-600 hover:shadow-md transition-all">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AM" className="text-lg font-mono py-2">AM</SelectItem>
              <SelectItem value="PM" className="text-lg font-mono py-2">PM</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

interface ClockInEntry {
  id: string;
  job_id: string;
  job_name: string;
  start_time: string;
  elapsed_seconds: number;
}

interface QuickTimeEntryProps {
  userId: string;
  onSuccess?: () => void;
  onBack?: () => void;
  allowedJobs?: Job[]; // Optional: restrict to specific jobs only
  /** When 'shop', hide Existing Job/Misc Job tabs and lock to internal Shop job (1-click like crew). */
  userRole?: string;
  /** Pre-resolved Shop job when userRole is 'shop'. If not provided, component will fetch it. */
  shopJobId?: string | null;
}

export function QuickTimeEntry({ userId, onSuccess, onBack, allowedJobs, userRole, shopJobId: shopJobIdProp }: QuickTimeEntryProps) {
  const [loading, setLoading] = useState(false);
  const [clockedInEntry, setClockedInEntry] = useState<ClockInEntry | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showDialog, setShowDialog] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [jobSearchQuery, setJobSearchQuery] = useState('');
  const dialogContentRef = useRef<HTMLDivElement | null>(null);
  const [manualData, setManualData] = useState({
    date: new Date().toISOString().split('T')[0],
    startTime: '06:00',
    endTime: '17:00',
    isOvernightShift: false,
    notes: '',
  });
  const [jobType, setJobType] = useState<'existing' | 'misc'>('existing');
  const [miscJobData, setMiscJobData] = useState({
    name: '',
    address: '',
    date: new Date().toISOString().split('T')[0],
    startTime: '06:00',
    endTime: '17:00',
    notes: '',
    isOvernightShift: false,
  });
  const [miscJobsId, setMiscJobsId] = useState<string | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [jobComponents, setJobComponents] = useState<Array<{
    componentId: string;
    hours: string;
    minutes: string;
  }>>([]);
  const [shopJob, setShopJob] = useState<Job | null>(null);

  const isShopUser = userRole === 'shop';

  // Check if selected job is snowplowing (for overnight shift feature)
  const isSnowplowingJob = selectedJobId && jobs.find(j => j.id === selectedJobId)?.name?.toLowerCase().includes('snowplow');
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const filteredJobsForPicker = useMemo(() => {
    const query = jobSearchQuery.trim().toLowerCase();
    if (!query) return jobs;
    return jobs.filter((job) => getJobSearchLabel(job).toLowerCase().includes(query));
  }, [jobs, jobSearchQuery]);

  useEffect(() => {
    loadJobs();
    loadClockedInStatus();
    loadOrCreateMiscJobsCategory();
  }, [userId]);

  useEffect(() => {
    if (!isShopUser) return;
    if (shopJobIdProp) {
      setSelectedJobId(shopJobIdProp);
      const fromAllowed = allowedJobs?.find(j => j.id === shopJobIdProp);
      if (fromAllowed) {
        setShopJob(fromAllowed);
        setJobs([fromAllowed]);
      } else {
        supabase.from('jobs').select('*').eq('id', shopJobIdProp).single().then(({ data }) => {
          if (data) {
            setShopJob(data);
            setJobs([data]);
          }
        });
      }
    } else {
      supabase
        .from('jobs')
        .select('*')
        .eq('is_internal', true)
        .ilike('name', '%shop%')
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setShopJob(data);
            setJobs([data]);
            setSelectedJobId(data.id);
          }
        });
    }
  }, [isShopUser, shopJobIdProp, allowedJobs]);

  useEffect(() => {
    if (selectedJobId) {
      loadComponents(selectedJobId);
    }
  }, [selectedJobId]);

  // Calculate default component time from job time
  const calculateDefaultComponentTime = () => {
    if (!manualData.startTime || !manualData.endTime) return { hours: '0', minutes: '0' };
    
    const start = new Date(`${manualData.date}T${manualData.startTime}`);
    const end = new Date(`${manualData.date}T${manualData.endTime}`);
    
    if (end <= start) return { hours: '0', minutes: '0' };
    
    const totalMinutes = Math.floor((end.getTime() - start.getTime()) / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.floor((totalMinutes % 60) / 15) * 15; // Round to nearest 15
    
    return { hours: hours.toString(), minutes: minutes.toString() };
  };

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    
    if (clockedInEntry) {
      interval = setInterval(() => {
        const start = new Date(clockedInEntry.start_time).getTime();
        const now = Date.now();
        const elapsed = Math.floor((now - start) / 1000);
        setElapsedSeconds(elapsed);
      }, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [clockedInEntry]);

  async function loadJobs() {
    try {
      if (isShopUser) return;

      const defaultJobs = await ensureDefaultTimeEntryJobs(userId);

      // If allowedJobs is provided, use those instead of loading from database
      if (allowedJobs) {
        setJobs(prioritizeDefaultJobs(allowedJobs, defaultJobs));
        return;
      }

      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('status', 'active')
        .order('name');

      if (error) throw error;
      
      // Sort: regular jobs first, then internal jobs at bottom
      const sortedJobs = (data || []).sort((a, b) => {
        // If both are internal or both are not, sort by name
        if (a.is_internal === b.is_internal) {
          return a.name.localeCompare(b.name);
        }
        // Regular jobs (is_internal = false) come first
        return a.is_internal ? 1 : -1;
      });
      
      setJobs(prioritizeDefaultJobs(sortedJobs, defaultJobs));
    } catch (error) {
      console.error('Error loading jobs:', error);
    }
  }

  async function loadComponents(jobId: string) {
    try {
      // Get job to find its components
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('components')
        .eq('id', jobId)
        .single();

      if (jobError) throw jobError;

      const jobComponents = Array.isArray(job.components) ? job.components : [];
      
      if (jobComponents.length > 0) {
        const activeJobComponents = jobComponents.filter((c: any) => c.isActive);
        
        const { data, error } = await supabase
          .from('components')
          .select('*')
          .in('id', activeJobComponents.map((c: any) => c.id))
          .eq('archived', false);

        if (error) throw error;
        setComponents(data || []);
      } else {
        // Fallback: load all active components
        const { data, error } = await supabase
          .from('components')
          .select('*')
          .eq('archived', false)
          .order('name');

        if (error) throw error;
        setComponents(data || []);
      }
    } catch (error) {
      console.error('Error loading components:', error);
      setComponents([]);
    }
  }

  async function loadOrCreateMiscJobsCategory() {
    try {
      // Check if Misc Jobs internal job exists (created manually by crew member)
      const { data: existing, error: fetchError } = await supabase
        .from('jobs')
        .select('id')
        .eq('name', 'Misc Jobs')
        .eq('is_internal', true)
        .maybeSingle();

      if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

      if (existing) {
        setMiscJobsId(existing.id);
      }
      // No auto-creation - user must manually create via Internal Jobs Management
    } catch (error) {
      console.error('Error loading Misc Jobs category:', error);
    }
  }

  async function loadClockedInStatus() {
    try {
      // Check if user has an active clock-in (job-level time entry with is_active = true and no component)
      const { data, error } = await supabase
        .from('time_entries')
        .select(`
          id,
          job_id,
          start_time,
          jobs(name)
        `)
        .eq('user_id', userId)
        .eq('is_active', true)
        .is('component_id', null)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        const start = new Date(data.start_time).getTime();
        const now = Date.now();
        const elapsed = Math.floor((now - start) / 1000);

        setClockedInEntry({
          id: data.id,
          job_id: data.job_id,
          job_name: (data.jobs as any)?.name || 'Unknown Job',
          start_time: data.start_time,
          elapsed_seconds: elapsed,
        });
        setElapsedSeconds(elapsed);
      } else {
        setClockedInEntry(null);
      }
    } catch (error) {
      console.error('Error loading clocked in status:', error);
    }
  }

  async function handleTimerClockIn() {
    if (!selectedJobId) {
      toast.error('Please select a job');
      return;
    }

    setLoading(true);

    try {
      const now = new Date().toISOString();
      
      // Create a time entry with no component (job-level clock in)
      const { data, error } = await supabase
        .from('time_entries')
        .insert({
          job_id: selectedJobId,
          component_id: null, // NULL = job-level time
          user_id: userId,
          start_time: now,
          end_time: null,
          total_hours: null,
          crew_count: 1, // Just the person clocking in
          is_manual: false,
          is_active: true,
          notes: 'Clock in - Timer',
          worker_names: [],
        })
        .select()
        .single();

      if (error) throw error;

      const job = jobs.find(j => j.id === selectedJobId);
      
      setClockedInEntry({
        id: data.id,
        job_id: selectedJobId,
        job_name: job?.name || 'Unknown Job',
        start_time: now,
        elapsed_seconds: 0,
      });
      setElapsedSeconds(0);

      toast.success(`Clocked in to ${job?.name}`);
      setShowDialog(false);
      setSelectedJobId('');
      onSuccess?.();
      onBack?.();
    } catch (error: any) {
      console.error('Clock in error:', error);
      toast.error('Failed to clock in');
    } finally {
      setLoading(false);
    }
  }

  // Helper function to create UTC timestamp from local date and time
  function createUTCTimestamp(dateStr: string, timeStr: string): string {
    // Parse date components
    const [year, month, day] = dateStr.split('-').map(Number);
    // Parse time components
    const [hours, minutes] = timeStr.split(':').map(Number);
    
    // Create date in LOCAL timezone
    const localDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
    
    // Convert to ISO string (UTC)
    return localDate.toISOString();
  }

  async function handleManualEntry() {
    if (!selectedJobId) {
      toast.error('Please select a job');
      return;
    }

    if (!manualData.startTime || !manualData.endTime) {
      toast.error('Please enter both start and end times');
      return;
    }

    // Calculate total hours - handle overnight shifts
    const [startHours, startMinutes] = manualData.startTime.split(':').map(Number);
    const [endHours, endMinutes] = manualData.endTime.split(':').map(Number);
    const startTotalMinutes = startHours * 60 + startMinutes;
    let endTotalMinutes = endHours * 60 + endMinutes;
    
    // For overnight shifts, add 24 hours (1440 minutes) to end time
    if (manualData.isOvernightShift) {
      endTotalMinutes += 1440; // Add 24 hours in minutes
    }
    
    // Validation: end must be after start (considering overnight)
    if (endTotalMinutes <= startTotalMinutes) {
      if (manualData.isOvernightShift) {
        toast.error('Invalid overnight shift times');
      } else {
        toast.error('Clock out time must be after clock in time. Use "Overnight Shift" for shifts spanning two days.');
      }
      return;
    }
    
    const exactMinutes = endTotalMinutes - startTotalMinutes;
    const totalHours = roundToQuarterHours(exactMinutes);

    // Validate component times if any components are selected
    if (jobComponents.length > 0) {
      for (const comp of jobComponents) {
        const compHours = parseInt(comp.hours) + parseInt(comp.minutes) / 60;
        if (compHours <= 0) {
          toast.error('All component times must be greater than 0');
          return;
        }
        if (compHours > totalHours) {
          toast.error('Component time cannot exceed total job time');
          return;
        }
      }
    }

    setLoading(true);

    try {
      const startDateTime = createUTCTimestamp(manualData.date, manualData.startTime);
      const startMs = new Date(startDateTime).getTime();
      const endMs = startMs + totalHours * 60 * 60 * 1000;
      const endDateTime = new Date(endMs).toISOString();

      // Save job-level time entry (quarter-hour rounded for payroll)
      const { error } = await supabase
        .from('time_entries')
        .insert({
          job_id: selectedJobId,
          component_id: null,
          user_id: userId,
          start_time: startDateTime,
          end_time: endDateTime,
          total_hours: totalHours,
          crew_count: 1,
          is_manual: true,
          is_active: false,
          notes: manualData.notes.trim() || null,
          worker_names: [],
        });

      if (error) throw error;

      // Save component time entries if any components are selected (quarter-hour rounded)
      if (jobComponents.length > 0) {
        const componentEntries = jobComponents.map(comp => {
          const compExactMinutes = parseInt(comp.hours) * 60 + parseInt(comp.minutes);
          const compHours = roundToQuarterHours(compExactMinutes);
          const compEndMs = startMs + compHours * 60 * 60 * 1000;
          return {
            job_id: selectedJobId,
            component_id: comp.componentId,
            user_id: userId,
            start_time: startDateTime,
            end_time: new Date(compEndMs).toISOString(),
            total_hours: compHours,
            crew_count: 1,
            is_manual: true,
            is_active: false,
            notes: 'Component time from job entry',
            worker_names: [],
          };
        });

        const { error: compError } = await supabase
          .from('time_entries')
          .insert(componentEntries);

        if (compError) throw compError;
      }

      const job = jobs.find(j => j.id === selectedJobId);
      const componentMsg = jobComponents.length > 0
        ? ` (${jobComponents.length} component${jobComponents.length > 1 ? 's' : ''})`
        : '';
      toast.success(`${totalHours.toFixed(2)} hours logged to ${job?.name}${componentMsg}`);
      
      // Reset and close
      setShowDialog(false);
      setSelectedJobId('');
      setManualData({
        date: new Date().toISOString().split('T')[0],
        startTime: '06:00',
        endTime: '17:00',
        isOvernightShift: false,
        notes: '',
      });
      setJobComponents([]);
      onSuccess?.();
      onBack?.();
    } catch (error: any) {
      console.error('Manual entry error:', error);
      toast.error('Failed to log time');
    } finally {
      setLoading(false);
    }
  }



  async function handleMiscJobEntry() {
    if (!miscJobData.name.trim()) {
      toast.error('Please enter a job name');
      return;
    }

    if (!miscJobData.address.trim()) {
      toast.error('Please enter a job address');
      return;
    }

    if (!miscJobData.startTime || !miscJobData.endTime) {
      toast.error('Please enter both start and end times');
      return;
    }

    if (!miscJobsId) {
      toast.error('Misc Jobs category not available');
      return;
    }

    // Calculate total hours - handle overnight shifts
    const [startHours, startMinutes] = miscJobData.startTime.split(':').map(Number);
    const [endHours, endMinutes] = miscJobData.endTime.split(':').map(Number);
    const startTotalMinutes = startHours * 60 + startMinutes;
    let endTotalMinutes = endHours * 60 + endMinutes;
    
    // For overnight shifts, add 24 hours (1440 minutes) to end time
    if (miscJobData.isOvernightShift) {
      endTotalMinutes += 1440; // Add 24 hours in minutes
    }
    
    // Validation: end must be after start (considering overnight)
    if (endTotalMinutes <= startTotalMinutes) {
      if (miscJobData.isOvernightShift) {
        toast.error('Invalid overnight shift times');
      } else {
        toast.error('Clock out time must be after clock in time. Use "Overnight Shift" for shifts spanning two days.');
      }
      return;
    }
    
    const exactMinutes = endTotalMinutes - startTotalMinutes;
    const totalHours = roundToQuarterHours(exactMinutes);

    setLoading(true);

    try {
      const startDateTime = createUTCTimestamp(miscJobData.date, miscJobData.startTime);
      const startMs = new Date(startDateTime).getTime();
      const endMs = startMs + totalHours * 60 * 60 * 1000;
      const endDateTime = new Date(endMs).toISOString();

      // Create structured notes with job details
      const notesData = {
        type: 'misc_job',
        jobName: miscJobData.name,
        address: miscJobData.address,
        notes: miscJobData.notes || '',
      };

      const { error } = await supabase
        .from('time_entries')
        .insert({
          job_id: miscJobsId,
          component_id: null,
          user_id: userId,
          start_time: startDateTime,
          end_time: endDateTime,
          total_hours: totalHours,
          crew_count: 1,
          is_manual: true,
          is_active: false,
          notes: JSON.stringify(notesData),
          worker_names: [],
        });

      if (error) throw error;

      toast.success(`${totalHours.toFixed(2)} hours logged to misc job: ${miscJobData.name}`);
      
      // Reset and close
      setShowDialog(false);
      setMiscJobData({
        name: '',
        address: '',
        date: new Date().toISOString().split('T')[0],
        startTime: '06:00',
        endTime: '17:00',
        notes: '',
        isOvernightShift: false,
      });
      onSuccess?.();
      onBack?.();
    } catch (error: any) {
      console.error('Misc job entry error:', error);
      toast.error('Failed to log time');
    } finally {
      setLoading(false);
    }
  }

  async function handleClockOut() {
    if (!clockedInEntry) return;

    setLoading(true);

    try {
      const startMs = new Date(clockedInEntry.start_time).getTime();
      const endMs = Date.now();
      const exactMinutes = (endMs - startMs) / (1000 * 60);
      const roundedHours = roundToQuarterHours(exactMinutes);
      const roundedMs = Math.round(roundedHours * 60 * 60 * 1000);
      const endTimeRounded = new Date(startMs + roundedMs);

      const { error } = await supabase
        .from('time_entries')
        .update({
          end_time: endTimeRounded.toISOString(),
          total_hours: roundedHours,
          is_active: false,
          notes: 'Clock out',
        })
        .eq('id', clockedInEntry.id);

      if (error) throw error;

      toast.success(`Clocked out: ${roundedHours.toFixed(2)} hours`);
      setClockedInEntry(null);
      setElapsedSeconds(0);
      onSuccess?.();
      onBack?.();
    } catch (error: any) {
      console.error('Clock out error:', error);
      toast.error('Failed to clock out');
    } finally {
      setLoading(false);
    }
  }

  function formatTimerDisplay(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // If clocked in, show clocked in status
  if (clockedInEntry) {
    return (
      <Card className="border-2 border-yellow-600 shadow-lg rounded-none bg-gray-100">
        <CardHeader className="pb-2 bg-black border-b-2 border-yellow-600">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base font-bold text-white">
              <div className="w-3 h-3 bg-yellow-600 rounded-full animate-pulse" />
              CLOCKED IN
            </CardTitle>
            <Badge variant="default" className="bg-yellow-600 text-black rounded-none font-bold">
              ACTIVE
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-3">
          <div className="text-center py-4 bg-white rounded-none border-2 border-black">
            <p className="text-xs text-black font-bold mb-1 uppercase tracking-wide">Time on Job</p>
            <p className="text-4xl font-mono font-bold text-yellow-600 tabular-nums tracking-tight">
              {formatTimerDisplay(elapsedSeconds)}
            </p>
          </div>

          <div className="space-y-1 p-3 bg-white rounded-none border-2 border-black">
            <div className="flex items-center justify-between text-sm">
              <span className="text-black font-bold">Job:</span>
              <span className="font-bold text-green-800">{clockedInEntry.job_name}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-black font-bold">Started:</span>
              <span className="font-bold text-green-800">
                {new Date(clockedInEntry.start_time).toLocaleTimeString([], { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </span>
            </div>
          </div>

          <Button
            onClick={handleClockOut}
            disabled={loading}
            size="lg"
            className="w-full h-12 text-base rounded-none font-bold bg-black text-yellow-600 hover:bg-gray-900 border-2 border-yellow-600"
          >
            <LogOut className="w-6 h-6 mr-3" />
            {loading ? 'Clocking Out...' : 'Clock Out'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Main button to open dialog
  return (
    <>
      <div className="px-2 sm:px-4">
        <Button
          onClick={() => setShowDialog(true)}
          className="w-full h-12 sm:h-14 bg-gradient-to-r from-green-700 to-green-800 text-white hover:from-green-800 hover:to-green-900 text-base sm:text-lg font-bold shadow-lg hover:shadow-xl transition-all border-2 border-black rounded-none"
        >
          <Clock className="w-5 h-5 mr-2" />
          Time Clock
        </Button>
      </div>

      {/* Time Clock Dialog */}
      <Dialog 
        open={showDialog} 
        onOpenChange={(open) => {
          setShowDialog(open);
          if (!open) {
            // Reset when closing
            setJobPickerOpen(false);
            setJobSearchQuery('');
            setSelectedJobId('');
            setManualData({
              date: new Date().toISOString().split('T')[0],
              startTime: '06:00',
              endTime: '17:00',
              isOvernightShift: false,
              notes: '',
            });
            setMiscJobData({
              name: '',
              address: '',
              date: new Date().toISOString().split('T')[0],
              startTime: '06:00',
              endTime: '17:00',
              notes: '',
              isOvernightShift: false,
            });
            setJobComponents([]);
            onBack?.(); // Go back to jobs page
          }
        }}
      >
        <DialogContent
          ref={dialogContentRef}
          floating
          className={cn(
            '!fixed !inset-0 !left-0 !top-0 z-50 !flex !h-[100dvh] !w-full !max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-lg',
            'md:!inset-auto md:!left-1/2 md:!top-1/2 md:!h-[min(90dvh,820px)] md:!max-h-[min(90dvh,820px)] md:!w-full md:!max-w-md md:!-translate-x-1/2 md:!-translate-y-1/2 md:rounded-lg md:border',
          )}
          onInteractOutside={(e) => {
            if (window.matchMedia('(max-width: 767px)').matches) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (window.matchMedia('(max-width: 767px)').matches) e.preventDefault();
          }}
        >
          <DialogHeader className="shrink-0 space-y-0 border-b px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] pr-12 text-left">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Clock className="h-5 w-5 text-yellow-600" />
              Time Clock
            </DialogTitle>
          </DialogHeader>

          {!isShopUser && (
            <div className="shrink-0 border-b bg-slate-50 px-4 py-3">
              <div className="grid grid-cols-2 gap-2 rounded-lg border-2 border-black bg-gradient-to-br from-slate-50 to-slate-100 p-1.5">
                <Button
                  variant={jobType === 'existing' ? 'default' : 'ghost'}
                  onClick={() => setJobType('existing')}
                  className={cn(
                    'h-11 rounded-none border-2 text-sm font-bold transition-all',
                    jobType === 'existing'
                      ? 'border-yellow-600 bg-black text-yellow-600 shadow-md'
                      : 'border-black hover:bg-white hover:shadow-sm',
                  )}
                >
                  <Briefcase className="mr-2 h-4 w-4" />
                  Existing Job
                </Button>
                <Button
                  variant={jobType === 'misc' ? 'default' : 'ghost'}
                  onClick={() => setJobType('misc')}
                  className={cn(
                    'h-11 rounded-none border-2 text-sm font-bold transition-all',
                    jobType === 'misc'
                      ? 'border-yellow-600 bg-black text-yellow-600 shadow-md'
                      : 'border-black hover:bg-white hover:shadow-sm',
                  )}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Misc Job
                </Button>
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 [-webkit-overflow-scrolling:touch]">
          <div className="space-y-3 pb-2">
            {/* Shop user: 1-click Clock In to Shop (no job/misc tabs) */}
            {isShopUser && (
              <div className="p-3 border-2 border-black rounded-lg bg-gradient-to-br from-green-50 to-green-100 shadow-md">
                <p className="font-semibold text-green-900 mb-2">Clocking in to Shop</p>
                {selectedJobId ? (
                  <Button
                    onClick={() => handleTimerClockIn()}
                    disabled={loading}
                    className="w-full h-12 bg-black text-yellow-600 hover:bg-gray-900 text-base font-bold border-2 border-yellow-600 rounded-none"
                  >
                    <LogIn className="w-5 h-5 mr-2" />
                    {loading ? 'Clocking In...' : 'Clock In to Shop'}
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">Loading Shop job...</p>
                )}
              </div>
            )}

            {/* Existing Job Flow - hidden for shop users */}
            {!isShopUser && jobType === 'existing' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="dialog-date" className="text-base font-bold text-yellow-600 flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4" />
                    Date *
                  </Label>
                  <Input
                    id="dialog-date"
                    type="date"
                    className="h-10 text-sm font-semibold border-2 border-black shadow-sm hover:border-yellow-600 transition-colors"
                    value={manualData.date}
                    onChange={(e) => setManualData({ ...manualData, date: e.target.value })}
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>

                {/* Job Selection - Highlighted */}
                <div className="space-y-2 p-3 border-2 border-black rounded-lg bg-gradient-to-br from-yellow-50 to-yellow-100 shadow-md">
                  <Label htmlFor="dialog-job" className="text-base font-bold text-yellow-600 flex items-center gap-2">
                    <Briefcase className="w-5 h-5" />
                    Select Job *
                  </Label>
                  <Popover
                    open={jobPickerOpen}
                    onOpenChange={(open) => {
                      setJobPickerOpen(open);
                      if (!open) setJobSearchQuery('');
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        id="dialog-job"
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={jobPickerOpen}
                        className={cn(
                          'h-12 w-full justify-between text-base font-bold border-2 border-black bg-white shadow-md hover:border-yellow-600 hover:shadow-lg transition-all px-3',
                          !selectedJob && 'text-muted-foreground'
                        )}
                      >
                        {selectedJob ? (
                          <div className="flex flex-col items-start text-left min-w-0">
                            <span className="truncate w-full">{getJobDisplayPrimary(selectedJob)}</span>
                            {getJobDisplaySecondary(selectedJob) && (
                              <span className="text-sm font-normal text-muted-foreground truncate w-full">
                                {getJobDisplaySecondary(selectedJob)}
                              </span>
                            )}
                          </div>
                        ) : (
                          'Choose a job...'
                        )}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      container={
                        // On mobile the dialog is full-screen, so portaling the popover INTO the
                        // dialog keeps it inside the dialog's scroll-lock subtree — without this the
                        // list can't be touch-scrolled. On desktop we keep the default body portal to
                        // avoid clipping by the dialog's transformed, overflow-hidden container.
                        jobPickerOpen && typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
                          ? dialogContentRef.current
                          : undefined
                      }
                      className="w-[var(--radix-popover-trigger-width)] p-0 flex flex-col h-[var(--radix-popper-available-height,85dvh)] max-h-[var(--radix-popper-available-height,85dvh)]"
                      align="start"
                      collisionPadding={12}
                      onWheel={(event) => event.stopPropagation()}
                    >
                      <div className="flex shrink-0 items-center border-b px-3">
                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        <Input
                          value={jobSearchQuery}
                          onChange={(event) => setJobSearchQuery(event.target.value)}
                          placeholder="Search job or customer (optional)..."
                          className="h-11 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                        />
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch]">
                        <div className="p-1">
                          {filteredJobsForPicker.length === 0 ? (
                            <p className="py-6 text-center text-sm text-muted-foreground">No jobs found.</p>
                          ) : (
                            filteredJobsForPicker.map((job) => (
                              <button
                                key={job.id}
                                type="button"
                                onClick={() => {
                                  setSelectedJobId(job.id);
                                  setJobPickerOpen(false);
                                  setJobSearchQuery('');
                                }}
                                className={cn(
                                  'flex w-full items-center rounded-sm px-2 py-3 text-left outline-none hover:bg-accent focus:bg-accent',
                                  selectedJobId === job.id && 'bg-accent'
                                )}
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-4 w-4 shrink-0',
                                    selectedJobId === job.id ? 'opacity-100' : 'opacity-0'
                                  )}
                                />
                                <div className="flex min-w-0 flex-col">
                                  <span className="font-bold text-base truncate">
                                    {getJobDisplayPrimary(job)}
                                  </span>
                                  {getJobDisplaySecondary(job) && (
                                    <span className="text-sm text-muted-foreground truncate">
                                      {getJobDisplaySecondary(job)}
                                    </span>
                                  )}
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="border-2 border-black rounded-lg bg-white shadow-sm overflow-hidden">
                  <Textarea
                    id="job-entry-notes"
                    placeholder="Notes"
                    className="min-h-[80px] resize-none rounded-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 hover:border-transparent"
                    rows={3}
                    value={manualData.notes}
                    onChange={(e) => setManualData({ ...manualData, notes: e.target.value })}
                  />
                </div>

                <div className="p-3 border-2 border-black rounded-lg bg-gradient-to-br from-yellow-50 to-yellow-100 shadow-md space-y-3">
                  {/* Overnight Shift Checkbox - Only for Snowplowing */}
                  {isSnowplowingJob && (
                      <>
                        <div className="flex items-center gap-2 p-2 bg-blue-50 border-2 border-blue-300 rounded-lg">
                          <input
                            type="checkbox"
                            id="overnight-shift"
                            checked={manualData.isOvernightShift}
                            onChange={(e) => setManualData({ ...manualData, isOvernightShift: e.target.checked })}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <Label htmlFor="overnight-shift" className="text-sm font-semibold text-blue-900 cursor-pointer">
                            🌙 Overnight Shift (ends next day)
                          </Label>
                        </div>
                        {manualData.isOvernightShift && (
                          <div className="p-2 bg-blue-100 border border-blue-400 rounded text-xs text-blue-800">
                            ℹ️ Clock out time will be recorded as the next day ({new Date(new Date(manualData.date).getTime() + 86400000).toLocaleDateString()})
                          </div>
                        )}
                      </>
                    )}
                    
                    <TimeDropdownPicker
                      label="Clock In Time"
                      value={manualData.startTime}
                      onChange={(time) => setManualData({ ...manualData, startTime: time })}
                    />

                    <TimeDropdownPicker
                      label="Clock Out Time"
                      value={manualData.endTime}
                    onChange={(time) => setManualData({ ...manualData, endTime: time })}
                  />
                </div>

                {/* Component Time (Optional) — always reserve space so layout doesn't shift when a job is selected */}
                <div className="space-y-3 pt-4 border-t-2">
                  {selectedJobId && components.length > 0 && jobComponents.length > 0 && (
                    <div className="space-y-3">
                        {jobComponents.map((comp, index) => (
                          <div key={index} className="space-y-2 p-3 border-2 rounded-lg bg-card shadow-sm">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs font-medium">Component {index + 1}</Label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setJobComponents(jobComponents.filter((_, i) => i !== index));
                                }}
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                            
                            <div className="space-y-2">
                              <Select 
                                value={comp.componentId} 
                                onValueChange={(value) => {
                                  const updated = [...jobComponents];
                                  updated[index].componentId = value;
                                  setJobComponents(updated);
                                }}
                              >
                                <SelectTrigger className="h-10">
                                  <SelectValue placeholder="Select component..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {components
                                    .filter(c => !jobComponents.some((jc, i) => i !== index && jc.componentId === c.id))
                                    .map((c) => (
                                      <SelectItem key={c.id} value={c.id}>
                                        {c.name}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {comp.componentId && (
                              <div className="space-y-2">
                                <Label className="text-xs">Time on Component</Label>
                                <div className="grid grid-cols-2 gap-2">
                                  <Select 
                                    value={comp.hours} 
                                    onValueChange={(value) => {
                                      const updated = [...jobComponents];
                                      updated[index].hours = value;
                                      setJobComponents(updated);
                                    }}
                                  >
                                    <SelectTrigger className="h-10">
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
                                  <Select 
                                    value={comp.minutes} 
                                    onValueChange={(value) => {
                                      const updated = [...jobComponents];
                                      updated[index].minutes = value;
                                      setJobComponents(updated);
                                    }}
                                  >
                                    <SelectTrigger className="h-10">
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
                                <div className="bg-primary/10 rounded p-2 text-center">
                                  <p className="text-xs text-muted-foreground">Total Time</p>
                                  <p className="text-base font-bold text-primary">
                                    {(parseInt(comp.hours) + parseInt(comp.minutes) / 60).toFixed(2)} hours
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedJobId || components.length === 0}
                    onClick={() => {
                      if (!selectedJobId || components.length === 0) return;
                      const defaultTime = calculateDefaultComponentTime();
                      setJobComponents([...jobComponents, {
                        componentId: '',
                        hours: defaultTime.hours,
                        minutes: defaultTime.minutes,
                      }]);
                      requestAnimationFrame(() => {
                        const allSelects = document.querySelectorAll('[role="combobox"]');
                        const lastSelect = allSelects[allSelects.length - 1] as HTMLElement;
                        if (lastSelect) {
                          lastSelect.click();
                        }
                      });
                    }}
                    className="w-full h-9"
                  >
                    <Package className="w-3 h-3 mr-1" />
                    Add Another Component
                  </Button>
                </div>
              </>
            )}

            {/* Misc Job Flow - hidden for shop users */}
            {!isShopUser && jobType === 'misc' && (
              <>
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 border-2 border-black rounded-lg p-3 shadow-sm">
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-amber-900 mb-1">Misc Job Entry</p>
                      <p className="text-sm text-amber-700">
                        Use this for odd jobs not in the system. All details will be visible in payroll.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="misc-job-name" className="text-base font-bold text-yellow-600 flex items-center gap-2">
                    <Briefcase className="w-4 h-4" />
                    Job Name *
                  </Label>
                  <Input
                    id="misc-job-name"
                    placeholder="Enter job name..."
                    className="h-10 text-sm font-semibold border-2 border-black shadow-sm hover:border-yellow-600 transition-colors"
                    value={miscJobData.name}
                    onChange={(e) => setMiscJobData({ ...miscJobData, name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="misc-job-address" className="text-base font-bold text-yellow-600 flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Address *
                  </Label>
                  <Input
                    id="misc-job-address"
                    placeholder="Enter job address..."
                    className="h-10 text-sm font-semibold border-2 border-black shadow-sm hover:border-yellow-600 transition-colors"
                    value={miscJobData.address}
                    onChange={(e) => setMiscJobData({ ...miscJobData, address: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="misc-date" className="text-base font-bold text-yellow-600 flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4" />
                    Date *
                  </Label>
                  <Input
                    id="misc-date"
                    type="date"
                    className="h-10 text-sm font-semibold border-2 border-black shadow-sm hover:border-yellow-600 transition-colors"
                    value={miscJobData.date}
                    onChange={(e) => setMiscJobData({ ...miscJobData, date: e.target.value })}
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>

                <div className="p-3 border-2 border-black rounded-lg bg-gradient-to-br from-yellow-50 to-yellow-100 shadow-md space-y-3">
                  <TimeDropdownPicker
                    label="Clock In Time"
                    value={miscJobData.startTime}
                    onChange={(time) => setMiscJobData({ ...miscJobData, startTime: time })}
                  />

                  <TimeDropdownPicker
                    label="Clock Out Time"
                    value={miscJobData.endTime}
                    onChange={(time) => setMiscJobData({ ...miscJobData, endTime: time })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="misc-notes" className="text-sm font-semibold text-muted-foreground">Notes (Optional)</Label>
                  <Textarea
                    id="misc-notes"
                    placeholder="Additional notes..."
                    className="resize-none border-2 border-black hover:border-yellow-600 transition-colors"
                    rows={3}
                    value={miscJobData.notes}
                    onChange={(e) => setMiscJobData({ ...miscJobData, notes: e.target.value })}
                  />
                </div>
              </>
            )}
          </div>
          </div>

          {!isShopUser && (
            <DialogFooter className="mt-0 shrink-0 !flex-row gap-2 border-t-2 border-black bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.08)] sm:justify-stretch">
              {jobType === 'existing' ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedJobId('');
                      setManualData({
                        date: new Date().toISOString().split('T')[0],
                        startTime: '06:00',
                        endTime: '17:00',
                        isOvernightShift: false,
                        notes: '',
                      });
                      setJobComponents([]);
                      onBack?.();
                    }}
                    className="h-12 flex-1 rounded-none border-2 border-black text-base font-semibold hover:bg-slate-100"
                    disabled={loading}
                  >
                    <X className="mr-2 h-5 w-5" />
                    Cancel
                  </Button>
                  <Button
                    onClick={handleManualEntry}
                    disabled={loading || !selectedJobId}
                    className="h-12 flex-1 rounded-none border-2 border-yellow-600 bg-black text-base font-bold text-yellow-600 shadow-lg hover:bg-gray-900"
                  >
                    <Clock className="mr-2 h-5 w-5" />
                    {loading ? 'Logging...' : 'Log Time'}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowDialog(false);
                      setMiscJobData({
                        name: '',
                        address: '',
                        date: new Date().toISOString().split('T')[0],
                        startTime: '06:00',
                        endTime: '17:00',
                        notes: '',
                        isOvernightShift: false,
                      });
                      onBack?.();
                    }}
                    className="h-12 flex-1 rounded-none border-2 border-black text-base font-semibold hover:bg-slate-100"
                    disabled={loading}
                  >
                    <X className="mr-2 h-5 w-5" />
                    Cancel
                  </Button>
                  <Button
                    onClick={handleMiscJobEntry}
                    disabled={loading || !miscJobData.name.trim() || !miscJobData.address.trim()}
                    className="h-12 flex-1 rounded-none border-2 border-yellow-600 bg-black text-base font-bold text-yellow-600 shadow-lg hover:bg-gray-900"
                  >
                    <Clock className="mr-2 h-5 w-5" />
                    {loading ? 'Logging...' : 'Log Time'}
                  </Button>
                </>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
