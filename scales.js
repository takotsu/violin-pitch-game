export const ALL_KEYS = ["G","D","A","E","C","F","Bb","Eb","Ab","B","F#","C#"];

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

const NAT = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};

const START = {
  "G":  {letter:"G",oct:3},
  "D":  {letter:"D",oct:4},
  "A":  {letter:"A",oct:3},
  "E":  {letter:"E",oct:4},
  "C":  {letter:"C",oct:4},
  "F":  {letter:"F",oct:4},
  "Bb": {letter:"B",oct:3},
  "Eb": {letter:"E",oct:4},
  "Ab": {letter:"A",oct:3},
  "B":  {letter:"B",oct:3},
  "F#": {letter:"F",oct:3},
  "C#": {letter:"C",oct:4},
};

const LETTERS = ["C","D","E","F","G","A","B"];
function rotateFrom(letter){ const i=LETTERS.indexOf(letter); return [...LETTERS.slice(i),...LETTERS.slice(0,i)]; }

function buildUp(tonicLetter, startOct){
  const seq = rotateFrom(tonicLetter);
  const out=[]; let o=startOct;
  for(let i=0;i<16;i++){
    const L=seq[i%7];
    if(i>0 && seq[(i-1)%7]==="B" && L==="C") o++;
    out.push({letter:L,octave:o});
  }
  return out;
}
function buildDown(upArr){
  const top=upArr[upArr.length-1];
  const seq=rotateFrom(upArr[0].letter);
  const down=[]; let o=top.octave;
  down.push({...top});
  for(let i=15;i>=1;i--){
    const prevL=seq[(i-1)%7];
    if(i<15 && seq[i%7]==="C" && prevL==="B") o--;
    down.push({letter:prevL,octave:o});
  }
  return down;
}

export function buildMajorScale(key){
  const st = START[key] || START["G"];
  const up = buildUp(st.letter, st.oct);
  const down = buildDown(up);
  const vexKeys=[...up,...down].map(n=>`${n.letter}/${n.octave}`);
  return {id:key, keySignature:key, vexKeys, noteObjs:[...up,...down]};
}

export function letterFreq(letter, octave, key, a4=442){
  const sig = KEY_SIG[key] || KEY_SIG["C"];
  let semi = NAT[letter];
  if(Array.isArray(sig.sharps) && sig.sharps.includes(letter)) semi += 1;
  if(Array.isArray(sig.flats)  && sig.flats.includes(letter))  semi -= 1;
  const n = (octave-4)*12 + (semi-9);
  return a4 * Math.pow(2, n/12);
}
