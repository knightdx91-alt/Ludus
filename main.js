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
    { id: 'kord', name: 'Kord', faction: 'Alera', difficulty: 'easy', blurb: 'A brutal slaver — crude, aggressive, and utterly without finesse.' },
    { id: 'bittan', name: 'Bittan', faction: 'Alera', difficulty: 'easy', blurb: 'Kord\'s cowardly son — he lunges wildly, then loses his nerve.' },
    { id: 'brencis', name: 'Brencis Minoris', faction: 'Alera', difficulty: 'easy', blurb: 'An arrogant young lordling — overconfident and reckless, he leaves himself open.' },
    { id: 'frederic', name: 'Frederic', faction: 'Alera', difficulty: 'easy', blurb: 'An earnest young steadholder — brave but green, with simple, honest play.' },
    { id: 'amara', name: 'Amara', faction: 'Alera', difficulty: 'medium', blurb: 'A Cursor on the wing — swift, daring, and always probing for an opening.' },
    { id: 'ehren', name: 'Ehren ex Cursori', faction: 'Alera', difficulty: 'medium', blurb: 'A Cursor\'s careful, clever calculation. Misses little.' },
    { id: 'kitai', name: 'Kitai', faction: 'Alera', difficulty: 'medium', blurb: 'Marat-sharp and endlessly adaptable to your plans.' },
    { id: 'bernard', name: 'Bernard', faction: 'Alera', difficulty: 'medium', blurb: 'A steadholder\'s patience — disciplined, defensive, every piece supporting the next.' },
    { id: 'araris', name: 'Araris Valerian', faction: 'Alera', difficulty: 'medium', blurb: 'The peerless blade. Flawless defense, and he guards his lord above all.' },
    { id: 'miles', name: 'Sir Miles', faction: 'Alera', difficulty: 'medium', blurb: 'A Legion captain — disciplined and defensive, every piece supporting the next.' },
    { id: 'crassus', name: 'Antillus Crassus', faction: 'Alera', difficulty: 'medium', blurb: 'A young Knight Commander and gifted flier — balanced, and quick to seize the skies.' },
    { id: 'isana', name: 'Isana', faction: 'Alera', difficulty: 'medium', blurb: 'A watercrafter\'s patience — protective and deeply defensive; hard to break through.' },
    { id: 'navaris', name: 'Phrygiar Navaris', faction: 'Alera', difficulty: 'hard', blurb: 'A relentless killer who hunts pieces without mercy or caution.' },
    { id: 'marcus', name: 'Valiar Marcus', faction: 'Alera', difficulty: 'hard', blurb: 'A veteran First Spear and double-agent — patient, pragmatic, and impossible to bait.' },
    { id: 'tavi', name: 'Tavi', faction: 'Alera', difficulty: 'hard', blurb: 'The finest Ludus mind in the Realm. He sees the endgame from the first move.' },
    { id: 'attis', name: 'Aquitainus Attis', faction: 'Alera', difficulty: 'hard', blurb: 'High Lord Aquitaine — a bold, brilliant commander who seizes the skies and presses hard.' },
    { id: 'invidia', name: 'Invidia Aquitaine', faction: 'Alera', difficulty: 'hard', blurb: 'Cold and patient. She sets traps and lets your own ambition undo you.' },
    { id: 'gaius', name: 'Gaius Sextus', faction: 'Alera', difficulty: 'hard', blurb: 'The old First Lord — he wins by sacrifice and misdirection, and never stops hunting your king.' },
    { id: 'doroga', name: 'Doroga', faction: 'Marat', difficulty: 'medium', blurb: 'A Marat headman\'s straightforward might — he comes straight at you, heedless of his own safety.' },
    { id: 'hashat', name: 'Hashat', faction: 'Marat', difficulty: 'medium', blurb: 'A Horse-clan headman — swift and mobile, striking like cavalry and wheeling away.' },
    { id: 'nasaug', name: 'Nasaug', faction: 'Canim', difficulty: 'medium', blurb: 'A Canim battlemaster who never wastes a move.' },
    { id: 'varg', name: 'Warmaster Varg', faction: 'Canim', difficulty: 'hard', blurb: 'Patient, disciplined, and utterly relentless once committed.' },
    { id: 'queen', name: 'The Vord Queen', faction: 'Vord', difficulty: 'hard', blurb: 'Cold, inhuman calculation. She studies you as you play.' }
  ];
  var FACTIONS = ['Alera', 'Marat', 'Canim', 'Vord'];
  var DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

  var ui, state, mode = null;            // 'bot' | 'hotseat' | 'online'
  var humanColors = {};
  var difficulty = 'medium', aiColor = 'black';
  var currentOpponent = null, currentSide = 'white';
  var net = null, unsub = null, unsubPlayers = null, applying = false, unsubRooms = null;
  var unsubAway = null, awayTimer = null, awayUntil = 0;
  var castRef = null, casting = false;              // broadcasting a local game for spectators
  var gameStart = 0, gameRecorded = false;          // for the Hall of Records
  var unsubLeader = null, unsubMsg = null, clockTimer = null;

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
    stopBroadcast(true);
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
      // Alera (the largest group) starts open; the rest collapse to cut clutter.
      if (fac !== 'Alera') g.classList.add('collapsed');
      var h = document.createElement('h3');
      h.innerHTML = '<span class="caret">▼</span><span>' + fac + '</span>' +
        '<span class="count">' + inFac.length + '</span>';
      h.onclick = function () { g.classList.toggle('collapsed'); };
      g.appendChild(h);
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
    if (side === 'random') side = Math.random() < 0.5 ? 'white' : 'black';
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
    stopBroadcast(true); // a new game ends any broadcast from the previous one
    net = null; mode = m; humanColors = hc;
    state = E.initialState();
    $('oppLabel').innerHTML = label;
    $('roomBox').style.display = 'none';
    $('btnFlip').dataset.p = perspective;
    ui.setPerspective(perspective);
    ui.clearSelection();
    gameStart = Date.now(); gameRecorded = false;
    startClock();
    showScreen('screenGame');
    updateWatchUI();
    loop();
  }

  // ---- in-game clock: elapsed time since the game began ----------------
  function startClock() {
    stopClock();
    var el = $('gameClock'); if (el) el.style.display = '';
    updateClock();
    clockTimer = setInterval(updateClock, 1000);
  }
  function updateClock() {
    var el = $('gameClock'); if (el && gameStart) el.textContent = '⏱ ' + fmtTime(Date.now() - gameStart);
  }
  function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }

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

  // ---- broadcast a local (bot / pass-and-play) game for spectators ------
  // Opt-in: the player presses "Let others watch", which mirrors the local
  // board into a spectate-only room and keeps it in sync on every move.
  function broadcastLabel() {
    var me = NET.playerName() || 'A challenger';
    if (mode === 'bot') return me + ' vs ' + (currentOpponent ? currentOpponent.name : 'the bot');
    if (mode === 'hotseat') return me + ' — pass & play';
    return me + "'s game";
  }
  function startBroadcast() {
    if (casting || !NET.configured()) return;
    var btn = $('btnWatch'); if (btn) { btn.disabled = true; btn.textContent = '📡 Starting…'; }
    NET.createBroadcast(state, broadcastLabel()).then(function (room) {
      castRef = room.ref; casting = true;
      updateWatchUI();
    }).catch(function () {
      casting = false; castRef = null; updateWatchUI();
      if (btn) btn.disabled = false;
      alert('Could not start sharing — check your connection / Firebase rules.');
    });
  }
  function stopBroadcast(silent) {
    casting = false;
    var ref = castRef; castRef = null;
    if (ref) NET.leaveRoom(ref); // deletes the spectate-only room (no other occupants)
    if (!silent) updateWatchUI();
  }
  function syncBroadcast() {
    if (casting && castRef) NET.pushState(castRef, state).catch(function () {});
  }
  function updateWatchUI() {
    var btn = $('btnWatch'); if (!btn) return;
    // Only offer sharing for local games you control, when online is configured.
    var canShare = NET.configured() && (mode === 'bot' || mode === 'hotseat') && !(state && state.winner);
    btn.style.display = canShare || casting ? '' : 'none';
    btn.disabled = false;
    if (casting) {
      btn.textContent = '📡 Sharing — room ' + (castRef ? castRef.key : '') + ' · Stop';
      btn.title = 'Others can watch via the lobby. Click to stop sharing.';
    } else {
      btn.textContent = '📡 Let others watch';
      btn.title = 'Publish this game so others can watch it live from the lobby';
    }
  }

  function loop() {
    syncBroadcast();
    ui.render(state);
    if (state.winner) {
      var youWin = humanColors[state.winner];
      updateClock(); stopClock();   // freeze the clock at the final time
      recordResult();
      if (mode === 'spectate') setStatus(state.winner.toUpperCase() + ' wins — captured the First Lord.');
      else setStatus((mode === 'hotseat' ? state.winner.toUpperCase() + ' wins' : (youWin ? 'Victory — you' : 'Defeat — your foe') + ' captured the First Lord') + '.');
      ui.setInteractive(false);
      updateWatchUI(); // the final board is pushed (above); switch button to "Stop"
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
      var what = r.broadcast ? (r.label ? esc(r.label) : 'Bot game') + ' · <span class="rj">Watch ›</span>'
                             : 'In progress · <span class="rj">Watch ›</span>';
      row(r, what, function () { stopRooms(); spectateOnline(r.id); });
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
    stopClock(); var ck = $('gameClock'); if (ck) ck.style.display = 'none'; // not your game
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
    gameStart = Date.now(); gameRecorded = false; startClock();
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
      if (!unsubLeader) unsubLeader = NET.onResults(renderLeader, 25, boardsError);
      if (!unsubMsg) unsubMsg = NET.onMessages(renderMsgs, 50, boardsError);
    }
  }
  // Show why the Hall can't read/write — almost always missing DB rules.
  function boardsError(err) {
    var note = $('boardsNote'), msg = (err && err.message) || String(err);
    if (/permission|denied/i.test(msg)) msg = 'the Realtime Database rules don’t allow it yet — publish the results/ and messages/ rules from LUDUS.md in your Firebase console.';
    note.textContent = 'Hall unavailable: ' + msg;
    note.style.display = 'block';
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
    var note = $('boardsNote');
    note.style.display = 'block'; note.style.color = ''; note.textContent = 'Posting…';
    NET.postMessage(NET.playerName() || 'Anon', t).then(function () {
      $('msgInput').value = '';
      note.style.color = '#8fe39a'; note.textContent = 'Posted ✓';
      setTimeout(function () { if (note.textContent === 'Posted ✓') { note.style.display = 'none'; note.style.color = ''; } }, 2500);
    }).catch(boardsError);
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
      stopClock();
      stopBroadcast(true);
      if (mode === 'online') leaveOnline(); else teardownNet();
      $('roomBox').style.display = 'none';
      showScreen('screenTitle');
    };
    $('btnWatch').onclick = function () { if (casting) stopBroadcast(); else startBroadcast(); };
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

    // floating options cog: toggles the menu of less-used controls; closes after
    // a choice or an outside click.
    var optMenu = $('optionsMenu'), optCog = $('btnOptions');
    function closeOptions() { optMenu.classList.remove('open'); optCog.classList.remove('open'); }
    optCog.onclick = function (e) {
      e.stopPropagation();
      var open = !optMenu.classList.contains('open');
      optMenu.classList.toggle('open', open); optCog.classList.toggle('open', open);
    };
    optMenu.addEventListener('click', function (e) { if (e.target.closest('button')) closeOptions(); });
    document.addEventListener('click', function (e) {
      if (optMenu.classList.contains('open') && !optMenu.contains(e.target) && e.target !== optCog) closeOptions();
    });

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

      // Click the count to expand a roster of who's online (names people picked
      // for the leaderboard; unnamed clients show as "Anonymous"). Anyone who is
      // sharing a game (a broadcast room they host) gets a Watch button so you
      // can jump straight into spectating from here.
      var online = [], casts = {};   // casts: hostId -> broadcast room id
      var renderRoster = function () {
        var list = $('onlineList');
        if (!list) return;
        if (!online.length) { list.innerHTML = '<div style="padding:4px 14px;color:#7d8a93">No one online</div>'; return; }
        var me = NET.clientId();
        list.innerHTML = online.map(function (p) {
          var name = (p.name || '').trim() || 'Anonymous';
          name = name.replace(/[<>&]/g, '');                 // basic escaping
          var mine = p.id === me ? ' <span style="color:#7d8a93">(you)</span>' : '';
          // Offer Watch when this person is broadcasting (but not for yourself —
          // you're already in your own game).
          var room = p.id !== me ? casts[p.id] : null;
          var watch = room
            ? '<button class="ghost" data-watch="' + room + '" title="Watch this player\'s game" '
              + 'style="margin-left:8px;padding:1px 8px;font-size:11px">📡 Watch</button>'
            : '';
          return '<div style="padding:4px 14px;white-space:nowrap;display:flex;align-items:center;justify-content:space-between;gap:8px">'
            + '<span>● ' + name + mine + '</span>' + watch + '</div>';
        }).join('');
      };
      NET.onOnline(function (list) {
        online = list.slice().sort(function (a, b) { return (a.name || '~').localeCompare(b.name || '~'); });
        if ($('onlineList').style.display !== 'none') renderRoster();
      });
      // Track live broadcasts so the roster knows who's watchable.
      NET.onRooms(function (rooms) {
        casts = {};
        rooms.forEach(function (r) { if (r.broadcast && r.host) casts[r.host] = r.id; });
        if ($('onlineList').style.display !== 'none') renderRoster();
      });
      // Clicking a roster Watch button jumps into spectating that game.
      $('onlineList').addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-watch]');
        if (!b) return;
        $('onlineList').style.display = 'none';
        stopRooms();                     // close the lobby feed if it was open
        spectateOnline(b.getAttribute('data-watch'));
      });
      $('onlineCount').onclick = function () {
        var list = $('onlineList');
        if (list.style.display === 'none') { renderRoster(); list.style.display = ''; }
        else list.style.display = 'none';
      };
      // Close the roster when clicking elsewhere.
      document.addEventListener('click', function (e) {
        var list = $('onlineList'), badge = $('onlineCount');
        if (list && list.style.display !== 'none' && e.target !== badge && !list.contains(e.target)) list.style.display = 'none';
      });
    }

    showScreen('screenTitle');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
