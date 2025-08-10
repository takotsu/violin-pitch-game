// app.js
import { A4, KEYS, letterFreq, makeExercise4Bars } from "./scales.js";
import { renderTwoBars } from "./score.js";

/* ===== 定数 ===== */
const A4_REF_HZ = 442;
const F_MIN = 110, F_MAX = 2200;
const VIOLIN_MIN = 196.0; // G3
const PASS_BAND_CENTS = 15;
const PASS_DWELL_MS = 100;   // 合格持続（半分）
const COOL_NEXT_MS = 100;    // 進行クール
const LOCK_SAME_MS = 140;    // 連続同音ロック

/* ===== UI ===== */
const adviceEl = document.getElementById('advice');
const miniScoreEl = document.getElementById('mini-score');
const bigScoreEl = document.getElementById('big-score');
const bar = document.getElementById('cents-bar');
const needleBar = document.getElementById('bar-needle');
const dbEl = document.getElementById('db-indicator');
const passSel = document.getElementById('pass');
const btnStart = document.getElementById('start');
const btnStop = document.getElementById('stop');
const keySel = document.getElementById('key-select');
const rmsInput = document.getElementById('rms');
const dboffInput = document.getElementById('dboff');
const progEl = document.getElementById('prog');
const pageLabel = document.getElementById('page-label');
const staffWrap = document.getElementById('staff-wrap');
const sparkCanvas = document.getElementById('spark');

(function initPass(){ for(let p=85;p<=100;p++){ const o=document.createElement('option'); o.textContent=String(p); passSel.appendChild(o); } passSel.value="90"; })();

/* ===== 状態 ===== */
let currentKey = keySel.value;
let exercise = null;     // 32音
let pageOffset = 0;      // 0 / 16
let idx = 0;             // 0..31
let scores = [];
let passThreshold = 90;
let RMS_TH = 0.0015;
let DB_OFFSET = 0;
let sessionRunning = false;
let renderAPI = null;
let lastAdvance = 0;
let inBandSince = 0;

/* ===== エラーログ ===== */
const errorSet = new Set();
function logError(e){
  const msg = (e?.message||e)?.toString(); const stack = e?.stack||"";
  errorSet.add(`${new Date().toISOString()} : ${msg}${stack?("\n"+stack):""}`);
  renderErrorModal();
}
const errList = document.getElementById('error-list');
function renderErrorModal(){ if(!errList) return; errList.innerHTML=""; [...errorSet].slice(-200).forEach(t=>{ const li=document.createElement('li'); li.textContent=t; errList.appendChild(li); }); }
document.getElementById('err-copy').onclick=async()=>{ await navigator.clipboard.writeText([...errorSet].join("\n")); toast("エラー内容をコピーしました。","info",1800); };
document.getElementById('err-close').onclick=()=>{ document.getElementById('error-modal').classList.remove('show'); };

/* ===== トースト ===== */
let toastTimer;
function toast(msg, level='warn', ms=2500, tiny=false){
  const el=document.getElementById('toast');
  el.className=`${level} ${tiny?'tiny':''} show`; el.textContent=msg;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.className=el.className.replace('show',''), ms);
}

/* ===== 2小節描画 ===== */
function drawPage(){
  renderAPI = renderTwoBars({ key: currentKey, notes: exercise, offset: pageOffset });
  sparkCanvas.width = staffWrap.clientWidth; sparkCanvas.height = staffWrap.clientHeight;
}

