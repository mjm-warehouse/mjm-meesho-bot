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

async function seedInventoryBalance() {
  try {
    console.log('⏳ Fetching SKU_Master_Costing data...');
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'SKU_Master_Costing!A1:Z',
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) {
      console.log('⚠️ SKU_Master_Costing sheet is empty or only has headers.');
      return;
    }

    const headers = rows[0].map(h => String(h).trim().toLowerCase());
    const skuIdx = headers.findIndex(h => h.includes('sku'));
    const physicalStockIdx = headers.findIndex(h => h.includes('physical stock') || h.includes('opening stock') || h.includes('stock'));
    let currentBalanceIdx = headers.findIndex(h => h.includes('current balance') || h.includes('balance'));

    if (skuIdx === -1 || physicalStockIdx === -1) {
      console.error('❌ Required headers not found! Ensure SKU and Physical Stock exist.');
      return;
    }

    if (currentBalanceIdx === -1) {
      currentBalanceIdx = headers.length;
      console.log(`ℹ️ Adding 'Current Balance' column at index ${currentBalanceIdx}...`);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `SKU_Master_Costing!${String.fromCharCode(65 + currentBalanceIdx)}1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['Current Balance']] },
      });
    }

    const updates = [];
    let updatedCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const sku = row[skuIdx] ? String(row[skuIdx]).trim() : '';
      if (!sku) continue;

      const physicalStock = parseInt(row[physicalStockIdx], 10) || 0;
      const currentBalance = row[currentBalanceIdx] !== undefined && row[currentBalanceIdx] !== '' 
                             ? parseInt(row[currentBalanceIdx], 10) 
                             : null;

      if (currentBalance === null || isNaN(currentBalance)) {
        updates.push({
          range: `SKU_Master_Costing!${String.fromCharCode(65 + currentBalanceIdx)}${i + 1}`,
          values: [[physicalStock]]
        });
        updatedCount++;
      }
    }

    if (updates.length > 0) {
      console.log(`⏳ Seeding ${updatedCount} SKUs with Initial Balance...`);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: updates,
        },
      });
      console.log(`✅ Successfully seeded Current Balance for ${updatedCount} SKUs!`);
    } else {
      console.log('✅ All SKUs already have Current Balance initialized. No updates needed.');
    }
  } catch (err) {
    console.error('❌ Error seeding inventory balance:', err.message);
  }
}

seedInventoryBalance();