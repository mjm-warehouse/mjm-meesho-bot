const { parseDispatchPdf } = require('../parsers/dispatchParser');
const { appendRows, readTab } = require('./sheets');
const { dispatchRecordToRow, findCol } = require('./schema');
const { recordDispatchOrder } = require('./riskEngine');

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
  if (!records.length) return { count: 0, duplicates: 0, records: [] };

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

  // Sync repeat-customer tracking: every newly dispatched order counts as
  // +1 Total Order for that customer/pincode in Customer_Risk_Intelligence
  // (skipped for duplicate AWBs, since those weren't actually re-added).
  for (const rec of keptRecords) {
    if (rec.customerName || rec.pincode) {
      await recordDispatchOrder({
        customerName: rec.customerName,
        pincode: rec.pincode,
        city: rec.city,
        state: rec.state,
      });
    }
  }

  return { count: rows.length, duplicates, records: keptRecords };
}

module.exports = { processDispatchPdf };