import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Building2 } from 'lucide-react';
import type { Job } from '@/types';

// Helper function to create or update contact
async function createOrUpdateContact(contactInfo: {
  name: string;
  email: string | null;
  phone: string | null;
  category: string;
  job_id: string | null;
  created_by: string;
}) {
  try {
    // Build search query dynamically based on available data
    const searchConditions = [];
    if (contactInfo.name) {
      searchConditions.push(`name.ilike.${contactInfo.name}`);
    }
    if (contactInfo.email) {
      searchConditions.push(`email.eq.${contactInfo.email}`);
    }
    if (contactInfo.phone) {
      searchConditions.push(`phone.eq.${contactInfo.phone}`);
    }
    
    if (searchConditions.length === 0) {
      console.log('⚠️ No search criteria for contact');
      return null;
    }
    
    const { data: existingContacts } = await supabase
      .from('contacts')
      .select('*')
      .or(searchConditions.join(','))
      .eq('category', contactInfo.category)
      .limit(1);

    if (existingContacts && existingContacts.length > 0) {
      console.log('✅ Contact already exists:', existingContacts[0].name);
      
      // Update contact with job_id if not set
      if (!existingContacts[0].job_id && contactInfo.job_id) {
        await supabase
          .from('contacts')
          .update({ job_id: contactInfo.job_id })
          .eq('id', existingContacts[0].id);
        console.log('✅ Linked contact to job');
      }
      
      return existingContacts[0];
    }

    // Only create contact if we have email (required field)
    if (!contactInfo.email) {
      console.log('⚠️ Cannot create contact without email (required field)');
      return null;
    }

    // Create new contact
    const { data: newContact, error } = await supabase
      .from('contacts')
      .insert({
        name: contactInfo.name,
        email: contactInfo.email,
        phone: contactInfo.phone,
        category: contactInfo.category,
        job_id: contactInfo.job_id,
        is_active: true,
        created_by: contactInfo.created_by,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating contact:', error);
      return null;
    }

    console.log('✅ Created new contact:', newContact.name);
    return newContact;
  } catch (error) {
    console.error('Error in createOrUpdateContact:', error);
    return null;
  }
}

interface EditJobDialogProps {
  open: boolean;
  job: Job | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditJobDialog({ open, job, onClose, onSuccess }: EditJobDialogProps) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    client_name: '',
    customer_email: '',
    customer_phone: '',
    address: '',
    description: '',
    notes: '',
    status: 'active',
    quote_number: '',
    job_number: '',
    estimated_hours: '',
    projected_start_date: '',
    projected_end_date: '',
  });

  useEffect(() => {
    if (job) {
      setFormData({
        name: job.name || '',
        client_name: job.client_name || '',
        customer_email: (job as any).customer_email || '',
        customer_phone: (job as any).customer_phone || '',
        address: job.address || '',
        description: job.description || '',
        notes: job.notes || '',
        status: job.status || 'active',
        quote_number: job.quote_number || '',
        job_number: job.job_number || '',
        estimated_hours: job.estimated_hours?.toString() || '',
        projected_start_date: job.projected_start_date || '',
        projected_end_date: job.projected_end_date || '',
      });
    }
  }, [job]);

  async function handleSubmit(e: React.FormEvent) {
    // CRITICAL: Prevent default FIRST to block page reload
    e.preventDefault();
    e.stopPropagation();
    
    if (!job) return;

    // Office role validation
    if (profile?.role !== 'office' && !profile?.is_admin) {
      toast.error('Only office staff can edit jobs');
      return;
    }

    // Manual scroll anchor - record EXACT scroll position at the very start
    const savedScrollPosition = window.scrollY;
    console.log('💾 Saved scroll position:', savedScrollPosition);

    setLoading(true);

    try {
      const estimatedHours = formData.estimated_hours.trim() 
        ? parseFloat(formData.estimated_hours) 
        : 0;

      const updates: Record<string, unknown> = {
        name: formData.name.trim(),
        client_name: formData.client_name.trim(),
        customer_email: formData.customer_email.trim() || null,
        customer_phone: formData.customer_phone.trim() || null,
        address: formData.address.trim(),
        description: formData.description.trim() || null,
        notes: formData.notes.trim() || null,
        status: formData.status,
        job_number: formData.job_number.trim() || null,
        estimated_hours: estimatedHours,
        projected_start_date: formData.projected_start_date || null,
        projected_end_date: formData.projected_end_date || null,
        updated_at: new Date().toISOString(),
      };

      // Quote number is unique across jobs - only send it when the user actually changed it.
      const nextQuoteNumber = formData.quote_number.trim() || null;
      if (nextQuoteNumber !== (job.quote_number || null)) {
        updates.quote_number = nextQuoteNumber;
      }

      const { error } = await supabase
        .from('jobs')
        .update(updates)
        .eq('id', job.id);

      if (error) {
        console.error('Job update error:', error);
        throw new Error(error.message || 'Failed to update job');
      }

      // Auto-update contact with email/phone
      if (formData.client_name.trim()) {
        await createOrUpdateContact({
          name: formData.client_name.trim(),
          email: formData.customer_email.trim() || null,
          phone: formData.customer_phone.trim() || null,
          category: 'customer',
          job_id: job.id,
          created_by: profile.id
        });
      }

      // Restore scroll position AFTER updates but BEFORE toast
      requestAnimationFrame(() => {
        window.scrollTo({ top: savedScrollPosition, behavior: 'instant' });
        console.log('📍 Scroll restored to:', savedScrollPosition);
      });

      toast.success('Job updated successfully', {
        duration: 2000,
        position: 'bottom-right'
      });
      
      onSuccess();
    } catch (error: any) {
      console.error('Job update failed:', error);
      toast.error(error.message || 'Failed to update job');
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (!loading) {
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Edit Job
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Job Name *</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Smith Barn Construction"
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-client">Client Name</Label>
            <Input
              id="edit-client"
              value={formData.client_name}
              onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
              placeholder="John Smith"
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-email">Customer Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={formData.customer_email}
                onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })}
                placeholder="customer@example.com"
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Customer Phone</Label>
              <Input
                id="edit-phone"
                type="tel"
                value={formData.customer_phone}
                onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                placeholder="(555) 123-4567"
                disabled={loading}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-quote-number">Quote / Job #</Label>
              <Input
                id="edit-quote-number"
                value={formData.quote_number}
                onChange={(e) => setFormData({ ...formData, quote_number: e.target.value })}
                placeholder="26001"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Shown on job cards and proposals
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-job-number">Legacy Job Number</Label>
              <Input
                id="edit-job-number"
                value={formData.job_number}
                onChange={(e) => setFormData({ ...formData, job_number: e.target.value })}
                placeholder="JOB-2024-001"
                disabled={loading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-estimated">Estimated Hours</Label>
            <Input
              id="edit-estimated"
              type="number"
              step="0.5"
              min="0"
              value={formData.estimated_hours}
              onChange={(e) => setFormData({ ...formData, estimated_hours: e.target.value })}
              placeholder="Enter total estimated hours for job"
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              Set the total estimated hours to track project progress
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-start-date">Projected Start Date</Label>
              <Input
                id="edit-start-date"
                type="date"
                value={formData.projected_start_date}
                onChange={(e) => setFormData({ ...formData, projected_start_date: e.target.value })}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Job appears in field view on this date
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-end-date">Projected End Date</Label>
              <Input
                id="edit-end-date"
                type="date"
                value={formData.projected_end_date}
                onChange={(e) => setFormData({ ...formData, projected_end_date: e.target.value })}
                disabled={loading}
                min={formData.projected_start_date || undefined}
              />
              <p className="text-xs text-muted-foreground">
                Estimated completion date
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-address">Job Address *</Label>
            <Input
              id="edit-address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="123 Main St, City, State"
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-status">Status</Label>
            <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
              <SelectTrigger id="edit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quoting">Quoting</SelectItem>
                <SelectItem value="prepping">Prepping</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              placeholder="Project details, scope, etc."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea
              id="edit-notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              placeholder="Internal notes, special instructions, etc."
            />
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="gradient-primary">
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Updating...
                </>
              ) : (
                'Update Job'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
