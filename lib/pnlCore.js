const pnl = require('./pnl');

// Handles: 2026-08-29 | 2026-06-30 00:00:00 | 8/31/2026 2:46:38 | 8/19/26 | Excel serial
function parseSheetDate(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (v === '' || v == null) return null;
  const s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86400000);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);          // M/D/YY(YY)
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[1] - 1, +m[2]); }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// range: [from, to] | {start,end} | {from,to} | null (= all-time)
function makeInRange(range) {
  const [a, b] = Array.isArray(range) ? range
    : [range && (range.start || range.from), range && (range.end || range.to)];
  if (!a && !b) return () => true;
  const f = a ? parseSheetDate(a) : null;
  let t = b ? parseSheetDate(b) : null;
  if (t) t = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59, 999);
  return v => { const d = parseSheetDate(v); return !!d && (!f || d >= f) && (!t || d <= t); };
}

// getRows(tabName) -> 2D array incl. header row
async function computePnlCore(getRows, range) {
  const inRange = makeInRange(range);
  const [orders, pays, sku, rets] = await Promise.all([
    getRows('Orders_Dispatch'), getRows('Payment_Reconciliation'),
    getRows('SKU_Master_Costing'), getRows('Returns_Tracking')]);

  const skuMap = pnl.skuCostMap(sku);
  const paySubs = pnl.paymentCohortSubs(pays);
  const st = pnl.orderStats(orders, skuMap, inRange, paySubs);
  const po = pnl.paymentCohortStats(pays, skuMap, inRange);
  const pay = pnl.settlement(pays, st.orderDate, inRange);

  const counts = { ...st.counts };
  Object.entries(po.counts).forEach(([k, v]) => { counts[k] = (counts[k] || 0) + v; });
  const n = k => counts[k] || 0;

  const rh = (rets && rets[0]) || [];
  const tampered = rh.length ? (() => {
    try {
      const iD = pnl.col(rh, 'Return Date'), iC = pnl.col(rh, 'Condition'), iR = pnl.col(rh, 'Remarks');
      return rets.slice(1).filter(r => inRange(r[iD]) && /TAMPER/i.test(`${r[iC]} ${r[iR]}`)).length;
    } catch {
      return 0;
    }
  })() : 0;

  const iSub = pnl.col(orders[0], 'Sub Order ID');
  const unlinkedScans = orders.slice(1).filter(r =>
    r.some(c => String(c).trim()) && !String(r[iSub] || '').trim()).length;

  const prodCost = st.prodCost + po.prod, packCost = st.packCost + po.pack, totalCost = prodCost + packCost;
  const missingCostOrders = Object.values(po.missing).reduce((a, b) => a + b, 0) + st.missingCost;

  const warnings = [];
  if (n('UNCLASSIFIED')) warnings.push(`${n('UNCLASSIFIED')} orders have blank status; cost/volume not counted`);
  if (missingCostOrders) warnings.push(`${missingCostOrders} delivered orders have no cost data; counted as 0`);
  if (pay.undated) warnings.push(`${pay.undated} payment rows have no usable date`);
  if (st.dupesRemoved) warnings.push(`${st.dupesRemoved} duplicate Sub Order ID rows ignored in Orders_Dispatch`);
  if (range && st.undated) warnings.push(`${st.undated} Orders_Dispatch rows have no order date; excluded from this period`);
  if (unlinkedScans) warnings.push(`${unlinkedScans} Orders_Dispatch scans have no Sub Order ID; excluded`);

  return {
    volume: { dispatched: st.total + po.total, delivered: n('DELIVERED'), exchanged: n('EXCHANGED'),
      rto: n('RTO'), returned: n('RETURNED'), cancelled: n('CANCELLED'), inTransit: n('IN_TRANSIT'),
      readyToShip: n('READY_TO_SHIP'), unclassified: n('UNCLASSIFIED'), other: n('OTHER'), tampered },
    financials: {
      grossSales: st.gross + po.gross,
      actualNetSettlement: pay.settled,
      settledOrders: pay.nSettled,
      productCost: prodCost,
      packagingCost: packCost,
      totalCost,
      costOrders: st.costOrders + po.costOrders,
      netRealProfit: pay.settled - totalCost
    },
    warnings,
    meta: { unlinkedScans, dupesRemoved: st.dupesRemoved, datesDerivedFromId: st.derived, missingSkus: po.missing },
  };
}

module.exports = { computePnlCore, parseSheetDate, makeInRange };