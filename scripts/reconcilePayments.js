const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const XLSX = require('xlsx');
const fs = require('fs');
const { getSheetsClient } = require('../lib/sheets');

const TAB = 'Payment_Reconciliation';
const HEADERS = ['Payment Date', 'Sub Order ID', 'Status', 'Customer Price',
  'Commission', 'Ads', 'Net Settlement', 'Bank Status', 'Remarks'];
const APPLY = process.argv.includes('--apply');
const EXPECTED_JUNE_JULY = 112195.24;

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

function loadFile(file) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  return rows.map(r => {
    const bank = String(r['Payout Status']).trim().toUpperCase() || 'NOT_SETTLED';
    const claim = String(r['Claim Status']).trim();
    return [
      '',                                   // Payment Date
      String(r['Sub orderId']).trim(),
      String(r['Order Status']).trim(),
      num(r['Price']),
      '', '',                               // Commission, Ads
      num(r['Payout Value']),
      bank,
      `src:${file}${claim ? ' | claim:' + claim : ''}`,
    ];
  });
}

(async () => {
  const files = fs.readdirSync('.').filter(f => /order_summary.*\.xlsx$/i.test(f)).sort();
  console.log('Source files:', files);

  const byId = new Map(); const dupes = [];
  for (const f of files) for (const row of loadFile(f)) {
    if (!row[1]) continue;
    if (byId.has(row[1])) dupes.push(row[1]);
    byId.set(row[1], row);
  }
  const rows = [...byId.values()];

  const settled = rows.filter(r => r[7] === 'SETTLED');
  const sum = a => a.reduce((s, r) => s + r[6], 0);
  const r2 = n => Math.round(n * 100) / 100;
  console.log('\n===== DRY-RUN SUMMARY =====');
  console.log('Unique Sub Order IDs :', rows.length, '| duplicates across files:', dupes.length);
  console.log('SETTLED orders       :', settled.length);
  console.log('SETTLED net sum      :', r2(sum(settled)));
  console.log('  of which positive  :', r2(sum(settled.filter(r => r[6] > 0))));
  console.log('  of which negative  :', r2(sum(settled.filter(r => r[6] < 0))));
  console.log('NOT_SETTLED orders   :', rows.length - settled.length, '| net sum:', r2(sum(rows.filter(r => r[7] !== 'SETTLED'))));
  console.log('Expected (Jun+Jul)   :', EXPECTED_JUNE_JULY, '| diff:', r2(sum(settled) - EXPECTED_JUNE_JULY));
  const byStatus = {};
  rows.forEach(r => { byStatus[r[2]] = (byStatus[r[2]] || 0) + 1; });
  console.log('Order Status counts  :', byStatus);

  const sheets = await getSheetsClient();
  const id = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;
  const cur = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${TAB}!A1:I` })).data.values || [];
  const hasHeader = cur.length && cur[0].join('|') === HEADERS.join('|');
  const existing = new Map();
  cur.slice(hasHeader ? 1 : 0).forEach((r, i) => existing.set(r[1], i + (hasHeader ? 2 : 1)));
  const updates = rows.filter(r => existing.has(r[1]));
  const inserts = rows.filter(r => !existing.has(r[1]));
  console.log('\nSheet currently has header:', !!hasHeader, '| existing rows:', existing.size);
  console.log('Would UPDATE:', updates.length, '| Would INSERT:', inserts.length);

  const csv = [HEADERS, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  fs.writeFileSync('payment_reconciliation_preview.csv', csv);
  console.log('Preview written: payment_reconciliation_preview.csv');

  if (!APPLY) { console.log('\nDRY-RUN only. Nothing written. Use --apply after approval.'); return; }

  if (!hasHeader) {
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${TAB}!A1:I1`,
      valueInputOption: 'RAW', requestBody: { values: [HEADERS] } });
  }
  if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id,
    requestBody: { valueInputOption: 'RAW',
      data: updates.map(r => ({ range: `${TAB}!A${existing.get(r[1])}:I${existing.get(r[1])}`, values: [r] })) } });
  if (inserts.length) await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${TAB}!A1`,
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: inserts } });
  console.log('APPLIED. Updated:', updates.length, '| Inserted:', inserts.length);
})().catch(e => console.error('FAILED:', e.message));