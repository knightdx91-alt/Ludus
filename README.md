# Ludus

A playable, balanced reconstruction of **Ludus**, the chess-like strategy game from
Jim Butcher's *Codex Alera*. Standalone browser game: local play vs an AI (3 difficulties)
or online 2-player via Firebase.

This is the standalone mini-site extracted from the Awakened Calamity prototype, where it
lives under `ludus/`. The full ruleset and design notes are in [`LUDUS.md`](LUDUS.md).

## Play
Served from the repo root — open `index.html` over HTTP (not `file://`, so `fetch()` works):

```
python3 -m http.server 8000
# then visit http://localhost:8000/
```

## Deploy
GitHub Pages via Actions (`.github/workflows/pages.yml`). On push to `main` it replaces
`__CACHE_BUST__` in `*.html` with the commit SHA, then deploys the repo root.
Enable Pages with **Settings → Pages → Source: GitHub Actions**.

## Code map
- `engine.js` — pure rules: state, legal-action generation, apply, win check (no DOM).
- `ai.js` — bot: `easy` (random), `medium` (greedy 1-ply), `hard` (negamax + alpha-beta).
- `render.js` — canvas board (ground + sky overlay), input/selection, highlights.
- `net.js` — Firebase Realtime DB rooms for online 2-player (config in `firebase-config.js`).
- `main.js` — menu, mode wiring (local-bot / hotseat / online), glue.
- `index.html` — standalone entry page.
