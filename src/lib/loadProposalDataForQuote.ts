import { supabase } from '@/lib/supabase';
import { isFieldRequestSheetName } from '@/lib/materialWorkbook';
import { fetchJobQuotesForJob, jobHasMultipleFormalProposals } from '@/lib/quotesSchemaFallback';

export type LoadProposalDataOptions = { forChangeOrderDocument?: boolean };
export async function loadProposalDataForQuote(
    jobId: string,
    quoteId: string | null,
    taxExempt: boolean,
    opts?: LoadProposalDataOptions
  ) {
    try {
      const { data: jobQuotesForScope } = await fetchJobQuotesForJob(supabase, jobId);
      const isolateFormalProposals = jobHasMultipleFormalProposals(jobQuotesForScope || []);

      const { data: coQuoteEarly } = await supabase
        .from('quotes')
        .select('id')
        .eq('job_id', jobId)
        .eq('is_change_order_proposal', true)
        .limit(1)
        .maybeSingle();
      const changeOrderQuoteIdForJob = coQuoteEarly?.id ?? null;
      const forChangeOrderDocument =
        !!opts?.forChangeOrderDocument || (!!quoteId && quoteId === changeOrderQuoteIdForJob);

      // Prefer proposal totals stored on the quote (written by JobFinancials) so portal always matches office
      let storedTotals: { subtotal: number; tax: number; grandTotal: number; materials?: number; labor?: number } | null = null;
      if (quoteId) {
        const { data: quoteRow } = await supabase
          .from('quotes')
          .select('proposal_subtotal, proposal_tax, proposal_grand_total')
          .eq('id', quoteId)
          .maybeSingle();
        const sub = quoteRow?.proposal_subtotal != null ? Number(quoteRow.proposal_subtotal) : NaN;
        const tax = quoteRow?.proposal_tax != null ? Number(quoteRow.proposal_tax) : NaN;
        const grand = quoteRow?.proposal_grand_total != null ? Number(quoteRow.proposal_grand_total) : NaN;
        if (Number.isFinite(sub) && Number.isFinite(grand)) {
          storedTotals = { subtotal: sub, tax: Number.isFinite(tax) ? tax : 0, grandTotal: grand };
        }
      }

      // Workbook selection â€” mirrors JobFinancials multi-step fallback exactly:
      // 1a. Quote-specific workbook, status='working' (primary â€” matches JobFinancials default)
      // 1b. Quote-specific workbook, any status (fallback)
      // 2.  Null-quote legacy workbook, status='working'
      // 3.  Scan ALL job workbooks, pick 'working' then newest
      let workbookData: { id: string } | null = null;
      if (quoteId) {
        const { data: wb } = await supabase
          .from('material_workbooks')
          .select('id')
          .eq('job_id', jobId)
          .eq('quote_id', quoteId)
          .eq('status', 'working')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        workbookData = wb ?? null;
        if (!workbookData) {
          const { data: wb2 } = await supabase
            .from('material_workbooks')
            .select('id')
            .eq('job_id', jobId)
            .eq('quote_id', quoteId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          workbookData = wb2 ?? null;
        }
      }
      if (!workbookData && !isolateFormalProposals) {
        const { data: wb } = await supabase
          .from('material_workbooks')
          .select('id')
          .eq('job_id', jobId)
          .is('quote_id', null)
          .eq('status', 'working')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        workbookData = wb ?? null;
      }
      if (!workbookData) {
        let wbQuery = supabase
          .from('material_workbooks')
          .select('id')
          .eq('job_id', jobId)
          .order('status', { ascending: false })
          .order('updated_at', { ascending: false });
        if (isolateFormalProposals && quoteId) {
          wbQuery = wbQuery.eq('quote_id', quoteId);
        }
        const { data: allWbs } = await wbQuery;
        workbookData = (allWbs || [])[0] ?? null;
      }

      let materialSheets: any[] = [];
      if (workbookData) {
        const summarizeWorkbook = async (wbId: string) => {
          const { data: wbSheetsData } = await supabase
            .from('material_sheets')
            .select('*')
            .eq('workbook_id', wbId)
            .order('order_index');
          const wbSheets = (wbSheetsData || []).filter((s: any) => !isFieldRequestSheetName(s.sheet_name));
          const wbSheetIds = wbSheets.map((s: any) => s.id);
          let wbItemsCount = 0;
          const wbDescribedSheetsCount = wbSheets.filter(
            (s: any) => typeof s.description === 'string' && s.description.trim() !== ''
          ).length;
          if (wbSheetIds.length > 0) {
            const { count } = await supabase
              .from('material_items')
              .select('id', { count: 'exact', head: true })
              .in('sheet_id', wbSheetIds);
            wbItemsCount = count ?? 0;
          }
          return {
            wbId,
            sheets: wbSheets,
            sheetsCount: wbSheets.length,
            describedSheetsCount: wbDescribedSheetsCount,
            itemsCount: wbItemsCount,
          };
        };

        const { data: sheetsData } = await supabase
          .from('material_sheets')
          .select('*')
          .eq('workbook_id', workbookData.id)
          .order('order_index');
        let sheets = (sheetsData || []).filter((s: any) => !isFieldRequestSheetName(s.sheet_name));

        // Always choose the richest workbook for this job (not only when empty), so portal
        // proposal sections match what office users see in Proposal/Materials.
        const { data: allWbs } = await supabase
          .from('material_workbooks')
          .select('id, quote_id')
          .eq('job_id', jobId)
          .order('status', { ascending: false })
          .order('updated_at', { ascending: false });

        const comparableWbs = (allWbs || []).filter((wb: { id: string; quote_id?: string | null }) => {
          if (wb.id === workbookData!.id) return false;
          if (isolateFormalProposals && quoteId) return wb.quote_id === quoteId;
          return true;
        });

        // Prefer workbooks with more proposal sections/descriptions; item count is only a tie-breaker.
        const score = (s: { describedSheetsCount: number; sheetsCount: number; itemsCount: number }) =>
          (s.describedSheetsCount * 1_000_000) + (s.sheetsCount * 1_000) + s.itemsCount;
        let best = await summarizeWorkbook(workbookData.id);
        for (const wb of comparableWbs) {
          const candidate = await summarizeWorkbook(wb.id);
          if (score(candidate) > score(best)) best = candidate;
        }

        if (best.wbId !== workbookData.id) {
          sheets = best.sheets;
          workbookData = { id: best.wbId };
        }

        const sheetIds = sheets.map((s: any) => s.id);
        for (const sheet of sheets) {
          const [{ data: items }, { data: laborRows }, { data: categoryMarkupRows }] = await Promise.all([
            supabase.from('material_items').select('*').eq('sheet_id', sheet.id).order('order_index'),
            supabase.from('material_sheet_labor').select('*').eq('sheet_id', sheet.id),
            supabase.from('material_category_markups').select('*').eq('sheet_id', sheet.id),
          ]);
          (sheet as any).items = items || [];
          (sheet as any).laborRows = laborRows || [];
          const laborTotal = (laborRows || []).reduce((s: number, l: any) => s + (l.total_labor_cost ?? (l.estimated_hours ?? 0) * (l.hourly_rate ?? 0)), 0);
          (sheet as any).laborTotal = laborTotal;
          const catMarkupMap: Record<string, number> = {};
          (categoryMarkupRows || []).forEach((cm: any) => { catMarkupMap[cm.category_name] = cm.markup_percent ?? 10; });
          (sheet as any).categoryMarkups = catMarkupMap;
        }
        // Fetch sheet-linked custom_financial_row_items (row_id IS NULL) â€” used for labor line items added to sheets
        if (sheetIds.length > 0) {
          const { data: sheetLineItems } = await supabase
            .from('custom_financial_row_items')
            .select('*')
            .in('sheet_id', sheetIds)
            .is('row_id', null)
            .order('order_index');
          const bySheet: Record<string, any[]> = {};
          (sheetLineItems || []).forEach((item: any) => {
            const sid = item.sheet_id;
            if (sid) {
              if (!bySheet[sid]) bySheet[sid] = [];
              bySheet[sid].push(item);
            }
          });
          sheets.forEach((sheet: any) => {
            (sheet as any).sheetLinkedItems = bySheet[sheet.id] || [];
          });
        }
        materialSheets = sheets;
      }

      // Change order proposal workbook (main proposal view only â€” not when loading the CO document itself)
      let changeOrderSheets: any[] = [];
      const changeOrderQuoteRow = changeOrderQuoteIdForJob ? { id: changeOrderQuoteIdForJob } : null;
      if (changeOrderQuoteRow?.id && !forChangeOrderDocument) {
        const { data: coWb } = await supabase
          .from('material_workbooks')
          .select('id')
          .eq('quote_id', changeOrderQuoteRow.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (coWb?.id) {
          const { data: coSheets } = await supabase
            .from('material_sheets')
            .select('*')
            .eq('workbook_id', coWb.id)
            .order('order_index');
          const coSheetsList = (coSheets || []).filter((s: any) => !isFieldRequestSheetName(s.sheet_name));
          for (const sheet of coSheetsList) {
            const [{ data: items }, { data: laborRows }, { data: categoryMarkupRows }] = await Promise.all([
              supabase.from('material_items').select('*').eq('sheet_id', sheet.id).order('order_index'),
              supabase.from('material_sheet_labor').select('*').eq('sheet_id', sheet.id),
              supabase.from('material_category_markups').select('*').eq('sheet_id', sheet.id),
            ]);
            (sheet as any).items = items || [];
            (sheet as any).laborRows = laborRows || [];
            const laborTotal = (laborRows || []).reduce((s: number, l: any) => s + (l.total_labor_cost ?? (l.estimated_hours ?? 0) * (l.hourly_rate ?? 0)), 0);
            (sheet as any).laborTotal = laborTotal;
            const catMarkupMap: Record<string, number> = {};
            (categoryMarkupRows || []).forEach((cm: any) => { catMarkupMap[cm.category_name] = cm.markup_percent ?? 10; });
            (sheet as any).categoryMarkups = catMarkupMap;
          }
          const coSheetIds = coSheetsList.map((s: any) => s.id);
          if (coSheetIds.length > 0) {
            const { data: sheetLineItems } = await supabase
              .from('custom_financial_row_items')
              .select('*')
              .in('sheet_id', coSheetIds)
              .is('row_id', null)
              .order('order_index');
            const bySheet: Record<string, any[]> = {};
            (sheetLineItems || []).forEach((item: any) => {
              const sid = item.sheet_id;
              if (sid) { if (!bySheet[sid]) bySheet[sid] = []; bySheet[sid].push(item); }
            });
            coSheetsList.forEach((sheet: any) => { (sheet as any).sheetLinkedItems = bySheet[sheet.id] || []; });
          }
          coSheetsList.forEach((sheet: any) => {
            const catMarkups: Record<string, number> = sheet.categoryMarkups || {};
            const byCategory = new Map<string, any[]>();
            (sheet.items || []).forEach((item: any) => {
              const cat = item.category || 'Uncategorized';
              if (!byCategory.has(cat)) byCategory.set(cat, []);
              byCategory.get(cat)!.push(item);
            });
            let sheetCatPrice = 0;
            byCategory.forEach((catItems, catName) => {
              const markup = catMarkups[catName] ?? 10;
              sheetCatPrice += catItems.reduce((s: number, i: any) => {
                const ext = i.extended_price != null && i.extended_price !== '' ? Number(i.extended_price) : null;
                if (ext != null && ext > 0) return s + ext;
                const qty = Number(i.quantity) || 0;
                const pricePerUnit = Number(i.price_per_unit) || 0;
                if (pricePerUnit > 0) return s + qty * pricePerUnit;
                const cost = i.extended_cost != null ? Number(i.extended_cost) : qty * (Number(i.cost_per_unit) || 0);
                return s + cost * (1 + markup / 100);
              }, 0);
            });
            let sheetLinkedLabor = 0;
            (sheet.sheetLinkedItems || []).forEach((item: any) => {
              if ((item.item_type || 'material') === 'labor')
                sheetLinkedLabor += (Number(item.total_cost) || 0) * (1 + ((item.markup_percent ?? 0) / 100));
            });
            (sheet as any)._computedTotal = sheetCatPrice + (sheet.laborTotal ?? 0) + sheetLinkedLabor;
          });
          changeOrderSheets = coSheetsList;
        }
      }

      // Custom rows: quote-specific + job-level (quote_id null), deduplicated and sorted.
      // Matches JobFinancials exactly: quote rows take priority; job-level rows that share an id are dropped.
      let customRowsData: any[] = [];
      if (quoteId) {
        const [forQuote, forJob] = await Promise.all([
          supabase.from('custom_financial_rows').select('*, custom_financial_row_items(*)').eq('quote_id', quoteId).order('order_index'),
          supabase.from('custom_financial_rows').select('*, custom_financial_row_items(*)').eq('job_id', jobId).is('quote_id', null).order('order_index'),
        ]);
        customRowsData = [...(forQuote.data || [])];
        if (!isolateFormalProposals) {
          const quoteRowIds = new Set((forQuote.data || []).map((r: any) => r.id));
          const jobOnlyRows = (forJob.data || []).filter((r: any) => !quoteRowIds.has(r.id));
          customRowsData = [...customRowsData, ...jobOnlyRows];
        }
        customRowsData.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
      } else {
        const { data } = await supabase.from('custom_financial_rows').select('*, custom_financial_row_items(*)').eq('job_id', jobId).order('order_index');
        customRowsData = data || [];
      }

      // Subcontractor estimates: same deduplicated pattern
      let subEstimatesData: any[] = [];
      if (quoteId) {
        const [forQuote, forJob] = await Promise.all([
          supabase.from('subcontractor_estimates').select('*, subcontractor_estimate_line_items(*)').eq('quote_id', quoteId).order('order_index'),
          supabase.from('subcontractor_estimates').select('*, subcontractor_estimate_line_items(*)').eq('job_id', jobId).is('quote_id', null).order('order_index'),
        ]);
        subEstimatesData = [...(forQuote.data || [])];
        if (!isolateFormalProposals) {
          const quoteSubIds = new Set((forQuote.data || []).map((r: any) => r.id));
          const jobOnlySubs = (forJob.data || []).filter((r: any) => !quoteSubIds.has(r.id));
          subEstimatesData = [...subEstimatesData, ...jobOnlySubs];
        }
        subEstimatesData.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
      } else {
        const { data } = await supabase.from('subcontractor_estimates').select('*, subcontractor_estimate_line_items(*)').eq('job_id', jobId).order('order_index');
        subEstimatesData = data || [];
      }

      const TAX_RATE = 0.07;

      // Optional sheet IDs â€” exclude from proposal totals (match JobFinancials)
      const isSheetOptional = (s: any) => s.is_option === true || s.is_option === 'true' || s.is_option === 1;
      const optionalSheetIds = new Set(
        (materialSheets || []).filter((s: any) => isSheetOptional(s)).map((s: any) => s.id)
      );

      // Optional categories: from material_category_options and/or infer from items (match JobFinancials)
      const proposalSheetIds = [
        ...(materialSheets || []),
        ...(changeOrderSheets || []),
      ]
        .map((s: any) => s.id)
        .filter(Boolean);
      const categoryOptionalMap = new Map<string, boolean>();
      if (proposalSheetIds.length > 0) {
        const { data: categoryOptions } = await supabase
          .from('material_category_options')
          .select('sheet_id, category_name, is_optional')
          .in('sheet_id', proposalSheetIds);
        (categoryOptions || []).forEach((r: any) => {
          categoryOptionalMap.set(`${r.sheet_id}_${r.category_name}`, !!r.is_optional);
        });
        // Fallback: if no category options (e.g. RLS), treat category as optional when every item has is_optional
        const inferOptionalCategories = (sheets: any[]) => {
          (sheets || []).forEach((sheet: any) => {
            const byCategory = new Map<string, any[]>();
            (sheet.items || []).forEach((item: any) => {
              const cat = item.category || 'Uncategorized';
              if (!byCategory.has(cat)) byCategory.set(cat, []);
              byCategory.get(cat)!.push(item);
            });
            byCategory.forEach((items, catName) => {
              const key = `${sheet.id}_${catName}`;
              if (categoryOptionalMap.has(key)) return;
              const allOptional = items.length > 0 && items.every((i: any) => i.is_optional === true || i.is_optional === 'true');
              if (allOptional) categoryOptionalMap.set(key, true);
            });
          });
        };
        inferOptionalCategories(materialSheets || []);
        inferOptionalCategories(changeOrderSheets || []);
      }

      /** For customer portal: per-category "optional add-on" flags (matches JobFinancials / totals). */
      const attachPortalCategoryOptional = (sheets: any[]) => {
        (sheets || []).forEach((sheet: any) => {
          const byCategory = new Map<string, any[]>();
          (sheet.items || []).forEach((item: any) => {
            const cat = item.category || 'Uncategorized';
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat)!.push(item);
          });
          const flags: Record<string, boolean> = {};
          byCategory.forEach((_, catName) => {
            flags[catName] = categoryOptionalMap.get(`${sheet.id}_${catName}`) === true;
          });
          (sheet as any)._portalCategoryOptional = flags;
        });
      };
      attachPortalCategoryOptional(materialSheets || []);
      attachPortalCategoryOptional(changeOrderSheets || []);

      // Helper: compute row materials + labor (with line item markups) and add linked subs (est.row_id === row.id)
      const rowTotalsWithLinkedSubs = (row: any, subs: any[]) => {
        const lineItems: any[] = row.custom_financial_row_items || [];
        const rowMarkup = 1 + (Number(row.markup_percent) || 0) / 100;
        let rowMat = 0;
        let rowLab = 0;
        let rowMatTaxable = 0;
        if (lineItems.length > 0) {
          const matItems = lineItems.filter((li: any) => (li.item_type || 'material') === 'material');
          const labItems = lineItems.filter((li: any) => (li.item_type || 'material') === 'labor');
          rowMat = matItems.reduce((s: number, i: any) => s + (Number(i.total_cost) || 0), 0);
          rowMatTaxable = matItems.filter((i: any) => i.taxable).reduce((s: number, i: any) => s + (Number(i.total_cost) || 0), 0);
          rowLab = labItems.reduce((s: number, i: any) => s + (Number(i.total_cost) || 0) * (1 + ((i.markup_percent ?? 0) / 100)), 0);
        } else {
          rowMat = row.category === 'labor' ? 0 : (Number(row.total_cost) || 0);
          rowMatTaxable = row.taxable ? rowMat : 0;
          rowLab = row.category === 'labor' ? (Number(row.total_cost) || 0) : 0;
        }
        const linkedSubs = subs.filter((e: any) => e.row_id === row.id);
        linkedSubs.forEach((sub: any) => {
          const items = sub.subcontractor_estimate_line_items || [];
          const sm = items.filter((i: any) => !i.excluded && (i.item_type || 'material') === 'material').reduce((s: number, i: any) => s + (Number(i.total_price) || 0), 0);
          const smTax = items.filter((i: any) => !i.excluded && (i.item_type || 'material') === 'material' && i.taxable).reduce((s: number, i: any) => s + (Number(i.total_price) || 0), 0);
          const sl = items.filter((i: any) => !i.excluded && (i.item_type || 'material') === 'labor').reduce((s: number, i: any) => s + (Number(i.total_price) || 0), 0);
          const m = 1 + (Number(sub.markup_percent) || 0) / 100;
          rowMat += sm * m;
          rowMatTaxable += smTax * m;
          rowLab += sl * m;
        });
        return { materials: rowMat * rowMarkup, labor: rowLab * rowMarkup, materialsTaxable: rowMatTaxable * rowMarkup };
      };

      // Materials: use extended_price (selling price override) per category; fall back to extended_cost Ã— markup.
      // Include linked custom rows and sheet-level subcontractors in each sheet total (match JobFinancials).
      let sheetMaterialsTotal = 0;
      let sheetLaborTotal = 0;
      let sheetMaterialsTaxableOnly = 0;
      (materialSheets || []).forEach((sheet: any) => {
        const isOptional = isSheetOptional(sheet);
        const isChangeOrder = sheet.sheet_type === 'change_order';
        const catMarkups: Record<string, number> = sheet.categoryMarkups || {};
        const byCategory = new Map<string, any[]>();
        (sheet.items || []).forEach((item: any) => {
          const cat = item.category || 'Uncategorized';
          if (!byCategory.has(cat)) byCategory.set(cat, []);
          byCategory.get(cat)!.push(item);
        });
        let sheetCatPrice = 0;
        // Match JobFinancials itemEffectivePrice: extended_price or quantity*price_per_unit only (no cost*markup fallback)
        const itemEffectivePrice = (i: any) =>
          (i.extended_price != null && i.extended_price !== '') ? Number(i.extended_price) : (Number(i.quantity) || 0) * (Number(i.price_per_unit) || 0);
        const isItemOptional = (i: any) => i.is_optional === true || i.is_optional === 'true' || i.is_optional === 1;
        byCategory.forEach((catItems, catName) => {
          const isCategoryOptional = categoryOptionalMap.get(`${sheet.id}_${catName}`) === true;
          if (isCategoryOptional) return; // exclude optional categories from proposal total (match JobFinancials)
          const categoryTotal = catItems
            .filter((i: any) => !isItemOptional(i))
            .reduce((s: number, i: any) => s + itemEffectivePrice(i), 0);
          sheetCatPrice += categoryTotal;
        });
        const sheetDirectLabor = sheet.laborTotal ?? 0;
        let sheetLinkedLabor = 0;
        let sheetLinkedMaterials = 0;
        (sheet.sheetLinkedItems || []).forEach((item: any) => {
          const itemTotal = (Number(item.total_cost) || 0) * (1 + ((item.markup_percent ?? 0) / 100));
          if ((item.item_type || 'material') === 'labor') {
            sheetLinkedLabor += itemTotal;
          } else {
            sheetLinkedMaterials += itemTotal;
          }
        });
        // Linked custom rows (row.sheet_id === sheet.id) and their linked subs
        let linkedRowsMat = 0;
        let linkedRowsLab = 0;
        let linkedRowsMatTaxable = 0;
        (customRowsData || []).filter((r: any) => r.sheet_id === sheet.id).forEach((row: any) => {
          const t = rowTotalsWithLinkedSubs(row, subEstimatesData || []);
          linkedRowsMat += t.materials;
          linkedRowsLab += t.labor;
          linkedRowsMatTaxable += t.materialsTaxable;
        });
        // Sheet-level linked subcontractors (est.sheet_id === sheet.id, no row_id)
        let linkedSubsMat = 0;
        let linkedSubsLab = 0;
        let linkedSubsMatTaxable = 0;
        (subEstimatesData || []).filter((e: any) => e.sheet_id === sheet.id && !e.row_id).forEach((est: any) => {
          const items = est.subcontractor_estimate_line_items || [];
          const m = 1 + (Number(est.markup_percent) || 0) / 100;
          const mat = items.filter((i: any) => !i.excluded && (i.item_type || 'material') === 'material').reduce((s: number, i: any) => s + (Number(i.total_price) || 0), 0);
          const matTax = items.filter((i: any) => !i.excluded && (i.item_type || 'material') === 'material' && i.taxable).reduce((s: number, i: any) => s + (Number(i.total_price) || 0), 0);
          const lab = items.filter((i: any) => !i.excluded && (i.item_type || 'material') === 'labor').reduce((s: number, i: any) => s + (Number(i.total_price) || 0), 0);
          linkedSubsMat += mat * m;
          linkedSubsMatTaxable += matTax * m;
          linkedSubsLab += lab * m;
        });
        const sheetMaterialsPart = sheetCatPrice + sheetLinkedMaterials + linkedRowsMat + linkedSubsMat;
        const sheetLaborPart = sheetDirectLabor + sheetLinkedLabor + linkedRowsLab + linkedSubsLab;
        const sheetTotal = sheetMaterialsPart + sheetLaborPart;
        (sheet as any)._computedTotal = sheetTotal;
        (sheet as any)._computedMaterials = sheetMaterialsPart;
        (sheet as any)._computedLabor = sheetLaborPart;
        const countInProposalTotals = (!isChangeOrder || forChangeOrderDocument) && !isOptional;
        if (countInProposalTotals) {
          sheetMaterialsTotal += sheetCatPrice + linkedRowsMat + linkedSubsMat;
          sheetLaborTotal += sheetDirectLabor + sheetLinkedLabor + linkedRowsLab + linkedSubsLab;
          // All sheet category materials taxable by default (match JobFinancials)
          sheetMaterialsTaxableOnly += sheetCatPrice + linkedRowsMatTaxable + linkedSubsMatTaxable;
        }
      });

      // Custom rows â€” only standalone (no sheet_id). Include linked subs. Store per-row _computedTotal.
      const standaloneCustomRows = (customRowsData || []).filter((r: any) => !r.sheet_id);
      let customMaterialsTotal = 0;
      let customLaborTotal = 0;
      let customMaterialsTaxableOnly = 0;
      standaloneCustomRows.forEach((row: any) => {
        const t = rowTotalsWithLinkedSubs(row, subEstimatesData || []);
        customMaterialsTotal += t.materials;
        customLaborTotal += t.labor;
        customMaterialsTaxableOnly += t.materialsTaxable;
        (row as any)._computedTotal = t.materials + t.labor;
      });

      // Subcontractors â€” only standalone (no sheet_id, no row_id). Store per-est _computedTotal.
      const standaloneSubs = (subEstimatesData || []).filter((e: any) => !e.sheet_id && !e.row_id);
      let subMaterialsTotal = 0;
      let subLaborTotalVal = 0;
      let subMaterialsTaxableOnly = 0;
      standaloneSubs.forEach((est: any) => {
        const lineItems: any[] = est.subcontractor_estimate_line_items || [];
        const markup = 1 + (Number(est.markup_percent) || 0) / 100;
        const matItems = lineItems.filter((li: any) => !li.excluded && (li.item_type || 'material') === 'material');
        const labItems = lineItems.filter((li: any) => !li.excluded && (li.item_type || 'material') === 'labor');
        const matTotal = matItems.reduce((s: number, i: any) => s + (Number(i.total_price) || 0), 0) * markup;
        const matTaxable = lineItems.filter((li: any) => !li.excluded && (li.item_type || 'material') === 'material' && li.taxable).reduce((s: number, i: any) => s + (Number(i.total_price) || 0), 0) * markup;
        const labTotal = labItems.reduce((s: number, i: any) => s + (Number(i.total_price) || 0), 0) * markup;
        subMaterialsTotal += matTotal;
        subLaborTotalVal += labTotal;
        subMaterialsTaxableOnly += matTaxable;
        (est as any)._computedTotal = matTotal + labTotal;
      });

      // Also set _computedTotal for linked rows/subs so UI can show per-row/sub totals (they're included in sheet total)
      (customRowsData || []).filter((r: any) => r.sheet_id).forEach((row: any) => {
        const t = rowTotalsWithLinkedSubs(row, subEstimatesData || []);
        (row as any)._computedTotal = t.materials + t.labor;
      });
      (subEstimatesData || []).filter((e: any) => e.sheet_id || e.row_id).forEach((est: any) => {
        const lineItems: any[] = est.subcontractor_estimate_line_items || [];
        const markup = 1 + (Number(est.markup_percent) || 0) / 100;
        const mat = lineItems.filter((li: any) => !li.excluded && (li.item_type || 'material') === 'material').reduce((s: number, i: any) => s + (Number(i.total_price) || 0), 0) * markup;
        const lab = lineItems.filter((li: any) => !li.excluded && (li.item_type || 'material') === 'labor').reduce((s: number, i: any) => s + (Number(i.total_price) || 0), 0) * markup;
        (est as any)._computedTotal = mat + lab;
      });

      const totalMaterials = sheetMaterialsTotal + customMaterialsTotal + subMaterialsTotal;
      const totalLabor = sheetLaborTotal + customLaborTotal + subLaborTotalVal;
      const computedSubtotal = totalMaterials + totalLabor;
      const materialsTaxableOnly = sheetMaterialsTaxableOnly + customMaterialsTaxableOnly + subMaterialsTaxableOnly;
      const computedTax = taxExempt ? 0 : materialsTaxableOnly * TAX_RATE;
      const computedGrandTotal = computedSubtotal + computedTax;

      // Use stored totals from quote (written by JobFinancials) so portal matches office exactly; include materials/labor for header
      const totals = storedTotals
        ? { ...storedTotals, materials: storedTotals.materials ?? totalMaterials, labor: storedTotals.labor ?? totalLabor }
        : { subtotal: computedSubtotal, tax: computedTax, grandTotal: computedGrandTotal, materials: totalMaterials, labor: totalLabor };

      return {
        materialSheets,
        changeOrderSheets,
        customRows: customRowsData,
        subcontractorEstimates: subEstimatesData,
        totals,
      };
    } catch (error) {
      console.error('Error loading proposal data:', error);
      return {
        materialSheets: [],
        changeOrderSheets: [],
        customRows: [],
        subcontractorEstimates: [],
        totals: { subtotal: 0, tax: 0, grandTotal: 0, materials: 0, labor: 0 },
      };
    }
}

export type ProposalDataBundle = Awaited<ReturnType<typeof loadProposalDataForQuote>>;