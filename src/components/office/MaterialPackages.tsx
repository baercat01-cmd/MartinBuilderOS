import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import {
  buildLockedToWorkingItemIdMap,
  bundleContainsEquivalentMaterial,
  dedupeMaterialBundleItemsForJob,
  remapMaterialBundleItemsForQuote,
  resolveJobWorkbookIdForQuote,
} from '@/lib/materialBundleRemap';
import {
  dispatchMaterialPackageStatusUpdated,
  MATERIAL_ITEM_STATUS_UPDATED_EVENT,
  syncMaterialsToPackageStatus,
  updatePackageStatusAndMaterials,
} from '@/lib/materialPackageStatus';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Package,
  Plus,
  Edit,
  Trash2,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Square,
  ChevronLeft,
  ShoppingCart,
  FileText,
  DollarSign,
  Info,
  XCircle,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { ZohoOrderConfirmationDialog } from './ZohoOrderConfirmationDialog';
import type { Job } from '@/types';
import type { MetalCatalogBySku } from '@/lib/materialItemLineMoney';

interface MaterialItem {
  id: string;
  sheet_id: string;
  category: string;
  material_name: string;
  quantity: number;
  length: string | null;
  part_length?: string | null;
  color: string | null;
  usage: string | null;
  cost_per_unit: number | null;
  price_per_unit?: number | null;
  extended_cost?: number | null;
  extended_price?: number | null;
  sku?: string | null;
  zoho_sales_order_id?: string | null;
  zoho_sales_order_number?: string | null;
  zoho_purchase_order_id?: string | null;
  zoho_purchase_order_number?: string | null;
  ordered_at?: string | null;
  sheets: {
    sheet_name: string;
  };
}

interface BundleItem {
  id: string;
  bundle_id: string;
  material_item_id: string;
  added_at: string;
  material_items: MaterialItem;
}

interface MaterialBundle {
  id: string;
  job_id: string;
  name: string;
  description: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  bundle_items: BundleItem[];
}

interface MaterialWorkbook {
  id: string;
  job_id: string;
  sheets: MaterialSheet[];
}

interface MaterialSheet {
  id: string;
  workbook_id: string;
  sheet_name: string;
  items: MaterialItem[];
}

interface MaterialPackagesProps {
  jobId: string;
  userId: string;
  /** Active proposal quote — scopes the job workbook (working row) for this contract. */
  quoteId?: string | null;
  /** When set, load materials from this exact workbook (the manage-tab job workbook). */
  sourceWorkbookId?: string | null;
  job?: Job;
}

