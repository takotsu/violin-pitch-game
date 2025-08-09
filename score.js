import { KEY_SIG } from "./scales.js";

const staffDiv=document.getElementById('staff');
const NS="http://www.w3.org/2000/svg";
const mkSvg=(w,h)=>{const s=document.createElementNS(NS,"svg");s.setAttribute("viewBox",`0 0 ${w} ${h}`);s.setAttribute("width","100%");s.setAttribute("height","100%");s.setAttribute("preserveAspectRatio","xMidYMin meet");return s;};
const line=(svg,x1,y1,x2,y2,st="#e8eef7",w=1)=>{const l=document.createElementNS(NS,"line");Object.entries({x1,y1,x2,y2,stroke:st}).forEach(([k,v])=>l.setAttribute(k,v));l.setAttribute("stroke-width",w);svg.appendChild(l);return l;};
const text=(svg,x,y,tx,size=12,weight="700",anchor="middle",fill="#a7c7dd")=>{const t=document.createElementNS(NS,"text");Object.entries({x,y,fill,"font-size":size,"font-weight":weight,"text-anchor":anchor,"font-family":'system-ui,"Noto Music","Bravura","Petaluma",sans-serif'}).forEach(([k,v])=>t.setAttribute(k,v));t.textContent=tx;svg.appendChild(t);return t;};
const head=(svg,x,y,fill="#e8eef7")=>{const e=document.createElementNS(NS,"ellipse");e.setAttribute("cx",x);e.setAttribute("cy",y);e.setAttribute("rx",3.4);e.setAttribute("ry",2.3);e.setAttribute("fill",fill);e.setAttribute("transform",`rotate(-20,${x},${y})`);svg.appendChild(e);return e;};
const stem=(svg,x,y,len=10,st="#e8eef7")=>{const l=line(svg,x+4.6,y-2,x+4.6,y-len,st,1.0);l.setAttribute("opacity","0.9");return l;};

const STEPS=["C","D","E","F","G","A","B"];
const idx=L=>STEPS.indexOf(L);
const yFor=(letter,oct,top,space)=>{const bottom=top+space*4;const steps=(oct-4)*7 + (idx(letter)-idx("E"));return bottom - (steps*space/2);};
function drawLedger(svg,xi,yi,top,bottom,space,color="#a7c7dd"){
  const short=11, w=1, alpha=0.6;
  for(let y=top-space; y>=yi-1; y-=space){ const l=line(svg, xi-short/2, y, xi+short/2, y, color,w); l.setAttribute("opacity",alpha); }
  for(let y=bottom+space; y<=yi+1; y+=space){ const l=line(svg, xi-short/2, y, xi+short/2, y, color,w); l.setAttribute("opacity",alpha); }
}
function drawKeySig(svg,key,left,top,space){
  const sig=KEY_SIG[key]||KEY_SIG.C;
  const SH=[{L:"F",o:5},{L:"C",o:5},{L:"G",o:5},{L:"D",o:5},{L:"A",o:4},{L:"E",o:5},{L:"B",o:4}];
  const FL=[{L:"B",o:4},{L:"E",o:5},{L:"A",o:4},{L:"D",o:5},{L:"G",o:4},{L:"C",o:5},{L:"F",o:4}];
  let x=left, step=5.0, size=10;
  const sharp=(L,o)=>{text(svg,x,yFor(L,o,top,space)+3,"♯",size,"800","left","#e8eef7");x+=step;};
  const flat =(L,o)=>{text(svg,x,yFor(L,o,top,space)+3,"♭",size,"800","left","#e8eef7");x+=step;};
  sig.sharps.forEach((_,i)=>{const p=SH[i]; sharp(p.L,p.o);});
  sig.flats.forEach((_,i)=>{const p=FL[i]; flat(p.L,p.o);});
  return x-left;
}

let CTX=null;

export function renderScale(key, objs){
  staffDiv.innerHTML="";
  const w=staffDiv.clientWidth||820;
  const baseH=320;
  const svg=mkSvg(w,baseH); staffDiv.appendChild(svg);
  const space=6.8; // さらに詰める
  const systems=[{top:10,left:6,right:w-6,notes:objs.slice(0,24)},
                 {top:170,left:6,right:w-6,notes:objs.slice(24,48)}];
  const all=document.createElementNS(NS,"g"); svg.appendChild(all);
  const nodes=[];

  systems.forEach((sys,si)=>{
    const {top,left,right}=sys; const bottom=top+space*4;
    for(let i=0;i<5;i++) line(all,left,top+space*i,right,top+space*i,"#e8eef7",1);
    const ksW=drawKeySig(all,key,left+6,top,space);
    const innerLeft=left+6+ksW+2, innerRight=right-6;
    const stepX=(innerRight-innerLeft)/Math.max(1,sys.notes.length);
    sys.notes.forEach((n,i)=>{
      const xi=innerLeft+stepX*(i+0.5);
      const yi=yFor(n.letter,n.octave,top,space);
      if(yi<top||yi>bottom) drawLedger(all,xi,yi,top,bottom,space);
      const sel=(si===0&&i===0);
      const h=head(all,xi,yi, sel?"#22c55e":"#e8eef7");
      const st=stem(all,xi,yi,10, sel?"#22c55e":"#e8eef7");
      nodes[si*24+i]={head:h,stem:st,x:xi,y:yi,top,bottom,space};
      if((i+1)%8===0 && i<sys.notes.length-1){ const bx=innerLeft+stepX*(i+1); line(all,bx,top,bx,bottom,"#214057",1); }
    });
  });

  // はみ出し防止の自動フィット
  const bb=all.getBBox(); const fit=Math.min(1,(baseH-12)/bb.height);
  if(fit<1){ const tx=-bb.x+6, ty=-bb.y+6; all.setAttribute("transform",`translate(${tx},${ty}) scale(${fit})`); }

  CTX={svg:nodes.length?svg:null, nodes, key, notes:objs, height:baseH};
  highlightIndex(0);
  return CTX;
}

export function highlightIndex(idx,scoreForIdx){
  if(!CTX || !CTX.nodes?.length) return;
  // バッジ消去
  document.querySelectorAll("#staff svg text.badge").forEach(e=>e.remove());
  CTX.nodes.forEach((n,i)=>{
    const col=(i===idx)?"#22c55e":"#e8eef7";
    if(n?.head) n.head.setAttribute("fill",col);
    if(n?.stem?.setAttribute) n.stem.setAttribute("stroke",col);
  });
  if(Number.isFinite(scoreForIdx) && scoreForIdx>=90){
    const n=CTX.nodes[idx]; if(n){ const t=document.createElementNS(NS,"text");
      t.setAttribute("x", n.x+9); t.setAttribute("y", Math.max(n.top+12,Math.min(n.bottom-6,n.y-10)));
      t.setAttribute("class","badge"); t.textContent = scoreForIdx>=95?"◎":"◯";
      document.querySelector("#staff svg").appendChild(t);
    }
  }
}

export function currentCtx(){ return CTX; }
