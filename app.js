// app.js
import { A4 as A4_REF_HZ, getKeys, makeExerciseAll, letterFreqWithAcc } from "./scales.js";
import { renderTwoBars } from "./score.js";

/* ===== 定数 ===== */
const F_MIN = 110, F_MAX = 2200;
const VIOLIN_MIN = 196.0; // G3
const DIFF_TO_BAND = { easy:7, normal:5, hard:2 }; // ±cent
const NEXT_DWELL_MS = 90;
const PASS_DWELL_MS = 100;    // 合格滞在時間（短縮）
const LOCK_SAME_MS  = 160;    // 連続同音の暴走防止
const DEAD_BAND_CENT = 1;

/* ===== UI ===== */
const adviceEl = document.getElementById('advice');
const miniScoreEl = document.getElementById('mini-score');
const bigScoreEl = document.getElementById('big-score');
const bar = document.getElementById('cents-bar');
const needleBar = document.getElementById('bar-needle');
const dbEl = document.getElementById('db-indicator');
const btnStart = document.getElementById('start');
const btnStop = document.getElementById('stop');
const btnShowErr = document.getElementById('show-errors');
const keySel = document.getElementById('key-select');
const diffSel = document.getElementById('difficulty');
const rmsInput = document.getElementById('rms');
const dboffInput = document.getElementById('dboff');
const progEl = document.getElementById('prog');
const pageLabel = document.getElementById('page-label');
const staffWrap = document.getElementById('staff-wrap');
const sparkCanvas = document.getElementById('spark');
const confettiCanvas = document.getElementById('confetti-layer');
const hudFlash = document.getElementById('hud-flash');
const tabMajor = document.getElementById('tab-major');
const tabMinor = document.getElementById('tab-minor');
const tabIntermediate = document.getElementById('tab-intermediate');
const tabAdvanced = document.getElementById('tab-advanced');

/* ===== 状態 ===== */
let scaleType = "major";       // "major" | "minor"
let level = "advanced";        // "intermediate" | "advanced"
let currentKey = "";           // データセットに応じて設定
let exercise = [];             // 可変長
let totalNotes = 0;
let pageOffset = 0;            // 0,16,32,...
let idx = 0;                   // 現在ターゲットの絶対インデックス
let scores = [];               // 合格確定スコア
let RMS_TH = 0.0015;
let DB_OFFSET = 0;
let renderAPI = null;
let inBandSince = 0;
let nextBandSince = 0;
let lastAdvance = 0;

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
btnShowErr.onclick=()=>{ document.getElementById('error-modal').classList.add('show'); };

/* ===== トースト ===== */
let toastTimer;
function toast(msg, level='warn', ms=2500, tiny=false){
  const el=document.getElementById('toast');
  el.className=`${level} ${tiny?'tiny':''} show`; el.textContent=msg;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.className=el.className.replace('show',''), ms);
}

/* ===== 描画 ===== */
function drawPage(){
  renderAPI = renderTwoBars({ key: currentKey, notes: exercise, offset: pageOffset });
  sparkCanvas.width = staffWrap.clientWidth; sparkCanvas.height = staffWrap.clientHeight;
  confettiCanvas.width = staffWrap.clientWidth; confettiCanvas.height = staffWrap.clientHeight;
}
function updateProgress(){
  progEl.textContent = `音 ${idx+1}/${totalNotes}`;
  const pageStart = (pageOffset/16)+1;
  pageLabel.textContent = `小節 ${(pageStart)}–${(pageStart+1)}`;
  const iInPage = idx - pageOffset;
  for(let j=0;j<16;j++) renderAPI.recolor(j, (j===iInPage)?"note-target":"note-normal");
}

