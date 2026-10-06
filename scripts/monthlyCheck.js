const XLSX = require('xlsx'), fs = require('fs');
const T = {
  '2026-06': { delivered: 222, net: 25600.92, transit: 0 },
  '2026-07': { delivered: 452, net: 85534.39, transit: 0 },
  '2026-08': { delivered: 605, net: 93658.44, transit: 0 },
  '2026-09': { delivered: 583, net: 97760.99, transit: 12249.35 },
  '2026-10': { delivered: 2, net: 5350.23, transit: 5008.00 },
};
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const iso = d => typeof d === 'number' ? new Date((d - 25569) * 864e5).toISOString().slice(0, 10) : String(d).slice(0, 10);
const r2 = n => Math.round(n * 100) / 100;

const orders = new Map();
for (const f of fs.readdirSync('.').filter(f => /order_summary.*\.xlsx$/i.test(f)).sort()) {
  const wb = XLSX.readFile(f);
  XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).forEach(r => {
    const id = String(r['Sub orderId']).trim();
    if (id) orders.set(id, r);                       // later file wins
  });
}
const M = {}, statuses = {};
for (const r of orders.values()) {
  const m = iso(r['Order Date']).slice(0, 7);
  const x = M[m] = M[m] || { rows: 0, delivered: 0, all: 0, settled: 0, open: 0, openN: 0 };
  const st = String(r['Order Status']).trim(), pay = num(r['Payout Value']);
  const settled = String(r['Payout Status']).trim().toUpperCase() === 'SETTLED';
  statuses[st] = (statuses[st] || 0) + 1;
  x.rows++; x.all += pay;
  if (/^delivered$/i.test(st)) x.delivered++;
  if (settled) x.settled += pay; else if (pay) { x.open += pay; x.openN++; }
}
console.log('Order Status values:', statuses);
for (const m of Object.keys(M).sort()) {
  const x = M[m], t = T[m];
  console.log(`\n${m}: rows ${x.rows} | delivered ${x.delivered}${t ? ` (target ${t.delivered})` : ''}`);
  console.log(`  payout all ${r2(x.all)}${t ? ` (target ${t.net}, diff ${r2(x.all - t.net)})` : ''}`);
  console.log(`  settled ${r2(x.settled)} | open(non-zero) ${r2(x.open)} in ${x.openN} orders${t && t.transit ? ` (target in-transit ${t.transit})` : ''}`);
}