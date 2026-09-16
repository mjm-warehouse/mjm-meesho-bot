const XLSX = require('xlsx');
const { readTab, appendRows } = require('./sheets');
const { findCol } = require('./schema');

function normalizeHeader(h) {
  return (h || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findFieldIndex(headerRow, candidates) {
  const normalized = headerRow.map(normalizeHeader);
  for (const c of candidates) {
    const nc = normalizeHeader(c);
    const idx = normalized.findIndex((h) => h === nc || h.includes(nc));
    if (idx !== -1) return idx;
  }
  return -1;
}

async function processReconciliationFile(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

  if (!rows.length) return { count: 0, discrepancies: 0 };

  const headerRow = rows[0];
  const idx = {
    subOrderId: findFieldIndex(headerRow, ['Sub Order ID', 'SubOrderId', 'Order ID']),
    grossSale: findFieldIndex(headerRow, ['Gross Sale Amount', 'Gross Sale', 'Order Amount']),
    marketplaceFee: findFieldIndex(headerRow, ['Marketplace Deductions', 'Marketplace Fee', 'Shipping Fee', 'Commission']),
    netSettlement: findFieldIndex(headerRow, ['Net Settlement Amount', 'Net Settlement', 'Settlement Amount']),
    paymentDate: findFieldIndex(headerRow, ['Payment Date', 'Settlement Date']),
  };

  if (idx.subOrderId === -1) {
    throw new Error('Could not find a "Sub Order ID" column in the uploaded file.');
  }

  const dispatchRows = await readTab('Orders_Dispatch');
  const dHeader = dispatchRows[0] || [];
  const dCol = (name) => findCol(dHeader, name);
  const invoiceBySubOrder = {};
  for (let i = 1; i < dispatchRows.length; i++) {
    const r = dispatchRows[i];
    const sid = r[dCol('Sub Order ID')];
    if (sid) invoiceBySubOrder[sid] = Number(r[dCol('Invoice Amount')]) || 0;
  }

  const outRows = [];
  let discrepancies = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const subOrderId = r[idx.subOrderId];
    if (!subOrderId) continue;

    const grossSale = idx.grossSale !== -1 ? Number(r[idx.grossSale]) || 0 : 0;
    const marketplaceFee = idx.marketplaceFee !== -1 ? Number(r[idx.marketplaceFee]) || 0 : 0;
    const netSettlement = idx.netSettlement !== -1 ? Number(r[idx.netSettlement]) || 0 : 0;
    const paymentDate = idx.paymentDate !== -1 ? r[idx.paymentDate] : null;

    const invoiceAmount = invoiceBySubOrder[subOrderId];
    let discrepancy = '';
    if (invoiceAmount !== undefined) {
      const diff = Number((grossSale - invoiceAmount).toFixed(2));
      if (Math.abs(diff) > 0.5) {
        discrepancy = `Diff of Rs.${diff} vs invoice`;
        discrepancies += 1;
      }
    } else {
      discrepancy = 'No matching order found';
      discrepancies += 1;
    }

    outRows.push([
      paymentDate, subOrderId, 'Settled', grossSale, marketplaceFee,
      '', netSettlement, 'Reconciled', discrepancy,
    ]);
  }

  if (outRows.length) await appendRows('Payment_Reconciliation', outRows);
  return { count: outRows.length, discrepancies };
}

module.exports = { processReconciliationFile };