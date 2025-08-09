import { ALL_KEYS, buildMajorScale, letterFreq } from "./scales.js";
import { renderScale, highlightIndex } from "./score.js";

const A4_REF_HZ = 442;
const COOLDOWN_NEXT_MS = 220;
const PASS_BAND_CENTS = 15;

const errorLog=[];
function sanitize(s){
  return String(s||"")
    .replace(/https?:\/\/[^\s)]+/g,"<URL>")
    .replace(/file:\/\/[^\s)]+/g,"<FILE>")
    .replace(/at .*?\((.*?)\)/g,"at <func>(<masked>)");
}
function pushError(e){
  const msg=sanitize(e?.message||e);
  const entry=`${new Date().toLocaleString()} : ${msg}`;
  errorLog.push(entry); renderErrorModal();
  showErrorModal(); // 自動ポップアップ
}
window.addEventListener('error',(ev)=>{ pushError(ev.error||ev.message||"UnknownError"); });
window.addEventListener('unhandledrejection',(ev)=>{ pushError(ev.reason||"UnhandledRejection"); });

function renderErrorModal(){ const list=document.getElementById('error-list'); if(!list) return; list.innerHTML=""; errorLog.slice(-80).forEach(t=>{ const li=document.createElement('li'); li.textContent=t; list.appendChild(li); }); }
function showErrorModal(){ const m=document.getElementById('error-modal'); m.classList.add('show'); m.setAttribute('aria-hidden','false'); }
function hideErrorModal(){ const m=document.getElementById('error-modal'); m.classList.remove('show'); m.setAttribute('aria-hidden','true'); }
document.getElementById('err-close').onclick=hideErrorModal;
document.getElementById('err-copy').onclick=async()=>{ await navigator.clipboard.writeText(errorLog.join('\n\n')); toast('エラー内容をコピーしました。','info',1800,true); };

let toastTimer;
function toast(msg, level='warn', ms=2000, tiny=false){
  const el=document.getElementById('toast');
  el.className=`${level} ${tiny?'tiny':''} show`; el.textContent=msg;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.className=el.className.replace('show',''), ms);
}

/* WakeLock */
let wakeLock=null;
const nosleepVideo=document.getElementById('nosleep');
async function keepAwakeEnable(){
  try{
    if('wakeLock' in navigator){ wakeLock=await navigator.wakeLock.request('screen'); }
    else if(nosleepVideo && nosleepVideo.paused){ await nosleepVideo.play().catch(()=>{}); }
  }catch{}
}
async function keepAwakeDisable(){
  try{ if(wakeLock){ await wakeLock.release(); wakeLock=null; } }catch{}
  try{ if(nosleepVideo && !nosleepVideo.paused){ nosleepVideo.pause(); } }catch{}
}

