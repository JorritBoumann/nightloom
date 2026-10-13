/* Keyboard and gamepad input. Human players get p.in from here; bots set their own.
   Fixed key map, so a recording's key log tells the two players apart:
   Bramble = W A S D, Space, Left Shift.  Flit = arrows, Enter or '.', Right Shift or '/'. */

const KEYS={
  bramble:{up:['KeyW'],down:['KeyS'],left:['KeyA'],right:['KeyD'],grab:['Space','KeyE'],act:['ShiftLeft','KeyQ']},
  flit:{up:['ArrowUp'],down:['ArrowDown'],left:['ArrowLeft'],right:['ArrowRight'],grab:['Enter','NumpadEnter','Period'],act:['ShiftRight','Slash']}
};
const GAME_KEYS=new Set(Object.values(KEYS).flatMap(b=>Object.values(b).flat()));
const Input={solo:false,held:new Set(),pads:{},device:'keyboard'};

function keySets(p){return Input.solo?[KEYS.bramble,KEYS.flit]:[KEYS[p.kind]]}
function keyHeld(p,a){return keySets(p).some(k=>k[a].some(code=>Input.held.has(code)))}
function humans(){return S?S.players.filter(p=>!p.bot):[]}

addEventListener('keydown',e=>{
  if(UI.mode!=='play'){UI.menuKey(e);return}
  if(e.code==='Escape'||e.code==='KeyP'){e.preventDefault();UI.pause();return}
  if(GAME_KEYS.has(e.code))e.preventDefault();
  Input.held.add(e.code);
  if(e.repeat)return;
  Input.device='keyboard';
  for(const p of humans())for(const k of keySets(p)){
    if(k.grab.includes(e.code))grab(p);
    if(k.act.includes(e.code))actDown(p);
  }
});
addEventListener('keyup',e=>Input.held.delete(e.code));
addEventListener('blur',()=>{Input.held.clear();if(UI.mode==='play')UI.pause()});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&UI.mode==='play')UI.pause()});

/* Pad 1 drives the first human player, pad 2 the second. A grabs, X or B works or throws, Start pauses. */
function pollPads(){
  let list=[];try{list=navigator.getGamepads?[...navigator.getGamepads()].filter(Boolean):[]}catch(e){list=[]}
  const hs=humans();
  list.forEach((gp,i)=>{
    const b=gp.buttons.map(x=>x.pressed),prev=Input.pads[gp.index]||[];Input.pads[gp.index]=b;
    const edge=n=>b[n]&&!prev[n];
    if(UI.mode!=='play'){if(edge(0)||edge(9))UI.menuConfirm();return}
    if(edge(9)){UI.pause();return}
    const p=hs[i];if(!p)return;
    let x=gp.axes[0]||0,y=gp.axes[1]||0;if(Math.hypot(x,y)<.3){x=0;y=0}
    if(b[14])x=-1;if(b[15])x=1;if(b[12])y=-1;if(b[13])y=1;
    p.pad={x,y,act:!!(b[2]||b[1]||b[5])};
    if(edge(0))grab(p);
    if(edge(2)||edge(1)||edge(5))actDown(p);
    if(x||y||b.some(Boolean))Input.device='gamepad';
  });
}
function applyHumanInput(){
  for(const p of humans()){
    let x=(keyHeld(p,'right')?1:0)-(keyHeld(p,'left')?1:0),y=(keyHeld(p,'down')?1:0)-(keyHeld(p,'up')?1:0),act=keyHeld(p,'act');
    if(p.pad){if(p.pad.x||p.pad.y){x=p.pad.x;y=p.pad.y}act=act||p.pad.act}
    p.in.x=x;p.in.y=y;p.in.act=act;
  }
}