/* ===== 視覚フィードバック：火花 + ハロ（半透明円） ===== */
const spk = sparkCanvas.getContext('2d');
let sparks=[], halos=[];
function spawnSpark(x,y){
  const N=28;
  for(let i=0;i<N;i++){
    const a = (Math.PI*2)*Math.random(), v = 80+90*Math.random();
    sparks.push({x,y, vx:Math.cos(a)*v, vy:Math.sin(a)*v, life:300, t:0});
  }
  halos.push({x,y, r0:6, r1:48, t:0, life:260});
}
let sparkRAF=null, lastT=performance.now();
function sparkLoop(t){
  const dt = Math.min(32, t-lastT); lastT=t;
  spk.clearRect(0,0,sparkCanvas.width, sparkCanvas.height);
  spk.globalCompositeOperation="lighter";

  // halo
  halos = halos.filter(h=>h.t<h.life);
  for(const h of halos){
    h.t+=dt; const k=Math.min(1,h.t/h.life);
    const r = h.r0 + (h.r1-h.r0)*k;
    spk.globalAlpha = 0.22*(1-k);
    const grd = spk.createRadialGradient(h.x,h.y,r*0.1, h.x,h.y,r);
    grd.addColorStop(0,"rgba(34,197,94,0.35)");
    grd.addColorStop(1,"rgba(34,197,94,0.0)");
    spk.fillStyle=grd; spk.beginPath(); spk.arc(h.x,h.y,r,0,Math.PI*2); spk.fill();
  }

  // sparks
  sparks = sparks.filter(p=>p.t<p.life);
  for(const p of sparks){
    p.t+=dt; const k=p.t/p.life;
    const x=p.x + p.vx*(p.t/1000);
    const y=p.y + p.vy*(p.t/1000) + 0.0008*(p.t*p.t);
    spk.globalAlpha = (1-k);
    spk.beginPath(); spk.arc(x,y, 1.8, 0, Math.PI*2); spk.fillStyle="#22c55e"; spk.fill();
  }
  sparkRAF = (sparks.length||halos.length)? requestAnimationFrame(sparkLoop) : null;
}
function burstAtNote(iInPage){
  const p = renderAPI?.getXY(iInPage); if(!p) return;
  const svgRect = document.querySelector("#staff svg")?.getBoundingClientRect() || staffWrap.getBoundingClientRect();
  const x = p.x - svgRect.left, y = p.y - svgRect.top;
  spawnSpark(x,y);
  if(!sparkRAF){ lastT=performance.now(); sparkRAF = requestAnimationFrame(sparkLoop); }
  bar.classList.add('flash'); setTimeout(()=>bar.classList.remove('flash'),140);
}

/* ===== オーディオ ===== */
let ac=null, mediaStream=null, source=null, hpf=null, peak=null, analyser=null;
let rafPitch=null, rafServo=null;

async function startAudio(){
  if(document.visibilityState!=="visible"){ toast("非可視状態では開始できません。","warn",2000); return; }
  try{
    if(!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia未対応");
    ac = new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 }
    });
    source = ac.createMediaStreamSource(mediaStream);
    hpf = ac.createBiquadFilter(); hpf.type="highpass"; hpf.frequency.value=90; hpf.Q.value=0.7;
    peak = ac.createBiquadFilter(); peak.type="peaking"; peak.frequency.value=2500; peak.Q.value=1.0; peak.gain.value=5;
    analyser = ac.createAnalyser(); analyser.fftSize=2048;
    source.connect(hpf); hpf.connect(peak); peak.connect(analyser);
    startLoops();
  }catch(e){ logError(e); document.getElementById('error-modal').classList.add('show'); }
}
async function stopAudio(){
  try{
    stopLoops();
    if(analyser){ try{ analyser.disconnect(); }catch{} }
    if(peak){ try{ peak.disconnect(); }catch{} }
    if(hpf){ try{ hpf.disconnect(); }catch{} }
    if(source){ try{ source.disconnect(); }catch{} }
    if(mediaStream){ try{ mediaStream.getTracks().forEach(t=>t.stop()); }catch{} }
    if(ac){ try{ await ac.suspend(); }catch{} try{ await ac.close(); }catch{} }
  }finally{ analyser=peak=hpf=source=mediaStream=ac=null; }
}
/* 同期版（ページ遷移/閉じる対策） */
function stopAudioSync(){
  try{
    if(analyser) try{ analyser.disconnect(); }catch{}
    if(peak) try{ peak.disconnect(); }catch{}
    if(hpf) try{ hpf.disconnect(); }catch{}
    if(source) try{ source.disconnect(); }catch{}
    if(mediaStream) try{ mediaStream.getTracks().forEach(t=>t.stop()); }catch{}
    analyser=peak=hpf=source=mediaStream=null;
    if(ac){ try{ ac.suspend(); }catch{} try{ ac.close(); }catch{} ac=null; }
  }catch{}
}

