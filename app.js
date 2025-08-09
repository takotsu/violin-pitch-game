import { ALL_KEYS, buildMajorScale, letterFreq } from "./scales.js";
import { renderScale, highlightIndex } from "./score.js";

/* ===== 設定 ===== */
const A4_REF_HZ = 442;
const STUCK_SEC_BEFORE_AUTONEXT = 3;
const COOLDOWN_NEXT_MS = 220;
const PASS_BAND_CENTS = 15;

/* ===== エラーログ ===== */
const errorLog = [];
function pushError(e){
  const msg = (e?.message||e)?.toString();
  const stack = e?.error?.stack || e?.stack || "";
  const entry = `${new Date().toLocaleString()} : ${msg}\n${stack}`;
  errorLog.push(entry); renderErrorModal();
}
window.addEventListener('error',(ev)=>{ pushError(ev); notify('エラーが発生（詳細を見るをタップ）','error',3500); showErrorModal(); });
window.addEventListener('unhandledrejection',(ev)=>{ pushError(ev.reason||ev); notify('エラーが発生（詳細を見るをタップ）','error',3500); showErrorModal(); });
function renderErrorModal(){ const list=document.getElementById('error-list'); if(!list) return; list.innerHTML=""; errorLog.slice(-80).forEach(t=>{ const li=document.createElement('li'); li.textContent=t; list.appendChild(li); }); }
function showErrorModal(){ const m=document.getElementById('error-modal'); m.classList.add('show'); m.setAttribute('aria-hidden','false'); }
function hideErrorModal(){ const m=document.getElementById('error-modal'); m.classList.remove('show'); m.setAttribute('aria-hidden','true'); }
document.getElementById('err-close').onclick=hideErrorModal;
document.getElementById('err-copy').onclick=async()=>{ await navigator.clipboard.writeText(errorLog.join('\n\n')); notify('エラー内容をコピーしました。','info',2000); };

/* ===== 通知 ===== */
let toastTimer;
function notify(msg, level='warn', ms=2500, tiny=false){
  const el=document.getElementById('toast');
  el.className=`${level} ${tiny?'tiny':''} show`; el.textContent=msg;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.className=el.className.replace('show',''), ms);
}

/* ===== Wake Lock ===== */
let wakeLock = null;
const nosleepVideo = document.getElementById('nosleep');
async function keepAwakeEnable(){
  try{
    if('wakeLock' in navigator){
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', ()=>{});
    }else{
      if(nosleepVideo && nosleepVideo.paused){ await nosleepVideo.play().catch(()=>{}); }
    }
  }catch{}
}
async function keepAwakeDisable(){
  try{ if(wakeLock){ await wakeLock.release(); wakeLock=null; } }catch{}
  try{ if(nosleepVideo && !nosleepVideo.paused){ nosleepVideo.pause(); } }catch{}
}

/* ===== VexFlow ===== */
async function ensureVexFlow(){
  if(window.Vex?.Flow) return true;
  const cdns = [
    "https://cdn.jsdelivr.net/npm/vexflow@3.0.9/build/vexflow-min.js",
    "https://unpkg.com/vexflow@3.0.9/build/vexflow-min.js"
  ];
  for(const url of cdns){
    try{ await loadScript(url, 7000); if(window.Vex?.Flow) return true; }
    catch(e){ pushError(new Error(`VexFlow load fail: ${url}`)); }
  }
  pushError(new Error("VexFlowをCDNから読み込めませんでした。フォールバック描画に切り替えます。"));
  return false;
}
function loadScript(src, timeoutMs=7000){
  return new Promise((res,rej)=>{
    const s=document.createElement('script'); s.src=src; s.crossOrigin="anonymous"; s.referrerPolicy="no-referrer";
    const to=setTimeout(()=>{ s.remove(); rej(new Error("timeout")); }, timeoutMs);
    s.onload=()=>{ clearTimeout(to); res(); };
    s.onerror=()=>{ clearTimeout(to); rej(new Error("onerror")); };
    document.head.appendChild(s);
  });
}

/* ===== UI ===== */
const adviceEl=document.getElementById('advice');
const bigScoreEl=document.getElementById('big-score');
const miniScoreEl=document.getElementById('mini-score');
const needleEl=document.getElementById('needle');
const passSel=document.getElementById('pass');
const btnStart=document.getElementById('start');
const btnStop=document.getElementById('stop');
const bpmInput=document.getElementById('bpm');
const metroLed=document.getElementById('metro-led');
const metroToggle=document.getElementById('metroToggle');
const keySelect=document.getElementById('key-select');
const rmsInput=document.getElementById('rms');
const progEl=document.getElementById('prog');

