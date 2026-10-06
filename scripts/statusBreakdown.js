const XLSX = require('xlsx'), fs = require('fs');
const month = process.argv[2] || '2026-07';                  // node scripts/statusBreakdown.js 2026-07
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const iso = d => typeof d === 'number' ? new Date((d - 25569) * 864e5).toISOString().slice(0, 10) : String(d).slice(0, 10);
const r2 = n => Math.round(n * 100) / 100;

const orders = new Map();
for (const f of fs.readdirSync('.').filter(f => /order_summary.*\.xlsx$/i.test(f)).sort()) {
  const wb = XLSX.readFile(f);
  XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).forEach(r => {
    const id = String(r['Sub orderId']).trim(); if (id) orders.set(id, r); });
}
const agg = {}, claims = {}; let total = 0;
for (const r of orders.values()) {
  if (iso(r['Order Date']).slice(0, 7) !== month) continue;
  const k = `${String(r['Order Status']).trim()} | ${String(r['Payout Status']).trim() || '(blank)'}`;
  const a = agg[k] = agg[k] || { n: 0, sum: 0 };
  a.n++; a.sum += num(r['Payout Value']); total += num(r['Payout Value']);
  const c = String(r['Claim Status']).trim(); if (c) claims[c] = (claims[c] || 0) + 1;
}
console.log(month);
Object.entries(agg).sort().forEach(([k, a]) => console.log(`  ${k.padEnd(32)} n=${String(a.n).padStart(4)}  sum=${r2(a.sum)}`));
console.log('  TOTAL', r2(total), '| claim statuses:', claims);