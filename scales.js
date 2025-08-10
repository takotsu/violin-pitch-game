// scales.js v0-4 — A4=442Hz。バイオリン実用音域 G3〜E7 に厳密制限。
// 小野アンナの3オク長音階（上行24音＋下行24音 = 48音）を、開始オクターブを自動調整して収める。

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

// 推奨の開始音（小野アンナの並びを踏襲：開放弦/1stポジション起点）
const START_BASE = {
  "G":["G",3], "D":["D",3], "A":["A",3],
  "C":["C",4], "F":["F",3], "Bb":["Bb",3],
  "Eb":["Eb",4], "E":["E",4], "B":["B",3],
  "F#":["F#",3], "Ab":["Ab",3], "C#":["C#",4]
};

const PC = {"C":-9,"C#":-8,"Db":-8,"D":-7,"D#":-6,"Eb":-6,"E":-5,"F":-4,"F#":-3,"Gb":-3,"G":-2,"G#":-1,"Ab":-1,"A":0,"A#":1,"Bb":1,"B":2};

const V_MIN = {letter:"G",oct:3};
const V_MAX = {letter:"E",oct:7};

function applyKeySig(letter, key){
  const sig = KEY_SIG[key] || KEY_SIG.C;
  if (sig.sharps.includes(letter)) return letter + "#";
  if (sig.flats.includes(letter))  return letter + "b";
  return letter;
}
export function letterFreq(letter, octave, key="C"){
  const L = applyKeySig(letter, key);
  const pc = PC[L];
  const n = (octave-4)*12 + pc;
  return 442*Math.pow(2,n/12);
}
function freqOf(o,key){ return letterFreq(o.letter,o.oct,key); }

const LETTERS=["C","D","E","F","G","A","B"];
const nextL = (L)=> LETTERS[(LETTERS.indexOf(L)+1)%7];

function oneOct(rootL,rootO){
  const arr=[]; let L=rootL,O=rootO;
  for(let i=0;i<8;i++){
    arr.push({letter:L,oct:O});
    const N=nextL(L);
    if((L==="E"&&N==="F")||(L==="B"&&N==="C")) O+=1;
    L=N;
  }
  return arr;
}

function build3Oct(startL,startO){
  const up1=oneOct(startL,startO);
  const up2=oneOct(up1[7].letter,up1[7].oct);
  const up3=oneOct(up2[7].letter,up2[7].oct);
  const up=[...up1,...up2,...up3];
  const down=[...up].reverse();
  return up.concat(down); // 48
}

export function makeMajorScale3Oct(key="G"){
  let [L,O] = START_BASE[key] || ["G",3];

  // バイオリン音域に収まるまで開始オクターブを±1で調整（最大3回）
  for(let t=0;t<4;t++){
    const cand = build3Oct(L,O);
    const fmin = freqOf(cand[0], key);
    const fmax = freqOf(cand[23], key); // 上行の最終音
    const okLow = fmin >= freqOf(V_MIN,key);
    const okHigh= fmax <= freqOf(V_MAX,key);
    if(okLow && okHigh) return {keySignature:key, notes:cand};
    if(!okHigh){ O -= 1; continue; }
    if(!okLow){  O += 1; continue; }
  }
  // それでもダメなら、レンジ外は **切り捨て**（表示しない）
  let notes = build3Oct(L,O).filter(o=>{
    const f = freqOf(o,key);
    return f >= freqOf(V_MIN,key) && f <= freqOf(V_MAX,key);
  });
  // 片側欠けを避けるため、上行24が成立しない調は候補から外す想定だが、最低でも12音は確保
  if (notes.length < 24) notes = notes.slice(0,24).concat([...notes.slice(0,24)].reverse());
  return {keySignature:key, notes};
}

export function toVexKeys(objs, key="C"){
  return objs.map(o => `${applyKeySig(o.letter,key)}/${o.oct}`);
}
