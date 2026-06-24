import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Package } from 'lucide-react';
import type { Job } from '@/types';

interface MaterialItem {
  id: string;
  material_name: string;
  quantity: number;
  length: string | null;
  color: string | null;
  usage: string | null;
  status: string;
  sku: string | null;
  _sheet_name?: string;
}

interface MaterialBundle {
  id: string;
  name: string;
  description: string | null;
  status: string;
  items: MaterialItem[];
}

interface MaterialsByBundleProps {
  job: Job;
}

const STATUS_CONFIG: Record<string, { label: string; bgClass: string }> = {
  not_ordered: { label: 'Not Ordered', bgClass: 'bg-gray-50 text-gray-700 border-gray-200' },
  pull_from_shop: { label: 'Pull from Shop', bgClass: 'bg-purple-50 text-purple-800 border-purple-200' },
  ready_for_job: { label: 'Ready for Job', bgClass: 'bg-blue-50 text-blue-800 border-blue-200' },
  at_job: { label: 'At Job', bgClass: 'bg-green-50 text-green-800 border-green-200' },
  installed: { label: 'Installed', bgClass: 'bg-slate-100 text-slate-800 border-slate-200' },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.not_ordered;
}

export function MaterialsByBundle({ job }: MaterialsByBundleProps) {
  const [bundles, setBundles] = useState<MaterialBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set());
  const [expandedMaterials, setExpandedMaterials] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadBundles();

    // Subscribe to bundle and material changes
    const bundlesChannel = supabase
      .channel('bundles_materials_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'material_bundles' },
        () => {
          loadBundles();
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'material_items' },
        () => {
          loadBundles();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(bundlesChannel);
    };
  }, [job.id]);

  async function loadBundles() {
    try {
      setLoading(true);

      console.log('🔍 Loading bundles for job:', job.id);

      // Get material bundles for this job
      const { data: bundlesData, error: bundlesError } = await supabase
        .from('material_bundles')
        .select(`
          id,
          name,
          description,
          status,
          bundle_items:material_bundle_items (
            id,
            material_item_id,
            material_items (
              id,
              sheet_id,
              material_name,
              quantity,
              length,
              color,
              usage,
              status,
              sku,
              sheets:material_sheets(sheet_name)
            )
          )
        `)
        .eq('job_id', job.id)
        .order('created_at', { ascending: false });

      if (bundlesError) throw bundlesError;

      console.log('📦 Loaded bundles:', bundlesData?.length || 0);

      // Transform data
      const transformedBundles = (bundlesData || []).map((bundle: any) => {
        const bundleItems = (bundle.bundle_items || []).map((item: any) => {
          const materialItem = item.material_items;
          
          if (!materialItem) {
            return null;
          }
          
          const sheet = Array.isArray(materialItem.sheets) 
            ? materialItem.sheets[0] 
            : materialItem.sheets || { sheet_name: 'Unknown Sheet' };
          
          return {
            ...materialItem,
            _sheet_name: sheet.sheet_name || 'Unknown Sheet',
          };
        }).filter(Boolean);

        const seenIds = new Set<string>();
        const seenFp = new Set<string>();
        const dedupedItems = bundleItems.filter((item: any) => {
          if (seenIds.has(item.id)) return false;
          seenIds.add(item.id);
          const fp = `${item._sheet_name}|${item.material_name}|${item.sku}|${item.quantity}|${item.usage}|${item.length}`;
          if (seenFp.has(fp)) return false;
          seenFp.add(fp);
          return true;
        });

        return {
          id: bundle.id,
          name: bundle.name,
          description: bundle.description,
          status: bundle.status,
          items: dedupedItems,
        };
      });

      setBundles(transformedBundles);

      // Start with all bundles collapsed
      setExpandedBundles(new Set());
    } catch (error: any) {
      console.error('❌ Error loading bundles:', error);
    } finally {
      setLoading(false);
    }
  }

  function toggleBundle(bundleId: string) {
    const newSet = new Set(expandedBundles);
    if (newSet.has(bundleId)) {
      newSet.delete(bundleId);
    } else {
      newSet.add(bundleId);
    }
    setExpandedBundles(newSet);
  }

  function toggleMaterial(materialId: string) {
    const newSet = new Set(expandedMaterials);
    if (newSet.has(materialId)) {
      newSet.delete(materialId);
    } else {
      newSet.add(materialId);
    }
    setExpandedMaterials(newSet);
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">Loading bundles...</p>
      </div>
    );
  }

  if (bundles.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Package className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">
            No material bundles created yet
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Office staff can create material bundles
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {bundles.map(bundle => {
        const isExpanded = expandedBundles.has(bundle.id);

        return (
          <Card key={bundle.id} className="border border-emerald-200">
            <Collapsible open={isExpanded} onOpenChange={() => toggleBundle(bundle.id)}>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer bg-gradient-to-r from-emerald-50 to-emerald-100/50 hover:from-emerald-100 hover:to-emerald-200/50 transition-colors py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-emerald-600" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-emerald-600" />
                      )}
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Package className="w-4 h-4 text-emerald-600" />
                          {bundle.name}
                        </CardTitle>
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="p-2 sm:p-3">
                  <div className="space-y-2">
                    {bundle.items.map((item) => {
                      const isMaterialExpanded = expandedMaterials.has(item.id);

                      return (
                        <div 
                          key={item.id} 
                          className="bg-white border rounded-lg hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => toggleMaterial(item.id)}
                        >
                          <div className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-sm leading-tight mb-2">
                                  {item.material_name}
                                </h4>
                                
                                <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                                  <div>
                                    <span className="text-muted-foreground">Qty:</span>
                                    <p className="font-semibold text-base">{item.quantity}</p>
                                  </div>
                                  
                                  <div>
                                    <span className="text-muted-foreground">Color:</span>
                                    <p className="font-medium">
                                      {item.color || '-'}
                                    </p>
                                  </div>
                                  
                                  <div>
                                    <span className="text-muted-foreground">Length:</span>
                                    <p className="font-medium">
                                      {item.length || '-'}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge
                                    variant="outline"
                                    className={getStatusConfig(item.status).bgClass}
                                  >
                                    {getStatusConfig(item.status).label}
                                  </Badge>
                                  {item._sheet_name && (
                                    <Badge variant="outline" className="text-xs">
                                      {item._sheet_name}
                                    </Badge>
                                  )}
                                  {item.sku && (
                                    <Badge variant="outline" className="text-xs">
                                      SKU: {item.sku}
                                    </Badge>
                                  )}
                                </div>

                                {isMaterialExpanded && item.usage && (
                                  <div className="mt-2 pt-2 border-t">
                                    <p className="text-xs text-muted-foreground font-medium">Usage:</p>
                                    <p className="text-xs text-foreground mt-1">
                                      {item.usage}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        );
      })}
    </div>
  );
}
