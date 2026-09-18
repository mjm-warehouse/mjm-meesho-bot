const crypto = require('crypto');

function verifyTelegramInitData(initData) {
  if (!initData || !process.env.TELEGRAM_BOT_TOKEN) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const userJson = params.get('user');
  if (!userJson) return null;
  try {
    const user = JSON.parse(userJson);
    return { chatId: user.id, firstName: user.first_name || '' };
  } catch (err) {
    return null;
  }
}

module.exports = { verifyTelegramInitData };