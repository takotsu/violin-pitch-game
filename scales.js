// scales.js  v26
export const KEY_SIG={
  "C":{sharps:[],flats:[]}, "G":{sharps:["F"],flats:[]}, "D":{sharps:["F","C"],flats:[]},
  "A":{sharps:["F","C","G"],flats:[]}, "E":{sharps:["F","C","G","D"],flats:[]},
  "B":{sharps:["F","C","G","D","A"],flats:[]}, "F#":{sharps:["F","C","G","D","A","E"],flats:[]},
  "C#":{sharps:["F","C","G","D","A","E","B"],flats:[]},
  "F":{flats:["B"],sharps:[]}, "Bb":{flats:["B","E"],sharps:[]}, "Eb":{flats:["B","E","A"],sharps:[]},
  "Ab":{flats:["B","E","A","D"],sharps:[]}
};
const LETTERS=["C","D","E","F","G","A","B"];
function nextLetter(L,step){ return LETTERS[(LETTERS.indexOf(L)+step+7)%7]; }

// 3オクターブ往復（48音）：バイオリン実用域で開始音をキー別に設定
export function makeMajorScale3Oct(key="G"){
  const startByKey={
    "G":["G",3], "D":["D",4], "A":["A",3], "E":["E",4],
    "C":["C",4], "F":["F",3], "Bb":["Bb",3], "Eb":["Eb",4],
    "Ab":["Ab",3], "B":["B",3], "F#":["F#",3], "C#":["C#",4]
  };
  const st=startByKey[key] || ["G",3];
  let L=st[0].replace("b","B"); let O=st[1];

  const seqUp=[{letter:L,octave:O}];
  for(let i=0;i<23;i++){
    const prev=seqUp[seqUp.length-1];
    const nxtL=nextLetter(prev.letter,1);
    let nxtO=prev.octave;
    if((prev.letter==="B" && nxtL==="C") || (prev.letter==="E" && nxtL==="F")) nxtO++;
    seqUp.push({letter:nxtL,octave:nxtO});
  }
  const seqDown=[...seqUp].reverse();
  return {keySignature:key, notes:[...seqUp,...seqDown]};
}

// A4=442Hz
export function letterFreq(letter,oct, key="C"){
  const sig=KEY_SIG[key]||KEY_SIG.C;
  const isSharp=sig.sharps.includes(letter), isFlat=sig.flats.includes(letter);
  const L=letter + (isSharp?"#":(isFlat?"b":""));
  const pc={
    "C":-9,"C#":-8,"Db":-8,"D":-7,"D#":-6,"Eb":-6,"E":-5,"F":-4,"F#":-3,"Gb":-3,
    "G":-2,"G#":-1,"Ab":-1,"A":0,"A#":1,"Bb":1,"B":2
  }[L];
  const n=(oct-4)*12+pc;
  return 442*Math.pow(2,n/12);
}
export function toVexKeys(objs,key="C"){
  return objs.map(o=>{
    let L=o.letter; const sig=KEY_SIG[key]||KEY_SIG.C;
    if(sig.sharps.includes(L)) L+="#";
    if(sig.flats.includes(L))  L+="b";
    return `${L}/${o.octave}`;
  });
}
