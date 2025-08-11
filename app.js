// app.js
// 音声パイプライン（HPF/Peaking/Analyser）、自己相関＋放物線補間、RMS→dB、
// 採点・自動進行・火花、針サーボ、許可ゲート、バックグラウンド即停止、エラーログ。

import { A4, getKeys, makeExerciseAll, letterFreqWithAcc } from "./scales.js";
import { renderTwoBars } from "./score.js";

// ───────── ユーティリティ ─────────
const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const now=()=>performance.now();

const errors = new Set();
function pushErr(msg){
  const line = `${new Date().toISOString()} : ${msg}`;
  if(!errors.has(line)) errors.add(line);
}
function showToast(msg,type="info",tiny=false){
  const t=$("#toast"); if(!t) return;
  t.textContent = msg; t.className = tiny?`show tiny ${type}`:`show ${type}`;
  setTimeout(()=>{ t.classList.remove("show","tiny","info","warn","error"); }, 1800);
}
function hudFlash(intensity=1){
  const el=$("#hud-flash"); el.classList.add("show");
  el.style.opacity = String(Math.min(0.18, 0.08 + 0.12*intensity));
  setTimeout(()=>el.classList.remove("show"), 120);
}

// ───────── DOM参照 ─────────
const ui = {
  // header
  scaleType: $$('input[name="scaleType"]'),
  level: $$('input[name="level"]'),
  keySel: $("#key-select"),
  diffSel: $("#difficulty"),
  rms: $("#rms"),
  db: $("#db-indicator"),
  ver: $("#app-version"),
  // controls
  start: $("#start"), stop: $("#stop"), log: $("#show-errors"),
  // hud
  bigScore: $("#big-score"), advice: $("#advice"),
  bar: $("#cents-bar"), barNeedle: $("#bar-needle"),
  analogHand: $("#hand"), tickset: $("#tickset"),
  // score
  staffWrap: $("#staff-wrap"), spark: $("#spark"),
  prog: $("#prog"), pageLabel: $("#page-label"),
  // modals
  gate: $("#gate"), permit: $("#permit"),
  result: $("#result"), praise: $("#praise"), details: $("#details"),
  again: $("#again"), close: $("#close"),
  errModal: $("#error-modal"), errList: $("#error-list"),
  errCopy: $("#err-copy"), errClose: $("#err-close"),
  noSleep: $("#nosleep"),
};

// ───────── グローバル状態 ─────────
const difficultyToCents = { easy:7, normal:5, hard:2 };
let state = {
  visible: document.visibilityState === "visible",
  running: false,
  gateReady: false,
  stream: null,
  ac: null,
  nodes: null,
  analyser: null,
  buf: null,
  lastT: 0,
  // needle servo
  servo: { pos:0, vel:0 },
  // selection
  scaleType: "major",
  level: "advanced",
  key: null,
  notes: [],          // すべての音（NoteObj）
  total: 0,
  totalBars: 0,       // 1小節=8音
  offset: 0,          // ページ先頭（16刻み）
  idx: 0,             // 現在の絶対インデックス（0..total-1）
  lockUntil: 0,       // 連続同音暴走防止ロック（ms）
  passRecorded: [],   // 合格スコア（null/number）
  failed: new Set(),  // ×をつけたインデックス
  rmsThresh: parseFloat(ui.rms.value||"0.0015"),
  diffCents: difficultyToCents[ui.diffSel.value],
};

// 画面可視／不可視で強制停止（Safariバックグラウンド対策）
["visibilitychange","webkitvisibilitychange","pagehide","freeze","blur"].forEach(ev=>{
  window.addEventListener(ev, ()=>{
    state.visible = document.visibilityState === "visible";
    if(!state.visible) hardStop("非可視で停止");
  }, {passive:true});
});

// staffが画面外なら安全側で停止（「特定の画面以外では動かない」）
const screenObserver = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{
    if(state.running && !e.isIntersecting) hardStop("譜面が非表示で停止");
  });
},{ threshold:0.15 });
screenObserver.observe(ui.staffWrap);

// ───────── スケール選択・初期化 ─────────
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
  state.offset = 0;
  state.idx = 0;
  state.passRecorded = Array(state.total).fill(null);
  state.failed.clear();
  renderPage();
  updateProgressUI();
}

