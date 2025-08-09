// scales.js  v26a  — violin 3-oct patterns that match standard study scales
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
const nextLetter = (L,step)=> LETTERS[(LETTERS.indexOf(L)+step+7)%7];

// ▼各調の開始音（バイオリン実用域内）
const VIOLIN_START = {
  "G": ["G",3],  // G線開放
  "D": ["D",3],  // D線開放
  "A": ["A",3],  // A線開放
  "E": ["E",4],  // E線開放（E3は不可）
  "C": ["C",4],
  "F": ["F",3],
  "Bb":["Bb",3],
  "Eb":["Eb",4],
  "Ab":["Ab",3],
  "B": ["B",3],
  "F#":["F#",3],
  "C#":["C#",4]
};

// 調号に基づきその音名に #/b を付ける
function applyKeySig(letter, key){
  const sig = KEY_SIG[key] || KEY_SIG.C;
  if (sig.sharps.includes(letter)) return letter + "#";
  if (sig.flats.includes(letter))  return letter + "b";
  return letter;
}

// ３オクターブ・メジャー（全全半 全全全半）を24音作って往復（合計48音）
export function makeMajorScale3Oct(key="G"){
  const [startL, startO] = VIOLIN_START[key] || ["G",3];
  const steps = [2,2,1,2,2,2,1]; // メジャー
  // 半音をまたぐときだけオクターブを進める（E→F, B→C）
  const needsOctUp = (from,to)=> (from==="E"&&to==="F") || (from==="B"&&to==="C");

  const up = [{ letter:startL, octave:startO }];
  while (up.length < 24) {
    const prev = up[up.length-1];
    const L = nextLetter(prev.letter,1);
    const octave = needsOctUp(prev.letter, L) ? prev.octave+1 : prev.octave;
    up.push({ letter:L, octave });
  }
  const down = [...up].reverse();            // 24↓
  const notes = up.concat(down);             // 48音

  return { keySignature:key, notes };
}

// A4=442Hz
export function letterFreq(letter, octave, key="C"){
  const L = applyKeySig(letter, key);
  const pc = {
    "C":-9,"C#":-8,"Db":-8,"D":-7,"D#":-6,"Eb":-6,"E":-5,
    "F":-4,"F#":-3,"Gb":-3,"G":-2,"G#":-1,"Ab":-1,"A":0,
    "A#":1,"Bb":1,"B":2
  }[L];
  const n = (octave-4)*12 + pc;
  return 442*Math.pow(2,n/12);
}

export function toVexKeys(objs, key="C"){
  return objs.map(o => `${applyKeySig(o.letter,key)}/${o.octave}`);
}
