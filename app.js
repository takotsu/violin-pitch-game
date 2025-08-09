import { makeMajorScale3Oct, toVexKeys, letterFreq } from "./scales.js";
import { renderScale, highlightIndex } from "./score.js";

const selKey = document.getElementById("key-select");
const selPass= document.getElementById("pass");
const inpRMS = document.getElementById("rms");
const inpDbCal= document.getElementById("dbCal");
const btnStart=document.getElementById("start");
const btnStop =document.getElementById("stop");
const advice  =document.getElementById("advice");
const bigScore=document.getElementById("big-score");
const prog    =document.getElementById("prog");
const needle  =document.getElementById("needle");
const fxCanvas=document.getElementById("fx");
const micdb   =document.getElementById("micdb");
const gate    =document.getElementById("mic-gate");
const permit  =document.getElementById("permit");

for(let p=85;p<=100;p++){ const o=document.createElement("option"); o.textContent=p; selPass.appendChild(o); }
selPass.value="90";

const errors=[];
const pushErr=(e)=>{ const t=new Date().toISOString().replace("T"," ").slice(0,19); const line=`${t} : ${e}`; errors.push(line); console.warn(line); };
function showErrorModal(){
  const modal=document.getElementById("error-modal"); const list=document.getElementById("error-list"); list.innerHTML="";
  errors.slice(-200).forEach(s=>{ const li=document.createElement("li"); li.textContent=s; list.appendChild(li); });
  modal.setAttribute("aria-hidden","false");
  document.getElementById("err-close").onclick=()=>modal.setAttribute("aria-hidden","true");
  document.getElementById("err-copy").onclick=()=>navigator.clipboard.writeText(errors.join("\n"));
}
window.addEventListener("error",ev=>{ pushErr(ev.message||"Error"); showErrorModal(); });

let audio, analyser, aFilt1,aFilt2, srcNode, gain, mediaStream;
let rafId=null, running=false, session=null, renderCtx=null;

async function openMic(){
  if(!audio) audio = new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
  }catch(e){ pushErr("mic permission: "+e.message); showErrorModal(); throw e; }
  srcNode = audio.createMediaStreamSource(mediaStream);

  // A-weighting 近似（ハイパス＋ピーキング）
  aFilt1 = audio.createBiquadFilter(); aFilt1.type="highpass"; aFilt1.frequency.value=120; aFilt1.Q.value=0.7;
  aFilt2 = audio.createBiquadFilter(); aFilt2.type="peaking";  aFilt2.frequency.value=2500; aFilt2.Q.value=0.9; aFilt2.gain.value=6;
  gain   = audio.createGain(); gain.gain.value=1.0;

  analyser = audio.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=0.05;
  srcNode.connect(aFilt1).connect(aFilt2).connect(gain).connect(analyser);

  try{ document.getElementById("nosleep").play(); }catch{}
}
function closeMic(){
  if(mediaStream){ mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; }
  analyser=srcNode=gain=aFilt1=aFilt2=undefined;
}

const buf=new Float32Array(8192);
function detectPitch(){
  if(!analyser) return {freq:0,rms:0,db:0};
  const len=Math.min(buf.length, analyser.fftSize);
  const time=new Float32Array(len);
  analyser.getFloatTimeDomainData(time);
  let rms=0; for(let i=0;i<len;i++){ const v=time[i]; rms+=v*v; } rms=Math.sqrt(rms/len);

  // 相対 dB 表示：dBFS をベースにし、校正オフセットで実用化
  const dbfs = rms>0 ? 20*Math.log10(rms) : -120;
  const db = Math.max(0, Math.min(120, Math.round(dbfs + 100 + (parseFloat(inpDbCal.value)||0)))); // ≒0..120dB に収める

  // 表示色
  micdb.textContent = `${db} dB`;
  micdb.style.color = (db>=80) ? "#ff3b30" : (db>=70) ? "#ff9f0a" : (db>=40) ? "#34c759" : "#8fb3cc";

  if(rms < parseFloat(inpRMS.value||"0.002")) return {freq:0,rms,db};
  // ハミング窓
  for(let i=0;i<len;i++){ const w=0.5*(1-Math.cos(2*Math.PI*i/(len-1))); buf[i]=time[i]*w; }
  const sr=audio.sampleRate, fMin=110, fMax=2200;
  const minLag=Math.floor(sr/fMax), maxLag=Math.floor(sr/fMin);
  let bestLag=-1, best=0;
  for(let lag=minLag; lag<=maxLag; lag++){
    let sum=0; for(let i=0;i<len-lag;i++) sum+=buf[i]*buf[i+lag];
    if(sum>best){ best=sum; bestLag=lag; }
  }
  if(bestLag>0){
    let y0=0,y1=0,y2=0;
    for(let i=0;i<len-(bestLag+1);i++){ y0+=buf[i]*buf[i+bestLag-1]; y1+=buf[i]*buf[i+bestLag]; y2+=buf[i]*buf[i+bestLag+1]; }
    const p=0.5*(y0-y2)/(y0-2*y1+y2);
    const lag = bestLag + (isFinite(p)?p:0);
    return {freq: sr/lag, rms, db};
  }
  return {freq:0,rms,db};
}

const centsFrom=(f,ref)=>1200*Math.log2(f/ref);
const scoreFromCents=c=>Math.min(100, Math.max(0, 100 - (Math.abs(c)/50)*100 ));
const drawCents=c=>{ const pct=Math.max(0,Math.min(100,50+(c/50)*50)); needle.style.left=pct+"%"; };

