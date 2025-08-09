// score.js  （VexFlow v3：グローバル Vex.Flow を使用）
const staffDiv = document.getElementById('staff');
const karaokeCanvas = document.getElementById('karaoke');

function ensureCanvasSize(){
  const w=staffDiv.clientWidth||480, h=152; // CSSと一致
  karaokeCanvas.width=w; karaokeCanvas.height=h;
}

export function renderSingle(noteName="A4"){
  const VF = Vex.Flow; // グローバル
  staffDiv.innerHTML="";
  const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
  const w=staffDiv.clientWidth||480, h=152; renderer.resize(w,h);
  const ctx = renderer.getContext();
  const stave = new VF.Stave(10,10,w-20);
  stave.addClef("treble").addTimeSignature("4/4"); stave.setContext(ctx).draw();

  const key=toVexKey(noteName);
  const n=new VF.StaveNote({keys:[key],duration:"w",clef:"treble"});
  if(noteName.includes("#")) n.addModifier(new VF.Accidental("#"),0);
  const voice=new VF.Voice({num_beats:4,beat_value:4}); voice.addTickables([n]);
  new VF.Formatter().joinVoices([voice]).format([voice], w-40); voice.draw(ctx,stave);
  ensureCanvasSize();
  return {renderer, stave, notes:[n]};
}

export function renderScale(scale){
  const VF = Vex.Flow;
  staffDiv.innerHTML="";
  const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
  const w=staffDiv.clientWidth||480, h=152; renderer.resize(w,h);
  const ctx = renderer.getContext();
  const stave = new VF.Stave(10,10,w-20);
  stave.addClef("treble").addTimeSignature("4/4").addKeySignature(scale.keySignature);
  stave.setContext(ctx).draw();

  const notes = [];
  scale.notes.forEach((nn,i)=>{
    const k=toVexKey(nn);
    const sn=new VF.StaveNote({keys:[k],duration:"8",clef:"treble"});
    if(nn.includes("#")) sn.addModifier(new VF.Accidental("#"),0);
    notes.push(sn);
    if((i+1)%8===0 && i<scale.notes.length-1) notes.push(new VF.BarNote());
  });

  const onlyNotes = notes.filter(n=>n.getCategory && n.getCategory()==='stavenotes');
  const beams=[];
  for(let i=0;i<onlyNotes.length;i+=4){ beams.push(new Vex.Flow.Beam(onlyNotes.slice(i,i+4))); }

  const voice=new VF.Voice({num_beats:16,beat_value:4});
  voice.setMode(VF.Voice.Mode.SOFT);
  voice.addTickables(notes);

  new VF.Formatter().joinVoices([voice]).format([voice], w-40);
  voice.draw(ctx,stave);
  beams.forEach(b=>b.setContext(ctx).draw());

  ensureCanvasSize();
  return {renderer, stave, notes:onlyNotes};
}

export function highlightIndex(renderCtx, idx, nextIdx=null){
  const VF = Vex.Flow; if(!renderCtx?.notes?.length) return;
  const {renderer, stave} = renderCtx;
  const w=staffDiv.clientWidth||480, h=152; renderer.resize(w,h);
  const ctx = renderer.getContext(); ctx.clear();
  stave.setContext(ctx).draw();

  const notes = renderCtx.notes.map((sn,i)=>{
    sn.setStyle({fillStyle:(i===idx?"#22c55e": i===nextIdx?"#60a5fa":"#e8eef7"),
                 strokeStyle:(i===idx?"#22c55e": i===nextIdx?"#60a5fa":"#e8eef7")});
    return sn;
  });
  const beams=[];
  for(let i=0;i<notes.length;i+=4){ beams.push(new Vex.Flow.Beam(notes.slice(i,i+4))); }
  const voice=new VF.Voice({num_beats:16,beat_value:4});
  voice.setMode(VF.Voice.Mode.SOFT); voice.addTickables(notes);
  new VF.Formatter().joinVoices([voice]).format([voice], w-40);
  voice.draw(ctx,stave);
  beams.forEach(b=>b.setContext(ctx).draw());
}

function toVexKey(n){ const m=n.match(/^([A-Ga-g])([#b]?)(\d)$/); const L=m[1].toUpperCase(),acc=m[2]||"",o=m[3]; return `${L}${acc}/${o}`; }
