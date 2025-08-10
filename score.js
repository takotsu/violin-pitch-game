// score.js v0-3c — 1段表示・24音ページング。VexFlowが無くても必ず描画する。

const staffDiv = document.getElementById('staff');
const NS="http://www.w3.org/2000/svg";

// ---------- フォールバック（自前SVG） ----------
function mkSvg(w,h){const s=document.createElementNS(NS,"svg");s.setAttribute("viewBox",`0 0 ${w} ${h}`);s.setAttribute("width","100%");s.setAttribute("height","100%");s.setAttribute("preserveAspectRatio","xMidYMin meet");return s;}
function line(svg,x1,y1,x2,y2,st="#e8eef7",w=1){const l=document.createElementNS(NS,"line");Object.entries({x1,y1,x2,y2,stroke:st}).forEach(([k,v])=>l.setAttribute(k,v));l.setAttribute("stroke-width",w);svg.appendChild(l);return l;}
function text(svg,x,y,tx,size=12,weight="700",anchor="start",fill="#e8eef7"){const t=document.createElementNS(NS,"text");Object.entries({x,y,fill,"font-size":size,"font-weight":weight,"text-anchor":anchor,"font-family":'system-ui,"Noto Music","Bravura","Petaluma",sans-serif'}).forEach(([k,v])=>t.setAttribute(k,v));t.textContent=tx;svg.appendChild(t);return t;}
function head(svg,x,y,fill="#e8eef7"){const e=document.createElementNS(NS,"ellipse");e.setAttribute("cx",x);e.setAttribute("cy",y);e.setAttribute("rx",3.6);e.setAttribute("ry",2.4);e.setAttribute("fill",fill);e.setAttribute("opacity","0.95");e.setAttribute("transform",`rotate(-20,${x},${y})`);svg.appendChild(e);return e;}
function stem(svg,x,y,len=10,st="#e8eef7"){const l=line(svg,x+4.8,y-2,x+4.8,y-len,st,1.0);l.setAttribute("opacity","0.9");return l;}
const STEPS=["C","D","E","F","G","A","B"]; const idx=(L)=>STEPS.indexOf(L);
function yFor(letter,oct,top,space){ const bottom=top+space*4; const steps=(oct-4)*7 + (idx(letter)-idx("E")); return bottom - (steps*space/2); }

