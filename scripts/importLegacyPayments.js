const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const XLSX = require('xlsx');
const fs = require('fs');
const { getSheetsClient } = require('../lib/sheets');

const TAB = 'Payment_Reconciliation';
const BACKUP = 'backup_Payment_Reconciliation_1791268890371.csv';
const HEADERS = ['Payment Date', 'Sub Order ID', 'Status', 'Customer Price',
  'Commission', 'Ads', 'Net Settlement', 'Bank Status', 'Remarks'];
const APPLY = process.argv.includes('--apply');
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const r2 = n => Math.round(n * 100) / 100;

(async () => {
  const wb = XLSX.read(fs.readFileSync(BACKUP, 'utf8'), { type: 'string', raw: true });
  const all = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  const legacy = all.filter(r => r[7] === 'Reconciled' && String(r[1]).trim() && r.length >= 9 && r[14] !== 'Order Summary Backfill');

  const seen = new Set(); const dupes = [];
  const rows = [];
  for (const r of legacy) {
    const sid = String(r[1]).trim();
    if (seen.has(sid)) { dupes.push(sid); continue; }
    seen.add(sid);
    rows.push([String(r[0]), sid, '', '', '', '', num(r[4]), 'SETTLED',
      `legacy-recovered from col E (UNVERIFIED) | orig: ${r[8]}`]);
  }

  const sheets = await getSheetsClient();
  const id = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;
  const cur = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${TAB}!A1:I` })).data.values || [];
  if (!cur.length || cur[0].join('|') !== HEADERS.join('|'))
    throw new Error('Header missing/wrong. Run applyPayments.js --apply --drop-legacy first.');
  const existing = new Set(cur.slice(1).map(r => String(r[1]).trim()));
  const toAdd = rows.filter(r => !existing.has(r[1]));

  const curSettled = cur.slice(1).filter(r => r[7] === 'SETTLED').reduce((s, r) => s + num(r[6]), 0);
  const addSum = toAdd.reduce((s, r) => s + r[6], 0);
  console.log('Legacy rows in backup:', legacy.length, '| unique:', rows.length, '| dupes:', dupes.length);
  console.log('Already in sheet (skipped):', rows.length - toAdd.length, '| To add:', toAdd.length);
  console.log('Sum to add:', r2(addSum), '(expected 55878)');
  console.log('Negative/zero amounts:', toAdd.filter(r => r[6] <= 0).length);
  console.log('Sheet SETTLED now:', r2(curSettled), '| after import:', r2(curSettled + addSum));
  console.log('Portal target 254607 | remaining gap:', r2(254607 - curSettled - addSum));
  if (!APPLY) { console.log('\nDRY-RUN only.'); return; }

  await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${TAB}!A1`,
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: toAdd } });
  console.log('APPLIED. Appended:', toAdd.length);
})().catch(e => console.error('FAILED:', e.message));