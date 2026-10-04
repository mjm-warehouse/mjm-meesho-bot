const XLSX = require('xlsx');
const { readTab, appendRows } = require('./sheets');
const { findCol } = require('./schema');

const UNDER_SETTLEMENT_TOLERANCE = 5;

function normalizeHeader(h) {
  return (h || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function parseAmount(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  const cleaned = val.toString().replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned) || 0;
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

  // 1. Sheet selection: Prioritize Order-level settlement sheets
  let targetSheetName = wb.SheetNames[0];
  for (const name of wb.SheetNames) {
    if (/order|payment|settlement|details/i.test(name)) {
      targetSheetName = name;
      break;
    }
  }

  const sheet = wb.Sheets[targetSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

  if (!rows || rows.length <= 1) {
    return { count: 0, discrepancies: 0, underSettlementCount: 0 };
  }

  // 2. Locate Header Row (Meesho sometimes puts banner rows at top)
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i].map(normalizeHeader);
    if (r.some(col => col.includes('suborder') || col.includes('orderid') || col.includes('suborderno') || col.includes('orderdate'))) {
      headerRowIdx = i;
      break;
    }
  }

  const headerRow = rows[headerRowIdx];
  const idx = {
    subOrderId: findFieldIndex(headerRow, [
      'Sub-order Number', 'Sub Order Number', 'Sub Order No', 'Sub Order ID', 'SubOrderId', 'Order ID'
    ]),
    grossSale: findFieldIndex(headerRow, [
      'Total Sale Amount', 'Gross Sale Amount', 'Gross Sale', 'Order Amount', 'Total Invoice Amount', 'Gross Amount'
    ]),
    marketplaceFee: findFieldIndex(headerRow, [
      'Total Deductions', 'Marketplace Deductions', 'Marketplace Fee', 'Shipping Fee', 'Commission', 'Return Shipping Charge'
    ]),
    netSettlement: findFieldIndex(headerRow, [
      'Bank Settlement Amount', 'Final Settlement Amount', 'Net Settlement Amount', 'Net Settlement', 'Settlement Amount', 'Total Amount'
    ]),
    paymentDate: findFieldIndex(headerRow, [
      'Payment Date', 'Settlement Date', 'Payout Date', 'Invoice Date', 'Date'
    ]),
    orderStatus: findFieldIndex(headerRow, [
      'Live Order Status', 'Order Status', 'Status'
    ]),
  };

  if (idx.subOrderId === -1) {
    throw new Error('Is Excel sheet me "Sub Order No" ya "Sub-order Number" column nahi mila.');
  }

  // 3. Pre-load Orders_Dispatch to cross-check Invoice amounts
  const dispatchRows = await readTab('Orders_Dispatch');
  const dHeader = dispatchRows[0] || [];
  const dCol = (name) => findCol(dHeader, name);
  const invoiceBySubOrder = {};

  for (let i = 1; i < dispatchRows.length; i++) {
    const r = dispatchRows[i];
    const sid = r[dCol('Sub Order ID')];
    if (sid) {
      invoiceBySubOrder[sid.trim()] = parseAmount(r[dCol('Invoice Amount')]);
    }
  }

  const outRows = [];
  let discrepancies = 0;
  let underSettlementCount = 0;

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const rawSubOrderId = r[idx.subOrderId];
    if (!rawSubOrderId) continue;

    const subOrderId = rawSubOrderId.toString().trim().replace(/\s+/, '_');
    const grossSale = idx.grossSale !== -1 ? parseAmount(r[idx.grossSale]) : 0;
    const marketplaceFee = idx.marketplaceFee !== -1 ? parseAmount(r[idx.marketplaceFee]) : 0;
    const netSettlement = idx.netSettlement !== -1 ? parseAmount(r[idx.netSettlement]) : 0;
    const paymentDate = idx.paymentDate !== -1 ? (r[idx.paymentDate] || '').toString().trim() : '';
    const status = idx.orderStatus !== -1 && r[idx.orderStatus] ? r[idx.orderStatus].toString().trim() : 'Settled';

    const invoiceAmount = invoiceBySubOrder[subOrderId];
    const notes = [];

    if (invoiceAmount !== undefined && invoiceAmount > 0) {
      const diff = Number((grossSale - invoiceAmount).toFixed(2));
      if (Math.abs(diff) > 0.5) {
        notes.push(`Diff of Rs.${diff} vs invoice`);
        discrepancies += 1;
      }

      const expectedNet = invoiceAmount - marketplaceFee;
      const shortfall = Number((expectedNet - netSettlement).toFixed(2));
      if (shortfall > UNDER_SETTLEMENT_TOLERANCE) {
        notes.push(`⚠️ Under-Settlement: Rs.${shortfall} short`);
        underSettlementCount += 1;
      }
    } else {
      notes.push('No matching dispatch order found');
      discrepancies += 1;
    }

    outRows.push([
      paymentDate,
      subOrderId,
      status,
      grossSale,
      marketplaceFee,
      '',
      netSettlement,
      'Reconciled',
      notes.join(' | '),
    ]);
  }

  if (outRows.length > 0) {
    await appendRows('Payment_Reconciliation', outRows);
  }

  return { count: outRows.length, discrepancies, underSettlementCount };
}

module.exports = { processReconciliationFile };