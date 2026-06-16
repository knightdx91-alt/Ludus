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
  var app = null, db = null, loading = null;

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
      .then(function () {
        app = window.firebase.initializeApp(window.LUDUS_FIREBASE_CONFIG);
        db = window.firebase.database();
        return db;
      });
    return loading;
  }

  function clientId() {
    var k = 'ludus_client_id', v = localStorage.getItem(k);
    if (!v) { v = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(k, v); }
    return v;
  }

  function randomRoomId() {
    var s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', o = '';
    for (var i = 0; i < 5; i++) o += s[(Math.random() * s.length) | 0];
    return o;
  }

  // Create a room as `white`. Returns {roomId, color, ref}.
  function createRoom(initialState) {
    return init().then(function () {
      var id = randomRoomId(), ref = db.ref('rooms/' + id);
      return ref.set({
        state: initialState,
        players: { white: clientId(), black: null },
        updated: Date.now()
      }).then(function () { return { roomId: id, color: 'white', ref: ref }; });
    });
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
          return { roomId: id, color: color, ref: ref };
        });
      });
    });
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
    var me = clientId();
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
      });
    }).then(function () {}).catch(function () {});
  }

  window.LudusNet = {
    configured: configured, clientId: clientId,
    createRoom: createRoom, joinRoom: joinRoom, onState: onState, pushState: pushState,
    onPlayers: onPlayers, isFull: isFull, leaveRoom: leaveRoom
  };
})();
