// scales.js（全面差し替え）
// A4=442Hz。小野アンナの3oct長音階（度数進行＋調号）を生成し、
// セット全体が Violin 実用域 G3..G6（MIDI 55..91）に必ず収まるよう開始オクターブを自動調整。

export const KEY_SIG = {
  "C":{sharps:[],flats:[]},
  "G":{sharps:["F"],flats:[]},
  "D":{sharps:["F","C"],flats:[]},
  "A":{sharps:["F","C","G"],flats:[]},
  "E":{sharps:["F","C","G","D"],flats:[]},
  "B":{sharps:["F","C","G","D","A"],flats:[]},
  "F#":{sharps:["F","C","G","D","A","E"],flats:[]},
  "F":{flats:["B"],sharps:[]},
  "Bb":{flats:["B","E"],sharps:[]},
  "Eb":{flats:["B","E","A"],sharps:[]},
  "Ab":{flats:["B","E","A","D"],sharps:[]}
};

// Ono Anna の慣用を踏まえた推奨開始（後で G3..G6 へクランプ）
const START_BASE={
  "G":["G",3],"D":["D",3],"A":["A",3],
  "C":["C",4],"F":["F",3],"Bb":["Bb",3],
  "Eb":["Eb",4],"E":["E",4],"B":["B",3],
  "F#":["F#",3],"Ab":["Ab",3]
};

const LETTERS=["C","D","E","F","G","A","B"];
const PC={ // Aを0（A4=442）
  "C":-9,"C#":-8,"Db":-8,"D":-7,"D#":-6,"Eb":-6,"E":-5,"F":-4,
  "F#":-3,"Gb":-3,"G":-2,"G#":-1,"Ab":-1,"A":0,"A#":1,"Bb":1,"B":2
};
const MIDI_MIN=55; // G3
const MIDI_MAX=91; // G6

function applyKeySig(letter,key){
  const s=KEY_SIG[key]||KEY_SIG.C;
  if(s.sharps.includes(letter)) return letter+"#";
  if(s.flats.includes(letter))  return letter+"b";
  return letter;
}
function midiFrom(letter,oct,key){
  const L=applyKeySig(letter,key);
  return 69 + ((oct-4)*12 + PC[L]);
}
export function letterFreq(letter, octave, key="C"){
  const m=midiFrom(letter,octave,key);
  return 442*Math.pow(2,(m-69)/12);
}

// 1オクターブ分（8度含む、度数進行＋調号）
function oneOct(rootL, rootO, key){
  const out=[{letter:rootL,octave:rootO}];
  const next=(L)=>LETTERS[(LETTERS.indexOf(L)+1)%7];
  let L=rootL, O=rootO;
  for(let i=0;i<7;i++){
    const N=next(L);
    if((L==="E"&&N==="F")||(L==="B"&&N==="C")) O++; // 度だけ進め、E→F／B→Cでオクターブ繰上げ
    out.push({letter:N,octave:O});
    L=N;
  }
  return out;
}

// セット（上行24＋下行24）が G3..G6 に入るよう開始オクターブを両方向で調整
function clampStart(L,O,key){
  let guard=12;
  while(guard--){
    const up1=oneOct(L,O,key), up2=oneOct(up1[7].letter,up1[7].octave,key), up3=oneOct(up2[7].letter,up2[7].octave,key);
    const up24=[...up1,...up2,...up3].slice(0,24);
    const down24=[...up24].reverse();
    const all=[...up24,...down24];
    let minM=999, maxM=-999;
    for(const n of all){ const m=midiFrom(n.letter,n.octave,key); if(m<minM)minM=m; if(m>maxM)maxM=m; }
    if(maxM>MIDI_MAX){ O--; continue; }
    if(minM<MIDI_MIN){ O++; continue; }
    return O;
  }
  return O; // 保険
}

export function makeMajorScale3Oct(key="G"){
  let [L,O]=START_BASE[key]||["G",3];
  O=clampStart(L,O,key);
  const up1=oneOct(L,O,key), up2=oneOct(up1[7].letter,up1[7].octave,key), up3=oneOct(up2[7].letter,up2[7].octave,key);
  const up24=[...up1,...up2,...up3].slice(0,24);
  const down24=[...up24].reverse();
  return {keySignature:key, notes:[...up24,...down24]}; // 48音
}

// エクササイズ：4小節=32音（上行24＋下行8）
export function makeExercise4Bars(key="G"){
  const {notes}=makeMajorScale3Oct(key);
  return notes.slice(0,32);
}

export function toVexKeys(objs, key="C"){
  return objs.map(o=>`${applyKeySig(o.letter,key)}/${o.octave}`);
}
