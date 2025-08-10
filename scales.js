// scales.js v0-4b — A4=442Hz。Violin range G3..E7 を厳守しつつ「必ず48音（上行24+下行24）」を生成。
export const KEY_SIG = {
  "C":{sharps:[],flats:[]}, "G":{sharps:["F"],flats:[]}, "D":{sharps:["F","C"],flats:[]},
  "A":{sharps:["F","C","G"],flats:[]}, "E":{sharps:["F","C","G","D"],flats:[]},
  "B":{sharps:["F","C","G","D","A"],flats:[]}, "F#":{sharps:["F","C","G","D","A","E"],flats:[]},
  "C#":{sharps:["F","C","G","D","A","E","B"],flats:[]}, "F":{flats:["B"],sharps:[]},
  "Bb":{flats:["B","E"],flats2:[],sharps:[]}, "Eb":{flats:["B","E","A"],sharps:[]}, "Ab":{flats:["B","E","A","D"],sharps:[]}
};
const START_BASE = { "G":["G",3], "D":["D",3], "A":["A",3], "C":["C",4], "F":["F",3], "Bb":["Bb",3],
  "Eb":["Eb",4], "E":["E",4], "B":["B",3], "F#":["F#",3], "Ab":["Ab",3], "C#":["C#",4] };

const PC={"C":-9,"C#":-8,"Db":-8,"D":-7,"D#":-6,"Eb":-6,"E":-5,"F":-4,"F#":-3,"Gb":-3,"G":-2,"G#":-1,"Ab":-1,"A":0,"A#":1,"Bb":1,"B":2};
const LETTERS=["C","D","E","F","G","A","B"]; const nextL=(L)=>LETTERS[(LETTERS.indexOf(L)+1)%7];

function applyKeySig(letter,key){ const s=KEY_SIG[key]||KEY_SIG.C; if(s.sharps?.includes(letter))return letter+"#"; if(s.flats?.includes(letter))return letter+"b"; return letter; }
export function letterFreq(letter,octave,key="C"){ const L=applyKeySig(letter,key); const n=(octave-4)*12+PC[L]; return 442*Math.pow(2,n/12); }
function oneOct(L,O){ const a=[]; for(let i=0;i<8;i++){ a.push({letter:L,octave:O}); const N=nextL(L); if((L==="E"&&N==="F")||(L==="B"&&N==="C")) O++; L=N; } return a; }

export function makeMajorScale3Oct(key="G"){
  let [L,O]=START_BASE[key] || ["G",3];

  // 音域ガード（G3..E7）
  const G3 = letterFreq("G",3,key), E7 = letterFreq("E",7,key);
  const up3 = (l,o)=>[...oneOct(l,o), ...oneOct(oneOct(l,o)[7].letter,oneOct(l,o)[7].octave),
                      ...oneOct(oneOct(oneOct(l,o)[7].letter,oneOct(l,o)[7].octave)[7].letter,
                                oneOct(oneOct(l,o)[7].letter,oneOct(l,o)[7].octave)[7].octave)];
  const f = (o)=>letterFreq(o.letter,o.octave,key);

  let guard=6;
  while(guard--){
    const t=up3(L,O);
    if(f(t[0])<G3){ O++; continue; }
    if(f(t[23])>E7){ O--; continue; }
    break;
  }

  let up = up3(L,O);
  while(f(up[23])>E7) up[23]=up[22];
  if(f(up[0])<G3) up[0]={letter:"G",octave:3};

  const down=[...up].reverse();
  const notes=up.concat(down); // 48固定
  return { keySignature:key, notes };
}

export function toVexKeys(objs,key="C"){ return objs.map(o=>`${applyKeySig(o.letter,key)}/${o.octave}`); }
