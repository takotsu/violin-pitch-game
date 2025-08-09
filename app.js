import { ALL_KEYS, buildMajorScale, letterFreq } from "./scales.js";
import { renderScale, highlightIndex, setNoteLabel } from "./score.js";

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
function renderErrorModal(){ const list=document.getElementById('error-list'); if(!list) return; list.innerHTML=""; errorLog.slice(-50).forEach(t=>{ const li=document.createElement('li'); li.textContent=t; list.appendChild(li); }); }
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

/* ===== Wake Lock / スリープ防止 ===== */
let wakeLock = null;
const nosleepVideo = document.getElementById('nosleep');
async function keepAwakeEnable(){
  try{
    if('wakeLock' in navigator){
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', ()=>{ /* 可視復帰で再取得 */ });
    }else{
      if(nosleepVideo && nosleepVideo.paused){ await nosleepVideo.play().catch(()=>{}); }
    }
  }catch{}
}
async function keepAwakeDisable(){
  try{ if(wakeLock){ await wakeLock.release(); wakeLock=null; } }catch{}
  try{ if(nosleepVideo && !nosleepVideo.paused){ nosleepVideo.pause(); } }catch{}
}

/* ===== 画面回転ロック ===== */
async function aggressiveLandscape(){
  try{
    if(!document.fullscreenElement){
      await document.documentElement.requestFullscreen({navigationUI:"hide"}).catch(()=>{});
    }
    if(screen.orientation?.lock){ await screen.orientation.lock('landscape').catch(()=>{}); }
  }catch{}
}
['pointerdown','touchend','keydown'].forEach(ev=>{
  document.addEventListener(ev, ()=>{ aggressiveLandscape(); resumeAudio(); keepAwakeEnable(); }, {passive:true});
});

/* ===== VexFlow（失敗しても続行） ===== */
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
  pushError(new Error("VexFlowをCDNから読み込めませんでした。フォールバック描画に切替。"));
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

/* ===== 定数・UI ===== */
const A4_REF_HZ=442;
const LEVEL_RMS_THRESHOLD = 0.005;

const miniScoreEl=document.getElementById('mini-score');
const feedbackEl=document.getElementById('feedback');
const needleEl=document.getElementById('needle');
const passSel=document.getElementById('pass');
const btnStart=document.getElementById('start');
const btnStop=document.getElementById('stop');
const bpmInput=document.getElementById('bpm');
const metroLed=document.getElementById('metro-led');
const metroToggle=document.getElementById('metroToggle');
const keySelect=document.getElementById('key-select');

/* ===== 状態 ===== */
let renderCtx=null;
let currentKey="G";
let passThreshold=90;
let sessionRunning=false, inScale=false;
let scaleData=null;
let idx=0, firstScores=[];
let lowLevelSince=0, lastPitchWarn=0;

/* ===== 表示ユーティリティ ===== */
function colorMini(s){
  miniScoreEl.className=""; 
  if(s>=90) miniScoreEl.classList.add('green'); else if(s>=70) miniScoreEl.classList.add('yellow'); else miniScoreEl.classList.add('red');
}
function updateNeedle(c){ const clamped=Math.max(-50,Math.min(50,c)); const pct=(clamped+50)/100; needleEl.style.left=`calc(${pct*100}% - 1px)`; }

/* ===== メトロノーム（要素オーディオ・音量強化） ===== */
let metroTimer=null, metroOn=false;
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
  const bpm=+bpmInput.value, beatMs=60_000/bpm; let beat=0;
  metroTimer=setInterval(()=>{ playBeep(beat%4===0); metroLed.style.background="#22c55e"; setTimeout(()=>metroLed.style.background="#334155",120); beat++; }, beatMs);
}
function stopMetronome(){ if(metroTimer) clearInterval(metroTimer); metroTimer=null; }

/* ===== Audio 可視・不可視制御 ===== */
let ac, workletNode, mic, analyser, mediaStream=null;
let audioReady=false;
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

