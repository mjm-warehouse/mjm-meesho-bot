// Background worker: every 10 minutes, checks Pending_Fetch_Queue for
// entries whose retry time has passed (pendingQueue.js already knows the
// correct +15m/+1h/+3h schedule), re-attempts the Meesho portal search +
// submission, and either resolves the entry or reschedules/fails it.
//
// Reuses lib/claimPipeline/pendingQueue.js (getDueRetries/recordAttemptResult)
// rather than re-implementing sheet access - that module already handles
// the retry-tier math correctly and uses findCol() (not hardcoded column
// letters), so it stays correct even if the sheet's column order ever shifts.
const cron = require('node-cron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getDueRetries, recordAttemptResult } = require('./pendingQueue');
const { searchReturnByAwb, submitClaim } = require('./meeshoSubmitter');
const { generateDescription } = require('./geminiDescription');
const { downloadEvidenceFile } = require('./storage');
const { appendRows } = require('../sheets');
const { claimRecordToRow } = require('../schema');

const RETRY_CRON_EXPR = '*/10 * * * *'; // every 10 minutes

function initRetryWorker() {
  cron.schedule(RETRY_CRON_EXPR, () => {
    runRetryPass().catch((err) => {
      console.error('Retry worker pass failed:', err.message);
    });
  });
  console.log('🚀 Background Retry Worker initialized (runs every 10 min).');
}

async function runRetryPass() {
  const due = await getDueRetries();
  if (!due.length) return;

  console.log(`🔄 Retry queue: ${due.length} entr${due.length === 1 ? 'y' : 'ies'} due.`);

  // Lazily require claimsBot to avoid a require-cycle at module load time
  // (claimsBot.js doesn't import retryWorker.js, but server.js imports both).
  const { claimsBot } = require('../../claimsBot');

  for (const entry of due) {
    await processRetryEntry(entry, claimsBot);
  }
}

async function processRetryEntry(entry, claimsBot) {
  const { rowIndex1Based, awb, packetId, code, chatId, evidenceKeys } = entry;
  console.log(`🔍 Retrying AWB ${maskAwb(awb)} (attempt ${entry.attempts + 1})...`);

  const searchResult = await searchReturnByAwb(awb);

  if (!searchResult.found) {
    await recordAttemptResult(rowIndex1Based, { success: false, errorMessage: 'Portal search still not found/timed out' });
    return; // pendingQueue.js already moved it to the next tier or Failed status
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-retry-'));
  try {
    // Re-download evidence from R2 back to local disk (temp files from the
    // original claimsBot.js session are already deleted by this point).
    const videoPath = evidenceKeys.video ? await downloadEvidenceFile(evidenceKeys.video, path.join(tmpDir, 'video.mp4')) : null;
    const labelPhotoPaths = await downloadAll(evidenceKeys.label, tmpDir, 'label');
    const damagePhotoPaths = await downloadAll(evidenceKeys.damage, tmpDir, 'damage');
    const slipPhotoPaths = await downloadAll(evidenceKeys.slip, tmpDir, 'slip');

    const description = await generateDescription({
      awb,
      subOrderId: searchResult.subOrderId,
      packetId,
      code,
      returnReason: searchResult.returnReason,
    });

    const submitResult = await submitClaim({
      awb,
      subOrderId: searchResult.subOrderId,
      packetId,
      code,
      description,
      mediaSlots: { labelPhotoPaths, damagePhotoPaths, slipPhotoPaths, videoPath },
    });

    const today = new Date().toISOString().slice(0, 10);
    await appendRows('Claims_Manager', [claimRecordToRow({
      receivedDate: today,
      subOrderId: searchResult.subOrderId,
      reverseAwb: awb,
      sku: searchResult.sku,
      claimDeadline: null,
      daysLeft: null,
      issueType: code,
      status: 'Submitted',
      claimValue: null,
      remarks: `Ticket ID: ${submitResult.ticketId} | Auto-submitted via Retry Queue (attempt ${entry.attempts + 1})`,
    })]);

    await recordAttemptResult(rowIndex1Based, { success: true });

    if (chatId) {
      await claimsBot.sendMessage(chatId,
        `✅ Delayed Sync Success!\nAWB: ${awb}\nTicket ID: ${submitResult.ticketId}\nClaim submitted after retry.`);
    }
  } catch (err) {
    console.error(`Retry submission failed for AWB ${maskAwb(awb)}:`, err.message);
    await recordAttemptResult(rowIndex1Based, { success: false, errorMessage: err.message });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best-effort cleanup */ }
  }
}

async function downloadAll(keys, tmpDir, prefix) {
  const paths = [];
  for (let i = 0; i < (keys || []).length; i++) {
    const p = path.join(tmpDir, `${prefix}_${i}.jpg`);
    await downloadEvidenceFile(keys[i], p);
    paths.push(p);
  }
  return paths;
}

function maskAwb(awb) {
  return awb ? `${awb.slice(0, 4)}...${awb.slice(-4)}` : 'unknown';
}

module.exports = { initRetryWorker };