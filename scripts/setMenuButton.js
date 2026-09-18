require('dotenv').config();
const axios = require('axios');

// Sets the bot's persistent menu button (bottom-left, next to the message
// box in Telegram) to open the Mini App dashboard directly - staff never
// need to remember a URL or command.
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!token || !baseUrl) {
    console.error('Set TELEGRAM_BOT_TOKEN and PUBLIC_BASE_URL in .env first.');
    process.exit(1);
  }

  const res = await axios.post(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    menu_button: {
      type: 'web_app',
      text: 'Dashboard',
      web_app: { url: `${baseUrl}/dashboard.html` },
    },
  });
  console.log(res.data);
}

main();