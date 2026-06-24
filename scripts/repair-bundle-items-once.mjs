import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || 'https://qlpaecryapnfqmwlqlpa.backend.onspace.ai';
const key = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjIwNzg4NjA3OTEsImlhdCI6MTc2MzUwMDc5MSwiaXNzIjoib25zcGFjZSIsInJlZiI6InFscGFlY3J5YXBuZnFtd2xxbHBhIiwicm9sZSI6ImFub24ifQ.YC0ydR10QuQfR_3oOYBa4mIEKf7ugoghPWbwavPL5E8';
const sb = createClient(url, key);

async function remapForQuote(jobId, quoteId) {
  const { data: wbs } = await sb
    .from('material_workbooks')
    .select('id,status,version_number')
    .eq('job_id', jobId)
    .eq('quote_id', quoteId);
  const locked = (wbs || [])
    .filter((w) => w.status === 'locked')
    .sort((a, b) => (b.version_number || 0) - (a.version_number || 0))[0];
  const working = (wbs || [])
    .filter((w) => w.status === 'working')
    .sort((a, b) => (b.version_number || 0) - (a.version_number || 0))[0];
  if (!locked || !working) return 0;

  const [{ data: lockedSheets }, { data: workingSheets }] = await Promise.all([
    sb.from('material_sheets').select('id,sheet_name,order_index,sheet_type').eq('workbook_id', locked.id).order('order_index'),
    sb.from('material_sheets').select('id,sheet_name,order_index,sheet_type').eq('workbook_id', working.id).order('order_index'),
  ]);

  const workingSheetByKey = new Map(
    (workingSheets || []).map((s) => [`${s.sheet_name}|${s.order_index ?? 0}|${s.sheet_type ?? 'proposal'}`, s.id]),
  );
  const itemIdMap = {};

  for (const ls of lockedSheets || []) {
    const wsId = workingSheetByKey.get(`${ls.sheet_name}|${ls.order_index ?? 0}|${ls.sheet_type ?? 'proposal'}`);
    if (!wsId) continue;
    const [{ data: oldItems }, { data: newItems }] = await Promise.all([
      sb.from('material_items').select('id,material_name,sku,quantity,order_index').eq('sheet_id', ls.id).order('order_index'),
      sb.from('material_items').select('id,material_name,sku,quantity,order_index').eq('sheet_id', wsId).order('order_index'),
    ]);
    const newByKey = new Map(
      (newItems || []).map((w) => [`${w.order_index ?? 0}|${w.material_name}|${w.sku ?? ''}|${w.quantity ?? 0}`, w.id]),
    );
    for (const o of oldItems || []) {
      const nid = newByKey.get(`${o.order_index ?? 0}|${o.material_name}|${o.sku ?? ''}|${o.quantity ?? 0}`);
      if (nid && nid !== o.id) itemIdMap[o.id] = nid;
    }
  }

  const entries = Object.entries(itemIdMap);
  if (!entries.length) return 0;

  const { data: bundles } = await sb.from('material_bundles').select('id').eq('job_id', jobId);
  if (!bundles?.length) return 0;

  const { data: bundleItems } = await sb
    .from('material_bundle_items')
    .select('id,material_item_id')
    .in(
      'bundle_id',
      bundles.map((b) => b.id),
    )
    .in(
      'material_item_id',
      entries.map(([o]) => o),
    );

  let updated = 0;
  for (const row of bundleItems || []) {
    const newId = itemIdMap[row.material_item_id];
    if (!newId) continue;
    const { error } = await sb.from('material_bundle_items').update({ material_item_id: newId }).eq('id', row.id);
    if (!error) updated += 1;
  }
  return updated;
}

const { data: signedQuotes } = await sb
  .from('quotes')
  .select('id, job_id, signed_version')
  .not('signed_version', 'is', null);
const withJob = (signedQuotes || []).filter((q) => q.job_id);
let total = 0;
for (const q of withJob) {
  const n = await remapForQuote(q.job_id, q.id);
  if (n > 0) console.log('Remapped', n, 'bundle items for quote', q.id, 'job', q.job_id);
  total += n;
}
console.log('Total remapped:', total, 'across', withJob.length, 'signed quotes');
