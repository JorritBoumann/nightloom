// Synced room state. Names follow the Stateloop co-op data rules: players,
// objects, goals, phase, score, levelId, act, bot, connected, role.
// Positions are tile units (1 unit = 1 tile), measured from the top-left
// corner of the map, x to the right and y down. Every field has a default,
// because clients read the state before the first full patch.
import { schema, t } from '@colyseus/schema';

/** One input frame per fixed step, sent by the client.
 * x, y: wanted move direction (-1..1). act: the work key is held.
 * dev and ct describe the frame for the recording; the game does not read them.
 * pn: number of presses so far (wraps at 65536). pk: kinds of the last 32
 * presses, newest in bit 0 (1 = work key, 0 = grab key). Counting presses
 * keeps every press, also when the server skips a backlog of frames. */
export const InputCmd = schema({
  x: t.number().default(0),        // float64: a gamepad's analog value keeps full precision
  y: t.number().default(0),
  act: t.boolean().default(false),
  pn: t.uint16().default(0),
  pk: t.uint32().default(0),
  dev: t.uint8().default(0),       // input device of this frame: 0 keyboard, 1 gamepad, 2 touch
  ct: t.number().default(0),       // client clock when the frame was made (ms, performance.now)
}, 'InputCmd');

/** The input that the simulation applied on the last step (after the
 * backlog, repeat and idle rules). pr: presses applied in this step, in order
 * ('g' grab, 'a' work key). src: f fresh frame, r repeated, i idle, n no frame
 * yet, d disconnected, b server bot. */
export const Applied = schema({
  x: t.number().default(0),
  y: t.number().default(0),
  act: t.boolean().default(false),
  pr: t.string().default(''),
  src: t.string().default(''),
}, 'Applied');

export const Player = schema({
  slot: t.uint8().default(0),           // actor index in the simulation: 0 Bramble, 1 Flit
  role: t.string().default('bramble'),
  kind: t.string().default('human'),    // human, test-bot (a client that joined with {bot:true}) or server-bot
  bot: t.boolean().default(false),      // true for test bots and the server bot
  name: t.string().default(''),
  color: t.string().default('#9bd47a'),
  ready: t.boolean().default(false),
  connected: t.boolean().default(true),
  alive: t.boolean().default(true),
  x: t.number().default(0), y: t.number().default(0), z: t.number().default(0),
  yaw: t.number().default(0),           // facing, radians: atan2(fy, fx)
  fx: t.number().default(0), fy: t.number().default(0),
  held: t.string().default(''),         // item code, '' when empty
  heldId: t.uint32().default(0),        // stable item id within the episode, 0 when empty
  dashT: t.number().default(0), dashCd: t.number().default(0),
  working: t.boolean().default(false), moving: t.boolean().default(false),
  say: t.string().default(''), sayT: t.number().default(0),
  act: Applied,
  intent: t.string().default(''),       // bot and test-bot seats only: what the planner is fetching now (wool, star, moondrop, thread, jar, dirty)
  ack: t.uint32().default(0),           // input frames the server has consumed from this client
  rtt: t.uint16().default(0),           // last measured round trip, ms
  comms: t.string().default(''),        // answer to the lobby question: none, voice, same_room, text ('' = not asked yet)
  newcomer: t.boolean().default(false), // no finished round before: the lobby suggests Dusk as a warm-up
}, 'Player');

/** A fixture tile (counter, kettle, loom, ...), a floor tile that holds an
 * item, or an item in flight (type 'proj'). */
export const Obj = schema({
  type: t.string().default(''),
  x: t.number().default(0), y: t.number().default(0), z: t.number().default(0),
  yaw: t.number().default(0),
  item: t.string().default(''),
  itemId: t.uint32().default(0),
  prog: t.number().default(0),          // loom spin or basin wash progress, 0..1
  count: t.uint8().default(0),          // clean jars on the shelf, dirty jars at the return hatch
  dirty: t.uint8().default(0),          // dirty jars in the basin
  active: t.boolean().default(false),   // bridge: lit (walkable for Bramble)
  kstate: t.string().default(''),       // kettle: empty, filling, brewing, ready, nightmare
  kitems: t.array('string'),
  kprog: t.number().default(0), kneed: t.number().default(0), kgrace: t.number().default(0),
  kwarned: t.boolean().default(false),
  dx: t.number().default(0), dy: t.number().default(0), spin: t.number().default(0),
  thrower: t.string().default(''),
}, 'Obj');

/** An order: a dream that a sleeper wants, with the time left. */
export const Order = schema({
  dream: t.string().default(''),
  uid: t.uint32().default(0),
  life: t.number().default(0),
  left: t.number().default(0),
}, 'Order');

export const NightState = schema({
  code: t.string().default(''),
  phase: t.string().default('lobby'),   // lobby, countdown, playing, ended
  countdown: t.number().default(0),
  shift: t.uint8().default(0),          // selected shift, 0..4
  levelId: t.string().default('dusk'),
  episode: t.uint16().default(0),
  seed: t.number().default(0),
  tick: t.uint32().default(0),
  score: t.int32().default(0),
  delivered: t.uint16().default(0), missed: t.uint16().default(0),
  nightmares: t.uint16().default(0), lost: t.uint16().default(0),
  streak: t.uint16().default(0), bestStreak: t.uint16().default(0),
  timeLeft: t.number().default(0),
  bridgeOn: t.boolean().default(true), bridgeT: t.number().default(0),
  windPhase: t.string().default('calm'), windDir: t.int8().default(1), windT: t.number().default(0),
  outcome: t.string().default(''), reason: t.string().default(''),
  moons: t.uint8().default(0),
  withBot: t.boolean().default(false),
  suggest: t.uint8().default(0),        // the shift the lobby suggests next (Dusk warm-up, then Midnight, then Daybreak)
  rounds: t.uint16().default(0),        // finished rounds in this room; roles swap after every second one
  swapped: t.boolean().default(false),  // the roles were swapped after the last round
  players: t.map(Player),
  objects: t.map(Obj),
  goals: t.array(Order),
}, 'NightState');
