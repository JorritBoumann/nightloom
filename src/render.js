/* Nightloom renderer: draws the board, characters and effects on one canvas.
   All art is drawn in code. */

const TS=56,HUD_H=84,MAX_ROWS=9,CW=14*TS,CH_=HUD_H+MAX_ROWS*TS;
const boardY=()=>HUD_H+(MAX_ROWS-S.rows)*TS/2;
const cv=document.getElementById('board'),c=cv.getContext('2d');
const FX={parts:[],texts:[],shake:0,stars:[],hints:[]};
const reduceMotion=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;

HOOK.float=(text,x,y,col,size)=>FX.texts.push({text,x,y,col,size,t:1.3});
HOOK.sparkle=(x,y,col,n)=>{for(let i=0;i<n;i++){const a=Math.random()*6.28,s=Math.random()*2+.6;FX.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.6,max:.6,col,s:2.4})}};
HOOK.puff=(x,y,col)=>{for(let i=0;i<10;i++){const a=Math.random()*6.28,s=Math.random()*.9+.3;FX.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-.3,life:.7,max:.7,col,s:6})}};
HOOK.shake=v=>{if(!reduceMotion)FX.shake=v};

/* The canvas keeps one size for every shift, so a recording never sees it resize. */
function sizeCanvas(){
  const dpr=Math.min(2,window.devicePixelRatio||1);
  if(cv.width!==CW*dpr){cv.width=CW*dpr;cv.height=CH_*dpr}
  c.setTransform(dpr,0,0,dpr,0,0);
  FX.stars=[];for(let n=0;n<200;n++)FX.stars.push({x:Math.random()*CW,y:Math.random()*CH_,r:Math.random()*1.4+.3,ph:Math.random()*6});
  FX.parts=[];FX.texts=[];
}
function stepFx(dt){
  for(let i=FX.parts.length-1;i>=0;i--){const q=FX.parts[i];q.life-=dt;q.x+=q.vx*dt;q.y+=q.vy*dt;if(q.life<=0)FX.parts.splice(i,1)}
  for(let i=FX.texts.length-1;i>=0;i--){const q=FX.texts[i];q.t-=dt;q.y-=dt*.6;if(q.t<=0)FX.texts.splice(i,1)}
  FX.shake=Math.max(0,FX.shake-dt);
  // ambient work particles
  for(const p of S.players)if(p.working&&Math.random()<dt*12){const t=target(p);if(t)FX.parts.push({x:t.x+.5+(Math.random()-.5)*.5,y:t.y+.45,vx:(Math.random()-.5)*.6,vy:-.8,life:.45,max:.45,col:t.type==='loom'?'#c7a8ff':'#bfe9ff',s:2.2})}
  for(const t of S.kettles)if(t.k.state==='brewing'&&Math.random()<dt*6)FX.parts.push({x:t.x+.5+(Math.random()-.5)*.4,y:t.y+.45,vx:0,vy:-.5,life:.6,max:.6,col:mixColor(t.k.items),s:2});
}
function mixColor(items){
  if(!items||!items.length)return'#3a3170';
  const id=dreamOf(items);if(id)return DREAMS[id].color;
  let r=0,g=0,b=0;for(const it of items){const h=ICOL[it];r+=parseInt(h.slice(1,3),16);g+=parseInt(h.slice(3,5),16);b+=parseInt(h.slice(5,7),16)}
  const n=items.length;return`rgb(${r/n*.7|0},${g/n*.7|0},${b/n*.7|0})`;
}

