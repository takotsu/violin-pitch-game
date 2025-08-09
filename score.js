import { KEY_SIG } from "./scales.js";

const staffDiv = document.getElementById('staff');

function mkSvg(w,h){ const ns="http://www.w3.org/2000/svg"; const s=document.createElementNS(ns,"svg"); s.setAttribute("viewBox",`0 0 ${w} ${h}`); s.setAttribute("width","100%"); s.setAttribute("height","100%"); return s; }
function text(svg,x,y,str,size=12,weight="700",anchor="middle",fill="#a7c7dd"){
  const ns="http://www.w3.org/2000/svg"; const t=document.createElementNS(ns,"text");
  t.setAttribute("x",x); t.setAttribute("y",y); t.setAttribute("fill",fill);
  t.setAttribute("font-size",size); t.setAttribute("font-weight",weight); t.setAttribute("text-anchor",anchor);
  t.setAttribute("font-family",'system-ui,"Noto Music","Bravura","Petaluma",sans-serif'); t.textContent=str; svg.appendChild(t); return t;
}
function line(svg,x1,y1,x2,y2,stroke="#e8eef7",w=1){ const ns="http://www.w3.org/2000/svg"; const l=document.createElementNS(ns,"line"); l.setAttribute("x1",x1); l.setAttribute("y1",y1); l.setAttribute("x2",x2); l.setAttribute("y2",y2); l.setAttribute("stroke",stroke); l.setAttribute("stroke-width",w); svg.appendChild(l); return l; }
function notehead(svg,x,y,fill="#e8eef7",rX=5.8,rY=4.2,rot=-20){ const ns="http://www.w3.org/2000/svg"; const e=document.createElementNS(ns,"ellipse"); e.setAttribute("cx",x); e.setAttribute("cy",y); e.setAttribute("rx",rX); e.setAttribute("ry",rY); e.setAttribute("fill",fill); e.setAttribute("transform",`rotate(${rot},${x},${y})`); svg.appendChild(e); return e; }
function stem(svg,x,yUp,len=18,stroke="#e8eef7"){ return line(svg,x+7,yUp, x+7, yUp-len, stroke, 1.6); }

let fbState = null;
let VFCache = null;

/* ==== フォールバック（SVG） 2段描画 ==== */
function renderKeySignature(svg, key, left, staffTop, space){
  const sig = KEY_SIG[key] || KEY_SIG["C"];
  if(!sig.sharps.length && !sig.flats.length) return 0;
  const SHARP_POS=[{L:'F',o:5},{L:'C',o:5},{L:'G',o:5},{L:'D',o:5},{L:'A',o:4},{L:'E',o:5},{L:'B',o:4}];
  const FLAT_POS =[{L:'B',o:4},{L:'E',o:5},{L:'A',o:4},{L:'D',o:5},{L:'G',o:4},{L:'C',o:5},{L:'F',o:4}];
  const yFor=(letter,oct)=>{ const seq=["C","D","E","F","G","A","B"]; const idx=(L)=>seq.indexOf(L);
    const steps=(oct-4)*7 + (idx(letter)-idx("E")); const staffBottom=staffTop+space*4; return staffBottom - (steps*space/2); };
  let x=left;
  const drawSharp=(L,o)=>{ text(svg,x, yFor(L,o)+4, "♯", 18, "800","left","#e8eef7"); x+=10; };
  const drawFlat =(L,o)=>{ text(svg,x, yFor(L,o)+4, "♭", 18, "800","left","#e8eef7"); x+=10; };
  if(sig.sharps.length){ for(let i=0;i<sig.sharps.length;i++){ const p=SHARP_POS[i]; drawSharp(p.L,p.o); } }
  else if(sig.flats.length){ for(let i=0;i<sig.flats.length;i++){ const p=FLAT_POS[i]; drawFlat(p.L,p.o); } }
  return x-left;
}

