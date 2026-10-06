const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { getSheetsClient } = require('../lib/sheets');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;

async function fixOrders() {
  console.log('🔄 Connecting to Google Sheets...');
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Orders_Dispatch!A1:Z4000',
  });

  const rows = res.data.values || [];
  console.log(`📊 Total rows found: ${rows.length}`);

  let fixedCount = 0;
  const cleanedRows = [rows[0]]; // Header row preserved

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];

    // Check if this row is shifted (Col 0 to 15 are empty, but Col 16+ has Packet ID)
    if (!r[0] && !r[1] && !r[2] && r[16]) {
      const fixedRow = new Array(20).fill('');
      fixedRow[0] = r[16] || ''; // Packet ID
      fixedRow[1] = r[17] || ''; // Forward AWB
      fixedRow[2] = r[18] || ''; // Sub Order ID
      fixedRow[3] = r[19] || ''; // Customer Name
      fixedRow[4] = r[20] || ''; // SKU
      fixedRow[5] = r[21] || ''; // Product Name
      fixedRow[6] = r[22] || '1'; // Qty
      fixedRow[7] = r[23] || ''; // Invoice Amount
      fixedRow[8] = r[24] || ''; // Product Cost
      fixedRow[9] = r[25] || ''; // Packaging Cost
      fixedRow[10] = r[26] || ''; // Payment Mode
      fixedRow[11] = r[27] || ''; // Courier Partner
      fixedRow[12] = r[28] || ''; // City
      fixedRow[13] = r[29] || ''; // District
      fixedRow[14] = r[30] || ''; // State
      fixedRow[15] = r[31] || ''; // Pincode
      fixedRow[16] = r[32] || ''; // Order Date
      fixedRow[17] = 'Delivered';  // Status
      fixedRow[18] = 'Historical Cleaned';
      fixedRow[19] = new Date().toLocaleString('en-IN');

      cleanedRows.push(fixedRow);
      fixedCount++;
    } else {
      // Normal row - ensure length 20
      while (r.length < 20) r.push('');
      cleanedRows.push(r.slice(0, 20));
    }
  }

  console.log(`🔧 Fixed ${fixedCount} shifted rows. Clearing old range and updating...`);

  // Clear sheet to remove ghost trailing columns
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Orders_Dispatch!A1:Z4000',
  });

  // Write back perfectly aligned rows
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Orders_Dispatch!A1:T${cleanedRows.length}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: cleanedRows },
  });

  console.log(`🎉 SUCCESS! Cleaned and aligned ${cleanedRows.length - 1} orders perfectly into Columns A to T.`);
}

fixOrders().catch(console.error);