/* ===== 可視・不可視イベント ===== */
document.addEventListener('visibilitychange', async()=>{
  if(!document.hidden){
    await aggressiveLandscape();
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
  const {f0, conf, rms, dropped, now} = ev.data || {};
  const tNow = now || performance.now();

  if(!sessionRunning){
    // 非セッション中は針だけ動かす（ターゲットは現在のキーの先頭音）
    if(scaleData){
      const n=scaleData.noteObjs[Math.min(idx, scaleData.noteObjs.length-1)];
      const fTarget=letterFreq(n.letter,n.octave,scaleData.keySignature,A4_REF_HZ);
      if(f0){ const cents=centsDiff(f0,fTarget); updateNeedle(cents); }
    }
    return;
  }

  if(rms < LEVEL_RMS_THRESHOLD){
    if(!lowLevelSince) lowLevelSince=tNow;
    if(tNow - lowLevelSince > 3000){ notify('入力が小さいです。マイクを近づけてください。','warn',1800,true); lowLevelSince=tNow; }
    return;
  }else lowLevelSince=0;

  if(!f0 || conf<0.5){
    if(tNow - lastPitchWarn > 2000){ feedbackEl.textContent='検出が不安定です。一定の弓圧で弾いてください。'; lastPitchWarn=tNow; }
    return;
  }

  const cur=scaleData.noteObjs[idx];
  const fTarget=letterFreq(cur.letter,cur.octave,scaleData.keySignature,A4_REF_HZ);
  const cents=centsDiff(f0,fTarget);
  const sc=scoreFromCents(Math.abs(cents));

  miniScoreEl.textContent=String(sc); colorMini(sc);
  feedbackEl.textContent=`音 ${idx+1}/${scaleData.noteObjs.length}`;
  updateNeedle(cents);

  // 初回スコアのみ記録・表示（音符の直下に数値）
  if(firstScores[idx]==null){
    firstScores[idx]=sc;
    setNoteLabel(renderCtx, idx, sc);
  }

  if(sc >= passThreshold){
    idx++;
    if(idx >= scaleData.noteObjs.length){ finishScale(); return; }
    highlightIndex(renderCtx, idx);
  }
}

/* ===== セッション制御 ===== */
function startSession(){
  if(!audioReady){ notify('マイク初期化中です。画面を一度タップして有効化してください。','info',2500); resumeAudio(); return; }
  sessionRunning=true; inScale=true; document.body.classList.add('running');
  btnStart.disabled=true; btnStop.disabled=false;
  passThreshold=+passSel.value;

  try{
    scaleData=buildMajorScale(currentKey);
    renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys, scaleData.noteObjs);
    idx=0; firstScores=Array(scaleData.vexKeys.length).fill(null);
    highlightIndex(renderCtx,0);
    startMetronome();
  }catch(e){ pushError(e); notify('五線譜の描画に失敗（エラー情報を確認）','error',4000); }
}
function stopSession(){
  sessionRunning=false; inScale=false; document.body.classList.remove('running');
  btnStart.disabled=false; btnStop.disabled=true;
  stopMetronome();
  miniScoreEl.textContent="--"; miniScoreEl.className="";
  feedbackEl.textContent="停止中";
}
function finishScale(){
  stopMetronome();
  const valid=firstScores.filter(x=>typeof x==='number');
  const avg=valid.length? Math.round(valid.reduce((s,x)=>s+x,0)/valid.length):0;
  showResult(avg); stopSession();
}

/* ===== 結果演出 ===== */
function showResult(final){
  const resultEl=document.getElementById('result');
  const finalScoreEl=document.getElementById('final-score');
  const praiseEl=document.getElementById('praise');
  const detailsEl=document.getElementById('details');
  const PRAISES=["すごい！モーツァルトかと思いました！","今日の主役です！","響きが美しいです！","音程が澄み切っています！","ピッチコントロールが神！","耳が良すぎます！"];
  praiseEl.textContent=PRAISES[Math.floor(Math.random()*PRAISES.length)];
  detailsEl.textContent=`各音は「最初に検出したスコア」を平均化。最終: ${final} 点`;
  let v=0; const t0=performance.now(), dur=900;
  (function anim(t){const r=Math.min(1,(t-t0)/dur); v=Math.floor(final*r*r+0.5); finalScoreEl.textContent=String(v); if(r<1) requestAnimationFrame(anim);})(performance.now());
  resultEl.classList.add('show'); resultEl.setAttribute('aria-hidden','false');
  document.getElementById('again').onclick=()=>{ resultEl.classList.remove('show'); resultEl.setAttribute('aria-hidden','true'); startSession(); };
  document.getElementById('close').onclick=()=>{ resultEl.classList.remove('show'); resultEl.setAttribute('aria-hidden','true'); };
}

/* ===== UIイベント ===== */
btnStart.addEventListener('click', ()=>{ resumeAudio(); startSession(); });
btnStop.addEventListener('click', stopSession);
passSel.addEventListener('change', ()=>{ passThreshold=+passSel.value; notify(`合格閾値: ${passThreshold} 点`,'info',1200,true); });
bpmInput.addEventListener('change', ()=>{ const v=Math.max(40,Math.min(200, Math.round((+bpmInput.value)/5)*5)); bpmInput.value=String(v); startMetronome(); });
metroToggle.addEventListener('change', ()=>{ metroOn=metroToggle.checked; startMetronome(); });

(function ensureKeyOptions(){
  const values = new Set(Array.from(keySelect.options).map(o=>o.value));
  if(!values.has(keySelect.value)) keySelect.value="G";
})();
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

/* ===== 初期化 ===== */
(async function init(){
  // 横向き・スリープ防止を可能な範囲で即時試行
  aggressiveLandscape(); keepAwakeEnable();
  // VexFlow読み込み（失敗しても自前描画にフォールバック）
  try{ await ensureVexFlow(); }catch{}
  // 初期レンダリング
  try{
    const currentKeyInit="G"; currentKey=currentKeyInit;
    scaleData=buildMajorScale(currentKeyInit);
    renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys, scaleData.noteObjs);
    highlightIndex(renderCtx,0);
  }catch(e){ pushError(e); }
  // 前面ならマイクON
  if(!document.hidden){ await startAudioGraph(); await resumeAudio(); }
})();
