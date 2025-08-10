// app.js
// A4=442Hz、自己相関＋放物線、RMS閾値、YAMAHA系針、二小節ページング、バックグラウンド即停止（許可要求もしない）、エラーは下部。

import { makeExercise4Bars, letterFreq } from "./scales.js";
import { renderTwoBars } from "./score.js";

// DOM
const selKey=document.getElementById("key-select");
const selPass=document.getElementById("pass");
const inpRMS=document.getElementById("rms");
const inpDbCal=document.getElementById("dbCal");
const btnStart=document.getElementById("start");
const btnStop=document.getElementById("stop");
const advice=document.getElementById("advice");
const bigScore=document.getElementById("big-score");
const prog=document.getElementById("prog");
const micdb=document.getElementById("micdb");
const gate=document.getElementById("mic-gate");
const permit=document.getElementById("permit");
const ticksGroup=document.getElementById("ticks");
const needleSvg=document.getElementById("needle");
const noteText=document.getElementById("noteText");
const octText=document.getElementById("octText");
const hzText=document.getElementById("hzText");
const centText=document.getElementById("centText");
const needleBar=document.getElementById("needleBar");
const fx=document.getElementById("fx");
const errList=document.getElementById("error-list");
const errCopy=document.getElementById("err-copy");

// エラー（重複なし）
const errors=new Set();
function pushErr(e){ const msg=typeof e==="string"?e:(e?.message||String(e)); const item=`${new Date().toISOString()} : ${msg}`; if(errors.has(item)) return; errors.add(item); const li=document.createElement("li"); li.textContent=item; errList.appendChild(li); console.error(item); }

// 針目盛（5c刻み／10c中／25c長）
(function(){ const cx=210,cy=140,r=95; const ang=c=>(-50+c)/100*(Math.PI*1.2)-Math.PI*0.6;
  for(let c=-50;c<=50;c+=5){ const a=ang(c), long=c%25===0, mid=c%10===0; const inner=r-(long?20:mid?14:9);
    const l=document.createElementNS("http://www.w3.org/2000/svg","line");
    l.setAttribute("x1",cx+inner*Math.sin(a)); l.setAttribute("y1",cy-inner*Math.cos(a));
    l.setAttribute("x2",cx+r*Math.sin(a));     l.setAttribute("y2",cy-r*Math.cos(a));
    l.setAttribute("stroke", c===0? "#8fd1ff":"#d7e6f3"); l.setAttribute("opacity", (!mid)?0.55:0.9); l.setAttribute("stroke-width", long?2:1);
    ticksGroup?.appendChild(l);
  }})();

// 合格閾値（85〜100）
for(let p=85;p<=100;p++){ const o=document.createElement("option"); o.textContent=p; selPass.appendChild(o); }
selPass.value="90";

// ===== Audio & Pitch =====
let audio, analyser, aHP,aPeak, srcNode, mediaStream;
let rafId=null, running=false;

// Audio
async function ensureAudio(){ if(!audio){ try{ audio=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"}); if(audio.state==="suspended") await audio.resume(); }catch(e){ pushErr(e); } } }
async function openMic(){
  if(document.visibilityState!=="visible"){ pushErr("非表示中はマイク許可しません"); return false; }
  await ensureAudio();
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 } });
  }catch(e){ pushErr("マイク未許可/未接続"); return false; }
  gate.setAttribute("aria-hidden","true");
  srcNode = audio.createMediaStreamSource(mediaStream);
  aHP = audio.createBiquadFilter(); aHP.type="highpass"; aHP.frequency.value=90; aHP.Q.value=0.7;
  aPeak = audio.createBiquadFilter(); aPeak.type="peaking"; aPeak.frequency.value=2500; aPeak.Q.value=1.0; aPeak.gain.value=5;
  analyser = audio.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=0.06;
  srcNode.connect(aHP).connect(aPeak).connect(analyser);
  document.getElementById("nosleep")?.play?.().catch(()=>{});
  return true;
}
function suspendAll(reason="suspend"){
  try{ running=false; if(rafId) cancelAnimationFrame(rafId); }catch{}
  try{ audio?.suspend?.(); }catch{}
  try{ mediaStream?.getTracks().forEach(t=>t.stop()); }catch(e){ pushErr(e); }
  mediaStream=null; analyser=srcNode=aHP=aPeak=undefined;
  btnStart.disabled=false; btnStop.disabled=true;
  gate.setAttribute("aria-hidden","false");
  console.log("[suspend]", reason);
}
// 可視性の全方位フック＋監視タイマ（取りこぼしゼロ）
const stopIfHidden=tag=>{ if(document.visibilityState!=="visible" || !document.hasFocus()){ if(mediaStream){ suspendAll(tag); } } };
["visibilitychange","webkitvisibilitychange","blur"].forEach(ev=>window.addEventListener(ev,()=>stopIfHidden(ev)));
window.addEventListener("pagehide",()=>suspendAll("pagehide"));
window.addEventListener("freeze",()=>suspendAll("freeze"));
setInterval(()=>stopIfHidden("watchdog"),800);

