/* Nightloom core simulation.
   No DOM access: the browser build and the headless simulator share this file.
   All randomness goes through S.rand so a seed replays the same shift. */

const HOOK = {sfx(){}, sparkle(){}, puff(){}, float(){}, shake(){}, orders(){}, end(){}, event(){}};
let S = null;

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const keyOf = a => a.slice().sort().join('+');
function dreamOf(items){const k=keyOf(items);for(const id in DREAMS)if(keyOf(DREAMS[id].items)===k)return id;return null}
function isSubset(a,b){const m={};for(const x of b)m[x]=(m[x]||0)+1;for(const x of a){if(!m[x])return false;m[x]--}return true}
function missingFrom(have,recipe){const m={};for(const x of have)m[x]=(m[x]||0)+1;const out=[];for(const x of recipe){if(m[x])m[x]--;else out.push(x)}return out}
const INGREDIENTS = ['thread','star','moondrop'];

function tileAt(x,y){return(x<0||y<0||x>=S.cols||y>=S.rows)?null:S.grid[y][x]}

function newGame(i,opt={}){
  const L=LEVELS[i];const rows=L.map.length,cols=L.map[0].length;
  const seed=opt.seed??((Math.random()*2**31)|0);
  S={L,lvl:i,rows,cols,seed,grid:[],kettles:[],players:[],orders:[],projs:[],returnQ:[],
     score:0,delivered:0,missed:0,nightmares:0,lost:0,streak:0,bestStreak:0,
     timeLeft:L.time,spawnT:7,lastDream:null,bridgeOn:true,bridgeT:0,
     wind:{dir:1,phase:'calm',t:0},countdown:opt.countdown??3,clock:0,tick:0,uid:0,
     rand:mulberry32(seed),jarsTile:null,returnTile:null,basinTile:null,over:false};
  for(let y=0;y<rows;y++){const r=[];for(let x=0;x<cols;x++){
    const type=CH[L.map[y][x]];
    const t={type,x,y,item:null,prog:0,count:0,dirty:0,k:null,seed:(x*73+y*151)%97};
    if(type==='kettle'){t.k={items:[],prog:0,need:0,state:'empty',grace:0,warned:false};S.kettles.push(t)}
    if(type==='jars'){t.count=L.jars;S.jarsTile=t}
    if(type==='return')S.returnTile=t;
    if(type==='basin')S.basinTile=t;
    r.push(t)}S.grid.push(r)}
  S.players=[mkP('bramble',L.p1),mkP('flit',L.p2)];
  spawnOrder();
  return S;
}
function mkP(kind,[x,y]){
  return{kind,x,y,fx:0,fy:kind==='bramble'?-1:1,held:null,dashT:0,dashCd:0,say:'',sayT:0,walk:0,
    working:false,moving:false,speed:kind==='bramble'?3.3:4.6,in:{x:0,y:0,act:false},bot:null,
    color:kind==='bramble'?'#9bd47a':'#ffb3c7',name:kind==='bramble'?'Bramble':'Flit'};
}

/* ---------- rules ---------- */
function walkable(t,kind){
  if(!t)return false;
  if(t.type==='floor')return true;
  if(t.type==='bridge')return S.bridgeOn||kind==='flit';
  if(t.type==='void')return kind==='flit';
  return false;
}
const isSurface=t=>!!t&&(t.type==='counter'||t.type==='floor'||(t.type==='bridge'&&S.bridgeOn));
const isSolid=t=>!!t&&t.type!=='floor'&&t.type!=='void'&&t.type!=='bridge';
function card(p){return Math.abs(p.fx)>Math.abs(p.fy)?[Math.sign(p.fx),0]:[0,Math.sign(p.fy)||1]}
function target(p){const[dx,dy]=card(p);return tileAt(Math.floor(p.x)+dx,Math.floor(p.y)+dy)}
function say(p,s){if(p.bot)return;if(p.say===s&&p.sayT>0.6)return;p.say=s;p.sayT=2.4}
const actKey=p=>p.kind==='bramble'?'Left Shift':'Right Shift';
const actLabel=p=>p.actName||actKey(p);

