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

- `engine.js` — pure game rules/state (`window.Ludus`). 24 pieces/side incl. the
  Cursor (CU, glides ≤4) and Steadholder (SH, steps 1, doubles adjacent support).
  `evaluate(state,color,weights)` takes personality weights; `clone` is a fast
  structural clone (the AI's hot path); `firstLordAttacked` powers king-safety.
- `ai.js` — bot move selection (`window.LudusAI`). easy/medium/hard, plus a
  per-opponent `PERSONA` table (sky/advance/support/danger/ownDanger/jitter/
  furyBias) so each foe plays to character. King-safety is applied at the
  decision **root** (not deep leaves) to stay fast; `chooseAction(state,color,
  difficulty,personaId)`.
- `net.js` — Firebase Realtime DB rooms, lobby index, presence, plus the Hall of
  Records: `results/` (leaderboard: who beat whom + durationMs) and `messages/`
  (public board), and a localStorage player handle (`window.LudusNet`).
- `render.js` — canvas board + input (`window.LudusUI`). Portrait layout: the
  ground board fills the top, the sky board sits below it on the left, and the
  captured-piece tray fills the space to the sky board's right. A move-capture vs
  furycraft-strike chooser popup; a show-legal-moves toggle (`setShowMoves`).
- `main.js` — screen flow + game controller. Collapsible faction groups on the
  title; in-game elapsed clock; Hall overlay; one-time name prompt at first game.
- `index.html` — single-page shell; `firebase-config.js` holds the DB config.
  `__CACHE_BUST__` in HTML is replaced with the commit SHA by the Pages workflow.

The shared rules JSON (incl. `results`/`messages` nodes) lives in `LUDUS.md`;
publish it in the Firebase console or the Hall reads/writes are denied.

Online rooms self-clean via Firebase `onDisconnect`: an abandoned lobby room
(host closed the tab) removes itself and its `lobby/` ad; a mid-game drop only
vacates that player's seat so a live match isn't destroyed. As a backstop,
`NET.sweepStale()` runs on every page load and prunes any room whose host is no
longer in `presence/` (cross-referencing the lobby ads against live presence),
so a room that escaped `onDisconnect` still gets cleaned up the next time anyone
opens the site.

Backing out of a live online game (device back button) doesn't forfeit
immediately: the leaver gets a 60s Resume banner, and the opponent sees a synced
forfeit countdown via `rooms/{id}/away = {color, until}`. Resuming clears it;
letting it lapse hands the win to whoever's still at the board.
