/***** トースト通知（小さめ対応） *****/
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

/***** A=442Hz 音名⇔周波数 *****/
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

/***** 採点（最低50点・甘め表示） *****/
function baseInstantScore(absC){
  if(absC<=5) return 100;
  if(absC<=10) return Math.round(100-3*(absC-5));
  if(absC<=25) return Math.round(85-2.33*(absC-10));
  if(absC<=50) return Math.round(50-2*(absC-25));
  return 50; // 以前は0。最低50へ
}
function instantScore(absC){ return Math.max(50, baseInstantScore(absC)); }

function feedbackCore(c){
  if(Math.abs(c)<=5) return "とても良いです。安定しています。";
  if(c>5&&c<=15)   return "やや高めです。ほんの少し下げてください。";
  if(c<-5&&c>=-15) return "やや低めです。ほんの少し上げてください。";
  if(Math.abs(c)<=30) return "ズレが大きいです。開放弦基準で合わせ直してください。";
  return "音程が外れています。ポジション／指置きを確認してください。";
}

/* リングフィット風：点が低めの時の励ましメッセージ */
const COACH = [
  "大丈夫です！ここから整えていきましょう！",
  "その集中、きています。次の1音もいきましょう！",
  "今の動き、すごく良いです！呼吸を整えてもう一回！",
  "肩の力を抜いて、スッと指を置いてみましょう。",
  "いい姿勢です！そのまま前を見て！",
  "少しだけ弓をゆっくり、焦らずいきましょう！",
  "指先の準備OK！次の音で決めましょう！",
  "音をよく聴けています！自信を持って！",
  "フォーム安定してます！その調子であと一回！",
  "やってることは合っています！継続が勝ちです！",
  "今の修正、ナイスです！次が本命！",
  "指の移動を小さく、コンパクトに！できます！",
  "深呼吸して、もう一回だけいきますよ！",
  "良い挑戦です！ここから伸びます！",
  "その集中力、最高です！あと少し！",
  "音の“芯”に近づいてます！もう一押し！"
];
let coachIdx=0;
function coachMessage(score){
  if(score>=70) return ""; // 70以上は通常フィードバックのみ
  const msg = COACH[coachIdx++ % COACH.length];
  return " " + msg;
}

/***** 称賛100パターン（結果発表で使用） *****/
const PRAISES = [
  "すごい！モーツァルトかと思いました！","今日の主役です！","響きが美しいです！","音程が澄み切っています！",
  "その滑らかさ、職人技です！","音の立ち上がりがキレッキレ！","耳が良すぎます！","音の重心が安定しています！",
  "上ずらない、その冷静さ最高！","歌心に満ちています！","音程の精度がプロ仕様！","音色が上品です！",
  "丁寧さが伝わります！","指の記憶が育っています！","弓のスピードが理想的！","音程のセンターに吸い込まれてます！",
  "音の粒立ちが綺麗！","コンサートホール仕様の安定感！","バランス感覚が抜群！","良いビブラートの土台ができています！",
  "倍音がよく鳴っています！","聴いていて気持ちいいです！","ピッチコントロールが神！","今日いちばんの音です！",
  "耳のフォーカスが合っています！","音の“芯”が見えます！","静かな自信を感じます！","レガートが滑らか！",
  "そのA線、黄金比です！","E線のきらめき素敵！","左手の正確さが光っています！","安定した弓圧、理想的！",
  "音程の戻しが速い！","指の着地が美しい！","音の出口がきれい！","拍感も完璧！",
  "集中力が素晴らしい！","練習の成果が出ています！","チューナー泣かせの精度！","高音域でもブレません！",
  "低音の存在感が最高！","立体的なサウンドです！","耳のキャリブレーション完璧！","一音で物語れています！",
  "プロの入り口に立ってます！","弦の鳴らし方が上手い！","その一音、写真が撮れます！","音程の安定は正義です！",
  "音の尾が美しい！","右手のコントロールが冴えてます！","左手の最短距離が見事！","音の表情が豊か！",
  "音程が“吸着”してます！","音の輪郭がシャープ！","狙いが的確！","音と体が一体化してます！",
  "呼吸が音楽的！","耳の解像度が高い！","緊張と緩和のバランス◎！","音の密度が上がりました！",
  "音程のリカバリが超速！","音の遠近感が素敵！","音が前に出ています！","ビート感が気持ちいい！",
  "音の立ち姿が美しい！","音程の“芯食い”達人！","一発で決めましたね！","舞台でも通る音です！",
  "聴衆を惹きつける音です！","ミスしても戻しが上手い！","楽器が喜んでます！","今日いちばんの集中です！",
  "音程の“寄り”が上品！","アンサンブルでも映えます！","音の方向性が明確！","響きのコントロールが成熟！",
  "音の角度が良い！","上腕の力みゼロ！","音の懐が深い！","リズムの芯がブレません！",
  "表現の余白が見える音！","艶やかです！","音ほどけが自然！","音楽の呼吸ができています！",
  "音の発語がきれい！","音程の決断が速い！","音の照準が完璧！","音の気品が溢れています！",
  "心が動く音です！","弦移動が滑らか！","トーンが瑞々しい！","響きがホール級！",
  "音程の磁石が働いてます！","耳がチューニングマスター！","音の背骨が通ってます！","音の香りが良い！",
  "音楽的な勇気を感じます！","弓の返しが美！","音の着地点が美しい！","次の段階へ行ける音です！",
  "まるで録音テイク！","音の説得力がすごい！","音が微笑んでます！","今日の自己ベスト更新！",
  "拍手喝采コース！","舞台に出せます！","余裕を感じます！","音楽が立ち上がりました！"
];

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

