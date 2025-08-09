import { ALL_KEYS, buildMajorScale, letterFreq } from "./scales.js";
import { renderScale, highlightIndex } from "./score.js";

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

/* ===== Wake Lock ===== */
let wakeLock=null;
async function requestWakeLock(){ try{ if('wakeLock' in navigator){ wakeLock=await navigator.wakeLock.request('screen'); } }catch{} }
document.addEventListener('visibilitychange', async()=>{ if(!document.hidden){ requestWakeLock(); resumeAudio(); } });

/* ===== 画面回転ロック ===== */
async function lockLandscape(){
  try{
    if(!document.fullscreenElement){
      await document.documentElement.requestFullscreen({navigationUI:"hide"}).catch(()=>{});
    }
    if(screen.orientation && screen.orientation.lock){
      await screen.orientation.lock('landscape');
    }
  }catch(e){ pushError(new Error("orientation lock failed")); }
}
function updateRotateOverlay(){
  const isPortrait = window.matchMedia("(orientation: portrait)").matches;
  const ov = document.getElementById('rotate-overlay');
  if(isPortrait) ov.classList.add('show'); else ov.classList.remove('show');
}
document.getElementById('try-lock').addEventListener('click', ()=>{ lockLandscape(); updateRotateOverlay(); });

/* ===== VexFlow（失敗しても続行） ===== */
async function ensureVexFlow(){
  if(window.Vex && window.Vex.Flow) return true;
  const cdns = [
    "https://cdn.jsdelivr.net/npm/vexflow@3.0.9/build/vexflow-min.js",
    "https://unpkg.com/vexflow@3.0.9/build/vexflow-min.js"
  ];
  for(const url of cdns){
    try{ await loadScript(url, 7000); if(window.Vex && window.Vex.Flow) return true; }
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

/* ===== 基本ユーティリティ ===== */
const A4_REF_HZ=442;
function centsDiff(f_est,f_tgt){ return 1200*Math.log2(f_est/f_tgt); }
function scoreFromCents(absC){ const c=Math.min(200,Math.max(0,absC)); return Math.round(100*(1-c/200)); }

/* ===== UI refs ===== */
const bigScoreEl=document.getElementById('big-score');
const feedbackEl=document.getElementById('feedback');
const needleEl=document.getElementById('needle');
const passSel=document.getElementById('pass');
const btnStart=document.getElementById('start');
const btnStop=document.getElementById('stop');
const bpmInput=document.getElementById('bpm');
const metroLed=document.getElementById('metro-led');
const metroToggle=document.getElementById('metroToggle');
const keySelect=document.getElementById('key-select');
const karaokeCanvas=document.getElementById('karaoke');
const oscCanvas=document.getElementById('osc');

/* ===== 状態 ===== */
let renderCtx=null;
let currentKey="G";
function colorScore(s){ bigScoreEl.className=""; if(s>=90) bigScoreEl.classList.add('green'); else if(s>=70) bigScoreEl.classList.add('yellow'); else bigScoreEl.classList.add('red');}
function updateNeedle(c){ const clamped=Math.max(-50,Math.min(50,c)); const pct=(clamped+50)/100; needleEl.style.left=`calc(${pct*100}% - 1px)`; }

/* ===== Audio（常時：iOS対策で必ずresume） ===== */
let ac, workletNode, mic, analyser, mediaStream=null;
let audioReady=false;
let lowLevelSince=0, lastPitchWarn=0;
/* 閾値を大幅に下げる */
const LEVEL_RMS_THRESHOLD = 0.005;

async function resumeAudio(){
  try{
    if(ac && ac.state!=='running'){
      await ac.resume();
      notify('オーディオを再開しました。','info',1200,true);
    }
  }catch(e){ pushError(e); }
}

/* ===== スケール進行 ===== */
let sessionRunning=false, inScale=false;
let scaleData=null;
let idx=0, firstScores=[], passThreshold=90;

/* ===== メトロノーム（要素オーディオ） ===== */
let metroTimer=null, metroOn=false;
let strongPool=[], weakPool=[], poolIdxS=0, poolIdxW=0;
function makeBeepUrl(freq=1500, durMs=110, sr=44100){
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
  const urlS=makeBeepUrl(2400,120); const urlW=makeBeepUrl(1700,100);
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

/* ===== 波形（常時・左→右・プレイヘッド） ===== */
let sweepX=0, lastOscT=0, lastW=0, lastH=0;
function drawOsc(ts){
  const ctx=oscCanvas.getContext('2d');
  const w=oscCanvas.width=oscCanvas.clientWidth;
  const h=oscCanvas.height=oscCanvas.clientHeight;
  if(w!==lastW||h!==lastH){ ctx.fillStyle="#0f131a"; ctx.fillRect(0,0,w,h); lastW=w; lastH=h; sweepX=0; }

  const pxPerSec = w/20;
  const dt = lastOscT ? (ts-lastOscT)/1000 : 0; lastOscT=ts;
  const step = Math.max(1, Math.floor(pxPerSec*dt));

  if(analyser){
    const data=new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let maxAbs=0; for(let i=0;i<data.length;i++){ const v=Math.abs((data[i]-128)/128); if(v>maxAbs) maxAbs=v; }
    const bar = Math.max(1, Math.floor(maxAbs*h*0.9));
    for(let i=0;i<step;i++){
      ctx.fillStyle="#0f131a"; ctx.fillRect(sweepX,0,1,h);
      ctx.fillStyle="#8fbce8"; ctx.fillRect(sweepX, Math.floor(h/2 - bar/2), 1, bar);
      ctx.fillStyle="#2dd4bf"; ctx.fillRect(sweepX, 0, 1, h);
      sweepX++; if(sweepX>=w){ sweepX=0; }
    }
  }else{
    for(let i=0;i<step;i++){ ctx.fillStyle="#0f131a"; ctx.fillRect(sweepX,0,1,h); ctx.fillStyle="#2dd4bf"; ctx.fillRect(sweepX,0,1,h); sweepX++; if(sweepX>=w){ sweepX=0; } }
  }
  requestAnimationFrame(drawOsc);
}

/* ===== 解析結果（常時） ===== */
function onPitchMessage(ev){
  const {f0, conf, rms, dropped, now} = ev.data || {};
  const tNow = now || performance.now();

  if(rms < LEVEL_RMS_THRESHOLD){
    if(!lowLevelSince) lowLevelSince=tNow;
    if(tNow - lowLevelSince > 3000){ notify('入力が小さいです。マイクを近づけてください。','warn',1800,true); lowLevelSince=tNow; }
  }else lowLevelSince=0;

  if(dropped) notify('処理が追いついていません。他アプリを閉じてください。','warn',3000);

  // セッション外：針とカラオケだけ
  if(!sessionRunning){
    if(!f0){ updateNeedle(0); return; }
    if(scaleData){
      const n=scaleData.noteObjs[Math.min(idx, scaleData.noteObjs.length-1)];
      const fTarget=letterFreq(n.letter,n.octave,scaleData.keySignature,A4_REF_HZ);
      const cents=centsDiff(f0,fTarget);
      updateNeedle(cents); drawKaraoke(cents);
    }
    return;
  }

  // セッション中
  if(!f0 || conf<0.5 || rms<LEVEL_RMS_THRESHOLD){
    drawKaraoke(null);
    if(tNow - lastPitchWarn > 2000){ feedbackEl.textContent='検出が不安定です。一定の弓圧で弾いてください。'; lastPitchWarn=tNow; }
    return;
  }
  const cur=scaleData.noteObjs[idx];
  const fTarget=letterFreq(cur.letter,cur.octave,scaleData.keySignature,A4_REF_HZ);
  const cents=centsDiff(f0,fTarget);
  const sc=scoreFromCents(Math.abs(cents));
  bigScoreEl.textContent=String(sc); colorScore(sc);
  feedbackEl.textContent=`音 ${idx+1}/${scaleData.noteObjs.length}`;
  updateNeedle(cents); drawKaraoke(cents);

  if(firstScores[idx]==null){ firstScores[idx]=sc; }
  if(sc >= passThreshold){
    idx++;
    if(idx >= scaleData.noteObjs.length){ finishScale(); return; }
    highlightIndex(renderCtx, idx, Math.min(idx+1, scaleData.noteObjs.length-1));
  }
}

/* ===== カラオケ ===== */
const karaokePts=[];
function drawKaraoke(centsOrNull){
  const ctx=karaokeCanvas.getContext('2d'); const w=karaokeCanvas.width, h=karaokeCanvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle="rgba(200,200,200,0.4)"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,h*0.5); ctx.lineTo(w,h*0.5); ctx.stroke();

  if(inScale && scaleData){
    const stepW=w/scaleData.vexKeys.length;
    ctx.fillStyle="rgba(45,212,191,0.15)"; ctx.fillRect(0,0, stepW*(idx+1), h);
    for(let i=0;i<=scaleData.vexKeys.length;i++){
      const x=i*stepW;
      ctx.strokeStyle= (i%8===0) ? "rgba(120,160,170,0.45)" : "rgba(100,160,160,0.25)";
      if(i%2===0){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    }
  }
  if(centsOrNull!=null){
    const c=Math.max(-50,Math.min(50,centsOrNull));
    const y=h*0.5 - (c/50)*(h*0.4);
    const x= inScale && scaleData ? (w/scaleData.vexKeys.length)*(idx + 0.5) : w*0.5;
    karaokePts.push({x,y}); if(karaokePts.length>160) karaokePts.shift();
    ctx.strokeStyle="rgba(45,212,191,0.95)"; ctx.lineWidth=2; ctx.beginPath();
    karaokePts.forEach((p,i)=>{ if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); }); ctx.stroke();
  }
}

/* ===== 結果 ===== */
function finishScale(){
  stopMetronome();
  const valid=firstScores.filter(x=>typeof x==='number');
  const avg=valid.length? Math.round(valid.reduce((s,x)=>s+x,0)/valid.length):0;
  showResult(avg); stopSession();
}
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

/* ===== エンジン起動（常時） ===== */
async function startEngine(){
  if(audioReady) return;
  try{
    ac=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
    await ac.audioWorklet.addModule('./pitch-worklet.js');
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio:{
        echoCancellation:false, noiseSuppression:false, autoGainControl:false,
        channelCount:1
      }
    });
    mic=ac.createMediaStreamSource(mediaStream);
    analyser=ac.createAnalyser(); analyser.fftSize=2048;
    workletNode=new AudioWorkletNode(ac,'pitch-detector',{numberOfInputs:1,numberOfOutputs:0});
    workletNode.port.onmessage=onPitchMessage;
    mic.connect(analyser); mic.connect(workletNode);
    initBeepPool();
    audioReady=true;
    requestAnimationFrame(drawOsc);
  }catch(e){ pushError(e); notify('マイク初期化に失敗。エラー情報を確認してください。','error',5000); }
}

