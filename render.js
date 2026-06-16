/* ludus/render.js — canvas board + input for Ludus. Global: window.LudusUI
 * Draws the 11x11 ground board and the 5x5 sky board (which shadows the central
 * 5x5). Handles piece selection + highlighting legal destinations; calls back
 * onAction(action) when the player commits a move.
 */
(function () {
  'use strict';
  var E = window.Ludus;

  var GCELL = 40, SCELL = 40, GAP = 28;
  var GW = E.GROUND * GCELL;      // ground pixel width/height
  var SW = E.SKY * SCELL;         // sky pixel width/height
  var PAD = 16;
  var W = PAD + GW + GAP + SW + PAD;
  var H = PAD + GW + PAD;
  var SKY_X = PAD + GW + GAP, SKY_Y = PAD;  // sky board origin
  var GRD_X = PAD, GRD_Y = PAD;

  var LIGHT = '#d9c4a3', DARK = '#9a7b4f', SKYL = '#3a5a7a', SKYD = '#26415c';
  var SEL = 'rgba(90,200,255,0.55)', DEST = 'rgba(120,255,160,0.45)', CAP = 'rgba(255,90,90,0.55)';
  var SHADOW = 'rgba(90,200,255,0.12)';
  var GLYPH = { L: 'L', VL: 'V', KF: 'F', KT: 'T', KI: 'I', KA: 'A', HL: 'H', FL: '★' };

  function create(opts) {
    var canvas = opts.canvas, onAction = opts.onAction;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var state = null, selected = null, actions = [], interactive = true, perspective = 'white';

    // map a board cell to its top-left pixel, honoring perspective flip
    function cellPx(board, r, c) {
      var R = r, C = c;
      if (perspective === 'black') {
        if (board === 'ground') { R = E.GROUND - 1 - r; C = E.GROUND - 1 - c; }
        else { R = E.SKY - 1 - r; C = E.SKY - 1 - c; }
      }
      if (board === 'ground') return { x: GRD_X + C * GCELL, y: GRD_Y + R * GCELL, s: GCELL };
      return { x: SKY_X + C * SCELL, y: SKY_Y + R * SCELL, s: SCELL };
    }
    // inverse: pixel -> {board,r,c} or null
    function pxCell(px, py) {
      if (px >= GRD_X && px < GRD_X + GW && py >= GRD_Y && py < GRD_Y + GW) {
        var C = ((px - GRD_X) / GCELL) | 0, R = ((py - GRD_Y) / GCELL) | 0;
        if (perspective === 'black') { R = E.GROUND - 1 - R; C = E.GROUND - 1 - C; }
        return { board: 'ground', r: R, c: C };
      }
      if (px >= SKY_X && px < SKY_X + SW && py >= SKY_Y && py < SKY_Y + SW) {
        var c2 = ((px - SKY_X) / SCELL) | 0, r2 = ((py - SKY_Y) / SCELL) | 0;
        if (perspective === 'black') { r2 = E.SKY - 1 - r2; c2 = E.SKY - 1 - c2; }
        return { board: 'sky', r: r2, c: c2 };
      }
      return null;
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#11161d'; ctx.fillRect(0, 0, W, H);
      // ground squares
      for (var r = 0; r < E.GROUND; r++) for (var c = 0; c < E.GROUND; c++) {
        var p = cellPx('ground', r, c);
        ctx.fillStyle = ((r + c) & 1) ? DARK : LIGHT;
        ctx.fillRect(p.x, p.y, p.s, p.s);
        if (E.underSky(r, c)) { ctx.fillStyle = SHADOW; ctx.fillRect(p.x, p.y, p.s, p.s); }
      }
      // sky squares
      for (var sr = 0; sr < E.SKY; sr++) for (var sc = 0; sc < E.SKY; sc++) {
        var sp = cellPx('sky', sr, sc);
        ctx.fillStyle = ((sr + sc) & 1) ? SKYD : SKYL;
        ctx.fillRect(sp.x, sp.y, sp.s, sp.s);
      }
      // labels
      ctx.fillStyle = '#cfe3ff'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
      ctx.fillText('GROUND 11×11', GRD_X, GRD_Y - 4);
      ctx.fillText('SKY 5×5 (over centre)', SKY_X, SKY_Y - 4);

      // highlights for selected piece's actions
      if (selected) {
        var selPx = cellPx(selected.board, selected.r, selected.c);
        outline(selPx, SEL);
        for (var i = 0; i < actions.length; i++) {
          var a = actions[i]; if (a.pieceId !== selected.id) continue;
          var d = cellPx(a.to.board, a.to.r, a.to.c);
          if (a.type === 'attack') { // ranged: mark each target cell
            for (var t = 0; t < a.targets.length; t++) { var v = E.pieceById(state, a.targets[t]); if (v) outline(cellPx(v.board, v.r, v.c), CAP); }
          } else outline(d, a.targets.length ? CAP : DEST);
        }
      }

      // pieces
      for (var k = 0; k < state.pieces.length; k++) {
        var pc = state.pieces[k], q = cellPx(pc.board, pc.r, pc.c);
        drawPiece(q, pc);
      }
    }

    function outline(p, color) { ctx.fillStyle = color; ctx.fillRect(p.x, p.y, p.s, p.s); }

    function drawPiece(q, pc) {
      var cx = q.x + q.s / 2, cy = q.y + q.s / 2, rad = q.s * 0.38;
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fillStyle = pc.color === 'white' ? '#f2ead2' : '#2a2a32';
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = pc.color === 'white' ? '#8a7a52' : '#0c0c10'; ctx.stroke();
      if (E.isAerial(pc.type)) { ctx.strokeStyle = '#5ac8ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, rad + 2.5, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = pc.color === 'white' ? '#2a2a32' : '#f2ead2';
      ctx.font = 'bold ' + (q.s * 0.42) + 'px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(GLYPH[pc.type] || '?', cx, cy + 1);
      ctx.textBaseline = 'alphabetic';
    }

    function onClick(ev) {
      if (!interactive || !state || state.winner) return;
      var rect = canvas.getBoundingClientRect();
      var px = (ev.clientX - rect.left) * (W / rect.width);
      var py = (ev.clientY - rect.top) * (H / rect.height);
      var cell = pxCell(px, py); if (!cell) return;
      // if a selected piece can act on this cell, commit
      if (selected) {
        for (var i = 0; i < actions.length; i++) {
          var a = actions[i]; if (a.pieceId !== selected.id) continue;
          if (a.type === 'attack') {
            for (var t = 0; t < a.targets.length; t++) {
              var v = E.pieceById(state, a.targets[t]);
              if (v && v.board === cell.board && v.r === cell.r && v.c === cell.c) { commit(a); return; }
            }
          } else if (a.to.board === cell.board && a.to.r === cell.r && a.to.c === cell.c) { commit(a); return; }
        }
      }
      // else (re)select a friendly piece we're allowed to move
      var p = E.pieceAt(state, cell.board, cell.r, cell.c);
      if (p && p.color === state.turn && opts.canSelect(p.color)) { selected = p; draw(); }
      else { selected = null; draw(); }
    }
    function commit(a) { selected = null; onAction(a); }

    canvas.addEventListener('click', onClick);

    return {
      render: function (st) { state = st; actions = st && !st.winner ? E.legalActions(st, st.turn) : []; if (selected && !E.pieceById(st, selected.id)) selected = null; draw(); },
      setInteractive: function (b) { interactive = b; },
      setPerspective: function (p) { perspective = p; if (state) draw(); },
      clearSelection: function () { selected = null; if (state) draw(); }
    };
  }

  window.LudusUI = { create: create, GLYPH: GLYPH };
})();
