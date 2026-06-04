// ==UserScript==
// @name         JudoTV Enhanced (iOS)
// @namespace    https://judotv.com
// @version      2.1
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
      gap: 8px;
      padding: 10px 14px;
      background: linear-gradient(to top, rgba(0,0,0,0.82) 0%, transparent 100%);
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
      gap: 4px;
      padding: 5px 11px;
      border: none;
      border-radius: 20px;
      background: rgba(255,255,255,0.13);
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      cursor: pointer;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border: 1px solid rgba(255,255,255,0.18);
      transition: background 0.15s ease, transform 0.1s ease;
      white-space: nowrap;
    }
    .judotv-btn:hover { background: rgba(255,255,255,0.26); transform: scale(1.05); }
    .judotv-btn:active { transform: scale(0.97); }
    .judotv-status-badge {
      font-size: 11px;
      font-weight: 700;
      font-family: system-ui, sans-serif;
      padding: 3px 8px;
      border-radius: 12px;
      margin-right: 4px;
      letter-spacing: 0.3px;
    }
    .status--live         { background: #e8000d; color: #fff; }
    .status--stalled      { background: #f59e0b; color: #000; }
    .status--reconnecting { background: #3b82f6; color: #fff; }
    .status--error        { background: #6b7280; color: #fff; }
    .status--paused       { background: #374151; color: #9ca3af; }
    .judotv-toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(12px);
      z-index: 99999;
      padding: 9px 18px;
      border-radius: 24px;
      font-size: 14px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      color: #fff;
      background: rgba(30,30,30,0.92);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      opacity: 0;
      transition: opacity 0.25s ease, transform 0.25s ease;
      pointer-events: none;
      white-space: nowrap;
    }
    .judotv-toast--visible  { opacity: 1; transform: translateX(-50%) translateY(0); }
    .judotv-toast--warn     { background: rgba(180, 120, 0, 0.92); }
    .judotv-toast--error    { background: rgba(180, 30, 30, 0.92); }
    .judotv-toast--success  { background: rgba(22, 130, 80, 0.92); }
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
  let observer             = null;
  let rafPending           = false;
  let boundVideo           = null;
  let videoEventController = null;

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
      if (!src.includes('judotv.com') && !src.includes('vimeo') && !src.includes('youtube')) {
        el.remove();
      }
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
  function scheduleReconnect(video, reason) {
    if (!autoReconnect) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      attemptReconnect(video, reason);
    }, STALL_TIMEOUT_MS);
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
    bar.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      bar.classList.add('judotv-controls--visible');
    });

    // Touch-ondersteuning voor iOS
    wrapper.addEventListener('touchstart', () => {
      showControls();
    }, { passive: true });

    bindVideoEvents(videoEl);
    updateStatusBadge('live');
  }

  // ─── SPA-navigatie opvangen ───────────────────────────────────────────────
  let lastUrl = location.href;
  function checkNavigation() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    document.getElementById(CONTROLS_ID)?.remove();
    boundVideo = null;
    if (videoEventController) { videoEventController.abort(); videoEventController = null; }
    reconnectCount = 0;
    clearTimeout(stallTimer);
    setTimeout(() => { removeAds(); ensureControlsExist(); }, 1500);
  }
  const navInterval = setInterval(checkNavigation, 1000);

  window.addEventListener('pagehide', () => {
    if (observer)             { observer.disconnect(); observer = null; }
    clearInterval(navInterval);
    if (videoEventController) { videoEventController.abort(); videoEventController = null; }
    clearTimeout(stallTimer);
    clearTimeout(hideTimer);
  });

  // ─── Init ─────────────────────────────────────────────────────────────────
  removeAds();
  ensureControlsExist();
  startObserver();

})();