let pageAPI = null;
function renderPage(){
  pageAPI = renderTwoBars({ key: state.key, notes: state.notes, offset: state.offset });
  // すべて白に戻し、現在ターゲットのみ緑に
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
  for(let i=0;i<16;i++){
    pageAPI.recolor(i, i===rel ? "note-target" : "note-normal");
  }
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
ui.rms.addEventListener("input", e=>{ state.rmsThresh = parseFloat(e.target.value)||0.0015; });

// 初期ロード
populateKeys(); loadExercise();

// ───────── 許可ゲート／開始停止 ─────────
window.__permit = async function(){
  ui.gate.classList.remove("show");
  ui.gate.setAttribute("aria-hidden","true");
  try { await start(); } catch(err){ pushErr(err.message||String(err)); showToast("開始に失敗しました","error"); gateBack(); }
};
function gateBack(){
  ui.gate.classList.add("show"); ui.gate.setAttribute("aria-hidden","false");
}
ui.start.addEventListener("click", ()=> window.__permit && window.__permit());
ui.stop.addEventListener("click", ()=> hardStop("停止ボタン"));

ui.log.addEventListener("click", ()=>{
  ui.errList.innerHTML = [...errors].map(s=>`<li><code>${s}</code></li>`).join("") || "<li>なし</li>";
  ui.errModal.classList.add("show"); ui.errModal.setAttribute("aria-hidden","false");
});
ui.errCopy.addEventListener("click", async ()=>{
  await navigator.clipboard.writeText([...errors].join("\n")); showToast("コピーしました");
});
ui.errClose.addEventListener("click", ()=>{ ui.errModal.classList.remove("show"); ui.errModal.setAttribute("aria-hidden","true"); });

// 完了ダイアログ
ui.again.addEventListener("click", ()=>{ ui.result.classList.remove("show"); ui.result.setAttribute("aria-hidden","true"); loadExercise(); gateBack(); });
ui.close.addEventListener("click", ()=>{ ui.result.classList.remove("show"); ui.result.setAttribute("aria-hidden","true"); gateBack(); });

// ───────── 音声処理セットアップ ─────────
async function start(){
  if(!state.visible){ showToast("画面が見えていません","warn"); gateBack(); return; }
  if(state.running) return;
  // 無音1px動画でスリープ抑止（ユーザー操作直後）
  ui.noSleep.play().catch(()=>{});
  // AudioContext / MediaStream
  const ac = new (window.AudioContext||window.webkitAudioContext)({ latencyHint: "interactive" });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1, sampleRate: ac.sampleRate,
      echoCancellation:false, noiseSuppression:false, autoGainControl:false
    }
  });
  const src = ac.createMediaStreamSource(stream);
  // HPF ≈90Hz Q≈0.7
  const hpf = ac.createBiquadFilter(); hpf.type="highpass"; hpf.frequency.value=90; hpf.Q.value=0.7;
  // Peaking fc≈2.5kHz / Q≈1 / +5dB
  const peak = ac.createBiquadFilter(); peak.type="peaking"; peak.frequency.value=2500; peak.Q.value=1; peak.gain.value=5;
  const analyser = ac.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.0;

  src.connect(hpf); hpf.connect(peak); peak.connect(analyser);

  state.ac = ac; state.stream = stream; state.nodes = {src,hpf,peak}; state.analyser = analyser;
  state.buf = new Float32Array(analyser.fftSize);
  state.running = true; document.body.classList.add("running");
  ui.start.disabled = true; ui.stop.disabled = false;
  loop();
}

function hardStop(reason=""){
  if(!state.running && !state.stream && !state.ac) return;
  try{
    cancelAnimationFrame(state.rafId);
  }catch{}
  try{
    if(state.ac?.state!=="closed"){ state.ac.suspend?.(); state.ac.close?.(); }
  }catch(e){ pushErr("AudioContext close失敗: "+(e.message||e)); }
  try{
    state.stream?.getTracks?.().forEach(t=>t.stop());
  }catch(e){ pushErr("MediaStream停止失敗: "+(e.message||e)); }
  state.stream = null; state.ac=null; state.nodes=null; state.analyser=null;
  state.running=false; document.body.classList.remove("running");
  ui.start.disabled = false; ui.stop.disabled = true;
  gateBack();
  if(reason) pushErr(reason);
  // 取りこぼし補完（600–1200ms監視）
  setTimeout(()=>{ try{ state.stream?.getTracks?.().forEach(t=>t.stop()); }catch{} }, 900);
}

