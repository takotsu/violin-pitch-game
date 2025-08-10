// scales.js
// A4=442Hz。小野アンナ準拠の3oct長音階（実用域：開始G3等、上限は概ねG6にクリップ）。
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

const START_BASE={
  "G":["G",3],"D":["D",3],"A":["A",3],
  "C":["C",4],"F":["F",3],"Bb":["Bb",3],
  "Eb":["Eb",4],"E":["E",4],"B":["B",3],
  "F#":["F#",3],"Ab":["Ab",3]
};

const LETTERS=["C","D","E","F","G","A","B"];
const PC={"C":-9,"C#":-8,"Db":-8,"D":-7,"D#":-6,"Eb":-6,"E":-5,"F":-4,"F#":-3,"Gb":-3,"G":-2,"G#":-1,"Ab":-1,"A":0,"A#":1,"Bb":1,"B":2};
export function letterFreq(letter, octave, key="C"){
  const sig=KEY_SIG[key]||KEY_SIG.C;
  let L=letter;
  if(sig.sharps.includes(letter)) L+= "#";
  if(sig.flats.includes(letter))  L+= "b";
  const n=(octave-4)*12 + PC[L];
  return 442*Math.pow(2,n/12);
}

function oneOct(rootL, rootO){
  const out=[{letter:rootL,octave:rootO}];
  const next=(L)=>LETTERS[(LETTERS.indexOf(L)+1)%7];
  let L=rootL, O=rootO;
  for(let i=0;i<7;i++){
    const N=next(L);
    if((L==="E"&&N==="F")||(L==="B"&&N==="C")) O++;
    out.push({letter:N,octave:O}); L=N;
  }
  return out; // 8音
}

function clampStart(L,O,key){
  // 目標上限：概ね G6（G線〜E線の実用域内）
  const G6=letterFreq("G",6,key);
  let guard=6;
  while(guard--){
    const a1=oneOct(L,O), a2=oneOct(a1[7].letter,a1[7].octave), a3=oneOct(a2[7].letter,a2[7].octave);
    const top=a3[7];
    if(letterFreq(top.letter,top.octave,key)<=G6) break;
    O--;
  }
  return O;
}

export function makeMajorScale3Oct(key="G"){
  let [L,O]=START_BASE[key]||["G",3];
  O=clampStart(L,O,key);
  const up=[...oneOct(L,O)];
  const o2=oneOct(up[7].letter,up[7].octave); up.push(...o2);
  const o3=oneOct(o2[7].letter,o2[7].octave); up.push(...o3);
  const up24=up.slice(0,24);
  const down24=[...up24].reverse();
  return {keySignature:key, notes:up24.concat(down24)}; // 48音
}

// 課題（4小節=32音）用に切り出し
export function makeExercise4Bars(key="G"){
  const {notes}=makeMajorScale3Oct(key);
  return notes.slice(0,32); // 1小節=8音×4
}

export function toVexKeys(objs, key="C"){
  const sig=KEY_SIG[key]||KEY_SIG.C;
  const mapL=(L)=>sig.sharps.includes(L)?L+"#":sig.flats.includes(L)?L+"b":L;
  return objs.map(o=>`${mapL(o.letter)}/${o.octave}`);
}
