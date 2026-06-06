// ==UserScript==
// @name         JudoTV Enhanced (iOS)
// @namespace    https://judotv.com
// @version      2.5
// @description  Advertenties verwijderen, videobediening en auto-reconnect op judotv.com
// @author       JudoTV Enhanced
// @match        https://judotv.com/*
// @match        https://www.judotv.com/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
  'use strict';

  // ─── Stijlen injecteren ───────────────────────────────────────────────────
  const css = `
    #judotv-ext-v2-controls {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 9998;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 5px;
      padding: 8px 10px;
      background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%);
      pointer-events: none;
      opacity: 0;
      transform: translateY(6px);
      transition: opacity 0.22s ease, transform 0.22s ease;
    }
    #judotv-ext-v2-controls.judotv-controls--visible {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    .judotv-btn {
      display: inline-flex;
      align-items: center;
      padding: 4px 9px;
      border-radius: 20px;
      background: rgba(255,255,255,0.15);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      font-family: system-ui, sans-serif;
      cursor: pointer;
      -webkit-backdrop-filter: blur(6px);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255,255,255,0.22);
      transition: background 0.15s ease;
      white-space: nowrap;
    }
    .judotv-btn:active { background: rgba(255,255,255,0.35); }
    .judotv-status-badge {
      font-size: 10px;
      font-weight: 700;
      font-family: system-ui, sans-serif;
      padding: 2px 7px;
      border-radius: 10px;
      letter-spacing: 0.3px;
    }
    .status--live         { background: #e8000d; color: #fff; }
    .status--stalled      { background: #f59e0b; color: #000; }
    .status--reconnecting { background: #3b82f6; color: #fff; }
    .status--error        { background: #6b7280; color: #fff; }
    .status--paused       { background: #374151; color: #9ca3af; }
    .judotv-toast {
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%) translateY(10px);
      z-index: 99999;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      color: #fff;
      background: rgba(20,20,20,0.93);
      -webkit-backdrop-filter: blur(8px);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      opacity: 0;
      transition: opacity 0.25s ease, transform 0.25s ease;
      pointer-events: none;
      white-space: nowrap;
      max-width: 88vw;
    }
    .judotv-toast--visible  { opacity: 1; transform: translateX(-50%) translateY(0); }
    .judotv-toast--warn     { background: rgba(160,100,0,0.93); }
    .judotv-toast--error    { background: rgba(160,30,30,0.93); }
    .judotv-toast--success  { background: rgba(20,110,60,0.93); }
    #judotv-ext-v2-airplay {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99998;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(10,10,10,0.93);
      border-radius: 32px;
      border: 1px solid rgba(255,255,255,0.18);
      -webkit-backdrop-filter: blur(14px);
      backdrop-filter: blur(14px);
      box-shadow: 0 4px 28px rgba(0,0,0,0.55);
    }
    .judotv-airplay-label {
      font-size: 11px;
      font-weight: 700;
      font-family: system-ui, sans-serif;
      color: #60a5fa;
      padding-right: 4px;
      border-right: 1px solid rgba(255,255,255,0.15);
      margin-right: 2px;
      white-space: nowrap;
    }
  `;

  if (typeof GM_addStyle !== 'undefined') {
    GM_addStyle(css);
  } else {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─── Constants ────────────────────────────────────────────────────────────
  const EXT_ID           = 'judotv-ext-v2';
  const CONTROLS_ID      = `${EXT_ID}-controls`;
  const TOAST_ID         = `${EXT_ID}-toast`;
  const AIRPLAY_PANEL_ID = `${EXT_ID}-airplay`;
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
    // Cookie- en consent-banners
    '[class*="cookie-banner"]',
    '[class*="cookie-consent"]',
    '[class*="cookie-notice"]',
    '[id*="cookie-banner"]',
    '[id*="cookie-consent"]',
    '[class*="gdpr"]',
    '[id*="gdpr"]',
    '[class*="consent-popup"]',
    // Generieke modals/popups
    '[class*="modal-overlay"]',
    '[class*="popup-overlay"]',
    '[id*="modal-overlay"]',
    // Google One Tap / inlog-prompt (schuift van boven naar beneden)
    '#credential_picker_container',
    '#g_id_onload',
    '[id*="google-one-tap"]',
    '[class*="google-one-tap"]',
    '[class*="g_id_signin"]',
    // App-download / smartbanners
    '[class*="smartbanner"]',
    '[id*="smartbanner"]',
    '.branch-banner-container',
    '[class*="app-banner"]',
    '[id*="app-banner"]',
    '[class*="app-install"]',
    '[class*="open-in-app"]',
    '[class*="download-app"]',
  ];

  const STATUS_BADGE_MAP = {
    live:         { text: '● LIVE',       cls: 'status--live'         },
    stalled:      { text: '⏸ Buffering',  cls: 'status--stalled'      },
    reconnecting: { text: '🔄 Herstel',   cls: 'status--reconnecting' },
    error:        { text: '✕ Fout',        cls: 'status--error'        },
    paused:       { text: '⏸ Gepauzeerd', cls: 'status--paused'       },
  };

  // ─── State ────────────────────────────────────────────────────────────────
  let reconnectCount        = 0;
  let stallTimer            = null;
  let hideTimer             = null;
  let observer              = null;
  let rafPending            = false;
  let boundVideo            = null;
  let videoEventController  = null;
  let wrapperController     = null;
  let navInterval           = null;

  // Auto-reconnect instelling via GM_getValue/GM_setValue (of standaard true)
  let autoReconnect = (typeof GM_getValue !== 'undefined')
    ? GM_getValue('autoReconnect', true)
    : true;

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
    document.querySelectorAll('iframe[src]').forEach(el => {
      const src = el.getAttribute('src').toLowerCase();
      const allowed = src.includes('judotv.com') || src.includes('vimeo') || src.includes('youtube');
      if (!allowed) el.remove();
    });
    // Google One Tap gebruikt soms een frameless container zonder iframe
    document.querySelectorAll('[id^="g_"][style*="position"]').forEach(el => {
      if (!el.id.startsWith(EXT_ID)) el.remove();
    });
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
    if (observer) return;
    observer = new MutationObserver(onDOMMutation);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Auto-reconnect ───────────────────────────────────────────────────────
  function scheduleReconnect(video) {
    if (!autoReconnect) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => attemptReconnect(video), STALL_TIMEOUT_MS);
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
    if (video === boundVideo) return;
    if (videoEventController) videoEventController.abort();
    videoEventController = new AbortController();
    const { signal } = videoEventController;
    boundVideo = video;

    ['stalled', 'waiting'].forEach(evt => {
      video.addEventListener(evt, () => {
        updateStatusBadge('stalled');
        scheduleReconnect(video);
      }, { signal });
    });
    video.addEventListener('error', () => {
      updateStatusBadge('error');
      scheduleReconnect(video);
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

    // AirPlay detectie via Remote Playback API
    if (video.remote) {
      video.remote.onconnect    = () => { createAirPlayPanel(); showToast('📺 AirPlay verbonden', 'info', 2500); };
      video.remote.ondisconnect = () => { removeAirPlayPanel(); showToast('📺 AirPlay verbroken', 'info', 2500); };
      if (video.remote.state === 'connected') createAirPlayPanel();
    }
  }

  // ─── Status badge ─────────────────────────────────────────────────────────
  function updateStatusBadge(state) {
    const badge = document.getElementById(`${EXT_ID}-status`);
    if (!badge) return;
    const s = STATUS_BADGE_MAP[state] || STATUS_BADGE_MAP.live;
    badge.textContent = s.text;
    badge.className   = `judotv-status-badge ${s.cls}`;
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
    const v = getVideo();
    if (!v) return;
    // iOS Safari ondersteunt geen requestFullscreen op div-elementen;
    // webkitEnterFullscreen werkt alleen op <video> zelf
    if (v.webkitEnterFullscreen) {
      v.webkitEnterFullscreen();
      return;
    }
    const wrapper = document.getElementById(CONTROLS_ID)?.parentElement
                    || v.closest('.relative.aspect-video')
                    || v.parentElement;
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

  // ─── AirPlay zwevend paneel ───────────────────────────────────────────────
  function createAirPlayPanel() {
    if (document.getElementById(AIRPLAY_PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = AIRPLAY_PANEL_ID;

    const label = document.createElement('span');
    label.className = 'judotv-airplay-label';
    label.textContent = '📺 AirPlay';
    panel.appendChild(label);

    const btns = [
      { label: '⏪ 10s',  action: () => doRewind(10) },
      { label: '⏪ 30s',  action: () => doRewind(30) },
      { label: '⏯',       action: () => { const v = getVideo(); if (v) v.paused ? v.play().catch(() => {}) : v.pause(); } },
      { label: '⏩ LIVE', action: doGoLive },
    ];

    btns.forEach(({ label, action }) => {
      const btn = document.createElement('button');
      btn.className   = 'judotv-btn';
      btn.textContent = label;
      btn.addEventListener('click', (e) => { e.stopPropagation(); action(); });
      panel.appendChild(btn);
    });

    document.body.appendChild(panel);
  }

  function removeAirPlayPanel() {
    document.getElementById(AIRPLAY_PANEL_ID)?.remove();
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

    const wStyle = getComputedStyle(wrapper);
    if (wStyle.position === 'static') wrapper.style.position = 'relative';

    const bar = document.createElement('div');
    bar.id = CONTROLS_ID;
    bar.className = 'judotv-controls';

    const badge = document.createElement('span');
    badge.id = `${EXT_ID}-status`;
    badge.className = 'judotv-status-badge status--live';
    badge.textContent = '● LIVE';

    const btns = [
      { label: '⏪ 5s',    title: '5 seconden terug',   action: () => doRewind(5)  },
      { label: '⏪ 10s',   title: '10 seconden terug',  action: () => doRewind(10) },
      { label: '⏪ 30s',   title: '30 seconden terug',  action: () => doRewind(30) },
      { label: '⏩ LIVE',  title: 'Ga naar live',        action: doGoLive           },
      { label: '⧉ PiP',   title: 'Picture-in-Picture',  action: doPiP              },
      { label: '⛶ Scherm', title: 'Volledig scherm',    action: doFullscreen       },
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

    if (wrapperController) wrapperController.abort();
    wrapperController = new AbortController();
    const { signal: wSignal } = wrapperController;

    function showControls() {
      bar.classList.add('judotv-controls--visible');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => bar.classList.remove('judotv-controls--visible'), HIDE_DELAY_MS);
    }
    function hideControls() {
      clearTimeout(hideTimer);
      bar.classList.remove('judotv-controls--visible');
    }

    wrapper.addEventListener('mousemove',  showControls, { signal: wSignal });
    wrapper.addEventListener('mouseenter', showControls, { signal: wSignal });
    wrapper.addEventListener('touchstart', showControls, { passive: true, signal: wSignal });
    wrapper.addEventListener('mouseleave', hideControls, { signal: wSignal });
    bar.addEventListener('mouseenter', showControls, { signal: wSignal });

    bindVideoEvents(videoEl);
    updateStatusBadge('live');
  }

  // ─── SPA-navigatie opvangen ───────────────────────────────────────────────
  let lastUrl = location.href;
  function onNavigate() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    document.getElementById(CONTROLS_ID)?.remove();
    removeAirPlayPanel();
    boundVideo = null;
    if (videoEventController) { videoEventController.abort(); videoEventController = null; }
    if (wrapperController)    { wrapperController.abort();    wrapperController = null; }
    reconnectCount = 0;
    clearTimeout(stallTimer);
    setTimeout(() => { removeAds(); ensureControlsExist(); }, 1500);
  }
  window.addEventListener('popstate',   onNavigate);
  window.addEventListener('hashchange', onNavigate);

  window.addEventListener('pagehide', () => {
    if (observer)             { observer.disconnect();        observer = null; }
    if (navInterval)          { clearInterval(navInterval);   navInterval = null; }
    if (videoEventController) { videoEventController.abort(); videoEventController = null; }
    if (wrapperController)    { wrapperController.abort();    wrapperController = null; }
    removeAirPlayPanel();
    clearTimeout(stallTimer);
    clearTimeout(hideTimer);
  });

  // Herstel na terugkeer uit iOS bfcache (app-wisseling, terug-knop)
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    startObserver();
    removeAds();
    document.getElementById(CONTROLS_ID)?.remove();
    boundVideo = null;
    ensureControlsExist();
    if (!navInterval) navInterval = setInterval(onNavigate, 1000);
  });

  // Herstel knoppen bij terugkeer in Safari zonder volledige pageshow
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      setTimeout(() => ensureControlsExist(), 400);
    }
  });

  // ─── Init ─────────────────────────────────────────────────────────────────
  removeAds();
  ensureControlsExist();
  startObserver();
  navInterval = setInterval(onNavigate, 1000);

})();
