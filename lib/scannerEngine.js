const { readTab, appendRows, updateRow } = require('./sheets');
const { findCol, returnRecordToRow, claimRecordToRow } = require('./schema');
const { recordTamperedReturn, recordRtoReturn } = require('./riskEngine');
const { incrementOnReturn } = require('./inventoryEngine');

const CLAIM_WINDOW_DAYS = 7;
const sessions = new Map();

function addDays(dateStr, days) {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(d.getTime())) d.setTime(Date.now());
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function hasActiveSession(chatId) { return sessions.has(String(chatId)); }
function cancelSession(chatId) { sessions.delete(String(chatId)); }

function cameraKeyboard(step) {
  const base = process.env.PUBLIC_BASE_URL || '';
  return { inline_keyboard: [[{ text: '📷 Open Camera Scanner', web_app: { url: `${base}/scanner.html?step=${step}` } }]] };
}

const RETURN_CONDITION_KEYBOARD = {
  inline_keyboard: [[
    { text: '✅ OK', callback_data: 'ret_ok' },
    { text: '⚠️ TAMPERED', callback_data: 'ret_tampered' },
    { text: '🔁 Wrong/Empty', callback_data: 'ret_wrong' },
  ]],
};

const RELINK_CONFIRM_KEYBOARD = {
  inline_keyboard: [[
    { text: '✅ Confirm Overwrite', callback_data: 'relink_confirm' },
    { text: '❌ Cancel', callback_data: 'relink_cancel' },
  ]],
};

const PACKED_STATUS_PREFIX = 'Packed / Ready to Dispatch';

function startDispatchScan(chatId) {
  sessions.set(String(chatId), { flow: 'dispatch', step: 'awb', data: {} });
  return { reply: '📦 Dispatch Packing Verification\n\nStep 1: AWB scan/type karo.', keyboard: cameraKeyboard('awb') };
}

async function finalizeDispatchScan(chatId, session) {
  const { awb, packetCode } = session.data;
  const rows = await readTab('Orders_Dispatch');
  const header = rows[0] || [];
  const awbCol = findCol(header, 'Forward AWB');
  const packetCol = findCol(header, 'Packet ID');
  const statusCol = findCol(header, 'Status');
  const updatedCol = findCol(header, 'Last Updated');

  const rowIdx = rows.findIndex((r, i) => i > 0 && r[awbCol] === awb);
  if (rowIdx < 0) {
    cancelSession(chatId);
    return { reply: `❌ AWB "${awb}" Orders_Dispatch mein nahi mila.` };
  }

  const existingPacketId = rows[rowIdx][packetCol];
  const alreadyPacked = String(rows[rowIdx][statusCol] || '').startsWith(PACKED_STATUS_PREFIX);
  const packetMatches = String(existingPacketId).trim().toLowerCase() === String(packetCode).trim().toLowerCase();

  if (alreadyPacked) {
    if (packetMatches) {
      cancelSession(chatId);
      return { reply: `ℹ️ AWB "${awb}" pehle se hi Packed hai.` };
    }
    session.step = 'confirm_relink';
    session.data.pendingPacketCode = packetCode;
    session.data.existingPacketId = existingPacketId;
    return { reply: `⚠️ Already Linked! Relink karna hai?`, keyboard: RELINK_CONFIRM_KEYBOARD };
  }

  if (!packetMatches) {
    return { reply: `⚠️ Packet ID match nahi hua.`, keyboard: cameraKeyboard('packet') };
  }

  const row = [...rows[rowIdx]];
  row[statusCol] = PACKED_STATUS_PREFIX;
  row[updatedCol] = new Date().toISOString();
  await updateRow('Orders_Dispatch', rowIdx + 1, row);
  cancelSession(chatId);
  return { reply: `✅ Packing verified! AWB: ${awb}, Packet: ${packetCode}` };
}