/* ===== 状態 ===== */
let renderCtx=null, scaleData=null;
let currentKey="G";
let passThreshold=90;
let LEVEL_RMS_THRESHOLD = 0.002;
let sessionRunning=false;
let idx=0;
let lastProgressTime=0;
let lastValidTime=0;
let lastAdvanceTime=0;
let mustExitPassBand=false;
let scores=[];

/* ===== 表示 ===== */
function colorMini(diffAbs){
  miniScoreEl.className="";
  if(diffAbs<=5) miniScoreEl.classList.add('green'), miniScoreEl.textContent="◎";
  else if(diffAbs<=15) miniScoreEl.classList.add('yellow'), miniScoreEl.textContent="◯";
  else miniScoreEl.classList.add('red'), miniScoreEl.textContent="△";
}
function updateNeedle(c){ const clamped=Math.max(-50,Math.min(50,c)); const pct=(clamped+50)/100; needleEl.style.left=`calc(${pct*100}% - 1px)`; }
let lastAdviceTs = 0;
function setAdviceThrottled(cents, score){
  const now = performance.now();
  if(now - lastAdviceTs < 140) return; // 更新頻度を下げる
  lastAdviceTs = now;
  const abs=Math.abs(cents);
  const arrow = cents>0 ? "↑" : (cents<0 ? "↓" : "＝");
  const text = `${(abs|0)}c ${arrow}`;
  adviceEl.className="";
  if(abs<=5){ adviceEl.classList.add('good'); adviceEl.textContent = text+"（そのまま）"; }
  else if(abs<=20){ adviceEl.classList.add('warn'); adviceEl.textContent = text+"（微調整）"; }
  else { adviceEl.classList.add('bad'); adviceEl.textContent = text+"（思い切って修正）"; }
  bigScoreEl.textContent = `${score}`;
}

/* ===== メトロノーム ===== */
let metroTimer=null, metroOn=false, beat=0;
let strongPool=[], weakPool=[], poolIdxS=0, poolIdxW=0;
function makeBeepUrl(freq=2400, durMs=120, sr=44100){
  const len=Math.floor(sr*durMs/1000), wavLen=44+len*2;
  const buf=new ArrayBuffer(wavLen); const dv=new DataView(buf);
  const wrStr=(o,s)=>{ for(let i=0;i<s.length;i++) dv.setUint8(o+i,s.charCodeAt(i)); };
  wrStr(0,"RIFF"); dv.setUint32(4,wavLen-8,true); wrStr(8,"WAVE"); wrStr(12,"fmt "); dv.setUint32(16,16,true);
  dv.setUint16(20,1,true); dv.setUint16(22,1,true); dv.setUint32(24,sr,true); dv.setUint32(28,sr*2,true);
  dv.setUint16(32,2,true); dv.setUint16(34,16,true); wrStr(36,"data"); dv.setUint32(40,len*2,true);
  let off=44; for(let i=0;i<len;i++){ const t=i/sr; const env=Math.exp(-6*i/len); const s=Math.sign(Math.sin(2*Math.PI*freq*t))*0.98*env; dv.setInt16(off, s*32767, true); off+=2; }
  return URL.createObjectURL(new Blob([buf], {type:"audio/wav"}));
}
function initBeepPool(){
  const urlS=makeBeepUrl(2500,120); const urlW=makeBeepUrl(1700,100);
  strongPool=Array.from({length:8},()=>{const a=new Audio(urlS); a.preload="auto"; a.playsInline=true; a.volume=1.0; return a;});
  weakPool  =Array.from({length:8},()=>{const a=new Audio(urlW); a.preload="auto"; a.playsInline=true; a.volume=1.0; return a;});
}
function playBeep(strong=false){ const pool=strong?strongPool:weakPool; const a=pool[strong?(poolIdxS++%pool.length):(poolIdxW++%pool.length)]; a.currentTime=0; a.play().catch(()=>{}); }
function startMetronome(){
  if(metroTimer) clearInterval(metroTimer);
  if(!metroOn || !sessionRunning) return;
  const bpm=+bpmInput.value, beatMs=60_000/bpm; beat=0;
  metroTimer=setInterval(()=>{
    playBeep(beat%4===0);
    metroLed.style.background="#22c55e";
    setTimeout(()=>metroLed.style.background="#334155",120);
    if((beat%4===0) && sessionRunning){
      const now=performance.now();
      if(now - lastProgressTime > STUCK_SEC_BEFORE_AUTONEXT*1000 && now - lastValidTime < 1200){
        idx = Math.min(idx+1, scaleData.noteObjs.length);
        if(idx >= scaleData.noteObjs.length){ finishScale(); }
        else { highlightIndex(renderCtx, idx); progEl.textContent=`音 ${idx+1}/${scaleData.noteObjs.length}`; lastProgressTime=now; mustExitPassBand=true; }
      }
    }
    beat++;
  }, beatMs);
}
function stopMetronome(){ if(metroTimer) clearInterval(metroTimer); metroTimer=null; }

