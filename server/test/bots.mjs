// Network test bots: play Nightloom over WebSocket against a running server,
// through the same input frames, prediction and mirror code as the browser
// (src/netcore.js), with the game's own planner choosing the keys.
// The bots join with {bot: true}, so the recordings mark their seats as test bots.
//
//   URL=ws://localhost:2567 node test/bots.mjs pair    [--shifts 0,1] [--delay-ms 200] [--swap]
//   URL=wss://...           node test/bots.mjs withbot [--shifts 0]   [--delay-ms 200] [--role flit]
//
// pair:    two test bots in one private room (the second joins by code).
// withbot: one test bot and the server-side bot seat.
// --delay-ms adds that much round trip to the FIRST bot (half on sends, half on receives).
// --swap swaps the roles before every shift after the first.
//   URL=ws://localhost:2567 ROBOT_PORT=2601 ROBOT_KEY=... node test/bots.mjs robot [--shifts 1] [--k 2]
// robot:   one test bot (Bramble) in a robot room; test/robot-client.mjs drives the Flit seat over the robot link.
import fs from 'node:fs';
import vm from 'node:vm';
import { Client } from '@colyseus/sdk';
import { runTestRobot } from './robot-client.mjs';

const URL_ = process.env.URL || 'ws://localhost:2567';
const args = process.argv.slice(2);
const mode = args[0] || 'pair';
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SHIFTS = String(opt('--shifts', '0')).split(',').map(Number);
const DELAY = Number(opt('--delay-ms', 0));
const SWAP = args.includes('--swap');
const ROLE = opt('--role', 'bramble');
const BOT_TYPE = opt('--bot-type', undefined);   // withbot: 'script' (default on a server with the scripts) or 'jorrit'
const STEP_MS = 1000 / 60;

const root = new URL('../../src/', import.meta.url);
const SRC = ['data.js', 'core.js', 'bot.js', 'netcore.js'].map((f) => fs.readFileSync(new URL(f, root), 'utf8')).join('\n');

function brain() {
  const ctx = vm.createContext({ console, Math, Int16Array, Int32Array, Set, Map, JSON, WeakMap });
  vm.runInContext(`${SRC}\nglobalThis.__net = {core: makeNetCore(), ap: makeAutopilot(), get S(){ return S; }};`, ctx);
  return ctx.__net;
}

function addDelay(room, ms) {
  if (!ms) return;
  const tr = room.connection.transport;
  const send = tr.send.bind(tr);
  tr.send = (data) => { const copy = Uint8Array.from(data); setTimeout(() => send(copy), ms / 2); };
  const ev = tr.events;
  const onmessage = ev.onmessage;
  ev.onmessage = (e) => setTimeout(() => onmessage(e), ms / 2);
}

async function firstPatch(room) {
  for (let i = 0; i < 200 && !(room.state && room.state.players && room.state.players.size); i++) await new Promise((r) => setTimeout(r, 25));
}

function runBot(name, room, { delayMs = 0, onEnded }) {
  const b = brain();
  const core = b.core, ap = b.ap;
  const input = room.input();
  const stats = { sent: 0, presses: 0, episodes: [] };
  let key = '', t0 = 0, steps = 0, intent = '';
  room.onMessage('net:ping', (m) => room.send('net:pong', { n: m.n, pending: core.pending.length }));
  room.onMessage('evt:episode_end', (m) => { stats.episodes.push(m); onEnded && onEnded(m); });
  room.onMessage('*', () => {});
  room.onStateChange((st) => {
    const k = `${st.seed}:${st.shift}:${st.episode}`;
    if ((st.phase === 'countdown' || st.phase === 'playing') && k !== key && st.seed) {
      key = k; core.begin(st, room.sessionId); ap.reset();
    }
    if (core.started) core.mirror(st, performance.now());
    if (st.phase === 'playing' && !t0) { t0 = performance.now(); steps = 0; }
    if (st.phase !== 'playing') t0 = 0;
  });
  addDelay(room, delayMs);
  const timer = setInterval(() => {
    if (!t0 || room.state.phase !== 'playing') return;
    const due = Math.floor((performance.now() - t0) / STEP_MS);
    let n = 0;
    while (steps < due && n++ < 6) {
      steps++;
      const me = core.me();
      const out = ap.step(me, core.pressAcked());
      const fetch = (ap.task && ap.task.fetch) || '';
      if (fetch !== intent) { intent = fetch; room.send('intent', { fetch }); }
      if (out.press) { core.press(out.press); stats.presses++; }
      if (process.env.DEBUG && steps % 60 === 0) console.log(`[${name}] t=${steps} me=${me ? me.kind + ' ' + me.x.toFixed(2) + ',' + me.y.toFixed(2) + ' f=' + me.fx.toFixed(1) + ',' + me.fy.toFixed(1) + ' held=' + (me.held ? me.held.kind : '-') : '-'} task=${ap.task ? ap.task.label + '/' + ap.task.action + ' pi=' + ap.pi + '/' + ap.task.path.length : '-'} cool=${ap.cool.toFixed(2)} acked=${core.pressAcked()} ack=${core.ack} lastPress=${core.lastPressSeq} out=${JSON.stringify(out)} pending=${core.pending.length}`);
      const f = core.frame({ x: out.x, y: out.y, act: out.act });
      input.data.x = f.x; input.data.y = f.y; input.data.act = f.act; input.data.pn = f.pn; input.data.pk = f.pk;
      const seq = input.send();
      core.sent(f, seq);
      stats.sent++;
    }
    if (steps < due) steps = due; // a stall longer than 6 steps: skip ahead, like the browser loop
  }, 4);
  return { name, room, core, stats, stop: () => clearInterval(timer) };
}

