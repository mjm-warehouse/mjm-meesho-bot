require('dotenv').config();
const axios = require('axios');

// Immediately unbinds the Telegram webhook (e.g. the old Google Apps Script
// URL) and clears any backlog of retried/queued updates, so a spam/retry
// loop stops right away. Safe to run any time - running it again later
// (e.g. after deploying a new URL) just unbinds whatever webhook is
// currently set.
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('Set TELEGRAM_BOT_TOKEN in .env first.');
    process.exit(1);
  }

  const res = await axios.post(`https://api.telegram.org/bot${token}/deleteWebhook`, {
    drop_pending_updates: true,
  });
  console.log(res.data);
}

main();