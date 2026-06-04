(() => {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────
  const EXT_ID           = 'judotv-ext-v2';
  const CONTROLS_ID      = `${EXT_ID}-controls`;
  const TOAST_ID         = `${EXT_ID}-toast`;
  const MAX_RECONNECTS   = 4;
  const HIDE_DELAY_MS    = 3000;
  const STALL_TIMEOUT_MS = 8000;

  const AD_SELECTORS = [
    '.flex.items-center.justify-center.top-0.left-0.right-0.absolute.z-10.w-5\\/6',
    '.flex.items-center.justify-center.right-0.absolute.z-10.w-1\\/4.bottom-\\[30\\%\\]',
    '[class*="ad-overlay"]',
    '[class*="advertisement"]',
    '[id*="ad-container"]',
    '[id*="sponsor-overlay"]',
    'div[style*="z-index: 9999"]:not(#judotv-ext-v2-controls)',
  ];

  // ─── State ────────────────────────────────────────────────────────────────
  let reconnectCount       = 0;
  let stallTimer           = null;
  let hideTimer            = null;
  let autoReconnect        = true;
  let observer             = null;
  let rafPending           = false;
  let navInterval          = null;
  let boundVideo           = null;
  let videoEventController = null;

  // ─── Settings ─────────────────────────────────────────────────────────────
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
    AD_SELECTORS.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          if (el.id && el.id.startsWith(EXT_ID)) return;
          if (el.closest(`#${CONTROLS_ID}`)) return;
          el.remove();
        });
      } catch (_) {}
    });

    // Ad-iframes: case-insensitive check op src
    document.querySelectorAll('iframe[src]').forEach(el => {
      const src = el.getAttribute('src').toLowerCase();
      if (!src.includes('judotv.com') && !src.includes('vimeo') && !src.includes('youtube')) {
        el.remove();
      }
    });
  }

  // ─── Throttled MutationObserver ───────────────────────────────────────────
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
    if (observer) return;
    observer = new MutationObserver(onDOMMutation);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Auto-reconnect ───────────────────────────────────────────────────────
  function scheduleReconnect(video, reason) {
    if (!autoReconnect) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => attemptReconnect(video, reason), STALL_TIMEOUT_MS);
  }

  function attemptReconnect(video) {
    if (reconnectCount >= MAX_RECONNECTS) {
      showToast('⚠️ Stream kon niet hersteld worden. Herlaad de pagina.', 'error', 8000);
      updateStatusBadge('error');
      return;
    }
    reconnectCount++;
    showToast(`🔄 Stream herstellen... (poging ${reconnectCount}/${MAX_RECONNECTS})`, 'warn', 4000);
    updateStatusBadge('reconnecting');

    const savedTime = video.currentTime;
    try {
      video.load();
    } catch (_) {
      showToast('⚠️ Herstel mislukt. Herlaad de pagina.', 'error', 6000);
      return;
    }
    video.addEventListener('canplay', () => {
      video.currentTime = savedTime;
      video.play().catch(() => {});
      reconnectCount = 0;
      updateStatusBadge('live');
      showToast('✅ Stream hersteld', 'success');
    }, { once: true });
  }

  // Bind video events met AbortController zodat ze correct opgeruimd worden
  function bindVideoEvents(video) {
    if (video === boundVideo) return;
    if (videoEventController) videoEventController.abort();
    videoEventController = new AbortController();
    const { signal } = videoEventController;
    boundVideo = video;

    video.addEventListener('stalled', () => {
      updateStatusBadge('stalled');
      scheduleReconnect(video, 'stalled');
    }, { signal });
    video.addEventListener('waiting', () => {
      updateStatusBadge('stalled');
      scheduleReconnect(video, 'waiting');
    }, { signal });
    video.addEventListener('error', () => {
      updateStatusBadge('error');
      scheduleReconnect(video, 'error');
    }, { signal });
    video.addEventListener('playing', () => {
      clearTimeout(stallTimer);
      reconnectCount = 0;
      updateStatusBadge('live');
    }, { signal });
    video.addEventListener('pause', () => {
      clearTimeout(stallTimer);
      updateStatusBadge('paused');
    }, { signal });
  }

  // ─── Status badge ─────────────────────────────────────────────────────────
  function updateStatusBadge(state) {
    const badge = document.getElementById(`${EXT_ID}-status`);
    if (!badge) return;
    const map = {
      live:         { text: '● LIVE',       cls: 'status--live'         },
      stalled:      { text: '⏸ Buffering',  cls: 'status--stalled'      },
      reconnecting: { text: '🔄 Herstel',   cls: 'status--reconnecting' },
      error:        { text: '✕ Fout',        cls: 'status--error'        },
      paused:       { text: '⏸ Gepauzeerd', cls: 'status--paused'       },
    };
    const s = map[state] || map.live;
    badge.textContent = s.text;
    badge.className   = `judotv-status-badge ${s.cls}`;
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
    const wrapper = document.getElementById(CONTROLS_ID)?.parentElement
                    || getVideo()?.closest('.relative.aspect-video')
                    || getVideo()?.parentElement;
    if (!wrapper) return;
    const req = wrapper.requestFullscreen || wrapper.webkitRequestFullscreen;
    if (req) req.call(wrapper).catch(() => {});
  }

  function doPiP() {
    const v = getVideo();
    if (!v) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else {
      v.requestPictureInPicture().catch(() => {
        showToast('PiP niet ondersteund door deze browser', 'warn', 2500);
      });
    }
  }

  // ─── Toetsenbordsnelkoppelingen ───────────────────────────────────────────
  function handleKeyboard(e) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const v = getVideo();
    if (!v) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (v.paused) { v.play().catch(() => {}); showToast('▶ Afspelen', 'info', 1200); }
        else          { v.pause();                 showToast('⏸ Gepauzeerd', 'info', 1200); }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        doRewind(10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        doGoLive();
        break;
      case 'KeyF':
        doFullscreen();
        break;
      case 'KeyP':
        doPiP();
        break;
    }
  }

  // ─── Controls injectie ────────────────────────────────────────────────────
  function ensureControlsExist() {
    if (document.getElementById(CONTROLS_ID)) return;

    const videoEl = getVideo();
    if (!videoEl) return;

    const wrapper = videoEl.closest('.relative.aspect-video')
                    || videoEl.closest('[class*="video-wrapper"]')
                    || videoEl.parentElement;
    if (!wrapper) return;

    if (getComputedStyle(wrapper).position === 'static') {
      wrapper.style.position = 'relative';
    }

    const bar = document.createElement('div');
    bar.id = CONTROLS_ID;
    bar.className = 'judotv-controls';

    const badge = document.createElement('span');
    badge.id = `${EXT_ID}-status`;
    badge.className = 'judotv-status-badge status--live';
    badge.textContent = '● LIVE';

    const btns = [
      { label: '⏪ 5s',    title: '5 seconden terug (←)',    action: () => doRewind(5)  },
      { label: '⏪ 10s',   title: '10 seconden terug (←)',   action: () => doRewind(10) },
      { label: '⏪ 30s',   title: '30 seconden terug',        action: () => doRewind(30) },
      { label: '⏩ LIVE',  title: 'Ga naar live (→)',         action: doGoLive           },
      { label: '⧉ PiP',   title: 'Picture-in-Picture (P)',   action: doPiP              },
      { label: '⛶ Scherm', title: 'Volledig scherm (F)',     action: doFullscreen       },
    ];

    bar.appendChild(badge);
    btns.forEach(({ label, title, action }) => {
      const btn = document.createElement('button');
      btn.className      = 'judotv-btn';
      btn.textContent    = label;
      btn.title          = title;
      btn.setAttribute('aria-label', title);
      btn.addEventListener('click', (e) => { e.stopPropagation(); action(); });
      bar.appendChild(btn);
    });

    wrapper.appendChild(bar);

    function showControls() {
      bar.classList.add('judotv-controls--visible');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => bar.classList.remove('judotv-controls--visible'), HIDE_DELAY_MS);
    }

    wrapper.addEventListener('mousemove',  showControls);
    wrapper.addEventListener('mouseenter', showControls);
    wrapper.addEventListener('touchstart', showControls, { passive: true });
    wrapper.addEventListener('mouseleave', () => {
      clearTimeout(hideTimer);
      bar.classList.remove('judotv-controls--visible');
    });
    bar.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      bar.classList.add('judotv-controls--visible');
    });

    bindVideoEvents(videoEl);
    updateStatusBadge('live');
  }

  // ─── SPA-navigatie ────────────────────────────────────────────────────────
  let lastUrl = location.href;
  function checkNavigation() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    // Ruim controls op zodat ze op de nieuwe pagina opnieuw geïnjecteerd worden
    document.getElementById(CONTROLS_ID)?.remove();
    boundVideo = null;
    if (videoEventController) { videoEventController.abort(); videoEventController = null; }
    reconnectCount = 0;
    clearTimeout(stallTimer);
    setTimeout(() => { removeAds(); ensureControlsExist(); }, 1500);
  }

  // ─── Cleanup bij pagina-verlating ────────────────────────────────────────
  window.addEventListener('pagehide', () => {
    if (observer)             { observer.disconnect(); observer = null; }
    if (navInterval)          { clearInterval(navInterval); navInterval = null; }
    if (videoEventController) { videoEventController.abort(); videoEventController = null; }
    clearTimeout(stallTimer);
    clearTimeout(hideTimer);
  });

  // ─── Berichten van popup ──────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'rewind')      { doRewind(msg.seconds); return; }
    if (msg.action === 'goLive')      { doGoLive();            return; }
    if (msg.action === 'fullscreen')  { doFullscreen();        return; }
    if (msg.action === 'pip')         { doPiP();               return; }
    if (msg.action === 'setAutoReconnect') {
      autoReconnect = msg.value;
      chrome.storage.sync.set({ autoReconnect: msg.value });
      return;
    }
    if (msg.action === 'getStatus') {
      const v = getVideo();
      return Promise.resolve({
        hasVideo:     !!v,
        paused:       v ? v.paused : null,
        currentTime:  v ? Math.floor(v.currentTime) : null,
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
    document.addEventListener('keydown', handleKeyboard);
    navInterval = setInterval(checkNavigation, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
