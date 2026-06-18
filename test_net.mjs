// node ludus/test_net.mjs — verify the online room handshake in net.js
// against a faithful in-memory mock of the Firebase compat Realtime DB.
// Two independent clients (own contexts/clientIds) share one backend, so this
// exercises createRoom -> onPlayers(not full) -> joinRoom -> onPlayers(full).
import fs from 'fs';
import vm from 'vm';

const NET_SRC = fs.readFileSync(new URL('./net.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond) { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('FAIL  ' + name)); }
function deep(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

// ---- shared in-memory Firebase Realtime DB backend ----------------------
function makeStore() {
  const root = {};
  const listeners = []; // {path, cb}
  const onDisc = []; // pending onDisconnect ops {path, val}; applied on "disconnect"
  const primed = []; // paths read via once() — their subtree is "cached" locally
  function isCached(path) { return primed.some(function (p) { return path === p || path.startsWith(p + '/'); }); }
  function getNode(path, create) {
    const segs = path.split('/').filter(Boolean);
    let n = root;
    for (let i = 0; i < segs.length; i++) {
      if (n[segs[i]] == null) { if (!create) return undefined; n[segs[i]] = {}; }
      n = n[segs[i]];
    }
    return n;
  }
  function setNode(path, val) {
    const segs = path.split('/').filter(Boolean);
    if (!segs.length) return;
    let n = root;
    for (let i = 0; i < segs.length - 1; i++) { if (n[segs[i]] == null) n[segs[i]] = {}; n = n[segs[i]]; }
    if (val === null || val === undefined) delete n[segs[segs.length - 1]];
    else n[segs[segs.length - 1]] = deep(val);
  }
  function valAt(path) { const n = getNode(path, false); return n === undefined ? null : deep(n); }
  function snapOf(path) {
    return {
      val: function () { return valAt(path); },
      exists: function () { return valAt(path) !== null; },
      key: path.split('/').filter(Boolean).pop() || null,
      numChildren: function () { const v = valAt(path); return v && typeof v === 'object' ? Object.keys(v).length : 0; },
      forEach: function (cb) { const v = valAt(path); if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { cb(snapOf(path + '/' + k)); }); }
    };
  }
  function notify(path) {
    listeners.forEach(function (l) {
      if (l.path === path || path.startsWith(l.path + '/') || l.path.startsWith(path + '/'))
        l.cb(snapOf(l.path));
    });
  }
  function ref(path) {
    return {
      _path: path,
      key: path.split('/').filter(Boolean).pop() || null,
      child: function (p) { return ref(path + '/' + p); },
      set: function (val) { setNode(path, val); notify(path); return Promise.resolve(); },
      remove: function () { setNode(path, null); notify(path); return Promise.resolve(); },
      update: function (obj) { Object.keys(obj).forEach(function (k) { setNode(path + '/' + k, obj[k]); }); notify(path); return Promise.resolve(); },
      once: function () { primed.push(path); return Promise.resolve(snapOf(path)); },
      transaction: function (fn) {
        // Faithful to Firebase: the handler is first called with the LOCAL estimate,
        // which is null for an uncached path. Returning undefined aborts with NO
        // server retry. Only an already-cached (once'd) path sees the real value first.
        const firstVal = isCached(path) ? valAt(path) : null;
        const out = fn(firstVal);
        if (out === undefined) { const cur = valAt(path); return Promise.resolve({ committed: false, snapshot: { val: function () { return cur; }, exists: function () { return cur !== null; } } }); }
        setNode(path, out); notify(path);
        return Promise.resolve({ committed: true, snapshot: { val: function () { return valAt(path); }, exists: function () { return valAt(path) !== null; } } });
      },
      onDisconnect: function () {
        return {
          remove: function () { onDisc.push({ path: path, val: null }); return Promise.resolve(); },
          set: function (v) { onDisc.push({ path: path, val: v }); return Promise.resolve(); },
          cancel: function () { for (let i = onDisc.length - 1; i >= 0; i--) if (onDisc[i].path === path) onDisc.splice(i, 1); return Promise.resolve(); }
        };
      },
      on: function (_evt, cb) {
        const l = { path: path, cb: cb }; listeners.push(l);
        if (path === '.info/connected') cb({ val: function () { return true; } });
        else cb(snapOf(path));
        return cb;
      },
      off: function (_evt, handler) { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].cb === handler) listeners.splice(i, 1); }
    };
  }
  // Apply pending onDisconnect ops. Real Firebase fires only the dropped
  // client's rules, so an optional path prefix lets a test drop one client.
  function flushDisconnect(prefix) {
    for (let i = onDisc.length - 1; i >= 0; i--) {
      const op = onDisc[i];
      if (prefix && !(op.path === prefix || op.path.startsWith(prefix + '/'))) continue;
      onDisc.splice(i, 1); setNode(op.path, op.val); notify(op.path);
    }
  }
  return { ref: ref, _root: root, flushDisconnect: flushDisconnect };
}

