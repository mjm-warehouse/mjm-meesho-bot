const { parseDispatchPdf } = require('../parsers/dispatchParser');
const { appendRows, readTab } = require('./sheets');
const { dispatchRecordToRow, findCol } = require('./schema');
const { recordDispatchOrder } = require('./riskEngine');
const { decrementOnDispatch } = require('./inventoryEngine');

async function getSkuCostMap() {
  const rows = await readTab('SKU_Master_Costing');
  const header = rows[0] || [];
  const skuCol = findCol(header, 'SKU ID');
  const nameCol = findCol(header, 'Product Name');
  const prodCostCol = findCol(header, 'Product Cost');
  const packCostCol = findCol(header, 'Packaging Cost');

  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const skuId = row[skuCol];
    if (skuId) {
      map[skuId] = {
        productName: row[nameCol],
        productCost: Number(row[prodCostCol]) || 0,
        packagingCost: Number(row[packCostCol]) || 0,
      };
    }
  }
  return map;
}

async function processDispatchPdf(pages) {
  const records = parseDispatchPdf(pages);
  if (!records.length) return { count: 0, duplicates: 0, records: [], lowStockAlerts: [] };

  const costMap = await getSkuCostMap();
  const existing = await readTab('Orders_Dispatch');
  const existHeader = existing[0] || [];
  const awbCol = findCol(existHeader, 'Forward AWB');
  const existingAwbs = new Set(
    existing.slice(1).map((r) => r[awbCol]).filter(Boolean)
  );

  let nextPacketNum = existing.length;
  let duplicates = 0;
  const rows = [];
  const keptRecords = [];

  for (const rec of records) {
    if (rec.forwardAwb && existingAwbs.has(rec.forwardAwb)) {
      duplicates += 1;
      continue;
    }

    const cost = costMap[rec.sku];
    if (cost) {
      rec.productName = cost.productName;
      rec.productCost = cost.productCost;
      rec.packagingCost = cost.packagingCost;
    }

    nextPacketNum += 1;
    const packetId = `PKT-${String(nextPacketNum).padStart(5, '0')}`;
    rows.push(dispatchRecordToRow(rec, packetId));
    keptRecords.push(rec);

    if (rec.forwardAwb) existingAwbs.add(rec.forwardAwb);
  }

  if (rows.length) await appendRows('Orders_Dispatch', rows);

  // Sync repeat-customer tracking + live inventory for every newly
  // dispatched order (skipped for duplicate AWBs, since those weren't
  // actually re-added).
  const lowStockAlerts = [];
  for (const rec of keptRecords) {
    if (rec.customerName || rec.pincode) {
      await recordDispatchOrder({
        customerName: rec.customerName,
        pincode: rec.pincode,
        city: rec.city,
        state: rec.state,
      });
    }
    if (rec.sku) {
      const stockResult = await decrementOnDispatch(rec.sku, rec.qty || 1);
      if (stockResult && stockResult.lowStock) lowStockAlerts.push(stockResult);
    }
  }

  return { count: rows.length, duplicates, records: keptRecords, lowStockAlerts };
}

module.exports = { processDispatchPdf };