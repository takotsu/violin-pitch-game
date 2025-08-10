// score.js
import { KEY_SIG, toVexKeys } from "./scales.js";

const staffDiv = document.getElementById("staff");
const spark = document.getElementById("spark");
let cache = null;

function mkSvg(w,h){ const ns="http://www.w3.org/2000/svg"; const s=document.createElementNS(ns,"svg"); s.setAttribute("viewBox",`0 0 ${w} ${h}`); s.setAttribute("width","100%"); s.setAttribute("height","100%"); return s; }
function line(svg,x1,y1,x2,y2,stroke="#e8eef7",w=1){ const ns="http://www.w3.org/2000/svg"; const l=document.createElementNS(ns,"line"); l.setAttribute("x1",x1); l.setAttribute("y1",y1); l.setAttribute("x2",x2); l.setAttribute("y2",y2); l.setAttribute("stroke",stroke); l.setAttribute("stroke-width",w); svg.appendChild(l); return l; }
function text(svg,x,y,str,size=12,weight="700",anchor="middle",fill="#a7c7dd"){
  const ns="http://www.w3.org/2000/svg"; const t=document.createElementNS(ns,"text");
  t.setAttribute("x",x); t.setAttribute("y",y); t.setAttribute("fill",fill);
  t.setAttribute("font-size",size); t.setAttribute("font-weight",weight); t.setAttribute("text-anchor",anchor);
  t.setAttribute("font-family",'system-ui,"Noto Music","Bravura","Petaluma",sans-serif'); t.textContent=str; svg.appendChild(t); return t;
}
function notehead(svg,x,y,cls="note-normal",rX=5.8,rY=4.2,rot=-20){
  const ns="http://www.w3.org/2000/svg"; const e=document.createElementNS(ns,"ellipse");
  e.setAttribute("cx",x); e.setAttribute("cy",y); e.setAttribute("rx",rX); e.setAttribute("ry",rY);
  e.setAttribute("transform",`rotate(${rot},${x},${y})`); e.setAttribute("class",cls); svg.appendChild(e); return e;
}
function stem(svg,x,y,len=18,cls="note-normal"){ return line(svg,x+7,y-3,x+7,y-3-len,"currentColor",1.6).classList.add(cls), null; }

function renderKeySignature(svg, key, left, top, space){
  const sig = KEY_SIG[key] || KEY_SIG["C"];
  const SHARP_POS=[{L:'F',o:5},{L:'C',o:5},{L:'G',o:5},{L:'D',o:5},{L:'A',o:4},{L:'E',o:5},{L:'B',o:4}];
  const FLAT_POS =[{L:'B',o:4},{L:'E',o:5},{L:'A',o:4},{L:'D',o:5},{L:'G',o:4},{L:'C',o:5},{L:'F',o:4}];
  const yFor=(letter,oct)=>{ const seq=["C","D","E","F","G","A","B"]; const idx=(L)=>seq.indexOf(L);
    const steps=(oct-4)*7 + (idx(letter)-idx("E")); const bottom=top+space*4; return bottom - (steps*space/2); };
  let x=left;
  const drawSharp=(L,o)=>{ text(svg,x, yFor(L,o)+4, "♯", 18, "800","left","#e8eef7"); x+=10; };
  const drawFlat =(L,o)=>{ text(svg,x, yFor(L,o)+4, "♭", 18, "800","left","#e8eef7"); x+=10; };
  if(sig.sharps.length){ for(let i=0;i<sig.sharps.length;i++){ const p=SHARP_POS[i]; drawSharp(p.L,p.o); } }
  else if(sig.flats.length){ for(let i=0;i<sig.flats.length;i++){ const p=FLAT_POS[i]; drawFlat(p.L,p.o); } }
  return x-left;
}

function renderFallback({ key, notes16 }){
  staffDiv.innerHTML="";
  const w=staffDiv.clientWidth||680, h=300;
  const svg=mkSvg(w,h); staffDiv.appendChild(svg);
  const top=60, space=14, left=16, right=w-16, bottom=top+space*4;

  for(let i=0;i<5;i++) line(svg,left, top+space*i, right, top+space*i, "#e8eef7", 1.2);

  const ksW = renderKeySignature(svg,key,left+4, top, space);
  const innerLeft = left+4+ksW+8, innerRight=right-8;

  const stepX=(innerRight-innerLeft)/16;
  const yFor=(L,O)=>{ const seq=["C","D","E","F","G","A","B"]; const idx=(l)=>seq.indexOf(l); const s=(O-4)*7+(idx(L)-idx("E")); return bottom-(s*space/2); };

  const nodes=[], anchors=[];
  notes16.forEach((n,i)=>{
    const x = innerLeft + stepX*(i+0.5);
    const y = yFor(n.letter, n.octave);
    const head = notehead(svg,x,y,"note-normal");
    stem(svg,x,y,20,"note-normal");
    // 小節線（8音毎）
    if((i+1)%8===0 && i<16) line(svg, innerLeft+stepX*(i+1), top, innerLeft+stepX*(i+1), bottom, "#7aa2c1",1.2);
    nodes.push(head);
    anchors.push({x,y});
    // 加線
    const pos = (bottom - y)/(space/2); // E4を0として段数
    if(pos<-2){ // 下加線
      for(let k=-2;k>=pos; k-=2){ line(svg, x-9, bottom + (Math.abs(k)/2-1)*space, x+9, bottom + (Math.abs(k)/2-1)*space, "#e8eef7",1.2); }
    }else if(pos>8){ // 上加線
      for(let k=10;k<=pos; k+=2){ line(svg, x-9, top - ((k-10)/2+1)*space, x+9, top - ((k-10)/2+1)*space, "#e8eef7",1.2); }
    }
  });

  cache={ mode:"svg", svg, nodes, anchors, key, left:innerLeft, stepX, top, space, bottom };
  return api();
}

