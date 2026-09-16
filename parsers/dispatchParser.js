// Parses one page of text from a Meesho forward shipping label into a
// structured order record. Uses independent field matchers (rather than one
// strict single-line regex) because digital PDF text extraction often splits
// lines irregularly.

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Puducherry', 'Chandigarh',
];

const SELLER_ORIGIN_PINCODE = '395006';

const COURIER_PATTERNS = [
  { name: 'Valmo', regex: /\b(VL[A-Z0-9]{10,})\b/ },
  { name: 'Shadowfax', regex: /\b(SF[A-Z0-9]{10,})\b/ },
  { name: 'Xpressbees', regex: /\b(XB[A-Z0-9]{8,})\b/ },
  { name: 'Delhivery', regex: /\b(1\d{11,14})\b/ }, // Delhivery AWBs: numeric, commonly start with 1, 12-15 digits
];

function extractAwb(text) {
  for (const c of COURIER_PATTERNS) {
    const m = text.match(c.regex);
    if (m) return { awb: m[1], courier: c.name };
  }
  const generic = text.match(/\b([A-Z]{0,4}\d{8,16}[A-Z]{0,4})\b/);
  return generic ? { awb: generic[1], courier: 'Unknown' } : { awb: null, courier: 'Unknown' };
}

function extractPaymentMode(text) {
  if (/prepaid/i.test(text) || /do not collect cash/i.test(text)) return 'Prepaid';
  if (/\bcod\b/i.test(text) || /cash on delivery/i.test(text)) return 'COD';
  return 'Unknown';
}

function extractSubOrderId(text) {
  const m = text.match(/\b(\d{18}_\d+|\d{18}\s+\d+)\b/);
  if (!m) return null;
  return m[1].replace(/\s+/, '_');
}

function extractPincode(text) {
  const matches = text.match(/\b\d{6}\b/g) || [];
  const filtered = matches.filter((p) => p !== SELLER_ORIGIN_PINCODE);
  return filtered[0] || null;
}

function extractState(text) {
  for (const state of INDIAN_STATES) {
    const re = new RegExp(`\\b${state}\\b`, 'i');
    if (re.test(text)) return state;
  }
  return null;
}

function extractSkuQtyAmount(text) {
  const skuMatch = text.match(/SKU:\s*([A-Za-z0-9\-_]+)/i);
  const qtyMatch = text.match(/Qty:\s*(\d+)/i);
  const orderNoMatch = text.match(/Order No:\s*([0-9_]+)/i);
  const dateMatch = text.match(/Invoice Date:\s*([\d.\-\/]+)/i);
  const totalMatch = text.match(/Total:\s*Rs\.?\s*([\d.]+)/i);

  return {
    sku: skuMatch ? skuMatch[1] : null,
    qty: qtyMatch ? parseInt(qtyMatch[1], 10) : null,
    orderNo: orderNoMatch ? orderNoMatch[1] : null,
    invoiceDate: dateMatch ? dateMatch[1] : null,
    invoiceAmount: totalMatch ? parseFloat(totalMatch[1]) : null,
  };
}

function extractCustomerAddressBlock(text) {
  const m = text.match(/Customer Address:\s*(.+?)(?=Return to:|Prepaid:|COD:|ValmoPlus|Shadowfax|Delhivery|Xpressbees|SKU:|$)/i);
  return m ? m[1] : '';
}

function extractCityDistrict(addrBlock) {
  const parts = addrBlock.split(',').map((s) => s.trim()).filter(Boolean);
  let district = null;
  let districtIdx = -1;

  parts.forEach((p, i) => {
    const dm = p.match(/^([A-Za-z ]+?)\s+District$/i);
    if (dm) {
      district = dm[1].trim();
      districtIdx = i;
    }
  });

  const city = districtIdx > 0 ? parts[districtIdx - 1] : (parts.length > 2 ? parts[1] : null);
  const customerName = parts[0] || null;

  return { customerName, city, district };
}

function parseDispatchPage(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  const { awb, courier } = extractAwb(cleaned);
  if (!awb) return null;

  const paymentMode = extractPaymentMode(cleaned);
  const subOrderIdFromPattern = extractSubOrderId(cleaned);
  const { sku, qty, orderNo, invoiceDate, invoiceAmount } = extractSkuQtyAmount(cleaned);
  const addrBlock = extractCustomerAddressBlock(cleaned);
  const { customerName, city, district } = extractCityDistrict(addrBlock);
  const state = extractState(addrBlock || cleaned);
  const pincode = extractPincode(addrBlock || cleaned);

  return {
    forwardAwb: awb,
    subOrderId: subOrderIdFromPattern || orderNo,
    customerName,
    sku,
    productName: null,
    qty,
    invoiceAmount,
    productCost: null,
    packagingCost: null,
    paymentMode,
    courierPartner: courier,
    city,
    district,
    state,
    pincode,
    orderDate: invoiceDate,
    status: 'Dispatched',
    actionHandler: 'System',
    lastUpdated: new Date().toISOString(),
  };
}

function parseDispatchPdf(pages) {
  return pages.map((p) => parseDispatchPage(p.text)).filter(Boolean);
}

module.exports = { parseDispatchPdf, parseDispatchPage };