// Presidenten: kaartspel voor 4–7 spelers op één apparaat (mensen en computers door elkaar).
// Regels: 2 laag … A hoog. De joker vult elke set aan; los is hij een aas. Alleen hoger leggen, passen = klaar voor die slag.
// Niets gaat boven een aas: na een aas wint die speler de slag na 2 tellen en komt meteen weer uit.
// Staatsgreep: vier gelijke (zonder joker), na het ruilen altijd te leggen, ook buiten je beurt.
// Die stopt de ronde meteen: pleger wordt president, de president feut, de rest burger. Dan wordt opnieuw gedeeld.
(()=>{
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const SUITS=["♣","♦","♥","♠"];
const ACE=14;
const rn=r=>({11:"B",12:"V",13:"H",14:"A",15:"Joker"})[r]||String(r);
const rnPlural=r=>({11:"boeren",12:"vrouwen",13:"heren",14:"azen"})[r]||rn(r)+"'en";
const cn=c=>c.j?"Joker":rn(c.r)+c.s;
const rand=(a,b)=>a+Math.random()*(b-a);
const BOT_NAMES=["Henk","Ingrid","Kees","Fleur","Joop","Mien"];
const AVATARS=["😎","🧔","👩‍🦰","👴","🧑‍🎤","🤠","👵"];
const TCLASS={President:"pres",Vicepresident:"vp",Burger:"burger","Vice-feut":"vf",Feut:"feut"};
const REDUCED=matchMedia("(prefers-reduced-motion: reduce)").matches;
// tempo (ms): rustig, zodat je kunt volgen wat er gebeurt
const T={fly:REDUCED?0:750,think:[1400,2200],ace:2000,ex:1300,auto:900,coupBot:[2000,5000]};

// ---------- Tabbladen ----------
const TABS={quiz:{h:"BEUK<span>QUIZ</span>",t:"Beukquiz"},pres:{h:"PRESI<span>DENTEN</span>",t:"Presidenten"}};
function tab(name){
  if(!TABS[name])name="quiz";
  document.querySelectorAll(".tabs button").forEach(b=>{const on=b.dataset.tab===name;b.classList.toggle("on",on);b.setAttribute("aria-selected",on)});
  $("quizView").hidden=name!=="quiz";$("presView").hidden=name!=="pres";$("volWrap").hidden=name!=="quiz";
  $("title").innerHTML=TABS[name].h;document.title=TABS[name].t;
  if(name!=="quiz"){const a=$("audio");if(a&&!a.paused)a.pause()}
  try{localStorage.setItem("bq_tab",name)}catch(e){}
}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>tab(b.dataset.tab));
let startTab="quiz";try{startTab=localStorage.getItem("bq_tab")||"quiz"}catch(e){}
tab(startTab);

// ---------- Instellingen ----------
let cfg=loadCfg();
function loadCfg(){
  try{const c=JSON.parse(localStorage.getItem("pres_cfg"));
    if(c&&c.n>=4&&c.n<=7&&Array.isArray(c.seats)&&c.seats.length===7)return c}catch(e){}
  return {n:4,sortDesc:false,seats:[{name:"Jij",human:true},...BOT_NAMES.map(name=>({name,human:false}))]};
}
function saveCfg(){try{localStorage.setItem("pres_cfg",JSON.stringify(cfg))}catch(e){}}
function renderSetup(){
  $("pCount").innerHTML=[4,5,6,7].map(n=>`<button type="button" class="seg${cfg.n===n?" on":""}" data-n="${n}" aria-pressed="${cfg.n===n}">${n}</button>`).join("");
  $("pSeatCfg").innerHTML=cfg.seats.slice(0,cfg.n).map((s,i)=>`<div class="seatcfg">
    <span class="mini-ava" aria-hidden="true">${AVATARS[i]}</span>
    <input type="text" value="${esc(s.name)}" data-i="${i}" maxlength="14" aria-label="Naam speler ${i+1}">
    <div class="toggle" role="group" aria-label="Soort speler ${i+1}">
      <button type="button" data-i="${i}" data-h="1" class="${s.human?"on":""}" aria-pressed="${s.human}">Mens</button>
      <button type="button" data-i="${i}" data-h="0" class="${s.human?"":"on"}" aria-pressed="${!s.human}">Computer</button></div></div>`).join("");
}
$("pCount").onclick=e=>{const b=e.target.closest("[data-n]");if(!b)return;cfg.n=+b.dataset.n;saveCfg();renderSetup()};
$("pSeatCfg").onclick=e=>{const b=e.target.closest("[data-h]");if(!b)return;cfg.seats[+b.dataset.i].human=b.dataset.h==="1";saveCfg();renderSetup()};
$("pSeatCfg").oninput=e=>{const i=e.target.dataset.i;if(i!=null){cfg.seats[+i].name=e.target.value;saveCfg()}};
$("pStart").onclick=newGame;
$("pQuit").onclick=()=>{
  if(!confirm("Dit spel stoppen?"))return;
  stopTimers();G=null;$("pGame").hidden=true;$("pSetup").hidden=false;$("pOverlay").hidden=true;renderSetup();
};
renderSetup();

// ---------- Hulpjes ----------
let G=null;
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a}
function deck(){const d=[];let id=0;
  for(const s of SUITS)for(let r=2;r<=14;r++)d.push({id:id++,r,s});
  d.push({id:id++,r:15,j:true},{id:id++,r:15,j:true});return shuffle(d)}