function renderVex({ key, vexKeys16, noteObjs16 }){
  staffDiv.innerHTML="";
  const VF = window.Vex?.Flow;
  const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
  const w=staffDiv.clientWidth||680, h=300; renderer.resize(w,h);
  const ctx = renderer.getContext();

  const stave = new VF.Stave(10,40,w-20);
  stave.addKeySignature(key);
  stave.setContext(ctx).draw();

  const notes = vexKeys16.map(k=>new VF.StaveNote({keys:[k],duration:"8",clef:"treble"}));
  const voice = new VF.Voice({num_beats:16,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(notes);
  new VF.Formatter().joinVoices([voice]).format([voice], w-40);
  voice.draw(ctx,stave);

  cache={ mode:"vex", VF, renderer, ctx, stave, notes, noteObjs:noteObjs16, key };
  return api();
}

function api(){
  return {
    mode: cache.mode,
    recolor(i, cls){
      if(cache.mode==="vex"){
        const n=cache.notes[i]; if(!n) return;
        const color = cls==="note-target"?"#22c55e":(cls==="note-failed"?"#ef4444":"#e8eef7");
        n.setStyle({fillStyle:color, strokeStyle:color});
        cache.ctx.clear(); cache.stave.setContext(cache.ctx).draw();
        const voice=new cache.VF.Voice({num_beats:16,beat_value:4}).setMode(cache.VF.Voice.Mode.SOFT).addTickables(cache.notes);
        new cache.VF.Formatter().joinVoices([voice]).format([voice], staffDiv.clientWidth-40);
        voice.draw(cache.ctx,cache.stave);
      }else{
        const el = cache.nodes[i]; if(!el) return;
        el.setAttribute("class", cls);
      }
    },
    badge(i, symbol){
      const gId = "badge-layer";
      let layer = staffDiv.querySelector(`#${gId}`);
      if(cache.mode==="vex"){
        const svg = staffDiv.querySelector("svg");
        if(!layer){ layer = document.createElementNS("http://www.w3.org/2000/svg","g"); layer.setAttribute("id",gId); svg.appendChild(layer); }
        const bb = cache.notes[i]?.getBoundingBox();
        if(!bb) return;
        const x = bb.getX() + bb.getW() + 6;
        const y = bb.getY() + 6;
        const t=document.createElementNS("http://www.w3.org/2000/svg","text");
        t.setAttribute("x",x); t.setAttribute("y",y); t.setAttribute("fill","#ffd166");
        t.setAttribute("font-size","12"); t.setAttribute("font-weight","800"); t.textContent = symbol;
        layer.appendChild(t);
      }else{
        const svg = staffDiv.querySelector("svg");
        if(!layer){ layer = document.createElementNS("http://www.w3.org/2000/svg","g"); layer.setAttribute("id",gId); svg.appendChild(layer); }
        const a = cache.anchors[i]; if(!a) return;
        const t=document.createElementNS("http://www.w3.org/2000/svg","text");
        t.setAttribute("x",a.x+12); t.setAttribute("y",a.y-8); t.setAttribute("fill","#ffd166");
        t.setAttribute("font-size","12"); t.setAttribute("font-weight","800"); t.textContent = symbol;
        layer.appendChild(t);
      }
    },
    getXY(i){
      if(cache.mode==="vex"){
        const bb = cache.notes[i]?.getBoundingBox();
        if(!bb) return {x:0,y:0};
        const rect = staffDiv.querySelector("svg").getBoundingClientRect();
        const x = bb.getX()+bb.getW()/2, y = bb.getY()+bb.getH()/2;
        return {x, y};
      }else{
        const a = cache.anchors[i]; return a || {x:0,y:0};
      }
    }
  };
}

function buildTicks(){
  const g=document.getElementById("tickset"); if(!g) return;
  g.innerHTML="";
  for(let c=-50;c<=50;c+=5){
    const ang = (c/50)*60;
    const x1 = Math.sin(ang*Math.PI/180)*48;
    const y1 = -Math.cos(ang*Math.PI/180)*48;
    const len = (c%25===0?8:(c%10===0?6:4));
    const x2 = Math.sin(ang*Math.PI/180)*(48-len);
    const y2 = -Math.cos(ang*Math.PI/180)*(48-len);
    const l=document.createElementNS("http://www.w3.org/2000/svg","line");
    l.setAttribute("x1",x1); l.setAttribute("y1",y1);
    l.setAttribute("x2",x2); l.setAttribute("y2",y2);
    l.setAttribute("class","tick"+(c%25===0?" major":""));
    g.appendChild(l);
  }
}
buildTicks();

/* 2小節=16音の描画 */
export function renderTwoBars({ key, notes, offset=0 }){
  const slice = notes.slice(offset, offset+16);
  const vex = toVexKeys(slice, key);
  const okVex = !!window.Vex?.Flow;
  return okVex ? renderVex({key, vexKeys16:vex, noteObjs16:slice}) : renderFallback({key, notes16:slice});
}
