const { readTab, appendRows } = require('./sheets');
const { findCol, dispatchRecordToRow, returnRecordToRow, claimRecordToRow } = require('./schema');
const { recordDispatchOrder, recordTamperedReturn, recordRtoReturn } = require('./riskEngine');

const CLAIM_WINDOW_DAYS = 7;

function addDays(dateStr, days) {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(d.getTime())) d.setTime(Date.now());
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function getSkuCostMap() {
  const rows = await readTab('SKU_Master_Costing');
  const header = rows[0] || [];
  const skuCol = findCol(header, 'SKU ID');
  const nameCol = findCol(header, 'Product Name');
  const prodCol = findCol(header, 'Product Cost');
  const packCol = findCol(header, 'Packaging Cost');
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[skuCol]) map[r[skuCol]] = { productName: r[nameCol], productCost: Number(r[prodCol]) || 0, packagingCost: Number(r[packCol]) || 0 };
  }
  return map;
}

async function syncOrders(orders) {
  if (!orders || !orders.length) return { count: 0, duplicates: 0 };

  const costMap = await getSkuCostMap();
  const existing = await readTab('Orders_Dispatch');
  const header = existing[0] || [];
  const subOrderCol = findCol(header, 'Sub Order ID');
  const existingSubOrders = new Set(existing.slice(1).map((r) => r[subOrderCol]).filter(Boolean));

  let nextPacketNum = existing.length;
  let duplicates = 0;
  const rows = [];

  for (const o of orders) {
    if (!o.subOrderId || existingSubOrders.has(o.subOrderId)) {
      if (o.subOrderId) duplicates += 1;
      continue;
    }

    const cost = costMap[o.sku] || {};
    nextPacketNum += 1;
    rows.push(dispatchRecordToRow({
      forwardAwb: o.forwardAwb || null,
      subOrderId: o.subOrderId,
      customerName: o.customerName || null,
      sku: o.sku || null,
      productName: cost.productName || null,
      qty: o.qty || 1,
      invoiceAmount: Number(o.invoiceAmount) || 0,
      productCost: cost.productCost || 0,
      packagingCost: cost.packagingCost || 0,
      paymentMode: o.paymentMode || 'Unknown',
      courierPartner: o.courierPartner || 'Unknown',
      city: o.city || null,
      district: o.district || null,
      state: o.state || null,
      pincode: o.pincode || null,
      orderDate: o.orderDate || new Date().toISOString().slice(0, 10),
      status: o.status || 'Ready to Ship',
      actionHandler: 'Meesho Portal Sync',
      lastUpdated: new Date().toISOString(),
    }, `PKT-${String(nextPacketNum).padStart(5, '0')}`));

    existingSubOrders.add(o.subOrderId);
    await recordDispatchOrder({ customerName: o.customerName, pincode: o.pincode, city: o.city, state: o.state });
  }

  if (rows.length) await appendRows('Orders_Dispatch', rows);
  return { count: rows.length, duplicates };
}

async function syncReturns(returns) {
  if (!returns || !returns.length) return { count: 0, tamperedCount: 0 };

  const dispatchRows = await readTab('Orders_Dispatch');
  const dHeader = dispatchRows[0] || [];
  const col = (name) => findCol(dHeader, name);
  const bySubOrder = {};
  for (let i = 1; i < dispatchRows.length; i++) {
    const r = dispatchRows[i];
    const sid = r[col('Sub Order ID')];
    if (sid) {
      bySubOrder[sid] = {
        awb: r[col('Forward AWB')], sku: r[col('SKU')], customerName: r[col('Customer Name')],
        city: r[col('City')], state: r[col('State')], pincode: r[col('Pincode')],
        invoiceAmount: Number(r[col('Invoice Amount')]) || 0,
      };
    }
  }

  const returnRows = [];
  const claimRows = [];
  let tamperedCount = 0;

  for (const ret of returns) {
    const info = bySubOrder[ret.subOrderId];
    returnRows.push(returnRecordToRow({
      returnDate: ret.returnDate || new Date().toISOString().slice(0, 10),
      reverseAwb: ret.reverseAwb || null,
      originalAwb: info ? info.awb : null,
      subOrderId: ret.subOrderId || null,
      returnType: ret.returnType || 'RTO Return',
      courier: ret.courier || null,
      riderInfo: 'Meesho Portal Sync',
      condition: ret.condition || 'OK',
      status: ret.condition === 'TAMPERED' ? 'Flagged - Claims Manager' : 'Received - Portal Sync',
      relinkedAwb: null,
      remarks: 'Synced from Meesho Seller Portal',
    }));

    if (ret.condition === 'TAMPERED') {
      tamperedCount += 1;
      claimRows.push(claimRecordToRow({
        receivedDate: ret.returnDate,
        subOrderId: ret.subOrderId,
        reverseAwb: ret.reverseAwb,
        sku: info ? info.sku : null,
        claimDeadline: addDays(ret.returnDate, CLAIM_WINDOW_DAYS),
        daysLeft: CLAIM_WINDOW_DAYS,
        issueType: ret.returnType || 'Customer Return',
        status: 'Claim Pending',
        claimValue: info ? info.invoiceAmount : null,
        remarks: 'Synced from Meesho Seller Portal',
      }));

      if (info) {
        await recordTamperedReturn({
          customerName: info.customerName, pincode: info.pincode, city: info.city, state: info.state,
          lossAmount: info.invoiceAmount, subOrderId: ret.subOrderId,
        });
      }
    } else if (ret.returnType === 'RTO Return' && info) {
      await recordRtoReturn({
        customerName: info.customerName, pincode: info.pincode, city: info.city, state: info.state,
        subOrderId: ret.subOrderId,
      });
    }
  }

  await appendRows('Returns_Tracking', returnRows);
  if (claimRows.length) await appendRows('Claims_Manager', claimRows);
  return { count: returnRows.length, tamperedCount };
}

async function syncFinancials(financials) {
  if (!financials || !financials.length) return { count: 0, discrepancies: 0 };

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

  for (const f of financials) {
    const grossSale = Number(f.grossSale) || 0;
    const invoiceAmount = invoiceBySubOrder[f.subOrderId];
    let discrepancy = '';
    if (invoiceAmount !== undefined) {
      const diff = Number((grossSale - invoiceAmount).toFixed(2));
      if (Math.abs(diff) > 0.5) { discrepancy = `Diff of Rs.${diff} vs invoice`; discrepancies += 1; }
    } else {
      discrepancy = 'No matching order found';
      discrepancies += 1;
    }
    outRows.push([
      f.paymentDate || null, f.subOrderId || null, f.liveStatus || 'Pending',
      grossSale, Number(f.marketplaceFee) || 0, '', Number(f.netSettlement) || 0,
      'Synced', discrepancy,
    ]);
  }

  if (outRows.length) await appendRows('Payment_Reconciliation', outRows);
  return { count: outRows.length, discrepancies };
}

async function processMeeshoSync(payload) {
  const orderResult = await syncOrders(payload.orders);
  const returnResult = await syncReturns(payload.returns);
  const financialResult = await syncFinancials(payload.financials);
  return { orderResult, returnResult, financialResult };
}

module.exports = { processMeeshoSync };