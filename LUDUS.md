# LUDUS — Awakened Calamity's take on the Aleran war-game

A playable, balanced reconstruction of **Ludus**, the chess-like strategy game from
Jim Butcher's *Codex Alera*. Standalone browser game: local play vs an AI (3 difficulties)
or online 2-player via Firebase. Self-contained under `ludus/` (`ludus/index.html` +
`ludus/*.js`) — a standalone mini-site with its own URL, independent of the main AC engine.

## What's canon vs. what we designed
The novels (esp. the *Cursor's Fury* prologue) describe Ludus only in narrative:
- An **11×11** black-and-white board of painted lead figurines.
- A **5×5 second board** on a rod **over the center** of the lower board — "the skies."
- Named pieces: **Legionares, Lords, High Lords, First Lord** (capture ends the game).
- Themes: discipline over ferocity; pieces **support each other in adjacent rows**;
  mid-game sacrifices → an endgame hunt for the First Lord.

**No piece movement, capture rules, or furycraft mechanics are canonical** — they are all
fan-invented. The name nods to the Roman **Ludus latrunculorum** (custodian/flanking capture).
This ruleset is our own balanced redesign, seeded by u/bmyst70's fan draft, fixing its
broken skyboard mapping and underspecified rules.

## The two boards (the fix)
- **Ground**: 11×11. Coordinates `(r,c)`, `r,c ∈ 0..10`. Row 0 = Black's back rank (top),
  row 10 = White's back rank (bottom).
- **Sky**: 5×5. Sky `(r,c)` sits **directly above ground `(r+3, c+3)`** — i.e. the central
  5×5 of the ground board (ground rows/cols 3..7). This is the canon "board over the center."
  A piece on sky `(r,c)` "shadows" ground `(r+3,c+3)` 1:1 — no ambiguous 4→1 tiling.
- Only **aerial** pieces (Knight Aeris, High Lord, First Lord) may occupy the sky.

## Pieces (26 per side)
| Type | Tag | Count | Aerial | Value |
|------|-----|------:|:------:|------:|
| Legionare | L | 11 | no | 1 |
| Veteran Legionare | VL | (promoted) | no | 2 |
| Knight Flora | KF | 2 | no | 3 |
| Knight Terra | KT | 2 | no | 3 |
| Knight Ignus | KI | 2 | no | 3 |
| Knight Ferrous | KR | 2 | no | 4 |
| Knight Aeris | KA | 2 | yes | 4 |
| High Lord | HL | 2 | yes | 6 |
| Cursor | CU | 2 | no | 3 |
| Steadholder | SH | 2 | no | 2 |
| First Lord | FL | 1 | yes | ∞ (king) |

**Cursor (CU)** glides up to 4 squares any direction (captures by landing); a swift
scout/courier (Books 3-4). **Steadholder (SH)** steps 1 any direction and **shelters**: any
friendly piece orthogonally adjacent to it is immune to enemy furycraft strikes (and a warded
piece also stops the strike's line, shielding what's behind it — see `furyWarded`). Per
Gaius's line, a Cursor + Steadholder together rival a First Lord: the Cursor has no furycraft
of its own and is fragile, but sheltered beside a Steadholder it becomes fury-proof while
keeping its 4-square reach, so the pair is a resilient, far-striking unit. They share a third
rank — flanked by the two **Knights Ferrous (KR)** — just behind the legionares (26 pieces/side).
(The AI also still gets a small `support` eval bonus for clustering, doubled next to a Steadholder.)

### Starting layout (both sides mirror)
- Back rank: `KA KT KI KF HL FL HL KF KI KT KA` (11 across).
- Rank in front: 11 Legionares.
- White: rows 10 (back) & 9 (legionares). Black: rows 0 (back) & 1 (legionares).

## Turn structure
One **action** per turn: a piece either **moves** (and captures by landing on an enemy —
"touch removes") **or** performs a **furycraft ranged attack** (removes a target without
moving), depending on the piece. Flying to/from the sky is a move.

Capture is **move-onto** (chess style), not latrunculorum flanking — chosen for clarity and
a tractable AI. The First Lord is a **king**: when it is captured the game ends immediately.
(v1 is *king-capture* — there is no "check" legality enforcement; do not leave your First
Lord hanging. This keeps move generation simple and the AI fast.)

## Movement & attacks
- **Legionare (L)** — moves 1 square **forward / left / right** (not back, not diagonal);
  may move **2 forward on its first move**. Captures **forward-diagonally only**. On reaching
  the far back rank it promotes to **Veteran**.
- **Veteran Legionare (VL)** — moves/captures 1 square in **any** of the 8 directions.
- **Knight Flora (KF)** — slides up to **2 squares diagonally** (blocked by pieces); captures
  by landing. *Woodcraft:* may instead **attack** an enemy up to 2 diagonal squares away
  (line-of-sight) without moving.
- **Knight Terra (KT)** — moves like a **chess knight** (2+1 L-shape, may jump). *Terracraft:*
  may instead **attack** an orthogonally-adjacent enemy; if a second enemy sits directly
  behind the first (same line), it is **also** removed (the earth ripples through).
- **Knight Ignus (KI)** — moves up to **2 squares orthogonally** (blocked by pieces). *Firecraft:*
  may instead **attack** an enemy up to 2 squares away orthogonally (line-of-sight).
- **Knight Ferrous (KR)** — the armored metalcrafter: slides up to **2 squares in any
  direction** (blocked by pieces), capturing by landing. *Metalcraft ward:* it **cannot be
  targeted by any furycraft ranged strike** (Flora/Terra/Ignus/High Lord attacks pass it by,
  and it blocks the strike's line); it can only be removed by a move-capture.
- **Knight Aeris (KA)** — moves **2 squares any direction** on the ground; may **fly** to the
  sky (when standing under the central 5×5) or land from sky, as its action; on the sky moves
  **1 square any direction**. A sky piece may attack/land on the ground square it shadows.
- **High Lord (HL)** — moves **2 any direction** on ground; may **fly**; sky move 1 any
  direction; lands by capture onto its shadowed ground square. *Furycraft (all crafts except
  Flora's):* may instead make an **orthogonal ranged strike to range 2 that pierces** the enemy
  directly behind the first target — combining Ignus's reach with Terra's pierce.
- **First Lord (FL)** — like HL, moves 2 any direction / flies / sky move 1. **If captured,
  the game ends.**

## Deferred (future passes)
- **Shieldwall** (multi-Legionare single-move), full furycraft variety per Knight, latrunculorum
  flanking capture as an alt mode, "check" legality. v1 omits these for balance + a tractable AI.

## Code map
- `ludus/engine.js` — pure rules: state, legal-action generation, apply, win check. No DOM.
- `ludus/ai.js` — bot: `easy` (random), `medium` (greedy 1-ply), `hard` (negamax + alpha-beta).
- `ludus/render.js` — canvas board (ground + sky overlay), input/selection, highlights.
- `ludus/net.js` — Firebase Realtime DB rooms for online 2-player (config in `ludus/firebase-config.js`).
- `ludus/main.js` — menu, mode wiring (local-bot / hotseat / online), glue.
- `ludus/index.html` — standalone entry page (served at `…/ludus/`).

## Online (Firebase Realtime DB)
The DB has three top-level nodes:
- `rooms/{id}` — `{ state, players:{white,black}, public, created, updated }`. The full
  game state. The rules allow reading **one room at a time** (by id) so joiners and
  spectators can subscribe, but not bulk-listing every game. Empty rooms self-delete on leave.
- `lobby/{id}` — `{ open, full, host, updated, broadcast?, label? }`. A lightweight,
  publicly-listable index of `public` rooms (no game state) that powers the **Open Games**
  lobby: Join an open seat, or **Watch** a full game as a spectator. Kept in sync by
  create/join/leave. A `broadcast` entry is a local game (vs the bot, or pass-and-play)
  the player opted to share via "Let others watch": it's advertised full (spectate-only,
  not joinable — `players.black` is a literal `'bot'`) with an optional `label`, and the
  host pushes state on every move (`createBroadcast`). Host disconnect tears it down.
- `presence/{clientId}` — `{name, at}` written while a client is connected (via
  `.info/connected` + `onDisconnect().remove()`); the header **online count** is this
  node's child count, and clicking it expands a roster of the connected players' names.

Why the split: spectating and joining need a single room readable, but the lobby needs a
*list*. Exposing all of `rooms` would leak every game's full state, so the listable part
is the metadata-only `lobby` index instead.

Recommended rules (public reads, writes only by the two seated players + own presence):
```json
{
  "rules": {
    "rooms": {
      "$id": {
        ".read": true,
        ".write": "!data.exists() || !data.child('players/white').exists() || !data.child('players/black').exists() || data.child('players/white').val() == auth.uid || data.child('players/black').val() == auth.uid || newData.child('players/white').val() == auth.uid || newData.child('players/black').val() == auth.uid"
      }
    },
    "lobby":    { ".read": true, "$id": { ".write": true } },
    "presence": { ".read": true, "$cid": { ".write": true } },
    "results":  { ".read": true, "$id": { ".write": true } },
    "messages": { ".read": true, "$id": { ".write": true } }
  }
}
```
Test mode (open read/write) works for prototyping; tighten before any public deploy.
Seats and presence are keyed on a **Firebase Anonymous Auth** `uid` (see `net.js` `init`),
so the rules above are enforceable. To use them you must, in the Firebase console:
1. **Authentication → Sign-in method → enable Anonymous.**
2. **Realtime Database → Rules → publish the JSON above.**
Do this *after* the auth-enabled `net.js` is deployed (publishing strict rules first would
deny writes from unauthenticated clients). If auth isn't enabled, `net.js` falls back to a
`localStorage` client id and play still works — but the strict rules won't pass, so keep
test-mode rules until Anonymous sign-in is on.
