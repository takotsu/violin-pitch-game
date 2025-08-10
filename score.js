// score.js v0-3b — VexFlow専用。常に1段のみ表示。24音ごとにページング。
export function renderPage({key, vexKeys, page=0, perPage=24}){
  const VF = window.Vex?.Flow;
  if(!VF) return null;  // まだロードされていない場合は描画しない
  const staffDiv = document.getElementById('staff');
  staffDiv.innerHTML="";
  const w = staffDiv.clientWidth || 820;
  const h = 160;

  const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
  renderer.resize(w,h);
  const vctx = renderer.getContext();

  const stave = new VF.Stave(8, 8, w-16);
  stave.addClef("treble").addKeySignature(key).setContext(vctx).draw();

  const from = page*perPage;
  const to   = Math.min(vexKeys.length, from+perPage);
  const keysSlice = vexKeys.slice(from, to);

  const notes = keysSlice.map(k => new VF.StaveNote({keys:[k], duration:"8"}).setStemDirection(1));

  const voice = new VF.Voice({num_beats:notes.length, beat_value:4})
                    .setMode(VF.Voice.Mode.SOFT)
                    .addTickables(notes);
  new VF.Formatter().joinVoices([voice]).format([voice], w-36);
  voice.draw(vctx, stave);

  return {renderer, ctx:vctx, stave, notes, page, perPage, key};
}

export function recolorPage(ctx, localIdx, scoreForIdx){
  if(!ctx || !ctx.renderer) return;
  const VF = window.Vex?.Flow;
  const staffDiv = document.getElementById('staff');
  const w = staffDiv.clientWidth || 820;
  ctx.renderer.resize(w,160);
  const vg = ctx.renderer.getContext(); vg.clear(); ctx.stave.setContext(vg).draw();

  const arr = ctx.notes.map((sn,i)=>{ const col=(i===localIdx)?"#22c55e":"#e8eef7"; sn.setStyle({fillStyle:col,strokeStyle:col}); return sn; });
  const voice = new VF.Voice({num_beats:arr.length, beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(arr);
  new VF.Formatter().joinVoices([voice]).format([voice], w-36);
  voice.draw(vg, ctx.stave);

  if(Number.isFinite(scoreForIdx) && scoreForIdx>=90 && localIdx>=0 && localIdx<arr.length){
    const sn = arr[localIdx];
    const bb = sn.getBoundingBox?.();
    if(bb){
      const svg = staffDiv.querySelector("svg");
      const t = document.createElementNS("http://www.w3.org/2000/svg","text");
      t.setAttribute("x", bb.getX()+bb.getW()+4);
      t.setAttribute("y", bb.getY()+12);
      t.setAttribute("fill","#fff");
      t.setAttribute("font-size","14");
      t.setAttribute("font-weight","900");
      t.textContent = scoreForIdx>=95? "◎":"◯";
      svg.appendChild(t);
    }
  }
}
