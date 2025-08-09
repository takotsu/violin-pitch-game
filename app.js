import { SCALES, getScaleById } from "./scales.js";
import { renderSingle, renderScale, highlightIndex } from "./score.js";

/***** トースト *****/
let toastTimer;
function notify(msg, level='warn', ms=2500, tiny=false){
  const el=document.getElementById('toast');
  el.className=`${level} ${tiny?'tiny':''} show`; el.textContent=msg;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.className=el.className.replace('show',''), ms);
}

/***** 前提チェック *****/
async function preflightChecks(){
  if(!isSecureContext) notify('このページはHTTPSで開いてください。マイクが使えません。','error',5000);
  if(!('mediaDevices' in navigator)) notify('この端末ではマイクAPIが利用できません。','error',5000);
  if(!window.Vex) notify('五線譜ライブラリの読込に失敗しました。再読み込みしてください。','error',5000);
  try{
    const st=await navigator.permissions?.query({name:'microphone'});
    if(st && st.state==='denied') notify('マイク権限が拒否されています。ブラウザ設定から許可してください。','error',6000);
  }catch{}
}

/***** 周波数ユーティリティ（A=442） *****/
const A4_REF_HZ=442;
function noteToFreq(n,a4=A4_REF_HZ){
  const SEMI={C:-9,"C#":-8,Db:-8,D:-7,"D#":-6,Eb:-6,E:-5,F:-4,"F#":-3,Gb:-3,G:-2,"G#":-1,Ab:-1,A:0,"A#":1,Bb:1,B:2};
  const m=n.match(/^([A-Ga-g])([#b]?)(\d)$/); if(!m) return a4;
  let L=m[1].toUpperCase(),acc=m[2]||"",oct=+m[3];
  const name=acc==="#"?`${L}#`:acc==="b"?({A:"G#",B:"A#",C:"B",D:"C#",E:"D#",F:"E",G:"F#"}[L]||L):L;
  const semi=SEMI[name]??0, nSemis=(oct-4)*12+semi;
  return a4*Math.pow(2,nSemis/12);
}
function centsDiff(f_est,f_tgt){ return 1200*Math.log2(f_est/f_tgt); }
/* 0〜100点。±200cで0点 */
function scoreFromCents(absC){ const c=Math.min(200,Math.max(0,absC)); return Math.round(100*(1-c/200)); }

/***** 励まし（検出時・0.7sスロットリング） *****/
const COACH = ["大丈夫！ここから整えていきましょう！","いい姿勢！次の1音もいきましょう！","今の修正ナイス！もう一回！",
"肩の力を抜いて、指をスッと置いて！","焦らず弓をゆっくり。できます！","耳、よく聴けてます！自信を持って！",
"フォーム安定！その調子！","深呼吸、もう一回だけ！","良い挑戦！ここから伸びます！","音の芯に近づいてます！もう一押し！"];
const SHORT_PRAISE = ["いい音！","キレてます！","冴えてます！","安定！","素晴らしい！","美しい！","完璧！","ナイス！"];
let lastEncourage=0;
function encourage(score){
  const now=performance.now();
  if(now-lastEncourage<700) return "";
  lastEncourage=now;
  return " " + (score>=70? SHORT_PRAISE[Math.floor(Math.random()*SHORT_PRAISE.length)]
                         : COACH[Math.floor(Math.random()*COACH.length)]);
}

/***** UI 参照 *****/
const bigScoreEl=document.getElementById('big-score');
const feedbackEl=document.getElementById('feedback');
const needleEl=document.getElementById('needle');
const noteSel=document.getElementById('note-select');
const modeSel=document.getElementById('mode');
const passSel=document.getElementById('pass');
const btnStart=document.getElementById('start');
const btnStop=document.getElementById('stop');
const btnRandom=document.getElementById('random');
const bpmInput=document.getElementById('bpm');
const metroLed=document.getElementById('metro-led');
const karaokeCanvas=document.getElementById('karaoke');
const oscCanvas=document.getElementById('osc');

/***** 五線譜管理 *****/
let renderCtx=null; // {renderer,stave,notes}
function drawSingle(){ renderCtx = renderSingle(noteSel.value); }
function drawScale(){ renderCtx = renderScale(getScaleById('g_scale_4bars')); }

/***** 表示ユーティリティ *****/
function colorScore(s){ bigScoreEl.className=""; if(s>=90) bigScoreEl.classList.add('green'); else if(s>=70) bigScoreEl.classList.add('yellow'); else bigScoreEl.classList.add('red');}
function updateNeedle(c){ const clamped=Math.max(-50,Math.min(50,c)); const pct=(clamped+50)/100; needleEl.style.left=`calc(${pct*100}% - 1px)`; }

/***** オーディオ（自動OFF含む） *****/
let ac, workletNode, mic, analyser, running=false, mediaStream=null;
let targetFreq = noteToFreq(noteSel.value);
let lowLevelSince=0, lastPitchWarn=0;

/***** スケール進行（新仕様） *****/
let inScale=false;
let scaleNotes=[];               // 例: 32音の音名
let idx=0;                       // 現在インデックス
let firstScores=[];              // 各音の「最初に検出したスコア」
let passThreshold=90;

/***** メトロノーム（任意。前進は閾値で行う） *****/
function makeClick(){ const dur=0.04, sr=ac.sampleRate, len=Math.floor(dur*sr);
  const buf=ac.createBuffer(1,len,sr), data=buf.getChannelData(0);
  for(let i=0;i<len;i++){ const env=Math.exp(-60*i/len); data[i]=(Math.random()*2-1)*0.45*env; } return buf; }
let clickBuf=null, metroTimer=null;
function playClick(){ if(!ac || ac.state!=='running' || !clickBuf) return;
  const src=ac.createBufferSource(), g=ac.createGain(); src.buffer=clickBuf; g.gain.value=0.7; src.connect(g).connect(ac.destination); src.start(); }
function startMetronome(){
  const bpm=+bpmInput.value, beatMs=60_000/bpm;
  if(metroTimer) clearInterval(metroTimer);
  metroTimer=setInterval(()=>{ playClick(); metroLed.style.background="#22c55e"; setTimeout(()=>metroLed.style.background="#334155",110); }, beatMs);
}
function stopMetronome(){ if(metroTimer) clearInterval(metroTimer); metroTimer=null; }

/***** 波形：20秒スクロール *****/
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

/***** 解析結果受取 *****/
function onPitchMessage(ev){
  const {f0, conf, rms, dropped, now} = ev.data || {};
  const tNow = now || performance.now();

  if(rms < 0.01){
    if(!lowLevelSince) lowLevelSince=tNow;
    if(tNow - lowLevelSince > 1500){ notify('入力が小さいです。マイクを近づけてください。','warn',1800,true); lowLevelSince=tNow; }
  }else lowLevelSince=0;

  if(dropped) notify('処理が追いついていません。他アプリを閉じてください。','warn',3000);

  if(!f0 || conf < 0.5){
    drawKaraoke(null); // 下で定義
    if(tNow - lastPitchWarn > 2000){ feedbackEl.textContent='検出が不安定です。一定の弓圧で弾いてください。'; lastPitchWarn=tNow; }
    return;
  }

  const fTarget = inScale ? noteToFreq(scaleNotes[idx]) : targetFreq;
  const cents = centsDiff(f0, fTarget);
  const sc = scoreFromCents(Math.abs(cents));

  // 大画面 UI
  bigScoreEl.textContent=String(sc); colorScore(sc);
  updateNeedle(cents);
  feedbackEl.textContent = pitchFeedback(cents) + encourage(sc);

  drawKaraoke(cents);

  // --- スケール処理 ---
  if(inScale){
    // その音で「最初に検出したスコア」を保存（1回だけ）
    if(firstScores[idx]==null){ firstScores[idx] = sc; }

    // 閾値に達したら次の音へ
    if(sc >= passThreshold){
      idx++;
      if(idx >= scaleNotes.length){
        finishScale(); // 採点とモーダル
        return;
      }
      highlightIndex(renderCtx, idx, Math.min(idx+1, scaleNotes.length-1));
    }
  }
}

function pitchFeedback(c){
  if(Math.abs(c)<=5) return "とても良いです。安定しています。";
  if(c>5&&c<=15)   return "やや高めです。ほんの少し下げてください。";
  if(c<-5&&c>=-15) return "やや低めです。ほんの少し上げてください。";
  if(Math.abs(c)<=30) return "ズレが大きいです。開放弦基準で合わせ直してください。";
  return "音程が外れています。ポジション／指置きを確認してください。";
}

/***** カラオケ（五線譜に重ね） *****/
const karaokePts=[];
function drawKaraoke(centsOrNull){
  const ctx=karaokeCanvas.getContext('2d'); const w=karaokeCanvas.width, h=karaokeCanvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle="rgba(200,200,200,0.4)"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,h*0.5); ctx.lineTo(w,h*0.5); ctx.stroke();

  if(inScale){
    const stepW=w/scaleNotes.length;
    ctx.fillStyle="rgba(45,212,191,0.15)";
    ctx.fillRect(0,0, stepW*(idx+1), h);
    for(let i=0;i<=scaleNotes.length;i++){
      const x=i*stepW;
      ctx.strokeStyle= (i%8===0) ? "rgba(120,160,170,0.45)" : "rgba(100,160,160,0.25)";
      if(i%2===0){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    }
  }

  if(centsOrNull!=null){
    const c=Math.max(-50,Math.min(50,centsOrNull));
    const y=h*0.5 - (c/50)*(h*0.4);
    const x= inScale ? (w/scaleNotes.length)*(idx + 0.5) : w*0.5;
    karaokePts.push({x,y}); if(karaokePts.length>160) karaokePts.shift();
    ctx.strokeStyle="rgba(45,212,191,0.95)"; ctx.lineWidth=2; ctx.beginPath();
    karaokePts.forEach((p,i)=>{ if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); }); ctx.stroke();
  }
}

/***** スケール完了 → 採点 *****/
function finishScale(){
  stopMetronome();
  const valid = firstScores.filter(x=>typeof x==='number');
  const avg = valid.length ? Math.round(valid.reduce((s,x)=>s+x,0)/valid.length) : 0;
  showResult(avg);
  stop(); // マイクOFF
}

/***** 結果モーダル（簡略） *****/
function showResult(final){
  const resultEl=document.getElementById('result');
  const finalScoreEl=document.getElementById('final-score');
  const praiseEl=document.getElementById('praise');
  const detailsEl=document.getElementById('details');

  finalScoreEl.textContent="0";
  const PRAISES=["すごい！モーツァルトかと思いました！","今日の主役です！","響きが美しいです！","音程が澄み切っています！",
  "ピッチコントロールが神！","音の立ち上がりがキレッキレ！","耳が良すぎます！","音の重心が安定しています！"];
  praiseEl.textContent = PRAISES[Math.floor(Math.random()*PRAISES.length)];
  detailsEl.textContent = `各音は「最初に検出したスコア」を採用。平均：${final} 点`;

  let v=0; const start=performance.now(); const dur=900;
  function tick(t){ const r=Math.min(1,(t-start)/dur); v=Math.floor(final*r*r + 0.5); finalScoreEl.textContent=String(v); if(r<1) requestAnimationFrame(tick); }
  requestAnimationFrame(tick);

  resultEl.classList.add('show'); resultEl.setAttribute('aria-hidden','false');
  document.getElementById('again').onclick=()=>{ resultEl.classList.remove('show'); resultEl.setAttribute('aria-hidden','true'); start(); };
  document.getElementById('close').onclick=()=>{ resultEl.classList.remove('show'); resultEl.setAttribute('aria-hidden','true'); };
}

/***** 開始・停止・可視状態制御（ページ前面のみマイクON） *****/
function handleGetUserMediaError(err){
  const name=err?.name||''; if(name==='NotAllowedError'||name==='SecurityError') notify('マイク権限が拒否されています。設定→サイト→マイク許可。','error',5000);
  else if(name==='NotFoundError') notify('マイクが見つかりません。接続を確認してください。','error',5000);
  else if(name==='NotReadableError') notify('他アプリがマイク使用中。終了して再試行。','error',5000);
  else notify(`マイク起動エラー: ${name||err}`,'error',5000);
}

async function start(){
  if(running) return;
  try{
    ac=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
    await ac.audioWorklet.addModule('./pitch-worklet.js');
    clickBuf = makeClick();

    mediaStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}});
    mic=ac.createMediaStreamSource(mediaStream);
    analyser=ac.createAnalyser(); analyser.fftSize=2048;
    workletNode=new AudioWorkletNode(ac,'pitch-detector',{numberOfInputs:1,numberOfOutputs:0});
    workletNode.port.onmessage=onPitchMessage;
    mic.connect(analyser); mic.connect(workletNode);

    running=true; btnStart.disabled=true; btnStop.disabled=false;

    passThreshold = +passSel.value;

    if(modeSel.value==='g_scale_4bars'){
      inScale=true;
      const sc = getScaleById('g_scale_4bars');
      scaleNotes = sc.notes.slice();
      drawScale();
      highlightIndex(renderCtx, 0, 1);
      idx=0; firstScores = Array(scaleNotes.length).fill(null);
    }else{
      inScale=false;
      targetFreq = noteToFreq(noteSel.value);
      drawSingle();
    }

    startMetronome();
    notify('音声処理を開始しました。','info',1200);
    requestAnimationFrame(drawOsc);
  }catch(e){ handleGetUserMediaError(e); }
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

