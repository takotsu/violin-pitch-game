// score.js v29 — VexFlowが無ければSVGで自前描画。加線/調号/2段表示/縮尺自動。
import { KEY_SIG } from "./scales.js";
const staffDiv=document.getElementById('staff');
const NS="http://www.w3.org/2000/svg";
const mkSvg=(w,h)=>{const s=document.createElementNS(NS,"svg");s.setAttribute("viewBox",`0 0 ${w} ${h}`);s.setAttribute("width","100%");s.setAttribute("height","100%");s.setAttribute("preserveAspectRatio","xMidYMin meet");return s;};
const line=(svg,x1,y1,x2,y2,st="#e8eef7",w=1)=>{const l=document.createElementNS(NS,"line");Object.entries({x1,y1,x2,y2,stroke:st}).forEach(([k,v])=>l.setAttribute(k,v));l.setAttribute("stroke-width",w);svg.appendChild(l);return l;};
const text=(svg,x,y,tx,size=12,weight="700",anchor="middle",fill="#a7c7dd")=>{const t=document.createElementNS(NS,"text");Object.entries({x,y,fill,"font-size":size,"font-weight":weight,"text-anchor":anchor,"font-family":'system-ui,"Noto Music","Bravura","Petaluma",sans-serif'}).forEach(([k,v])=>t.setAttribute(k,v));t.textContent=tx;svg.appendChild(t);return t;};
const head=(svg,x,y,fill="#e8eef7")=>{const e=document.createElementNS(NS,"ellipse");e.setAttribute("cx",x);e.setAttribute("cy",y);e.setAttribute("rx",3.4);e.setAttribute("ry",2.3);e.setAttribute("fill",fill);e.setAttribute("opacity","0.95");e.setAttribute("transform",`rotate(-20,${x},${y})`);svg.appendChild(e);return e;};
const stem=(svg,x,y,len=9,st="#e8eef7")=>{const l=line(svg,x+4.6,y-2,x+4.6,y-len,st,1.0);l.setAttribute("opacity","0.9");return l;};

let FB=null, VFCache=null;
const STEPS=["C","D","E","F","G","A","B"];
const idx=(L)=>STEPS.indexOf(L);

function yFor(letter,oct,top,space){
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
  let x=left, step=4.8, size=10; // コンパクト化
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
  const baseH=300; // 少し低めに設定しつつ自動縮尺

  if(VF){
    const renderer=new VF.Renderer(staffDiv,VF.Renderer.Backends.SVG);
    renderer.resize(w,baseH);
    const ctx=renderer.getContext();

    const s1=new VF.Stave(6,6,w-12);
    s1.addKeySignature(key).setContext(ctx).draw();
    const s2=new VF.Stave(6,158,w-12);
    s2.addKeySignature(key).setContext(ctx).draw();

    const mk=(arr)=>arr.map(k=>new VF.StaveNote({keys:[k],duration:"8"}));
    const n1=mk(vexKeys.slice(0,24)), n2=mk(vexKeys.slice(24,48));
    const v1=new VF.Voice({num_beats:24,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(n1);
    const v2=new VF.Voice({num_beats:24,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(n2);
    new VF.Formatter().joinVoices([v1]).format([v1],w-36);
    new VF.Formatter().joinVoices([v2]).format([v2],w-36);
    v1.draw(ctx,s1); v2.draw(ctx,s2);

    // 見切れ対策：BBox を見て自動スケール
    const svg=staffDiv.querySelector("svg");
    const bbox=svg.getBBox();
    if(bbox.height+14>baseH){
      const scale=(baseH-14)/bbox.height;
      const g=document.createElementNS(NS,"g");
      while(svg.firstChild) g.appendChild(svg.firstChild);
      g.setAttribute("transform",`scale(${scale}) translate(${6/scale},${6/scale})`);
      svg.appendChild(g);
    }
    VFCache={renderer,ctx,stave1:s1,stave2:s2,notes:[...n1,...n2],height:baseH};
    highlightIndex(VFCache,0);
    return VFCache;
  }

  // —— フォールバック（自前SVG）——
  const svg=mkSvg(w,baseH); staffDiv.appendChild(svg);
  const space=7.2; // 線間を少し詰める
  const systems=[{top:10,left:6,right:w-6,notes:objs.slice(0,24)},
                 {top:160,left:6,right:w-6,notes:objs.slice(24,48)}];
  const allGroup=document.createElementNS(NS,"g"); svg.appendChild(allGroup);
  const nodes=[];

  systems.forEach((sys,si)=>{
    const {top,left,right}=sys; const bottom=top+space*4;
    for(let i=0;i<5;i++) line(allGroup,left,top+space*i,right,top+space*i,"#e8eef7",1);
    const ksW=drawKeySig(allGroup,key,left+6,top,space);
    const innerLeft=left+6+ksW+3, innerRight=right-6;
    const stepX=(innerRight-innerLeft)/Math.max(1,sys.notes.length);
    sys.notes.forEach((n,i)=>{
      const xi=innerLeft+stepX*(i+0.5);
      const yi=(()=>{ const bottomLine=top+space*4; const steps=(n.octave-4)*7 + (idx(n.letter)-idx("E")); return bottomLine - (steps*space/2); })();
      if(yi<top||yi>bottom) drawLedger(allGroup,xi,yi,top,bottom,space);
      const h=head(allGroup,xi,yi,(si===0&&i===0)?"#22c55e":"#e8eef7");
      const st=stem(allGroup,xi,yi,9,(si===0&&i===0)?"#22c55e":"#e8eef7");
      nodes[si*24+i]={head:h,stem:st,x:xi,y:yi,top,bottom,space};
      if((i+1)%8===0 && i<sys.notes.length-1){ const bx=innerLeft+stepX*(i+1); line(allGroup,bx,top,bx,bottom,"#7aa2c1",1); }
    });
  });

  const bb=allGroup.getBBox(); const fit=Math.min(1,(baseH-12)/bb.height);
  if(fit<1){ const tx=-bb.x+6, ty=-bb.y+6; allGroup.setAttribute("transform",`translate(${tx},${ty}) scale(${fit})`); }

  FB={svg,nodes,key,notes:objs};
  VFCache=null; highlightIndex(FB,0);
  return FB;
}

export function highlightIndex(ctx,idx,scoreForIdx){
  const VF=window.Vex?.Flow;
  document.querySelectorAll("#staff svg text.badge").forEach(e=>e.remove());
  if(VF && (VFCache||ctx)?.notes?.length){
    const c=VFCache||ctx; const w=staffDiv.clientWidth||820; c.renderer.resize(w,c.height||300);
    const g=c.renderer.getContext(); g.clear(); c.stave1.setContext(g).draw(); c.stave2.setContext(g).draw();
    const arr=c.notes.map((sn,i)=>{const col=(i===idx)?"#22c55e":"#e8eef7"; sn.setStyle({fillStyle:col,strokeStyle:col}); return sn;});
    const v1=new Vex.Flow.Voice({num_beats:24,beat_value:4}).setMode(Vex.Flow.Voice.Mode.SOFT).addTickables(arr.slice(0,24));
    const v2=new Vex.Flow.Voice({num_beats:24,beat_value:4}).setMode(Vex.Flow.Voice.Mode.SOFT).addTickables(arr.slice(24,48));
    new Vex.Flow.Formatter().joinVoices([v1]).format([v1],w-36); new Vex.Flow.Formatter().joinVoices([v2]).format([v2],w-36);
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
