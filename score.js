// score.js v0-4b — 1段/ページ（24音）。VexFlow無くても自前SVG。高音見切れを自動スケールで回避。
import { KEY_SIG } from "./scales.js";
const staffDiv=document.getElementById('staff'); const NS="http://www.w3.org/2000/svg";
const mkSvg=(w,h)=>{const s=document.createElementNS(NS,"svg");s.setAttribute("viewBox",`0 0 ${w} ${h}`);s.setAttribute("width","100%");s.setAttribute("height","100%");s.setAttribute("preserveAspectRatio","xMidYMin meet");return s;};
const line=(svg,x1,y1,x2,y2,st="#e8eef7",w=1)=>{const l=document.createElementNS(NS,"line");Object.entries({x1,y1,x2,y2,stroke:st}).forEach(([k,v])=>l.setAttribute(k,v));l.setAttribute("stroke-width",w);svg.appendChild(l);return l;};
const head=(svg,x,y,fill="#e8eef7")=>{const e=document.createElementNS(NS,"ellipse");e.setAttribute("cx",x);e.setAttribute("cy",y);e.setAttribute("rx",3.6);e.setAttribute("ry",2.4);e.setAttribute("fill",fill);e.setAttribute("transform",`rotate(-20,${x},${y})`);svg.appendChild(e);return e;};
const stem=(svg,x,y,len=10,st="#e8eef7")=>line(svg,x+4.8,y-2,x+4.8,y-len,st,1.1);
const LETTERS=["C","D","E","F","G","A","B"]; const idx=(L)=>LETTERS.indexOf(L);
function yFor(letter,oct,top,space){ const bottom=top+space*4; const steps=(oct-4)*7+(idx(letter)-idx("E")); return bottom-(steps*space/2); }
function drawKeySig(svg,key,left,top,space){
  const sig=KEY_SIG[key]||KEY_SIG.C, SH=[{L:"F",o:5},{L:"C",o:5},{L:"G",o:5},{L:"D",o:5},{L:"A",o:4},{L:"E",o:5},{L:"B",o:4}],
        FL=[{L:"B",o:4},{L:"E",o:5},{L:"A",o:4},{L:"D",o:5},{L:"G",o:4},{L:"C",o:5},{L:"F",o:4}];
  let x=left; const t=(L,o,s)=>{const T=document.createElementNS(NS,"text");T.setAttribute("x",x);T.setAttribute("y",yFor(L,o,top,space)+3);T.setAttribute("font-size",11);T.setAttribute("font-weight","900");T.setAttribute("fill","#e8eef7");T.textContent=s; svg.appendChild(T); x+=5; };
  sig.sharps?.forEach((_,i)=>{const p=SH[i]; t(p.L,p.o,"♯");}); sig.flats?.forEach((_,i)=>{const p=FL[i]; t(p.L,p.o,"♭");}); return x-left;
}

export function renderPage({key, vexKeys, objs, page=0, perPage=24}){
  const VF=window.Vex?.Flow; staffDiv.innerHTML="";
  const w=staffDiv.clientWidth||820, H=200;
  const from=page*perPage, to=Math.min(objs.length,from+perPage);
  if(VF){
    const renderer=new VF.Renderer(staffDiv,VF.Renderer.Backends.SVG); renderer.resize(w,H);
    const ctx=renderer.getContext(); const stave=new VF.Stave(6,10,w-12);
    stave.addClef("treble").addKeySignature(key).setContext(ctx).draw();
    const notes=vexKeys.slice(from,to).map(k=>new VF.StaveNote({keys:[k],duration:"8"}).setStemDirection(1));
    const voice=new VF.Voice({num_beats:notes.length,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(notes);
    new VF.Formatter().joinVoices([voice]).format([voice], w-36); voice.draw(ctx,stave);
    return {mode:"vex",renderer,ctx,stave,notes,page,perPage,key,height:H};
  }
  const svg=mkSvg(w,H); staffDiv.appendChild(svg);
  const top=12, space=7.2, left=6, right=w-6, bottom=top+space*4;
  for(let i=0;i<5;i++) line(svg,left,top+space*i,right,top+space*i);
  const ksW=drawKeySig(svg,key,left+6,top,space);
  const L=left+6+ksW+4, R=right-6; const slice=objs.slice(from,to); const stepX=(R-L)/Math.max(1,slice.length);
  const group=document.createElementNS(NS,"g"); svg.appendChild(group);
  const nodes=[];
  slice.forEach((n,i)=>{ const x=L+stepX*(i+0.5), y=yFor(n.letter,n.octave,top,space);
    if(y<top||y>bottom){ const short=12; for(let yy=top-space; yy>=y-1; yy-=space){ line(group,x-short/2,yy,x+short/2,yy,"#a7c7dd",1); }
                          for(let yy=bottom+space; yy<=y+1; yy+=space){ line(group,x-short/2,yy,x+short/2,yy,"#a7c7dd",1); } }
    const h=head(group,x,y,i===0?"#22c55e":"#e8eef7"); const s=stem(group,x,y,10,i===0?"#22c55e":"#e8eef7"); nodes.push({h,s});
    if((i+1)%8===0 && i<slice.length-1){ const bx=L+stepX*(i+1); line(svg,bx,top,bx,bottom,"#284559",1); }
  });
  // 見切れ防止の自動スケール
  const bb=group.getBBox(); const fit=Math.min(1,(H-14)/(bb.height+16)); if(fit<1){ const g2=document.createElementNS(NS,"g"); g2.setAttribute("transform",`scale(${fit})`); g2.appendChild(group); svg.appendChild(g2); }
  return {mode:"fb",svg,nodes,page,perPage,key,height:H};
}

export function recolorPage(ctx, localIdx){
  if(!ctx) return; const w=staffDiv.clientWidth||820;
  if(ctx.mode==="vex"){ ctx.renderer.resize(w,ctx.height||200);
    const VF=window.Vex.Flow, g=ctx.renderer.getContext(); g.clear(); ctx.stave.setContext(g).draw();
    const arr=ctx.notes.map((sn,i)=>{const col=(i===localIdx)?"#22c55e":"#e8eef7"; sn.setStyle({fillStyle:col,strokeStyle:col}); return sn;});
    const v=new VF.Voice({num_beats:arr.length,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(arr);
    new VF.Formatter().joinVoices([v]).format([v], w-36); v.draw(g,ctx.stave); return;
  }
  ctx.nodes?.forEach((n,i)=>{ const col=(i===localIdx)?"#22c55e":"#e8eef7"; n.h.setAttribute("fill",col); n.s.setAttribute("stroke",col); });
}
