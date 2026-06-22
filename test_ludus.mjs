// node ludus/test_ludus.mjs — smoke-test the Ludus engine + AI under Node.
import fs from 'fs';
import vm from 'vm';
const ctx = { window: {}, Math: Math, JSON: JSON };
vm.createContext(ctx);
for (const f of ['engine.js', 'ai.js']) {
  vm.runInContext(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8'), ctx, { filename: f });
}
const E = ctx.window.Ludus, AI = ctx.window.LudusAI;
let pass = 0, fail = 0;
function ok(name, cond) { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('FAIL  ' + name)); }

const s0 = E.initialState();
ok('48 pieces total', s0.pieces.length === 48);
ok('24 per side', s0.pieces.filter(p => p.color === 'white').length === 24);
ok('one FL each', s0.pieces.filter(p => p.type === 'FL').length === 2);
ok('one Cursor + one Steadholder each', s0.pieces.filter(p => p.type === 'CU').length === 2 && s0.pieces.filter(p => p.type === 'SH').length === 2);
ok('white moves first', s0.turn === 'white');

const acts = E.legalActions(s0);
ok('white has opening actions', acts.length > 0);
console.log('  opening action count:', acts.length);

// sky mapping sanity
const sg = E.skyToGround(0, 0); ok('sky(0,0)->ground(3,3)', sg.r === 3 && sg.c === 3);
ok('underSky(3,3) true', E.underSky(3, 3) === true);
ok('underSky(0,0) false', E.underSky(0, 0) === false);

// determinism of applyAction (no mutation of input)
const before = JSON.stringify(s0);
E.applyAction(s0, acts[0]);
ok('applyAction does not mutate input', JSON.stringify(s0) === before);

// play a full random-vs-random game, ensure it terminates with a winner or move cap
let s = E.initialState(), moves = 0;
while (!s.winner && moves < 2000) {
  const a = AI.chooseAction(s, s.turn, 'easy');
  if (!a) break;
  s = E.applyAction(s, a);
  moves++;
}
ok('random game terminates', moves < 2000);
console.log('  random game length:', moves, 'winner:', s.winner);

// medium beats easy more often than not over a few games (sanity, not strict)
let medWins = 0, games = 6;
for (let g = 0; g < games; g++) {
  let st = E.initialState(), m = 0;
  const medColor = g % 2 === 0 ? 'white' : 'black';
  while (!st.winner && m < 1500) {
    const diff = st.turn === medColor ? 'medium' : 'easy';
    const a = AI.chooseAction(st, st.turn, diff);
    if (!a) break; st = E.applyAction(st, a); m++;
  }
  if (st.winner === medColor) medWins++;
}
console.log('  medium vs easy: medium won', medWins + '/' + games);
ok('medium wins majority vs easy', medWins >= games / 2);

// hard picks a move on the opening within reasonable time
const t0 = Date.now();
const hardMove = AI.chooseAction(E.initialState(), 'white', 'hard');
console.log('  hard opening move chosen in', (Date.now() - t0) + 'ms');
ok('hard returns a move', !!hardMove);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