// 自己相関＋放物線
const winBuf=new Float32Array(8192), acBuf=new Float32Array(8192);
function detectPitch(){
  if(!analyser) return {freq:0,rms:0,db:0};
  const N=Math.min(analyser.fftSize,4096);
  const time=new Float32Array(N);
  try{ analyser.getFloatTimeDomainData(time); }catch(e){ pushErr(e); return {freq:0,rms:0,db:0}; }
  let rms=0; for(let i=0;i<N;i++) rms+=time[i]*time[i]; rms=Math.sqrt(rms/N);
  const db=Math.max(0,Math.min(120,Math.round(20*Math.log10(Math.max(rms,1e-9))+94+(parseFloat(inpDbCal.value)||0))));
  micdb.textContent=`${db} dB`; micdb.style.color=(db>=80)?"#ff3b30":(db>=70)?"#ff9f0a":(db>=40)?"#34c759":"#8fb3cc";
  if(rms < parseFloat(inpRMS.value||"0.0015")) return {freq:0,rms,db};
  for(let i=0;i<N;i++){ const w=0.54-0.46*Math.cos(2*Math.PI*i/(N-1)); winBuf[i]=time[i]*w; }
  const sr=audio.sampleRate, fMin=110, fMax=2200; const minLag=Math.floor(sr/fMax), maxLag=Math.floor(sr/fMin);
  let bestLag=-1,best=0; for(let lag=minLag; lag<=maxLag; lag++){ let s=0; for(let i=0;i<N-lag;i++) s+=winBuf[i]*winBuf[i+lag]; acBuf[lag]=s; if(s>best){best=s;bestLag=lag;} }
  if(bestLag<0) return {freq:0,rms,db};
  const y1=acBuf[bestLag-1]||0, y2=acBuf[bestLag]||0, y3=acBuf[bestLag+1]||0; const p=0.5*(y1-y3)/(y1-2*y2+y3); const lag=bestLag+(isFinite(p)?p:0);
  return {freq: sr/lag, rms, db};
}

// ===== Needle（YAMAHA系サーボ、±50c→±60°）=====
class ServoNeedle {
  constructor(){ this.pos=0; this.vel=0; this.target=0; this.DEADBAND=1; this.Z_BASE=0.78; this.WN=11.5; }
  setTarget(c){ this.target=Math.max(-50,Math.min(50,c)); }
  step(dt){ const e=this.target-this.pos; const near=Math.min(1,Math.abs(e)/6); const z=this.Z_BASE+(0.95-this.Z_BASE)*(1-near);
    const err=(Math.abs(e)<this.DEADBAND)?0:e;
    const a=this.WN*this.WN*err - 2*z*this.WN*this.vel;
    this.vel+=a*dt; this.pos+=this.vel*dt;
    const deg=this.pos*(60/50); needleSvg?.setAttribute("transform",`rotate(${deg} 210 140)`); return this.pos; }
}
const servo=new ServoNeedle();
function drawBarCents(c){ const pct=Math.max(0,Math.min(100,50+(c/50)*50)); needleBar.style.left=pct+"%"; }
const NAMES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function nearNoteName(f){ if(!f||!isFinite(f)) return {name:"—",oct:"-",ref:0}; const m=Math.round(69 + 12*Math.log2(f/442)); const name=NAMES[(m%12+12)%12]; const oct=Math.floor(m/12)-1; const ref=442*Math.pow(2,(m-69)/12); return {name,oct,ref}; }
const cents=(f,ref)=>1200*Math.log2(f/ref);
const scoreFrom=c=>Math.min(100,Math.max(0,100-(Math.abs(c)/50)*100));

// 火花
const FX=fx.getContext("2d"); let particles=[];
function sparks(x,y){ const W=fx.width=fx.clientWidth,H=fx.height=fx.clientHeight; for(let i=0;i<14;i++){ const a=Math.random()*Math.PI*2, v=60+Math.random()*120; particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,l:280}); } }
function tickSparks(dt){ const W=fx.width=fx.clientWidth,H=fx.clientHeight; FX.clearRect(0,0,W,H); FX.fillStyle="#7bffc0"; particles=particles.filter(p=>(p.l-=dt)>0).map(p=>{ p.x+=p.vx*dt/1000; p.y+=p.vy*dt/1000; FX.globalAlpha=Math.max(0,p.l/280); FX.fillRect(p.x,p.y,2,2); return p; }); }

