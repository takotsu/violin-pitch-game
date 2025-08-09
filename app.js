import { ALL_KEYS, buildMajorScale, letterFreq } from "./scales.js";
import { renderScale, renderTunerStaff, highlightIndex } from "./score.js";

/* ========== グローバル・エラーログ（一覧ポップアップ） ========== */
const errorLog = [];
function pushError(e){
  const msg = (e?.message||e)?.toString();
  const stack = e?.error?.stack || e?.stack || "";
  const entry = `${new Date().toLocaleString()} : ${msg}\n${stack}`;
  errorLog.push(entry);
  renderErrorModal();
}
window.addEventListener('error',(ev)=>{ pushError(ev); notify('エラーが発生しました（詳細を見るをタップ）','error',4000); showErrorModal(); });
window.addEventListener('unhandledrejection',(ev)=>{ pushError(ev.reason||ev); notify('エラーが発生しました（詳細を見るをタップ）','error',4000); showErrorModal(); });

function renderErrorModal(){
  const list=document.getElementById('error-list'); if(!list) return;
  list.innerHTML=""; errorLog.slice(-20).forEach((t,i)=>{ const li=document.createElement('li'); li.textContent=t; list.appendChild(li); });
}
function showErrorModal(){ const m=document.getElementById('error-modal'); m.classList.add('show'); m.setAttribute('aria-hidden','false'); }
function hideErrorModal(){ const m=document.getElementById('error-modal'); m.classList.remove('show'); m.setAttribute('aria-hidden','true'); }
document.getElementById('err-close').onclick=hideErrorModal;
document.getElementById('err-copy').onclick=async()=>{ await navigator.clipboard.writeText(errorLog.join('\n\n')); notify('エラー内容をコピーしました。','info',2000); };

/* ========== トースト/通知 ========== */
let toastTimer;
function notify(msg, level='warn', ms=2500, tiny=false){
  const el=document.getElementById('toast');
  el.className=`${level} ${tiny?'tiny':''} show`; el.textContent=msg;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.className=el.className.replace('show',''), ms);
}

