require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const AdmZip = require('adm-zip');

const { isAllowed, getRole } = require('./lib/permissions');
const commands = require('./lib/commands');
const { extractPages } = require('./lib/pdfText');
const { processDispatchPdf } = require('./lib/processDispatch');
const { processPodPdf } = require('./lib/processReturns');
const { processReconciliationFile } = require('./lib/processReconciliation');
const { verifyTelegramInitData } = require('./lib/telegramAuth');
const { processMeeshoSync } = require('./lib/meeshoSync');
const { getDashboardSummary } = require('./lib/dashboardData');
const { getPnlForRange } = require('./lib/analytics');
const { listInventory } = require('./lib/inventoryEngine');
const { lookupCustomer } = require('./lib/customerLookup');
const scanner = require('./lib/scannerEngine');
const { readTab } = require('./lib/sheets');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN);

// ==========================================
// DYNAMIC SKU COSTING & LIVE PnL ENGINE (15-COL)
// ==========================================
let skuCostingCache = new Map();
let lastCostingFetch = 0;
const COSTING_CACHE_TTL = 10 * 60 * 1000; // 10 mins cache

async function loadSkuCostingMaster(force = false) {
  const now = Date.now();
  if (!force && skuCostingCache.size > 0 && (now - lastCostingFetch) < COSTING_CACHE_TTL) {
    return skuCostingCache;
  }

  try {
    const rows = await readTab('SKU_Master_Costing');
    if (!rows || rows.length < 2) {
      console.warn('⚠️ No data found in SKU_Master_Costing tab.');
      return skuCostingCache;
    }

    const newCache = new Map();
    // Rows 1 to N (skipping header row 0)
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[1]) continue; // Col B: SKU ID

      const sku = String(r[1]).trim();
      if (!sku) continue;

      const customerPrice = parseFloat(r[4]) || 0;    // Col E
      const bankPayout = parseFloat(r[5]) || 0;       // Col F
      const meeshoShipping = parseFloat(r[6]) || 0;   // Col G
      const purchaseCost = parseFloat(r[7]) || 0;     // Col H
      const packagingCost = parseFloat(r[8]) || 0;    // Col I
      const influencerComm = parseFloat(r[9]) || 0;   // Col J

      let influencerCost = 0;
      if (influencerComm > 0) {
        influencerCost = influencerComm < 1 ? bankPayout * influencerComm : influencerComm;
      }

      const totalCost = purchaseCost + packagingCost + influencerCost;
      const netProfit = bankPayout > 0 ? (bankPayout - totalCost) : (-totalCost);
      const profitMargin = bankPayout > 0 ? ((netProfit / bankPayout) * 100) : 0;

      newCache.set(sku, {
        sku,
        productName: r[2] || '',
        category: r[3] || '',
        customerPrice,
        bankPayout,
        meeshoShipping,
        purchaseCost,
        packagingCost,
        influencerComm,
        influencerCost: Math.round(influencerCost * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        netProfit: Math.round(netProfit * 100) / 100,
        profitMargin: Math.round(profitMargin * 10) / 10,
        stock: parseInt(r[14]) || 0, // Col O: Current Stock
      });
    }

    skuCostingCache = newCache;
    lastCostingFetch = now;
    console.log(`✅ Loaded ${skuCostingCache.size} SKUs from Google Sheet SKU_Master_Costing.`);
    return skuCostingCache;
  } catch (err) {
    console.error('⚠️ Error fetching SKU Costing from Sheet:', err.message);
    return skuCostingCache;
  }
}

// Initial fetch on server boot
loadSkuCostingMaster().catch((e) => console.error(e));

// Helper function to calculate PnL for any given SKU
function getSkuCosting(skuId) {
  if (!skuId) return null;
  return skuCostingCache.get(String(skuId).trim()) || null;
}

