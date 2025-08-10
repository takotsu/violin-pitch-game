// scales.js
export const A4 = 442;
export const KEYS = ["G","D","A","C","F","Bb","Eb","E","B","F#","Ab"];

export const KEY_SIG = {
  C:{sharps:[],flats:[]},
  G:{sharps:["F"],flats:[]},
  D:{sharps:["F","C"],flats:[]},
  A:{sharps:["F","C","G"],flats:[]},
  E:{sharps:["F","C","G","D"],flats:[]},
  B:{sharps:["F","C","G","D","A"],flats:[]},
  "F#":{sharps:["F","C","G","D","A","E"],flats:[]},
  F:{sharps:[],flats:["B"]},
  Bb:{sharps:[],flats:["B","E"]},
  Eb:{sharps:[],flats:["B","E","A"]},
  Ab:{sharps:[],flats:["B","E","A","D"]},
};

const NAT = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const STEP = [2,2,1,2,2,2,1];
const LET_SEQ = ["C","D","E","F","G","A","B"];

function tonicLetter(key){
  const map={C:"C",G:"G",D:"D",A:"A",E:"E",B:"B","F#":"F",F:"F",Bb:"B",Eb:"E",Ab:"A"};
  return map[key]||"C";
}

export function letterFreq(letter, octave, key, a4=A4){
  const sig = KEY_SIG[key] || KEY_SIG["C"];
  let semi = NAT[letter];
  if(sig.sharps.includes(letter)) semi += 1;
  if(sig.flats.includes(letter)) semi -= 1;
  const n = (octave-4)*12 + (semi-9); // A4基準
  return a4 * Math.pow(2, n/12);
}

function nextDegree(letter){ return LET_SEQ[(LET_SEQ.indexOf(letter)+1)%7]; }

/* 3oct長音階（48音）を G3..E7 に必ず収める（最後に境界内へシフト補正） */
export function makeMajorScale3Oct(key){
  const startLetter = tonicLetter(key);
  let chosenStartOct = 3;
  for(let so=3; so<=5; so++){
    const up=[{letter:startLetter,octave:so}];
    let L=startLetter, oct=so;
    for(let i=0;i<23;i++){
      const nextL = nextDegree(L);
      if(L==="B" && nextL==="C") oct+=1;
      L=nextL; up.push({letter:L,octave:oct});
    }
    const seq=[...up, ...up.slice().reverse()];
    if(inRange(seq,key)){ chosenStartOct=so; break; }
  }
  let up=[{letter:startLetter,octave:chosenStartOct}], L=startLetter, oct=chosenStartOct;
  for(let i=0;i<23;i++){ const nL=nextDegree(L); if(L==="B"&&nL==="C") oct+=1; L=nL; up.push({letter:L,octave:oct}); }
  let seq=[...up, ...up.slice().reverse()];
  seq = fitIntoRange(seq,key); // 最終安全
  return seq;
}

function inRange(seq,key){
  const G3=letterFreq("G",3,"C"), E7=letterFreq("E",7,"C");
  let min=Infinity,max=0;
  for(const n of seq){ const f=letterFreq(n.letter,n.octave,key); if(f<min)min=f; if(f>max)max=f; }
  return (min>=G3-1e-6 && max<=E7+1e-6);
}
function fitIntoRange(seq,key){
  const G3=letterFreq("G",3,"C"), E7=letterFreq("E",7,"C");
  function bounds(s){ let mn=Infinity,mx=0; for(const n of s){ const f=letterFreq(n.letter,n.octave,key); if(f<mn)mn=f; if(f>mx)mx=f; } return [mn,mx]; }
  let [mn,mx]=bounds(seq);
  while(mn<G3){ seq = seq.map(n=>({...n,octave:n.octave+1})); [mn,mx]=bounds(seq); }
  while(mx>E7){ seq = seq.map(n=>({...n,octave:n.octave-1})); [mn,mx]=bounds(seq); }
  return seq;
}

/* 4小節（32音）：上行24 + 下行8 */
export function makeExercise4Bars(key){
  const full=makeMajorScale3Oct(key);
  return [...full.slice(0,24), ...full.slice(24,32)];
}

/* VexFlowキー配列 */
export function toVexKeys(noteObjs, key){
  const sig = KEY_SIG[key] || KEY_SIG["C"];
  return noteObjs.map(n=>{
    const base = n.letter.toLowerCase();
    const acc = sig.sharps.includes(n.letter) ? "#" : (sig.flats.includes(n.letter) ? "b" : "");
    return `${base}${acc}/${n.octave}`;
  });
}
