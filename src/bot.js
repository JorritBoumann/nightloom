/* Nightloom bot: plays either character.
   Used for the solo partner, the title-screen demo, the first-shift hints
   and the headless balance runs in tools/sim.mjs. */

const DIRS4=[[1,0],[-1,0],[0,1],[0,-1]];

function bfs(kind,sx,sy){
  const n=S.cols*S.rows,dist=new Int16Array(n).fill(-1),prev=new Int32Array(n).fill(-1);
  if(sx<0||sy<0||sx>=S.cols||sy>=S.rows)return{dist,prev};
  const s=sy*S.cols+sx,q=[s];dist[s]=0;
  for(let h=0;h<q.length;h++){
    const c=q[h],cx=c%S.cols,cy=(c/S.cols)|0;
    for(const[dx,dy]of DIRS4){
      const nx=cx+dx,ny=cy+dy;if(!walkable(tileAt(nx,ny),kind))continue;
      const ni=ny*S.cols+nx;if(dist[ni]>=0)continue;dist[ni]=dist[c]+1;prev[ni]=c;q.push(ni);
    }
  }
  return{dist,prev};
}
function reach(F,t){
  let best=null;
  for(const[dx,dy]of DIRS4){
    const sx=t.x-dx,sy=t.y-dy;if(sx<0||sy<0||sx>=S.cols||sy>=S.rows)continue;
    const d=F.dist[sy*S.cols+sx];if(d<0)continue;
    if(!best||d<best.cost)best={sx,sy,dx,dy,cost:d};
  }
  return best;
}
function pathFrom(F,sx,sy){
  const out=[];let i=sy*S.cols+sx;
  while(i>=0&&F.dist[i]>0){out.push(i);i=F.prev[i]}
  return out.reverse();
}
function predictThrow(sx,sy,dx,dy,item){
  let x=sx+.5+dx*.3,y=sy+.5+dy*.3,dist=0,lx=sx,ly=sy;
  const landing=(tx,ty)=>{const t=tileAt(tx,ty);return t&&(t.type==='floor'||(t.type==='bridge'&&S.bridgeOn))&&!t.item?{land:t}:{lost:true}};
  while(true){
    x+=dx*.1;y+=dy*.1;dist+=.1;
    const tx=Math.floor(x),ty=Math.floor(y),t=tileAt(tx,ty);
    if(!t)return{lost:true};
    if(isSolid(t))return canAccept(t,item)?{accept:t}:landing(lx,ly);
    lx=tx;ly=ty;
    if(dist>=5)return landing(tx,ty);
  }
}
function throwPlan(F,item,want){
  let best=null;
  for(let i=0;i<F.dist.length;i++){
    if(F.dist[i]<0)continue;const sx=i%S.cols,sy=(i/S.cols)|0;
    for(const[dx,dy]of DIRS4){
      const r=predictThrow(sx,sy,dx,dy,item);
      const ok=want?r.accept===want:(r.land&&F.dist[r.land.y*S.cols+r.land.x]<0)||(r.accept&&r.accept.type==='counter'&&!reach(F,r.accept));
      if(ok&&(!best||F.dist[i]<best.cost))best={sx,sy,dx,dy,cost:F.dist[i]};
    }
  }
  return best;
}

