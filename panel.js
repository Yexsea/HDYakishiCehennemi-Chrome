// ╔══════════════════════════════════════════════════════════════╗
// ║  HD Yakishi Cehennemi — Floating Panel UI (Shadow DOM)     ║
// ║  Chat, video kontrolleri, reaksiyonlar, bildirimler        ║
// ╚══════════════════════════════════════════════════════════════╝
(function () {
    'use strict';

    // yakishi API'sini bekle
    var checkInterval = setInterval(function () {
        if (window.yakishi && document.body) {
            clearInterval(checkInterval);
            initPanel();
        }
    }, 100);

    // Timeout: 15 saniye sonra vazgeç
    setTimeout(function () { clearInterval(checkInterval); }, 15000);

    function initPanel() {
        var yakishi = window.yakishi;
        var events = yakishi.events;

        // ═══════════════════════════════════════
        //  SVG ICONS (Material Design)
        // ═══════════════════════════════════════
        var ICONS = {
            play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
            pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
            skipBack: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>',
            skipForward: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>',
            volumeUp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
            volumeMute: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>',
            pencil: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
            mouse: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 1.07V9h7c0-4.08-3.05-7.44-7-7.93zM4 15c0 4.42 3.58 8 8 8s8-3.58 8-8v-4H4v4zm7-13.93C7.05 1.56 4 4.92 4 9h7V1.07z"/></svg>',
            send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
            minimize: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h12v2H6z"/></svg>'
        };

        // ═══════════════════════════════════════
        //  SHADOW DOM HOST
        // ═══════════════════════════════════════
        var host = document.createElement('div');
        host.id = 'yakishi-extension-host';
        host.setAttribute('style',
            'all: initial !important; position: fixed !important; z-index: 2147483647 !important;' +
            'bottom: 0 !important; right: 0 !important; width: 0 !important; height: 0 !important;' +
            'overflow: visible !important; pointer-events: none !important;'
        );
        document.documentElement.appendChild(host);

        var shadow = host.attachShadow({ mode: 'closed' });

        // CSS yükle
        var cssLink = document.createElement('link');
        cssLink.rel = 'stylesheet';
        cssLink.href = chrome.runtime.getURL('panel.css');
        shadow.appendChild(cssLink);

        // ═══════════════════════════════════════
        //  DOM YAPISI
        // ═══════════════════════════════════════
        var root = document.createElement('div');
        root.className = 'yakishi-root';
        root.innerHTML = buildPanelHTML();
        shadow.appendChild(root);

        // Referanslar
        var fab = root.querySelector('.yakishi-fab');
        var panel = root.querySelector('.yakishi-panel');
        var minimizeBtn = root.querySelector('#yk-minimize-btn');
        var statusDot = root.querySelector('.status-dot');
        var statusText = root.querySelector('.status-text');
        var userList = root.querySelector('.user-list');
        var chatMessages = root.querySelector('.chat-messages');
        var typingIndicator = root.querySelector('.typing-indicator');
        var msgInput = root.querySelector('#yk-msg-input');
        var sendBtn = root.querySelector('#yk-send-btn');
        var btnPlay = root.querySelector('#yk-btn-play');
        var btnBack = root.querySelector('#yk-btn-back');
        var btnForward = root.querySelector('#yk-btn-forward');
        var btnMute = root.querySelector('#yk-btn-mute');
        var volumeSlider = root.querySelector('#yk-volume-slider');
        var volumeText = root.querySelector('.volume-text');
        var timeDisplay = root.querySelector('.time-display');
        var btnDraw = root.querySelector('#yk-btn-draw');
        var btnMouse = root.querySelector('#yk-btn-mouse');
        var notification = root.querySelector('.yakishi-notification');
        var notifTitle = root.querySelector('.notif-title');
        var notifMsg = root.querySelector('.notif-msg');
        var emergency = root.querySelector('.yakishi-emergency');
        var emergencyMsg = root.querySelector('.emergency-msg');
        var urlWarning = root.querySelector('.yakishi-url-warning');
        var urlWarningMsg = root.querySelector('.warning-msg');
        var unreadBadge = root.querySelector('.unread-badge');

        var isPanelOpen = false;
        var isConnected = false;
        var unreadCount = 0;
        var notifTimeout = null;

        // Başlangıçta gizli
        fab.style.display = 'none';
        panel.classList.add('hidden');

        // pointer-events: root elementine tıklanabilirlik ver
        root.style.pointerEvents = 'auto';

        // ═══════════════════════════════════════
        //  FAB CLICK
        // ═══════════════════════════════════════
        fab.addEventListener('click', function (e) {
            e.stopPropagation();
            isPanelOpen = !isPanelOpen;
            if (isPanelOpen) {
                panel.classList.remove('hidden');
                panel.classList.add('visible');
                unreadCount = 0;
                unreadBadge.classList.remove('visible');
                unreadBadge.textContent = '';
                // Focus input
                setTimeout(function () { msgInput.focus(); }, 100);
            } else {
                panel.classList.add('hidden');
                panel.classList.remove('visible');
            }
        });

        // ═══════════════════════════════════════
        //  MINIMIZE
        // ═══════════════════════════════════════
        minimizeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            isPanelOpen = false;
            panel.classList.add('hidden');
            panel.classList.remove('visible');
        });

        // ═══════════════════════════════════════
        //  DRAG (Sürükleme)
        // ═══════════════════════════════════════
        var header = root.querySelector('.panel-header');
        var isDragging = false;
        var dragStartX, dragStartY;
        var rootStartRight, rootStartBottom;

        header.addEventListener('mousedown', function (e) {
            if (e.target.closest('.header-btn')) return;
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            rootStartRight = parseInt(root.style.right) || 20;
            rootStartBottom = parseInt(root.style.bottom) || 20;
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!isDragging) return;
            var dx = dragStartX - e.clientX;
            var dy = dragStartY - e.clientY;
            root.style.right = Math.max(0, rootStartRight + dx) + 'px';
            root.style.bottom = Math.max(0, rootStartBottom + dy) + 'px';
        });

        document.addEventListener('mouseup', function () { isDragging = false; });

        // ═══════════════════════════════════════
        //  VIDEO CONTROLS
        // ═══════════════════════════════════════
        btnPlay.addEventListener('click', function () { yakishi.togglePlay(); });
        btnBack.addEventListener('click', function () { yakishi.seekBackward(); });
        btnForward.addEventListener('click', function () { yakishi.seekForward(); });
        btnMute.addEventListener('click', function () { yakishi.toggleMute(); });
        volumeSlider.addEventListener('input', function (e) {
            yakishi.setVolume(parseInt(e.target.value) / 100);
        });

        // ═══════════════════════════════════════
        //  CHAT
        // ═══════════════════════════════════════
        sendBtn.addEventListener('click', sendMessage);
        msgInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') sendMessage();
        });
        msgInput.addEventListener('input', function () { yakishi.typingStart(); });

        // Input'ta klavye kısayollarını engelle
        msgInput.addEventListener('keydown', function (e) { e.stopPropagation(); });

        function sendMessage() {
            var text = msgInput.value.trim();
            if (!text) return;
            yakishi.sendMessage(text);
            msgInput.value = '';
        }

        // ═══════════════════════════════════════
        //  REACTIONS
        // ═══════════════════════════════════════
        root.querySelectorAll('.reaction-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                yakishi.sendReaction(btn.getAttribute('data-emoji'));
            });
        });

        // ═══════════════════════════════════════
        //  TOGGLE BUTTONS
        // ═══════════════════════════════════════
        btnDraw.addEventListener('click', function () { yakishi.toggleDrawing(); });
        btnMouse.addEventListener('click', function () { yakishi.toggleMouseShare(); });

        // ═══════════════════════════════════════
        //  EVENT LISTENERS (content.js'den)
        // ═══════════════════════════════════════

        events.addEventListener('connected', function (e) {
            isConnected = true;
            fab.style.display = 'flex';
            fab.classList.add('connected');
            statusDot.classList.add('online');
            statusText.textContent = e.detail.name + ' — ' + e.detail.room;
            showNotification('Sistem', 'Bağlandı!');

            // Paneli otomatik aç
            isPanelOpen = true;
            panel.classList.remove('hidden');
            panel.classList.add('visible');
        });

        events.addEventListener('disconnected', function () {
            isConnected = false;
            fab.classList.remove('connected');
            statusDot.classList.remove('online');
            statusText.textContent = 'Bağlantı koptu...';

            if (isConnected) {
                showNotification('Sistem', 'Bağlantı kesildi!');
            }
        });

        events.addEventListener('chat-message', function (e) {
            addMessage(e.detail.sender, e.detail.text, false);
            if (!isPanelOpen) {
                unreadCount++;
                unreadBadge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
                unreadBadge.classList.add('visible');
                showNotification(e.detail.sender, e.detail.text);
            }
        });

        events.addEventListener('own-message', function (e) {
            addMessage(e.detail.sender, e.detail.text, true);
        });

        events.addEventListener('system-message', function (e) {
            addSystemMessage(e.detail.text);
            showNotification('Sistem', e.detail.text);
        });

        events.addEventListener('user-list', function (e) {
            userList.innerHTML = '<span class="user-list-label">İzleyenler</span>';
            e.detail.users.forEach(function (user) {
                var tag = document.createElement('span');
                tag.className = 'user-tag';
                tag.textContent = user;
                userList.appendChild(tag);
            });
        });

        events.addEventListener('play-state-changed', function (e) {
            btnPlay.innerHTML = e.detail.playing ? ICONS.pause : ICONS.play;
        });

        events.addEventListener('time-update', function (e) {
            timeDisplay.textContent = formatTime(e.detail.current) + ' / ' + formatTime(e.detail.duration);
        });

        events.addEventListener('volume-changed', function (e) {
            btnMute.innerHTML = e.detail.muted ? ICONS.volumeMute : ICONS.volumeUp;
            var percent = Math.round((e.detail.muted ? 0 : e.detail.volume) * 100);
            volumeText.textContent = percent + '%';
            volumeSlider.value = percent;
        });

        events.addEventListener('emergency-pause', function (e) {
            emergencyMsg.textContent = e.detail.userName + ' DÜŞTÜ! Video durduruldu.';
            emergency.classList.add('show');
            setTimeout(function () { emergency.classList.remove('show'); }, 5000);
        });

        events.addEventListener('url-mismatch', function (e) {
            urlWarningMsg.textContent = 'Farklı sayfalardaysınız! Aynı videoyu açtığınızdan emin olun.';
            urlWarning.classList.add('show');
            setTimeout(function () { urlWarning.classList.remove('show'); }, 8000);
        });

        events.addEventListener('reaction-anim', function (e) {
            showFloatingEmoji(e.detail.type);
        });

        events.addEventListener('user-typing', function (e) {
            if (e.detail.isTyping) {
                typingIndicator.textContent = e.detail.user + ' yazıyor...';
                typingIndicator.classList.add('visible');
            } else {
                typingIndicator.classList.remove('visible');
            }
        });

        events.addEventListener('drawing-changed', function (e) {
            if (e.detail.active) {
                btnDraw.classList.add('active');
                showNotification('Mod', 'Çizim Modu: AÇIK');
            } else {
                btnDraw.classList.remove('active');
                showNotification('Mod', 'Çizim Modu: KAPALI');
            }
        });

        events.addEventListener('mouse-share-changed', function (e) {
            if (e.detail.active) {
                btnMouse.classList.add('active');
                showNotification('Sistem', 'Mouse Takibi: AÇIK');
            } else {
                btnMouse.classList.remove('active');
                showNotification('Sistem', 'Mouse Takibi: KAPALI');
            }
        });

        events.addEventListener('video-found', function () {
            showNotification('Sistem', 'Video bulundu!');
        });

        // ─── Remote Mouse Cursors ───
        events.addEventListener('remote-mouse', function (e) {
            showRemoteCursor(e.detail);
        });

        events.addEventListener('remove-cursor', function (e) {
            var cursor = document.getElementById('yakishi-cursor-' + e.detail.id);
            if (cursor) cursor.remove();
        });

        // ═══════════════════════════════════════
        //  HELPER FUNCTIONS
        // ═══════════════════════════════════════

        function addMessage(sender, text, isMine) {
            var div = document.createElement('div');
            div.className = 'msg' + (isMine ? ' mine' : '');
            div.innerHTML = '<strong>' + escapeHtml(sender) + ':</strong> ' + escapeHtml(text);
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;

            // Maksimum 200 mesaj tut
            while (chatMessages.children.length > 200) {
                chatMessages.removeChild(chatMessages.firstChild);
            }
        }

        function addSystemMessage(text) {
            var div = document.createElement('div');
            div.className = 'msg system';
            div.textContent = text;
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function showNotification(title, msg) {
            notifTitle.textContent = title;
            notifMsg.textContent = msg;
            notification.classList.add('show');
            clearTimeout(notifTimeout);
            notifTimeout = setTimeout(function () {
                notification.classList.remove('show');
            }, 3000);
        }

        function showFloatingEmoji(type) {
            var el = document.createElement('div');
            el.className = 'floating-emoji';
            el.textContent = type;
            el.style.left = (Math.random() * 70 + 15) + '%';
            root.appendChild(el);
            setTimeout(function () { el.remove(); }, 3000);
        }

        function showRemoteCursor(data) {
            // Ana sayfa DOM'unda göster (Shadow DOM dışında)
            var cursorId = 'yakishi-cursor-' + data.id;
            var cursor = document.getElementById(cursorId);
            if (!cursor) {
                cursor = document.createElement('div');
                cursor.id = cursorId;
                cursor.style.cssText =
                    'position:fixed;pointer-events:none;z-index:2147483645;' +
                    'width:12px;height:12px;border-radius:50%;' +
                    'background:' + (data.color || '#ff80bf') + ';' +
                    'box-shadow:0 0 10px ' + (data.color || '#ff80bf') + ';' +
                    'transform:translate(-50%,-50%);' +
                    'transition:left 0.1s linear,top 0.1s linear,opacity 0.3s;';

                var nameTag = document.createElement('span');
                nameTag.style.cssText =
                    'position:absolute;top:15px;left:50%;transform:translateX(-50%);' +
                    'background:rgba(0,0,0,0.75);color:white;padding:2px 6px;' +
                    'border-radius:4px;font-size:10px;white-space:nowrap;' +
                    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
                nameTag.textContent = data.name || '?';
                cursor.appendChild(nameTag);
                document.body.appendChild(cursor);
            }

            // Video üzerinde konumlandır
            var video = document.querySelector('video');
            if (video) {
                var rect = video.getBoundingClientRect();
                cursor.style.left = (rect.left + (data.x / 100) * rect.width) + 'px';
                cursor.style.top = (rect.top + (data.y / 100) * rect.height) + 'px';
            }
            cursor.style.opacity = '1';

            // Trail efekti
            if (video) {
                var trail = document.createElement('div');
                trail.style.cssText =
                    'position:fixed;pointer-events:none;z-index:2147483644;' +
                    'width:8px;height:8px;border-radius:50%;' +
                    'background:' + (data.color || '#ff80bf') + ';' +
                    'transform:translate(-50%,-50%);opacity:0.6;' +
                    'left:' + cursor.style.left + ';top:' + cursor.style.top + ';' +
                    'transition:opacity 0.5s;';
                document.body.appendChild(trail);
                setTimeout(function () { trail.style.opacity = '0'; }, 50);
                setTimeout(function () { trail.remove(); }, 600);
            }

            clearTimeout(cursor._hideTimeout);
            cursor._hideTimeout = setTimeout(function () {
                cursor.style.opacity = '0';
            }, 2000);
        }

        function formatTime(s) {
            if (!s || isNaN(s) || !isFinite(s)) return '00:00';
            var min = Math.floor(s / 60);
            var sec = Math.floor(s % 60);
            return (min < 10 ? '0' + min : min) + ':' + (sec < 10 ? '0' + sec : sec);
        }

        function escapeHtml(text) {
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // ═══════════════════════════════════════
        //  BUILD PANEL HTML
        // ═══════════════════════════════════════
        function buildPanelHTML() {
            var imgUrl = '';
            try { imgUrl = chrome.runtime.getURL('simgecik.png'); } catch (e) { imgUrl = ''; }

            return '' +
                /* FAB */
                '<div class="yakishi-fab">' +
                    (imgUrl ? '<img src="' + imgUrl + '" alt="Y" class="fab-icon">' : '<span style="font-size:20px;color:#ff80bf">🔥</span>') +
                    '<span class="unread-badge"></span>' +
                '</div>' +

                /* Panel */
                '<div class="yakishi-panel hidden">' +
                    /* Header */
                    '<div class="panel-header">' +
                        '<span class="header-title">🔥 HD Yakishi Cehennemi</span>' +
                        '<div class="header-actions">' +
                            '<button class="header-btn" id="yk-minimize-btn" title="Küçült">' + ICONS.minimize + '</button>' +
                        '</div>' +
                    '</div>' +

                    /* Status */
                    '<div class="status-bar">' +
                        '<span class="status-dot"></span>' +
                        '<span class="status-text">Bağlı değil</span>' +
                    '</div>' +

                    /* User List */
                    '<div class="user-list"></div>' +

                    /* Video Controls */
                    '<div class="video-controls">' +
                        '<button class="ctrl-btn" id="yk-btn-back" title="-5 saniye">' + ICONS.skipBack + '</button>' +
                        '<button class="ctrl-btn" id="yk-btn-play" title="Oynat/Durdur">' + ICONS.play + '</button>' +
                        '<button class="ctrl-btn" id="yk-btn-forward" title="+5 saniye">' + ICONS.skipForward + '</button>' +
                        '<div class="volume-group">' +
                            '<button class="ctrl-btn" id="yk-btn-mute" title="Sessiz">' + ICONS.volumeUp + '</button>' +
                            '<input type="range" class="volume-slider" id="yk-volume-slider" min="0" max="200" value="100">' +
                            '<span class="volume-text">100%</span>' +
                        '</div>' +
                        '<span class="time-display">00:00 / 00:00</span>' +
                    '</div>' +

                    /* Chat */
                    '<div class="chat-messages"></div>' +
                    '<div class="typing-indicator"></div>' +

                    /* Reactions */
                    '<div class="reaction-bar">' +
                        '<button class="reaction-btn" data-emoji="❤️">❤️</button>' +
                        '<button class="reaction-btn" data-emoji="😂">😂</button>' +
                        '<button class="reaction-btn" data-emoji="😲">😲</button>' +
                        '<button class="reaction-btn" data-emoji="👏">👏</button>' +
                        '<button class="reaction-btn" data-emoji="🔥">🔥</button>' +
                    '</div>' +

                    /* Input */
                    '<div class="chat-input-area">' +
                        '<input type="text" class="chat-input" id="yk-msg-input" placeholder="Mesaj..." autocomplete="off">' +
                        '<button class="send-btn" id="yk-send-btn">' + ICONS.send + '</button>' +
                    '</div>' +

                    /* Toggles */
                    '<div class="toggle-bar">' +
                        '<button class="toggle-btn" id="yk-btn-draw" title="Çizim Modu">' + ICONS.pencil + ' Çizim</button>' +
                        '<button class="toggle-btn" id="yk-btn-mouse" title="Mouse Paylaş">' + ICONS.mouse + ' Mouse</button>' +
                    '</div>' +
                '</div>' +

                /* Notification */
                '<div class="yakishi-notification">' +
                    '<div class="notif-title"></div>' +
                    '<div class="notif-msg"></div>' +
                '</div>' +

                /* Emergency */
                '<div class="yakishi-emergency">' +
                    '<div class="emergency-icon">⚠️</div>' +
                    '<div class="emergency-msg"></div>' +
                '</div>' +

                /* URL Warning */
                '<div class="yakishi-url-warning">' +
                    '<div class="warning-icon">⚠️</div>' +
                    '<div class="warning-msg"></div>' +
                '</div>';
        }
    }
})();