async function performRelink(chatId, session) {
  const { awb, pendingPacketCode, existingPacketId } = session.data;
  const rows = await readTab('Orders_Dispatch');
  const header = rows[0] || [];
  const awbCol = findCol(header, 'Forward AWB');
  const packetCol = findCol(header, 'Packet ID');
  const statusCol = findCol(header, 'Status');
  const updatedCol = findCol(header, 'Last Updated');
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[awbCol] === awb);
  if (rowIdx < 0) { cancelSession(chatId); return { reply: `❌ AWB "${awb}" ab nahi mila.` }; }
  const timestamp = new Date().toISOString();
  const row = [...rows[rowIdx]];
  row[packetCol] = pendingPacketCode;
  row[statusCol] = `${PACKED_STATUS_PREFIX} — Relinked/Re-packed`;
  row[updatedCol] = timestamp;
  await updateRow('Orders_Dispatch', rowIdx + 1, row);
  cancelSession(chatId);
  return { reply: `✅ Relinked! ${existingPacketId} -> ${pendingPacketCode}` };
}

async function handleRelinkCallback(chatId, callbackData) {
  const session = sessions.get(String(chatId));
  if (!session || session.flow !== 'dispatch' || session.step !== 'confirm_relink') {
    return { reply: '⚠️ Koi pending relink request nahi hai.' };
  }
  if (callbackData === 'relink_cancel') {
    const oldPacketId = session.data.existingPacketId;
    cancelSession(chatId);
    return { reply: `❌ Cancel kiya. Purana Packet ID (${oldPacketId}) waisa hi raha.` };
  }
  if (callbackData === 'relink_confirm') return performRelink(chatId, session);
  return { reply: '⚠️ Samajh nahi aaya.' };
}

async function quickDispatchScan(chatId, awb, packetCode) {
  const session = { flow: 'dispatch', step: 'packet', data: { awb, packetCode } };
  sessions.set(String(chatId), session);
  return finalizeDispatchScan(chatId, session);
}

function startReturnScan(chatId) {
  sessions.set(String(chatId), { flow: 'return', step: 'awb', data: {} });
  return { reply: '🔄 Return Parcel Inwarding\n\nReverse AWB scan/type karo.', keyboard: cameraKeyboard('return_awb') };
}

async function handleReturnConditionCallback(chatId, conditionCode) {
  const session = sessions.get(String(chatId));
  if (!session || session.flow !== 'return' || session.step !== 'condition') {
    return { reply: '⚠️ Koi active return scan nahi hai.' };
  }
  const conditionMap = { ret_ok: 'OK', ret_tampered: 'TAMPERED', ret_wrong: 'WRONG_ITEM/EMPTY' };
  const condition = conditionMap[conditionCode];
  if (!condition) return { reply: '⚠️ Samajh nahi aaya.' };
  session.data.condition = condition;
  if (condition === 'TAMPERED') {
    session.step = 'suborder';
    return { reply: '⚠️ Sub Order ID type karo, ya "skip".' };
  }
  return finalizeReturnScan(chatId, session);
}

