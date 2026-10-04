// CSP-safe script injection via web_accessible_resources
try {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
  console.log('[MJM Engine] Injected script successfully loaded.');
} catch (e) {
  console.error('[MJM Engine] Injection error:', e);
}

// Intercepted data ko background worker ko delegate karna with direct feedback
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.type !== 'MJM_INTERCEPTED_DATA') {
    return;
  }

  const { url, payload } = event.data;
  console.log('[MJM Engine] Content Script passing data to background for:', url);

  chrome.runtime.sendMessage({
    action: 'MEESHO_INTERCEPTED_PAYLOAD',
    url: url,
    data: payload
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[MJM Engine] Message error:', chrome.runtime.lastError.message);
    } else {
      console.log('[MJM Engine] Background replied:', response);
    }
  });
});