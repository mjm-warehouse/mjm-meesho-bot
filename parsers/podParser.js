// Meesho convention (per business rules):
//  - "_RET_" / standalone "RET" tag on the sub-order  -> Customer Return
//  - "_repl_" tag, or the word "exchange"              -> Meesho Exchange
//  - no return tag present at all                      -> RTO Return
function classifyReturnType(rawType, subOrderId) {
  const combined = `${rawType || ''} ${subOrderId || ''}`.toLowerCase();
  if (/_ret_|(^|[^a-z])ret([^a-z]|$)/.test(combined)) return 'Customer Return';
  if (/_repl_|exchange/.test(combined)) return 'Meesho Exchange';
  return 'RTO Return';
}

function parsePodPdf(pages) {
  const fullText = pages.map((p) => p.text).join('\n').replace(/\s+/g, ' ');

  const dateMatch = fullText.match(/Date:\s*([\d]{1,2}\s+\w+,?\s+\d{4})/i);
  const riderMatch = fullText.match(/Rider Name:\s*([A-Za-z ]+?)(?=\s*\d|\s*$)/i);
  const returnDate = dateMatch ? dateMatch[1] : null;
  const riderInfo = riderMatch ? riderMatch[1].trim() : null;

  const lineRegex = /(\d+)\s*\|\s*([A-Z0-9]+)\s+(TAMPERED|OK)\s*\|\s*([0-9_a-zA-Z]+)\s*\|\s*([A-Za-z ]+?)(?=\s*\d+\s*\||\s*Shipments Delivered|$)/g;

  const rows = [];
  let m;
  while ((m = lineRegex.exec(fullText)) !== null) {
    const [, , reverseAwb, condition, subOrderId, rawType] = m;
    rows.push({
      returnDate,
      reverseAwb,
      originalAwb: null,
      subOrderId,
      returnType: classifyReturnType(rawType, subOrderId),
      courier: null,
      riderInfo,
      condition,
      status: condition === 'TAMPERED' ? 'Flagged - Claims Manager' : 'Received OK',
      relinkedAwb: null,
      remarks: rawType.trim(),
    });
  }

  return rows;
}

module.exports = { parsePodPdf, classifyReturnType };