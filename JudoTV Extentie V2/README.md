# JudoTV Enhanced — v2.0

Chrome-extensie voor een betere kijkervaring op [judotv.com](https://judotv.com).

## Functies

| Functie | Details |
|---|---|
| **Ad-removal** | Verwijdert bekende advertentie-overlays via meerdere selectors, throttled via `requestAnimationFrame` |
| **Spelercontroles** | ⏪ 5s / 10s / 30s terugspoelen, ⏩ naar LIVE, ⛶ volledig scherm |
| **Hover-controls** | Knoppen verschijnen onderaan de video bij muisbeweging — ook in fullscreen — en verdwijnen na 3s |
| **Auto-reconnect** | Detecteert stream-stalling/errors en herverbindt automatisch (max 4 pogingen) |
| **Toast-meldingen** | Visuele feedback bij acties en stream-status |
| **Popup** | Statusweergave + alle controls + toggle voor auto-reconnect |
| **SPA-navigatie** | Werkt correct na navigatie zonder pagina-herlaad |

## Installeren (Developer Mode)

1. Download / unzip deze map
2. Ga naar `chrome://extensions`
3. Zet **Developer mode** aan (rechtsboven)
4. Klik **Load unpacked**
5. Selecteer de map `judotv-ext-v2`

## Bestandsoverzicht

```
judotv-ext-v2/
├── manifest.json   — Extensie-configuratie (MV3)
├── content.js      — Hoofdlogica: ad-removal, controls, reconnect
├── content.css     — Stijlen voor controls bar en toasts
├── popup.html      — Popup interface
├── popup.js        — Popup logica
├── popup.css       — Popup stijlen
└── icon.png        — Extensie-icoon
```

## Technische notities

- **Fullscreen**: de video-wrapper wordt fullscreen gezet (niet enkel het `<video>` element), zodat de geïnjecteerde knoppen mee in fullscreen gaan
- **Ad-selectors**: uitbreidbaar via de `AD_SELECTORS` array bovenaan `content.js`
- **Auto-reconnect**: in te stellen via popup-toggle, wordt opgeslagen via `chrome.storage.sync`