/* What the kitchen needs right now: which kettle brews which order, and what is missing. */
function analyze(){
  const A={pipes:[],needs:{thread:0,star:0,moondrop:0},needKettles:{thread:[],star:[],moondrop:[]},stray:[]};
  const jars=[];
  for(const p of S.players)if(p.held&&p.held.jar==='dream')jars.push(p.held);
  for(const r of S.grid)for(const t of r)if(t.item&&t.item.jar==='dream')jars.push(t.item);
  for(const pr of S.projs)if(pr.item.jar==='dream')jars.push(pr.item);
  const orders=S.orders.slice().sort((a,b)=>a.left-b.left);
  const usedJ=new Set(),usedK=new Set();
  for(const o of orders){
    const recipe=DREAMS[o.id].items,k=keyOf(recipe);
    const j=jars.find(d=>!usedJ.has(d)&&keyOf(d.contents)===k);if(j){usedJ.add(j);continue}
    let best=null,bs=-1;
    for(const t of S.kettles){
      if(usedK.has(t))continue;const kk=t.k;
      if(kk.state==='empty'||kk.state==='nightmare')continue;
      if(!isSubset(kk.items,recipe))continue;
      const sc=kk.items.length*10+(kk.state==='ready'?100:0)+kk.prog;if(sc>bs){bs=sc;best=t}
    }
    const open=A.pipes.filter(q=>q.missing.length>0).length;
    if(!best&&open<2)best=S.kettles.find(t=>!usedK.has(t)&&t.k.state==='empty')||null;
    if(best){usedK.add(best);const missing=missingFrom(best.k.items,recipe);A.pipes.push({order:o,kettle:best,missing});
      for(const m of missing){A.needs[m]++;A.needKettles[m].push(best)}}
  }
  for(const t of S.kettles){
    const kk=t.k;
    const stray=(kk.state==='filling'||kk.state==='brewing'||kk.state==='ready')&&!S.orders.some(o=>isSubset(kk.items,DREAMS[o.id].items));
    if(stray){kk.strayAt=kk.strayAt??S.clock;if(S.clock-kk.strayAt>4)A.stray.push(t)}else kk.strayAt=null;
  }
  A.pipeKettles=new Set(A.pipes.map(p=>p.kettle));
  A.extraJars=jars.filter(j=>!usedJ.has(j));
  return A;
}
function supplyOf(kind,me){
  let n=0;
  for(const p of S.players){if(p===me)continue;if(p.held&&p.held.kind===kind)n++;if(p.bot&&p.bot.task&&p.bot.task.fetch===kind)n++}
  if(me.held&&me.held.kind===kind)n++;
  for(const pr of S.projs)if(pr.item.kind===kind)n++;
  return n;
}
function lying(kind){const out=[];for(const r of S.grid)for(const t of r)if(t.item&&t.item.kind===kind&&t.type!=='loom'&&t.item.kind!=='jar')out.push(t);return out}
function tilesOf(type){const out=[];for(const r of S.grid)for(const t of r)if(t.type===type)out.push(t);return out}
function otherFetching(me,what){return S.players.some(p=>p!==me&&p.bot&&p.bot.task&&p.bot.task.fetch===what)}
function heldCount(pred){return S.players.filter(p=>p.held&&pred(p.held)).length}

