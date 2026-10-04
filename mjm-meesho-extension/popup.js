document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['backendUrl', 'apiKey'], (data) => {
    if (data.backendUrl) document.getElementById('backendUrl').value = data.backendUrl;
    if (data.apiKey) document.getElementById('apiKey').value = data.apiKey;
  });
});

document.getElementById('saveBtn').addEventListener('click', () => {
  const backendUrl = document.getElementById('backendUrl').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  chrome.storage.sync.set({ backendUrl, apiKey }, () => {
    document.getElementById('status').innerText = '✅ Settings saved.';
  });
});

document.getElementById('syncBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  statusDiv.innerText = 'Scraping page data...';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_PAGE' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      statusDiv.innerText = '❌ Scrape failed - are you on a Meesho Supplier Panel page?';
      return;
    }

    const totalRows = (response.payload.orders || []).length
      + (response.payload.returns || []).length
      + (response.payload.financials || []).length;

    if (totalRows === 0) {
      statusDiv.innerText = `⚠️ 0 rows scraped on this "${response.pageType}" page - check content.js selectors.`;
      return;
    }

    statusDiv.innerText = `Uploading ${totalRows} row(s) to backend...`;

    chrome.runtime.sendMessage({ action: 'SYNC_TO_SERVER', payload: response.payload }, (res) => {
      if (res && res.success) {
        statusDiv.innerText = `✅ Sync successful! (${response.pageType})`;
      } else {
        statusDiv.innerText = '❌ Sync failed: ' + (res ? res.error : 'Unknown error');
      }
    });
  });
});