/* ===== エフェクト ===== */
const spk = sparkCanvas.getContext('2d');
let sparks=[], halos=[], rockets=[];
const conf = confettiCanvas.getContext('2d');
let confs=[];
function spawnSpark(x,y,intense=false){
  const N=intense?54:28;
  for(let i=0;i<N;i++){
    const a = (Math.PI*2)*Math.random(), v = 90+120*Math.random();
    sparks.push({x,y, vx:Math.cos(a)*v, vy:Math.sin(a)*v, life:intense?420:300, t:0});
  }
  halos.push({x,y, r0:8, r1:intense?80:48, t:0, life:intense?360:260});
}
function spawnRocket(x){
  rockets.push({x, y:sparkCanvas.height+12, vy:-380-120*Math.random(), life:420, t:0});
}
function spawnConfetti(){
  const W=confettiCanvas.width;
  for(let i=0;i<45;i++){
    confs.push({x:Math.random()*W, y:-10, vx:(Math.random()*80-40), vy:120+Math.random()*120, rot:Math.random()*6.28, vr:(Math.random()-.5)*4, life:900, t:0});
  }
  hudFlash.classList.add('show'); setTimeout(()=>hudFlash.classList.remove('show'),100);
}
let effRAF=null, lastT=performance.now();
function effectsLoop(t){
  const dt = Math.min(32, t-lastT); lastT=t;
  spk.clearRect(0,0,sparkCanvas.width, sparkCanvas.height);
  spk.globalCompositeOperation="lighter";

  rockets = rockets.filter(r=>r.t<r.life);
  for(const r of rockets){ r.t+=dt; r.y += r.vy*dt/1000; spk.globalAlpha=.6; spk.fillStyle="#a7f3d0"; spk.fillRect(r.x-1.2,r.y,2.4,10); }

  halos = halos.filter(h=>h.t<h.life);
  for(const h of halos){
    h.t+=dt; const k=Math.min(1,h.t/h.life); const r=h.r0+(h.r1-h.r0)*k;
    spk.globalAlpha = 0.22*(1-k);
    const grd = spk.createRadialGradient(h.x,h.y,r*0.1, h.x,h.y,r);
    grd.addColorStop(0,"rgba(34,197,94,0.35)");
    grd.addColorStop(1,"rgba(34,197,94,0.0)");
    spk.fillStyle=grd; spk.beginPath(); spk.arc(h.x,h.y,r,0,Math.PI*2); spk.fill();
  }

  sparks = sparks.filter(p=>p.t<p.life);
  for(const p of sparks){
    p.t+=dt; const k=p.t/p.life;
    const x=p.x + p.vx*(p.t/1000);
    const y=p.y + p.vy*(p.t/1000) + 0.0008*(p.t*p.t);
    spk.globalAlpha = (1-k); spk.beginPath(); spk.arc(x,y, 1.8, 0, Math.PI*2); spk.fillStyle="#22c55e"; spk.fill();
  }

  conf.clearRect(0,0,confettiCanvas.width, confettiCanvas.height);
  confs = confs.filter(c=>c.t<c.life);
  for(const c of confs){
    c.t+=dt; c.x += c.vx*dt/1000; c.y += c.vy*dt/1000; c.rot += c.vr*dt/1000;
    conf.save(); conf.translate(c.x,c.y); conf.rotate(c.rot);
    conf.fillStyle = `hsl(${(c.x+c.y)%360},85%,60%)`;
    conf.fillRect(-3,-6,6,12); conf.restore();
  }
  effRAF = (sparks.length||halos.length||confs.length||rockets.length)? requestAnimationFrame(effectsLoop) : null;
}
function celebrateAt(iInPage,intense=false){
  const p = renderAPI?.getXY(iInPage); if(!p) return;
  const svgRect = document.querySelector("#staff svg")?.getBoundingClientRect() || staffWrap.getBoundingClientRect();
  const x = p.x - svgRect.left, y = p.y - svgRect.top;
  spawnSpark(x,y,intense);
  spawnRocket(x);
  if(intense) spawnConfetti();
  if(!effRAF){ lastT=performance.now(); effRAF = requestAnimationFrame(effectsLoop); }
  bar.classList.add('flash'); setTimeout(()=>bar.classList.remove('flash'),140);
}

/* ===== オーディオ ===== */
let ac=null, mediaStream=null, source=null, hpf=null, peak=null, analyser=null;
let rafPitch=null;

