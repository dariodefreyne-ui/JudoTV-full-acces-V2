(() => {
  'use strict';

  const statusEl = document.getElementById('stream-status');
  const toggleEl = document.getElementById('auto-reconnect-toggle');

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function sendToContent(msg) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length) return;
      chrome.tabs.sendMessage(tabs[0].id, msg).catch(() => {});
    });
  }

  function isJudoTVTab(url) {
    try {
      return new URL(url).hostname.includes('judotv.com');
    } catch (_) {
      return false;
    }
  }

  function setStatusUI(state, hasVideo) {
    const map = {
      live:         { text: '● LIVE',       cls: ''                    },
      stalled:      { text: '⏸ Buffering',  cls: 'status--stalled'     },
      reconnecting: { text: '🔄 Herstellen', cls: 'status--reconnecting'},
      error:        { text: '✕ Fout',        cls: 'status--error'       },
      paused:       { text: '⏸ Gepauzeerd', cls: 'status--paused'      },
    };
    if (!hasVideo) {
      statusEl.textContent = 'Geen video gevonden';
      statusEl.className   = 'popup__status status--no-video';
      return;
    }
    const s = map[state] || map.live;
    statusEl.textContent = s.text;
    statusEl.className   = `popup__status ${s.cls}`;
  }

  function disableButtons(disabled) {
    document.querySelectorAll('.popup__btn').forEach(btn => {
      btn.disabled = disabled;
    });
  }

  // ─── Status ophalen ───────────────────────────────────────────────────────
  function refreshStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length) {
        setStatusUI('error', false);
        disableButtons(true);
        return;
      }
      if (!isJudoTVTab(tabs[0].url || '')) {
        statusEl.textContent = 'Geen JudoTV tab';
        statusEl.className   = 'popup__status status--no-video';
        disableButtons(true);
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, (response) => {
        if (!response) {
          setStatusUI('error', false);
          disableButtons(true);
          return;
        }
        setStatusUI(response.paused ? 'paused' : 'live', response.hasVideo);
        disableButtons(!response.hasVideo);
        toggleEl.checked = response.autoReconnect;
      });
    });
  }

  // Auto-refresh status terwijl popup open is
  refreshStatus();
  const refreshInterval = setInterval(refreshStatus, 2000);
  window.addEventListener('unload', () => clearInterval(refreshInterval));

  // ─── Knop-clicks ─────────────────────────────────────────────────────────
  document.querySelectorAll('.popup__btn[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action  = btn.dataset.action;
      const seconds = btn.dataset.seconds ? parseInt(btn.dataset.seconds, 10) : undefined;
      sendToContent(seconds !== undefined ? { action, seconds } : { action });
    });
  });

  // ─── Toggle auto-reconnect ────────────────────────────────────────────────
  toggleEl.addEventListener('change', () => {
    const value = toggleEl.checked;
    sendToContent({ action: 'setAutoReconnect', value });
    chrome.storage.sync.set({ autoReconnect: value });
  });

  // ─── Instellingen laden ───────────────────────────────────────────────────
  chrome.storage.sync.get({ autoReconnect: true }, (result) => {
    toggleEl.checked = result.autoReconnect;
  });

})();
