// ====== 共有UI: トースト通知 ======
let toastTimer;
function notify(msg, level='warn', ms=3500) {
  const el = document.getElementById('toast');
  el.className = `${level} show`; el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.className = el.className.replace('show',''), ms);
}

// ====== 前提チェック（HTTPS / 権限API / iOS注意）======
async function preflightChecks() {
  if (!window.isSecureContext) notify('このページはHTTPSで開いてください。マイクが使えません。', 'error', 6000);
  if (!('mediaDevices' in navigator)) notify('この端末ではマイクAPIが利用できません。', 'error', 6000);
  if (!window.Vex) notify('五線譜ライブラリの読込に失敗しました。再読み込みしてください。', 'error', 6000);
  const isiOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (isiOS) notify('iPhoneは「消音スイッチOFF」「音量UP」でご利用ください。', 'info', 5000);
  try {
    const st = await navigator.permissions?.query({ name: 'microphone' });
    if (st && st.state === 'denied') notify('マイク権限が拒否されています。ブラウザ設定から許可してください。', 'error', 6000);
  } catch {}
}

// ====== 五線譜描画（VexFlow）======
let vfCtx = null;
function renderStaff(noteName="A4") {
  const Vex = window.Vex; // from CDN
  const div = document.getElementById('staff');
  div.innerHTML = "";
  const renderer = new Vex.Flow.Renderer(div, Vex.Flow.Renderer.Backends.SVG);
  const w = div.clientWidth || 360, h = 120;
  renderer.resize(w, h);
  const context = renderer.getContext();
  const stave = new Vex.Flow.Stave(10, 10, w - 20);
  stave.addClef("treble");
  stave.setContext(context).draw();

  const keys = noteToVexKey(noteName); // 例 "A/4"
  const note = new Vex.Flow.StaveNote({ keys:[keys], duration:"w", clef:"treble" });
  // シャープ/フラット付与
  const acc = noteName.match(/(#|b)/)?.[0];
  if (acc === "#") note.addModifier(new Vex.Flow.Accidental("#"), 0);
  if (acc === "b") note.addModifier(new Vex.Flow.Accidental("b"), 0);

  const voice = new Vex.Flow.Voice({num_beats: 1, beat_value: 1});
  voice.addTickables([note]);
  new Vex.Flow.Formatter().joinVoices([voice]).format([voice], w-40);
  voice.draw(context, stave);
  vfCtx = { renderer, context, stave };
}
function noteToVexKey(n) {
  // "A4" "C#5" -> "A/4" "C#/5"
  const m = n.match(/^([A-Ga-g])([#b]?)(\d)$/);
  const L = m[1].toUpperCase(), acc = m[2] || "", o = m[3];
  return `${L}${acc}/${o}`;
}

// ====== 音名→周波数（A4=442Hz 基準） ======
const A4_REF_HZ = 442; // ★指定どおり
function noteToFreq(n, a4=A4_REF_HZ) {
  // 12平均律、A4基準
  const SEMI_FROM_A = {C: -9, "C#": -8, Db:-8, D:-7, "D#":-6, Eb:-6, E:-5, F:-4, "F#":-3, Gb:-3,
                       G:-2, "G#":-1, Ab:-1, A:0, "A#":1, Bb:1, B:2};
  const m = n.match(/^([A-Ga-g])([#b]?)(\d)$/);
  if (!m) return a4;
  let L = m[1].toUpperCase(), acc = m[2]||"", oct = parseInt(m[3],10);
  // フラット→等価シャープに寄せる（簡便）
  const name = acc==="#" ? `${L}#`
              : acc==="b" ? ({A:"G#",B:"A#",C:"B",D:"C#",E:"D#",F:"E",G:"F#"}[L]||L)
              : L;
  const semi = SEMI_FROM_A[name] ?? 0;
  const nSemis = (oct-4)*12 + semi;
  return a4 * Math.pow(2, nSemis/12);
}
function centsDiff(f_est, f_tgt) {
  return 1200 * Math.log2(f_est / f_tgt);
}

// ====== 点数（100点満点・軽量カーブ）=====
function scoreFromCents(absC) {
  if (absC <= 5) return 100;
  if (absC <=10) return Math.max(0, Math.round(100 - 3*(absC-5)));
  if (absC <=25) return Math.max(0, Math.round(85 - 2.33*(absC-10)));
  if (absC <=50) return Math.max(0, Math.round(50 - 2*(absC-25)));
  return 0;
}
function feedbackText(c) {
  if (Math.abs(c) <= 5) return "とても良いです。安定しています。";
  if (c > 5 && c <= 15) return "やや高めです。ほんの少し下げてください。";
  if (c < -5 && c >= -15) return "やや低めです。ほんの少し上げてください。";
  if (Math.abs(c) <= 30) return "ズレが大きいです。開放弦基準で合わせ直してください。";
  return "音程が外れています。ポジション／指置きを確認してください。";
}

// ====== UI参照 ======
const bigScoreEl = document.getElementById('big-score');
const feedbackEl = document.getElementById('feedback');
const needleEl = document.getElementById('needle');
const noteSel = document.getElementById('note-select');
const modeSel = document.getElementById('mode');
const btnStart = document.getElementById('start');
const btnStop = document.getElementById('stop');
const btnRandom = document.getElementById('random');

// ★ランダム出題のプール（A4を除くテスト用5音）
const TEST_NOTES = ['B4','C5','D5','E5','F5'];

// ====== オーディオ初期化 ======
let ac, workletNode, mic, running=false, targetFreq = noteToFreq(noteSel.value);
let lowLevelSince = 0, lastPitchWarn = 0;

function colorScore(s){
  bigScoreEl.classList.remove('green','yellow','red');
  if (s >= 90) bigScoreEl.classList.add('green');
  else if (s >= 60) bigScoreEl.classList.add('yellow');
  else bigScoreEl.classList.add('red');
}

function updateNeedle(cents) {
  // -50c .. +50c をバー幅100%にマップ
  const clamped = Math.max(-50, Math.min(50, cents));
  const pct = (clamped + 50) / 100; // 0..1
  needleEl.style.left = `calc(${pct*100}% - 1px)`;
}

function onPitchMessage(ev) {
  const { f0, conf, rms, dropped } = ev.data || {};
  const now = performance.now();

  if (dropped) notify('処理が追いついていません。他アプリを閉じてください。', 'warn', 3000);

  // 入力レベル監視
  if (rms < 0.01) {
    if (!lowLevelSince) lowLevelSince = now;
    if (now - lowLevelSince > 1500) {
      notify('入力が小さいです。マイクを近づけるか音量を上げてください。', 'warn', 2500);
      lowLevelSince = now;
    }
  } else lowLevelSince = 0;

  // ピッチ未検出
  if (!f0 || conf < 0.5) {
    if (now - lastPitchWarn > 2000) {
      feedbackEl.textContent = "検出が不安定です。一定の弓圧で弾いてください。";
      lastPitchWarn = now;
    }
    return;
  }

  const cents = centsDiff(f0, targetFreq);
  const sc = scoreFromCents(Math.abs(cents));
  bigScoreEl.textContent = String(sc);
  colorScore(sc);
  feedbackEl.textContent = feedbackText(cents);
  updateNeedle(cents);
}

function handleGetUserMediaError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    notify('マイク権限が拒否されました。サイトの権限設定で「マイクを許可」にしてください。', 'error', 6000);
  } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    notify('マイクデバイスが見つかりません。外部マイクの接続を確認してください。', 'error', 6000);
  } else if (name === 'NotReadableError') {
    notify('他のアプリがマイクを使用中です。使用中のアプリを終了してください。', 'error', 6000);
  } else if (name === 'OverconstrainedError') {
    notify('要求した音声条件に合うマイクがありません。別のマイク設定でお試しください。', 'error', 6000);
  } else {
    notify(`マイク起動エラー: ${name || err}`, 'error', 6000);
  }
}

// ====== 開始・停止 ======
async function start() {
  if (running) return;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
    watchAudioState(ac);
    await ac.audioWorklet.addModule('./pitch-worklet.js').catch(()=>{
      notify('解析モジュールの読込に失敗しました。パスをご確認ください。', 'error', 6000);
      throw new Error('worklet load failed');
    });
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false }
    });
    mic = ac.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(ac, 'pitch-detector', { numberOfInputs:1, numberOfOutputs:0 });
    workletNode.port.onmessage = onPitchMessage;
    mic.connect(workletNode);
    running = true;
    btnStart.disabled = true; btnStop.disabled = false;
    notify('音声処理を開始しました。', 'info', 1500);
  } catch (e) {
    handleGetUserMediaError(e);
  }
}
function stop() {
  if (!running) return;
  try { mic && mic.disconnect(); } catch {}
  try { workletNode && workletNode.port.close(); } catch {}
  try { ac && ac.close(); } catch {}
  running = false;
  btnStart.disabled = false; btnStop.disabled = true;
  bigScoreEl.textContent = "--"; bigScoreEl.className = ""; feedbackEl.textContent = "停止中";
  updateNeedle(0);
  notify('停止しました。', 'info', 1500);
}

function watchAudioState(ac) {
  if (ac.state !== 'running') notify('音声処理が一時停止中です。「開始」ボタンを押してください。', 'warn', 2500);
  ac.onstatechange = () => {
    if (ac.state === 'suspended') notify('音声処理が停止しました。「開始」を押してください。', 'warn', 3000);
  };
}

// ====== 課題音の変更（セレクタ／ランダム） ======
function setTargetNote(n) {
  // セレクタ表示も合わせる
  const opts = Array.from(noteSel.options).map(o=>o.value);
  if (opts.includes(n)) noteSel.value = n;
  targetFreq = noteToFreq(n);
  renderStaff(n);
  // 変更直後はスコアをリセット表示
  bigScoreEl.textContent = "--"; bigScoreEl.className = "";
  feedbackEl.textContent = `課題音：${n}（A=442Hz）`;
  updateNeedle(0);
}

function randomPick() {
  const idx = Math.floor(Math.random() * TEST_NOTES.length);
  return TEST_NOTES[idx];
}

// ====== イベント ======
btnStart.addEventListener('click', start);
btnStop.addEventListener('click', stop);
noteSel.addEventListener('change', ()=> setTargetNote(noteSel.value));
btnRandom.addEventListener('click', ()=> setTargetNote(randomPick()));
modeSel.addEventListener('change', ()=>{
  if (modeSel.value !== 'single') notify('3度は後日追加予定です（単音で練習できます）。', 'info', 4000);
});

// 初期化
await preflightChecks();
setTargetNote(noteSel.value);  // 既定はA4
updateNeedle(0);
