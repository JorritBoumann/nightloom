// Shared driver for online play and replay.
//
// The server, the recording converter and the tests all run the game through
// this file, so a recording replays with exactly the code that made it.
// It loads the unchanged src/data.js, src/core.js and src/bot.js into one
// isolated VM context per world (core.js keeps the game in a global `S`), and
// runs one fixed step of 1/60 s at a time in a fixed order:
//
//   1. presses of the human seats, Bramble first, in the order they were made
//      ('g' = grab or place, 'a' = the work key: spin, wash, throw, dash)
//   2. held input {x, y, act} of the human seats
//   3. botStep() for the bot seats, Bramble first
//   4. update(1/60)
//
// This is the order of the offline game loop in src/ui.js: key presses run
// between steps, then applyHumanInput(), then the bots, then update().
// The game rules are not touched. The driver only reads the state and listens
// on the HOOK callbacks that core.js already calls.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

export const TICK_HZ = 60;
export const STEP = 1 / TICK_HZ;
export const HASH_EVERY = 60;        // one state hash per second, as tools/traces.mjs
export const KEYFRAME_EVERY = 600;   // one full keyframe every 10 s
export const SIM_FILES = ['data.js', 'core.js', 'bot.js'];
export const ROLES = ['bramble', 'flit'];

/** The simulation source as one text, with its SHA-256 (goes into every recording header). */
export function simSource(srcDir = new URL('../src/', import.meta.url)) {
  const text = SIM_FILES.map((f) => fs.readFileSync(new URL(f, srcDir), 'utf8')).join('\n');
  return { text, sha256: crypto.createHash('sha256').update(text).digest('hex') };
}

