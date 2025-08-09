// score.js
// VexFlow は index.html で window.Vex として読み込まれている前提
const staffDiv = document.getElementById('staff');
const karaokeCanvas = document.getElementById('karaoke');

function ensureCanvasSize(){
  const w=staffDiv.clientWidth||480, h=190;
  karaokeCanvas.width=w; karaokeCanvas.height=h;
}

export function renderSingle(noteName="A4"){
  const Vex = window.Vex; if(!Vex) return {notes:[]};
  staffDiv.innerHTML="";
  const renderer = new Vex.Flow.Renderer(staffDiv, Vex.Flow.Renderer.Backends.SVG);
  const w=staffDiv.clientWidth||480, h=190; renderer.resize(w,h);
  const ctx = renderer.getContext();
  const stave = new Vex.Flow.Stave(10,10,w-20);
  stave.addClef("treble").addTimeSignature("4/4"); stave.setContext(ctx).draw();

  const key=noteToVexKey(noteName);
  const n=new Vex.Flow.StaveNote({keys:[key],duration:"w",clef:"treble"});
  if(noteName.includes("#")) n.addModifier(new Vex.Flow.Accidental("#"),0);
  const voice=new Vex.Flow.Voice({num_beats:4,beat_value:4}); voice.addTickables([n]);
  new Vex.Flow.Formatter().joinVoices([voice]).format([voice], w-40); voice.draw(ctx,stave);
  ensureCanvasSize();
  return {renderer, stave, notes:[n]};
}

export function renderScale(scale){
  const Vex = window.Vex; if(!Vex) return {notes:[]};
  staffDiv.innerHTML="";
  const renderer = new Vex.Flow.Renderer(staffDiv, Vex.Flow.Renderer.Backends.SVG);
  const w=staffDiv.clientWidth||480, h=190; renderer.resize(w,h);
  const ctx = renderer.getContext();
  const stave = new Vex.Flow.Stave(10,10,w-20);
  stave.addClef("treble").addTimeSignature("4/4").addKeySignature(scale.keySignature);
  stave.setContext(ctx).draw();

  const notes = [];
  scale.notes.forEach((nn,i)=>{
    const k=noteToVexKey(nn);
    const sn=new Vex.Flow.StaveNote({keys:[k],duration:"8",clef:"treble"});
    if(nn.includes("#")) sn.addModifier(new Vex.Flow.Accidental("#"),0);
    notes.push(sn);
    if((i+1)%8===0 && i<scale.notes.length-1) notes.push(new Vex.Flow.BarNote());
  });

  const onlyNotes = notes.filter(n=>n instanceof Vex.Flow.StaveNote);
  const beams=[];
  for(let i=0;i<onlyNotes.length;i+=4){ beams.push(new Vex.Flow.Beam(onlyNotes.slice(i,i+4))); }

  const voice=new Vex.Flow.Voice({num_beats:16,beat_value:4});
  voice.setMode(Vex.Flow.Voice.Mode.SOFT);
  voice.addTickables(notes);

  new Vex.Flow.Formatter().joinVoices([voice]).format([voice], w-40);
  voice.draw(ctx,stave);
  beams.forEach(b=>b.setContext(ctx).draw());

  ensureCanvasSize();
  return {renderer, stave, notes:onlyNotes};
}

// ハイライト：current を強調、next を薄い強調
export function highlightIndex(renderCtx, idx, nextIdx=null){
  const Vex = window.Vex; if(!Vex || !renderCtx?.notes?.length) return;
  const {renderer, stave} = renderCtx;
  // 再描画（色を変えて書き直す）
  const w=staffDiv.clientWidth||480, h=190; renderer.resize(w,h);
  const ctx = renderer.getContext(); ctx.clear();
  stave.setContext(ctx).draw();

  const notes = renderCtx.notes.map((sn,i)=>{
    sn.setStyle({fillStyle:(i===idx?"#22c55e": i===nextIdx?"#60a5fa":"#e8eef7"),
                 strokeStyle:(i===idx?"#22c55e": i===nextIdx?"#60a5fa":"#e8eef7")});
    return sn;
  });

  // 小節線やビームは描画済み情報がないので簡易に：4つずつのビームを引き直す
  const beams=[];
  for(let i=0;i<notes.length;i+=4){ beams.push(new Vex.Flow.Beam(notes.slice(i,i+4))); }
  const voice=new Vex.Flow.Voice({num_beats:16,beat_value:4});
  voice.setMode(Vex.Flow.Voice.Mode.SOFT); voice.addTickables(notes);
  new Vex.Flow.Formatter().joinVoices([voice]).format([voice], w-40);
  voice.draw(ctx,stave);
  beams.forEach(b=>b.setContext(ctx).draw());
}

function noteToVexKey(n){ const m=n.match(/^([A-Ga-g])([#b]?)(\d)$/); const L=m[1].toUpperCase(),acc=m[2]||"",o=m[3]; return `${L}${acc}/${o}`; }