function grab(p){
  if(S.over||S.countdown>0)return;
  const t=target(p);if(!t)return;const h=p.held,F=p.kind==='flit';
  HOOK.event('grab',p,t);
  switch(t.type){
    case 'counter':case 'floor':case 'bridge':
      if(t.type==='bridge'&&!S.bridgeOn)return;
      if(!h&&t.item){p.held=t.item;t.item=null;HOOK.sfx('pick')}
      else if(h&&!t.item){t.item=h;p.held=null;HOOK.sfx('place')}
      return;
    case 'star':
      if(h)return say(p,'Hands full');
      if(!F)return say(p,'Stars slip through big paws. Flit can take them.');
      p.held={kind:'star'};HOOK.sfx('pick');return;
    case 'wool':if(h)return say(p,'Hands full');p.held={kind:'wool'};HOOK.sfx('pick');return;
    case 'moon':if(h)return say(p,'Hands full');p.held={kind:'moondrop'};HOOK.sfx('pick');return;
    case 'loom':
      if(!h&&t.item){p.held=t.item;t.item=null;t.prog=0;HOOK.sfx('pick')}
      else if(h&&!t.item){
        if(h.kind!=='wool')return say(p,'Only wool goes on the loom');
        t.item=h;p.held=null;t.prog=0;HOOK.sfx('place');
        say(p,F?'Bramble has to spin this':`Hold ${actLabel(p)} to spin`);
      }
      return;
    case 'kettle':return kettleGrab(p,t);
    case 'jars':
      if(!h){if(t.count>0){t.count--;p.held={kind:'jar',jar:'clean'};HOOK.sfx('pick')}else say(p,'No clean jars. Wash some at the basin.')}
      else if(h.kind==='jar'&&h.jar==='clean'){t.count++;p.held=null;HOOK.sfx('place')}
      return;
    case 'basin':
      if(h&&h.kind==='jar'&&h.jar==='dirty'){t.dirty++;p.held=null;HOOK.sfx('splash');say(p,`Hold ${actLabel(p)} to wash`)}
      else if(h)say(p,'The basin is for dirty jars');
      else if(t.dirty>0)say(p,`Hold ${actLabel(p)} to wash`);
      return;
    case 'return':
      if(!h&&t.count>0){t.count--;p.held={kind:'jar',jar:'dirty'};HOOK.sfx('pick')}
      return;
    case 'chute':
      if(h&&h.kind==='jar'&&h.jar==='dream'){if(deliver(h,t))p.held=null}
      else if(h)say(p,'Only bottled dreams go down the chute');
      return;
    case 'bin':
      if(!h)return;
      if(h.kind==='jar'){if(h.jar==='dream'){p.held={kind:'jar',jar:'dirty'};HOOK.sfx('trash');HOOK.puff(t.x+.5,t.y+.5,'#8a7fb0')}return}
      p.held=null;HOOK.sfx('trash');HOOK.puff(t.x+.5,t.y+.5,'#8a7fb0');return;
  }
}
/* A kettle fills until its mix makes a whole dream (or holds three things), then brews. */
const kettleOpen=k=>(k.state==='empty'||k.state==='filling')&&k.items.length<3;
function addToKettle(k,item){
  if(!INGREDIENTS.includes(item.kind)||!kettleOpen(k))return false;
  k.items.push(item.kind);
  if(dreamOf(k.items)||k.items.length>=3){k.state='brewing';k.prog=0;k.need=S.L.brew??6}
  else k.state='filling';
  return true;
}
function resetKettle(k){k.items=[];k.prog=0;k.need=0;k.state='empty';k.grace=0;k.warned=false}
function kettleGrab(p,t){
  const k=t.k,h=p.held;
  if(k.state==='nightmare'){
    if(h)return say(p,'Empty your hands to tip out the nightmare');
    resetKettle(k);HOOK.sfx('trash');HOOK.puff(t.x+.5,t.y+.5,'#5a2240');return;
  }
  if(!h){
    if(k.state==='ready')say(p,'Bring a clean jar');
    else if(k.state==='filling')say(p,`Add the rest of the dream. Wrong mix? ${actLabel(p)} tips it out`);
    else if(k.state==='brewing')say(p,'Still brewing');
    return;
  }
  if(h.kind==='jar'){
    if(h.jar!=='clean')return say(p,h.jar==='dirty'?'Wash this jar first':'This jar is full');
    if(k.state==='ready'){p.held={kind:'jar',jar:'dream',contents:k.items.slice()};resetKettle(k);HOOK.sfx('pour');HOOK.sparkle(t.x+.5,t.y+.5,'#ffffff',8)}
    else say(p,k.state==='brewing'?'Still brewing':k.state==='filling'?'Not a whole dream yet':'The kettle is empty');
    return;
  }
  if(h.kind==='wool')return say(p,'Spin the wool on the loom first');
  if(addToKettle(k,h)){p.held=null;HOOK.sfx('place')}
  else say(p,k.state==='ready'?'Bottle it first':'The kettle is full');
}
function actDown(p){
  if(S.over||S.countdown>0)return;
  const t=target(p);
  HOOK.event('act',p,t);
  if(t&&t.type==='loom'&&t.item&&t.item.kind==='wool'){if(p.kind==='flit')say(p,'Too heavy for Flit. Bramble spins the loom.');return}
  if(t&&t.type==='basin'&&t.dirty>0&&!p.held)return;
  if(t&&t.type==='kettle'&&!p.held&&t.k.state!=='empty'){resetKettle(t.k);HOOK.sfx('trash');HOOK.puff(t.x+.5,t.y+.5,'#5a2240');return}
  if(p.kind==='bramble'){if(p.held)throwItem(p)}
  else if(p.dashCd<=0){p.dashT=.2;p.dashCd=.9;HOOK.sfx('dash');HOOK.sparkle(p.x,p.y,'#ffd9e4',6)}
}
function throwItem(p){
  const[dx,dy]=card(p);
  S.projs.push({item:p.held,x:p.x+dx*.3,y:p.y+dy*.3,dx,dy,dist:0,max:5,lx:Math.floor(p.x),ly:Math.floor(p.y),thrower:p.kind,spin:0});
  p.held=null;HOOK.sfx('throw');
}
function canAccept(t,item){
  switch(t.type){
    case 'counter':return !t.item;
    case 'kettle':return INGREDIENTS.includes(item.kind)&&kettleOpen(t.k);
    case 'loom':return !t.item&&item.kind==='wool';
    case 'jars':return item.kind==='jar'&&item.jar==='clean';
    case 'basin':return item.kind==='jar'&&item.jar==='dirty';
    case 'chute':return item.kind==='jar'&&item.jar==='dream'&&S.orders.some(o=>keyOf(DREAMS[o.id].items)===keyOf(item.contents));
    case 'bin':return !(item.kind==='jar'&&item.jar!=='dream');
  }
  return false;
}
function accept(t,item){
  if(!canAccept(t,item))return false;
  switch(t.type){
    case 'counter':t.item=item;return true;
    case 'kettle':return addToKettle(t.k,item);
    case 'loom':t.item=item;t.prog=0;return true;
    case 'jars':t.count++;return true;
    case 'basin':t.dirty++;return true;
    case 'chute':return deliver(item,t);
    case 'bin':if(item.kind==='jar')S.returnQ.push(6);HOOK.puff(t.x+.5,t.y+.5,'#8a7fb0');HOOK.sfx('trash');return true;
  }
  return false;
}
function landAt(tx,ty,item){
  const t=tileAt(tx,ty);
  const free=n=>n&&(n.type==='floor'||(n.type==='bridge'&&S.bridgeOn))&&!n.item;
  if(t&&(t.type==='floor'||(t.type==='bridge'&&S.bridgeOn))){
    if(free(t)){t.item=item;HOOK.sfx('place');return}
    for(const[ax,ay]of[[1,0],[-1,0],[0,1],[0,-1]]){const n=tileAt(tx+ax,ty+ay);if(free(n)){n.item=item;HOOK.sfx('place');return}}
  }
  lose(item,tx+.5,ty+.5);
}
function lose(item,x,y){
  S.lost++;
  if(item.kind==='jar')S.returnQ.push(8);
  HOOK.float('Lost to the sky',x,y,'#a79cc9',14);HOOK.puff(x,y,'#3a3170');HOOK.sfx('trash');
}
function deliver(item,t){
  const k=keyOf(item.contents);let best=null;
  for(const o of S.orders)if(keyOf(DREAMS[o.id].items)===k&&(!best||o.left<best.left))best=o;
  if(!best){HOOK.float('Nobody ordered that',t.x+.5,t.y+.8,'#ff5c8a',14);HOOK.sfx('bad');return false}
  const tip=Math.round(10*best.left/best.life),bonus=Math.min(S.streak,4)*3,pts=20+tip+bonus;
  S.score+=pts;S.delivered++;S.streak++;S.bestStreak=Math.max(S.bestStreak,S.streak);
  S.orders.splice(S.orders.indexOf(best),1);
  HOOK.float(bonus?`+${pts}  streak ×${S.streak}`:`+${pts}`,t.x+.5,t.y+.9,'#f4c96b',22);
  HOOK.sparkle(t.x+.5,t.y+.5,DREAMS[best.id].color,22);HOOK.sfx('good');
  HOOK.event('deliver',best.id,pts);
  S.returnQ.push(5);HOOK.orders();return true;
}
function spawnOrder(){
  const pool=S.L.dreams.filter(d=>d!==S.lastDream||S.L.dreams.length===1);
  const id=pool[Math.floor(S.rand()*pool.length)];S.lastDream=id;
  S.orders.push({id,life:S.L.life,left:S.L.life,uid:++S.uid});HOOK.orders();
}

