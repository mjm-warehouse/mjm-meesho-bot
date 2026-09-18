const { readTab, appendRows, updateRow } = require('./sheets');
const { findCol } = require('./schema');
const { normalizeDateStr } = require('./dateUtils');
const { getPnlForRange } = require('./analytics');

async function cmdToday() {
  const rows = await readTab('Orders_Dispatch');
  const header = rows[0] || [];
  const dateCol = findCol(header, 'Order Date');
  const amtCol = findCol(header, 'Invoice Amount');
  const todayIso = new Date().toISOString().slice(0, 10);

  const todayOrders = rows.slice(1).filter((r) => normalizeDateStr(r[dateCol]) === todayIso);
  if (!todayOrders.length) return `No orders logged for today (${todayIso}) yet.`;

  const total = todayOrders.reduce((sum, r) => sum + (Number(r[amtCol]) || 0), 0);
  return `📦 Today (${todayIso}): ${todayOrders.length} orders | Gross: ₹${total.toFixed(2)}`;
}

// /pnl                -> all-time (unchanged legacy behavior)
// /pnl today           /pnl this_week           /pnl this_month
// /pnl last_3_months    /pnl last_6_months        /pnl 7d / 30d / 90d
async function cmdPnl(args) {
  const period = args && args[0] ? args[0] : null;
  const result = await getPnlForRange(period);

  const rangeLine = result.range ? `Period: ${result.range.from} → ${result.range.to}` : 'Period: All time';

  return `💰 P&L Summary\n${rangeLine}\n\n` +
    `📦 Dispatched: ${result.volume.dispatched} | Delivered: ${result.volume.delivered}\n` +
    `🔁 RTO: ${result.volume.rto} | Customer Returns: ${result.volume.customerReturns} | Tampered: ${result.volume.tampered}\n\n` +
    `Gross Sales (invoiced): ₹${result.financials.grossSales.toFixed(2)}\n` +
    `Actual Net Settlement: ₹${result.financials.actualNetSettlement.toFixed(2)}\n` +
    `Product+Packaging Cost: ₹${result.financials.totalCost.toFixed(2)}\n` +
    `Dead Losses: ₹${result.financials.deadLosses.toFixed(2)}\n` +
    `Net Real Profit: ₹${result.financials.netRealProfit.toFixed(2)}`;
}

async function cmdClaims() {
  const rows = await readTab('Claims_Manager');
  const header = rows[0] || [];
  const statusCol = findCol(header, 'Status');
  const subOrderCol = findCol(header, 'Sub Order ID');
  const deadlineCol = findCol(header, 'Claim Deadline');
  const issueCol = findCol(header, 'Issue Type');

  const pending = rows.slice(1).filter((r) => (r[statusCol] || '').startsWith('Claim Pending'));
  if (!pending.length) return '✅ No pending claims.';

  const lines = pending.slice(0, 15).map((r) =>
    `• ${r[subOrderCol]} | Deadline: ${r[deadlineCol]} | ${r[issueCol]}`
  );
  return `⏳ Pending Claims (${pending.length}):\n${lines.join('\n')}`;
}

