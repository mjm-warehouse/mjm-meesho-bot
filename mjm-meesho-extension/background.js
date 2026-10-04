const BACKEND_URL = 'https://mjm-meesho-bot.onrender.com/api/meesho/sync';
const DEFAULT_SYNC_API_KEY = 'd2c04588c43daf88649f00ab2031b85f195f418572a5402e';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'MEESHO_INTERCEPTED_PAYLOAD') {
    handleInterceptedPayload(request.url, request.data)
      .then((res) => {
        sendResponse({ status: 'ok', synced: res });
      })
      .catch((err) => {
        console.error('[MJM Background] Processing error:', err);
        sendResponse({ status: 'error', error: err.message });
      });
    return true;
  }

  if (request.action === 'NETWORK_SYNC_ORDERS') {
    syncWithBackend(request.orders, request.returns, request.payments)
      .then((res) => sendResponse({ status: 'ok', result: res }))
      .catch((err) => sendResponse({ status: 'error', error: err.message }));
    return true;
  }
});

async function handleInterceptedPayload(url, payload) {
  if (!payload) return null;

  // 1. ORDERS EXTRACTION
  if (url.includes('/fulfillment/orders')) {
    let subOrdersList = [];
    if (payload.data && Array.isArray(payload.data.subOrders)) subOrdersList = payload.data.subOrders;
    else if (payload.data && Array.isArray(payload.data.orders)) subOrdersList = payload.data.orders;
    else if (Array.isArray(payload.subOrders)) subOrdersList = payload.subOrders;
    else if (Array.isArray(payload.orders)) subOrdersList = payload.orders;
    else if (Array.isArray(payload.data)) subOrdersList = payload.data;

    if (subOrdersList.length) {
      const orders = subOrdersList.map(item => {
        const subOrderId = item.sub_order_id || item.subOrderId || item.sub_order_num || item.order_id || item.id;
        const productInfo = (item.products && item.products[0]) || (item.product_details && item.product_details[0]) || {};
        return {
          subOrderId: String(subOrderId || '').trim(),
          forwardAwb: item.awb_number || item.forward_awb || item.awb || productInfo.awb || '',
          sku: item.supplier_sku || item.sku || productInfo.sku || productInfo.supplier_sku || '',
          productName: item.product_name || item.name || productInfo.name || productInfo.product_name || '',
          qty: Number(item.quantity || item.qty || productInfo.quantity || 1),
          invoiceAmount: Number(item.total_price || item.invoice_amount || item.transfer_price || item.supplier_discounted_price || 0),
          paymentMode: item.payment_type || item.payment_mode || 'Online/COD',
          courierPartner: item.logistics_partner || item.courier_name || item.courier_partner || 'Meesho Logistics',
          city: item.shipping_city || item.customer_city || item.delivery_city || '',
          district: item.shipping_district || item.district || '',
          state: item.shipping_state || item.customer_state || item.state || '',
          pincode: item.shipping_pincode || item.pincode || '',
          orderDate: item.order_date || item.created_at || new Date().toISOString().slice(0, 10),
          status: normalizeStatus(item.status || item.fulfillment_status || item.order_status || item.state),
        };
      }).filter(o => o.subOrderId);

      if (orders.length > 0) {
        return await syncWithBackend(orders, [], []);
      }
    }
  }

  // 2. RETURNS & CLAIMS EXTRACTION
  if (url.includes('/fulfillment/returnRto')) {
    let returnList = [];
    if (payload.data && Array.isArray(payload.data.claims)) returnList = payload.data.claims;
    else if (payload.data && Array.isArray(payload.data.returns)) returnList = payload.data.returns;
    else if (payload.data && Array.isArray(payload.data.data)) returnList = payload.data.data;
    else if (Array.isArray(payload.data)) returnList = payload.data;

    if (returnList.length) {
      const returns = returnList.map(item => ({
        returnDate: item.return_date || item.created_at || item.return_created_date || new Date().toISOString().slice(0, 10),
        reverseAwb: item.reverse_awb || item.awb_number || item.waybill || '',
        originalAwb: item.forward_awb || item.original_awb || '',
        subOrderId: String(item.sub_order_id || item.subOrderId || item.order_id || '').trim(),
        returnType: item.return_type || (item.is_rto ? 'RTO' : 'Customer Return') || 'Customer Return',
        courier: item.logistics_partner || item.courier || 'Meesho Logistics',
        riderInfo: item.rider_name || item.delivery_boy_name || '',
        condition: item.condition || 'Pending Verification',
        status: item.status || item.claim_status || 'In Transit',
        sku: item.supplier_sku || item.sku || ''
      })).filter(r => r.subOrderId || r.reverseAwb);

      if (returns.length > 0) {
        return await syncWithBackend([], returns, []);
      }
    }
  }

  // 3. PAYMENTS & PAYOUTS EXTRACTION
  if (url.includes('payments') || url.includes('payouts')) {
    let paymentList = [];
    if (payload.data && Array.isArray(payload.data.payments)) paymentList = payload.data.payments;
    else if (payload.data && Array.isArray(payload.data.payouts)) paymentList = payload.data.payouts;
    else if (payload.data && Array.isArray(payload.data.list)) paymentList = payload.data.list;
    else if (Array.isArray(payload.data)) paymentList = payload.data;
    else if (Array.isArray(payload.payments)) paymentList = payload.payments;

    if (paymentList.length) {
      const payments = paymentList.map(item => ({
        paymentDate: item.date || item.payment_date || item.date_iso || new Date().toISOString().slice(0, 10),
        subOrderId: String(item.sub_order_id || item.subOrderId || item.transferId || '').trim(),
        liveStatus: item.status || 'Settled',
        grossSale: Number(item.netOrderAmount || item.orderAmount || item.gross_sale || 0),
        marketplaceFee: Number(item.marketplace_fee || item.netPlatformRecovery || 0),
        returnShippingFee: Number(item.return_shipping_fee || item.shipping_fee || 0),
        netSettlement: Number(item.netAmount || item.net_settlement || item.amount || 0),
        bankStatus: item.bank_status || 'Credited',
        transferId: item.transferId || item.utr || ''
      }));

      if (payments.length > 0) {
        return await syncWithBackend([], [], payments);
      }
    }
  }

  return null;
}

function normalizeStatus(rawStatus) {
  if (!rawStatus) return 'Ready to Ship';
  const s = String(rawStatus).toUpperCase();
  if (s.includes('HOLD')) return 'On Hold';
  if (s.includes('PENDING') || s.includes('ACCEPT')) return 'Pending';
  if (s.includes('READY') || s.includes('TO_SHIP') || s.includes('LABEL_GENERATED')) return 'Ready to Ship';
  if (s.includes('SHIPPED') || s.includes('IN_TRANSIT')) return 'Shipped';
  if (s.includes('CANCEL')) return 'Cancelled';
  if (s.includes('DELIVERED')) return 'Delivered';
  if (s.includes('RETURN') || s.includes('RTO')) return 'RTO';
  return rawStatus;
}

async function syncWithBackend(orders = [], returns = [], payments = []) {
  if (!orders.length && !returns.length && !payments.length) return null;

  const stored = await chrome.storage.local.get(['syncApiKey']);
  const apiKey = stored.syncApiKey || DEFAULT_SYNC_API_KEY;

  const res = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sync-api-key': apiKey,
    },
    body: JSON.stringify({ orders, returns, payments }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error(`[MJM Background] Sync failed (${res.status}):`, txt);
    throw new Error(`Sync failed (${res.status}): ${txt}`);
  }

  const result = await res.json();
  console.log('[MJM Background] Server responded with success:', result);
  return result;
}