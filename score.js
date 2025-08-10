// score.js
// VexFlow優先 → 失敗時は自前SVG。二段（上行/下行）を「ページ切替」で表示。
// API: renderScale(key, vexKeys, noteObjs, page=0) -> ctx {mode, getNoteXY(i), recolor(i,cls), putBadge(i,kind)}
//      highlightIndex(ctx, idx, badgeKind)  // badgeKind: "◎"|"◯"|"×"|null

import { KEY_SIG } from "./scales.js";

const staffDiv=document.getElementById("staff");
const NS="http://www.w3.org/2000/svg";
const mkSvg=(w,h)=>{const s=document.createElementNS(NS,"svg");s.setAttribute("viewBox",`0 0 ${w} ${h}`);s.setAttribute("width","100%");s.setAttribute("height","100%");s.setAttribute("preserveAspectRatio","xMidYMin meet");return s;};
const line=(svg,x1,y1,x2,y2,st="#e8eef7",w=1)=>{const l=document.createElementNS(NS,"line");l.setAttribute("x1",x1);l.setAttribute("y1",y1);l.setAttribute("x2",x2);l.setAttribute("y2",y2);l.setAttribute("stroke",st);l.setAttribute("stroke-width",w);svg.appendChild(l);return l;};
const text=(svg,x,y,txt,cls="badge")=>{const t=document.createElementNS(NS,"text");t.setAttribute("x",x);t.setAttribute("y",y);t.setAttribute("class",cls);t.textContent=txt;svg.appendChild(t);return t;};
const ellipse=(svg,x,y,rx,ry,cls)=>{const e=document.createElementNS(NS,"ellipse");e.setAttribute("cx",x);e.setAttribute("cy",y);e.setAttribute("rx",rx);e.setAttribute("ry",ry);if(cls)e.setAttribute("class",cls);svg.appendChild(e);return e;};

const LETTERS=["C","D","E","F","G","A","B"]; const idxL=(L)=>LETTERS.indexOf(L);
function yFor(letter,oct,top,space){ const bottom=top+space*4; const steps=(oct-4)*7+(idxL(letter)-idxL("E")); return bottom-(steps*space/2); }

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

