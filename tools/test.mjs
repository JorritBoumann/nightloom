// Headless tests: game rules, bot strength on every shift, and determinism.
// Usage: npm test
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../src/', import.meta.url);
const src = ['data.js','core.js','bot.js'].map(f => readFileSync(new URL(f, root), 'utf8')).join('\n');
function world() {
  const ctx = vm.createContext({console, Math, Int16Array, Int32Array, Set, Map, JSON});
  vm.runInContext(src + `
    globalThis.api = {
      start(l, seed){ newGame(l, {seed, countdown:0}); return S; },
      get S(){ return S; }, grab, actDown, update, makeBot, botStep, LEVELS, moonsFor, keyOf,
      at(p, x, y, fx, fy){ p.x = x + .5; p.y = y + .5; p.fx = fx; p.fy = fy; },
      run(sec, bots){ for (let i = 0; i < sec * 60 && !S.over; i++) { if (bots) for (const p of S.players) if (p.bot) botStep(p, 1/60); update(1/60); } },
      hash(){ return JSON.stringify([S.score, S.delivered, S.missed, S.players.map(p => [p.x.toFixed(4), p.y.toFixed(4), p.held && p.held.kind]), S.kettles.map(k => k.k.items.join()+k.k.state)]); }
    };`, ctx);
  return ctx.api;
}
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ' + name); };

test('a whole Flying dream goes from shelf to chute', () => {
  const G = world(); const S = G.start(0, 1);
  const [B, F] = S.players;
  G.at(F, 2, 1, 0, -1); G.grab(F); assert.equal(F.held.kind, 'star');
  G.at(B, 5, 1, 0, -1); G.grab(B); assert.equal(B.held.kind, 'wool');
  G.at(B, 6, 2, 0, 1); G.grab(B); assert.equal(S.grid[3][6].item.kind, 'wool');
  B.in.act = true; G.run(2.4); B.in.act = false;
  assert.equal(S.grid[3][6].item.kind, 'thread');
  G.grab(B);
  G.at(B, 8, 1, 0, -1); G.grab(B);
  const k = S.grid[0][8].k; assert.equal(k.state, 'filling');
  G.at(F, 8, 1, 0, -1); G.grab(F); assert.equal(k.state, 'brewing');
  G.run(6.1); assert.equal(k.state, 'ready');
  G.at(F, 12, 2, 1, 0); G.grab(F); assert.equal(F.held.jar, 'clean');
  G.at(F, 8, 1, 0, -1); G.grab(F); assert.equal(F.held.jar, 'dream');
  S.orders.push({id:'flying', life:80, left:80, uid:99});
  G.at(F, 12, 1, 0, -1); G.grab(F);
  assert.equal(F.held, null); assert.ok(S.score >= 20); assert.equal(S.delivered, 1);
});

test('Bramble cannot take stars and Flit cannot spin', () => {
  const G = world(); const S = G.start(0, 2); const [B, F] = S.players;
  G.at(B, 2, 1, 0, -1); G.grab(B); assert.equal(B.held, null);
  S.grid[3][6].item = {kind:'wool'};
  G.at(F, 6, 2, 0, 1); F.in.act = true; G.run(3); assert.equal(S.grid[3][6].item.kind, 'wool');
});

test('a ready kettle left too long becomes a nightmare and costs moonlight', () => {
  const G = world(); const S = G.start(0, 3); const [, F] = S.players;
  S.score = 30;
  G.at(F, 0 + 1, 2, -1, 0); G.grab(F); G.at(F, 10, 1, 0, -1); G.grab(F);
  G.at(F, 1, 2, -1, 0); G.grab(F); G.at(F, 10, 1, 0, -1); G.grab(F);
  // Seaside still needs a thread; add it directly
  S.grid[0][10].k.items.push('thread'); S.grid[0][10].k.state = 'brewing'; S.grid[0][10].k.need = 6;
  G.run(6.1 + 11.2);
  assert.equal(S.grid[0][10].k.state, 'nightmare'); assert.equal(S.score, 25);
  G.grab(F); assert.equal(S.grid[0][10].k.state, 'empty');
});

test('a wrong mix can be tipped out with the work key', () => {
  const G = world(); const S = G.start(0, 4); const [B] = S.players;
  const k = S.grid[0][8].k; k.items = ['star']; k.state = 'filling';
  G.at(B, 8, 1, 0, -1); G.actDown(B); assert.equal(k.state, 'empty');
});

test('a throw across the sky gap lands on the far counter, and Flit catches one in flight', () => {
  const G = world(); const S = G.start(1, 5); const [B, F] = S.players;
  G.at(F, 11, 6, 0, 1);
  B.held = {kind:'moondrop'}; G.at(B, 6, 4, 1, 0); G.actDown(B); G.run(1);
  const landed = S.grid[4].some(t => t.item && t.item.kind === 'moondrop');
  assert.ok(landed, 'moondrop landed somewhere on row 4');
  B.held = {kind:'wool'}; G.at(F, 10, 3, 0, 1); G.at(B, 6, 3, 1, 0); G.actDown(B); G.run(1);
  assert.equal(F.held && F.held.kind, 'wool');
});

test('Bramble cannot walk onto open sky, Flit can fly over it', () => {
  const G = world(); const S = G.start(1, 6); const [B, F] = S.players;
  G.at(B, 6, 1, 1, 0); B.in.x = 1; G.run(1); B.in.x = 0; assert.ok(B.x < 7);
  G.at(F, 9, 1, -1, 0); F.in.x = -1; G.run(.6); F.in.x = 0; assert.ok(F.x < 8);
});

test('the moonbeam bridge goes out but never under Bramble', () => {
  const G = world(); const S = G.start(3, 7); const [B] = S.players;
  G.at(B, 6, 3, 0, 1); G.run(9.5); assert.equal(S.bridgeOn, true);
  G.at(B, 6, 5, 0, 1); G.run(.6); assert.equal(S.bridgeOn, false);
});

test('the same seed replays the same shift', () => {
  const run = () => { const G = world(); const S = G.start(3, 777); for (const p of S.players) G.makeBot(p); G.run(90, true); return G.hash(); };
  assert.equal(run(), run());
});

test('two bots earn at least one moon on every shift', () => {
  for (let l = 0; l < 5; l++) {
    const G = world(); const S = G.start(l, 2024 + l); for (const p of S.players) G.makeBot(p);
    G.run(400, true);
    assert.ok(G.moonsFor(S.score, S.L) >= 1, `${S.L.name}: ${S.score}`);
  }
});

console.log(`\n${passed} tests passed`);
