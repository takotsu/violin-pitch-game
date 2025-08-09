import { makeMajorScale3Oct, toVexKeys, KEY_SIG } from "./scales.js";

const staffDiv=document.getElementById('staff');
const NS="http://www.w3.org/2000/svg";

const mkSvg=(w,h)=>{const s=document.createElementNS(NS,"svg");s.setAttribute("viewBox",`0 0 ${w} ${h}`);s.setAttribute("width","100%");s.setAttribute("height","100%");s.setAttribute("preserveAspectRatio","xMidYMin meet");return s;};
const line=(svg,x1,y1,x2,y2,st="#e8eef7",w=1)=>{const l=document.createElementNS(NS,"line");Object.entries({x1,y1,x2,y2,stroke:st}).forEach(([k,v])=>l.setAttribute(k,v));l.setAttribute("stroke-width",w);svg.appendChild(l);return l;};
const text=(svg,x,y,tx,size=12,weight="700",anchor="middle",fill="#a7c7dd")=>{const t=document.createElementNS(NS,"text");Object.entries({x,y,fill,"font-size":size,"font-weight":weight,"text-anchor":anchor,"font-family":'system-ui,"Noto Music","Bravura","Petaluma",sans-serif'}).forEach(([k,v])=>t.setAttribute(k,v));t.textContent=tx;svg.appendChild(t);return t;};
const head=(svg,x,y,fill="#e8eef7")=>{const e=document.createElementNS(NS,"ellipse");e.setAttribute("cx",x);e.setAttribute("cy",y);e.setAttribute("rx",3.7);e.setAttribute("ry",2.6);e.setAttribute("fill",fill);e.setAttribute("opacity","0.95");e.setAttribute("transform",`rotate(-20,${x},${y})`);svg.appendChild(e);return e;};
const stem=(svg,x,y,len=10,st="#e8eef7")=>{const l=line(svg,x+4.9,y-2,x+4.9,y-len,st,1.0);l.setAttribute("opacity","0.9");return l;};

let FB=null, VFCache=null;

function yFor(letter,oct,top,space){
  const order=["C","D","E","F","G","A","B"], idx=L=>order.indexOf(L);
  const bottom=top+space*4;
  const steps=(oct-4)*7 + (idx(letter)-idx("E"));
  return bottom - (steps*space/2);
}
function drawLedger(svg,xi,yi,top,bottom,space,color="#a7c7dd"){
  const short=11, w=0.9, alpha=0.6;
  for(let y=top-space; y>=yi-1; y-=space){ const l=line(svg, xi-short/2, y, xi+short/2, y, color,w); l.setAttribute("opacity",alpha); }
  for(let y=bottom+space; y<=yi+1; y+=space){ const l=line(svg, xi-short/2, y, xi+short/2, y, color,w); l.setAttribute("opacity",alpha); }
}
function drawKeySig(svg,key,left,top,space){
  const sig=KEY_SIG[key]||KEY_SIG.C;
  const SH=[{L:"F",o:5},{L:"C",o:5},{L:"G",o:5},{L:"D",o:5},{L:"A",o:4},{L:"E",o:5},{L:"B",o:4}];
  const FL=[{L:"B",o:4},{L:"E",o:5},{L:"A",o:4},{L:"D",o:5},{L:"G",o:4},{L:"C",o:5},{L:"F",o:4}];
  let x=left, step=5.2, size=10;
  const drawSharp=(L,o)=>{text(svg,x,yFor(L,o,top,space)+3,"♯",size,"800","left","#e8eef7");x+=step;};
  const drawFlat =(L,o)=>{text(svg,x,yFor(L,o,top,space)+3,"♭",size,"800","left","#e8eef7");x+=step;};
  sig.sharps.forEach((_,i)=>{const p=SH[i]; drawSharp(p.L,p.o);});
  sig.flats.forEach((_,i)=>{const p=FL[i]; drawFlat(p.L,p.o);});
  return x-left;
}

