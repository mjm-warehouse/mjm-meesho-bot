require('dotenv').config();
const axios = require('axios');

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = process.env.TELEGRAM_WEBHOOK_URL;
  if (!token || !url) {
    console.error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_URL in .env first.');
    process.exit(1);
  }

  // drop_pending_updates clears any backlog of retried/queued updates from
  // before the fix was deployed, so old timed-out messages don't flood in
  // and get reprocessed once the new webhook goes live.
  const res = await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, {
    url,
    drop_pending_updates: true,
  });
  console.log(res.data);
}

main();