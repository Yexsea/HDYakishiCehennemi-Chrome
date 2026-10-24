// ╔══════════════════════════════════════════════════════════════╗
// ║  HD Yakishi Cehennemi — Content Script (Core Logic)        ║
// ║  Video senkronizasyonu, socket bağlantısı, çizim, mouse   ║
// ╚══════════════════════════════════════════════════════════════╝
(function () {
    'use strict';

    // Çift yüklenmeyi engelle
    if (window.__yakishiLoaded) return;
    window.__yakishiLoaded = true;

    const SERVER_URL = 'https://hdyakishicehennemi.onrender.com';

    // ═══════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════
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

    // ═══════════════════════════════════════
    //  EVENT SYSTEM  (panel.js ile iletişim)
    // ═══════════════════════════════════════
    const events = new EventTarget();

    function emit(name, detail) {
        events.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    }

    // ═══════════════════════════════════════
    //  PUBLIC API  (panel.js tarafından kullanılır)
    // ═══════════════════════════════════════
    window.yakishi = {
        events: events,

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
            if (!socket || !myRoom) return;
            socket.emit('send-reaction', { roomId: myRoom, type: type });
            emit('reaction-anim', { type: type });

            // Gizli kombo: ❤️😂😲👏🔥 → 🕊️🤷
            comboSequence.push(type);
            if (comboSequence.length > 5) comboSequence.shift();
            if (JSON.stringify(comboSequence) === JSON.stringify(TARGET_COMBO)) {
                socket.emit('send-reaction', { roomId: myRoom, type: '🕊️' });
                emit('reaction-anim', { type: '🕊️' });
                setTimeout(function () {
                    socket.emit('send-reaction', { roomId: myRoom, type: '🤷' });
                    emit('reaction-anim', { type: '🤷' });
                }, 300);
                comboSequence = [];
            }
        },

        togglePlay: function () {
            if (!videoElement) return;
            initAudioContext();
            if (videoElement.paused) {
                videoElement.play().catch(console.error);
                if (!isSyncing) emitSync('play', videoElement.currentTime);
            } else {
                videoElement.pause();
                if (!isSyncing) emitSync('pause', videoElement.currentTime);
            }
        },

        seekForward: function () {
            if (!videoElement) return;
            videoElement.currentTime += 5;
            emitSync('seek', videoElement.currentTime);
        },

        seekBackward: function () {
            if (!videoElement) return;
            videoElement.currentTime -= 5;
            emitSync('seek', videoElement.currentTime);
        },

        setVolume: function (val) {
            if (!videoElement) return;
            initAudioContext();
            var volume = parseFloat(val);
            if (volume <= 1) {
                videoElement.volume = volume;
                if (gainNode) gainNode.gain.value = 1;
            } else {
                videoElement.volume = 1;
                if (gainNode) gainNode.gain.value = volume;
            }
            videoElement.muted = (volume === 0);
            emit('volume-changed', { volume: volume, muted: videoElement.muted });
        },

        toggleMute: function () {
            if (!videoElement) return;
            videoElement.muted = !videoElement.muted;
            var vol = videoElement.muted ? 0 : videoElement.volume;
            emit('volume-changed', { volume: vol, muted: videoElement.muted });
        },

        toggleMouseShare: function () {
            isMouseSharing = !isMouseSharing;
            if (isMouseSharing && isDrawingMode) {
                isDrawingMode = false;
                updateDrawingCanvas();
                emit('drawing-changed', { active: false });
            }
            emit('mouse-share-changed', { active: isMouseSharing });
        },

        toggleDrawing: function () {
            isDrawingMode = !isDrawingMode;
            if (isDrawingMode && isMouseSharing) {
                isMouseSharing = false;
                emit('mouse-share-changed', { active: false });
            }
            updateDrawingCanvas();
            emit('drawing-changed', { active: isDrawingMode });
        },

        typingStart: function () {
            if (!socket || !myRoom) return;
            socket.emit('typing-start', myRoom);
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(function () {
                if (socket) socket.emit('typing-stop', myRoom);
            }, 1500);
        },

        getState: function () {
            return {
                connected: !!(socket && socket.connected),
                myName: myName,
                myRoom: myRoom,
                videoFound: !!videoElement,
                isMouseSharing: isMouseSharing,
                isDrawingMode: isDrawingMode
            };
        }
    };

    // ═══════════════════════════════════════
    //  AUDIO CONTEXT  (%200 ses desteği)
    // ═══════════════════════════════════════
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

    // ═══════════════════════════════════════
    //  VIDEO DETECTION
    // ═══════════════════════════════════════
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
        var observer = new MutationObserver(function () {
            var newVideo = findMainVideo();
            if (newVideo && newVideo !== videoElement) {
                videoElement = newVideo;
                emit('video-found', {});
                attachVideoListeners();
                setupDrawingCanvas();
                // Yeni video için audio context sıfırla
                audioCtx = null;
                gainNode = null;
                audioSource = null;
            }
        });
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    // ═══════════════════════════════════════
    //  VIDEO LISTENERS
    // ═══════════════════════════════════════
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
        if (!isSyncing && socket && myRoom) emitSync('play', videoElement.currentTime);
        emit('play-state-changed', { playing: true });
    }

    function onVideoPause() {
        if (!isSyncing && socket && myRoom) emitSync('pause', videoElement.currentTime);
        emit('play-state-changed', { playing: false });
    }

    function onVideoSeeked() {
        if (!isSyncing && socket && myRoom) emitSync('seek', videoElement.currentTime);
    }

    function onTimeUpdate() {
        if (videoElement) {
            emit('time-update', {
                current: videoElement.currentTime,
                duration: videoElement.duration || 0
            });
        }
    }

    function onMetadata() {
        emit('time-update', {
            current: 0,
            duration: videoElement.duration || 0
        });
    }

    function emitSync(action, time) {
        if (socket && myRoom) {
            socket.emit('sync-action', { roomId: myRoom, type: action, time: time });
        }
    }

    // ═══════════════════════════════════════
    //  SOCKET CONNECTION
    // ═══════════════════════════════════════
    function connectToServer(name, room) {
        if (socket) socket.disconnect();

        myName = name;
        myRoom = room;

        socket = io(SERVER_URL, {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000
        });

        socket.on('connect', function () {
            console.log('Yakishi: Sunucuya bağlanıldı');
            socket.emit('join-room', { roomId: myRoom, userName: myName });
            socket.emit('page-url', { roomId: myRoom, url: window.location.href });
            emit('connected', { name: myName, room: myRoom });

            try {
                chrome.runtime.sendMessage({ type: 'CONNECTION_STATUS', connected: true });
            } catch (e) { /* popup kapalı */ }

            // Heartbeat
            clearInterval(heartbeatInterval);
            heartbeatInterval = setInterval(function () {
                if (socket) socket.emit('heartbeat', { roomId: myRoom, userName: myName });
            }, 25000);
        });

        socket.on('disconnect', function () {
            console.log('Yakishi: Bağlantı koptu');
            emit('disconnected', {});
            try {
                chrome.runtime.sendMessage({ type: 'CONNECTION_STATUS', connected: false });
            } catch (e) { /* popup kapalı */ }
        });

        socket.on('connect', function () {
            // Yeniden bağlanma sonrası
            if (myName && myRoom) {
                socket.emit('join-room', { roomId: myRoom, userName: myName });
                socket.emit('page-url', { roomId: myRoom, url: window.location.href });
            }
        });

        // ─── Senkronizasyon ───
        socket.on('sync-update', function (data) {
            if (!videoElement) return;
            isSyncing = true;
            if (Math.abs(videoElement.currentTime - data.time) > 0.5) {
                videoElement.currentTime = data.time;
            }
            if (data.type === 'play') {
                videoElement.play().catch(console.error);
            } else if (data.type === 'pause') {
                videoElement.pause();
            }
            setTimeout(function () { isSyncing = false; }, 300);
        });

        // ─── Mesajlar ───
        socket.on('receive-message', function (data) {
            if (data.isSystem) {
                emit('system-message', { text: data.text });
            } else {
                emit('chat-message', { sender: data.sender, text: data.text });
            }
        });

        // ─── Kullanıcı listesi ───
        socket.on('update-user-list', function (users) {
            emit('user-list', { users: users });
        });

        // ─── Acil durum: biri düştü ───
        socket.on('emergency-pause', function (data) {
            if (videoElement) videoElement.pause();
            emit('emergency-pause', { userName: data.userName });
        });

        // ─── URL uyumsuzluğu ───
        socket.on('url-mismatch', function (data) {
            emit('url-mismatch', data);
        });

        // ─── Reaksiyonlar ───
        socket.on('show-reaction', function (type) {
            emit('reaction-anim', { type: type });
        });

        // ─── Yazıyor... ───
        socket.on('user-typing', function (data) {
            emit('user-typing', data);
        });

        // ─── Mouse imleçleri ───
        socket.on('mouse-update', function (data) {
            emit('remote-mouse', data);
        });
        socket.on('remove-cursor', function (data) {
            emit('remove-cursor', data);
        });

        // ─── Çizim ───
        socket.on('draw-line', function (data) {
            addDrawPath(data.startX, data.startY, data.endX, data.endY);
        });

        // Session kaydet
        chrome.storage.local.set({
            yakishi_name: name,
            yakishi_room: room,
            yakishi_active: true
        });
    }

    function disconnectFromServer() {
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        clearInterval(heartbeatInterval);
        myName = '';
        myRoom = '';
        isMouseSharing = false;
        isDrawingMode = false;
        emit('disconnected', {});
        try {
            chrome.runtime.sendMessage({ type: 'CONNECTION_STATUS', connected: false });
        } catch (e) { /* popup kapalı */ }
        chrome.storage.local.set({ yakishi_active: false });
        removeDrawingCanvas();
        removeRemoteCursors();
    }

    // ═══════════════════════════════════════
    //  DRAWING CANVAS
    // ═══════════════════════════════════════
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
        var rect = drawingCanvas.getBoundingClientRect();
        var cx = (e.clientX - rect.left) / rect.width;
        var cy = (e.clientY - rect.top) / rect.height;
        addDrawPath(lastDrawPos.x, lastDrawPos.y, cx, cy);
        if (socket && myRoom) {
            socket.emit('draw-line', {
                roomId: myRoom,
                startX: lastDrawPos.x,
                startY: lastDrawPos.y,
                endX: cx,
                endY: cy,
                color: '#ff80bf'
            });
        }
        lastDrawPos = { x: cx, y: cy };
    }

    function endDraw() {
        isPainting = false;
    }

    function addDrawPath(x1, y1, x2, y2) {
        drawingPaths.push({ x1: x1, y1: y1, x2: x2, y2: y2, opacity: 1.0 });
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
            drawingCtx.strokeStyle = 'rgba(255, 128, 191, ' + p.opacity + ')';
            drawingCtx.lineWidth = 4;
            drawingCtx.lineCap = 'round';
            drawingCtx.stroke();
            p.opacity -= 0.015;
        }
        drawingPaths = drawingPaths.filter(function (p) { return p.opacity > 0; });
    }

    // ═══════════════════════════════════════
    //  MOUSE SHARING
    // ═══════════════════════════════════════
    document.addEventListener('mousemove', function (e) {
        if (!isMouseSharing || !socket || !myRoom || !videoElement) return;
        var now = Date.now();
        if (now - lastMouseTime < 50) return;
        lastMouseTime = now;
        var rect = videoElement.getBoundingClientRect();
        var xPercent = ((e.clientX - rect.left) / rect.width) * 100;
        var yPercent = ((e.clientY - rect.top) / rect.height) * 100;
        socket.emit('mouse-move', { roomId: myRoom, x: xPercent, y: yPercent });
    });

    function removeRemoteCursors() {
        document.querySelectorAll('[id^="yakishi-cursor-"]').forEach(function (el) {
            el.remove();
        });
    }

    // ═══════════════════════════════════════
    //  URL TRACKING  (SPA desteği)
    // ═══════════════════════════════════════
    function trackUrlChanges() {
        setInterval(function () {
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
                    audioCtx = null;
                    gainNode = null;
                    audioSource = null;
                }
            }
        }, 1000);
    }

    // ═══════════════════════════════════════
    //  KEYBOARD SHORTCUTS
    // ═══════════════════════════════════════
    document.addEventListener('keydown', function (e) {
        // Input alanlarında çalışmasın
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        if (!socket || !myRoom) return;

        // Alt + tuş kombinasyonları (site kısayollarıyla çakışmasın)
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

    // ═══════════════════════════════════════
    //  MESSAGES FROM POPUP
    // ═══════════════════════════════════════
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (msg.type === 'JOIN_ROOM') {
            connectToServer(msg.username, msg.roomname);
            sendResponse({ ok: true });
        } else if (msg.type === 'DISCONNECT') {
            disconnectFromServer();
            sendResponse({ ok: true });
        } else if (msg.type === 'GET_STATE') {
            sendResponse(window.yakishi.getState());
        }
        return true;
    });

    // ═══════════════════════════════════════
    //  AUTO-CONNECT
    // ═══════════════════════════════════════
    function checkAutoConnect() {
        chrome.storage.local.get(['yakishi_name', 'yakishi_room', 'yakishi_active'], function (data) {
            if (data.yakishi_active && data.yakishi_name && data.yakishi_room) {
                // Kısa bir gecikmeyle bağlan (sayfa yüklensin)
                setTimeout(function () {
                    connectToServer(data.yakishi_name, data.yakishi_room);
                }, 500);
            }
        });
    }

    // ═══════════════════════════════════════
    //  INITIALIZATION
    // ═══════════════════════════════════════
    if (document.body) {
        watchForVideos();
    } else {
        document.addEventListener('DOMContentLoaded', watchForVideos);
    }
    trackUrlChanges();
    checkAutoConnect();
})();