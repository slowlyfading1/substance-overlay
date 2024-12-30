// Store active connections
const connections = new Map();

// Initialize default settings
const defaultSettings = {
  enablePsychonautWiki: true,
  enableTripSit: true,
  highlightColor: '#e6ffe6',
  showDosage: true,
  showInteractions: true,
  showEffects: true,
  showWarnings: true,
  customSubstances: []
};

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  try {
    // Set default settings
    await chrome.storage.sync.set(defaultSettings);
    console.log('Extension installed with default settings');
  } catch (error) {
    console.error('Failed to initialize settings:', error);
  }
});

// Handle API requests and messaging
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleRequest = async () => {
    try {
      switch (message.type) {
        case 'API_REQUEST':
          const response = await fetch(message.url, message.options);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const data = await response.json();
          return { success: true, data };

        case 'GET_SETTINGS':
          const settings = await chrome.storage.sync.get(null);
          return { settings };

        case 'UPDATE_SETTINGS':
          await chrome.storage.sync.set(message.settings);
          // Notify active tabs of settings update
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            try {
              await chrome.tabs.sendMessage(tab.id, {
                type: 'SETTINGS_UPDATED',
                settings: message.settings
              });
            } catch (error) {
              // Ignore errors for inactive tabs
              console.debug(`Failed to update tab ${tab.id}:`, error);
            }
          }
          return { success: true };

        default:
          return { error: 'Unknown message type' };
      }
    } catch (error) {
      console.error('Error handling message:', error);
      return { error: error.message };
    }
  };

  // Handle the request and send response
  handleRequest().then(response => {
    try {
      sendResponse(response);
    } catch (error) {
      console.error('Failed to send response:', error);
    }
  });
  return true; // Will respond asynchronously
});

// Handle content script injection
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['substance-list.js', 'api-service.js', 'content.js']
    }).catch(error => {
      console.debug('Content script injection failed:', error);
    });
  }
});

// Error handling
chrome.runtime.onError.addListener((error) => {
  console.error('Runtime error:', error);
});

// Keep service worker alive
const KEEP_ALIVE_INTERVAL = 20000; // 20 seconds
let keepAliveTimeout;

async function keepAlive() {
  try {
    await chrome.runtime.getPlatformInfo();
    keepAliveTimeout = setTimeout(keepAlive, KEEP_ALIVE_INTERVAL);
  } catch (error) {
    console.error('Keep-alive failed:', error);
    // Retry after error with exponential backoff
    keepAliveTimeout = setTimeout(keepAlive, KEEP_ALIVE_INTERVAL * 2);
  }
}

// Start keep-alive
keepAlive();

// Handle uninstall
chrome.runtime.setUninstallURL('https://forms.gle/feedback').catch(error => {
  console.error('Failed to set uninstall URL:', error);
});

// Clean up on startup
chrome.runtime.onStartup.addListener(() => {
  connections.clear();
  if (keepAliveTimeout) {
    clearTimeout(keepAliveTimeout);
  }
  keepAlive();
});