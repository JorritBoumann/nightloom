// Prints each bot decision for one shift. Usage: node tools/trace.mjs <shift> [seed] [seconds]
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const root = new URL('../src/', import.meta.url);
const src = ['data.js','core.js','bot.js'].map(f => readFileSync(new URL(f, root), 'utf8')).join('\n');
const [lvl, seed = 1000, secs = 60] = process.argv.slice(2).map(Number);
const ctx = vm.createContext({console, Math, Int16Array, Int32Array, Set, Map, JSON});
vm.runInContext(src + `
newGame(${lvl}, {seed:${seed}, countdown:0});
for (const p of S.players) makeBot(p);
const last = {};
HOOK.event = (n, a, b) => { if (n==='deliver'||n==='expire') console.log(S.clock.toFixed(1).padStart(6), '**', n, a, b||''); };
for (let i = 0; i < ${secs}*60 && !S.over; i++) {
  for (const p of S.players) {
    botStep(p, 1/60);
    const t = p.bot.task, s = t ? t.label + ' @' + (t.tile ? t.tile.type + ' ' + t.tile.x + ',' + t.tile.y : '-') + ' ' + t.action : 'idle';
    if (last[p.kind] !== s) { last[p.kind] = s; console.log(S.clock.toFixed(1).padStart(6), p.kind.padEnd(7), 'held=' + (p.held ? (p.held.jar || p.held.kind) : '-'), s,
      '| kettles', S.kettles.map(k => k.k.state[0] + k.k.items.map(x=>x[0]).join('')).join(' '), '| orders', S.orders.map(o => o.id).join(',')); }
  }
  update(1/60);
}
console.log('score', S.score, 'delivered', S.delivered, 'missed', S.missed, 'nightmares', S.nightmares);
`, ctx);
