const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const fs = require('fs');
const { getSheetsClient } = require('../lib/sheets');

(async () => {
  const sheets = await getSheetsClient();
  const id = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;

  const rows = (await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: 'Payment_Reconciliation!A1:Z',
  })).data.values || [];

  console.log('Total rows:', rows.length);
  const widths = {};
  rows.forEach(r => { widths[r.length] = (widths[r.length] || 0) + 1; });
  console.log('Row width distribution:', widths);
  console.log('--- First 5 ---');
  rows.slice(0, 5).forEach((r, i) => console.log(`Row ${i + 1}:`, JSON.stringify(r)));
  console.log('--- Last 3 ---');
  rows.slice(-3).forEach((r, i) => console.log(`Row ${rows.length - 2 + i}:`, JSON.stringify(r)));

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const name = `backup_Payment_Reconciliation_${Date.now()}.csv`;
  fs.writeFileSync(name, csv);
  console.log('Backup saved:', name);
})().catch(e => console.error('FAILED:', e.message));