// ───────── F0推定：自己相関＋放物線補間 ─────────
const fMin=110, fMax=2200;
function hamming(i,N){ return 0.54 - 0.46 * Math.cos(2*Math.PI*i/(N-1)); }

function autoCorrelate(buf,sr){
  const N = buf.length;
  // power & RMS
  let rms=0; for(let i=0;i<N;i++){ const s=buf[i]*hamming(i,N); buf[i]=s; rms+=s*s; }
  rms = Math.sqrt(rms/N);
  const db = Math.round(clamp(20*Math.log10(Math.max(rms,1e-9)) + 94, 0, 120));
  updateDB(db);

  if(rms < state.rmsThresh) return {freq:0, rms, db, alive:false};
  // ACF
  const size = N;
  let bestOfs=-1, best=0;
  const startOfs = Math.floor(sr/fMax), endOfs = Math.floor(sr/fMin);
  for(let ofs=startOfs; ofs<endOfs; ofs++){
    let sum=0;
    for(let i=0;i<size-ofs;i++) sum += buf[i]*buf[i+ofs];
    if(sum>best){ best=sum; bestOfs=ofs; }
  }
  if(bestOfs<0) return {freq:0, rms, db, alive:false};
  // 放物線補間
  const x1 = bestOfs-1, x2=bestOfs, x3=bestOfs+1;
  const s1 = acfAt(x1), s2=acfAt(x2), s3=acfAt(x3);
  const denom = (s1 - 2*s2 + s3);
  const shift = denom ? 0.5 * (s1 - s3) / denom : 0;
  const T = (bestOfs + shift) / sr;
  const freq = 1/T;
  return {freq, rms, db, alive:true};

  function acfAt(ofs){
    let sum=0; for(let i=0;i<size-ofs;i++) sum+=buf[i]*buf[i+ofs]; return sum;
  }
}

// ───────── 針サーボ（2次） ─────────
// ±50c→±60°。デッドバンド±1c。近接でζを0.95に。
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

// ───────── 採点・進行 ─────────
function centsFrom(freq, refFreq){ return 1200*Math.log2(freq/refFreq); }
function nearestSemitoneCents(freq){
  if(freq<=0) return 0;
  const n = Math.round(12*Math.log2(freq/A4));
  const ref = A4 * Math.pow(2, n/12);
  return 1200*Math.log2(freq/ref);
}

function targetFreq(){
  const note = state.notes[state.idx];
  return letterFreqWithAcc(note, A4);
}

function intensityFromScore(score){
  // 指数増加：85→ほぼ0、100→大量（~200粒）
  const s = clamp(score, 0, 100);
  const n = Math.round(16 * Math.exp((s-85)/6)); // 85: ~16, 95: ~73, 100: ~195
  return clamp(n, 8, 240);
}