// intern altijd laag→hoog, jokers achteraan (r=15 alleen voor sorteren en "hoogste kaart" bij het ruilen)
const sortHand=h=>h.sort((a,b)=>a.r-b.r||SUITS.indexOf(a.s)-SUITS.indexOf(b.s));
const humans=()=>G.players.map((p,i)=>p.human?i:-1).filter(i=>i>=0);
function log(t){G.log.unshift(t);if(G.log.length>40)G.log.length=40}
function take(p,cards){const ids=new Set(cards.map(c=>c.id));p.hand=p.hand.filter(c=>!ids.has(c.id))}
function groups(hand){const g={};hand.forEach(c=>{if(!c.j)(g[c.r]=g[c.r]||[]).push(c)});return g}
// Een set: allemaal dezelfde waarde, jokers vullen aan. Alleen jokers = azen.
function evalSet(cards){
  if(!cards.length)return null;
  const nat=cards.filter(c=>!c.j);
  if(nat.some(c=>c.r!==nat[0].r))return null;
  return {count:cards.length,value:nat.length?nat[0].r:ACE};
}
const isQuad=cards=>cards.length===4&&cards.every(c=>!c.j&&c.r===cards[0].r);
const quads=i=>Object.values(groups(G.players[i].hand)).filter(a=>a.length>=4).map(a=>a.slice(0,4));
const myTurn=i=>G.phase==="play"&&!G.aceHold&&G.turn===i;
function coupAllowed(i){const p=G.players[i];return G.phase==="play"&&!p.out&&p.title!=="President"}
function nextActive(i){for(let k=1;k<=G.n;k++){const j=(i+k)%G.n;if(!G.players[j].out)return j}return i}
const selCards=i=>i==null?[]:G.players[i].hand.filter(c=>G.sel.has(c.id));
function canPlay(i,cards){
  if(!myTurn(i))return false;
  if(isQuad(cards)&&coupAllowed(i))return true;
  const ev=evalSet(cards);if(!ev)return false;
  return !G.trick||(ev.count===G.trick.count&&ev.value>G.trick.value);
}
// mens die nu niet zelf hoeft te klikken: open spelen of automatisch passen
function autoActs(i){const p=G.players[i];
  return p.human&&myTurn(i)&&(p.open||(p.autoPass>0&&G.trick&&G.trick.value>p.autoPass))}

// ---------- Spelverloop ----------
function newGame(){
  stopTimers();
  const players=cfg.seats.slice(0,cfg.n).map((s,i)=>({name:s.name.trim()||`Speler ${i+1}`,human:s.human,avatar:AVATARS[i],hand:[],title:null,out:false,passed:false,pres:0}));
  const H=players.map((p,i)=>p.human?i:-1).filter(i=>i>=0);
  G={players,n:players.length,base:H.length?H[0]:0,round:0,log:[],sel:new Set(),selFor:null,viewer:null,vis:null,coupT:{},turnT:null,coupDlg:null,exQueue:[]};
  $("pSetup").hidden=true;$("pGame").hidden=false;
  startRound();
}
function stopTimers(){if(!G)return;clearTimeout(G.turnT);G.turnT=null;Object.values(G.coupT).forEach(clearTimeout);G.coupT={}}
function changed(){render();schedule()}

function startRound(){
  stopTimers();G.round++;
  G.players.forEach(p=>{p.hand=[];p.out=false;p.passed=false;p.open=false;p.autoPass=0;p.acted=false});
  deck().forEach((c,i)=>G.players[(i+G.round)%G.n].hand.push(c));
  G.players.forEach(p=>sortHand(p.hand));
  Object.assign(G,{phase:"deal",finish:[],trick:null,pile:[],pileWinner:null,lastBy:null,aceHold:false,coupBy:null,coupShow:null,coupDlg:null,exQueue:[],exSum:{},anim:null});
  G.sel.clear();
  log(`Ronde ${G.round}: de kaarten zijn gedeeld.`);
  const pr=pairs();pr.length?startExchange(pr):startPlay();
}

