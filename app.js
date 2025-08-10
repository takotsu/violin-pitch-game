// app.js v0-4b — 既存機能維持。針式チューナーの挙動調整、48音固定、0.5秒保持のまま。
import { makeMajorScale3Oct, toVexKeys, letterFreq } from "./scales.js";
import { renderPage, recolorPage } from "./score.js";

const selKey=document.getElementById("key-select");
const selPass=document.getElementById("pass");
const inpRMS=document.getElementById("rms");
const inpDbCal=document.getElementById("dbCal");
const btnStart=document.getElementById("start");
const btnStop=document.getElementById("stop");
const advice=document.getElementById("advice");
const bigScore=document.getElementById("big-score");
const prog=document.getElementById("prog");
const needleBar=document.getElementById("needleBar");
const micdb=document.getElementById("micdb");
const gate=document.getElementById("mic-gate");
const permit=document.getElementById("permit");

// tuner svg elems
const needleSvg=document.getElementById("needle");
const ticksGroup=document.getElementById("ticks");
const noteText=document.getElementById("noteText");
const octText=document.getElementById("octText");
const hzText=document.getElementById("hzText");
const centText=document.getElementById("centText");

// 合格閾値
for(let p=85;p<=100;p++){ const o=document.createElement("option"); o.textContent=p; selPass.appendChild(o); }
selPass.value="90";

// 針式チューナー目盛り
(function buildTicks(){
  const cx=210, cy=170, r=128;
  const ang = c=>(-50+c)/100* (Math.PI*0.9) - Math.PI*0.45; // -0.45π..+0.45π
  for(let c=-50;c<=50;c+=5){
    const a=ang(c);
    const inner = r - (c%25===0?18:10);
    const x1=cx + inner*Math.sin(a), y1=cy - inner*Math.cos(a);
    const x2=cx + r*Math.sin(a),     y2=cy - r*Math.cos(a);
    const l=document.createElementNS("http://www.w3.org/2000/svg","line");
    l.setAttribute("x1",x1); l.setAttribute("y1",y1); l.setAttribute("x2",x2); l.setAttribute("y2",y2);
    l.setAttribute("stroke", c===0? "#8fd1ff":"#d7e6f3"); l.setAttribute("opacity", c%25===0?1:0.6);
    l.setAttribute("stroke-width", c%25===0?2:1);
    ticksGroup.appendChild(l);
  }
})();

const names=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

let audio, analyser, aHP,aPeak, srcNode, mediaStream;
let rafId=null, running=false, session=null, pageCtx=null, page=0, perPage=24;

async function ensureAudio(){ if(!audio){ audio=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"}); if(audio.state==="suspended"){ try{ await audio.resume(); }catch{} } } }
async function openMic(){
  await ensureAudio();
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 } });
  }catch(e){
    advice.textContent="マイク未許可／未接続です"; advice.style.color="#ff9f0a"; return false;
  }
  gate.setAttribute("aria-hidden","true");
  srcNode = audio.createMediaStreamSource(mediaStream);
  aHP = audio.createBiquadFilter(); aHP.type="highpass"; aHP.frequency.value=90; aHP.Q.value=0.7;
  aPeak = audio.createBiquadFilter(); aPeak.type="peaking"; aPeak.frequency.value=2500; aPeak.Q.value=1.0; aPeak.gain.value=5;
  analyser = audio.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=0.06;
  srcNode.connect(aHP).connect(aPeak).connect(analyser);
  try{ document.getElementById("nosleep").play(); }catch{}
  return true;
}
function closeMic(){ if(mediaStream){ mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; } analyser=srcNode=aHP=aPeak=undefined; }

const buf=new Float32Array(8192);
function detectPitch(){
  if(!analyser) return {freq:0,rms:0,db:0};
  const len=Math.min(buf.length, analyser.fftSize), time=new Float32Array(len);
  analyser.getFloatTimeDomainData(time);
  let rms=0; for(let i=0;i<len;i++){ const v=time[i]; rms+=v*v; } rms=Math.sqrt(rms/len);

  const db = Math.max(0, Math.min(120, Math.round(20*Math.log10(Math.max(rms,1e-9))+94+(parseFloat(inpDbCal.value)||0))));
  micdb.textContent = `${db} dB`;
  micdb.style.color = (db>=80)?"#ff3b30":(db>=70)?"#ff9f0a":(db>=40)?"#34c759":"#8fb3cc";

  if(rms < parseFloat(inpRMS.value||"0.0015")) return {freq:0,rms,db};

  for(let i=0;i<len;i++){ const w=0.5*(1-Math.cos(2*Math.PI*i/(len-1))); buf[i]=time[i]*w; }
  const sr=audio.sampleRate, fMin=110, fMax=2200; const minLag=Math.floor(sr/fMax), maxLag=Math.floor(sr/fMin);
  let bestLag=-1,best=0;
  for(let lag=minLag; lag<=maxLag; lag++){ let sum=0; for(let i=0;i<len-lag;i++) sum+=buf[i]*buf[i+lag]; if(sum>best){best=sum;bestLag=lag;} }
  if(bestLag>0){ let y0=0,y1=0,y2=0; for(let i=0;i<len-(bestLag+1);i++){ y0+=buf[i]*buf[i+bestLag-1]; y1+=buf[i]*buf[i+bestLag]; y2+=buf[i]*buf[i+bestLag+1]; }
    const p=0.5*(y0-y2)/(y0-2*y1+y2); const lag=bestLag+(isFinite(p)?p:0); return {freq:sr/lag,rms,db}; }
  return {freq:0,rms,db};
}