async function cmdFraud() {
  const rows = await readTab('Customer_Risk_Intelligence');
  const header = rows[0] || [];
  const nameCol = findCol(header, 'Customer Name');
  const pinCol = findCol(header, 'Pincode');
  const totalCol = findCol(header, 'Total Orders');
  const fraudCol = findCol(header, 'Fraud Returns');
  const rtoCol = findCol(header, 'RTO Count');
  const riskCol = findCol(header, 'Risk Level');
  const tagCol = findCol(header, 'Customer Tag');
  const notesCol = findCol(header, 'Pattern Notes');

  const dataRows = rows.slice(1);

  const vip = tagCol !== -1 ? dataRows.filter((r) => (r[tagCol] || '').includes('VIP')) : [];
  const flagged = dataRows.filter((r) => {
    const tag = tagCol !== -1 ? (r[tagCol] || '') : '';
    const risk = riskCol !== -1 ? (r[riskCol] || '') : '';
    return tag.includes('Blacklisted') || tag.includes('High RTO') || risk.match(/WATCHLIST|BLACKLIST/);
  });

  if (!vip.length && !flagged.length) return '✅ Koi flagged ya VIP customer abhi nahi hai.';

  const lines = [];

  if (vip.length) {
    lines.push('⭐ Top Repeat/VIP Customers:');
    vip.slice(0, 10).forEach((r) => {
      lines.push(`• ${r[nameCol]} (${r[pinCol]}) — ${totalCol !== -1 ? r[totalCol] : '?'} orders, 0 fraud`);
    });
    lines.push('');
  }

  if (flagged.length) {
    lines.push(`🚩 Flagged (${flagged.length}):`);
    flagged.slice(0, 15).forEach((r) => {
      const tag = tagCol !== -1 ? r[tagCol] : (riskCol !== -1 ? r[riskCol] : '');
      const note = notesCol !== -1 ? r[notesCol] : '';
      const fraudCount = fraudCol !== -1 ? r[fraudCol] : 0;
      const rtoCount = rtoCol !== -1 ? r[rtoCol] : 0;
      lines.push(`• ${r[nameCol]} (${r[pinCol]}) — ${tag} | Fraud: ${fraudCount}, RTO: ${rtoCount}${note ? `\n   ↳ ${note}` : ''}`);
    });
  }

  return lines.join('\n');
}

async function cmdSetCost(args) {
  const [sku, pCost, packCost] = args;
  if (!sku || pCost === undefined || packCost === undefined) {
    return 'Usage: setcost <SKU> <ProductCost> <PackagingCost>';
  }

  const rows = await readTab('SKU_Master_Costing');
  const header = rows[0] || [];
  const skuCol = findCol(header, 'SKU ID');
  const rowIdx = rows.findIndex((r, i) => i > 0 && r[skuCol] === sku);
  const total = Number(pCost) + Number(packCost);
  const now = new Date().toISOString();

  if (rowIdx > 0) {
    const row = [...rows[rowIdx]];
    row[skuCol] = sku;
    row[findCol(header, 'Product Cost')] = pCost;
    row[findCol(header, 'Packaging Cost')] = packCost;
    row[findCol(header, 'Total Base Cost')] = total;
    row[findCol(header, 'Last Updated')] = now;
    await updateRow('SKU_Master_Costing', rowIdx + 1, row);
    return `✅ Updated costing for ${sku}: Product ₹${pCost} + Packaging ₹${packCost} = ₹${total}`;
  }

  const newRow = new Array(header.length).fill('');
  newRow[skuCol] = sku;
  newRow[findCol(header, 'Product Name')] = sku;
  newRow[findCol(header, 'Product Cost')] = pCost;
  newRow[findCol(header, 'Packaging Cost')] = packCost;
  newRow[findCol(header, 'Total Base Cost')] = total;
  newRow[findCol(header, 'Last Updated')] = now;
  await appendRows('SKU_Master_Costing', [newRow]);
  return `✅ Added new SKU costing for ${sku}: ₹${total} total`;
}

async function cmdLink(args) {
  const [oldAwb, newAwb] = args;
  if (!oldAwb || !newAwb) return 'Usage: link <OLD_AWB> <NEW_AWB>';

  const rows = await readTab('Returns_Tracking');
  const header = rows[0] || [];
  const origCol = findCol(header, 'Original AWB');
  const reverseCol = findCol(header, 'Reverse AWB');
  const relinkCol = findCol(header, 'Relinked AWB');
  const statusCol = findCol(header, 'Status');

  const rowIdx = rows.findIndex((r, i) => i > 0 && (r[origCol] === oldAwb || r[reverseCol] === oldAwb));
  if (rowIdx < 0) return `⚠️ No return record found for AWB ${oldAwb} (checked both Original AWB and Reverse AWB).`;

  const row = [...rows[rowIdx]];
  row[relinkCol] = newAwb;
  row[statusCol] = 'Relinked - Reused for New Order';
  await updateRow('Returns_Tracking', rowIdx + 1, row);
  return `🔗 Linked returned AWB ${oldAwb} → new forward AWB ${newAwb}. Product & packaging cost saved.`;
}

module.exports = { cmdToday, cmdPnl, cmdClaims, cmdFraud, cmdSetCost, cmdLink };