async function hardResume(){ try{ await resumeAudio(); }catch{} }

/* ===== セッション制御 ===== */
function startSession(){
  if(!audioReady){ notify('マイク初期化中です。画面を一度タップして有効化してください。','info',2500); hardResume(); return; }
  lockLandscape().finally(()=>updateRotateOverlay());
  sessionRunning=true; inScale=true; document.body.classList.add('running');
  btnStart.disabled=true; btnStop.disabled=false;
  passThreshold=+passSel.value;
  try{
    scaleData=buildMajorScale(currentKey);
    renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys, scaleData.noteObjs);
    idx=0; firstScores=Array(scaleData.vexKeys.length).fill(null);
    highlightIndex(renderCtx,0,1);
    startMetronome();
  }catch(e){ pushError(e); notify('五線譜の描画に失敗（エラー情報を確認）','error',4000); }
}
function stopSession(){
  sessionRunning=false; inScale=false; document.body.classList.remove('running');
  btnStart.disabled=false; btnStop.disabled=true;
  stopMetronome();
  bigScoreEl.textContent="--"; bigScoreEl.className=""; feedbackEl.textContent="停止中";
}

/* ===== UI ===== */
btnStart.addEventListener('click', ()=>{ hardResume(); startSession(); });
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
      highlightIndex(renderCtx,0,1);
    }catch(e){ pushError(e); }
  }
});

/* 任意のユーザー操作でAudioContextを必ず起動（iOS対策） */
['touchend','mousedown','keydown'].forEach(ev=>document.addEventListener(ev, resumeAudio, {passive:true}));

window.addEventListener('resize', ()=>{ updateRotateOverlay();
  try{
    if(scaleData){ renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys, scaleData.noteObjs); highlightIndex(renderCtx,Math.min(idx,scaleData.vexKeys.length-1),Math.min(idx+1,scaleData.vexKeys.length-1)); }
  }catch(e){ pushError(e); }
});

/* ===== 初期化 ===== */
(async function init(){
  updateRotateOverlay();
  try{ await ensureVexFlow(); }catch{}
  try{
    const currentKeyInit="G";
    const scaleDataInit=buildMajorScale(currentKeyInit);
    renderCtx=renderScale(scaleDataInit.keySignature, scaleDataInit.vexKeys, scaleDataInit.noteObjs);
    highlightIndex(renderCtx,0,1);
  }catch(e){ pushError(e); }
  await startEngine();           // 波形は常時
  requestWakeLock();             // スリープ防止
})();