// 結果モーダル
const resultEl=document.getElementById('result');
const confettiCanvas=document.getElementById('confetti');
const finalScoreEl=document.getElementById('final-score');
const praiseEl=document.getElementById('praise');
const detailsEl=document.getElementById('details');
document.getElementById('again').onclick=()=>{ hideResult(); start(); };
document.getElementById('close').onclick=()=> hideResult();

/***** 五線譜描画（4/4固定） *****/
let vfCtx=null, targetTimeline=[];
function renderSingle(noteName="A4"){
  targetTimeline=[{note:noteName,durBeats:4}];
  const Vex=window.Vex;
  staffDiv.innerHTML="";
  const renderer=new Vex.Flow.Renderer(staffDiv,Vex.Flow.Renderer.Backends.SVG);
  const w=staffDiv.clientWidth||360, h=150; renderer.resize(w,h);
  const ctx=renderer.getContext();
  const stave=new Vex.Flow.Stave(10,10,w-20); stave.addClef("treble").addTimeSignature("4/4"); stave.setContext(ctx).draw();
  const key=noteToVexKey(noteName);
  const note=new Vex.Flow.StaveNote({keys:[key],duration:"w",clef:"treble"});
  if(noteName.includes("#")) note.addModifier(new Vex.Flow.Accidental("#"),0);
  const voice=new Vex.Flow.Voice({num_beats:4,beat_value:4}); voice.addTickables([note]);
  new Vex.Flow.Formatter().joinVoices([voice]).format([voice], w-40); voice.draw(ctx,stave);
  vfCtx={renderer,stave}; karaokeCanvas.width=w; karaokeCanvas.height=h;
}
function renderGScale(){
  const Vex=window.Vex;
  const seq=["G4","A4","B4","C5","D5","E5","F#5","G5","G5","F#5","E5","D5","C5","B4","A4","G4"];
  targetTimeline = seq.map(n=>({note:n,durBeats:0.5}));
  staffDiv.innerHTML="";
  const renderer=new Vex.Flow.Renderer(staffDiv,Vex.Flow.Renderer.Backends.SVG);
  const w=staffDiv.clientWidth||360, h=150; renderer.resize(w,h);
  const ctx=renderer.getContext();
  const stave=new Vex.Flow.Stave(10,10,w-20);
  stave.addClef("treble").addTimeSignature("4/4").addKeySignature("G");
  stave.setContext(ctx).draw();
  const notes = seq.map(n=>{
    const k=noteToVexKey(n);
    const sn=new Vex.Flow.StaveNote({keys:[k],duration:"8",clef:"treble"});
    if(n.includes("#")) sn.addModifier(new Vex.Flow.Accidental("#"),0);
    return sn;
  });
  const beams=[new Vex.Flow.Beam(notes.slice(0,4)),new Vex.Flow.Beam(notes.slice(4,8)),
               new Vex.Flow.Beam(notes.slice(8,12)),new Vex.Flow.Beam(notes.slice(12,16))];
  const voice=new Vex.Flow.Voice({num_beats:8, beat_value:4});
  voice.setMode(Vex.Flow.Voice.Mode.SOFT); voice.addTickables(notes);
  new Vex.Flow.Formatter().joinVoices([voice]).format([voice], w-40); voice.draw(ctx,stave);
  beams.forEach(b=>b.setContext(ctx).draw());
  vfCtx={renderer,stave}; karaokeCanvas.width=w; karaokeCanvas.height=h;
}
function noteToVexKey(n){ const m=n.match(/^([A-Ga-g])([#b]?)(\d)$/); const L=m[1].toUpperCase(),acc=m[2]||"",o=m[3]; return `${L}${acc}/${o}`; }

/***** 表示ユーティリティ *****/
function colorScore(s){ bigScoreEl.className=""; if(s>=90) bigScoreEl.classList.add('green'); else if(s>=70) bigScoreEl.classList.add('yellow'); else bigScoreEl.classList.add('red');}
function updateNeedle(c){ const clamped=Math.max(-50,Math.min(50,c)); const pct=(clamped+50)/100; needleEl.style.left=`calc(${pct*100}% - 1px)`; }

/***** オーディオ：Worklet・解析・波形 *****/
let ac, workletNode, mic, analyser, running=false;
let mediaStream=null;           // 自動OFF用
let targetFreq = noteToFreq(noteSel.value);
let lowLevelSince=0, lastPitchWarn=0;

// スケール進行・採点
let armed=false, currentIdx=0, noteTimer=null, perNoteCents=[], perNoteScores=[], sessionStart=0;

// メトロノーム（iPhone対応クリック）
function makeClick(){ const dur=0.04, sr=ac.sampleRate, len=Math.floor(dur*sr);
  const buf=ac.createBuffer(1,len,sr), data=buf.getChannelData(0);
  for(let i=0;i<len;i++){ const env=Math.exp(-60*i/len); data[i]=(Math.random()*2-1)*0.45*env; }
  return buf; }
let clickBuf=null;
function playClick(){ if(!ac || ac.state!=='running' || !clickBuf) return;
  const src=ac.createBufferSource(), g=ac.createGain(); src.buffer=clickBuf; g.gain.value=0.7; src.connect(g).connect(ac.destination); src.start(); }
function scheduleMetronome(){
  const bpm=+bpmInput.value, beatMs=60_000/bpm;
  if(noteTimer) clearInterval(noteTimer);
  noteTimer=setInterval(()=>{
    playClick(); metroLed.style.background="#22c55e"; setTimeout(()=>metroLed.style.background="#334155",110);
    if(modeSel.value==='gscale' && armed){
      closeCurrentNoteAndScore();
      currentIdx++;
      if(currentIdx>=16){ finishScaleAndShowResult(); return; }
    }
  }, beatMs/2);
}

/***** 波形：20秒スクロール *****/
let lastOscT=0;
function drawOsc(ts){
  if(!analyser) return;
  const ctx=oscCanvas.getContext('2d');
  const w=oscCanvas.width=oscCanvas.clientWidth;
  const h=oscCanvas.height=oscCanvas.clientHeight;

  const pxPerSec = w/20;
  const dt = lastOscT ? (ts-lastOscT)/1000 : 0;
  lastOscT = ts;

  const shift = Math.max(1, Math.floor(pxPerSec*dt));
  const img = ctx.getImageData(shift,0, w-shift, h);
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle="#0f131a"; ctx.fillRect(w-shift,0,shift,h);

  const data=new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(data);
  ctx.strokeStyle="#90cdf4"; ctx.lineWidth=1;
  ctx.beginPath();
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

  if(modeSel.value==='gscale' && !armed){
    if(f0 && conf>=0.6 && rms>=0.01){
      armed=true; currentIdx=0; sessionStart=tNow;
      perNoteCents = Array.from({length:16},()=>[]);
      perNoteScores = [];
      playClick();
    }else{
      drawKaraoke(tNow, null);
      return;
    }
  }

  if(!f0 || conf < 0.5){
    drawKaraoke(tNow, null);
    if(tNow - lastPitchWarn > 2000){ feedbackEl.textContent='検出が不安定です。一定の弓圧で弾いてください。'; lastPitchWarn=tNow; }
    return;
  }

  const fTarget = getCurrentTargetFreq();
  const cents = centsDiff(f0, fTarget);
  const sc = instantScore(Math.abs(cents));
  bigScoreEl.textContent=String(sc); colorScore(sc);
  feedbackEl.textContent = feedbackCore(cents) + coachMessage(sc);
  updateNeedle(cents);
  drawKaraoke(tNow, cents);

  if(modeSel.value==='gscale' && armed && currentIdx<16){
    perNoteCents[currentIdx].push(Math.abs(cents));
  }
}

/***** ターゲット周波数 *****/
function getCurrentTargetFreq(){
  if(modeSel.value!=='gscale') return targetFreq;
  const seq=["G4","A4","B4","C5","D5","E5","F#5","G5","G5","F#5","E5","D5","C5","B4","A4","G4"];
  const n = seq[currentIdx] || seq[seq.length-1];
  return noteToFreq(n);
}

/***** カラオケ描画 *****/
const karaokePts=[];
function drawKaraoke(tNow, centsOrNull){
  const ctx=karaokeCanvas.getContext('2d'); const w=karaokeCanvas.width, h=karaokeCanvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle="rgba(200,200,200,0.4)"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,h*0.5); ctx.lineTo(w,h*0.5); ctx.stroke();

  if(modeSel.value==='gscale'){
    const stepW=w/16;
    ctx.fillStyle="rgba(45,212,191,0.15)";
    ctx.fillRect(0,0, stepW*(currentIdx+1), h);
    ctx.strokeStyle="rgba(100,160,160,0.25)"; ctx.beginPath();
    for(let i=0;i<=16;i+=2){ const x=i*stepW; ctx.moveTo(x,0); ctx.lineTo(x,h); }
    ctx.stroke();
  }

  if(centsOrNull!=null){
    const c=Math.max(-50,Math.min(50,centsOrNull));
    const y=h*0.5 - (c/50)*(h*0.4);
    const x= modeSel.value==='gscale' ? (w/16)*(currentIdx + 0.5) : w*0.5;
    karaokePts.push({x,y}); if(karaokePts.length>120) karaokePts.shift();
    ctx.strokeStyle="rgba(45,212,191,0.95)"; ctx.lineWidth=2; ctx.beginPath();
    karaokePts.forEach((p,i)=>{ if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); }); ctx.stroke();
  }else{
    ctx.strokeStyle="rgba(45,212,191,0.35)"; ctx.lineWidth=2; ctx.beginPath();
    karaokePts.forEach((p,i)=>{ if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); }); ctx.stroke();
  }
}

/***** 採点関連（最終も最低50点） *****/
function closeCurrentNoteAndScore(){
  const arr = perNoteCents[currentIdx] || [];
  const med = arr.length ? percentile(arr,50) : 50;
  perNoteScores[currentIdx] = instantScore(med);
}
function percentile(a,p){
  const b=[...a].sort((x,y)=>x-y); const k=(p/100)*(b.length-1); const f=Math.floor(k), c=Math.ceil(k);
  if(b.length===0) return 0; if(f===c) return b[f]; return b[f] + (b[c]-b[f])*(k-f);
}
function computeFinalScore(){
  const valid = perNoteScores.filter(x=>Number.isFinite(x));
  const raw = valid.length ? (valid.reduce((s,x)=>s+x,0)/valid.length) : 50;
  // 既に各音で最低50。ここでも最低50を保証
  const final = Math.max(50, Math.round(raw));
  return { raw: Math.round(raw), final };
}
function finishScaleAndShowResult(){
  if(currentIdx<16) closeCurrentNoteAndScore();
  const {raw, final} = computeFinalScore();
  showResult(final, raw);
  stop(); // 採点後は確実にOFF
}

/***** 結果モーダル：演出 *****/
function showResult(final, raw){
  finalScoreEl.textContent="0";
  const praise = PRAISES[Math.floor(Math.random()*PRAISES.length)];
  praiseEl.textContent = praise;
  detailsEl.textContent = `平均点（最低50適用）：${raw} 点`;

  let v=0; const start=performance.now(); const dur=900;
  function tick(t){ const r=Math.min(1,(t-start)/dur); v=Math.floor(final*r*r + 0.5); finalScoreEl.textContent=String(Math.max(50,v)); if(r<1) requestAnimationFrame(tick); }
  requestAnimationFrame(tick);

  launchConfetti();
  resultEl.classList.add('show');
  resultEl.setAttribute('aria-hidden','false');
}
function hideResult(){
  resultEl.classList.remove('show');
  resultEl.setAttribute('aria-hidden','true');
  const c=confettiCanvas.getContext('2d'); c && c.clearRect(0,0,confettiCanvas.width,confettiCanvas.height);
}
function launchConfetti(){
  const cvs=confettiCanvas; const ctx=cvs.getContext('2d');
  cvs.width=window.innerWidth; cvs.height=window.innerHeight;
  const N=120, parts=[];
  for(let i=0;i<N;i++){
    parts.push({x:Math.random()*cvs.width, y:-20-Math.random()*cvs.height*0.4,
      vx:(Math.random()-0.5)*1.2, vy:1+Math.random()*2.5, r:2+Math.random()*4, rot:Math.random()*6.28});
  }
  let alive=true; const colors=["#22c55e","#60a5fa","#f59e0b","#ef4444","#a78bfa","#2dd4bf"];
  (function anim(){
    if(!alive) return;
    ctx.clearRect(0,0,cvs.width,cvs.height);
    parts.forEach(p=>{
      p.x+=p.vx; p.y+=p.vy; p.vy+=0.02; p.rot+=0.1;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
      ctx.fillStyle=colors[(p.x|0)%colors.length];
      ctx.fillRect(-p.r,-p.r,p.r*2,p.r*2);
      ctx.restore();
    });
    if(parts.every(p=>p.y>cvs.height+30)) alive=false;
    requestAnimationFrame(anim);
  })();
}

/***** 開始・停止・可視状態制御（ページ前面時のみマイクON） *****/
function handleGetUserMediaError(err){
  const name=err?.name||''; if(name==='NotAllowedError'||name==='SecurityError') notify('マイク権限が拒否されています。設定→サイト→マイク許可。','error',5000);
  else if(name==='NotFoundError') notify('マイクが見つかりません。接続を確認してください。','error',5000);
  else if(name==='NotReadableError') notify('他アプリがマイク使用中。終了して再試行。','error',5000);
  else notify(`マイク起動エラー: ${name||err}`,'error',5000);
}

async function start(){
  if(running) return;
  hideResult();
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

    armed = (modeSel.value!=='gscale');
    currentIdx=0; sessionStart=performance.now();
    perNoteCents = Array.from({length:16},()=>[]);
    perNoteScores = [];

    if(modeSel.value==='gscale') renderGScale(); else renderSingle(noteSel.value);
    scheduleMetronome();

    notify('音声処理を開始しました。','info',1200);
    requestAnimationFrame(drawOsc);
  }catch(e){ handleGetUserMediaError(e); }
}

