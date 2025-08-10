// score.js
// 二小節（16音）ブロック。VexFlow優先→自前SVGフォールバック。調号のみ・加線・自動縮尺・◎/◯/×バッジ。
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

export function renderTwoBars({key, notes, offset=0}){
  const slice=notes.slice(offset, offset+16);
  staffDiv.innerHTML="";
  const W=Math.max(320, staffDiv.clientWidth||820), H=240;

  const VF=window.Vex?.Flow;
  if(VF){
    const renderer=new VF.Renderer(staffDiv,VF.Renderer.Backends.SVG); renderer.resize(W,H);
    const ctx=renderer.getContext();
    const stave=new VF.Stave(6,10,W-12); // clef/timeは出さない
    stave.addKeySignature(key).setContext(ctx).draw();

    const keys=slice.map(n=>{
      const sig=KEY_SIG[key]||KEY_SIG.C; const L=n.letter;
      const mapL = sig.sharps.includes(L)?L+"#":sig.flats.includes(L)?L+"b":L;
      return `${mapL}/${n.octave}`;
    });
    const notesVF=keys.map(k=>new VF.StaveNote({keys:[k],duration:"8"}).setStemDirection(1));
    const voice=new VF.Voice({num_beats:notesVF.length,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(notesVF);
    new VF.Formatter().joinVoices([voice]).format([voice], W-36);
    voice.draw(ctx,stave);

    [8,16].forEach(c=>{
      const n=notesVF[c-1]; if(!n) return;
      const x=n.getAbsoluteX()+20; ctx.beginPath(); ctx.moveTo(x,stave.getYForLine(0)); ctx.lineTo(x,stave.getYForLine(4)); ctx.stroke();
    });

    const centers=notesVF.map(n=>({x:n.getAbsoluteX()+6,y:stave.getYForLine(2)}));
    return {
      mode:"vex", renderer, ctx, stave, notesVF,
      recolor:(i,cls)=>{
        const col = cls==="note-target"?"#22c55e":cls==="note-failed"?"#f43f5e":"#e8eef7";
        const it=notesVF[i]; if(!it) return;
        it.setStyle({fillStyle:col,strokeStyle:col});
        ctx.clear(); stave.setContext(ctx).draw();
        const v=new VF.Voice({num_beats:notesVF.length,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(notesVF);
        new VF.Formatter().joinVoices([v]).format([v], W-36); v.draw(ctx,stave);
        [8,16].forEach(c=>{ const x=notesVF[c-1].getAbsoluteX()+20; ctx.beginPath(); ctx.moveTo(x,stave.getYForLine(0)); ctx.lineTo(x,stave.getYForLine(4)); ctx.stroke(); });
      },
      badge:(i,kind)=>{
        const svg=staffDiv.querySelector("svg"); if(!svg) return;
        const id=`badge-${i}`; let t=svg.querySelector(`#${id}`); const xy=centers[i]; if(!xy) return;
        const cls=kind==="◎"?"badge-good":kind==="◯"?"badge-ok":"badge-ng";
        if(!t){ t=document.createElementNS(NS,"text"); t.setAttribute("id",id); svg.appendChild(t); }
        t.setAttribute("class",`badge ${cls}`); t.setAttribute("x",xy.x+8); t.setAttribute("y",40); t.textContent=kind;
      },
      getXY:(i)=>centers[i]||{x:0,y:0}
    };
  }

  // ===== フォールバック（自前SVG） =====
  const svg=document.createElementNS(NS,"svg"); svg.setAttribute("viewBox",`0 0 ${W} ${H}`); svg.setAttribute("width","100%"); svg.setAttribute("height","100%");
  staffDiv.appendChild(svg);
  const top=12, space=7.2, left=6, right=W-6, bottom=top+space*4;
  for(let i=0;i<5;i++){ const l=document.createElementNS(NS,"line"); l.setAttribute("x1",left);l.setAttribute("x2",right);l.setAttribute("y1",top+space*i);l.setAttribute("y2",top+space*i);l.setAttribute("stroke","#e8eef7"); svg.appendChild(l);}
  const ksW=drawKeySig(svg,key, left+6, top, space);
  const L=left+6+ksW+4, R=right-6;
  const dx=(R-L)/Math.max(1,slice.length);
  const g=document.createElementNS(NS,"g"); svg.appendChild(g);
  const nodes=[];
  slice.forEach((n,i)=>{
    const x=L+dx*(i+0.5), y=yFor(n.letter,n.octave,top,space);
    if(y<top||y>bottom){
      const short=12;
      for(let yy=top-space; yy>=y-1; yy-=space){ const ll=document.createElementNS(NS,"line"); ll.setAttribute("x1",x-short/2); ll.setAttribute("x2",x+short/2); ll.setAttribute("y1",yy); ll.setAttribute("y2",yy); ll.setAttribute("stroke","#a7c7dd"); g.appendChild(ll); }
      for(let yy=bottom+space; yy<=y+1; yy+=space){ const ll=document.createElementNS(NS,"line"); ll.setAttribute("x1",x-short/2); ll.setAttribute("x2",x+short/2); ll.setAttribute("y1",yy); ll.setAttribute("y2",yy); ll.setAttribute("stroke","#a7c7dd"); g.appendChild(ll); }
    }
    const head=document.createElementNS(NS,"ellipse"); head.setAttribute("cx",x); head.setAttribute("cy",y); head.setAttribute("rx","3.6"); head.setAttribute("ry","2.4"); head.setAttribute("class","note-normal"); head.setAttribute("transform",`rotate(-20 ${x} ${y})`);
    const stem=document.createElementNS(NS,"line"); stem.setAttribute("x1",x+4.8); stem.setAttribute("x2",x+4.8); stem.setAttribute("y1",y-2); stem.setAttribute("y2",y-12); stem.setAttribute("stroke","#e8eef7"); stem.setAttribute("stroke-width","1.1");
    g.appendChild(head); g.appendChild(stem); nodes.push({head,stem,x,y});
    if((i+1)%8===0){ const bx=L+dx*(i+1); const m=document.createElementNS(NS,"line"); m.setAttribute("x1",bx);m.setAttribute("x2",bx);m.setAttribute("y1",top);m.setAttribute("y2",bottom);m.setAttribute("stroke","#284559");svg.appendChild(m); }
  });
  const bb=g.getBBox(); const fit=Math.min(1,(H-14)/(bb.height+16)); if(fit<1){ g.setAttribute("transform",`scale(${fit})`); }

  return {
    mode:"fb",
    recolor:(i,cls)=>{ const n=nodes[i]; if(!n) return; const col=cls==="note-target"?"#22c55e":cls==="note-failed"?"#f43f5e":"#e8eef7"; n.head.setAttribute("class",cls); n.head.setAttribute("fill",col); n.head.setAttribute("stroke",col); n.stem.setAttribute("stroke",col); },
    badge:(i,kind)=>{ const n=nodes[i]; if(!n) return; const t=document.createElementNS(NS,"text"); t.setAttribute("x",n.x+8); t.setAttribute("y",40); t.setAttribute("class",`badge ${kind==="◎"?"badge-good":kind==="◯"?"badge-ok":"badge-ng"}`); t.textContent=kind; svg.appendChild(t); },
    getXY:(i)=>nodes[i]?{x:nodes[i].x,y:nodes[i].y}:{x:0,y:0}
  };
}