/* ===== ピッチ検出（自己相関＋放物線補間 / ハミング窓） ===== */
const timeBuf = new Float32Array(2048);
function hammingInplace(arr){ const N=arr.length; for(let i=0;i<N;i++){ const w=0.54-0.46*Math.cos(2*Math.PI*i/(N-1)); arr[i]*=w; } }
function autoCorrelateF0(frame, sr){
  const N = frame.length;
  let s=0; for(let i=0;i<N;i++){ const v=frame[i]; s += v*v; }
  const rms = Math.sqrt(s/N); if(rms < 1e-9) return {f0:0, rms};
  hammingInplace(frame);
  const tauMin = Math.floor(sr/F_MAX), tauMax = Math.floor(sr/F_MIN);
  const d = new Float32Array(tauMax+1);
  for(let tau=tauMin; tau<=tauMax; tau++){ let sum=0; for(let i=0;i<N-tau;i++){ const diff=frame[i]-frame[i+tau]; sum+=diff*diff; } d[tau]=sum; }
  const cmnd = new Float32Array(tauMax+1); let run=0;
  for(let tau=tauMin; tau<=tauMax; tau++){ run+=d[tau]; cmnd[tau] = d[tau]*tau/(run||1); }
  let tauBest=-1, thr=0.12;
  for(let tau=tauMin+2; tau<tauMax-1; tau++){
    if(cmnd[tau]<thr && cmnd[tau]<=cmnd[tau-1] && cmnd[tau]<=cmnd[tau+1]){ tauBest=tau; break; }
  }
  if(tauBest<0){ let mv=1e9,mi=-1; for(let t=tauMin;t<=tauMax;t++){ if(cmnd[t]<mv){ mv=cmnd[t]; mi=t; } } tauBest=mi; }
  const x0=tauBest-1, x1=tauBest, x2=tauBest+1;
  const y0=cmnd[x0]??cmnd[x1], y1=cmnd[x1], y2=cmnd[x2]??cmnd[x1];
  const denom=(y0-2*y1+y2)||1, delta=(y0-y2)/(2*denom);
  const tauRef=tauBest+delta, f0=sr/tauRef;
  return {f0:(isFinite(f0)?f0:0), rms};
}

/* ===== セント・スコア ===== */
function centsDiff(f, fRef){ return 1200*Math.log2(f/fRef); }
function scoreFromCents(absC){ return Math.max(0, Math.min(100, Math.round(100 - absC*2))); }

/* ===== アナログ針（2次サーボ） ===== */
const hand = document.getElementById('hand');
let servo = {pos:0, vel:0};
const OMEGA = 11.5, ZETA_BASE=0.78;
function servoUpdate(targetCents, dt){
  const e = targetCents - servo.pos; const absE = Math.abs(e);
  const zInc = (absE<=6)? (0.95 - ZETA_BASE)*(1 - absE/6) : 0;
  const zeta = ZETA_BASE + zInc;
  const a = OMEGA*OMEGA*e - 2*zeta*OMEGA*servo.vel;
  servo.vel += a*dt; servo.pos += servo.vel*dt;
  servo.pos = Math.max(-50, Math.min(50, servo.pos));
  const ang = servo.pos * (60/50);
  hand.setAttribute("transform", `translate(0,60) rotate(${ang})`);
}

/* ===== 針/バー更新 ===== */
let centsBar = 0, nearestSemiCents = 0;
let lastServoTS = performance.now();
function servoLoop(ts){
  const dt = Math.min(0.05, (ts-lastServoTS)/1000);
  lastServoTS = ts; servoUpdate(nearestSemiCents, dt);
  requestAnimationFrame(servoLoop);
}
function updateBar(c){
  const clamped=Math.max(-50,Math.min(50,c));
  const pct=(clamped+50)/100;
  needleBar.style.left=`calc(${pct*100}% - 1px)`;
  bar.classList.toggle("hint-low", clamped<-3);
  bar.classList.toggle("hint-high", clamped>3);
}

/* ===== dB表示 ===== */
function showDB(rms){
  const db = Math.round(20*Math.log10(Math.max(rms,1e-9)) + 94 + DB_OFFSET);
  const clipped = clamp(db,0,120);
  dbEl.textContent = `${clipped} dB`;
  if(clipped>=80){ dbEl.style.color="#ff9b96"; }
  else if(clipped>=70){ dbEl.style.color="#ffca76"; }
  else if(clipped>=40){ dbEl.style.color="#a6ffbf"; }
  else { dbEl.style.color="#cbd5e1"; }
}
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

