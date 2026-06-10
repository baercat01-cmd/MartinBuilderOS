import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, X, Trash2, Users, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { getLocalDateString } from '@/lib/utils';

interface UnavailableDate {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  created_at: string;
  user_profiles?: {
    username: string;
  };
}

export const TIME_OFF_REASONS = ['Off', 'Personal', 'Sick', 'Holiday'] as const;
export type TimeOffReason = (typeof TIME_OFF_REASONS)[number];

function normalizeTimeOffReason(value: string | null | undefined): string {
  if (!value) return '';
  return TIME_OFF_REASONS.includes(value as TimeOffReason) ? value : '';
}

/** Parse YYYY-MM-DD (or ISO string) as local date (avoids UTC midnight shifting day-of-week). */
function parseLocalDate(dateStr: string): Date {
  const datePart = typeof dateStr === 'string' && dateStr.length >= 10 ? dateStr.slice(0, 10) : dateStr;
  const [y, m, d] = datePart.split('-').map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function formatTimeOffDateRange(startDate: string, endDate: string): string {
  if (startDate === endDate) {
    return parseLocalDate(startDate).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  return `${parseLocalDate(startDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })} – ${parseLocalDate(endDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

function overlapsPeriod(
  range: UnavailableDate,
  periodStart?: string,
  periodEnd?: string
): boolean {
  if (!periodStart || !periodEnd) return true;
  const start = range.start_date.slice(0, 10);
  const end = range.end_date.slice(0, 10);
  return start <= periodEnd && end >= periodStart;
}

interface UnavailableCalendarProps {
  userId: string;
  onBack?: () => void;
  /** Payroll view: read-only log of all staff time off. Default: interactive calendar. */
  variant?: 'manage' | 'log';
  periodStart?: string;
  periodEnd?: string;
}

export function UnavailableCalendar({
  userId,
  onBack,
  variant = 'manage',
  periodStart,
  periodEnd,
}: UnavailableCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [unavailableDates, setUnavailableDates] = useState<UnavailableDate[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [startDate, setStartDate] = useState(getLocalDateString());
  const [endDate, setEndDate] = useState(getLocalDateString());
  const [reason, setReason] = useState('');
  const [showAllStaff, setShowAllStaff] = useState(true);
  const [editingRange, setEditingRange] = useState<UnavailableDate | null>(null);
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
  const isSelectingRef = useRef(false);
  const selectionStartRef = useRef<string | null>(null);
  const selectionEndRef = useRef<string | null>(null);
  selectionStartRef.current = selectionStart;
  selectionEndRef.current = selectionEnd;

  const canSelectDays = true;

  useEffect(() => {
    loadUnavailableDates();
  }, [userId, showAllStaff, variant]);

  async function loadUnavailableDates() {
    try {
      let query = supabase
        .from('user_unavailable_dates')
        .select('*, user_profiles(username)');

      // Log view always shows all staff; manage view can filter to current user
      if (variant !== 'log' && !showAllStaff) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.order('start_date');

      if (error) throw error;
      setUnavailableDates(data || []);
    } catch (error: any) {
      console.error('Error loading unavailable dates:', error);
    }
  }

  function countWeekdays(start: string, end: string): number {
    const startDate = parseLocalDate(start);
    const endDate = parseLocalDate(end);
    let count = 0;
    for (let d = new Date(startDate.getTime()); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
    }
    return count;
  }

  async function addUnavailableDate() {
    if (!startDate || !endDate) {
      toast.error('Please select start and end dates');
      return;
    }

    if (parseLocalDate(endDate) < parseLocalDate(startDate)) {
      toast.error('End date must be after start date');
      return;
    }

    // Check if the selected range includes any weekdays
    const weekdayCount = countWeekdays(startDate, endDate);
    if (weekdayCount === 0) {
      toast.error('Time off must include at least one weekday (Monday-Friday)');
      return;
    }

    if (!reason || !TIME_OFF_REASONS.includes(reason as TimeOffReason)) {
      toast.error('Please select a reason');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('user_unavailable_dates')
        .insert({
          user_id: userId,
          start_date: startDate,
          end_date: endDate,
          reason,
        });

      if (error) throw error;

      toast.success(`Time off added (${weekdayCount} weekday${weekdayCount !== 1 ? 's' : ''})`);
      setShowAddDialog(false);
      setStartDate(getLocalDateString());
      setEndDate(getLocalDateString());
      setReason('');
      loadUnavailableDates();
    } catch (error: any) {
      toast.error('Failed to add time off');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function updateUnavailableDate(id: string, updates: { start_date: string; end_date: string; reason: string }) {
    if (!updates.reason || !TIME_OFF_REASONS.includes(updates.reason as TimeOffReason)) {
      toast.error('Please select a reason');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('user_unavailable_dates')
        .update({
          start_date: updates.start_date,
          end_date: updates.end_date,
          reason: updates.reason,
        })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      toast.success('Time off updated');
      setEditingRange(null);
      setShowAddDialog(false);
      loadUnavailableDates();
    } catch (error: any) {
      toast.error('Failed to update time off');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function deleteUnavailableDate(id: string) {
    if (!confirm('Remove this time off?')) return;

    try {
      const { error } = await supabase
        .from('user_unavailable_dates')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      toast.success('Time off removed');
      loadUnavailableDates();
    } catch (error: any) {
      toast.error('Failed to remove time off');
      console.error(error);
    }
  }

  function openEditDialog(range: UnavailableDate) {
    setStartDate(range.start_date);
    setEndDate(range.end_date);
    setReason(normalizeTimeOffReason(range.reason));
    setEditingRange(range);
    setShowAddDialog(true);
  }

  function getDaysInMonth(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  function getFirstDayOfMonth(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  }

  function isDateUnavailable(dateStr: string): boolean {
    const date = parseLocalDate(dateStr);
    const dayOfWeek = date.getDay();
    
    // Weekends are never marked as unavailable in the calendar
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return false;
    }
    
    return unavailableDates.some(range => {
      const start = parseLocalDate(range.start_date);
      const end = parseLocalDate(range.end_date);
      return date >= start && date <= end;
    });
  }

  function getUnavailableInfo(dateStr: string): string | null {
    const date = parseLocalDate(dateStr);
    const dayOfWeek = date.getDay();
    
    // Weekends don't show unavailable info
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return null;
    }
    
    const ranges = unavailableDates.filter(range => {
      const start = parseLocalDate(range.start_date);
      const end = parseLocalDate(range.end_date);
      return date >= start && date <= end;
    });
    
    if (ranges.length === 0) return null;
    
    if (showAllStaff) {
      const names = ranges.map(r => r.user_profiles?.username || 'Unknown').join(', ');
      return `Off: ${names}`;
    } else {
      return ranges[0]?.reason || 'Time off';
    }
  }

  function getUnavailableUsers(dateStr: string): string[] {
    const date = parseLocalDate(dateStr);
    const dayOfWeek = date.getDay();
    
    // Weekends don't show unavailable users
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return [];
    }
    
    const ranges = unavailableDates.filter(range => {
      const start = parseLocalDate(range.start_date);
      const end = parseLocalDate(range.end_date);
      return date >= start && date <= end;
    });
    
    return ranges.map(r => r.user_profiles?.username || 'Unknown');
  }

  function previousMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  }

  function nextMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  }

  function goToToday() {
    setCurrentDate(new Date());
  }

  function getSelectionRange(): { start: string; end: string } | null {
    if (!selectionStart || !selectionEnd) return null;
    const a = selectionStart;
    const b = selectionEnd;
    return a <= b ? { start: a, end: b } : { start: b, end: a };
  }

  function isDateInSelection(dateStr: string): boolean {
    const range = getSelectionRange();
    if (!range) return false;
    return dateStr >= range.start && dateStr <= range.end;
  }

  function handleSelectionStart(dateStr: string) {
    if (!canSelectDays) return;
    isSelectingRef.current = true;
    setSelectionStart(dateStr);
    setSelectionEnd(dateStr);
  }

  function handleSelectionUpdate(dateStr: string) {
    if (!canSelectDays || !isSelectingRef.current) return;
    setSelectionEnd(dateStr);
  }

  function openAddDialogForRange(range: { start: string; end: string }) {
    setEditingRange(null);
    setStartDate(range.start);
    setEndDate(range.end);
    setReason('');
    setShowAddDialog(true);
  }

  function openNewTimeOffDialog() {
    setEditingRange(null);
    setStartDate(getLocalDateString());
    setEndDate(getLocalDateString());
    setReason('');
    setShowAddDialog(true);
  }

  const handleSelectionEnd = useCallback(() => {
    if (!isSelectingRef.current) return;
    isSelectingRef.current = false;
    const s = selectionStartRef.current;
    const e = selectionEndRef.current;
    const range = s && e
      ? (s <= e ? { start: s, end: e } : { start: e, end: s })
      : null;
    setSelectionStart(null);
    setSelectionEnd(null);
    if (range) openAddDialogForRange(range);
  }, []);

  useEffect(() => {
    if (!canSelectDays) return;
    window.addEventListener('mouseup', handleSelectionEnd);
    window.addEventListener('touchend', handleSelectionEnd, { passive: true });
    return () => {
      window.removeEventListener('mouseup', handleSelectionEnd);
      window.removeEventListener('touchend', handleSelectionEnd);
    };
  }, [canSelectDays, handleSelectionEnd]);

  const daysInMonth = getDaysInMonth(currentDate);
  const firstDay = getFirstDayOfMonth(currentDate);
  const monthYear = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Generate calendar grid
  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) {
    calendarDays.push(null);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day);
  }

  if (variant === 'log') {
    const logEntries = unavailableDates
      .filter((range) => overlapsPeriod(range, periodStart, periodEnd))
      .sort(
        (a, b) =>
          parseLocalDate(b.start_date).getTime() - parseLocalDate(a.start_date).getTime()
      );

    return (
      <Card className="w-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-primary" />
            Time Off Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!periodStart || !periodEnd ? (
            <p className="text-sm text-muted-foreground">
              Select a payroll period to view time off records.
            </p>
          ) : logEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No time off recorded for this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/20">
                    <th className="text-left p-3 font-semibold">Employee</th>
                    <th className="text-left p-3 font-semibold">Dates</th>
                    <th className="text-left p-3 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {logEntries.map((range) => (
                    <tr key={range.id} className="border-b hover:bg-muted/20">
                      <td className="p-3 font-medium">
                        {range.user_profiles?.username || 'Unknown User'}
                      </td>
                      <td className="p-3">
                        {formatTimeOffDateRange(range.start_date, range.end_date)}
                      </td>
                      <td className="p-3">
                        {range.reason ? (
                          <Badge
                            variant="outline"
                            className="bg-amber-50 text-amber-700 border-amber-200"
                          >
                            {range.reason}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="w-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {onBack && (
                <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 mr-2">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              )}
              <CalendarIcon className="w-5 h-5 text-primary" />
              {showAllStaff ? 'All Staff Time Off' : 'My Time Off'}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant={showAllStaff ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowAllStaff(!showAllStaff)}
                className="h-9"
              >
                <Users className="w-4 h-4 mr-2" />
                {showAllStaff ? 'My Time' : 'All Staff'}
              </Button>
              <Button
                size="sm"
                onClick={openNewTimeOffDialog}
                className="h-9"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-3 space-y-3">
          {/* Calendar Navigation */}
          <div className="flex items-center justify-between">
            <Button variant="outline" size="icon" onClick={previousMonth} className="h-8 w-8">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-[140px] text-center">
              <p className="text-sm font-bold">{monthYear}</p>
            </div>
            <Button variant="outline" size="sm" onClick={goToToday} className="h-8 px-3 text-xs">
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={nextMonth} className="h-8 w-8">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Calendar Grid - Weekdays Only */}
          {canSelectDays && (
            <p className="text-xs text-muted-foreground">Click a day or drag across days to add time off</p>
          )}
          <div
            className="grid grid-cols-5 gap-1"
            onTouchMove={(e) => {
              if (!canSelectDays || !isSelectingRef.current || !e.touches.length) return;
              const touch = e.touches[0];
              const el = document.elementFromPoint(touch.clientX, touch.clientY);
              const cell = el?.closest?.('[data-date]');
              const dateStr = cell?.getAttribute?.('data-date');
              if (dateStr) handleSelectionUpdate(dateStr);
            }}
          >
            {/* Day headers - Monday to Friday */}
            {['M', 'T', 'W', 'T', 'F'].map((day, index) => (
              <div key={`header-${index}`} className="text-center font-semibold text-xs text-muted-foreground py-1">
                {day}
              </div>
            ))}

            {/* Calendar days - Weekdays only */}
            {calendarDays.map((day, index) => {
              if (!day) {
                const cellDayOfWeek = index % 7;
                if (cellDayOfWeek === 0 || cellDayOfWeek === 6) return null;
                return <div key={`empty-${index}`} className="h-12 border rounded bg-muted/30" />;
              }

              const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
              const dayOfWeek = date.getDay();
              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
              
              if (isWeekend) return null;
              
              const isUnavailable = isDateUnavailable(dateStr);
              const today = new Date();
              const isToday = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
              const unavailableInfo = getUnavailableInfo(dateStr);
              const unavailableUsers = showAllStaff ? getUnavailableUsers(dateStr) : [];
              const inSelection = isDateInSelection(dateStr);
              const isSelectable = canSelectDays;

              return (
                <div
                  key={day}
                  data-date={dateStr}
                  className={`h-12 border rounded flex flex-col items-start justify-start text-xs font-medium p-1 select-none ${
                    isToday ? 'border-primary ring-1 ring-primary/20' : ''
                  } ${
                    inSelection ? 'bg-primary/20 ring-1 ring-primary border-primary' : ''
                  } ${
                    !inSelection && isUnavailable ? 'bg-muted/30' : ''
                  } ${
                    !inSelection && !isUnavailable ? 'hover:bg-muted/50' : ''
                  } ${isSelectable ? 'cursor-pointer' : ''}`}
                  title={unavailableInfo || (isSelectable ? 'Click or drag to select' : undefined)}
                  onMouseDown={(e) => { e.preventDefault(); handleSelectionStart(dateStr); }}
                  onMouseEnter={() => handleSelectionUpdate(dateStr)}
                  onTouchStart={(e) => { if (canSelectDays) handleSelectionStart(dateStr); }}
                >
                  <div className="font-bold">{day}</div>
                  {showAllStaff && unavailableUsers.length > 0 && (
                    <div className="text-[9px] leading-tight text-left truncate w-full text-muted-foreground mt-auto">
                      {[...new Set(unavailableUsers)].join(', ')}
                    </div>
                  )}
                </div>
              );
            })})
          </div>

          {/* Upcoming Time Off List */}
          {unavailableDates.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Scheduled Time Off</p>
              <div className="space-y-2 max-h-[150px] overflow-y-auto">
                {unavailableDates
                  .filter(range => parseLocalDate(range.end_date) >= new Date())
                  .map(range => {
                    const isOwner = range.user_id === userId;
                    return (
                      <div
                        key={range.id}
                        className="bg-muted/50 border border-muted rounded p-2 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            {showAllStaff && (
                              <p className="font-semibold text-primary mb-1">
                                {range.user_profiles?.username || 'Unknown User'}
                              </p>
                            )}
                            <p className="font-bold text-foreground">
                              {range.start_date === range.end_date
                                ? parseLocalDate(range.start_date).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })
                                : `${parseLocalDate(range.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${parseLocalDate(range.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                            </p>
                            {range.reason && (
                              <p className="text-muted-foreground mt-1">{range.reason}</p>
                            )}
                          </div>
                          {isOwner && (
                            <div className="flex items-center gap-0.5 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditDialog(range)}
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                title="Edit"
                              >
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteUnavailableDate(range.id)}
                                className="h-6 w-6 text-destructive hover:text-destructive"
                                title="Delete"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Time Off Dialog */}
      <Dialog
        open={showAddDialog}
        onOpenChange={(open) => {
          setShowAddDialog(open);
          if (!open) setEditingRange(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRange ? 'Edit Time Off' : 'Add Time Off'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-date">Start Date *</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  min={editingRange ? undefined : getLocalDateString()}
                  className="h-12"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-date">End Date *</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className="h-12"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason *</Label>
              <Select value={reason || undefined} onValueChange={setReason}>
                <SelectTrigger id="reason">
                  <SelectValue placeholder="Select reason..." />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OFF_REASONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => { setShowAddDialog(false); setEditingRange(null); }}
                className="flex-1"
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                onClick={() => editingRange
                  ? updateUnavailableDate(editingRange.id, { start_date: startDate, end_date: endDate, reason })
                  : addUnavailableDate()
                }
                className="flex-1 gradient-primary"
                disabled={loading || !reason}
              >
                {loading ? (editingRange ? 'Updating...' : 'Adding...') : (editingRange ? 'Update Time Off' : 'Add Time Off')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
