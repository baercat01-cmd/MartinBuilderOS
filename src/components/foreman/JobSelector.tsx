
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, MapPin, ExternalLink, Target, Calendar as CalendarIcon, Package, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { MaterialsCatalogBrowser } from './MaterialsCatalogBrowser';
import type { Job } from '@/types';
import { excludeDefaultTimeEntryJobsFromCards } from '@/lib/defaultJobs';

interface JobSelectorProps {
  onSelectJob: (job: Job) => void;
  userId: string;
  userRole?: string;
  onShowJobCalendar?: (job: Job) => void;
  onSelectJobForMaterials?: (job: Job) => void;
  onSelectJobForPullMaterials?: (job: Job) => void;
}

interface JobWithProgress extends Job {
  totalManHours: number;
  progressPercent: number;
  actualProgressPercent: number;
  isOverBudget: boolean;
  ready_materials_count?: number;
  pull_from_shop_count?: number;
}

export function JobSelector({ onSelectJob, userId, userRole, onShowJobCalendar, onSelectJobForMaterials, onSelectJobForPullMaterials }: JobSelectorProps) {
  const [jobs, setJobs] = useState<JobWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalReadyMaterials, setTotalReadyMaterials] = useState(0);
  const [totalPullMaterials, setTotalPullMaterials] = useState(0);
  const [showMaterialRequest, setShowMaterialRequest] = useState(false);
  const [selectedJobForRequest, setSelectedJobForRequest] = useState<Job | null>(null);

  useEffect(() => {
    loadJobs();
  }, [userId]);

  async function loadJobs() {
    try {
      // Get today's date in YYYY-MM-DD format (local timezone)
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      // For all crew members: show all active, non-internal jobs
      // Show jobs that either have no start date OR have started (on or before today)
      let jobsQuery = supabase
        .from('jobs')
        .select('*')
        .eq('status', 'active') // Only active jobs - no quoting or on_hold
        .or('is_internal.is.null,is_internal.eq.false') // Show jobs where is_internal is false OR null
        .or(`projected_start_date.is.null,projected_start_date.lte.${todayStr}`) // Show jobs with no start date OR started already
        .order('name', { ascending: true }); // Sort by name alphabetically

      const { data: jobsData, error: jobsError } = await jobsQuery;

      if (jobsError) throw jobsError;

      // Load CLOCK-IN time entries only (component_id IS NULL) to calculate progress
      const { data: timeEntries, error: timeError } = await supabase
        .from('time_entries')
        .select('job_id, total_hours, crew_count, component_id')
        .is('component_id', null) // Only clock-in hours
        .not('total_hours', 'is', null);

      if (timeError) throw timeError;

      // Calculate total clock-in man-hours for each job
      const jobManHours = new Map<string, number>();
      (timeEntries || []).forEach((entry: any) => {
        const manHours = (entry.total_hours || 0) * (entry.crew_count || 1);
        const current = jobManHours.get(entry.job_id) || 0;
        jobManHours.set(entry.job_id, current + manHours);
      });

      // Filter out Misc Jobs and time-entry-only jobs (NCC, Training)
      const filteredJobs = excludeDefaultTimeEntryJobsFromCards(
        (jobsData || []).filter((job) => job.name !== 'Misc Jobs')
      );

      // Load ready materials count and pull from shop count for each job
      const jobsWithMaterials = await Promise.all(
        filteredJobs.map(async (job) => {
          // Count from old materials table
          const { count: readyCountOld } = await supabase
            .from('materials')
            .select('id', { count: 'exact', head: true })
            .eq('job_id', job.id)
            .eq('status', 'at_shop');
          
          const { count: pullCountOld } = await supabase
            .from('materials')
            .select('id', { count: 'exact', head: true })
            .eq('job_id', job.id)
            .eq('status', 'ready_to_pull');
          
          // Count from new material_workbooks system
          // Get workbooks for this job
          const { data: workbooksData } = await supabase
            .from('material_workbooks')
            .select('id')
            .eq('job_id', job.id)
            .eq('status', 'working');
          
          let readyCountNew = 0;
          let pullCountNew = 0;
          
          if (workbooksData && workbooksData.length > 0) {
            const workbookIds = workbooksData.map(wb => wb.id);
            
            // Get sheets for these workbooks
            const { data: sheetsData } = await supabase
              .from('material_sheets')
              .select('id')
              .in('workbook_id', workbookIds);
            
            if (sheetsData && sheetsData.length > 0) {
              const sheetIds = sheetsData.map(s => s.id);
              
              // Count ready_for_job materials
              const { count: readyNew } = await supabase
                .from('material_items')
                .select('id', { count: 'exact', head: true })
                .in('sheet_id', sheetIds)
                .eq('status', 'ready_for_job');
              
              // Count pull_from_shop materials
              const { count: pullNew } = await supabase
                .from('material_items')
                .select('id', { count: 'exact', head: true })
                .in('sheet_id', sheetIds)
                .eq('status', 'pull_from_shop');
              
              readyCountNew = readyNew || 0;
              pullCountNew = pullNew || 0;
            }
          }
          
          const totalManHours = jobManHours.get(job.id) || 0;
          const estimatedHours = job.estimated_hours || 0;
          const actualProgressPercent = estimatedHours > 0 
            ? (totalManHours / estimatedHours) * 100
            : 0;
          const progressPercent = Math.min(actualProgressPercent, 100);
          const isOverBudget = totalManHours > estimatedHours && estimatedHours > 0;

          // Combine counts from both old and new systems
          const totalReadyCount = (readyCountOld || 0) + readyCountNew;
          const totalPullCount = (pullCountOld || 0) + pullCountNew;

          return {
            ...job,
            totalManHours,
            progressPercent,
            actualProgressPercent,
            isOverBudget,
            ready_materials_count: totalReadyCount,
            pull_from_shop_count: totalPullCount,
          };
        })
      );
      
      const totalReady = jobsWithMaterials.reduce((sum, job) => sum + (job.ready_materials_count || 0), 0);
      const totalPull = jobsWithMaterials.reduce((sum, job) => sum + (job.pull_from_shop_count || 0), 0);
      setTotalReadyMaterials(totalReady);
      setTotalPullMaterials(totalPull);
      setJobs(jobsWithMaterials);
    } catch (error) {
      console.error('Error loading jobs:', error);
    } finally {
      setLoading(false);
    }
  }

  // Jobs are already filtered (no internal jobs)
  const filteredJobs = jobs;

  async function handleOrderMaterials(job: Job) {
    try {
      // Create a notification for the office
      const { error } = await supabase
        .from('notifications')
        .insert({
          job_id: job.id,
          created_by: userId,
          type: 'material_request',
          brief: `Material request for ${job.name}`,
          reference_data: {
            job_name: job.name,
            client_name: job.client_name,
            requested_by: userId
          }
        });

      if (error) throw error;

      toast.success(`Material request sent to office for ${job.name}`);
    } catch (error: any) {
      console.error('Error creating material request:', error);
      toast.error('Failed to send material request');
    }
  }

  return (
    <>
      {/* Material Request Dialog */}
      {selectedJobForRequest && (
        <MaterialsCatalogBrowser
          job={selectedJobForRequest}
          userId={userId}
          onMaterialAdded={() => {
            setShowMaterialRequest(false);
            setSelectedJobForRequest(null);
            loadJobs(); // Reload to update material counts
          }}
        />
      )}

      {/* Dialog wrapper for the catalog browser */}
      <Dialog open={showMaterialRequest} onOpenChange={(open) => {
        if (!open) {
          setShowMaterialRequest(false);
          setSelectedJobForRequest(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order Materials - {selectedJobForRequest?.name}</DialogTitle>
          </DialogHeader>
          {selectedJobForRequest && (
            <MaterialsCatalogBrowser
              job={selectedJobForRequest}
              userId={userId}
              onMaterialAdded={() => {
                loadJobs(); // Reload to update material counts
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <div className="space-y-4">
      {loading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Loading jobs...
          </CardContent>
        </Card>
      ) : filteredJobs.length === 0 ? (
        <Card className="rounded-none border-slate-300">
          <CardContent className="py-8 text-center text-black">
            No active jobs found
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {filteredJobs.map((job) => (
            <Card
              key={job.id}
              className="cursor-pointer hover:shadow-lg hover:border-green-900 transition-all rounded-none border-slate-300 bg-white"
            >
              {/* Main clickable area for opening the job */}
              <div onClick={() => onSelectJob(job)}>
                <CardHeader className="pb-3 bg-slate-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-xl mb-2 text-green-900 font-bold tracking-tight">{job.name}</CardTitle>
                      <p className="text-base font-medium text-black">
                        {job.client_name}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {(job.ready_materials_count || 0) > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 hover:bg-transparent"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectJobForMaterials?.(job);
                            }}
                          >
                            <Badge className="bg-blue-700 text-white hover:bg-blue-800 cursor-pointer rounded-none border border-slate-300">
                              <Package className="w-3 h-3 mr-1" />
                              {job.ready_materials_count} ready for job
                            </Badge>
                          </Button>
                        )}
                        {(job.pull_from_shop_count || 0) > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 hover:bg-transparent"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Navigate to the job with pull tab active
                              onSelectJobForPullMaterials?.(job);
                            }}
                          >
                            <Badge className="bg-purple-700 text-white hover:bg-purple-800 cursor-pointer rounded-none border border-slate-300">
                              <Package className="w-3 h-3 mr-1" />
                              {job.pull_from_shop_count} pull from shop
                            </Badge>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 hover:bg-transparent"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedJobForRequest(job);
                            setShowMaterialRequest(true);
                          }}
                        >
                          <Badge className="bg-green-700 text-white hover:bg-green-800 cursor-pointer rounded-none border border-slate-300">
                            <ShoppingCart className="w-3 h-3 mr-1" />
                            Order Materials
                          </Badge>
                        </Button>
                      </div>
                    </div>
                    {/* Calendar icon - prevent propagation to not trigger job selection */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 rounded-none hover:bg-slate-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowJobCalendar?.(job);
                      }}
                    >
                      <CalendarIcon className="w-4 h-4 text-black" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 pb-4 space-y-3 bg-white">
                  {job.description && (
                    <p className="text-sm text-black line-clamp-2">
                      {job.description}
                    </p>
                  )}
                  
                  {/* Progress Bar */}
                  {job.estimated_hours && job.estimated_hours > 0 && (
                    <div className="space-y-2 pt-2">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Target className="w-4 h-4 text-green-900" />
                          <span className="text-black font-semibold">Progress</span>
                        </div>
                        <span className={`font-bold ${
                          job.isOverBudget ? 'text-orange-500' : 'text-green-900'
                        }`}>
                          {job.actualProgressPercent.toFixed(0)}%
                        </span>
                      </div>
                      
                      {/* First Progress Bar - Always shows up to 100% */}
                      <div className="h-2 bg-slate-200 rounded-none overflow-hidden border border-slate-300">
                        <div 
                          className={`h-full transition-all ${
                            job.isOverBudget ? 'bg-orange-500' : 'bg-green-900'
                          }`}
                          style={{ width: `${job.progressPercent}%` }}
                        />
                      </div>
                      
                      {/* Second Progress Bar - Shows overflow when over 100% */}
                      {job.isOverBudget && job.actualProgressPercent > 100 && (
                        <div className="space-y-1">
                          <div className="h-2 bg-slate-200 rounded-none overflow-hidden border border-slate-300">
                            <div 
                              className="h-full transition-all bg-orange-500"
                              style={{ width: `${Math.min(job.actualProgressPercent - 100, 100)}%` }}
                            />
                          </div>
                          <div className="text-center">
                            <span className="text-xs font-bold text-orange-500">
                              {(job.actualProgressPercent - 100).toFixed(0)}% over budget
                            </span>
                          </div>
                        </div>
                      )}
                      

                    </div>
                  )}
                </CardContent>
              </div>
              
              {/* Action buttons at bottom */}
              <CardContent className="pt-0 pb-3 border-t border-slate-300 bg-slate-50 space-y-2">
                {/* Address link button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs h-auto py-2 rounded-none hover:bg-slate-100"
                  asChild
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-black"
                  >
                    <MapPin className="w-3 h-3 flex-shrink-0 text-green-900" />
                    <span className="flex-1 text-left line-clamp-2">{job.address}</span>
                    <ExternalLink className="w-3 h-3 flex-shrink-0 text-green-900" />
                  </a>
                </Button>
                
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </div>
    </>
  );
}
