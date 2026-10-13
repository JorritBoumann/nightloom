/* Sound: short synthesized effects and a soft generated lullaby. Nothing is loaded from files. */

const AU={ac:null,out:null,music:null,sfxOn:true,musicOn:true,timer:null,step:0,next:0};
const SF={pick:[520,700,.06,'triangle'],place:[420,300,.06,'triangle'],done:[660,990,.14,'sine'],good:[523,1046,.32,'sine'],
  bad:[220,130,.25,'sawtooth'],trash:[200,80,.15,'square'],throw:[260,720,.14,'sine'],dash:[420,820,.08,'sine'],
  pour:[760,480,.22,'sine'],splash:[320,180,.1,'triangle'],warn:[880,860,.07,'square'],bridge:[330,495,.3,'sine'],
  catch:[600,950,.1,'triangle'],nightmare:[160,70,.5,'sawtooth'],go:[392,784,.25,'triangle'],wind:[180,420,.6,'sine'],click:[600,640,.03,'triangle']};

function initAudio(){
  if(AU.ac){if(AU.ac.state==='suspended')AU.ac.resume();return}
  try{AU.ac=new (window.AudioContext||window.webkitAudioContext)()}catch(e){AU.ac=null;return}
  AU.out=AU.ac.createGain();AU.out.gain.value=.9;AU.out.connect(AU.ac.destination);
  AU.music=AU.ac.createGain();AU.music.gain.value=AU.musicOn?.05:0;AU.music.connect(AU.out);
  AU.next=AU.ac.currentTime+.1;AU.timer=setInterval(scheduleMusic,60);
}
function sfx(n){
  if(!AU.ac||!AU.sfxOn)return;const s=SF[n];if(!s)return;const now=AU.ac.currentTime;
  const play=(f0,f1,d,type,v,at=0)=>{const o=AU.ac.createOscillator(),g=AU.ac.createGain();o.type=type;o.frequency.setValueAtTime(f0,now+at);o.frequency.exponentialRampToValueAtTime(f1,now+at+d);g.gain.setValueAtTime(v,now+at);g.gain.exponentialRampToValueAtTime(.0008,now+at+d+.06);o.connect(g).connect(AU.out);o.start(now+at);o.stop(now+at+d+.08)};
  play(s[0],s[1],s[2],s[3],s[3]==='sawtooth'||s[3]==='square'?.045:.11);
  if(n==='good'){play(659,1318,.3,'sine',.07,.05);play(784,1568,.3,'sine',.05,.1)}
}
HOOK.sfx=sfx;

/* D major lullaby: I, vi, IV, V with a gentle arpeggio. It speeds up a little in a shift's last 20 seconds. */
const CHORDS=[[50,57,62,66],[47,54,59,62],[43,50,55,59],[45,52,57,61]];
const ARP=[0,2,1,3,2,1,3,-1];
const mtof=m=>440*Math.pow(2,(m-69)/12);
function note(m,t,d,type,v){
  const o=AU.ac.createOscillator(),g=AU.ac.createGain();o.type=type;o.frequency.value=mtof(m);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+.03);g.gain.exponentialRampToValueAtTime(.0005,t+d);
  o.connect(g).connect(AU.music);o.start(t);o.stop(t+d+.05);
}
function scheduleMusic(){
  if(!AU.ac)return;
  const urgent=S&&UI.mode==='play'&&S.timeLeft<20&&!S.over;
  const eighth=60/(urgent?92:72)/2;
  while(AU.next<AU.ac.currentTime+.25){
    const bar=Math.floor(AU.step/8)%4,i=AU.step%8,ch=CHORDS[bar];
    if(i===0){for(const m of ch.slice(0,3))note(m,AU.next,eighth*8,'sine',.22)}
    const a=ARP[i];if(a>=0)note(ch[a]+12+(AU.step%32>=24&&i===6?12:0),AU.next,eighth*1.8,'triangle',.28);
    AU.next+=eighth;AU.step++;
  }
}
function setMusic(on){AU.musicOn=on;if(AU.music)AU.music.gain.setTargetAtTime(on?.05:0,AU.ac.currentTime,.2)}
function setSfx(on){AU.sfxOn=on}
