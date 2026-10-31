// " """"""""""""""""""""""""""""""""""""""""""""""""""""""""""""""" 
// "   HD Yakishi Cehennemi   Content Script (Core Logic)        " 
// "   Video senkronizasyonu, socket baxlantısı, çizim, mouse   " 
// "a"""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""
(function () {
    'use strict';

    // !ift yüklenmeyi engelle
    if (window.__yakishiLoaded) return;
    window.__yakishiLoaded = true;

    const SERVER_URL = 'https://hdyakishicehennemi.onrender.com';

    // """""""""""""""""""""""""""""""""""""""
    //  STATE
    // """""""""""""""""""""""""""""""""""""""
    let isTopFrame = false;
    try { isTopFrame = (window.self === window.top); } catch (e) { isTopFrame = false; }
    let topVideoFoundEmitted = false;
    let socket = null;
    let videoElement = null;
    let myName = '';
    let myRoom = '';
    let isSyncing = false;
    let isMouseSharing = false;
    let isDrawingMode = false;
    let isPainting = false;
    let lastDrawPos = { x: 0, y: 0 };
    let drawingPaths = [];
    let lastMouseTime = 0;
    let drawingCanvas = null;
    let drawingCtx = null;
    let comboSequence = [];
    const TARGET_COMBO = ['❤️', '😂', '😲', '👏', '🔥'];
    let typingTimeout = null;
    let lastUrl = window.location.href;
    let heartbeatInterval = null;
    let audioCtx = null;
    let gainNode = null;
    let audioSource = null;
    let drawAnimFrame = null;
    let drawColor = '#ff80bf'; //  zellik 2: çizim rengi
    let pingInterval = null;   //  zellik 6: ping ölçümü
    let urlTrackInterval = null; // Hata 4: interval temizleme
    let soundEnabled = false;  //  zellik 8: sesli bildirim (varsayılan: kapalı)
    let videoObserver = null;  // MutationObserver referansı
    let storageChangeHandler = null; // storage.onChanged listener referansı
    let amLeader = false;            // Başkan mıyım?
    let followLeaderAuto = true;     // Aynı sitedeyse başkanı otomatik takip et
    let lastLeaderSentUrl = '';      // Başkan olarak en son bildirilen URL
    let iframeVideoUrl = '';         // Video iframe içindeyse, bulunduğu sayfanın URL'i

    // Hassas senkron
    let clockOffset = null;          // sunucu saati - yerel saat (ms); null = henüz ölçülmedi
    let clockSamples = [];           // { rtt, off } ölçümleri
    let lastRtt = 100;               // son ölçülen gidiş-dönüş süresi (ms)
    let timeSyncInterval = null;
    let positionInterval = null;     // her saniye video konumunu raporla
    let baseRate = 1;                // ince ayar yokken olması gereken oynatma hızı
    let rateCorrecting = false;      // şu an hız ince ayarı yapılıyor mu
    let rateResetTimer = null;

    // """""""""""""""""""""""""""""""""""""""
    //  EVENT SYSTEM  (panel.js ile iletixim)
    // """""""""""""""""""""""""""""""""""""""
    const events = new EventTarget();

    function emit(name, detail) {
        events.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    }

    function postMessageToAllFrames(msg) {
        var payload = { type: 'YAKISHI_EVENT', name: msg.name, detail: msg.detail };
        window.postMessage(payload, '*'); // Kendi frame'ine
        var frames = document.querySelectorAll('iframe');
        frames.forEach(function(f) {
            try { f.contentWindow.postMessage(payload, '*'); } catch(e) {} // Alt iframelere
        });
    }

    // """""""""""""""""""""""""""""""""""""""
    //  PUBLIC API  (panel.js tarafından kullanılır)
    // """""""""""""""""""""""""""""""""""""""
    window.yakishi = {
        events: events,
        isPowerOn: false,

        connect: function (name, room) {
            connectToServer(name, room);
        },

        disconnect: function () {
            disconnectFromServer();
        },

        sendMessage: function (text) {
            if (socket && myRoom) {
                socket.emit('send-message', { roomId: myRoom, sender: myName, text: text });
                emit('own-message', { sender: 'Ben', text: text });
            }
        },

        sendReaction: function (type) {
            if (!socket || !myRoom) {
                chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_COMMAND', action: 'sendReaction', emoji: type } });
                return;
            }
            socket.emit('send-reaction', { roomId: myRoom, type: type });
            emit('reaction-anim', { type: type });

            // Gizli kombo: ❤️ x  xܲ x  x      x"`️ x
            comboSequence.push(type);
            if (comboSequence.length > 5) comboSequence.shift();
            if (JSON.stringify(comboSequence) === JSON.stringify(TARGET_COMBO)) {
                socket.emit('send-reaction', { roomId: myRoom, type: '🕊️' }); emit('reaction-anim', { type: '🕊️' });
                setTimeout(function () {
                    socket.emit('send-reaction', { roomId: myRoom, type: '🕊️' }); emit('reaction-anim', { type: '🕊️' });
                }, 300);
                comboSequence = [];
            }
        },

        togglePlay: function () {
            if (videoElement) {
                initAudioContext();
                if (videoElement.paused) {
                    videoElement.play().catch(console.error);
                    if (!isSyncing) emitSync('play', videoElement.currentTime);
                } else {
                    videoElement.pause();
                    if (!isSyncing) emitSync('pause', videoElement.currentTime);
                }
            } else {
                chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_COMMAND', action: 'togglePlay' } });
            }
        },

        seekForward: function () {
            if (videoElement) {
                videoElement.currentTime += 5;
                emitSync('seek', videoElement.currentTime);
            } else {
                chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_COMMAND', action: 'seekForward' } });
            }
        },

        seekBackward: function () {
            if (videoElement) {
                videoElement.currentTime -= 5;
                emitSync('seek', videoElement.currentTime);
            } else {
                chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_COMMAND', action: 'seekBackward' } });
            }
        },

        setVolume: function (val) {
            var volume = parseFloat(val);
            if (videoElement) {
                initAudioContext();
                if (volume <= 1) {
                    videoElement.volume = volume;
                    if (gainNode) gainNode.gain.value = 1;
                } else {
                    videoElement.volume = 1;
                    if (gainNode) gainNode.gain.value = volume;
                }
                videoElement.muted = (volume === 0);
                emit('volume-changed', { volume: volume, muted: videoElement.muted });
            } else {
                chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_COMMAND', action: 'setVolume', volume: volume } });
            }
        },

        toggleMute: function () {
            if (videoElement) {
                videoElement.muted = !videoElement.muted;
                var vol = videoElement.muted ? 0 : videoElement.volume;
                emit('volume-changed', { volume: vol, muted: videoElement.muted });
            } else {
                chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_COMMAND', action: 'toggleMute' } });
            }
        },

        toggleMouseShare: function () {
            isMouseSharing = !isMouseSharing;
            if (isMouseSharing && isDrawingMode) {
                isDrawingMode = false;
                updateDrawingCanvas();
                emit('drawing-changed', { active: false });
            }
            emit('mouse-share-changed', { active: isMouseSharing });
            chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_COMMAND', action: 'setMouseShare', state: isMouseSharing } });
        },

        toggleDrawing: function () {
            isDrawingMode = !isDrawingMode;
            if (isDrawingMode && isMouseSharing) {
                isMouseSharing = false;
                emit('mouse-share-changed', { active: false });
            }
            updateDrawingCanvas();
            emit('drawing-changed', { active: isDrawingMode });
            chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_COMMAND', action: 'setDrawingMode', state: isDrawingMode } });
        },

        typingStart: function () {
            if (!socket || !myRoom) return;
            socket.emit('typing-start', myRoom);
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(function () {
                if (socket) socket.emit('typing-stop', myRoom);
            }, 1500);
        },

        // Başkanın açtığı sayfaya geç (panel "Aç" butonu)
        followLeader: function (url) {
            navigateToLeaderUrl(url);
        },

        // Başkanlığı başka birine devret
        transferLeader: function (targetName) {
            if (socket && myRoom && amLeader && targetName && targetName !== myName) {
                socket.emit('transfer-leader', { roomId: myRoom, targetName: targetName });
            }
        },

        getState: function () {
            return {
                connected: !!(socket && socket.connected),
                myName: myName,
                myRoom: myRoom,
                isLeader: amLeader,
                videoFound: !!videoElement,
                isMouseSharing: isMouseSharing,
                isDrawingMode: isDrawingMode,
                soundEnabled: soundEnabled
            };
        },

        //  zellik 2: Çizim rengi setter
        setDrawColor: function (color) {
            drawColor = color || '#ff80bf';
            chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_COMMAND', action: 'setDrawColor', color: drawColor } });
        }
    };

    // """""""""""""""""""""""""""""""""""""""
    //  AUDIO CONTEXT  (%200 ses destexi)
    // """""""""""""""""""""""""""""""""""""""
    function initAudioContext() {
        if (audioCtx || !videoElement) return;
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AC();
            audioSource = audioCtx.createMediaElementSource(videoElement);
            gainNode = audioCtx.createGain();
            audioSource.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            if (audioCtx.state === 'suspended') audioCtx.resume();
        } catch (e) {
            console.log('Yakishi: AudioContext hatası', e);
        }
    }

    // """""""""""""""""""""""""""""""""""""""
    //  VIDEO DETECTION
    // """""""""""""""""""""""""""""""""""""""
    function findMainVideo() {
        var videos = document.querySelectorAll('video');
        if (videos.length === 0) return null;
        if (videos.length === 1) return videos[0];

        // En büyük videoyu bul
        var mainVideo = null;
        var maxArea = 0;
        videos.forEach(function (v) {
            var area = v.clientWidth * v.clientHeight;
            if (area > maxArea) {
                maxArea = area;
                mainVideo = v;
            }
        });
        return mainVideo || videos[0];
    }

    function watchForVideos() {
        videoElement = findMainVideo();
        if (videoElement) {
            emit('video-found', {});
            attachVideoListeners();
            setupDrawingCanvas();
        }

        // Dinamik yüklenen videoları izle
        if (videoObserver) videoObserver.disconnect();
        videoObserver = new MutationObserver(function () {
            var newVideo = findMainVideo();
            if (newVideo && newVideo !== videoElement) {
                videoElement = newVideo;
                emit('video-found', {});
                attachVideoListeners();
                setupDrawingCanvas();
                // Yeni video için audio context sıfırla
                if (audioCtx) { try { audioCtx.close(); } catch(e) {} }
                audioCtx = null;
                gainNode = null;
                audioSource = null;
            }
        });
        videoObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    // """""""""""""""""""""""""""""""""""""""
    //  VIDEO LISTENERS
    // """""""""""""""""""""""""""""""""""""""
    function attachVideoListeners() {
        if (!videoElement) return;

        videoElement.removeEventListener('play', onVideoPlay);
        videoElement.removeEventListener('pause', onVideoPause);
        videoElement.removeEventListener('seeked', onVideoSeeked);
        videoElement.removeEventListener('timeupdate', onTimeUpdate);
        videoElement.removeEventListener('loadedmetadata', onMetadata);

        videoElement.addEventListener('play', onVideoPlay);
        videoElement.addEventListener('pause', onVideoPause);
        videoElement.addEventListener('seeked', onVideoSeeked);
        videoElement.addEventListener('timeupdate', onTimeUpdate);
        videoElement.addEventListener('loadedmetadata', onMetadata);
    }

    function onVideoPlay() {
        if (!isSyncing) emitSync('play', videoElement.currentTime);
        if (isTopFrame) emit('play-state-changed', { playing: true });
    }

    function onVideoPause() {
        if (!isSyncing) emitSync('pause', videoElement.currentTime);
        if (isTopFrame) emit('play-state-changed', { playing: false });
    }

    // Senkron için programla yapılan atlama: bitince 'seeked' olayı diğerlerine geri yollanmasın
    let programmaticSeek = false;
    let programmaticSeekTimer = null;
    function syncSeek(t) {
        if (!videoElement) return;
        programmaticSeek = true;
        clearTimeout(programmaticSeekTimer);
        programmaticSeekTimer = setTimeout(function () { programmaticSeek = false; }, 5000);
        videoElement.currentTime = t;
    }

    function onVideoSeeked() {
        if (programmaticSeek) {
            programmaticSeek = false;
            clearTimeout(programmaticSeekTimer);
            return;
        }
        if (!isSyncing) emitSync('seek', videoElement.currentTime);
    }

    function onTimeUpdate() {
        if (videoElement) {
            var data = { current: videoElement.currentTime, duration: videoElement.duration || 0 };
            if (isTopFrame) {
                emit('time-update', data);
            } else {
                chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_TIME_UPDATE', data: data } });
            }
        }
    }

    function onMetadata() {
        if (isTopFrame) {
            emit('time-update', { current: 0, duration: videoElement.duration || 0 });
        }
    }

    function emitSync(action, time, localAt) {
        localAt = localAt || Date.now();
        if (isTopFrame) {
            if (socket && myRoom) {
                var payload = { roomId: myRoom, type: action, time: time };
                // Saat ölçüldüyse olayın sunucu saatine göre ne zaman olduğunu da gönder
                if (clockOffset !== null) payload.at = localAt + clockOffset;
                socket.emit('sync-action', payload);
            }
        } else {
            chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_VIDEO_EVENT', action: action, time: time, localAt: localAt } });
        }
    }

    // =======================================
    //  HASSAS SENKRON
    // =======================================
    function serverNow() {
        return Date.now() + (clockOffset || 0);
    }

    // count adet ölçüm, aralarında 150ms
    function runClockSync(count) {
        var i = 0;
        (function one() {
            if (!socket || !socket.connected) return;
            socket.emit('time-sync', { t0: Date.now() });
            if (++i < count) setTimeout(one, 150);
        })();
    }

    function onTimeSyncReply(d) {
        var rtt = Date.now() - d.t0;
        if (!(rtt >= 0 && rtt < 5000)) return;
        lastRtt = rtt;
        clockSamples.push({ rtt: rtt, off: d.serverTime - (d.t0 + rtt / 2) });
        if (clockSamples.length > 15) clockSamples.shift();
        // En kısa gidiş-dönüşlü ölçüm en güvenilir olanıdır
        var best = clockSamples[0];
        for (var i = 1; i < clockSamples.length; i++) if (clockSamples[i].rtt < best.rtt) best = clockSamples[i];
        clockOffset = best.off;
    }

    // Bir olayın üzerinden geçen süre (sn). at = olayın sunucu saatindeki zamanı
    function elapsedSince(at, sentServerNow) {
        if (typeof at !== 'number') return 0;
        var ms = (clockOffset !== null)
            ? serverNow() - at
            : (typeof sentServerNow === 'number' ? (sentServerNow - at) + lastRtt / 2 : 0);
        return Math.min(10, Math.max(0, ms / 1000));
    }

    function setRate(r) {
        if (!videoElement) return;
        try {
            if (Math.abs(videoElement.playbackRate - r) > 0.0005) videoElement.playbackRate = r;
        } catch (e) {}
    }

    function stopRateCorrection() {
        if (rateCorrecting) setRate(baseRate);
        rateCorrecting = false;
    }

    // Senkron olayını uygula (videonun olduğu frame'de çalışır)
    function applySync(time, type, elapsed) {
        if (!videoElement) return;
        var willPlay = type === 'play' || (type === 'seek' && !videoElement.paused);
        var target = time + (willPlay ? elapsed * (rateCorrecting ? baseRate : videoElement.playbackRate) : 0);
        isSyncing = true;
        // Oynarken küçük farkları ince ayar halleder; büyük farkta atla
        var threshold = willPlay ? 0.25 : 0.05;
        if (Math.abs(videoElement.currentTime - target) > threshold) {
            syncSeek(target);
        }
        if (type === 'play') {
            videoElement.play().catch(console.error);
        } else if (type === 'pause') {
            stopRateCorrection();
            videoElement.pause();
        }
        setTimeout(function () { isSyncing = false; }, 500);
    }

    // Başkanın konumuna kilitlen: küçük farkta hızı hafifçe değiştir, büyük farkta atla
    function applyLeaderPosition(p) {
        if (!videoElement || videoElement.paused || videoElement.seeking || videoElement.readyState < 3) return;
        var leaderRate = p.rate || 1;
        var expected = p.time + ((Date.now() - p.localAt) / 1000) * leaderRate;
        var diff = expected - videoElement.currentTime; // + = gerideyim

        clearTimeout(rateResetTimer);
        rateResetTimer = setTimeout(stopRateCorrection, 3000); // güncelleme kesilirse normale dön

        baseRate = leaderRate;
        if (Math.abs(diff) > 0.5) {
            isSyncing = true;
            syncSeek(expected);
            setTimeout(function () { isSyncing = false; }, 800);
            setRate(baseRate);
            rateCorrecting = true;
        } else if (Math.abs(diff) < 0.005) {
            setRate(baseRate);
            rateCorrecting = true;
        } else {
            // Farkın yarısını her saniye kapat, en fazla %5 hız değişimi
            var corr = Math.max(-0.05, Math.min(0.05, diff * 0.5));
            setRate(baseRate * (1 + corr));
            rateCorrecting = true;
        }
    }

    // Her saniye: video oynuyorsa konumu raporla (başkansam sunucuya gider)
    function reportPosition() {
        if (!videoElement || videoElement.paused || videoElement.seeking) return;
        var rep = {
            time: videoElement.currentTime,
            localAt: Date.now(),
            rate: rateCorrecting ? baseRate : videoElement.playbackRate
        };
        if (isTopFrame) {
            handlePositionReport(rep);
        } else {
            try { chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_POSITION', data: rep } }); } catch (e) {}
        }
    }

    function handlePositionReport(rep) {
        if (!isTopFrame || !amLeader || !socket || !socket.connected || !myRoom || clockOffset === null) return;
        socket.emit('leader-position', {
            roomId: myRoom,
            time: rep.time,
            at: rep.localAt + clockOffset,
            rate: rep.rate,
            url: location.href
        });
    }

    function onPositionUpdate(d) {
        if (!isTopFrame || clockOffset === null || !d) return;
        // Başkan başka bir sayfadaysa ona kilitlenme
        if (normalizeUrl(d.url) !== normalizeUrl(location.href)) return;
        var p = { time: d.time, localAt: d.at - clockOffset, rate: d.rate };
        if (videoElement) {
            applyLeaderPosition(p);
        } else {
            chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_COMMAND', action: 'leaderPosition', p: p } });
        }
    }

    // """""""""""""""""""""""""""""""""""""""
    //  SOCKET CONNECTION
    // """""""""""""""""""""""""""""""""""""""
    function connectToServer(name, room, silent) {
        if (socket) socket.disconnect();

        myName = name;
        myRoom = room;
        amLeader = false;
        lastLeaderSentUrl = '';

        // Sekme hafızasına yaz (sayfa değişince otomatik geri bağlanmak için)
        if (isTopFrame) {
            try { chrome.runtime.sendMessage({ type: 'YAKISHI_TAB_SESSION', action: 'set', name: name, room: room }, function () { void chrome.runtime.lastError; }); } catch (e) {}
        }

        socket = io(SERVER_URL, {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000
        });

        socket.on('connect', function () {
            console.log('Yakishi: Sunucuya baxlanıldı');
            socket.emit('join-room', { roomId: myRoom, userName: myName });
            socket.emit('page-url', { roomId: myRoom, url: window.location.href });
            emit('connected', { name: myName, room: myRoom, silent: !!silent });
            silent = true; // Sonraki otomatik yeniden bağlanmalarda paneli tekrar açma

            try {
                chrome.runtime.sendMessage({ type: 'CONNECTION_STATUS', connected: true, name: myName, room: myRoom });
            } catch (e) { /* popup kapalı */ }

            // Heartbeat
            clearInterval(heartbeatInterval);
            heartbeatInterval = setInterval(function () {
                if (socket) socket.emit('heartbeat', { roomId: myRoom, userName: myName });
            }, 25000);

            // Saat eşitleme: bağlanınca 8 ölçüm, sonra her 20sn'de 3 ölçüm
            clockSamples = [];
            clockOffset = null;
            runClockSync(8);
            clearInterval(timeSyncInterval);
            timeSyncInterval = setInterval(function () { runClockSync(3); }, 20000);

            //  zellik 6: Ping ölçümü   her 5sn'de bir latency ölç
            clearInterval(pingInterval);
            pingInterval = setInterval(function () {
                if (!socket || !myRoom) return;
                var t0 = Date.now();
                socket.emit('client-ping', { t: t0 });
                socket.once('client-pong', function (data) {
                    var latency = Date.now() - t0;
                    socket.emit('report-latency', { roomId: myRoom, latency: latency });
                });
            }, 5000);
        });

        socket.on('disconnect', function () {
            console.log('Yakishi: Baxlantı koptu');
            emit('disconnected', {});
            try {
                chrome.runtime.sendMessage({ type: 'CONNECTION_STATUS', connected: false });
            } catch (e) { /* popup kapalı */ }
        });

        //     Senkronizasyon    
        socket.on('sync-update', function (data) {
            // Olay gönderildiğinden beri geçen süreyi hesaba kat (ağ gecikmesi telafisi)
            var elapsed = elapsedSince(data.at, data.serverNow);
            if (videoElement) {
                applySync(data.time, data.type, elapsed);
            } else {
                chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_COMMAND', action: 'forceSync', time: data.time, playState: data.type, elapsed: elapsed } });
            }
        });

        //     Hassas senkron
        socket.on('time-sync-reply', onTimeSyncReply);
        socket.on('position-update', onPositionUpdate);

        //     Mesajlar    
        socket.on('receive-message', function (data) {
            if (data.isSystem) {
                emit('system-message', { text: data.text });
            } else {
                emit('chat-message', { sender: data.sender, text: data.text });
            }
        });

        //     Kullanıcı listesi    
        socket.on('update-user-list', function (users) {
            var me = (users || []).find(function (u) { return u && u.name === myName; });
            var wasLeader = amLeader;
            amLeader = !!(me && me.isLeader);
            if (amLeader && !wasLeader) lastLeaderSentUrl = '';
            emit('user-list', { users: users, myName: myName, amLeader: amLeader });
        });

        //     Başkan yeni bir video açtı
        socket.on('leader-navigated', function (data) {
            handleLeaderNavigated(data);
        });

        //     Acil durum: biri düxtü    
        socket.on('emergency-pause', function (data) {
            if (videoElement) videoElement.pause();
            emit('emergency-pause', { userName: data.userName });
        });

        //     URL uyumsuzluxu    
        socket.on('url-mismatch', function (data) {
            emit('url-mismatch', data);
        });

        //     Reaksiyonlar    
        socket.on('show-reaction', function (type) {
            emit('reaction-anim', { type: type });
        });

        //     Yazıyor...    
        socket.on('user-typing', function (data) {
            emit('user-typing', data);
        });

        //     Mouse imleçleri    
        socket.on('mouse-update', function (data) {
            emit('remote-mouse', data);
            postMessageToAllFrames({ name: 'remote-mouse', detail: data });
        });
        socket.on('remove-cursor', function (data) {
            emit('remove-cursor', data);
            postMessageToAllFrames({ name: 'remove-cursor', detail: data });
        });

        //     Çizim    
        socket.on('draw-line', function (data) {
            emit('remote-draw', data);
            postMessageToAllFrames({ name: 'remote-draw', detail: data });
        });

        //      zellik 4: Mesaj geçmixi    
        socket.on('message-history', function (messages) {
            messages.forEach(function (data) {
                if (data.isSystem) {
                    emit('system-message', { text: data.text, isHistory: true });
                } else {
                    emit('chat-message', { sender: data.sender, text: data.text, isHistory: true });
                }
            });
        });

        //      zellik 1: Catch-up sync    
        socket.on('catch-up-sync', function (state) {
            if (!state || typeof state.time !== 'number') return;
            var receivedAt = Date.now();
            // Saat henüz ölçülmedi: sunucunun gönderdiği saatle geçen süreyi tahmin et
            var baseElapsed = (typeof state.at === 'number' && typeof state.serverNow === 'number')
                ? Math.max(0, (state.serverNow - state.at) + lastRtt / 2) / 1000
                : 0;
            function apply() {
                var elapsed = baseElapsed + (Date.now() - receivedAt) / 1000;
                if (state.type === 'play' && elapsed > 6 * 3600) return; // saçma değer
                if (videoElement) {
                    applySync(state.time, state.type === 'pause' ? 'pause' : (state.type === 'play' ? 'play' : 'seek'), elapsed);
                } else {
                    chrome.runtime.sendMessage({ type: 'YAKISHI_RELAY', payload: { type: 'YAKISHI_COMMAND', action: 'forceSync', time: state.time, playState: state.type, elapsed: elapsed } });
                }
            }
            if (videoElement) apply();
            else setTimeout(apply, 2000); // Video henüz yüklenmemişse biraz bekle
        });

        // Session kaydet (chrome.storage yerine)
        if (isTopFrame) {
            sessionStorage.setItem('yakishi_name', name);
            sessionStorage.setItem('yakishi_room', room);
            sessionStorage.setItem('yakishi_active', 'true');
        }
    }

    function disconnectFromServer() {
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        clearInterval(heartbeatInterval); heartbeatInterval = null;
        clearInterval(pingInterval); pingInterval = null;
        clearInterval(timeSyncInterval); timeSyncInterval = null;
        clockOffset = null;
        stopRateCorrection();
        myName = '';
        myRoom = '';
        amLeader = false;
        lastLeaderSentUrl = '';
        clearTabSession();
        isMouseSharing = false;
        isDrawingMode = false;
        emit('disconnected', {});
        try {
            chrome.runtime.sendMessage({ type: 'CONNECTION_STATUS', connected: false });
        } catch (e) { /* popup kapalı */ }
        if (isTopFrame) {
            sessionStorage.removeItem('yakishi_active');
        }
        removeDrawingCanvas();
        removeRemoteCursors();
    }

    // =======================================
    //  BAŞKAN SİSTEMİ
    // =======================================
    function clearTabSession() {
        if (!isTopFrame) return;
        try { chrome.runtime.sendMessage({ type: 'YAKISHI_TAB_SESSION', action: 'clear' }, function () { void chrome.runtime.lastError; }); } catch (e) {}
    }

    function isHttpUrl(u) {
        try {
            var p = new URL(u).protocol;
            return p === 'http:' || p === 'https:';
        } catch (e) { return false; }
    }

    function normalizeUrl(u) {
        if (!u) return '';
        try {
            var obj = new URL(u);
            var host = obj.hostname.replace(/^www\./, '');
            var path = obj.pathname.replace(/\/$/, '');
            var params = new URLSearchParams(obj.search);
            ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'ref', 'gclid', 't', 'si', 'pp'].forEach(function (k) { params.delete(k); });
            var search = params.toString();
            return host + path + (search ? '?' + search : '');
        } catch (e) { return u; }
    }

    // "www.youtube.com" / "m.youtube.com" → "youtube.com", "youtu.be" → "youtube.com"
    function baseDomain(u) {
        try {
            var host = new URL(u).hostname.toLowerCase();
            if (host === 'youtu.be') return 'youtube.com';
            var parts = host.split('.');
            return parts.length <= 2 ? host : parts.slice(-2).join('.');
        } catch (e) { return ''; }
    }

    // Başkanın bulunduğu sayfa bir video sayfası mı?
    function isVideoPage() {
        var host = location.hostname.toLowerCase();
        if (/(^|\.)youtube\.com$/.test(host)) {
            return location.pathname === '/watch' || location.pathname.indexOf('/shorts/') === 0;
        }
        if (host === 'youtu.be') return true;
        if (videoElement && document.contains(videoElement)) return true;
        return iframeVideoUrl === location.href;
    }

    // Başkansam ve yeni bir video sayfasındaysam herkese bildir
    function checkLeaderBroadcast() {
        if (!isTopFrame || !amLeader || !socket || !socket.connected || !myRoom) return;
        var url = location.href;
        if (url === lastLeaderSentUrl || !isHttpUrl(url) || !isVideoPage()) return;
        lastLeaderSentUrl = url;
        socket.emit('leader-navigate', { roomId: myRoom, url: url });
    }

    function navigateToLeaderUrl(url) {
        if (!isHttpUrl(url)) return;
        try { sessionStorage.setItem('yakishi_last_followed', url); } catch (e) {}
        location.href = url;
    }

    function handleLeaderNavigated(data) {
        if (!isTopFrame || !data || !isHttpUrl(data.url)) return;
        var url = data.url;
        if (normalizeUrl(url) === normalizeUrl(location.href)) return;

        var alreadyFollowed = false;
        try { alreadyFollowed = sessionStorage.getItem('yakishi_last_followed') === url; } catch (e) {}
        var sameSite = baseDomain(url) && baseDomain(url) === baseDomain(location.href);

        if (sameSite && followLeaderAuto && !alreadyFollowed) {
            emit('system-message', { text: '👑 ' + (data.leaderName || 'Başkan') + ' yeni bir video açtı, geçiliyor...' });
            setTimeout(function () { navigateToLeaderUrl(url); }, 600);
        } else {
            emit('leader-prompt', { url: url, leaderName: data.leaderName || 'Başkan', domain: baseDomain(url) });
        }
    }

    // """""""""""""""""""""""""""""""""""""""
    //  DRAWING CANVAS
    // """""""""""""""""""""""""""""""""""""""
    function setupDrawingCanvas() {
        if (drawingCanvas) return;
        drawingCanvas = document.createElement('canvas');
        drawingCanvas.id = 'yakishi-drawing-canvas';
        drawingCanvas.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483640;touch-action:none;opacity:1;';
        document.body.appendChild(drawingCanvas);
        drawingCtx = drawingCanvas.getContext('2d');

        drawingCanvas.addEventListener('mousedown', startDraw);
        drawingCanvas.addEventListener('mousemove', draw);
        drawingCanvas.addEventListener('mouseup', endDraw);
        drawingCanvas.addEventListener('mouseleave', endDraw);

        positionDrawingCanvas();
        window.addEventListener('scroll', positionDrawingCanvas, { passive: true });
        window.addEventListener('resize', positionDrawingCanvas, { passive: true });

        if (!drawAnimFrame) loopDrawing();
    }

    function removeDrawingCanvas() {
        if (drawingCanvas) {
            drawingCanvas.remove();
            drawingCanvas = null;
            drawingCtx = null;
        }
        window.removeEventListener('scroll', positionDrawingCanvas);
        window.removeEventListener('resize', positionDrawingCanvas);
        drawingPaths = [];
    }

    function positionDrawingCanvas() {
        if (!videoElement || !drawingCanvas) return;
        var rect = videoElement.getBoundingClientRect();
        drawingCanvas.style.left = rect.left + 'px';
        drawingCanvas.style.top = rect.top + 'px';
        drawingCanvas.style.width = rect.width + 'px';
        drawingCanvas.style.height = rect.height + 'px';
        drawingCanvas.width = Math.round(rect.width);
        drawingCanvas.height = Math.round(rect.height);
    }

    function updateDrawingCanvas() {
        if (!drawingCanvas) return;
        drawingCanvas.style.pointerEvents = isDrawingMode ? 'auto' : 'none';
        drawingCanvas.style.cursor = isDrawingMode ? 'crosshair' : 'default';
    }

    function startDraw(e) {
        if (!isDrawingMode) return;
        e.stopPropagation();
        e.preventDefault();
        isPainting = true;
        var rect = drawingCanvas.getBoundingClientRect();
        lastDrawPos = {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };
    }

    function draw(e) {
        if (!isDrawingMode || !isPainting) return;
        e.stopPropagation();
        e.preventDefault();
        var rect = drawingCanvas.getBoundingClientRect();
        var cx = (e.clientX - rect.left) / rect.width;
        var cy = (e.clientY - rect.top) / rect.height;
        addDrawPath(lastDrawPos.x, lastDrawPos.y, cx, cy, drawColor);
        if (socket && myRoom) {
            socket.emit('draw-line', {
                roomId: myRoom,
                startX: lastDrawPos.x,
                startY: lastDrawPos.y,
                endX: cx,
                endY: cy,
                color: drawColor
            });
        } else {
            chrome.runtime.sendMessage({
                type: 'YAKISHI_RELAY', payload: {
                    type: 'YAKISHI_COMMAND', action: 'drawLine', data: {
                        roomId: myRoom,
                        startX: lastDrawPos.x,
                        startY: lastDrawPos.y,
                        endX: cx,
                        endY: cy,
                        color: drawColor
                    }
                }
            });
        }
        lastDrawPos = { x: cx, y: cy };
    }

    function endDraw() {
        isPainting = false;
    }

    function addDrawPath(x1, y1, x2, y2, color) {
        drawingPaths.push({ x1: x1, y1: y1, x2: x2, y2: y2, color: color || drawColor, opacity: 1.0 });
    }

    function loopDrawing() {
        drawAnimFrame = requestAnimationFrame(loopDrawing);
        if (!drawingCtx || !drawingCanvas) return;
        positionDrawingCanvas();
        drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        var w = drawingCanvas.width, h = drawingCanvas.height;
        for (var i = 0; i < drawingPaths.length; i++) {
            var p = drawingPaths[i];
            drawingCtx.beginPath();
            drawingCtx.moveTo(p.x1 * w, p.y1 * h);
            drawingCtx.lineTo(p.x2 * w, p.y2 * h);
            // Her path'in kendi rengi var
            var colorValue = p.color || '#ff80bf';
            drawingCtx.strokeStyle = colorValue.startsWith('rgba') ? colorValue.replace(/[\.\d]+\)$/, p.opacity + ')') :
                'rgba(' + hexToRgb(colorValue) + ',' + p.opacity + ')';
            drawingCtx.lineWidth = 4;
            drawingCtx.lineCap = 'round';
            drawingCtx.stroke();
            p.opacity -= 0.015;
        }
        drawingPaths = drawingPaths.filter(function (p) { return p.opacity > 0; });
    }

    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        var r = parseInt(hex.substring(0, 2), 16);
        var g = parseInt(hex.substring(2, 4), 16);
        var b = parseInt(hex.substring(4, 6), 16);
        return r + ',' + g + ',' + b;
    }


    // """""""""""""""""""""""""""""""""""""""
    //  MOUSE SHARING
    // """""""""""""""""""""""""""""""""""""""
    document.addEventListener('mousemove', function (e) {
        // İframe içerisinde socket null olsa bile relay (köprü) ile veri gönderebilmesi için 
        // !socket ve !myRoom kontrollerini bu bloktan çıkardık.
        if (!window.yakishi.isPowerOn || !isMouseSharing || !videoElement) return;
        var now = Date.now();
        if (now - lastMouseTime < 50) return;
        lastMouseTime = now;
        var rect = videoElement.getBoundingClientRect();
        var xPercent = ((e.clientX - rect.left) / rect.width) * 100;
        var yPercent = ((e.clientY - rect.top) / rect.height) * 100;
        if (socket && myRoom) {
            socket.emit('mouse-move', { roomId: myRoom, x: xPercent, y: yPercent, color: drawColor });
        } else {
            chrome.runtime.sendMessage({
                type: 'YAKISHI_RELAY', payload: {
                    type: 'YAKISHI_COMMAND', action: 'mouseMove', data: {
                        x: xPercent,
                        y: yPercent,
                        color: drawColor
                    }
                }
            });
        }
    });

    function removeRemoteCursors() {
        document.querySelectorAll('[id^="yakishi-cursor-"]').forEach(function (el) {
            // Trail havuzunu da temizle
            if (el._trailPool) {
                el._trailPool.forEach(function (t) { t.remove(); });
                el._trailPool = [];
            }
            el.remove();
        });
    }

    events.addEventListener('remote-mouse', function (e) {
        drawRemoteCursor(e.detail);
    });

    events.addEventListener('remove-cursor', function (e) {
        var el = document.getElementById('yakishi-cursor-' + e.detail.id);
        if (el) el.remove();
    });

    events.addEventListener('remote-draw', function (e) {
        var d = e.detail;
        addDrawPath(d.startX, d.startY, d.endX, d.endY, d.color);
    });

    function drawRemoteCursor(data) {
        if (!videoElement) return;
        var cursorId = 'yakishi-cursor-' + data.id;
        var cursor = document.getElementById(cursorId);
        if (!cursor) {
            cursor = document.createElement('div');
            cursor.id = cursorId;
            cursor.className = 'yakishi-remote-cursor';
            cursor.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;width:12px;height:12px;border-radius:50%;transition:left 0.1s linear,top 0.1s linear,opacity 0.3s;transform:translate(-50%,-50%);';
            var nameTag = document.createElement('div');
            nameTag.className = 'yakishi-cursor-name';
            nameTag.style.cssText = 'position:absolute;top:15px;left:50%;transform:translateX(-50%);padding:2px 6px;border-radius:4px;font-size:10px;white-space:nowrap;color:white;';
            cursor.appendChild(nameTag);
            cursor._trailPool = [];
            document.body.appendChild(cursor);
        }
        cursor.style.background = data.color || '#ff80bf';
        cursor.style.boxShadow = '0 0 10px ' + (data.color || '#ff80bf');
        cursor.firstChild.textContent = data.name || '?';
        cursor.firstChild.style.background = 'rgba(0,0,0,0.75)';
        var rect = videoElement.getBoundingClientRect();
        var left = rect.left + (data.x / 100) * rect.width;
        var top = rect.top + (data.y / 100) * rect.height;
        cursor.style.left = left + 'px';
        cursor.style.top = top + 'px';
        cursor.style.opacity = '1';

        // Trail: maks 5 element havuzu ile DOM kirliliğini önle
        var trail;
        if (cursor._trailPool.length >= 5) {
            trail = cursor._trailPool.shift();
        } else {
            trail = document.createElement('div');
            trail.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483644;width:8px;height:8px;border-radius:50%;transform:translate(-50%,-50%);transition:opacity 0.5s;';
            document.body.appendChild(trail);
        }
        trail.style.background = data.color || '#ff80bf';
        trail.style.left = left + 'px';
        trail.style.top = top + 'px';
        trail.style.opacity = '0.6';
        cursor._trailPool.push(trail);
        setTimeout(function () { trail.style.opacity = '0'; }, 50);

        clearTimeout(cursor._hideTimeout);
        cursor._hideTimeout = setTimeout(function () { cursor.style.opacity = '0'; }, 2000);
    }

    // PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
    //  URL TRACKING  (SPA destexi)
    // """""""""""""""""""""""""""""""""""""""
    function trackUrlChanges() {
        // Hata 4: interval ID sakla, tekrar baxlatmayı önle
        if (urlTrackInterval) return;
        urlTrackInterval = setInterval(function () {
            checkLeaderBroadcast();
            if (window.location.href !== lastUrl) {
                lastUrl = window.location.href;
                if (socket && myRoom) {
                    socket.emit('page-url', { roomId: myRoom, url: lastUrl });
                }
                // Video yeniden ara
                var newVideo = findMainVideo();
                if (newVideo && newVideo !== videoElement) {
                    videoElement = newVideo;
                    emit('video-found', {});
                    attachVideoListeners();
                    removeDrawingCanvas();
                    setupDrawingCanvas();
                    if (audioCtx) { try { audioCtx.close(); } catch(e) {} }
                    audioCtx = null;
                    gainNode = null;
                    audioSource = null;
                }
            }
        }, 1000);
    }

    // """""""""""""""""""""""""""""""""""""""
    //  KEYBOARD SHORTCUTS
    // """""""""""""""""""""""""""""""""""""""
    document.addEventListener('keydown', function (e) {
        // Input alanlarında çalıxmasın (Shadow DOM içindeki inputları da yakala)
        var actualTarget = e.target;
        if (e.composedPath && e.composedPath().length > 0) {
            actualTarget = e.composedPath()[0];
        }
        if (actualTarget.tagName === 'INPUT' || actualTarget.tagName === 'TEXTAREA' || actualTarget.isContentEditable) return;
        if (!socket || !myRoom) return;

        // Alt + tux kombinasyonları (site kısayollarıyla çakıxmasın)
        if (!e.altKey) return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                window.yakishi.togglePlay();
                break;
            case 'ArrowRight':
                e.preventDefault();
                window.yakishi.seekForward();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                window.yakishi.seekBackward();
                break;
        }
    });

    // """""""""""""""""""""""""""""""""""""""
    //  MESSAGES FROM POPUP
    // """""""""""""""""""""""""""""""""""""""
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (msg.type === 'POWER_ON') {
            window.yakishi.isPowerOn = true;
            initYakishiSystem();
            var host = document.getElementById('yakishi-extension-host');
            if (host) host.style.setProperty('display', 'block', 'important');
        } else if (msg.type === 'POWER_OFF') {
            window.yakishi.isPowerOn = false;
            if (isInitialized) {
                if (socket) socket.disconnect();
                clearTabSession();
                if (isTopFrame) sessionStorage.removeItem('yakishi_active');
                // Canvas ve cursorları temizle
                removeDrawingCanvas();
                removeRemoteCursors();
                // URL interval'ı temizle
                if (urlTrackInterval) { clearInterval(urlTrackInterval); urlTrackInterval = null; }
                // Ping interval'ı temizle
                if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
                // Senkron interval'larını temizle, hızı normale döndür
                if (positionInterval) { clearInterval(positionInterval); positionInterval = null; }
                if (timeSyncInterval) { clearInterval(timeSyncInterval); timeSyncInterval = null; }
                stopRateCorrection();
                // MutationObserver temizle
                if (videoObserver) { videoObserver.disconnect(); videoObserver = null; }
                // AudioContext kapat
                if (audioCtx) { try { audioCtx.close(); } catch(e) {} audioCtx = null; gainNode = null; audioSource = null; }
                // DrawAnimFrame iptal et
                if (drawAnimFrame) { cancelAnimationFrame(drawAnimFrame); drawAnimFrame = null; }
                // storage.onChanged listener temizle
                if (storageChangeHandler) { try { chrome.storage.onChanged.removeListener(storageChangeHandler); } catch(e) {} storageChangeHandler = null; }
                // isInitialized sıfırla
                isInitialized = false;
            }
            var host = document.getElementById('yakishi-extension-host');
            if (host) host.style.setProperty('display', 'none', 'important');
        } else if (msg.type === 'SET_DRAW_COLOR') {
            //  zellik 2: Çizim rengini güncelle
            drawColor = msg.color || '#ff80bf';
        } else if (msg.type === 'SET_SOUND') {
            //  zellik 8: Sesli bildirim toggle
            soundEnabled = !!msg.enabled;
        }
        
        // Cross-frame relay handlers
        if (msg.type === 'YAKISHI_VIDEO_EVENT' && isTopFrame) {
            if (!isSyncing) emitSync(msg.action, msg.time, msg.localAt);
            if (msg.action === 'play') emit('play-state-changed', { playing: true });
            else if (msg.action === 'pause') emit('play-state-changed', { playing: false });
        } else if (msg.type === 'YAKISHI_POSITION' && isTopFrame) {
            handlePositionReport(msg.data);
        } else if (msg.type === 'YAKISHI_TIME_UPDATE' && isTopFrame) {
            iframeVideoUrl = location.href;
            emit('time-update', msg.data);
            if (!topVideoFoundEmitted) {
                topVideoFoundEmitted = true;
                emit('video-found', {});
            }
        } else if (msg.type === 'YAKISHI_COMMAND') {
            if (!videoElement) return;
            if (msg.action === 'togglePlay') {
                if (videoElement.paused) videoElement.play().catch(console.error);
                else videoElement.pause();
            } else if (msg.action === 'seekForward') {
                videoElement.currentTime += 5;
            } else if (msg.action === 'seekBackward') {
                videoElement.currentTime -= 5;
            } else if (msg.action === 'setVolume') {
                videoElement.volume = msg.volume;
                videoElement.muted = (msg.volume === 0);
            } else if (msg.action === 'toggleMute') {
                videoElement.muted = !videoElement.muted;
            } else if (msg.action === 'forceSync') {
                applySync(msg.time, msg.playState, msg.elapsed || 0);
            } else if (msg.action === 'leaderPosition') {
                if (msg.p) applyLeaderPosition(msg.p);
            } else if (msg.action === 'drawLine') {
                if (socket && myRoom) {
                    msg.data.roomId = myRoom;
                    msg.data.color = msg.data.color || drawColor;
                    socket.emit('draw-line', msg.data);
                }
            } else if (msg.action === 'mouseMove') {
                if (socket && myRoom) {
                    msg.data.roomId = myRoom;
                    msg.data.color = msg.data.color || drawColor;
                    socket.emit('mouse-move', msg.data);
                }
            } else if (msg.action === 'sendReaction') {
                if (socket && myRoom) {
                    socket.emit('send-reaction', { roomId: myRoom, type: msg.emoji });
                    emit('reaction-anim', { type: msg.emoji });
                }
            } else if (msg.action === 'setDrawingMode') {
                isDrawingMode = msg.state;
                if (isDrawingMode && isMouseSharing) isMouseSharing = false;
                updateDrawingCanvas();
            } else if (msg.action === 'setMouseShare') {
                isMouseSharing = msg.state;
                if (isMouseSharing && isDrawingMode) {
                    isDrawingMode = false;
                    updateDrawingCanvas();
                }
            } else if (msg.action === 'setDrawColor') {
                drawColor = msg.color;
            }
        }

        if (msg.type === 'JOIN_ROOM') {
            if (isTopFrame) {
                sessionStorage.setItem('yakishi_name', msg.username);
                sessionStorage.setItem('yakishi_room', msg.roomname);
                sessionStorage.setItem('yakishi_active', 'true');
                connectToServer(msg.username, msg.roomname);
            }
            sendResponse({ ok: true });
            return true;
        } else if (msg.type === 'DISCONNECT') {
            if (isTopFrame) {
                disconnectFromServer();
            }
            sendResponse({ ok: true });
            return true;
        } else if (msg.type === 'GET_STATE') {
            if (isTopFrame) {
                sendResponse(window.yakishi.getState());
            } else {
                sendResponse(null);
            }
            return true;
        }
    });

    // =======================================
    //  INITIALIZATION & POWER MANAGEMENT
    // =======================================
    let isInitialized = false;

    function initYakishiSystem() {

        if (isInitialized) return;
        isInitialized = true;

        // Kaydedilmix ayarları yükle
        try {
            chrome.storage.local.get(['yakishi_draw_color', 'yakishi_sound_enabled', 'yakishi_follow_leader'], function (data) {
                if (data.yakishi_draw_color) drawColor = data.yakishi_draw_color;
                soundEnabled = !!data.yakishi_sound_enabled;
                followLeaderAuto = data.yakishi_follow_leader !== false; // varsayılan: açık
            });
        } catch (e) {}
        
        // Önceki listener'ı temizle (tekrar eklenmesini önle)
        if (storageChangeHandler) { try { chrome.storage.onChanged.removeListener(storageChangeHandler); } catch(e) {} }
        storageChangeHandler = function(changes) {
            if (changes.yakishi_draw_color) {
                drawColor = changes.yakishi_draw_color.newValue;
            }
            if (changes.yakishi_follow_leader) {
                followLeaderAuto = changes.yakishi_follow_leader.newValue !== false;
            }
        };
        chrome.storage.onChanged.addListener(storageChangeHandler);
        if (document.body) watchForVideos();
        else document.addEventListener('DOMContentLoaded', watchForVideos);

        trackUrlChanges();

        // Hassas senkron: oynayan videonun konumunu her saniye raporla
        if (positionInterval) clearInterval(positionInterval);
        positionInterval = setInterval(reportPosition, 1000);
    }

    function checkPowerAndInit() {
        chrome.runtime.sendMessage({ type: 'GET_POWER_STATE' }, function(response) {
            if (chrome.runtime.lastError) {
                // Background might not be ready, default to off
                return;
            }
            if (response && response.powerOn) {
                window.yakishi.isPowerOn = true;
                initYakishiSystem();
                var host = document.getElementById('yakishi-extension-host');
                if (host) host.style.setProperty('display', 'block', 'important');

                // Bu sekme daha önce bir odadaysa (sayfa yenilendi/değişti) sessizce geri bağlan
                if (isTopFrame && !socket) {
                    chrome.runtime.sendMessage({ type: 'YAKISHI_TAB_SESSION', action: 'get' }, function (saved) {
                        if (chrome.runtime.lastError || !saved || !saved.name || !saved.room) return;
                        if (!socket) connectToServer(saved.name, saved.room, true);
                    });
                }
            } else {
                window.yakishi.isPowerOn = false;
                // Hide panel if it was mounted by panel.js
                var host = document.getElementById('yakishi-extension-host');
                if (host) host.style.setProperty('display', 'none', 'important');
            }
        });
    }

    // İlk Yükleme
    checkPowerAndInit();

    window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'YAKISHI_EVENT') {
            emit(event.data.name, event.data.detail);
        }
    });
})();