async function main() {
  const shifts = [...SHIFTS];
  const ca = new Client(URL_);
  const robotOpt = mode === 'robot' ? { k: Number(opt('--k', 2)) } : undefined;
  const a = await ca.create('night', { name: 'Test bot A', bot: true, controller: 'netcore-autopilot@1', private: true, role: mode === 'robot' ? 'bramble' : ROLE, withBot: mode === 'withbot', botType: BOT_TYPE, robot: robotOpt, shift: shifts[0] });
  await firstPatch(a);
  console.log(`room ${a.roomId} (${mode}), shifts ${shifts.join(',')}, delay ${DELAY} ms on A`);
  let b = null, robot = null;
  if (mode === 'robot') robot = runTestRobot({ port: Number(process.env.ROBOT_PORT), key: process.env.ROBOT_KEY, room: a.roomId, log: console.log });
  if (mode === 'pair') {
    const cb = new Client(URL_);
    b = await cb.joinById(a.roomId, { name: 'Test bot B', bot: true, controller: 'netcore-autopilot@1' });
    await firstPatch(b);
  }
  let done = 0;
  const bots = [];
  const finished = new Promise((resolve) => {
    const onEnded = (m) => {
      done++;
      console.log(`episode ${m.episode} ${m.outcome} (${m.reason}): score ${m.score}, delivered ${m.delivered}, missed ${m.missed}, nightmares ${m.nightmares}, lost ${m.lost}, moons ${m.moons}`);
      if (done >= shifts.length) { resolve(); return; }
      setTimeout(() => {
        a.send('shift', { shift: shifts[done] });
        if (SWAP) a.send('swap', {});
        setTimeout(() => { a.send('ready', { hints: false, comms: 'none' }); if (b) b.send('ready', { hints: false, comms: 'none' }); }, 300);
      }, 500);
    };
    bots.push(runBot('A', a, { delayMs: DELAY, onEnded }));
    if (b) bots.push(runBot('B', b, {}));
  });
  await new Promise((r) => setTimeout(r, 300));
  a.send('ready', { hints: false, comms: 'none' });
  if (b) b.send('ready', { hints: false, comms: 'none' });
  const t = setInterval(() => {
    const s = a.state;
    const pl = [];
    s.players.forEach((p) => pl.push(`${p.role}:${p.kind}:${p.x.toFixed(1)},${p.y.toFixed(1)}${p.held ? '[' + p.held + ']' : ''} ack=${p.ack} rtt=${p.rtt}`));
    console.log(`  t=${(s.tick / 60).toFixed(0)}s phase=${s.phase} score=${s.score} delivered=${s.delivered} ${pl.join(' | ')}`);
  }, 15000);
  await finished;
  clearInterval(t);
  for (const x of bots) { x.stop(); console.log(`bot ${x.name}: sent ${x.stats.sent} frames, ${x.stats.presses} presses`); }
  if (robot) { console.log(`robot: ${robot.stats.obs} observations, ${robot.stats.acts} messages, ${robot.stats.actions} uses`); robot.close(); }
  await a.leave(true).catch(() => {});
  if (b) await b.leave(true).catch(() => {});
  setTimeout(() => process.exit(0), 300);
}

main().catch((e) => { console.error(e); process.exit(1); });