function pairs(){
  const t=n=>G.players.findIndex(p=>p.title===n),r=[];
  const P=t("President"),F=t("Feut"),VP=t("Vicepresident"),VF=t("Vice-feut");
  if(P>=0&&F>=0)r.push({low:F,high:P,k:2});
  if(VP>=0&&VF>=0)r.push({low:VF,high:VP,k:1});
  return r;
}
function move(a,b,cards){take(G.players[a],cards);cards.forEach(c=>c.fresh=true);G.players[b].hand.push(...cards);sortHand(G.players[b].hand)}
// Ruilen in stappen: eerst geeft de lage titel zijn hoogste kaart(en), dan geeft de hoge titel er evenveel terug.
function startExchange(pr){
  G.phase="exchange";G.exQueue=[];
  pr.forEach(({low,high,k})=>G.exQueue.push({up:true,from:low,to:high,k},{up:false,from:high,to:low,k}));
  changed();
}
// de hoogste kaarten zijn altijd de hoogste: joker, dan aas, enz., ook als je daarmee een set breekt
const forced=e=>[...G.players[e.from].hand].sort((a,b)=>b.r-a.r).slice(0,e.k);
function doExchange(cards){
  const e=G.exQueue.shift(),P=G.players;
  move(e.from,e.to,cards);G.sel.clear();
  const sum=i=>G.exSum[i]=G.exSum[i]||{gave:[],got:[]};
  sum(e.from).gave.push(...cards);sum(e.to).got.push(...cards);
  log(e.up?`${P[e.from].name} geeft ${e.k>1?`de ${e.k} hoogste kaarten`:"de hoogste kaart"} aan ${P[e.to].name}.`
          :`${P[e.from].name} geeft ${e.k>1?`${e.k} kaarten`:"1 kaart"} terug aan ${P[e.to].name}.`);
  G.anim={kind:"swap",from:e.from,to:e.to,cards};
  G.exQueue.length?changed():startPlay();
}

function startPlay(){
  G.phase="play";G.trick=null;G.pile=[];G.pileWinner=null;G.lastBy=null;G.players.forEach(p=>p.passed=false);
  // eerste ronde: klaver 2 begint; daarna altijd de feut
  let s=G.round>1?G.players.findIndex(p=>p.title==="Feut"):-1,why="is feut en begint";
  if(s<0){s=G.players.findIndex(p=>p.hand.some(c=>c.r===2&&c.s==="♣"));why="heeft klaver 2 en begint"}
  G.turn=s;log(`${G.players[s].name} ${why}.`);
  changed();
}

function play(i,cards){
  const p=G.players[i];take(p,cards);p.acted=true;p.hand.forEach(c=>c.fresh=false);G.sel.clear();
  const ev=evalSet(cards);
  if(G.pileWinner!=null){G.pile=[];G.pileWinner=null}
  G.trick={count:ev.count,value:ev.value};G.lastBy=i;
  G.pile.push({cards,by:i,value:ev.value});
  G.anim={kind:"play",by:i};
  log(`${p.name}: ${cards.map(cn).join(" ")}${cards.some(c=>c.j)?` (als ${rn(ev.value)})`:""}`);
  if(goOut(i)){changed();return}
  if(ev.value===ACE)G.aceHold=true;   // hoger dan een aas kan niet: slag is na 2 tellen voorbij
  else advanceFrom(i);
  changed();
}
function pass(i){
  const p=G.players[i];p.passed=true;p.acted=true;p.hand.forEach(c=>c.fresh=false);G.sel.clear();
  log(`${p.name} past.`);
  advanceFrom(i);changed();
}
function goOut(i){
  const p=G.players[i];if(p.hand.length)return false;
  p.out=true;G.finish.push(i);log(`${p.name} is uit (#${G.finish.length}).`);
  const left=G.players.map((q,j)=>j).filter(j=>!G.players[j].out);
  if(left.length<=1){left.forEach(j=>{G.players[j].out=true;G.finish.push(j)});endRound();return true}
  return false;
}
function endTrick(){
  const w=G.lastBy;G.trick=null;G.aceHold=false;G.pileWinner=w;G.players.forEach(p=>p.passed=false);
  G.turn=G.players[w].out?nextActive(w):w;
  log(`Slag voor ${G.players[w].name}.`);
}
// Volgende speler die nog meedoet in deze slag; is er niemand meer, dan is de slag voorbij.
function advanceFrom(i){
  for(let k=1;k<G.n;k++){const j=(i+k)%G.n,p=G.players[j];
    if(!p.out&&!p.passed&&j!==G.lastBy){G.turn=j;return}}
  endTrick();
}
function coup(i,cards){
  const p=G.players[i];take(p,cards);G.sel.clear();G.coupDlg=null;
  G.coupBy=i;G.coupShow={cards,by:i};
  const old=G.players.findIndex(q=>q.title==="President");
  G.players.forEach((q,j)=>q.title=j===i?"President":j===old?"Feut":"Burger");
  log(`STAATSGREEP door ${p.name} met vier ${rnPlural(cards[0].r)}! ${p.name} is president${old>=0?`, ${G.players[old].name} is feut`:""}, de rest is burger.`);
  G.anim={kind:"coup",by:i};
  endRound();changed();
}
function endRound(){
  stopTimers();G.phase="roundEnd";G.trick=null;G.aceHold=false;G.coupDlg=null;
  if(G.coupBy==null){const n=G.n;
    G.finish.forEach((i,pos)=>G.players[i].title=pos===0?"President":pos===1?"Vicepresident":pos===n-1?"Feut":pos===n-2?"Vice-feut":"Burger")}
  G.players.forEach(p=>{if(p.title==="President")p.pres++});
  if(G.coupBy==null)log(`Ronde ${G.round} klaar. ${G.players.find(p=>p.title==="President").name} is president.`);
}