function sparks(){
  const cv=fxCanvas, ctx=cv.getContext("2d");
  if(!cv.width||!cv.height){ const wrap=document.getElementById("staff-wrap"); cv.width=wrap.clientWidth; cv.height=wrap.clientHeight; }
  const N=90, P=[];
  for(let i=0;i<N;i++){ const a=Math.random()*Math.PI*2, sp=2.2+Math.random()*2.6; P.push({x:cv.width*0.5,y:cv.height*0.28, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:0, hue:120+Math.random()*80}); }
  let t0=performance.now();
  function step(now){
    const dt=Math.min(32, now-t0)/1000; t0=now;
    ctx.clearRect(0,0,cv.width,cv.height);
    P.forEach(p=>{ p.life+=dt; p.vy+=2.8*dt; p.x+=p.vx; p.y+=p.vy;
      const a=Math.max(0,1-p.life/0.7); ctx.fillStyle=`hsla(${p.hue} 80% 60% / ${a})`; ctx.beginPath(); ctx.arc(p.x,p.y,2,0,Math.PI*2); ctx.fill(); });
    if(P[0].life<0.7) requestAnimationFrame(step); else ctx.clearRect(0,0,cv.width,cv.height);
  }
  requestAnimationFrame(step);
  if(navigator.vibrate) try{ navigator.vibrate(12); }catch{}
}

function resetSession(key){
  const sc=makeMajorScale3Oct(key);
  const vex=toVexKeys(sc.notes, key);
  renderCtx = renderScale(sc.keySignature, vex, sc.notes);
  session={ key, notes:sc.notes, idx:0, pass:parseInt(selPass.value,10)||90, results:Array(sc.notes.length).fill(null), advancedAt:0, waitingFirst:true };
  prog.textContent=`音 1/${session.notes.length}`;
  advice.textContent="待機中…"; advice.style.color="#ffccd5"; bigScore.textContent="0";
  highlightIndex(renderCtx,0);
}
function advance(){
  if(!session) return;
  if(session.idx < session.notes.length-1){
    session.idx += 1; session.waitingFirst=true;
    highlightIndex(renderCtx, session.idx);
    prog.textContent=`音 ${session.idx+1}/${session.notes.length}`;
  }
}

function loop(){
  const {freq,rms,db}=detectPitch();
  if(freq>0 && session){
    const n=session.notes[session.idx];
    const target=letterFreq(n.letter, n.octave, session.key);
    const c=centsFrom(freq,target); const sc=scoreFromCents(c);
    drawCents(Math.max(-50,Math.min(50,c))); bigScore.textContent=Math.round(sc);

    const abs=Math.abs(c);
    if(abs>50){ advice.textContent="頑張ろう！"; advice.style.color="#ffccd5"; }
    else if(abs>15){ advice.textContent=(c>0?`${abs|0}c 高い`:`${abs|0}c 低い`); advice.style.color="#ffd166"; }
    else { advice.textContent="いい感じ！"; advice.style.color="#c7ffd1"; }

    if(abs<=50){
      if(session.waitingFirst){
        session.results[session.idx]=Math.round(sc);
        session.waitingFirst=false;
        highlightIndex(renderCtx, session.idx, session.results[session.idx]);
        if(session.results[session.idx] >= session.pass){ const now=performance.now(); if(now - session.advancedAt > 140){ session.advancedAt=now; sparks(); advance(); } }
      }else if(session.results[session.idx] < session.pass && sc>=session.pass){
        const now=performance.now(); if(now - session.advancedAt > 140){ session.advancedAt=now; sparks(); advance(); }
      }
    }
  }else{
    bigScore.textContent="0";
  }
  if(running) rafId=requestAnimationFrame(loop);
}

// —— UI / ライフサイクル —— //
document.getElementById("permit").addEventListener("click", async ()=>{
  try{ await openMic(); document.getElementById("mic-gate").setAttribute("aria-hidden","true"); }
  catch{ /* 失敗時はゲートを閉じない */ }
});
btnStart.onclick=async ()=>{
  try{
    if(!mediaStream) await openMic();
    running=true; btnStart.disabled=true; btnStop.disabled=false; loop();
  }catch(e){ pushErr(e.message||e); showErrorModal(); }
};
btnStop.onclick=()=>{ running=false; btnStart.disabled=false; btnStop.disabled=true; if(rafId) cancelAnimationFrame(rafId); closeMic(); };

selKey.addEventListener("change",()=>{ running=false; btnStart.disabled=false; btnStop.disabled=true; if(rafId) cancelAnimationFrame(rafId); resetSession(selKey.value); });
selPass.addEventListener("change",()=>{ if(session) session.pass=parseInt(selPass.value,10)||90; });

window.addEventListener("visibilitychange",()=>{ if(document.hidden){ running=false; if(rafId) cancelAnimationFrame(rafId); btnStart.disabled=false; btnStop.disabled=true; closeMic(); document.getElementById("mic-gate").setAttribute("aria-hidden","false"); }});
window.addEventListener("pagehide",()=>{ closeMic(); });
window.addEventListener("resize",()=>{ const wrap=document.getElementById("staff-wrap"); fxCanvas.width=wrap.clientWidth; fxCanvas.height=wrap.clientHeight; if(session) highlightIndex(renderCtx, session.idx, session.results[session.idx]); });

// 初期表示
resetSession("G");