/* ===== ピッチループ ===== */
function startLoops(){
  stopLoops();
  const sr = ac.sampleRate, buf = timeBuf;
  (function loop(){
    if(!analyser){ return; }
    analyser.getFloatTimeDomainData(buf);
    const {f0, rms} = autoCorrelateF0(buf, sr);
    showDB(rms);

    if(rms < RMS_TH){
      adviceEl.className="bad"; adviceEl.textContent="入力が小さいです。";
      updateBar(0); nearestSemiCents=0; inBandSince=0;
      rafPitch = requestAnimationFrame(loop); return;
    }
    if(f0<=0){ adviceEl.className="warn"; adviceEl.textContent="検出が不安定…"; rafPitch=requestAnimationFrame(loop); return; }
    if(f0 < VIOLIN_MIN-2){ adviceEl.className="warn"; adviceEl.textContent="バイオリン音域外（低すぎ）"; updateBar(0); rafPitch=requestAnimationFrame(loop); return; }

    const cur = exercise[idx]; if(!cur){ rafPitch=requestAnimationFrame(loop); return; }
    const fRef = letterFreq(cur.letter, cur.octave, currentKey, A4_REF_HZ);
    const cents = centsDiff(f0, fRef), absC = Math.abs(cents), sc = scoreFromCents(absC);

    centsBar = clamp(cents, -50, 50);
    updateBar(centsBar);

    const midi = 69 + 12*Math.log2(f0/A4), midiRnd = Math.round(midi);
    const fSemi = A4 * Math.pow(2, (midiRnd-69)/12);
    nearestSemiCents = clamp(centsDiff(f0,fSemi), -50, 50);

    if(absC>50){ setAdvice("頑張ろう！","bad"); }
    else if(absC<=15){ setAdvice("いい感じ！","good"); }
    else { setAdvice(`${absC|0}c ${cents>0?"高い":"低い"}`,"warn"); }

    miniScore(absC);
    bigScoreEl.textContent = String(sc);

    const now = performance.now();
    if(absC<=PASS_BAND_CENTS){
      if(!inBandSince) inBandSince = now;
      if(sc>=passThreshold && now-inBandSince>=PASS_DWELL_MS && now-lastAdvance>=Math.max(COOL_NEXT_MS,LOCK_SAME_MS)){
        if(scores[idx]==null) scores[idx]=sc;
        badgeFor(sc); advance(); lastAdvance=now; inBandSince=0;
      }
    }else{ inBandSince=0; }

    rafPitch = requestAnimationFrame(loop);
  })();

  lastServoTS = performance.now();
  rafServo = requestAnimationFrame(servoLoop);
}
function stopLoops(){ if(rafPitch){ cancelAnimationFrame(rafPitch); rafPitch=null; } if(rafServo){ cancelAnimationFrame(rafServo); rafServo=null; } }

/* ===== UI ===== */
function setAdvice(t, cls){ adviceEl.className=cls; adviceEl.textContent=t; }
function miniScore(absC){
  miniScoreEl.className="";
  if(absC<=5){ miniScoreEl.classList.add('green'); miniScoreEl.textContent="◎"; }
  else if(absC<=15){ miniScoreEl.classList.add('yellow'); miniScoreEl.textContent="◯"; }
  else { miniScoreEl.classList.add('red'); miniScoreEl.textContent="△"; }
}

/* ===== 進行 ===== */
function updateProgress(){
  progEl.textContent = `音 ${idx+1}/32`;
  const page = pageOffset===0 ? "1–2" : "3–4";
  pageLabel.textContent = `小節 ${page}`;
  const iInPage = idx - pageOffset;
  for(let j=0;j<16;j++){ renderAPI.recolor(j, (j===iInPage)?"note-target":"note-normal"); }
}
function badgeFor(sc){
  const iInPage = idx - pageOffset;
  if(sc>=95){ renderAPI.badge(iInPage,"◎"); }
  else if(sc>=90){ renderAPI.badge(iInPage,"◯"); }
  else{ renderAPI.recolor(iInPage,"note-failed"); renderAPI.badge(iInPage,"×"); }
  burstAtNote(iInPage);
}
function advance(){
  idx++; if(idx===16){ pageOffset=16; drawPage(); }
  if(idx>=32){ finish(); return; }
  updateProgress();
}

/* ===== セッション ===== */
function startSession(){
  sessionRunning=true; document.body.classList.add('running');
  passThreshold=+passSel.value|0; RMS_TH=+rmsInput.value; DB_OFFSET=(+dboffInput.value)|0;

  exercise = makeExercise4Bars(currentKey);
  pageOffset=0; idx=0; scores=[]; inBandSince=0;
  drawPage(); updateProgress();
}
function stopSessionUI(){
  sessionRunning=false; document.body.classList.remove('running');
  bigScoreEl.textContent="—"; miniScoreEl.textContent="—"; miniScoreEl.className=""; setAdvice("停止中","");
}

/* ===== 完了（褒める） ===== */
function finish(){
  stopSessionUI();
  const passed = scores.filter(v=>typeof v==="number");
  const avg = passed.length? Math.round(passed.reduce((a,b)=>a+b,0)/passed.length) : 0;
  const resultEl=document.getElementById('result');
  const praise=document.getElementById('praise');
  const details=document.getElementById('details');
  if(avg>=98) praise.textContent="神懸りの安定感。";
  else if(avg>=95) praise.textContent="プロレベルの精度。";
  else if(avg>=90) praise.textContent="とても良い音程です。";
  else praise.textContent="着実に上達しています。";
  details.textContent=`合格時スコア平均：${avg} 点（${passed.length} / 32 音）`;
  resultEl.classList.add('show'); resultEl.setAttribute('aria-hidden','false');
  document.getElementById('again').onclick=()=>{ resultEl.classList.remove('show'); startSession(); };
  document.getElementById('close').onclick=()=>{ resultEl.classList.remove('show'); };
}