/* VexFlow（失敗→フォールバック） */
async function ensureVexFlow(){
  if(window.Vex?.Flow) return true;
  const cdns=[
    "https://cdn.jsdelivr.net/npm/vexflow@3.0.9/build/vexflow-min.js",
    "https://unpkg.com/vexflow@3.0.9/build/vexflow-min.js"
  ];
  for(const url of cdns){
    try{ await loadScript(url,7000); if(window.Vex?.Flow) return true; }
    catch{ pushError(new Error("VexFlow load fail")); }
  }
  pushError(new Error("VexFlowを読み込めませんでした（フォールバック描画へ）"));
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

/* UI 要素 */
const adviceEl=document.getElementById('advice');
const bigScoreEl=document.getElementById('big-score');
const miniScoreEl=document.getElementById('mini-score');
const needleEl=document.getElementById('needle');
const passSel=document.getElementById('pass');
const btnStart=document.getElementById('start');
const btnStop=document.getElementById('stop');
const keySelect=document.getElementById('key-select');
const rmsInput=document.getElementById('rms');
const progEl=document.getElementById('prog');

/* 状態 */
let renderCtx=null, scaleData=null;
let currentKey="G";
let passThreshold=90;
let LEVEL_RMS_THRESHOLD=0.002;
let sessionRunning=false;
let idx=0;
let lastAdvanceTime=0;
let mustExitPassBand=false;
let scores=[];
let finishing=false;

/* 画面表示 */
function updateNeedle(c){ const cc=Math.max(-50,Math.min(50,c)); const pct=(cc+50)/100; needleEl.style.left=`calc(${pct*100}% - 1px)`; }
function colorMini(diffAbs){
  miniScoreEl.className="";
  if(diffAbs<=5) miniScoreEl.classList.add('green'), miniScoreEl.textContent="◎";
  else if(diffAbs<=15) miniScoreEl.classList.add('yellow'), miniScoreEl.textContent="◯";
  else miniScoreEl.classList.add('red'), miniScoreEl.textContent="△";
}
let lastAdviceTs=0;
function setAdviceThrottled(cents, score, mode="normal"){
  const now=performance.now(); if(now-lastAdviceTs<140) return; lastAdviceTs=now;
  if(mode==="encourage"){ adviceEl.className="bad"; adviceEl.textContent="頑張ろう！"; bigScoreEl.textContent="—"; return; }
  const abs=Math.abs(cents); const arrow = cents>0?"↑":(cents<0?"↓":"＝"); const text=`${(abs|0)}c ${arrow}`;
  adviceEl.className="";
  if(abs<=5){ adviceEl.classList.add('good'); adviceEl.textContent=text+"（そのまま）"; }
  else if(abs<=20){ adviceEl.classList.add('warn'); adviceEl.textContent=text+"（微調整）"; }
  else { adviceEl.classList.add('bad'); adviceEl.textContent=text+"（思い切って修正）"; }
  bigScoreEl.textContent = `${score}`;
}

/* Audio */
let ac, workletNode, mic, analyser, mediaStream=null, audioReady=false;
async function startAudioGraph(){
  if(audioReady) return;
  try{
    ac=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
    await ac.audioWorklet.addModule('./pitch-worklet.js');
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 } });
    mic=ac.createMediaStreamSource(mediaStream);
    analyser=ac.createAnalyser(); analyser.fftSize=2048;
    workletNode=new AudioWorkletNode(ac,'pitch-detector',{numberOfInputs:1,numberOfOutputs:0});
    workletNode.port.onmessage=onWorkletMessage;
    mic.connect(analyser); mic.connect(workletNode);
    audioReady=true;
  }catch(e){ pushError(e); toast('マイク初期化に失敗。エラーを確認してください。','error',4500); }
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

/* visibility：開いている時だけマイクON */
document.addEventListener('visibilitychange', async()=>{
  if(!document.hidden){
    await keepAwakeEnable();
    if(!audioReady){ await startAudioGraph(); }
    await resumeAudio();
  }else{
    await keepAwakeDisable();
    await stopAudioGraph();
  }
});

/* ピッチ処理 */
function centsDiff(f_est,f_tgt){ return 1200*Math.log2(f_est/f_tgt); }
function scoreFromCents(absC){ const c=Math.min(200,Math.max(0,absC)); return Math.round(100*(1-c/200)); }

function onWorkletMessage(ev){
  const {f0, conf, rms, now} = ev.data || {};
  if(scaleData && idx < scaleData.noteObjs.length){
    const n=scaleData.noteObjs[idx];
    const fTarget=letterFreq(n.letter,n.octave,scaleData.keySignature,A4_REF_HZ);
    if(f0){ updateNeedle(centsDiff(f0,fTarget)); }
  }
  if(!sessionRunning || !scaleData) return;

  if(rms < LEVEL_RMS_THRESHOLD){ setAdviceThrottled(0,0,"encourage"); return; }
  if(!f0 || conf<0.30){ adviceEl.className="warn"; adviceEl.textContent='検出が不安定…'; return; }

  const cur=scaleData.noteObjs[idx];
  const fTarget=letterFreq(cur.letter,cur.octave,scaleData.keySignature,A4_REF_HZ);
  const cents=centsDiff(f0,fTarget);
  const absC=Math.abs(cents);

  // ±50c超 → 採点しない＆進めない
  if(absC > 50){ setAdviceThrottled(0,0,"encourage"); colorMini(absC); highlightIndex(renderCtx, idx); return; }

  const sc=scoreFromCents(absC);
  setAdviceThrottled(cents, sc);
  colorMini(absC);
  progEl.textContent=`音 ${Math.min(idx+1, scaleData.noteObjs.length)}/${scaleData.noteObjs.length}`;

  if(absC > PASS_BAND_CENTS) mustExitPassBand=false;
  const inPassBand = absC <= PASS_BAND_CENTS;

  if(sc >= passThreshold && inPassBand && !mustExitPassBand){
    const nowTs=performance.now();
    if(nowTs - lastAdvanceTime < COOLDOWN_NEXT_MS) return;
    if(scores[idx] == null) scores[idx] = sc;

    idx++; lastAdvanceTime=nowTs; mustExitPassBand=true;
    if(idx >= scaleData.noteObjs.length){ finishScale(); return; }
    highlightIndex(renderCtx, idx);
  }
}

