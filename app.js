// app.js
// バックグラウンド即停止、開始/停止をヘッダーへ。RMS閾値は固定。
// 合格エフェクト：粒子大量・長寿命。色は |c| により緑/青/赤。

import { A4, getKeys, makeExerciseAll, letterFreqWithAcc } from "./scales.js";
import { renderTwoBars } from "./score.js";

const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const now=()=>performance.now();

const errors = new Set();
function pushErr(msg){ const line = `${new Date().toISOString()} : ${msg}`; if(!errors.has(line)) errors.add(line); }
function showToast(msg,type="info",tiny=false){
  const t=$("#toast"); if(!t) return;
  t.textContent = msg; t.className = tiny?`show tiny ${type}`:`show ${type}`;
  setTimeout(()=>{ t.classList.remove("show","tiny","info","warn","error"); }, 1800);
}
function hudFlash(intensity=1){
  const el=$("#hud-flash"); el.classList.add("show");
  el.style.opacity = String(Math.min(0.28, 0.10 + 0.18*intensity));
  setTimeout(()=>el.classList.remove("show"), 180);
}

// DOM
const ui = {
  scaleType: $$('input[name="scaleType"]'),
  level: $$('input[name="level"]'),
  keySel: $("#key-select"),
  diffSel: $("#difficulty"),
  db: $("#db-indicator"),
  ver: $("#app-version"),

  start: $("#start"), stop: $("#stop"), log: $("#show-errors"),

  bigScore: $("#big-score"), advice: $("#advice"),
  bar: $("#cents-bar"), barNeedle: $("#bar-needle"),
  analogHand: $("#hand"),

  staffWrap: $("#staff-wrap"), spark: $("#spark"),
  prog: $("#prog"), pageLabel: $("#page-label"),

  gate: $("#gate"), permit: $("#permit"),
  result: $("#result"), praise: $("#praise"), details: $("#details"),
  again: $("#again"), close: $("#close"),

  errModal: $("#error-modal"), errList: $("#error-list"),
  errCopy: $("#err-copy"), errClose: $("#err-close"),
  noSleep: $("#nosleep"),
};

// 状態
const difficultyToCents = { "s-easy":9, easy:7, normal:5, hard:3, oni:2 };
let state = {
  visible: document.visibilityState === "visible",
  running: false,
  stream: null,
  ac: null,
  analyser: null,
  buf: null,
  lastT: 0,
  servo: { pos:0, vel:0 },
  scaleType: "major",
  level: "advanced",
  key: null,
  notes: [],
  total: 0,
  totalBars: 0,
  offset: 0,
  idx: 0,
  lockUntil: 0,
  passRecorded: [],
  failed: new Set(),
  rmsThresh: 0.0015, // 固定
  diffCents: difficultyToCents[$("#difficulty").value],
  rafId: 0,
};

// バックグラウンド/ページ離脱で即停止（iOS Safari対策に多重フック）
["visibilitychange","webkitvisibilitychange","pagehide","freeze","blur","beforeunload"].forEach(ev=>{
  window.addEventListener(ev, ()=>{
    state.visible = document.visibilityState === "visible";
    if(!state.visible || ev==="pagehide" || ev==="beforeunload" || ev==="freeze" || ev==="blur"){
      hardStop("非可視または離脱で停止");
    }
  }, {passive:true,capture:true});
});

// 「特定の画面以外では動かない」…譜面が画面外なら停止
const screenObserver = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{
    if(state.running && !e.isIntersecting) hardStop("譜面が非表示で停止");
  });
},{ threshold:0.15 });
screenObserver.observe(ui.staffWrap);

// スケール選択
function populateKeys(){
  const st = state.scaleType, lv = state.level;
  const keys = getKeys(st, lv);
  ui.keySel.innerHTML = keys.map(k=>`<option value="${k}">${k}</option>`).join("");
  if(!state.key || !keys.includes(state.key)) state.key = keys[0];
  ui.keySel.value = state.key;
}

function loadExercise(){
  state.notes = makeExerciseAll(state.scaleType, state.level, state.key);
  state.total = state.notes.length;
  state.totalBars = Math.ceil(state.total/8);
  state.offset = 0; state.idx = 0;
  state.passRecorded = Array(state.total).fill(null);
  state.failed.clear();
  renderPage(); updateProgressUI();
}

