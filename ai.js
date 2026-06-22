/* ludus/ai.js — Ludus bot. Global: window.LudusAI
 * difficulties: 'easy' (random), 'medium' (greedy 1-ply), 'hard' (negamax + alpha-beta).
 * chooseAction(state, color, difficulty, persona) -> action | null
 *
 * `persona` (an opponent id) gives each foe a play-style by tweaking eval weights
 * and randomness, so bots feel like their Codex Alera characters.
 */
(function () {
  'use strict';
  var E = window.Ludus;

  // Per-character style. weights override engine DEFAULT_W; jitter = how much the bot
  // plays on "instinct" (randomness); furyBias = eagerness to use furycraft strikes.
  //   sky      — desire to seize the skies
  //   advance  — aggression / pushing forward (high = comes at you; low = sits back)
  //   support  — discipline: keeping pieces mutually defended
  //   danger   — keenness to hunt the enemy First Lord
  //   ownDanger— care for its own First Lord (low = reckless, hangs its king)
  var PERSONA = {
    // Brash, fearless, plays on instinct not patience — charges, careless with his king.
    max:    { sky: 0.4, advance: 0.05,  support: 0.02, danger: 50, ownDanger: 18, jitter: 0.25, furyBias: 0.02 },
    // A Cursor's careful, clever calculation — defensive, guards its king, low randomness.
    ehren:  { sky: 0.6, advance: 0.008, support: 0.09, danger: 35, ownDanger: 70, jitter: 0.03, furyBias: 0.06 },
    // Marat-sharp and endlessly adaptable — balanced, opportunistic.
    kitai:  { sky: 0.7, advance: 0.02,  support: 0.05, danger: 45, ownDanger: 45, jitter: 0.10, furyBias: 0.05 },
    // The finest Ludus mind — deep, well-rounded, values the skies, almost no randomness.
    tavi:   { sky: 0.9, advance: 0.02,  support: 0.06, danger: 60, ownDanger: 60, jitter: 0.01, furyBias: 0.06 },
    // Canim battlemaster who never wastes a move — efficient, material-disciplined.
    nasaug: { sky: 0.5, advance: 0.02,  support: 0.07, danger: 45, ownDanger: 50, jitter: 0.04, furyBias: 0.05 },
    // Patient, disciplined, relentless once committed — holds, controls the air, then strikes.
    varg:   { sky: 0.9, advance: 0.012, support: 0.09, danger: 55, ownDanger: 60, jitter: 0.02, furyBias: 0.05 },
    // Cold, inhuman calculation that studies you — deepest, aggressive everywhere, no nerves.
    queen:  { sky: 1.0, advance: 0.025, support: 0.06, danger: 70, ownDanger: 55, jitter: 0.005, furyBias: 0.07 },
    // Gaius Sextus — the old First Lord. Wins by sacrifice and misdirection; hunts
    // your king relentlessly and will spend material to do it.
    gaius:  { sky: 0.8,  advance: 0.022, support: 0.05, danger: 75, ownDanger: 40, jitter: 0.01, furyBias: 0.07 },
    // Aquitainus Attis — bold, brilliant field commander. Seizes the skies, presses hard.
    attis:  { sky: 0.95, advance: 0.035, support: 0.05, danger: 60, ownDanger: 45, jitter: 0.02, furyBias: 0.06 },
    // Invidia Aquitaine — cold schemer. Patient, defensive, traps overreach; nerveless.
    invidia:{ sky: 0.7,  advance: 0.008, support: 0.08, danger: 50, ownDanger: 70, jitter: 0.005, furyBias: 0.06 },
    // Bernard — a steadholder's patience: disciplined, support-heavy, slow to advance.
    bernard:{ sky: 0.45, advance: 0.008, support: 0.11, danger: 40, ownDanger: 60, jitter: 0.03, furyBias: 0.05 },
    // Araris Valerian — the peerless blade. Flawless defense; guards his lord above all.
    araris: { sky: 0.6,  advance: 0.012, support: 0.10, danger: 45, ownDanger: 70, jitter: 0.02, furyBias: 0.06 },
    // Amara — a Cursor on the wing: swift, daring, ever probing, takes risks.
    amara:  { sky: 0.75, advance: 0.04,  support: 0.04, danger: 50, ownDanger: 35, jitter: 0.10, furyBias: 0.05 },
    // Phrygiar Navaris — a relentless killer. Hunts pieces and the king, careless of her own.
    navaris:{ sky: 0.5,  advance: 0.045, support: 0.03, danger: 70, ownDanger: 20, jitter: 0.06, furyBias: 0.06 },
    // Doroga — a Marat headman's straightforward might: charges, heedless of his own king.
    doroga: { sky: 0.3,  advance: 0.05,  support: 0.03, danger: 55, ownDanger: 25, jitter: 0.12, furyBias: 0.03 }
  };
  var DEFAULT = { sky: 0.6, advance: 0.015, support: 0.05, danger: 40, ownDanger: 40, jitter: 0.01, furyBias: 0.03 };

  function styleFor(persona) {
    var p = (persona && PERSONA[persona]) || DEFAULT, w = {};
    for (var k in DEFAULT) w[k] = (p[k] !== undefined) ? p[k] : DEFAULT[k];
    return w;
  }

  function randomChoice(arr) { return arr[(Math.random() * arr.length) | 0]; }

  // furycraft strikes capture without exposing the piece — nudge bots to notice them.
  function styleScore(action, w) {
    return (action.type === 'attack' ? w.furyBias : 0) + Math.random() * w.jitter;
  }

  function greedy(state, color, w) {
    var acts = E.legalActions(state, color), best = null, bestScore = -Infinity;
    for (var i = 0; i < acts.length; i++) {
      var s = E.evaluate(E.applyAction(state, acts[i]), color, w) + styleScore(acts[i], w);
      if (s > bestScore) { bestScore = s; best = acts[i]; }
    }
    return best;
  }

  // min/max recursion with alpha-beta, eval anchored to `color`. depth in plies.
  function search(state, color, depth, alpha, beta, w) {
    if (state.winner || depth === 0) return E.evaluate(state, color, w);
    var acts = E.legalActions(state, state.turn);
    if (!acts.length) return E.evaluate(state, color, w);
    acts.sort(function (a, b) { return b.targets.length - a.targets.length; });
    var maximizing = (state.turn === color);
    var best = maximizing ? -Infinity : Infinity;
    for (var i = 0; i < acts.length; i++) {
      var v = search(E.applyAction(state, acts[i]), color, depth - 1, alpha, beta, w);
      if (maximizing) { if (v > best) best = v; if (best > alpha) alpha = best; }
      else { if (v < best) best = v; if (best < beta) beta = best; }
      if (alpha >= beta) break;
    }
    return best;
  }

  function hard(state, color, depth, w) {
    depth = depth || 3;
    var acts = E.legalActions(state, color);
    if (!acts.length) return null;
    acts.sort(function (a, b) { return b.targets.length - a.targets.length; });
    var best = null, bestScore = -Infinity, alpha = -Infinity, beta = Infinity;
    for (var i = 0; i < acts.length; i++) {
      var v = search(E.applyAction(state, acts[i]), color, depth - 1, alpha, beta, w) + styleScore(acts[i], w);
      if (v > bestScore) { bestScore = v; best = acts[i]; }
      if (bestScore > alpha) alpha = bestScore;
    }
    return best;
  }

  function chooseAction(state, color, difficulty, persona) {
    var acts = E.legalActions(state, color);
    if (!acts.length) return null;
    var w = styleFor(persona);
    if (difficulty === 'easy') {
      // even "instinct" players notice a free capture sometimes — but mostly wing it.
      return Math.random() < 0.35 ? greedy(state, color, w) : randomChoice(acts);
    }
    if (difficulty === 'medium') return greedy(state, color, w);
    return hard(state, color, 3, w); // 'hard'
  }

  window.LudusAI = { chooseAction: chooseAction, PERSONA: PERSONA };
})();
