const { readTab, appendRows, updateRow } = require('./sheets');
const { findCol } = require('./schema');

// Accepts DD.MM.YYYY, DD-MM-YYYY, DD/MM/YYYY, or YYYY-MM-DD and normalizes to YYYY-MM-DD.
function normalizeDateStr(str) {
  if (!str) return null;
  const s = str.toString().trim();

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

  return null;
}

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

async function cmdPnl() {
  const orders = await readTab('Orders_Dispatch');
  const oh = orders[0] || [];
  const claims = await readTab('Claims_Manager');
  const ch = claims[0] || [];

  const grossCol = findCol(oh, 'Invoice Amount');
  const prodCol = findCol(oh, 'Product Cost');
  const packCol = findCol(oh, 'Packaging Cost');
  const statusCol = findCol(ch, 'Status');
  const claimValCol = findCol(ch, 'Claim Value');

  let gross = 0, productCost = 0, packagingCost = 0;
  for (const r of orders.slice(1)) {
    gross += Number(r[grossCol]) || 0;
    productCost += Number(r[prodCol]) || 0;
    packagingCost += Number(r[packCol]) || 0;
  }

  let deadLoss = 0;
  for (const r of claims.slice(1)) {
    if ((r[statusCol] || '').startsWith('Claim Expired')) {
      deadLoss += Number(r[claimValCol]) || 0;
    }
  }

  const netProfit = gross - (productCost + packagingCost) - deadLoss;
  return `💰 P&L Summary\nGross Sales: ₹${gross.toFixed(2)}\nProduct+Packaging Cost: ₹${(productCost + packagingCost).toFixed(2)}\nDead Losses: ₹${deadLoss.toFixed(2)}\nNet Profit: ₹${netProfit.toFixed(2)}`;
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
  const tagCol = findCol(header, 'Customer Tag'); // -1 if the sheet hasn't added this column yet
  const notesCol = findCol(header, 'Pattern Notes'); // -1 if not added yet

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
    await updateRow('SKU_Master_Costing', rowIdx + 1, [sku, rows[rowIdx][1] || sku, pCost, packCost, total, now]);
    return `✅ Updated costing for ${sku}: Product ₹${pCost} + Packaging ₹${packCost} = ₹${total}`;
  }
  await appendRows('SKU_Master_Costing', [[sku, sku, pCost, packCost, total, now]]);
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