/* ========== Wake Lock（ページ表示中はスリープさせない） ========== */
let wakeLock=null;
async function requestWakeLock(){
  try{
    if('wakeLock' in navigator){ wakeLock=await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release',()=>{}); }
  }catch(e){ /* 非対応は無視 */ }
}
document.addEventListener('visibilitychange', async()=>{ if(!document.hidden) requestWakeLock(); });

/* ========== A=442 util / スコア ========== */
const A4_REF_HZ=442;
function centsDiff(f_est,f_tgt){ return 1200*Math.log2(f_est/f_tgt); }
function scoreFromCents(absC){ const c=Math.min(200,Math.max(0,absC)); return Math.round(100*(1-c/200)); }

/* ========== チューナー最寄り音名 ========== */
const NOTE_ORDER=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function nearestNoteName(freq){
  if(!freq) return "A4";
  const n = Math.round(12*Math.log2(freq/A4_REF_HZ))+ 9 + 4*12;
  const octave = Math.floor(n/12)-4; const idx=((n%12)+12)%12;
  return `${NOTE_ORDER[idx]}${4+octave}`;
}

/* ========== 励まし（0.7sスロットリング） ========== */
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

/* ========== UI refs ========== */
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

/* ========== 五線譜/状態 ========== */
let renderCtx=null;
let currentKey="G";

/* ========== 表示ユーティリティ ========== */
function colorScore(s){ bigScoreEl.className=""; if(s>=90) bigScoreEl.classList.add('green'); else if(s>=70) bigScoreEl.classList.add('yellow'); else bigScoreEl.classList.add('red');}
function updateNeedle(c){ const clamped=Math.max(-50,Math.min(50,c)); const pct=(clamped+50)/100; needleEl.style.left=`calc(${pct*100}% - 1px)`; }

/* ========== Audio（マイクは常時） ========== */
let ac, workletNode, mic, analyser, mediaStream=null;
let lowLevelSince=0, lastPitchWarn=0;
let audioReady=false;

// 常時の波形・検出はON。練習セッションだけ別管理。
let sessionRunning=false; // 「開始/停止」ボタンの対象

// しきい値：このRMS未満は採点・前進しない
const LEVEL_RMS_THRESHOLD = 0.02;

/* ========== スケール進行（閾値で前進・初回スコア固定） ========== */
let tunerOn=false, inScale=false;
let scaleData=null; // {keySignature,vexKeys,noteObjs}
let idx=0, firstScores=[], passThreshold=90;

/* ========== メトロノーム：要素オーディオ（大音量） ========== */
let metroTimer=null, metroOn=false;
let strongPool=[], weakPool=[], poolIdxS=0, poolIdxW=0;

function makeBeepUrl(freq=1500, durMs=70, sr=44100){
  const len=Math.floor(sr*durMs/1000), wavLen=44+len*2;
  const buf=new ArrayBuffer(wavLen); const dv=new DataView(buf);
  const wrStr=(o,s)=>{ for(let i=0;i<s.length;i++) dv.setUint8(o+i,s.charCodeAt(i)); };
  wrStr(0,"RIFF"); dv.setUint32(4,wavLen-8,true); wrStr(8,"WAVE"); wrStr(12,"fmt "); dv.setUint32(16,16,true);
  dv.setUint16(20,1,true); dv.setUint16(22,1,true); dv.setUint32(24,sr,true); dv.setUint32(28,sr*2,true);
  dv.setUint16(32,2,true); dv.setUint16(34,16,true); wrStr(36,"data"); dv.setUint32(40,len*2,true);
  let off=44; for(let i=0;i<len;i++){ const t=i/sr; const env=Math.exp(-8*i/len); const s=Math.sign(Math.sin(2*Math.PI*freq*t))*0.9*env; dv.setInt16(off, s*32767, true); off+=2; }
  return URL.createObjectURL(new Blob([buf], {type:"audio/wav"}));
}
function initBeepPool(){
  const urlS=makeBeepUrl(2400,80); const urlW=makeBeepUrl(1700,70);
  strongPool=Array.from({length:6},()=>{const a=new Audio(urlS); a.preload="auto"; a.playsInline=true; a.volume=1.0; return a;});
  weakPool  =Array.from({length:6},()=>{const a=new Audio(urlW); a.preload="auto"; a.playsInline=true; a.volume=1.0; return a;});
}
function playBeep(strong=false){ const pool=strong?strongPool:weakPool; const a=pool[strong?(poolIdxS++%pool.length):(poolIdxW++%pool.length)]; a.currentTime=0; a.play().catch(()=>{}); }
function startMetronome(){
  if(metroTimer) clearInterval(metroTimer);
  if(!metroOn || !sessionRunning) return;
  const bpm=+bpmInput.value, beatMs=60_000/bpm; let beat=0;
  metroTimer=setInterval(()=>{ playBeep(beat%4===0); metroLed.style.background="#22c55e"; setTimeout(()=>metroLed.style.background="#334155",120); beat++; }, beatMs);
}
function stopMetronome(){ if(metroTimer) clearInterval(metroTimer); metroTimer=null; }

/* ========== 波形（20秒スクロール：常時） ========== */
let lastOscT=0;
function drawOsc(ts){
  if(!analyser){ requestAnimationFrame(drawOsc); return; }
  const ctx=oscCanvas.getContext('2d');
  const w=oscCanvas.width=oscCanvas.clientWidth;
  const h=oscCanvas.height=oscCanvas.clientHeight;

  const pxPerSec=w/20;
  const dt=lastOscT? (ts-lastOscT)/1000:0; lastOscT=ts;

  const shift=Math.max(1,Math.floor(pxPerSec*dt));
  const img=ctx.getImageData(shift,0,w-shift,h);
  ctx.putImageData(img,0,0);
  ctx.fillStyle="#0f131a"; ctx.fillRect(w-shift,0,shift,h);

  const data=new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(data);
  ctx.strokeStyle="#90cdf4"; ctx.lineWidth=1; ctx.beginPath();
  for(let y=0;y<h;y++){
    const i=Math.floor(y/h*data.length);
    const v=(data[i]-128)/128;
    const x=w-1; const yy=h/2 - v*(h*0.45);
    if(y===0) ctx.moveTo(x,yy); else ctx.lineTo(x,yy);
  }
  ctx.stroke();
  requestAnimationFrame(drawOsc);
}

/* ========== 解析結果受取（常時） ========== */
function onPitchMessage(ev){
  const {f0, conf, rms, dropped, now} = ev.data || {};
  const tNow = now || performance.now();

  // 低レベル警告
  if(rms < LEVEL_RMS_THRESHOLD){
    if(!lowLevelSince) lowLevelSince=tNow;
    if(tNow - lowLevelSince > 1500){ notify('入力が小さいです。マイクを近づけてください。','warn',1800,true); lowLevelSince=tNow; }
  }else lowLevelSince=0;

  if(dropped) notify('処理が追いついていません。他アプリを閉じてください。','warn',3000);

  // チューナー：既製品のように常に最寄り音へスナップ
  if(tunerOn){
    if(!f0){ updateNeedle(0); feedbackEl.textContent="チューナー待機中…"; return; }
    const nn=nearestNoteName(f0);
    // ターゲット周波数
    const m=nn.match(/^([A-G])(#?)(\d)$/); const map={C:0,"C#":1,D:2,"D#":3,E:4,F:5,"F#":6,G:7,"G#":8,A:9,"A#":10,B:11};
    const semi=(map[m[1]+(m[2]||"")]-9)+ (parseInt(m[3],10)-4)*12; const fTarget=A4_REF_HZ*Math.pow(2,semi/12);
    const cents=centsDiff(f0,fTarget); const sc=scoreFromCents(Math.abs(cents));
    bigScoreEl.textContent=String(sc); colorScore(sc);
    feedbackEl.textContent=`チューナー: ${nn}` + encourage(sc);
    updateNeedle(cents);
    drawKaraoke(cents);
    return;
  }

  // セッション外：針と波形だけ動かす
  if(!sessionRunning){
    if(!f0){ updateNeedle(0); return; }
    // 選択中スケールの現在音に合わせた針（視覚用）
    if(scaleData){
      const n=scaleData.noteObjs[Math.min(idx, scaleData.noteObjs.length-1)];
      const fTarget=letterFreq(n.letter,n.octave,scaleData.keySignature,A4_REF_HZ);
      const cents=centsDiff(f0,fTarget);
      updateNeedle(cents); drawKaraoke(cents);
    }
    return;
  }

  // ---- ここから練習セッション（スケール） ----
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
  feedbackEl.textContent=`音 ${idx+1}/${scaleData.noteObjs.length}` + encourage(sc);
  updateNeedle(cents); drawKaraoke(cents);

  if(firstScores[idx]==null){ firstScores[idx]=sc; }
  if(sc >= passThreshold){
    idx++;
    if(idx >= scaleData.noteObjs.length){ finishScale(); return; }
    highlightIndex(renderCtx, idx, Math.min(idx+1, scaleData.noteObjs.length-1));
  }
}

/* ========== 結果 ========== */
function finishScale(){
  stopMetronome();
  const valid=firstScores.filter(x=>typeof x==='number');
  const avg=valid.length? Math.round(valid.reduce((s,x)=>s+x,0)/valid.length):0;
  showResult(avg);
  stopSession();
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

/* ========== エンジン起動（マイクは常時） ========== */
async function startEngine(){
  if(audioReady) return;
  try{
    await requestWakeLock();
    ac=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
    await ac.audioWorklet.addModule('./pitch-worklet.js');
    mediaStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}});
    mic=ac.createMediaStreamSource(mediaStream);
    analyser=ac.createAnalyser(); analyser.fftSize=2048;
    workletNode=new AudioWorkletNode(ac,'pitch-detector',{numberOfInputs:1,numberOfOutputs:0});
    workletNode.port.onmessage=onPitchMessage;
    mic.connect(analyser); mic.connect(workletNode);
    initBeepPool();
    audioReady=true;
    requestAnimationFrame(drawOsc);
    notify('マイク準備が完了しました。','info',1500,true);
  }catch(e){ pushError(e); notify('マイクの初期化に失敗しました。上の「エラー情報」を確認してください。','error',5000); }
}

/* ========== セッション制御（開始/停止） ========== */
function startSession(){
  if(!audioReady){ notify('マイクを初期化中です。しばらくお待ちください。','info',2000); return; }
  if(tunerOn){ notify('チューナーON中は練習を開始できません。チューナーをOFFにしてください。','warn',3000); return; }
  sessionRunning=true; btnStart.disabled=true; btnStop.disabled=false;
  passThreshold=+passSel.value;
  inScale=true;
  scaleData=buildMajorScale(currentKey);
  renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys);
  idx=0; firstScores=Array(scaleData.vexKeys.length).fill(null);
  highlightIndex(renderCtx,0,1);
  startMetronome();
}
function stopSession(){
  sessionRunning=false; btnStart.disabled=false; btnStop.disabled=true;
  stopMetronome();
  bigScoreEl.textContent="--"; bigScoreEl.className=""; feedbackEl.textContent="停止中";
}

