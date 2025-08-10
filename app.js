// app.js v0-4 — バイオリン音域を厳守。アナログ針式チューナー（-50..+50c）を追加。
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
const fxCanvas=document.getElementById("fx");
const micdb=document.getElementById("micdb");
const gate=document.getElementById("mic-gate");
const permit=document.getElementById("permit");
// tuner svg elements
const tunerSvg=document.getElementById("tuner-svg");
const ticksGroup=document.getElementById("ticks");
const needleSvg=document.getElementById("needle");
const noteText=document.getElementById("noteText");
const octText=document.getElementById("octText");
const hzText=document.getElementById("hzText");
const centText=document.getElementById("centText");

for(let p=85;p<=100;p++){ const o=document.createElement("option"); o.textContent=p; selPass.appendChild(o); }
selPass.value="90";

// 針式チューナー目盛（-50..+50c）
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

const errors=[];
const pushErr=(e)=>{ const t=new Date().toISOString().replace("T"," ").slice(0,19); const line=`${t} : ${e}`; errors.push(line); console.warn(line); };

let audio, analyser, aHP,aPeak, srcNode, mediaStream;
let rafId=null, running=false, pageCtx=null;

async function ensureAudio(){
  if(!audio){
    audio = new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
    if(audio.state==="suspended"){ try{ await audio.resume(); }catch{} }
  }
}
async function openMic(){
  await ensureAudio();
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio:{ echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1 }
    });
  }catch(e){
    advice.textContent="マイク未許可／未接続です"; advice.style.color="#ff9f0a";
    pushErr("mic permission: "+e.message); return false;
  }
  gate.setAttribute("aria-hidden","true");
  srcNode = audio.createMediaStreamSource(mediaStream);

  aHP   = audio.createBiquadFilter(); aHP.type="highpass"; aHP.frequency.value=90; aHP.Q.value=0.7;
  aPeak = audio.createBiquadFilter(); aPeak.type="peaking"; aPeak.frequency.value=2500; aPeak.Q.value=1.0; aPeak.gain.value=5;

  analyser = audio.createAnalyser(); analyser.fftSize=4096; analyser.smoothingTimeConstant=0.06;
  srcNode.connect(aHP).connect(aPeak).connect(analyser);
  try{ document.getElementById("nosleep").play(); }catch{}

  return true;
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

  // ハミング窓＋自己相関
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

// --- 針式チューナー --- //
const names=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function freqToNoteName(f){
  if(!f||!isFinite(f)) return {name:"—",oct:"-",midi:0,ref:0};
  const m = Math.round(12*Math.log2(f/442) + 57); // A4(442)->69 → +57
  const name = names[(m+1200)%12]; const oct = Math.floor(m/12)-1;
  const ref = 442*Math.pow(2,(m-69)/12);
  return {name,oct,midi:m,ref};
}
function drawBarCents(c){ const pct=Math.max(0,Math.min(100,50+(c/50)*50)); needleBar.style.left=pct+"%"; }
function setTuner(cents, f, note){
  const clamp=Math.max(-50,Math.min(50,cents));
  // -50..+50c → -81..+81度（視認性のため広め）
  const angle = clamp * 81 / 50;
  needleSvg.setAttribute("transform",`rotate(${angle} 210 170)`);
  centText.textContent = `${Math.round(clamp)}`;
  noteText.textContent = note.name; octText.textContent = note.oct;
  hzText.textContent   = `${Math.round(f)} Hz`;
}

// 慣性付き針（一次IIR + 速度制限）
let smoothed=0, vel=0;
function smoothCents(target, dtMs){
  const dt = dtMs/1000;
  const K = 9.0, D = 6.0; // ばね定数・減衰
  const acc = K*(target - smoothed) - D*vel;
  vel += acc*dt; smoothed += vel*dt;
  // 速度制限
  const vmax = 220; if(vel>vmax) vel=vmax; if(vel<-vmax) vel=-vmax;
  return smoothed;
}

const centsFrom=(f,ref)=>1200*Math.log2(f/ref);
const scoreFromCents=c=>Math.min(100, Math.max(0, 100 - (Math.abs(c)/50)*100 ));

let session=null, page=0, perPage=24, lastT=performance.now();

