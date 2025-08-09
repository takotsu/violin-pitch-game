import { KEY_SIG } from "./scales.js";
const staffDiv=document.getElementById('staff');

const NS="http://www.w3.org/2000/svg";
const mkSvg=(w,h)=>{const s=document.createElementNS(NS,"svg");s.setAttribute("viewBox",`0 0 ${w} ${h}`);s.setAttribute("width","100%");s.setAttribute("height","100%");return s;};
const line=(svg,x1,y1,x2,y2,st="#e8eef7",w=1)=>{const l=document.createElementNS(NS,"line");Object.entries({x1,y1,x2,y2,stroke:st}).forEach(([k,v])=>l.setAttribute(k,v));l.setAttribute("stroke-width",w);svg.appendChild(l);return l;};
const text=(svg,x,y,tx,size=12,weight="700",anchor="middle",fill="#a7c7dd")=>{const t=document.createElementNS(NS,"text");Object.entries({x,y,fill,"font-size":size,"font-weight":weight,"text-anchor":anchor,"font-family":'system-ui,"Noto Music","Bravura","Petaluma",sans-serif'}).forEach(([k,v])=>t.setAttribute(k,v));t.textContent=tx;svg.appendChild(t);return t;};
const head=(svg,x,y,fill="#e8eef7")=>{const e=document.createElementNS(NS,"ellipse");e.setAttribute("cx",x);e.setAttribute("cy",y);e.setAttribute("rx",4.3);e.setAttribute("ry",3.0);e.setAttribute("fill",fill);e.setAttribute("transform",`rotate(-20,${x},${y})`);svg.appendChild(e);return e;};
const stem=(svg,x,y,len=11,st="#e8eef7")=>line(svg,x+5.6,y-2,x+5.6,y-len,st,1.2);

let FB=null, VFCache=null;

function yFor(letter,oct,top,space){
  const seq=["C","D","E","F","G","A","B"]; const idx=(L)=>seq.indexOf(L);
  const bottom=top+space*4;
  const steps=(oct-4)*7 + (idx(letter)-idx("E"));
  return bottom - (steps*space/2);
}
function drawLedger(svg,xi,yi,top,bottom,space,color="#a7c7dd"){
  const short=15, w=1.1;
  for(let y=top-space; y>=yi-1; y-=space) line(svg, xi-short/2, y, xi+short/2, y, color,w);
  for(let y=bottom+space; y<=yi+1; y+=space) line(svg, xi-short/2, y, xi+short/2, y, color,w);
}

/** ★詰めた調号描画（サイズ小・字送り狭く） */
function drawKeySig(svg,key,left,top,space){
  const sig=KEY_SIG[key]||KEY_SIG.C;
  const SH=[{L:"F",o:5},{L:"C",o:5},{L:"G",o:5},{L:"D",o:5},{L:"A",o:4},{L:"E",o:5},{L:"B",o:4}];
  const FL=[{L:"B",o:4},{L:"E",o:5},{L:"A",o:4},{L:"D",o:5},{L:"G",o:4},{L:"C",o:5},{L:"F",o:4}];
  let x=left, step=6;        // ← 旧 7.5 → **圧縮**
  const size=11;             // ← 旧 13  → **小型化**
  const drawSharp=(L,o)=>{text(svg,x,yFor(L,o,top,space)+3,"♯",size,"800","left","#e8eef7");x+=step;};
  const drawFlat =(L,o)=>{text(svg,x,yFor(L,o,top,space)+3,"♭",size,"800","left","#e8eef7");x+=step;};
  sig.sharps.forEach((_,i)=>{const p=SH[i]; drawSharp(p.L,p.o);});
  sig.flats.forEach((_,i)=>{const p=FL[i]; drawFlat(p.L,p.o);});
  return x-left;
}

