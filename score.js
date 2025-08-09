// score.js（VexFlow v3：window.Vex.Flow に依存）
const staffDiv = document.getElementById('staff');
const karaokeCanvas = document.getElementById('karaoke');

function ensureCanvasSize(){
  const w=staffDiv.clientWidth||480, h=152;
  karaokeCanvas.width=w; karaokeCanvas.height=h;
}

export function renderScale(keySignature, vexKeys){
  const VF = window.Vex?.Flow; if(!VF) throw new Error("VexFlow 未ロード");
  staffDiv.innerHTML="";
  const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
  const w=staffDiv.clientWidth||480, h=152; renderer.resize(w,h);
  const ctx = renderer.getContext();
  const stave = new VF.Stave(10,10,w-20);
  stave.addClef("treble").addTimeSignature("4/4").addKeySignature(keySignature);
  stave.setContext(ctx).draw();

  const notes=[];
  vexKeys.forEach((vk,i)=>{
    notes.push(new VF.StaveNote({keys:[vk],duration:"8",clef:"treble"}));
    if((i+1)%8===0 && i<vexKeys.length-1) notes.push(new VF.BarNote());
  });
  const onlyNotes = notes.filter(n=>n.getCategory && n.getCategory()==='stavenotes');
  const beams=[]; for(let i=0;i<onlyNotes.length;i+=4){ beams.push(new VF.Beam(onlyNotes.slice(i,i+4))); }

  const voice=new VF.Voice({num_beats:16,beat_value:4});
  voice.setMode(VF.Voice.Mode.SOFT); voice.addTickables(notes);
  new VF.Formatter().joinVoices([voice]).format([voice], w-40);
  voice.draw(ctx,stave); beams.forEach(b=>b.setContext(ctx).draw());

  ensureCanvasSize();
  return {renderer, stave, notes:onlyNotes};
}

export function renderTunerStaff(){
  const VF = window.Vex?.Flow; if(!VF) throw new Error("VexFlow 未ロード");
  staffDiv.innerHTML="";
  const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
  const w=staffDiv.clientWidth||480, h=152; renderer.resize(w,h);
  const ctx = renderer.getContext();
  const stave = new VF.Stave(10,10,w-20);
  stave.addClef("treble").addTimeSignature("4/4").setContext(ctx).draw();

  const n=new VF.StaveNote({keys:["A/4"],duration:"w",clef:"treble"});
  const voice=new VF.Voice({num_beats:4,beat_value:4}); voice.addTickables([n]);
  new VF.Formatter().joinVoices([voice]).format([voice], w-40);
  voice.draw(ctx,stave);

  ensureCanvasSize();
  return {renderer, stave, notes:[n]};
}

export function highlightIndex(renderCtx, idx, nextIdx=null){
  const VF = window.Vex?.Flow; if(!VF || !renderCtx?.notes?.length) return;
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
}
