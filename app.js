import { makeMajorScale3Oct, toVexKeys, letterFreq } from "./scales.js";
import { renderScale, highlightIndex } from "./score.js";

const selKey = document.getElementById("key-select");
const selPass= document.getElementById("pass");
const inpRMS = document.getElementById("rms");
const btnStart=document.getElementById("start");
const btnStop =document.getElementById("stop");
const advice  =document.getElementById("advice");
const bigScore=document.getElementById("big-score");
const prog    =document.getElementById("prog");
const needle  =document.getElementById("needle");
const fxCanvas=document.getElementById("fx");
const micdb   =document.getElementById("micdb");

for(let p=85;p<=100;p++){ const o=document.createElement("option"); o.textContent=p; selPass.appendChild(o); }
selPass.value="90";

const errors=[];
function pushErr(e){ const t=new Date().toISOString().replace("T"," ").slice(0,19); const line=`${t} : ${e}`; errors.push(line); console.warn(line); }
function showErrorModal(){
  const modal=document.getElementById("error-modal"); const list=document.getElementById("error-list"); list.innerHTML="";
  errors.slice(-200).forEach(s=>{ const li=document.createElement("li"); li.textContent=s; list.appendChild(li); });
  modal.setAttribute("aria-hidden","false");
  document.getElementById("err-close").onclick=()=>modal.setAttribute("aria-hidden","true");
  document.getElementById("err-copy").onclick=()=>{ navigator.clipboard.writeText(errors.join("\n")); };
}
window.addEventListener("error",ev=>{ pushErr(ev.message||"Error"); showErrorModal(); });

let audio, analyser, srcNode, gain, shelf, band;
let rafId=null, running=false, session=null, renderCtx=null;

function setupAudio(){
  const ctx = audio = new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
  return navigator.mediaDevices.getUserMedia({audio:{
    echoCancellation:false, noiseSuppression:false, autoGainControl:false,
    channelCount:1, sampleRate: ctx.sampleRate
  }}).then(stream=>{
    srcNode = ctx.createMediaStreamSource(stream);
    // E線強化：高域シェルフ + 緩めのバンドパス
    shelf = ctx.createBiquadFilter(); shelf.type="highshelf"; shelf.frequency.value=1200; shelf.gain.value=9;
    band  = ctx.createBiquadFilter(); band.type="bandpass"; band.frequency.value=700; band.Q.value=0.7;
    gain  = ctx.createGain(); gain.gain.value=1.0;
    analyser = ctx.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=0.04;
    srcNode.connect(shelf).connect(band).connect(gain).connect(analyser);

    document.getElementById("nosleep").play().catch(()=>{});
  }).catch(err=>{ pushErr("mic: "+err.message); showErrorModal(); });
}

// 自己相関ピッチ
const buf=new Float32Array(8192);
function detectPitch(){
  if(!analyser) return {freq:0,rms:0};
  const len=Math.min(buf.length, analyser.fftSize);
  const time=new Float32Array(len);
  analyser.getFloatTimeDomainData(time);
  let rms=0; for(let i=0;i<len;i++){ const v=time[i]; rms+=v*v; } rms=Math.sqrt(rms/len);

  // 小さく dB 表示（dBFS）
  const db = rms>0 ? 20*Math.log10(rms) : -Infinity;
  micdb.textContent = (isFinite(db)?db: -90).toFixed(0) + " dB";

  if(rms < parseFloat(inpRMS.value||"0.002")) return {freq:0,rms};
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
    return {freq: sr/lag, rms};
  }
  return {freq:0,rms};
}

// セント→スコア
const centsFrom=(f,ref)=>1200*Math.log2(f/ref);
const scoreFromCents=c=>Math.min(100, Math.max(0, 100 - (Math.abs(c)/50)*100 ));
const drawCents=c=>{ const pct=Math.max(0,Math.min(100,50+(c/50)*50)); needle.style.left=pct+"%"; };