function forceStopForBackground(reason){
  if(running || mediaStream){
    stop();
    notify(reason || 'バックグラウンドに移動したためマイクを停止しました。','info',2500);
  }
}

/***** イベント *****/
function randomPick(){ const TEST=['B4','C5','D5','E5','F5']; return TEST[Math.floor(Math.random()*TEST.length)]; }
btnStart.addEventListener('click', start);
btnStop.addEventListener('click', stop);
btnRandom.addEventListener('click', ()=>{ noteSel.value=randomPick(); });
modeSel.addEventListener('change', ()=>{ if(!running){ modeSel.value==='g_scale_4bars'?drawScale():drawSingle(noteSel.value);} });
passSel.addEventListener('change', ()=>{ passThreshold=+passSel.value; notify(`合格閾値を ${passThreshold} 点に設定しました。`,'info',1200,true); });
bpmInput.addEventListener('change', ()=>{ const v=Math.max(40,Math.min(200, Math.round((+bpmInput.value)/5)*5)); bpmInput.value=String(v); if(running){ startMetronome(); }});
window.addEventListener('resize', ()=>{ if(!running){ modeSel.value==='g_scale_4bars'?drawScale():drawSingle(noteSel.value);} });

// ページ前面のみマイクON
document.addEventListener('visibilitychange', ()=>{ if(document.hidden){ forceStopForBackground('タブが非表示になったためマイクを停止しました。'); }});
window.addEventListener('pagehide', ()=> forceStopForBackground());
window.addEventListener('beforeunload', ()=> forceStopForBackground());

/***** 起動 *****/
await preflightChecks();
drawScale(); // 既定表示
