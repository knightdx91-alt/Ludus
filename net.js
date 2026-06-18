/* ludus/net.js — Firebase Realtime DB rooms for online 2-player Ludus.
 * Global: window.LudusNet. Loads the Firebase compat SDK lazily from CDN the
 * first time online mode is used, so local/bot play has zero network cost.
 *
 * Room shape under rooms/{id}: { state, players:{white,black}, updated }
 * Sync model: each client applies its own action locally then writes the full
 * engine state; both clients listen and re-render. Color is claimed via a
 * transaction to avoid races. No server code required.
 */
(function () {
  'use strict';
  var SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var app = null, db = null, loading = null, authUid = null;

  function configured() {
    var c = window.LUDUS_FIREBASE_CONFIG;
    return !!(c && c.databaseURL && c.apiKey);
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src;
      s.onload = res; s.onerror = function () { rej(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function init() {
    if (db) return Promise.resolve(db);
    if (!configured()) return Promise.reject(new Error('Firebase not configured — edit ludus/firebase-config.js'));
    if (loading) return loading;
    loading = loadScript(SDK + 'firebase-app-compat.js')
      .then(function () { return loadScript(SDK + 'firebase-database-compat.js'); })
      .then(function () { return loadScript(SDK + 'firebase-auth-compat.js'); })
      .then(function () {
        app = window.firebase.initializeApp(window.LUDUS_FIREBASE_CONFIG);
        db = window.firebase.database();
        // Anonymous auth gives each player a Firebase-verified uid, so the DB
        // rules can restrict room writes to the two seated players (spectators
        // stay read-only). If auth is unavailable or not enabled in the console,
        // we fall back to the localStorage client id and play still works.
        if (window.firebase.auth) {
          return window.firebase.auth().signInAnonymously()
            .then(function (cred) {
              var u = (cred && cred.user) || window.firebase.auth().currentUser;
              authUid = (u && u.uid) || null;
              return db;
            })
            .catch(function () { return db; });
        }
        return db;
      });
    return loading;
  }

  // Stable per-player identity. Prefers the Firebase-verified anonymous uid
  // (so seats/presence are enforceable by DB rules); falls back to a random
  // localStorage id when auth is unavailable.
  function clientId() {
    if (authUid) return authUid;
    var k = 'ludus_client_id', v = localStorage.getItem(k);
    if (!v) { v = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(k, v); }
    return v;
  }

  function randomRoomId() {
    var s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', o = '';
    for (var i = 0; i < 5; i++) o += s[(Math.random() * s.length) | 0];
    return o;
  }

  // ---- onDisconnect cleanup --------------------------------------------
  // Firebase fires these server-side when a socket drops, so a closed/refreshed
  // tab tidies up after itself instead of leaving a room advertised forever.
  // All guarded so the test mock / a missing SDK degrade gracefully.
  function odOf(path) {
    if (!db) return null;
    var r = db.ref(path);
    return (r && typeof r.onDisconnect === 'function') ? r.onDisconnect() : null;
  }
  function odRemove(path) { var od = odOf(path); if (od && od.remove) od.remove(); }
  function odCancel(path) { var od = odOf(path); if (od && od.cancel) od.cancel(); }

  // Create a room as `white`. Returns {roomId, color, ref}.
  // opts.public !== false → the room is advertised in the open-games lobby
  // via a lightweight lobby/{id} index entry (no game state — that stays under
  // rooms/{id}, which the rules only allow reading one room at a time).
  function createRoom(initialState, opts) {
    opts = opts || {};
    return init().then(function () {
      var id = randomRoomId(), ref = db.ref('rooms/' + id), pub = opts.public !== false;
      return ref.set({
        state: initialState,
        players: { white: clientId(), black: null },
        public: pub,
        created: Date.now(),
        updated: Date.now()
      }).then(function () {
        // Advertise to the lobby, but never let a denied/failed lobby write
        // break room creation — the room itself (joinable by code) still works.
        if (pub) return db.ref('lobby/' + id).set({ open: true, full: false, host: clientId(), updated: Date.now() }).catch(function () {});
      }).then(function () {
        // While the host waits alone, a dropped socket should delete the whole
        // room AND its lobby ad — otherwise an abandoned, never-played room
        // lingers in the open-games list looking "in progress". armGame() (called
        // once an opponent joins) swaps this for seat-only cleanup.
        odRemove('rooms/' + id);
        if (pub) odRemove('lobby/' + id);
        return { roomId: id, color: 'white', ref: ref };
      });
    });
  }

  // Reflect a room's seat status into its lobby entry (if it has one — private
  // rooms don't). Removes the entry when the room is gone.
  function syncLobby(id, players) {
    var ref = db.ref('lobby/' + id);
    return ref.once('value').then(function (snap) {
      if (!snap.exists()) return; // private room, or already cleaned up
      if (!players) return ref.remove();
      var full = isFull(players);
      return ref.update({ open: !full, full: full, updated: Date.now() });
    }).catch(function () {});
  }

  // Join an existing room, claiming a free color (prefers black). Returns {roomId,color,ref}.
  // NOTE: a transaction's handler is first invoked with the client's local (often
  // null) estimate; returning undefined there ABORTS with no server retry. So we
  // read the room once first — that confirms it exists, primes the cache, and lets
  // us seed the transaction from the snapshot so a transient null never aborts it.
  function joinRoom(id) {
    id = (id || '').trim().toUpperCase();
    return init().then(function () {
      var ref = db.ref('rooms/' + id), me = clientId();
      return ref.once('value').then(function (snap) {
        if (!snap.exists()) throw new Error('room not found');
        var known = (snap.val() && snap.val().players) || null;
        return ref.child('players').transaction(function (players) {
          if (players === null) players = known ? { white: known.white || null, black: known.black || null } : { white: null, black: null };
          if (players.white === me || players.black === me) return players; // rejoin
          if (!players.black) { players.black = me; return players; }
          if (!players.white) { players.white = me; return players; }
          return; // genuinely full -> abort
        }).then(function (res) {
          if (!res.committed) throw new Error('room is full');
          var players = res.snapshot.val();
          var color = players.white === me ? 'white' : (players.black === me ? 'black' : null);
          if (!color) throw new Error('room is full');
          return syncLobby(id, players).then(function () { return { roomId: id, color: color, ref: ref }; });
        });
      });
    });
  }

  // Call once a game is actually under way (both seats taken). A mid-game drop
  // should only vacate that player's own seat — never destroy a live match — so
  // we cancel the host's whole-room remove and arm a seat-level remove instead.
  // The lobby ad (a full game) is still cleared on disconnect.
  function armGame(ref, color) {
    if (!ref) return;
    var id = ref.key;
    odCancel('rooms/' + id);                 // don't nuke a live game on a blip
    odRemove('rooms/' + id + '/players/' + color);
    odRemove('lobby/' + id);
  }

  // Watch a room without claiming a seat (spectator). Returns {roomId, ref}.
  function spectate(id) {
    id = (id || '').trim().toUpperCase();
    return init().then(function () {
      var ref = db.ref('rooms/' + id);
      return ref.child('state').once('value').then(function (snap) {
        if (!snap.exists()) throw new Error('room not found');
        return { roomId: id, ref: ref };
      });
    });
  }

  // ---- presence: a live count of connected clients ---------------------
  // Each client writes presence/{clientId} while connected and clears it on
  // disconnect (handled server-side by onDisconnect, so closed tabs/dropped
  // networks are cleaned up automatically).
  function startPresence() {
    return init().then(function () {
      var ref = db.ref('presence/' + clientId());
      db.ref('.info/connected').on('value', function (snap) {
        if (snap.val() === true) { ref.onDisconnect().remove(); ref.set(Date.now()); }
      });
    }).catch(function () {});
  }

  // Subscribe to the online-client count. cb(n). Returns unsubscribe fn.
  function onOnlineCount(cb) {
    var ref = null;
    init().then(function () {
      ref = db.ref('presence');
      ref.on('value', function (snap) { cb(snap.numChildren()); });
    }).catch(function () {});
    return function () { if (ref) try { ref.off('value'); } catch (e) {} };
  }

  // ---- lobby: the list of public rooms ---------------------------------
  // Reads the lobby/ index (publicly readable) rather than rooms/ (which the
  // rules only allow reading one room at a time). cb(rooms[]) where each entry
  // is {id, host, open, full, updated}.
  function onRooms(cb) {
    var ref = null;
    init().then(function () {
      ref = db.ref('lobby');
      ref.on('value', function (snap) {
        var out = [];
        snap.forEach(function (child) {
          var r = child.val() || {};
          out.push({
            id: child.key, host: r.host || null,
            open: !!r.open, full: !!r.full, updated: r.updated || 0
          });
        });
        out.sort(function (a, b) { return b.updated - a.updated; });
        cb(out);
      });
    }).catch(function () {});
    return function () { if (ref) try { ref.off('value'); } catch (e) {} };
  }

  // Subscribe to state changes. cb(state). Returns unsubscribe fn.
  function onState(ref, cb) {
    var handler = ref.child('state').on('value', function (snap) { var v = snap.val(); if (v) cb(v); });
    return function () { ref.child('state').off('value', handler); };
  }

  function pushState(ref, state) { return ref.update({ state: state, updated: Date.now() }); }

  // Subscribe to the players node. cb(players|null). Returns unsubscribe fn.
  function onPlayers(ref, cb) {
    var handler = ref.child('players').on('value', function (snap) { cb(snap.val()); });
    return function () { ref.child('players').off('value', handler); };
  }

  // Both seats filled?
  function isFull(players) { return !!(players && players.white && players.black); }

  // Cancel/leave a room. If we're the last one out, delete the whole room
  // (so abandoned rooms — including their state — don't linger in the DB).
  function leaveRoom(ref) {
    if (!ref) return Promise.resolve();
    var me = clientId(), id = ref.key;
    odCancel('rooms/' + id); odCancel('rooms/' + id + '/players/white');
    odCancel('rooms/' + id + '/players/black'); odCancel('lobby/' + id);
    return ref.once('value').then(function (snap) {
      if (!snap.exists()) return;
      return ref.transaction(function (room) {
        if (room === null) room = snap.val(); // seed from snapshot on a cold-cache pass
        var players = room.players || {};
        if (players.white === me) players.white = null;
        if (players.black === me) players.black = null;
        if (!players.white && !players.black) return null; // empty -> remove whole room
        room.players = players;
        return room;
      }).then(function (res) {
        var room = res.snapshot.val();
        return syncLobby(id, room ? (room.players || null) : null); // delete or update the lobby entry
      });
    }).then(function () {}).catch(function () {});
  }

  window.LudusNet = {
    configured: configured, clientId: clientId,
    createRoom: createRoom, joinRoom: joinRoom, spectate: spectate,
    onState: onState, pushState: pushState,
    onPlayers: onPlayers, isFull: isFull, leaveRoom: leaveRoom, armGame: armGame,
    startPresence: startPresence, onOnlineCount: onOnlineCount, onRooms: onRooms
  };
})();