// ===== Session（二小節ページング）=====
let session=null; // {key, all[32], pass, blockIdx, noteIdx, ctx}
let advanceLockUntil=0;

function buildSession(key){
  const all=makeExercise4Bars(key); // 32音 = 4小節
  return { key, all, pass:parseInt(selPass.value,10)||90, blockIdx:0, noteIdx:0, ctx:null };
}
function renderBlock(){
  const off=session.blockIdx*16;
  session.ctx=renderTwoBars({key:session.key, notes:session.all, offset:off});
  session.ctx.recolor(session.noteIdx,"note-target");
  prog.textContent=`音 ${off+session.noteIdx+1}/${session.all.length}`;
}
function resetSession(key){
  session=buildSession(key);
  requestAnimationFrame(()=>renderBlock());
  advice.textContent="待機中…"; advice.style.color="#ffccd5"; bigScore.textContent="0";
}

function markAndAdvance(score){
  const badge = score>=95?"◎":score>=90?"◯":"×";
  session.ctx.badge(session.noteIdx, badge);
  if(badge==="×"){ session.ctx.recolor(session.noteIdx,"note-failed"); }
  const p=session.ctx.getXY(session.noteIdx); sparks(p.x,p.y);

  session.noteIdx++;
  const abs=session.blockIdx*16 + session.noteIdx;
  if(session.noteIdx<16 && abs<session.all.length){
    session.ctx.recolor(session.noteIdx,"note-target");
    prog.textContent=`音 ${abs+1}/${session.all.length}`;
  }else{
    session.blockIdx++; session.noteIdx=0;
    if(session.blockIdx*16 >= session.all.length){ suspendAll("finished"); return; }
    renderBlock();
  }
}

// ===== Loop =====
let lastT=performance.now();
function loop(){
  const now=performance.now(), dt=now-lastT; lastT=now;
  const {freq}=detectPitch();

  tickSparks(dt);

  if(freq>0 && session){
    const idxAbs=session.blockIdx*16 + session.noteIdx;
    const target=session.all[idxAbs];
    const fT=letterFreq(target.letter,target.octave,session.key);
    const c=cents(freq,fT); drawBarCents(Math.max(-50,Math.min(50,c)));
    const s=scoreFrom(c); bigScore.textContent=String(Math.round(s));

    const near=nearNoteName(freq); const cn=cents(freq,near.ref);
    servo.setTarget(cn);
    const sm=servo.step(dt/1000);
    centText.textContent=String(Math.round(sm));
    noteText.textContent=near.name; octText.textContent=near.oct; hzText.textContent=`${Math.round(freq)} Hz`;

    const a=Math.abs(c);
    if(a>50){ advice.textContent="頑張ろう！"; advice.style.color="#f8b4c4"; }
    else if(a>15){ advice.textContent=(c>0?`${a|0}c 高い`:`${a|0}c 低い`); advice.style.color="#ffd166"; }
    else { advice.textContent="いい感じ！"; advice.style.color="#c7ffd1"; }

    const passed=(a<=50)&&(s>=session.pass);
    if(passed && now>advanceLockUntil){
      advanceLockUntil=now+180;
      setTimeout(()=>markAndAdvance(Math.round(s)),200);
    }
  }else{
    servo.setTarget(0);
    const sm=servo.step(dt/1000); centText.textContent=String(Math.round(sm));
    bigScore.textContent="0";
  }

  if(running) rafId=requestAnimationFrame(loop);
}

// ===== Permission & UI =====
window.__permit = async function(){
  if(document.visibilityState!=="visible"){ pushErr("非表示中の許可要求は行いません"); return; }
  const ok=await openMic();
  if(ok){ resetSession(selKey.value); running=false; btnStart.disabled=false; btnStop.disabled=true; }
  else { gate.setAttribute("aria-hidden","false"); }
};
["pointerup","touchend","click"].forEach(t=> permit.addEventListener(t, async (e)=>{e.preventDefault(); await window.__permit(); }, {passive:false}));

async function startFlow(){
  if(document.visibilityState!=="visible"){ pushErr("非表示中の開始は無効です"); return; }
  if(!mediaStream){ const ok=await openMic(); if(!ok) return; }
  if(!session) resetSession(selKey.value);
  running=true; btnStart.disabled=true; btnStop.disabled=false; lastT=performance.now(); loop();
}
["pointerup","touchend","click"].forEach(t=> btnStart.addEventListener(t,(e)=>{e.preventDefault();startFlow();},{passive:false}));
btnStop.addEventListener("click",()=>suspendAll("stop"));

selKey.addEventListener("change",()=>{ suspendAll("key-change"); resetSession(selKey.value); });

errCopy.onclick=async ()=>{ try{ await navigator.clipboard.writeText([...errors.values()].join("\n")); }catch(e){ pushErr(e); } };

// 初期
resetSession("G");