export function renderScale(key, vexKeys, noteObjs, page=0){
  const VF=window.Vex?.Flow;
  staffDiv.innerHTML="";
  const W=staffDiv.clientWidth||820, H=240;
  const from=page===0?0:24, to=page===0?24:48;
  const objs=noteObjs.slice(from,to);
  const keys=vexKeys.slice(from,to);

  if(VF){
    const renderer=new VF.Renderer(staffDiv,VF.Renderer.Backends.SVG); renderer.resize(W,H);
    const ctx=renderer.getContext();
    const stave=new VF.Stave(6,10,W-12); // clef/timeは出さない
    stave.addKeySignature(key).setContext(ctx).draw();
    const notes=keys.map(k=>new VF.StaveNote({keys:[k],duration:"8"}).setStemDirection(1));
    const voice=new VF.Voice({num_beats:notes.length,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(notes);
    new VF.Formatter().joinVoices([voice]).format([voice], W-36); voice.draw(ctx,stave);

    // バッジ用にノート中心座標を拾う
    const xys=notes.map(n=>({x:n.getAbsoluteX()+6,y:stave.getYForLine(2)}));
    return {
      mode:"vex", renderer, ctx, stave, notes, page,
      getNoteXY:(i)=>xys[i]||{x:0,y:0},
      recolor:(i,cls)=>{
        const col = cls==="note-target"?"#22c55e":cls==="note-failed"?"#f43f5e":"#e8eef7";
        const item=notes[i]; if(!item) return;
        item.setStyle({fillStyle:col,strokeStyle:col});
        ctx.clear(); stave.setContext(ctx).draw();
        const v=new VF.Voice({num_beats:notes.length,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(notes);
        new VF.Formatter().joinVoices([v]).format([v], W-36); v.draw(ctx,stave);
      },
      putBadge:(i,kind)=>{
        const svg=staffDiv.querySelector("svg"); if(!svg) return;
        const xy=xys[i]; if(!xy) return;
        const id=`badge-${page}-${i}`; let t=svg.querySelector(`#${id}`);
        const cls=kind==="◎"?"badge-good":kind==="◯"?"badge-ok":"badge-ng";
        if(kind){
          if(!t){ t=document.createElementNS(NS,"text"); t.setAttribute("id",id); svg.appendChild(t); }
          t.setAttribute("class",`badge ${cls}`); t.setAttribute("x",xy.x+8); t.setAttribute("y",40);
          t.textContent=kind;
        }else if(t){ t.remove(); }
      }
    };
  }

  // ===== 自前SVG =====
  const svg=mkSvg(W,H); staffDiv.appendChild(svg);
  const top=12, space=7.2, left=6, right=W-6, bottom=top+space*4;
  for(let i=0;i<5;i++) line(svg,left,top+space*i,right,top+space*i);
  const ksW=drawKeySig(svg,key,left+6,top,space);
  const L=left+6+ksW+4, R=right-6; const dx=(R-L)/Math.max(1,objs.length);
  const group=document.createElementNS(NS,"g"); svg.appendChild(group);
  const nodes=[];
  objs.forEach((n,i)=>{
    const x=L+dx*(i+0.5), y=yFor(n.letter,n.octave,top,space);
    // ledger lines
    if(y<top||y>bottom){
      const short=12;
      for(let yy=top-space; yy>=y-1; yy-=space) line(group,x-short/2,yy,x+short/2,yy,"#a7c7dd",1);
      for(let yy=bottom+space; yy<=y+1; yy+=space) line(group,x-short/2,yy,x+short/2,yy,"#a7c7dd",1);
    }
    const head=ellipse(group,x,y,3.6,2.4,"note-normal");
    const stem=line(group,x+4.8,y-2,x+4.8,y-12,"#e8eef7",1.1);
    nodes.push({head,stem,x,y});
  });
  // 自動スケールで見切れ防止
  const bb=group.getBBox(); const fit=Math.min(1,(H-14)/(bb.height+16));
  if(fit<1){ const wrap=document.createElementNS(NS,"g"); wrap.setAttribute("transform",`scale(${fit})`); wrap.appendChild(group); svg.appendChild(wrap); }

  return {
    mode:"fb", svg, nodes, page,
    getNoteXY:(i)=>nodes[i]?{x:nodes[i].x,y:nodes[i].y}:{x:0,y:0},
    recolor:(i,cls)=>{
      const n=nodes[i]; if(!n) return;
      const col = cls==="note-target"?"#22c55e":cls==="note-failed"?"#f43f5e":"#e8eef7";
      n.head.setAttribute("fill",col); n.head.setAttribute("stroke",col); n.stem.setAttribute("stroke",col);
    },
    putBadge:(i,kind)=>{
      const id=`badge-${page}-${i}`; let t=svg.querySelector(`#${id}`);
      const xy=nodes[i]; if(!xy) return;
      const cls=kind==="◎"?"badge-good":kind==="◯"?"badge-ok":"badge-ng";
      if(kind){
        if(!t){ t=document.createElementNS(NS,"text"); t.setAttribute("id",id); svg.appendChild(t); }
        t.setAttribute("class",`badge ${cls}`); t.setAttribute("x",xy.x+8); t.setAttribute("y",40);
        t.textContent=kind;
      }else if(t){ t.remove(); }
    }
  };
}

export function highlightIndex(ctx, idx, badge){
  if(!ctx) return;
  const local = idx%24;
  // 全音を通常色へ
  for(let i=0;i<24;i++){
    if(i===local) continue;
    ctx.recolor(i,"note-normal");
  }
  // 注目ノートを緑
  ctx.recolor(local,"note-target");
  // バッジ（指定があれば描画／nullなら何もしない）
  if(badge){ ctx.putBadge(local,badge); }
}
