// The robot seat link (robot task, sections 1.6 and 7.2): an outside process
// (the robot: physics, controller and policy) drives the Flit seat of a room.
// It connects over a WebSocket that listens on 127.0.0.1 only, and it speaks
// JSON. It is off unless NIGHTLOOM_ROBOT_PORT and NIGHTLOOM_ROBOT_KEY are set.
//
//   ws://127.0.0.1:<NIGHTLOOM_ROBOT_PORT>/?room=<CODE>&key=<NIGHTLOOM_ROBOT_KEY>
//
// robot -> room
//   {type:'hello', policy:'<policy id>', version:'<controller version>'}
//   {type:'act', seq, x, y, work:[cx,cy]|null, receive:bool, actions:[{verb:'use'|'tip', cell:[cx,cy]}]}
//      x, y: the gripper position in tile units (the Flit proxy stands there).
//      actions: interactions that are due now (the effect moment), applied at the next step in this order.
//      work: hold the work key at the basin cell (washing) until a later message clears it.
//      receive: the gripper is in the receive pose (a thrown item can be caught).
// room -> robot
//   {type:'welcome', room, k, dt, seat:1}
//   {type:'episode_start', episode, shift, seed, k, dt}
//   {type:'obs', tick, game_time, applied_seq, state, events}   every 3 steps (20 per second)
//   {type:'episode_end', episode, outcome, reason, summary}
import { WebSocketServer } from 'ws';

const rooms = new Map();   // room code -> NightRoom
let wss = null;

export const robotLinkEnabled = () => !!(process.env.NIGHTLOOM_ROBOT_PORT && process.env.NIGHTLOOM_ROBOT_KEY);

export function registerRobotRoom(code, room) {
  rooms.set(code, room);
  if (!wss && robotLinkEnabled()) {
    wss = new WebSocketServer({ host: '127.0.0.1', port: Number(process.env.NIGHTLOOM_ROBOT_PORT), maxPayload: 64 * 1024 });
    wss.on('connection', (ws, req) => {
      const q = new URL(req.url, 'http://local').searchParams;
      const target = rooms.get(String(q.get('room') || '').toUpperCase());
      if (q.get('key') !== process.env.NIGHTLOOM_ROBOT_KEY || !target || !target.attachRobot(ws)) {
        ws.close(4001, 'no such robot room, or wrong key');
        return;
      }
    });
    console.log(`[nightloom] robot link on 127.0.0.1:${process.env.NIGHTLOOM_ROBOT_PORT}`);
  }
}

export function unregisterRobotRoom(code) { rooms.delete(code); }
