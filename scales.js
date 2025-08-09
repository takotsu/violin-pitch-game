// v28 — 3オクターブ長音階（Carl Flesch/小野アンナの実用域準拠）
export const KEY_SIG = {
  C:{sharps:[],flats:[]},
  G:{sharps:["F"],flats:[]},
  D:{sharps:["F","C"],flats:[]},
  A:{sharps:["F","C","G"],flats:[]},
  E:{sharps:["F","C","G","D"],flats:[]},
  B:{sharps:["F","C","G","D","A"],flats:[]},
  "F#":{sharps:["F","C","G","D","A","E"],flats:[]},
  "C#":{sharps:["F","C","G","D","A","E","B"],flats:[]},
  F:{flats:["B"],sharps:[]},
  Bb:{flats:["B","E"],sharps:[]},
  Eb:{flats:["B","E","A"],sharps:[]},
  Ab:{flats:["B","E","A","D"],sharps:[]},
};

const LETTERS=["C","D","E","F","G","A","B"];
const nextL=(L,s)=>LETTERS[(LETTERS.indexOf(L)+s+7)%7];

// 開始音（主音から3oct）：G3/D3/A3/E4/C4/F3/Bb3/Eb4/Ab3/B3/F#3/C#4
const START={
  G:["G",3], D:["D",3], A:["A",3], E:["E",4],
  C:["C",4], F:["F",3], Bb:["Bb",3], Eb:["Eb",4],
  Ab:["Ab",3], B:["B",3], "F#":["F#",3], "C#":["C#",4],
};

function applyKey(letter,key){
  const sig=KEY_SIG[key]||KEY_SIG.C;
  if(sig.sharps.includes(letter)) return letter+"#";
  if(sig.flats.includes(letter))  return letter+"b";
  return letter;
}

// 3オクターブ上行24→下行24（合計48）
export function makeMajorScale3Oct(key="G"){
  const [L0,O0]=START[key]||["G",3];
  const needsOct=(a,b)=> (a==="E"&&b==="F") || (a==="B"&&b==="C");
  const up=[{letter:L0,octave:O0}];
  while(up.length<24){
    const prev=up.at(-1);
    const L=nextL(prev.letter,1);
    up.push({letter:L,octave:needsOct(prev.letter,L)?prev.octave+1:prev.octave});
  }
  const notes=up.concat([...up].reverse());
  return {keySignature:key,notes};
}

// A4=442Hz
export function letterFreq(letter,octave,key="C"){
  const L=applyKey(letter,key);
  const pc={"C":-9,"C#":-8,"Db":-8,"D":-7,"D#":-6,"Eb":-6,"E":-5,"F":-4,"F#":-3,"Gb":-3,"G":-2,"G#":-1,"Ab":-1,"A":0,"A#":1,"Bb":1,"B":2}[L];
  const n=(octave-4)*12+pc;
  return 442*Math.pow(2,n/12);
}
export function applyKeySig(letter,key){return applyKey(letter,key);}
