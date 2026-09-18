// Live stock tracking on SKU_Master_Costing. "Current Balance" is the
// warehouse-ready stock count: decremented on every dispatch, incremented
// when a return comes back in OK condition (re-sellable).
//
// Non-breaking: if a sheet hasn't added the "Current Balance" / other new
// columns yet, these functions silently no-op (return null) rather than
// crashing - dispatch/return logging itself is never blocked by inventory
// tracking being unset up.
const { readTab, updateRow } = require('./sheets');
const { findCol } = require('./schema');

const LOW_STOCK_THRESHOLD = 5;

async function adjustStock(sku, delta) {
  if (!sku || !delta) return null;

  const rows = await readTab('SKU_Master_Costing');
  const header = rows[0] || [];
  const skuCol = findCol(header, 'SKU ID');
  const balanceCol = findCol(header, 'Current Balance');
  if (balanceCol === -1) return null; // column not added to the sheet yet

  const rowIdx = rows.findIndex((r, i) => i > 0 && r[skuCol] === sku);
  if (rowIdx < 0) return null; // unknown SKU - nothing to adjust

  const row = [...rows[rowIdx]];
  const newBalance = Math.max((Number(row[balanceCol]) || 0) + delta, 0);
  row[balanceCol] = newBalance;
  await updateRow('SKU_Master_Costing', rowIdx + 1, row);

  return { sku, newBalance, lowStock: newBalance <= LOW_STOCK_THRESHOLD };
}

// Called on every newly dispatched unit.
async function decrementOnDispatch(sku, qty = 1) {
  return adjustStock(sku, -Math.abs(Number(qty) || 1));
}

// Called when a returned parcel is inwarded in OK (re-sellable) condition.
async function incrementOnReturn(sku, qty = 1) {
  return adjustStock(sku, Math.abs(Number(qty) || 1));
}

// Returns every SKU's current stock snapshot, for the dashboard inventory tab.
async function listInventory() {
  const rows = await readTab('SKU_Master_Costing');
  const header = rows[0] || [];
  const skuCol = findCol(header, 'SKU ID');
  const nameCol = findCol(header, 'Product Name');
  const listingCol = findCol(header, 'Listing Sale Price');
  const physicalCol = findCol(header, 'Physical Stock');
  const balanceCol = findCol(header, 'Current Balance');
  const listedCol = findCol(header, 'Meesho Listed Stock');

  return rows.slice(1).filter((r) => r[skuCol]).map((r) => {
    const currentBalance = balanceCol !== -1 ? Number(r[balanceCol]) || 0 : null;
    return {
      sku: r[skuCol],
      productName: nameCol !== -1 ? r[nameCol] : '',
      listingPrice: listingCol !== -1 ? Number(r[listingCol]) || 0 : null,
      physicalStock: physicalCol !== -1 ? Number(r[physicalCol]) || 0 : null,
      currentBalance,
      meeshoListedStock: listedCol !== -1 ? Number(r[listedCol]) || 0 : null,
      lowStock: currentBalance !== null && currentBalance <= LOW_STOCK_THRESHOLD,
    };
  });
}

module.exports = { decrementOnDispatch, incrementOnReturn, listInventory, LOW_STOCK_THRESHOLD };