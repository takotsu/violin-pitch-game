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
  "G":  {letter:"G",oct:3}, "D":{letter:"D",oct:4}, "A":{letter:"A",oct:3}, "E":{letter:"E",oct:4},
  "C":  {letter:"C",oct:4}, "F":{letter:"F",oct:4}, "Bb":{letter:"B",oct:3}, "Eb":{letter:"E",oct:4},
  "Ab": {letter:"A",oct:3}, "B":{letter:"B",oct:3}, "F#":{letter:"F",oct:3}, "C#":{letter:"C",oct:4},
};

const LETTERS=["C","D","E","F","G","A","B"];
function rotateFrom(letter){ const i=LETTERS.indexOf(letter); return [...LETTERS.slice(i),...LETTERS.slice(0,i)]; }
function incOctIfWrap(prevL,curL,oct){ return (prevL==="B" && curL==="C") ? (oct+1) : oct; }
const TOP_LIMIT={letter:"E",octave:7};
function clampTop(n){ if(n.octave>7) return {...TOP_LIMIT}; if(n.octave===7 && "CDEFGAB".indexOf(n.letter)>"CDEFGAB".indexOf("E")) return {...TOP_LIMIT}; return n; }

function buildUp(tonic, startOct){
  const seq=rotateFrom(tonic); const out=[]; let o=startOct;
  for(let i=0;i<24;i++){ const L=seq[i%7]; if(i>0) o=incOctIfWrap(seq[(i-1)%7],L,o); out.push(clampTop({letter:L,octave:o})); }
  return out;
}
function buildDown(up){
  const seq=rotateFrom(up[0].letter), top=up[up.length-1]; const down=[{...top}]; let o=top.octave;
  for(let i=23;i>=1;i--){ const prev=seq[(i-1)%7]; if(seq[i%7]==="C" && prev==="B") o--; down.push({letter:prev,octave:o}); }
  return down;
}

export function buildMajorScale(key){
  const st=START[key]||START["G"];
  const up=buildUp(st.letter, st.oct);
  const down=buildDown(up);
  const seq=[...up,...down];
  if(seq.length<48) seq.push({...seq[seq.length-1]});
  const vexKeys=seq.map(n=>`${n.letter}/${n.octave}`);
  return {id:key, keySignature:key, vexKeys, noteObjs:seq};
}

export function letterFreq(letter, octave, key, a4=442){
  const sig=KEY_SIG[key] || KEY_SIG["C"];
  let semi=NAT[letter];
  if(sig.sharps.includes(letter)) semi+=1;
  if(sig.flats.includes(letter))  semi-=1;
  const n=(octave-4)*12 + (semi-9);
  return a4 * Math.pow(2, n/12);
}
