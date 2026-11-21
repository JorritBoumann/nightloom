// Rebuilds online recordings in the headless game and checks them.
//
//   node tools/convert.mjs <recording.jsonl.gz | folder> [more ...] [--out <dir>] [--check-only] [--quiet] [--core <dir>]
//
// Input: "nightloom-online-v1" recordings (server/src/recording.js). For each
// episode it starts the game from the recorded seed, feeds the applied inputs of
// the human seats step by step, lets bot.js play the bot seats, and compares:
// every state hash, every keyframe, every event, the bot seats' inputs and the
// summary. Then it writes a "nightloom-trace-v2" file: the same lines as
// nightloom-trace-v1 (tools/traces.mjs) plus who controlled each actor, the
// player names, item ids and the network data, so later tools read one format
// for bot and human sessions.
//
// Exit code 1 when any check fails. A report goes to <out>/report.json.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { SimWorld, simSource, HASH_EVERY, plain } from '../online/sim.mjs';

const KEYMAP = { bramble: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'], flit: ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Enter', 'ShiftRight'] };
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const optv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = optv('--out', 'converted');
const CORE_DIR = optv('--core', '');   // a folder with data.js, core.js, bot.js (for example the robot rooms' pinned core)
const CHECK_ONLY = flag('--check-only');
const QUIET = flag('--quiet');
const inputs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--core');

