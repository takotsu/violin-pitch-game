import { KEY_SIG } from "./scales.js";

const staffDiv = document.getElementById('staff');
const karaokeCanvas = document.getElementById('karaoke');

function ensureCanvasSize(){
  const w=staffDiv.clientWidth||600, h=staffDiv.clientHeight||152;
  karaokeCanvas.width=w; karaokeCanvas.height=152; // 固定高でオーバーレイ
}

/* ====== フォールバック描画ユーティリティ ====== */
let fbState = null; // {key, noteObjs}

function mkSvg(w,h){ const ns="http://www.w3.org/2000/svg"; const s=document.createElementNS(ns,"svg"); s.setAttribute("viewBox",`0 0 ${w} ${h}`); s.setAttribute("width","100%"); s.setAttribute("height","100%"); return s; }
function text(svg,x,y,str,size=14,weight="600",anchor="start",fill="#e8eef7"){
  const ns="http://www.w3.org/2000/svg"; const t=document.createElementNS(ns,"text");
  t.setAttribute("x",x); t.setAttribute("y",y); t.setAttribute("fill",fill);
  t.setAttribute("font-size",size); t.setAttribute("font-weight",weight); t.setAttribute("text-anchor",anchor);
  t.setAttribute("font-family",'system-ui,"Noto Music","Bravura","Petaluma",sans-serif'); t.textContent=str; svg.appendChild(t);
}
function line(svg,x1,y1,x2,y2,stroke="#e8eef7",w=1){ const ns="http://www.w3.org/2000/svg"; const l=document.createElementNS(ns,"line"); l.setAttribute("x1",x1); l.setAttribute("y1",y1); l.setAttribute("x2",x2); l.setAttribute("y2",y2); l.setAttribute("stroke",stroke); l.setAttribute("stroke-width",w); svg.appendChild(l); }
function notehead(svg,x,y,fill="#e8eef7",rX=5.8,rY=4.2,rot=-20){ const ns="http://www.w3.org/2000/svg"; const e=document.createElementNS(ns,"ellipse"); e.setAttribute("cx",x); e.setAttribute("cy",y); e.setAttribute("rx",rX); e.setAttribute("ry",rY); e.setAttribute("fill",fill); e.setAttribute("transform",`rotate(${rot},${x},${y})`); svg.appendChild(e); }
function stem(svg,x,yUp,len=18,stroke="#e8eef7"){ line(svg,x+7,yUp, x+7, yUp-len, stroke, 1.6); }
function bar(svg,x,top,bottom){ line(svg,x,top, x, bottom, "#7aa2c1", 1.2); }

function renderKeySignature(svg, key, left, staffTop, space){
  const sig = KEY_SIG[key] || KEY_SIG["C"];
  if(!sig.sharps.length && !sig.flats.length) return 0;
  const SHARP_POS=[{L:'F',o:5},{L:'C',o:5},{L:'G',o:5},{L:'D',o:5},{L:'A',o:4},{L:'E',o:5},{L:'B',o:4}];
  const FLAT_POS =[{L:'B',o:4},{L:'E',o:5},{L:'A',o:4},{L:'D',o:5},{L:'G',o:4},{L:'C',o:5},{L:'F',o:4}];
  const yFor=(letter,oct)=>{ const seq=["C","D","E","F","G","A","B"]; const idx=(L)=>seq.indexOf(L);
    const steps=(oct-4)*7 + (idx(letter)-idx("E")); const staffBottom=staffTop+space*4; return staffBottom - (steps*space/2); };
  let x=left;
  const drawSharp=(L,o)=>{ text(svg,x, yFor(L,o)+4, "♯", 18, "700","left","#e8eef7"); x+=10; };
  const drawFlat =(L,o)=>{ text(svg,x, yFor(L,o)+4, "♭", 18, "700","left","#e8eef7"); x+=10; };
  if(sig.sharps.length){
    const need = sig.sharps.length;
    for(let i=0;i<need;i++){ const p=SHARP_POS[i]; drawSharp(p.L,p.o); }
  }else if(sig.flats.length){
    const need = sig.flats.length;
    for(let i=0;i<need;i++){ const p=FLAT_POS[i]; drawFlat(p.L,p.o); }
  }
  return x-left; // 使用幅
}