// ---- spin up one net.js "client" bound to a shared backend ---------------
function makeClient(store) {
  const memLS = {};
  const localStorage = {
    getItem: function (k) { return k in memLS ? memLS[k] : null; },
    setItem: function (k, v) { memLS[k] = String(v); }
  };
  const document = {
    head: { appendChild: function (s) { queueMicrotask(function () { s.onload && s.onload(); }); } },
    createElement: function () { return {}; }
  };
  // Each client signs in anonymously to a distinct uid (as real Firebase would).
  const uid = 'uid_' + Math.random().toString(36).slice(2);
  const authObj = {
    currentUser: { uid: uid },
    signInAnonymously: function () { return Promise.resolve({ user: { uid: uid } }); }
  };
  const win = {
    LUDUS_FIREBASE_CONFIG: { apiKey: 'x', databaseURL: 'mock://db' },
    firebase: {
      initializeApp: function () { return {}; },
      database: function () { return { ref: store.ref }; },
      auth: function () { return authObj; }
    },
    _uid: uid
  };
  const ctx = {
    window: win, document: document, localStorage: localStorage,
    Math: Math, JSON: JSON, Date: Date, Promise: Promise,
    queueMicrotask: queueMicrotask, setTimeout: setTimeout, console: console
  };
  vm.createContext(ctx);
  vm.runInContext(NET_SRC, ctx, { filename: 'net.js' });
  return ctx.window.LudusNet;
}

const store = makeStore();
const A = makeClient(store); // host (white)
const B = makeClient(store); // joiner (black)

ok('configured() true with mock config', A.configured() === true);
ok('A and B have distinct client ids', A.clientId() !== B.clientId());

