console.log('MJM Meesho Sync content script active on', window.location.href);

function detectPageType() {
  const url = window.location.href;
  if (/ready-to-ship|orders|hubpm/i.test(url)) return 'orders';
  if (/\/returns|\/rto/i.test(url)) return 'returns';
  if (/\/payments|\/settlement/i.test(url)) return 'financials';
  return 'unknown';
}

function scrapeOrders() {
  const orders = [];
  const pTags = Array.from(document.querySelectorAll('p, span, div'));
  const seenSubOrders = new Set();

  pTags.forEach((el) => {
    const text = (el.innerText || '').trim();
    // Match Sub-Order ID format (16-20 digits with optional _1)
    if (/^\d{16,20}(?:_\d+)?$/.test(text) && !seenSubOrders.has(text)) {
      seenSubOrders.add(text);

      let row = el.closest('[class*="fulfillment"]') || el.parentElement?.parentElement?.parentElement || el.parentElement;
      const rowText = row ? row.innerText : '';

      // Match SKU ID
      const skuMatch = rowText.match(/SKU\s*ID[:\s]*([^\n]+)/i) || 
                       rowText.match(/([a-zA-Z0-9_\-]+(?:pouch|pack|combo|case|cover|mobile)[^\n]*)/i);
      const sku = skuMatch ? skuMatch[1].trim() : 'MJM-ITEM';

      // Match Quantity
      const qtyMatch = rowText.match(/(?:Qty|Quantity)[:\s]*(\d+)/i);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

      orders.push({
        subOrderId: text,
        forwardAwb: '',
        sku: sku,
        customerName: 'Meesho Customer',
        city: '',
        state: '',
        pincode: '',
        invoiceAmount: 0,
        paymentMode: 'Online/COD',
        courierPartner: 'Meesho Logistics',
        orderDate: new Date().toISOString().slice(0, 10),
        status: 'Ready to Ship',
        qty: qty,
      });
    }
  });

  return orders;
}

function scrapeReturns() {
  const returns = [];
  const pTags = Array.from(document.querySelectorAll('p, span, div'));
  const seenReturns = new Set();

  pTags.forEach((el) => {
    const text = (el.innerText || '').trim();
    if (/^\d{16,20}(?:_\d+)?$/.test(text) && !seenReturns.has(text)) {
      seenReturns.add(text);
      returns.push({
        subOrderId: text,
        reverseAwb: '',
        returnType: 'RTO/Customer Return',
        condition: 'Pending Verification',
        returnDate: new Date().toISOString().slice(0, 10),
      });
    }
  });

  return returns;
}

function scrapeFinancials() {
  return [];
}

// Extension message listener - perfectly matching popup.js expectations
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SCRAPE_PAGE' || request.action === 'scrape_current_page') {
    const pageType = detectPageType();

    if (pageType === 'unknown') {
      sendResponse({ success: false, error: 'Not on an expected Meesho Supplier Panel page.' });
      return true;
    }

    const payload = {
      orders: [],
      returns: [],
      financials: []
    };

    if (pageType === 'orders') payload.orders = scrapeOrders();
    else if (pageType === 'returns') payload.returns = scrapeReturns();
    else if (pageType === 'financials') payload.financials = scrapeFinancials();

    sendResponse({
      success: true,
      pageType: pageType,
      payload: payload
    });
  }
  return true;
});