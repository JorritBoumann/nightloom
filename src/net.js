/* Nightloom online: the lobby, the connection, the keys and the drawing.
   Two people in two places play one shift on the Colyseus server. The server
   runs the game; this file sends one input frame per step, predicts the
   player's own movement and draws the server state (netcore.js).
   The offline modes do not use this file. */

const NET=(()=>{
  const CONSENT={version:'nightloom-online-consent-1',
    notice:'By joining a room you agree that the session is recorded as Stateloop play data. Please do not talk or chat with your partner while you play: no voice, no chat.'};
  const STORE='nightloom.online.v1';
  const ALPHA='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const N={view:'off',room:null,core:null,ap:null,input:null,acc:0,sig:'',msg:'',st:null,key:'',lastPatch:0,
    device:'keyboard',pads:{},hintT:0,intent:'',audioSig:'',clientT:0,leaving:false,autopilot:false};
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---- who plays: a stable player code, kept in this browser ---- */
  let prof={id:'',name:'',rating:null};
  try{const raw=localStorage.getItem(STORE);if(raw)prof=Object.assign(prof,JSON.parse(raw))}catch(e){}
  const saveProf=()=>{try{localStorage.setItem(STORE,JSON.stringify(prof))}catch(e){}};
  const newId=()=>{let s='';try{const a=new Uint32Array(8);crypto.getRandomValues(a);for(const v of a)s+=ALPHA[v%32]}catch(e){for(let i=0;i<8;i++)s+=ALPHA[Math.floor(Math.random()*32)]}return s};
  const normId=s=>String(s||'').toUpperCase().replace(/[^0-9A-Z]/g,'').replace(/[IL]/g,'1').replace(/O/g,'0').replace(/U/g,'V');
  const validId=s=>/^[0-9A-HJKMNP-TV-Z]{8}$/.test(s);
  if(!validId(prof.id)){prof.id=newId();saveProf()}
  const showId=id=>id.slice(0,4)+'-'+id.slice(4);

  /* ---- the server ---- */
  function serverUrl(){
    const built=typeof COOP_SERVER_URL_BUILT==='string'?COOP_SERVER_URL_BUILT:'';
    if(built)return built;
    try{return new URLSearchParams(location.search).get('COOP_SERVER_URL')||''}catch(e){return''}
  }
  N.available=()=>!!serverUrl()&&typeof Colyseus!=='undefined'&&!!Colyseus.Client;

  function clientInfo(){
    const ua=navigator.userAgent||'';
    const browser=/Firefox\//.test(ua)?'firefox':/Edg\//.test(ua)?'edge':/OPR\//.test(ua)?'opera':/Chrome\//.test(ua)?'chrome':/Safari\//.test(ua)?'safari':'other';
    const os=/iPhone|iPad|iPod/.test(ua)?'ios':/Android/.test(ua)?'android':/Windows/.test(ua)?'windows':/Mac OS X/.test(ua)?'macos':/CrOS/.test(ua)?'chromeos':/Linux/.test(ua)?'linux':'other';
    let r={width:0,height:0};try{r=cv.getBoundingClientRect()}catch(e){}
    return{build:typeof NIGHTLOOM_BUILD==='string'?NIGHTLOOM_BUILD:'',browser,os,mobile:/Mobile|Android|iPhone|iPad/.test(ua),
      css_w:Math.round(innerWidth),css_h:Math.round(innerHeight),canvas_w:Math.round(r.width),canvas_h:Math.round(r.height),
      dpr:window.devicePixelRatio||1,...audio()};
  }
  function audio(){return{audio_on:!!(save.settings.sfx&&AU.ac&&AU.ac.state==='running'),music_on:!!(save.settings.music&&AU.ac&&AU.ac.state==='running')}}

  /* ---- screens ---- */
  N.open=()=>{UI.mode='net';N.view='menu';N.msg='';if(!S||S.over)setupShift(1,{still:true});menu()};

  function menu(){
    N.view='menu';
    show(`<span class="eyebrow">Play online</span><h2>Two players, two places</h2>
      <label class="flow lbl">Your name <input class="field" id="nlName" maxlength="16" autocomplete="nickname" data-enter="quick" value="${esc(prof.name)}"></label>
      <p class="flow">Your player code is <b class="pcode">${showId(prof.id)}</b>. On another computer, type this code to stay the same player. <button type="button" class="small" id="nlCodeT">I have a code</button></p>
      <div class="btns" id="nlCodeBox" hidden><input class="field" id="nlCodeIn" maxlength="9" placeholder="XXXX-XXXX" data-enter="setcode"><button type="button" id="nlCodeSet">Use this code</button></div>
      <div class="btns"><button class="primary" type="button" id="nlQuick">Quick match</button><button type="button" id="nlCreate">Create a room</button><button type="button" id="nlBot">Play with the bot</button></div>
      <div class="btns"><input class="field codein" id="nlJoinCode" maxlength="4" placeholder="CODE" autocomplete="off" data-enter="join"><button type="button" id="nlJoin">Join a room</button></div>
      <p class="flow notice">${esc(CONSENT.notice)}</p>
      <p class="flow warn" id="nlMsg" aria-live="polite">${esc(N.msg)}</p>
      <div class="btns"><button type="button" id="nlBack">Back</button></div>`);
    const nm=$('nlName');
    nm.oninput=()=>{prof.name=nm.value.replace(/[<>]/g,'').slice(0,16);saveProf()};
    if(!prof.name)nm.focus();
    $('nlCodeT').onclick=()=>{$('nlCodeBox').hidden=false;$('nlCodeIn').focus()};
    $('nlCodeSet').onclick=A.setcode;
    $('nlQuick').onclick=A.quick;$('nlCreate').onclick=A.create;$('nlBot').onclick=A.bot;$('nlJoin').onclick=A.join;
    $('nlBack').onclick=()=>{N.view='off';titleScreen()};
  }
  const say=m=>{N.msg=m;const e=$('nlMsg');if(e)e.textContent=m};
  const A={
    setcode(){const v=normId($('nlCodeIn').value);if(!validId(v)){say('That code has 8 letters and digits, for example K7QX-M2PA.');return}prof.id=v;saveProf();N.msg='Player code changed.';menu()},
    quick(){join('quick')},create(){join('create')},bot(){join('bot')},
    join(){const c=($('nlJoinCode').value||'').trim().toUpperCase();if(!/^[A-Z]{4}$/.test(c)){say('A room code has 4 letters.');return}join('code',c)},
  };

  async function join(kind,code){
    if(!prof.name.trim()){say('Type your name first.');const nm=$('nlName');if(nm)nm.focus();return}
    if(N.room)return;
    initAudio();
    say('Connecting…');
    N.autopilot=typeof window!=='undefined'&&window.NIGHTLOOM_AUTOPILOT===true;
    const opts={name:prof.name.trim(),player_id:prof.id,consent:{version:CONSENT.version,at:new Date().toISOString()},
      client:clientInfo(),rating:prof.rating,bot:N.autopilot,controller:N.autopilot?'browser-autopilot@1':undefined};
    try{
      const c=new Colyseus.Client(serverUrl());
      let room;
      if(kind==='quick')room=await c.joinOrCreate('night',opts);
      else if(kind==='create')room=await c.create('night',{...opts,private:true});
      else if(kind==='bot')room=await c.create('night',{...opts,withBot:true});
      else room=await c.joinById(code,opts);
      attach(room);
    }catch(e){
      const m=String(e&&e.message||e);
      say(/not found|invalid|locked|full/i.test(m)?'No open room with that code.':'Could not connect. Try again in a moment. ('+m.slice(0,80)+')');
    }
  }

  function attach(room){
    N.room=room;N.core=makeNetCore();N.ap=N.autopilot?makeAutopilot():null;N.input=room.input();
    N.key='';N.sig='';N.view='room';N.msg='';N.acc=0;N.leaving=false;N.intent='';
    room.onStateChange(st=>{try{onState(st)}catch(e){console.error(e)}});
    room.onMessage('fx',list=>{for(const [n,...a] of list){const f=HOOK[n];if(typeof f==='function')try{f(...a)}catch(e){}}});
    room.onMessage('net:ping',m=>{if(!N.room)return;room.send('net:pong',{n:m.n,pending:N.core.pending.length,pvd:pvd(),corr:N.core.takeCorrections(),ct:Math.round(performance.now())})});
    room.onMessage('*',()=>{});
    room.onLeave(code=>{const was=N.leaving;N.room=null;N.core=null;N.st=null;N.view='menu';UI.mode='net';
      N.msg=was?'':'The connection to the room ended ('+code+').';if(!S||S.over)setupShift(1,{still:true});menu()});
    room.onError&&room.onError((code,m)=>console.warn('room error',code,m));
    addEventListener('resize',onResize);
  }
  let resizeT=0;
  function onResize(){clearTimeout(resizeT);resizeT=setTimeout(()=>{if(N.room)N.room.send('client',clientInfo())},500)}
  function pvd(){const me=N.st&&N.room&&N.st.players.get(N.room.sessionId);return Math.round(NETC.DELAY_MS+(me?me.rtt/2:0))}

  function onState(st){
    N.st=st;N.lastPatch=performance.now();
    const ph=st.phase,core=N.core;
    if((ph==='countdown'||ph==='playing')&&st.seed){
      const k=st.seed+':'+st.shift+':'+st.episode;
      if(k!==N.key){N.key=k;core.begin(st,N.room.sessionId);N.acc=0;sizeCanvas();FX.hints=[];if(N.ap)N.ap.reset()}
    }
    if(core.started&&(ph==='countdown'||ph==='playing'||ph==='ended'))core.mirror(st,performance.now());
    if(core.started){
      st.players.forEach((q,key)=>{const p=S.players[q.slot];if(!p)return;p.tag=key===N.room.sessionId?'you':q.kind==='server-bot'?'bot':q.name;p.color=q.slot===0?'#9bd47a':'#ffb3c7'});
      const me=st.players.get(N.room.sessionId);
      HUD.label=me?`Online as ${me.role==='flit'?'Flit':'Bramble'}`:'Online';
    }
    if(ph==='countdown'||ph==='playing'){if(!ov.hidden)hide();N.sig=''}
    else lobby(st);
  }

  /* ---- the room lobby (before a round and between rounds) ---- */
  const COMMS=[['none','No, we cannot talk'],['voice','We are on a voice or video call'],['same_room','We are in the same room'],['text','We have a text chat open']];
  function lobby(st){
    const sid=N.room.sessionId,me=st.players.get(sid);if(!me)return;
    const seats=[null,null];st.players.forEach((q,key)=>{seats[q.slot]={q,key}});
    const sig=JSON.stringify([st.botType,st.scripts,st.phase,st.code,seats.map(s=>s&&[s.key,s.q.name,s.q.kind,s.q.ready,s.q.comms,s.q.newcomer]),st.shift,st.suggest,st.outcome,st.score,st.swapped,st.episode,N.msg,prof.rating,save.settings.hints]);
    if(sig===N.sig&&!ov.hidden)return;N.sig=sig;
    const L=LEVELS[st.shift],ended=st.phase==='ended'&&st.episode>0;
    const seatHTML=(s,i)=>{const role=i===0?'Bramble':'Flit',cls=i===0?'b':'f';
      if(!s)return`<div class="who ${cls}"><h3>${role}</h3><p>Waiting for a partner…</p></div>`;
      const q=s.q,mine=s.key===sid;
      return`<div class="who ${cls}"><h3>${role}${mine?' <small>(you)</small>':''}</h3><p><b>${esc(q.kind==='server-bot'?(st.botType==='script'?'Bot partner':'Bot partner (game bot)'):q.name)}</b>${q.kind==='test-bot'?' (test bot)':''}</p><p>${q.ready?'Ready ✓':'Not ready'}</p></div>`};
    const chips=LEVELS.map((l,i)=>`<button type="button" class="chip${st.shift===i?' on':''}" data-i="${i}" aria-pressed="${st.shift===i}"><b>${i+1}</b> ${l.name}${st.suggest===i?' <small>next</small>':''}</button>`).join('');
    const alone=!seats[0]||!seats[1];
    const res=ended?`<h2>${esc(LEVELS[S&&S.L?S.lvl:st.shift].name)}: ${st.score} moonlight</h2>${moonHTML(st.moons)}
      <p>${st.delivered} dream${st.delivered===1?'':'s'} delivered, ${st.missed} sleeper${st.missed===1?'':'s'} woke up${st.nightmares?`, ${st.nightmares} nightmare${st.nightmares===1?'':'s'}`:''}.${st.reason!=='time_up'?' The round ended early.':''}</p>`:`<h2>${alone?'Waiting for your partner':'Ready when you are'}</h2>`;
    const commsQ=me.comms?'':`<p class="flow"><b>Before you play:</b> can you and your partner talk to each other now?</p><div class="btns">${COMMS.map(([v,t])=>`<button type="button" class="small" data-comms="${v}">${t}</button>`).join('')}</div>`;
    const rating=prof.rating?'':`<p class="flow">How often do you play video games? (optional)</p><div class="btns">${[1,2,3,4,5].map(n=>`<button type="button" class="small" data-rate="${n}">${['Never','Rarely','Monthly','Weekly','Daily'][n-1]}</button>`).join('')}</div>`;
    show(`<span class="eyebrow">Room code</span><div class="roomcode">${esc(st.code)}</div>
      ${alone&&!st.withBot?'<p class="flow">Give this code to your partner. They choose <b>Play online</b>, then <b>Join a room</b>.</p>':''}
      ${res}
      ${st.swapped?`<p class="flow"><b>Roles swapped.</b> You play ${me.role==='flit'?'Flit':'Bramble'} now. Roles swap after every two rounds.</p>`:''}
      <div class="seats">${seatHTML(seats[0],0)}${seatHTML(seats[1],1)}</div>
      <span class="eyebrow">Shift</span><div class="chips">${chips}</div>
      <p class="flow">${esc(L.blurb)}${seats.some(s=>s&&s.q.newcomer)?' A first round is Dusk, as a warm-up.':''}</p>
      ${commsQ}${rating}
      <div class="btns"><button type="button" class="primary" id="nlReady" ${me.comms?'':'disabled'}>${me.ready?'Not ready':'Ready'}</button>
        <button type="button" id="nlSwap">Swap roles</button>
        ${!seats[0]||!seats[1]||st.withBot?`<button type="button" id="nlBotT">${st.withBot?'Remove the bot':'Play with the bot'}</button>`:''}
        ${st.withBot&&st.scripts?`<button type="button" id="nlBotK">Bot: ${st.botType==='script'?'new bot':'game bot'}</button>`:''}
        <button type="button" id="nlHints">Hints in Dusk: ${save.settings.hints?'on':'off'}</button>
        <button type="button" id="nlLeave">Leave room</button></div>
      <p class="flow">${controls(me.role)} <b>No voice and no chat while you play.</b></p>
      <p class="flow warn" id="nlMsg" aria-live="polite">${esc(N.msg)}</p>`);
    for(const b of ov.querySelectorAll('.chip'))b.onclick=()=>{N.room.send('shift',{shift:+b.dataset.i})};
    for(const b of ov.querySelectorAll('[data-comms]'))b.onclick=()=>{N.room.send('comms',{value:b.dataset.comms})};
    for(const b of ov.querySelectorAll('[data-rate]'))b.onclick=()=>{prof.rating=+b.dataset.rate;saveProf();N.room.send('profile',{rating:prof.rating});N.sig='';lobby(st)};
    $('nlReady').onclick=()=>{initAudio();N.room.send('ready',{ready:!me.ready,hints:!!save.settings.hints,comms:me.comms||undefined,...audio()})};
    $('nlSwap').onclick=()=>N.room.send('swap',{});
    if($('nlBotT'))$('nlBotT').onclick=()=>N.room.send('bot',{on:!st.withBot});
    if($('nlBotK'))$('nlBotK').onclick=()=>N.room.send('botType',{type:st.botType==='script'?'jorrit':'script'});
    $('nlHints').onclick=()=>{save.settings.hints=!save.settings.hints;persist();N.sig='';lobby(st)};
    $('nlLeave').onclick=()=>{N.leaving=true;N.room.leave(true)};
  }
  const controls=role=>`You play <b class="${role==='flit'?'moth':'moss'}">${role==='flit'?'Flit':'Bramble'}</b>: move with W A S D or the arrows, grab with Space or Enter, ${role==='flit'?'wash or dash':'spin, wash or throw'} with Shift.`;

  /* ---- keys and pads ---- */
  N.keydown=e=>{
    const tg=e.target;
    if(tg&&(tg.tagName==='INPUT'||tg.tagName==='TEXTAREA')){
      if((e.code==='Enter'||e.code==='NumpadEnter')&&tg.dataset&&A[tg.dataset.enter]){e.preventDefault();A[tg.dataset.enter]()}
      return;
    }
    const st=N.st,live=st&&N.core&&N.core.started&&(st.phase==='playing'||st.phase==='countdown');
    if(!live){
      if((e.code==='Enter'||e.code==='Space')&&!e.repeat&&!ov.hidden){const b=document.activeElement;if(b&&ov.contains(b)&&b.tagName==='BUTTON'){e.preventDefault();b.click()}}
      return;
    }
    if(GAME_KEYS.has(e.code))e.preventDefault();
    Input.held.add(e.code);
    if(e.repeat||st.phase!=='playing')return;
    N.device='keyboard';
    if(KEYS.bramble.grab.includes(e.code)||KEYS.flit.grab.includes(e.code))N.core.press('g');
    if(KEYS.bramble.act.includes(e.code)||KEYS.flit.act.includes(e.code))N.core.press('a');
  };
  const anyHeld=list=>list.some(c=>Input.held.has(c));
  function heldInput(){
    const kb=KEYS.bramble,kf=KEYS.flit;
    let x=(anyHeld([...kb.right,...kf.right])?1:0)-(anyHeld([...kb.left,...kf.left])?1:0);
    let y=(anyHeld([...kb.down,...kf.down])?1:0)-(anyHeld([...kb.up,...kf.up])?1:0);
    let act=anyHeld([...kb.act,...kf.act]);
    if(N.pad){if(N.pad.x||N.pad.y){x=N.pad.x;y=N.pad.y}act=act||N.pad.act}
    return{x,y,act};
  }
  function pollPad(){
    let list=[];try{list=navigator.getGamepads?[...navigator.getGamepads()].filter(Boolean):[]}catch(e){list=[]}
    const gp=list[0];N.pad=null;if(!gp)return;
    const b=gp.buttons.map(v=>v.pressed),prev=N.pads[gp.index]||[];N.pads[gp.index]=b;
    const edge=n=>b[n]&&!prev[n];
    const playing=N.st&&N.st.phase==='playing';
    let x=gp.axes[0]||0,y=gp.axes[1]||0;if(Math.hypot(x,y)<.3){x=0;y=0}
    if(b[14])x=-1;if(b[15])x=1;if(b[12])y=-1;if(b[13])y=1;
    N.pad={x,y,act:!!(b[2]||b[1]||b[5])};
    if(x||y||b.some(Boolean))N.device='gamepad';
    if(!playing)return;
    if(edge(0))N.core.press('g');
    if(edge(2)||edge(1)||edge(5))N.core.press('a');
  }

  /* Test autopilot (only when a test page sets window.NIGHTLOOM_AUTOPILOT before
     joining; the seat is then a test bot). It presses real key events. */
  const AKEYS={r:'ArrowRight',l:'ArrowLeft',d:'ArrowDown',u:'ArrowUp',act:'ShiftRight',grab:'Enter'};
  const key=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,key:code,bubbles:true}));
  function autoKeys(out){
    const want={[AKEYS.r]:out.x>0,[AKEYS.l]:out.x<0,[AKEYS.d]:out.y>0,[AKEYS.u]:out.y<0,[AKEYS.act]:!!out.act};
    for(const [c,on] of Object.entries(want)){if(on&&!Input.held.has(c))key('keydown',c);else if(!on&&Input.held.has(c))key('keyup',c)}
    if(out.press==='g'){key('keydown',AKEYS.grab);key('keyup',AKEYS.grab)}
    if(out.press==='a'){if(Input.held.has(AKEYS.act))key('keyup',AKEYS.act);key('keydown',AKEYS.act);if(!out.act)key('keyup',AKEYS.act)}
  }

  function sendStep(){
    const core=N.core;
    if(N.ap){
      const out=N.ap.step(core.me(),core.pressAcked());
      autoKeys(out);
      const f=(N.ap.task&&N.ap.task.fetch)||'';if(f!==N.intent){N.intent=f;N.room.send('intent',{fetch:f})}
    }
    const f=core.frame(heldInput());
    const d=N.input.data;
    d.x=f.x;d.y=f.y;d.act=f.act;d.pn=f.pn;d.pk=f.pk;d.dev=N.device==='gamepad'?1:0;d.ct=Math.round(performance.now()*10)/10;
    core.sent(f,N.input.send());
  }

  /* Called by the main loop in ui.js while UI.mode is 'net'. */
  N.tick=dt=>{
    const now=performance.now(),st=N.st,core=N.core;
    pollPad();
    const playing=!!(st&&core&&core.started&&st.phase==='playing');
    if(playing){
      N.acc+=dt;let n=0;
      while(N.acc>=NETC.STEP&&n<6){N.acc-=NETC.STEP;n++;sendStep()}
      if(n>=6)N.acc=0;
      N.hintT-=dt;
      if(N.hintT<=0){
        N.hintT=.35;FX.hints=[];
        const me=core.me(),on=save.settings.hints&&S.L.hints&&!N.ap;
        if(me){const h=on?hintFor(me):null;me.hint=h?h.label:'';if(h&&h.tile)FX.hints.push({tile:h.tile,color:me.color})}
      }
    }else N.acc=0;
    if(core&&core.started){core.pose(now,dt);S.clock+=dt}
    else if(S)S.clock+=dt;
    N.clientT+=dt;
    if(N.clientT>1&&N.room){N.clientT=0;const a=JSON.stringify(audio());if(a!==N.audioSig){N.audioSig=a;N.room.send('client',audio())}}
    stepFx(dt);
    if(S)draw(!!(st&&core&&core.started&&(st.phase==='playing'||st.phase==='countdown')));
  };

  function focusEvent(kind){if(N.room&&N.st&&N.st.phase==='playing')N.room.send('net:focus',{kind,tick:S?S.tick:0,ct:Math.round(performance.now())})}
  addEventListener('blur',()=>focusEvent('blur'));
  addEventListener('focus',()=>focusEvent('focus'));
  document.addEventListener('visibilitychange',()=>focusEvent(document.hidden?'hidden':'visible'));

  N.profile=()=>({id:prof.id,name:prof.name});
  N.phase=()=>N.st?N.st.phase:(N.room?"joining":N.view);
  N.stats=()=>N.core?{pending:N.core.pending.length,ack:N.core.ack,pn:N.core.pn,slot:N.core.slot}:null;
  return N;
})();
