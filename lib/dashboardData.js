const { readTab } = require('./sheets');
const { findCol } = require('./schema');

async function getDashboardSummary() {
  const orders = await readTab('Orders_Dispatch');
  const oh = orders[0] || [];
  const statusCol = findCol(oh, 'Status');
  const grossCol = findCol(oh, 'Invoice Amount');
  const prodCol = findCol(oh, 'Product Cost');
  const packCol = findCol(oh, 'Packaging Cost');

  const counts = { readyToShip: 0, packed: 0, dispatched: 0, cancelled: 0 };
  let gross = 0, cost = 0;
  for (const r of orders.slice(1)) {
    const status = (r[statusCol] || '').toLowerCase();
    if (status.includes('ready to ship')) counts.readyToShip += 1;
    else if (status.includes('packed')) counts.packed += 1;
    else if (status.includes('cancel')) counts.cancelled += 1;
    else if (status.includes('dispatch') || status.includes('delivered')) counts.dispatched += 1;
    gross += Number(r[grossCol]) || 0;
    cost += (Number(r[prodCol]) || 0) + (Number(r[packCol]) || 0);
  }

  const returns = await readTab('Returns_Tracking');
  const rh = returns[0] || [];
  const returnTypeCol = findCol(rh, 'Return Type');
  const conditionCol = findCol(rh, 'Condition');
  let rtoCount = 0, customerReturnCount = 0, tamperedCount = 0;
  for (const r of returns.slice(1)) {
    if ((r[returnTypeCol] || '') === 'RTO Return') rtoCount += 1;
    if ((r[returnTypeCol] || '') === 'Customer Return') customerReturnCount += 1;
    if ((r[conditionCol] || '') === 'TAMPERED') tamperedCount += 1;
  }

  const claims = await readTab('Claims_Manager');
  const ch = claims[0] || [];
  const claimStatusCol = findCol(ch, 'Status');
  const daysLeftCol = findCol(ch, 'Days Left');
  const claimSubOrderCol = findCol(ch, 'Sub Order ID');
  const claimDeadlineCol = findCol(ch, 'Claim Deadline');
  const pendingClaims = claims.slice(1).filter((r) => (r[claimStatusCol] || '').startsWith('Claim Pending'));

  const payments = await readTab('Payment_Reconciliation');
  const ph = payments[0] || [];
  const netCol = findCol(ph, 'Net Settlement');
  const dateCol = findCol(ph, 'Payment Date');
  const subOrderCol = findCol(ph, 'Sub Order ID');
  const bankStatusCol = findCol(ph, 'Bank Status');
  const liveStatusCol = findCol(ph, 'Live Status');

  let pendingPayout = 0, nextPayoutDate = null;
  const processedSubOrders = new Set();

  for (const r of payments.slice(1)) {
    const subOrderId = (r[subOrderCol] || '').trim();
    // Ignore legacy batch summary rows
    if (subOrderId.startsWith('PAY-')) continue;

    // Deduplicate duplicate entries
    if (subOrderId && processedSubOrders.has(subOrderId)) continue;
    if (subOrderId) processedSubOrders.add(subOrderId);

    const bStatus = (r[bankStatusCol] || '').toLowerCase();
    const lStatus = (r[liveStatusCol] || '').toLowerCase();

    // Check if payout is truly pending (not settled, completed, or reconciled)
    const isCompleted = bStatus.includes('settled') || bStatus.includes('completed') || bStatus.includes('reconciled') || lStatus.includes('settled');

    if (!isCompleted) {
      pendingPayout += Number(r[netCol]) || 0;
      if (!nextPayoutDate || (r[dateCol] && r[dateCol] < nextPayoutDate)) {
        nextPayoutDate = r[dateCol];
      }
    }
  }

  return {
    orders: counts,
    returns: { rto: rtoCount, customerReturns: customerReturnCount, tampered: tamperedCount },
    claims: {
      pendingCount: pendingClaims.length,
      list: pendingClaims.slice(0, 10).map((r) => ({
        subOrderId: r[claimSubOrderCol], deadline: r[claimDeadlineCol], daysLeft: r[daysLeftCol],
      })),
    },
    pnl: { gross, cost, netProfit: gross - cost },
    payout: {
      pending: Math.round(pendingPayout * 100) / 100,
      nextDate: nextPayoutDate || 'All Settled',
    },
  };
}

module.exports = { getDashboardSummary };