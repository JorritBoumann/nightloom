// Headless balance runs: two bots play every shift on fixed seeds.
// Usage: node tools/sim.mjs [runs-per-shift] [shift-index]
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root = new URL('../src/', import.meta.url);
const src = ['data.js','core.js','bot.js'].map(f => readFileSync(new URL(f, root), 'utf8')).join('\n');
const runs = Number(process.argv[2] || 20);
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : null;

const ctx = vm.createContext({console, Math, Int16Array, Int32Array, Set, Map, JSON});
vm.runInContext(src + `
globalThis.simShift = function(level, seed){
  newGame(level, {seed, countdown:0});
  for (const p of S.players) makeBot(p);
  const dt = 1/60; let guard = 0;
  while (!S.over && guard++ < 60*400) { for (const p of S.players) botStep(p, dt); update(dt); }
  return {score:S.score, delivered:S.delivered, missed:S.missed, nightmares:S.nightmares, lost:S.lost,
          moons: moonsFor(S.score, S.L), name:S.L.name, thresholds:S.L.moons};
};
globalThis.LEVEL_COUNT = LEVELS.length;
`, ctx);

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
for (let l = 0; l < ctx.LEVEL_COUNT; l++) {
  if (only !== null && l !== only) continue;
  const rs = [];
  for (let i = 0; i < runs; i++) rs.push(ctx.simShift(l, 1000 + i * 7919));
  const avg = k => (rs.reduce((a, r) => a + r[k], 0) / rs.length).toFixed(1);
  const scores = rs.map(r => r.score);
  console.log(`${rs[0].name.padEnd(14)} score avg ${avg('score').padStart(6)}  p10 ${String(pct(scores,.1)).padStart(4)}  p90 ${String(pct(scores,.9)).padStart(4)}  ` +
    `delivered ${avg('delivered')}  missed ${avg('missed')}  nightmares ${avg('nightmares')}  lost ${avg('lost')}  moons(now ${rs[0].thresholds.join('/')}) avg ${avg('moons')}`);
}
