const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { getSheetsClient } = require('../lib/sheets');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;
const TABS = ['Orders_Dispatch', 'Payment_Reconciliation'];

(async () => {
  const sheets = await getSheetsClient();

  for (const tab of TABS) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab}!A1:Z6`,
    });
    const rows = res.data.values || [];
    console.log(`\n===== ${tab} =====`);
    if (!rows.length) {
      console.log('EMPTY TAB');
      continue;
    }
    console.log('Header count:', rows[0].length);
    rows[0].forEach((h, i) => console.log(`  [${i}] ${JSON.stringify(h)}`));
    console.log('--- First 5 data rows ---');
    rows.slice(1).forEach((r, i) => console.log(`Row ${i + 2}:`, JSON.stringify(r)));

    const meta = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab}!A:A`,
    });
    console.log('Total rows (incl. header):', (meta.data.values || []).length);
  }

  // Status distribution (Orders_Dispatch, column R = Status)
  const st = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Orders_Dispatch!R2:R',
  });
  const counts = {};
  (st.data.values || []).forEach(([v]) => {
    const k = (v || '').trim() || '(blank)';
    counts[k] = (counts[k] || 0) + 1;
  });
  console.log('\n===== Orders_Dispatch Status counts =====');
  console.log(counts);
})().catch((e) => console.error('AUDIT FAILED:', e.message));