function stop(){
  if(!running && !mediaStream && !ac) return;

  try{ mic && mic.disconnect(); }catch{}
  try{ workletNode && workletNode.port.close(); }catch{}
  try{ analyser && (analyser=null); }catch{}

  try{
    if(mediaStream){
      mediaStream.getTracks().forEach(t=>t.stop());
      mediaStream = null;
    }
  }catch{}

  try{ ac && ac.close(); }catch{}
  if(noteTimer) clearInterval(noteTimer);

  running=false; btnStart.disabled=false; btnStop.disabled=true;
  bigScoreEl.textContent="--"; bigScoreEl.className=""; feedbackEl.textContent="停止中"; updateNeedle(0);
  karaokePts.length=0; const kctx=karaokeCanvas.getContext('2d'); kctx && kctx.clearRect(0,0,karaokeCanvas.width,karaokeCanvas.height);
  armed=false;
}

function forceStopForBackground(reason){
  if(running || mediaStream){
    stop();
    notify(reason || 'バックグラウンドに移動したためマイクを停止しました。','info',2500);
  }
}

/***** イベント *****/
function setTargetNote(n){ targetFreq=noteToFreq(n); renderSingle(n);
  bigScoreEl.textContent="--"; bigScoreEl.className=""; feedbackEl.textContent=`課題音：${n}（A=442Hz）`; updateNeedle(0); }
function randomPick(){ const TEST=['B4','C5','D5','E5','F5']; return TEST[Math.floor(Math.random()*TEST.length)]; }

btnStart.addEventListener('click', start);
btnStop.addEventListener('click', stop);
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

/* ページ前面時だけマイクON：非表示・離脱で即停止 */
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden){ forceStopForBackground('タブが非表示になったためマイクを停止しました。'); }
});
window.addEventListener('pagehide', ()=> forceStopForBackground());
window.addEventListener('beforeunload', ()=> forceStopForBackground());

/***** 起動 *****/
await preflightChecks();
setTargetNote(noteSel.value); // 既定：単音A4
