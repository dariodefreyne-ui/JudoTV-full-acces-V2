(() => {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────
  const EXT_ID         = 'judotv-ext-v2';
  const CONTROLS_ID    = `${EXT_ID}-controls`;
  const TOAST_ID       = `${EXT_ID}-toast`;
  const MAX_RECONNECTS = 4;
  const HIDE_DELAY_MS  = 3000;
  const STALL_TIMEOUT_MS = 8000;

  // Alle bekende ad-selectors — uitbreidbaar
  const AD_SELECTORS = [
    // Originele v1 selectors
    '.flex.items-center.justify-center.top-0.left-0.right-0.absolute.z-10.w-5\\/6',
    '.flex.items-center.justify-center.right-0.absolute.z-10.w-1\\/4.bottom-\\[30\\%\\]',
    // Generieke overlay-patronen
    '[class*="ad-overlay"]',
    '[class*="advertisement"]',
    '[id*="ad-container"]',
    '[id*="sponsor-overlay"]',
    'div[style*="z-index: 9999"]:not(#judotv-ext-v2-controls)',
    // Iframes die niet van judotv.com komen (ad-iframes)
    'iframe:not([src*="judotv.com"]):not([src*="vimeo"]):not([src*="youtube"])',
  ];

  // ─── State ────────────────────────────────────────────────────────────────
  let reconnectCount  = 0;
  let stallTimer      = null;
  let hideTimer       = null;
  let autoReconnect   = true;
  let observerActive  = false;
  let rafPending      = false;

  // ─── Settings (via chrome.storage) ───────────────────────────────────────
  function loadSettings() {
    chrome.storage.sync.get({ autoReconnect: true }, (result) => {
      autoReconnect = result.autoReconnect;
    });
  }

  // ─── Toast notificaties ───────────────────────────────────────────────────
  function showToast(message, type = 'info', duration = 3500) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `judotv-toast judotv-toast--${type} judotv-toast--visible`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('judotv-toast--visible');
    }, duration);
  }

  // ─── Ad removal ───────────────────────────────────────────────────────────
  function removeAds() {
    let removed = 0;
    AD_SELECTORS.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          // Nooit onze eigen extensie-elementen verwijderen
          if (el.id && el.id.startsWith(EXT_ID)) return;
          if (el.closest(`#${CONTROLS_ID}`)) return;
          el.remove();
          removed++;
        });
      } catch (_) { /* ongeldige selector — overslaan */ }
    });
    return removed;
  }

  // ─── Throttled MutationObserver via rAF ──────────────────────────────────
  function onDOMMutation() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      removeAds();
      ensureControlsExist();
    });
  }

  function startObserver() {
    if (observerActive) return;
    const observer = new MutationObserver(onDOMMutation);
    observer.observe(document.body, { childList: true, subtree: true });
    observerActive = true;
  }

  // ─── Auto-reconnect ───────────────────────────────────────────────────────
  function scheduleReconnect(video, reason) {
    if (!autoReconnect) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      attemptReconnect(video, reason);
    }, STALL_TIMEOUT_MS);
  }

  function attemptReconnect(video, reason) {
    if (reconnectCount >= MAX_RECONNECTS) {
      showToast('⚠️ Stream kon niet hersteld worden. Herlaad de pagina.', 'error', 8000);
      updateStatusBadge('error');
      return;
    }
    reconnectCount++;
    showToast(`🔄 Stream herstellen... (poging ${reconnectCount}/${MAX_RECONNECTS})`, 'warn', 4000);
    updateStatusBadge('reconnecting');

    const currentTime = video.currentTime;
    video.load();
    video.addEventListener('canplay', () => {
      video.currentTime = currentTime;
      video.play().catch(() => {});
      reconnectCount = 0;
      updateStatusBadge('live');
      showToast('✅ Stream hersteld', 'success');
    }, { once: true });
  }

  function bindVideoEvents(video) {
    video.addEventListener('stalled', () => {
      updateStatusBadge('stalled');
      scheduleReconnect(video, 'stalled');
    });
    video.addEventListener('waiting', () => {
      updateStatusBadge('stalled');
      scheduleReconnect(video, 'waiting');
    });
    video.addEventListener('error', () => {
      updateStatusBadge('error');
      scheduleReconnect(video, 'error');
    });
    video.addEventListener('playing', () => {
      clearTimeout(stallTimer);
      reconnectCount = 0;
      updateStatusBadge('live');
    });
    video.addEventListener('pause', () => {
      clearTimeout(stallTimer);
      updateStatusBadge('paused');
    });
  }

  // ─── Status badge (in controls bar) ──────────────────────────────────────
  function updateStatusBadge(state) {
    const badge = document.getElementById(`${EXT_ID}-status`);
    if (!badge) return;
    const map = {
      live:         { text: '● LIVE',      cls: 'status--live'        },
      stalled:      { text: '⏸ Buffering', cls: 'status--stalled'     },
      reconnecting: { text: '🔄 Herstel',  cls: 'status--reconnecting'},
      error:        { text: '✕ Fout',       cls: 'status--error'       },
      paused:       { text: '⏸ Gepauzeerd',cls: 'status--paused'      },
    };
    const s = map[state] || map.live;
    badge.textContent = s.text;
    badge.className   = `judotv-status-badge ${s.cls}`;

    // Stuur ook status naar popup
    chrome.storage.session?.set?.({ streamStatus: state });
  }

  // ─── Acties ───────────────────────────────────────────────────────────────
  function getVideo() {
    return document.querySelector('video.vjs-tech') || document.querySelector('video');
  }

  function doRewind(seconds) {
    const v = getVideo();
    if (!v) return;
    v.currentTime = Math.max(0, v.currentTime - seconds);
    showToast(`⏪ ${seconds}s terug`, 'info', 1500);
  }

  function doGoLive() {
    const v = getVideo();
    if (!v) return;
    try {
      v.currentTime = v.seekable.end(0);
      showToast('⏩ Naar live', 'success', 1500);
    } catch (_) {
      showToast('Geen live stream actief', 'warn', 2000);
    }
  }

  function doFullscreen() {
    // Fullscreen op de video-wrapper zodat onze controls mee in fullscreen gaan
    const wrapper = document.getElementById(CONTROLS_ID)?.parentElement
                    || getVideo()?.closest('.relative.aspect-video')
                    || getVideo()?.parentElement;
    if (!wrapper) return;
    const req = wrapper.requestFullscreen || wrapper.webkitRequestFullscreen;
    if (req) req.call(wrapper).catch(() => {});
  }

  // ─── Controls injectie ────────────────────────────────────────────────────
  function ensureControlsExist() {
    if (document.getElementById(CONTROLS_ID)) return; // al aanwezig

    const videoEl = getVideo();
    if (!videoEl) return;

    const wrapper = videoEl.closest('.relative.aspect-video')
                    || videoEl.closest('[class*="video-wrapper"]')
                    || videoEl.parentElement;
    if (!wrapper) return;

    // Wrapper moet position:relative hebben
    const wStyle = getComputedStyle(wrapper);
    if (wStyle.position === 'static') wrapper.style.position = 'relative';

    // ── Container ──
    const bar = document.createElement('div');
    bar.id = CONTROLS_ID;
    bar.className = 'judotv-controls';

    // ── Status badge ──
    const badge = document.createElement('span');
    badge.id = `${EXT_ID}-status`;
    badge.className = 'judotv-status-badge status--live';
    badge.textContent = '● LIVE';

    // ── Knoppen ──
    const btns = [
      { label: '⏪ 5s',        title: '5 seconden terug',   action: () => doRewind(5)   },
      { label: '⏪ 10s',       title: '10 seconden terug',  action: () => doRewind(10)  },
      { label: '⏪ 30s',       title: '30 seconden terug',  action: () => doRewind(30)  },
      { label: '⏩ LIVE',      title: 'Ga naar live',       action: doGoLive            },
      { label: '⛶ Volledig',  title: 'Volledig scherm',    action: doFullscreen        },
    ];

    bar.appendChild(badge);

    btns.forEach(({ label, title, action }) => {
      const btn = document.createElement('button');
      btn.className   = 'judotv-btn';
      btn.textContent = label;
      btn.title       = title;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        action();
      });
      bar.appendChild(btn);
    });

    wrapper.appendChild(bar);

    // ── Mouse-interactie: toon/verberg ──
    function showControls() {
      bar.classList.add('judotv-controls--visible');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        bar.classList.remove('judotv-controls--visible');
      }, HIDE_DELAY_MS);
    }

    wrapper.addEventListener('mousemove', showControls);
    wrapper.addEventListener('mouseenter', showControls);
    wrapper.addEventListener('mouseleave', () => {
      clearTimeout(hideTimer);
      bar.classList.remove('judotv-controls--visible');
    });
    // Knoppen zelf: timer resetten bij hover
    bar.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      bar.classList.add('judotv-controls--visible');
    });

    // Video events binden
    bindVideoEvents(videoEl);
    updateStatusBadge('live');
  }

  // ─── SPA-navigatie opvangen ───────────────────────────────────────────────
  let lastUrl = location.href;
  function checkNavigation() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Wacht even tot nieuwe DOM geladen is
      setTimeout(() => {
        removeAds();
        ensureControlsExist();
      }, 1500);
    }
  }
  setInterval(checkNavigation, 1000);

  // ─── Berichten van popup ──────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'rewind')      doRewind(msg.seconds);
    if (msg.action === 'goLive')      doGoLive();
    if (msg.action === 'fullscreen')  doFullscreen();
    if (msg.action === 'setAutoReconnect') {
      autoReconnect = msg.value;
      chrome.storage.sync.set({ autoReconnect: msg.value });
    }
    if (msg.action === 'getStatus') {
      const v = getVideo();
      return Promise.resolve({
        hasVideo:      !!v,
        paused:        v ? v.paused : null,
        currentTime:   v ? Math.floor(v.currentTime) : null,
        autoReconnect,
      });
    }
  });

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    loadSettings();
    removeAds();
    ensureControlsExist();
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