async function startAudio(){
  if(document.visibilityState!=="visible"){ toast("非可視状態では開始できません。","warn",2000); return; }
  try{
    if(!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia未対応");
    if(!ac) ac = new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
    if(!ac) throw new Error("AudioContext作成失敗");
    if(ac.state==="suspended"){ try{ await ac.resume(); }catch{} }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 }
    });
    if(!mediaStream || mediaStream.getAudioTracks().length===0) throw new Error("MediaStreamが空");
    if(!ac || ac.state==="closed") ac = new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});

    source = new MediaStreamAudioSourceNode(ac, {mediaStream});
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
function stopAudioSync(){
  try{
    stopLoops();
    if(analyser) try{ analyser.disconnect(); }catch{}; if(peak) try{ peak.disconnect(); }catch{};
    if(hpf) try{ hpf.disconnect(); }catch{}; if(source) try{ source.disconnect(); }catch{};
    if(mediaStream) try{ mediaStream.getTracks().forEach(t=>t.stop()); }catch{};
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
let nearestSemiCents = 0;
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
  const clipped = Math.max(0, Math.min(120, db));
  dbEl.textContent = `${clipped} dB`;
  if(clipped>=80){ dbEl.style.color="#ff9b96"; }
  else if(clipped>=70){ dbEl.style.color="#ffca76"; }
  else if(clipped>=40){ dbEl.style.color="#a6ffbf"; }
  else { dbEl.style.color="#cbd5e1"; }
}

/* ===== ピッチループ ===== */
let PASS_BAND_CENTS = DIFF_TO_BAND[diffSel.value];
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
      updateBar(0); nearestSemiCents=0; inBandSince=0; nextBandSince=0;
      rafPitch = requestAnimationFrame(loop); return;
    }
    if(f0<=0){ adviceEl.className="warn"; adviceEl.textContent="検出が不安定…"; rafPitch=requestAnimationFrame(loop); return; }
    if(f0 < VIOLIN_MIN-2){ adviceEl.className="warn"; adviceEl.textContent="バイオリン音域外（低すぎ）"; updateBar(0); rafPitch=requestAnimationFrame(loop); return; }

    const cur = exercise[idx]; if(!cur){ rafPitch=requestAnimationFrame(loop); return; }
    const fRef = letterFreqWithAcc(cur, A4_REF_HZ);
    const cents = centsDiff(f0, fRef), absC = Math.abs(cents), sc = scoreFromCents(absC);

    updateBar(Math.max(-50, Math.min(50, cents)));

    // 針は近傍半音に対するセント
    const midi = 69 + 12*Math.log2(f0/A4_REF_HZ), midiRnd = Math.round(midi);
    const fSemi = A4_REF_HZ * Math.pow(2, (midiRnd-69)/12);
    const near = Math.max(-50, Math.min(50, centsDiff(f0,fSemi)));
    nearestSemiCents = (Math.abs(near) <= DEAD_BAND_CENT) ? 0 : near;

    // アドバイス
    if(absC>50){ setAdvice("頑張ろう！","bad"); }
    else if(absC<=PASS_BAND_CENTS){ setAdvice("いい感じ！","good"); }
    else { setAdvice(`${absC|0}c ${cents>0?"高い":"低い"}`,"warn"); }

    // 表示スコア
    miniScore(absC);
    bigScoreEl.textContent = String(sc);

    const now = performance.now();

    // ---- 採点（現在の音だけ） ----
    if(absC<=PASS_BAND_CENTS){
      if(!inBandSince) inBandSince = now;
      if(scores[idx]==null && now-inBandSince>=PASS_DWELL_MS){
        scores[idx]=sc;
        const iInPage = idx - pageOffset;
        renderAPI.badge(iInPage, sc>=95?"◎":"◯"); // 合格は◎/◯
        celebrateAt(iInPage, sc>=95);
        hudFlash.classList.add('show'); setTimeout(()=>hudFlash.classList.remove('show'),90);
      }
    }else{ inBandSince=0; }

    // ---- 進行：次の音を実際に弾いたら進む ----
    const hasNext = (idx+1<totalNotes);
    if(hasNext){
      const nextRef = exercise[idx+1];
      const fNext = letterFreqWithAcc(nextRef, A4_REF_HZ);
      const cNext = Math.abs(centsDiff(f0, fNext));

      if(cNext<=PASS_BAND_CENTS){
        if(!nextBandSince) nextBandSince = now;
        if(now-nextBandSince>=NEXT_DWELL_MS && now-lastAdvance>=LOCK_SAME_MS){
          if(scores[idx]==null){ // 飛ばし
            const iInPage = idx - pageOffset;
            renderAPI.recolor(iInPage,"note-failed"); renderAPI.badge(iInPage,"×");
          }
          advance(); lastAdvance=now; nextBandSince=0; inBandSince=0;
        }
      }else{
        nextBandSince=0;
      }
    }else{
      if(scores[idx]!=null && now-lastAdvance>LOCK_SAME_MS){ finish(); }
    }

    rafPitch = requestAnimationFrame(loop);
  })();

  requestAnimationFrame(servoLoop);
}
function stopLoops(){ if(rafPitch){ cancelAnimationFrame(rafPitch); rafPitch=null; } }