/* ---------- movement ---------- */
const RADIUS={bramble:.34,flit:.26};
function canStand(kind,x,y){
  const r=RADIUS[kind];
  if(x<r||y<r||x>S.cols-r||y>S.rows-r)return false;
  for(const[dx,dy]of[[-r,-r],[r,-r],[-r,r],[r,r]])if(!walkable(tileAt(Math.floor(x+dx),Math.floor(y+dy)),kind))return false;
  return true;
}
function overlapsType(p,type){
  const r=RADIUS[p.kind];
  return[[-r,-r],[r,-r],[-r,r],[r,r]].some(([dx,dy])=>{const t=tileAt(Math.floor(p.x+dx),Math.floor(p.y+dy));return t&&t.type===type});
}
function tryMove(p,mx,my){
  const sp=Math.max(Math.abs(mx),Math.abs(my));
  if(mx){const nx=p.x+mx;if(canStand(p.kind,nx,p.y))p.x=nx;else if(Math.abs(my)<1e-6){const cy=Math.floor(p.y)+.5,d=cy-p.y;if(Math.abs(d)>.02)p.y+=Math.sign(d)*Math.min(Math.abs(d),sp)}}
  if(my){const ny=p.y+my;if(canStand(p.kind,p.x,ny))p.y=ny;else if(Math.abs(mx)<1e-6){const cx=Math.floor(p.x)+.5,d=cx-p.x;if(Math.abs(d)>.02)p.x+=Math.sign(d)*Math.min(Math.abs(d),sp)}}
}

