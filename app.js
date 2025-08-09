import { ALL_KEYS, buildMajorScale, letterFreq } from "./scales.js";
import { renderScale, renderTunerStaff, highlightIndex } from "./score.js";

/* ========== 安全に VexFlow を待つ（必須） ========== */
async function waitForVex(maxMs=8000){
  const start = performance.now();
  while(!(window.Vex && window.Vex.Flow)){
    await new Promise(r=>setTimeout(r,50));
    if(performance.now()-start>maxMs) break;
  }
  if(!(window.Vex && window.Vex.Flow)){
    notify("五線譜ライブラリの読み込みに失敗しました。通信環境を確認し再読み込みしてください。","error",6000);
    throw new Error("VexFlowNotLoaded");
  }
}

/* ========= トースト ========= */
let toastTimer;
function notify(msg, level='warn', ms=2500, tiny=false){
  const el=document.getElementById('toast');
  el.className=`${level} ${tiny?'tiny':''} show`; el.textContent=msg;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.className=el.className.replace('show',''), ms);
}

/* ========= Wake Lock（スリープ防止） ========= */
let wakeLock = null;
async function requestWakeLock(){
  try{
    if('wakeLock' in navigator){
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', ()=>{ /* 再取得はvisibilitychangeで */ });
    }
  }catch(e){ /* 非対応は無視 */ }
}
document.addEventListener('visibilitychange', async ()=>{
  if(!document.hidden && wakeLock) requestWakeLock();
});

/* ========= A=442 util / スコア ========= */
const A4_REF_HZ=442;
function centsDiff(f_est,f_tgt){ return 1200*Math.log2(f_est/f_tgt); }
function scoreFromCents(absC){ const c=Math.min(200,Math.max(0,absC)); return Math.round(100*(1-c/200)); }

/* ========= 近傍音（チューナー） ========= */
const NOTE_ORDER=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function nearestNoteName(freq){
  if(!freq) return "A4";
  const n = Math.round(12*Math.log2(freq/A4_REF_HZ))+ 9 + 4*12;
  const octave = Math.floor(n/12)-4; const idx=((n%12)+12)%12;
  return `${NOTE_ORDER[idx]}${4+octave}`;
}

/* ========= 励まし（0.7sスロットリング） ========= */
const COACH = ["大丈夫！ここから整えていきましょう！","いい姿勢！次の1音もいきましょう！","今の修正ナイス！もう一回！",
"肩の力を抜いて、指をスッと置いて！","焦らず弓をゆっくり。できます！","耳、よく聴けてます！自信を持って！",
"フォーム安定！その調子！","深呼吸、もう一回だけ！","良い挑戦！ここから伸びます！","音の芯に近づいてます！もう一押し！"];
const SHORT_PRAISE = ["いい音！","キレてます！","冴えてます！","安定！","素晴らしい！","美しい！","完璧！","ナイス！"];
let lastEncourage=0;
function encourage(score){
  const now=performance.now(); if(now-lastEncourage<700) return "";
  lastEncourage=now; return " " + (score>=70? SHORT_PRAISE[Math.floor(Math.random()*SHORT_PRAISE.length)]
                                             : COACH[Math.floor(Math.random()*COACH.length)]);
}

/* ========= UI refs ========= */
const bigScoreEl=document.getElementById('big-score');
const feedbackEl=document.getElementById('feedback');
const needleEl=document.getElementById('needle');
const passSel=document.getElementById('pass');
const btnStart=document.getElementById('start');
const btnStop=document.getElementById('stop');
const bpmInput=document.getElementById('bpm');
const metroLed=document.getElementById('metro-led');
const metroToggle=document.getElementById('metroToggle');
const tunerBtn=document.getElementById('tunerBtn');
const keySelect=document.getElementById('key-select');
const karaokeCanvas=document.getElementById('karaoke');
const oscCanvas=document.getElementById('osc');

/* ========= 五線譜管理 ========= */
let renderCtx=null;      // {renderer,stave,notes}
let currentKey="G";

/* ========= 表示ユーティリティ ========= */
function colorScore(s){ bigScoreEl.className=""; if(s>=90) bigScoreEl.classList.add('green'); else if(s>=70) bigScoreEl.classList.add('yellow'); else bigScoreEl.classList.add('red');}
function updateNeedle(c){ const clamped=Math.max(-50,Math.min(50,c)); const pct=(clamped+50)/100; needleEl.style.left=`calc(${pct*100}% - 1px)`; }

/* ========= オーディオ ========= */
let ac, workletNode, mic, analyser, running=false, mediaStream=null;
let lowLevelSince=0, lastPitchWarn=0;

// 「音量しきい値」：このRMSを超えるまで採点しない
const LEVEL_RMS_THRESHOLD = 0.02;