/* セッション */
function startSession(){
  if(!audioReady){ resumeAudio(); }
  sessionRunning=true; finishing=false; document.body.classList.add('running');
  btnStart.disabled=true; btnStop.disabled=false;
  passThreshold=+passSel.value;
  LEVEL_RMS_THRESHOLD = +rmsInput.value;

  try{
    scaleData=buildMajorScale(currentKey);
    renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys, scaleData.noteObjs);
    idx=0; scores=[]; mustExitPassBand=true;
    highlightIndex(renderCtx,0);
    progEl.textContent=`音 1/${scaleData.noteObjs.length}`;
  }catch(e){ pushError(e); toast('五線譜の描画に失敗。エラーを確認してください。','error',4000); }
}
function stopSession(){
  sessionRunning=false; finishing=false; document.body.classList.remove('running');
  btnStart.disabled=false; btnStop.disabled=true;
  miniScoreEl.textContent="—"; miniScoreEl.className="";
  adviceEl.className=""; adviceEl.textContent="停止中";
  bigScoreEl.textContent="—";
  progEl.textContent=`音 1/${scaleData?.noteObjs?.length||48}`;
}
function finishScale(){
  if(finishing) return; finishing=true;
  const passed = scores.filter(s=>typeof s==='number');
  const avg = passed.length ? Math.round(passed.reduce((a,b)=>a+b,0)/passed.length) : 0;
  const resultEl=document.getElementById('result');
  const praiseEl=document.getElementById('praise');
  const detailsEl=document.getElementById('details');

  if(avg>=98) praiseEl.textContent="神懸りの安定感。舞台いけます。";
  else if(avg>=95) praiseEl.textContent="プロの精度。美しい。";
  else if(avg>=90) praiseEl.textContent="とても良い音程です！";
  else praiseEl.textContent="確実に上がっています。継続しましょう。";

  detailsEl.textContent = `合格時スコア平均：${avg} 点（${passed.length} / ${scaleData.noteObjs.length} 音）`;
  resultEl.classList.add('show'); resultEl.setAttribute('aria-hidden','false');
  document.getElementById('again').onclick=()=>{ resultEl.classList.remove('show'); resultEl.setAttribute('aria-hidden','true'); startSession(); };
  document.getElementById('close').onclick=()=>{ resultEl.classList.remove('show'); resultEl.setAttribute('aria-hidden','true'); };
  stopSession();
}

/* UI 初期化 */
(function fillPass(){
  const sel=passSel; sel.innerHTML="";
  for(let p=85;p<=100;p++){ const op=document.createElement('option'); op.textContent=String(p); sel.appendChild(op); }
  sel.value="90";
})();
rmsInput.addEventListener('change', ()=>{ const v=Math.max(0.001,Math.min(0.02, +rmsInput.value)); rmsInput.value=String(v.toFixed(3)); toast(`音量閾値(RMS): ${rmsInput.value}`,'info',1200,true); });
keySelect.addEventListener('change', ()=>{
  currentKey=keySelect.value;
  if(sessionRunning) stopSession();
  try{
    scaleData=buildMajorScale(currentKey);
    renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys, scaleData.noteObjs);
    highlightIndex(renderCtx,0);
    progEl.textContent=`音 1/${scaleData.noteObjs.length}`;
  }catch(e){ pushError(e); }
});
btnStart.addEventListener('click', ()=>{ resumeAudio(); startSession(); });
btnStop.addEventListener('click', stopSession);

/* 起動 */
(async function init(){
  keepAwakeEnable();
  try{ await ensureVexFlow(); }catch{}
  try{
    currentKey="G"; scaleData=buildMajorScale(currentKey);
    renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys, scaleData.noteObjs);
    highlightIndex(renderCtx,0);
    progEl.textContent=`音 1/${scaleData.noteObjs.length}`;
  }catch(e){ pushError(e); }
  if(!document.hidden){ await startAudioGraph(); await resumeAudio(); }
})();
