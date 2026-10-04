// Background service worker: posts scraped data to our Render backend,
// authenticated with the x-sync-api-key header that server.js's
// requireSyncApiKey middleware checks (matches process.env.SYNC_API_KEY).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SYNC_TO_SERVER') {
    chrome.storage.sync.get(['backendUrl', 'apiKey'], async (data) => {
      if (!data.apiKey) {
        sendResponse({ success: false, error: 'API key not set - open the extension popup and save it first.' });
        return;
      }

      const endpoint = (data.backendUrl || 'https://mjm-meesho-bot.onrender.com') + '/api/meesho/sync';

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sync-api-key': data.apiKey,
          },
          body: JSON.stringify(request.payload), // { orders: [...], returns: [...], financials: [...] }
        });

        const result = await response.json();
        if (!response.ok) {
          sendResponse({ success: false, error: result.error || `HTTP ${response.status}` });
          return;
        }
        sendResponse({ success: true, result });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });
    return true; // keep the async sendResponse channel open
  }
});