// --- チューナー（針＋バー） ---
function freqToNoteName(f){ if(!f||!isFinite(f)) return {name:"—",oct:"-",ref:0}; const m=Math.round(12*Math.log2(f/442)+57); return {name:names[(m+1200)%12],oct:Math.floor(m/12)-1,ref:442*Math.pow(2,(m-69)/12)}; }
const centsFrom=(f,ref)=>1200*Math.log2(f/ref);
const scoreFromCents=c=>Math.min(100, Math.max(0, 100 - (Math.abs(c)/50)*100 ));
function drawBarCents(c){ const pct=Math.max(0,Math.min(100,50+(c/50)*50)); needleBar.style.left=pct+"%"; }

let needlePos=0, needleVel=0;
function smoothTo(targetCents, dtMs){
  // ±50c → ±60°。臨界減衰寄りで自然な戻り。
  const dt = dtMs/1000;
  const desired = Math.max(-50, Math.min(50, targetCents));
  const K = 10.5, D = 9.5;
  const acc = K*(desired - needlePos) - D*needleVel;
  needleVel += acc*dt;
  needlePos += needleVel*dt;
  const angle = needlePos * (60/50);
  needleSvg.setAttribute("transform",`rotate(${angle} 210 170)`);
  return needlePos;
}
function setNeedleUI(cents,f,nn){ centText.textContent=`${Math.round(cents)}`; noteText.textContent=nn.name; octText.textContent=nn.oct; hzText.textContent = f?`${Math.round(f)} Hz`:"0 Hz"; }

// --- セッション（48音固定） ---
function resetSession(key){
  const sc=makeMajorScale3Oct(key);
  const vex=toVexKeys(sc.notes,key);
  session={ key, notes:sc.notes, vex, idx:0, pass:parseInt(selPass.value,10)||90, results:Array(48).fill(null) };
  page=0; perPage=24;
  pageCtx=renderPage({key:session.key, vexKeys:session.vex, objs:session.notes, page, perPage});
  recolorPage(pageCtx,0);
  prog.textContent=`音 1/48（上行）`;
  advice.textContent="待機中…"; advice.style.color="#ffccd5"; bigScore.textContent="0";
}
function turnPageIfNeeded(){ const newPage=Math.floor(session.idx/perPage); if(newPage!==page){ page=newPage; pageCtx=renderPage({key:session.key, vexKeys:session.vex, objs:session.notes, page, perPage}); } }
function advance(){ if(session.idx<47){ session.idx++; turnPageIfNeeded(); recolorPage(pageCtx, session.idx%perPage); prog.textContent=`音 ${session.idx+1}/48 ${session.idx<24?"（上行）":"（下行）"}`; } }

let lastT=performance.now(), holdMs=0;
function loop(){
  const now=performance.now(), dt=now-lastT; lastT=now;
  const {freq}=detectPitch();

  if(freq>0 && session){
    const note=session.notes[session.idx];
    const fT=letterFreq(note.letter,note.octave,session.key);
    const cents=centsFrom(freq,fT);
    const near=freqToNoteName(freq);
    const cn=centsFrom(freq,near.ref);
    const sm=smoothTo(cn,dt);
    setNeedleUI(sm,freq,near);
    drawBarCents(Math.max(-50,Math.min(50,cents)));

    const sc=scoreFromCents(cents); bigScore.textContent=Math.round(sc);
    const a=Math.abs(cents);
    if(a>50){ advice.textContent="頑張ろう！"; advice.style.color="#ffccd5"; holdMs=0; }
    else if(a>15){ advice.textContent=(cents>0?`${a|0}c 高い`:`${a|0}c 低い`); advice.style.color="#ffd166"; holdMs=0; }
    else { advice.textContent="いい感じ！"; advice.style.color="#c7ffd1"; holdMs+=dt; }

    if(holdMs>=500){ holdMs=0; advance(); }
  }else{
    const sm=smoothTo(0,dt); setNeedleUI(sm,0,{name:"—",oct:"-"}); bigScore.textContent="0";
  }
  if(running) rafId=requestAnimationFrame(loop);
}

// —— UI —— //
permit.addEventListener("click", async ()=>{ if(await openMic()) resetSession(selKey.value); });
btnStart.onclick=async ()=>{ if(!mediaStream){ const ok=await openMic(); if(!ok) return; } if(!session) resetSession(selKey.value); running=true; btnStart.disabled=true; btnStop.disabled=false; lastT=performance.now(); loop(); };
btnStop.onclick=()=>{ running=false; btnStart.disabled=false; btnStop.disabled=true; if(rafId) cancelAnimationFrame(rafId); closeMic(); };
selKey.addEventListener("change",()=>{ running=false; btnStart.disabled=false; btnStop.disabled=true; if(rafId) cancelAnimationFrame(rafId); resetSession(selKey.value); });
window.addEventListener("visibilitychange",()=>{ if(document.hidden){ running=false; if(rafId) cancelAnimationFrame(rafId); btnStart.disabled=false; btnStop.disabled=true; closeMic(); }});
window.addEventListener("pagehide",()=>{ closeMic(); });
window.addEventListener("resize",()=>{ if(pageCtx) recolorPage(pageCtx, session? (session.idx%perPage):0); });

// 初期
resetSession("G");
