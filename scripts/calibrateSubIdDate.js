const XLSX = require('xlsx'), fs = require('fs');
const IST = 19800000, H = 36e5;
const iso = d => typeof d === 'number' ? new Date((d - 25569) * 864e5).toISOString().slice(0, 10) : String(d).slice(0, 10);
const shifted = id => Number(BigInt(String(id).replace(/_\d+$/, '')) >> 22n);

const pairs = [];
for (const f of fs.readdirSync('.').filter(f => /order_summary.*\.xlsx$/i.test(f)))
  XLSX.utils.sheet_to_json(XLSX.readFile(f).Sheets.Sheet1, { defval: '' }).forEach(r => {
    const id = String(r['Sub orderId']).trim();
    if (/^\d{15,19}(?:_\d+)?$/.test(id)) pairs.push({ s: shifted(id), d: iso(r['Order Date']) });
  });

const med = a => a.sort((x, y) => x - y)[a.length >> 1];
const guess = med(pairs.map(p => Date.parse(p.d + 'T12:00:00Z') - IST - p.s));
const hits = e => pairs.filter(p => new Date(p.s + e + IST).toISOString().slice(0, 10) === p.d).length;

let max = -1, good = [];
for (let o = -24 * H; o <= 24 * H; o += 6e5) {
  const h = hits(guess + o);
  if (h > max) { max = h; good = [guess + o]; } else if (h === max) good.push(guess + o);
}
const epoch = Math.round((good[0] + good[good.length - 1]) / 2);
console.log('\n===== SUB ORDER ID CALIBRATION =====');
console.log('Pairs tested:', pairs.length, '| Exact date match:', max, `(${(100 * max / pairs.length).toFixed(1)}%)`);
console.log('SUBID_EPOCH_MS =', epoch, '| Epoch Date:', new Date(epoch).toISOString());