function plan(p){
  const F=bfs(p.kind,Math.floor(p.x),Math.floor(p.y));
  const A=analyze();
  const C=[];
  const add=(t,action,bias,extra={})=>{if(!t)return;const r=reach(F,t);if(r)C.push({tile:t,action,stand:r,cost:r.cost+bias,...extra});return r};
  const viaThrow=(t,item,bias,extra)=>{
    if(add(t,'grab',bias,extra))return true;
    if(p.kind!=='bramble')return false;
    const r=throwPlan(F,item,t);if(r){C.push({tile:t,action:'throw',stand:r,cost:r.cost+bias+1,...extra});return true}
    return false;
  };
  const handoff=(bias,label)=>{
    if(p.kind!=='bramble')return;
    const r=throwPlan(F,p.held,null);if(r)C.push({tile:null,action:'throw',stand:r,cost:r.cost+bias,label});
  };
  const loom=tilesOf('loom')[0],jarsT=S.jarsTile,basin=S.basinTile,ret=S.returnTile;
  const h=p.held;

  if(h){
    if(h.kind==='jar'&&h.jar==='dream'){
      const ok=S.orders.some(o=>keyOf(DREAMS[o.id].items)===keyOf(h.contents));
      if(ok)for(const t of tilesOf('chute'))viaThrow(t,h,-5,{label:'Send the dream down the chute'});
      else for(const t of tilesOf('bin'))add(t,'grab',0,{label:'Bin the unwanted dream'});
      if(!C.length)handoff(2,'Throw it to Flit');
    }else if(h.kind==='jar'&&h.jar==='clean'){
      for(const t of S.kettles){
        const kk=t.k;
        if(kk.state==='ready'&&(A.pipeKettles.has(t)||dreamOf(kk.items)))add(t,'grab',-4,{label:'Bottle the ready dream'});
        else if(kk.state==='brewing'&&A.pipeKettles.has(t)){
          const left=kk.need-kk.prog;
          add(t,'wait',left*.6,{label:'Wait for the kettle',until:()=>t.k.state==='ready'||t.k.state==='nightmare'||t.k.state==='empty'});
        }
      }
      if(!C.length&&jarsT)add(jarsT,'grab',2,{label:'Put the jar back'});
      if(!C.length)handoff(3,'Throw the jar over');
    }else if(h.kind==='jar'&&h.jar==='dirty'){
      if(basin&&!viaThrow(basin,h,0,{label:'Take the jar to the basin'}))handoff(2,'Throw the jar over');
    }else if(h.kind==='wool'){
      if(loom){
        if(!loom.item){if(!viaThrow(loom,h,0,{label:'Put the wool on the loom'}))handoff(2,'Throw the wool over')}
        else add(loom,'wait',2,{label:'Wait for the loom',until:()=>!loom.item})||handoff(3,'Throw the wool over');
      }
    }else{
      const ks=A.needKettles[h.kind]||[];
      for(const t of ks)viaThrow(t,h,-2,{label:`Put the ${h.kind} in the kettle`});
      if(!C.length){
        for(const t of S.kettles){
          const kk=t.k;if(!canAccept(t,h))continue;
          const after=kk.items.concat(h.kind);
          if(S.L.dreams.some(id=>isSubset(after,DREAMS[id].items)))add(t,'grab',3,{label:`Put the ${h.kind} in a kettle`});
        }
      }
      if(!C.length){
        for(const r of S.grid)for(const t of r)if(t.type==='counter'&&!t.item)add(t,'grab',4,{label:'Set it down for later'});
      }
      if(!C.length)handoff(2,'Throw it over');
    }
  }else{
    for(const t of S.kettles)if(t.k.state==='nightmare')add(t,'grab',-6,{label:'Tip out the nightmare'});
    for(const t of A.stray)add(t,'act',-1,{label:'Tip out the wrong mix'});
    // bottling
    const soon=S.kettles.filter(t=>(t.k.state==='ready'&&(A.pipeKettles.has(t)||dreamOf(t.k.items)))||(t.k.state==='brewing'&&A.pipeKettles.has(t)&&A.pipes.find(q=>q.kettle===t).missing.length===0&&t.k.need-t.k.prog<7));
    const jarsComing=heldCount(it=>it.jar==='clean')+S.players.filter(q=>q!==p&&q.bot&&q.bot.task&&q.bot.task.fetch==='jar').length;
    if(soon.length>jarsComing){
      const urgency=Math.min(...soon.map(t=>t.k.state==='ready'?0:t.k.need-t.k.prog));
      if(jarsT&&jarsT.count>0)add(jarsT,'grab',-3+urgency*.4,{label:'Fetch a clean jar',fetch:'jar'});
      else if(basin&&basin.dirty>0)add(basin,'work',-2,{label:'Wash a jar',until:()=>basin.dirty===0||(jarsT&&jarsT.count>0)});
      else if(ret&&ret.count>0)add(ret,'grab',-1,{label:'Collect a dirty jar',fetch:'dirty'});
    }
    // dream jars and wanted things lying around
    for(const r of S.grid)for(const t of r){
      if(!t.item||t.type==='loom')continue;
      const it=t.item;
      if(it.jar==='dream')add(t,'grab',-4,{label:'Pick up the dream'});
      else if(it.jar==='dirty'&&basin)add(t,'grab',2,{label:'Pick up the dirty jar',fetch:'dirty'});
    }
    // ingredients
    for(const kind of INGREDIENTS){
      const want=A.needs[kind]-supplyOf(kind,p);
      if(want<=0)continue;
      for(const t of lying(kind))add(t,'grab',-1,{label:`Pick up the ${kind}`,fetch:kind});
      if(kind==='star'&&p.kind==='flit')for(const t of tilesOf('star'))add(t,'grab',0,{label:'Fetch a star',fetch:'star'});
      if(kind==='moondrop')for(const t of tilesOf('moon'))add(t,'grab',0,{label:'Fetch a moondrop',fetch:'moondrop'});
      if(kind==='thread'&&loom){
        if(loom.item&&loom.item.kind==='thread')add(loom,'grab',-1,{label:'Take the thread',fetch:'thread'});
      }
    }
    if(loom){
      if(loom.item&&loom.item.kind==='wool'&&p.kind==='bramble')add(loom,'work',-2,{label:'Spin the wool',until:()=>!loom.item||loom.item.kind!=='wool'});
      const threadWant=A.needs.thread-supplyOf('thread',p)-lying('thread').length-(loom.item?1:0);
      const woolSupply=supplyOf('wool',p)+lying('wool').length;
      if(threadWant>0&&woolSupply<1&&!loom.item){
        for(const t of lying('wool'))add(t,'grab',0,{label:'Pick up the wool',fetch:'wool'});
        for(const t of tilesOf('wool'))add(t,'grab',p.kind==='bramble'?0:2,{label:'Fetch wool',fetch:'wool'});
      }
    }
    // dishes
    if(ret&&ret.count>0&&!otherFetching(p,'dirty'))add(ret,'grab',3,{label:'Collect a dirty jar',fetch:'dirty'});
    if(basin&&basin.dirty>0)add(basin,'work',jarsT&&jarsT.count<2?1:6,{label:'Wash the jars',until:()=>basin.dirty===0});
  }
  C.sort((a,b)=>a.cost-b.cost);
  if(p.bot)p.bot.options=C.slice(0,6).map(o=>({label:o.label,action:o.action,cost:+o.cost.toFixed(2)}));
  if(!C.length)return null;
  const best=C[0];
  best.path=pathFrom(F,best.stand.sx,best.stand.sy);
  return best;
}