// ---------- Computerspelers ----------
function botGiveBack(p,k){
  // weg met losse lage kaarten; sets en jokers zo lang mogelijk houden
  const g=groups(p.hand),key=c=>c.j?1000:c.r+(g[c.r].length>=2?6:0)+(g[c.r].length>=4?50:0);
  return [...p.hand].sort((a,b)=>key(a)-key(b)).slice(0,k);
}
function botChoose(p,me){
  const J=p.hand.filter(c=>c.j),g=groups(p.hand),ranks=Object.keys(g).map(Number).sort((a,b)=>a-b);
  if(!G.trick){
    if(!ranks.length)return J;
    if(ranks.length===1)return p.hand;           // één waarde + jokers: alles in één keer
    return g[ranks[0]];                          // laagste set eerst
  }
  const {count:n,value:v}=G.trick,opts=[];
  for(const r of ranks){if(r<=v)continue;const have=g[r].length;
    if(have>=n)opts.push({cards:g[r].slice(0,n),r,broke:have>n});
    else if(have+J.length>=n)opts.push({cards:[...g[r],...J.slice(0,n-have)],r,joker:true});
  }
  if(J.length>=n&&v<ACE)opts.push({cards:J.slice(0,n),r:ACE,joker:true});
  if(!opts.length)return null;
  const fin=opts.find(o=>o.cards.length===p.hand.length);if(fin)return fin.cards;
  opts.sort((a,b)=>(a.r+(a.broke?4:0)+(a.joker?8:0))-(b.r+(b.broke?4:0)+(b.joker?8:0)));
  const best=opts[0];
  // terughoudend: hoge kaarten en jokers bewaren tot het eind, tenzij iemand bijna uit is
  const others=G.players.filter((q,j)=>j!==me&&!q.out).map(q=>q.hand.length);
  const endgame=p.hand.length<=4||Math.min(...others)<=2;
  if(!endgame){
    if(best.joker)return null;
    if(best.r>=13&&Math.random()<.75)return null;
    if(best.r===12&&Math.random()<.4)return null;
    if(best.broke&&best.r>=9&&Math.random()<.6)return null;
  }
  return best.cards;
}
function botMove(i){
  if(!G||!myTurn(i))return;
  const p=G.players[i];
  if(!p.human){const q=coupAllowed(i)&&quads(i)[0];if(q)return coup(i,q)}
  const c=botChoose(p,i);
  c?play(i,c):pass(i);
}
function schedule(){
  const g=G;if(!g)return;
  clearTimeout(g.turnT);g.turnT=null;
  const later=(f,ms)=>{g.turnT=setTimeout(()=>{if(G===g)f()},ms)};
  if(g.phase==="exchange"&&g.exQueue[0]&&!g.players[g.exQueue[0].from].human){
    const e=g.exQueue[0];later(()=>doExchange(e.up?forced(e):botGiveBack(g.players[e.from],e.k)),T.ex);
  }
  if(g.phase==="play"){
    if(g.aceHold)later(()=>{endTrick();changed()},T.fly+T.ace);
    else{const t=g.turn,p=g.players[t];
      if(!p.human)later(()=>botMove(t),T.fly+rand(...T.think));
      else if(autoActs(t))later(()=>{if(!autoActs(t))return;p.open?botMove(t):pass(t)},T.fly+(p.open?rand(...T.think):T.auto));
    }
    g.players.forEach((p,i)=>{
      if(p.human||g.coupT[i]||!coupAllowed(i)||!quads(i).length)return;
      // buiten de beurt: computers wachten even, zodat een mens ze voor kan zijn
      g.coupT[i]=setTimeout(()=>{delete g.coupT[i];if(G!==g||!coupAllowed(i))return;const q=quads(i)[0];if(q)coup(i,q)},rand(...T.coupBot));
    });
  }
}

