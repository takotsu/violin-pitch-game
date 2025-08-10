// score.js v0-3 — VexFlow専用。常に1段のみ表示。24音ごとにページング。
// ポジションガイドを切替点に注記（annotation）表示。
export function renderPage({key, vexKeys, page=0, perPage=24, posLabels=[]}){
  const VF = window.Vex?.Flow;
  if(!VF) throw new Error("VexFlowが読み込まれていません。");
  const staffDiv = document.getElementById('staff');
  staffDiv.innerHTML="";
  const w = staffDiv.clientWidth || 820;
  const h = 160;

  const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
  renderer.resize(w,h);
  const ctx = renderer.getContext();

  // 1段・ト音・調号
  const stave = new VF.Stave(8, 8, w-16);
  stave.addClef("treble").addKeySignature(key).setContext(ctx).draw();

  const from = page*perPage;
  const to   = Math.min(vexKeys.length, from+perPage);
  const keysSlice = vexKeys.slice(from, to);
  const labelsSlice = posLabels.slice(from, to);

  const notes = keysSlice.map((k, i) => {
    const n = new VF.StaveNote({keys:[k], duration:"8"});
    n.setStemDirection(1);
    // ポジション注記：切替点だけに表示
    const lab = labelsSlice[i];
    const prev = (i>0)? labelsSlice[i-1] : (from>0? posLabels[from-1] : null);
    if(lab && lab !== prev){
      n.addModifier(new VF.Annotation(lab).setVerticalJustification(VF.Annotation.VerticalJustify.TOP));
    }
    return n;
  });

  const voice = new VF.Voice({num_beats:notes.length, beat_value:4})
                    .setMode(VF.Voice.Mode.SOFT)
                    .addTickables(notes);
  new VF.Formatter().joinVoices([voice]).format([voice], w-36);
  voice.draw(ctx, stave);

  return {renderer, ctx, stave, notes, page, perPage, key, posLabels};
}

export function recolorPage(ctx, localIdx, scoreForIdx){
  const VF = window.Vex?.Flow;
  const staffDiv = document.getElementById('staff');
  const w = staffDiv.clientWidth || 820;
  ctx.renderer.resize(w,160);
  const vg = ctx.renderer.getContext(); vg.clear(); ctx.stave.setContext(vg).draw();

  const arr = ctx.notes.map((sn,i)=>{ const col=(i===localIdx)?"#22c55e":"#e8eef7"; sn.setStyle({fillStyle:col,strokeStyle:col}); return sn; });
  const voice = new VF.Voice({num_beats:arr.length, beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(arr);
  new VF.Formatter().joinVoices([voice]).format([voice], w-36);
  voice.draw(vg, ctx.stave);

  // 合格バッジ
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
