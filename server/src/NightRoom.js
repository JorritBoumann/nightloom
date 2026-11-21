// The Nightloom room: two seats (Bramble and Flit), a lobby, then episodes.
// One episode is one round of one shift. The server is the authority: clients
// send input frames, the server runs the unchanged game code (src/data.js,
// src/core.js, src/bot.js) at 60 steps per second in its own VM context, and
// every client draws the synced state. Each episode is recorded so that it
// replays exactly (recording.js, tools/convert.mjs).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Room } from 'colyseus';
import { NightState, Player, Obj, Order, Applied, InputCmd } from './schema.js';
import { SimWorld, simSource, TICK_HZ, HASH_EVERY, KEYFRAME_EVERY, ROLES, plain } from '../../online/sim.mjs';
import { EpisodeRecorder, flushUploads, getJson, putJson, PLAYERS_PREFIX } from './recording.js';
import { registerRobotRoom, unregisterRobotRoom, robotLinkEnabled } from './robotLink.js';

const SOURCE = simSource(new URL('../../src/', import.meta.url));
const MANIFEST = JSON.parse(fs.readFileSync(new URL('../../stateloop.coop.json', import.meta.url), 'utf8'));
const GAME_VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const SERVER_PKG = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const SHIFTS = (() => { const w = new SimWorld(SOURCE); return plain(w.api.LEVELS.map((L) => ({ id: L.id, name: L.name, hints: !!L.hints }))); })();
const BUILD = process.env.STATELOOP_BUILD_SHA || 'local';
const BOT_CONTROLLER = `bot:nightloom-bot.js@${SOURCE.sha256.slice(0, 12)}`;

const COUNTDOWN_S = 3;
const MAX_BACKLOG = 4;        // frames (~67 ms) waiting before the server skips to the newest
const HOLD_TICKS = 15;        // repeat the last movement for at most 250 ms without a frame
const GRIP_TICKS = 60;        // a held work key (spinning, washing) survives a 1 s stall
const MAX_PRESSES = 8;        // presses applied from one frame window
const RECONNECT_S = 20;
const PING_TICKS = 60;        // ping each client every second
const MIN_ROUND_TICKS = 600;  // a round shorter than 10 s does not count in a player's history
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PLAYER_ID = /^[0-9A-HJKMNP-TV-Z]{8}$/;   // Crockford base32, made by the client
const COLORS = ['#9bd47a', '#ffb3c7'];
const BOT_KEY = 'bot';
const ROBOT_KEY = 'robot';
const OBS_EVERY = 3;          // robot rooms: an observation every 3 steps (20 per second)
const INTENTS = new Set(['', 'wool', 'star', 'moondrop', 'thread', 'jar', 'dirty']);
const COMMS = new Set(['none', 'voice', 'same_room', 'text']);
const FOCUS = new Set(['blur', 'focus', 'hidden', 'visible']);
const DEVICES = ['keyboard', 'gamepad', 'touch'];
const SHIFT = { dusk: 0, midnight: 1, daybreak: 4 };
const STEP_ORDER = 'per step: presses of human seats (Bramble first, in press order: g = grab(p), a = actDown(p)); held input p.in of human seats; botStep(p, 1/60) of bot seats (Bramble first); update(1/60). Same order as the offline loop in src/ui.js.';
const ROW = 'step "in"[actor] = [x, y, act, presses, src, skipped, frame, client_ms, recv_ms]: the applied input; src f fresh frame, r repeated (no frame, at most 15 steps), i idle (no frame for longer), n no frame yet, d disconnected, b server bot; frame = index of the client frame used (1-based, as the client counts sends), client_ms = the client clock in that frame, recv_ms = when the server received it, ms after the episode start. Bot rows end at src.';

const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
const cleanStr = (s, n = 64) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, n);
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null; };
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const emptyRounds = () => Object.fromEntries(ROLES.map((r) => [r, Object.fromEntries(SHIFTS.map((s) => [s.id, 0]))]));

export class NightRoom extends Room {
  maxClients = 2;
  patchRate = 1000 / 30;          // 30 state patches per second
  maxMessagesPerSecond = 240;     // 60 input frames per second plus lobby messages
  state = new NightState();
  inputs = this.defineInput(InputCmd, {
    bufferMaxSize: 32,
    tickRate: TICK_HZ,
    sanitize: { x: [-1, 1], y: [-1, 1] },
  });

  messages = {
    name: (client, msg) => this.onName(client, msg),
    role: (client, msg) => this.onRole(client, msg),
    swap: (client) => this.onSwap(client),
    shift: (client, msg) => this.onShift(client, msg),
    bot: (client, msg) => this.onBot(client, msg),
    ready: (client, msg) => this.onReady(client, msg),
    comms: (client, msg) => this.onComms(client, msg),
    profile: (client, msg) => this.onProfile(client, msg),
    client: (client, msg) => this.onClientInfo(client, msg),
    intent: (client, msg) => this.onIntent(client, msg),
    'net:pong': (client, msg) => this.onPong(client, msg),
    'net:focus': (client, msg) => this.onFocus(client, msg),
    '*': () => {},
  };