export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// Runs inside the VM context, after data.js, core.js and bot.js, so it sees
// their top-level bindings (S, HOOK, grab, actDown, update, makeBot, ...).
const DRIVER = String.raw`
globalThis.__nl = (function () {
  const DT = 1 / 60;
  let events = [], fx = [], pressed = [], phase = 'idle', curActor = -1;
  let randN = 0;
  let ids = new WeakMap(), nextId = 0;
  const iid = (it) => { if (!it) return 0; let v = ids.get(it); if (v === undefined) { v = ++nextId; ids.set(it, v); } return v; };
  // item codes: 'wool', 'jar:clean', 'jar:dream:thread+star' (contents in kettle order)
  const code = (it) => it ? (it.kind === 'jar' ? 'jar:' + it.jar + (it.contents ? ':' + it.contents.join('+') : '') : it.kind) : '';
  // the item format of nightloom-trace-v1 (contents sorted)
  const v1item = (it) => it ? (it.kind === 'jar' ? 'jar:' + it.jar + (it.contents ? ':' + it.contents.slice().sort().join('+') : '') : it.kind) : null;
  const tref = (t) => t ? {x: t.x, y: t.y, kind: t.type} : null;
  const ev = (o) => { o.tick = S.tick; events.push(o); };

  HOOK.event = (name, a, b, c) => {
    if (name === 'grab' || name === 'act') {
      const actor = S.players.indexOf(a);
      pressed.push({actor, action: name});
      pressTarget[actor] = tref(b);
      ev({name, actor, tile: tref(b)});
    } else if (name === 'decide') {
      if (b) ev({name: 'decision', actor: S.players.indexOf(a), options: c || [],
        pick: {label: b.label, action: b.action, tile: tref(b.tile), stand: {x: b.stand.sx, y: b.stand.sy}}});
    } else {
      ev({name, data: [a, b === undefined ? null : b]});
    }
  };
  // Cosmetic effects go to the clients as they are (sound, floating text, particles).
  HOOK.sfx = (n) => {
    fx.push(['sfx', n]);
    if (n === 'throw' && phase === 'press' && curActor >= 0) {
      const pr = S.projs[S.projs.length - 1];
      if (pr) ev({name: 'throw', actor: curActor, item: code(pr.item), id: iid(pr.item), x: pr.x, y: pr.y, dx: pr.dx, dy: pr.dy});
    }
    if (n === 'catch') { const f = S.players[1]; ev({name: 'catch', actor: 1, item: code(f.held), id: iid(f.held)}); }
  };
  HOOK.float = (text, x, y, col, size) => fx.push(['float', text, x, y, col, size]);
  HOOK.sparkle = (x, y, col, n) => fx.push(['sparkle', x, y, col, n]);
  HOOK.puff = (x, y, col) => fx.push(['puff', x, y, col]);
  HOOK.shake = (v) => fx.push(['shake', v]);
  HOOK.orders = () => {};
  HOOK.end = () => {};

  // ---- semantic snapshot, compared before and after a step ----
  function snap() {
    const tiles = [];
    for (const r of S.grid) for (const t of r) {
      if (t.type === 'void' || (t.type === 'floor' && !t.item)) continue;
      tiles.push(t);
    }
    return {
      held: S.players.map((p) => p.held),
      tiles: tiles.map((t) => [t, t.item, t.type === 'loom' && t.item ? t.item.kind : null, t.dirty, t.count, t.k ? t.k.state : null, t.k ? t.k.items.join('+') : null]),
      orders: new Set(S.orders.map((o) => o.uid)),
      projs: S.projs.slice(),
      bridgeOn: S.bridgeOn, wind: S.wind.phase, lost: S.lost,
    };
  }
  function heldDiff(a, b, via) {
    for (let i = 0; i < S.players.length; i++) {
      if (a.held[i] === b.held[i]) continue;
      const from = a.held[i], to = b.held[i];
      ev({name: 'held', actor: i, via: via[i] || 'press',
        from: from ? {id: iid(from), item: code(from)} : null, to: to ? {id: iid(to), item: code(to)} : null,
        tile: via[i] === 'grab' || via[i] === 'act' ? pressTarget[i] : null});
    }
  }
  function worldDiff(a, b) {
    const byTile = new Map(a.tiles.map((r) => [r[0], r]));
    for (const r of b.tiles) {
      const t = r[0], o = byTile.get(t);
      if (o && o[5] !== r[5]) ev({name: 'kettle', tile: tref(t), from: o[5], to: r[5], items: t.k.items.slice()});
      if (o && o[5] !== 'nightmare' && r[5] === 'nightmare') ev({name: 'nightmare', tile: tref(t)});
      if (o && o[2] === 'wool' && r[2] === 'thread') ev({name: 'spun', tile: tref(t), id: iid(t.item)});
      if (t.type === 'basin' && o && r[3] < o[3]) ev({name: 'washed', tile: tref(t), dirty: r[3]});
      if (t.type === 'return' && o && r[4] > o[4]) ev({name: 'jar_return', tile: tref(t), count: r[4]});
    }
    for (const o of S.orders) if (!a.orders.has(o.uid)) ev({name: 'order', dream: o.id, uid: o.uid, life: o.life});
    for (const pr of a.projs) {
      if (b.projs.includes(pr)) continue;
      const id = iid(pr.item);
      let result = 'used', at = null;
      if (S.players[1].held === pr.item) result = 'caught';
      else {
        for (const row of S.grid) for (const t of row) if (t.item === pr.item) { result = 'placed'; at = tref(t); }
        if (result === 'used' && b.lost > a.lost) result = 'lost';
      }
      ev({name: 'proj_end', id, item: code(pr.item), result, tile: at, x: pr.x, y: pr.y});
    }
    if (a.bridgeOn !== b.bridgeOn) ev({name: 'bridge', on: b.bridgeOn});
    if (a.wind !== b.wind) ev({name: 'wind', phase: b.wind, dir: S.wind.dir});
    if (b.lost > a.lost) ev({name: 'lost', count: b.lost - a.lost, total: b.lost});
  }
  let pressTarget = [null, null];
  // say() sets sayT to exactly 2.4 and only for a new text, so 2.4 after the
  // press phase means the game showed a new speech bubble in this step.
  function sayNew() {
    for (let i = 0; i < S.players.length; i++) if (S.players[i].sayT === 2.4) ev({name: 'say', actor: i, text: S.players[i].say});
  }

  let seats = null;
  function start(shift, seed, seatList) {
    newGame(shift, {seed, countdown: 0});
    // count the random draws, so a keyframe can say where the generator stands
    const r = S.rand; randN = 0; S.rand = () => { randN++; return r(); };
    ids = new WeakMap(); nextId = 0;
    seats = seatList.map((s) => ({...s}));
    for (let i = 0; i < S.players.length; i++) {
      const p = S.players[i], s = seats[i];
      p.tag = ''; p.hint = '';
      if (s.controller === 'bot') makeBot(p, s.react !== undefined ? {react: s.react} : {});
      else p.actName = 'Shift'; // the say texts name the key as in solo mode; no rule changes
    }
    events = []; fx = [];
    return info();
  }

  function info() {
    return {shift: S.lvl, id: S.L.id, name: S.L.name, seed: S.seed, rows: S.rows, cols: S.cols, map: S.L.map,
      legend: CH, dreams: S.L.dreams.map((id) => ({id, items: DREAMS[id].items})), time: S.L.time, moons: S.L.moons,
      p1: S.L.p1, p2: S.L.p2, wind: S.L.wind || null, bridge: S.L.bridge || null};
  }

  // inputs[i]: {x, y, act, pr} for a human seat, null for a bot seat
  function step(inputs) {
    events = []; fx = []; pressed = [];
    const before = snap();
    const via = [null, null];
    pressTarget = [null, null];
    phase = 'press';
    for (let i = 0; i < S.players.length; i++) {
      const inp = inputs[i];
      if (!inp || seats[i].controller === 'bot') continue;
      const p = S.players[i];
      for (const k of inp.pr || '') {
        curActor = i;
        const pre = p.held;
        if (k === 'g') grab(p); else if (k === 'a') actDown(p);
        if (p.held !== pre) via[i] = k === 'g' ? 'grab' : 'act';
      }
    }
    for (let i = 0; i < S.players.length; i++) {
      const inp = inputs[i];
      if (seats[i].controller === 'bot') continue;
      const p = S.players[i];
      p.in.x = inp ? inp.x : 0; p.in.y = inp ? inp.y : 0; p.in.act = inp ? !!inp.act : false;
    }
    const botPress = [];
    for (let i = 0; i < S.players.length; i++) {
      if (seats[i].controller !== 'bot') continue;
      const p = S.players[i];
      curActor = i;
      const pre = p.held, n0 = pressed.length;
      botStep(p, DT);
      botPress[i] = pressed.slice(n0).filter((q) => q.actor === i).map((q) => q.action === 'grab' ? 'g' : 'a').join('');
      if (p.held !== pre) via[i] = botPress[i].includes('g') ? 'grab' : 'act';
    }
    curActor = -1;
    const mid = snap();
    heldDiff(before, mid, via);
    sayNew();
    phase = 'update';
    update(DT);
    phase = 'idle';
    const after = snap();
    heldDiff(mid, after, ['catch', 'catch']);
    worldDiff(before, after);
    const applied = S.players.map((p, i) => [p.in.x, p.in.y, p.in.act ? 1 : 0,
      seats[i].controller === 'bot' ? (botPress[i] || '') : ((inputs[i] && inputs[i].pr) || '')]);
    return {tick: S.tick, over: S.over, events, fx, pressed: pressed.slice(), applied};
  }

  // ---- hashes and keyframes ----
  function hashV1Text() {
    const item = v1item;
    return JSON.stringify([S.tick, S.score, S.players.map((p) => [p.x, p.y, p.fx, p.fy, item(p.held)]),
      S.grid.map((r) => r.map((t) => [item(t.item), t.prog, t.count, t.dirty, t.k && [t.k.items, t.k.state, t.k.prog, t.k.grace]])),
      S.orders.map((o) => [o.id, o.left]), S.projs.map((q) => [q.x, q.y, item(q.item)]), S.bridgeOn, S.wind]);
  }
  function botState(b) {
    if (!b) return null;
    const t = b.task;
    return {task: t ? {label: t.label, action: t.action, tile: tref(t.tile), stand: {x: t.stand.sx, y: t.stand.sy, dx: t.stand.dx, dy: t.stand.dy}, path: t.path, fetch: t.fetch || null} : null,
      cool: b.cool, react: b.react, pi: b.pi, t: b.t, stuckT: b.stuckT, lx: b.lx, ly: b.ly};
  }
  function full() {
    return {
      tick: S.tick, clock: S.clock, randN, seed: S.seed, shift: S.lvl,
      score: S.score, delivered: S.delivered, missed: S.missed, nightmares: S.nightmares, lost: S.lost,
      streak: S.streak, bestStreak: S.bestStreak, timeLeft: S.timeLeft, spawnT: S.spawnT, lastDream: S.lastDream,
      uid: S.uid, over: S.over, bridgeOn: S.bridgeOn, bridgeT: S.bridgeT, wind: {dir: S.wind.dir, phase: S.wind.phase, t: S.wind.t},
      returnQ: S.returnQ.slice(),
      players: S.players.map((p) => ({kind: p.kind, x: p.x, y: p.y, fx: p.fx, fy: p.fy, held: code(p.held), heldId: iid(p.held),
        dashT: p.dashT, dashCd: p.dashCd, walk: p.walk, working: p.working, moving: p.moving, say: p.say, sayT: p.sayT,
        in: {x: p.in.x, y: p.in.y, act: p.in.act}, bot: botState(p.bot)})),
      tiles: S.grid.flatMap((r) => r.filter((t) => t.type !== 'void' && (t.type !== 'floor' || t.item)).map((t) => ({
        x: t.x, y: t.y, type: t.type, item: code(t.item), itemId: iid(t.item), prog: t.prog, count: t.count, dirty: t.dirty,
        k: t.k ? {items: t.k.items.slice(), state: t.k.state, prog: t.k.prog, need: t.k.need, grace: t.k.grace, warned: t.k.warned, strayAt: t.k.strayAt ?? null} : null}))),
      orders: S.orders.map((o) => ({id: o.id, uid: o.uid, life: o.life, left: o.left})),
      projs: S.projs.map((q) => ({id: iid(q.item), item: code(q.item), x: q.x, y: q.y, dx: q.dx, dy: q.dy, dist: q.dist, max: q.max,
        lx: q.lx, ly: q.ly, thrower: q.thrower, spin: q.spin})),
    };
  }
  function hashes() { return {fnv1a: (${fnv1a.toString()})(hashV1Text()), full: (${fnv1a.toString()})(JSON.stringify(full()))}; }

  function summary() {
    return {score: S.score, delivered: S.delivered, missed: S.missed, nightmares: S.nightmares, lost: S.lost,
      bestStreak: S.bestStreak, moons: moonsFor(S.score, S.L), ticks: S.tick, over: S.over};
  }

  return {start, step, hashes, full, summary, info,
    get S() { return S; }, get tick() { return S.tick; }, get over() { return S.over; }, get randN() { return randN; },
    code, iid, v1item, moonsFor: (s) => moonsFor(s, S.L), LEVELS, DREAMS, CH};
})();
`;

