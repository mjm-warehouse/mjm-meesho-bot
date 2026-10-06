const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const XLSX = require('xlsx');
const fs = require('fs');
const { getSheetsClient } = require('../lib/sheets');

const TAB = 'Payment_Reconciliation';
const HEADERS = ['Payment Date', 'Sub Order ID', 'Status', 'Customer Price',
  'Commission', 'Ads', 'Net Settlement', 'Bank Status', 'Remarks'];
const APPLY = process.argv.includes('--apply');
const DROP_LEGACY = process.argv.includes('--drop-legacy');
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const r2 = n => Math.round(n * 100) / 100;

function loadFile(file) {
  const wb = XLSX.readFile(file);
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).map(r => {
    const claim = String(r['Claim Status']).trim();
    return ['', String(r['Sub orderId']).trim(), String(r['Order Status']).trim(), num(r['Price']),
      '', '', num(r['Payout Value']),
      String(r['Payout Status']).trim().toUpperCase() || 'NOT_SETTLED',
      `src:${file}${claim ? ' | claim:' + claim : ''}`];
  });
}

(async () => {
  const files = fs.readdirSync('.').filter(f => /order_summary.*\.xlsx$/i.test(f)).sort();
  const byId = new Map();
  files.forEach(f => loadFile(f).forEach(r => r[1] && byId.set(r[1], r)));
  const fresh = [...byId.values()];
  const freshSettled = fresh.filter(r => r[7] === 'SETTLED').reduce((s, r) => s + r[6], 0);

  const sheets = await getSheetsClient();
  const id = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;
  const cur = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${TAB}!A1:Z` })).data.values || [];

  const backfill = cur.filter(r => r.length === 15 && r[14] === 'Order Summary Backfill');
  const legacy9 = cur.filter(r => r.length === 9 && String(r[1] || '').trim());
  const legacyKeep = DROP_LEGACY ? [] : legacy9.filter(r => !byId.has(String(r[1]).trim()));

  console.log('Fresh rows (Jun+Jul):', fresh.length, '| SETTLED sum:', r2(freshSettled));
  console.log('\nBackfill rows (15-wide):', backfill.length,
    '| their Net sum (col M):', r2(backfill.reduce((s, r) => s + num(r[12]), 0)),
    '| should equal fresh SETTLED sum');
  console.log('\nLegacy 9-wide rows:', legacy9.length, '| not in Jun/Jul set:', legacyKeep.length);
  const st = {}; legacy9.forEach(r => { st[r[2]] = (st[r[2]] || 0) + 1; });
  console.log('Legacy Status counts:', st);
  console.log('Legacy Net Settlement sum (col G):', r2(legacy9.reduce((s, r) => s + num(r[6]), 0)));
  console.log('Legacy sample:');
  legacy9.slice(0, 3).concat(legacy9.slice(-2)).forEach(r => console.log(' ', JSON.stringify(r)));
  console.log('\nWill write:', fresh.length, 'fresh +', legacyKeep.length, 'legacy carried over',
    DROP_LEGACY ? '(--drop-legacy)' : '');

  if (!APPLY) { console.log('\nDRY-RUN only. Nothing written.'); return; }

  const final = [HEADERS, ...fresh, ...legacyKeep];
  await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `${TAB}!A1:Z` });
  await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${TAB}!A1`,
    valueInputOption: 'RAW', requestBody: { values: final } });
  console.log('APPLIED. Rows written (incl. header):', final.length);

  // Verify by reading back
  const chk = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${TAB}!A1:I` })).data.values || [];
  console.log('Readback header OK:', chk[0].join('|') === HEADERS.join('|'), '| rows:', chk.length);
  const s = chk.slice(1).filter(r => r[7] === 'SETTLED' && String(r[10] || '') !== 'x')
    .reduce((a, r) => a + num(r[6]), 0);
  console.log('Readback SETTLED net sum (all rows):', r2(s));
})().catch(e => console.error('FAILED:', e.message));