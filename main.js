/* ludus/main.js — screen flow + game controller.
 * Screens: title (opponent select) -> side select -> game ; or title -> online.
 * Difficulty lives in in-game Settings and restarts the game (with confirm).
 */
(function () {
  'use strict';
  var E = window.Ludus, AI = window.LudusAI, UI = window.LudusUI, NET = window.LudusNet;

  // Opponents from across the Realm. Difficulty maps to the AI strength.
  var OPPONENTS = [
    { id: 'max', name: 'Antillar Maximus', faction: 'Alera', difficulty: 'easy', blurb: 'Brash and fearless — he plays on instinct, not patience.' },
    { id: 'ehren', name: 'Ehren ex Cursori', faction: 'Alera', difficulty: 'medium', blurb: 'A Cursor\'s careful, clever calculation. Misses little.' },
    { id: 'kitai', name: 'Kitai', faction: 'Alera', difficulty: 'medium', blurb: 'Marat-sharp and endlessly adaptable to your plans.' },
    { id: 'tavi', name: 'Tavi', faction: 'Alera', difficulty: 'hard', blurb: 'The finest Ludus mind in the Realm. He sees the endgame from the first move.' },
    { id: 'nasaug', name: 'Nasaug', faction: 'Canim', difficulty: 'medium', blurb: 'A Canim battlemaster who never wastes a move.' },
    { id: 'varg', name: 'Warmaster Varg', faction: 'Canim', difficulty: 'hard', blurb: 'Patient, disciplined, and utterly relentless once committed.' },
    { id: 'queen', name: 'The Vord Queen', faction: 'Vord', difficulty: 'hard', blurb: 'Cold, inhuman calculation. She studies you as you play.' }
  ];
  var FACTIONS = ['Alera', 'Canim', 'Vord'];
  var DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

  var ui, state, mode = null;            // 'bot' | 'hotseat' | 'online'
  var humanColors = {};
  var difficulty = 'medium', aiColor = 'black';
  var currentOpponent = null, currentSide = 'white';
  var net = null, unsub = null, unsubPlayers = null, applying = false, unsubRooms = null;

  function $(id) { return document.getElementById(id); }
  function setStatus(m) { $('status').textContent = m; }

  function showScreen(id) {
    var s = document.querySelectorAll('.screen');
    for (var i = 0; i < s.length; i++) s[i].classList.toggle('active', s[i].id === id);
  }

  // ---- title: build opponent cards ------------------------------------
  function buildOpponents() {
    var host = $('oppGroups'); host.innerHTML = '';
    FACTIONS.forEach(function (fac) {
      var inFac = OPPONENTS.filter(function (o) { return o.faction === fac; });
      if (!inFac.length) return;
      var g = document.createElement('div'); g.className = 'opp-group';
      g.innerHTML = '<h3>' + fac + '</h3>';
      var grid = document.createElement('div'); grid.className = 'opp-grid';
      inFac.forEach(function (o) {
        var b = document.createElement('button'); b.className = 'opp-card';
        b.innerHTML = '<div class="nm">' + o.name + '</div>' +
          '<div class="meta diff-' + o.difficulty + '">' + DIFF_LABEL[o.difficulty] + '</div>' +
          '<div class="bl">' + o.blurb + '</div>';
        b.onclick = function () { chooseOpponent(o); };
        grid.appendChild(b);
      });
      g.appendChild(grid); host.appendChild(g);
    });
  }

  function chooseOpponent(o) {
    currentOpponent = o; difficulty = o.difficulty;
    $('sideOpp').innerHTML = 'Facing <b>' + o.name + '</b> · ' + DIFF_LABEL[o.difficulty] + ' difficulty.';
    showScreen('screenSide');
  }

  // ---- start a local (bot/hotseat) game --------------------------------
  function startBot(side) {
    currentSide = side;
    aiColor = side === 'white' ? 'black' : 'white';
    var hc = {}; hc[side] = true;
    beginLocal('bot', hc, side, currentOpponent ? 'vs ' + currentOpponent.name + ' · ' + DIFF_LABEL[difficulty] : 'vs Bot');
  }
  function startHotseat() {
    beginLocal('hotseat', { white: true, black: true }, 'white', 'Pass & Play');
  }
  function beginLocal(m, hc, perspective, label) {
    teardownNet();
    net = null; mode = m; humanColors = hc;
    state = E.initialState();
    $('oppLabel').innerHTML = label;
    $('roomBox').style.display = 'none';
    $('btnFlip').dataset.p = perspective;
    ui.setPerspective(perspective);
    ui.clearSelection();
    showScreen('screenGame');
    loop();
  }

  function loop() {
    ui.render(state);
    if (state.winner) {
      var youWin = humanColors[state.winner];
      if (mode === 'spectate') setStatus(state.winner.toUpperCase() + ' wins — captured the First Lord.');
      else setStatus((mode === 'hotseat' ? state.winner.toUpperCase() + ' wins' : (youWin ? 'Victory — you' : 'Defeat — your foe') + ' captured the First Lord') + '.');
      ui.setInteractive(false);
      return;
    }
    var humanTurn = !!humanColors[state.turn];
    ui.setInteractive(humanTurn);
    if (mode === 'spectate') { setStatus('Spectating — ' + state.turn.toUpperCase() + ' to move.'); return; }
    if (mode === 'online') { setStatus(humanTurn ? 'Your move (' + state.turn + ').' : 'Waiting for ' + state.turn + '…'); return; }
    if (humanTurn) { setStatus(state.turn.toUpperCase() + ' to move.'); return; }
    setStatus((currentOpponent ? currentOpponent.name : state.turn.toUpperCase()) + ' is thinking…');
    setTimeout(function () {
      var a = AI.chooseAction(state, state.turn, difficulty);
      if (a) state = E.applyAction(state, a);
      loop();
    }, 140);
  }

  function onAction(action) {
    if (state.winner || !humanColors[state.turn]) return;
    state = E.applyAction(state, action);
    if (mode === 'online' && net) { applying = true; NET.pushState(net.ref, state).finally(function () { applying = false; }); }
    loop();
  }

  // ---- online ----------------------------------------------------------
  function teardownNet() {
    if (unsub) { unsub(); unsub = null; }
    if (unsubPlayers) { unsubPlayers(); unsubPlayers = null; }
  }

  function onlineError(err) {
    var msg = (err && err.message) || String(err);
    if (/permission|denied/i.test(msg)) msg += ' — publish the Realtime Database rules (see LUDUS.md).';
    $('onlineStatus').textContent = 'Online error: ' + msg;
    showScreen('screenOnline');
  }

  // ---- lobby: browse open games & live games to spectate ---------------
  function showOnlineScreen() {
    showScreen('screenOnline');
    if (NET.configured() && !unsubRooms) unsubRooms = NET.onRooms(renderRooms);
  }
  function stopRooms() { if (unsubRooms) { unsubRooms(); unsubRooms = null; } }

  function renderRooms(rooms) {
    var host = $('roomList'); if (!host) return;
    var me = NET.clientId();
    var open = rooms.filter(function (r) { return r.open && r.host !== me; });
    var live = rooms.filter(function (r) { return r.full; });
    host.innerHTML = '';
    if (!open.length && !live.length) {
      host.innerHTML = '<div class="lobby-empty">No open games right now — create one above and wait for a player, or share your code.</div>';
      return;
    }
    function row(r, label, action) {
      var b = document.createElement('button'); b.className = 'room-item';
      b.innerHTML = '<span class="rc">' + r.id + '</span><span class="rs">' + label + '</span>';
      b.onclick = action; host.appendChild(b);
    }
    open.forEach(function (r) {
      row(r, '<b>Open</b> — waiting for a player · <span class="rj">Join ›</span>', function () { stopRooms(); joinOnline(r.id); });
    });
    live.forEach(function (r) {
      row(r, 'In progress · <span class="rj">Watch ›</span>', function () { stopRooms(); spectateOnline(r.id); });
    });
  }

  // SPECTATE: watch a live game without taking a seat.
  function spectateOnline(code) {
    teardownNet();
    $('onlineStatus').textContent = 'Loading game…';
    NET.spectate(code).then(function (room) {
      net = room; mode = 'spectate'; currentOpponent = null; humanColors = {};
      $('onlineStatus').textContent = '';
      enterSpectate(room);
    }).catch(onlineError);
  }

  function enterSpectate(room) {
    net = room; mode = 'spectate';
    $('oppLabel').textContent = 'Spectating · room ' + room.roomId;
    ui.setPerspective('white'); $('btnFlip').dataset.p = 'white';
    $('roomBox').style.display = 'block';
    $('roomCode').textContent = room.roomId; $('roomColor').textContent = 'spectator';
    showScreen('screenGame');
    ui.clearSelection();
    state = E.initialState();
    unsub = NET.onState(room.ref, function (remote) { state = remote; loop(); });
    loop();
  }

  // CREATE: open a room, sit in the lobby, and start the moment a foe joins.
  function createOnline() {
    stopRooms();
    teardownNet();
    $('onlineStatus').textContent = 'Creating room…';
    NET.createRoom(E.initialState()).then(function (room) {
      net = room; mode = 'online'; currentOpponent = null;
      humanColors = {}; humanColors[room.color] = true;
      $('onlineStatus').textContent = '';
      $('lobbyCode').textContent = room.roomId;
      $('lobbyColor').textContent = room.color;
      $('lobbySpin').textContent = '⏳ Waiting for your opponent to join…';
      showScreen('screenLobby');
      // Watch the seats; when both are filled, both clients drop into the game.
      unsubPlayers = NET.onPlayers(room.ref, function (players) {
        if (NET.isFull(players)) { teardownNet(); enterOnlineGame(room); }
      });
    }).catch(onlineError);
  }

  // JOIN: claim a seat in an existing room and go straight into the game.
  function joinOnline(code) {
    stopRooms();
    teardownNet();
    $('onlineStatus').textContent = 'Joining…';
    NET.joinRoom(code).then(function (room) {
      net = room; mode = 'online'; currentOpponent = null;
      humanColors = {}; humanColors[room.color] = true;
      $('onlineStatus').textContent = '';
      enterOnlineGame(room);
    }).catch(onlineError);
  }

  function enterOnlineGame(room) {
    net = room; mode = 'online';
    $('oppLabel').textContent = 'Online · you are ' + room.color;
    ui.setPerspective(room.color); $('btnFlip').dataset.p = room.color;
    $('roomBox').style.display = 'block';
    $('roomCode').textContent = room.roomId; $('roomColor').textContent = room.color;
    showScreen('screenGame');
    ui.clearSelection();
    state = E.initialState(); // safe placeholder; the state listener syncs the authoritative board
    unsub = NET.onState(room.ref, function (remote) { if (applying) return; state = remote; loop(); });
    setStatus('Room ' + room.roomId + ' — your opponent has joined. You are ' + room.color + '.');
    loop();
  }

  function leaveOnline() {
    teardownNet();
    if (net) { NET.leaveRoom(net.ref); net = null; }
    mode = null;
  }

  // ---- settings (difficulty w/ confirm-restart) ------------------------
  function openSettings() {
    $('settingsDifficulty').value = difficulty;
    $('diffWarn').style.display = 'none';
    $('settingsOverlay').classList.add('open');
  }
  function closeSettings() { $('settingsOverlay').classList.remove('open'); }

  function init() {
    ui = UI.create({ canvas: $('board'), onAction: onAction, canSelect: function (c) { return !!humanColors[c]; } });
    buildOpponents();

    // side select
    document.querySelectorAll('#screenSide [data-side]').forEach(function (b) {
      b.onclick = function () { startBot(b.dataset.side); };
    });
    $('sideBack').onclick = function () { showScreen('screenTitle'); };

    // online
    $('btnAnotherPlayer').onclick = showOnlineScreen;
    $('onlineBack').onclick = function () { stopRooms(); showScreen('screenTitle'); };
    $('btnPassPlay').onclick = function () { stopRooms(); startHotseat(); };
    $('btnCreate').onclick = function () {
      if (!NET.configured()) { showScreen('screenOnline'); setStatus(''); alert('Online play is not configured yet (ludus/firebase-config.js).'); return; }
      createOnline();
    };
    $('btnJoin').onclick = function () {
      if (!NET.configured()) { alert('Online play is not configured yet (ludus/firebase-config.js).'); return; }
      var code = $('joinCode').value; if (!code) { alert('Enter a room code.'); return; }
      joinOnline(code);
    };

    // lobby: cancel the room and go back to pick an opponent (e.g. play the AI)
    $('lobbyBack').onclick = function () { leaveOnline(); showScreen('screenTitle'); };

    // game-screen tools
    $('btnNewGame').onclick = function () {
      if (mode === 'online') leaveOnline(); else teardownNet();
      $('roomBox').style.display = 'none';
      showScreen('screenTitle');
    };
    $('btnFlip').onclick = function () {
      var next = $('btnFlip').dataset.p === 'black' ? 'white' : 'black';
      $('btnFlip').dataset.p = next; ui.setPerspective(next);
    };

    // settings modal
    $('btnSettings').onclick = openSettings;
    $('btnSettingsClose').onclick = closeSettings;
    $('settingsDifficulty').onchange = function () {
      $('diffWarn').style.display = (this.value !== difficulty) ? 'block' : 'none';
    };
    $('diffCancel').onclick = function () { $('settingsDifficulty').value = difficulty; $('diffWarn').style.display = 'none'; };
    $('diffConfirm').onclick = function () {
      difficulty = $('settingsDifficulty').value;
      closeSettings();
      if (mode === 'bot') startBot(currentSide); // restart with same side, new difficulty
    };

    // rules modal
    $('btnRules').onclick = function () { $('rulesOverlay').classList.add('open'); };
    $('btnRulesClose').onclick = function () { $('rulesOverlay').classList.remove('open'); };

    // overlay backdrop + Esc close
    document.querySelectorAll('.overlay').forEach(function (ov) {
      ov.addEventListener('click', function (e) { if (e.target === ov) ov.classList.remove('open'); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') document.querySelectorAll('.overlay.open').forEach(function (o) { o.classList.remove('open'); });
    });

    if (!NET.configured()) $('btnCreate').title = $('btnJoin').title = 'Configure ludus/firebase-config.js to enable online play';

    // presence: announce ourselves and show the live online count
    if (NET.configured()) {
      NET.startPresence();
      NET.onOnlineCount(function (n) {
        var el = $('onlineCount');
        if (el) { el.textContent = '● ' + n + ' online'; el.style.display = ''; }
      });
    }

    showScreen('screenTitle');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
