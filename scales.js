// scales.js ー スケール定義/生成（バイオリン音域：G3〜E6に収める）

export const MAJOR_ORDER = ["C","D","E","F","G","A","B"];
const NATURAL = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};

// 調ごとのキーシグネチャ（長調）
const KEY_SIG = {
  "C": {sharps:[], flats:[]},
  "G": {sharps:["F"], flats:[]},
  "D": {sharps:["F","C"], flats:[]},
  "A": {sharps:["F","C","G"], flats:[]},
  "E": {sharps:["F","C","G","D"], flats:[]},
  "B": {sharps:["F","C","G","D","A"], flats:[]},
  "F#":{sharps:["F","C","G","D","A","E"], flats:[]},
  "C#":{sharps:["F","C","G","D","A","E","B"], flats:[]},

  "F": {sharps:[], flats:["B"]},
  "Bb":{sharps:[], flats:["B","E"]},
  "Eb":{sharps:[], flats:["B","E","A"]},
  "Ab":{sharps:[], flats:["B","E","A","D"]},
};

// 調→開始音（1オクターブ上行→下行×2：計32音）
const START_OCT = { // すべて 4オクターブ開始で上限E6を超えない設計
  "C":4, "G":4, "D":4, "A":4, "E":4, "B":4, "F#":4, "C#":4, "F":4, "Bb":4, "Eb":4, "Ab":4
};

// 五線譜用キー（キーシグネチャに任せる＝臨時記号を付けない）
function toVexKey(letter, octave){ return `${letter}/${octave}`; }

// 周波数用：キーシグネチャに従い半音補正（#/-1）
export function letterFreq(letter, octave, key, a4=442){
  let semi = NATURAL[letter];
  const sig = KEY_SIG[key] || KEY_SIG["C"];
  if(sig.sharps.includes(letter)) semi += 1;
  if(sig.flats.includes(letter))  semi -= 1;
  const n = (octave-4)*12 + (semi-9); // A=9
  return a4 * Math.pow(2, n/12);
}

// 調ごとの 4小節スケール（8分×32音）を生成
export function buildMajorScale(key){
  const octave = START_OCT[key] ?? 4;
  // 上行：主音〜主音（1オクターブ上）
  const tonicIndex = MAJOR_ORDER.indexOf(key.replace("b","B").replace("#","#")) >= 0
    ? MAJOR_ORDER.indexOf(key[0]) : MAJOR_ORDER.indexOf(key[0]);
  // 文字順（例：G,A,B,C,D,E,F,G）
  const upLetters = [];
  const order = ["C","D","E","F","G","A","B"];
  const startLetter = key.replace("b","")[0]; // 例 "G","A","E","F"...
  let idx = order.indexOf(startLetter);
  for(let i=0;i<8;i++){
    upLetters.push(order[idx%7]);
    idx++;
  }
  // オクターブ管理
  const up = [];
  let oct = octave;
  for(let i=0;i<upLetters.length;i++){
    const L = upLetters[i];
    if(i>0){
      const prev = upLetters[i-1];
      if(prev==="B" && L==="C") oct++; // Cに回ったらオクターブ進む
    }
    up.push({letter:L, octave: (i===0?octave:oct)});
  }
  // 下行（同音から戻る）
  const down = [...up].reverse();

  // 4小節＝(上行8 + 下行8)×2
  const notes = [...up, ...down, ...up, ...down];
  return {
    id: key, keySignature: key,
    vexKeys: notes.map(n => toVexKey(n.letter, n.octave)),
    noteObjs: notes
  };
}

// ドロップダウンに出す調一覧（増減可）
export const ALL_KEYS = ["G","D","A","E","C","F","Bb","Eb","Ab","B","F#","C#"];
