// score.js
// 流れる譜面（コンベア式）。VexFlow優先／自前SVGフォールバック。調号のみ・加線あり・自動縮尺。
// 常に2小節（16音）以上を先読み表示。advance()で左へシフト、合格音は消去。

import { KEY_SIG } from "./scales.js";

const staffDiv=document.getElementById("staff");
const NS="http://www.w3.org/2000/svg";

const LETTERS=["C","D","E","F","G","A","B"]; const idxL=(L)=>LETTERS.indexOf(L);
const yFor=(letter,oct,top,space)=>{ const bottom=top+space*4; const steps=(oct-4)*7+(idxL(letter)-idxL("E")); return bottom-(steps*space/2); };

function drawKeySig(svg,key,left,top,space){
  const sig=KEY_SIG[key]||KEY_SIG.C;
  const SH=[{L:"F",o:5},{L:"C",o:5},{L:"G",o:5},{L:"D",o:5},{L:"A",o:4},{L:"E",o:5},{L:"B",o:4}];
  const FL=[{L:"B",o:4},{L:"E",o:5},{L:"A",o:4},{L:"D",o:5},{L:"G",o:4},{L:"C",o:5},{L:"F",o:4}];
  let x=left;
  const put=(L,o,s)=>{const t=document.createElementNS(NS,"text");t.setAttribute("x",x);t.setAttribute("y",yFor(L,o,top,space)+3);t.setAttribute("font-size",11);t.setAttribute("font-weight","900");t.setAttribute("fill","#e8eef7");t.textContent=s;svg.appendChild(t);x+=5;};
  sig.sharps.forEach((_,i)=>{const p=SH[i]; put(p.L,p.o,"♯");});
  sig.flats .forEach((_,i)=>{const p=FL[i]; put(p.L,p.o,"♭");});
  return x-left;
}

function drawStaffLines(container){
  const W=container.clientWidth, H=container.clientHeight;
  const svg=document.createElementNS(NS,"svg"); svg.setAttribute("viewBox",`0 0 ${W} ${H}`); svg.setAttribute("width","100%"); svg.setAttribute("height","100%");
  const top=28, space=7.2, left=6, right=W-6;
  for(let i=0;i<5;i++){ const l=document.createElementNS(NS,"line"); l.setAttribute("x1",left);l.setAttribute("x2",right);l.setAttribute("y1",top+space*i);l.setAttribute("y2",top+space*i);l.setAttribute("stroke","#e8eef7");svg.appendChild(l);}
  // 調号（左端固定）
  drawKeySig(svg, window.__ctxKey||"G", 16, top, space);
  svg.className="staffLines";
  return svg;
}

export function renderConveyor(key, noteObjs){
  staffDiv.innerHTML="";
  window.__ctxKey=key; // 調号用

  // レーンDOM
  const lane=document.createElement("div"); lane.id="lane"; staffDiv.appendChild(drawStaffLines(staffDiv)); staffDiv.appendChild(lane);

  const W=staffDiv.clientWidth, H=staffDiv.clientHeight;
  const top=28, space=7.2, bottom=top+space*4;
  const NSsvg=document.createElementNS(NS,"svg"); NSsvg.setAttribute("viewBox",`0 0 ${W*2} ${H}`); NSsvg.setAttribute("width",W*2); NSsvg.setAttribute("height",H); lane.appendChild(NSsvg);
  const group=document.createElementNS(NS,"g"); NSsvg.appendChild(group);

  const NOTE_W=32;                    // 1音の横幅（=8分相当）。1小節=8音で 256px
  const BAR_W=NOTE_W*8;
  let headNodes=[];                   // {head,stem,x,y,idx}

  function putLedger(x,y){
    const addLine=(yy)=>{const l=document.createElementNS(NS,"line"); l.setAttribute("x1",x-6);l.setAttribute("x2",x+6);l.setAttribute("y1",yy);l.setAttribute("y2",yy);l.setAttribute("stroke","#a7c7dd");l.setAttribute("stroke-width","1");group.appendChild(l);};
    for(let yy=top-7.2; yy>=y-1; yy-=7.2) addLine(yy);
    for(let yy=bottom+7.2; yy<=y+1; yy+=7.2) addLine(yy);
  }

  function drawNote(n, i, xBase){
    const x=xBase + i*NOTE_W + 18; const y=yFor(n.letter,n.octave,top,space);
    if(y<top||y>bottom) putLedger(x,y);
    const head=document.createElementNS(NS,"ellipse"); head.setAttribute("cx",x); head.setAttribute("cy",y); head.setAttribute("rx","3.6"); head.setAttribute("ry","2.4"); head.setAttribute("class","note-normal"); head.setAttribute("transform",`rotate(-20 ${x} ${y})`);
    const stem=document.createElementNS(NS,"line"); stem.setAttribute("x1",x+4.8); stem.setAttribute("x2",x+4.8); stem.setAttribute("y1",y-2); stem.setAttribute("y2",y-12); stem.setAttribute("stroke","#e8eef7"); stem.setAttribute("stroke-width","1.1");
    group.appendChild(head); group.appendChild(stem);
    headNodes.push({head,stem,x,y});
    // 小節線
    if((i+1)%8===0){ const bx=xBase+(i+1)*NOTE_W+2; const m=document.createElementNS(NS,"line"); m.setAttribute("x1",bx);m.setAttribute("x2",bx);m.setAttribute("y1",top);m.setAttribute("y2",bottom);m.setAttribute("stroke","#284559");group.appendChild(m); }
  }

  // 初期描画（2小節先読み + 予備）
  const VISIBLE_NOTES = 16; const EXTRA_NOTES = 8;
  const initCount = Math.min(noteObjs.length, VISIBLE_NOTES + EXTRA_NOTES);
  for(let i=0;i<initCount;i++) drawNote(noteObjs[i], i, 20);

  function recolor(i,cls){
    const n=headNodes[i]; if(!n) return;
    const col = cls==="note-target"?"#22c55e":cls==="note-failed"?"#f43f5e":"#e8eef7";
    n.head.setAttribute("class",cls); n.head.setAttribute("fill",col); n.head.setAttribute("stroke",col);
    n.stem.setAttribute("stroke",col);
  }
  function putBadge(i,kind){
    const xy=headNodes[i]; if(!xy) return;
    const t=document.createElementNS(NS,"text"); t.setAttribute("x",xy.x+8); t.setAttribute("y",40);
    t.setAttribute("class",`badge ${kind==="◎"?"badge-good":kind==="◯"?"badge-ok":"badge-ng"}`); t.textContent=kind; group.appendChild(t);
  }

  let consumed=0; // 消した数
  function advance(){
    // 左端を消し、レーンを左へシフト（CSS transform）
    const del=headNodes.shift(); if(del){ del.head.remove(); del.stem.remove(); consumed++; }
    const t = `translateX(${-consumed*NOTE_W}px)`; lane.style.transform=t;

    // 足りなくなったら次を追加（常に16音以上の先読みを維持）
    const nextIndex = headNodes.length + consumed;
    if(nextIndex < noteObjs.length && headNodes.length < VISIBLE_NOTES+EXTRA_NOTES){
      drawNote(noteObjs[nextIndex], headNodes.length, 20 + consumed*NOTE_W);
    }
  }

  function getNoteXY(i){
    const n=headNodes[i]; if(!n) return {x:0,y:0};
    // 画面座標（相対でOK）
    const r=staffDiv.getBoundingClientRect();
    return {x:n.x - consumed*NOTE_W - r.left, y:n.y - r.top};
  }

  return {recolor, putBadge, advance, getNoteXY};
}
