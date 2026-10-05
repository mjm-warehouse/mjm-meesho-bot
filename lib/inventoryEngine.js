// Live stock tracking on SKU_Master_Costing.
// Supports both new 15-column schema ("Current Stock", "Purchase Cost")
// and legacy 10-column schema ("Current Balance", "Product Cost").
const { readTab, updateRow } = require('./sheets');
const { findCol } = require('./schema');

const LOW_STOCK_THRESHOLD = 5;

// Resolves column indices supporting both 15-col and 10-col header variants
function getColumnMappings(header) {
  const skuCol = findCol(header, 'SKU ID');
  const nameCol = findCol(header, 'Product Name');

  // Stock: try "Current Stock" (15-col) first, fallback to "Current Balance" (10-col)
  let stockCol = findCol(header, 'Current Stock');
  if (stockCol === -1) stockCol = findCol(header, 'Current Balance');

  // Price: try "Customer Price" (15-col) first, fallback to "Listing Sale Price" (10-col)
  let priceCol = findCol(header, 'Customer Price');
  if (priceCol === -1) priceCol = findCol(header, 'Listing Sale Price');

  // Purchase/Product Cost
  let costCol = findCol(header, 'Purchase Cost');
  if (costCol === -1) costCol = findCol(header, 'Product Cost');

  const physicalCol = findCol(header, 'Physical Stock');
  const listedCol = findCol(header, 'Meesho Listed Stock');

  return { skuCol, nameCol, stockCol, priceCol, costCol, physicalCol, listedCol };
}

async function adjustStock(sku, delta) {
  if (!sku || !delta) return null;

  const rows = await readTab('SKU_Master_Costing');
  if (!rows || !rows.length) return null;

  const header = rows[0] || [];
  const { skuCol, stockCol } = getColumnMappings(header);

  if (skuCol === -1 || stockCol === -1) return null;

  const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[skuCol]).trim() === String(sku).trim());
  if (rowIdx < 0) return null;

  const row = [...rows[rowIdx]];
  const currentVal = Number(row[stockCol]) || 0;
  const newBalance = Math.max(currentVal + delta, 0);
  row[stockCol] = newBalance;

  await updateRow('SKU_Master_Costing', rowIdx + 1, row);

  return { sku, newBalance, lowStock: newBalance <= LOW_STOCK_THRESHOLD };
}

async function decrementOnDispatch(sku, qty = 1) {
  return adjustStock(sku, -Math.abs(Number(qty) || 1));
}

async function incrementOnReturn(sku, qty = 1) {
  return adjustStock(sku, Math.abs(Number(qty) || 1));
}

// Returns every SKU's current stock snapshot for Mini App & commands
async function listInventory() {
  const rows = await readTab('SKU_Master_Costing');
  if (!rows || !rows.length) return [];

  const header = rows[0] || [];
  const { skuCol, nameCol, stockCol, priceCol, physicalCol, listedCol } = getColumnMappings(header);

  if (skuCol === -1) return [];

  return rows
    .slice(1)
    .filter((r) => r && r[skuCol] && String(r[skuCol]).trim())
    .map((r) => {
      const currentBalance = stockCol !== -1 && r[stockCol] !== undefined ? Number(r[stockCol]) || 0 : null;
      const listingPrice = priceCol !== -1 && r[priceCol] !== undefined ? Number(r[priceCol]) || 0 : null;

      return {
        sku: String(r[skuCol]).trim(),
        productName: nameCol !== -1 && r[nameCol] ? String(r[nameCol]).trim() : '',
        listingPrice,
        physicalStock: physicalCol !== -1 ? Number(r[physicalCol]) || 0 : null,
        currentBalance,
        meeshoListedStock: listedCol !== -1 ? Number(r[listedCol]) || 0 : null,
        lowStock: currentBalance !== null && currentBalance <= LOW_STOCK_THRESHOLD,
      };
    });
}

module.exports = {
  decrementOnDispatch,
  incrementOnReturn,
  listInventory,
  LOW_STOCK_THRESHOLD,
};