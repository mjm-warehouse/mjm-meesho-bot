// Universal Parser for Meesho Forward Shipping Labels & Invoices
// Supports Delhivery, Shadowfax, Xpressbees, Valmo, and ValmoPlus

const INDIAN_STATES = [
  'Andhra Pradesh', 'Andhrapradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Puducherry', 'Chandigarh',
];

const SELLER_ORIGIN_PINCODE = '395006';

function extractAwbAndCourier(text) {
  // 1. Valmo / ValmoPlus (Starts with VL followed by digits)
  const valmoMatch = text.match(/\b(VL\d{10,15})\b/i);
  if (valmoMatch) {
    const courier = /valmoplus/i.test(text) ? 'ValmoPlus' : 'Valmo';
    return { awb: valmoMatch[1].toUpperCase(), courier };
  }

  // 2. Shadowfax (Starts with SF)
  const sfMatch = text.match(/\b(SF[A-Z0-9]{10,16})\b/i);
  if (sfMatch) {
    return { awb: sfMatch[1].toUpperCase(), courier: 'Shadowfax' };
  }

  // 3. Xpressbees (Starts with XB or 14/15-digit numeric starting with 13/14)
  if (/xpress\s*bees/i.test(text) || /\bXB[A-Z0-9]{8,14}\b/i.test(text)) {
    const xbMatch = text.match(/\b(XB[A-Z0-9]{8,14})\b/i) || text.match(/\b(13\d{12,14}|14\d{12,14})\b/);
    if (xbMatch) return { awb: xbMatch[1], courier: 'Xpressbees' };
  }

  // 4. Delhivery (14-16 digits numeric, usually starting with 149/14/1)
  const delMatch = text.match(/\b(14\d{12,14}|1\d{13,15})\b/);
  if (delMatch) {
    return { awb: delMatch[1], courier: 'Delhivery' };
  }

  // Generic Fallback
  const generic = text.match(/\b([A-Z]{0,2}\d{10,16}[A-Z]{0,3})\b/);
  return generic ? { awb: generic[1], courier: 'Unknown' } : { awb: null, courier: 'Unknown' };
}

function extractPaymentMode(text) {
  if (/prepaid/i.test(text) || /do not collect cash/i.test(text)) return 'Prepaid';
  if (/\bcod\b/i.test(text) || /check the payable amount/i.test(text)) return 'COD';
  return 'Prepaid';
}

function extractSubOrderId(text) {
  const m = text.match(/\b(\d{18})[_\s]+(\d+)\b/);
  if (m) return `${m[1]}_${m[2]}`;

  const poMatch = text.match(/Purchase Order No\.?[\s:]*(\d{18})/i);
  return poMatch ? `${poMatch[1]}_1` : null;
}

function extractCustomerAddressBlock(text) {
  const m = text.match(/Customer Address[\s:]*([\s\S]*?)(?=If undelivered|Return to:|Prepaid:|COD:|Valmo|Shadowfax|Delhivery|Xpress|$)/i);
  return m ? m[1].trim() : '';
}

function extractCustomerInfo(addrBlock, fullText) {
  let customerName = null;
  let city = null;
  let district = null;

  if (addrBlock) {
    const lines = addrBlock.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) customerName = lines[0];

    const dm = addrBlock.match(/([A-Za-z ]+?)\s+District/i);
    if (dm) district = dm[1].trim();
  }

  const pincodeMatches = (addrBlock || fullText).match(/\b[1-9]\d{5}\b/g) || [];
  const destPincodes = pincodeMatches.filter(p => p !== SELLER_ORIGIN_PINCODE);
  const pincode = destPincodes[0] || null;

  let state = null;
  for (const s of INDIAN_STATES) {
    const re = new RegExp(`\\b${s}\\b`, 'i');
    if (re.test(addrBlock || fullText)) {
      state = s === 'Andhrapradesh' ? 'Andhra Pradesh' : s;
      break;
    }
  }

  return { customerName, city, district, pincode, state };
}

function extractSkuFinancials(text) {
  const skuMatch = text.match(/SKU[\s:]+([A-Za-z0-9\-_]+)/i);
  const sku = skuMatch ? skuMatch[1].trim() : null;

  const qtyMatch = text.match(/Qty[\s:]+(\d+)/i);
  const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

  const dateMatch = text.match(/Invoice Date[\s:]*([\d.\-\/]+)/i) || text.match(/Order Date[\s:]*([\d.\-\/]+)/i);
  const invoiceDate = dateMatch ? dateMatch[1] : null;

  let deliveryCharge = 0.0;
  const otherChargesMatch = text.match(/Other Charges[\s\S]*?Rs\.?\s*(\d+(?:\.\d{2})?)/i);
  if (otherChargesMatch) {
    deliveryCharge = parseFloat(otherChargesMatch[1]);
  }

  let invoiceAmount = 0.0;
  const totalMatches = [...text.matchAll(/Total[\s\S]*?Rs\.?\s*(\d+(?:\.\d{2})?)/gi)];
  if (totalMatches.length > 0) {
    invoiceAmount = parseFloat(totalMatches[totalMatches.length - 1][1]);
  }

  return { sku, qty, invoiceDate, deliveryCharge, invoiceAmount };
}

function parseDispatchPage(text) {
  if (!text || !text.trim()) return null;

  const { awb, courier } = extractAwbAndCourier(text);
  if (!awb) return null;

  const subOrderId = extractSubOrderId(text);
  const paymentMode = extractPaymentMode(text);

  const addrBlock = extractCustomerAddressBlock(text);
  const { customerName, city, district, pincode, state } = extractCustomerInfo(addrBlock, text);
  const { sku, qty, invoiceDate, deliveryCharge, invoiceAmount } = extractSkuFinancials(text);

  return {
    forwardAwb: awb,
    courierPartner: courier,
    subOrderId,
    paymentMode,
    customerName,
    city: district || city,
    destinationState: state,
    destinationPincode: pincode,
    shippingAddress: addrBlock.replace(/\s+/g, ' '),
    sku,
    qty,
    invoiceDate,
    deliveryCharge,
    invoiceAmount,
  };
}

// Wrapper to parse array of pages sent by pdfText / telegram handler
function parseDispatchPdf(pages) {
  const records = [];
  for (const page of pages) {
    const rawText = typeof page === 'string' ? page : (page.text || '');
    const parsed = parseDispatchPage(rawText);
    if (parsed && parsed.forwardAwb) {
      records.push(parsed);
    }
  }
  return records;
}

module.exports = {
  parseDispatchPdf,
  parseDispatchPage,
  extractAwbAndCourier,
  extractPaymentMode,
  extractSubOrderId,
};