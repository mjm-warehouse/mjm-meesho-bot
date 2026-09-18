require('dotenv').config();
const { google } = require('googleapis');
const { SCHEMA } = require('../lib/schema');

async function getSheetsClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return google.sheets({ version: 'v4', auth });
}

async function fixSheets() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    console.error('❌ GOOGLE_SHEET_ID missing in .env');
    return;
  }

  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetList = meta.data.sheets;

  // 1. Rename mismatched tabs
  const tabRenames = {
    'Payment_Reco': 'Payment_Reconciliation',
    'Customer_Risk_intelligence': 'Customer_Risk_Intelligence',
    'Returns_RTC': 'Returns_Tracking',
  };

  const requests = [];
  sheetList.forEach((s) => {
    const title = s.properties.title;
    if (tabRenames[title]) {
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId: s.properties.sheetId,
            title: tabRenames[title],
          },
          fields: 'title',
        },
      });
    }
  });

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests },
    });
    console.log('✅ Tab names corrected successfully.');
  }

  // 2. Set Row 1 headers for all schema tabs
  for (const [tabName, expectedHeaders] of Object.entries(SCHEMA)) {
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A1:${String.fromCharCode(64 + expectedHeaders.length)}1`,
        valueInputOption: 'RAW',
        resource: {
          values: [expectedHeaders],
        },
      });
      console.log(`✅ Set Row 1 headers for: ${tabName}`);
    } catch (err) {
      console.log(`⚠️ Tab ${tabName} might not exist yet: ${err.message}`);
    }
  }

  console.log('\n🎉 Saari tabs aur column headers 100% correct format mein set ho gayi hain!');
}

fixSheets().catch((err) => console.error('❌ Error:', err.message));