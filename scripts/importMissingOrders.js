const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const fs = require('fs');
const { getSheetsClient } = require('../lib/sheets');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;

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

async function runImport() {
  console.log('🔄 1. Connecting to Google Sheets & SKU Master...');
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
  console.log(`✅ Loaded ${costingMap.size} SKUs from SKU Master.`);

  // Load existing orders to avoid any duplicates
  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Orders_Dispatch!A:C',
  });
  const existingRows = existingRes.data.values || [];
  const existingKeys = new Set();
  for (const r of existingRows.slice(1)) {
    if (r[0]) existingKeys.add(r[0].trim()); // Packet ID
    if (r[1]) existingKeys.add(r[1].trim()); // AWB
    if (r[2]) existingKeys.add(r[2].trim()); // Sub Order ID
  }
  console.log(`📦 Found ${existingRows.length - 1} existing orders in Orders_Dispatch.`);

  // 2. Read Meesho Order CSV files
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

  const newRows = [];
  const addedKeys = new Set();

  for (const filePath of orderFiles) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) continue;

    const headers = parseCsvLine(lines[0]);
    const getIdx = (keys) => headers.findIndex((h) => keys.some((k) => h.toLowerCase() === k.toLowerCase()));

    const subOrderIdx = getIdx(['Sub Order No', 'Sub Order ID', 'sub_order_id']);
    const packetIdx = getIdx(['Packet ID', 'packet_id']);
    const awbIdx = getIdx(['AWB Number', 'AWB', 'awb']);
    const custIdx = getIdx(['Customer Name', 'customer_name']);
    const skuIdx = getIdx(['SKU', 'Seller SKU', 'sku']);
    const nameIdx = getIdx(['Product Name', 'product_name']);
    const qtyIdx = getIdx(['Quantity', 'Qty', 'qty']);
    const amountIdx = getIdx(['Total Price', 'Invoice Amount', 'Customer Price']);
    const payModeIdx = getIdx(['Payment Mode', 'payment_mode']);
    const courierIdx = getIdx(['Courier Partner', 'courier_partner']);
    const cityIdx = getIdx(['City', 'Customer City']);
    const stateIdx = getIdx(['State', 'Customer State']);
    const pinIdx = getIdx(['Pincode', 'Customer Pincode']);
    const dateIdx = getIdx(['Order Date', 'Order Created Date']);

    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      const subOrderId = subOrderIdx !== -1 ? (row[subOrderIdx] || '').trim() : '';
      const packetId = packetIdx !== -1 ? (row[packetIdx] || '').trim() : '';
      const awb = awbIdx !== -1 ? (row[awbIdx] || '').trim() : '';

      // Skip if already in Google Sheet or already processed
      if ((packetId && existingKeys.has(packetId)) ||
          (awb && existingKeys.has(awb)) ||
          (subOrderId && existingKeys.has(subOrderId)) ||
          (subOrderId && addedKeys.has(subOrderId))) {
        continue;
      }

      if (subOrderId) addedKeys.add(subOrderId);
      if (packetId) existingKeys.add(packetId);
      if (awb) existingKeys.add(awb);

      const sku = skuIdx !== -1 ? (row[skuIdx] || '').trim() : '';
      const matchedCost = costingMap.get(sku.toLowerCase());

      const productCost = matchedCost ? matchedCost.productCost : '';
      const packagingCost = matchedCost ? matchedCost.packagingCost : '';

      newRows.push([
        packetId,                                           // A: Packet ID
        awb,                                                // B: Forward AWB
        subOrderId,                                         // C: Sub Order ID
        custIdx !== -1 ? row[custIdx] || '' : '',          // D: Customer Name
        sku,                                                // E: SKU
        nameIdx !== -1 ? row[nameIdx] || '' : '',          // F: Product Name
        qtyIdx !== -1 ? row[qtyIdx] || '1' : '1',          // G: Qty
        amountIdx !== -1 ? row[amountIdx] || '' : '',      // H: Invoice Amount
        productCost,                                        // I: Product Cost
        packagingCost,                                      // J: Packaging Cost
        payModeIdx !== -1 ? row[payModeIdx] || '' : '',    // K: Payment Mode
        courierIdx !== -1 ? row[courierIdx] || '' : '',    // L: Courier Partner
        cityIdx !== -1 ? row[cityIdx] || '' : '',          // M: City
        '',                                                 // N: District
        stateIdx !== -1 ? row[stateIdx] || '' : '',        // O: State
        pinIdx !== -1 ? row[pinIdx] || '' : '',            // P: Pincode
        dateIdx !== -1 ? row[dateIdx] || '' : '',          // Q: Order Date
        'Delivered',                                        // R: Status
        'Meesho Historical Import',                         // S: Action Handler
        new Date().toLocaleString('en-IN'),                 // T: Last Updated
      ]);
    }
  }

  console.log(`📊 Found ${newRows.length} missing orders to import.`);

  if (newRows.length === 0) {
    console.log('✅ Sabhi orders pehle se hi Google Sheet me maujood hain.');
    return;
  }

  console.log('🔄 Appending missing orders with SKU & Costing to Orders_Dispatch...');
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Orders_Dispatch!A:T',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: newRows },
  });

  console.log(`🎉 100% SUCCESS! Successfully added ${newRows.length} missing orders with exact SKU & Costing.`);
}

runImport().catch(console.error);