function renderFallbackScale(key, noteObjs, highlightIdx=-1, nextIdx=null){
  staffDiv.innerHTML="";
  const w=staffDiv.clientWidth||960, h=152; const svg=mkSvg(w,h); staffDiv.appendChild(svg);
  const left=18, right=w-14, staffTop=20, space=12, staffBottom=staffTop+space*4;

  for(let i=0;i<5;i++) line(svg,left, staffTop+space*i, right, staffTop+space*i, "#e8eef7", 1.2);
  text(svg, left+10, staffTop+space*2, "4", 14, "800", "middle");
  text(svg, left+10, staffTop+space*4, "4", 14, "800", "middle");
  text(svg, left+34, staffTop+space*4-2, "𝄞", 26, "700", "middle");

  // 調号（♯/♭）
  const ksWidth = renderKeySignature(svg, key, left+54, staffTop, space);

  const innerLeft = left+54+ksWidth+10, innerRight = right-6;
  const cols = noteObjs.length;
  const stepX = (innerRight-innerLeft)/Math.max(1, cols);
  const yFor=(L,O)=>{ const seq=["C","D","E","F","G","A","B"]; const idx=(l)=>seq.indexOf(l); const s=(O-4)*7 + (idx(L)-idx("E")); return staffBottom - (s*space/2); };

  noteObjs.forEach((n,i)=>{
    const x = innerLeft + stepX*(i+0.5);
    const y = yFor(n.letter, n.octave);
    const isNow = (i===highlightIdx);
    const isNext= (i===nextIdx);
    const color = isNow? "#22c55e" : isNext? "#60a5fa" : "#e8eef7";
    notehead(svg, x, y, color); stem(svg, x, y-3, 18, color);
    if((i+1)%8===0 && i<cols-1){ const bx = innerLeft + stepX*(i+1); bar(svg, bx, staffTop, staffBottom); }
  });

  ensureCanvasSize();
  fbState = { key, noteObjs };
  return { renderer:null, stave:null, notes: Array(noteObjs.length).fill(0) };
}

/* ====== VexFlow 経路 or フォールバック ====== */
export function renderScale(keySignature, vexKeys, noteObjs=null){
  const VF = window.Vex?.Flow;
  if(VF){
    staffDiv.innerHTML="";
    const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
    const w=staffDiv.clientWidth||960, h=152; renderer.resize(w,h);
    const ctx = renderer.getContext();
    const stave = new VF.Stave(10,10,w-20);
    stave.addClef("treble").addTimeSignature("4/4").addKeySignature(keySignature);
    stave.setContext(ctx).draw();

    const notes=[];
    (vexKeys||[]).forEach((vk,i)=>{
      notes.push(new VF.StaveNote({keys:[vk],duration:"8",clef:"treble"}));
      if((i+1)%8===0 && i<(vexKeys.length-1)) notes.push(new VF.BarNote());
    });
    const onlyNotes = notes.filter(n=>n.getCategory && n.getCategory()==='stavenotes');
    const beams=[]; for(let i=0;i<onlyNotes.length;i+=4){ beams.push(new VF.Beam(onlyNotes.slice(i,i+4))); }
    const voice=new VF.Voice({num_beats:16,beat_value:4}); voice.setMode(VF.Voice.Mode.SOFT); voice.addTickables(notes);
    new VF.Formatter().joinVoices([voice]).format([voice], w-40); voice.draw(ctx,stave); beams.forEach(b=>b.setContext(ctx).draw());
    ensureCanvasSize();
    fbState=null;
    return {renderer, stave, notes:onlyNotes};
  }else{
    const objs = noteObjs || (vexKeys||[]).map(vk=>{ const m=vk.match(/^([A-G])\/(\d)$/); return {letter:m?m[1]:"A", octave:m?+m[2]:4}; });
    return renderFallbackScale(keySignature, objs, 0, Math.min(1, objs.length-1));
  }
}

export function renderTunerStaff(){ // チューナー削除 → ダミーでA4全音符のみ（未使用）
  return renderFallbackScale("C", [{letter:"A",octave:4}], 0, null);
}

export function highlightIndex(renderCtx, idx, nextIdx=null){
  const VF = window.Vex?.Flow;
  if(VF && renderCtx?.notes?.length){
    const {renderer, stave} = renderCtx;
    const w=staffDiv.clientWidth||960, h=152; renderer.resize(w,h);
    const ctx = renderer.getContext(); ctx.clear(); stave.setContext(ctx).draw();

    const notes = renderCtx.notes.map((sn,i)=>{
      sn.setStyle({fillStyle:(i===idx?"#22c55e": i===nextIdx?"#60a5fa":"#e8eef7"),
                   strokeStyle:(i===idx?"#22c55e": i===nextIdx?"#60a5fa":"#e8eef7")});
      return sn;
    });
    const beams=[]; for(let i=0;i<notes.length;i+=4){ beams.push(new VF.Beam(notes.slice(i,i+4))); }
    const voice=new VF.Voice({num_beats:16,beat_value:4}); voice.setMode(VF.Voice.Mode.SOFT); voice.addTickables(notes);
    new VF.Formatter().joinVoices([voice]).format([voice], w-40);
    voice.draw(ctx,stave); beams.forEach(b=>b.setContext(ctx).draw());
    return;
  }
  if(fbState){ renderFallbackScale(fbState.key, fbState.noteObjs, idx, nextIdx); }
}