function renderFallbackScaleTwoSystems(key, noteObjs, highlightIdx=0){
  staffDiv.innerHTML="";
  const w=staffDiv.clientWidth||660, h=360; const svg=mkSvg(w,h); staffDiv.appendChild(svg);

  const systems = [
    {top:30, left:12, right:w-12, notes: noteObjs.slice(0,16)},
    {top:200, left:12, right:w-12, notes: noteObjs.slice(16,32)}
  ];
  const nodes=[];

  systems.forEach((sys, sIdx)=>{
    const {top,left,right,notes} = sys;
    const space=14, bottom=top+space*4;
    for(let i=0;i<5;i++) line(svg,left, top+space*i, right, top+space*i, "#e8eef7", 1.2);
    text(svg, left+10, top+space*2, "4", 14, "800", "middle");
    text(svg, left+10, top+space*4, "4", 14, "800", "middle");

    const ksW = renderKeySignature(svg, key, left+26, top, space);
    const innerLeft = left+26+ksW+10, innerRight = right-6;

    const stepX = (innerRight-innerLeft)/Math.max(1, notes.length);
    const yFor=(L,O)=>{ const seq=["C","D","E","F","G","A","B"]; const idx=(l)=>seq.indexOf(l); const s=(O-4)*7 + (idx(L)-idx("E")); return bottom - (s*space/2); };

    notes.forEach((n,i)=>{
      const xi = innerLeft + stepX*(i+0.5);
      const yi = yFor(n.letter, n.octave);
      const gi = sIdx*16 + i;
      const color = (gi===highlightIdx) ? "#22c55e" : "#e8eef7";
      const head=notehead(svg, xi, yi, color); const stm=stem(svg, xi, yi-3, 20, color);
      nodes[gi] = {head:head, stem:stm};
      if((i+1)%8===0 && i<notes.length-1){ const bx=innerLeft+stepX*(i+1); line(svg,bx,top,bx,bottom,"#7aa2c1",1.2); }
    });
  });

  fbState={key, noteObjs, svg, nodes};
  VFCache=null;
  return {renderer:null, stave:null, notes:[], nodes};
}

/* ==== VexFlow があれば使う ==== */
export function renderScale(keySignature, vexKeys, noteObjs=null){
  const VF = window.Vex?.Flow;
  if(VF){
    staffDiv.innerHTML="";
    const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
    const w=staffDiv.clientWidth||660, h=360; renderer.resize(w,h);
    const ctx = renderer.getContext();

    const stave1 = new VF.Stave(10,20,w-20);
    stave1.addTimeSignature("4/4").addKeySignature(keySignature);
    stave1.setContext(ctx).draw();

    const stave2 = new VF.Stave(10,200,w-20);
    stave2.addTimeSignature("4/4").addKeySignature(keySignature);
    stave2.setContext(ctx).draw();

    const keys1=vexKeys.slice(0,16), keys2=vexKeys.slice(16,32);
    const makeNotes=(keys)=>keys.map(k=>new VF.StaveNote({keys:[k],duration:"8",clef:"treble"}));
    const notes1=makeNotes(keys1), notes2=makeNotes(keys2);
    const voice1=new VF.Voice({num_beats:16,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(notes1);
    const voice2=new VF.Voice({num_beats:16,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(notes2);
    new VF.Formatter().joinVoices([voice1]).format([voice1], w-40);
    new VF.Formatter().joinVoices([voice2]).format([voice2], w-40);
    voice1.draw(ctx,stave1); voice2.draw(ctx,stave2);

    VFCache={renderer, ctx, stave1, stave2, notes:[...notes1,...notes2]};
    fbState=null;
    highlightIndex(VFCache, 0);
    return VFCache;
  }else{
    const objs = noteObjs || (vexKeys||[]).map(vk=>{ const m=vk.match(/^([A-G])\/(\d)$/); return {letter:m?m[1]:"A", octave:m?+m[2]:4}; });
    return renderFallbackScaleTwoSystems(keySignature, objs, 0);
  }
}

export function highlightIndex(renderCtx, idx){
  const VF = window.Vex?.Flow;
  if(VF && (VFCache||renderCtx)?.notes?.length){
    const cache = VFCache || renderCtx;
    const {renderer, stave1, stave2} = cache;
    const w=staffDiv.clientWidth||660, h=360; renderer.resize(w,h);
    const ctx = renderer.getContext(); ctx.clear(); stave1.setContext(ctx).draw(); stave2.setContext(ctx).draw();

    const notes = cache.notes.map((sn,i)=>{
      const color = (i===idx) ? "#22c55e" : "#e8eef7";
      sn.setStyle({fillStyle:color, strokeStyle:color});
      return sn;
    });
    const voice1=new window.Vex.Flow.Voice({num_beats:16,beat_value:4}).setMode(window.Vex.Flow.Voice.Mode.SOFT).addTickables(notes.slice(0,16));
    const voice2=new window.Vex.Flow.Voice({num_beats:16,beat_value:4}).setMode(window.Vex.Flow.Voice.Mode.SOFT).addTickables(notes.slice(16,32));
    new window.Vex.Flow.Formatter().joinVoices([voice1]).format([voice1], w-40);
    new window.Vex.Flow.Formatter().joinVoices([voice2]).format([voice2], w-40);
    voice1.draw(ctx,stave1); voice2.draw(ctx,stave2);
    VFCache={renderer, ctx, stave1, stave2, notes};
    return;
  }
  if(fbState?.nodes){
    fbState.nodes.forEach((n,i)=>{ const c=(i===idx)?"#22c55e":"#e8eef7"; if(!n) return; n.head.setAttribute("fill",c); n.stem.setAttribute("stroke",c); });
  }
}
