const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const fs = require('fs');
const xlsx = require('xlsx');
const { getSheetsClient } = require('../lib/sheets');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;

async function syncSummary() {
  console.log('🔄 1. Reading Excel Summary Files...');
  const projectDir = path.resolve(__dirname, '..');
  const files = fs.readdirSync(projectDir)
    .filter(f => f.startsWith('4276384_order_summary') && f.endsWith('.xlsx'))
    .map(f => path.join(projectDir, f));

  if (!files.length) {
    console.error('❌ Koi summary file nahi mili project root me.');
    return;
  }

  console.log(`📁 Found ${files.length} summary files.`);
  const statusMap = new Map();
  const paymentRows = [];

  for (const f of files) {
    const wb = xlsx.readFile(f);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);

    for (const r of data) {
      const subOrderId = String(r['Sub orderId'] || '').trim();
      const status = String(r['Order Status'] || '').trim();
      const payoutVal = parseFloat(r['Payout Value']) || 0;
      const payoutStatus = String(r['Payout Status'] || '').trim();
      const orderDate = String(r['Order Date'] || '').trim();

      if (subOrderId) {
        statusMap.set(subOrderId, { status, payoutVal, payoutStatus, orderDate });

        // If settled payout exists, prepare payment row
        if (payoutStatus.toUpperCase() === 'SETTLED' && payoutVal !== 0) {
          paymentRows.push([
            orderDate,
            subOrderId,
            status,
            r['Price'] || '',
            '0',
            '',
            payoutVal,
            'Settled',
            'Order Summary Backfill'
          ]);
        }
      }
    }
  }

  console.log(`✅ Loaded ${statusMap.size} order status records from Excel.`);

  // 2. Update Orders_Dispatch Sheet
  console.log('🔄 2. Updating Orders_Dispatch in Google Sheets...');
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Orders_Dispatch!A1:T4000',
  });

  const rows = res.data.values || [];
  let updatedStatusCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const subOrderId = (row[2] || '').trim();
    const info = statusMap.get(subOrderId);
    if (info) {
      row[17] = info.status; // Col R: Status (Delivered, RTO, Returned, Cancelled)
      // If Cancelled or RTO, set product cost to 0 for P&L expense deduction
      if (info.status === 'Cancelled' || info.status === 'RTO') {
        row[8] = '0'; // Product is retained in inventory
        row[9] = '0';
      }
      updatedStatusCount++;
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Orders_Dispatch!A1:T${rows.length}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
  console.log(`✅ Updated status & cost adjustments for ${updatedStatusCount} orders in Orders_Dispatch.`);

  // 3. Append missing payments to Payment_Reconciliation
  if (paymentRows.length > 0) {
    console.log(`🔄 3. Appending ${paymentRows.length} settled payouts to Payment_Reconciliation...`);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Payment_Reconciliation!A:I',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: paymentRows },
    });
    console.log('🎉 SUCCESS! Both status and settlements are fully synced.');
  }
}

syncSummary().catch(console.error);