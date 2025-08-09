export const ALL_KEYS = ["G","D","A","E","C","F","Bb","Eb","Ab","B","F#","C#"];

const NAT = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
export const KEY_SIG = {
  "C":  {sharps:[], flats:[]},
  "G":  {sharps:["F"], flats:[]},
  "D":  {sharps:["F","C"], flats:[]},
  "A":  {sharps:["F","C","G"], flats:[]},
  "E":  {sharps:["F","C","G","D"], flats:[]},
  "B":  {sharps:["F","C","G","D","A"], flats:[]},
  "F#": {sharps:["F","C","G","D","A","E"], flats:[]},
  "C#": {sharps:["F","C","G","D","A","E","B"], flats:[]},
  "F":  {sharps:[], flats:["B"]},
  "Bb": {sharps:[], flats:["B","E"]},
  "Eb": {sharps:[], flats:["B","E","A"]},
  "Ab": {sharps:[], flats:["B","E","A","D"]},
};

function toVex(letter, octave){ return `${letter}/${octave}`; }
const STEP = [2,2,1,2,2,2,1]; // 長音階（ttsttts）

/** 指定 Key のトニック音のピッチクラス（C=0） */
function tonicPC(key){
  const map={C:0,"G":7,"D":2,"A":9,"E":4,"B":11,"F#":6,"C#":1,"F":5,"Bb":10,"Eb":3,"Ab":8};
  return map[key];
}
/** Violin range (G3 ≈ 55Hz) to (E7 ≈ high end) →  G3..E6 目標 */
const MIN_OCT=3, MAX_OCT=6;

/** Keyに応じて、可能ならG3付近から2オクターブの音階を組む */
export function buildMajorScale(key){
  const pcT = tonicPC(key);
  // トニックの開始オクターブを決める（G3〜A3 を優先して低音から）
  let startOct = 3;
  if(key==="C"||key==="D"||key==="E"||key==="F") startOct=3;
  if(key==="B"||key==="F#"||key==="C#"||key==="Ab") startOct=3;
  // 2オクターブの上行
  const up = [];
  let pc = pcT; let octave = startOct;
  const letters = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]; // 参照用
  // Key Signatureを踏まえて「綴り」は基本的に C D E F G A B を使い、昇降は調号で反映
  const seqLetters = ["C","D","E","F","G","A","B"];
  let idxL = seqLetters.indexOf(letters[pc].replace("#","").replace("B","")); // 近似

  function letterByPc(pcVal){
    const naturals = Object.entries(NAT).find(([L,v])=>v=== (pcVal%12+12)%12 );
    if(naturals) return naturals[0];
    // # 系（F#など）は letterFreq 側で調号から半音処理するので、基本は近い自然名を返す
    const table=[["C",1],["D",3],["F",6],["G",8],["A",10]];
    let pick="C", best=99;
    table.forEach(([L,semi])=>{ const d=Math.min((semi-(pcVal%12)+12)%12, (pcVal%12 -semi +12)%12); if(d<best){best=d;pick=L;} });
    return pick;
  }

  // 上行16音（2オクターブ＋戻り）
  up.push({letter:letterByPc(pc), octave});
  for(let i=0;i<14;i++){
    const step = STEP[i%7];
    pc = (pc + step) % 12;
    if(pc===0 || pc===2 || pc===4 || pc===5 || pc===7 || pc===9 || pc===11){ /* natural */ }
    if((pc===0) && up.length>1) octave++; // B→C をまたぐとき
    up.push({letter:letterByPc(pc), octave:octave});
  }
  // 上行の頂点をもう1音入れて16音に
  const last = up[up.length-1]; up.push({letter:last.letter, octave:last.octave});

  // 下行（16音）：上の逆順
  const down = [...up].reverse();

  // 2段目：3度進行（上→下 16音）
  const third = [];
  const line = [...up.slice(0,8), ...up.slice(8,16)]; // 16音基準の音列
  for(let i=0;i<8;i++){
    const a=line[i], b=line[Math.min(i+2,line.length-1)];
    third.push(a, b);
  }
  const thirdDown = [...third].reverse();

  // 1段目16音、2段目16音（合計32）
  const notes = [...up, ...down].slice(0,16);
  const notes2 = [...third, ...thirdDown].slice(0,16);
  const all = [...notes, ...notes2];

  return {
    id:key,
    keySignature:key,
    vexKeys: all.map(n=>toVex(n.letter, n.octave)),
    noteObjs: all
  };
}

export function letterFreq(letter, octave, key, a4=442){
  // 調号を適用（F#, C#, … / B♭, E♭, …）
  const sig = KEY_SIG[key] || KEY_SIG["C"];
  let semi = NAT[letter]; // 自然音半音
  if(Array.isArray(sig.sharps) && sig.sharps.includes(letter)) semi += 1;
  if(Array.isArray(sig.flats)  && sig.flats.includes(letter))  semi -= 1;
  // A4 の半音距離
  const n = (octave-4)*12 + (semi-9); // A=9
  return a4 * Math.pow(2, n/12);
}
