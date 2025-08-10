// app.js v0-3b — VexFlowロード待ち＆自動ポーリングで必ず描画。ポジション表記ナシ。
import { makeMajorScale3Oct, toVexKeys, letterFreq } from "./scales.js";
import { renderPage, recolorPage } from "./score.js";

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
// tuner
const tunNote = document.getElementById("tun-note");
const tunOct  = document.getElementById("tun-oct");
const tunNeed = document.getElementById("tun-needle");
const tunCentNum = document.getElementById("tun-centnum");

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
window.addEventListener("error",ev=>{ pushErr(ev.message||"Error"); });

// ---- VexFlow ロード待機（タイムアウト後もポーリング継続） ----
async function waitVexFlow(timeoutMs=5000){
  const ok = ()=> !!window.Vex?.Flow;
  if(ok()) return true;
  const start = performance.now();
  while(performance.now() - start < timeoutMs){
    await new Promise(r=>setTimeout(r,50));
    if(ok()) return true;
  }
  pushErr("VexFlow load timeout");
  return false;
}

let audio, analyser, aHP,aPeak, srcNode, mediaStream;
let rafId=null, running=false, pageCtx=null, renderPoll=null;

async function ensureAudio(){
  if(!audio){
    audio = new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
    if(audio.state==="suspended"){
      try{ await audio.resume(); }catch{}
    }
  }
}

async function openMic(){
  await ensureAudio();
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio:{ echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1 }
    });
  }catch(e){
    pushErr("mic permission: "+e.message);
    showErrorModal();
    throw e;
  }
  gate.setAttribute("aria-hidden","true");

  srcNode = audio.createMediaStreamSource(mediaStream);
  aHP   = audio.createBiquadFilter(); aHP.type="highpass"; aHP.frequency.value=100; aHP.Q.value=0.7;
  aPeak = audio.createBiquadFilter(); aPeak.type="peaking"; aPeak.frequency.value=2500; aPeak.Q.value=1.0; aPeak.gain.value=5;
  analyser = audio.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=0.06;
  srcNode.connect(aHP).connect(aPeak).connect(analyser);

  try{ document.getElementById("nosleep").play(); }catch{}
}
function closeMic(){
  if(mediaStream){ mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; }
  analyser=srcNode=aHP=aPeak=undefined;
}

