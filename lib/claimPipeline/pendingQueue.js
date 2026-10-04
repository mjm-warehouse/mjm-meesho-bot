const { readTab, appendRows, updateCell, findColIndex } = require('../sheets');

const TAB_NAME = 'Pending_Fetch_Queue';

// Schedule: Tier 1 (+15m), Tier 2 (+1h), Tier 3 (+3h)
const RETRY_DELAYS_MS = [
  15 * 60 * 1000,
  60 * 60 * 1000,
  180 * 60 * 1000
];

async function getDueRetries() {
  const rows = await readTab(TAB_NAME);
  if (!rows || rows.length <= 1) return [];

  const headers = rows[0];
  const colAwb = findColIndex(headers, 'AWB');
  const colPacketId = findColIndex(headers, 'Packet_ID');
  const colCode = findColIndex(headers, 'Return_Code');
  const colChatId = findColIndex(headers, 'Telegram_Chat_ID');
  const colNextRetry = findColIndex(headers, 'Next_Retry_At');
  const colStatus = findColIndex(headers, 'Status');
  const colAttempts = findColIndex(headers, 'Attempts');
  const colEvidence = findColIndex(headers, 'Evidence_Keys_JSON');

  const now = new Date();
  const dueEntries = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const status = (row[colStatus] || '').trim();
    if (status !== 'Pending') continue;

    const nextRetryStr = row[colNextRetry];
    if (!nextRetryStr) continue;

    const nextRetryTime = new Date(nextRetryStr);
    if (isNaN(nextRetryTime.getTime()) || nextRetryTime <= now) {
      let evidenceKeys = {};
      try {
        evidenceKeys = JSON.parse(row[colEvidence] || '{}');
      } catch (e) {
        evidenceKeys = {};
      }

      dueEntries.push({
        rowIndex1Based: i + 1,
        awb: (row[colAwb] || '').trim(),
        packetId: (row[colPacketId] || '').trim(),
        code: (row[colCode] || '').trim(),
        chatId: (row[colChatId] || '').trim(),
        attempts: parseInt(row[colAttempts] || '0', 10),
        evidenceKeys,
      });
    }
  }

  return dueEntries;
}

async function recordAttemptResult(rowIndex1Based, { success, errorMessage }) {
  const rows = await readTab(TAB_NAME);
  const headers = rows[0];

  const colStatus = findColIndex(headers, 'Status');
  const colAttempts = findColIndex(headers, 'Attempts');
  const colNextRetry = findColIndex(headers, 'Next_Retry_At');
  const colError = findColIndex(headers, 'Last_Error');

  const currentRow = rows[rowIndex1Based - 1];
  const attempts = parseInt(currentRow[colAttempts] || '0', 10) + 1;

  if (success) {
    await updateCell(TAB_NAME, rowIndex1Based, colStatus + 1, 'Resolved');
    await updateCell(TAB_NAME, rowIndex1Based, colAttempts + 1, attempts);
    await updateCell(TAB_NAME, rowIndex1Based, colNextRetry + 1, '-');
    await updateCell(TAB_NAME, rowIndex1Based, colError + 1, '-');
    return;
  }

  if (attempts >= RETRY_DELAYS_MS.length) {
    await updateCell(TAB_NAME, rowIndex1Based, colStatus + 1, 'Failed');
    await updateCell(TAB_NAME, rowIndex1Based, colAttempts + 1, attempts);
    await updateCell(TAB_NAME, rowIndex1Based, colNextRetry + 1, '-');
    await updateCell(TAB_NAME, rowIndex1Based, colError + 1, errorMessage || 'Max retries exhausted');
  } else {
    const nextTime = new Date(Date.now() + RETRY_DELAYS_MS[attempts]).toISOString();
    await updateCell(TAB_NAME, rowIndex1Based, colStatus + 1, 'Pending');
    await updateCell(TAB_NAME, rowIndex1Based, colAttempts + 1, attempts);
    await updateCell(TAB_NAME, rowIndex1Based, colNextRetry + 1, nextTime);
    await updateCell(TAB_NAME, rowIndex1Based, colError + 1, errorMessage || 'Failed, rescheduled');
  }
}

module.exports = {
  getDueRetries,
  recordAttemptResult,
};