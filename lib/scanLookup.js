const { norm } = require('./dispatchGuard');

// Statuses that mean "already handled". Blank / Ready to Ship stay scannable.
const DONE = new Set(['DISPATCHED', 'DELIVERED', 'RTO', 'RTO / RETURN RECEIVED', 'RETURNED', 'CANCELLED', 'EXCHANGED']);

function findDispatchRow(rows, { awb, packetCode }) {
  const h = rows[0].map(x => String(x).trim().toLowerCase());
  const cols = ['packet id', 'forward awb', 'sub order id'].map(n => h.indexOf(n)).filter(i => i >= 0);
  const iSt = h.indexOf('status');
  const lookup = code => {
    const k = norm(code); if (!k) return [];
    const hits = [];
    for (let i = 1; i < rows.length; i++) if (cols.some(c => norm(rows[i][c]) === k)) hits.push(i);
    return hits;
  };
  let hits = lookup(awb), via = 'awb';
  if (!hits.length && packetCode) { hits = lookup(packetCode); via = 'packet'; }
  const open = hits.filter(i => !DONE.has(String(rows[i][iSt] || '').trim().toUpperCase()));
  return { hits, via, idx: open.length ? open[0] : -1, duplicate: hits.length > 0 && !open.length,
    status: hits.length ? String(rows[hits[0]][iSt] || '').trim() : '' };
}

// Absorbs gun double-reads while the first scan is still being written to the sheet.
const inflight = new Map();
function claimScan(awb, ttlMs = 4000) {
  const k = norm(awb), now = Date.now();
  for (const [kk, t] of inflight) if (t < now) inflight.delete(kk);
  if (inflight.has(k)) return false;
  inflight.set(k, now + ttlMs); return true;
}
const releaseScan = awb => inflight.delete(norm(awb));

module.exports = { findDispatchRow, claimScan, releaseScan };