// ---- NOTIFY OWNERS LOW STOCK ----
async function notifyOwnersLowStock(alerts) {
  if (!alerts || !alerts.length) return;
  const ownerIds = (process.env.OWNER_TELEGRAM_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const msg =
    '⚠️ *Low Stock Alert*\n\n' +
    alerts
      .map((a) => `• *${a.skuId}* (${a.productName}): *${a.currentStock}* bacha hai (threshold: ${a.reorderPoint})`)
      .join('\n');

  for (const ownerId of ownerIds) {
    try {
      await bot.sendMessage(ownerId, msg, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Failed to notify owner', ownerId, err.message);
    }
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;

  if (!isAllowed(chatId)) {
    return bot.sendMessage(chatId, '⛔ You are not authorized to use this bot.');
  }

  if (msg.document) {
    return handleDocument(chatId, msg.document);
  }

  if (msg.text) {
    return handleTextCommand(chatId, msg.text.trim());
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
    return bot.sendMessage(chatId, result.reply, result.opts || {});
  }

  if (['relink_confirm', 'relink_cancel'].includes(callbackQuery.data)) {
    const result = await scanner.handleRelinkCallback(chatId, callbackQuery.data);
    return bot.sendMessage(chatId, result.reply);
  }
}

async function downloadTelegramFile(fileId) {
  const fileLink = await bot.getFileLink(fileId);
  const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

// ---- DOCUMENT HANDLER: PDF, EXCEL, CSV, ZIP ----
async function handleDocument(chatId, document) {
  const fileName = (document.file_name || '').toLowerCase();

  // 1. Direct PDF (Shipping Labels / POD)
  if (fileName.endsWith('.pdf')) {
    return handlePdfDocument(chatId, document);
  }

  // 2. Direct Excel / CSV Settlements
  if (fileName.endsWith('.csv') || fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    return handleReconciliationDocument(chatId, document);
  }

  // 3. ZIP File Handler (Meesho Settlement / Invoice ZIPs)
  if (fileName.endsWith('.zip')) {
    await bot.sendMessage(chatId, `📦 Unpacking ZIP archive "${document.file_name}"...`);
    try {
      const buffer = await downloadTelegramFile(document.file_id);
      const zip = new AdmZip(buffer);
      const zipEntries = zip.getEntries();

      let processedCount = 0;

      for (const entry of zipEntries) {
        if (entry.isDirectory) continue;
        const entryName = entry.entryName.toLowerCase();

        // Process Extracted Excel / CSV Settlement File
        if (entryName.endsWith('.xlsx') || entryName.endsWith('.xls') || entryName.endsWith('.csv')) {
          await bot.sendMessage(chatId, `⏳ Processing extracted "${entry.name}"...`);
          const fileBuffer = entry.getData();
          const result = await processReconciliationFile(fileBuffer);

          let reply = `✅ Reconciliation processed: ${result.count} row(s) logged from ${entry.name}`;
          if (result.underSettlementCount) {
            reply += `\n⚠️ ${result.underSettlementCount} orders flagged for under-settlement.`;
          }
          await bot.sendMessage(chatId, reply);
          processedCount++;
        }
        // Process Extracted PDF (e.g. bulk dispatch invoices)
        else if (entryName.endsWith('.pdf')) {
          const fileBuffer = entry.getData();
          const pages = await extractPages(fileBuffer);
          const usablePages = pages.filter((p) => !p.needsOcr);

          if (usablePages.length) {
            const isPod = usablePages.some((p) => /Return Delivery Report|Rider Name/i.test(p.text));
            if (!isPod) {
              const result = await processDispatchPdf(usablePages);
              if (result.count > 0) {
                let reply = `✅ Extracted PDF processed: ${result.count} order(s) added to Orders_Dispatch.`;
                if (result.duplicates) reply += ` (${result.duplicates} duplicate AWB(s) skipped.)`;
                await bot.sendMessage(chatId, reply);
                await notifyOwnersLowStock(result.lowStockAlerts);
                processedCount++;
              }
            }
          }
        }
      }

      if (processedCount === 0) {
        await bot.sendMessage(chatId, '⚠️ ZIP file ke andar koi valid Excel settlement ya PDF document nahi mila.');
      }
      return;
    } catch (err) {
      console.error(err);
      return bot.sendMessage(chatId, `❌ ZIP file process karne me error aaya: ${err.message}`);
    }
  }

  return bot.sendMessage(chatId, '⚠️ Please send a PDF, Excel (.xlsx/.csv), or a ZIP file.');
}

async function handlePdfDocument(chatId, document) {
  await bot.sendMessage(chatId, `⏳ Processing "${document.file_name}"...`);
  try {
    const buffer = await downloadTelegramFile(document.file_id);
    const pages = await extractPages(buffer);

    const stillNeedsOcr = pages.filter((p) => p.needsOcr);
    const ocrRecovered = pages.filter((p) => p.ocrApplied).length;
    if (ocrRecovered) await bot.sendMessage(chatId, `ℹ️ Recovered ${ocrRecovered} scanned page(s) via OCR fallback.`);
    if (stillNeedsOcr.length) {
      await bot.sendMessage(chatId, `⚠️️ ${stillNeedsOcr.length} page(s) had no extractable text even after OCR fallback — skipped.`);
    }

    const usablePages = pages.filter((p) => !p.needsOcr);
    const isPod = usablePages.some((p) => /Return Delivery Report|Rider Name/i.test(p.text));

    if (isPod) {
      const result = await processPodPdf(usablePages);
      await bot.sendMessage(chatId, `✅ POD processed: ${result.count} returns logged` +
        (result.tamperedCount ? `, ${result.tamperedCount} flagged TAMPERED → Claims_Manager.` : '.'));
    } else {
      const result = await processDispatchPdf(usablePages);
      let reply = `✅ Dispatch label processed: ${result.count} order(s) added to Orders_Dispatch.`;
      if (result.duplicates) reply += ` (${result.duplicates} duplicate AWB(s) skipped.)`;

      // Costing Live Alert
      if (skuCostingCache.size > 0 && result.count > 0) {
        reply += `\n💰 Costing & Profit metrics auto-linked from SKU_Master_Costing.`;
      }

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
    if (result.discrepancies) reply += `\n⚠️ Discrepancies noted in ${result.discrepancies} orders.`;
    if (result.underSettlementCount) reply += `\n🚨 ${result.underSettlementCount} orders under-settled.`;
    await bot.sendMessage(chatId, reply);
  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, `❌ Failed to process settlement file: ${err.message}`);
  }
}

async function handleTextCommand(chatId, text) {
  const role = getRole(chatId);
  const trimmed = text.trim();

  const restricted = (cmd) => {
    if (role !== 'owner') {
      bot.sendMessage(chatId, '⛔ Yeh command sirf Owner ke liye hai.');
      return true;
    }
    return false;
  };

  if (trimmed === '/start' || trimmed === '/help') {
    return bot.sendMessage(
      chatId,
      `MJM Enterprise Bot (${role === 'owner' ? 'Owner' : 'Employee'} access)\n\n` +
      '📄 Send a shipping label or POD PDF to auto-log it.\n' +
      '📊 Send a Meesho settlement XLSX/CSV or ZIP to reconcile payments.\n\n' +
      'Commands:\n' +
      '/today - today\'s dispatch summary\n' +
      '/pnl - net P&L summary\n' +
      '/claims - pending claims countdown\n' +
      '/fraud - high-risk buyer pincodes\n' +
      '/costing - view top SKU profit margins\n' +
      '/reloadcosts - refresh live prices from Google Sheet\n'
    );
  }

  if (trimmed === '/today') return bot.sendMessage(chatId, await commands.cmdToday());
  if (trimmed === '/pnl' || trimmed.startsWith('/pnl ')) {
    if (restricted('/pnl')) return;
    const args = trimmed.split(' ').slice(1);
    return bot.sendMessage(chatId, await commands.cmdPnl(args));
  }
  if (trimmed === '/claims') return bot.sendMessage(chatId, await commands.cmdClaims());
  if (trimmed === '/fraud') {
    if (restricted('/fraud')) return;
    return bot.sendMessage(chatId, await commands.cmdFraud());
  }

  // Reload Master Costing from Sheet
  if (trimmed === '/reloadcosts') {
    if (restricted('/reloadcosts')) return;
    await bot.sendMessage(chatId, '⏳ Fetching latest rates from SKU_Master_Costing...');
    const cache = await loadSkuCostingMaster(true);
    return bot.sendMessage(chatId, `✅ Successfully synced ${cache.size} SKUs from Google Sheet.`);
  }

  // Quick View of Profit Margins
  if (trimmed === '/costing') {
    if (restricted('/costing')) return;
    if (skuCostingCache.size === 0) await loadSkuCostingMaster();
    
    let report = `📊 *MJM Top Costing & Profit Margins:*\n\n`;
    let count = 0;
    for (const [sku, info] of skuCostingCache.entries()) {
      if (info.bankPayout > 0 && count < 8) {
        report += `• *${sku}*\n  Payout: ₹${info.bankPayout} | Total Cost: ₹${info.totalCost} | *Net: ₹${info.netProfit} (${info.profitMargin}%)*\n`;
        count++;
      }
    }
    report += `\n_Total active SKUs: ${skuCostingCache.size}_`;
    return bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
  }

  if (trimmed.startsWith('setcost ')) {
    if (restricted('setcost')) return;
    const args = trimmed.split(' ').slice(1);
    return bot.sendMessage(chatId, await commands.cmdSetCost(args));
  }

  if (trimmed.startsWith('link ')) {
    const args = trimmed.split(' ').slice(1);
    return bot.sendMessage(chatId, await commands.cmdLink(args));
  }

  // Quick Barcode Scanning via text (AWBs or Packet Codes)
  if (/^[A-Za-z0-9_-]{8,25}$/.test(trimmed)) {
    const scanResult = await scanner.handleScannedBarcode(chatId, trimmed);
    return bot.sendMessage(chatId, scanResult.reply, scanResult.opts || {});
  }

  return bot.sendMessage(chatId, "Didn't recognize that. Send /help for commands.");
}

// ---- Mini App API ----
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
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/pnl', requireTelegramAuth, async (req, res) => {
  try {
    res.json(await getPnlForRange(req.query.period || null));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inventory/list', requireTelegramAuth, async (req, res) => {
  try {
    res.json({ items: await listInventory() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customer/lookup', requireTelegramAuth, async (req, res) => {
  try {
    res.json({ results: await lookupCustomer(req.query.q) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scan/dispatch', requireTelegramAuth, async (req, res) => {
  try {
    const { awb, packetCode } = req.body;
    res.json(await scanner.quickDispatchScan(req.telegramChatId, awb, packetCode));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scan/relink', requireTelegramAuth, async (req, res) => {
  try {
    const { confirm } = req.body;
    res.json(await scanner.handleRelinkCallback(req.telegramChatId, confirm ? 'relink_confirm' : 'relink_cancel'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scan/return', requireTelegramAuth, async (req, res) => {
  try {
    const { awb, condition, subOrderId } = req.body;
    res.json(await scanner.quickReturnScan(req.telegramChatId, awb, condition, subOrderId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Telegram Webhook Handler
app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  if (req.body.message) handleMessage(req.body.message);
  if (req.body.callback_query) handleCallbackQuery(req.body.callback_query);
});

app.get('/', (req, res) => res.send('MJM Meesho Bot is running with Live SKU Costing Engine.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});