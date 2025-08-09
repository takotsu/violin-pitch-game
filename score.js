import { KEY_SIG } from "./scales.js";

const staffDiv = document.getElementById('staff');

/* ===== 共通ユーティリティ ===== */
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

/* ===== VexFlow or フォールバック ===== */
let fbState = null;
let VFCache = null;

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

function renderFallbackScale(key, noteObjs, highlightIdx=0){
  staffDiv.innerHTML="";
  const w=staffDiv.clientWidth||1024, h=200; const svg=mkSvg(w,h); staffDiv.appendChild(svg);
  const left=18, right=w-14, staffTop=30, space=14, staffBottom=staffTop+space*4;

  for(let i=0;i<5;i++) line(svg,left, staffTop+space*i, right, staffTop+space*i, "#e8eef7", 1.2);
  // 4/4（ト音記号は描かない）
  text(svg, left+10, staffTop+space*2, "4", 14, "800", "middle");
  text(svg, left+10, staffTop+space*4, "4", 14, "800", "middle");

  const ksWidth = renderKeySignature(svg, key, left+26, staffTop, space);
  const innerLeft = left+26+ksWidth+10, innerRight = right-6;

  const cols = noteObjs.length;
  const stepX = (innerRight-innerLeft)/Math.max(1, cols);
  const yFor=(L,O)=>{ const seq=["C","D","E","F","G","A","B"]; const idx=(l)=>seq.indexOf(l); const s=(O-4)*7 + (idx(L)-idx("E")); return staffBottom - (s*space/2); };

  const nodes=[]; // {x, yHead, head, stem, label}
  noteObjs.forEach((n,i)=>{
    const x = innerLeft + stepX*(i+0.5);
    const y = yFor(n.letter, n.octave);
    const color = (i===highlightIdx) ? "#22c55e" : "#e8eef7";
    const head=notehead(svg, x, y, color); const stm=stem(svg, x, y-3, 20, color);
    const label=text(svg, x, y+18, "", 11, "800","middle","#a7c7dd");
    if((i+1)%8===0 && i<cols-1){ const bx = innerLeft + stepX*(i+1); line(svg,bx,staffTop,bx,staffBottom,"#7aa2c1",1.2); }
    nodes.push({x,yHead:y,head:head,stem:stm,label:label});
  });

  fbState = { key, noteObjs, svg, nodes, staffTop, staffBottom, space, left, right };
  VFCache=null;
  return {renderer:null, stave:null, notes:[], ann:[], nodes};
}

export function renderScale(keySignature, vexKeys, noteObjs=null){
  const VF = window.Vex?.Flow;
  if(VF){
    staffDiv.innerHTML="";
    const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
    const w=staffDiv.clientWidth||1024, h=200; renderer.resize(w,h);
    const ctx = renderer.getContext();
    const stave = new VF.Stave(10,18,w-20);
    // ト音記号は付けない
    stave.addTimeSignature("4/4").addKeySignature(keySignature);
    stave.setContext(ctx).draw();

    const notes=[];
    (vexKeys||[]).forEach((vk,i)=>{
      const sn=new VF.StaveNote({keys:[vk],duration:"8",clef:"treble"});
      // 下側にスコア注記（初期空文字）
      const ann=new VF.Annotation("").setJustification(VF.Annotation.Justify.CENTER).setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM);
      ann.setFont("Sans", 11, "bold"); sn.addModifier(0, ann);
      notes.push(sn);
      if((i+1)%8===0 && i<(vexKeys.length-1)) notes.push(new VF.BarNote());
    });
    const onlyNotes = notes.filter(n=>n.getCategory && n.getCategory()==='stavenotes');
    const beams=[]; for(let i=0;i<onlyNotes.length;i+=4){ beams.push(new VF.Beam(onlyNotes.slice(i,i+4))); }
    const voice=new VF.Voice({num_beats:16,beat_value:4}); voice.setMode(VF.Voice.Mode.SOFT); voice.addTickables(notes);
    new VF.Formatter().joinVoices([voice]).format([voice], w-40); voice.draw(ctx,stave); beams.forEach(b=>b.setContext(ctx).draw());

    VFCache={renderer, ctx, stave, notes:onlyNotes, beams, voice, all:notes};
    fbState=null;
    // 初回は 0 番だけハイライト
    highlightIndex(VFCache, 0);
    return {renderer, stave, notes:onlyNotes, ann:onlyNotes.map(n=>n.getModifiers(0).find(m=>m.getCategory()==='annotations'))};
  }else{
    const objs = noteObjs || (vexKeys||[]).map(vk=>{ const m=vk.match(/^([A-G])\/(\d)$/); return {letter:m?m[1]:"A", octave:m?+m[2]:4}; });
    return renderFallbackScale(keySignature, objs, 0);
  }
}

export function highlightIndex(renderCtx, idx){
  const VF = window.Vex?.Flow;
  if(VF && (VFCache||renderCtx)?.notes?.length){
    const cache = VFCache || renderCtx;
    const {renderer, stave} = cache;
    const w=staffDiv.clientWidth||1024, h=200; renderer.resize(w,h);
    const ctx = renderer.getContext(); ctx.clear(); stave.setContext(ctx).draw();

    const notes = cache.notes.map((sn,i)=>{
      const color = (i===idx) ? "#22c55e" : "#e8eef7";
      sn.setStyle({fillStyle:color, strokeStyle:color});
      return sn;
    });
    const beams=[]; for(let i=0;i<notes.length;i+=4){ beams.push(new window.Vex.Flow.Beam(notes.slice(i,i+4))); }
    const voice=new window.Vex.Flow.Voice({num_beats:16,beat_value:4}); voice.setMode(window.Vex.Flow.Voice.Mode.SOFT); voice.addTickables(notes);
    new window.Vex.Flow.Formatter().joinVoices([voice]).format([voice], w-40);
    voice.draw(ctx,stave); beams.forEach(b=>b.setContext(ctx).draw());
    VFCache={renderer, ctx, stave, notes, beams, voice};
    return;
  }
  if(fbState){
    fbState.nodes.forEach((n,i)=>{
      const c = (i===idx) ? "#22c55e" : "#e8eef7";
      n.head.setAttribute("fill",c); n.stem.setAttribute("stroke",c);
    });
  }
}

export function setNoteLabel(renderCtx, idx, textStr){
  const VF = window.Vex?.Flow;
  if(VF && (VFCache||renderCtx)?.notes?.length){
    const cache=VFCache||renderCtx;
    const note=cache.notes[idx]; if(!note) return;
    const ann = note.getModifiers(0).find(m=>m.getCategory()==='annotations');
    if(ann){ ann.setText(String(textStr)); }
    // 再描画
    highlightIndex(cache, idx);
    return;
  }
  if(fbState?.nodes?.[idx]){
    fbState.nodes[idx].label.textContent = String(textStr);
  }
}
