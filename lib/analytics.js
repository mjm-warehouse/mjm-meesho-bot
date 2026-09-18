// Date-filtered P&L and delivery analytics. Reused by both the /pnl <period>
// Telegram command and the Mini App dashboard's period filter buttons, so
// they always show identical numbers.
const { readTab } = require('./sheets');
const { findCol } = require('./schema');
const { resolveDateRange, isWithinRange } = require('./dateUtils');

async function getPnlForRange(period) {
  const range = resolveDateRange(period); // null = all-time

  const orders = await readTab('Orders_Dispatch');
  const oh = orders[0] || [];
  const orderDateCol = findCol(oh, 'Order Date');
  const grossCol = findCol(oh, 'Invoice Amount');
  const prodCol = findCol(oh, 'Product Cost');
  const packCol = findCol(oh, 'Packaging Cost');

  let dispatchedCount = 0, grossSales = 0, orderCost = 0;
  for (const r of orders.slice(1)) {
    if (!isWithinRange(r[orderDateCol], range)) continue;
    dispatchedCount += 1;
    grossSales += Number(r[grossCol]) || 0;
    orderCost += (Number(r[prodCol]) || 0) + (Number(r[packCol]) || 0);
  }

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

  const payments = await readTab('Payment_Reconciliation');
  const ph = payments[0] || [];
  const paymentDateCol = findCol(ph, 'Payment Date');
  const netCol = findCol(ph, 'Net Settlement');

  let actualNetSettlement = 0;
  for (const r of payments.slice(1)) {
    if (!isWithinRange(r[paymentDateCol], range)) continue;
    actualNetSettlement += Number(r[netCol]) || 0;
  }

  // Net Real Profit uses ACTUAL settlement received (not just invoiced
  // gross), since that's what genuinely landed in the bank after Meesho's
  // fees/deductions - per the "Actual Settlement - Total Costs - Dead
  // Losses" definition.
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
      grossSales,
      actualNetSettlement,
      totalCost: orderCost,
      deadLosses,
      netRealProfit,
    },
  };
}

module.exports = { getPnlForRange };