function resetSession(key){
  const sc=makeMajorScale3Oct(key); // ここでG3〜E7内に調整済み
  const vex=toVexKeys(sc.notes, key);

  session={
    key, notes:sc.notes, vex,
    idx:0, pass:parseInt(selPass.value,10)||90,
    results:Array(sc.notes.length).fill(null)
  };

  page = 0; perPage = 24;
  pageCtx = renderPage({key:session.key, vexKeys:session.vex, objs:session.notes, page, perPage});
  recolorPage(pageCtx, 0);

  prog.textContent=`音 1/${session.notes.length}（上行）`;
  advice.textContent="待機中…"; advice.style.color="#ffccd5"; bigScore.textContent="0";
}

function turnPageIfNeeded(){
  const newPage=Math.floor(session.idx/perPage);
  if(newPage!==page){
    page=newPage;
    pageCtx=renderPage({key:session.key, vexKeys:session.vex, objs:session.notes, page, perPage});
  }
}

function advance(){
  if(session.idx < session.notes.length-1){
    session.idx += 1;
    turnPageIfNeeded();
    recolorPage(pageCtx, session.idx % perPage);
    const phase = (session.idx<24) ? "（上行）" : "（下行）";
    prog.textContent=`音 ${session.idx+1}/${session.notes.length} ${phase}`;
  }
}

const work = new Float32Array(8192);
function loop(){
  const now=performance.now();
  const dt = now - lastT; lastT = now;

  const {freq,rms,db}=detectPitch();

  if(freq>0 && session){
    const targetNote = session.notes[session.idx];
    const targetFreq = letterFreq(targetNote.letter, targetNote.oct, session.key);
    const cents = centsFrom(freq, targetFreq);

    // 針式
    const near = freqToNoteName(freq);
    const cForNeedle = Math.max(-50, Math.min(50, centsFrom(freq, near.ref)));
    const sm = smoothCents(cForNeedle, dt);
    setTuner(sm, freq, near);

    // バー表示
    drawBarCents(Math.max(-50,Math.min(50,cents)));

    // スコア＆アドバイス
    const sc=scoreFromCents(cents); bigScore.textContent=Math.round(sc);
    const abs=Math.abs(cents);
    if(abs>50){ advice.textContent="頑張ろう！"; advice.style.color="#ffccd5"; }
    else if(abs>15){ advice.textContent=(cents>0?`${abs|0}c 高い`:`${abs|0}c 低い`); advice.style.color="#ffd166"; }
    else { advice.textContent="いい感じ！"; advice.style.color="#c7ffd1"; }

    // 合格条件：±15cを0.5秒保持 or スコアが閾値以上で通過
    const pass = abs<=15;
    session.results[session.idx] = Math.max(session.results[session.idx]||0, Math.round(sc));
    if(pass){ // 0.5秒相当の安定（慣性針使用のためフレームで代替）
      // dt積算
      work[0] = (work[0]||0) + dt;
      if(work[0] >= 500){
        advance();
        work[0]=0;
      }
    }else{
      work[0]=0;
    }
  }else{
    // 針をゆっくり0へ戻す
    const sm = smoothCents(0, dt); setTuner(sm, 0, {name:"—",oct:"-"}); bigScore.textContent="0";
  }

  if(running) rafId=requestAnimationFrame(loop);
}

// —— UI —— //
permit.addEventListener("click", async ()=>{
  const ok = await openMic(); if(!ok) return; resetSession(selKey.value);
});
btnStart.onclick=async ()=>{
  if(!mediaStream){ const ok=await openMic(); if(!ok) return; }
  if(!session) resetSession(selKey.value);
  running=true; btnStart.disabled=true; btnStop.disabled=false; lastT=performance.now(); loop();
};
btnStop.onclick=()=>{ running=false; btnStart.disabled=false; btnStop.disabled=true; if(rafId) cancelAnimationFrame(rafId); closeMic(); };
selKey.addEventListener("change",()=>{ running=false; btnStart.disabled=false; btnStop.disabled=true; if(rafId) cancelAnimationFrame(rafId); resetSession(selKey.value); });

window.addEventListener("visibilitychange",()=>{
  if(document.hidden){ running=false; if(rafId) cancelAnimationFrame(rafId); btnStart.disabled=false; btnStop.disabled=true; closeMic(); }
});
window.addEventListener("pagehide",()=>{ closeMic(); });
window.addEventListener("resize",()=>{ if(pageCtx) recolorPage(pageCtx, session? (session.idx%perPage):0); });

// 初期
resetSession("G");
