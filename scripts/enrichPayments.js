const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const XLSX = require('xlsx');
const fs = require('fs');
const { getSheetsClient } = require('../lib/sheets');

const TAB = 'Payment_Reconciliation';
const BASE = ['Payment Date', 'Sub Order ID', 'Status', 'Customer Price', 'Commission', 'Ads',
  'Net Settlement', 'Bank Status', 'Remarks'];
const EXTRA = ['Order Date', 'SKU ID', 'Qty'];
const APPLY = process.argv.includes('--apply');
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const isoDate = d => typeof d === 'number'
  ? new Date((d - 25569) * 864e5).toISOString().slice(0, 10) : String(d).slice(0, 10);

(async () => {
  const files = fs.readdirSync('.').filter(f => /order_summary.*\.xlsx$/i.test(f)).sort();
  const meta = new Map();
  for (const f of files) {
    const wb = XLSX.readFile(f);
    XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).forEach(r => {
      const sid = String(r['Sub orderId']).trim();
      if (sid) meta.set(sid, { date: isoDate(r['Order Date']), sku: String(r['SKU ID']).trim(),
        qty: Math.max(1, num(r['Quantity'])), status: String(r['Order Status']).trim() });
    });
  }

  const sheets = await getSheetsClient();
  const id = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;
  const get = async range => (await sheets.spreadsheets.values.get({ spreadsheetId: id, range })).data.values || [];

  const cur = await get(`${TAB}!A1:L`);
  if (cur[0].slice(0, 9).join('|') !== BASE.join('|')) throw new Error('Base headers A:I do not match. Aborting.');

  let matched = 0, unmatched = 0;
  const out = cur.map((row, i) => {
    if (i === 0) return EXTRA;
    const m = meta.get(String(row[1] || '').trim());
    if (m) { matched++; return [m.date, m.sku, m.qty]; }
    unmatched++; return [row[9] ?? '', row[10] ?? '', row[11] ?? ''];
  });

  const skuRows = await get('SKU_Master_Costing!A1:N');
  const known = new Set(skuRows.slice(1).map(r => String(r[1]).trim()));
  const missing = {}; let costOrders = 0, coveredOrders = 0;
  for (const m of meta.values()) {
    if (!/^(delivered|exchanged)$/i.test(m.status)) continue;
    costOrders++;
    if (known.has(m.sku)) coveredOrders++; else missing[m.sku] = (missing[m.sku] || 0) + 1;
  }

  console.log('\n===== ENRICH PAYMENTS SUMMARY =====');
  console.log('Payment rows:', cur.length - 1, '| matched to Excel:', matched, '| unmatched (legacy Aug rows etc.):', unmatched);
  console.log(`Delivered/Exchanged orders needing cost: ${costOrders} | SKU found in master: ${coveredOrders}`);
  console.log('Missing SKUs (top 15):', Object.entries(missing).sort((a, b) => b[1] - a[1]).slice(0, 15));
  if (!APPLY) { console.log('\nDRY-RUN only.'); return; }

  await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${TAB}!J1:L${cur.length}`,
    valueInputOption: 'RAW', requestBody: { values: out } });
  console.log('APPLIED J1:L' + cur.length);
})().catch(e => console.error('FAILED:', e.message));