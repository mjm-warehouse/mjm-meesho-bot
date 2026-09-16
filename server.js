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
const { isAllowed, canUseCommand, getRole } = require('./lib/permissions');
const scanner = require('./lib/scannerEngine');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // serves /scanner.html for the camera WebApp

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN); // webhook mode: no polling, we call sendMessage ourselves

// ---- THE FIX FOR THE WEBHOOK TIMEOUT BUG ----
// Telegram gives us 5 seconds to respond. We ACK immediately with 200 OK,
// then do all the slow work (PDF/file download + parse + Sheets writes)
// AFTER responding, in the background. Telegram never sees a timeout, so it
// never retries, so the bot never falls back into "/start" behavior.
app.post('/webhook', (req, res) => {
  res.sendStatus(200); // respond instantly, well under 5s
  handleUpdate(req.body).catch((err) => {
    console.error('Error handling update:', err);
  });
});

async function handleUpdate(update) {
  // Inline button presses (return-condition / relink-confirm buttons) arrive
  // as callback_query, not a normal message.
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query);
  }

  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;

  if (!isAllowed(chatId)) {
    return bot.sendMessage(chatId, '⛔ You are not authorized to use this bot.');
  }

  // Data sent back from the scanner.html camera WebApp.
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

  await bot.answerCallbackQuery(callbackQuery.id); // stop the loading spinner on the button

  if (['ret_ok', 'ret_tampered', 'ret_wrong'].includes(callbackQuery.data)) {
    const result = await scanner.handleReturnConditionCallback(chatId, callbackQuery.data);
    return sendScanResult(chatId, result);
  }

  if (['relink_confirm', 'relink_cancel'].includes(callbackQuery.data)) {
    const result = await scanner.handleRelinkCallback(chatId, callbackQuery.data);
    return sendScanResult(chatId, result);
  }
}

// Shared helper: a scan step result is { reply, keyboard? } - send it, and
// wire up the inline keyboard (camera button or condition/relink buttons) if present.
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

  if (fileName.endsWith('.pdf')) {
    return handlePdfDocument(chatId, document);
  }
  if (fileName.endsWith('.csv') || fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    return handleReconciliationDocument(chatId, document);
  }
  return bot.sendMessage(chatId, '⚠️ Please send a PDF (shipping label / POD report) or a CSV/XLSX settlement report.');
}

async function handlePdfDocument(chatId, document) {
  await bot.sendMessage(chatId, `⏳ Processing "${document.file_name}"...`);

  try {
    const buffer = await downloadTelegramFile(document.file_id);
    const pages = await extractPages(buffer);

    const stillNeedsOcr = pages.filter((p) => p.needsOcr);
    const ocrRecovered = pages.filter((p) => p.ocrApplied).length;
    if (ocrRecovered) {
      await bot.sendMessage(chatId, `ℹ️ Recovered ${ocrRecovered} scanned page(s) via OCR fallback.`);
    }
    if (stillNeedsOcr.length) {
      await bot.sendMessage(chatId, `⚠️ ${stillNeedsOcr.length} page(s) had no extractable text even after OCR fallback — those pages were skipped.`);
    }

    const usablePages = pages.filter((p) => !p.needsOcr);
    const isPod = usablePages.some((p) => /Return Delivery Report|Rider Name/i.test(p.text));

    if (isPod) {
      const result = await processPodPdf(usablePages);
      await bot.sendMessage(
        chatId,
        `✅ POD processed: ${result.count} returns logged` +
        (result.tamperedCount ? `, ${result.tamperedCount} flagged TAMPERED → moved to Claims_Manager (7-day countdown started, risk profile updated).` : '.')
      );
    } else {
      const result = await processDispatchPdf(usablePages);
      let reply = `✅ Dispatch label processed: ${result.count} order(s) added to Orders_Dispatch.`;
      if (result.duplicates) reply += ` (${result.duplicates} duplicate AWB(s) skipped.)`;
      await bot.sendMessage(chatId, reply);
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
    await bot.sendMessage(
      chatId,
      `✅ Reconciliation processed: ${result.count} row(s) logged` +
      (result.discrepancies ? `, ${result.discrepancies} discrepancy(ies) flagged in Payment_Reconciliation.` : ', no discrepancies found.')
    );
  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, `❌ Failed to process settlement file: ${err.message}`);
  }
}

async function handleText(chatId, text) {
  const trimmed = text.trim();

  // If this employee/owner is mid-scan (dispatch or return flow), route
  // their reply into the scanner engine first - it's keyed by chatId, so
  // 2-3 staff on different phones each have their own isolated flow.
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
  if (trimmed === '/pnl') { if (restricted('/pnl')) return; return bot.sendMessage(chatId, await commands.cmdPnl()); }
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
      ? '/pnl - profit & loss summary\n' +
        '/fraud - flagged customers/pincodes\n' +
        'setcost <SKU> <ProductCost> <PackagingCost>\n' +
        'link <OLD_AWB> <NEW_AWB>\n'
      : '';
    return bot.sendMessage(
      chatId,
      `MJM Enterprise Bot (${role === 'owner' ? 'Owner' : 'Employee'} access)\n\n` +
      '📄 Send a shipping label or POD PDF to auto-log it.\n' +
      '📊 Send a Meesho settlement CSV/XLSX to reconcile payments.\n' +
      '📷 /scan_dispatch - packing verification (AWB + Packet QR)\n' +
      '🔄 /scan_return - return parcel inwarding\n\n' +
      'Commands:\n' +
      '/today - today\'s dispatch summary\n' +
      '/claims - pending claims\n' +
      ownerLines
    );
  }

  // Manual USB barcode-gun / torn-label fallback: "AWB PACKET_ID" on one
  // line, with no active session and no other command matched, is treated
  // as a quick dispatch packing scan.
  const quickScanParts = trimmed.split(/\s+/);
  if (quickScanParts.length === 2 && !trimmed.startsWith('/')) {
    const [awb, packetCode] = quickScanParts;
    return sendScanResult(chatId, await scanner.quickDispatchScan(chatId, awb, packetCode));
  }

  return bot.sendMessage(chatId, "Didn't recognize that. Send /help for commands.");
}

app.get('/', (req, res) => res.send('MJM Meesho Bot is running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));