/* ===== Audio ===== */
let ac, workletNode, mic, analyser, mediaStream=null, audioReady=false;
async function startAudioGraph(){
  if(audioReady) return;
  try{
    ac=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
    await ac.audioWorklet.addModule('./pitch-worklet.js');
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 }
    });
    mic=ac.createMediaStreamSource(mediaStream);
    analyser=ac.createAnalyser(); analyser.fftSize=2048;
    workletNode=new AudioWorkletNode(ac,'pitch-detector',{numberOfInputs:1,numberOfOutputs:0});
    workletNode.port.onmessage=onWorkletMessage;
    mic.connect(analyser); mic.connect(workletNode);
    initBeepPool();
    audioReady=true;
  }catch(e){ pushError(e); notify('マイク初期化に失敗。エラー情報を確認してください。','error',5000); }
}
async function stopAudioGraph(){
  try{
    if(workletNode){ try{ workletNode.disconnect(); }catch{} workletNode.port.onmessage=null; workletNode=null; }
    if(analyser){ try{ analyser.disconnect(); }catch{} analyser=null; }
    if(mic){ try{ mic.disconnect(); }catch{} mic=null; }
    if(mediaStream){ try{ mediaStream.getTracks().forEach(t=>t.stop()); }catch{} mediaStream=null; }
    if(ac){ try{ await ac.suspend(); }catch{} try{ await ac.close(); }catch{} ac=null; }
  }finally{ audioReady=false; }
}
async function resumeAudio(){ try{ if(ac && ac.state!=='running'){ await ac.resume(); } }catch(e){ pushError(e); }}

/* 可視・不可視 */
document.addEventListener('visibilitychange', async()=>{
  if(!document.hidden){
    await keepAwakeEnable();
    if(!audioReady){ await startAudioGraph(); }
    await resumeAudio();
  }else{
    await keepAwakeDisable();
    await stopAudioGraph();
    stopMetronome();
  }
});

/* ===== ピッチ処理 ===== */
function centsDiff(f_est,f_tgt){ return 1200*Math.log2(f_est/f_tgt); }
function scoreFromCents(absC){ const c=Math.min(200,Math.max(0,absC)); return Math.round(100*(1-c/200)); }

function onWorkletMessage(ev){
  const {f0, conf, rms, now} = ev.data || {};
  const tNow = now || performance.now();

  // 常時ニードル
  if(scaleData){
    const n=scaleData.noteObjs[Math.min(idx, scaleData.noteObjs.length-1)];
    const fTarget=letterFreq(n.letter,n.octave,scaleData.keySignature,A4_REF_HZ);
    if(f0){ updateNeedle(centsDiff(f0,fTarget)); }
  }

  if(!sessionRunning) return;

  if(rms < LEVEL_RMS_THRESHOLD){ adviceEl.className="bad"; adviceEl.textContent='入力が小さいです。'; return; }
  if(!f0 || conf<0.30){ adviceEl.className="warn"; adviceEl.textContent='検出が不安定…'; return; } // conf閾値を下げてF#取りこぼしを回避

  lastValidTime = tNow;

  const cur=scaleData.noteObjs[idx];
  const fTarget=letterFreq(cur.letter,cur.octave,scaleData.keySignature,A4_REF_HZ);
  const cents=centsDiff(f0,fTarget);
  const absC=Math.abs(cents);
  const sc=scoreFromCents(absC);

  setAdviceThrottled(cents, sc);
  colorMini(absC);
  progEl.textContent=`音 ${idx+1}/${scaleData.noteObjs.length}`;

  if(absC > PASS_BAND_CENTS) mustExitPassBand=false;
  const inPassBand = absC <= PASS_BAND_CENTS;

  if(sc >= passThreshold && inPassBand && !mustExitPassBand){
    if(tNow - lastAdvanceTime < COOLDOWN_NEXT_MS) return;
    if(scores[idx] == null) scores[idx] = sc;

    idx++;
    lastProgressTime = tNow;
    lastAdvanceTime = tNow;
    mustExitPassBand = true;

    if(idx >= scaleData.noteObjs.length){ finishScale(); return; }
    highlightIndex(renderCtx, idx);
  }
}