(async function () {
  // --- host creates a room ---
  const room = await A.createRoom({ demo: 'initial-state' });
  ok('createRoom returns a 5-char code', typeof room.roomId === 'string' && room.roomId.length === 5);
  ok('host is white', room.color === 'white');
  ok('seat keyed on the anonymous-auth uid', store._root.rooms[room.roomId].players.white === A.clientId() && /^uid_/.test(A.clientId()));

  // --- host watches seats; should NOT be full yet ---
  let hostSawFull = false, lastPlayers = null;
  const unsub = A.onPlayers(room.ref, function (players) {
    lastPlayers = players;
    if (A.isFull(players)) hostSawFull = true;
  });
  ok('lobby: seats not full before opponent joins', hostSawFull === false);
  ok('lobby: white seat occupied, black empty', !!(lastPlayers && lastPlayers.white && !lastPlayers.black));

  // --- joiner joins by code ---
  const joined = await B.joinRoom(room.roomId.toLowerCase()); // also tests case-normalisation
  ok('joiner gets black seat', joined.color === 'black');
  ok('joiner same room id', joined.roomId === room.roomId);

  // --- host's onPlayers must now have fired full -> auto-start trigger ---
  await Promise.resolve();
  ok('host auto-start: onPlayers saw room full', hostSawFull === true);
  ok('isFull true with both seats', A.isFull(lastPlayers) === true);
  unsub();

  // --- state sync: host pushes, joiner receives ---
  let joinerState = null;
  const unsubState = B.onState(joined.ref, function (s) { joinerState = s; });
  await A.pushState(room.ref, { move: 1, board: 'after-white-move' });
  await Promise.resolve();
  ok('joiner receives host state push', joinerState && joinerState.move === 1);
  unsubState();

  // --- a third client cannot take a full room ---
  const C = makeClient(store);
  let fullRejected = false;
  try { await C.joinRoom(room.roomId); } catch (e) { fullRejected = /full/i.test(e.message); }
  ok('third client rejected from full room', fullRejected === true);

  // --- joining a non-existent room fails cleanly ---
  let missingRejected = false;
  try { await B.joinRoom('ZZZZZ'); } catch (e) { missingRejected = /not found|full/i.test(e.message); }
  ok('join of unknown code rejected', missingRejected === true);

  // --- spectator can watch a live room without taking a seat ---
  let specState = null;
  const spec = await C.spectate(room.roomId);
  ok('spectate returns the room ref', spec.roomId === room.roomId);
  const unsubSpec = C.onState(spec.ref, function (s) { specState = s; });
  await A.pushState(room.ref, { move: 2, board: 'after-black-move' });
  await Promise.resolve();
  ok('spectator receives live state', specState && specState.move === 2);
  ok('spectate left both seats untouched', A.isFull(store._root.rooms[room.roomId].players) === true);
  unsubSpec();
  let specMissing = false;
  try { await C.spectate('ZZZZZ'); } catch (e) { specMissing = /not found/i.test(e.message); }
  ok('spectate of unknown room rejected', specMissing === true);

  // --- lobby listing: public rooms surface; private ones stay hidden ---
  let lobby = [];
  const unsubRooms = A.onRooms(function (rooms) { lobby = rooms; });
  await Promise.resolve();
  ok('onRooms lists the public room as full', lobby.some(function (r) { return r.id === room.roomId && r.full; }));
  ok('lobby index holds no game state', store._root.lobby[room.roomId].state === undefined);
  const priv = await B.createRoom({ demo: 'x' }, { public: false });
  await Promise.resolve();
  ok('onRooms hides the private room', !lobby.some(function (r) { return r.id === priv.roomId; }));
  ok('private room writes no lobby entry', !store._root.lobby[priv.roomId]);
  unsubRooms();
  await B.leaveRoom(priv.ref);

  // --- presence: count reflects connected clients ---
  let count = 0;
  const unsubCount = A.onOnlineCount(function (n) { count = n; });
  await A.startPresence();
  await B.startPresence();
  await Promise.resolve();
  ok('online count tracks present clients', count >= 2);
  unsubCount();

  // --- leaveRoom by both empties (deletes) the room ---
  await A.leaveRoom(room.ref);
  await B.leaveRoom(joined.ref);
  ok('room deleted after both leave', store._root.rooms == null || store._root.rooms[room.roomId] == null);
  ok('lobby entry removed after both leave', store._root.lobby == null || store._root.lobby[room.roomId] == null);

  // --- ghost cleanup: a host who abandons the lobby (closes/refreshes the tab)
  //     must not leave the room advertised as an open/in-progress game ---
  const ghost = await A.createRoom({ demo: 'lobby' });
  ok('abandoned room + lobby ad exist before disconnect',
    !!store._root.rooms[ghost.roomId] && !!store._root.lobby[ghost.roomId]);
  store.flushDisconnect(); // host's socket drops
  ok('abandoned room removed on host disconnect', store._root.rooms[ghost.roomId] == null);
  ok('abandoned lobby ad removed on host disconnect', store._root.lobby[ghost.roomId] == null);

  // --- a live game survives one player's disconnect: only that seat vacates,
  //     and the match is NOT destroyed ---
  const live = await A.createRoom({ demo: 'live' });
  const liveB = await B.joinRoom(live.roomId);
  A.armGame(live.ref, 'white');   // both clients arm seat-only cleanup on entry
  B.armGame(liveB.ref, 'black');
  store.flushDisconnect('rooms/' + live.roomId + '/players/white'); // white's tab drops
  ok('live room survives one player disconnect', !!store._root.rooms[live.roomId]);
  ok('disconnected player\'s seat is vacated', store._root.rooms[live.roomId].players.white == null);
  ok('remaining player keeps their seat', store._root.rooms[live.roomId].players.black === B.clientId());

  // --- stale-room sweep: on load, prune rooms whose host is no longer present.
  //     (A and B announced presence earlier; D never does, so D is "offline".) ---
  const D = makeClient(store);
  const aband = await D.createRoom({ demo: 'sweep' });
  store._root.lobby[aband.roomId].updated = Date.now() - 60000; // age past the grace window
  await A.sweepStale();
  ok('sweep removes the abandoned lobby ad', store._root.lobby[aband.roomId] == null);
  ok('sweep removes the abandoned open room', store._root.rooms[aband.roomId] == null);

  // a room whose host IS still online must survive the sweep
  await A.startPresence(); // re-announce (an earlier disconnect-flush cleared it)
  const keep = await A.createRoom({ demo: 'keep' });
  store._root.lobby[keep.roomId].updated = Date.now() - 60000;
  await B.sweepStale();
  ok('sweep keeps a room whose host is still online', !!store._root.lobby[keep.roomId]);

  // a brand-new room (within the grace window) is never swept, even host-offline
  const fresh = await D.createRoom({ demo: 'fresh' });
  await A.sweepStale();
  ok('sweep spares a just-created room (grace window)', !!store._root.lobby[fresh.roomId]);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