/* ========= スケール進行（閾値で前進・初回スコア固定） ========= */
let tunerOn=false, inScale=false;
let scaleData=null;          // {keySignature, vexKeys, noteObjs}
let idx=0, firstScores=[], passThreshold=90;

/* ========= メトロノーム：要素オーディオ（iPhoneで大音量） ========= */
let metroTimer=null, metroOn=false;
let strongPool=[], weakPool=[], poolIdxS=0, poolIdxW=0;

function makeBeepUrl(freq=1500, durMs=60, sr=44100){
  const len=Math.floor(sr*durMs/1000), wavLen=44+len*2;
  const buf=new ArrayBuffer(wavLen); const dv=new DataView(buf);
  // WAV header
  const wrStr=(o,s)=>{ for(let i=0;i<s.length;i++) dv.setUint8(o+i,s.charCodeAt(i)); };
  wrStr(0,"RIFF"); dv.setUint32(4,wavLen-8,true); wrStr(8,"WAVE"); wrStr(12,"fmt "); dv.setUint32(16,16,true);
  dv.setUint16(20,1,true); dv.setUint16(22,1,true); dv.setUint32(24,sr,true); dv.setUint32(28,sr*2,true);
  dv.setUint16(32,2,true); dv.setUint16(34,16,true); wrStr(36,"data"); dv.setUint32(40,len*2,true);
  // Sine + 短いエンベロープ
  let off=44;
  for(let i=0;i<len;i++){
    const t=i/sr; const env=Math.exp(-8*i/len);
    const sample = Math.max(-1,Math.min(1, Math.sin(2*Math.PI*freq*t)*0.98*env));
    dv.setInt16(off, sample*32767, true); off+=2;
  }
  return URL.createObjectURL(new Blob([buf], {type:"audio/wav"}));
}
function initBeepPool(){
  const urlS = makeBeepUrl(2200,70);
  const urlW = makeBeepUrl(1500,60);
  strongPool = Array.from({length:6}, ()=>{ const a=new Audio(urlS); a.preload="auto"; a.playsInline=true; a.volume=1.0; return a; });
  weakPool   = Array.from({length:6}, ()=>{ const a=new Audio(urlW); a.preload="auto"; a.playsInline=true; a.volume=1.0; return a; });
}
function playBeep(strong=false){
  const pool = strong? strongPool : weakPool;
  const a = pool[strong? (poolIdxS++%pool.length) : (poolIdxW++%pool.length)];
  a.currentTime=0; a.play().catch(()=>{ /* ユーザ操作前などは無視 */ });
}
function startMetronome(){
  if(metroTimer) clearInterval(metroTimer);
  if(!metroOn) return;
  const bpm=+bpmInput.value, beatMs=60_000/bpm;
  let beat=0;
  metroTimer=setInterval(()=>{
    playBeep(beat%4===0);
    metroLed.style.background="#22c55e"; setTimeout(()=>metroLed.style.background="#334155",120);
    beat++;
  }, beatMs);
}
function stopMetronome(){ if(metroTimer) clearInterval(metroTimer); metroTimer=null; }

/* ========= 波形（20秒スクロール） ========= */
let lastOscT=0;
function drawOsc(ts){
  if(!analyser) return;
  const ctx=oscCanvas.getContext('2d');
  const w=oscCanvas.width=oscCanvas.clientWidth;
  const h=oscCanvas.height=oscCanvas.clientHeight;

  const pxPerSec = w/20;
  const dt = lastOscT ? (ts-lastOscT)/1000 : 0; lastOscT = ts;

  const shift = Math.max(1, Math.floor(pxPerSec*dt));
  const img = ctx.getImageData(shift,0, w-shift, h);
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle="#0f131a"; ctx.fillRect(w-shift,0,shift,h);

  const data=new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(data);
  ctx.strokeStyle="#90cdf4"; ctx.lineWidth=1; ctx.beginPath();
  for(let y=0;y<h;y++){
    const idx=Math.floor(y/h * data.length);
    const v=(data[idx]-128)/128; 
    const x = w-1;
    const yPix = h/2 - v*(h*0.45);
    if(y===0) ctx.moveTo(x,yPix); else ctx.lineTo(x,yPix);
  }
  ctx.stroke();
  requestAnimationFrame(drawOsc);
}

