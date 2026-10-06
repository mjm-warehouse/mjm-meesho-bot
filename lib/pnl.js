// Pure functions. Rows are 2D arrays, header in row 0.
const num = v => { const n = parseFloat(String(v).replace(/[₹,]/g, '')); return Number.isFinite(n) ? n : 0; };
const norm = x => String(x == null ? '' : x).trim().toLowerCase();
const optCol = (h, name) => h.findIndex(x => norm(x) === norm(name));
function col(h, name) {
  const i = optCol(h, name);
  if (i === -1) throw new Error(`Column "${name}" not found. Headers: ${h.join(' | ')}`);
  return i;
}

// Order date from the Sub Order ID (snowflake-like). Only active if SUBID_EPOCH_MS is set
const SUBID_EPOCH_MS = Number(process.env.SUBID_EPOCH_MS) || null;
function subIdToDate(sub) {
  if (SUBID_EPOCH_MS == null) return null;
  const m = String(sub || '').trim().match(/^(\d{15,19})(?:_\d+)?$/);
  if (!m) return null;
  const ms = Number(BigInt(m[1]) >> 22n) + SUBID_EPOCH_MS + 19800000;
  return new Date(ms).toISOString().slice(0, 10);
}

function normStatus(s) {
  const v = String(s || '').trim().toUpperCase();
  if (!v) return 'UNCLASSIFIED';
  if (v.startsWith('RTO')) return 'RTO';
  if (v === 'RETURNED' || v.includes('CUSTOMER RETURN')) return 'RETURNED';
  if (v === 'CANCELLED' || v === 'CANCELED') return 'CANCELLED';
  if (v === 'DELIVERED') return 'DELIVERED';
  if (v === 'EXCHANGED') return 'EXCHANGED';
  if (v === 'READY TO SHIP') return 'READY_TO_SHIP';
  if (v === 'DISPATCHED' || v.includes('TRANSIT')) return 'IN_TRANSIT';
  return 'OTHER';
}
const COST_STATUSES = new Set(['DELIVERED', 'EXCHANGED']);

function skuCostMap(skuRows) {
  const h = skuRows[0], iS = col(h, 'SKU ID (Style ID)'), iP = col(h, 'Purchase Cost (Rs)'),
    iK = col(h, 'Packaging Cost (Rs)'), iC = optCol(h, 'Customer Price (Rs)');
  const m = new Map();
  skuRows.slice(1).forEach(r => {
    const k = String(r[iS] || '').trim();
    if (k) m.set(k, { prod: num(r[iP]), pack: num(r[iK]), price: iC >= 0 ? num(r[iC]) : 0 });
  });
  return m;
}

// Sub Order IDs that the payment tab owns (rows carrying Meesho's Order Date).
function paymentCohortSubs(payRows) {
  const h = payRows[0], iSub = col(h, 'Sub Order ID'), iOD = optCol(h, 'Order Date');
  const s = new Set();
  if (iOD < 0) return s;
  payRows.slice(1).forEach(r => { const sub = String(r[iSub] || '').trim(); if (sub && r[iOD]) s.add(sub); });
  return s;
}

