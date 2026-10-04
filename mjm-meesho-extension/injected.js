(function () {
  console.log('[MJM Interceptor] Injected script active & listening...');

  // URL matching pattern for Orders, Returns, and Payments
  function isTargetUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return (
      url.includes('/fulfillment/orders') ||
      url.includes('/fulfillment/returnRto') ||
      url.includes('payments') ||
      url.includes('payouts')
    );
  }

  function dispatchPayload(url, data) {
    try {
      window.postMessage({
        type: 'MJM_INTERCEPTED_DATA',
        url: url,
        payload: data
      }, '*');
    } catch (e) {
      console.error('[MJM Interceptor] Failed to postMessage:', e);
    }
  }

  // 1. Intercept Fetch API
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';

    if (isTargetUrl(url)) {
      try {
        const clone = response.clone();
        clone.json().then((data) => {
          dispatchPayload(url, data);
        }).catch(() => {});
      } catch (err) {}
    }
    return response;
  };

  // 2. Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._url = url;
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      if (isTargetUrl(this._url)) {
        try {
          const data = JSON.parse(this.responseText);
          dispatchPayload(this._url, data);
        } catch (e) {}
      }
    });
    return originalSend.apply(this, args);
  };
})();