let pageAPI = null;
function renderPage(){
  pageAPI = renderTwoBars({ key: state.key, notes: state.notes, offset: state.offset });
  for(let i=0;i<16;i++) pageAPI.recolor(i, "note-normal");
  highlightCurrentNote();
}
function updateProgressUI(){
  ui.prog.textContent = `音 ${state.idx+1}/${state.total}`;
  const firstBar = Math.floor(state.offset/8)+1;
  const lastBar = Math.min(firstBar+1, state.totalBars);
  ui.pageLabel.textContent = `小節 ${firstBar}–${lastBar} / 全 ${state.totalBars} 小節`;
}
function highlightCurrentNote(){
  const rel = state.idx - state.offset;
  for(let i=0;i<16;i++) pageAPI.recolor(i, i===rel ? "note-target" : "note-normal");
}

// UIイベント
ui.scaleType.forEach(r=>r.addEventListener("change", e=>{
  if(e.target.checked){ state.scaleType = e.target.value; populateKeys(); loadExercise(); }
}));
ui.level.forEach(r=>r.addEventListener("change", e=>{
  if(e.target.checked){ state.level = e.target.value; populateKeys(); loadExercise(); }
}));
ui.keySel.addEventListener("change", e=>{ state.key = e.target.value; loadExercise(); });
ui.diffSel.addEventListener("change", e=>{ state.diffCents = difficultyToCents[e.target.value]; });

populateKeys(); loadExercise();

// 許可ゲート
window.__permit = async function(){
  ui.gate.classList.remove("show"); ui.gate.setAttribute("aria-hidden","true");
  try { await start(); } catch(err){ pushErr(err.message||String(err)); showToast("開始に失敗しました","error"); gateBack(); }
};
function gateBack(){
  ui.gate.classList.add("show"); ui.gate.setAttribute("aria-hidden","false");
}

// ボタン
ui.start.addEventListener("click", ()=> window.__permit && window.__permit());
ui.stop.addEventListener("click", ()=> hardStop("停止ボタン"));

ui.log.addEventListener("click", ()=>{
  ui.errList.innerHTML = [...errors].map(s=>`<li><code>${s}</code></li>`).join("") || "<li>なし</li>";
  $("#error-modal").classList.add("show"); $("#error-modal").setAttribute("aria-hidden","false");
});
ui.errCopy.addEventListener("click", async ()=>{ await navigator.clipboard.writeText([...errors].join("\n")); showToast("コピーしました"); });
ui.errClose.addEventListener("click", ()=>{ $("#error-modal").classList.remove("show"); $("#error-modal").setAttribute("aria-hidden","true"); });

// 完了ダイアログ
$("#again").addEventListener("click", ()=>{ $("#result").classList.remove("show"); $("#result").setAttribute("aria-hidden","true"); loadExercise(); gateBack(); });
$("#close").addEventListener("click", ()=>{ $("#result").classList.remove("show"); $("#result").setAttribute("aria-hidden","true"); gateBack(); });

// 音声セットアップ
async function start(){
  if(!state.visible){ showToast("画面が見えていません","warn"); gateBack(); return; }
  if(state.running) return;

  ui.noSleep.play().catch(()=>{});
  const ac = new (window.AudioContext||window.webkitAudioContext)({ latencyHint: "interactive" });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: ac.sampleRate, echoCancellation:false, noiseSuppression:false, autoGainControl:false }
  });

  const src = ac.createMediaStreamSource(stream);
  const hpf = ac.createBiquadFilter(); hpf.type="highpass"; hpf.frequency.value=90; hpf.Q.value=0.7;
  const peak = ac.createBiquadFilter(); peak.type="peaking"; peak.frequency.value=2500; peak.Q.value=1; peak.gain.value=5;
  const analyser = ac.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.0;

  src.connect(hpf); hpf.connect(peak); peak.connect(analyser);

  state.ac = ac; state.stream = stream; state.analyser = analyser;
  state.buf = new Float32Array(analyser.fftSize);
  state.running = true; document.body.classList.add("running");
  ui.start.disabled = true; ui.stop.disabled = false;
  loop();
}

function hardStop(reason=""){
  try{ cancelAnimationFrame(state.rafId); }catch{}
  try{ state.ac?.suspend?.(); }catch{}
  try{ state.ac?.close?.(); }catch(e){ pushErr("AudioContext close失敗: "+(e.message||e)); }
  try{ state.stream?.getTracks?.().forEach(t=>t.stop()); }catch(e){ pushErr("MediaStream停止失敗: "+(e.message||e)); }
  state.stream = null; state.ac=null; state.analyser=null; state.buf=null;
  state.running=false; document.body.classList.remove("running");
  ui.start.disabled = false; ui.stop.disabled = true;
  if(reason) pushErr(reason);
  // 監視タイマ（Safari取りこぼし補完）
  setTimeout(()=>{ try{ state.stream?.getTracks?.().forEach(t=>t.stop()); }catch{} }, 900);
  gateBack();
}

