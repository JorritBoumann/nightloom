/* Nightloom online, the part without DOM: it copies the server state into the
   local S that render.js draws, predicts the local player's own movement, and
   builds the input frames. The browser (net.js) and the Node test bots
   (server/test/bots.mjs) share it. The server decides everything; nothing here
   changes the outcome of a shift. */

const NETC={STEP:1/60,DELAY_MS:100,SNAP_TILES:1.5};

function itemFromCode(c){
  if(!c)return null;
  const [kind,jar,contents]=c.split(':');
  if(kind!=='jar')return{kind};
  const it={kind:'jar',jar};if(contents)it.contents=contents.split('+');return it;
}

/* The local player's movement. The same lines as the start of update() in
   core.js, for one player and one step. Prediction only. */
function predictMove(p,inp){
  const dt=NETC.STEP;
  p.dashT=Math.max(0,p.dashT-dt);p.dashCd=Math.max(0,p.dashCd-dt);
  let ix=inp.x,iy=inp.y;const m=Math.hypot(ix,iy);
  if(m>1){ix/=m;iy/=m}
  p.moving=m>.2;
  if(p.moving){const n=Math.hypot(ix,iy);p.fx=ix/n;p.fy=iy/n;p.walk=(p.walk||0)+dt*(p.kind==='bramble'?9:14)}else{ix=0;iy=0}
  const sp=p.speed*(p.dashT>0?2.4:1)*dt;
  tryMove(p,ix*sp,iy*sp);
  if(S.L.wind&&S.wind.phase==='gust'){const nx=p.x+(S.L.wind[p.kind])*S.wind.dir*dt;if(canStand(p.kind,nx,p.y))p.x=nx}
}
/* A guess of the dash that actDown() would start for Flit. The server decides. */
function predictPress(p,k){
  if(k!=='a'||p.kind!=='flit'||p.dashCd>0)return;
  const t=target(p);
  if(t&&t.type==='loom'&&t.item&&t.item.kind==='wool')return;
  if(t&&t.type==='basin'&&t.dirty>0&&!p.held)return;
  if(t&&t.type==='kettle'&&!p.held&&t.k.state!=='empty')return;
  p.dashT=.2;p.dashCd=.9;
}

