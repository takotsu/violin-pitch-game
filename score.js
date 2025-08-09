import { KEY_SIG, applyKeySig } from "./scales.js";

const staffDiv=document.getElementById('staff');
const NS="http://www.w3.org/2000/svg";
const mkSvg=(w,h)=>{const s=document.createElementNS(NS,"svg");s.setAttribute("viewBox",`0 0 ${w} ${h}`);s.setAttribute("width","100%");s.setAttribute("height","100%");s.setAttribute("preserveAspectRatio","xMidYMin meet");return s;};
const line=(svg,x1,y1,x2,y2,st="#e8eef7",w=1)=>{const l=document.createElementNS(NS,"line");Object.entries({x1,y1,x2,y2,stroke:st}).forEach(([k,v])=>l.setAttribute(k,v));l.setAttribute("stroke-width",w);svg.appendChild(l);return l;};
const text=(svg,x,y,tx,size=12,weight="700",anchor="middle",fill="#a7c7dd")=>{const t=document.createElementNS(NS,"text");Object.entries({x,y,fill,"font-size":size,"font-weight":weight,"text-anchor":anchor,"font-family":'system-ui,"Noto Music","Bravura","Petaluma",sans-serif'}).forEach(([k,v])=>t.setAttribute(k,v));t.textContent=tx;svg.appendChild(t);return t;};
const head=(svg,x,y,fill="#e8eef7")=>{const e=document.createElementNS(NS,"ellipse");e.setAttribute("cx",x);e.setAttribute("cy",y);e.setAttribute("rx",3.5);e.setAttribute("ry",2.4);e.setAttribute("fill",fill);e.setAttribute("transform",`rotate(-20,${x},${y})`);svg.appendChild(e);return e;};
const stem=(svg,x,y,len=10,st="#e8eef7")=>{const l=line(svg,x+4.7,y-2,x+4.7,y-len,st,1.0);l.setAttribute("opacity","0.9");return l;};

const STEPS=["C","D","E","F","G","A","B"];
const idx=(L)=>STEPS.indexOf(L);
function yFor(letter,oct,top,space){ const bottom=top+space*4; const steps=(oct-4)*7 + (idx(letter)-idx("E")); return bottom - (steps*space/2); }
function drawLedger(svg,xi,yi,top,bottom,space,color="#a7c7dd"){
  const short=11, w=1, alpha=0.6;
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

let CTX=null; // 描画状態

export function renderScale(key, objs){
  staffDiv.innerHTML="";
  const w=staffDiv.clientWidth||820;
  const baseH=320;
  const svg=mkSvg(w,baseH); staffDiv.appendChild(svg);
  const space=7.0; // 線間 少し詰める
  const systems=[{top:10,left:6,right:w-6,notes:objs.slice(0,24)},
                 {top:170,left:6,right:w-6,notes:objs.slice(24,48)}];
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
      const yi=yFor(n.letter,n.octave,top,space);
      if(yi<top||yi>bottom) drawLedger(allGroup,xi,yi,top,bottom,space);
      const isFirst=(si===0&&i===0);
      const h=head(allGroup,xi,yi,isFirst?"#22c55e":"#e8eef7");
      const st=stem(allGroup,xi,yi,10,isFirst?"#22c55e":"#e8eef7");
      nodes[si*24+i]={head:h,stem:st,x:xi,y:yi,top,bottom,space};
      if((i+1)%8===0 && i<sys.notes.length-1){ const bx=innerLeft+stepX*(i+1); line(allGroup,bx,top,bx,bottom,"#7aa2c1",1); }
    });
  });

  // 高音域の切れを“絶対発生させない”ため、内容全体で自動スケール
  const bb=allGroup.getBBox(); const fit=Math.min(1,(baseH-14)/bb.height);
  if(fit<1){ const tx=-bb.x+6, ty=-bb.y+6; allGroup.setAttribute("transform",`translate(${tx},${ty}) scale(${fit})`); }

  CTX={svg,nodes,key,notes:objs,height:baseH};
  highlightIndex(0);
  return CTX;
}

export function highlightIndex(idx,scoreForIdx){
  if(!CTX) return;
  // 既存バッジ除去
  CTX.svg.querySelectorAll("text.badge").forEach(e=>e.remove());
  CTX.nodes.forEach((n,i)=>{const col=(i===idx)?"#22c55e":"#e8eef7"; n.head.setAttribute("fill",col); n.stem.setAttribute("stroke",col);});
  if(Number.isFinite(scoreForIdx) && scoreForIdx>=90){
    const n=CTX.nodes[idx]; if(n){ const svg=CTX.svg; const y=Math.max(n.top+12,Math.min(n.bottom-6,n.y-10));
      const t=text(svg,n.x+9,y,scoreForIdx>=95?"◎":"◯",14,"900","start","#fff"); t.setAttribute("class","badge"); }
  }
}

export function currentCtx(){ return CTX; }