/* ===== UI ===== */
function setAdvice(t, cls){ adviceEl.className=cls; adviceEl.textContent=t; }
function miniScore(absC){
  miniScoreEl.className="";
  if(absC<=2){ miniScoreEl.classList.add('green'); miniScoreEl.textContent="◎"; }
  else if(absC<=7){ miniScoreEl.classList.add('yellow'); miniScoreEl.textContent="◯"; }
  else { miniScoreEl.classList.add('red'); miniScoreEl.textContent="△"; }
}

/* ===== 進行 ===== */
function advance(){
  idx++;
  if(idx>=totalNotes){ finish(); return; }
  const newPage = Math.floor(idx/16)*16;
  if(newPage!==pageOffset){ pageOffset=newPage; drawPage(); }
  updateProgress();
}

/* ===== セッション ===== */
function rebuildSequence(){
  exercise = makeExerciseAll(scaleType, level, currentKey);
  totalNotes = exercise.length;
  pageOffset = 0; idx = 0; scores = []; inBandSince=0; nextBandSince=0; lastAdvance=performance.now();
}
function startSession(){
  RMS_TH=+rmsInput.value; DB_OFFSET=(+dboffInput.value)|0;
  PASS_BAND_CENTS = DIFF_TO_BAND[diffSel.value] || 5;
  rebuildSequence(); drawPage(); updateProgress();
}
function stopSessionUI(){
  bigScoreEl.textContent="—"; miniScoreEl.textContent="—"; miniScoreEl.className=""; setAdvice("停止中","");
}

/* ===== 完了（褒める） ===== */
function finish(){
  const passed = scores.filter(v=>typeof v==="number");
  const avg = passed.length? Math.round(passed.reduce((a,b)=>a+b,0)/passed.length) : 0;
  const resultEl=document.getElementById('result');
  const praise=document.getElementById('praise'); const details=document.getElementById('details');
  if(avg>=98) praise.textContent="神懸りの安定感。";
  else if(avg>=95) praise.textContent="プロレベルの精度。";
  else if(avg>=90) praise.textContent="とても良い音程です。";
  else praise.textContent="着実に上達しています。";
  details.textContent=`合格時スコア平均：${avg} 点（${passed.length} / ${totalNotes} 音）`;
  resultEl.classList.add('show'); resultEl.setAttribute('aria-hidden','false');
  document.getElementById('again').onclick=()=>{ resultEl.classList.remove('show'); startSession(); };
  document.getElementById('close').onclick=()=>{ resultEl.classList.remove('show'); };
}

/* ===== ゲート・ライフサイクル ===== */
const gate = document.getElementById('gate');
let permitting=false;
window.__permit = async function(){
  if(permitting) return; permitting=true;
  try{
    gate.classList.remove('show'); gate.setAttribute('aria-hidden','true');
    await startAudio(); startSession(); keepAwake(true);
    btnStart.disabled=true; btnStop.disabled=false;
  }catch(e){ logError(e); gate.classList.add('show'); gate.setAttribute('aria-hidden','false'); }
  finally{ permitting=false; }
};