/* ---------- step ---------- */
function update(dt){
  S.clock+=dt;
  if(S.over)return;
  if(S.countdown>0){S.countdown-=dt;if(S.countdown<=0){S.countdown=0;HOOK.sfx('go')}return}
  S.tick++;
  const L=S.L;
  if(L.wind){
    const w=S.wind;w.t+=dt;const dur=L.wind[w.phase];
    if(w.t>=dur){w.t=0;w.phase=w.phase==='calm'?'warn':w.phase==='warn'?'gust':'calm';if(w.phase==='warn'){w.dir=S.rand()<.5?-1:1;HOOK.sfx('wind')}}
  }
  for(const p of S.players){
    p.dashT=Math.max(0,p.dashT-dt);p.dashCd=Math.max(0,p.dashCd-dt);p.sayT=Math.max(0,p.sayT-dt);
    let ix=p.in.x,iy=p.in.y;const m=Math.hypot(ix,iy);
    if(m>1){ix/=m;iy/=m}
    p.moving=m>.2;
    if(p.moving){const n=Math.hypot(ix,iy);p.fx=ix/n;p.fy=iy/n;p.walk+=dt*(p.kind==='bramble'?9:14)}else{ix=0;iy=0}
    const sp=p.speed*(p.dashT>0?2.4:1)*dt;
    tryMove(p,ix*sp,iy*sp);
    if(L.wind&&S.wind.phase==='gust'){const nx=p.x+(L.wind[p.kind])*S.wind.dir*dt;if(canStand(p.kind,nx,p.y))p.x=nx}
    p.working=false;
    if(p.in.act){
      const t=target(p);
      if(t&&t.type==='loom'&&p.kind==='bramble'&&t.item&&t.item.kind==='wool'){
        t.prog+=dt/2.2;p.working=true;
        if(t.prog>=1){t.item={kind:'thread'};t.prog=0;HOOK.sfx('done');HOOK.sparkle(t.x+.5,t.y+.5,'#c7a8ff',10)}
      }else if(t&&t.type==='basin'&&t.dirty>0&&!p.held){
        t.prog+=dt/(p.kind==='flit'?1.6:2.1);p.working=true;
        if(t.prog>=1){t.dirty--;t.prog=0;if(S.jarsTile)S.jarsTile.count++;HOOK.sfx('done');HOOK.sparkle(t.x+.5,t.y+.5,'#bfe9ff',8)}
      }
    }
  }
  for(const t of S.kettles){
    const k=t.k;
    if(k.state==='brewing'){k.prog+=dt;if(k.prog>=k.need){k.state='ready';k.grace=L.grace;HOOK.sfx('done')}}
    else if(k.state==='ready'){
      k.grace-=dt;
      if(k.grace<4&&!k.warned){k.warned=true;HOOK.sfx('warn')}
      if(k.grace<=0){k.state='nightmare';S.nightmares++;S.score=Math.max(0,S.score-5);HOOK.sfx('nightmare');HOOK.puff(t.x+.5,t.y+.5,'#5a2240');HOOK.float('Nightmare! −5',t.x+.5,t.y+.4,'#ff5c8a',18)}
    }
  }
  for(let i=S.projs.length-1;i>=0;i--){
    const pr=S.projs[i];let move=10*dt,done=false;pr.spin+=dt*14;
    while(move>0&&!done){
      const st=Math.min(.1,move);move-=st;pr.x+=pr.dx*st;pr.y+=pr.dy*st;pr.dist+=st;
      const f=S.players[1];
      if(!f.held&&pr.thrower!=='flit'&&Math.hypot(f.x-pr.x,f.y-pr.y)<.55){f.held=pr.item;HOOK.sfx('catch');HOOK.float('Caught!',f.x,f.y-.6,'#ffb3c7',16);done=true;break}
      const tx=Math.floor(pr.x),ty=Math.floor(pr.y),t=tileAt(tx,ty);
      if(!t){lose(pr.item,pr.x,pr.y);done=true;break}
      if(isSolid(t)){if(accept(t,pr.item))HOOK.sfx('place');else landAt(pr.lx,pr.ly,pr.item);done=true;break}
      pr.lx=tx;pr.ly=ty;
      if(pr.dist>=pr.max){landAt(tx,ty,pr.item);done=true}
    }
    if(done)S.projs.splice(i,1);
  }
  if(L.bridge){
    S.bridgeT+=dt;const period=S.bridgeOn?L.bridge.on:L.bridge.off;
    if(S.bridgeT>=period&&!(S.bridgeOn&&overlapsType(S.players[0],'bridge'))){
      S.bridgeOn=!S.bridgeOn;S.bridgeT=0;HOOK.sfx('bridge');
      if(!S.bridgeOn)for(const r of S.grid)for(const t of r)if(t.type==='bridge'&&t.item){lose(t.item,t.x+.5,t.y+.5);t.item=null}
    }
  }
  for(let i=S.returnQ.length-1;i>=0;i--){S.returnQ[i]-=dt;if(S.returnQ[i]<=0){S.returnQ.splice(i,1);if(S.returnTile)S.returnTile.count++}}
  for(let i=S.orders.length-1;i>=0;i--){const o=S.orders[i];o.left-=dt;if(o.left<=0){S.orders.splice(i,1);S.missed++;S.streak=0;S.score=Math.max(0,S.score-10);HOOK.shake(.35);HOOK.sfx('bad');HOOK.event('expire',o.id);HOOK.orders()}}
  S.spawnT-=dt;if(S.spawnT<=0){if(S.orders.length<4)spawnOrder();S.spawnT=S.orders.length<=1?L.spawn*.45:L.spawn}
  S.timeLeft-=dt;if(S.timeLeft<=0){S.timeLeft=0;S.over=true;HOOK.end()}
}
function moonsFor(score,L){return L.moons.filter(s=>score>=s).length}