/** 五線譜2段を描画。必要に応じてSVG高さを増やし、見切れなし */
function renderFallbackTwoSystems(key, notes, hi=0){
  staffDiv.innerHTML="";
  const w=staffDiv.clientWidth||820;
  let baseH=360, space=9.0;  // わずかにコンパクト化
  const provisional=mkSvg(w,baseH); staffDiv.appendChild(provisional);
  const systems=[{top:14,left:8,right:w-8,notes:notes.slice(0,24)},
                 {top:188,left:8,right:w-8,notes:notes.slice(24,48)}];

  let extraTop=0, extraBottom=0;
  systems.forEach(sys=>{
    const {top,left,right}=sys; const bottom=top+space*4;
    const ksW=drawKeySig(provisional,key,left+8,top,space);
    const innerLeft=left+8+ksW+4, innerRight=right-6;
    const stepX=(innerRight-innerLeft)/Math.max(1,sys.notes.length);
    sys.notes.forEach(n=>{
      const yi=yFor(n.letter,n.octave,top,space);
      extraTop=Math.max(extraTop, Math.max(0, (top - (yi - 2.6*space))));
      extraBottom=Math.max(extraBottom, Math.max(0, ((yi + 2.6*space) - (bottom))));
    });
  });

  const h = baseH + extraTop + extraBottom;
  provisional.setAttribute("viewBox",`0 0 ${w} ${h}`);
  provisional.innerHTML="";

  const svg=provisional;
  const nodes=[];
  systems.forEach((sys,sIdx)=>{
    const top=sys.top+extraTop; const left=sys.left; const right=sys.right; const bottom=top+space*4;
    for(let i=0;i<5;i++) line(svg,left,top+space*i,right,top+space*i,"#e8eef7",1);
    const ksW=drawKeySig(svg,key,left+8,top,space);
    const innerLeft=left+8+ksW+4, innerRight=right-6;
    const stepX=(innerRight-innerLeft)/Math.max(1,sys.notes.length);
    sys.notes.forEach((n,i)=>{
      const xi=innerLeft+stepX*(i+0.5), yi=yFor(n.letter,n.octave,top,space);
      const gi=sIdx*24+i, col=(gi===hi)?"#22c55e":"#e8eef7";
      if(yi<top||yi>bottom) drawLedger(svg,xi,yi,top,bottom,space,col);
      const h=head(svg,xi,yi,col);
      const st = stem(svg,xi,yi,11,col);
      if(gi===hi){ h.classList.add("note-glow"); }
      nodes[gi]={head:h, stem:st, x:xi, y:yi, top, bottom, space};
      if((i+1)%8===0 && i<sys.notes.length-1){ const bx=innerLeft+stepX*(i+1); line(svg,bx,top,bx,bottom,"#7aa2c1",1); }
    });
  });

  FB={svg,nodes,key,notes};
  VFCache=null;
  const wrap=document.getElementById("staff-wrap");
  wrap.style.minHeight = Math.ceil(h)+"px";
  const fx=document.getElementById("fx"); fx.width = wrap.clientWidth; fx.height = wrap.clientHeight;
  return {renderer:null,notes:[],nodes};
}

