// Builds the game into one self-contained page.
//   npm run build          -> dist/index.html (what Stateloop's source route serves)
//   npm run build -- --zip -> also dist-upload/nightloom-stateloop.zip (for a manual ZIP upload)
// It also writes dist-artifact/nightloom.html, the same page without the document skeleton,
// for publishing as a claude.ai artifact.
import {readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const out = p => new URL(`../${p}`, import.meta.url);
const JS = ['data.js','core.js','bot.js','render.js','input.js','audio.js','ui.js'];
const pkg = JSON.parse(readFileSync(out('package.json'), 'utf8'));

const head = `<title>Nightloom</title>
<meta name="description" content="A co-op night shift for two: Bramble and Flit weave dreams to order. Local two-player or solo with a bot partner.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gluten:wght@500;700;800&family=Figtree:wght@400;600;700&display=swap">
<style>
${src('style.css')}</style>`;
const body = `${src('shell.html')}<script>
/* Nightloom ${pkg.version}. Copyright (c) 2026 Jorrit Boumann. All rights reserved. */
(()=>{'use strict';
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
console.log(`dist/index.html  ${(page.length/1024).toFixed(1)} KB`);

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
