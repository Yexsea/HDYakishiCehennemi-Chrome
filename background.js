// HD Yakishi Cehennemi — Background Service Worker
// Badge yönetimi ve mesaj köprüsü

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CONNECTION_STATUS') {
        if (message.connected) {
            chrome.action.setBadgeText({ text: '✓' });
            chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    }

    // Popup'a state aktarma
    if (message.type === 'GET_ACTIVE_TAB_STATE') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATE' }, (response) => {
                    sendResponse(response || { connected: false });
                });
            } else {
                sendResponse({ connected: false });
            }
        });
        return true; // async
    }
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.action.setBadgeText({ text: '' });
});
