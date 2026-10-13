/* Screens, saved progress, the main loop and the Stateloop hand-off. */

const $=id=>document.getElementById(id);
const ov=$('overlay'),stage=$('stage');
const STEP=1/60;
const Q=new URLSearchParams(location.search);
const EMBEDDED=(()=>{if(Q.has('slLaunch'))return true;try{return window.top!==window}catch(e){return true}})();
const BASE_SEED=Q.has('seed')?(Number(Q.get('seed'))>>>0):null;
if(EMBEDDED)document.body.classList.add('embedded');

/* ---------- saved progress (per browser, optional) ---------- */
const STORE_KEY='nightloom.v1';
const save={best:{},settings:{hints:true,music:true,sfx:true}};
try{const raw=localStorage.getItem(STORE_KEY);if(raw){const d=JSON.parse(raw);Object.assign(save.best,d.best||{});Object.assign(save.settings,d.settings||{})}}catch(e){}
function persist(){try{localStorage.setItem(STORE_KEY,JSON.stringify(save))}catch(e){}}
const unlocked=i=>i===0||!!(save.best[LEVELS[i-1].id]&&save.best[LEVELS[i-1].id].moons>0);

/* ---------- state ---------- */
const UI={mode:'title',solo:false,as:'flit',start:0,run:[],pendingEnd:false,hintT:0,
  menuKey(e){
    if((e.code==='Enter'||e.code==='Space'||e.code==='NumpadEnter')&&!e.repeat&&!ov.hidden){
      const b=document.activeElement&&ov.contains(document.activeElement)&&document.activeElement.tagName==='BUTTON'?document.activeElement:ov.querySelector('button.primary');
      if(b){e.preventDefault();b.click()}
    }
    if((e.code==='Escape'||e.code==='KeyP')&&UI.mode==='paused'){e.preventDefault();resume()}
  },
  menuConfirm(){const b=ov.querySelector('button.primary');if(b&&!ov.hidden)b.click()},
  pause(){pause()}
};
HOOK.end=()=>{UI.pendingEnd=true};

function seedFor(i){return BASE_SEED===null?undefined:(BASE_SEED+i*7919)>>>0}
function setupShift(i,{demo=false,still=false}={}){
  newGame(i,{seed:demo?4242:seedFor(i),countdown:demo||still?0:3});
  Input.solo=UI.solo&&!demo;
  for(const p of S.players){
    p.tag='';p.hint='';p.actName=null;
    if(demo||(UI.solo&&p.kind!==UI.as)){makeBot(p);if(!demo)p.tag='partner'}
    else if(UI.solo){p.tag='you';p.actName='Shift'}
  }
  HUD.label=demo?'':UI.solo?`Solo as ${UI.as==='flit'?'Flit':'Bramble'}`:'Two players';
  sizeCanvas();FX.hints=[];
}

/* ---------- screens ---------- */
function show(html){ov.innerHTML=`<div class="card">${html}</div>`;ov.hidden=false;ov.classList.toggle('see-through',UI.mode==='title');
  const b=ov.querySelector('button.primary');if(b)b.focus({preventScroll:true})}
function hide(){ov.hidden=true;stage.focus({preventScroll:true})}
const icon=(()=>{const cache={};return it=>{const k=JSON.stringify(it);return cache[k]||(cache[k]=itemIcon(it))}})();
const recipeHTML=ids=>`<div class="recipes">${ids.map(id=>{const d=DREAMS[id];return`<span class="recipe"><b style="color:${d.color}">${d.name}</b>${d.items.map(k=>`<img alt="${k}" title="${k}" src="${icon({kind:k})}">`).join('')}</span>`}).join('')}</div>`;
const moonHTML=n=>`<span class="moons" aria-label="${n} of 3 moons">${[0,1,2].map(i=>`<span class="${i<n?'':'off'}">☾</span>`).join('')}</span>`;

