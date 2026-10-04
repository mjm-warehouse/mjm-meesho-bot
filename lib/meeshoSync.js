const { readTab, appendRows, batchUpdateRows } = require('./sheets');
const { findCol, dispatchRecordToRow } = require('./schema');

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
    if (r[skuCol]) {
      map[r[skuCol].trim()] = {
        productName: r[nameCol] || '',
        productCost: Number(r[prodCol]) || 0,
        packagingCost: Number(r[packCol]) || 0,
      };
    }
  }
  return map;
}

/**
 * Smart Batch Upsert: Naya order hai toh append karega,
 * purana order hai toh status/AWB update karega (NO DUPLICATES).
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
  for (let i = 1; i < existing.length; i++) {
    const r = existing[i];
    const subId = (r[subOrderCol] || '').trim();
    if (subId) {
      existingMap.set(subId, { rowIndex1Based: i + 1, rowData: [...r] });
    }
  }

  const rowsToInsert = [];
  const updatesToBatch = [];
  let nextPacketNum = existing.length;
  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

  for (const o of orders) {
    const subId = (o.subOrderId || '').trim();
    if (!subId) continue;

    if (existingMap.has(subId)) {
      const { rowIndex1Based, rowData } = existingMap.get(subId);
      let hasChanges = false;

      if (o.status && o.status !== rowData[statusCol]) {
        rowData[statusCol] = o.status;
        hasChanges = true;
      }
      if (o.forwardAwb && o.forwardAwb !== rowData[awbCol]) {
        rowData[awbCol] = o.forwardAwb;
        hasChanges = true;
      }
      if (o.courierPartner && o.courierPartner !== 'Unknown' && o.courierPartner !== rowData[courierCol]) {
        rowData[courierCol] = o.courierPartner;
        hasChanges = true;
      }

      if (hasChanges) {
        if (lastUpdatedCol !== -1) rowData[lastUpdatedCol] = nowStr;
        updatesToBatch.push({ rowIndex1Based, rowValues: rowData });
      }
    } else {
      const skuKey = (o.sku || '').trim();
      const cost = costMap[skuKey] || {};
      nextPacketNum += 1;

      const newRow = dispatchRecordToRow(
        {
          forwardAwb: o.forwardAwb || '',
          subOrderId: subId,
          customerName: o.customerName || 'Meesho Customer',
          sku: skuKey,
          productName: cost.productName || o.productName || '',
          qty: o.qty || 1,
          invoiceAmount: Number(o.invoiceAmount) || 0,
          productCost: cost.productCost || 0,
          packagingCost: cost.packagingCost || 0,
          paymentMode: o.paymentMode || 'Online/COD',
          courierPartner: o.courierPartner || 'Meesho Logistics',
          city: o.city || '',
          district: o.district || '',
          state: o.state || '',
          pincode: o.pincode || '',
          orderDate: o.orderDate || new Date().toISOString().slice(0, 10),
          status: o.status || 'Ready to Ship',
          actionHandler: 'MJM Auto-Sync',
          lastUpdated: nowStr,
        },
        `PKT-${String(nextPacketNum).padStart(5, '0')}`
      );

      rowsToInsert.push(newRow);
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

async function processMeeshoSync(payload) {
  const { orders = [], returns = [] } = payload;
  const orderResult = await syncOrders(orders);
  return {
    orderResult,
    returnResult: { count: returns.length },
  };
}

module.exports = { syncOrders, processMeeshoSync };