/* ========= カラオケ描画 ========= */
const karaokePts=[];
function drawKaraoke(centsOrNull){
  const ctx=karaokeCanvas.getContext('2d'); const w=karaokeCanvas.width, h=karaokeCanvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle="rgba(200,200,200,0.4)"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,h*0.5); ctx.lineTo(w,h*0.5); ctx.stroke();

  if(inScale && scaleData){
    const stepW=w/scaleData.vexKeys.length;
    ctx.fillStyle="rgba(45,212,191,0.15)";
    ctx.fillRect(0,0, stepW*(idx+1), h);
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

/* ========= 解析結果受取 ========= */
function onPitchMessage(ev){
  const {f0, conf, rms, dropped, now} = ev.data || {};
  const tNow = now || performance.now();

  if(rms < LEVEL_RMS_THRESHOLD){
    if(!lowLevelSince) lowLevelSince=tNow;
    if(tNow - lowLevelSince > 1500){ notify('入力が小さいです。マイクを近づけてください。','warn',1800,true); lowLevelSince=tNow; }
  }else lowLevelSince=0;

  if(dropped) notify('処理が追いついていません。他アプリを閉じてください。','warn',3000);

  // --- チューナー ---
  if(tunerOn){
    if(!f0){ drawKaraoke(null); return; }
    const nn = nearestNoteName(f0);
    const target = (()=>{
      // 最近傍名から周波数（A=442）
      const m=nn.match(/^([A-G])(#?)(\d)$/); const L=m[1],acc=m[2],oct=+m[3];
      const map={C:0,"C#":1,D:2,"D#":3,E:4,F:5,"F#":6,G:7,"G#":8,A:9,"A#":10,B:11};
      const semi=(map[L+(acc||"")]-9)+ (oct-4)*12; return A4_REF_HZ*Math.pow(2,semi/12);
    })();
    const cents = centsDiff(f0,target);
    const sc = scoreFromCents(Math.abs(cents));
    bigScoreEl.textContent=String(sc); colorScore(sc);
    feedbackEl.textContent = `チューナー: ${nn}` + encourage(sc);
    updateNeedle(cents); drawKaraoke(cents);
    return;
  }

  // --- スケール ---
  if(!inScale || !scaleData){ drawKaraoke(null); return; }

  // 検出が弱すぎる場合は採点・前進しない
  if(!f0 || conf<0.5 || rms<LEVEL_RMS_THRESHOLD){
    drawKaraoke(null);
    if(tNow - lastPitchWarn > 2000){ feedbackEl.textContent='検出が不安定です。一定の弓圧で弾いてください。'; lastPitchWarn=tNow; }
    return;
  }

  const noteObj = scaleData.noteObjs[idx];
  const fTarget = letterFreq(noteObj.letter, noteObj.octave, scaleData.keySignature, A4_REF_HZ);
  const cents = centsDiff(f0, fTarget);
  const sc = scoreFromCents(Math.abs(cents));
  bigScoreEl.textContent=String(sc); colorScore(sc);
  feedbackEl.textContent = `音 ${idx+1}/${scaleData.noteObjs.length}` + encourage(sc);
  updateNeedle(cents); drawKaraoke(cents);

  // 最初に有効検出したスコアだけ採用
  if(firstScores[idx]==null){ firstScores[idx]=sc; }
  // 閾値を満たしたら次へ
  if(sc >= passThreshold){
    idx++;
    if(idx >= scaleData.noteObjs.length){ finishScale(); return; }
    highlightIndex(renderCtx, idx, Math.min(idx+1, scaleData.noteObjs.length-1));
  }
}

/* ========= 採点・結果 ========= */
function finishScale(){
  stopMetronome();
  const valid = firstScores.filter(x=>typeof x==='number');
  const avg = valid.length ? Math.round(valid.reduce((s,x)=>s+x,0)/valid.length) : 0;
  showResult(avg);
  stop(); // マイクOFF
}
function showResult(final){
  const resultEl=document.getElementById('result');
  const finalScoreEl=document.getElementById('final-score');
  const praiseEl=document.getElementById('praise');
  const detailsEl=document.getElementById('details');

  const PRAISES=["すごい！モーツァルトかと思いました！","今日の主役です！","響きが美しいです！","音程が澄み切っています！",
                 "ピッチコントロールが神！","音の立ち上がりがキレッキレ！","耳が良すぎます！","音の重心が安定しています！"];
  praiseEl.textContent = PRAISES[Math.floor(Math.random()*PRAISES.length)];
  detailsEl.textContent = `各音は「最初に検出したスコア」だけを平均化。最終: ${final} 点`;

  let v=0; const start=performance.now(); const dur=900;
  function tick(t){ const r=Math.min(1,(t-start)/dur); v=Math.floor(final*r*r + 0.5); finalScoreEl.textContent=String(v); if(r<1) requestAnimationFrame(tick); }
  requestAnimationFrame(tick);

  resultEl.classList.add('show'); resultEl.setAttribute('aria-hidden','false');
  document.getElementById('again').onclick=()=>{ resultEl.classList.remove('show'); resultEl.setAttribute('aria-hidden','true'); start(); };
  document.getElementById('close').onclick=()=>{ resultEl.classList.remove('show'); resultEl.setAttribute('aria-hidden','true'); };
}

/* ========= 開始・停止 ========= */
function handleGetUserMediaError(err){
  const name=err?.name||''; if(name==='NotAllowedError'||name==='SecurityError') notify('マイク権限が拒否されています。設定→サイト→マイク許可。','error',5000);
  else if(name==='NotFoundError') notify('マイクが見つかりません。接続を確認してください。','error',5000);
  else if(name==='NotReadableError') notify('他アプリがマイク使用中。終了して再試行。','error',5000);
  else notify(`マイク起動エラー: ${name||err}`,'error',5000);
}

async function start(){
  if(running) return;
  try{
    await waitForVex();           // ← 必ずVexFlow準備完了を待つ
    await requestWakeLock();      // ← スリープ防止
    ac=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
    await ac.audioWorklet.addModule('./pitch-worklet.js');

    mediaStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}});
    mic=ac.createMediaStreamSource(mediaStream);
    analyser=ac.createAnalyser(); analyser.fftSize=2048;
    workletNode=new AudioWorkletNode(ac,'pitch-detector',{numberOfInputs:1,numberOfOutputs:0});
    workletNode.port.onmessage=onPitchMessage;
    mic.connect(analyser); mic.connect(workletNode);

    initBeepPool(); // メトロノーム音（要素オーディオ）

    running=true; btnStart.disabled=true; btnStop.disabled=false;
    passThreshold = +passSel.value;

    if(tunerOn){
      renderCtx = renderTunerStaff();
      inScale=false;
    }else{
      inScale=true;
      scaleData = buildMajorScale(currentKey);
      renderCtx  = renderScale(scaleData.keySignature, scaleData.vexKeys);
      idx=0; firstScores = Array(scaleData.vexKeys.length).fill(null);
      highlightIndex(renderCtx, 0, 1);
    }

    startMetronome();
    requestAnimationFrame(drawOsc);
    notify('音声処理を開始しました。','info',1200);
  }catch(e){ if(e.message!=="VexFlowNotLoaded") handleGetUserMediaError(e); }
}

