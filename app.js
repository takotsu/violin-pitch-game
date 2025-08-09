/***** トースト通知（小さめ版あり） *****/
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
  const isiOS=/iPhone|iPad|iPod/.test(navigator.userAgent);
  if(isiOS) notify('iPhoneは「消音スイッチOFF」「音量UP」でご利用ください。','info',4000);
  try{
    const st=await navigator.permissions?.query({name:'microphone'});
    if(st && st.state==='denied') notify('マイク権限が拒否されています。ブラウザ設定から許可してください。','error',6000);
  }catch{}
}

/***** 音名・周波数（A4=442Hz） *****/
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

/***** 採点 *****/
function scoreFromCents(absC){ if(absC<=5) return 100; if(absC<=10) return Math.round(100-3*(absC-5));
  if(absC<=25) return Math.round(85-2.33*(absC-10)); if(absC<=50) return Math.round(50-2*(absC-25)); return 0; }
function feedbackText(c){ if(Math.abs(c)<=5) return "とても良いです。安定しています。";
  if(c>5&&c<=15) return "やや高めです。ほんの少し下げてください。";
  if(c<-5&&c>=-15) return "やや低めです。ほんの少し上げてください。";
  if(Math.abs(c)<=30) return "ズレが大きいです。開放弦基準で合わせ直してください。";
  return "音程が外れています。ポジション／指置きを確認してください。"; }

/***** UI 参照 *****/
const bigScoreEl=document.getElementById('big-score');
const feedbackEl=document.getElementById('feedback');
const needleEl=document.getElementById('needle');
const noteSel=document.getElementById('note-select');
const modeSel=document.getElementById('mode');
const btnStart=document.getElementById('start');
const btnStop=document.getElementById('stop');
const btnRandom=document.getElementById('random');
const bpmInput=document.getElementById('bpm');
const metroLed=document.getElementById('metro-led');
const staffDiv=document.getElementById('staff');
const karaokeCanvas=document.getElementById('karaoke');
const oscCanvas=document.getElementById('osc');

/***** 譜面：単音表示／Gメジャースケール（2小節/8分・上下） *****/
let vfCtx=null, targetTimeline=[];
function renderSingle(noteName="A4"){
  targetTimeline=[{note:noteName,dur:1}]; // ダミー（譜面表示用）
  drawStaffNotes([{keys:[noteToVexKey(noteName)], duration:"w"}], "4/4");
}
function renderGScale(){
  // 4/4 × 2小節、8分音符×16：上行8つ＋下行8つ（G4〜G5〜G4）
  const seq=["G4","A4","B4","C5","D5","E5","F#5","G5","G5","F#5","E5","D5","C5","B4","A4","G4"];
  targetTimeline = seq.map(n=>({note:n,dur:0.5})); // 8分=0.5拍
  const notes = seq.map(n=> {
    const k=noteToVexKey(n); const o={keys:[k], duration:"8", clef:"treble"};
    if(n.includes("#")) o.accidentals=[new Vex.Flow.Accidental("#")];
    return new Vex.Flow.StaveNote(o);
  });
  // F#に#を追加
  seq.forEach((n,i)=>{ if(n.startsWith("F#")) notes[i].addModifier(new Vex.Flow.Accidental("#"),0); });
  drawStaffNotes(notes, "4/4");
}
function drawStaffNotes(vfNotes, timeSig){
  const Vex=window.Vex;
  staffDiv.innerHTML="";
  const renderer=new Vex.Flow.Renderer(staffDiv,Vex.Flow.Renderer.Backends.SVG);
  const w=staffDiv.clientWidth||360, h=140; renderer.resize(w,h);
  const context=renderer.getContext();
  const stave=new Vex.Flow.Stave(10,10,w-20); stave.addClef("treble").addTimeSignature(timeSig); stave.setContext(context).draw();
  // 小節線は自動で。16音を2小節に分割
  const voice=new Vex.Flow.Voice({num_beats:8, beat_value:4}); // 2小節（4/4 x2）をまとめて書く
  voice.setMode(Vex.Flow.Voice.Mode.SOFT);
  voice.addTickables(vfNotes);
  new Vex.Flow.Formatter().joinVoices([voice]).format([voice], w-40);
  voice.draw(context, stave);
  vfCtx={renderer,context,stave};
  // カラオケCanvasサイズ
  karaokeCanvas.width=w; karaokeCanvas.height=h;
}