async function finalizeReturnScan(chatId, session) {
  const { awb, condition, subOrderId } = session.data;
  const returnDate = new Date().toISOString().slice(0, 10);
  const hasSubOrder = subOrderId && subOrderId.toLowerCase() !== 'skip';

  let originalAwb = null, sku = null, customerInfo = null;

  if (hasSubOrder) {
    const dispatchRows = await readTab('Orders_Dispatch');
    const dHeader = dispatchRows[0] || [];
    const col = (name) => findCol(dHeader, name);
    const match = dispatchRows.find((r, i) => i > 0 && r[col('Sub Order ID')] === subOrderId);
    if (match) {
      originalAwb = match[col('Forward AWB')];
      sku = match[col('SKU')];
      customerInfo = {
        customerName: match[col('Customer Name')], city: match[col('City')], state: match[col('State')],
        pincode: match[col('Pincode')], invoiceAmount: Number(match[col('Invoice Amount')]) || 0,
      };
    }
  }

  const returnType = condition === 'TAMPERED' || condition === 'WRONG_ITEM/EMPTY' ? 'Customer Return' : 'RTO Return';

  const returnRow = returnRecordToRow({
    returnDate, reverseAwb: awb, originalAwb, subOrderId: hasSubOrder ? subOrderId : null, returnType,
    courier: null, riderInfo: 'Warehouse Scan', condition,
    status: condition === 'TAMPERED' ? 'Flagged - Claims Manager' : 'Received - Scanned',
    relinkedAwb: null, remarks: 'Logged via warehouse scanner',
  });

  await appendRows('Returns_Tracking', [returnRow]);

  let claimMsg = '';
  if (condition === 'TAMPERED') {
    await appendRows('Claims_Manager', [claimRecordToRow({
      receivedDate: returnDate, subOrderId: hasSubOrder ? subOrderId : null, reverseAwb: awb, sku,
      claimDeadline: addDays(returnDate, CLAIM_WINDOW_DAYS), daysLeft: CLAIM_WINDOW_DAYS,
      issueType: 'Customer Return', status: 'Claim Pending',
      claimValue: customerInfo ? customerInfo.invoiceAmount : null, remarks: 'Logged via warehouse scanner',
    })]);
    claimMsg = '\n📋 Claims_Manager updated.';
    if (customerInfo) {
      await recordTamperedReturn({
        customerName: customerInfo.customerName, pincode: customerInfo.pincode, city: customerInfo.city,
        state: customerInfo.state, lossAmount: customerInfo.invoiceAmount, subOrderId: hasSubOrder ? subOrderId : null,
      });
      claimMsg += '\n🚩 Risk profile updated.';
    }
  } else if (returnType === 'RTO Return' && customerInfo) {
    await recordRtoReturn({
      customerName: customerInfo.customerName, pincode: customerInfo.pincode, city: customerInfo.city,
      state: customerInfo.state, subOrderId: hasSubOrder ? subOrderId : null,
    });
    claimMsg = '\n📊 RTO count updated.';
  } else if (condition === 'OK' && sku) {
    // Re-sellable return -> back into live stock.
    const stockResult = await incrementOnReturn(sku, 1);
    if (stockResult) claimMsg = `\n📦 Stock updated: ${sku} now at ${stockResult.newBalance}.`;
  }

  cancelSession(chatId);
  return { reply: `✅ Return logged! AWB: ${awb}, Condition: ${condition}${claimMsg}` };
}

// One-shot version for the web dashboard: it already knows both the AWB and
// the chosen condition (and sub-order ID if TAMPERED) from its own UI, so it
// submits everything in a single call instead of the multi-step chat flow.
async function quickReturnScan(chatId, awb, condition, subOrderId) {
  const session = { flow: 'return', step: 'condition', data: { awb, condition, subOrderId } };
  sessions.set(String(chatId), session);
  return finalizeReturnScan(chatId, session);
}

async function handleScanText(chatId, text) {
  const trimmed = text.trim();
  const session = sessions.get(String(chatId));
  if (!session) return null;

  if (trimmed.toLowerCase() === 'cancel') { cancelSession(chatId); return { reply: '❌ Cancel ho gaya.' }; }

  if (session.flow === 'dispatch') {
    if (session.step === 'awb') {
      session.data.awb = trimmed; session.step = 'packet';
      return { reply: `AWB: ${trimmed}\nStep 2: Packet QR scan/type karo.`, keyboard: cameraKeyboard('packet') };
    }
    if (session.step === 'packet') { session.data.packetCode = trimmed; return finalizeDispatchScan(chatId, session); }
    if (session.step === 'confirm_relink') {
      if (trimmed.toLowerCase() === 'confirm') return performRelink(chatId, session);
      return { reply: 'Buttons se confirm karo.', keyboard: RELINK_CONFIRM_KEYBOARD };
    }
  }

  if (session.flow === 'return') {
    if (session.step === 'awb') {
      session.data.awb = trimmed; session.step = 'condition';
      return { reply: `AWB: ${trimmed}\nCondition select karo:`, keyboard: RETURN_CONDITION_KEYBOARD };
    }
    if (session.step === 'suborder') { session.data.subOrderId = trimmed; return finalizeReturnScan(chatId, session); }
    if (session.step === 'condition') return { reply: 'Buttons se condition select karo.' };
  }

  return { reply: 'Samajh nahi aaya.' };
}

async function handleWebAppData(chatId, rawData) {
  let parsed;
  try { parsed = JSON.parse(rawData); } catch (err) { return { reply: '⚠️ Galat data.' }; }
  const { value } = parsed || {};
  if (!value) return { reply: '⚠️ Khaali scan.' };
  return handleScanText(chatId, value);
}

module.exports = {
  hasActiveSession, cancelSession, startDispatchScan, startReturnScan, quickDispatchScan,
  quickReturnScan, handleScanText, handleWebAppData, handleReturnConditionCallback, handleRelinkCallback,
};