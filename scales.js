// scales.js  v26b — Carl Flesch / 小野アンナの「３オクターブ長音階」基準
export const KEY_SIG = {
  C:{sharps:[],flats:[]},  G:{sharps:["F"],flats:[]}, D:{sharps:["F","C"],flats:[]},
  A:{sharps:["F","C","G"],flats:[]}, E:{sharps:["F","C","G","D"],flats:[]},
  B:{sharps:["F","C","G","D","A"],flats:[]}, "F#":{sharps:["F","C","G","D","A","E"],flats:[]},
  "C#":{sharps:["F","C","G","D","A","E","B"],flats:[]},
  F:{flats:["B"],sharps:[]}, Bb:{flats:["B","E"],sharps:[]}, Eb:{flats:["B","E","A"],sharps:[]},
  Ab:{flats:["B","E","A","D"],sharps:[]}
};

const LETTERS = ["C","D","E","F","G","A","B"];
const nextLetter = L => LETTERS[(LETTERS.indexOf(L)+1)%7];

// 開始音（実用ポジション内）
const START = {
  G:["G",3], D:["D",3], A:["A",3], E:["E",4],
  C:["C",4], F:["F",3], Bb:["Bb",3], Eb:["Eb",4],
  Ab:["Ab",3], B:["B",3], "F#":["F#",3], "C#":["C#",4]
};

function applyKeySig(letter,key){
  const s=KEY_SIG[key]||KEY_SIG.C;
  if (s.sharps.includes(letter)) return letter+"#";
  if (s.flats.includes(letter))  return letter+"b";
  return letter;
}

// ３オクターブ上行24音 → 反転して下行24音（合計48音）
export function makeMajorScale3Oct(key="G"){
  const [L0,O0]=START[key] || ["G",3];
  const up=[{letter:L0,octave:O0}];
  const octUp=(from,to)=>(from==="E"&&to==="F")||(from==="B"&&to==="C");
  while(up.length<24){
    const p=up[up.length-1]; const L=nextLetter(p.letter);
    up.push({letter:L, octave: octUp(p.letter,L)?p.octave+1:p.octave});
  }
  const down=[...up].reverse();
  return { keySignature:key, notes: up.concat(down) };
}

// A4=442Hz
export function letterFreq(letter,octave,key="C"){
  const L=applyKeySig(letter,key);
  const pc = {
    "C":-9,"C#":-8,"Db":-8,"D":-7,"D#":-6,"Eb":-6,"E":-5,
    "F":-4,"F#":-3,"Gb":-3,"G":-2,"G#":-1,"Ab":-1,"A":0,
    "A#":1,"Bb":1,"B":2
  }[L];
  const n=(octave-4)*12 + pc;
  return 442*Math.pow(2,n/12);
}
export function toVexKeys(list,key="C"){
  return list.map(n=>`${applyKeySig(n.letter,key)}/${n.octave}`);
}
