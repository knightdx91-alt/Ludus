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
  var unsubAway = null, awayTimer = null, awayUntil = 0;
  var gameStart = 0, gameRecorded = false;          // for the Hall of Records
  var unsubLeader = null, unsubMsg = null;

  function $(id) { return document.getElementById(id); }
  function setStatus(m) { $('status').textContent = m; }

  // ---- back-button / resume handling -----------------------------------
  // Screens that represent a live session you shouldn't lose to a stray tap.
  var SESSION_SCREENS = { screenGame: 1, screenLobby: 1 };
  var GRACE_MS = 60000;                 // window to undo an accidental "back"
  var sessionActive = false, lastSessionScreen = null;
  var graceTimer = null, graceUntil = 0;

  function showScreen(id, fromPop) {
    var s = document.querySelectorAll('.screen');
    for (var i = 0; i < s.length; i++) s[i].classList.toggle('active', s[i].id === id);
    if (!fromPop) {
      // Forward navigation: returning to the title is an intentional exit;
      // anything deeper pushes a history entry so the device back button is
      // caught by us (→ title) instead of unloading the whole site.
      if (id === 'screenTitle') clearSession();
      else if (window.history && history.pushState) history.pushState({ ludus: id }, '');
    }
    if (SESSION_SCREENS[id]) { // we're (re)entering a live session — cancel any pending grace
      sessionActive = true; lastSessionScreen = id;
      clearGraceTimer(); $('resumeBar').style.display = 'none';
    }
  }

  function clearGraceTimer() { if (graceTimer) { clearInterval(graceTimer); graceTimer = null; } }

  // Back was pressed during a live session: drop to the title but keep the game
  // alive for GRACE_MS so an accidental tap can be undone via the Resume banner.
  function softLeaveToTitle() {
    sessionActive = false;
    showScreen('screenTitle', true);
    graceUntil = Date.now() + GRACE_MS;
    // Tell the opponent we've stepped away so they see a forfeit countdown too.
    if (mode === 'online' && net && !(state && state.winner)) NET.setAway(net.ref, net.color, graceUntil);
    $('resumeBar').style.display = 'flex';
    tickGrace();
    graceTimer = setInterval(tickGrace, 1000);
  }
  function tickGrace() {
    var left = Math.ceil((graceUntil - Date.now()) / 1000);
    if (left <= 0) { finalizeLeave(); return; }
    $('resumeCount').textContent = left + 's';
  }
  function resumeSession() {
    if (!lastSessionScreen) { finalizeLeave(); return; }
    clearGraceTimer(); $('resumeBar').style.display = 'none';
    if (mode === 'online' && net) NET.clearAway(net.ref); // we're back — call off the forfeit
    showScreen(lastSessionScreen); // re-enters the session (and re-arms a back guard)
  }
  // Grace expired (or unresumable): actually abandon the session.
  function finalizeLeave() {
    clearGraceTimer(); $('resumeBar').style.display = 'none';
    if (mode === 'online' && net) {
      // Forfeit: hand the win to the opponent so their board shows the result.
      if (state && !state.winner) { state.winner = net.color === 'white' ? 'black' : 'white'; NET.pushState(net.ref, state); }
      NET.clearAway(net.ref);
      leaveOnline();
    } else teardownNet();
    mode = null; sessionActive = false; lastSessionScreen = null;
  }
  // Intentional, immediate exit (menu buttons): no grace, nothing to resume.
  function clearSession() {
    clearGraceTimer(); $('resumeBar').style.display = 'none';
    sessionActive = false; lastSessionScreen = null;
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
    ensureName();
    teardownNet();
    net = null; mode = m; humanColors = hc;
    state = E.initialState();
    $('oppLabel').innerHTML = label;
    $('roomBox').style.display = 'none';
    $('btnFlip').dataset.p = perspective;
    ui.setPerspective(perspective);
    ui.clearSelection();
    gameStart = Date.now(); gameRecorded = false;
    showScreen('screenGame');
    loop();
  }

  // First time the player starts a game, ask what to call them (for the Hall of
  // Records). Only asks once — a saved name or a prior decline won't re-prompt.
  function ensureName() {
    try {
      if (NET.playerName()) return;
      if (localStorage.getItem('ludus_name_asked')) return;
      localStorage.setItem('ludus_name_asked', '1');
      var n = window.prompt('What name shall the Realm remember you by?\n(Used for the leaderboard & message board — you can change it later in the Hall.)', '');
      if (n && n.trim()) NET.setPlayerName(n.trim());
    } catch (e) {}
  }

  // Record a human victory to the shared leaderboard (bot + online games only).
  function recordResult() {
    if (gameRecorded) return;
    gameRecorded = true;
    if (mode !== 'bot' && mode !== 'online') return;   // skip hotseat / spectate
    if (!NET.configured() || !(state && state.winner)) return;
    if (!humanColors[state.winner]) return;            // a Hall of *Records* = victories
    var foe = mode === 'bot' ? (currentOpponent ? currentOpponent.name : 'the bot') : 'an online challenger';
    NET.submitResult({
      name: NET.playerName() || 'Challenger', opponent: foe,
      mode: mode, won: true, durationMs: Date.now() - gameStart
    });
  }

  function loop() {
    ui.render(state);
    if (state.winner) {
      var youWin = humanColors[state.winner];
      recordResult();
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
      var a = AI.chooseAction(state, state.turn, difficulty, currentOpponent && currentOpponent.id);
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
    if (unsubAway) { unsubAway(); unsubAway = null; }
    clearAwayTimer(); $('awayBar').style.display = 'none';
  }

  function clearAwayTimer() { if (awayTimer) { clearInterval(awayTimer); awayTimer = null; } }

  // The opponent stepped away (or came back). away = {color, until} | null.
  function onOpponentAway(away) {
    // Ignore our own away flag (we have the Resume banner) and a stale flag once
    // the game is already decided.
    if (!away || (net && away.color === net.color) || (state && state.winner)) {
      clearAwayTimer(); $('awayBar').style.display = 'none'; return;
    }
    awayUntil = away.until || 0;
    $('awayBar').style.display = 'flex';
    tickAway();
    clearAwayTimer(); awayTimer = setInterval(tickAway, 1000);
  }
  function tickAway() {
    var left = Math.ceil((awayUntil - Date.now()) / 1000);
    if (left <= 0) {
      clearAwayTimer(); $('awayBar').style.display = 'none';
      // Claim the win ourselves in case the absent player's tab can't push it.
      if (mode === 'online' && net && state && !state.winner) {
        state.winner = net.color; NET.pushState(net.ref, state); NET.clearAway(net.ref); loop();
      }
      return;
    }
    $('awayCount').textContent = left;
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
    ensureName();
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
    ensureName();
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
    NET.armGame(room.ref, room.color); // a tab that dies mid-game drops only its own seat
    gameStart = Date.now(); gameRecorded = false;
    $('oppLabel').textContent = 'Online · you are ' + room.color;
    ui.setPerspective(room.color); $('btnFlip').dataset.p = room.color;
    $('roomBox').style.display = 'block';
    $('roomCode').textContent = room.roomId; $('roomColor').textContent = room.color;
    showScreen('screenGame');
    ui.clearSelection();
    state = E.initialState(); // safe placeholder; the state listener syncs the authoritative board
    unsub = NET.onState(room.ref, function (remote) { if (applying) return; state = remote; loop(); });
    unsubAway = NET.onAway(room.ref, onOpponentAway); // watch for the opponent stepping away
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

  // ---- Hall of Records: leaderboard + message board --------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtTime(ms) {
    var s = Math.max(0, Math.round((ms || 0) / 1000)), m = (s / 60) | 0;
    return m + ':' + ('0' + (s % 60)).slice(-2);
  }
  function openBoards() {
    $('boardsName').value = NET.playerName();
    var note = $('boardsNote');
    if (!NET.configured()) {
      note.textContent = 'Online play isn’t configured (ludus/firebase-config.js), so the Hall is offline — names still save locally.';
      note.style.display = 'block';
    } else { note.style.display = 'none'; }
    $('boardsOverlay').classList.add('open');
    if (NET.configured()) {
      if (!unsubLeader) unsubLeader = NET.onResults(renderLeader);
      if (!unsubMsg) unsubMsg = NET.onMessages(renderMsgs);
    }
  }
  function closeBoards() {
    $('boardsOverlay').classList.remove('open');
    if (unsubLeader) { unsubLeader(); unsubLeader = null; }
    if (unsubMsg) { unsubMsg(); unsubMsg = null; }
  }
  function renderLeader(list) {
    var host = $('leaderList');
    if (!list || !list.length) { host.innerHTML = '<div style="color:var(--muted)">No games recorded yet — beat a foe to make your mark.</div>'; return; }
    host.innerHTML = list.map(function (r) {
      return '<div><b>' + esc(r.name || 'Challenger') + '</b> beat <b>' + esc(r.opponent || 'a foe') +
        '</b> <span style="color:#8fe39a">in ' + fmtTime(r.durationMs) + '</span></div>';
    }).join('');
  }
  function renderMsgs(list) {
    var host = $('msgList');
    if (!list || !list.length) { host.innerHTML = '<div style="color:var(--muted)">No messages yet — say hello.</div>'; return; }
    host.innerHTML = list.map(function (m) {
      return '<div><b style="color:#9fd0ff">' + esc(m.name || 'Anon') + ':</b> ' + esc(m.text) + '</div>';
    }).join('');
    host.scrollTop = host.scrollHeight;
  }
  function postMessage() {
    if (!NET.configured()) { alert('Online play is not configured yet (ludus/firebase-config.js), so the message board is offline.'); return; }
    var t = $('msgInput').value;
    if (!t.trim()) return;
    NET.postMessage(NET.playerName() || 'Anon', t);
    $('msgInput').value = '';
  }

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
    $('btnHints').onclick = function () {
      var on = $('btnHints').dataset.on !== '1';
      $('btnHints').dataset.on = on ? '1' : '0';
      $('btnHints').textContent = '◎ Moves: ' + (on ? 'On' : 'Off');
      ui.setShowMoves(on);
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

    // Hall of Records (leaderboard + message board)
    $('btnBoards').onclick = openBoards;
    $('btnBoardsClose').onclick = closeBoards;
    $('boardsSaveName').onclick = function () {
      NET.setPlayerName($('boardsName').value);
      $('boardsName').value = NET.playerName();
    };
    $('msgSend').onclick = postMessage;
    $('msgInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') postMessage(); });

    // overlay backdrop + Esc close
    document.querySelectorAll('.overlay').forEach(function (ov) {
      ov.addEventListener('click', function (e) { if (e.target === ov) ov.classList.remove('open'); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') document.querySelectorAll('.overlay.open').forEach(function (o) { o.classList.remove('open'); });
    });

    // device/browser back button: keep the user in the app (→ title), and give a
    // grace period to undo an accidental back-out of a live game.
    $('resumeBtn').onclick = resumeSession;
    window.addEventListener('popstate', function () {
      if (sessionActive) softLeaveToTitle();   // was in a game → title + Resume banner
      else showScreen('screenTitle', true);     // already out → just stay on the menu
    });

    if (!NET.configured()) $('btnCreate').title = $('btnJoin').title = 'Configure ludus/firebase-config.js to enable online play';

    // presence: announce ourselves and show the live online count
    if (NET.configured()) {
      NET.startPresence();
      NET.sweepStale(); // on load, prune rooms whose host is no longer online
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
