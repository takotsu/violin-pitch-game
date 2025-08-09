// バイオリン音域の長調スケール（4小節：8分×32音）

export const ALL_KEYS = ["G","D","A","E","C","F","Bb","Eb","Ab","B","F#","C#"];

const NATURAL = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
export const KEY_SIG = {
  "C":  {sharps:[], flats:[]},
  "G":  {sharps:["F"], flats:[]},
  "D":  {sharps:["F","C"], flats:[]},
  "A":  {sharps:["F","C","G"], flats:[]},
  "E":  {sharps:["F","C","G","D"], flats:[]},
  "B":  {sharps:["F","C","G","D","A"], flats:[]},
  "F#": {sharps:["F","C","G","D","A","E"], flats:[]},
  "C#": {sharps:["F","C","G","D","A","E","B"], flats:[]},
  "F":  {sharps:[], flats:["B"]},
  "Bb": {sharps:[], flats:["B","E"]},
  "Eb": {sharps:[], flats:["B","E","A"]},
  "Ab": {sharps:[], flats:["B","E","A","D"]},
};

function toVexKey(letter, octave){ return `${letter}/${octave}`; }
function letterOrderFrom(start){
  const seq=["C","D","E","F","G","A","B"]; const i=seq.indexOf(start);
  return [...seq.slice(i),...seq.slice(0,i), start];
}

export function buildMajorScale(key){
  const order = letterOrderFrom(key.replace("b","")[0]);
  const upLetters = order.slice(0,8);
  let octave = 4;
  const up=[]; let oct=octave;
  for(let i=0;i<8;i++){
    const L=upLetters[i];
    if(i>0 && upLetters[i-1]==="B" && L==="C") oct++;
    up.push({letter:L, octave:(i===0?octave:oct)});
  }
  const down=[...up].reverse();
  const notes=[...up, ...down, ...up, ...down];
  return {
    id:key, keySignature:key,
    vexKeys: notes.map(n=>toVexKey(n.letter,n.octave)),
    noteObjs: notes
  };
}

export function letterFreq(letter, octave, key, a4=442){
  const sig = KEY_SIG[key] || KEY_SIG["C"];
  let semi = NATURAL[letter];
  if((sig.sharps||[]).includes(letter)) semi += 1;
  if((sig.flats||[]).includes(letter))  semi -= 1;
  const n = (octave-4)*12 + (semi-9); // A=9
  return a4 * Math.pow(2, n/12);
}