function makeNetCore(){
  const C={
    sid:'',slot:-1,episode:0,started:false,
    ghost:null,            // predicted pose of the local player
    pending:[],            // sent frames the server has not consumed yet
    pn:0,pk:0,queue:'',lastPressSeq:0,ack:0,
    off:{x:0,y:0},
    snaps:[],              // [{t, players:[{x,y}|null,...], projs: Map}] for interpolation
    names:['',''],kinds:['',''],
    corr:[],               // forecast corrections: [server tick, size in tiles]
  };

  /* A new board for an episode (the server sends shift and seed at the countdown). */
  C.begin=function(st,sid){
    newGame(st.shift,{seed:st.seed,countdown:0});
    for(const p of S.players){p.tag='';p.hint='';p.actName='Shift'}
    C.sid=sid;C.started=true;C.pending=[];C.queue='';C.snaps=[];C.off={x:0,y:0};C.ack=0;
    C.slot=-1;C.ghost=null;
    const me=st.players.get?st.players.get(sid):st.players[sid];
    if(me){C.slot=me.slot;C.ack=me.ack}
    C.mirror(st,0);
    if(C.slot>=0){const p=S.players[C.slot];C.ghost={kind:p.kind,speed:p.speed,x:p.x,y:p.y,fx:p.fx,fy:p.fy,dashT:0,dashCd:0,moving:false,walk:0,held:p.held}}
  };

  /* Copy the latest server state into S. Runs on every patch. */
  C.mirror=function(st,now){
    if(!S||!C.started)return;
    S.tick=st.tick;S.score=st.score;S.delivered=st.delivered;S.missed=st.missed;S.nightmares=st.nightmares;S.lost=st.lost;
    S.streak=st.streak;S.bestStreak=st.bestStreak;S.timeLeft=st.timeLeft;
    S.bridgeOn=st.bridgeOn;S.bridgeT=st.bridgeT;S.wind.phase=st.windPhase;S.wind.dir=st.windDir;S.wind.t=st.windT;
    S.over=st.phase==='ended';
    S.countdown=st.phase==='countdown'?st.countdown:0;
    const seen=new Set(),projs=new Map();
    st.objects.forEach((o,key)=>{
      if(o.type==='proj'){projs.set(key,{x:o.x,y:o.y,item:o.item,dx:o.dx,dy:o.dy,spin:o.spin,thrower:o.thrower});return}
      const x=Math.floor(o.x),y=Math.floor(o.y),t=S.grid[y]&&S.grid[y][x];if(!t)return;
      seen.add(t);
      if(t.itemCode!==o.item){t.item=itemFromCode(o.item);t.itemCode=o.item}
      t.prog=o.prog;t.count=o.count;t.dirty=o.dirty;
      if(t.k){const k=t.k;k.state=o.kstate;k.prog=o.kprog;k.need=o.kneed;k.grace=o.kgrace;k.warned=o.kwarned;
        const items=[];o.kitems.forEach(v=>items.push(v));if(items.join()!==k.items.join())k.items=items}
    });
    for(const r of S.grid)for(const t of r)if(t.item&&!seen.has(t)){t.item=null;t.itemCode=''}
    const old=new Map(S.orders.map(o=>[o.uid,o]));S.orders=[];
    st.goals.forEach(g=>{const o=old.get(g.uid)||{id:g.dream,uid:g.uid,life:g.life,left:g.left};o.left=g.left;S.orders.push(o)});
    const pl=[null,null];
    st.players.forEach((q,key)=>{
      const p=S.players[q.slot];if(!p)return;
      pl[q.slot]={x:q.x,y:q.y};
      if(p.heldCode!==q.held){p.held=itemFromCode(q.held);p.heldCode=q.held}
      p.working=q.working;p.say=q.say;p.sayT=q.sayT;
      C.names[q.slot]=q.name;C.kinds[q.slot]=q.kind;
      if(key===C.sid){
        C.slot=q.slot;
        if(C.ghost){C.ghost.held=p.held;C.tickNow=st.tick;C.reconcile(q)}
      }else{p.fx=q.fx;p.fy=q.fy;p.dashT=q.dashT;p.moving=q.moving;
        // bot.js reads a partner bot's task (supplyOf, otherFetching); only bot seats fill intent
        p.bot={task:q.intent?{fetch:q.intent}:null}}
    });
    C.snaps.push({t:now,players:pl,projs});
    while(C.snaps.length>2&&now-C.snaps[1].t>1000)C.snaps.shift();
  };

  /* Server pose + frames it has not consumed yet = the predicted pose. */
  C.reconcile=function(q){
    const g=C.ghost,ox=g.x,oy=g.y;
    C.ack=q.ack;
    g.x=q.x;g.y=q.y;g.fx=q.fx;g.fy=q.fy;g.dashT=q.dashT;g.dashCd=q.dashCd;
    C.pending=C.pending.filter(f=>f.seq>q.ack);
    for(const f of C.pending){for(const k of f.pr)predictPress(g,k);predictMove(g,f)}
    const size=Math.hypot(ox-g.x,oy-g.y);
    if(size>.01&&C.corr.length<240)C.corr.push([C.tickNow,Math.round(size*1000)/1000]);
    C.off.x+=ox-g.x;C.off.y+=oy-g.y;
    if(Math.hypot(C.off.x,C.off.y)>NETC.SNAP_TILES)C.off={x:0,y:0};
  };

  C.press=function(k){C.queue+=k};
  C.takeCorrections=function(){const c=C.corr;C.corr=[];return c};

  /* One input frame for this step (held keys plus the presses since the last frame). */
  C.frame=function(held){
    const pr=C.queue.slice(-8);C.queue='';
    for(const k of pr){C.pn=(C.pn+1)&0xffff;C.pk=((C.pk<<1)|(k==='a'?1:0))>>>0}
    return{x:Math.fround(held.x||0),y:Math.fround(held.y||0),act:!!held.act,pn:C.pn,pk:C.pk,pr,seq:0};
  };
  /* After the frame went out: remember it and move the ghost. */
  C.sent=function(f,seq){
    f.seq=seq;if(!seq)return;
    if(f.pr)C.lastPressSeq=seq;
    C.pending.push(f);if(C.pending.length>240)C.pending.shift();
    if(C.ghost){for(const k of f.pr)predictPress(C.ghost,k);predictMove(C.ghost,f)}
  };
  C.pressAcked=function(){return C.ack>=C.lastPressSeq};

  /* Put the drawn poses into S: own player predicted, partner and items in flight interpolated. */
  C.pose=function(now,dt){
    if(!S||!C.started)return;
    const k=Math.exp(-dt*12);C.off.x*=k;C.off.y*=k;
    const rt=now-NETC.DELAY_MS,sn=C.snaps;
    let a=sn[sn.length-1],b=a,f=0;
    for(let i=sn.length-1;i>0;i--){if(sn[i-1].t<=rt){a=sn[i-1];b=sn[i];f=b.t>a.t?Math.min(1,Math.max(0,(rt-a.t)/(b.t-a.t))):1;break}}
    S.players.forEach((p,i)=>{
      if(i===C.slot&&C.ghost){const g=C.ghost;p.x=g.x+C.off.x;p.y=g.y+C.off.y;p.fx=g.fx;p.fy=g.fy;p.dashT=g.dashT;p.moving=g.moving;p.walk=g.walk;return}
      const pa=a&&a.players[i],pb=b&&b.players[i];
      if(pa&&pb){p.x=pa.x+(pb.x-pa.x)*f;p.y=pa.y+(pb.y-pa.y)*f}
      if(p.moving)p.walk=(p.walk||0)+dt*(p.kind==='bramble'?9:14);
    });
    const list=[];
    if(b)b.projs.forEach((q,key)=>{const qa=a&&a.projs.get(key)||q;
      list.push({x:qa.x+(q.x-qa.x)*f,y:qa.y+(q.y-qa.y)*f,item:itemFromCode(q.item),spin:q.spin,dx:q.dx,dy:q.dy,thrower:q.thrower})});
    S.projs=list;
  };

  /* The predicted pose for decisions (no smoothing offset). */
  C.me=function(){
    if(C.slot<0)return null;
    const p=S.players[C.slot],g=C.ghost;
    if(g){p.x=g.x;p.y=g.y;p.fx=g.fx;p.fy=g.fy;p.dashT=g.dashT;p.dashCd=g.dashCd}
    return p;
  };
  return C;
}

