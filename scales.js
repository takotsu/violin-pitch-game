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
  const n = (octave-4)*12 + (semi-9);
  return a4 * Math.pow(2, n/12);
}

function nextDegree(letter){ return LET_SEQ[(LET_SEQ.indexOf(letter)+1)%7]; }

/* 3oct長音階（48音）を G3..E7 に必ず収める（整数オクターブkを数式で一括適用） */
export function makeMajorScale3Oct(key){
  const startLetter = tonicLetter(key);

  // とりあえず Oct=3 で作る
  const up=[{letter:startLetter,octave:3}];
  let L=startLetter, O=3;
  for(let i=0;i<23;i++){
    const nL=nextDegree(L); if(L==="B"&&nL==="C") O+=1; L=nL; up.push({letter:L,octave:O});
  }
  let seq=[...up, ...up.slice().reverse()];

  // 周波数境界
  const G3 = letterFreq("G",3,"C");
  const E7 = letterFreq("E",7,"C");

  // 現在の最小・最大
  let minF=Infinity,maxF=0;
  for(const n of seq){ const f=letterFreq(n.letter,n.octave,key); if(f<minF)minF=f; if(f>maxF)maxF=f; }

  // 2^k で全体をシフトするための整数kを決定
  // 条件: minF*2^k >= G3 かつ maxF*2^k <= E7
  const kLow  = Math.ceil( Math.log2(G3/minF) );
  const kHigh = Math.floor( Math.log2(E7/maxF) );
  let k = Math.min(Math.max(kLow, -10), kHigh); // あり得る範囲にクランプ
  if(!Number.isFinite(k)) k=0;

  // 適用
  if(k!==0) seq = seq.map(n=>({...n, octave:n.octave+k}));

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