// ---------- Weergave ----------
// Wiens kaarten mogen zichtbaar zijn? Bij één mens altijd die; bij meer mensen alleen wie nu iets moet doen.
function neededViewer(){
  const H=humans();if(!H.length)return null;if(H.length===1)return H[0];
  if(G.coupDlg&&G.coupDlg.who!=null)return G.coupDlg.who;
  if(G.phase==="play"&&myTurn(G.turn)&&G.players[G.turn].human&&!autoActs(G.turn))return G.turn;
  if(G.phase==="exchange"&&G.exQueue[0]&&G.players[G.exQueue[0].from].human)return G.exQueue[0].from;
  return null;
}
function cardHTML(c,o={}){
  const cls=`card${c.j?" joker":c.s==="♥"||c.s==="♦"?" red":""}${o.sel?" sel":""}${o.btn&&c.fresh?" fresh":""}${o.hid?" hid":""}${o.mini?" mini":""}`;
  const inner=c.j?`<b>★</b><i>${o.as?`als ${rn(o.as)}`:"JOKER"}</i>`:`<b>${rn(c.r)}</b><i>${c.s}</i>`;
  const label=cn(c)+(c.j&&o.as?` als ${rn(o.as)}`:"");
  return o.btn?`<button type="button" class="${cls}"${o.fan?` style="${o.fan}"`:""} data-id="${c.id}" aria-pressed="${!!o.sel}" ${o.lock?"disabled":""} aria-label="${label}${c.fresh?" (nieuw)":""}">${inner}</button>`
              :`<span class="${cls}" role="img" aria-label="${label}">${inner}</span>`;
}
const titleTag=t=>t?`<span class="stitle t-${TCLASS[t]}">${t}</span>`:"";
const animating=()=>G.anim&&G.anim.until&&Date.now()<G.anim.until;

