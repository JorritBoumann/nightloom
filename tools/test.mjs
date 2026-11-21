// Headless tests: game rules, bot strength on every shift, and determinism.
// Usage: npm test
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { SimWorld, HASH_EVERY, KEYFRAME_EVERY, simSource } from '../online/sim.mjs';
import { convert } from './convert.mjs';

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

// ---- online play: a recorded round must replay exactly from the seed and the inputs ----
function recordRound(shift, seed, seats, steps, inputAt, opts = {}) {
  const w = new SimWorld();
  w.start(shift, seed, seats, opts);
  const info = JSON.parse(JSON.stringify(w.info()));
  const L = [{ type: 'header', schema: 'nightloom-online-v1', game: 'nightloom', version: 'test', room: 'TEST', episode: 1, seed,
    shift: { index: shift, id: info.id, name: info.name }, tick_hz: 60, dt: opts.dt || 1 / 60, core_sha256: simSource().sha256, build: { sim_sha256: simSource().sha256 },
    seats: seats.map((s, i) => ({ seat: i, actor: i, role: s.role, kind: s.controller === 'bot' ? 'server-bot' : s.controller === 'robot' ? 'robot' : 'human',
      controller: s.controller === 'bot' ? 'bot:test' : s.controller === 'robot' ? 'robot:test' : 'human',
      replay: s.controller === 'bot' ? 'bot.js' : s.controller === 'robot' ? 'robot' : 'inputs', player_id: s.controller === 'human' ? 'TEST0000' : null })) }];
  const J = (o) => JSON.parse(JSON.stringify(o));
  L.push({ type: 'keyframe', t: 0, state: J(w.full()) }, { type: 'hash', t: 0, ...w.hashes() });
  for (let t = 1; t <= steps && !w.over; t++) {
    const inputs = seats.map((s, i) => s.controller === 'bot' ? null : inputAt(t, i, w));
    const r = w.step(inputs);
    L.push({ type: 'step', t, in: r.applied.map((a, i) => seats[i].controller === 'robot'
      ? [...J(a), 'R', 0, null, null, null, inputs[i].work || null, !!inputs[i].receive]
      : [...J(a), seats[i].controller === 'bot' ? 'b' : 'f']) });
    for (const e of r.events) L.push({ type: 'event', t, ...J(e) });
    if (t % HASH_EVERY === 0) L.push({ type: 'hash', t, ...w.hashes() });
    if (t % KEYFRAME_EVERY === 0) L.push({ type: 'keyframe', t, state: J(w.full()) });
    if (t % 60 === 0) seats.forEach((s, i) => { if (s.controller !== 'bot') L.push({ type: 'net', t, kind: 'input', actor: i }); });
  }
  const sum = J(w.summary());
  L.push({ type: 'summary', outcome: sum.over ? 'success' : 'abandon', reason: sum.over ? 'time_up' : 'left', ...sum });
  return L;
}
// a person-like input stream: keys change every few steps, presses now and then, sometimes two in one step
function keys(seed) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let held = { x: 0, y: 0, act: false };
  return (t) => {
    if (t % 9 === 0) held = { x: [-1, 0, 1][Math.floor(rnd() * 3)], y: [-1, 0, 1][Math.floor(rnd() * 3)], act: rnd() < .2 };
    const p = rnd();
    const pr = p < .03 ? 'g' : p < .045 ? 'a' : p < .05 ? 'ga' : '';
    return { ...held, x: held.x * (rnd() < .1 ? .73 : 1), pr };
  };
}

test('an online round with a person and a bot replays exactly (hashes, keyframes, events, bot inputs)', () => {
  const k = keys(7);
  const L = recordRound(4, 99, [{ role: 'bramble', controller: 'human' }, { role: 'flit', controller: 'bot' }], 1500, (t) => k(t));
  const r = convert(L);
  for (const c of r.checks) assert.ok(c.ok, `${c.id}: ${c.detail}`);
  assert.ok(r.events > 20, 'events recorded');
});

test('two people on Midnight replay exactly to the end of the shift', () => {
  const k0 = keys(11), k1 = keys(12);
  const L = recordRound(1, 4242, [{ role: 'bramble', controller: 'human' }, { role: 'flit', controller: 'human' }], 1e6, (t, i) => (i ? k1 : k0)(t));
  const r = convert(L);
  for (const c of r.checks) assert.ok(c.ok, `${c.id}: ${c.detail}`);
  assert.equal(r.steps, 165 * 60);
});

test('one changed input is caught by the replay check', () => {
  const k = keys(3);
  const L = recordRound(0, 5, [{ role: 'bramble', controller: 'human' }, { role: 'flit', controller: 'bot' }], 900, (t) => k(t));
  const step = L.find((l) => l.type === 'step' && l.t === 300);
  step.in[0][0] = step.in[0][0] === 1 ? -1 : 1;   // flip one movement value
  const r = convert(L);
  assert.ok(!r.ok, 'a tampered recording must fail');
  assert.ok(r.checks.some((c) => !c.ok && (c.id === 'every_hash_matches' || c.id === 'events_replay')));
});

test('a robot seat (Flit) takes a star and fills a kettle at half speed, and the round replays exactly', () => {
  // Midnight: star shelf (10,0), kettle (5,3). The gripper moves in straight lines; uses happen at cells.
  const k = keys(21);
  const plan = { 30: 'u10,0', 240: 'u5,3', 420: 'u10,0', 600: 'u5,4' };
  let gx = 11.5, gy = 1.5;
  const L = recordRound(1, 777, [{ role: 'bramble', controller: 'human' }, { role: 'flit', controller: 'robot' }], 1200, (t, i) => {
    if (i === 0) return k(t);
    gx += (t < 240 ? -0.02 : 0); gy += (t > 400 && t < 500 ? 0.01 : 0);
    return { x: gx, y: gy, pr: plan[t] || '', work: null, receive: t > 900 };
  }, { dt: 1 / 120 });
  const r = convert(L);
  for (const c of r.checks) assert.ok(c.ok, `${c.id}: ${c.detail}`);
  const ev = L.filter((l) => l.type === 'event');
  assert.equal(ev.filter((e) => e.name === 'robot_action').length, 4);
  assert.ok(ev.some((e) => e.name === 'kettle' && e.items.includes('star')), 'the robot put a star into a kettle');
  const last = L.filter((l) => l.type === 'keyframe').pop();
  assert.ok(Math.abs(last.state.timeLeft - (165 - last.t / 120)) < 1e-6, `game time runs at half speed (timeLeft ${last.state.timeLeft} at step ${last.t})`);
});

console.log(`\n${passed} tests passed`);