function stop(){
  try{ mic && mic.disconnect(); }catch{}
  try{ workletNode && workletNode.port.close(); }catch{}
  try{ analyser && (analyser=null); }catch{}
  try{ if(mediaStream){ mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; } }catch{}
  try{ ac && ac.close(); }catch{}
  stopMetronome();

  running=false; btnStart.disabled=false; btnStop.disabled=true;
  bigScoreEl.textContent="--"; bigScoreEl.className=""; feedbackEl.textContent="停止中"; updateNeedle(0);
  karaokeCanvas.getContext('2d')?.clearRect(0,0,karaokeCanvas.width,karaokeCanvas.height);
  inScale=false;
}

/* ========= イベント ========= */
btnStart.addEventListener('click', start);
btnStop.addEventListener('click', stop);

passSel.addEventListener('change', ()=>{ passThreshold=+passSel.value; notify(`合格閾値: ${passThreshold} 点`,'info',1200,true); });
bpmInput.addEventListener('change', ()=>{ const v=Math.max(40,Math.min(200, Math.round((+bpmInput.value)/5)*5)); bpmInput.value=String(v); if(running){ startMetronome(); }});
metroToggle.addEventListener('change', ()=>{ metroOn=metroToggle.checked; if(running){ startMetronome(); }});

tunerBtn.addEventListener('click', ()=>{
  tunerOn = !tunerOn;
  tunerBtn.textContent = tunerOn ? "チューナー停止" : "チューナー";
  keySelect.disabled = tunerOn;
  if(!running){
    if(tunerOn) renderTunerStaff(); else { scaleData=buildMajorScale(currentKey); renderScale(scaleData.keySignature, scaleData.vexKeys); }
  }
});

ALL_KEYS.forEach(k=>{
  const opt=document.createElement('option'); opt.value=k; opt.textContent=k; keySelect.appendChild(opt);
});
keySelect.value = currentKey;
keySelect.addEventListener('change', ()=>{
  currentKey = keySelect.value;
  if(!running && !tunerOn){
    scaleData = buildMajorScale(currentKey);
    renderCtx  = renderScale(scaleData.keySignature, scaleData.vexKeys);
    highlightIndex(renderCtx,0,1);
  }
});

window.addEventListener('resize', ()=>{
  if(!running){
    if(tunerOn) renderTunerStaff();
    else { scaleData=buildMajorScale(currentKey); renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys); highlightIndex(renderCtx,0,1); }
  }
});

/* ========= 初期描画 ========= */
(async function init(){
  try{
    await waitForVex();
    // 初期表示：スケール（G）
    scaleData=buildMajorScale(currentKey);
    renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys);
    highlightIndex(renderCtx,0,1);
  }catch{}
})();