/* ===== セッション ===== */
function startSession(){
  if(!audioReady){ notify('マイク初期化中です。画面をタップして有効化してください。','info',2500); resumeAudio(); return; }
  sessionRunning=true; document.body.classList.add('running');
  btnStart.disabled=true; btnStop.disabled=false;
  passThreshold=+passSel.value;
  LEVEL_RMS_THRESHOLD = +rmsInput.value;

  try{
    scaleData=buildMajorScale(currentKey);
    renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys, scaleData.noteObjs);
    idx=0; scores=[]; lastProgressTime=performance.now(); lastValidTime=0; lastAdvanceTime=0; mustExitPassBand=true;
    highlightIndex(renderCtx,0);
    startMetronome();
  }catch(e){ pushError(e); notify('五線譜の描画に失敗（エラー情報を確認）','error',4000); }
}
function stopSession(){
  sessionRunning=false; document.body.classList.remove('running');
  btnStart.disabled=false; btnStop.disabled=true;
  stopMetronome();
  miniScoreEl.textContent="—"; miniScoreEl.className="";
  adviceEl.className=""; adviceEl.textContent="停止中";
  bigScoreEl.textContent="—";
  progEl.textContent=`音 1/32`;
}
function finishScale(){
  stopMetronome();
  const passedScores = scores.filter(s=>typeof s==='number');
  const avg = passedScores.length ? Math.round(passedScores.reduce((a,b)=>a+b,0)/passedScores.length) : 0;

  const resultEl=document.getElementById('result');
  const praiseEl=document.getElementById('praise');
  const detailsEl=document.getElementById('details');

  if(avg>=98) praiseEl.textContent="神懸りの安定感。舞台いけます。";
  else if(avg>=95) praiseEl.textContent="プロの精度。美しい。";
  else if(avg>=90) praiseEl.textContent="とても良い音程です！";
  else praiseEl.textContent="確実に上がっています。継続しましょう。";

  detailsEl.textContent = `合格時スコア平均：${avg} 点（${passedScores.length} / ${scaleData.noteObjs.length} 音）`;
  resultEl.classList.add('show'); resultEl.setAttribute('aria-hidden','false');
  document.getElementById('again').onclick=()=>{ resultEl.classList.remove('show'); resultEl.setAttribute('aria-hidden','true'); startSession(); };
  document.getElementById('close').onclick=()=>{ resultEl.classList.remove('show'); resultEl.setAttribute('aria-hidden','true'); };
  stopSession();
}

/* ===== UI ===== */
(function fillPass(){
  const sel=passSel; sel.innerHTML="";
  for(let p=85;p<=100;p++){ const op=document.createElement('option'); op.textContent=String(p); sel.appendChild(op); }
  sel.value="90";
})();
bpmInput.addEventListener('change', ()=>{ const v=Math.max(40,Math.min(200, Math.round((+bpmInput.value)/5)*5)); bpmInput.value=String(v); startMetronome(); });
metroToggle.addEventListener('change', ()=>{ metroOn=metroToggle.checked; startMetronome(); });
rmsInput.addEventListener('change', ()=>{ const v=Math.max(0.001,Math.min(0.02, +rmsInput.value)); rmsInput.value=String(v.toFixed(3)); notify(`音量閾値(RMS): ${rmsInput.value}`,'info',1200,true); });

keySelect.addEventListener('change', ()=>{
  currentKey=keySelect.value;
  if(!sessionRunning){
    try{
      scaleData=buildMajorScale(currentKey);
      renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys, scaleData.noteObjs);
      highlightIndex(renderCtx,0);
    }catch(e){ pushError(e); }
  }
});
btnStart.addEventListener('click', ()=>{ resumeAudio(); startSession(); });
btnStop.addEventListener('click', stopSession);

/* ===== 初期化 ===== */
(async function init(){
  keepAwakeEnable();
  try{ await ensureVexFlow(); }catch{}
  try{
    currentKey="G"; scaleData=buildMajorScale(currentKey);
    renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys, scaleData.noteObjs);
    highlightIndex(renderCtx,0);
  }catch(e){ pushError(e); }
  if(!document.hidden){ await startAudioGraph(); await resumeAudio(); }
})();
