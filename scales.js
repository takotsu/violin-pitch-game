// scales.js
// A4=442Hz / 小野アンナの3oct長音階（度数進行＋調号）。全48音が G3..G6 に入るまで開始オクターブを自動調整。

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

// 小野アンナの実用的開始点（後でG3..G6にクランプ）
const START_BASE={
  "G":["G",3],"D":["D",3],"A":["A",3],
  "C":["C",4],"F":["F",3],"Bb":["Bb",3],
  "Eb":["Eb",4],"E":["E",4],"B":["B",3],
  "F#":["F#",3],"Ab":["Ab",3]
};

const LETTERS=["C","D","E","F","G","A","B"];
const PC={"C":-9,"C#":-8,"Db":-8,"D":-7,"D#":-6,"Eb":-6,"E":-5,"F":-4,"F#":-3,"Gb":-3,"G":-2,"G#":-1,"Ab":-1,"A":0,"A#":1,"Bb":1,"B":2};
const MIDI_MIN=55/*G3*/, MIDI_MAX=91/*G6*/;

const applyKey=(L,key)=> (KEY_SIG[key]?.sharps.includes(L)?L+"#":KEY_SIG[key]?.flats.includes(L)?L+"b":L);
const midi=(L,O,key)=> 69 + ((O-4)*12 + PC[applyKey(L,key)]);
export const letterFreq=(L,O,key="C")=> 442*Math.pow(2,(midi(L,O,key)-69)/12);

const nextL=L=>LETTERS[(LETTERS.indexOf(L)+1)%7];
function oneOct(L,O,key){ const out=[{letter:L,octave:O}]; let l=L,o=O; for(let i=0;i<7;i++){ const n=nextL(l); if((l==="E"&&n==="F")||(l==="B"&&n==="C")) o++; out.push({letter:n,octave:o}); l=n;} return out; }

function clampStart(L,O,key){
  // 全48音がG3..G6へ入るまでOを上下
  for(let guard=0; guard<12; guard++){
    const u1=oneOct(L,O,key), u2=oneOct(u1[7].letter,u1[7].octave,key), u3=oneOct(u2[7].letter,u2[7].octave,key);
    const up24=[...u1,...u2,...u3].slice(0,24), all=[...up24,...[...up24].reverse()];
    const min=Math.min(...all.map(n=>midi(n.letter,n.octave,key)));
    const max=Math.max(...all.map(n=>midi(n.letter,n.octave,key)));
    if(max>MIDI_MAX){ O--; continue; }
    if(min<MIDI_MIN){ O++; continue; }
    break;
  }
  return O;
}

export function makeMajorScale3Oct(key="G"){
  let [L,O]=START_BASE[key]||["G",3];
  O=clampStart(L,O,key);
  const u1=oneOct(L,O,key), u2=oneOct(u1[7].letter,u1[7].octave,key), u3=oneOct(u2[7].letter,u2[7].octave,key);
  const up24=[...u1,...u2,...u3].slice(0,24);
  const down24=[...up24].reverse();
  return {keySignature:key, notes:[...up24,...down24]}; // 48音
}

// エクササイズ：4小節=32音（上行24 + 下行8）
export function makeExercise4Bars(key="G"){
  const {notes}=makeMajorScale3Oct(key);
  return notes.slice(0,32);
}

export function toVexKeys(objs, key="C"){
  return objs.map(o=>`${applyKey(o.letter,key)}/${o.octave}`);
}
