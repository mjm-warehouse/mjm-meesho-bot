require('dotenv').config();
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const { extractPages } = require('./lib/pdfText');
const { processDispatchPdf } = require('./lib/processDispatch');
const { processPodPdf } = require('./lib/processReturns');
const { processReconciliationFile } = require('./lib/processReconciliation');
const commands = require('./lib/commands');
const { isAllowed, canUseCommand, getRole, OWNER_CHAT_IDS } = require('./lib/permissions');
const scanner = require('./lib/scannerEngine');
const { verifyTelegramInitData } = require('./lib/telegramAuth');
const { processMeeshoSync } = require('./lib/meeshoSync');
const { getDashboardSummary } = require('./lib/dashboardData');
const { lookupCustomer } = require('./lib/customerLookup');
const { getPnlForRange } = require('./lib/analytics');
const { listInventory } = require('./lib/inventoryEngine');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // serves /scanner.html and /dashboard.html

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN); // webhook mode: no polling, we call sendMessage ourselves

// ---- THE FIX FOR THE WEBHOOK TIMEOUT BUG ----
app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  handleUpdate(req.body).catch((err) => {
    console.error('Error handling update:', err);
  });
});

async function notifyOwnersLowStock(lowStockAlerts) {
  if (!lowStockAlerts || !lowStockAlerts.length) return;
  const msg = '⚠️ Low Stock Alert:\n' + lowStockAlerts.map((a) => `• ${a.sku}: only ${a.newBalance} left`).join('\n');
  for (const ownerId of OWNER_CHAT_IDS) {
    try { await bot.sendMessage(ownerId, msg); } catch (err) { console.error('Failed to notify owner', ownerId, err.message); }
  }
}

async function handleUpdate(update) {
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query);
  }

  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;

  if (!isAllowed(chatId)) {
    return bot.sendMessage(chatId, '⛔ You are not authorized to use this bot.');
  }

  if (msg.web_app_data) {
    const result = await scanner.handleWebAppData(chatId, msg.web_app_data.data);
    return sendScanResult(chatId, result);
  }

  if (msg.document) {
    return handleDocument(chatId, msg.document);
  }

  if (msg.text) {
    return handleText(chatId, msg.text);
  }
}

async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;

  if (!isAllowed(chatId)) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: 'Not authorized.' });
  }

  await bot.answerCallbackQuery(callbackQuery.id);

  if (['ret_ok', 'ret_tampered', 'ret_wrong'].includes(callbackQuery.data)) {
    const result = await scanner.handleReturnConditionCallback(chatId, callbackQuery.data);
    return sendScanResult(chatId, result);
  }

  if (['relink_confirm', 'relink_cancel'].includes(callbackQuery.data)) {
    const result = await scanner.handleRelinkCallback(chatId, callbackQuery.data);
    return sendScanResult(chatId, result);
  }
}

async function sendScanResult(chatId, result) {
  if (!result) return;
  const opts = result.keyboard ? { reply_markup: result.keyboard } : undefined;
  return bot.sendMessage(chatId, result.reply, opts);
}