// F0推定：自己相関＋放物線補間
const fMin=110, fMax=2200;
function hamming(i,N){ return 0.54 - 0.46 * Math.cos(2*Math.PI*i/(N-1)); }
function autoCorrelate(buf,sr){
  const N = buf.length;
  let rms=0; for(let i=0;i<N;i++){ const s=buf[i]*hamming(i,N); buf[i]=s; rms+=s*s; }
  rms = Math.sqrt(rms/N);
  const db = Math.round(clamp(20*Math.log10(Math.max(rms,1e-9)) + 94, 0, 120));
  updateDB(db);

  if(rms < state.rmsThresh) return {freq:0, rms, db, alive:false};
  let bestOfs=-1, best=0;
  const startOfs = Math.floor(sr/fMax), endOfs = Math.floor(sr/fMin);
  for(let ofs=startOfs; ofs<endOfs; ofs++){
    let sum=0; for(let i=0;i<N-ofs;i++) sum += buf[i]*buf[i+ofs];
    if(sum>best){ best=sum; bestOfs=ofs; }
  }
  if(bestOfs<0) return {freq:0, rms, db, alive:false};
  const s1=acf(bestOfs-1), s2=acf(bestOfs), s3=acf(bestOfs+1);
  const denom=(s1-2*s2+s3); const shift=denom?0.5*(s1-s3)/denom:0;
  const T=(bestOfs+shift)/sr; const freq=1/T;
  return {freq, rms, db, alive:true};
  function acf(ofs){ let sum=0; for(let i=0;i<N-ofs;i++) sum+=buf[i]*buf[i+ofs]; return sum; }
}

// 針サーボ
const servo = { wn:11.5, z:0.78 };
function updateNeedle(cents, dt){
  const e = clamp(cents, -50, 50);
  const dead = Math.abs(e)<=1 ? 0 : e;
  const z = Math.min(0.95, servo.z + (Math.max(0,6-Math.abs(e))/6)*(0.95-servo.z));
  const a = servo.wn*servo.wn*dead - 2*z*servo.wn*state.servo.vel;
  state.servo.vel += a*dt; state.servo.pos += state.servo.vel*dt;
  const angle = clamp(state.servo.pos*(60/50), -60, 60);
  ui.analogHand.setAttribute("transform", `translate(0,60) rotate(${angle})`);
}

// 採点・進行
function nearestSemitoneCents(freq){
  if(freq<=0) return 0;
  const n = Math.round(12*Math.log2(freq/A4));
  const ref = A4 * Math.pow(2, n/12);
  return 1200*Math.log2(freq/ref);
}
function targetFreq(){ return letterFreqWithAcc(state.notes[state.idx], A4); }
function updateDB(db){
  const el = ui.db;
  el.textContent = `${db} dB`;
  el.style.background = db>=80?"#3b0e0e": db>=70?"#3b2a0e": db>=40?"#0e2f1f":"#0d1117";
}
function badgeFor(score){ return score>=95?"◎":(score>=90?"◯":"×"); }
function setAdvice(c){
  const abs=Math.abs(c); const a=ui.advice;
  if(abs>50){ a.className="bad"; a.textContent="頑張ろう！"; }
  else if(abs>15){ a.className="warn"; a.textContent=`${Math.round(abs)}c ${c>0?"高い":"低い"}`; }
  else { a.className="good"; a.textContent="いい感じ！"; }
}
function goNextNote(){
  state.idx++;
  if(state.idx >= state.total){
    $("#result").classList.add("show"); $("#result").setAttribute("aria-hidden","false");
    const ok = state.passRecorded.filter(v=>typeof v==="number").length;
    const avg = Math.round(state.passRecorded.reduce((a,b)=>a+(b||0),0)/Math.max(1,ok));
    ui.praise.textContent = ok===state.total ? "Perfect!! 🎉" : "Good job! ✅";
    ui.details.textContent = `合格 ${ok}/${state.total} 音、平均 ${isFinite(avg)?avg:0} 点`;
    hardStop("完了"); return;
  }
  const rel = state.idx - state.offset;
  if(rel<0 || rel>15){ state.offset = Math.floor(state.idx/16)*16; renderPage(); }
  highlightCurrentNote(); updateProgressUI();
}

// ============ 花火エンジン（長寿命・派手） ============
const sparks = [];
let sparkRunning = false;
function ensureSparkLoop(){
  if(sparkRunning) return; sparkRunning = true;
  const cvs = ui.spark; const ctx = cvs.getContext("2d");
  function loop(){
    if(!sparkRunning) return;
    const W = cvs.width=cvs.clientWidth, H=cvs.height=cvs.clientHeight;
    ctx.clearRect(0,0,W,H);
    const t = now();
    for(let i=sparks.length-1;i>=0;i--){
      const p = sparks[i];
      const life = (t - p.t0);
      if(life>p.life){ sparks.splice(i,1); continue; }
      // 物理
      p.vy += 0.010; p.x += p.vx; p.y += p.vy; p.size *= 0.995; p.alpha *= 0.985;
      // 描画
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.6,p.size), 0, Math.PI*2); ctx.fill();
    }
    if(sparks.length===0){ sparkRunning=false; return; }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