function render(){
  if(!G)return;
  const need=neededViewer(),multi=humans().length>1;
  if(!multi)G.viewer=need;
  const cover=multi&&need!==null&&G.viewer!==need;
  const v=need!==null&&G.viewer===need?need:null;
  G.vis=v;
  if(G.selFor!==v){G.sel.clear();G.selFor=v}
  if(v!=null){const ids=new Set(G.players[v].hand.map(c=>c.id));[...G.sel].forEach(id=>{if(!ids.has(id))G.sel.delete(id)})}
  $("pRound").textContent=`Ronde ${G.round}`;
  renderSeats();renderFelt();renderTurn(v);renderHand(v);renderActions(v);renderOpts(v);
  $("pLog").innerHTML=G.log.slice(0,6).map(t=>`<div>${esc(t)}</div>`).join("");
  renderOverlay(cover?need:null);
  runAnim(v);
}
function seatPos(i){
  const k=(i-G.base+G.n)%G.n,a=(90+k*360/G.n)*Math.PI/180;   // k=0 onderaan, daarna met de klok mee
  const rx=innerWidth<640?37:45;   // op de telefoon iets naar binnen, anders vallen de zijkanten weg
  return {x:50+rx*Math.cos(a),y:50+42*Math.sin(a)};
}
function renderSeats(){
  $("pSeats").innerHTML=G.players.map((p,i)=>{
    const {x,y}=seatPos(i),turn=myTurn(i);
    const status=p.out&&G.phase!=="roundEnd"?`<span class="bubble out">uit #${G.finish.indexOf(i)+1}</span>`
      :G.phase==="play"&&p.passed?'<span class="bubble">pas</span>':"";
    // open kaarten liggen naast elkaar op tafel, voor de speler richting het midden
    const k=(i-G.base+G.n)%G.n,a=(90+k*360/G.n)*Math.PI/180;
    const open=p.open&&!p.out?`<div class="openhand" style="--ox:${(-Math.cos(a)*90).toFixed(0)}px;--oy:${(-Math.sin(a)*78).toFixed(0)}px">${p.hand.map(c=>cardHTML(c,{mini:true})).join("")}</div>`:"";
    // dichte kaarten in de hand van het poppetje (max 7 getekend)
    const m=Math.min(p.hand.length,7);
    const fan=!p.open&&m?`<span class="mfan" aria-hidden="true">${Array.from({length:m},(_,k)=>`<i style="--r:${(k-(m-1)/2)*11}deg"></i>`).join("")}</span>`:"";
    return `<div class="seat${turn?" turn":""}${p.out&&G.phase==="play"?" out":""}" data-seat="${i}" style="left:${x}%;top:${y}%">
      <div class="ava">${p.avatar}${fan}${p.title==="President"?'<span class="crown" aria-hidden="true">👑</span>':""}${status}</div>
      <div class="nm">${esc(p.name)}${p.human?"":' <span class="bot" aria-label="computer">🤖</span>'}</div>
      <div class="cnt">${p.out?"":`${p.hand.length} kaart${p.hand.length===1?"":"en"}`}${p.pres?` · 👑${p.pres}`:""}</div>
      ${titleTag(p.title)}${open}</div>`}).join("");
}
function renderFelt(){
  const P=G.players;let pile="",msg="";
  if(G.phase==="roundEnd"){
    if(G.coupBy!=null){
      const order=["President","Feut","Burger"],ids=P.map((p,i)=>i).sort((a,b)=>order.indexOf(P[a].title)-order.indexOf(P[b].title));
      pile=`<div class="play top">${G.coupShow.cards.map(c=>cardHTML(c,{hid:animating()})).join("")}</div>`;
      msg=`<div class="coupban">STAATSGREEP!</div><div class="result">${ids.map(i=>`<div><b>${esc(P[i].name)}</b> ${titleTag(P[i].title)}</div>`).join("")}</div>`;
    }else msg=`<div class="result"><div class="rh">Ronde ${G.round} klaar</div>${G.finish.map((i,n)=>`<div><span class="pos">${n+1}</span> <b>${esc(P[i].name)}</b> ${titleTag(P[i].title)}</div>`).join("")}</div>`;
  }else{
    const show=G.pile.slice(-4),last=show.length-1;
    pile=show.map((pl,k)=>{const d=last-k,top=d===0;
      const rot=((pl.by*37+pl.cards[0].id*13)%17)-8;
      return `<div class="play${top?" top":""}${G.pileWinner!=null?" won":""}" style="--dy:${-d*16}px;--sc:${1-d*.1};--op:${top?1:.55-d*.12};--rot:${rot}deg;z-index:${k+1}">
        ${pl.cards.map(c=>cardHTML(c,{as:c.j?pl.value:0,hid:top&&animating()})).join("")}</div>`}).join("");
    if(G.phase==="exchange")msg=`<div class="tmsg">Er wordt geruild</div>`;
    else if(G.aceHold)msg=`<div class="tmsg hot">Aas! Niemand kan hoger</div>`;
    else if(G.pileWinner!=null)msg=`<div class="tmsg">Slag voor ${esc(P[G.pileWinner].name)}</div>`;
    else if(G.pile.length){const t=G.pile[G.pile.length-1];msg=`<div class="tmsg">${esc(P[t.by].name)}</div>`}
  }
  $("pPile").innerHTML=pile;$("pMsg").innerHTML=msg;
}
function renderTurn(v){
  const P=G.players;let h="",cls="turnbar";
  if(G.phase==="play"&&!G.aceHold){
    if(v!=null&&G.turn===v){h=autoActs(v)?(P[v].open?"Jij speelt open":"Automatisch passen…"):"Jij bent aan de beurt";cls+=" me"}
    else h=`${esc(P[G.turn].name)} is aan de beurt`;
  }else if(G.phase==="exchange"){
    const e=G.exQueue[0];
    if(e&&v===e.from){h=e.up?`Geef je ${e.k>1?`${e.k} hoogste kaarten`:"hoogste kaart"} aan ${esc(P[e.to].name)}`:`Kies ${e.k>1?`${e.k} kaarten`:"1 kaart"} voor ${esc(P[e.to].name)}`;cls+=" me"}
    else if(e)h=`${esc(P[e.from].name)} ruilt met ${esc(P[e.to].name)}`;
  }else if(G.aceHold)h="Nieuwe slag over 2 tellen";
  $("pTurn").className=cls;$("pTurn").innerHTML=h;
}
// waaier: kaarten overlappen, draaien naar buiten en zakken aan de randen iets weg
function fanPos(k,n){
  const w=Math.max(260,($("pHand").clientWidth||600)-24),cw=innerWidth<640?44:58;
  const step=n>1?Math.min(cw*.78,(w-cw*1.4)/(n-1)):0,o=k-(n-1)/2,ang=Math.min(3.5,36/n);
  return `--x:${(o*step).toFixed(1)}px;--y:${(o*o*ang*.22).toFixed(1)}px;--rot:${(o*ang).toFixed(2)}deg;z-index:${k+1}`;
}
function renderHand(v){
  if(v==null){
    $("pHand").innerHTML=`<p class="tag">${humans().length?"Kaarten zijn verborgen tot er een mens aan zet is.":"Alleen computers aan tafel: kijk mee."}</p>`;return}
  const p=G.players[v],e=G.exQueue[0];
  const lock=G.phase==="exchange"&&e&&e.up&&e.from===v?new Set(forced(e).map(c=>c.id)):null;
  const list=cfg.sortDesc?[...p.hand].reverse():p.hand;
  const sum=G.exSum[v];
  const swap=sum&&G.phase==="play"&&!p.acted?`<div class="swapped"><span>Weg</span>${sum.gave.map(c=>cardHTML(c,{mini:true})).join("")}<span>Erbij</span>${sum.got.map(c=>cardHTML(c,{mini:true})).join("")}</div>`:"";
  $("pHand").innerHTML=`<div class="handhead"><span class="handlabel">${esc(p.name)} · ${p.hand.length} kaart${p.hand.length===1?"":"en"}</span>
      <button type="button" class="ghost mini" data-act="sort" aria-label="Sorteervolgorde wisselen">${cfg.sortDesc?"Hoog → laag":"Laag → hoog"}</button></div>${swap}
    <div class="cards${p.open?"":" fan"}">${list.map((c,k)=>cardHTML(c,{btn:true,sel:lock?lock.has(c.id):G.sel.has(c.id),lock:!!lock,fan:p.open?null:fanPos(k,list.length)})).join("")}</div>`;
}
function renderActions(v){
  const P=G.players,A=[];
  const btn=(act,label,extra="")=>`<button type="button" data-act="${act}" ${extra}>${label}</button>`;
  const dlg=G.coupDlg&&G.coupDlg.who!=null&&v===G.coupDlg.who;
  if(dlg){
    const q=coupAllowed(v)?quads(v):[];
    if(!q.length)A.push(`<span class="tag">${coupAllowed(v)?"Geen vier gelijke kaarten":"Te laat"}</span>`);
    q.forEach(c=>A.push(btn("coup",`Staatsgreep: vier ${rnPlural(c[0].r)}`,`class="hot" data-r="${c[0].r}"`)));
    A.push(btn("coupcancel","Terug",'class="ghost"'));
  }else{
    if(G.phase==="exchange"){
      const e=G.exQueue[0];
      if(e&&v===e.from)A.push(btn("give",`Ruilen met ${esc(P[e.to].name)}`,e.up||G.sel.size===e.k?"":"disabled"));
    }else if(G.phase==="play"&&v!=null&&myTurn(v)&&!autoActs(v)){
      const sel=selCards(v),ok=canPlay(v,sel),cp=isQuad(sel)&&coupAllowed(v);
      A.push(btn("play",cp?"Staatsgreep!":"Spelen",(cp?'class="hot" ':"")+(ok?"":"disabled")));
      A.push(btn("pass","Passen",`class="ghost"${G.trick?"":" disabled"}`));
    }else if(G.phase==="roundEnd")A.push(btn("next","Volgende ronde"));
    if(v!=null&&coupAllowed(v)&&!(myTurn(v)&&isQuad(selCards(v))))
      quads(v).forEach(q=>A.push(btn("coup",`Staatsgreep: vier ${rnPlural(q[0].r)}`,`class="hot" data-r="${q[0].r}"`)));
    if(humans().length>1&&G.phase==="play"&&!G.coupDlg)A.push(btn("coupdlg","Staatsgreep…",'class="ghost"'));
  }
  $("pActions").innerHTML=A.join("");
}
function renderOpts(v){
  if(v==null||G.phase!=="play"||G.players[v].out){$("pOpts").hidden=true;return}
  const p=G.players[v];
  $("pOpts").hidden=false;
  $("pOpts").innerHTML=`<h3>Muitopties</h3>
    <label class="opt">Automatisch passen boven
      <select data-opt="autopass" aria-label="Automatisch passen boven">
        <option value="0">uit</option>${[2,3,4,5,6,7,8,9,10,11,12,13].map(r=>`<option value="${r}"${p.autoPass===r?" selected":""}>${rn(r)}</option>`).join("")}
      </select></label>
    <button type="button" class="ghost mini${p.open?" on":""}" data-act="open" aria-pressed="${!!p.open}">${p.open?"Open spelen: aan":"Open spelen"}</button>`;
}
function renderOverlay(coverFor){
  const o=$("pOverlay"),P=G.players;
  if(coverFor!=null){
    const why=G.coupDlg&&G.coupDlg.who===coverFor?"wil een staatsgreep plegen":G.phase==="exchange"?"moet ruilen":"is aan de beurt";
    $("pDialog").innerHTML=`<p class="tag">Geef het apparaat aan</p><div class="bigava" aria-hidden="true">${P[coverFor].avatar}</div><h2 class="big">${esc(P[coverFor].name)}</h2><p class="tag">${why}</p>
      <button type="button" data-act="reveal">Ik ben ${esc(P[coverFor].name)}: toon mijn kaarten</button>`;
    o.hidden=false;return;
  }
  if(G.coupDlg&&G.coupDlg.who==null){
    const H=humans().filter(coupAllowed);
    $("pDialog").innerHTML=`<h2>Wie pleegt de staatsgreep?</h2>
      <div class="btns">${H.map(i=>`<button type="button" data-act="coupwho" data-i="${i}">${P[i].avatar} ${esc(P[i].name)}</button>`).join("")||'<p class="tag">Niemand kan nu een staatsgreep plegen.</p>'}</div>
      <button type="button" class="ghost" data-act="coupcancel">Annuleren</button>`;
    o.hidden=false;return;
  }
  o.hidden=true;
}