/***** ユーティリティ *****/
function noteToVexKey(n){ const m=n.match(/^([A-Ga-g])([#b]?)(\d)$/); const L=m[1].toUpperCase(),acc=m[2]||"",o=m[3]; return `${L}${acc}/${o}`;}
function colorScore(s){ bigScoreEl.className=""; if(s>=90) bigScoreEl.classList.add('green'); else if(s>=60) bigScoreEl.classList.add('yellow'); else bigScoreEl.classList.add('red');}
function updateNeedle(c){ const clamped=Math.max(-50,Math.min(50,c)); const pct=(clamped+50)/100; needleEl.style.left=`calc(${pct*100}% - 1px)`; }

/***** オーディオ初期化＋Worklet＋解析結果受取 *****/
let ac, workletNode, mic, analyser, running=false;
let targetFreq = noteToFreq(noteSel.value);
let lowLevelSince=0, lastPitchWarn=0;
let metroTimer=null, metroNextTime=0;

function onPitchMessage(ev){
  const {f0, conf, rms, dropped, now} = ev.data || {};
  const tNow = now || performance.now();

  // 小さめ警告（音量）
  if(rms < 0.01){
    if(!lowLevelSince) lowLevelSince=tNow;
    if(tNow - lowLevelSince > 1500){ notify('入力が小さいです。マイクを近づけてください。','warn',1800,true); lowLevelSince=tNow; }
  }else lowLevelSince=0;

  if(dropped) notify('処理が追いついていません。他アプリを閉じてください。','warn',3000);

  // ピッチ未検出
  if(!f0 || conf < 0.5){
    if(tNow - lastPitchWarn > 2000){ feedbackEl.textContent='検出が不安定です。一定の弓圧で弾いてください。'; lastPitchWarn=tNow; }
    drawKaraoke(tNow, null); // 欠測を描く（点を途切れさせる）
    return;
  }

  // 現在のターゲット（スケール時：進行に応じて変化）
  const fTarget = getCurrentTargetFreq(tNow);
  const cents = centsDiff(f0, fTarget);
  const sc = scoreFromCents(Math.abs(cents));
  bigScoreEl.textContent=String(sc); colorScore(sc);
  feedbackEl.textContent = feedbackText(cents);
  updateNeedle(cents);
  drawKaraoke(tNow, cents);
}

/***** 現在ターゲット周波数（単音／スケール） *****/
let sessionStartTime=0, beatDurMs=750; // BPM=80初期
function getCurrentTargetFreq(tNow){
  if(modeSel.value!=='gscale') return targetFreq;
  // スケール：開始時刻からの経過で16音を切替
  const elapsed = tNow - sessionStartTime;
  const noteDurMs = (60_000/ (+bpmInput.value)) / 2; // 8分=半拍
  const idx = Math.min(15, Math.max(0, Math.floor(elapsed / noteDurMs)));
  const n = targetTimeline[idx]?.note || targetTimeline.at(-1).note;
  return noteToFreq(n);
}

/***** カラオケ描画（五線譜に重ね） *****/
const karaokePts=[]; // {x,y} の短いリング
function drawKaraoke(tNow, centsOrNull){
  const ctx=karaokeCanvas.getContext('2d'); const w=karaokeCanvas.width, h=karaokeCanvas.height;
  // 時間→x：2小節全体を横幅にマップ（単音は常に中央付近に流す）
  const totalMs = modeSel.value==='gscale' ? (16 * (60_000/(+bpmInput.value))/2) : 2000;
  const x = modeSel.value==='gscale'
      ? Math.min(w-1, ( (tNow-sessionStartTime) / totalMs) * w )
      : (w*0.5);
  // セント→y：中央=0c、±50cを上下端の80%で
  let y=null;
  if(centsOrNull!=null){ const c=Math.max(-50,Math.min(50,centsOrNull)); y = h*0.5 - (c/50)*(h*0.4); }

  // 背景薄消し
  ctx.fillStyle="rgba(11,13,18,0.25)"; ctx.fillRect(0,0,w,h);

  // 正解基準線（0c）
  ctx.strokeStyle="rgba(180,180,180,0.4)"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,h*0.5); ctx.lineTo(w,h*0.5); ctx.stroke();

  // 進行バー（スケール時）
  if(modeSel.value==='gscale'){ ctx.fillStyle="rgba(45,212,191,0.15)"; ctx.fillRect(0,0,x,h); }

  // 点列に追加＆描線
  if(y!==null){ karaokePts.push({x,y}); if(karaokePts.length>200) karaokePts.shift(); }
  ctx.strokeStyle="rgba(45,212,191,0.95)"; ctx.lineWidth=2; ctx.beginPath();
  karaokePts.forEach((p,i)=>{ if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); });
  ctx.stroke();
}

/***** 入力波形（音形）描画 *****/
function drawOsc(){
  if(!analyser) return;
  const ctx=oscCanvas.getContext('2d'); const w=oscCanvas.width=oscCanvas.clientWidth; const h=oscCanvas.height=oscCanvas.clientHeight;
  const arr=new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(arr);
  ctx.fillStyle="#0f131a"; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle="#90cdf4"; ctx.lineWidth=1.5; ctx.beginPath();
  for(let i=0;i<w;i++){
    const idx=Math.floor(i/ w * arr.length); const v=(arr[idx]-128)/128; const y=h/2 - v*(h*0.45);
    i===0?ctx.moveTo(i,y):ctx.lineTo(i,y);
  }
  ctx.stroke();
  requestAnimationFrame(drawOsc);
}

/***** 開始・停止・メトロノーム *****/
function scheduleMetronome(){
  // 視覚LED点滅＋クリック音（簡易）
  const beatMs = 60_000 / (+bpmInput.value);
  beatDurMs = beatMs;
  metroNextTime = performance.now();
  if(metroTimer) clearInterval(metroTimer);
  metroTimer = setInterval(()=>{
    metroLed.style.background = "#22c55e"; setTimeout(()=>metroLed.style.background="#334155",100);
    // クリック音：短いクリック（安全のためオーディオ起動済み時のみ）
    if(ac && ac.state==='running'){
      const o=ac.createOscillator(), g=ac.createGain();
      o.frequency.value=1000; g.gain.value=0.0001; o.connect(g).connect(ac.destination);
      o.start(); g.gain.exponentialRampToValueAtTime(0.0000001, ac.currentTime+0.05); o.stop(ac.currentTime+0.06);
    }
  }, beatMs);
}
async function start(){
  if(running) return;
  try{
    ac=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
    await ac.audioWorklet.addModule('./pitch-worklet.js');
    const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}});
    mic=ac.createMediaStreamSource(stream);
    analyser=ac.createAnalyser(); analyser.fftSize=2048;
    workletNode=new AudioWorkletNode(ac,'pitch-detector',{numberOfInputs:1,numberOfOutputs:0});
    workletNode.port.onmessage=onPitchMessage;
    mic.connect(analyser); mic.connect(workletNode);
    running=true; btnStart.disabled=true; btnStop.disabled=false;
    sessionStartTime=performance.now(); scheduleMetronome();
    notify('音声処理を開始しました。','info',1200);
    drawOsc();
  }catch(e){ handleGetUserMediaError(e); }
}
function stop(){
  if(!running) return;
  try{ mic&&mic.disconnect(); }catch{} try{ workletNode&&workletNode.port.close(); }catch{} try{ ac&&ac.close(); }catch{}
  if(metroTimer) clearInterval(metroTimer);
  running=false; btnStart.disabled=false; btnStop.disabled=true;
  bigScoreEl.textContent="--"; bigScoreEl.className=""; feedbackEl.textContent="停止中"; updateNeedle(0);
  karaokePts.length=0; karaokeCanvas.getContext('2d').clearRect(0,0,karaokeCanvas.width,karaokeCanvas.height);
  notify('停止しました。','info',1000);
}
function handleGetUserMediaError(err){
  const name=err?.name||''; if(name==='NotAllowedError'||name==='SecurityError') notify('マイク権限が拒否されています。設定→サイト→マイク許可。','error',5000);
  else if(name==='NotFoundError') notify('マイクが見つかりません。接続を確認してください。','error',5000);
  else if(name==='NotReadableError') notify('他アプリがマイク使用中。終了して再試行。','error',5000);
  else notify(`マイク起動エラー: ${name||err}`,'error',5000);
}

/***** イベント *****/
function setTargetNote(n){ targetFreq=noteToFreq(n); renderSingle(n);
  bigScoreEl.textContent="--"; bigScoreEl.className=""; feedbackEl.textContent=`課題音：${n}（A=442Hz）`; updateNeedle(0); }
function randomPick(){ const TEST=['B4','C5','D5','E5','F5']; return TEST[Math.floor(Math.random()*TEST.length)]; }

document.getElementById('start').addEventListener('click', start);
document.getElementById('stop').addEventListener('click', stop);
noteSel.addEventListener('change', ()=> setTargetNote(noteSel.value));
btnRandom.addEventListener('click', ()=> setTargetNote(randomPick()));
modeSel.addEventListener('change', ()=>{
  if(modeSel.value==='gscale'){ renderGScale(); }
  else { setTargetNote(noteSel.value); }
});
bpmInput.addEventListener('change', ()=>{
  const v=Math.max(40,Math.min(200, Math.round((+bpmInput.value)/5)*5)); bpmInput.value=String(v);
  if(running) scheduleMetronome();
});

/***** 初期化 *****/
await preflightChecks();
setTargetNote(noteSel.value); // 既定：単音A4
