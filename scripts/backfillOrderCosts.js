require('dotenv').config();
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function formatPrivateKey(key) {
  if (!key) return '';
  let cleanKey = key.trim();
  if (cleanKey.startsWith('"') && cleanKey.endsWith('"')) {
    cleanKey = cleanKey.slice(1, -1);
  }
  return cleanKey.replace(/\\n/g, '\n');
}

function getAuth() {
  const privateKey = formatPrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

async function getSheetsClient() {
  const auth = getAuth();
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function backfillOrderCosts() {
  try {
    console.log('⏳ Step 1: Loading SKU Costing Master...');
    const sheets = await getSheetsClient();
    const skuRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'SKU_Master_Costing!A1:Z',
    });

    const skuRows = skuRes.data.values || [];
    if (skuRows.length <= 1) {
      console.log('⚠️ SKU_Master_Costing tab has no data.');
      return;
    }

    const skuHeaders = skuRows[0].map(h => String(h).trim().toLowerCase());
    const sIdx = skuHeaders.findIndex(h => h.includes('sku'));
    const pCostIdx = skuHeaders.findIndex(h => h.includes('purchase') || h.includes('product cost') || h.includes('cost price'));
    const pkgCostIdx = skuHeaders.findIndex(h => h.includes('pack') || h.includes('packaging'));

    const costMap = {};
    for (let i = 1; i < skuRows.length; i++) {
      const row = skuRows[i];
      const sku = row[sIdx] ? String(row[sIdx]).trim().toUpperCase() : '';
      if (!sku) continue;

      const pCost = parseFloat(String(row[pCostIdx] || 0).replace(/[^0-9.]/g, '')) || 0;
      const pkgCost = parseFloat(String(row[pkgCostIdx] || 0).replace(/[^0-9.]/g, '')) || 0;
      costMap[sku] = { pCost, pkgCost };
    }

    console.log(`✅ Loaded costing for ${Object.keys(costMap).length} SKUs.`);

    console.log('⏳ Step 2: Fetching Orders_Dispatch rows...');
    const ordersRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Orders_Dispatch!A1:Z',
    });

    const orderRows = ordersRes.data.values || [];
    if (orderRows.length <= 1) {
      console.log('⚠️ Orders_Dispatch has no orders.');
      return;
    }

    const orderHeaders = orderRows[0].map(h => String(h).trim().toLowerCase());
    const oSkuIdx = orderHeaders.findIndex(h => h.includes('sku'));
    const oProductCostIdx = orderHeaders.findIndex(h => h.includes('product cost') || h.includes('item cost'));
    const oPackagingCostIdx = orderHeaders.findIndex(h => h.includes('packaging cost') || h.includes('package cost'));

    if (oSkuIdx === -1 || oProductCostIdx === -1) {
      console.error('❌ Could not find SKU or Product Cost column in Orders_Dispatch!');
      return;
    }

    const updates = [];
    let updatedRows = 0;

    for (let i = 1; i < orderRows.length; i++) {
      const row = orderRows[i];
      const sku = row[oSkuIdx] ? String(row[oSkuIdx]).trim().toUpperCase() : '';
      if (!sku || !costMap[sku]) continue;

      const currentProdCost = parseFloat(String(row[oProductCostIdx] || 0).replace(/[^0-9.]/g, '')) || 0;
      
      if (currentProdCost === 0) {
        const { pCost, pkgCost } = costMap[sku];
        
        updates.push({
          range: `Orders_Dispatch!${String.fromCharCode(65 + oProductCostIdx)}${i + 1}`,
          values: [[pCost]]
        });

        if (oPackagingCostIdx !== -1) {
          updates.push({
            range: `Orders_Dispatch!${String.fromCharCode(65 + oPackagingCostIdx)}${i + 1}`,
            values: [[pkgCost]]
          });
        }

        updatedRows++;
      }
    }

    if (updates.length > 0) {
      console.log(`⏳ Backfilling costing into ${updatedRows} order rows...`);
      const chunkSize = 500;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SHEET_ID,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: chunk,
          },
        });
      }
      console.log(`🎉 Successfully backfilled costs for ${updatedRows} orders!`);
    } else {
      console.log('✅ All orders already have valid costing. No backfill needed.');
    }
  } catch (err) {
    console.error('❌ Error backfilling order costs:', err.message);
  }
}

backfillOrderCosts();