export function renderScale(key,vexKeys,objs){
  const VF=window.Vex?.Flow;
  staffDiv.innerHTML="";
  const w=staffDiv.clientWidth||820;
  const H=320;

  if(VF){
    const r=new VF.Renderer(staffDiv,VF.Renderer.Backends.SVG);
    r.resize(w,H);
    const ctx=r.getContext();

    const st1=new VF.Stave(6,6,w-12); st1.addKeySignature(key).setContext(ctx).draw();
    const st2=new VF.Stave(6,166,w-12); st2.addKeySignature(key).setContext(ctx).draw();

    const mk=arr=>arr.map(k=>new VF.StaveNote({keys:[k],duration:"8"}));
    const n1=mk(vexKeys.slice(0,24)), n2=mk(vexKeys.slice(24));
    const v1=new VF.Voice({num_beats:24,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(n1);
    const v2=new VF.Voice({num_beats:24,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(n2);
    new VF.Formatter().joinVoices([v1]).format([v1],w-36);
    new VF.Formatter().joinVoices([v2]).format([v2],w-36);
    v1.draw(ctx,st1); v2.draw(ctx,st2);

    VFCache={renderer:r,ctx,stave1:st1,stave2:st2,notes:[...n1,...n2],height:H};
    highlightIndex(VFCache,0);
    return VFCache;
  }

  // フォールバック
  const svg=mkSvg(w,H); staffDiv.appendChild(svg);
  const space=7.4;
  const systems=[{top:10,left:6,right:w-6,notes:objs.slice(0,24)},
                 {top:170,left:6,right:w-6,notes:objs.slice(24)}];
  const g=document.createElementNS(NS,"g"); svg.appendChild(g);
  const nodes=[];
  systems.forEach((sys,si)=>{
    const {top,left,right}=sys; const bottom=top+space*4;
    for(let i=0;i<5;i++) line(g,left,top+space*i,right,top+space*i,"#e8eef7",1);
    const ks=drawKeySig(g,key,left+6,top,space);
    const L=left+6+ks+3, R=right-6, stepX=(R-L)/Math.max(1,sys.notes.length);
    sys.notes.forEach((n,i)=>{
      const x=L+stepX*(i+0.5);
      const order=["C","D","E","F","G","A","B"], idx=L=>order.indexOf(L);
      const y= (top+space*4) - (((n.octave-4)*7 + (idx(n.letter)-idx("E")))*space/2);
      if(y<top||y>bottom) drawLedger(g,x,y,top,bottom,space);
      const h=head(g,x,y,(si===0&&i===0)?"#22c55e":"#e8eef7");
      const st=stem(g,x,y,10,(si===0&&i===0)?"#22c55e":"#e8eef7");
      nodes[si*24+i]={head:h,stem:st,x,y,top,bottom,space};
      if((i+1)%8===0 && i<sys.notes.length-1){ const bx=L+stepX*(i+1); line(g,bx,top,bx,bottom,"#7aa2c1",1); }
    });
  });
  FB={svg:g.ownerSVGElement,nodes,key,notes:objs};
  VFCache=null; highlightIndex(FB,0);
  return FB;
}

export function highlightIndex(ctx,idx,scoreForIdx){
  const VF=window.Vex?.Flow;
  document.querySelectorAll("#staff svg text.badge").forEach(e=>e.remove());
  if(VF && (VFCache||ctx)?.notes?.length){
    const c=VFCache||ctx; const w=staffDiv.clientWidth||820; c.renderer.resize(w,c.height||320);
    const g=c.renderer.getContext(); g.clear(); c.stave1.setContext(g).draw(); c.stave2.setContext(g).draw();
    const arr=c.notes.map((sn,i)=>{const col=(i===idx)?"#22c55e":"#e8eef7"; sn.setStyle({fillStyle:col,strokeStyle:col}); return sn;});
    const v1=new Vex.Flow.Voice({num_beats:24,beat_value:4}).setMode(Vex.Flow.Voice.Mode.SOFT).addTickables(arr.slice(0,24));
    const v2=new Vex.Flow.Voice({num_beats:24,beat_value:4}).setMode(Vex.Flow.Voice.Mode.SOFT).addTickables(arr.slice(24));
    new Vex.Flow.Formatter().joinVoices([v1]).format([v1],w-36);
    new Vex.Flow.Formatter().joinVoices([v2]).format([v2],w-36);
    v1.draw(g,c.stave1); v2.draw(g,c.stave2);
    if(Number.isFinite(scoreForIdx) && scoreForIdx>=90){
      const sn=arr[idx]; const bb=sn.getBoundingBox?.(); if(bb){ const x=bb.getX()+bb.getW()+4, y=bb.getY()+12;
        const t=document.createElementNS(NS,"text"); t.setAttribute("x",x); t.setAttribute("y",y); t.setAttribute("class","badge");
        t.textContent = scoreForIdx>=95?"◎":"◯"; g.svg.appendChild(t); }
    }
    VFCache={...c,notes:arr}; return;
  }
  if(FB?.nodes){
    FB.nodes.forEach((n,i)=>{ const col=(i===idx)?"#22c55e":"#e8eef7"; if(n?.head) n.head.setAttribute("fill",col); if(n?.stem?.setAttribute) n.stem.setAttribute("stroke",col); });
    if(Number.isFinite(scoreForIdx) && scoreForIdx>=90){
      const n=FB.nodes[idx]; if(n){ const svg=FB.svg; const y=Math.max(n.top+12,Math.min(n.bottom-6,n.y-10));
        const t=text(svg,n.x+9,y,scoreForIdx>=95?"◎":"◯",14,"900","start","#fff"); t.setAttribute("class","badge"); }
    }
  }
}
