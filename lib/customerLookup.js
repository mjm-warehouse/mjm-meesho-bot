const { readTab } = require('./sheets');
const { findCol } = require('./schema');

async function lookupCustomer(query) {
  const rows = await readTab('Customer_Risk_Intelligence');
  const header = rows[0] || [];
  const nameCol = findCol(header, 'Customer Name');
  const pinCol = findCol(header, 'Pincode');
  const q = (query || '').toString().toLowerCase().trim();
  if (!q) return [];

  const matches = rows.slice(1).filter((r) =>
    (r[nameCol] || '').toString().toLowerCase().includes(q) ||
    (r[pinCol] || '').toString().includes(q)
  );

  return matches.slice(0, 10).map((r) => {
    const obj = {};
    header.forEach((h, i) => { if (h) obj[h] = r[i]; });
    return obj;
  });
}

module.exports = { lookupCustomer };