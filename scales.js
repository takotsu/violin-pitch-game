// scales.js  v0-1 — 3オクターブ長音階（上行24音＋下行24音=48音）／A4=442Hz／バイオリン域 G3–E7 に収める
export const KEY_SIG = {
  "C":{sharps:[],flats:[]},
  "G":{sharps:["F"],flats:[]},
  "D":{sharps:["F","C"],flats:[]},
  "A":{sharps:["F","C","G"],flats:[]},
  "E":{sharps:["F","C","G","D"],flats:[]},
  "B":{sharps:["F","C","G","D","A"],flats:[]},
  "F#":{sharps:["F","C","G","D","A","E"],flats:[]},
  "C#":{sharps:["F","C","G","D","A","E","B"],flats:[]},
  "F":{flats:["B"],sharps:[]},
  "Bb":{flats:["B","E"],sharps:[]},
  "Eb":{flats:["B","E","A"],sharps:[]},
  "Ab":{flats:["B","E","A","D"],sharps:[]}
};

const LETTERS = ["C","D","E","F","G","A","B"];
const nextL = (L)=> LETTERS[(LETTERS.indexOf(L)+1)%7];

// 調ごとの標準開始音（バイオリン実用スタート）
const START = {
  "G":["G",3],
  "D":["D",3],
  "A":["A",3],
  "C":["C",4],
  "F":["F",3],
  "Bb":["Bb",3],
  "Eb":["Eb",4],
  "E":["E",4],
  "B":["B",3],
  "F#":["F#",3],
  "Ab":["Ab",3],
  "C#":["C#",4]
};

// A4=442Hz 基準のピッチクラス
const PC = {"C":-9,"C#":-8,"Db":-8,"D":-7,"D#":-6,"Eb":-6,"E":-5,"F":-4,"F#":-3,"Gb":-3,"G":-2,"G#":-1,"Ab":-1,"A":0,"A#":1,"Bb":1,"B":2};

// A4=442Hz
export function letterFreq(letter, octave, key="C"){
  const L = applyKeySig(letter, key);
  const pc = PC[L];
  const n = (octave-4)*12 + pc;
  return 442*Math.pow(2,n/12);
}

function applyKeySig(letter, key){
  const sig = KEY_SIG[key] || KEY_SIG.C;
  if (sig.sharps.includes(letter)) return letter + "#";
  if (sig.flats.includes(letter))  return letter + "b";
  return letter;
}

// バイオリン実用レンジ
const V_MIN = {letter:"G", octave:3};
const V_MAX = {letter:"E", octave:7};
const freqOf = (o,key)=>letterFreq(o.letter,o.octave,key);

// 1オクターブ分の長音階（度数 1..8）
function oneOct(rootL,rootO){
  const deg = ["1","2","3","4","5","6","7","8"];
  const arr = [];
  let L = rootL, O = rootO;
  for(let i=0;i<deg.length;i++){
    arr.push({letter:L, octave:O});
    const next = nextL(L);
    if((L==="E" && next==="F") || (L==="B" && next==="C")) O += 1; // 半音進行でオクターブUP
    L = next;
  }
  return arr;
}

// 3オクターブ長音階（境界の8度は重ねて合計24音）→ 上行24 + 下行24 = 48
function build3OctSequence(startLetter, startOct){
  const up1 = oneOct(startLetter,startOct);
  const up2 = oneOct(up1[up1.length-1].letter, up1[up1.length-1].octave);
  const up3 = oneOct(up2[up2.length-1].letter, up2[up2.length-1].octave);
  const up24 = [...up1, ...up2, ...up3];      // 24
  const down24 = [...up24].reverse();         // 24
  return up24.concat(down24);                 // 48
}

// 3オクターブ長音階を生成し、G3〜E7に収める（必要なら開始オクターブ±1して再生成）
export function makeMajorScale3Oct(key="G"){
  let [letter,oct] = START[key] || ["G",3];

  // 収まるまで最大3回まで調整
  for(let t=0; t<3; t++){
    const notes = build3OctSequence(letter,oct);
    const fmin = freqOf(notes[0], key);
    const fmax = freqOf(notes[23], key); // 上行の最後（24音目）が最高音
    const okLow  = fmin >= freqOf(V_MIN,key);
    const okHigh = fmax <= freqOf(V_MAX,key);
    if(okLow && okHigh){
      return { keySignature:key, notes };
    }
    // 上がはみ出る → 開始を1オクターブ下げる
    if(!okHigh) { oct -= 1; continue; }
    // 下がはみ出る → 開始を1オクターブ上げる
    if(!okLow)  { oct += 1; continue; }
  }
  // 収束しない場合は最後に生成して返す
  return { keySignature:key, notes: build3OctSequence(letter,oct) };
}

// VexFlow の keys 文字列へ
export function toVexKeys(objs, key="C"){
  return objs.map(o => `${applyKeySig(o.letter,key)}/${o.octave}`);
}
