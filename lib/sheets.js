const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Cache the client instance & token to prevent quota exhaustion
let cachedSheetsClient = null;
let tokenExpiresAt = 0;

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
  const now = Date.now();
  if (cachedSheetsClient && now < tokenExpiresAt) {
    return cachedSheetsClient;
  }

  const auth = getAuth();
  await auth.authorize();
  cachedSheetsClient = google.sheets({ version: 'v4', auth });
  // Token validity is typically 1 hour (3600s); cache for 50 minutes
  tokenExpiresAt = now + 50 * 60 * 1000;
  return cachedSheetsClient;
}

async function appendRows(tabName, rows) {
  if (!rows || !rows.length) return;
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

async function readTab(tabName) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1:Z10000`,
  });
  return res.data.values || [];
}

async function updateRow(tabName, rowIndex1Based, rowValues) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A${rowIndex1Based}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowValues] },
  });
}

async function batchUpdateRows(tabName, updates) {
  if (!updates || !updates.length) return;
  const sheets = await getSheetsClient();
  const data = updates.map((u) => ({
    range: `${tabName}!A${u.rowIndex1Based}`,
    values: [u.rowValues],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: data,
    },
  });
}

module.exports = {
  getSheetsClient,
  appendRows,
  readTab,
  updateRow,
  batchUpdateRows,
};