/* ====== フィルター（タブ）とキーリスト ====== */
function populateKeys(){
  const keys = getKeys(scaleType, level);
  keySel.innerHTML = "";
  keys.forEach(k=>{ const o=document.createElement('option'); o.value=k; o.textContent=k; keySel.appendChild(o); });
  if(!keys.includes(currentKey)) currentKey = keys[0]||"C";
  keySel.value = currentKey;
}
function onFilterChange(){
  scaleType = tabMajor.checked ? "major" : "minor";
  level = tabAdvanced.checked ? "advanced" : "intermediate";
  populateKeys();
  rebuildSequence(); drawPage(); updateProgress();
  toast(`種別:${scaleType==="major"?"長調":"短調"} / レベル:${level==="advanced"?"上級":"中級"} / 調:${currentKey}`,'info',1400,true);
}

[tabMajor, tabMinor, tabIntermediate, tabAdvanced].forEach(el=>{
  el.addEventListener('change', onFilterChange, {passive:true});
});
keySel.addEventListener('change', ()=>{
  currentKey = keySel.value;
  rebuildSequence(); drawPage(); updateProgress();
});

/* 難易度（採点帯） */
diffSel.addEventListener('change', ()=>{
  PASS_BAND_CENTS = DIFF_TO_BAND[diffSel.value] || 5;
});

/* 開始/停止 */
btnStart.addEventListener('click', async()=>{
  try{
    if(!ac || !mediaStream){ await startAudio(); if(!ac||!mediaStream){ toast("マイク許可が必要です。","warn",2000); return; } }
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
rmsInput.addEventListener('change', ()=>{ const v = Math.max(0.0005, Math.min(0.02, +rmsInput.value)); rmsInput.value=String(v.toFixed(4)); toast(`RMS閾値: ${rmsInput.value}`,'info',1200,true); });
dboffInput.addEventListener('change', ()=>{ const v = Math.max(-20, Math.min(20, (+dboffInput.value)|0)); dboffInput.value=String(v); DB_OFFSET=v; toast(`dB補正: ${v} dB`,'info',1200,true); });

/* ===== バックグラウンド/遷移で確実停止 ===== */
async function hardStop(){
  try{
    stopSessionUI(); btnStart.disabled=false; btnStop.disabled=true;
    await stopAudio();
    gate.classList.add('show'); gate.setAttribute('aria-hidden','false');
  }catch(e){ logError(e); }
}
function hardStopSync(){ try{ stopSessionUI(); stopAudioSync(); }catch(e){} }

["visibilitychange","webkitvisibilitychange","blur","freeze"].forEach(ev=>{
  window.addEventListener(ev, ()=>{ if(document.hidden || ev!=="visibilitychange"){ hardStop(); } }, {passive:true});
});
window.addEventListener("pagehide", hardStopSync, {passive:true});
window.addEventListener("beforeunload", hardStopSync, {passive:true});
window.addEventListener("unload", hardStopSync, {passive:true});
setInterval(()=>{ if(document.hidden && (ac || mediaStream)){ hardStop(); } }, 900);

/* ===== スリープ抑止 ===== */
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
  // 初期フィルター
  scaleType = "major"; level = "advanced";
  populateKeys();
  if(!currentKey) currentKey = keySel.value;

  rebuildSequence(); drawPage(); updateProgress();
  requestAnimationFrame(servoLoop);

  // 音域検証（データは可奏域内の想定）
  try{
    const keys = getKeys(scaleType, level);
    const problems=[];
    for(const scType of ["major","minor"]){
      for(const lv of ["intermediate","advanced"]){
        for(const k of getKeys(scType, lv)){
          const ex = makeExerciseAll(scType, lv, k);
          const freqs = ex.map(n=>letterFreqWithAcc(n));
          const mn=Math.min(...freqs), mx=Math.max(...freqs);
          if(mn<196-1e-6 || mx>2637+1e-6) problems.push(`${scType}/${lv}/${k}`);
        }
      }
    }
    if(problems.length){ logError(new Error("音域外キー検出: "+problems.join(", "))); }
  }catch(e){ logError(e); }
})();

/* ===== エラー収集 ===== */
window.addEventListener('error', ev=>{ logError(ev.error||ev.message||ev); document.getElementById('error-modal').classList.add('show'); });
window.addEventListener('unhandledrejection', ev=>{ logError(ev.reason||ev); document.getElementById('error-modal').classList.add('show'); });
