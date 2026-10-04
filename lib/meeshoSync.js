const { readTab, appendRows, batchUpdateRows } = require('./sheets');
const { findCol, dispatchRecordToRow } = require('./schema');

/**
 * SKU Cost and Packaging Cost Map
 */
async function getSkuCostMap() {
  try {
    const rows = await readTab('SKU_Master_Costing');
    if (!rows || rows.length < 2) return new Map();
    const map = new Map();
    for (let i = 1; i < rows.length; i++) {
      const sku = (rows[i][0] || '').trim();
      const cost = parseFloat(rows[i][2]) || 0;
      const pkg = parseFloat(rows[i][3]) || 0;
      if (sku) map.set(sku, { cost, pkg });
    }
    return map;
  } catch (err) {
    console.error('[MJM Sync] Error reading SKU costs:', err.message);
    return new Map();
  }
}

/**
 * 1. Smart Batch Upsert for Orders_Dispatch
 * Headers: Packet ID | Forward AWB | Sub Order ID | Customer Name | SKU | Product Name | Qty | Invoice Amount | Product Cost | Packaging Cost | Payment Mode | Courier Partner | City | District | State | Pincode | Order Date | Status | Action Handler | Last Updated
 */
async function syncOrders(orders) {
  if (!orders || !orders.length) return { inserted: 0, updated: 0, skipped: 0 };
  const costMap = await getSkuCostMap();
  const existing = await readTab('Orders_Dispatch');
  const header = existing[0] || [];

  const subOrderCol = findCol(header, 'Sub Order ID');
  const statusCol = findCol(header, 'Status');
  const awbCol = findCol(header, 'Forward AWB');
  const courierCol = findCol(header, 'Courier Partner');
  const lastUpdatedCol = findCol(header, 'Last Updated');

  const existingMap = new Map();
  if (subOrderCol !== -1) {
    for (let i = 1; i < existing.length; i++) {
      const subOrderId = (existing[i][subOrderCol] || '').trim();
      if (subOrderId) existingMap.set(subOrderId, { rowIndex1Based: i + 1, rowData: [...existing[i]] });
    }
  }

  const rowsToInsert = [];
  const updatesToBatch = [];
  let nextPacketNum = existing.length;
  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

  for (const ord of orders) {
    const subId = (ord.subOrderId || '').trim();
    if (!subId) continue;

    if (existingMap.has(subId)) {
      const { rowIndex1Based, rowData } = existingMap.get(subId);
      let hasChanges = false;

      if (ord.status && statusCol !== -1 && rowData[statusCol] !== ord.status) {
        rowData[statusCol] = ord.status;
        hasChanges = true;
      }
      if (ord.forwardAwb && awbCol !== -1 && !rowData[awbCol]) {
        rowData[awbCol] = ord.forwardAwb;
        hasChanges = true;
      }
      if (ord.courierPartner && courierCol !== -1 && !rowData[courierCol]) {
        rowData[courierCol] = ord.courierPartner;
        hasChanges = true;
      }

      if (hasChanges) {
        if (lastUpdatedCol !== -1) rowData[lastUpdatedCol] = nowStr;
        updatesToBatch.push({ rowIndex1Based, rowValues: rowData });
      }
    } else {
      const costs = costMap.get(ord.sku) || { cost: 0, pkg: 0 };
      const newRow = dispatchRecordToRow(
        header,
        {
          ...ord,
          productCost: costs.cost,
          packagingCost: costs.pkg,
          actionHandler: 'MJM Auto-Sync',
          lastUpdated: nowStr,
        },
        `PKT-${String(nextPacketNum).padStart(5, '0')}`
      );
      rowsToInsert.push(newRow);
      nextPacketNum++;
      existingMap.set(subId, { rowIndex1Based: nextPacketNum, rowData: newRow });
    }
  }

  if (updatesToBatch.length > 0) {
    await batchUpdateRows('Orders_Dispatch', updatesToBatch);
  }
  if (rowsToInsert.length > 0) {
    await appendRows('Orders_Dispatch', rowsToInsert);
  }

  return {
    inserted: rowsToInsert.length,
    updated: updatesToBatch.length,
    totalProcessed: orders.length,
  };
}

