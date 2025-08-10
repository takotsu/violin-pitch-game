// app.js
// 自己相関＋放物線補間、RMS→dB、針/バー、流れる譜面（4小節=32音）、合格200msディレイ＆~180msロック、火花、ゲート、可視/不可視、エラー（下部）

import { makeExercise4Bars, letterFreq } from "./scales.js";
import { renderConveyor } from "./score.js";

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
function pushErr(e){
  const msg=typeof e==="string"?e:(e?.message||String(e));
  const item=`${new Date().toISOString()} : ${msg}`;
  if(errors.has(item)) return; errors.add(item);
  const li=document.createElement("li"); li.textContent=item; errList.appendChild(li);
  console.error(item);
}

// 針：目盛（5c小、10c中、25c長）
(function buildTicks(){
  const cx=210, cy=140, r=95;
  const ang = c=>(-50+c)/100*(Math.PI*1.2) - Math.PI*0.6; // 扇を少し広めに
  for(let c=-50;c<=50;c+=5){
    const a=ang(c);
    const long=(c%25===0), mid=(c%10===0), small=!mid;
    const inner = r - (long?20:mid?14:9);
    const x1=cx + inner*Math.sin(a), y1=cy - inner*Math.cos(a);
    const x2=cx + r*Math.sin(a),     y2=cy - r*Math.cos(a);
    const l=document.createElementNS("http://www.w3.org/2000/svg","line");
    l.setAttribute("x1",x1); l.setAttribute("y1",y1); l.setAttribute("x2",x2); l.setAttribute("y2",y2);
    l.setAttribute("stroke", c===0? "#8fd1ff":"#d7e6f3"); l.setAttribute("opacity", small?0.55:0.9);
    l.setAttribute("stroke-width", long?2:1);
    ticksGroup?.appendChild(l);
  }
})();

// 合格閾値
for(let p=85;p<=100;p++){ const o=document.createElement("option"); o.textContent=p; selPass.appendChild(o); }
selPass.value="90";

// 状態
let audio, analyser, aHP,aPeak, srcNode, mediaStream;
let rafId=null, running=false;
let session=null; // {key,notes[32],idx,pass,results[32],conv}
let advanceLockUntil=0;

// Audio
async function ensureAudio(){
  if(!audio){
    try{
      audio=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
      if(audio.state==="suspended") await audio.resume();
    }catch(e){ pushErr(e); }
  }
}
async function openMic(){
  await ensureAudio();
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}
    });
  }catch(e){ pushErr("マイク未許可/未接続"); return false; }
  gate.setAttribute("aria-hidden","true");
  srcNode = audio.createMediaStreamSource(mediaStream);
  aHP = audio.createBiquadFilter(); aHP.type="highpass"; aHP.frequency.value=90; aHP.Q.value=0.7;
  aPeak = audio.createBiquadFilter(); aPeak.type="peaking"; aPeak.frequency.value=2500; aPeak.Q.value=1.0; aPeak.gain.value=5;
  analyser = audio.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=0.06;
  srcNode.connect(aHP).connect(aPeak).connect(analyser);
  try{ document.getElementById("nosleep").play().catch(()=>{});}catch{}
  return true;
}
function closeMic(){
  try{ mediaStream?.getTracks().forEach(t=>t.stop()); }catch(e){ pushErr(e); }
  mediaStream=null; analyser=srcNode=aHP=aPeak=undefined;
}