// ---------- Kaarten laten vliegen ----------
function center(el){const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}}
function runAnim(v){
  const a=G.anim;if(!a||a.started||!T.fly)return;
  a.started=true;
  const seat=i=>document.querySelector(`#pSeats [data-seat="${i}"] .ava`);
  if(a.kind==="play"||a.kind==="coup"){
    const from=seat(a.by),targets=[...document.querySelectorAll("#pPile .play.top .card")];
    if(!from||!targets.length)return;
    a.until=Date.now()+T.fly+targets.length*90;
    targets.forEach(t=>t.classList.add("hid"));
    const s=center(from);
    targets.forEach((t,j)=>{
      const r=t.getBoundingClientRect(),cl=t.cloneNode(true);
      cl.classList.remove("hid");cl.classList.add("flyer");
      Object.assign(cl.style,{left:r.left+"px",top:r.top+"px",width:r.width+"px",height:r.height+"px"});
      document.body.appendChild(cl);
      const dx=s.x-(r.left+r.width/2),dy=s.y-(r.top+r.height/2);
      cl.animate([{transform:`translate(${dx}px,${dy}px) scale(.35) rotate(-25deg)`,opacity:.4},{transform:"none",opacity:1}],
        {duration:T.fly,delay:j*90,easing:"cubic-bezier(.2,.7,.2,1)",fill:"backwards"}).onfinish=()=>cl.remove();
    });
    setTimeout(()=>document.querySelectorAll("#pPile .hid").forEach(e=>e.classList.remove("hid")),T.fly+targets.length*90);
  }else if(a.kind==="swap"){
    const f=seat(a.from),t=seat(a.to);if(!f||!t)return;
    const s=center(f),d=center(t),faceUp=v===a.from||v===a.to;
    a.cards.forEach((c,j)=>{
      const tmp=document.createElement("div");
      tmp.innerHTML=faceUp?cardHTML(c):'<span class="card back" aria-hidden="true"></span>';
      const el=tmp.firstChild;el.classList.add("flyer");
      Object.assign(el.style,{left:(s.x-29)+"px",top:(s.y-42)+"px"});
      document.body.appendChild(el);
      el.animate([{transform:"scale(.5)",opacity:0},{transform:"scale(1)",opacity:1,offset:.25},{transform:`translate(${d.x-s.x}px,${d.y-s.y}px) scale(.6)`,opacity:.9}],
        {duration:T.fly*1.4,delay:j*140,easing:"ease-in-out",fill:"both"}).onfinish=()=>el.remove();
    });
  }
}

