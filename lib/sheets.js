const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function getAuth() {
  function formatPrivateKey(key) {
  if (!key) return '';
  let cleanKey = key.trim();
  // Agar key double quotes ke andar wrapped hai toh quotes hatayein
  if (cleanKey.startsWith('"') && cleanKey.endsWith('"')) {
    cleanKey = cleanKey.slice(1, -1);
  }
  // Sabhi literal \n ya \\n ko real newline mein convert karein
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

async function appendRows(tabName, rows) {
  if (!rows.length) return;
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

module.exports = { appendRows, readTab, updateRow };