function makeBot(p,opt={}){p.bot={task:null,cool:0,react:opt.react??.22,pi:0,t:0,stuckT:0,lx:p.x,ly:p.y};return p.bot}

function botStep(p,dt){
  const b=p.bot;p.in.x=0;p.in.y=0;p.in.act=false;
  if(S.countdown>0||S.over)return;
  b.cool=Math.max(0,b.cool-dt);
  if(!b.task){
    if(b.cool>0)return;
    b.task=plan(p);b.pi=0;b.t=0;b.stuckT=0;b.lx=p.x;b.ly=p.y;
    HOOK.event('decide',p,b.task,b.options);
    if(!b.task){b.cool=.35;return}
  }
  const T=b.task;b.t+=dt;
  const finish=()=>{b.task=null;b.cool=b.react*(.6+.8*S.rand())};
  if(b.t>14){finish();return}
  const st=T.stand;
  // walk the path
  if(b.pi<T.path.length){
    const i=T.path[b.pi],wx=i%S.cols+.5,wy=((i/S.cols)|0)+.5;
    const dx=wx-p.x,dy=wy-p.y,d=Math.hypot(dx,dy);
    if(d<.16){b.pi++}else{p.in.x=dx/d;p.in.y=dy/d}
  }else{
    const dx=st.sx+.5-p.x,dy=st.sy+.5-p.y,d=Math.hypot(dx,dy);
    if(d>.14){p.in.x=dx/d;p.in.y=dy/d}
    else{
      p.fx=st.dx;p.fy=st.dy;
      switch(T.action){
        case 'grab':grab(p);finish();break;
        case 'act':actDown(p);finish();break;
        case 'throw':if(p.held)actDown(p);finish();break;
        case 'work':p.in.act=true;if(T.until())finish();break;
        case 'wait':if(T.until()){grab(p);finish()}else if(b.t>10)finish();break;
      }
      return;
    }
  }
  // stuck: a bridge went out or the wind holds us back
  b.stuckT+=dt;
  if(b.stuckT>.7){
    if(Math.hypot(p.x-b.lx,p.y-b.ly)<.05){finish();b.cool=.3}
    b.stuckT=0;b.lx=p.x;b.ly=p.y;
  }
}

/* For the first-shift hints: what would a good player do next? */
function hintFor(p){
  const saved=p.bot;p.bot=null;
  let t=null;try{t=plan(p)}finally{p.bot=saved}
  return t;
}