// 火花演出
function sparks(){
  const cv=fxCanvas, ctx=cv.getContext("2d");
  if(!cv.width||!cv.height){ const wrap=document.getElementById("staff-wrap"); cv.width=wrap.clientWidth; cv.height=wrap.clientHeight; }
  const N=90, P=[];
  for(let i=0;i<N;i++){
    const a=Math.random()*Math.PI*2, sp=2.2+Math.random()*2.6;
    P.push({x:cv.width*0.5,y:cv.height*0.28, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:0, hue:120+Math.random()*80});
  }
  let t0=performance.now();
  function step(now){
    const dt=Math.min(32, now-t0)/1000; t0=now;
    ctx.clearRect(0,0,cv.width,cv.height);
    P.forEach(p=>{
      p.life+=dt; p.vy+=2.8*dt; p.x+=p.vx; p.y+=p.vy;
      const a=Math.max(0,1-p.life/0.7);
      ctx.fillStyle=`hsla(${p.hue} 80% 60% / ${a})`;
      ctx.beginPath(); ctx.arc(p.x,p.y,2,0,Math.PI*2); ctx.fill();
    });
    if(P[0].life<0.7) requestAnimationFrame(step); else ctx.clearRect(0,0,cv.width,cv.height);
  }
  requestAnimationFrame(step);
  if(navigator.vibrate) try{ navigator.vibrate(12); }catch{}
}

// セッション
function resetSession(key){
  const sc=makeMajorScale3Oct(key);
  const vex=toVexKeys(sc.notes, key);
  renderCtx = renderScale(sc.keySignature, vex, sc.notes);
  session={
    key, notes:sc.notes, idx:0, pass:parseInt(selPass.value,10)||90,
    results:Array(sc.notes.length).fill(null), advancedAt:0, waitingFirst:true
  };
  prog.textContent=`音 1/${session.notes.length}`;
  advice.textContent="待機中…"; advice.style.color="#ffccd5";
  bigScore.textContent="0";
  highlightIndex(renderCtx,0);
}

function advance(){
  if(!session) return;
  if(session.idx < session.notes.length-1){
    session.idx += 1;
    session.waitingFirst=true;
    highlightIndex(renderCtx, session.idx);
    prog.textContent=`音 ${session.idx+1}/${session.notes.length}`;
  }
}

function loop(){
  const {freq,rms}=detectPitch();
  let c=0, sc=0;
  if(freq>0 && session){
    const n=session.notes[session.idx];
    const target=letterFreq(n.letter, n.octave, session.key);
    c=centsFrom(freq,target); sc=scoreFromCents(c);
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
        if(session.results[session.idx] >= session.pass){
          const now=performance.now(); if(now - session.advancedAt > 140){
            session.advancedAt=now; sparks(); advance();
          }
        }
      }else if(session.results[session.idx] < session.pass && sc>=session.pass){
        const now=performance.now(); if(now - session.advancedAt > 140){
          session.advancedAt=now; sparks(); advance();
        }
      }
    }
  }else{
    bigScore.textContent="0";
  }
  if(running) rafId=requestAnimationFrame(loop);
}

// UI
btnStart.onclick=async ()=>{
  try{
    if(!audio) await setupAudio();
    running=true; btnStart.disabled=true; btnStop.disabled=false;
    loop();
  }catch(e){ pushErr(e.message||e); showErrorModal(); }
};
btnStop.onclick=()=>{
  running=false; btnStart.disabled=false; btnStop.disabled=true;
  if(rafId) cancelAnimationFrame(rafId);
};
selKey.addEventListener("change",()=>{
  running=false; btnStart.disabled=false; btnStop.disabled=true;
  if(rafId) cancelAnimationFrame(rafId);
  resetSession(selKey.value);
});
selPass.addEventListener("change",()=>{ if(session) session.pass=parseInt(selPass.value,10)||90; });
window.addEventListener("visibilitychange",()=>{
  if(document.hidden){ running=false; if(rafId) cancelAnimationFrame(rafId); btnStart.disabled=false; btnStop.disabled=true; }
});
window.addEventListener("resize",()=>{
  const wrap=document.getElementById("staff-wrap");
  fxCanvas.width=wrap.clientWidth; fxCanvas.height=wrap.clientHeight;
  if(session) highlightIndex(renderCtx, session.idx, session.results[session.idx]);
});

// VexFlow（失敗してもOK：フォールバック描画が保証）
(function preloadVF(){
  const s=document.createElement("script"); s.src="https://cdn.jsdelivr.net/npm/vexflow@3.0.9/build/vexflow-min.js";
  s.onerror=()=>{ pushErr("VexFlow load fail"); }; document.head.appendChild(s);
  const s2=document.createElement("script"); s2.src="https://unpkg.com/vexflow@3.0.9/build/vexflow-min.js";
  s2.onerror=()=>{ pushErr("VexFlow load fail"); }; document.head.appendChild(s2);
})();

// 初期化
resetSession("G");
