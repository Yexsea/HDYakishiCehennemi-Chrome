// HD Yakishi Cehennemi — Popup Logic

document.addEventListener('DOMContentLoaded', function () {
    var powerToggle = document.getElementById('power-toggle');
    var powerLabel = document.getElementById('power-label');
    var powerFlash = document.getElementById('power-flash');
    
    var powerOffPanel = document.getElementById('power-off-panel');
    var setupPanel = document.getElementById('setup-panel');
    var connectedPanel = document.getElementById('connected-panel');
    var settingsPanel = document.getElementById('settings-panel');
    
    var joinBtn = document.getElementById('join-btn');
    var disconnectBtn = document.getElementById('disconnect-btn');
    var statusText = document.getElementById('status-text');
    var usernameInput = document.getElementById('username');
    var roomnameInput = document.getElementById('roomname');
    var settingsBtn = document.getElementById('settings-btn');
    var settingsBackBtn = document.getElementById('settings-back-btn');

    // 1. Power State Init
    chrome.storage.session.get('yakishi_power', function (data) {
        var isPowerOn = !!data.yakishi_power;
        powerToggle.checked = isPowerOn;
        updatePowerUI(isPowerOn);
        
        if (isPowerOn) {
            checkConnectionState();
        }
    });

    // 2. Local Storage Init for inputs + settings
    chrome.storage.local.get(['yakishi_name', 'yakishi_room', 'yakishi_draw_color', 'yakishi_sound_enabled', 'yakishi_follow_leader'], function (data) {
        // Ayarlar: başkanı takip et (varsayılan açık)
        var followToggle = document.getElementById('follow-leader-toggle');
        if (followToggle) followToggle.checked = data.yakishi_follow_leader !== false;

        if (data.yakishi_name) usernameInput.value = data.yakishi_name;
        if (data.yakishi_room) roomnameInput.value = data.yakishi_room;
        
        // Ayarlar: çizim rengi
        var savedColor = data.yakishi_draw_color || '#ff80bf';
        setActiveColor(savedColor);

        // Ayarlar: sesli bildirim
        var soundEnabled = !!data.yakishi_sound_enabled; // varsayılan kapalı
        var soundToggle = document.getElementById('sound-toggle');
        if (soundToggle) soundToggle.checked = soundEnabled;
    });

    // 3. Power Toggle Event
    powerToggle.addEventListener('change', function () {
        var isOn = powerToggle.checked;
        chrome.storage.session.set({ yakishi_power: isOn });
        
        if (isOn) {
            // Flash animation
            powerFlash.classList.remove('active');
            void powerFlash.offsetWidth; // trigger reflow
            powerFlash.classList.add('active');
            
            updatePowerUI(true);
            checkConnectionState();
            checkServerStatus();
            
            // Broadcast POWER_ON
            broadcastMessage({ type: 'POWER_ON' });
        } else {
            updatePowerUI(false);
            
            // Broadcast POWER_OFF
            broadcastMessage({ type: 'POWER_OFF' });
        }
    });

    // 4. Connection State Check — session storage'a bak önce (daha güvenilir)
    function checkConnectionState() {
        chrome.storage.session.get('yakishi_conn', function (data) {
            if (data.yakishi_conn && data.yakishi_conn.myName) {
                showConnected(data.yakishi_conn.myName, data.yakishi_conn.myRoom);
            } else {
                showSetup();
                checkServerStatus();
            }
        });
    }

    // 4.5. Server Status Check
    var isCheckingServer = false;
    function checkServerStatus() {
        if (!powerToggle.checked || isCheckingServer) return;
        
        var serverStatus = document.getElementById('server-status');
        var serverStatusText = document.getElementById('server-status-text');
        
        serverStatus.classList.remove('hidden');
        serverStatus.classList.remove('ready');
        serverStatusText.textContent = "Sunucu uyanıyor...";
        
        isCheckingServer = true;
        var start = Date.now();
        
        fetch('https://hdyakishicehennemi.onrender.com/ping')
            .then(r => r.text())
            .then(text => {
                isCheckingServer = false;
                if (text === 'pong') {
                    serverStatus.classList.add('ready');
                    var elapsed = Math.round((Date.now() - start) / 1000);
                    if (elapsed > 2) {
                        serverStatusText.textContent = "Sunucu hazır (" + elapsed + "sn)";
                    } else {
                        serverStatusText.textContent = "Sunucu hazır!";
                    }
                }
            })
            .catch(e => {
                isCheckingServer = false;
                serverStatusText.textContent = "Bağlantı hatası!";
                serverStatusText.style.color = "#ff0040";
                serverStatus.querySelector('.server-dot').style.background = "#ff0040";
                serverStatus.querySelector('.server-dot').style.animation = "none";
            });
    }

    // 5. Broadcast helper
    function broadcastMessage(msg) {
        chrome.tabs.query({}, function (tabs) {
            for (var i = 0; i < tabs.length; i++) {
                chrome.tabs.sendMessage(tabs[i].id, msg, function() {
                    if (chrome.runtime.lastError) { /* ignore */ }
                });
            }
        });
    }

    // 6. Join Room
    joinBtn.addEventListener('click', function () {
        var username = usernameInput.value.trim();
        var roomname = roomnameInput.value.trim();

        var hasError = false;
        if (!username) { usernameInput.classList.add('error'); setTimeout(function () { usernameInput.classList.remove('error'); }, 600); hasError = true; }
        if (!roomname) { roomnameInput.classList.add('error'); setTimeout(function () { roomnameInput.classList.remove('error'); }, 600); hasError = true; }
        if (hasError) return;

        chrome.storage.local.set({ yakishi_name: username, yakishi_room: roomname });

        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'JOIN_ROOM',
                    username: username,
                    roomname: roomname
                }, function (response) {
                    if (chrome.runtime.lastError) {
                        alert("Eklenti güncellendi! Lütfen bulunduğunuz sekmeyi yenileyin (F5) ve tekrar deneyin.");
                        return;
                    }
                    if (response && response.ok) {
                        showConnected(username, roomname);
                    }
                });
            }
        });
    });

    // 7. Disconnect
    disconnectBtn.addEventListener('click', function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'DISCONNECT' }, function () {
                    if (chrome.runtime.lastError) { /* ignore */ }
                    showSetup();
                });
            }
        });
    });

    // Enter binds
    usernameInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') joinBtn.click(); });
    roomnameInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') joinBtn.click(); });

    // ═══════════════════════════════════
    //  SETTINGS PAGE
    // ═══════════════════════════════════
    if (settingsBtn) {
        settingsBtn.addEventListener('click', function () {
            setupPanel.style.display = 'none';
            connectedPanel.style.display = 'none';
            powerOffPanel.style.display = 'none';
            settingsPanel.style.display = 'block';
        });
    }

    if (settingsBackBtn) {
        settingsBackBtn.addEventListener('click', function () {
            settingsPanel.style.display = 'none';
            if (powerToggle.checked) {
                checkConnectionState();
            } else {
                updatePowerUI(false);
            }
        });
    }

    // Renk seçici
    document.querySelectorAll('.color-swatch').forEach(function (swatch) {
        swatch.addEventListener('click', function () {
            var color = swatch.getAttribute('data-color');
            chrome.storage.local.set({ yakishi_draw_color: color });
            setActiveColor(color);
            // Aktif sekmeye çizim rengini uygula
            broadcastDrawColor(color);
        });
    });

    function setActiveColor(color) {
        document.querySelectorAll('.color-swatch').forEach(function (s) {
            s.classList.toggle('active', s.getAttribute('data-color') === color);
        });
    }

    function broadcastDrawColor(color) {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_DRAW_COLOR', color: color }, function () {
                    if (chrome.runtime.lastError) {}
                });
            }
        });
    }

    // Sesli bildirim toggle
    var soundToggle = document.getElementById('sound-toggle');
    if (soundToggle) {
        soundToggle.addEventListener('change', function () {
            chrome.storage.local.set({ yakishi_sound_enabled: soundToggle.checked });
            broadcastMessage({ type: 'SET_SOUND', enabled: soundToggle.checked });
        });
    }

    // Başkanı takip et toggle (content.js storage.onChanged ile dinliyor)
    var followLeaderToggle = document.getElementById('follow-leader-toggle');
    if (followLeaderToggle) {
        followLeaderToggle.addEventListener('change', function () {
            chrome.storage.local.set({ yakishi_follow_leader: followLeaderToggle.checked });
        });
    }

    // UI Helpers
    function updatePowerUI(isOn) {
        if (isOn) {
            powerLabel.textContent = "Sistem Açık";
            powerLabel.style.color = "#ff80bf";
            powerOffPanel.style.display = 'none';
        } else {
            powerLabel.textContent = "Sistem Kapalı";
            powerLabel.style.color = "#888";
            powerOffPanel.style.display = 'block';
            setupPanel.style.display = 'none';
            connectedPanel.style.display = 'none';
            settingsPanel.style.display = 'none';
        }
    }

    function showConnected(name, room) {
        if (!powerToggle.checked) return;
        setupPanel.style.display = 'none';
        connectedPanel.style.display = 'block';
        settingsPanel.style.display = 'none';
        statusText.textContent = (name || '?') + ' — ' + (room || '?');
    }

    function showSetup() {
        if (!powerToggle.checked) return;
        setupPanel.style.display = 'block';
        connectedPanel.style.display = 'none';
        settingsPanel.style.display = 'none';
    }
});