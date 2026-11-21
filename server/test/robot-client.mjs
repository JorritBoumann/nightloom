// A test robot for the robot seat link (server/src/robotLink.js). It is not
// the robot of the task (stream B2 builds that). It flies the gripper in
// straight lines at a fixed speed and runs a small script: take a star, fill a
// kettle, take a clean jar, bottle a ready kettle, send the dream down the chute.
//
//   import { runTestRobot } from './robot-client.mjs';
//   runTestRobot({ port, key, room, speed: 6 })   // speed in tiles per game second
import WebSocket from 'ws';

export function runTestRobot({ port, key, room, speed = 6, log = () => {} }) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?room=${room}&key=${encodeURIComponent(key)}`);
  const stats = { obs: 0, acts: 0, actions: 0, episodes: [] };
  let dt = 1 / 120, pos = null, seq = 0, target = null, waitUntil = 0;
  const send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  ws.on('open', () => send({ type: 'hello', policy: 'test-script@1', version: 'robot-client.mjs' }));
  ws.on('message', (data) => {
    const m = JSON.parse(String(data));
    if (m.type === 'welcome' || m.type === 'episode_start') { dt = m.dt || dt; if (m.type === 'episode_start') { pos = null; target = null; } }
    if (m.type === 'episode_end') { stats.episodes.push(m); log(`robot: episode ${m.episode} ended (${m.reason}), delivered ${m.summary.delivered}`); }
    if (m.type !== 'obs') return;
    stats.obs++;
    const st = m.state, me = st.players[1];
    if (!pos) pos = { x: me.x, y: me.y };
    const tiles = st.tiles;
    const of = (type) => tiles.filter((t) => t.type === type);
    const kettles = of('kettle');
    if (!target && m.tick >= waitUntil) {
      const held = me.held;
      let cell = null;
      if (!held) {
        const ready = kettles.find((k) => k.k.state === 'ready');
        const jars = of('jars')[0];
        if (ready && jars && jars.count > 0) cell = jars;
        else if (kettles.some((k) => (k.k.state === 'empty' || k.k.state === 'filling') && !k.k.items.includes('star'))) cell = of('star')[0];
      } else if (held === 'star') cell = kettles.find((k) => k.k.state === 'filling' && !k.k.items.includes('star')) || kettles.find((k) => k.k.state === 'empty');
      else if (held === 'jar:clean') cell = kettles.find((k) => k.k.state === 'ready');
      else if (held.startsWith('jar:dream')) cell = of('chute')[0];
      else if (held === 'jar:dirty') cell = of('basin')[0];
      else cell = kettles.find((k) => k.k.state === 'empty' || k.k.state === 'filling') || of('bin')[0];
      if (cell) target = { x: cell.x, y: cell.y, held };
    }
    // fly toward the target cell centre, then use it
    let actions = [];
    if (target) {
      const dx = target.x + 0.5 - pos.x, dy = target.y + 0.5 - pos.y, d = Math.hypot(dx, dy);
      const stepLen = speed * dt * 3; // one observation every 3 steps
      if (d <= stepLen) {
        pos = { x: target.x + 0.5, y: target.y + 0.5 };
        actions = [{ verb: 'use', cell: [target.x, target.y] }];
        stats.actions++;
        target = null;
        waitUntil = m.tick + 30; // let the effect show in the state before the next choice
      } else {
        pos = { x: pos.x + dx / d * stepLen, y: pos.y + dy / d * stepLen };
      }
    }
    send({ type: 'act', seq: ++seq, x: pos.x, y: pos.y, work: null, receive: false, actions });
    stats.acts++;
  });
  ws.on('close', (code, reason) => log(`robot: link closed ${code} ${reason}`));
  return { ws, stats, close: () => ws.close() };
}
