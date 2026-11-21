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
//
// Robot seat (robot task section 1.6, for the live test): a seat with
// controller 'robot' is driven by an outside process. Flit's player is a proxy:
// it stands at the gripper position; a use or tip puts it on a walkable
// neighbor of the target cell, turns it to the cell and calls grab() or
// actDown(), then puts it back; a wash holds the work key at the basin during
// update(); a catch happens only while the robot receives (S.lab.receiving in a
// core with that LAB line, or else by blocking the catch for one update).
// The clock step is a start option: dt = 1/(60 k).
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
  let DT = 1 / 60;
  const RECV_BLOCK = {kind: 'lab:not-receiving'};   // fills Flit's hands for one update(): no catch
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

  let seats = null, labCore = false, robotPos = [null, null];
  function start(shift, seed, seatList, opts) {
    DT = opts && opts.dt ? opts.dt : 1 / 60;
    labCore = !!(opts && opts.labCore);
    newGame(shift, {seed, countdown: 0});
    // count the random draws, so a keyframe can say where the generator stands
    const r = S.rand; randN = 0; S.rand = () => { randN++; return r(); };
    ids = new WeakMap(); nextId = 0;
    seats = seatList.map((s) => ({...s}));
    for (let i = 0; i < S.players.length; i++) {
      const p = S.players[i], s = seats[i];
      p.tag = ''; p.hint = '';
      if (s.controller === 'bot') makeBot(p, s.react !== undefined ? {react: s.react} : {});
      else if (s.controller !== 'robot') p.actName = 'Shift'; // the say texts name the key as in solo mode; no rule changes
    }
    events = []; fx = [];
    return info();
  }

  function info() {
    return {shift: S.lvl, id: S.L.id, name: S.L.name, seed: S.seed, rows: S.rows, cols: S.cols, map: S.L.map,
      legend: CH, dreams: S.L.dreams.map((id) => ({id, items: DREAMS[id].items})), time: S.L.time, moons: S.L.moons,
      p1: S.L.p1, p2: S.L.p2, wind: S.L.wind || null, bridge: S.L.bridge || null};
  }

  // Robot seat: the walkable neighbor of a cell where the proxy stands to use it
  // (nearest to the gripper; ties in the order of bot.js DIRS4), and its facing.
  function standFor(cx, cy, p, gx, gy) {
    let best = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const sx = cx - dx, sy = cy - dy;
      if (!walkable(tileAt(sx, sy), p.kind)) continue;
      const d = Math.hypot(sx + .5 - gx, sy + .5 - gy);
      if (!best || d < best.d) best = {sx, sy, dx, dy, d};
    }
    return best;
  }
  // 'u8,0;t10,0' = use cell (8,0), then tip the kettle at (10,0); 'l' = lose the held item
  const robotActions = (pr) => String(pr || '').split(';').filter(Boolean).map((a) => {
    const [x, y] = a.slice(1).split(',').map(Number);
    return {verb: a[0], x, y};
  });

  // inputs[i]: {x, y, act, pr} for a human seat, null for a bot seat,
  // {x, y, pr, work: [cx, cy] | null, receive} for a robot seat
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
    // robot seats: uses and tips at their cells, in order
    for (let i = 0; i < S.players.length; i++) {
      if (seats[i].controller !== 'robot') continue;
      const inp = inputs[i] || {x: S.players[i].x, y: S.players[i].y, pr: '', work: null, receive: false};
      const p = S.players[i];
      for (const a of robotActions(inp.pr)) {
        if (a.verb === 'l') {
          // a physical drop that the rules count as lost: lose() of core.js, at the gripper
          if (!p.held) { ev({name: 'robot_reject', actor: i, verb: 'lose', cell: null}); continue; }
          const it = p.held; p.held = null; via[i] = 'lose';
          lose(it, inp.x, inp.y);
          ev({name: 'robot_action', actor: i, verb: 'lose', cell: null, item: code(it), id: iid(it)});
          continue;
        }
        const st = standFor(a.x, a.y, p, inp.x, inp.y);
        if (!st || (a.verb !== 'u' && a.verb !== 't')) { ev({name: 'robot_reject', actor: i, verb: a.verb, cell: {x: a.x, y: a.y}}); continue; }
        p.x = st.sx + .5; p.y = st.sy + .5; p.fx = st.dx; p.fy = st.dy;
        curActor = i;
        const pre = p.held;
        if (a.verb === 'u') grab(p); else actDown(p);
        if (p.held !== pre) via[i] = a.verb === 'u' ? 'grab' : 'act';
        ev({name: 'robot_action', actor: i, verb: a.verb === 'u' ? 'use' : 'tip', cell: {x: a.x, y: a.y}, stand: {x: st.sx, y: st.sy}});
      }
      p.x = inp.x; p.y = inp.y;
    }
    for (let i = 0; i < S.players.length; i++) {
      const inp = inputs[i];
      if (seats[i].controller === 'bot') continue;
      const p = S.players[i];
      if (seats[i].controller === 'robot') { p.in.x = 0; p.in.y = 0; p.in.act = !!(inp && inp.work); continue; }
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
    // robot seats during update(): at the basin while washing; no catch unless receiving
    const restore = [];
    for (let i = 0; i < S.players.length; i++) {
      if (seats[i].controller !== 'robot') continue;
      const inp = inputs[i] || {}, p = S.players[i];
      if (inp.work) {
        const st = standFor(inp.work[0], inp.work[1], p, p.x, p.y);
        if (st) { p.x = st.sx + .5; p.y = st.sy + .5; p.fx = st.dx; p.fy = st.dy; } else p.in.act = false;
      }
      if (labCore) { S.lab = S.lab || {}; S.lab.receiving = !!inp.receive; }
      else if (!inp.receive && !p.held && !inp.work) { p.held = RECV_BLOCK; }
      restore.push([p, inp]);
    }
    phase = 'update';
    update(DT);
    phase = 'idle';
    for (const [p, inp] of restore) {
      if (p.held === RECV_BLOCK) p.held = null;
      if (inp.x !== undefined) { p.x = inp.x; p.y = inp.y; }
    }
    const after = snap();
    heldDiff(mid, after, ['catch', 'catch']);
    worldDiff(before, after);
    const applied = S.players.map((p, i) => seats[i].controller === 'robot'
      ? [inputs[i] ? inputs[i].x : p.x, inputs[i] ? inputs[i].y : p.y, p.in.act ? 1 : 0, (inputs[i] && inputs[i].pr) || '']
      : [p.in.x, p.in.y, p.in.act ? 1 : 0, seats[i].controller === 'bot' ? (botPress[i] || '') : ((inputs[i] && inputs[i].pr) || '')]);
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

  /** seats: [{role:'bramble', controller:'human'|'bot'|'robot', react?}, {role:'flit', ...}] in actor order.
   * opts.dt: the clock step (1/60, or 1/(60 k) for a robot room). opts.labCore: the core has the
   * S.lab.receiving line of the robot task (otherwise a robot catch is blocked for one update instead). */
  start(shift, seed, seats, opts = {}) {
    if (seats.length !== 2 || seats[0].role !== 'bramble' || seats[1].role !== 'flit') throw new Error('seats must be [bramble, flit]');
    if (!seats.every((s) => ['human', 'bot', 'robot'].includes(s.controller))) throw new Error('controller must be human, bot or robot');
    this.seats = seats;
    this.started = true;
    this.dt = opts.dt || 1 / 60;
    return this.api.start(shift, seed >>> 0, seats, { dt: this.dt, labCore: !!opts.labCore || /S\.lab\b/.test(this.source.text) });
  }

  step(inputs) { return this.api.step(inputs); }
  hashes() { return this.api.hashes(); }
  full() { return this.api.full(); }
  summary() { return this.api.summary(); }
  info() { return this.api.info(); }
  get S() { return this.api.S; }
  /** The game's static tables (CH, DREAMS, LEVELS), as an observation rule needs them. */
  get G() { return (this._G ??= { CH: this.api.CH, DREAMS: this.api.DREAMS, LEVELS: this.api.LEVELS }); }
  get tick() { return this.api.tick; }
  get over() { return this.api.over; }
}

/** Plain-data copy of a value made in the VM context (its arrays and objects have another prototype). */
export function plain(v) { return JSON.parse(JSON.stringify(v)); }