// ---------- Invoer ----------
$("pHand").onclick=e=>{
  const s=e.target.closest('[data-act="sort"]');
  if(s){cfg.sortDesc=!cfg.sortDesc;saveCfg();render();return}
  const b=e.target.closest("[data-id]");if(!b||b.disabled||!G||G.vis==null||G.phase==="roundEnd")return;
  const id=+b.dataset.id;G.sel.has(id)?G.sel.delete(id):G.sel.add(id);render();
};
function onAct(e){
  const b=e.target.closest("[data-act]");if(!b||b.disabled||!G)return;
  const v=G.vis;
  switch(b.dataset.act){
    case "give":{const h=G.exQueue[0];if(!h||v!==h.from)return;
      const c=h.up?forced(h):selCards(v);if(c.length===h.k)doExchange(c);break}
    case "play":{const c=selCards(v);if(!canPlay(v,c))return;
      isQuad(c)&&coupAllowed(v)?coup(v,c):play(v,c);break}
    case "pass":if(myTurn(v)&&G.trick)pass(v);break;
    case "next":startRound();break;
    case "coup":{if(v==null||!coupAllowed(v))return;const q=quads(v).find(q=>q[0].r===+b.dataset.r);if(q)coup(v,q);break}
    case "coupdlg":G.coupDlg={who:null};render();break;
    case "coupwho":G.coupDlg={who:+b.dataset.i};render();break;
    case "coupcancel":G.coupDlg=null;render();break;
    case "reveal":G.viewer=neededViewer();render();break;
    case "open":if(v!=null){const p=G.players[v];
      if(!p.open&&!confirm("Open spelen? Je kaarten liggen dan open op tafel en de computer speelt ze deze ronde voor je uit."))return;
      p.open=!p.open;changed()}break;
  }
}
addEventListener("resize",()=>{if(G)render()});
$("pActions").onclick=onAct;$("pDialog").onclick=onAct;$("pOpts").onclick=onAct;
$("pOpts").onchange=e=>{if(e.target.dataset.opt==="autopass"&&G&&G.vis!=null){G.players[G.vis].autoPass=+e.target.value;changed()}};
})();
