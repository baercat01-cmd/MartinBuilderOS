const url = 'https://qlpaecryapnfqmwlqlpa.backend.onspace.ai';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjIwNzg4NjA3OTEsImlhdCI6MTc2MzUwMDc5MSwiaXNzIjoib25zcGFjZSIsInJlZiI6InFscGFlY3J5YXBuZnFtd2xxbHBhIiwicm9sZSI6ImFub24ifQ.YC0ydR10QuQfR_3oOYBa4mIEKf7ugoghPWbwavPL5E8';
const P1 = '264a2b44-8547-4b7c-aa27-1dc4c0e90835';
const P2 = 'cd5cf6e3-cc34-40a2-8673-98c3ab31b72c';

async function q(path) {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 200) }; }
}

function laborSum(items) {
  return (items || [])
    .filter((i) => i.item_type === 'labor')
    .reduce((s, i) => s + Number(i.total_cost || 0), 0);
}

async function probeQuote(quoteId) {
  const wbs = await q(`material_workbooks?quote_id=eq.${quoteId}&select=id,status,version_number`);
  const wbIds = wbs.map((w) => w.id);
  const sheets = wbIds.length
    ? await q(`material_sheets?workbook_id=in.(${wbIds.join(',')})&select=id,sheet_name,workbook_id,order_index`)
    : [];
  const sheetIds = sheets.map((s) => s.id);
  const items = sheetIds.length
    ? await q(
        `custom_financial_row_items?sheet_id=in.(${sheetIds.join(',')})&row_id=is.null&select=id,sheet_id,item_type,total_cost,description`,
      )
    : [];
  const join = sheetIds.length
    ? await q(`material_sheets?select=id,material_workbooks!inner(quote_id)&id=in.(${sheetIds.join(',')})`)
    : [];
  const hasLocked = wbs.some((w) => w.status === 'locked');
  const hasWorking = wbs.some((w) => w.status === 'working');
  let primaryWbId = '';
  if (hasLocked && hasWorking) {
    primaryWbId = wbs.filter((w) => w.status === 'locked').sort((a, b) => (b.version_number || 0) - (a.version_number || 0))[0]?.id ?? '';
  } else if (hasWorking) {
    primaryWbId = wbs.filter((w) => w.status === 'working').sort((a, b) => (b.version_number || 0) - (a.version_number || 0))[0]?.id ?? '';
  } else {
    primaryWbId = wbs.filter((w) => w.status === 'locked').sort((a, b) => (b.version_number || 0) - (a.version_number || 0))[0]?.id ?? wbs[0]?.id ?? '';
  }
  const displayed = sheets.filter((s) => s.workbook_id === primaryWbId);
  return {
    quoteId,
    wbs,
    primaryWbId,
    displayedSheets: displayed.map((s) => ({ id: s.id, name: s.sheet_name })),
    itemCount: items.length,
    laborTotal: laborSum(items),
    joinRowCount: join.length,
    laborBySheet: Object.fromEntries(
      displayed.map((s) => [s.sheet_name, laborSum(items.filter((i) => i.sheet_id === s.id))]),
    ),
  };
}

const p1 = await probeQuote(P1);
const p2 = await probeQuote(P2);
console.log(JSON.stringify({ p1, p2 }, null, 2));
