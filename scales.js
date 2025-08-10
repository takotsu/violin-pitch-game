// scales.js
// A4=442Hz / メジャースケール（全全半 全全全半）で 3oct = 24up + 24down = 48notes を生成。
// バイオリン実用域：各調の定番開始（例: GはG3）。上限は概ね G6 内に収める。

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
const DEGREE_STEPS=[2,2,1,2,2,2,1]; // 全全半 全全全半

function applyKeySig(letter,key){
  const s=KEY_SIG[key]||KEY_SIG.C;
  if(s.sharps.includes(letter)) return letter+"#";
  if(s.flats.includes(letter))  return letter+"b";
  return letter;
}

export function letterFreq(letter, octave, key="C"){
  const L=applyKeySig(letter,key);
  const n=(octave-4)*12 + PC[L];
  return 442*Math.pow(2,n/12);
}

function lettersForOneOct(root){
  const arr=[root];
  for(let i=0;i<7;i++){
    // 次の度（C→D→E…）
    const next=LETTERS[(LETTERS.indexOf(arr[arr.length-1])+1)%7];
    arr.push(next);
  }
  return arr; // 8音（度重複含む）
}

function oneOct(rootL, rootO){
  const letters=lettersForOneOct(rootL);
  const out=[]; let O=rootO;
  for(let i=0;i<letters.length;i++){
    const L=letters[i];
    if(i>0){
      const prev=letters[i-1];
      if((prev==="E"&&L==="F")||(prev==="B"&&L==="C")) O++; // E→F, B→Cでオクターブ繰上げ
    }
    out.push({letter:L, octave:O});
  }
  return out;
}

function clampStart(L,O,key){
  // 最上限を概ね G6 に（越えると開始オクターブを下げる）
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
  const notes=up24.concat(down24); // 48
  return {keySignature:key, notes};
}

export function toVexKeys(objs, key="C"){
  return objs.map(o=>`${applyKeySig(o.letter,key)}/${o.octave}`);
}
