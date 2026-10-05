// Date-filtered P&L and delivery analytics. Reused by both the /pnl <period>
// Telegram command and the Mini App dashboard's period filter buttons, so
// they always show identical numbers.
const { readTab } = require('./sheets');
const { findCol } = require('./schema');
const { resolveDateRange, isWithinRange } = require('./dateUtils');

async function getPnlForRange(period) {
  const range = resolveDateRange(period); // null = all-time

  // 1. Load SKU Costing Master for automatic historical lookup
  const costingRows = await readTab('SKU_Master_Costing').catch(() => []);
  const costingMap = new Map();
  if (Array.isArray(costingRows) && costingRows.length > 1) {
    for (const r of costingRows.slice(1)) {
      if (!r || !r[1]) continue; // Col B: SKU ID
      const skuKey = String(r[1]).trim().toLowerCase();
      const customerPrice = parseFloat(r[4]) || 0;
      const bankPayout = parseFloat(r[5]) || 0;
      const purchaseCost = parseFloat(r[7]) || 0;
      const packagingCost = parseFloat(r[8]) || 0;
      const influencerCost = parseFloat(r[10]) || 0;
      const totalCost = parseFloat(r[11]) || (purchaseCost + packagingCost + influencerCost);

      costingMap.set(skuKey, {
        customerPrice,
        bankPayout,
        purchaseCost,
        packagingCost,
        influencerCost,
        totalCost,
      });
    }
  }

  // 2. Process Dispatched Orders & Dynamic Costing
  const orders = await readTab('Orders_Dispatch');
  const oh = orders[0] || [];
  const orderDateCol = findCol(oh, 'Order Date');
  const grossCol = [findCol(oh, 'Invoice Amount'), findCol(oh, 'Customer Price'), findCol(oh, 'Total Amount')].find((c) => c !== -1) ?? -1;
  const prodCol = findCol(oh, 'Product Cost');
  const packCol = findCol(oh, 'Packaging Cost');
  const skuCol = [findCol(oh, 'SKU ID'), findCol(oh, 'SKU'), findCol(oh, 'Style ID')].find((c) => c !== -1) ?? -1;

  let dispatchedCount = 0, grossSales = 0, orderCost = 0;
  for (const r of orders.slice(1)) {
    if (!isWithinRange(r[orderDateCol], range)) continue;
    dispatchedCount += 1;

    const skuKey = skuCol !== -1 ? String(r[skuCol] || '').trim().toLowerCase() : '';
    const costInfo = costingMap.get(skuKey);

    // Calculate Gross Sales (with fallback to SKU Master price)
    let rowGross = grossCol !== -1 ? Number(r[grossCol]) || 0 : 0;
    if (!rowGross && costInfo) {
      rowGross = costInfo.customerPrice;
    }
    grossSales += rowGross;

    // Calculate Costs (with fallback to SKU Master costing)
    let rowProd = prodCol !== -1 ? Number(r[prodCol]) || 0 : 0;
    let rowPack = packCol !== -1 ? Number(r[packCol]) || 0 : 0;

    if (!rowProd && !rowPack && costInfo) {
      orderCost += costInfo.totalCost;
    } else {
      orderCost += rowProd + rowPack;
    }
  }

  // 3. Process Returns
  const returns = await readTab('Returns_Tracking');
  const rh = returns[0] || [];
  const returnDateCol = findCol(rh, 'Return Date');
  const returnTypeCol = findCol(rh, 'Return Type');
  const conditionCol = findCol(rh, 'Condition');

  let rtoCount = 0, customerReturnCount = 0, tamperedCount = 0;
  for (const r of returns.slice(1)) {
    if (!isWithinRange(r[returnDateCol], range)) continue;
    if ((r[returnTypeCol] || '') === 'RTO Return') rtoCount += 1;
    if ((r[returnTypeCol] || '') === 'Customer Return') customerReturnCount += 1;
    if ((r[conditionCol] || '') === 'TAMPERED') tamperedCount += 1;
  }

  const deliveredCount = Math.max(dispatchedCount - rtoCount - tamperedCount, 0);

  // 4. Process Dead Losses from Expired Claims
  const claims = await readTab('Claims_Manager');
  const ch = claims[0] || [];
  const claimReceivedCol = findCol(ch, 'Received Date');
  const claimStatusCol = findCol(ch, 'Status');
  const claimValueCol = findCol(ch, 'Claim Value');

  let deadLosses = 0;
  for (const r of claims.slice(1)) {
    if (!isWithinRange(r[claimReceivedCol], range)) continue;
    if ((r[claimStatusCol] || '').startsWith('Claim Expired')) {
      deadLosses += Number(r[claimValueCol]) || 0;
    }
  }

  // 5. Process Bank Settlement Received
  const payments = await readTab('Payment_Reconciliation');
  const ph = payments[0] || [];
  const paymentDateCol = findCol(ph, 'Payment Date');
  const netCol = findCol(ph, 'Net Settlement');

  let actualNetSettlement = 0;
  for (const r of payments.slice(1)) {
    if (!isWithinRange(r[paymentDateCol], range)) continue;
    actualNetSettlement += Number(r[netCol]) || 0;
  }

  // Net Real Profit = Bank Settlement - Product/Packaging Costs - Dead Losses
  const netRealProfit = actualNetSettlement - orderCost - deadLosses;

  return {
    period: period || 'all_time',
    range: range ? { from: range[0], to: range[1] } : null,
    volume: {
      dispatched: dispatchedCount,
      delivered: deliveredCount,
      rto: rtoCount,
      customerReturns: customerReturnCount,
      tampered: tamperedCount,
    },
    financials: {
      grossSales: Math.round(grossSales * 100) / 100,
      actualNetSettlement: Math.round(actualNetSettlement * 100) / 100,
      totalCost: Math.round(orderCost * 100) / 100,
      deadLosses: Math.round(deadLosses * 100) / 100,
      netRealProfit: Math.round(netRealProfit * 100) / 100,
    },
  };
}

module.exports = { getPnlForRange };