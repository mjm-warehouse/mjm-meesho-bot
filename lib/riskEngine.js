const { readTab, appendRows, updateRow } = require('./sheets');
const { findCol } = require('./schema');

function computeRiskLevel(fraudReturns) {
  if (fraudReturns >= 2) return '🔴 BLACKLIST / HIGH RISK';
  if (fraudReturns === 1) return '🟡 WATCHLIST';
  return 'OK';
}

// Customer Tag classification (separate from the older Risk Level emoji,
// kept alongside it for backward compatibility):
//   - Fraud Returns >= 1                         -> Blacklisted / Fraudster
//   - RTO% > 40%                                 -> High RTO Risk
//   - Orders >= 3, 0 fraud, RTO% <= 10%          -> VIP Repeat Customer
//   - everything else (incl. Orders 1-2, 0 fraud,
//     and the 10-40% RTO band not covered above) -> Genuine Buyer (default)
function computeCustomerTag(totalOrders, fraudReturns, rtoCount) {
  if (fraudReturns >= 1) return '🚨 Blacklisted / Fraudster';
  const rtoPct = totalOrders > 0 ? rtoCount / totalOrders : 0;
  if (rtoPct > 0.40) return '⚠️ High RTO Risk';
  if (totalOrders >= 3 && rtoPct <= 0.10) return '⭐ VIP Repeat Customer';
  return '🟢 Genuine Buyer';
}

// Shared upsert: finds the customer/pincode row (or creates one), applies
// the given deltas, recomputes Risk Level / Customer Tag / Delivered Count,
// and appends a Pattern Notes entry if provided.
//
// Delivered Count is derived (Total Orders - RTO Count - Fraud Returns,
// floored at 0) rather than tracked via its own increment event, since we
// don't have an explicit "confirmed delivered" trigger - an order is
// presumed delivered unless it comes back as an RTO or a fraud/tampered
// return.
//
// Missing columns (Delivered Count / Customer Tag / Pattern Notes not yet
// added to the sheet) are skipped gracefully via the `!== -1` checks, so
// this stays non-breaking on a sheet that hasn't added the new columns yet.
async function upsertCustomerRisk({
  customerName, pincode, city, state,
  totalOrdersDelta = 0, rtoDelta = 0, fraudDelta = 0, lossDelta = 0,
  patternNote = null,
}) {
  if (!customerName && !pincode) return null; // nothing to key on

  const rows = await readTab('Customer_Risk_Intelligence');
  const header = rows[0] || [];
  const col = (name) => findCol(header, name);

  const nameCol = col('Customer Name');
  const pinCol = col('Pincode');
  const cityCol = col('City');
  const stateCol = col('State');
  const totalOrdersCol = col('Total Orders');
  const deliveredCol = col('Delivered Count');
  const rtoCol = col('RTO Count');
  const fraudCol = col('Fraud Returns');
  const riskCol = col('Risk Level');
  const lossCol = col('Fraud Loss');
  const tagCol = col('Customer Tag');
  const notesCol = col('Pattern Notes');

  const rowIdx = rows.findIndex((r, i) => i > 0
    && r[nameCol] === customerName
    && r[pinCol] === pincode);

  if (rowIdx > 0) {
    const row = [...rows[rowIdx]];
    const totalOrders = Math.max((Number(row[totalOrdersCol]) || 0) + totalOrdersDelta, 0);
    const rtoCount = Math.max((Number(row[rtoCol]) || 0) + rtoDelta, 0);
    const fraudReturns = Math.max((Number(row[fraudCol]) || 0) + fraudDelta, 0);
    const fraudLoss = Math.max((Number(row[lossCol]) || 0) + lossDelta, 0);
    const deliveredCount = Math.max(totalOrders - rtoCount - fraudReturns, 0);
    const tag = computeCustomerTag(totalOrders, fraudReturns, rtoCount);

    row[totalOrdersCol] = totalOrders;
    row[rtoCol] = rtoCount;
    row[fraudCol] = fraudReturns;
    row[riskCol] = computeRiskLevel(fraudReturns);
    row[lossCol] = fraudLoss;
    if (deliveredCol !== -1) row[deliveredCol] = deliveredCount;
    if (tagCol !== -1) row[tagCol] = tag;
    if (notesCol !== -1 && patternNote) {
      const existingNotes = row[notesCol] || '';
      row[notesCol] = existingNotes ? `${existingNotes} | ${patternNote}` : patternNote;
    }

    await updateRow('Customer_Risk_Intelligence', rowIdx + 1, row);
    return { customerName, pincode, totalOrders, rtoCount, fraudReturns, deliveredCount, tag, riskLevel: row[riskCol] };
  }

  // New customer entry - baseline zero, then apply this event's deltas.
  const totalOrders = Math.max(totalOrdersDelta, 0);
  const rtoCount = Math.max(rtoDelta, 0);
  const fraudReturns = Math.max(fraudDelta, 0);
  const fraudLoss = Math.max(lossDelta, 0);
  const deliveredCount = Math.max(totalOrders - rtoCount - fraudReturns, 0);
  const tag = computeCustomerTag(totalOrders, fraudReturns, rtoCount);

  const newRow = new Array(header.length).fill('');
  newRow[pinCol] = pincode || '';
  if (cityCol !== -1) newRow[cityCol] = city || '';
  if (stateCol !== -1) newRow[stateCol] = state || '';
  newRow[nameCol] = customerName || '';
  newRow[totalOrdersCol] = totalOrders;
  newRow[rtoCol] = rtoCount;
  newRow[fraudCol] = fraudReturns;
  newRow[riskCol] = computeRiskLevel(fraudReturns);
  newRow[lossCol] = fraudLoss;
  if (deliveredCol !== -1) newRow[deliveredCol] = deliveredCount;
  if (tagCol !== -1) newRow[tagCol] = tag;
  if (notesCol !== -1 && patternNote) newRow[notesCol] = patternNote;

  await appendRows('Customer_Risk_Intelligence', [newRow]);
  return { customerName, pincode, totalOrders, rtoCount, fraudReturns, deliveredCount, tag, riskLevel: newRow[riskCol] };
}

// Called once per newly dispatched order (from processDispatch.js). Counts
// this as +1 Total Order for the customer - this is the ONLY place Total
// Orders gets incremented, so RTO/fraud events below never double-count it.
async function recordDispatchOrder({ customerName, pincode, city, state }) {
  return upsertCustomerRisk({ customerName, pincode, city, state, totalOrdersDelta: 1 });
}

// Called when a return is classified as RTO (undelivered, came back to
// warehouse) - from POD PDF processing or the /scan_return workflow.
async function recordRtoReturn({ customerName, pincode, city, state, subOrderId }) {
  const note = `RTO on ${new Date().toISOString().slice(0, 10)}${subOrderId ? ` for SubOrder ${subOrderId}` : ''}`;
  return upsertCustomerRisk({ customerName, pincode, city, state, rtoDelta: 1, patternNote: note });
}

// Called whenever a TAMPERED return is logged - from POD PDF processing or
// the /scan_return workflow.
async function recordTamperedReturn({ customerName, pincode, city, state, lossAmount, subOrderId }) {
  const note = `Flagged TAMPERED on ${new Date().toISOString().slice(0, 10)}${subOrderId ? ` for SubOrder ${subOrderId}` : ''}`;
  return upsertCustomerRisk({
    customerName, pincode, city, state,
    fraudDelta: 1,
    lossDelta: Number(lossAmount) || 0,
    patternNote: note,
  });
}

module.exports = { recordDispatchOrder, recordRtoReturn, recordTamperedReturn, computeRiskLevel, computeCustomerTag };