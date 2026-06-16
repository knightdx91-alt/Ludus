/* ludus/ai.js — Ludus bot. Global: window.LudusAI
 * difficulties: 'easy' (random), 'medium' (greedy 1-ply), 'hard' (negamax + alpha-beta).
 * chooseAction(state, color, difficulty) -> action | null
 */
(function () {
  'use strict';
  var E = window.Ludus;

  function randomChoice(arr) { return arr[(Math.random() * arr.length) | 0]; }

  function greedy(state, color) {
    var acts = E.legalActions(state, color), best = null, bestScore = -Infinity;
    for (var i = 0; i < acts.length; i++) {
      var s = E.evaluate(E.applyAction(state, acts[i]), color);
      // jitter to avoid deterministic ties / repetition
      s += Math.random() * 0.01;
      if (s > bestScore) { bestScore = s; best = acts[i]; }
    }
    return best;
  }

  // min/max recursion with alpha-beta, eval anchored to `color`. depth in plies.
  function search(state, color, depth, alpha, beta) {
    if (state.winner || depth === 0) return E.evaluate(state, color);
    var acts = E.legalActions(state, state.turn);
    if (!acts.length) return E.evaluate(state, color);
    acts.sort(function (a, b) { return b.targets.length - a.targets.length; });
    var maximizing = (state.turn === color);
    var best = maximizing ? -Infinity : Infinity;
    for (var i = 0; i < acts.length; i++) {
      var v = search(E.applyAction(state, acts[i]), color, depth - 1, alpha, beta);
      if (maximizing) { if (v > best) best = v; if (best > alpha) alpha = best; }
      else { if (v < best) best = v; if (best < beta) beta = best; }
      if (alpha >= beta) break;
    }
    return best;
  }

  function hard(state, color, depth) {
    depth = depth || 3;
    var acts = E.legalActions(state, color);
    if (!acts.length) return null;
    acts.sort(function (a, b) { return b.targets.length - a.targets.length; });
    var best = null, bestScore = -Infinity, alpha = -Infinity, beta = Infinity;
    for (var i = 0; i < acts.length; i++) {
      var v = search(E.applyAction(state, acts[i]), color, depth - 1, alpha, beta);
      v += Math.random() * 0.01;
      if (v > bestScore) { bestScore = v; best = acts[i]; }
      if (bestScore > alpha) alpha = bestScore;
    }
    return best;
  }

  function chooseAction(state, color, difficulty) {
    var acts = E.legalActions(state, color);
    if (!acts.length) return null;
    if (difficulty === 'easy') return randomChoice(acts);
    if (difficulty === 'medium') return greedy(state, color);
    return hard(state, color, 3); // 'hard'
  }

  window.LudusAI = { chooseAction: chooseAction };
})();
