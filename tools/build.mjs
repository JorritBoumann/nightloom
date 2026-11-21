// Builds the game into one self-contained page.
//   npm run build          -> dist/index.html (what Stateloop's source route serves)
//   npm run build -- --zip -> also dist-upload/nightloom-stateloop.zip (for a manual ZIP upload)
// It also writes dist-artifact/nightloom.html, the same page without the document skeleton,
// for publishing as a claude.ai artifact.
//
// Online play: set COOP_SERVER_URL (wss://...) when you build, and run `npm ci` first so
// the Colyseus browser client (node_modules/@colyseus/sdk/dist/colyseus.js) can be inlined.
// Without COOP_SERVER_URL the title screen has no "Play online" button (unless the page
// gets ?COOP_SERVER_URL=ws://... in development); without the client the page is offline only.
import {readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const out = p => new URL(`../${p}`, import.meta.url);
const JS = ['data.js','core.js','bot.js','render.js','input.js','audio.js','netcore.js','net.js','ui.js'];
const pkg = JSON.parse(readFileSync(out('package.json'), 'utf8'));

const SERVER_URL = (process.env.COOP_SERVER_URL || '').trim();
if (SERVER_URL && !/^wss?:\/\/[^\s"'<>]+$/.test(SERVER_URL)) throw new Error(`COOP_SERVER_URL must be a ws:// or wss:// address, got ${JSON.stringify(SERVER_URL)}`);
let BUILD_ID = process.env.NIGHTLOOM_BUILD || '';
if (!BUILD_ID) { try { BUILD_ID = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { BUILD_ID = pkg.version; } }
const SDK_FILE = out('node_modules/@colyseus/sdk/dist/colyseus.js');
const SDK = existsSync(SDK_FILE) ? readFileSync(SDK_FILE, 'utf8').replace(/<\/(script)/gi, '<\\/$1') : '';
if (!SDK) console.warn('warning: node_modules/@colyseus/sdk is missing (run npm ci); this build has no online play');

const head = `<title>Nightloom</title>
<meta name="description" content="A co-op night shift for two: Bramble and Flit weave dreams to order. Local two-player or solo with a bot partner.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gluten:wght@500;700;800&family=Figtree:wght@400;600;700&display=swap">
<style>
${src('style.css')}</style>`;
const sdkTag = SDK ? `<script>
/* Colyseus browser client (MIT licence), from @colyseus/sdk */
${SDK}
</script>\n` : '';
const body = `${src('shell.html')}${sdkTag}<script>
/* Nightloom ${pkg.version}. Copyright (c) 2026 Jorrit Boumann. All rights reserved. */
(()=>{'use strict';
const COOP_SERVER_URL_BUILT=${JSON.stringify(SDK ? SERVER_URL : '')},NIGHTLOOM_BUILD=${JSON.stringify(BUILD_ID)};
${JS.map(f => `/* ---- ${f} ---- */\n${src(f)}`).join('\n')}
})();
</script>`;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
${head}
</head>
<body>
${body}
</body>
</html>
`;

rmSync(out('dist'), {recursive:true, force:true});
mkdirSync(out('dist'), {recursive:true});
writeFileSync(out('dist/index.html'), page);
mkdirSync(out('dist-artifact'), {recursive:true});
writeFileSync(out('dist-artifact/nightloom.html'), `${head}\n${body}\n`);
console.log(`dist/index.html  ${(page.length/1024).toFixed(1)} KB  build ${BUILD_ID}${SERVER_URL && SDK ? `  online: ${SERVER_URL}` : SDK ? '  online: no server URL' : '  offline only'}`);

if (process.argv.includes('--zip')) {
  const stage = out('dist-upload/stage/');
  rmSync(out('dist-upload'), {recursive:true, force:true});
  mkdirSync(stage, {recursive:true});
  copyFileSync(out('dist/index.html'), new URL('index.html', stage));
  writeFileSync(new URL('stateloop-game.json', stage), JSON.stringify({
    entrypoint: 'index.html', engine: 'HTML5', controls: ['Keyboard', 'Gamepad'],
    players: {local: 2, solo: true},
    keyMap: {bramble: ['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft'], flit: ['ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Enter','ShiftRight']}
  }, null, 2) + '\n');
  execFileSync('zip', ['-q', '-X', '../nightloom-stateloop.zip', 'index.html', 'stateloop-game.json'], {cwd: stage});
  rmSync(stage, {recursive:true, force:true});
  console.log('dist-upload/nightloom-stateloop.zip');
}