function drawItem(g,it,x,y,s){
  g.save();g.translate(x,y);
  if(it.kind==='wool'){
    g.fillStyle='#f2eefc';
    g.beginPath();for(const[a,b,r]of[[-.2,.05,.22],[.17,.02,.24],[0,-.15,.22],[-.02,.12,.2]]){g.moveTo(a*s+r*s,b*s);g.arc(a*s,b*s,r*s,0,7)}g.fill();
    g.fillStyle='#fff';g.beginPath();g.arc(-.05*s,-.18*s,.08*s,0,7);g.fill();
    g.fillStyle='#cfc6ea';g.beginPath();g.arc(.12*s,.1*s,.06*s,0,7);g.fill();
  }else if(it.kind==='thread'){
    g.fillStyle='#8a5a3a';g.fillRect(-.3*s,-.32*s,.6*s,.12*s);g.fillRect(-.3*s,.2*s,.6*s,.12*s);
    g.fillStyle='#c7a8ff';g.fillRect(-.22*s,-.2*s,.44*s,.4*s);
    g.strokeStyle='#9d7fe0';g.lineWidth=1.2;for(let i=-2;i<=2;i++){g.beginPath();g.moveTo(-.22*s,i*.08*s);g.lineTo(.22*s,i*.08*s+.04*s);g.stroke()}
  }else if(it.kind==='star'){
    g.shadowColor='#f4c96b';g.shadowBlur=s*.4;g.fillStyle='#f8d77e';g.strokeStyle='#b8862a';g.lineWidth=1.5;
    g.beginPath();for(let i=0;i<10;i++){const r=i%2?.19*s:.42*s,a=-Math.PI/2+i*Math.PI/5;g.lineTo(Math.cos(a)*r,Math.sin(a)*r)}g.closePath();g.fill();g.shadowBlur=0;g.stroke();
  }else if(it.kind==='moondrop'){
    g.shadowColor='#7fe0e6';g.shadowBlur=s*.35;g.fillStyle='#8fe7ec';
    g.beginPath();g.moveTo(0,-.42*s);g.bezierCurveTo(.34*s,-.02*s,.32*s,.36*s,0,.36*s);g.bezierCurveTo(-.32*s,.36*s,-.34*s,-.02*s,0,-.42*s);g.fill();
    g.shadowBlur=0;g.fillStyle='#ffffffb0';g.beginPath();g.ellipse(-.09*s,.08*s,.05*s,.1*s,0,0,7);g.fill();
  }else if(it.kind==='jar'){
    const w=.5*s,h=.58*s;
    if(it.jar==='dream'){const col=mixColor(it.contents);g.shadowColor=col;g.shadowBlur=s*.45;g.fillStyle=col;g.beginPath();g.roundRect(-w/2,-h/2+.08*s,w,h-.08*s,.1*s);g.fill();g.shadowBlur=0}
    if(it.jar==='dirty'){g.fillStyle='#6b5a4a99';g.beginPath();g.roundRect(-w/2,-h/2+.25*s,w,h-.25*s,.1*s);g.fill()}
    g.strokeStyle='#dfe8ffcc';g.lineWidth=2;g.beginPath();g.roundRect(-w/2,-h/2,w,h,.1*s);g.stroke();
    g.fillStyle='#b88a5a';g.fillRect(-.16*s,-h/2-.1*s,.32*s,.12*s);
    g.fillStyle='#ffffff55';g.fillRect(-w/2+.06*s,-h/2+.08*s,.06*s,h*.55);
    if(it.jar==='dirty'){g.fillStyle='#4a3a2e';for(const[a,b]of[[-.1,.05],[.12,-.08],[.05,.17]]){g.beginPath();g.arc(a*s,b*s,.04*s,0,7);g.fill()}}
    if(it.jar==='dream'&&it.contents&&s>20){const n=it.contents.length;it.contents.forEach((k,i)=>drawItem(g,{kind:k},(i-(n-1)/2)*.24*s,-h/2-.28*s,s*.32))}
  }
  g.restore();
}
function counterBase(px,py){
  c.fillStyle='#2b2350';c.fillRect(px,py,TS,TS);
  c.fillStyle='#4b3d80';c.beginPath();c.roundRect(px+2,py+2,TS-4,TS-11,6);c.fill();
  c.fillStyle='#5c4c98';c.fillRect(px+5,py+4,TS-10,3);
}
function bar(px,py,f,col){c.fillStyle='#0009';c.beginPath();c.roundRect(px+8,py+TS-14,TS-16,7,3);c.fill();c.fillStyle=col;c.beginPath();c.roundRect(px+9,py+TS-13,(TS-18)*Math.max(0,Math.min(1,f)),5,2);c.fill()}
function badge(px,py,n,col){c.fillStyle=col;c.beginPath();c.arc(px+TS-11,py+11,9,0,7);c.fill();c.fillStyle='#14102a';c.font='700 12px Figtree,system-ui,sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(n,px+TS-11,py+11.5)}
function drawTile(t){
  const px=t.x*TS,py=t.y*TS,cx=px+TS/2,cy=py+TS/2,clock=S.clock;
  if(t.type==='void')return;
  if(t.type==='bridge'){
    const L=S.L;let a=S.bridgeOn?1:.12;
    if(S.bridgeOn&&L.bridge.on-S.bridgeT<1.6)a=.5+.5*Math.abs(Math.sin(clock*12));
    if(!S.bridgeOn&&L.bridge.off-S.bridgeT<1)a=.12+.3*Math.abs(Math.sin(clock*10));
    c.globalAlpha=a;c.fillStyle='#cfd8ff33';c.fillRect(px,py,TS,TS);
    c.strokeStyle='#e8eeff';c.lineWidth=1.5;for(let i=0;i<4;i++){c.beginPath();c.moveTo(px+3,py+7+i*14);c.lineTo(px+TS-3,py+7+i*14);c.stroke()}
    c.globalAlpha=1;return;
  }
  if(t.type==='floor'){
    c.fillStyle=(t.x+t.y)%2?'#2c2453':'#29214d';c.fillRect(px,py,TS,TS);
    c.strokeStyle='#221b42';c.lineWidth=1;for(let i=1;i<3;i++){c.beginPath();c.moveTo(px,py+i*TS/3);c.lineTo(px+TS,py+i*TS/3);c.stroke()}
    c.beginPath();c.moveTo(px+(t.seed%5+1)*9,py);c.lineTo(px+(t.seed%5+1)*9,py+TS/3);c.stroke();
    const below=tileAt(t.x,t.y+1);if(below&&below.type==='void'){c.fillStyle='#1b1538';c.fillRect(px,py+TS,TS,9)}
    return;
  }
  counterBase(px,py);
  switch(t.type){
    case 'star':
      c.fillStyle='#2f2760';c.fillRect(px+6,py+TS-20,TS-12,6);
      drawItem(c,{kind:'star'},cx,cy-4+Math.sin(clock*3+t.x)*3,TS*.62);
      for(let i=0;i<3;i++){const a=clock*1.5+i*2.1;c.fillStyle='#fff6';c.fillRect(cx+Math.cos(a)*18,cy-4+Math.sin(a)*8,2,2)}
      break;
    case 'wool':
      c.fillStyle='#7a5536';c.beginPath();c.ellipse(cx,cy+6,TS*.34,TS*.2,0,0,7);c.fill();
      c.strokeStyle='#5e3f26';c.lineWidth=2;for(let i=-2;i<=2;i++){c.beginPath();c.moveTo(cx+i*7,cy-2);c.lineTo(cx+i*7,cy+15);c.stroke()}
      drawItem(c,{kind:'wool'},cx,cy-4,TS*.6);break;
    case 'moon':{
      c.fillStyle='#6d6492';c.beginPath();c.arc(cx,cy-2,TS*.33,0,7);c.fill();
      const gr=c.createRadialGradient(cx,cy-2,2,cx,cy-2,TS*.26);gr.addColorStop(0,'#bff6f8');gr.addColorStop(1,'#2a7f9a');
      c.fillStyle=gr;c.beginPath();c.arc(cx,cy-2,TS*.26,0,7);c.fill();
      c.fillStyle='#f4fbff';c.beginPath();c.arc(cx+3,cy-6,7,0,7);c.fill();c.fillStyle='#4aa9bf';c.beginPath();c.arc(cx+7,cy-8,6,0,7);c.fill();
      break}
    case 'loom':
      c.fillStyle='#8a5a3a';c.fillRect(px+8,py+6,5,TS-16);c.fillRect(px+TS-13,py+6,5,TS-16);c.fillRect(px+8,py+6,TS-16,5);
      c.strokeStyle='#c7a8ff88';c.lineWidth=1;for(let i=0;i<7;i++){c.beginPath();c.moveTo(px+15+i*4.5,py+11);c.lineTo(px+15+i*4.5,py+TS-12);c.stroke()}
      if(t.prog>0)bar(px,py,t.prog,'#c7a8ff');
      break;
    case 'kettle':{
      const k=t.k,fl=Math.sin(clock*20)*2,hot=k.state==='brewing'||k.state==='ready';
      c.fillStyle=k.state==='nightmare'?'#ff3d6e':hot?'#9b7bff':'#4b3d80';c.beginPath();c.moveTo(cx-10,py+TS-10);c.quadraticCurveTo(cx,py+TS-(hot?26:16)+fl,cx+10,py+TS-10);c.fill();
      c.fillStyle='#17132a';c.beginPath();c.ellipse(cx,cy+2,TS*.31,TS*.26,0,0,7);c.fill();
      c.fillStyle='#2b2545';c.fillRect(cx-TS*.33,cy-10,TS*.66,5);
      let liquid=k.items.length?mixColor(k.items):null;if(k.state==='nightmare')liquid='#3a0d24';
      if(liquid){c.fillStyle=liquid;c.beginPath();c.ellipse(cx,cy-6,TS*.25,TS*.08,0,0,7);c.fill()}
      if(k.state==='ready'){c.save();c.shadowColor=liquid;c.shadowBlur=18;c.fillStyle=liquid;c.beginPath();c.ellipse(cx,cy-6,TS*.22,TS*.06,0,0,7);c.fill();c.restore()}
      if(k.state==='ready'&&k.grace<4&&Math.sin(clock*16)>0){c.strokeStyle='#ff5c8a';c.lineWidth=3;c.beginPath();c.ellipse(cx,cy+2,TS*.36,TS*.31,0,0,7);c.stroke()}
      if(k.state==='nightmare'){c.fillStyle='#ff3d6e';for(const d of[-6,6]){c.beginPath();c.ellipse(cx+d,cy+4,3,4.5,0,0,7);c.fill()}}
      k.items.forEach((it,i)=>drawItem(c,{kind:it},px+12+i*16,py+10,13));
      if(k.state==='brewing')bar(px,py,k.prog/k.need,'#9b7bff');
      if(k.state==='ready')bar(px,py,k.grace/S.L.grace,k.grace<4?'#ff5c8a':'#9bd47a');
      break}
    case 'jars':
      c.fillStyle='#6a4a30';c.fillRect(px+5,py+TS-20,TS-10,4);
      for(let i=0;i<Math.min(t.count,4);i++)drawItem(c,{kind:'jar',jar:'clean'},px+13+i*10,py+TS-30,TS*.42);
      badge(px,py,t.count,t.count?'#dfe8ff':'#ff5c8a');break;
    case 'basin':
      c.fillStyle='#8c8aa8';c.beginPath();c.ellipse(cx,cy,TS*.38,TS*.27,0,0,7);c.fill();
      c.fillStyle='#4fa3c7';c.beginPath();c.ellipse(cx,cy-1,TS*.3,TS*.2,0,0,7);c.fill();
      for(let i=0;i<Math.min(t.dirty,3);i++)drawItem(c,{kind:'jar',jar:'dirty'},cx-10+i*10,cy-2,TS*.36);
      c.fillStyle='#ffffff66';for(let i=0;i<3;i++){c.beginPath();c.arc(cx-12+i*12,cy+4+Math.sin(clock*4+i)*2,2.5,0,7);c.fill()}
      if(t.dirty)badge(px,py,t.dirty,'#d9b98f');
      if(t.prog>0)bar(px,py,t.prog,'#bfe9ff');break;
    case 'return':
      c.fillStyle='#1a1530';c.beginPath();c.roundRect(px+9,py+9,TS-18,TS-22,5);c.fill();
      c.strokeStyle='#6a5aa6';c.lineWidth=2;c.stroke();
      for(let i=0;i<Math.min(t.count,3);i++)drawItem(c,{kind:'jar',jar:'dirty'},cx-10+i*10,cy-2,TS*.36);
      if(t.count)badge(px,py,t.count,'#d9b98f');break;
    case 'chute':
      c.fillStyle='#0b0818';c.beginPath();c.arc(cx,cy-2,TS*.33,0,7);c.fill();
      c.strokeStyle='#f4c96b';c.lineWidth=2;for(let i=0;i<3;i++){const a=clock*2+i*2.09;c.beginPath();c.arc(cx,cy-2,TS*(.12+i*.07),a,a+1.9);c.stroke()}
      c.fillStyle='#f4c96b';c.font='700 9px Figtree,system-ui,sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('SEND',cx,py+TS-12);
      break;
    case 'bin':
      c.fillStyle='#120e22';c.beginPath();c.ellipse(cx,cy-1,TS*.3,TS*.22,0,0,7);c.fill();c.strokeStyle='#6a5aa6';c.lineWidth=3;c.stroke();break;
  }
}
function drawPlayer(p){
  const px=p.x*TS,py=p.y*TS,[dx,dy]=card(p),clock=S.clock;
  const overSky=!walkable(tileAt(Math.floor(p.x),Math.floor(p.y)),'bramble');
  if(!overSky){c.fillStyle='#0007';c.beginPath();c.ellipse(px,py+12,p.kind==='bramble'?19:11,6,0,0,7);c.fill()}
  let topY;
  if(p.kind==='bramble'){
    const bob=p.moving?Math.abs(Math.sin(p.walk))*3:Math.sin(clock*2)*1;const by=py-4-bob;topY=by-34;
    if(p.held&&dy<0)drawItem(c,p.held,px+dx*16,by-14,TS*.55);
    c.fillStyle='#4f6b42';c.beginPath();c.ellipse(px,by,20,19,0,0,7);c.fill();
    c.fillStyle='#6f8f5c';c.beginPath();c.ellipse(px,by+4,14,12,0,0,7);c.fill();
    c.fillStyle='#86b06b';for(const[a,b]of[[-12,-14],[0,-18],[11,-14]]){c.beginPath();c.arc(px+a,by+b,6,0,7);c.fill()}
    c.strokeStyle='#5c8a3a';c.lineWidth=2;c.beginPath();c.moveTo(px,by-20);c.lineTo(px+2,by-28);c.stroke();
    c.fillStyle='#9bd47a';c.beginPath();c.ellipse(px+6,by-29,6,3,-.5,0,7);c.fill();
    if(dy>=0)for(const s of[-1,1]){c.fillStyle='#f6f1e3';c.beginPath();c.arc(px+s*7+dx*3,by-4+dy*2,4.5,0,7);c.fill();c.fillStyle='#1b1430';c.beginPath();c.arc(px+s*7+dx*4.5,by-4+dy*3,2.2,0,7);c.fill()}
    if(p.working){c.fillStyle='#86b06b';c.beginPath();c.arc(px+dx*18+Math.sin(clock*25)*3,by+6+dy*10,6,0,7);c.fill()}
    if(p.held&&dy>=0)drawItem(c,p.held,px+dx*16,by+4+dy*12,TS*.55);
  }else{
    const lift=overSky?0:10;const by=py-lift+Math.sin(clock*5)*2;const flap=Math.abs(Math.sin(clock*(p.moving?28:10)));topY=by-26;
    if(p.held&&dy<0)drawItem(c,p.held,px+dx*12,by-14,TS*.48);
    c.fillStyle='#f5d3de';c.globalAlpha=.9;
    for(const s of[-1,1]){c.save();c.translate(px+s*5,by);c.scale(s*(.35+.65*flap),1);c.beginPath();c.ellipse(9,-5,11,9,-.3,0,7);c.fill();c.beginPath();c.ellipse(7,7,7,6,.4,0,7);c.fill();c.restore()}
    c.globalAlpha=1;
    c.fillStyle='#d98aa6';for(const s of[-1,1]){c.beginPath();c.arc(px+s*12*(.35+.65*flap),by-5,2.5,0,7);c.fill()}
    c.fillStyle='#efe2cf';c.beginPath();c.ellipse(px,by+2,6,10,0,0,7);c.fill();
    c.fillStyle='#fff8ee';c.beginPath();c.arc(px,by-6,7,0,7);c.fill();
    c.strokeStyle='#efe2cf';c.lineWidth=1.5;for(const s of[-1,1]){c.beginPath();c.moveTo(px+s*3,by-12);c.quadraticCurveTo(px+s*6,by-20,px+s*10,by-19);c.stroke()}
    if(dy>=0){c.fillStyle='#1b1430';for(const s of[-1,1]){c.beginPath();c.arc(px+s*3+dx*2,by-6+dy*1.5,2,0,7);c.fill()}}
    if(p.dashT>0){c.strokeStyle='#ffd9e4';c.lineWidth=2;c.beginPath();c.moveTo(px-dx*14,by-dy*14);c.lineTo(px-dx*26,by-dy*26);c.stroke()}
    if(p.held&&dy>=0)drawItem(c,p.held,px+dx*12,by+10+dy*8,TS*.48);
  }
  if(p.hint){c.font='600 11px Figtree,system-ui,sans-serif';c.textAlign='center';c.textBaseline='middle';const w=c.measureText(p.hint).width+12,hx=Math.max(w/2+2,Math.min(S.cols*TS-w/2-2,px));c.fillStyle='#100d24cc';c.beginPath();c.roundRect(hx-w/2,py+20,w,17,6);c.fill();c.fillStyle=p.color;c.fillText(p.hint,hx,py+29)}
  if(p.tag){c.font='700 10px Figtree,system-ui,sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillStyle=p.color;c.globalAlpha=.85;c.fillText(p.tag,px,topY-6);c.globalAlpha=1}
  if(p.sayT>0){
    c.globalAlpha=Math.min(1,p.sayT*2);c.font='600 12px Figtree,system-ui,sans-serif';
    const w=Math.min(c.measureText(p.say).width+16,300);const bx=Math.max(4,Math.min(S.cols*TS-w-4,px-w/2)),byy=Math.max(4,py-62);
    c.fillStyle='#f6f0ffee';c.beginPath();c.roundRect(bx,byy,w,22,8);c.fill();
    c.fillStyle='#1b1430';c.textAlign='left';c.textBaseline='middle';c.fillText(p.say,bx+8,byy+11.5,w-16);c.globalAlpha=1;
  }
}
function drawWind(){
  const w=S.wind,W=S.cols*TS,H=S.rows*TS;if(!S.L.wind||w.phase==='calm')return;
  const strong=w.phase==='gust';c.strokeStyle=strong?'#dfe8ff55':'#dfe8ff22';c.lineWidth=strong?2:1;
  for(let i=0;i<(strong?26:10);i++){
    const y=((i*97)%H)+Math.sin(S.clock*2+i)*6,len=strong?60:30;
    let x=((S.clock*(strong?520:160)*w.dir+i*173)%(W+len));if(x<0)x+=W+len;x-=len/2;
    c.beginPath();c.moveTo(x,y);c.lineTo(x+len*w.dir,y);c.stroke();
  }
  if(w.phase==='warn'){c.fillStyle='#dfe8ff';c.font="700 16px Gluten,'Trebuchet MS',cursive";c.textAlign='center';c.textBaseline='top';c.globalAlpha=.6+.4*Math.sin(S.clock*12);c.fillText(w.dir>0?'Gust coming  →':'←  Gust coming',W/2,8);c.globalAlpha=1}
}
function drawHints(){
  for(const h of FX.hints){
    if(!h||!h.tile)continue;
    const px=h.tile.x*TS+TS/2,py=h.tile.y*TS+(h.tile.y===0?TS*.82:-4)+Math.sin(S.clock*5)*3,up=h.tile.y===0;
    c.fillStyle=h.color;c.beginPath();
    if(up){c.moveTo(px,py-8);c.lineTo(px-7,py+3);c.lineTo(px+7,py+3)}else{c.moveTo(px,py+8);c.lineTo(px-7,py-3);c.lineTo(px+7,py-3)}
    c.fill();
  }
}
function draw(showTargets){
  c.save();
  const sky=c.createLinearGradient(0,0,0,CH_);sky.addColorStop(0,'#0c0a22');sky.addColorStop(1,'#1d1546');c.fillStyle=sky;c.fillRect(0,0,CW,CH_);
  for(const s of FX.stars){c.globalAlpha=.4+.6*Math.abs(Math.sin(S.clock*.8+s.ph));c.fillStyle='#fff';c.fillRect(s.x,s.y,s.r,s.r)}
  c.globalAlpha=1;
  drawHud();
  c.save();
  if(FX.shake>0)c.translate((Math.random()-.5)*8*FX.shake,(Math.random()-.5)*8*FX.shake);
  c.translate(0,boardY());
  const W=S.cols*TS,H=S.rows*TS;
  for(const r of S.grid)for(const t of r)drawTile(t);
  for(const r of S.grid)for(const t of r)if(t.item){const lift=t.type==='floor'||t.type==='bridge'?4:0;drawItem(c,t.item,t.x*TS+TS/2,t.y*TS+TS/2-4+lift,TS*.6)}
  if(showTargets)for(const p of S.players){if(p.bot)continue;const t=target(p);if(t&&t.type!=='void'){c.strokeStyle=p.color;c.globalAlpha=.55+.3*Math.sin(S.clock*6);c.lineWidth=2.5;c.setLineDash([6,4]);c.beginPath();c.roundRect(t.x*TS+3,t.y*TS+3,TS-6,TS-6,7);c.stroke();c.setLineDash([]);c.globalAlpha=1}}
  drawHints();
  for(const p of[...S.players].sort((a,b)=>a.y-b.y))drawPlayer(p);
  for(const pr of S.projs){c.save();c.translate(pr.x*TS,pr.y*TS-10);c.rotate(pr.spin);drawItem(c,pr.item,0,0,TS*.5);c.restore()}
  for(const q of FX.parts){c.globalAlpha=Math.max(0,q.life/q.max);c.fillStyle=q.col;c.beginPath();c.arc(q.x*TS,q.y*TS,q.s*(q.s>4?(1.6-q.life/q.max):1),0,7);c.fill()}
  c.globalAlpha=1;
  drawWind();
  for(const q of FX.texts){c.globalAlpha=Math.min(1,q.t*1.5);c.font=`700 ${q.size}px Gluten,'Trebuchet MS',cursive`;c.textAlign='center';c.textBaseline='middle';c.lineWidth=4;c.strokeStyle='#100d24';c.strokeText(q.text,q.x*TS,q.y*TS);c.fillStyle=q.col;c.fillText(q.text,q.x*TS,q.y*TS)}
  c.globalAlpha=1;
  c.restore();
  if(S.countdown>0&&showTargets){
    const n=Math.ceil(S.countdown),f=S.countdown-Math.floor(S.countdown);
    c.fillStyle='#100d24aa';c.fillRect(0,HUD_H,CW,CH_-HUD_H);
    c.font=`800 ${96+30*f}px Gluten,'Trebuchet MS',cursive`;c.textAlign='center';c.textBaseline='middle';c.fillStyle='#f4c96b';c.globalAlpha=.4+.6*f;c.fillText(n,CW/2,HUD_H+(CH_-HUD_H)/2);c.globalAlpha=1;
  }
  c.restore();
}

/* The HUD lives on the canvas, because Stateloop records the canvas and nothing around it. */
function drawHud(){
  c.fillStyle='#151131';c.fillRect(0,0,CW,HUD_H);c.fillStyle='#352d5e';c.fillRect(0,HUD_H-1,CW,1);
  c.textBaseline='alphabetic';c.textAlign='left';
  c.fillStyle='#a79cc9';c.font='600 10px Figtree,system-ui,sans-serif';c.fillText(`SHIFT ${S.lvl+1} OF ${LEVELS.length}`,14,30);
  c.fillStyle='#f4c96b';c.font="700 22px Gluten,'Trebuchet MS',cursive";c.fillText(S.L.name,14,54,128);
  if(HUD.label){c.fillStyle='#a79cc9';c.font='600 10px Figtree,system-ui,sans-serif';c.fillText(HUD.label,14,72,128)}
  const x0=150;
  S.orders.forEach((o,i)=>{
    const d=DREAMS[o.id],x=x0+i*122,y=8,w=114,h=68,f=o.left/o.life;
    c.fillStyle='#1c1736';c.strokeStyle=f<.25&&Math.sin(S.clock*10)>0?'#ff5c8a':'#352d5e';c.lineWidth=1.5;
    c.beginPath();c.roundRect(x,y,w,h,9);c.fill();c.stroke();
    drawItem(c,{kind:'jar',jar:'dream',contents:d.items},x+15,y+20,22);
    c.fillStyle=d.color;c.font="700 15px Gluten,'Trebuchet MS',cursive";c.fillText(d.name,x+30,y+24,w-34);
    d.items.forEach((k,j)=>{c.fillStyle='#0004';c.beginPath();c.roundRect(x+7+j*25,y+31,22,22,5);c.fill();drawItem(c,{kind:k},x+18+j*25,y+42,20)});
    c.fillStyle='#0006';c.beginPath();c.roundRect(x+7,y+58,w-14,5,3);c.fill();
    c.fillStyle=f<.25?'#ff5c8a':f<.5?'#f4c96b':'#9bd47a';c.beginPath();c.roundRect(x+7,y+58,(w-14)*Math.max(0,f),5,3);c.fill();
  });
  const s=Math.ceil(S.timeLeft),low=s<=20&&!S.over;
  c.textAlign='right';c.font="700 30px Gluten,'Trebuchet MS',cursive";
  c.fillStyle=low&&Math.sin(S.clock*8)>0?'#ff5c8a':'#efe8ff';c.fillText(`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`,CW-14,38);
  c.font='600 12px Figtree,system-ui,sans-serif';c.fillStyle='#a79cc9';c.fillText('Moonlight',CW-14-c.measureText(String(S.score)).width-22,62);
  c.font="700 18px Gluten,'Trebuchet MS',cursive";c.fillStyle='#f4c96b';c.fillText(String(S.score),CW-14,63);
  if(S.streak>1){c.font='700 11px Figtree,system-ui,sans-serif';c.fillStyle='#9bd47a';c.fillText(`Streak ×${S.streak}`,CW-14,78)}
}
const HUD={label:''};
function itemIcon(it,size=64){
  const o=document.createElement('canvas');o.width=o.height=size;const g=o.getContext('2d');
  drawItem(g,it,size/2,it.kind==='jar'?size*.6:size/2,size*.8);return o.toDataURL();
}