// 検出（自己相関+放物線）
const winBuf=new Float32Array(8192), acBuf=new Float32Array(8192);
function detectPitch(){
  if(!analyser) return {freq:0,rms:0,db:0};
  const N=Math.min(analyser.fftSize,4096);
  const time=new Float32Array(N);
  try{ analyser.getFloatTimeDomainData(time); }catch(e){ pushErr(e); return {freq:0,rms:0,db:0}; }

  // RMS→dB
  let rms=0; for(let i=0;i<N;i++){ rms += time[i]*time[i]; } rms=Math.sqrt(rms/N);
  const db = Math.max(0, Math.min(120, Math.round(20*Math.log10(Math.max(rms,1e-9))+94+(parseFloat(inpDbCal.value)||0))));
  micdb.textContent = `${db} dB`;
  micdb.style.color = (db>=80)?"#ff3b30":(db>=70)?"#ff9f0a":(db>=40)?"#34c759":"#8fb3cc";
  if(rms < parseFloat(inpRMS.value||"0.0015")) return {freq:0,rms,db};

  // ハミング窓
  for(let i=0;i<N;i++){ const w=0.54-0.46*Math.cos(2*Math.PI*i/(N-1)); winBuf[i]=time[i]*w; }
  const sr=audio.sampleRate, fMin=110, fMax=2200;
  const minLag=Math.floor(sr/fMax), maxLag=Math.floor(sr/fMin);

  // 自己相関
  let bestLag=-1,best=0;
  for(let lag=minLag; lag<=maxLag; lag++){
    let sum=0; for(let i=0;i<N-lag;i++) sum+=winBuf[i]*winBuf[i+lag];
    acBuf[lag]=sum; if(sum>best){best=sum;bestLag=lag;}
  }
  if(bestLag<0) return {freq:0,rms,db};

  // 放物線補間
  const y1=acBuf[bestLag-1]||0, y2=acBuf[bestLag]||0, y3=acBuf[bestLag+1]||0;
  const p=0.5*(y1-y3)/(y1-2*y2+y3);
  const lag=bestLag+(isFinite(p)?p:0);
  return {freq: sr/lag, rms, db};
}

// 針・バー
let needlePos=0, needleVel=0;
function smoothNeedle(targetCents, dtMs){
  const dt=dtMs/1000, desired=Math.max(-50,Math.min(50,targetCents));
  const K=10.5, D=9.5; const acc=K*(desired-needlePos)-D*needleVel; needleVel+=acc*dt; needlePos+=needleVel*dt;
  const angle=needlePos*(60/50); needleSvg?.setAttribute("transform",`rotate(${angle} 210 140)`); return needlePos;
}
function drawBarCents(c){ const pct=Math.max(0,Math.min(100,50+(c/50)*50)); needleBar.style.left=pct+"%"; }
const names=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function nearNoteName(f){ if(!f||!isFinite(f)) return {name:"—",oct:"-",ref:0}; const m=Math.round(12*Math.log2(f/442)+57); return {name:names[(m+1200)%12],oct:Math.floor(m/12)-1,ref:442*Math.pow(2,(m-69)/12)}; }
const cents=(f,ref)=>1200*Math.log2(f/ref);
const scoreFrom=c=>Math.min(100,Math.max(0,100-(Math.abs(c)/50)*100));

// 火花
const FX=fx.getContext("2d"); let particles=[];
function sparks(x,y){ const W=fx.width=fx.clientWidth,H=fx.height=fx.clientHeight; for(let i=0;i<14;i++){ const a=Math.random()*Math.PI*2, v=60+Math.random()*120; particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,l:280}); } }
function tickSparks(dt){ const W=fx.width=fx.clientWidth,H=fx.height=fx.clientHeight; FX.clearRect(0,0,W,H); FX.fillStyle="#7bffc0"; particles=particles.filter(p=>(p.l-=dt)>0).map(p=>{ p.x+=p.vx*dt/1000; p.y+=p.vy*dt/1000; FX.globalAlpha=Math.max(0,p.l/280); FX.fillRect(p.x,p.y,2,2); return p; }); }

// セッション
function resetSession(key){
  const notes=makeExercise4Bars(key); // 32音 = 4小節
  session={ key, notes, idx:0, pass:parseInt(selPass.value,10)||90, results:Array(notes.length).fill(null), conv:renderConveyor(key, notes) };
  prog.textContent=`音 1/${notes.length}`;
  advice.textContent="待機中…"; advice.style.color="#ffccd5"; bigScore.textContent="0";
}

function markBadge(localIdx,score){
  const kind = score>=95?"◎":score>=90?"◯":"×";
  if(kind==="×"){ session.conv.recolor(localIdx,"note-failed"); }
  session.conv.putBadge(localIdx, kind);
}

