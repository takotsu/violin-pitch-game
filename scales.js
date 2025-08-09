// scales.js  v29 — 3オクターブ長音階（上行24音＋下行24音=48音）／A4=442Hz
export const KEY_SIG = {
  "C":{sharps:[],flats:[]},
  "G":{sharps:["F"],flats:[]},
  "D":{sharps:["F","C"],flats:[]},
  "A":{sharps:["F","C","G"],flats:[]},
  "E":{sharps:["F","C","G","D"],flats:[]},
  "B":{sharps:["F","C","G","D","A"],flats:[]},
  "F#":{sharps:["F","C","G","D","A","E"],flats:[]},
  "C#":{sharps:["F","C","G","D","A","E","B"],flats:[]},
  "F":{flats:["B"],sharps:[]},
  "Bb":{flats:["B","E"],sharps:[]},
  "Eb":{flats:["B","E","A"],sharps:[]},
  "Ab":{flats:["B","E","A","D"],sharps:[]}
};

const LETTERS = ["C","D","E","F","G","A","B"];
const nextL = (L)=> LETTERS[(LETTERS.indexOf(L)+1)%7];

// 調ごとの開始音（バイオリン実用スタート）。最上限は概ね G6 付近に収まる設定。
const START = {
  "G":["G",3],
  "D":["D",3],
  "A":["A",3],
  "C":["C",4],
  "F":["F",3],
  "Bb":["Bb",3],
  "Eb":["Eb",4],
  "E":["E",4],   // 高めだが実用域（E7までは行かないよう後段で抑制）
  "B":["B",3],
  "F#":["F#",3],
  "Ab":["Ab",3],
  "C#":["C#",4]
};

function applyKeySig(letter, key){
  const sig = KEY_SIG[key] || KEY_SIG.C;
  if (sig.sharps.includes(letter)) return letter + "#";
  if (sig.flats.includes(letter))  return letter + "b";
  return letter;
}

// pitch class for A4 reference table
const PC = {"C":-9,"C#":-8,"Db":-8,"D":-7,"D#":-6,"Eb":-6,"E":-5,"F":-4,"F#":-3,"Gb":-3,"G":-2,"G#":-1,"Ab":-1,"A":0,"A#":1,"Bb":1,"B":2};

// A4=442Hz
export function letterFreq(letter, octave, key="C"){
  const L = applyKeySig(letter, key);
  const pc = PC[L];
  const n = (octave-4)*12 + pc;
  return 442*Math.pow(2,n/12);
}

// 3オクターブ長音階（各オクターブ 8音ずつ。境界音G4/G5などは重複して含め、合計24音）
export function makeMajorScale3Oct(key="G"){
  const start = START[key] || ["G",3];
  let letter = start[0], octave = start[1];

  // 1オクターブ分の度数列（長音階）
  const deg = ["1","2","3","4","5","6","7","8"];
  const oneOct = (rootL,rootO)=>{
    const arr = [];
    let L = rootL, O = rootO;
    for(let i=0;i<deg.length;i++){
      arr.push({letter:L, octave:O});
      const next = nextL(L);
      // E→F と B→C のみでオクターブが上がる
      if((L==="E" && next==="F") || (L==="B" && next==="C")) O += 1;
      L = next;
    }
    return arr;
  };

  // 3オクターブ積む（境界音を重ねて24音）
  const up1 = oneOct(letter,octave);          // 8
  const up2 = oneOct(up1[up1.length-1].letter, up1[up1.length-1].octave); // 8（先頭=前の8度）
  const up3 = oneOct(up2[up2.length-1].letter, up2[up2.length-1].octave); // 8
  const up24 = [...up1, ...up2, ...up3];      // 24
  const down24 = [...up24].reverse();         // 24
  const notes = up24.concat(down24);          // 48

  return { keySignature:key, notes };
}

// VexFlow の keys 文字列へ
export function toVexKeys(objs, key="C"){
  return objs.map(o => `${applyKeySig(o.letter,key)}/${o.octave}`);
}