export function MaterialPackages({ jobId, userId, quoteId = null, sourceWorkbookId = null, job }: MaterialPackagesProps) {
  const [showZohoOrderDialog, setShowZohoOrderDialog] = useState(false);
  const [selectedPackageForOrder, setSelectedPackageForOrder] = useState<MaterialBundle | null>(null);
  const [selectedMaterialsForOrder, setSelectedMaterialsForOrder] = useState<MaterialItem[]>([]);
  const [metalCatalogForZoho, setMetalCatalogForZoho] = useState<MetalCatalogBySku>({});
  const [packages, setPackages] = useState<MaterialBundle[]>([]);
  const [availableMaterials, setAvailableMaterials] = useState<MaterialItem[]>([]);
  const [jobWorkbook, setJobWorkbook] = useState<MaterialWorkbook | null>(null);
  const [jobWorkbookLoading, setJobWorkbookLoading] = useState(true);
  const [proposalToJobItemIdMap, setProposalToJobItemIdMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'list' | 'add'>('list');
  const [selectedPackageForAdd, setSelectedPackageForAdd] = useState<string>('');
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAddMaterialsDialog, setShowAddMaterialsDialog] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<MaterialBundle | null>(null);
  const [expandedPackages, setExpandedPackages] = useState<Set<string>>(new Set());
  
  // Form state
  const [packageName, setPackageName] = useState('');
  const [packageDescription, setPackageDescription] = useState('');
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  function openZohoOrderDialog(pkg: MaterialBundle) {
    const jobItems = bundleItemsOnJobWorkbook(pkg);
    if (jobItems.length === 0) {
      toast.error('This package has no materials on the job workbook to order');
      return;
    }
    
    // Only exclude materials that have BOTH SO and PO
    // Materials with only one type of order can still be ordered (to add the other type)
    const orderableMaterials = jobItems.filter(item => 
      !item.material_items.zoho_sales_order_id || !item.material_items.zoho_purchase_order_id
    );
    
    if (orderableMaterials.length === 0) {
      toast.error('All materials in this package have both Sales Orders and Purchase Orders');
      return;
    }
    
    if (orderableMaterials.length < jobItems.length) {
      const fullyOrderedCount = jobItems.length - orderableMaterials.length;
      toast.warning(
        `${fullyOrderedCount} material${fullyOrderedCount !== 1 ? 's' : ''} with both SO & PO will be excluded`
      );
    }
    
    setSelectedPackageForOrder(pkg);
    setSelectedMaterialsForOrder(orderableMaterials.map(item => item.material_items));
    setShowZohoOrderDialog(true);
  }

  function openZohoOrderDialogForMaterial(material: MaterialItem, packageName: string) {
    // Only block if material has BOTH SO and PO
    // If it only has one type, it can still be ordered to add the other type
    if (material.zoho_sales_order_id && material.zoho_purchase_order_id) {
      toast.error('This material already has both a Sales Order and Purchase Order');
      return;
    }
    
    // Provide helpful message about what orders can be created
    if (material.zoho_sales_order_id) {
      toast.info('This material has a Sales Order - you can add a Purchase Order');
    } else if (material.zoho_purchase_order_id) {
      toast.info('This material has a Purchase Order - you can add a Sales Order');
    }
    
    setSelectedPackageForOrder({ name: packageName } as MaterialBundle);
    setSelectedMaterialsForOrder([material]);
    setShowZohoOrderDialog(true);
  }

  useEffect(() => {
    loadPackages();
    loadJobWorkbookMaterials();

    const bundlesChannel = supabase
      .channel(`material_packages_bundles_${jobId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'material_bundles', filter: `job_id=eq.${jobId}` },
        () => {
          loadPackages();
        }
      )
      .subscribe();

    const itemsChannel = supabase
      .channel(`material_packages_bundle_items_${jobId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'material_bundle_items' },
        () => {
          loadPackages();
        }
      )
      .subscribe();

    const onWorkbookUpdated = (e: Event) => {
      const detail = (e as CustomEvent<{ jobId?: string; quoteId?: string | null }>).detail;
      if (!detail || detail.jobId !== jobId) return;
      if (quoteId != null && detail.quoteId != null && detail.quoteId !== quoteId) return;
      void loadJobWorkbookMaterials();
      void loadPackages();
    };
    const onItemStatusUpdated = (e: Event) => {
      const detail = (e as CustomEvent<{
        jobId?: string | null;
        materialItemIds: string[];
        newStatus: string;
        packageStatuses?: Record<string, string>;
      }>).detail;
      if (!detail || (detail.jobId && detail.jobId !== jobId)) return;

      if (detail.packageStatuses && Object.keys(detail.packageStatuses).length) {
        setPackages((prev) =>
          prev.map((pkg) =>
            detail.packageStatuses![pkg.id]
              ? { ...pkg, status: detail.packageStatuses![pkg.id]! }
              : pkg,
          ),
        );
      } else {
        void loadPackages();
      }
    };
    window.addEventListener(MATERIAL_ITEM_STATUS_UPDATED_EVENT, onItemStatusUpdated as EventListener);
    window.addEventListener('materials-workbook-updated', onWorkbookUpdated as EventListener);

    return () => {
      supabase.removeChannel(bundlesChannel);
      supabase.removeChannel(itemsChannel);
      window.removeEventListener(MATERIAL_ITEM_STATUS_UPDATED_EVENT, onItemStatusUpdated as EventListener);
      window.removeEventListener('materials-workbook-updated', onWorkbookUpdated as EventListener);
    };
  }, [jobId, quoteId, sourceWorkbookId]);

  useEffect(() => {
    if (activeView === 'add') {
      void loadJobWorkbookMaterials();
      void loadPackages();
    }
  }, [activeView]);

  useEffect(() => {
    if (!jobWorkbook?.sheets?.length) return;
    const stillValid = jobWorkbook.sheets.some((s) => s.id === selectedSheetId);
    if (!stillValid) {
      setSelectedSheetId(jobWorkbook.sheets[0]!.id);
    }
  }, [jobWorkbook?.id, jobWorkbook?.sheets, selectedSheetId]);

  useEffect(() => {
    if (!showZohoOrderDialog || selectedMaterialsForOrder.length === 0) {
      setMetalCatalogForZoho({});
      return;
    }
    const skus = [
      ...new Set(
        selectedMaterialsForOrder
          .filter(
            (m) =>
              m.category === 'Metal' &&
              m.sku &&
              m.cost_per_unit == null &&
              m.price_per_unit == null
          )
          .map((m) => m.sku as string)
      ),
    ];
    if (skus.length === 0) {
      setMetalCatalogForZoho({});
      return;
    }
    let cancelled = false;
    void supabase
      .from('materials_catalog')
      .select('sku, purchase_cost, unit_price')
      .in('sku', skus)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.length) {
          setMetalCatalogForZoho({});
          return;
        }
        const map: MetalCatalogBySku = {};
        for (const r of data as {
          sku: string;
          purchase_cost: number | null;
          unit_price: number | null;
        }[]) {
          map[r.sku] = {
            purchase_cost: Number(r.purchase_cost) || 0,
            unit_price: Number(r.unit_price) || 0,
          };
        }
        setMetalCatalogForZoho(map);
      });
    return () => {
      cancelled = true;
    };
  }, [showZohoOrderDialog, selectedMaterialsForOrder]);

  async function loadPackages() {
    try {
      setLoading(true);

      if (quoteId) {
        try {
          const workbookId =
            sourceWorkbookId ??
            (await resolveJobWorkbookIdForQuote(jobId, quoteId, { allowLegacyNullQuote: true }));
          await dedupeMaterialBundleItemsForJob(jobId, { quoteId, jobWorkbookId: workbookId });
        } catch (dedupeErr) {
          console.warn('MaterialPackages dedupe:', dedupeErr);
        }
      }
      
      const { data, error } = await supabase
        .from('material_bundles')
        .select(`
          *,
          bundle_items:material_bundle_items(
            id,
            bundle_id,
            material_item_id,
            added_at,
            material_items(
              id,
              sheet_id,
              category,
              material_name,
              quantity,
              length,
              color,
              usage,
              sku,
              cost_per_unit,
              price_per_unit,
              extended_cost,
              extended_price,
              zoho_sales_order_id,
              zoho_sales_order_number,
              zoho_purchase_order_id,
              zoho_purchase_order_number,
              ordered_at,
              sheets:material_sheets(sheet_name)
            )
          )
        `)
        .eq('job_id', jobId)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Packages load failed (non-blocking):', error.message);
        setPackages([]);
      } else {
        setPackages(data || []);
      }
    } catch (error: any) {
      console.warn('Packages load failed (non-blocking):', error?.message || error);
      setPackages([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadJobWorkbookMaterials() {
    setJobWorkbookLoading(true);
    try {
      if (quoteId) {
        try {
          await remapMaterialBundleItemsForQuote(jobId, quoteId);
          const map = await buildLockedToWorkingItemIdMap(jobId, quoteId);
          setProposalToJobItemIdMap(map);
        } catch (remapErr) {
          console.warn('MaterialPackages remap/map:', remapErr);
        }
      } else {
        setProposalToJobItemIdMap({});
      }

      const workbookId =
        sourceWorkbookId ??
        (await resolveJobWorkbookIdForQuote(jobId, quoteId, {
          allowLegacyNullQuote: true,
        }));
      if (!workbookId) {
        setJobWorkbook(null);
        setAvailableMaterials([]);
        return;
      }

      const { data: sheetsData } = await supabase
        .from('material_sheets')
        .select('id, sheet_name, workbook_id, order_index')
        .eq('workbook_id', workbookId)
        .order('order_index');

      if (!sheetsData?.length) {
        setJobWorkbook({ id: workbookId, job_id: jobId, sheets: [] });
        setAvailableMaterials([]);
        return;
      }

      const sheetIds = sheetsData.map((s) => s.id);
      const { data: itemsData } = await supabase
        .from('material_items')
        .select('id, sheet_id, category, material_name, quantity, length, color, usage, sku, cost_per_unit, price_per_unit, extended_cost, extended_price, zoho_sales_order_id, zoho_sales_order_number, zoho_purchase_order_id, zoho_purchase_order_number, ordered_at')
        .in('sheet_id', sheetIds)
        .order('material_name');

      const materials = (itemsData || []).map((item) => {
        const sheet = sheetsData.find((s) => s.id === item.sheet_id);
        return {
          ...item,
          sheets: { sheet_name: sheet?.sheet_name || 'Unknown' },
        };
      });

      const sheets: MaterialSheet[] = sheetsData.map((sheet) => ({
        id: sheet.id,
        workbook_id: sheet.workbook_id,
        sheet_name: sheet.sheet_name,
        items: materials.filter((m) => m.sheet_id === sheet.id),
      }));

      setJobWorkbook({ id: workbookId, job_id: jobId, sheets });
      setAvailableMaterials(materials);
      await loadPackages();
    } catch (error: any) {
      console.error('Error loading job workbook materials:', error);
      setJobWorkbook(null);
      setAvailableMaterials([]);
    } finally {
      setJobWorkbookLoading(false);
    }
  }

  async function loadAvailableMaterials() {
    await loadJobWorkbookMaterials();
  }

  function openCreateDialog() {
    setPackageName('');
    setPackageDescription('');
    setSelectedMaterialIds(new Set());
    setShowCreateDialog(true);
  }

  function openEditDialog(pkg: MaterialBundle) {
    setSelectedPackage(pkg);
    setPackageName(pkg.name);
    setPackageDescription(pkg.description || '');
    setShowEditDialog(true);
  }

  function openAddMaterialsDialog(pkg: MaterialBundle) {
    setSelectedPackage(pkg);
    const existingMaterialIds = new Set(
      pkg.bundle_items.map(item => item.material_item_id)
    );
    setSelectedMaterialIds(existingMaterialIds);
    setShowAddMaterialsDialog(true);
  }

  async function createPackage() {
    if (!packageName.trim()) {
      toast.error('Please enter a package name');
      return;
    }

    setSaving(true);

    try {
      console.log('Creating package with data:', {
        job_id: jobId,
        name: packageName.trim(),
        description: packageDescription.trim() || null,
        status: 'not_ordered',
        created_by: userId,
      });

      // Create bundle first without materials (materials are optional)
      const { data: bundleData, error: bundleError } = await supabase
        .from('material_bundles')
        .insert({
          job_id: jobId,
          name: packageName.trim(),
          description: packageDescription.trim() || null,
          status: 'not_ordered',
          created_by: userId || null,
        })
        .select()
        .single();

      if (bundleError) {
        console.error('Error creating bundle:', bundleError);
        throw bundleError;
      }

      console.log('Package created successfully:', bundleData);

      // Add materials to bundle if any selected
      if (selectedMaterialIds.size > 0) {
        const bundleItems = Array.from(selectedMaterialIds).map(materialId => ({
          bundle_id: bundleData.id,
          material_item_id: materialId,
        }));

        const { error: itemsError } = await supabase
          .from('material_bundle_items')
          .insert(bundleItems);

        if (itemsError) {
          console.error('Error adding materials to bundle:', itemsError);
          throw itemsError;
        }

        await syncMaterialsToPackageStatus(
          supabase,
          Array.from(selectedMaterialIds),
          bundleData.status ?? 'not_ordered',
        );

        console.log('Materials added to package successfully');
      }

      toast.success('Package created');
      setShowCreateDialog(false);
      loadPackages();
    } catch (error: any) {
      console.error('Error creating package:', error);
      toast.error(`Failed to create package: ${error.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  }

  async function updatePackage() {
    if (!selectedPackage || !packageName.trim()) {
      toast.error('Please enter a package name');
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase
        .from('material_bundles')
        .update({
          name: packageName.trim(),
          description: packageDescription.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedPackage.id);

      if (error) throw error;

      toast.success('Package updated');
      setShowEditDialog(false);
      loadPackages();
    } catch (error: any) {
      console.error('Error updating package:', error);
      toast.error('Failed to update package');
    } finally {
      setSaving(false);
    }
  }

  async function updatePackageMaterials() {
    if (!selectedPackage) return;

    setSaving(true);

    try {
      // Get current material IDs in the bundle
      const currentMaterialIds = new Set(
        selectedPackage.bundle_items.map(item => item.material_item_id)
      );

      // Find materials to add (in selectedMaterialIds but not in currentMaterialIds)
      const toAdd = Array.from(selectedMaterialIds).filter(
        id => !currentMaterialIds.has(id)
      );

      // Find materials to remove (in currentMaterialIds but not in selectedMaterialIds)
      const toRemove = Array.from(currentMaterialIds).filter(
        id => !selectedMaterialIds.has(id)
      );

      // Add new materials
      if (toAdd.length > 0) {
        const uniqueToAdd: string[] = [];
        for (const materialId of toAdd) {
          const already = await bundleContainsEquivalentMaterial(
            selectedPackage.id,
            materialId,
            proposalToJobItemIdMap,
          );
          if (!already) uniqueToAdd.push(materialId);
        }

        if (uniqueToAdd.length > 0) {
        const bundleItems = uniqueToAdd.map(materialId => ({
          bundle_id: selectedPackage.id,
          material_item_id: materialId,
        }));

        const { error: addError } = await supabase
          .from('material_bundle_items')
          .insert(bundleItems);

        if (addError) throw addError;

        await syncMaterialsToPackageStatus(
          supabase,
          uniqueToAdd,
          selectedPackage.status ?? 'not_ordered',
        );
        }
      }

      // Remove materials
      if (toRemove.length > 0) {
        const { error: removeError } = await supabase
          .from('material_bundle_items')
          .delete()
          .eq('bundle_id', selectedPackage.id)
          .in('material_item_id', toRemove);

        if (removeError) throw removeError;
      }

      toast.success('Package materials updated');
      setShowAddMaterialsDialog(false);
      loadPackages();
    } catch (error: any) {
      console.error('Error updating package materials:', error);
      toast.error('Failed to update package materials');
    } finally {
      setSaving(false);
    }
  }

  async function updatePackageStatus(packageId: string, newStatus: string) {
    try {
      console.log('Updating package status:', { packageId, newStatus });
      
      // Optimistic update - update UI immediately
      setPackages(prev => prev.map(pkg => 
        pkg.id === packageId 
          ? { ...pkg, status: newStatus }
          : pkg
      ));
      
      const { data: bundleItems, error: itemsError } = await supabase
        .from('material_bundle_items')
        .select('material_item_id')
        .eq('bundle_id', packageId);

      if (itemsError) {
        console.error('Error fetching bundle items:', itemsError);
        throw itemsError;
      }

      const materialItemIds = (bundleItems ?? []).map((item) => item.material_item_id);

      await updatePackageStatusAndMaterials(supabase, packageId, newStatus, materialItemIds);

      dispatchMaterialPackageStatusUpdated({
        packageId,
        newStatus,
        materialItemIds,
      });

      if (materialItemIds.length > 0) {
        toast.success(`Package status updated - ${materialItemIds.length} material${materialItemIds.length !== 1 ? 's' : ''} updated in workbook`);
      } else {
        toast.success('Package status updated (no materials in package)');
      }
    } catch (error: any) {
      console.error('Error updating package status:', error);
      toast.error(`Failed to update status: ${error.message || 'Unknown error'}`);
      await loadPackages();
    }
  }

  async function deletePackage(packageId: string) {
    if (!confirm('Delete this package? Materials will not be deleted, only the package.')) return;

    try {
      const { error } = await supabase
        .from('material_bundles')
        .delete()
        .eq('id', packageId);

      if (error) throw error;
      toast.success('Package deleted');
      loadPackages();
    } catch (error: any) {
      console.error('Error deleting package:', error);
      toast.error('Failed to delete package');
    }
  }

  async function clearOrderFromMaterial(materialId: string, materialName: string) {
    if (!confirm(`Remove order reference from "${materialName}"?\n\nThis will NOT delete the order from Zoho Books, only remove the reference from this material in the app.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('material_items')
        .update({
          zoho_sales_order_id: null,
          zoho_sales_order_number: null,
          zoho_purchase_order_id: null,
          zoho_purchase_order_number: null,
          zoho_invoice_id: null,
          zoho_invoice_number: null,
          ordered_at: null,
          ordered_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', materialId);

      if (error) throw error;
      
      toast.success('Order reference removed from material');
      loadPackages();
    } catch (error: any) {
      console.error('Error clearing order from material:', error);
      toast.error('Failed to remove order reference');
    }
  }

  async function clearOrdersFromPackage(pkg: MaterialBundle) {
    const materialsWithOrders = pkg.bundle_items.filter(
      item => item.material_items.zoho_sales_order_id || item.material_items.zoho_purchase_order_id
    );

    if (materialsWithOrders.length === 0) {
      toast.error('No materials in this package have orders');
      return;
    }

    if (!confirm(
      `Remove order references from ${materialsWithOrders.length} material${materialsWithOrders.length !== 1 ? 's' : ''} in "${pkg.name}"?\n\nThis will NOT delete orders from Zoho Books, only remove the references from materials in the app.`
    )) {
      return;
    }

    try {
      const materialIds = materialsWithOrders.map(item => item.material_item_id);
      
      const { error } = await supabase
        .from('material_items')
        .update({
          zoho_sales_order_id: null,
          zoho_sales_order_number: null,
          zoho_purchase_order_id: null,
          zoho_purchase_order_number: null,
          zoho_invoice_id: null,
          zoho_invoice_number: null,
          ordered_at: null,
          ordered_by: null,
          updated_at: new Date().toISOString(),
        })
        .in('id', materialIds);

      if (error) throw error;
      
      toast.success(`Order references removed from ${materialsWithOrders.length} material${materialsWithOrders.length !== 1 ? 's' : ''}`);
      loadPackages();
    } catch (error: any) {
      console.error('Error clearing orders from package:', error);
      toast.error('Failed to remove order references');
    }
  }

  function toggleMaterialSelection(materialId: string) {
    const newSet = new Set(selectedMaterialIds);
    if (newSet.has(materialId)) {
      newSet.delete(materialId);
    } else {
      newSet.add(materialId);
    }
    setSelectedMaterialIds(newSet);
  }

  function togglePackageExpanded(packageId: string) {
    const newSet = new Set(expandedPackages);
    if (newSet.has(packageId)) {
      newSet.delete(packageId);
    } else {
      newSet.add(packageId);
    }
    setExpandedPackages(newSet);
  }

  function openAddMaterialsForPackage(packageId: string) {
    if (!jobWorkbook) {
      toast.error('Job workbook is not loaded yet. Try again in a moment.');
      void loadJobWorkbookMaterials();
      return;
    }
    setSelectedPackageForAdd(packageId);
    setSelectedMaterialIds(new Set());
    setExpandedPackages((prev) => new Set(prev).add(packageId));
    void loadJobWorkbookMaterials();
    setActiveView('add');
  }

  async function addSelectedMaterialsToPackage() {
    if (!selectedPackageForAdd) {
      toast.error('Please select a package');
      return;
    }

    if (selectedMaterialIds.size === 0) {
      toast.error('Please select at least one material');
      return;
    }

    setSaving(true);

    try {
      // Get existing materials in package
      const pkg = packages.find(p => p.id === selectedPackageForAdd);
      const existingMaterialIds = new Set(
        pkg?.bundle_items?.map(item => item.material_item_id) || []
      );

      // Filter out materials already in package
      const materialsToAdd = Array.from(selectedMaterialIds).filter(
        id => !existingMaterialIds.has(id)
      );

      if (materialsToAdd.length === 0) {
        toast.error('All selected materials are already in this package');
        setSaving(false);
        return;
      }

      const uniqueToAdd: string[] = [];
      for (const materialId of materialsToAdd) {
        const already = await bundleContainsEquivalentMaterial(
          selectedPackageForAdd,
          materialId,
          proposalToJobItemIdMap,
        );
        if (!already) uniqueToAdd.push(materialId);
      }

      if (uniqueToAdd.length === 0) {
        toast.error('All selected materials are already in this package');
        setSaving(false);
        return;
      }

      // Add materials to package
      const bundleItems = uniqueToAdd.map(materialId => ({
        bundle_id: selectedPackageForAdd,
        material_item_id: materialId,
      }));

      const { error } = await supabase
        .from('material_bundle_items')
        .insert(bundleItems);

      if (error) throw error;

      const packageStatus = pkg?.status ?? 'not_ordered';
      await syncMaterialsToPackageStatus(supabase, uniqueToAdd, packageStatus);

      toast.success(`Added ${uniqueToAdd.length} material${uniqueToAdd.length !== 1 ? 's' : ''} to package`);
      setSelectedMaterialIds(new Set());
      setActiveView('list');
      loadPackages();
    } catch (error: any) {
      console.error('Error adding materials to package:', error);
      toast.error('Failed to add materials to package');
    } finally {
      setSaving(false);
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'ordered':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'received':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'pull_from_shop':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'ready_for_job':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'not_ordered':
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  }

  // Group materials by category for add view
  const groupByCategory = (items: MaterialItem[]) => {
    const categoryMap = new Map<string, MaterialItem[]>();
    items.forEach(item => {
      const category = item.category || 'Uncategorized';
      if (!categoryMap.has(category)) {
        categoryMap.set(category, []);
      }
      categoryMap.get(category)!.push(item);
    });
    return Array.from(categoryMap.entries()).map(([category, items]) => ({ category, items }));
  };

  const packagesWorkbook = jobWorkbook;
  const jobWorkbookItemIds = useMemo(
    () => new Set(availableMaterials.map((m) => m.id)),
    [availableMaterials],
  );

  function bundleItemsOnJobWorkbook(pkg: MaterialBundle): BundleItem[] {
    const items = pkg.bundle_items ?? [];
    const filtered =
      jobWorkbookItemIds.size === 0
        ? items
        : items.filter((bi) => jobWorkbookItemIds.has(bi.material_item_id));

    const seenMaterialIds = new Set<string>();
    const seenFingerprints = new Set<string>();
    return filtered.filter((bi) => {
      if (seenMaterialIds.has(bi.material_item_id)) return false;
      seenMaterialIds.add(bi.material_item_id);
      const mi = bi.material_items;
      if (!mi) return true;
      const fp = [
        mi.sheets?.sheet_name ?? '',
        mi.material_name ?? '',
        mi.sku ?? '',
        mi.quantity ?? 0,
        mi.usage ?? '',
        mi.length ?? '',
      ].join('|');
      if (seenFingerprints.has(fp)) return false;
      seenFingerprints.add(fp);
      return true;
    });
  }

  const materialPackageNamesByItemId = useMemo(() => {
    const map = new Map<string, string[]>();
    const displayedIds = new Set(availableMaterials.map((m) => m.id));

    for (const pkg of packages) {
      for (const bundleItem of pkg.bundle_items ?? []) {
        let materialId = bundleItem.material_item_id as string | undefined;
        if (!materialId) continue;
        if (!displayedIds.has(materialId) && proposalToJobItemIdMap[materialId]) {
          materialId = proposalToJobItemIdMap[materialId];
        }
        if (!displayedIds.has(materialId)) continue;
        const names = map.get(materialId) ?? [];
        names.push(pkg.name);
        map.set(materialId, names);
      }
    }
    return map;
  }, [packages, availableMaterials, proposalToJobItemIdMap]);

  function getMaterialPackageNames(materialId: string): string[] {
    return materialPackageNamesByItemId.get(materialId) ?? [];
  }

  function formatMaterialPackageLabel(names: string[]): string {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0]!;
    return `${names[0]} +${names.length - 1}`;
  }

  function isMaterialInPackage(materialId: string): boolean {
    if (!selectedPackageForAdd) return false;
    const pkg = packages.find((p) => p.id === selectedPackageForAdd);
    if (!pkg) return false;
    return bundleItemsOnJobWorkbook(pkg).some((item) => item.material_item_id === materialId);
  }

  function scrollToPackageSheet(sheetId: string) {
    setSelectedSheetId(sheetId);
    document.getElementById(`package-sheet-${sheetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderMaterialPickerRow(item: MaterialItem) {
    const packageNames = getMaterialPackageNames(item.id);
    const isInSelectedPackage = isMaterialInPackage(item.id);
    const isSelected = selectedMaterialIds.has(item.id);

    return (
      <div
        key={item.id}
        className={`p-3 flex items-center gap-3 cursor-pointer transition-colors ${
          isInSelectedPackage
            ? 'bg-green-50 opacity-60'
            : isSelected
            ? 'bg-blue-50 border-l-4 border-blue-600'
            : 'hover:bg-slate-50'
        }`}
        onClick={() => !isInSelectedPackage && toggleMaterialSelection(item.id)}
      >
        <div className="flex items-center justify-center w-6 h-6">
          {isInSelectedPackage ? (
            <CheckSquare className="w-5 h-5 text-green-600" />
          ) : isSelected ? (
            <CheckSquare className="w-5 h-5 text-blue-600" />
          ) : (
            <Square className="w-5 h-5 text-slate-400" />
          )}
        </div>
        <div className="flex-1">
          <div className="font-medium flex items-center gap-2 flex-wrap">
            {item.material_name}
            {isInSelectedPackage && (
              <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
                In this package
              </Badge>
            )}
            {packageNames.map((pkgName) => (
              <Badge
                key={`${item.id}-${pkgName}`}
                variant="outline"
                className="bg-indigo-50 text-indigo-800 border-indigo-300 font-semibold"
              >
                <Package className="w-3 h-3 mr-1" />
                {pkgName}
              </Badge>
            ))}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {item.sku && <span className="font-mono">{item.sku} • </span>}
            {item.usage && <span>{item.usage} • </span>}
            Qty: {item.quantity}
            {item.length && ` • ${item.length}`}
            {item.cost_per_unit != null && ` • $${Number(item.cost_per_unit).toFixed(2)}`}
          </div>
        </div>
      </div>
    );
  }

  const sheetsWithMaterials = packagesWorkbook?.sheets.filter((s) => s.items.length > 0) ?? [];

  const materialsBySheet = availableMaterials.reduce((acc, material) => {
    const sheetName = material.sheets.sheet_name;
    if (!acc[sheetName]) {
      acc[sheetName] = [];
    }
    acc[sheetName].push(material);
    return acc;
  }, {} as Record<string, MaterialItem[]>);

  if (loading || jobWorkbookLoading) {
    return (
      <div className="text-center py-8">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">Loading packages and job workbook…</p>
      </div>
    );
  }

  if (!packagesWorkbook) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 px-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Package className="w-5 h-5" />
            Material Packages
          </h3>
          <p className="text-sm text-muted-foreground mt-2">
            Packages use the job workbook (working copy). Open the Workbook tab and create a job workbook from the proposal, or wait for it to finish preparing after contract sign.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 px-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Package className="w-5 h-5" />
            Material Packages
          </h3>
          <p className="text-sm text-muted-foreground">
            Bundle materials from the job workbook (working copy) for shop tracking and orders.
            {packagesWorkbook && (
              <span className="block mt-1 text-xs">
                Using job workbook — {sheetsWithMaterials.length} sheet{sheetsWithMaterials.length !== 1 ? 's' : ''},{' '}
                {availableMaterials.length} material lines
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {activeView === 'add' && (
            <Button onClick={() => {
              setActiveView('list');
              setSelectedMaterialIds(new Set());
              setSelectedPackageForAdd('');
            }} variant="outline">
              <ChevronLeft className="w-4 h-4 mr-2" />
              Back to Packages
            </Button>
          )}
          {activeView === 'list' && packages.length > 0 && packagesWorkbook && (
            <Button onClick={() => { void loadJobWorkbookMaterials(); setActiveView('add'); }} variant="outline">
              <Plus className="w-4 h-4 mr-2" />
              Add Materials to Package
            </Button>
          )}
          <Button onClick={openCreateDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Create Package
          </Button>
        </div>
      </div>

      {/* Add Materials View */}
      {activeView === 'add' && packagesWorkbook && (
        <Card className="border-2">
          <CardHeader className="pb-3 border-b bg-gradient-to-r from-blue-50 to-blue-100">
            <div className="space-y-3">
              <div>
                <Label htmlFor="select-package" className="text-sm font-semibold mb-2 block">
                  Select Package to Add Materials To:
                </Label>
                <Select value={selectedPackageForAdd} onValueChange={setSelectedPackageForAdd}>
                  <SelectTrigger id="select-package" className="bg-white border-2">
                    <SelectValue placeholder="Choose a package..." />
                  </SelectTrigger>
                  <SelectContent>
                    {packages.map((pkg) => (
                      <SelectItem key={pkg.id} value={pkg.id}>
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4" />
                          {pkg.name}
                          <Badge variant="secondary" className="ml-2">
                            {pkg.bundle_items?.length || 0} items
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedPackageForAdd && selectedMaterialIds.size > 0 && (
                <Button
                  onClick={addSelectedMaterialsToPackage}
                  disabled={saving}
                  className="w-full"
                >
                  {saving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Add {selectedMaterialIds.size} Material{selectedMaterialIds.size !== 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardHeader>
          {selectedPackageForAdd && (
            <CardContent className="p-0">
              {sheetsWithMaterials.length > 1 && (
                <div className="bg-gradient-to-r from-slate-100 to-slate-50 border-b-2 sticky top-0 z-20">
                  <div className="flex items-center gap-1 overflow-x-auto px-2 py-1">
                    {sheetsWithMaterials.map((sheet) => (
                      <Button
                        key={sheet.id}
                        variant={selectedSheetId === sheet.id ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => scrollToPackageSheet(sheet.id)}
                        className={`flex items-center gap-2 min-w-[140px] justify-start font-semibold ${
                          selectedSheetId === sheet.id ? 'bg-white shadow-md border-2 border-primary' : 'hover:bg-white/50'
                        }`}
                      >
                        {sheet.sheet_name}
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {sheet.items.length}
                        </Badge>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <div className="p-4">
                {sheetsWithMaterials.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Package className="w-16 h-16 mx-auto mb-3 opacity-50" />
                    <p>No materials in this job workbook</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {sheetsWithMaterials.map((sheet) => {
                      const sheetCategoryGroups = groupByCategory(sheet.items);
                      return (
                        <div
                          key={sheet.id}
                          id={`package-sheet-${sheet.id}`}
                          className="scroll-mt-14 space-y-4"
                        >
                          <div className="sticky top-0 z-10 flex items-center justify-between rounded-lg border-2 border-cyan-700/30 bg-gradient-to-r from-cyan-50 to-sky-50 px-4 py-2.5 shadow-sm">
                            <h3 className="font-bold text-base text-cyan-950">{sheet.sheet_name}</h3>
                            <Badge variant="outline" className="bg-white font-semibold">
                              {sheet.items.length} items
                            </Badge>
                          </div>
                          {sheetCategoryGroups.map((catGroup) => (
                            <div key={`${sheet.id}-${catGroup.category}`} className="border-2 rounded-lg overflow-hidden">
                              <div className="bg-gradient-to-r from-indigo-100 to-indigo-50 p-3 border-b-2 border-indigo-200">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-bold text-lg text-indigo-900">{catGroup.category}</h4>
                                  <Badge variant="outline" className="bg-white">
                                    {catGroup.items.length} items
                                  </Badge>
                                </div>
                              </div>
                              <div className="divide-y">
                                {catGroup.items.map((item) => renderMaterialPickerRow(item))}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Packages List */}
      {activeView === 'list' && packages.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No Packages Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create packages to bundle materials together
            </p>
            <Button onClick={openCreateDialog}>
              <Plus className="w-4 h-4 mr-2" />
              Create First Package
            </Button>
          </CardContent>
        </Card>
      ) : activeView === 'list' ? (
        <div className="space-y-3">
          {packages.map(pkg => {
            const isExpanded = expandedPackages.has(pkg.id);
            const jobItems = bundleItemsOnJobWorkbook(pkg);
            
            return (
              <Card key={pkg.id} className="border-2">
                <CardHeader className="p-4 pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => togglePackageExpanded(pkg.id)}
                          className="h-8 w-8 p-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </Button>
                        <div>
                          <CardTitle className="text-base flex items-center gap-2 min-w-0">
                            <Package className="w-4 h-4 shrink-0" />
                            <span className="truncate">{pkg.name}</span>
                            <Badge variant="outline">
                              {jobItems.length} items
                            </Badge>
                          </CardTitle>
                          {pkg.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {pkg.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs border-blue-400 text-blue-800 hover:bg-blue-50 px-2"
                        onClick={() => openAddMaterialsForPackage(pkg.id)}
                        disabled={!packagesWorkbook}
                        title="Pick materials from the job workbook and add to this package"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add Materials
                      </Button>
                      <Select
                        value={pkg.status || 'not_ordered'}
                        onValueChange={(value) => updatePackageStatus(pkg.id, value)}
                      >
                        <SelectTrigger className={`h-8 min-w-[8.5rem] text-xs font-semibold border ${getStatusColor(pkg.status || 'pending')}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_ordered">Not Ordered</SelectItem>
                          <SelectItem value="ordered">Ordered</SelectItem>
                          <SelectItem value="received">Received</SelectItem>
                          <SelectItem value="pull_from_shop">Pull from Shop</SelectItem>
                          <SelectItem value="ready_for_job">Ready for Job</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        onClick={() => openZohoOrderDialog(pkg)}
                        className="h-8 text-xs px-2 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white"
                        title="Create Zoho Sales Order & PO for all unordered materials"
                      >
                        <ShoppingCart className="w-4 h-4 mr-1" />
                        Order All
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditDialog(pkg)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deletePackage(pkg.id)}
                        className="text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="pt-0">
                    <div className="border-t pt-3 space-y-4">
                      {jobItems.length === 0 ? (
                        <div className="text-center py-6 space-y-3">
                          <p className="text-sm text-muted-foreground">
                            No materials in this package yet. Add lines from the job workbook.
                          </p>
                          <Button
                            size="sm"
                            onClick={() => openAddMaterialsForPackage(pkg.id)}
                            disabled={!packagesWorkbook}
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            Add Materials from Job Workbook
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div>
                            <h4 className="font-semibold text-sm mb-2">Package Materials ({jobItems.length})</h4>
                            <div className="space-y-4">
                              {(() => {
                                const bySheet = new Map<string, BundleItem[]>();
                                for (const item of jobItems) {
                                  const sheetName = item.material_items.sheets?.sheet_name || 'Unknown';
                                  const list = bySheet.get(sheetName) ?? [];
                                  list.push(item);
                                  bySheet.set(sheetName, list);
                                }
                                return Array.from(bySheet.entries()).map(([sheetName, sheetItems]) => (
                                  <div key={sheetName} className="space-y-2">
                                    <div className="flex items-center justify-between rounded-md border border-cyan-700/25 bg-cyan-50 px-3 py-1.5">
                                      <span className="text-sm font-semibold text-cyan-950">{sheetName}</span>
                                      <Badge variant="outline" className="bg-white text-xs">
                                        {sheetItems.length} items
                                      </Badge>
                                    </div>
                                    {sheetItems.map((item) => {
                                const hasOrders = item.material_items.zoho_sales_order_id || item.material_items.zoho_purchase_order_id;
                                const hasBothOrders = item.material_items.zoho_sales_order_id && item.material_items.zoho_purchase_order_id;
                                const hasOnlySO = item.material_items.zoho_sales_order_id && !item.material_items.zoho_purchase_order_id;
                                const hasOnlyPO = !item.material_items.zoho_sales_order_id && item.material_items.zoho_purchase_order_id;
                                
                                return (
                                  <div
                                    key={item.id}
                                    className={`flex items-center justify-between p-3 rounded-lg border ${
                                      hasBothOrders 
                                        ? 'bg-emerald-50 border-emerald-200' 
                                        : hasOrders 
                                        ? 'bg-blue-50 border-blue-200' 
                                        : 'bg-slate-50'
                                    }`}
                                  >
                                    <div className="flex-1">
                                      <div className="font-medium flex items-center gap-2">
                                        {item.material_items.material_name}
                                        {item.material_items.sku && (
                                          <TooltipProvider>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <button
                                                  type="button"
                                                  className="text-blue-600 hover:text-blue-800 transition-colors"
                                                >
                                                  <Info className="w-4 h-4" />
                                                </button>
                                              </TooltipTrigger>
                                              <TooltipContent side="right" className="max-w-xs">
                                                <div className="space-y-1">
                                                  <p className="font-semibold text-xs">SKU</p>
                                                  <p className="font-mono text-sm">{item.material_items.sku}</p>
                                                </div>
                                              </TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                        <span>{item.material_items.sheets.sheet_name}</span>
                                        <span>•</span>
                                        <span>{item.material_items.category}</span>
                                        <span>•</span>
                                        <span>Qty: {item.material_items.quantity}</span>
                                        {item.material_items.length && (
                                          <>
                                            <span>•</span>
                                            <span>{item.material_items.length}</span>
                                          </>
                                        )}
                                      </div>
                                      {hasOrders && (
                                        <div className="flex flex-wrap items-center gap-1 mt-2">
                                          {item.material_items.zoho_sales_order_id && (
                                            <a
                                              href={`https://books.zoho.com/app/60007115224#/salesorders/${item.material_items.zoho_sales_order_id}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-300 hover:bg-green-100 cursor-pointer">
                                                📄 SO: {item.material_items.zoho_sales_order_number}
                                              </Badge>
                                            </a>
                                          )}
                                          {item.material_items.zoho_purchase_order_id && (
                                            <a
                                              href={`https://books.zoho.com/app/60007115224#/purchaseorders/${item.material_items.zoho_purchase_order_id}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100 cursor-pointer">
                                                📝 PO: {item.material_items.zoho_purchase_order_number}
                                              </Badge>
                                            </a>
                                          )}
                                          {item.material_items.ordered_at && (
                                            <Badge variant="outline" className="text-xs">
                                              {new Date(item.material_items.ordered_at).toLocaleDateString()}
                                            </Badge>
                                          )}
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              clearOrderFromMaterial(item.material_items.id, item.material_items.material_name);
                                            }}
                                            className="h-6 px-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                            title="Remove order reference from this material"
                                          >
                                            <XCircle className="w-3 h-3" />
                                          </Button>
                                        </div>
                                      )}
                                    </div>
                                    {!hasBothOrders && (
                                      <Button
                                        size="sm"
                                        onClick={() => openZohoOrderDialogForMaterial(item.material_items, pkg.name)}
                                        className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white ml-3"
                                        title={
                                          hasOnlySO 
                                            ? "Add Purchase Order for this material"
                                            : hasOnlyPO
                                            ? "Add Sales Order for this material"
                                            : "Order this material individually"
                                        }
                                      >
                                        <ShoppingCart className="w-4 h-4 mr-1" />
                                        {hasOnlySO ? 'Add PO' : hasOnlyPO ? 'Add SO' : 'Order'}
                                      </Button>
                                    )}
                                  </div>
                                );
                                    })}
                                  </div>
                                ));
                              })()}
                            </div>
                          </div>


                        </>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* Create Package Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Material Package</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="package-name">Package Name *</Label>
              <Input
                id="package-name"
                value={packageName}
                onChange={(e) => setPackageName(e.target.value)}
                placeholder="e.g., Main Building Hardware, Roof Materials..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="package-description">Description</Label>
              <Textarea
                id="package-description"
                value={packageDescription}
                onChange={(e) => setPackageDescription(e.target.value)}
                placeholder="Optional description..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Select Materials (Optional - you can add materials later)</Label>
              <div className="border rounded-lg max-h-[400px] overflow-y-auto">
                {Object.entries(materialsBySheet).map(([sheetName, materials]) => (
                  <div key={sheetName} className="border-b last:border-b-0">
                    <div className="bg-slate-100 px-4 py-2 font-semibold text-sm sticky top-0">
                      {sheetName}
                    </div>
                    <div className="divide-y">
                      {materials.map(material => (
                        <div
                          key={material.id}
                          className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer"
                          onClick={() => toggleMaterialSelection(material.id)}
                        >
                          <Checkbox
                            checked={selectedMaterialIds.has(material.id)}
                            onCheckedChange={() => toggleMaterialSelection(material.id)}
                          />
                          <div className="flex-1">
                            <div className="font-medium text-sm">
                              {material.material_name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {material.category} • Qty: {material.quantity}
                              {material.length && ` • ${material.length}`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Selected: {selectedMaterialIds.size} material{selectedMaterialIds.size !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button
                onClick={createPackage}
                disabled={saving}
                className="flex-1"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Package className="w-4 h-4 mr-2" />
                    Create Package
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Package Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Package</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-package-name">Package Name *</Label>
              <Input
                id="edit-package-name"
                value={packageName}
                onChange={(e) => setPackageName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-package-description">Description</Label>
              <Textarea
                id="edit-package-description"
                value={packageDescription}
                onChange={(e) => setPackageDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button
                onClick={updatePackage}
                disabled={saving}
                className="flex-1"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowEditDialog(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Remove Materials Dialog */}
      <Dialog open={showAddMaterialsDialog} onOpenChange={setShowAddMaterialsDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Package Materials</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select Materials</Label>
              <div className="border rounded-lg max-h-[400px] overflow-y-auto">
                {Object.entries(materialsBySheet).map(([sheetName, materials]) => (
                  <div key={sheetName} className="border-b last:border-b-0">
                    <div className="bg-slate-100 px-4 py-2 font-semibold text-sm sticky top-0">
                      {sheetName}
                    </div>
                    <div className="divide-y">
                      {materials.map(material => (
                        <div
                          key={material.id}
                          className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer"
                          onClick={() => toggleMaterialSelection(material.id)}
                        >
                          <Checkbox
                            checked={selectedMaterialIds.has(material.id)}
                            onCheckedChange={() => toggleMaterialSelection(material.id)}
                          />
                          <div className="flex-1">
                            <div className="font-medium text-sm">
                              {material.material_name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {material.category} • Qty: {material.quantity}
                              {material.length && ` • ${material.length}`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Selected: {selectedMaterialIds.size} material{selectedMaterialIds.size !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button
                onClick={updatePackageMaterials}
                disabled={saving}
                className="flex-1"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAddMaterialsDialog(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Zoho Order Confirmation Dialog */}
      {selectedPackageForOrder && job && (
        <ZohoOrderConfirmationDialog
          open={showZohoOrderDialog}
          onOpenChange={(open) => {
            setShowZohoOrderDialog(open);
            if (!open) {
              // Reload packages after closing dialog to show updated order status
              loadPackages();
              setSelectedMaterialsForOrder([]);
            }
          }}
          jobName={job.name}
          materials={selectedMaterialsForOrder}
          packageName={selectedPackageForOrder.name}
          metalCatalogBySku={metalCatalogForZoho}
        />
      )}
    </div>
  );
}