function titleScreen(){
  UI.mode='title';
  if(EMBEDDED)setupShift(UI.start,{still:true});else setupShift(0,{demo:true});
  const chips=LEVELS.map((L,i)=>{const b=save.best[L.id],ok=unlocked(i);
    return`<button type="button" class="chip${UI.start===i?' on':''}" data-i="${i}" ${ok?'':'disabled'} aria-pressed="${UI.start===i}"><b>${i+1}</b> ${L.name}${b?` <small>${'☾'.repeat(b.moons)||'·'} ${b.score}</small>`:''}</button>`}).join('');
  show(`<span class="eyebrow">A co-op night shift for two</span><h1>Nightloom</h1>
    <p>High above the sleeping town, Bramble and Flit weave dreams to order. Fetch stars, spin wool into thread, brew the kettle, bottle the dream and send it down before the sleeper wakes.</p>
    <div class="btns"><button class="primary" type="button" id="duo">Two players</button><button type="button" id="solo">Solo with a bot partner</button></div>
    <div class="btns" id="who" hidden><span class="flow">Play as</span><button type="button" class="primary" id="asFlit">Flit</button><button type="button" id="asBramble">Bramble</button></div>
    <span class="eyebrow">Start at</span><div class="chips">${chips}</div>`);
  $('duo').onclick=()=>{initAudio();sfx('click');UI.solo=false;UI.run=[];intro(UI.start)};
  $('solo').onclick=()=>{initAudio();sfx('click');$('who').hidden=false;$('duo').classList.remove('primary');$('asFlit').focus()};
  $('asFlit').onclick=()=>{UI.solo=true;UI.as='flit';UI.run=[];intro(UI.start)};
  $('asBramble').onclick=()=>{UI.solo=true;UI.as='bramble';UI.run=[];intro(UI.start)};
  for(const b of ov.querySelectorAll('.chip'))b.onclick=()=>{UI.start=+b.dataset.i;for(const o of ov.querySelectorAll('.chip')){o.classList.toggle('on',o===b);o.setAttribute('aria-pressed',o===b)}};
}
function controlsLine(){
  if(!UI.solo)return`<p class="flow"><b class="moss">Bramble</b> W A S D, Space grabs, Left Shift spins, washes or throws. <b class="moth">Flit</b> arrows, Enter grabs, Right Shift washes or dashes.</p>`;
  return`<p class="flow">You play <b class="${UI.as==='flit'?'moth':'moss'}">${UI.as==='flit'?'Flit':'Bramble'}</b>. Move with W A S D or the arrows, grab with Space or Enter, ${UI.as==='flit'?'wash or dash':'spin, wash or throw'} with Shift. A bot plays ${UI.as==='flit'?'Bramble':'Flit'}.</p>`;
}
function intro(i){
  UI.mode='intro';setupShift(i);
  const L=S.L;
  show(`<span class="eyebrow">Shift ${i+1} of ${LEVELS.length}</span><h2>${L.name}</h2><p>${L.blurb}</p>
    <span class="eyebrow">Tonight's dreams</span>${recipeHTML(L.dreams)}
    <p class="flow">Wool goes on the loom to become thread. Put a whole dream's ingredients in a kettle and it starts to brew. Pour a ready kettle into a clean jar and drop the jar down the chute. Empty jars come back dirty at the hatch.</p>
    ${controlsLine()}
    <div class="btns"><button class="primary" type="button" id="go">Begin shift</button><button type="button" id="back">Back</button></div>`);
  $('go').onclick=()=>{initAudio();hide();UI.mode='play';UI.hintT=0};
  $('back').onclick=titleScreen;
}
function pause(){
  if(UI.mode!=='play')return;UI.mode='paused';Input.held.clear();
  show(`<h2>Paused</h2><p class="flow">The kettles wait for you. Press Esc or P to go on.</p>
    <div class="btns"><button class="primary" type="button" id="go">Resume</button><button type="button" id="restart">Restart shift</button><button type="button" id="quit">Quit to title</button></div>
    <div class="btns"><button type="button" id="hints">Hints in Dusk: ${save.settings.hints?'on':'off'}</button></div>`);
  $('go').onclick=resume;$('restart').onclick=()=>intro(S.lvl);$('quit').onclick=titleScreen;
  $('hints').onclick=()=>{save.settings.hints=!save.settings.hints;persist();$('hints').textContent=`Hints in Dusk: ${save.settings.hints?'on':'off'}`};
}
function resume(){hide();UI.mode='play'}
function endShift(){
  UI.mode='result';Input.held.clear();FX.hints=[];
  const L=S.L,m=moonsFor(S.score,L),prev=save.best[L.id],last=S.lvl===LEVELS.length-1;
  const isBest=!prev||S.score>prev.score;
  if(isBest)save.best[L.id]={score:S.score,moons:Math.max(m,prev?prev.moons:0)};else if(m>prev.moons)prev.moons=m;
  persist();
  UI.run[S.lvl]={name:L.name,score:S.score,moons:m};
  show(`<span class="eyebrow">Shift ${S.lvl+1} done</span><h2>${L.name}: ${S.score} moonlight</h2>${moonHTML(m)}
    <p>${S.delivered} dream${S.delivered===1?'':'s'} delivered, ${S.missed} sleeper${S.missed===1?'':'s'} woke up${S.nightmares?`, ${S.nightmares} nightmare${S.nightmares===1?'':'s'}`:''}. Best streak ${S.bestStreak}.</p>
    <p class="flow">Moons at ${L.moons.join(', ')}.${isBest&&prev?' New best for this shift.':''}${m===0?' The next shift opens after at least one moon.':''}</p>
    <div class="btns">${m>0?`<button class="primary" type="button" id="next">${last?'See the whole night':'Next shift'}</button><button type="button" id="retry">Retry shift</button>`:`<button class="primary" type="button" id="retry">Retry shift</button>`}<button type="button" id="quit">Title</button></div>`);
  $('retry').onclick=()=>intro(S.lvl);$('quit').onclick=titleScreen;
  if(m>0)$('next').onclick=()=>last?finalScreen():intro(S.lvl+1);
}
function finalScreen(){
  UI.mode='final';
  const run=UI.run.filter(Boolean),sum=run.reduce((a,t)=>a+t.score,0),mm=run.reduce((a,t)=>a+t.moons,0);
  show(`<span class="eyebrow">Dawn</span><h2>The town slept well</h2>
    <p>${run.map(t=>`${t.name}: ${t.score} ${'☾'.repeat(t.moons)}`).join(' · ')}</p>
    <p><span class="big">${sum} moonlight</span> and ${mm} of ${run.length*3} moons.</p>
    <div class="btns"><button class="primary" type="button" id="again">Play the night again</button></div>`);
  $('again').onclick=()=>{UI.start=0;titleScreen()};
  sessionComplete({game:'nightloom',shifts:run.length,moonlight:sum,moons:mm,mode:UI.solo?'solo':'duo'});
}
/* Tells the Stateloop play page that the session reached its natural end. */
function sessionComplete(detail){
  try{
    if(window.StateloopSession&&typeof window.StateloopSession.complete==='function')window.StateloopSession.complete(detail);
    else window.dispatchEvent(new CustomEvent('stateloop:session-complete',{detail}));
  }catch(e){}
}

