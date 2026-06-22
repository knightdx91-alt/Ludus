/* ludus/engine.js — pure Ludus rules. No DOM. Global: window.Ludus
 *
 * State is a plain JSON-serializable object (so it can sync over Firebase and
 * be cloned for AI search):
 *   { pieces:[ {id,type,color,board,r,c,moved} ], turn:'white'|'black',
 *     winner:null|'white'|'black', moveCount:int }
 * Action: { pieceId, type:'move'|'fly'|'attack', to:{board,r,c}, targets:[id...] }
 *
 * Boards: ground 11x11 (r,c in 0..10). sky 5x5 (r,c in 0..4) shadows ground
 * (r+3,c+3) 1:1 — the central 5x5 (ground rows/cols 3..7).
 */
(function () {
  'use strict';

  var GROUND = 11, SKY = 5, SKY_OFF = 3;
  // piece values for AI eval; FL is effectively infinite (king).
  // CU = Cursor (fast courier/scout), SH = Steadholder (defensive anchor). Per the
  // Books 3-4 line, a Cursor + Steadholder together rival a First Lord's worth.
  var VALUE = { L: 1, VL: 2, KF: 3, KT: 3, KI: 3, KA: 4, HL: 6, CU: 3, SH: 2, FL: 1000 };
  var AERIAL = { KA: 1, HL: 1, FL: 1 };

  function inGround(r, c) { return r >= 0 && r < GROUND && c >= 0 && c < GROUND; }
  function inSky(r, c) { return r >= 0 && r < SKY && c >= 0 && c < SKY; }
  function underSky(r, c) { return r >= SKY_OFF && r < SKY_OFF + SKY && c >= SKY_OFF && c < SKY_OFF + SKY; }
  function groundToSky(r, c) { return { r: r - SKY_OFF, c: c - SKY_OFF }; }
  function skyToGround(r, c) { return { r: r + SKY_OFF, c: c + SKY_OFF }; }

  // white's "forward" is up (decreasing r); black's is down (increasing r).
  function forward(color) { return color === 'white' ? -1 : 1; }
  function backRank(color) { return color === 'white' ? 0 : GROUND - 1; } // promotion rank

  // Fast structural clone — far cheaper than JSON round-tripping, and this runs on
  // every node of the AI search. Knows the exact (flat) shape of a Ludus state.
  function clone(state) {
    var ps = state.pieces, n = ps.length, arr = new Array(n);
    for (var i = 0; i < n; i++) {
      var p = ps[i];
      arr[i] = { id: p.id, type: p.type, color: p.color, board: p.board, r: p.r, c: p.c, moved: p.moved };
    }
    var ns = { pieces: arr, turn: state.turn, winner: state.winner, moveCount: state.moveCount };
    var cap = state.captured;
    if (cap) ns.captured = { white: cloneCaps(cap.white), black: cloneCaps(cap.black) };
    return ns;
  }
  function cloneCaps(list) {
    if (!list || !list.length) return [];
    var out = new Array(list.length);
    for (var i = 0; i < list.length; i++) { var c = list[i]; out[i] = { type: c.type, color: c.color, by: c.by }; }
    return out;
  }

  function pieceAt(state, board, r, c) {
    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];
      if (p.board === board && p.r === r && p.c === c) return p;
    }
    return null;
  }
  function pieceById(state, id) {
    for (var i = 0; i < state.pieces.length; i++) if (state.pieces[i].id === id) return state.pieces[i];
    return null;
  }

  function initialState() {
    var pieces = [], id = 0;
    var back = ['KA', 'KT', 'KI', 'KF', 'HL', 'FL', 'HL', 'KF', 'KI', 'KT', 'KA'];
    function add(type, color, r, c) { pieces.push({ id: 'p' + (id++), type: type, color: color, board: 'ground', r: r, c: c, moved: false }); }
    // Black at top (rows 0,1), White at bottom (rows 10,9).
    for (var c = 0; c < GROUND; c++) {
      add(back[c], 'black', 0, c);
      add('L', 'black', 1, c);
      add('L', 'white', GROUND - 2, c);
      add(back[c], 'white', GROUND - 1, c);
    }
    // Cursor + Steadholder flank the First Lord's file, a rank behind the legionnaires.
    add('CU', 'black', 2, 4); add('SH', 'black', 2, 6);
    add('CU', 'white', GROUND - 3, 4); add('SH', 'white', GROUND - 3, 6);
    // captured[color] = pieces that `color` has taken (for the captured tray).
    return { pieces: pieces, turn: 'white', winner: null, moveCount: 0, captured: { white: [], black: [] } };
  }

  // ---- per-piece action generation -------------------------------------
  // Each pusher returns nothing; appends actions to `out`.

  function slide(state, p, dirs, maxSteps, out, opts) {
    // ground sliding move/capture. opts.diagCaptureOnly etc not used here.
    for (var d = 0; d < dirs.length; d++) {
      var dr = dirs[d][0], dc = dirs[d][1];
      for (var s = 1; s <= maxSteps; s++) {
        var r = p.r + dr * s, c = p.c + dc * s;
        if (!inGround(r, c)) break;
        var occ = pieceAt(state, 'ground', r, c);
        if (occ) {
          if (occ.color !== p.color) out.push({ pieceId: p.id, type: 'move', to: { board: 'ground', r: r, c: c }, targets: [occ.id] });
          break; // blocked either way
        }
        out.push({ pieceId: p.id, type: 'move', to: { board: 'ground', r: r, c: c }, targets: [] });
      }
    }
  }

  function rangedAttack(state, p, dirs, maxRange, out, pierce) {
    // furycraft: hit first enemy along each dir within range (LOS blocked by anyone).
    for (var d = 0; d < dirs.length; d++) {
      var dr = dirs[d][0], dc = dirs[d][1];
      for (var s = 1; s <= maxRange; s++) {
        var r = p.r + dr * s, c = p.c + dc * s;
        if (!inGround(r, c)) break;
        var occ = pieceAt(state, 'ground', r, c);
        if (!occ) continue;
        if (occ.color === p.color) break; // own piece blocks
        var targets = [occ.id];
        if (pierce) {
          var br = r + dr, bc = c + dc, behind = inGround(br, bc) ? pieceAt(state, 'ground', br, bc) : null;
          if (behind && behind.color !== p.color) targets.push(behind.id);
        }
        out.push({ pieceId: p.id, type: 'attack', to: { board: 'ground', r: p.r, c: p.c }, targets: targets });
        break; // first enemy hit
      }
    }
  }

  var DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  var ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var ALL8 = DIAG.concat(ORTHO);
  var KNIGHT = [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]];

  function legionnaireMoves(state, p, out) {
    var f = forward(p.color);
    // non-capture: forward, left, right (1); forward 2 if not moved
    var steps = [[f, 0], [0, -1], [0, 1]];
    for (var i = 0; i < steps.length; i++) {
      var r = p.r + steps[i][0], c = p.c + steps[i][1];
      if (inGround(r, c) && !pieceAt(state, 'ground', r, c)) addLegMove(state, p, r, c, out);
    }
    if (!p.moved) {
      var r1 = p.r + f, r2 = p.r + 2 * f;
      if (inGround(r2, p.c) && !pieceAt(state, 'ground', r1, p.c) && !pieceAt(state, 'ground', r2, p.c))
        addLegMove(state, p, r2, p.c, out);
    }
    // capture: forward diagonals
    var caps = [[f, -1], [f, 1]];
    for (var k = 0; k < caps.length; k++) {
      var cr = p.r + caps[k][0], cc = p.c + caps[k][1];
      if (!inGround(cr, cc)) continue;
      var occ = pieceAt(state, 'ground', cr, cc);
      if (occ && occ.color !== p.color) addLegMove(state, p, cr, cc, out, [occ.id]);
    }
  }
  function addLegMove(state, p, r, c, out, targets) {
    out.push({ pieceId: p.id, type: 'move', to: { board: 'ground', r: r, c: c }, targets: targets || [] });
  }

  function flyAndSkyMoves(state, p, out, skyStep) {
    // fly up from a central ground square to its shadow sky square (if empty)
    if (p.board === 'ground') {
      if (underSky(p.r, p.c)) {
        var s = groundToSky(p.r, p.c);
        if (!pieceAt(state, 'sky', s.r, s.c)) out.push({ pieceId: p.id, type: 'fly', to: { board: 'sky', r: s.r, c: s.c }, targets: [] });
      }
    } else { // on sky: step 1 in any dir (sky), or descend to shadowed ground (move/capture)
      for (var d = 0; d < ALL8.length; d++) {
        var sr = p.r + ALL8[d][0], sc = p.c + ALL8[d][1];
        if (inSky(sr, sc) && !pieceAt(state, 'sky', sr, sc)) out.push({ pieceId: p.id, type: 'fly', to: { board: 'sky', r: sr, c: sc }, targets: [] });
      }
      var g = skyToGround(p.r, p.c), occ = pieceAt(state, 'ground', g.r, g.c);
      if (!occ) out.push({ pieceId: p.id, type: 'fly', to: { board: 'ground', r: g.r, c: g.c }, targets: [] });
      else if (occ.color !== p.color) out.push({ pieceId: p.id, type: 'move', to: { board: 'ground', r: g.r, c: g.c }, targets: [occ.id] });
    }
  }

  function pieceActions(state, p, out) {
    if (p.board === 'sky') { flyAndSkyMoves(state, p, out); return; }
    switch (p.type) {
      case 'L': legionnaireMoves(state, p, out); break;
      case 'VL': slide(state, p, ALL8, 1, out); break;
      case 'KF': slide(state, p, DIAG, 2, out); rangedAttack(state, p, DIAG, 2, out, false); break;
      case 'KT':
        for (var i = 0; i < KNIGHT.length; i++) {
          var r = p.r + KNIGHT[i][0], c = p.c + KNIGHT[i][1];
          if (!inGround(r, c)) continue;
          var occ = pieceAt(state, 'ground', r, c);
          if (!occ) out.push({ pieceId: p.id, type: 'move', to: { board: 'ground', r: r, c: c }, targets: [] });
          else if (occ.color !== p.color) out.push({ pieceId: p.id, type: 'move', to: { board: 'ground', r: r, c: c }, targets: [occ.id] });
        }
        rangedAttack(state, p, ORTHO, 1, out, true); break;
      case 'KI': slide(state, p, ORTHO, 2, out); rangedAttack(state, p, ORTHO, 2, out, false); break;
      case 'KA': slide(state, p, ALL8, 2, out); flyAndSkyMoves(state, p, out); break;
      case 'HL':
        slide(state, p, ALL8, 2, out); flyAndSkyMoves(state, p, out);
        // High Lords wield all furycraft except Flora's: an orthogonal strike to
        // range 2 (fire) that pierces the enemy directly behind the target (earth).
        rangedAttack(state, p, ORTHO, 2, out, true);
        break;
      case 'CU': slide(state, p, ALL8, 4, out); break;        // fast courier: glides up to 4
      case 'SH': slide(state, p, ALL8, 1, out); break;        // steadholder: holds its ground, steps 1
      case 'FL': slide(state, p, ALL8, 2, out); flyAndSkyMoves(state, p, out); break;
    }
  }

  function legalActions(state, color) {
    color = color || state.turn;
    if (state.winner) return [];
    var out = [];
    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];
      if (p.color === color) pieceActions(state, p, out);
    }
    return out;
  }

  function applyAction(state, action) {
    var ns = clone(state);
    var p = pieceById(ns, action.pieceId);
    if (!p) return ns;
    var capturedFL = false;
    if (!ns.captured) ns.captured = { white: [], black: [] };
    if (action.targets && action.targets.length) {
      for (var t = 0; t < action.targets.length; t++) {
        var victim = pieceById(ns, action.targets[t]);
        if (victim) {
          if (victim.type === 'FL') capturedFL = true;
          // record what `p` (the actor) took, and with which piece, for the tray.
          ns.captured[p.color].push({ type: victim.type, color: victim.color, by: p.type });
          remove(ns, victim.id);
        }
      }
    }
    if (action.type !== 'attack') {
      p.board = action.to.board; p.r = action.to.r; p.c = action.to.c; p.moved = true;
      // legionnaire promotion
      if (p.type === 'L' && p.board === 'ground' && p.r === backRank(p.color)) p.type = 'VL';
    }
    ns.moveCount++;
    if (capturedFL) ns.winner = p.color;
    else if (!hasFirstLord(ns, opp(state.turn))) ns.winner = state.turn;
    ns.turn = opp(state.turn);
    return ns;
  }

  function remove(state, id) {
    for (var i = 0; i < state.pieces.length; i++) if (state.pieces[i].id === id) { state.pieces.splice(i, 1); return; }
  }
  function opp(color) { return color === 'white' ? 'black' : 'white'; }
  function hasFirstLord(state, color) {
    for (var i = 0; i < state.pieces.length; i++) if (state.pieces[i].color === color && state.pieces[i].type === 'FL') return true;
    return false;
  }

  // Personality weights let each opponent bot "feel" like its character (see ai.js).
  // material is always 1.0; the rest scale the positional/style terms.
  var DEFAULT_W = { sky: 0.6, advance: 0.015, support: 0.05, danger: 40, ownDanger: 40 };

  // material eval from `color`'s perspective (+ tiny support bonus per canon).
  function evaluate(state, color, w) {
    w = w || DEFAULT_W;
    var score = 0;
    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i], v = VALUE[p.type] || 0;
      score += (p.color === color ? v : -v);
    }
    if (state.winner === color) score += 100000;
    else if (state.winner === opp(color)) score -= 100000;
    // support: friendly pieces orthogonally adjacent reinforce each other
    score += w.support * (supportCount(state, color) - supportCount(state, opp(color)));
    // positional: contest the skies + keep advancing (so bots don't just sit back)
    score += positional(state, color, w) - positional(state, opp(color), w);
    // NOTE: king safety (firstLordAttacked) is applied by ai.js at the ROOT of each
    // decision, not here — the deep search already punishes a truly hung First Lord
    // via the winner term, so keeping this leaf eval free of move-generation keeps
    // the search fast. The root check is what protects the 1-ply (medium) bot.
    return score;
  }
  // sky occupation + advance-toward-the-enemy nudge. Kept small vs material so the
  // AI won't sacrifice a knight for it, but enough to break passive/sky-blind play.
  function positional(state, color, w) {
    w = w || DEFAULT_W;
    var b = 0, fwd = forward(color);
    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];
      if (p.color !== color) continue;
      if (p.board === 'sky') { if (p.type !== 'FL') b += w.sky; continue; } // hold the skies
      if (p.type === 'FL') continue; // the king stays home; don't reward marching it
      // rows advanced from own back rank toward the foe (0..GROUND-1)
      var adv = (fwd < 0) ? (GROUND - 1 - p.r) : p.r;
      b += adv * w.advance;
    }
    return b;
  }
  // does `color`'s First Lord sit on a square an enemy action can hit?
  function firstLordAttacked(state, color) {
    var fl = null;
    for (var i = 0; i < state.pieces.length; i++) {
      var q = state.pieces[i];
      if (q.color === color && q.type === 'FL') { fl = q; break; }
    }
    if (!fl) return false;
    var enemy = legalActions(state, opp(color));
    for (var a = 0; a < enemy.length; a++) {
      var ts = enemy[a].targets;
      for (var t = 0; t < ts.length; t++) if (ts[t] === fl.id) return true;
    }
    return false;
  }
  // count of friendly orthogonal reinforcements; a Steadholder anchors twice as hard.
  function supportCount(state, color) {
    var b = 0;
    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];
      if (p.color !== color || p.board !== 'ground') continue;
      for (var d = 0; d < ORTHO.length; d++) {
        var n = pieceAt(state, 'ground', p.r + ORTHO[d][0], p.c + ORTHO[d][1]);
        if (n && n.color === color) b += (n.type === 'SH' ? 2 : 1);
      }
    }
    return b;
  }

  window.Ludus = {
    GROUND: GROUND, SKY: SKY, SKY_OFF: SKY_OFF, VALUE: VALUE, AERIAL: AERIAL,
    initialState: initialState, legalActions: legalActions, applyAction: applyAction,
    evaluate: evaluate, clone: clone, pieceAt: pieceAt, pieceById: pieceById,
    underSky: underSky, groundToSky: groundToSky, skyToGround: skyToGround,
    opp: opp, hasFirstLord: hasFirstLord, firstLordAttacked: firstLordAttacked,
    isAerial: function (t) { return !!AERIAL[t]; }
  };
})();
