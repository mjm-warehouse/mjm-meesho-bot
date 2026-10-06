const { parseDispatchPdf } = require('../parsers/dispatchParser');
const { appendRows, readTab } = require('./sheets');
const { dispatchRecordToRow, findCol } = require('./schema');
const { recordDispatchOrder } = require('./riskEngine');
const { decrementOnDispatch } = require('./inventoryEngine');
const { buildSeen, nextPacketNumber, partitionRecords } = require('./dispatchGuard');

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

async function processDispatchPdfImpl(pages) {
  const records = parseDispatchPdf(pages);
  if (!records.length) {
    return { count: 0, duplicates: 0, flagged: 0, exceptions: 0, records: [], lowStockAlerts: [] };
  }

  const costMap = await getSkuCostMap();
  const existing = await readTab('Orders_Dispatch');

  const part = partitionRecords(records, buildSeen(existing));
  let duplicates = part.duplicates;
  const flaggedSet = new Set(part.flagged);
  let nextPacketNum = nextPacketNumber(existing);

  const rows = [];
  const keptRecords = [];
  const exceptionRows = [];
  const stamp = new Date().toISOString();

  for (const rec of part.fresh) {
    const cost = costMap[rec.sku];
    if (cost) {
      rec.productName = cost.productName;
      rec.productCost = cost.productCost;
      rec.packagingCost = cost.packagingCost;
    }

    const packetId = `PKT-${String(nextPacketNum++).padStart(5, '0')}`;
    rows.push(dispatchRecordToRow(rec, packetId));
    keptRecords.push(rec);

    if (flaggedSet.has(rec)) {
      exceptionRows.push([
        stamp,
        'KEPT_NO_SUB_ORDER_ID',
        rec.forwardAwb || '',
        packetId,
        JSON.stringify(rec).slice(0, 45000),
      ]);
    }
  }

  for (const e of part.exceptions) {
    exceptionRows.push([
      stamp,
      e.reason,
      e.rec.forwardAwb || '',
      '',
      JSON.stringify(e.rec).slice(0, 45000),
    ]);
  }

  if (rows.length) await appendRows('Orders_Dispatch', rows);
  if (exceptionRows.length) await appendRows('Dispatch_Exceptions', exceptionRows);

  // Sync repeat-customer tracking + live inventory for keptRecords
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
      if (stockResult && stockResult.lowStock) {
        lowStockAlerts.push(stockResult);
      }
    }
  }

  return {
    count: rows.length,
    duplicates,
    flagged: part.flagged.length,
    exceptions: part.exceptions.length,
    records: keptRecords,
    lowStockAlerts,
  };
}

let _lock = Promise.resolve();
const withLock = fn => {
  const run = _lock.then(fn, fn);
  _lock = run.catch(() => {});
  return run;
};

const processDispatchPdf = pages => withLock(() => processDispatchPdfImpl(pages));

module.exports = { processDispatchPdf };