// Orders_Dispatch: dedupe by Sub Order ID; date = ID-derived first, then Order Date.
function orderStats(orderRows, skuMap, inRange, skipSubs) {
  const h = orderRows[0], iSub = col(h, 'Sub Order ID'), iSku = col(h, 'SKU'), iQty = col(h, 'Qty'),
    iProd = col(h, 'Product Cost'), iPack = col(h, 'Packaging Cost'), iSt = col(h, 'Status'),
    iDate = col(h, 'Order Date'), iInv = optCol(h, 'Invoice Amount');

  const pick = new Map(); let dupesRemoved = 0;
  for (const r of orderRows.slice(1)) {
    const sub = String(r[iSub] || '').trim();
    if (!sub) continue;
    const prev = pick.get(sub);
    if (!prev) { pick.set(sub, r); continue; }
    dupesRemoved++;
    if (normStatus(r[iSt]) !== 'UNCLASSIFIED' || normStatus(prev[iSt]) === 'UNCLASSIFIED') pick.set(sub, r);
  }

  const counts = {}, orderDate = new Map();
  let prodCost = 0, packCost = 0, gross = 0, costOrders = 0, total = 0, undated = 0, derived = 0, missingCost = 0;
  for (const [sub, r] of pick) {
    let d = subIdToDate(sub);
    if (d) derived++; else d = r[iDate] || '';
    orderDate.set(sub, d);
    if (skipSubs && skipSubs.has(sub)) continue;
    if (!inRange(d)) { if (!d) undated++; continue; }
    total++;
    const st = normStatus(r[iSt]);
    counts[st] = (counts[st] || 0) + 1;
    if (!COST_STATUSES.has(st)) continue;
    const sku = skuMap.get(String(r[iSku]).trim()) || {};
    const qty = Math.max(1, num(r[iQty]));
    const p = num(r[iProd]) || sku.prod || 0, k = num(r[iPack]) || sku.pack || 0;
    if (!p) missingCost++;
    prodCost += p * qty; packCost += k * qty; costOrders++;
    gross += (iInv >= 0 && num(r[iInv])) || (sku.price || 0) * qty;
  }
  return { total, counts, prodCost, packCost, gross, costOrders, orderDate, dupesRemoved, undated, derived, missingCost };
}

// June/July cohort: volume + cost + gross straight from Payment_Reconciliation
function paymentCohortStats(payRows, skuMap, inRange) {
  const h = payRows[0], iSub = col(h, 'Sub Order ID'), iSt = col(h, 'Status'),
    iOD = optCol(h, 'Order Date'), iSku = optCol(h, 'SKU ID'), iQty = optCol(h, 'Qty'),
    iP = optCol(h, 'Customer Price');
  const out = { total: 0, counts: {}, prod: 0, pack: 0, gross: 0, costOrders: 0, missing: {} };
  if (iOD < 0 || iSku < 0 || iQty < 0) return out;
  for (const r of payRows.slice(1)) {
    const sub = String(r[iSub] || '').trim();
    if (!sub || !r[iOD] || !inRange(r[iOD])) continue;
    out.total++;
    const st = normStatus(r[iSt]);
    out.counts[st] = (out.counts[st] || 0) + 1;
    if (!COST_STATUSES.has(st)) continue;
    const qty = Math.max(1, num(r[iQty]));
    out.gross += (iP >= 0 ? num(r[iP]) : 0) * qty;
    const key = String(r[iSku]).trim(), sku = skuMap.get(key);
    if (!sku) { out.missing[key] = (out.missing[key] || 0) + 1; continue; }
    out.prod += sku.prod * qty; out.pack += sku.pack * qty; out.costOrders++;
  }
  return out;
}

// Settlement calculation with fallback priority
function settlement(payRows, orderDate, inRange) {
  const h = payRows[0], iSub = col(h, 'Sub Order ID'), iNet = col(h, 'Net Settlement'),
    iBank = col(h, 'Bank Status'), iDate = col(h, 'Payment Date'), iOD = optCol(h, 'Order Date');
  let settled = 0, pending = 0, nSettled = 0, nPending = 0, undated = 0;
  for (const r of payRows.slice(1)) {
    const sub = String(r[iSub] || '').trim();
    if (!sub) continue;
    const d = r[iDate] || (iOD >= 0 && r[iOD]) || orderDate.get(sub) || subIdToDate(sub) || '';
    if (!d) undated++;
    if (!inRange(d)) continue;
    const net = num(r[iNet]);
    if (String(r[iBank]).trim().toUpperCase() === 'SETTLED') { settled += net; nSettled++; }
    else { pending += net; nPending++; }
  }
  return { settled, pending, nSettled, nPending, undated };
}

module.exports = { num, col, subIdToDate, normStatus, skuCostMap, paymentCohortSubs,
  orderStats, paymentCohortStats, settlement, COST_STATUSES };