/**
 * 2. Smart Sync for Payment_Reconciliation
 * Headers: Payment Date | Sub Order ID | Live Status | Gross Sale | Marketplace Fee | Return Shipping Fee | Net Settlement | Bank Status | Discrepancy
 */
async function syncPayments(payments) {
  if (!payments || !payments.length) return { inserted: 0, updated: 0 };

  const existing = await readTab('Payment_Reconciliation');
  const header = existing[0] || [];
  const dateCol = findCol(header, 'Payment Date');
  const subOrderCol = findCol(header, 'Sub Order ID');
  const statusCol = findCol(header, 'Live Status');
  const grossCol = findCol(header, 'Gross Sale');
  const feeCol = findCol(header, 'Marketplace Fee');
  const retShipCol = findCol(header, 'Return Shipping Fee');
  const netCol = findCol(header, 'Net Settlement');
  const bankStatusCol = findCol(header, 'Bank Status');

  const existingMap = new Map();
  if (dateCol !== -1 && subOrderCol !== -1) {
    for (let i = 1; i < existing.length; i++) {
      const key = `${(existing[i][dateCol] || '').trim()}_${(existing[i][subOrderCol] || '').trim()}`;
      if (key) existingMap.set(key, { rowIndex1Based: i + 1, rowData: [...existing[i]] });
    }
  }

  const rowsToInsert = [];
  const updatesToBatch = [];

  for (const pay of payments) {
    const pDate = (pay.paymentDate || '').trim();
    const sId = (pay.subOrderId || pay.transferId || '').trim();
    const key = `${pDate}_${sId}`;

    if (existingMap.has(key)) {
      // Agar pehle se entry hai par amounts 0 ya empty hain, unhe update karein
      const { rowIndex1Based, rowData } = existingMap.get(key);
      let changed = false;

      if (grossCol !== -1 && (!rowData[grossCol] || Number(rowData[grossCol]) === 0) && pay.grossSale) {
        rowData[grossCol] = pay.grossSale;
        changed = true;
      }
      if (feeCol !== -1 && (!rowData[feeCol] || Number(rowData[feeCol]) === 0) && pay.marketplaceFee) {
        rowData[feeCol] = pay.marketplaceFee;
        changed = true;
      }
      if (retShipCol !== -1 && (!rowData[retShipCol] || Number(rowData[retShipCol]) === 0) && pay.returnShippingFee) {
        rowData[retShipCol] = pay.returnShippingFee;
        changed = true;
      }
      if (netCol !== -1 && (!rowData[netCol] || Number(rowData[netCol]) === 0) && pay.netSettlement) {
        rowData[netCol] = pay.netSettlement;
        changed = true;
      }
      if (statusCol !== -1 && pay.liveStatus && rowData[statusCol] !== pay.liveStatus) {
        rowData[statusCol] = pay.liveStatus;
        changed = true;
      }

      if (changed) {
        updatesToBatch.push({ rowIndex1Based, rowValues: rowData });
      }
    } else {
      // Nayi row create karein
      const row = new Array(header.length).fill('');
      if (dateCol !== -1) row[dateCol] = pDate;
      if (subOrderCol !== -1) row[subOrderCol] = sId;
      if (statusCol !== -1) row[statusCol] = pay.liveStatus || 'Settled';
      if (grossCol !== -1) row[grossCol] = pay.grossSale || 0;
      if (feeCol !== -1) row[feeCol] = pay.marketplaceFee || 0;
      if (retShipCol !== -1) row[retShipCol] = pay.returnShippingFee || 0;
      if (netCol !== -1) row[netCol] = pay.netSettlement || 0;
      if (bankStatusCol !== -1) row[bankStatusCol] = pay.bankStatus || 'Completed';

      rowsToInsert.push(row);
      existingMap.set(key, { rowIndex1Based: existing.length + rowsToInsert.length, rowData: row });
    }
  }

  if (updatesToBatch.length > 0) {
    await batchUpdateRows('Payment_Reconciliation', updatesToBatch);
  }
  if (rowsToInsert.length > 0) {
    await appendRows('Payment_Reconciliation', rowsToInsert);
  }

  return { inserted: rowsToInsert.length, updated: updatesToBatch.length, total: payments.length };
}