export function renderScale(key,vexKeys,objs){
  const VF=window.Vex?.Flow;
  if(VF){
    staffDiv.innerHTML="";
    const w=staffDiv.clientWidth||820;
    let h=360;
    const renderer=new VF.Renderer(staffDiv,VF.Renderer.Backends.SVG);
    renderer.resize(w,h);
    const ctx=renderer.getContext();
    const s1=new VF.Stave(6,6,w-12); s1.addKeySignature(key).setContext(ctx).draw();
    const s2=new VF.Stave(6,184,w-12); s2.addKeySignature(key).setContext(ctx).draw();

    const keys1=vexKeys.slice(0,24), keys2=vexKeys.slice(24,48);
    const make=(ks)=>ks.map(k=>new VF.StaveNote({keys:[k],duration:"8",clef:"treble"}));
    const n1=make(keys1), n2=make(keys2);
    const v1=new VF.Voice({num_beats:24,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(n1);
    const v2=new VF.Voice({num_beats:24,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(n2);
    new VF.Formatter().joinVoices([v1]).format([v1],w-36);
    new VF.Formatter().joinVoices([v2]).format([v2],w-36);
    v1.draw(ctx,s1); v2.draw(ctx,s2);

    const svg=staffDiv.querySelector("svg");
    const bbs=[...svg.querySelectorAll(".vf-stavenote")].map(n=>n.getBBox());
    const minY=Math.min(...bbs.map(b=>b.y-22)), maxY=Math.max(...bbs.map(b=>b.y+b.height+22));
    const needH = Math.ceil(maxY - Math.min(0,minY) + 10);
    if(needH > h){ h=needH; renderer.resize(w,h); ctx.clear(); s1.setY(6); s2.setY(184+(needH-360)/2|0); s1.draw(); s2.draw(); v1.draw(ctx,s1); v2.draw(ctx,s2); }
    const wrap=document.getElementById("staff-wrap");
    wrap.style.minHeight = Math.ceil(h)+"px";
    const fx=document.getElementById("fx"); fx.width = wrap.clientWidth; fx.height = wrap.clientHeight;

    VFCache={renderer,ctx,stave1:s1,stave2:s2,notes:[...n1,...n2],height:h};
    highlightIndex(VFCache,0);
    return VFCache;
  }
  const objs2 = objs || vexKeys.map(vk=>{const m=vk.match(/^([A-G][b#]?)[/](\d)$/); return {letter:m?m[1].replace("b","B").replace("#","#").replace(/[b#]$/,""):vk[0], octave:m?+m[2]:4};});
  const rc=renderFallbackTwoSystems(key,objs2,0);
  highlightIndex(rc,0); return rc;
}

export function highlightIndex(ctx,idx,scoreForIdx){
  const VF=window.Vex?.Flow;
  document.querySelectorAll("#staff svg text.badge").forEach(e=>e.remove());
  if(VF && (VFCache||ctx)?.notes?.length){
    const cache=VFCache||ctx;
    const {renderer,stave1,stave2,height}=cache;
    const w=staffDiv.clientWidth||820; renderer.resize(w,height||360);
    const g=renderer.getContext(); g.clear(); stave1.setContext(g).draw(); stave2.setContext(g).draw();
    const notes=cache.notes.map((sn,i)=>{const c=(i===idx)?"#22c55e":"#e8eef7"; sn.setStyle({fillStyle:c,strokeStyle:c}); return sn;});
    const v1=new Vex.Flow.Voice({num_beats:24,beat_value:4}).setMode(Vex.Flow.Voice.Mode.SOFT).addTickables(notes.slice(0,24));
    const v2=new Vex.Flow.Voice({num_beats:24,beat_value:4}).setMode(Vex.Flow.Voice.Mode.SOFT).addTickables(notes.slice(24,48));
    new Vex.Flow.Formatter().joinVoices([v1]).format([v1],w-36);
    new Vex.Flow.Formatter().joinVoices([v2]).format([v2],w-36);
    v1.draw(g,stave1); v2.draw(g,stave2);
    if(Number.isFinite(scoreForIdx) && scoreForIdx>=90){
      const sn=notes[idx]; const bb=sn.getBoundingBox?.(); if(bb){
        const x=bb.getX()+bb.getW()+4, y=bb.getY()+12;
        const t=document.createElementNS(NS,"text"); t.setAttribute("x",x); t.setAttribute("y",y); t.setAttribute("class","badge");
        t.textContent = scoreForIdx>=95?"◎":"◯"; g.svg.appendChild(t);
      }
    }
    VFCache={...cache,notes}; return;
  }
  if(FB?.nodes){
    FB.nodes.forEach((n,i)=>{
      const c=(i===idx)?"#22c55e":"#e8eef7";
      if(n?.head){ n.head.setAttribute("fill",c); if(i===idx) n.head.classList.add("note-glow"); else n.head.classList.remove("note-glow"); }
      if(n?.stem?.setAttribute) n.stem.setAttribute("stroke",c);
    });
    if(Number.isFinite(scoreForIdx) && scoreForIdx>=90){
      const n=FB.nodes[idx];
      if(n){
        const svg=FB.svg;
        const t=text(svg, n.x+10, Math.max(n.top+12, Math.min(n.bottom-6, n.y-10)), scoreForIdx>=95?"◎":"◯", 14,"900","start","#fff");
        t.setAttribute("class","badge");
      }
    }
  }
}
