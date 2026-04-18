(() => {
  'use strict';

  const statusEl  = document.getElementById('stream-status');
  const toggleEl  = document.getElementById('auto-reconnect-toggle');

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function sendToContent(msg) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length) return;
      chrome.tabs.sendMessage(tabs[0].id, msg).catch(() => {});
    });
  }

  function setStatusUI(state, hasVideo) {
    const map = {
      live:         { text: '● LIVE',       cls: ''                   },
      stalled:      { text: '⏸ Buffering',  cls: 'status--stalled'    },
      reconnecting: { text: '🔄 Herstellen', cls: 'status--reconnecting'},
      error:        { text: '✕ Fout',        cls: 'status--error'      },
      paused:       { text: '⏸ Gepauzeerd', cls: 'status--paused'     },
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

  // ─── Status ophalen bij openen popup ─────────────────────────────────────
  function refreshStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length) {
        setStatusUI('error', false);
        disableButtons(true);
        return;
      }
      // Controleer of we op judotv.com zitten
      const url = tabs[0].url || '';
      if (!url.includes('judotv.com')) {
        statusEl.textContent = 'Geen JudoTV tab';
        statusEl.className   = 'popup__status status--no-video';
        disableButtons(true);
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, (response) => {
        if (chrome.runtime.lastError || !response) {
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
    sendToContent({ action: 'setAutoReconnect', value: toggleEl.checked });
    chrome.storage.sync.set({ autoReconnect: toggleEl.checked });
  });

  // ─── Instellingen laden ───────────────────────────────────────────────────
  chrome.storage.sync.get({ autoReconnect: true }, (result) => {
    toggleEl.checked = result.autoReconnect;
  });

  // ─── Init ─────────────────────────────────────────────────────────────────
  refreshStatus();

})();
