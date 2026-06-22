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
  // Layout: the ground board fills the top; the sky board sits BELOW it on the
  // left, with the captured-piece tray filling the space to its right.
  var GRD_X = PAD, GRD_Y = PAD;
  var SKY_X = PAD, SKY_Y = PAD + GW + GAP;
  var CAP_X = SKY_X + SW + GAP;            // captured tray, right of the sky board
  var W = PAD + GW + PAD;
  var H = SKY_Y + SW + PAD;

  var LIGHT = '#d9c4a3', DARK = '#9a7b4f', SKYL = '#3a5a7a', SKYD = '#26415c';
  var SEL = 'rgba(90,200,255,0.55)', DEST = 'rgba(120,255,160,0.45)', CAP = 'rgba(255,90,90,0.55)';
  var SHADOW = 'rgba(90,200,255,0.12)';
  var GLYPH = { L: 'L', VL: 'V', KF: 'F', KT: 'T', KI: 'I', KR: 'R', KA: 'A', HL: 'H', CU: 'C', SH: 'S', FL: '★' };

  function create(opts) {
    var canvas = opts.canvas, onAction = opts.onAction;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var state = null, selected = null, actions = [], interactive = true, perspective = 'white';
    var showMoves = true;   // highlight a selected piece's legal destinations

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
      ctx.fillText('SKY-BOARD 5×5 (over centre)', SKY_X, SKY_Y - 4);

      // highlights for selected piece's actions
      if (selected) {
        var selPx = cellPx(selected.board, selected.r, selected.c);
        outline(selPx, SEL);
        if (showMoves) for (var i = 0; i < actions.length; i++) {
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

      drawCaptured();
    }

    // Captured-pieces tray in the space to the right of the sky board. Each row
    // shows the foes one side has taken (and which piece took the last one).
    function drawCaptured() {
      if (!state.captured) return;
      var x0 = CAP_X, y0 = SKY_Y + 14, rowH = 90, r = 9, gap = 4;
      var trayW = W - PAD - CAP_X;            // available width for chips
      // perspective: show "your" captures (bottom side) first.
      var bottom = perspective === 'black' ? 'black' : 'white';
      var top = bottom === 'white' ? 'black' : 'white';
      var rows = [
        { who: bottom, label: 'Your captures' },
        { who: top, label: 'Foe’s captures' }
      ];
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (var ri = 0; ri < rows.length; ri++) {
        var list = state.captured[rows[ri].who] || [];
        var y = y0 + ri * rowH;
        ctx.fillStyle = '#9fb4cc'; ctx.font = '11px monospace';
        ctx.fillText(rows[ri].label + ' (' + list.length + ')', x0, y - 12);
        var perRow = Math.max(1, Math.floor(trayW / (r * 2 + gap)));
        for (var i = 0; i < list.length; i++) {
          var col = i % perRow, line = Math.floor(i / perRow);
          var cx = x0 + r + col * (r * 2 + gap), cy = y + r + line * (r * 2 + gap);
          drawChip(cx, cy, r, list[i]);
        }
      }
    }
    function drawChip(cx, cy, r, victim) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = victim.color === 'white' ? '#f2ead2' : '#2a2a32';
      ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = victim.color === 'white' ? '#8a7a52' : '#0c0c10'; ctx.stroke();
      ctx.fillStyle = victim.color === 'white' ? '#2a2a32' : '#f2ead2';
      ctx.font = 'bold ' + (r * 1.1) + 'px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(GLYPH[victim.type] || '?', cx, cy + 1);
      ctx.textAlign = 'left';
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
      closeChooser();
      var cell = pxCell(px, py); if (!cell) return;
      // if a selected piece can act on this cell, commit
      if (selected) {
        var moveAct = null, atkAct = null;
        for (var i = 0; i < actions.length; i++) {
          var a = actions[i]; if (a.pieceId !== selected.id) continue;
          if (a.type === 'attack') {
            for (var t = 0; t < a.targets.length; t++) {
              var v = E.pieceById(state, a.targets[t]);
              if (v && v.board === cell.board && v.r === cell.r && v.c === cell.c) { atkAct = a; break; }
            }
          } else if (a.to.board === cell.board && a.to.r === cell.r && a.to.c === cell.c) { moveAct = a; }
        }
        // Both a move-capture and a furycraft strike land on this square → let the
        // player choose instead of silently picking one (Knight Flora/Ignus etc.).
        if (moveAct && atkAct) { showChooser(ev.clientX, ev.clientY, moveAct, atkAct); return; }
        if (moveAct) { commit(moveAct); return; }
        if (atkAct) { commit(atkAct); return; }
      }
      // else (re)select a friendly piece we're allowed to move
      var p = E.pieceAt(state, cell.board, cell.r, cell.c);
      if (p && p.color === state.turn && opts.canSelect(p.color)) { selected = p; draw(); }
      else { selected = null; draw(); }
    }
    function commit(a) { closeChooser(); selected = null; onAction(a); }

    // small popup to disambiguate move-capture vs furycraft strike on one square
    var chooserEl = null;
    function closeChooser() { if (chooserEl) { chooserEl.parentNode && chooserEl.parentNode.removeChild(chooserEl); chooserEl = null; } }
    function showChooser(clientX, clientY, moveAct, atkAct) {
      closeChooser();
      var m = document.createElement('div');
      m.style.cssText = 'position:fixed;z-index:9999;left:' + clientX + 'px;top:' + clientY +
        'px;background:#1b2530;border:1px solid #3a5a7a;border-radius:8px;padding:6px;' +
        'display:flex;flex-direction:column;gap:4px;box-shadow:0 6px 20px rgba(0,0,0,.55)';
      function btn(label, act) {
        var b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'cursor:pointer;border:0;border-radius:6px;padding:7px 12px;' +
          'font:13px/1.2 monospace;background:#274058;color:#eaf2ff;white-space:nowrap';
        b.onclick = function (e) { e.stopPropagation(); commit(act); };
        return b;
      }
      m.appendChild(btn('⚔ Move & capture', moveAct));
      m.appendChild(btn('✷ Furycraft strike', atkAct));
      document.body.appendChild(m);
      chooserEl = m;
    }

    canvas.addEventListener('click', onClick);

    return {
      render: function (st) { state = st; actions = st && !st.winner ? E.legalActions(st, st.turn) : []; if (selected && !E.pieceById(st, selected.id)) selected = null; draw(); },
      setInteractive: function (b) { interactive = b; },
      setPerspective: function (p) { perspective = p; if (state) draw(); },
      setShowMoves: function (b) { showMoves = !!b; if (state) draw(); },
      clearSelection: function () { closeChooser(); selected = null; if (state) draw(); }
    };
  }

  window.LudusUI = { create: create, GLYPH: GLYPH };
})();
