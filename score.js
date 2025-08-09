const staffDiv = document.getElementById('staff');
const karaokeCanvas = document.getElementById('karaoke');

function ensureCanvasSize(){
  const w=staffDiv.clientWidth||480, h=152;
  karaokeCanvas.width=w; karaokeCanvas.height=h;
}

/* ---------- フォールバック描画（VexFlowなしでも五線譜を出す） ---------- */
let fbState = null; // {key, noteObjs, idx, nextIdx}

function mkSvg(w,h){ const ns="http://www.w3.org/2000/svg"; const s=document.createElementNS(ns,"svg"); s.setAttribute("viewBox",`0 0 ${w} ${h}`); s.setAttribute("width","100%"); s.setAttribute("height","100%"); return s; }
function text(svg,x,y,str,size=14,weight="600",anchor="start"){
  const ns="http://www.w3.org/2000/svg"; const t=document.createElementNS(ns,"text");
  t.setAttribute("x",x); t.setAttribute("y",y); t.setAttribute("fill","#e8eef7");
  t.setAttribute("font-size",size); t.setAttribute("font-weight",weight); t.setAttribute("text-anchor",anchor);
  t.setAttribute("font-family",'system-ui,"Noto Music","Bravura","Petaluma",sans-serif'); t.textContent=str; svg.appendChild(t);
}
function line(svg,x1,y1,x2,y2,stroke="#e8eef7",w=1){
  const ns="http://www.w3.org/2000/svg"; const l=document.createElementNS(ns,"line");
  l.setAttribute("x1",x1); l.setAttribute("y1",y1); l.setAttribute("x2",x2); l.setAttribute("y2",y2);
  l.setAttribute("stroke",stroke); l.setAttribute("stroke-width",w); svg.appendChild(l);
}
function notehead(svg,x,y,fill="#e8eef7",rX=5.8,rY=4.2,rot=-20){
  const ns="http://www.w3.org/2000/svg"; const e=document.createElementNS(ns,"ellipse");
  e.setAttribute("cx",x); e.setAttribute("cy",y); e.setAttribute("rx",rX); e.setAttribute("ry",rY);
  e.setAttribute("fill",fill); e.setAttribute("transform",`rotate(${rot},${x},${y})`); svg.appendChild(e);
}
function stem(svg,x,yUp,len=18,stroke="#e8eef7"){ line(svg,x+7,yUp, x+7, yUp-len, stroke, 1.6); }
function bar(svg,x,top,bottom){ line(svg,x,top, x, bottom, "#7aa2c1", 1.2); }

function renderFallbackScale(key, noteObjs, highlightIdx=-1, nextIdx=null){
  staffDiv.innerHTML="";
  const w=staffDiv.clientWidth||480, h=152; const svg=mkSvg(w,h); staffDiv.appendChild(svg);
  const left=18, right=w-14, staffTop=20, space=12, staffBottom=staffTop+space*4;

  // 五線
  for(let i=0;i<5;i++){ line(svg,left, staffTop+space*i, right, staffTop+space*i, "#e8eef7", 1.2); }
  // 4/4
  text(svg, left+10, staffTop+space*2, "4", 14, "800", "middle");
  text(svg, left+10, staffTop+space*4, "4", 14, "800", "middle");
  // G-clef（フォント任せ：𝄞）
  text(svg, left+28, staffTop+space*4-2, "𝄞", 26, "700", "middle");

  // ノート配置
  const cols = noteObjs.length;
  const innerLeft = left+56, innerRight = right-6;
  const stepX = (innerRight-innerLeft)/Math.max(1, cols);
  const yFor = (letter,oct)=>{
    // ト音記号：下線E4がline0, spaceごとに1段。E4(0), F4(1), G4(2), A4(3), B4(4), C5(5), D5(6), E5(7), F5(8)...
    const seq=["C","D","E","F","G","A","B"]; const idx=(L)=>seq.indexOf(L);
    // E4基準の段数
    const stepsFromE4 = (L, O)=>{
      // ダイアトニック段
      let s = (O-4)*7 + (idx(L)-idx("E"));
      // Cを跨ぐたびにオクターブ調整は上式でOK
      return s;
    };
    const s = stepsFromE4(letter,oct);
    return staffBottom - (s*space/2);
  };

  noteObjs.forEach((n,i)=>{
    const x = innerLeft + stepX*(i+0.5);
    const y = yFor(n.letter, n.octave);
    const isNow = (i===highlightIdx);
    const isNext= (i===nextIdx);
    const color = isNow? "#22c55e" : isNext? "#60a5fa" : "#e8eef7";
    notehead(svg, x, y, color);
    stem(svg, x, y-3, 18, color);
    // 小節線（8音ごと）
    if((i+1)%8===0 && i<cols-1){
      const bx = innerLeft + stepX*(i+1);
      bar(svg, bx, staffTop, staffBottom);
    }
  });

  ensureCanvasSize();
  fbState = { key, noteObjs, lastW:w, lastH:h };
  return { renderer:null, stave:null, notes: Array(noteObjs.length).fill(0) };
}

function renderFallbackTuner(){
  return renderFallbackScale("G", [{letter:"A",octave:4}], 0, null);
}

/* ---------- VexFlow経路 or フォールバック ---------- */
export function renderScale(keySignature, vexKeys, noteObjs=null){
  const VF = window.Vex?.Flow;
  if(VF){
    staffDiv.innerHTML="";
    const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
    const w=staffDiv.clientWidth||480, h=152; renderer.resize(w,h);
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
    // フォールバック（vexKeys→noteObjsが無ければパース）
    const objs = noteObjs || (vexKeys||[]).map(vk=>{ const m=vk.match(/^([A-G])\/(\d)$/); return {letter:m?m[1]:"A", octave:m?+m[2]:4}; });
    return renderFallbackScale(keySignature, objs, 0, Math.min(1, objs.length-1));
  }
}

export function renderTunerStaff(){
  const VF = window.Vex?.Flow;
  if(VF){
    staffDiv.innerHTML="";
    const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
    const w=staffDiv.clientWidth||480, h=152; renderer.resize(w,h);
    const ctx = renderer.getContext();
    const stave = new VF.Stave(10,10,w-20);
    stave.addClef("treble").addTimeSignature("4/4").setContext(ctx).draw();

    const n=new VF.StaveNote({keys:["A/4"],duration:"w",clef:"treble"});
    const voice=new VF.Voice({num_beats:4,beat_value:4}); voice.addTickables([n]);
    new VF.Formatter().joinVoices([voice]).format([voice], w-40); voice.draw(ctx,stave);
    ensureCanvasSize();
    fbState=null;
    return {renderer, stave, notes:[n]};
  }else{
    return renderFallbackTuner();
  }
}

export function highlightIndex(renderCtx, idx, nextIdx=null){
  const VF = window.Vex?.Flow;
  // VexFlow経路
  if(VF && renderCtx?.notes?.length){
    const {renderer, stave} = renderCtx;
    const w=staffDiv.clientWidth||480, h=152; renderer.resize(w,h);
    const ctx = renderer.getContext(); ctx.clear();
    stave.setContext(ctx).draw();

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
  // フォールバック経路
  if(fbState){
    renderFallbackScale(fbState.key, fbState.noteObjs, idx, nextIdx);
  }
}