function sparkAt(x,y,score){
  const cvs = ui.spark; const ctx = cvs.getContext("2d");
  const rect = cvs.getBoundingClientRect(); const W = cvs.width=cvs.clientWidth; const H=cvs.height=cvs.clientHeight;
  const n = intensityFromScore(score);
  const hue = score>=99?150: (score>=95?120:100);
  const particles=[];
  for(let i=0;i<n;i++){
    particles.push({
      x, y, vx:(Math.random()*2-1)*2.2, vy:(-Math.random()*1.5-1.2)* (1+Math.random()*0.8),
      life: 220 + Math.random()*200, size: 1.3+Math.random()*1.6,
      alpha: 1.0
    });
  }
  const born = now();
  function step(){
    const t = now()-born;
    ctx.clearRect(0,0,W,H);
    particles.forEach(p=>{
      p.vy += 0.015; p.x += p.vx; p.y += p.vy;
      p.alpha *= 0.985; p.life -= 16;
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = `hsl(${hue},100%,70%)`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
    });
    if(t<300) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function badgeFor(score){
  if(score>=95) return "◎";
  if(score>=90) return "◯";
  return "×";
}

function setAdvice(c){
  const a = ui.advice;
  const abs = Math.abs(c);
  let msg=""; let cls="";

  if(abs>50){ msg="頑張ろう！"; cls="bad"; }
  else if(abs>15){ msg = `${Math.round(abs)}c ${c>0?"高い":"低い"}`; cls="warn"; }
  else { msg="いい感じ！"; cls="good"; }
  a.className = cls ? cls : "";
  a.textContent = msg;
}

function updateDB(db){
  const el = ui.db;
  el.textContent = `${db} dB`;
  el.style.background = db>=80?"#3b0e0e": db>=70?"#3b2a0e": db>=40?"#0e2f1f":"#0d1117";
}

function goNextNote(){
  state.idx++;
  if(state.idx >= state.total){
    // 完了
    ui.result.classList.add("show"); ui.result.setAttribute("aria-hidden","false");
    const okCount = state.passRecorded.filter(v=>typeof v==="number").length;
    const avg = Math.round(state.passRecorded.reduce((a,b)=>a+(b||0),0)/Math.max(1,okCount));
    ui.praise.textContent = okCount===state.total ? "Perfect!! 🎉" : "Good job! ✅";
    ui.details.textContent = `合格 ${okCount}/${state.total} 音、平均 ${isFinite(avg)?avg:0} 点`;
    hardStop("完了");
    return;
  }

  // ページめくり：そのページ最後(相対=15)で合格済なら即めくり
  const rel = state.idx - state.offset;
  if(rel<0 || rel>15){
    // 新しいページ
    state.offset = Math.floor(state.idx/16)*16;
    renderPage();
  }
  highlightCurrentNote();
  updateProgressUI();
}

// ───────── メインループ ─────────
function loop(){
  if(!state.running || !state.analyser){ return; }
  state.rafId = requestAnimationFrame(loop);
  const t = now(); const dt = (state.lastT? (t-state.lastT)/1000 : 0.016); state.lastT=t;

  // 解析
  state.analyser.getFloatTimeDomainData(state.buf);
  const res = autoCorrelate(state.buf, state.ac.sampleRate);
  const freq = res.freq||0;

  // 針（近傍半音基準）
  const needleC = nearestSemitoneCents(freq||A4);
  updateNeedle(needleC, dt);

  if(!res.alive){ ui.bigScore.textContent="—"; ui.advice.textContent="待機中…"; return; }

  // ターゲット基準バー
  const fRef = targetFreq();
  const cents = 1200*Math.log2((freq||fRef)/fRef);
  const x = clamp((cents+50)/100, 0, 1); // 0..1
  ui.barNeedle.style.left = `calc(${x*100}% - 1px)`;
  ui.bar.classList.toggle("hint-low", cents<-7);
  ui.bar.classList.toggle("hint-high", cents>7);

  // スコア（参考表示）
  const score = clamp(100 - Math.abs(cents)*2, 0, 100)|0;
  ui.bigScore.textContent = String(score);
  $("#mini-score").textContent = String(score);
  setAdvice(cents);

  // 採点
  const rel = state.idx - state.offset;
  if(rel<0 || rel>15) return; // ページ外
  if(performance.now() < state.lockUntil) return;

  const passBand = state.diffCents; // ±2/5/7
  if(Math.abs(cents) <= passBand){
    // 合格（初回のみ確定）
    if(state.passRecorded[state.idx]==null){
      state.passRecorded[state.idx] = score;
      // バッジ／火花
      const {x:px, y:py} = pageAPI.getXY(rel);
      sparkAt(px, py, score);
      hudFlash(score>=99?1: score>=95?0.7:0.45);
      pageAPI.badge(rel, badgeFor(score));
      // ページ最後なら即めくり
      if(rel===15){
        state.lockUntil = performance.now() + 180;
        goNextNote();
        return;
      }
      // 次へ（200ms空けてから）
      state.lockUntil = performance.now() + 200;
      goNextNote();
      return;
    }
  }else if(Math.abs(cents)>50){
    // 別の音：採点しない
  }else{
    // 不合格を確定させる必要はないが、明確な外しに×バッジを出すことも可能
  }
}

// ───────── 目盛（初期化済み）、開始ヘルパ ─────────
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

// バージョン表示
ui.ver.textContent = "v1.7.0";