  async onCreate(options = {}) {
    this.roomId = await this.uniqueCode();
    this.createdAt = Date.now();
    this.visitId = `${this.roomId}-${this.createdAt}`;
    this.state.code = this.roomId;
    this.isPrivate = !!options.private || !!options.withBot;
    this.formedBy = options.withBot ? 'solo_bot' : options.private ? 'code' : 'quick_match';
    if (this.isPrivate) await this.setPrivate(true);
    await this.setMetadata({ code: this.roomId, private: this.isPrivate });
    this.shiftFixed = options.shift !== undefined && options.shift !== null;
    this.setShift(this.shiftFixed ? options.shift : SHIFT.midnight);
    this.state.suggest = this.state.shift;
    this.wantBot = !!options.withBot && !options.robot;
    this.state.withBot = this.wantBot;
    this.robot = null;
    if (options.robot) {
      // Robot room (live test): an outside process drives the Flit seat over the robot link.
      if (!robotLinkEnabled()) throw new Error('robot_rooms_disabled');
      const k = Math.max(1, Math.min(4, Number(options.robot.k) || 2));
      this.robot = { k, dt: 1 / (60 * k), ws: null, policy: '', version: '', pose: null, queue: [], lastSeq: 0, lastRecv: null, events: [] };
      this.state.dt = this.robot.dt;
      this.formedBy = 'robot';
      if (!this.isPrivate) { this.isPrivate = true; await this.setPrivate(true); }
      const p = new Player();
      this.setSlot(p, 1);
      p.bot = true; p.kind = 'robot'; p.name = 'Robot'; p.ready = false; p.connected = false; p.comms = 'none';
      p.act = new Applied();
      this.state.players.set(ROBOT_KEY, p);
      registerRobotRoom(this.roomId, this);
    }
    this.seats = new Map();    // sessionId -> seat bookkeeping (inputs, client facts, history)
    this.world = null;
    this.rec = null;
    this.countdownTicks = 0;
    this.objKeys = new Map();  // key -> Obj, for the synced objects map
    this.lastShift = -1;
    this.hookReceiveTimes();
    this.setFixedTimestep(() => this.safeStep(), TICK_HZ);
  }

  /** Stamp the arrival time of every input frame (for the recording only).
   * Same internal hook as the Stateloop co-op host recorder: frames are
   * numbered by their position in the client's buffer (consumed + queued). */
  hookReceiveTimes() {
    const ic = this._inputController;
    if (!ic || typeof ic.capture !== 'function') return;
    const cap = ic.capture.bind(ic);
    ic.capture = (client, ...rest) => {
      const out = cap(client, ...rest);
      const s = this.seats?.get(client.sessionId);
      const buf = client._inputBuffer;
      if (s && buf) {
        const abs = buf.consumedCount + buf.size;
        if (abs !== s.lastAbs) { s.lastAbs = abs; s.recv.set(abs, Date.now()); if (s.recv.size > 256) s.recv.delete(s.recv.keys().next().value); }
      }
      return out;
    };
  }

