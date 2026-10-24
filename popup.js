// HD Yakishi Cehennemi — Popup Logic

document.addEventListener('DOMContentLoaded', function () {
    var setupPanel = document.getElementById('setup-panel');
    var connectedPanel = document.getElementById('connected-panel');
    var joinBtn = document.getElementById('join-btn');
    var disconnectBtn = document.getElementById('disconnect-btn');
    var statusText = document.getElementById('status-text');
    var usernameInput = document.getElementById('username');
    var roomnameInput = document.getElementById('roomname');

    // Kaydedilmiş verileri yükle
    chrome.storage.local.get(['yakishi_name', 'yakishi_room', 'yakishi_active'], function (data) {
        if (data.yakishi_name) usernameInput.value = data.yakishi_name;
        if (data.yakishi_room) roomnameInput.value = data.yakishi_room;

        if (data.yakishi_active) {
            showConnected(data.yakishi_name, data.yakishi_room);
        }
    });

    // Bağlan
    joinBtn.addEventListener('click', function () {
        var username = usernameInput.value.trim();
        var roomname = roomnameInput.value.trim();

        // Validasyon
        var hasError = false;
        if (!username) {
            usernameInput.classList.add('error');
            setTimeout(function () { usernameInput.classList.remove('error'); }, 600);
            hasError = true;
        }
        if (!roomname) {
            roomnameInput.classList.add('error');
            setTimeout(function () { roomnameInput.classList.remove('error'); }, 600);
            hasError = true;
        }
        if (hasError) return;

        // Aktif sekmeye mesaj gönder
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'JOIN_ROOM',
                    username: username,
                    roomname: roomname
                }, function (response) {
                    if (chrome.runtime.lastError) {
                        // Content script yüklenmemiş olabilir
                        console.log('Content script erişilemedi:', chrome.runtime.lastError.message);
                        return;
                    }
                    if (response && response.ok) {
                        showConnected(username, roomname);
                    }
                });
            }
        });
    });

    // Bağlantıyı kes
    disconnectBtn.addEventListener('click', function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'DISCONNECT' }, function () {
                    if (chrome.runtime.lastError) { /* ignore */ }
                    showSetup();
                });
            }
        });
        chrome.storage.local.set({ yakishi_active: false });
    });

    // Enter tuşu ile bağlan
    usernameInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') joinBtn.click(); });
    roomnameInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') joinBtn.click(); });

    function showConnected(name, room) {
        setupPanel.style.display = 'none';
        connectedPanel.style.display = 'block';
        statusText.textContent = name + ' — Oda: ' + room;
    }

    function showSetup() {
        setupPanel.style.display = 'block';
        connectedPanel.style.display = 'none';
    }
});