/* Test autopilot: plays the local seat with the game's own planner (plan() in
   bot.js), at key level, through the same input frames as a person. Only the
   Node test bots and browser tests use it, and those join with {bot:true}, so
   their seats are recorded as bots. */
function makeAutopilot(){
  const A={task:null,cool:0,pi:0,t:0,stuck:0,lx:0,ly:0,waits:0};
  const dir=(d,eps)=>Math.abs(d)>eps?Math.sign(d):0;
  A.reset=function(){A.task=null;A.cool=0;A.waits=0};
  /* plan() can wait for ever (Bramble holds wool while the loom holds wool).
     Two bots avoid that offline by reading each other's task at the same step;
     over the network they decide at the same time. After a wait that timed out,
     set the held item down on the nearest free counter. */
  const setDown=p=>{
    const F=bfs(p.kind,Math.floor(p.x),Math.floor(p.y));let best=null;
    for(const r of S.grid)for(const t of r){if(t.type!=='counter'||t.item)continue;const st=reach(F,t);if(st&&(!best||st.cost<best.stand.cost))best={tile:t,action:'grab',stand:st,label:'Set it down (unstick)'}}
    if(best)best.path=pathFrom(F,best.stand.sx,best.stand.sy);
    return best;
  };
  A.step=function(p,acked){
    const out={x:0,y:0,act:false,press:''};
    if(!p||S.over||S.countdown>0)return out;
    // until the server has applied the last press, keep holding what was held (no new press)
    if(!acked)return A.last?{x:0,y:0,act:A.last.act,press:''}:out;
    A.last=out;
    A.cool=Math.max(0,A.cool-NETC.STEP);
    if(!A.task){
      if(A.cool>0)return out;
      const saved=p.bot;p.bot=null;
      try{A.task=A.waits>=1&&p.held?setDown(p):plan(p)}finally{p.bot=saved}
      if(A.task&&A.task.label==='Set it down (unstick)')A.waits=0;
      A.pi=0;A.t=0;A.stuck=0;A.lx=p.x;A.ly=p.y;A.arrived=false;
      if(!A.task){A.cool=.35;return out}
    }
    const T=A.task;A.t+=NETC.STEP;
    const finish=()=>{A.task=null;A.cool=.12};
    if(A.t>14){finish();return out}
    if(A.pi<T.path.length){
      const i=T.path[A.pi],wx=i%S.cols+.5,wy=((i/S.cols)|0)+.5,dx=wx-p.x,dy=wy-p.y;
      if(Math.hypot(dx,dy)<.16)A.pi++;else{out.x=dir(dx,.08);out.y=dir(dy,.08)}
    }else{
      const st=T.stand,dx=st.sx+.5-p.x,dy=st.sy+.5-p.y,d=Math.hypot(dx,dy);
      // arrive within .14 of the centre; stay arrived while turning (a turn moves the player a little)
      if(d>(A.arrived?.35:.14)){A.arrived=false;out.x=dir(dx,.07);out.y=dir(dy,.07)}
      else{
        A.arrived=true;
        const [cx,cy]=card(p);
        if(cx!==st.dx||cy!==st.dy){out.x=st.dx;out.y=st.dy;return out}
        switch(T.action){
          case 'grab':out.press='g';A.waits=0;finish();break;
          case 'act':case 'throw':out.press='a';finish();break;
          case 'work':out.act=true;if(T.until())finish();break;
          case 'wait':if(T.until()){out.press='g';A.waits=0;finish()}else if(A.t>10){A.waits++;finish()}break;
        }
        return out;
      }
    }
    A.stuck+=NETC.STEP;
    if(A.stuck>.7){if(Math.hypot(p.x-A.lx,p.y-A.ly)<.05){finish();A.cool=.3}A.stuck=0;A.lx=p.x;A.ly=p.y}
    return out;
  };
  return A;
}