  async uniqueCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!(await this.presence.sismember('nightloom:codes', code))) {
        await this.presence.sadd('nightloom:codes', code);
        return code;
      }
    }
  }

  setShift(v) {
    const i = Math.max(0, Math.min(SHIFTS.length - 1, Math.floor(Number(v)) || 0));
    this.state.shift = i;
    this.state.levelId = SHIFTS[i].id;
  }

  // ---- seats ----------------------------------------------------------------
  playerAt(slot) {
    for (const [key, p] of this.state.players) if (p.slot === slot) return [key, p];
    return [null, null];
  }
  freeSlot(prefer) {
    const taken = new Set([...this.state.players.values()].map((p) => p.slot));
    if (prefer >= 0 && !taken.has(prefer)) return prefer;
    for (let s = 0; s < 2; s++) if (!taken.has(s)) return s;
    return -1;
  }
  setSlot(p, slot) { p.slot = slot; p.role = ROLES[slot]; p.color = COLORS[slot]; }
  humans() { return [...this.state.players.entries()].filter(([, p]) => p.kind === 'human' || p.kind === 'test-bot'); }

  // ---- robot seat ------------------------------------------------------------
  /** A robot process connected over the robot link (robotLink.js). */
  attachRobot(ws) {
    const r = this.robot;
    if (!r) return false;
    if (r.ws) { try { r.ws.close(4002, 'replaced by a new robot connection'); } catch { /* gone */ } }
    r.ws = ws;
    const rp = this.state.players.get(ROBOT_KEY);
    if (rp) rp.connected = true;
    this.netLog('robot_connect', ROBOT_KEY);
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (m.type === 'hello') {
        r.policy = cleanStr(m.policy, 80); r.version = cleanStr(m.version, 80);
        if (rp) { rp.ready = true; rp.name = 'Robot'; }
        const all = [...this.state.players.values()];
        if (this.inLobby() && all.length === 2 && all.every((q) => q.ready)) this.startCountdown();
      } else if (m.type === 'act') {
        const num2 = (v) => (Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) ? [v[0], v[1]] : null);
        const acts = (Array.isArray(m.actions) ? m.actions : []).slice(0, 8)
          .map((a) => ({ v: a?.verb === 'use' ? 'u' : a?.verb === 'tip' ? 't' : '', c: num2(a?.cell) })).filter((a) => a.v && a.c);
        r.queue.push({ seq: Number(m.seq) || 0, x: num(m.x, -2, 40), y: num(m.y, -2, 40), work: num2(m.work), receive: m.receive === true,
          pr: acts.map((a) => `${a.v}${a.c[0]},${a.c[1]}`).join(';'), at: Date.now() });
        if (r.queue.length > 240) r.queue.shift();
      }
    });
    ws.on('close', () => {
      if (r.ws !== ws) return;
      r.ws = null;
      if (rp) { rp.connected = false; if (this.inLobby()) rp.ready = false; }
      this.netLog('robot_disconnect', ROBOT_KEY);
    });
    this.robotSend({ type: 'welcome', room: this.roomId, k: r.k, dt: r.dt, seat: 1 });
    return true;
  }
  robotSend(m) { const ws = this.robot?.ws; if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
  /** The robot input for one step: every message since the last step, in order. */
  takeRobot(t) {
    const r = this.robot, S = this.world.S;
    if (!r.pose) r.pose = { x: S.players[1].x, y: S.players[1].y, work: null, receive: false };
    let pr = '';
    for (const m of r.queue) {
      if (m.x !== null && m.y !== null) { r.pose.x = m.x; r.pose.y = m.y; }
      r.pose.work = m.work; r.pose.receive = m.receive;
      if (m.pr) pr = pr ? `${pr};${m.pr}` : m.pr;
      r.lastSeq = m.seq; r.lastRecv = m.at;
    }
    const fresh = r.queue.length > 0;
    r.queue = [];
    return { inp: { x: r.pose.x, y: r.pose.y, pr, work: r.pose.work, receive: r.pose.receive }, src: 'R', skipped: 0,
      frame: fresh ? { k: r.lastSeq, ct: null, rx: r.lastRecv - this.episodeStartWall } : null };
  }

  async onJoin(client, options = {}) {
    const slot = this.freeSlot(ROLES.indexOf(options.role));
    if (slot < 0) throw new Error('room_full');
    const p = new Player();
    this.setSlot(p, slot);
    p.bot = options.bot === true;
    p.kind = p.bot ? 'test-bot' : 'human';
    p.name = cleanName(options.name) || (p.bot ? 'Test bot' : `Player ${this.humans().length + 1}`);
    p.act = new Applied();
    const pid = PLAYER_ID.test(String(options.player_id || '')) ? String(options.player_id) : null;
    const c = options.client || {};
    const s = {
      pn: 0, held: null, lastTick: -1e9, lastAbs: -1, recv: new Map(), dev: null, dropped: false,
      player_id: pid, consent: options.consent && typeof options.consent === 'object'
        ? { version: cleanStr(options.consent.version, 40), at: cleanStr(options.consent.at, 40), notice_sha256: cleanStr(options.consent.notice_sha256, 64) } : null,
      client: {
        build: cleanStr(c.build, 64), browser: cleanStr(c.browser, 40), os: cleanStr(c.os, 40), mobile: c.mobile === true,
        css_w: num(c.css_w, 0, 10000), css_h: num(c.css_h, 0, 10000), dpr: num(c.dpr, 0, 10), canvas_w: num(c.canvas_w, 0, 10000), canvas_h: num(c.canvas_h, 0, 10000),
      },
      controller: p.bot ? `bot:${cleanStr(options.controller || 'test-client', 60)}` : 'human',
      audio_on: typeof c.audio_on === 'boolean' ? c.audio_on : null, music_on: typeof c.music_on === 'boolean' ? c.music_on : null,
      hints: null, rating: num(options.rating, 1, 5), comms: null,
      rounds: emptyRounds(), pings: new Map(), pingN: 0, stats: this.newStats(), joinedAt: Date.now(),
    };
    this.state.players.set(client.sessionId, p);
    this.seats.set(client.sessionId, s);
    this.netLog('join', client.sessionId, { slot, kind: p.kind });
    if (this.wantBot && !this.state.players.has(BOT_KEY)) this.addBot();
    this.updateLock();
    if (pid) {
      const stored = await getJson(`${PLAYERS_PREFIX}/${pid}.json`);
      if (stored && stored.rounds) for (const r of ROLES) for (const sh of SHIFTS) s.rounds[r][sh.id] = Number(stored.rounds?.[r]?.[sh.id]) || 0;
    }
    p.newcomer = !p.bot && this.totalRounds(s) === 0;
    this.suggestShift();
  }

  totalRounds(s) { return ROLES.reduce((a, r) => a + SHIFTS.reduce((b, sh) => b + (s.rounds[r][sh.id] || 0), 0), 0); }

  /** Lobby rule (robot task, section 8.2): a new player's first round is Dusk as a
   * warm-up; after that the lobby offers Midnight first, then Daybreak. */
  suggestShift() {
    if (!this.inLobby()) return;
    const newcomer = this.humans().some(([, p]) => p.newcomer);
    let next;
    if (newcomer) next = SHIFT.dusk;
    else if (this.lastShift === SHIFT.midnight) next = SHIFT.daybreak;
    else next = SHIFT.midnight;
    this.state.suggest = next;
    if (!this.shiftFixed) this.setShift(next);
  }

  addBot() {
    const slot = this.freeSlot(-1);
    if (slot < 0) return false;
    const p = new Player();
    this.setSlot(p, slot);
    p.bot = true; p.kind = 'server-bot'; p.name = 'Bot'; p.ready = true; p.comms = 'none';
    p.act = new Applied();
    this.state.players.set(BOT_KEY, p);
    this.state.withBot = true;
    return true;
  }
  removeBot() {
    this.state.players.delete(BOT_KEY);
    this.state.withBot = false;
  }
  updateLock() {
    const full = this.state.players.size >= 2;
    if (full || this.state.players.has(BOT_KEY)) this.lock();
    else if (!this.isPrivate) this.unlock();
  }

  async onDrop(client) {
    const p = this.state.players.get(client.sessionId);
    const s = this.seats.get(client.sessionId);
    if (p) p.connected = false;
    if (s) s.dropped = true;
    this.netLog('drop', client.sessionId);
    try {
      await this.allowReconnection(client, RECONNECT_S);
    } catch {
      // timed out: onLeave follows
    }
  }

  onReconnect(client) {
    const p = this.state.players.get(client.sessionId);
    const s = this.seats.get(client.sessionId);
    if (p) p.connected = true;
    if (s) s.dropped = false;
    this.netLog('reconnect', client.sessionId);
  }

  onLeave(client) {
    const s = this.seats.get(client.sessionId);
    this.netLog('leave', client.sessionId, { after_drop: !!s?.dropped });
    this.state.players.delete(client.sessionId);
    this.seats.delete(client.sessionId);
    if (this.state.phase === 'playing') this.finishEpisode(s?.dropped ? 'disconnect' : 'left');
    if (this.state.phase === 'countdown') this.backToLobby();
    if (this.humans().length === 0) this.removeBot();
    if (this.robot && this.humans().length === 0) this.disconnect();
    for (const [, q] of this.humans()) q.ready = false;
    this.updateLock();
    this.suggestShift();
  }

  async onDispose() {
    if (this.state.phase === 'playing') this.finishEpisode('left');
    if (this.robot) { unregisterRobotRoom(this.roomId); try { this.robot.ws?.close(4003, 'room closed'); } catch { /* gone */ } }
    await flushUploads();
    await this.presence.srem('nightloom:codes', this.roomId);
  }

  // ---- lobby messages ---------------------------------------------------------
  inLobby() { return this.state.phase === 'lobby' || this.state.phase === 'ended'; }
  resetReady() { for (const [, q] of this.humans()) q.ready = false; }

  onName(client, msg) {
    const p = this.state.players.get(client.sessionId);
    const name = cleanName(msg?.name);
    if (p && name) p.name = name;
  }
  onRole(client, msg) {
    const p = this.state.players.get(client.sessionId);
    const want = ROLES.indexOf(msg?.role);
    if (!p || want < 0 || want === p.slot || !this.inLobby()) return;
    const [, other] = this.playerAt(want);
    if (other) this.setSlot(other, p.slot);
    this.setSlot(p, want);
    this.state.swapped = false;
    this.resetReady();
  }
  onSwap(client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !this.inLobby()) return;
    this.onRole(client, { role: ROLES[1 - p.slot] });
  }
  onShift(client, msg) {
    if (!this.inLobby() || !this.state.players.has(client.sessionId)) return;
    const before = this.state.shift;
    this.setShift(msg?.shift);
    this.shiftFixed = true;
    if (this.state.shift !== before) this.resetReady();
  }
  onBot(client, msg) {
    if (!this.inLobby() || !this.state.players.has(client.sessionId)) return;
    if (msg?.on) {
      if (!this.state.players.has(BOT_KEY)) this.addBot();
    } else if (this.state.players.has(BOT_KEY)) {
      this.removeBot();
    }
    this.wantBot = this.state.players.has(BOT_KEY);
    this.resetReady();
    this.updateLock();
  }
  onReady(client, msg) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !this.inLobby()) return;
    const s = this.seats.get(client.sessionId);
    if (s && typeof msg?.hints === 'boolean') s.hints = msg.hints;
    if (s && typeof msg?.audio_on === 'boolean') s.audio_on = msg.audio_on;
    if (s && typeof msg?.music_on === 'boolean') s.music_on = msg.music_on;
    if (msg?.comms && COMMS.has(msg.comms)) { p.comms = msg.comms; if (s) s.comms = msg.comms; }
    p.ready = msg?.ready !== false;
    const all = [...this.state.players.values()];
    if (all.length === 2 && all.every((q) => q.ready)) this.startCountdown();
  }
  onComms(client, msg) {
    const p = this.state.players.get(client.sessionId);
    const s = this.seats.get(client.sessionId);
    if (!p || !COMMS.has(msg?.value)) return;
    p.comms = msg.value;
    if (s) s.comms = msg.value;
  }
  onProfile(client, msg) {
    const s = this.seats.get(client.sessionId);
    if (s) s.rating = num(msg?.rating, 1, 5);
  }
  onClientInfo(client, msg) {
    const s = this.seats.get(client.sessionId);
    if (!s || !msg) return;
    const ch = {};
    for (const k of ['css_w', 'css_h', 'canvas_w', 'canvas_h']) { const v = num(msg[k], 0, 10000); if (v !== null && v !== s.client[k]) { s.client[k] = v; ch[k] = v; } }
    const dpr = num(msg.dpr, 0, 10); if (dpr !== null && dpr !== s.client.dpr) { s.client.dpr = dpr; ch.dpr = dpr; }
    for (const k of ['audio_on', 'music_on']) if (typeof msg[k] === 'boolean' && msg[k] !== s[k]) { s[k] = msg[k]; ch[k] = msg[k]; }
    if (Object.keys(ch).length) this.netLog('client', client.sessionId, ch);
  }
  /* Test bots tell their partner what they fetch, as two bots do offline
     (bot.js reads the other bot's task). People do not send this. */
  onIntent(client, msg) {
    const p = this.state.players.get(client.sessionId);
    const fetch = String(msg?.fetch || '');
    if (!p || p.kind !== 'test-bot' || !INTENTS.has(fetch)) return;
    if (p.intent !== fetch) { p.intent = fetch; this.netLog('intent', client.sessionId, { fetch }); }
  }
  onFocus(client, msg) {
    if (!FOCUS.has(msg?.kind)) return;
    this.netLog('focus', client.sessionId, { focus: msg.kind, client_tick: num(msg.tick, 0, 1e7), client_ms: num(msg.ct, 0, 1e10) });
  }
  onPong(client, msg) {
    const s = this.seats.get(client.sessionId);
    const sent = s?.pings.get(msg?.n);
    if (!s || sent === undefined) return;
    s.pings.delete(msg.n);
    const rtt = Date.now() - sent;
    const p = this.state.players.get(client.sessionId);
    if (p) p.rtt = Math.min(65535, rtt);
    if (!this.rec || this.state.phase !== 'playing') return;
    const corr = Array.isArray(msg.corr) ? msg.corr.slice(0, 120).map((c) => [num(c?.[0], 0, 1e7), num(c?.[1], 0, 100)]) : [];
    this.rec.net({
      t: this.world.tick, wall: Date.now(), kind: 'ping', actor: p?.slot, seat: client.sessionId, ping_ms: rtt,
      client_pending_frames: num(msg.pending, 0, 10000), partner_view_delay_ms: num(msg.pvd, 0, 60000), client_ms: num(msg.ct, 0, 1e10),
      corrections: corr,
    });
  }

  netLog(kind, sid, extra = {}) {
    if (this.rec && this.state.phase === 'playing') {
      const p = this.state.players.get(sid);
      this.rec.net({ t: this.world.tick, wall: Date.now(), kind, seat: sid, actor: p ? p.slot : extra.slot ?? null, ...extra });
    }
  }

  // ---- phases ---------------------------------------------------------------
  backToLobby() {
    this.state.phase = 'lobby';
    this.state.countdown = 0;
    this.resetReady();
  }

  startCountdown() {
    const seats = [0, 1].map((slot) => {
      const [key, p] = this.playerAt(slot);
      return { slot, key, role: ROLES[slot], kind: p.kind, sim: p.kind === 'server-bot' ? 'bot' : p.kind === 'robot' ? 'robot' : 'human' };
    });
    const seed = crypto.randomInt(0, 2 ** 32 - 1) >>> 0;
    this.world = new SimWorld(SOURCE);
    this.world.start(this.state.shift, seed, seats.map((s) => ({ role: s.role, controller: s.sim })), { dt: this.robot ? this.robot.dt : 1 / TICK_HZ });
    if (this.robot) { this.robot.pose = null; this.robot.queue = []; }
    this.episodeSeats = seats;
    this.state.seed = seed;
    this.state.outcome = '';
    this.state.reason = '';
    this.state.moons = 0;
    this.state.swapped = false;
    this.state.phase = 'countdown';
    this.countdownTicks = COUNTDOWN_S * TICK_HZ;
    this.state.countdown = COUNTDOWN_S;
    this.resetObjects();
    this.sync(null);
  }

  startEpisode() {
    const w = this.world;
    this.state.episode += 1;
    this.state.phase = 'playing';
    this.state.countdown = 0;
    this.episodeStartWall = Date.now();
    for (const s of this.seats.values()) { s.held = null; s.lastTick = -1e9; s.stats = this.newStats(); s.dev = null; }
    const info = plain(w.info());
    const shiftInfo = SHIFTS[info.shift];
    const seats = this.episodeSeats.map((e) => {
      const s = this.seats.get(e.key);
      const p = this.state.players.get(e.key);
      if (e.kind === 'robot') {
        const r = this.robot;
        return { seat: e.slot, actor: e.slot, role: e.role, controller: `robot:${r.policy || 'unknown'}`, kind: 'robot', replay: 'robot',
          robot_version: r.version || null, player_id: null, client_id: null, consent: null, input_device: null, client: null, audio_on: null, rounds_before: null, self_rating: null, comms: null, hints: null };
      }
      if (e.kind === 'server-bot') {
        return { seat: e.slot, actor: e.slot, role: e.role, controller: BOT_CONTROLLER, kind: e.kind, replay: 'bot.js', bot_react: 0.22,
          player_id: null, client_id: null, consent: null, input_device: null, client: null, audio_on: null, rounds_before: null, self_rating: null, comms: null, hints: null };
      }
      return {
        seat: e.slot, actor: e.slot, role: e.role, controller: s?.controller || 'human', kind: e.kind, replay: 'inputs',
        player_id: s?.player_id || null, client_id: e.key, consent: s?.consent || null,
        input_device: null, client: s ? { ...s.client } : null, audio_on: s?.audio_on ?? 'unknown', music_on: s?.music_on ?? 'unknown',
        rounds_before: s ? JSON.parse(JSON.stringify(s.rounds)) : null, self_rating: s?.rating ?? null,
        comms: p?.comms || null, hints: s?.hints ?? null,
      };
    });
    const humanSeats = seats.filter((s) => s.replay === 'inputs');
    const hintsShown = !shiftInfo.hints ? false
      : humanSeats.some((s) => s.hints === true) ? true : humanSeats.every((s) => s.hints === false) ? false : 'unknown';
    const commsAll = humanSeats.map((s) => s.comms);
    const comms = commsAll.find((c) => c && c !== 'none') || (commsAll.every((c) => c === 'none') ? 'none' : 'unknown');
    const formed = this.state.players.has(BOT_KEY) ? 'solo_bot' : this.formedBy;
    const created = new Date(this.createdAt).toISOString();
    this.sessionId = crypto.randomUUID();
    this.rec = new EpisodeRecorder({
      game: 'nightloom', version: GAME_VERSION,
      game_commit: process.env.NIGHTLOOM_GAME_COMMIT || BUILD.split('+')[0],
      core_sha256: SOURCE.sha256, core_files: ['src/data.js', 'src/core.js', 'src/bot.js'],
      online_build: { server: BUILD, clients: [...new Set(humanSeats.map((s) => s.client?.build).filter(Boolean))] },
      build: { build_sha: BUILD, sim_sha256: SOURCE.sha256, server: SERVER_PKG.name, node: process.version, colyseus: SERVER_PKG.dependencies.colyseus },
      session_id: this.sessionId, room_id: this.roomId, room: this.roomId, room_created: created, room_created_ms: this.createdAt,
      visit_id: this.visitId, round_in_visit: this.state.episode, episode: this.state.episode, pair_formed_by: formed, room_private: this.isPrivate,
      comms, hints_shown: hintsShown,
      seed: w.S.seed, shift: { index: info.shift, id: info.id, name: info.name },
      tick_rate: TICK_HZ, tick_hz: TICK_HZ, dt: this.robot ? this.robot.dt : 1 / TICK_HZ, countdown_s: COUNTDOWN_S,
      robot: this.robot ? { k: this.robot.k, policy: this.robot.policy, version: this.robot.version, lab_core: false, obs_every: OBS_EVERY, link: 'server/src/robotLink.js' } : null,
      hash_every: HASH_EVERY, keyframe_every: KEYFRAME_EVERY,
      step_order: STEP_ORDER, row_format: ROW,
      input_rules: { max_backlog_frames: MAX_BACKLOG, repeat_ticks: HOLD_TICKS, grip_ticks: GRIP_TICKS, max_presses: MAX_PRESSES, reconnect_s: RECONNECT_S },
      seats,
      level: { map: info.map, legend: info.legend, dreams: info.dreams, time: info.time, moons: info.moons, p1: info.p1, p2: info.p2, wind: info.wind, bridge: info.bridge, hints: shiftInfo.hints },
      frame: MANIFEST.frame,
      consent_notice: MANIFEST.consent,
      started_at: new Date(this.episodeStartWall).toISOString(),
    });
    this.rec.keyframe(0, w.full());
    this.rec.hash(0, w.hashes());
    this.robotSend({ type: 'episode_start', episode: this.state.episode, shift: this.state.shift, seed: w.S.seed, k: this.robot?.k, dt: this.robot?.dt });
    if (this.robot) this.robotObs(0, []);
    this.broadcast('evt:episode_start', {
      episode: this.state.episode, levelId: this.state.levelId, shift: this.state.shift, seed: w.S.seed,
      seats: seats.map((s) => ({ seat: s.client_id || BOT_KEY, actor: s.actor, role: s.role, kind: s.kind })),
    });
  }

  finishEpisode(reason) {
    const w = this.world;
    if (!w || this.state.phase !== 'playing') return;
    const sum = plain(w.summary());
    const ended = reason === 'shift_over' ? 'time_up' : reason;
    const outcome = ended === 'time_up' ? (sum.moons >= 1 ? 'success' : 'fail') : 'abandon';
    this.sync(null);
    this.state.outcome = outcome;
    this.state.reason = ended;
    this.state.moons = sum.moons;
    const shiftId = SHIFTS[w.S.lvl].id;
    const names = {};
    for (const e of this.episodeSeats) {
      const s = this.seats.get(e.key);
      const p = this.state.players.get(e.key);
      if (s?.player_id && p) names[s.player_id] = p.name;
      if (s && sum.ticks >= MIN_ROUND_TICKS) {
        s.rounds[e.role][shiftId] = (s.rounds[e.role][shiftId] || 0) + 1;
        if (p) p.newcomer = false;
        if (s.player_id && e.kind === 'human') putJson(`${PLAYERS_PREFIX}/${s.player_id}.json`, { player_id: s.player_id, rounds: s.rounds, updated_at: new Date().toISOString() });
      }
    }
    if (this.rec) {
      this.rec.finish({ outcome, reason: ended, ended: { reason: ended, last_tick: sum.ticks }, result: { score: sum.score, delivered: sum.delivered, missed: sum.missed, nightmares: sum.nightmares, lost: sum.lost, bestStreak: sum.bestStreak, moons: sum.moons }, ...sum, ended_at: new Date().toISOString() }, names);
      this.rec = null;
    }
    const all = [...this.state.players.values()];
    this.state.phase = all.length === 2 ? 'ended' : 'lobby';
    this.resetReady();
    this.lastShift = w.S.lvl;
    if (ended === 'time_up') {
      this.state.rounds += 1;
      // robot task section 8.2: the two players change roles after each two rounds
      if (this.state.rounds % 2 === 0 && all.length === 2) {
        for (const p of all) this.setSlot(p, 1 - p.slot);
        this.state.swapped = true;
      }
    }
    this.shiftFixed = false;
    this.suggestShift();
    this.robotSend({ type: 'episode_end', episode: this.state.episode, outcome, reason: ended, summary: sum });
    this.broadcast('evt:episode_end', { episode: this.state.episode, outcome, reason: ended, ...sum });
  }

  // ---- fixed step -----------------------------------------------------------
  safeStep() {
    try {
      this.step();
    } catch (e) {
      console.error('[nightloom] step failed', e);
      if (this.state.phase === 'playing') this.finishEpisode('error');
      else this.backToLobby();
    }
  }

  step() {
    const phase = this.state.phase;
    if (phase === 'countdown') {
      this.drainAll();
      this.countdownTicks--;
      this.state.countdown = Math.max(0, this.countdownTicks / TICK_HZ);
      if (this.countdownTicks <= 0) this.startEpisode();
      return;
    }
    if (phase !== 'playing' || !this.world) { this.drainAll(); return; }

    const w = this.world;
    const t = w.tick + 1;
    const inputs = [null, null];
    const meta = [null, null];
    for (let slot = 0; slot < 2; slot++) {
      const [key, p] = this.playerAt(slot);
      if (!p) { inputs[slot] = { x: 0, y: 0, act: false, pr: '' }; meta[slot] = { src: 'd', skipped: 0, frame: null }; continue; }
      if (p.kind === 'server-bot') continue;
      if (p.kind === 'robot') { const r = this.takeRobot(t); inputs[slot] = r.inp; meta[slot] = r; continue; }
      const r = this.takeInput(key, p, t);
      inputs[slot] = r.inp;
      meta[slot] = r;
    }
    const out = w.step(inputs);
    const rec = this.rec;
    const rows = out.applied.map((a, i) => {
      const m = meta[i];
      if (!m) return [a[0], a[1], a[2], a[3], 'b'];
      const f = m.frame;
      const row = [a[0], a[1], a[2], a[3], m.src, m.skipped, f ? f.k : null, f ? f.ct : null, f ? f.rx : null];
      if (m.src === 'R') row.push(m.inp.work || null, !!m.inp.receive);
      return row;
    });
    rec.step(t, rows);
    for (const e of out.events) rec.event(t, e);
    if (t % HASH_EVERY === 0) {
      rec.hash(t, w.hashes());
      for (const [key, p] of this.humans()) {
        const s = this.seats.get(key);
        if (!s) continue;
        rec.net({ t, kind: 'input', actor: p.slot, seat: key, ...s.stats, ping_ms: p.rtt, connected: p.connected });
        s.stats = this.newStats();
      }
    }
    if (t % KEYFRAME_EVERY === 0) rec.keyframe(t, w.full());
    if (this.robot) {
      this.robot.events.push(...out.events.filter((e) => e.name !== 'decision').map((e) => ({ t, ...e })));
      if (t % OBS_EVERY === 0) { this.robotObs(t, this.robot.events); this.robot.events = []; }
    }
    if (t % PING_TICKS === 0) this.sendPings();
    this.sync(out.applied, meta);
    if (out.fx.length) this.broadcast('fx', out.fx);
    for (const e of out.events) {
      if (e.name === 'decision' || e.name === 'say') continue;
      const seat = e.actor !== undefined ? this.keyForSlot(e.actor) : undefined;
      this.broadcast(`evt:${e.name}`, seat !== undefined ? { seat, ...e } : e);
    }
    if (out.over) this.finishEpisode('shift_over');
  }

  robotObs(t, events) {
    const r = this.robot;
    if (!r?.ws) return;
    this.robotSend({ type: 'obs', tick: t, game_time: t * r.dt, applied_seq: r.lastSeq, state: plain(this.world.full()), events: plain(events) });
  }

  keyForSlot(slot) { const [key] = this.playerAt(slot); return key; }
  newStats() { return { frames: 0, fresh: 0, repeat: 0, idle: 0, skipped: 0, max_backlog: 0, presses: 0 }; }

  /** The input applied for one human seat on step t (backlog, repeat and idle rules). */
  takeInput(key, p, t) {
    const s = this.seats.get(key);
    const acc = this.inputs.get(key);
    let skipped = 0, last;
    const size = acc ? acc.size : 0;
    if (s) s.stats.max_backlog = Math.max(s.stats.max_backlog, size);
    if (acc && acc.size > MAX_BACKLOG) while (acc.size > 1) { last = acc.next(); skipped++; }
    const cmd = acc && acc.size ? acc.next() : undefined;
    if (cmd) last = cmd;
    const pr = last && s ? this.pressesFrom(s, last) : '';
    let frame = null;
    if (cmd && s) {
      const k = acc.consumedCount;
      const rx = s.recv.get(k);
      s.recv.delete(k);
      frame = { k, ct: Math.round(Number(cmd.ct) * 10) / 10, rx: rx !== undefined ? rx - this.episodeStartWall : null };
      const dev = DEVICES[Number(cmd.dev)] || 'keyboard';
      if (dev !== s.dev) { if (this.rec) this.rec.net({ t, kind: 'device', actor: p.slot, seat: key, device: dev, first: s.dev === null }); s.dev = dev; }
    }
    let inp, src;
    if (!p.connected || !s) {
      inp = { x: 0, y: 0, act: false, pr: '' }; src = 'd';
    } else if (cmd) {
      s.held = { x: Number(cmd.x) || 0, y: Number(cmd.y) || 0, act: !!cmd.act };
      s.lastTick = t;
      inp = { ...s.held, pr }; src = 'f';
    } else if (!s.held) {
      inp = { x: 0, y: 0, act: false, pr }; src = 'n';
    } else if (t - s.lastTick <= HOLD_TICKS) {
      inp = { ...s.held, pr }; src = 'r';
    } else {
      inp = { x: 0, y: 0, act: s.held.act && t - s.lastTick <= GRIP_TICKS, pr }; src = 'i';
    }
    if (s) {
      s.stats.frames += (cmd ? 1 : 0) + skipped;
      if (src === 'f') s.stats.fresh++; else if (src === 'r') s.stats.repeat++; else s.stats.idle++;
      s.stats.skipped += skipped;
      s.stats.presses += pr.length;
    }
    return { inp, src, skipped, frame };
  }

  /** Presses since the last frame, oldest first, from the counter and the kind bits. */
  pressesFrom(s, f) {
    const pn = Number(f.pn) & 0xffff;
    const n = (pn - s.pn) & 0xffff;
    s.pn = pn;
    if (n === 0 || n > 32) return '';
    const k = Math.min(n, MAX_PRESSES);
    let out = '';
    for (let i = k - 1; i >= 0; i--) out += ((Number(f.pk) >>> i) & 1) ? 'a' : 'g';
    return out;
  }

  /** Outside an episode, inputs are dropped; their presses are counted as used. */
  drainAll() {
    for (const [key, s] of this.seats) {
      const acc = this.inputs.get(key);
      if (!acc || !acc.size) continue;
      const list = acc.drain();
      const last = list[list.length - 1];
      if (last) s.pn = Number(last.pn) & 0xffff;
      s.recv.clear();
    }
  }

  sendPings() {
    for (const client of this.clients) {
      const s = this.seats.get(client.sessionId);
      if (!s) continue;
      const n = ++s.pingN;
      s.pings.set(n, Date.now());
      if (s.pings.size > 8) s.pings.delete(s.pings.keys().next().value);
      client.send('net:ping', { n });
    }
  }

  // ---- state sync -------------------------------------------------------------
  resetObjects() {
    this.state.objects.clear();
    this.objKeys.clear();
    this.state.goals.clear();
  }

  obj(key, type, x, y) {
    let o = this.objKeys.get(key);
    if (!o) {
      o = new Obj();
      o.type = type; o.x = x; o.y = y;
      this.objKeys.set(key, o);
      this.state.objects.set(key, o);
    }
    return o;
  }

  sync(applied, meta) {
    const w = this.world;
    const S = w.S, st = this.state, api = w.api;
    st.tick = S.tick;
    st.score = S.score; st.delivered = S.delivered; st.missed = S.missed;
    st.nightmares = S.nightmares; st.lost = S.lost; st.streak = S.streak; st.bestStreak = S.bestStreak;
    st.timeLeft = r6(S.timeLeft);
    st.bridgeOn = S.bridgeOn; st.bridgeT = r6(S.bridgeT);
    st.windPhase = S.wind.phase; st.windDir = S.wind.dir; st.windT = r6(S.wind.t);

    for (const [key, pl] of st.players) {
      const p = S.players[pl.slot];
      if (!p) continue;
      pl.x = p.x; pl.y = p.y;
      pl.fx = p.fx; pl.fy = p.fy; pl.yaw = Math.atan2(p.fy, p.fx);
      const hc = api.code(p.held);
      if (pl.held !== hc) pl.held = hc;
      pl.heldId = api.iid(p.held);
      pl.dashT = r6(p.dashT); pl.dashCd = r6(p.dashCd);
      pl.working = p.working; pl.moving = p.moving;
      if (pl.say !== p.say) pl.say = p.say;
      pl.sayT = Math.max(0, Math.round(p.sayT * 100) / 100);
      if (applied) {
        const a = applied[pl.slot], m = meta && meta[pl.slot];
        pl.act.x = a[0]; pl.act.y = a[1]; pl.act.act = !!a[2]; pl.act.pr = a[3]; pl.act.src = m ? m.src : 'b';
      }
      if (pl.kind === 'robot') { pl.ack = this.robot ? this.robot.lastSeq : 0; }
      else if (pl.kind !== 'server-bot') { const acc = this.inputs.get(key); if (acc) pl.ack = acc.consumedCount; }
      else { const f = (p.bot && p.bot.task && p.bot.task.fetch) || ''; if (pl.intent !== f) pl.intent = f; }
    }

    const want = new Set();
    for (const row of S.grid) for (const t of row) {
      if (t.type === 'void' || (t.type === 'floor' && !t.item)) continue;
      const key = `t:${t.x},${t.y}`;
      want.add(key);
      const o = this.obj(key, t.type, t.x + 0.5, t.y + 0.5);
      const c = api.code(t.item);
      if (o.item !== c) o.item = c;
      o.itemId = api.iid(t.item);
      o.prog = r6(t.prog); o.count = t.count; o.dirty = t.dirty;
      if (t.type === 'bridge') o.active = S.bridgeOn;
      if (t.k) {
        const k = t.k;
        if (o.kstate !== k.state) o.kstate = k.state;
        if (o.kitems.length !== k.items.length || k.items.some((v, i) => o.kitems[i] !== v)) {
          o.kitems.clear();
          for (const v of k.items) o.kitems.push(v);
        }
        o.kprog = r6(k.prog); o.kneed = k.need; o.kgrace = r6(k.grace); o.kwarned = !!k.warned;
      }
    }
    for (const pr of S.projs) {
      const id = api.iid(pr.item);
      const key = `p:${id}`;
      want.add(key);
      const o = this.obj(key, 'proj', pr.x, pr.y);
      o.x = pr.x; o.y = pr.y; o.dx = pr.dx; o.dy = pr.dy; o.spin = r6(pr.spin);
      o.itemId = id;
      const c = api.code(pr.item);
      if (o.item !== c) o.item = c;
      o.thrower = pr.thrower;
    }
    for (const key of [...this.objKeys.keys()]) {
      if (!want.has(key)) { this.objKeys.delete(key); st.objects.delete(key); }
    }

    const goals = st.goals;
    const same = goals.length === S.orders.length && S.orders.every((o, i) => goals[i].uid === o.uid);
    if (!same) {
      goals.clear();
      for (const o of S.orders) { const g = new Order(); g.dream = o.id; g.uid = o.uid; g.life = o.life; g.left = r6(o.left); goals.push(g); }
    } else {
      S.orders.forEach((o, i) => { goals[i].left = r6(o.left); });
    }
  }
}
