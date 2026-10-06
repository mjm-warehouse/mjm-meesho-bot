// Date-filtered P&L and delivery analytics. Reused by both the /pnl <period>
// Telegram command and the Mini App dashboard's period filter buttons, so
// they always show identical numbers.
const { readTab } = require('./sheets');
const { findCol } = require('./schema');
const { resolveDateRange, isWithinRange } = require('./dateUtils');
const { computePnlCore } = require('./pnlCore');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 60s in-memory cache so repeated /pnl or Mini App calls don't re-read Google Sheets
const _cache = new Map();
const cachedRows = (getRows, ttl = 60000) => async (tab) => {
  const hit = _cache.get(tab);
  if (hit && Date.now() - hit.t < ttl) return hit.rows;
  const rows = await getRows(tab);
  _cache.set(tab, { t: Date.now(), rows });
  return rows;
};

function parsePeriodToRange(period) {
  if (!period || period === 'all_time') return null;
  if (/^\d{4}-\d{2}$/.test(String(period).trim())) {
    const [y, m] = period.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return [`${period}-01`, `${period}-${String(lastDay).padStart(2, '0')}`];
  }
  const resolved = resolveDateRange(period);
  if (Array.isArray(resolved)) return resolved;
  if (resolved && resolved.start && resolved.end) return [resolved.start, resolved.end];
  return resolved;
}

async function getPnlForRange(period) {
  const range = parsePeriodToRange(period); // [from, to] or null
  const getRows = cachedRows(readTab);

  // 1. Process Dead Losses from Expired Claims (Claims_Manager)
  const claims = await getRows('Claims_Manager').catch(() => []);
  const ch = (claims && claims[0]) || [];
  const claimReceivedCol = findCol(ch, 'Received Date');
  const claimStatusCol = findCol(ch, 'Status');
  const claimValueCol = findCol(ch, 'Claim Value');

  let deadLosses = 0;
  if (claims.length > 1 && claimReceivedCol !== -1 && claimStatusCol !== -1 && claimValueCol !== -1) {
    for (const r of claims.slice(1)) {
      if (!isWithinRange(r[claimReceivedCol], range)) continue;
      if (String(r[claimStatusCol] || '').startsWith('Claim Expired')) {
        deadLosses += Number(r[claimValueCol]) || 0;
      }
    }
  }

  // 2. Compute Audit-Ready P&L Metrics via pnlCore
  const core = await computePnlCore(getRows, range);
  const v = core.volume;
  const f = core.financials;

  const netRealProfit = f.actualNetSettlement - f.totalCost - deadLosses;

  return {
    period: period || 'all_time',
    range: range ? { from: range[0], to: range[1] } : null,
    volume: {
      dispatched: v.dispatched,
      delivered: v.delivered,
      rto: v.rto,
      customerReturns: v.returned,
      tampered: v.tampered,
    },
    financials: {
      grossSales: round2(f.grossSales),
      actualNetSettlement: round2(f.actualNetSettlement),
      totalCost: round2(f.totalCost),
      deadLosses: round2(deadLosses),
      netRealProfit: round2(netRealProfit),
    },
    warnings: core.warnings,
    meta: {
      ...core.meta,
      unclassified: v.unclassified,
      settledOrders: f.settledOrders,
    },
  };
}

module.exports = { getPnlForRange };