/* ===== ゲート・ライフサイクル ===== */
const gate = document.getElementById('gate');
window.__permit = async function(){
  gate.classList.remove('show'); gate.setAttribute('aria-hidden','true');
  try{ await startAudio(); }catch(e){ logError(e); }
};

btnStart.addEventListener('click', async()=>{
  try{
    if(!ac){ await startAudio(); if(!ac){ toast("マイク許可が必要です。","warn",2000); return; } }
    if(ac?.state==="suspended") await ac.resume();
    startSession(); keepAwake(true);
    btnStart.disabled=true; btnStop.disabled=false;
  }catch(e){ logError(e); toast("開始に失敗しました。","error",2500); }
});
btnStop.addEventListener('click', async()=>{
  try{
    stopSessionUI(); btnStart.disabled=false; btnStop.disabled=true;
    await stopAudio(); keepAwake(false);
  }catch(e){ logError(e); }
});
keySel.addEventListener('change', ()=>{
  currentKey = keySel.value;
  if(!sessionRunning){ exercise = makeExercise4Bars(currentKey); pageOffset=0; idx=0; drawPage(); updateProgress(); }
});
rmsInput.addEventListener('change', ()=>{ const v = clamp(+rmsInput.value, 0.0005, 0.02); rmsInput.value=String(v.toFixed(4)); toast(`RMS閾値: ${rmsInput.value}`,'info',1200,true); });
dboffInput.addEventListener('change', ()=>{ const v = clamp((+dboffInput.value)|0, -20, 20); dboffInput.value=String(v); DB_OFFSET=v; toast(`dB補正: ${v} dB`,'info',1200,true); });

/* ===== バックグラウンド/遷移で確実停止（iOS/Safari対策） ===== */
async function hardStop(){
  try{
    stopSessionUI(); btnStart.disabled=false; btnStop.disabled=true;
    await stopAudio();
    gate.classList.add('show'); gate.setAttribute('aria-hidden','false');
  }catch(e){ logError(e); }
}
function hardStopSync(){ // ページ遷移時の同期停止
  try{ stopSessionUI(); stopLoops(); stopAudioSync(); }catch(e){ }
}
["visibilitychange","webkitvisibilitychange","blur","freeze","pagehide"].forEach(ev=>{
  window.addEventListener(ev, ()=>{ if(document.hidden || ev!=="visibilitychange"){ hardStop(); } }, {passive:true});
});
window.addEventListener("beforeunload", hardStopSync, {passive:true});
window.addEventListener("unload", hardStopSync, {passive:true});
let visWatch = setInterval(()=>{ if(document.hidden && (ac || mediaStream)){ hardStop(); } }, 900);

/* ===== スリープ抑止（iOS） ===== */
const nosleep = document.getElementById('nosleep');
async function keepAwake(on){
  try{
    if(on){
      if('wakeLock' in navigator){ try{ await navigator.wakeLock.request('screen'); }catch{} }
      else{ try{ await nosleep.play(); }catch{} }
    }else{ try{ nosleep.pause(); }catch{} }
  }catch{}
}

/* ===== 初期化 ===== */
(function init(){
  exercise = makeExercise4Bars(currentKey);
  drawPage(); updateProgress();
  requestAnimationFrame(servoLoop);
  // 全キーの音域チェック（ログに出す）
  try{
    const problems=[];
    for(const k of KEYS){
      const ex = makeExercise4Bars(k);
      const freqs = ex.map(n=>letterFreq(n.letter,n.octave,k));
      const mn=Math.min(...freqs), mx=Math.max(...freqs);
      if(mn<196-1e-6 || mx>2637+1e-6) problems.push(k);
    }
    if(problems.length){ logError(new Error("音域外キー: "+problems.join(","))); }
  }catch(e){ logError(e); }
})();

/* ===== エラー収集 ===== */
window.addEventListener('error', ev=>{ logError(ev.error||ev.message||ev); document.getElementById('error-modal').classList.add('show'); });
window.addEventListener('unhandledrejection', ev=>{ logError(ev.reason||ev); document.getElementById('error-modal').classList.add('show'); });
