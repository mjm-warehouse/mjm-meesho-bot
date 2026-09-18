const OWNER_CHAT_IDS = (process.env.OWNER_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const EMPLOYEE_CHAT_IDS = (process.env.EMPLOYEE_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const OWNER_ONLY_COMMANDS = new Set(['/pnl', '/fraud', 'setcost', 'link']);
const SCANNER_COMMANDS = new Set(['/scan_dispatch', '/scan_return']);
function getRole(chatId) {
  const id = String(chatId);
  if (OWNER_CHAT_IDS.includes(id)) return 'owner';
  if (EMPLOYEE_CHAT_IDS.includes(id)) return 'employee';
  return null;
}
function isAllowed(chatId) {
  if (OWNER_CHAT_IDS.length === 0 && EMPLOYEE_CHAT_IDS.length === 0) return true;
  return getRole(chatId) !== null;
}
function canUseCommand(chatId, command) {
  const role = getRole(chatId);
  if (!role) return false;
  if (OWNER_ONLY_COMMANDS.has(command) && role !== 'owner') return false;
  return true;
}
module.exports = { getRole, isAllowed, canUseCommand, OWNER_ONLY_COMMANDS, SCANNER_COMMANDS, OWNER_CHAT_IDS };