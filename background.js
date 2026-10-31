// HD Yakishi Cehennemi — Background Service Worker
// Badge yönetimi ve mesaj köprüsü

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Çapraz frame (cross-frame) mesajlaşma köprüsü (Top Frame <-> iFrames)
    if (message.type === 'YAKISHI_RELAY') {
        if (sender && sender.tab) {
            chrome.tabs.sendMessage(sender.tab.id, message.payload);
        }
        return false;
    }

    // Sekme bazlı oda hafızası: sayfa yenilenince/değişince odaya otomatik geri bağlanmak için
    if (message.type === 'YAKISHI_TAB_SESSION') {
        if (!sender || !sender.tab) { sendResponse(null); return false; }
        var key = 'yakishi_tab_' + sender.tab.id;
        if (message.action === 'set') {
            var obj = {};
            obj[key] = { name: message.name, room: message.room };
            chrome.storage.session.set(obj);
            sendResponse({ ok: true });
            return false;
        } else if (message.action === 'clear') {
            chrome.storage.session.remove(key);
            sendResponse({ ok: true });
            return false;
        } else if (message.action === 'get') {
            chrome.storage.session.get(key, function (data) {
                sendResponse(data[key] || null);
            });
            return true;
        }
        return false;
    }

    if (message.type === 'GET_POWER_STATE') {
        chrome.storage.session.get('yakishi_power', (data) => {
            sendResponse({ powerOn: !!data.yakishi_power });
        });
        return true;
    }

    if (message.type === 'CONNECTION_STATUS') {
        if (message.connected) {
            chrome.action.setBadgeText({ text: '✓' });
            chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
            chrome.storage.session.set({ yakishi_conn: { myName: message.name, myRoom: message.room } });
        } else {
            chrome.action.setBadgeText({ text: '' });
            chrome.storage.session.remove('yakishi_conn');
        }
        return false;
    }

    // Popup'a state aktarma
    else if (message.type === 'GET_ACTIVE_TAB_STATE') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATE' }, (response) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ connected: false });
                    } else {
                        sendResponse(response || { connected: false });
                    }
                });
            } else {
                sendResponse({ connected: false });
            }
        });
        return true; // async
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.session.remove('yakishi_tab_' + tabId);
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.action.setBadgeText({ text: '' });
});
