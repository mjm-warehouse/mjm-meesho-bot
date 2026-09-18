const SCHEMA = {
  Orders_Dispatch: [
    'Packet ID', 'Forward AWB', 'Sub Order ID', 'Customer Name', 'SKU', 'Product Name',
    'Qty', 'Invoice Amount', 'Product Cost', 'Packaging Cost', 'Payment Mode',
    'Courier Partner', 'City', 'District', 'State', 'Pincode', 'Order Date',
    'Status', 'Action Handler', 'Last Updated',
  ],
  Returns_Tracking: [
    'Return Date', 'Reverse AWB', 'Original AWB', 'Sub Order ID', 'Return Type',
    'Courier', 'Rider Info', 'Condition', 'Status', 'Relinked AWB', 'Remarks',
  ],
  Claims_Manager: [
    'Received Date', 'Sub Order ID', 'Reverse AWB', 'SKU', 'Claim Deadline',
    'Days Left', 'Issue Type', 'Status', 'Claim Value', 'Remarks',
  ],
  SKU_Master_Costing: [
    'SKU ID', 'Product Name', 'Product Cost', 'Packaging Cost', 'Total Base Cost', 'Last Updated',
    // New columns (appended, findCol() matches by name so physical position
    // doesn't matter - add these anywhere in row 1 to enable live inventory):
    'Listing Sale Price', 'Physical Stock', 'Current Balance', 'Meesho Listed Stock',
  ],
  Customer_Risk_Intelligence: [
    'Pincode', 'City', 'State', 'Customer Name', 'Total Orders', 'Fraud Returns',
    'RTO Count', 'Risk Level', 'Fraud Loss', 'Delivered Count', 'Customer Tag', 'Pattern Notes',
  ],
  Payment_Reconciliation: [
    'Payment Date', 'Sub Order ID', 'Live Status', 'Gross Sale', 'Marketplace Fee',
    'Return Shipping Fee', 'Net Settlement', 'Bank Status', 'Discrepancy',
  ],
};

function normalizeHeaderName(name) {
  return (name || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findCol(header, name) {
  const target = normalizeHeaderName(name);
  let idx = header.findIndex((h) => normalizeHeaderName(h) === target);
  if (idx === -1) {
    idx = header.findIndex((h) => normalizeHeaderName(h).startsWith(target) || target.startsWith(normalizeHeaderName(h)));
  }
  return idx;
}

function dispatchRecordToRow(rec, packetId) {
  return [
    packetId, rec.forwardAwb, rec.subOrderId, rec.customerName, rec.sku, rec.productName,
    rec.qty, rec.invoiceAmount, rec.productCost, rec.packagingCost, rec.paymentMode,
    rec.courierPartner, rec.city, rec.district, rec.state, rec.pincode, rec.orderDate,
    rec.status, rec.actionHandler, rec.lastUpdated,
  ];
}

function returnRecordToRow(rec) {
  return [
    rec.returnDate, rec.reverseAwb, rec.originalAwb, rec.subOrderId, rec.returnType,
    rec.courier, rec.riderInfo, rec.condition, rec.status, rec.relinkedAwb, rec.remarks,
  ];
}

function claimRecordToRow(rec) {
  return [
    rec.receivedDate, rec.subOrderId, rec.reverseAwb, rec.sku, rec.claimDeadline,
    rec.daysLeft, rec.issueType, rec.status, rec.claimValue, rec.remarks,
  ];
}

module.exports = { SCHEMA, findCol, dispatchRecordToRow, returnRecordToRow, claimRecordToRow };