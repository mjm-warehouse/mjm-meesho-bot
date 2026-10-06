const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const fs = require('fs');
const { getSheetsClient } = require('../lib/sheets');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;

// Built-in simple CSV line parser (handles quotes and commas)
function parseCsvLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

async function runBackfill() {
  console.log('🔄 1. Loading Google Sheets Client & Master Costing Data...');
  const sheets = await getSheetsClient();

  // Load SKU Costing Master
  const costingRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'SKU_Master_Costing!A2:O65',
  });
  const costingRows = costingRes.data.values || [];
  const costingMap = new Map();
  for (const r of costingRows) {
    if (!r || !r[1]) continue;
    const skuKey = String(r[1]).trim().toLowerCase();
    costingMap.set(skuKey, {
      productCost: parseFloat(r[7]) || 0,
      packagingCost: parseFloat(r[8]) || 0,
    });
  }
  console.log(`✅ Loaded ${costingMap.size} SKUs from SKU_Master_Costing.`);

  // 2. Read Meesho CSV Files
  console.log('🔄 2. Reading Meesho CSV Order Files...');
  const targetDirs = [
    path.resolve(__dirname, '../backfillOrders.js'),
    path.resolve(__dirname, '../backfillOrders'),
    path.resolve(__dirname, '..'),
  ];

  let orderFiles = [];
  for (const dir of targetDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir)
        .filter((f) => (f.startsWith('Orders_') || f.includes('Orders')) && f.endsWith('.csv'))
        .map((f) => path.join(dir, f));
      if (files.length > 0) {
        orderFiles = files;
        break;
      }
    }
  }

  if (!orderFiles.length) {
    console.error('❌ Meesho CSV files nahi mili folder me.');
    return;
  }

  console.log(`📁 Found ${orderFiles.length} CSV file(s) to process.`);
  const meeshoMap = new Map();

  for (const filePath of orderFiles) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) continue;

    const headers = parseCsvLine(lines[0]);
    const getIdx = (keys) => headers.findIndex((h) => keys.some((k) => h.toLowerCase() === k.toLowerCase()));

    const subOrderIdx = getIdx(['Sub Order No', 'Sub Order ID', 'sub_order_id']);
    const packetIdx = getIdx(['Packet ID', 'packet_id']);
    const awbIdx = getIdx(['AWB Number', 'AWB', 'awb']);
    const skuIdx = getIdx(['SKU', 'Seller SKU', 'sku']);
    const nameIdx = getIdx(['Product Name', 'product_name']);
    const qtyIdx = getIdx(['Quantity', 'Qty', 'qty']);
    const amountIdx = getIdx(['Total Price', 'Invoice Amount', 'Customer Price']);
    const stateIdx = getIdx(['State', 'Customer State']);
    const dateIdx = getIdx(['Order Date', 'Order Created Date']);

    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      const subOrderId = subOrderIdx !== -1 ? row[subOrderIdx] || '' : '';
      const packetId = packetIdx !== -1 ? (row[packetIdx] || '').trim() : '';
      const awb = awbIdx !== -1 ? (row[awbIdx] || '').trim() : '';
      const sku = skuIdx !== -1 ? (row[skuIdx] || '').trim() : '';
      const productName = nameIdx !== -1 ? row[nameIdx] || '' : '';
      const qty = qtyIdx !== -1 ? row[qtyIdx] || '1' : '1';
      const invoiceAmount = amountIdx !== -1 ? row[amountIdx] || '' : '';
      const state = stateIdx !== -1 ? row[stateIdx] || '' : '';
      const orderDate = dateIdx !== -1 ? row[dateIdx] || '' : '';

      const dataObj = {
        subOrderId,
        packetId,
        awb,
        sku,
        productName,
        qty,
        invoiceAmount,
        state,
        orderDate,
      };

      if (packetId) meeshoMap.set(packetId, dataObj);
      if (awb) meeshoMap.set(awb, dataObj);
    }
  }
  console.log(`✅ Loaded ${meeshoMap.size} order mappings from Meesho files.`);

  // 3. Read Orders_Dispatch from Google Sheets
  console.log('🔄 3. Fetching Orders_Dispatch from Google Sheet...');
  const dispatchRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Orders_Dispatch!A1:T2000',
  });

  const rows = dispatchRes.data.values || [];
  if (rows.length <= 1) {
    console.error('❌ Orders_Dispatch me koi data nahi mila.');
    return;
  }

  let updatedCount = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    while (row.length < 20) row.push('');

    const packetId = (row[0] || '').trim();
    const awb = (row[1] || '').trim();

    const meeshoData = meeshoMap.get(packetId) || meeshoMap.get(awb);
    if (!meeshoData) continue;

    // Col C (index 2): Sub Order ID
    if (!row[2] && meeshoData.subOrderId) row[2] = meeshoData.subOrderId;

    // Col E (index 4): SKU
    if (!row[4] && meeshoData.sku) row[4] = meeshoData.sku;

    // Col F (index 5): Product Name
    if (!row[5] && meeshoData.productName) row[5] = meeshoData.productName;

    // Col G (index 6): Qty
    if (!row[6] && meeshoData.qty) row[6] = meeshoData.qty;

    // Col H (index 7): Invoice Amount
    if (!row[7] && meeshoData.invoiceAmount) row[7] = meeshoData.invoiceAmount;

    // Col O (index 14): State
    if (!row[14] && meeshoData.state) row[14] = meeshoData.state;

    // Col Q (index 16): Order Date
    if (!row[16] && meeshoData.orderDate) row[16] = meeshoData.orderDate;

    // Col I (index 8) & Col J (index 9): Product & Packaging Cost
    const matchedSku = (row[4] || meeshoData.sku || '').trim().toLowerCase();
    const cost = costingMap.get(matchedSku);
    if (cost) {
      if (!row[8] || Number(row[8]) === 0) row[8] = cost.productCost;
      if (!row[9] || Number(row[9]) === 0) row[9] = cost.packagingCost;
    }

    updatedCount++;
  }

  // 4. Update back to Google Sheets
  console.log(`🔄 4. Updating ${updatedCount} orders back to Google Sheets...`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Orders_Dispatch!A1:T${rows.length}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  console.log(`🎉 100% SUCCESS! Successfully backfilled and cost-linked ${updatedCount} orders in Google Sheets.`);
}

runBackfill().catch(console.error);