async function downloadTelegramFile(fileId) {
  const fileLink = await bot.getFileLink(fileId);
  const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

async function handleDocument(chatId, document) {
  const fileName = (document.file_name || '').toLowerCase();
  if (fileName.endsWith('.pdf')) return handlePdfDocument(chatId, document);
  if (fileName.endsWith('.csv') || fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) return handleReconciliationDocument(chatId, document);
  return bot.sendMessage(chatId, '⚠️ Please send a PDF (shipping label / POD report) or a CSV/XLSX settlement report.');
}

async function handlePdfDocument(chatId, document) {
  await bot.sendMessage(chatId, `⏳ Processing "${document.file_name}"...`);
  try {
    const buffer = await downloadTelegramFile(document.file_id);
    const pages = await extractPages(buffer);

    const stillNeedsOcr = pages.filter((p) => p.needsOcr);
    const ocrRecovered = pages.filter((p) => p.ocrApplied).length;
    if (ocrRecovered) await bot.sendMessage(chatId, `ℹ️ Recovered ${ocrRecovered} scanned page(s) via OCR fallback.`);
    if (stillNeedsOcr.length) await bot.sendMessage(chatId, `⚠️ ${stillNeedsOcr.length} page(s) had no extractable text even after OCR fallback — those pages were skipped.`);

    const usablePages = pages.filter((p) => !p.needsOcr);
    const isPod = usablePages.some((p) => /Return Delivery Report|Rider Name/i.test(p.text));

    if (isPod) {
      const result = await processPodPdf(usablePages);
      await bot.sendMessage(chatId, `✅ POD processed: ${result.count} returns logged` +
        (result.tamperedCount ? `, ${result.tamperedCount} flagged TAMPERED → moved to Claims_Manager (7-day countdown started, risk profile updated).` : '.'));
    } else {
      const result = await processDispatchPdf(usablePages);
      let reply = `✅ Dispatch label processed: ${result.count} order(s) added to Orders_Dispatch.`;
      if (result.duplicates) reply += ` (${result.duplicates} duplicate AWB(s) skipped.)`;
      await bot.sendMessage(chatId, reply);
      await notifyOwnersLowStock(result.lowStockAlerts);
    }
  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, `❌ Failed to process file: ${err.message}`);
  }
}

async function handleReconciliationDocument(chatId, document) {
  await bot.sendMessage(chatId, `⏳ Processing settlement file "${document.file_name}"...`);
  try {
    const buffer = await downloadTelegramFile(document.file_id);
    const result = await processReconciliationFile(buffer);
    let reply = `✅ Reconciliation processed: ${result.count} row(s) logged`;
    if (result.discrepancies) reply += `, ${result.discrepancies} discrepancy(ies)`;
    if (result.underSettlementCount) reply += `, ⚠️ ${result.underSettlementCount} under-settlement alert(s)`;
    reply += result.discrepancies || result.underSettlementCount ? ' flagged in Payment_Reconciliation.' : ', no issues found.';
    await bot.sendMessage(chatId, reply);
  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, `❌ Failed to process settlement file: ${err.message}`);
  }
}

