const { parsePodPdf } = require('../parsers/podParser');
const { appendRows, readTab } = require('./sheets');
const { returnRecordToRow, claimRecordToRow, findCol } = require('./schema');
const { recordTamperedReturn, recordRtoReturn } = require('./riskEngine');

const CLAIM_WINDOW_DAYS = 7;

function addDays(dateStr, days) {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(d.getTime())) d.setTime(Date.now());
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function processPodPdf(pages) {
  const returns = parsePodPdf(pages);
  if (!returns.length) return { count: 0, tamperedCount: 0 };

  const dispatchRows = await readTab('Orders_Dispatch');
  const dHeader = dispatchRows[0] || [];
  const col = (name) => findCol(dHeader, name);
  const dispatchBySubOrder = {};
  for (let i = 1; i < dispatchRows.length; i++) {
    const row = dispatchRows[i];
    const subId = row[col('Sub Order ID')];
    if (subId) {
      dispatchBySubOrder[subId] = {
        awb: row[col('Forward AWB')],
        sku: row[col('SKU')],
        customerName: row[col('Customer Name')],
        city: row[col('City')],
        state: row[col('State')],
        pincode: row[col('Pincode')],
        invoiceAmount: Number(row[col('Invoice Amount')]) || 0,
      };
    }
  }

  const returnRows = [];
  const claimRows = [];

  for (const rec of returns) {
    const info = dispatchBySubOrder[rec.subOrderId];
    if (info) rec.originalAwb = info.awb;

    returnRows.push(returnRecordToRow(rec));

    if (rec.condition === 'TAMPERED') {
      claimRows.push(claimRecordToRow({
        receivedDate: rec.returnDate,
        subOrderId: rec.subOrderId,
        reverseAwb: rec.reverseAwb,
        sku: info ? info.sku : null,
        claimDeadline: addDays(rec.returnDate, CLAIM_WINDOW_DAYS),
        daysLeft: CLAIM_WINDOW_DAYS,
        issueType: rec.returnType,
        status: 'Claim Pending',
        claimValue: info ? info.invoiceAmount : null,
        remarks: rec.remarks,
      }));

      if (info) {
        await recordTamperedReturn({
          customerName: info.customerName,
          pincode: info.pincode,
          city: info.city,
          state: info.state,
          lossAmount: info.invoiceAmount,
          subOrderId: rec.subOrderId,
        });
      }
    }

    if (rec.returnType === 'RTO Return' && info) {
      await recordRtoReturn({
        customerName: info.customerName,
        pincode: info.pincode,
        city: info.city,
        state: info.state,
        subOrderId: rec.subOrderId,
      });
    }
  }

  await appendRows('Returns_Tracking', returnRows);
  if (claimRows.length) await appendRows('Claims_Manager', claimRows);

  return { count: returnRows.length, tamperedCount: claimRows.length, returns };
}

module.exports = { processPodPdf };