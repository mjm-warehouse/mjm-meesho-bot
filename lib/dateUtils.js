// Shared date helpers used by commands.js (/pnl period filters), analytics.js,
// and anywhere else that needs to parse the mixed date formats in our sheets
// (DD.MM.YYYY from PDF labels, YYYY-MM-DD from portal sync / ISO timestamps).

// Accepts DD.MM.YYYY, DD-MM-YYYY, DD/MM/YYYY, or YYYY-MM-DD (with or without
// a time component) and normalizes to YYYY-MM-DD. Returns null if unparseable.
function normalizeDateStr(str) {
  if (!str) return null;
  const s = str.toString().trim();

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // also matches ISO timestamps
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

  return null;
}

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Resolves a period keyword (or {from, to} custom range) into a
// [startDateIso, endDateIso] inclusive range. Unknown/missing period ->
// null (meaning "all time", i.e. no filtering - preserves old /pnl behavior).
function resolveDateRange(period) {
  const now = new Date();
  const todayIso = toIsoDate(now);

  if (!period) return null;

  if (typeof period === 'object' && period.from) {
    return [period.from, period.to || todayIso];
  }

  const p = period.toString().toLowerCase().trim();

  if (p === 'today') return [todayIso, todayIso];

  if (p === 'this_week') {
    const day = now.getDay(); // 0=Sun
    const start = new Date(now);
    start.setDate(now.getDate() - day);
    return [toIsoDate(start), todayIso];
  }

  if (p === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return [toIsoDate(start), todayIso];
  }

  if (p === 'last_3_months') {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 3);
    return [toIsoDate(start), todayIso];
  }

  if (p === 'last_6_months') {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 6);
    return [toIsoDate(start), todayIso];
  }

  const daysMatch = p.match(/^(\d+)d$/); // "7d", "30d"
  if (daysMatch) {
    const start = new Date(now);
    start.setDate(start.getDate() - Number(daysMatch[1]));
    return [toIsoDate(start), todayIso];
  }

  return null; // unrecognized -> all time
}

function isWithinRange(dateStr, range) {
  if (!range) return true; // no range = include everything
  const iso = normalizeDateStr(dateStr);
  if (!iso) return false; // can't parse the date -> exclude from a filtered report
  return iso >= range[0] && iso <= range[1];
}

module.exports = { normalizeDateStr, resolveDateRange, isWithinRange };