function advance(){
  session.idx++;
  prog.textContent=`音 ${Math.min(session.idx+1,session.notes.length)}/${session.notes.length}`;
  session.conv.advance();
}

// ループ
let lastT=performance.now();
function loop(){
  const now=performance.now(), dt=now-lastT; lastT=now;
  const {freq}=detectPitch();

  tickSparks(dt);

  if(freq>0 && session){
    const target=session.notes[session.idx];
    const fT=letterFreq(target.letter,target.octave,session.key);
    const c=cents(freq,fT);
    drawBarCents(Math.max(-50,Math.min(50,c)));
    const s=scoreFrom(c); bigScore.textContent=String(Math.round(s));

    const near=nearNoteName(freq); const cn=cents(freq,near.ref);
    const sm=smoothNeedle(cn,dt); centText.textContent=String(Math.round(sm));
    noteText.textContent=near.name; octText.textContent=near.oct; hzText.textContent=`${Math.round(freq)} Hz`;

    const a=Math.abs(c);
    if(a>50){ advice.textContent="頑張ろう！"; advice.style.color="#f8b4c4"; }
    else if(a>15){ advice.textContent=(c>0?`${a|0}c 高い`:`${a|0}c 低い`); advice.style.color="#ffd166"; }
    else { advice.textContent="いい感じ！"; advice.style.color="#c7ffd1"; }

    // 合格判定（初回のみ）→200ms後消して流す、~180msロック
    const passed=(a<=50)&&(s>=session.pass);
    if(passed && session.results[session.idx]==null && now>advanceLockUntil){
      const local=0; // 左端が常にターゲット
      session.results[session.idx]=Math.round(s);
      markBadge(local, session.results[session.idx]);
      const xy=session.conv.getNoteXY(local); sparks(xy.x,xy.y);
      advanceLockUntil=now+180;
      setTimeout(()=>{ advance(); },200);
    }
    // 最後まで進んだら停止
    if(session.idx>=session.notes.length){ running=false; btnStart.disabled=false; btnStop.disabled=true; closeMic(); }
  }else{
    const sm=smoothNeedle(0,dt); centText.textContent=String(Math.round(sm)); bigScore.textContent="0";
  }

  if(running) rafId=requestAnimationFrame(loop);
}

// 許可・UI
window.__permit = async function(){
  const ok=await openMic();
  if(ok){ resetSession(selKey.value); running=false; btnStart.disabled=false; btnStop.disabled=true; }
  else { gate.setAttribute("aria-hidden","false"); }
};
async function handlePermit(ev){ try{ev.preventDefault();ev.stopPropagation();}catch{} await window.__permit(); }
["pointerup","touchend","click"].forEach(t=> permit.addEventListener(t, handlePermit, {passive:false}));

btnStart.onclick=async ()=>{
  if(!mediaStream){ const ok=await openMic(); if(!ok) return; }
  if(!session) resetSession(selKey.value);
  running=true; btnStart.disabled=true; btnStop.disabled=false; lastT=performance.now(); loop();
};
btnStop.onclick=()=>{ running=false; btnStart.disabled=false; btnStop.disabled=true; if(rafId) cancelAnimationFrame(rafId); closeMic(); };
selKey.addEventListener("change",()=>{ running=false; btnStart.disabled=false; btnStop.disabled=true; if(rafId) cancelAnimationFrame(rafId); resetSession(selKey.value); });

window.addEventListener("visibilitychange",()=>{
  if(document.hidden){
    running=false; if(rafId) cancelAnimationFrame(rafId);
    btnStart.disabled=false; btnStop.disabled=true;
    closeMic(); gate.setAttribute("aria-hidden","false");
  }
});
window.addEventListener("pagehide",()=>{ closeMic(); });

errCopy.onclick=async ()=>{ try{ await navigator.clipboard.writeText([...errors.values()].join("\n")); }catch(e){ pushErr(e); } };

// 初期
resetSession("G");