/* ========== UIイベント ========== */
btnStart.addEventListener('click', startSession);
btnStop.addEventListener('click', stopSession);
passSel.addEventListener('change', ()=>{ passThreshold=+passSel.value; notify(`合格閾値: ${passThreshold} 点`,'info',1200,true); });

bpmInput.addEventListener('change', ()=>{
  const v=Math.max(40,Math.min(200, Math.round((+bpmInput.value)/5)*5));
  bpmInput.value=String(v); startMetronome();
});
metroToggle.addEventListener('change', ()=>{ metroOn=metroToggle.checked; startMetronome(); });

tunerBtn.addEventListener('click', ()=>{
  tunerOn=!tunerOn;
  tunerBtn.textContent=tunerOn? "チューナー停止":"チューナー";
  keySelect.disabled=tunerOn;
  // 五線譜はチューナーでも表示（簡易譜）
  if(tunerOn){ renderTunerStaff(); stopSession(); }
  else { scaleData=buildMajorScale(currentKey); renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys); highlightIndex(renderCtx,0,1); }
});

(function ensureKeyOptions(){
  // JSでも必ず埋める（静的と二重だが安全）
  const had = new Set(Array.from(keySelect.options).map(o=>o.value));
  ALL_KEYS.forEach(k=>{ if(!had.has(k)){ const o=document.createElement('option'); o.value=k; o.textContent=k; keySelect.appendChild(o); }});
  keySelect.value="G";
})();

keySelect.addEventListener('change', ()=>{
  currentKey=keySelect.value;
  if(!sessionRunning && !tunerOn){
    scaleData=buildMajorScale(currentKey);
    renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys);
    highlightIndex(renderCtx,0,1);
  }
});

window.addEventListener('resize', ()=>{
  if(tunerOn) renderTunerStaff();
  else if(scaleData){ renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys); highlightIndex(renderCtx,Math.min(idx,scaleData.vexKeys.length-1),Math.min(idx+1,scaleData.vexKeys.length-1)); }
});

/* ========== 初期描画：常時エンジンON、五線譜は即描画 ========== */
(async function init(){
  try{
    if(!(window.Vex && window.Vex.Flow)) throw new Error("VexFlow が読み込めていません。ネットワークを確認してください。");
    scaleData=buildMajorScale(currentKey);
    renderCtx=renderScale(scaleData.keySignature, scaleData.vexKeys);
    highlightIndex(renderCtx,0,1);
  }catch(e){ pushError(e); }
  await startEngine(); // 常時マイク・波形
})();
