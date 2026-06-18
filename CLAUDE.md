# Working on Ludus

## Branch workflow — main only

This project works **only on `main`**. There are no feature/development
branches: do all work on `main`, commit there, and push updates **straight to
`main`**. Do not create side branches or open PRs unless explicitly asked.

## Tests

Run the suites before pushing (no build step — plain Node):

```sh
node test_net.mjs    # online rooms / lobby / presence (mock Firebase)
node test_ludus.mjs  # game engine + AI
```

## Layout

- `engine.js` — pure game rules/state (`window.Ludus`).
- `ai.js` — bot move selection (`window.LudusAI`).
- `net.js` — Firebase Realtime DB rooms, lobby index, presence (`window.LudusNet`).
- `render.js` — canvas board + input (`window.LudusUI`).
- `main.js` — screen flow + game controller wiring it all together.
- `index.html` — single-page shell; `firebase-config.js` holds the DB config.

Online rooms self-clean via Firebase `onDisconnect`: an abandoned lobby room
(host closed the tab) removes itself and its `lobby/` ad; a mid-game drop only
vacates that player's seat so a live match isn't destroyed. As a backstop,
`NET.sweepStale()` runs on every page load and prunes any room whose host is no
longer in `presence/` (cross-referencing the lobby ads against live presence),
so a room that escaped `onDisconnect` still gets cleaned up the next time anyone
opens the site.