/* ---------- top bar ---------- */
function syncToggles(){$('sfx').textContent=save.settings.sfx?'Sound on':'Sound off';$('music').textContent=save.settings.music?'Music on':'Music off';setSfx(save.settings.sfx);setMusic(save.settings.music)}
$('sfx').onclick=()=>{save.settings.sfx=!save.settings.sfx;persist();syncToggles();initAudio()};
$('music').onclick=()=>{save.settings.music=!save.settings.music;persist();initAudio();syncToggles()};
stage.addEventListener('pointerdown',()=>{if(UI.mode==='play')stage.focus({preventScroll:true})});

/* ---------- loop ---------- */
let acc=0,last=performance.now();
function frame(now){
  const dt=Math.min(.1,(now-last)/1000);last=now;
  tick(dt);
  requestAnimationFrame(frame);
}
function tick(dt){
  pollPads();
  const running=UI.mode==='play'||(UI.mode==='title'&&!EMBEDDED);
  if(running){
    acc+=dt;
    while(acc>=STEP){
      acc-=STEP;
      if(UI.mode==='play')applyHumanInput();
      for(const p of S.players)if(p.bot)botStep(p,STEP);
      update(STEP);
      if(UI.mode==='title'&&S.over)setupShift(0,{demo:true});
    }
  }else{acc=0;S.clock+=dt}
  if(UI.mode==='play'){
    UI.hintT-=dt;
    if(UI.hintT<=0){
      UI.hintT=.35;FX.hints=[];
      const on=save.settings.hints&&S.L.hints&&S.countdown<=0;
      for(const p of humans()){const h=on?hintFor(p):null;p.hint=h?h.label:'';if(h&&h.tile)FX.hints.push({tile:h.tile,color:p.color})}
    }
  }
  if(UI.pendingEnd){UI.pendingEnd=false;if(UI.mode==='play')endShift()}
  stepFx(dt);draw(UI.mode==='play');
}

syncToggles();
if(Q.has('mode')){UI.solo=Q.get('mode')==='solo';if(Q.get('as')==='bramble')UI.as='bramble'}
if(Q.has('shift')){const v=Q.get('shift'),i=LEVELS.findIndex((L,j)=>L.id===v||String(j+1)===v);if(i>=0)UI.start=i}
const boot=()=>{if(Q.has('shift'))intro(UI.start);else titleScreen();requestAnimationFrame(t=>{last=t;frame(t)})};
if(document.fonts&&document.fonts.load)Promise.race([Promise.all([document.fonts.load("700 22px Gluten"),document.fonts.load("600 12px Figtree")]),new Promise(r=>setTimeout(r,1500))]).then(boot,boot);else boot();

/* Test handle, only with ?debug=1 in the URL. */
if(Q.has('debug'))window.__nightloom={state:()=>S,ui:UI,finishShift:score=>{S.score=score;S.timeLeft=.02},run:sec=>{for(let i=0;i<sec*20;i++)tick(.05)}};