function drawFallback(key, objs, page=0, perPage=24){
  const w=staffDiv.clientWidth||820, h=160, space=7.2;
  staffDiv.innerHTML="";
  const svg=mkSvg(w,h); staffDiv.appendChild(svg);
  const top=8, left=8, right=w-8, bottom=top+space*4;

  for(let i=0;i<5;i++) line(svg,left,top+space*i,right,top+space*i,"#e8eef7",1);

  // 調号（簡略：♯/♭だけ配置）
  const SH=[{L:"F",o:5},{L:"C",o:5},{L:"G",o:5},{L:"D",o:5},{L:"A",o:4},{L:"E",o:5},{L:"B",o:4}];
  const FL=[{L:"B",o:4},{L:"E",o:5},{L:"A",o:4},{L:"D",o:5},{L:"G",o:4},{L:"C",o:5},{L:"F",o:4}];
  const KEY_SIG={"C":{sharps:[],flats:[]}, "G":{sharps:["F"],flats:[]}, "D":{sharps:["F","C"],flats:[]}, "A":{sharps:["F","C","G"],flats:[]}, "E":{sharps:["F","C","G","D"],flats:[]}, "B":{sharps:["F","C","G","D","A"],flats:[]}, "F#":{sharps:["F","C","G","D","A","E"],flats:[]}, "C#":{sharps:["F","C","G","D","A","E","B"],flats:[]}, "F":{flats:["B"],sharps:[]}, "Bb":{flats:["B","E"],sharps:[]}, "Eb":{flats:["B","E","A"],sharps:[]}, "Ab":{flats:["B","E","A","D"],sharps:[]}};
  let ksx=left+6, step=5.2;
  (KEY_SIG[key]?.sharps||[]).forEach((_,i)=>{const p=SH[i]; text(svg,ksx,yFor(p.L,p.o,top,space)+3,"♯",11,"900"); ksx+=step;});
  (KEY_SIG[key]?.flats ||[]).forEach((_,i)=>{const p=FL[i]; text(svg,ksx,yFor(p.L,p.o,top,space)+3,"♭",12,"900"); ksx+=step;});
  const innerLeft = ksx+4, innerRight=right-8;

  const from=page*perPage, to=Math.min(objs.length, from+perPage);
  const slice=objs.slice(from,to);
  const stepX=(innerRight-innerLeft)/Math.max(1,slice.length);

  const nodes=[];
  slice.forEach((n,i)=>{
    const x=innerLeft+stepX*(i+0.5);
    const y=yFor(n.letter,n.octave,top,space);
    head(svg,x,y,i===0?"#22c55e":"#e8eef7");
    stem(svg,x,y,10,i===0?"#22c55e":"#e8eef7");
    nodes[i]={x,y};
    // 加線
    if(y<top || y>bottom){
      const short=12, w1=0.9, alpha=0.6;
      for(let yy=top-space; yy>=y-1; yy-=space){ const l=line(svg,x-short/2,yy,x+short/2,yy,"#a7c7dd",w1); l.setAttribute("opacity",alpha); }
      for(let yy=bottom+space; yy<=y+1; yy+=space){ const l=line(svg,x-short/2,yy,x+short/2,yy,"#a7c7dd",w1); l.setAttribute("opacity",alpha); }
    }
  });

  return { mode:"fallback", svg, nodes, page, perPage, key, notes:slice };
}

// ---------- VexFlow ----------
function drawVex(key, vexKeys, page=0, perPage=24){
  const VF=window.Vex?.Flow; if(!VF) return null;
  staffDiv.innerHTML="";
  const w=staffDiv.clientWidth||820, h=160;
  const renderer=new VF.Renderer(staffDiv,VF.Renderer.Backends.SVG);
  renderer.resize(w,h);
  const ctx=renderer.getContext();
  const stave=new VF.Stave(8,8,w-16);
  stave.addClef("treble").addKeySignature(key).setContext(ctx).draw();

  const from=page*perPage, to=Math.min(vexKeys.length, from+perPage);
  const notes=vexKeys.slice(from,to).map(k=>new VF.StaveNote({keys:[k],duration:"8"}).setStemDirection(1));
  const voice=new VF.Voice({num_beats:notes.length,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(notes);
  new VF.Formatter().joinVoices([voice]).format([voice], w-36); voice.draw(ctx,stave);
  return { mode:"vex", renderer, ctx, stave, notes, page, perPage, key };
}

// API
export function renderPage({key, vexKeys, objs, page=0, perPage=24}){
  return (window.Vex?.Flow)
    ? drawVex(key, vexKeys, page, perPage)
    : drawFallback(key, objs, page, perPage);
}

export function recolorPage(ctx, localIdx, scoreForIdx){
  if(!ctx) return;
  const w=staffDiv.clientWidth||820;
  if(ctx.mode==="vex"){
    ctx.renderer.resize(w,160);
    const VF=window.Vex.Flow;
    const g=ctx.renderer.getContext(); g.clear(); ctx.stave.setContext(g).draw();
    const arr=ctx.notes.map((sn,i)=>{const col=(i===localIdx)?"#22c55e":"#e8eef7"; sn.setStyle({fillStyle:col,strokeStyle:col}); return sn;});
    const v=new VF.Voice({num_beats:arr.length,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(arr);
    new VF.Formatter().joinVoices([v]).format([v], w-36); v.draw(g,ctx.stave);
    return;
  }
  // fallback再描画（簡易：丸ごと描き直し）
  renderPage({key:ctx.key, vexKeys:[], objs:ctx.__allObjs || [], page:ctx.page, perPage:ctx.perPage});
}
