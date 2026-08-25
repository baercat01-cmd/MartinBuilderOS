import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Job } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Edit } from 'lucide-react';
import { JobDetailedView } from './JobDetailedView';
import { EditJobDialog } from './EditJobDialog';
import { isAbortLikeError } from '@/lib/error-handler';
import { agentLog } from '@/lib/officeViewPersistence';

interface OfficeOpenJobDialogProps {
  jobId: string | null;
  jobTab: string;
  /** When false the dialog is hidden but jobId state is preserved. */
  visible: boolean;
  onClose: () => void;
  onTabChange: (tab: string) => void;
}

export function OfficeOpenJobDialog({
  jobId,
  jobTab,
  visible,
  onClose,
  onTabChange,
}: OfficeOpenJobDialogProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const portalJobIdRef = useRef<string | null>(jobId);

  const loadJob = useCallback(async (targetId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('jobs').select('*').eq('id', targetId).single();
      if (error) throw error;
      setJob(data);
    } catch (error) {
      if (!isAbortLikeError(error)) console.error('Error loading open job:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    portalJobIdRef.current = jobId;
    if (!jobId) {
      setJob(null);
      return;
    }
    loadJob(jobId);
  }, [jobId, loadJob]);

  useEffect(() => {
    // #region agent log
    agentLog({
      location: 'OfficeOpenJobDialog.tsx:state',
      message: 'dialog state',
      data: { jobId, jobTab, visible, hasJob: !!job, loading },
      hypothesisId: 'J',
    });
    // #endregion
  }, [jobId, jobTab, visible, job, loading]);

  const dialogOpen = visible && !!jobId;

  return (
    <>
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        agentLog({
          location: 'OfficeOpenJobDialog.tsx:onOpenChange',
          message: 'dialog onOpenChange',
          data: { open, jobId, visible, visibility: document.visibilityState },
          hypothesisId: 'J',
        });
      }}
    >
      <DialogContent
        className="h-screen w-screen max-w-none flex flex-col p-0 m-0 rounded-none"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={() => onClose()}
      >
        <DialogHeader className="px-2 pt-2 pb-2 border-b shrink-0 bg-white">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl">{job?.name ?? 'Loading job…'}</DialogTitle>
            {job ? (
              <Button variant="outline" size="sm" onClick={() => setShowEditDialog(true)}>
                <Edit className="w-4 h-4 mr-2" />
                Edit Job
              </Button>
            ) : null}
          </div>
        </DialogHeader>
        {loading || !job ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">Loading job…</div>
        ) : (
          <div className="flex-1 overflow-y-auto w-full">
            <JobDetailedView
              job={job}
              portalJobId={jobId}
              getPortalJobId={() => portalJobIdRef.current ?? jobId}
              onBack={onClose}
              onEdit={() => setShowEditDialog(true)}
              onJobUpdate={() => jobId && loadJob(jobId)}
              initialTab={jobTab}
              onTabChange={onTabChange}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>

    <EditJobDialog
      open={showEditDialog}
      job={job}
      onClose={() => setShowEditDialog(false)}
      onSuccess={() => {
        setShowEditDialog(false);
        if (jobId) loadJob(jobId);
      }}
    />
    </>
  );
}