function files(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).flatMap((f) => files(path.join(p, f))).filter((f) => /\.jsonl(\.gz)?$/.test(f));
}
function readLines(file) {
  let buf = fs.readFileSync(file);
  if (file.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  return buf.toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SOURCE = simSource();
const EXTRA = CORE_DIR ? simSource(new URL(`file://${path.resolve(CORE_DIR)}/`)) : null;
const sourceFor = (sha) => (EXTRA && EXTRA.sha256 === sha ? EXTRA : SOURCE);

export function convert(lines, { name = '', write = null } = {}) {
  const checks = [];
  const check = (id, ok, detail = '') => checks.push({ id, ok: !!ok, detail });
  const h = lines[0];
  check('header', h && h.type === 'header' && h.schema === 'nightloom-online-v1' && h.seats?.length === 2 && Number.isInteger(h.seed) && h.tick_hz === 60,
    h ? `${h.schema} room ${h.room} ep ${h.episode} shift ${h.shift?.id} seed ${h.seed}` : 'no header');
  if (!h || h.type !== 'header') return { checks, ok: false };
  const want = h.core_sha256 || h.build?.sim_sha256;
  const src = sourceFor(want);
  check('sim_source_matches', want === src.sha256, want === src.sha256 ? (src === SOURCE ? 'src/' : CORE_DIR) : `recorded ${want}, local ${src.sha256} (use --core <dir> for another core)`);
  const byType = (t) => lines.filter((l) => l.type === t);
  const steps = byType('step');
  const summary = lines[lines.length - 1];
  check('summary_present', summary.type === 'summary', summary.type);
  check('steps_contiguous', steps.every((s, i) => s.t === i + 1 && Array.isArray(s.in) && s.in.length === 2), `${steps.length} steps`);
  const human = h.seats.map((s) => s.replay === 'inputs');
  const robot = h.seats.map((s) => s.replay === 'robot');
  check('inputs_for_every_seat', steps.every((s) => s.in.every((a, i) => Array.isArray(a) && a.length >= 5
      && (!human[i] || ['f', 'r', 'i', 'n', 'd', 'S'].includes(a[4])) && (!robot[i] || a[4] === 'R'))),
    h.seats.map((s) => `${s.role}:${s.kind}/${s.replay}`).join(' '));

  // replay
  const w = new SimWorld(src);
  w.start(h.shift.index, h.seed, h.seats.map((s) => ({ role: s.role, controller: s.replay === 'bot.js' ? 'bot' : s.replay === 'robot' ? 'robot' : 'human', react: s.bot_react ?? undefined })),
    { dt: h.dt || 1 / 60, labCore: !!h.robot?.lab_core || /S\.lab\b/.test(src.text) });
  const recEvents = byType('event');
  const recHashes = new Map(byType('hash').map((x) => [x.t, x]));
  const recKeys = new Map(byType('keyframe').map((x) => [x.t, x.state]));
  const out = [];
  const put = (o) => out.push(JSON.stringify(o));
  const info = plain(w.info());
  const firstDevice = (actor) => { const d = lines.find((l) => l.type === 'net' && l.kind === 'device' && l.actor === actor); return d ? d.device : null; };
  put({
    type: 'header', schema: 'nightloom-trace-v2', game: 'nightloom', version: h.version, shift: info.id, shiftName: info.name, seed: h.seed,
    tickRate: 60, map: info.map, legend: info.legend, dreams: info.dreams,
    actors: h.seats.map((s) => ({ id: s.actor, kind: s.role, controller: s.controller, driver: s.replay, seat_kind: s.kind, player_id: s.player_id ?? null, bot_react: s.bot_react ?? null, script: s.script ?? null })),
    keyMap: KEYMAP,
    // robot task section 4.1 (session)
    source: 'online', game_commit: h.game_commit ?? null, core_sha256: h.core_sha256 ?? h.build?.sim_sha256, online_build: h.online_build ?? null,
    session_id: h.session_id ?? null, room_id: h.room_id ?? h.room, visit_id: h.visit_id ?? null, round_in_visit: h.round_in_visit ?? h.episode,
    started_at: h.started_at, tick_rate: 60, countdown_s: h.countdown_s ?? 3, dt: h.dt ?? 1 / 60, robot: h.robot ?? null,
    hints_shown: h.hints_shown ?? 'unknown', pair_formed_by: h.pair_formed_by ?? null, comms: h.comms ?? 'unknown',
    // robot task section 4.2 (each seat); names stay out of the play data
    seats: h.seats.map((s) => ({ seat: s.seat ?? s.actor, role: s.role, controller: s.controller, kind: s.kind, driver: s.replay, player_id: s.player_id ?? null,
      consent: s.consent ?? null, input_device: s.input_device ?? firstDevice(s.actor), client: s.client ?? null, audio_on: s.audio_on ?? 'unknown',
      music_on: s.music_on ?? 'unknown', rounds_before: s.rounds_before ?? null, self_rating: s.self_rating ?? null, comms: s.comms ?? null, hints: s.hints ?? null,
      bot_react: s.bot_react ?? null, script: s.script ?? null })),
    build: h.build, step_order: h.step_order, input_rules: h.input_rules, consent_notice: h.consent_notice ?? h.consent ?? null,
    level: { time: info.time, moons: info.moons, p1: info.p1, p2: info.p2, wind: info.wind, bridge: info.bridge, hints: h.level?.hints ?? null },
    recording: name,
  });
  let hashBad = 0, hashN = 0, keyBad = 0, keyN = 0, botBad = 0, firstBad = null;
  const gotEvents = [];
  const k0 = recKeys.get(0);
  if (k0 !== undefined) { keyN++; if (!same(k0, w.full())) { keyBad++; firstBad ??= 'keyframe t=0'; } }
  const h0 = recHashes.get(0);
  if (h0) { hashN++; const g = w.hashes(); if (g.fnv1a !== h0.fnv1a || g.full !== h0.full) { hashBad++; firstBad ??= 'hash t=0'; } }
  for (const s of steps) {
    const inp = s.in.map((a, i) => human[i] ? { x: a[0], y: a[1], act: !!a[2], pr: a[3] }
      : robot[i] ? { x: a[0], y: a[1], pr: a[3], work: a[9] || null, receive: !!a[10] } : null);
    const r = w.step(inp);
    for (let i = 0; i < 2; i++) {
      if (!same(r.applied[i], s.in[i].slice(0, 4))) { botBad++; firstBad ??= `input actor ${i} t=${s.t}`; }
    }
    for (const e of r.events) gotEvents.push({ type: 'event', t: s.t, ...plain(e) });
    const S = w.S;
    const src = s.in.map((a) => a[4]);
    put({
      type: 'tick', tick: S.tick, time: +(S.tick * (h.dt || 1 / 60)).toFixed(4), score: S.score,
      actors: S.players.map((p, i) => ({
        id: i, x: +p.x.toFixed(4), y: +p.y.toFixed(4), fx: +p.fx.toFixed(3), fy: +p.fy.toFixed(3),
        held: w.api.v1item(p.held), input: { x: p.in.x, y: p.in.y, act: p.in.act }, working: p.working, valid: true,
        held_id: w.api.iid(p.held), presses: r.applied[i][3], input_src: src[i], skipped: s.in[i][5] || 0,
        frame: s.in[i][6] ?? null, client_ms: s.in[i][7] ?? null, recv_ms: s.in[i][8] ?? null,
      })),
      pressed: plain(r.pressed), bridgeOn: S.bridgeOn,
      wind: S.L.wind ? S.wind.phase + (S.wind.phase === 'calm' ? '' : (S.wind.dir > 0 ? ':east' : ':west')) : null,
    });
    for (const e of r.events) {
      const pe = plain(e);
      if (pe.name === 'decision') { const { name: _n, ...rest } = pe; put({ type: 'decision', ...rest }); } else put({ type: 'event', ...pe });
    }
    const rh = recHashes.get(s.t);
    if (rh || S.tick % HASH_EVERY === 0) {
      const g = w.hashes();
      if (S.tick % HASH_EVERY === 0) put({ type: 'hash', tick: S.tick, fnv1a: g.fnv1a, full: g.full });
      if (rh) { hashN++; if (g.fnv1a !== rh.fnv1a || g.full !== rh.full) { hashBad++; firstBad ??= `hash t=${s.t}`; } }
    }
    const rk = recKeys.get(s.t);
    if (rk !== undefined) { keyN++; if (!same(rk, w.full())) { keyBad++; firstBad ??= `keyframe t=${s.t}`; } }
  }
  const expectHashes = Math.floor(steps.length / HASH_EVERY) + 1;
  check('every_hash_matches', hashBad === 0 && hashN === expectHashes, `${hashN - hashBad}/${hashN} match, ${expectHashes} expected${firstBad ? `, first difference: ${firstBad}` : ''}`);
  check('every_keyframe_matches', keyBad === 0 && keyN >= 1, `${keyN - keyBad}/${keyN}`);
  check('applied_inputs_replay', botBad === 0, `${botBad} differing step inputs (bot seats regenerate theirs)`);
  const recEv = recEvents.map(({ type, ...e }) => e);
  const gotEv = gotEvents.map(({ type, ...e }) => e);
  let evDiff = -1;
  for (let i = 0; i < Math.max(recEv.length, gotEv.length); i++) if (!same(recEv[i], gotEv[i])) { evDiff = i; break; }
  check('events_replay', evDiff < 0, evDiff < 0 ? `${recEv.length} events` : `first difference at #${evDiff}: rec ${JSON.stringify(recEv[evDiff])?.slice(0, 160)} got ${JSON.stringify(gotEv[evDiff])?.slice(0, 160)}`);
  const sum = plain(w.summary());
  const keys = ['score', 'delivered', 'missed', 'nightmares', 'lost', 'bestStreak', 'moons', 'ticks'];
  check('summary_matches', summary.type === 'summary' && keys.every((k) => summary[k] === sum[k]), keys.map((k) => `${k} ${summary[k]}/${sum[k]}`).join(', '));
  check('end_state', summary.outcome === 'abandon' ? true : sum.over === true, `${summary.outcome} (${summary.reason}), over=${sum.over}`);
  const net = byType('net');
  // network data for every seat that plays through a client (not the server bot or the robot)
  const humanActors = h.seats.filter((s) => s.replay === 'inputs' && s.kind !== 'server-bot').map((s) => s.actor);
  check('network_data', steps.length < 120 || humanActors.every((a) => net.some((n) => n.kind === 'input' && n.actor === a)),
    `${net.length} lines: ${[...new Set(net.map((n) => n.kind))].join(', ')}`);
  for (const n of net) put({ type: 'net', ...n });
  put({ type: 'summary', ...sum, outcome: summary.outcome, reason: summary.reason, ended: summary.ended ?? { reason: summary.reason, last_tick: sum.ticks },
    result: { score: sum.score, delivered: sum.delivered, missed: sum.missed, nightmares: sum.nightmares, lost: sum.lost, bestStreak: sum.bestStreak, moons: sum.moons }, ended_at: summary.ended_at });
  const srcCount = {};
  for (const s of steps) s.in.forEach((a, i) => { const k = `${h.seats[i].role}:${a[4]}`; srcCount[k] = (srcCount[k] || 0) + 1; });
  const ok = checks.every((c) => c.ok);
  const result = { name, ok, checks, room: h.room, episode: h.episode, shift: h.shift.id, seats: h.seats.map((s) => `${s.role}:${s.kind}:${s.player_id || '-'}`),
    steps: steps.length, events: recEv.length, summary: { score: sum.score, delivered: sum.delivered, missed: sum.missed, nightmares: sum.nightmares, lost: sum.lost, moons: sum.moons, outcome: summary.outcome },
    input_sources: srcCount };
  if (write) write(out.join('\n') + '\n', result);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!inputs.length) { console.error('usage: convert.mjs <recording.jsonl.gz | folder> ... [--out dir] [--check-only]'); process.exit(2); }
  const all = inputs.flatMap(files).sort();
  if (!CHECK_ONLY) fs.mkdirSync(OUT, { recursive: true });
  const results = [];
  for (const f of all) {
    const lines = readLines(f);
    const base = path.basename(f).replace(/\.jsonl(\.gz)?$/, '');
    const tag = `${lines[0]?.room || 'room'}-${base}`;
    const key = f.replace(/\\/g, '/').replace(/^.*?(?=nightloom\/\d{4}-\d{2}-\d{2}\/)/, '');  // the bucket key when the path holds one
    const r = convert(lines, {
      name: key,
      write: CHECK_ONLY ? null : (text) => fs.writeFileSync(path.join(OUT, `${tag}.trace-v2.jsonl`), text),
    });
    results.push(r);
    const bad = r.checks.filter((c) => !c.ok);
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${f}  ${r.shift} ${r.seats?.join(' ')} steps ${r.steps} score ${r.summary?.score} ${r.summary?.outcome}`);
    if (!QUIET || bad.length) for (const c of r.checks) if (!QUIET || !c.ok) console.log(`   ${c.ok ? 'ok  ' : 'FAIL'} ${c.id}: ${c.detail}`);
  }
  if (!CHECK_ONLY) fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} recordings pass all checks`);
  process.exit(failed ? 1 : 0);
}