const buf=new Float32Array(8192);
function detectPitch(){
  if(!analyser) return {freq:0,rms:0,db:0};
  const len=Math.min(buf.length, analyser.fftSize);
  const time=new Float32Array(len);
  analyser.getFloatTimeDomainData(time);
  let rms=0; for(let i=0;i<len;i++){ const v=time[i]; rms+=v*v; } rms=Math.sqrt(rms/len);

  const raw = 20*Math.log10(Math.max(rms,1e-9)) + 94 + (parseFloat(inpDbCal.value)||0);
  const db  = Math.max(0, Math.min(120, Math.round(raw)));
  micdb.textContent = `${db} dB`;
  micdb.style.color = (db>=80) ? "#ff3b30" : (db>=70) ? "#ff9f0a" : (db>=40) ? "#34c759" : "#8fb3cc";

  if(rms < parseFloat(inpRMS.value||"0.0015")) return {freq:0,rms,db};

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
const drawCents=c=>{ const pct=Math.max(0,Math.min(100,50+(c/50)*50)); needle.style.left=pct+"%"; tunNeed.style.left=pct+"%"; tunCentNum.textContent=`${Math.round(c)}c`; };

function freqToNoteName(f){
  if(!f||!isFinite(f)) return {name:"—",oct:"-"};
  const m = Math.round(12*Math.log2(f/442) + 57);
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const name = names[(m+1200)%12]; const oct = Math.floor(m/12) - 1;
  return {name, oct};
}

function sparks(){
  const cv=fxCanvas, ctx=cv.getContext("2d");
  if(!cv.width||!cv.height){ const wrap=document.getElementById("staff-wrap"); cv.width=wrap.clientWidth; cv.height=wrap.clientHeight; }
  const N=90, P=[];
  for(let i=0;i<N;i++){ const a=Math.random()*Math.PI*2, sp=2.2+Math.random()*2.6; P.push({x:cv.width*0.5,y:cv.height*0.42, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:0, hue:120+Math.random()*80}); }
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

function setProg(idx,len){
  const phase = (idx<24) ? "（上行）" : "（下行）";
  prog.textContent = `音 ${idx+1}/${len}${phase}`;
}

let session=null, pageReady=false;

async function resetSession(key){
  // 1) 即時用のデータ準備
  const sc = makeMajorScale3Oct(key);
  const vex = toVexKeys(sc.notes, key);
  session={
    key, notes:sc.notes, vex,
    idx:0, pass:parseInt(selPass.value,10)||90,
    results:Array(sc.notes.length).fill(null),
    page:0, perPage:24, advancedAt:0,
    lockTill:0, stableMs:0
  };
  setProg(session.idx, session.notes.length);
  advice.textContent="待機中…"; advice.style.color="#ffccd5"; bigScore.textContent="0";

  // 2) VexFlow待機 → 失敗してもポーリングで再試行
  pageReady = await waitVexFlow(4000);
  if(pageReady){
    pageCtx = renderPage({key:session.key, vexKeys:session.vex, page:session.page, perPage:session.perPage});
    if(pageCtx) recolorPage(pageCtx, 0);
  }
  if(!renderPoll){
    renderPoll = setInterval(()=>{
      if(!pageCtx && window.Vex?.Flow){
        pageReady=true;
        pageCtx = renderPage({key:session.key, vexKeys:session.vex, page:session.page, perPage:session.perPage});
        if(pageCtx) recolorPage(pageCtx, 0);
        clearInterval(renderPoll); renderPoll=null;
      }
    }, 120);
  }
}

function turnPageIfNeeded(){
  if(!pageReady) return;
  const newPage = Math.floor(session.idx/session.perPage);
  if(newPage !== session.page){
    session.page = newPage;
    pageCtx = renderPage({key:session.key, vexKeys:session.vex, page:session.page, perPage:session.perPage});
  }
}

function advance(){
  if(session.idx < session.notes.length-1){
    session.idx += 1;
    session.stableMs = 0;
    turnPageIfNeeded();
    if(pageCtx) recolorPage(pageCtx, session.idx % session.perPage, session.results[session.idx]);
    setProg(session.idx, session.notes.length);
  }
}

let lastTime=performance.now();
function loop(){
  const now=performance.now();
  const dt = now - lastTime; lastTime = now;

  const {freq,rms,db}=detectPitch();
  if(freq>0 && session){
    const near = freqToNoteName(freq);
    tunNote.textContent = near.name; tunOct.textContent = near.oct;

    const n=session.notes[session.idx];
    const target=letterFreq(n.letter, n.octave, session.key);
    const c=centsFrom(freq,target);
    const sc=scoreFromCents(c);
    bigScore.textContent=Math.round(sc);
    drawCents(Math.max(-50,Math.min(50,c)));

    const abs=Math.abs(c);
    if(abs>50){ advice.textContent="頑張ろう！"; advice.style.color="#ffccd5"; session.stableMs=0; }
    else if(abs>15){ advice.textContent=(c>0?`${abs|0}c 高い`:`${abs|0}c 低い`); advice.style.color="#ffd166"; session.stableMs=0; }
    else { advice.textContent="いい感じ！"; advice.style.color="#c7ffd1"; }

    // 0.5秒安定保持で合格
    if(abs <= 15){
      session.stableMs += dt;
      session.results[session.idx] = Math.max(session.results[session.idx]||0, Math.round(sc));
      if(pageCtx) recolorPage(pageCtx, session.idx % session.perPage, session.results[session.idx]);
      if(session.stableMs >= 500 && (session.results[session.idx] >= session.pass)){
        session.lockTill = now + 180;
        sparks();
        advance();
      }
    }else{
      session.stableMs = 0;
    }
  }else{
    bigScore.textContent="0";
  }
  if(running) rafId=requestAnimationFrame(loop);
}

// —— UI —— //
document.getElementById("permit").addEventListener("click", async ()=>{
  gate.setAttribute("aria-hidden","true");
  try{ await openMic(); }catch{ gate.setAttribute("aria-hidden","false"); }
});

btnStart.onclick=async ()=>{
  try{
    if(!mediaStream) await openMic();
    if(!pageCtx) await resetSession(selKey.value || "G"); // ここで確実に描画準備
    running=true; btnStart.disabled=true; btnStop.disabled=false; lastTime=performance.now(); loop();
  }catch(e){ pushErr(e.message||e); showErrorModal(); }
};
btnStop.onclick=()=>{ running=false; btnStart.disabled=false; btnStop.disabled=true; if(rafId) cancelAnimationFrame(rafId); closeMic(); };

selKey.addEventListener("change",()=>{ running=false; btnStart.disabled=false; btnStop.disabled=true; if(rafId) cancelAnimationFrame(rafId); resetSession(selKey.value); });

window.addEventListener("visibilitychange",()=>{
  if(document.hidden){
    running=false; if(rafId) cancelAnimationFrame(rafId); btnStart.disabled=false; btnStop.disabled=true; closeMic();
  }else{
    if(!mediaStream){ gate.setAttribute("aria-hidden","false"); }
  }
});
window.addEventListener("pagehide",()=>{ closeMic(); });
window.addEventListener("resize",()=>{
  const wrap=document.getElementById("staff-wrap");
  fxCanvas.width=wrap.clientWidth; fxCanvas.height=wrap.clientHeight;
  if(pageCtx) recolorPage(pageCtx, session.idx % session.perPage, session.results[session.idx]);
});

// 初期：Gメジャー
resetSession("G");
