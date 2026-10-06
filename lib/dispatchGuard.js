const norm = v => String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '').replace(/\.0+$/, '');

// Index Packet ID + Forward AWB + Sub Order ID together (old rows had Packet ID / AWB swapped).
// PKT-xxxxx are locally generated, so they are not dedupe keys.
function buildSeen(existingRows) {
  const h = existingRows[0].map(x => String(x).trim().toLowerCase());
  const cols = ['packet id', 'forward awb', 'sub order id'].map(n => h.indexOf(n)).filter(i => i >= 0);
  const seen = new Set();
  for (const r of existingRows.slice(1))
    for (const i of cols) { const k = norm(r[i]); if (k && !k.startsWith('PKT-')) seen.add(k); }
  return seen;
}

// First PKT number to use (max existing + 1; falls back to row count like the old code)
function nextPacketNumber(existingRows) {
  const h = existingRows[0].map(x => String(x).trim().toLowerCase()), i = h.indexOf('packet id');
  let max = 0;
  if (i >= 0) for (const r of existingRows.slice(1)) {
    const m = /^PKT-(\d+)$/i.exec(String(r[i] || '').trim()); if (m) max = Math.max(max, +m[1]);
  }
  return (max || existingRows.length) + 1;
}

function partitionRecords(records, seen) {
  const fresh = [], flagged = [], exceptions = []; let duplicates = 0;
  for (const rec of records) {
    const sub = norm(rec.subOrderId), awb = norm(rec.forwardAwb);
    if (!sub && !awb) { exceptions.push({ reason: 'NO_SUB_ORDER_ID_OR_AWB', rec }); continue; }
    if ((sub && seen.has(sub)) || (awb && seen.has(awb))) { duplicates++; continue; }
    fresh.push(rec);
    if (!sub) flagged.push(rec);           // kept so the packet can be scanned, flagged for follow-up
    if (sub) seen.add(sub);
    if (awb) seen.add(awb);                // also catches duplicates inside the same upload
  }
  return { fresh, flagged, duplicates, exceptions };
}

module.exports = { norm, buildSeen, nextPacketNumber, partitionRecords };