/**
 * 3. Smart Sync for Returns_Tracking
 * Headers: Return Date | Reverse AWB | Original AWB | Sub Order ID | Return Type | Courier | Rider Info | Condition | Status | Relinked AWB | Remarks
 */
async function syncReturns(returns) {
  if (!returns || !returns.length) return { inserted: 0, updated: 0 };

  const existing = await readTab('Returns_Tracking');
  const header = existing[0] || [];
  const reverseAwbCol = findCol(header, 'Reverse AWB');
  const subOrderCol = findCol(header, 'Sub Order ID');
  const statusCol = findCol(header, 'Status');

  const existingSet = new Set();
  if (reverseAwbCol !== -1 || subOrderCol !== -1) {
    for (let i = 1; i < existing.length; i++) {
      const rawKey = (reverseAwbCol !== -1 ? existing[i][reverseAwbCol] : '') || (subOrderCol !== -1 ? existing[i][subOrderCol] : '');
      if (rawKey) existingSet.add(rawKey.trim());
    }
  }

  const rowsToInsert = [];
  for (const ret of returns) {
    const idKey = (ret.reverseAwb || ret.subOrderId || '').trim();
    if (idKey && !existingSet.has(idKey)) {
      const row = new Array(header.length).fill('');
      const rDateCol = findCol(header, 'Return Date');
      const rAwbCol = findCol(header, 'Reverse AWB');
      const oAwbCol = findCol(header, 'Original AWB');
      const sIdCol = findCol(header, 'Sub Order ID');
      const rTypeCol = findCol(header, 'Return Type');
      const cCol = findCol(header, 'Courier');
      const riderCol = findCol(header, 'Rider Info');
      const condCol = findCol(header, 'Condition');
      const stCol = findCol(header, 'Status');

      if (rDateCol !== -1) row[rDateCol] = ret.returnDate || new Date().toISOString().slice(0, 10);
      if (rAwbCol !== -1) row[rAwbCol] = ret.reverseAwb || '';
      if (oAwbCol !== -1) row[oAwbCol] = ret.originalAwb || '';
      if (sIdCol !== -1) row[sIdCol] = ret.subOrderId || '';
      if (rTypeCol !== -1) row[rTypeCol] = ret.returnType || 'RTO';
      if (cCol !== -1) row[cCol] = ret.courier || '';
      if (riderCol !== -1) row[riderCol] = ret.riderInfo || '';
      if (condCol !== -1) row[condCol] = ret.condition || 'Pending Verification';
      if (stCol !== -1) row[stCol] = ret.status || 'In Transit';

      rowsToInsert.push(row);
      existingSet.add(idKey);
    }
  }

  if (rowsToInsert.length > 0) {
    await appendRows('Returns_Tracking', rowsToInsert);
  }

  return { inserted: rowsToInsert.length, total: returns.length };
}

/**
 * Unified Sync Pipeline
 */
async function processMeeshoSync(payload) {
  const { orders = [], returns = [], payments = [] } = payload;
  const orderResult = await syncOrders(orders);
  const returnResult = await syncReturns(returns);
  const paymentResult = await syncPayments(payments);

  return {
    orderResult,
    returnResult,
    paymentResult,
  };
}

module.exports = { syncOrders, syncPayments, syncReturns, processMeeshoSync };