async function handleText(chatId, text) {
  const trimmed = text.trim();

  if (scanner.hasActiveSession(chatId)) {
    const result = await scanner.handleScanText(chatId, trimmed);
    return sendScanResult(chatId, result);
  }

  const restricted = (commandKey) => {
    if (!canUseCommand(chatId, commandKey)) {
      bot.sendMessage(chatId, '⛔ Yeh command sirf Owner ke liye hai.');
      return true;
    }
    return false;
  };

  if (trimmed === '/scan_dispatch') return sendScanResult(chatId, scanner.startDispatchScan(chatId));
  if (trimmed === '/scan_return') return sendScanResult(chatId, scanner.startReturnScan(chatId));

  if (trimmed === '/today') return bot.sendMessage(chatId, await commands.cmdToday());

  if (trimmed === '/pnl' || trimmed.startsWith('/pnl ')) {
    if (restricted('/pnl')) return;
    const args = trimmed.split(/\s+/).slice(1);
    return bot.sendMessage(chatId, await commands.cmdPnl(args));
  }

  if (trimmed === '/claims') return bot.sendMessage(chatId, await commands.cmdClaims());
  if (trimmed === '/fraud') { if (restricted('/fraud')) return; return bot.sendMessage(chatId, await commands.cmdFraud()); }

  if (trimmed.startsWith('setcost ')) {
    if (restricted('setcost')) return;
    const args = trimmed.split(/\s+/).slice(1);
    return bot.sendMessage(chatId, await commands.cmdSetCost(args));
  }

  if (trimmed.startsWith('link ')) {
    if (restricted('link')) return;
    const args = trimmed.split(/\s+/).slice(1);
    return bot.sendMessage(chatId, await commands.cmdLink(args));
  }

  if (trimmed === '/start' || trimmed === '/help') {
    const role = getRole(chatId);
    const ownerLines = role === 'owner'
      ? '/pnl [today|this_week|this_month|last_3_months|last_6_months|Nd] - P&L (default: all time)\n' +
        '/fraud - flagged customers/pincodes\n' +
        'setcost <SKU> <ProductCost> <PackagingCost>\n' +
        'link <OLD_AWB> <NEW_AWB>\n'
      : '';
    return bot.sendMessage(chatId,
      `MJM Enterprise Bot (${role === 'owner' ? 'Owner' : 'Employee'} access)\n\n` +
      '📄 Send a shipping label or POD PDF to auto-log it.\n' +
      '📊 Send a Meesho settlement CSV/XLSX to reconcile payments.\n' +
      '📷 /scan_dispatch - packing verification (AWB + Packet QR)\n' +
      '🔄 /scan_return - return parcel inwarding\n' +
      `🖥️ Dashboard: ${process.env.PUBLIC_BASE_URL || ''}/dashboard.html (open via bot menu button)\n\n` +
      'Commands:\n' +
      '/today - today\'s dispatch summary\n' +
      '/claims - pending claims\n' +
      ownerLines);
  }

  const quickScanParts = trimmed.split(/\s+/);
  if (quickScanParts.length === 2 && !trimmed.startsWith('/')) {
    const [awb, packetCode] = quickScanParts;
    return sendScanResult(chatId, await scanner.quickDispatchScan(chatId, awb, packetCode));
  }

  return bot.sendMessage(chatId, "Didn't recognize that. Send /help for commands.");
}

// ---- Mini App API (auth: Telegram initData, sent as x-telegram-init-data header) ----
function requireTelegramAuth(req, res, next) {
  const identity = verifyTelegramInitData(req.headers['x-telegram-init-data']);
  if (!identity || !isAllowed(identity.chatId)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.telegramChatId = identity.chatId;
  next();
}

app.get('/api/dashboard/summary', requireTelegramAuth, async (req, res) => {
  try {
    res.json(await getDashboardSummary());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/pnl', requireTelegramAuth, async (req, res) => {
  try {
    res.json(await getPnlForRange(req.query.period || null));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inventory/list', requireTelegramAuth, async (req, res) => {
  try {
    res.json({ items: await listInventory() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customer/lookup', requireTelegramAuth, async (req, res) => {
  try {
    res.json({ results: await lookupCustomer(req.query.q) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scan/dispatch', requireTelegramAuth, async (req, res) => {
  try {
    const { awb, packetCode } = req.body;
    if (!awb || !packetCode) return res.status(400).json({ error: 'awb and packetCode required' });
    res.json(await scanner.quickDispatchScan(req.telegramChatId, awb, packetCode));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scan/relink', requireTelegramAuth, async (req, res) => {
  try {
    const { confirm } = req.body;
    res.json(await scanner.handleRelinkCallback(req.telegramChatId, confirm ? 'relink_confirm' : 'relink_cancel'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scan/return', requireTelegramAuth, async (req, res) => {
  try {
    const { awb, condition, subOrderId } = req.body;
    if (!awb || !condition) return res.status(400).json({ error: 'awb and condition required' });
    res.json(await scanner.quickReturnScan(req.telegramChatId, awb, condition, subOrderId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Meesho Portal Sync API (auth: shared secret, x-sync-api-key header) ----
function requireSyncApiKey(req, res, next) {
  const key = req.headers['x-sync-api-key'];
  if (!process.env.SYNC_API_KEY || key !== process.env.SYNC_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/meesho/sync', requireSyncApiKey, async (req, res) => {
  try {
    const result = await processMeeshoSync(req.body || {});
    await notifyOwnersLowStock(result.orderResult && result.orderResult.lowStockAlerts);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.send('MJM Meesho Bot is running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));