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

## Pieces (22 per side)
| Type | Tag | Count | Aerial | Value |
|------|-----|------:|:------:|------:|
| Legionnaire | L | 11 | no | 1 |
| Veteran Legionnaire | VL | (promoted) | no | 2 |
| Knight Flora | KF | 2 | no | 3 |
| Knight Terra | KT | 2 | no | 3 |
| Knight Ignis | KI | 2 | no | 3 |
| Knight Aeris | KA | 2 | yes | 4 |
| High Lord | HL | 2 | yes | 6 |
| First Lord | FL | 1 | yes | ∞ (king) |

### Starting layout (both sides mirror)
- Back rank: `KA KT KI KF HL FL HL KF KI KT KA` (11 across).
- Rank in front: 11 Legionnaires.
- White: rows 10 (back) & 9 (legionnaires). Black: rows 0 (back) & 1 (legionnaires).

## Turn structure
One **action** per turn: a piece either **moves** (and captures by landing on an enemy —
"touch removes") **or** performs a **furycraft ranged attack** (removes a target without
moving), depending on the piece. Flying to/from the sky is a move.

Capture is **move-onto** (chess style), not latrunculorum flanking — chosen for clarity and
a tractable AI. The First Lord is a **king**: when it is captured the game ends immediately.
(v1 is *king-capture* — there is no "check" legality enforcement; do not leave your First
Lord hanging. This keeps move generation simple and the AI fast.)

## Movement & attacks
- **Legionnaire (L)** — moves 1 square **forward / left / right** (not back, not diagonal);
  may move **2 forward on its first move**. Captures **forward-diagonally only**. On reaching
  the far back rank it promotes to **Veteran**.
- **Veteran Legionnaire (VL)** — moves/captures 1 square in **any** of the 8 directions.
- **Knight Flora (KF)** — slides up to **2 squares diagonally** (blocked by pieces); captures
  by landing. *Woodcraft:* may instead **attack** an enemy up to 2 diagonal squares away
  (line-of-sight) without moving.
- **Knight Terra (KT)** — moves like a **chess knight** (2+1 L-shape, may jump). *Terracraft:*
  may instead **attack** an orthogonally-adjacent enemy; if a second enemy sits directly
  behind the first (same line), it is **also** removed (the earth ripples through).
- **Knight Ignis (KI)** — moves up to **2 squares orthogonally** (blocked by pieces). *Firecraft:*
  may instead **attack** an enemy up to 2 squares away orthogonally (line-of-sight).
- **Knight Aeris (KA)** — moves **2 squares any direction** on the ground; may **fly** to the
  sky (when standing under the central 5×5) or land from sky, as its action; on the sky moves
  **1 square any direction**. A sky piece may attack/land on the ground square it shadows.
- **High Lord (HL)** — moves **2 any direction** on ground; may **fly**; sky move 1 any
  direction; lands by capture onto its shadowed ground square. *Furycraft (all crafts except
  Flora's):* may instead make an **orthogonal ranged strike to range 2 that pierces** the enemy
  directly behind the first target — combining Ignis's reach with Terra's pierce.
- **First Lord (FL)** — like HL, moves 2 any direction / flies / sky move 1. **If captured,
  the game ends.**

## Deferred (future passes)
- **Shieldwall** (multi-Legionnaire single-move), full furycraft variety per Knight, latrunculorum
  flanking capture as an alt mode, "check" legality. v1 omits these for balance + a tractable AI.

## Code map
- `ludus/engine.js` — pure rules: state, legal-action generation, apply, win check. No DOM.
- `ludus/ai.js` — bot: `easy` (random), `medium` (greedy 1-ply), `hard` (negamax + alpha-beta).
- `ludus/render.js` — canvas board (ground + sky overlay), input/selection, highlights.
- `ludus/net.js` — Firebase Realtime DB rooms for online 2-player (config in `ludus/firebase-config.js`).
- `ludus/main.js` — menu, mode wiring (local-bot / hotseat / online), glue.
- `ludus/index.html` — standalone entry page (served at `…/ludus/`).