function addBurst(x,y,{count=120, life=900, color="hsl(140,100%,65%)"}={}){
  const cvs = ui.spark;
  for(let i=0;i<count;i++){
    const sp = (Math.random()*2-1)*Math.PI; // 半球にしない：放射
    const speed = 1 + Math.random()*3.6;
    sparks.push({
      x, y, vx:Math.cos(sp)*speed, vy:Math.sin(sp)*speed - 1.2,
      size: 1.6 + Math.random()*2.2, alpha: 1.0,
      t0: now(), life: life + Math.random()*400, color
    });
  }
  ensureSparkLoop();
}

// 強さと色を |c| から決定
function fireworkFor(score, centsAbs, xy){
  const base = Math.round(24 * Math.exp((score-85)/6)); // 指数増加
  const count = clamp(base, 16, 320);
  let col;
  if(centsAbs<=1) col="hsl(5,100%,65%)";        // ほぼ完璧→赤
  else if(centsAbs<=3) col="hsl(210,100%,65%)"; // ±3内→青
  else col="hsl(140,100%,65%)";                 // ギリギリ→緑
  addBurst(xy.x, xy.y, {count, life: 1100, color: col});
  hudFlash(score>=99?1: score>=95?0.8:0.55);
}

// メインループ
function loop(){
  if(!state.running || !state.analyser){ return; }
  state.rafId = requestAnimationFrame(loop);
  const t = now(); const dt = (state.lastT? (t-state.lastT)/1000 : 0.016); state.lastT=t;

  state.analyser.getFloatTimeDomainData(state.buf);
  const res = autoCorrelate(state.buf, state.ac.sampleRate);
  const freq = res.freq||0;

  // 針（近傍半音）
  const needleC = nearestSemitoneCents(freq||A4);
  updateNeedle(needleC, dt);

  if(!res.alive){ ui.bigScore.textContent="—"; ui.advice.textContent="待機中…"; return; }

  // バー（ターゲット基準）
  const fRef = targetFreq(); const cents = 1200*Math.log2((freq||fRef)/fRef);
  const x = clamp((cents+50)/100, 0, 1); ui.barNeedle.style.left = `calc(${x*100}% - 1px)`;
  ui.bar.classList.toggle("hint-low", cents<-7); ui.bar.classList.toggle("hint-high", cents>7);

  const score = clamp(100 - Math.abs(cents)*2, 0, 100)|0;
  ui.bigScore.textContent = String(score);
  setAdvice(cents);

  const rel = state.idx - state.offset; if(rel<0 || rel>15) return;
  if(performance.now() < state.lockUntil) return;

  const passBand = state.diffCents;
  const abs = Math.abs(cents);

  if(abs <= passBand){
    if(state.passRecorded[state.idx]==null){
      state.passRecorded[state.idx] = score;
      const xy = pageAPI.getXY(rel);
      pageAPI.badge(rel, score>=95?"◎": (score>=90?"◯":"×"));
      fireworkFor(score, abs, xy);
      if(rel===15){
        state.lockUntil = performance.now() + 180;
        goNextNote(); return;
      }
      state.lockUntil = performance.now() + 200;
      goNextNote(); return;
    }
  }else if(abs>50){
    // 別の音：採点しない
  }
}

// 目盛を初期化
(function buildTicks(){
  const g=$("#tickset"); if(!g) return;
  g.innerHTML="";
  for(let c=-50;c<=50;c+=5){
    const ang = (c/50)*60 * Math.PI/180;
    const cx=0, cy=60, R=60;
    const x1 = cx + Math.sin(ang)*R;
    const y1 = cy - Math.cos(ang)*R;
    const len = (c%25===0?10:(c%10===0?7:5));
    const x2 = cx + Math.sin(ang)*(R-len);
    const y2 = cy - Math.cos(ang)*(R-len);
    const l=document.createElementNS("http://www.w3.org/2000/svg","line");
    l.setAttribute("x1",x1); l.setAttribute("y1",y1);
    l.setAttribute("x2",x2); l.setAttribute("y2",y2);
    l.setAttribute("class","tick"+(c%25===0?" major":""));
    g.appendChild(l);
  }
})();

// バージョン
ui.ver.textContent = "v1.8.0";