/** One isolated game world: its own VM context, so each room has its own global S. */
export class SimWorld {
  constructor(source = simSource()) {
    this.source = source;
    this.ctx = vm.createContext({ console, Math, Int16Array, Int32Array, Set, Map, JSON, WeakMap });
    vm.runInContext(`${source.text}\n${DRIVER}`, this.ctx, { filename: 'nightloom-sim.js' });
    this.api = this.ctx.__nl;
    this.started = false;
  }

  /** seats: [{role:'bramble', controller:'human'|'bot', react?}, {role:'flit', ...}] in actor order. */
  start(shift, seed, seats) {
    if (seats.length !== 2 || seats[0].role !== 'bramble' || seats[1].role !== 'flit') throw new Error('seats must be [bramble, flit]');
    this.seats = seats;
    this.started = true;
    return this.api.start(shift, seed >>> 0, seats);
  }

  step(inputs) { return this.api.step(inputs); }
  hashes() { return this.api.hashes(); }
  full() { return this.api.full(); }
  summary() { return this.api.summary(); }
  info() { return this.api.info(); }
  get S() { return this.api.S; }
  get tick() { return this.api.tick; }
  get over() { return this.api.over; }
}

/** Plain-data copy of a value made in the VM context (its arrays and objects have another prototype). */
export function plain(v) { return JSON.parse(JSON.stringify(v)); }
