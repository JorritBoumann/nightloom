// Agent-played trace factory: two bots play shifts headless and every tick is written as JSON lines.
// Usage: node tools/traces.mjs [episodes-per-shift=3] [out-dir=traces]
// Format "nightloom-trace-v1", one JSON object per line:
//   {"type":"header", ...}   game, version, shift, seed, tick rate, map, actors, key map
//   {"type":"tick", ...}     per tick: every actor's pose, facing, held item, held inputs, pressed actions
//   {"type":"event", ...}    grab, act, deliver, expire, with the tick they happened on
//   {"type":"decision", ...} a bot chose a task: the ranked options it weighed and the pick
//   {"type":"hash", ...}     FNV-1a hash of the full game state, once per second
//   {"type":"summary", ...}  score, deliveries, misses, nightmares, moons
// A seed plus the same bot code replays byte for byte (tools/test.mjs checks this).
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import vm from 'node:vm';

const root = new URL('../src/', import.meta.url);
const src = ['data.js','core.js','bot.js'].map(f => readFileSync(new URL(f, root), 'utf8')).join('\n');
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const episodes = Number(process.argv[2] || 3);
const outDir = process.argv[3] || 'traces';
mkdirSync(outDir, {recursive:true});

const ctx = vm.createContext({console, Math, Int16Array, Int32Array, Set, Map, JSON});
vm.runInContext(src + `
globalThis.episode = function(level, seed, version){
  const lines = [], put = o => lines.push(JSON.stringify(o));
  newGame(level, {seed, countdown:0});
  for (const p of S.players) makeBot(p);
  const item = it => it ? (it.kind === 'jar' ? 'jar:' + it.jar + (it.contents ? ':' + it.contents.slice().sort().join('+') : '') : it.kind) : null;
  put({type:'header', schema:'nightloom-trace-v1', game:'nightloom', version, shift:S.L.id, shiftName:S.L.name, seed,
       tickRate:60, map:S.L.map, legend:CH, dreams:S.L.dreams.map(id => ({id, items:DREAMS[id].items})),
       actors:S.players.map((p, i) => ({id:i, kind:p.kind, controller:'bot'})),
       keyMap:{bramble:['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft'], flit:['ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Enter','ShiftRight']}});
  let pressed = [];
  HOOK.event = (name, a, b, c) => {
    if (name === 'grab' || name === 'act') { const id = S.players.indexOf(a); pressed.push({actor:id, action:name}); put({type:'event', tick:S.tick, name, actor:id, tile:b ? {x:b.x, y:b.y, kind:b.type} : null}); }
    else if (name === 'decide') { if (b) put({type:'decision', tick:S.tick, actor:S.players.indexOf(a), options:c || [], pick:{label:b.label, action:b.action, tile:b.tile ? {x:b.tile.x, y:b.tile.y, kind:b.tile.type} : null, stand:{x:b.stand.sx, y:b.stand.sy}}}); }
    else put({type:'event', tick:S.tick, name, data:[a, b]});
  };
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const dt = 1/60;
  while (!S.over) {
    pressed = [];
    for (const p of S.players) botStep(p, dt);
    update(dt);
    put({type:'tick', tick:S.tick, time:+(S.tick*dt).toFixed(4), score:S.score,
         actors:S.players.map((p, i) => ({id:i, x:+p.x.toFixed(4), y:+p.y.toFixed(4), fx:+p.fx.toFixed(3), fy:+p.fy.toFixed(3),
           held:item(p.held), input:{x:+p.in.x.toFixed(3), y:+p.in.y.toFixed(3), act:p.in.act}, working:p.working, valid:true})),
         pressed, bridgeOn:S.bridgeOn, wind:S.L.wind ? S.wind.phase + (S.wind.phase === 'calm' ? '' : (S.wind.dir > 0 ? ':east' : ':west')) : null});
    if (S.tick % 60 === 0) {
      const state = JSON.stringify([S.tick, S.score, S.players.map(p => [p.x, p.y, p.fx, p.fy, item(p.held)]),
        S.grid.map(r => r.map(t => [item(t.item), t.prog, t.count, t.dirty, t.k && [t.k.items, t.k.state, t.k.prog, t.k.grace]])),
        S.orders.map(o => [o.id, o.left]), S.projs.map(q => [q.x, q.y, item(q.item)]), S.bridgeOn, S.wind]);
      put({type:'hash', tick:S.tick, fnv1a:fnv(state)});
    }
  }
  put({type:'summary', score:S.score, delivered:S.delivered, missed:S.missed, nightmares:S.nightmares, lost:S.lost, bestStreak:S.bestStreak, moons:moonsFor(S.score, S.L)});
  return {text:lines.join('\\n') + '\\n', id:S.L.id, score:S.score};
};
globalThis.N_LEVELS = LEVELS.length;`, ctx);

for (let l = 0; l < ctx.N_LEVELS; l++) for (let e = 0; e < episodes; e++) {
  const seed = (9001 + l * 7919 + e * 104729) >>> 0;
  const r = ctx.episode(l, seed, version);
  const file = `${outDir}/${r.id}-${seed}.jsonl`;
  writeFileSync(file, r.text);
  console.log(`${file}  score ${r.score}  ${(r.text.length / 1024 / 1024).toFixed(1)} MB`);
}
