// Presidenten: kaartspel voor 4–7 spelers op één apparaat (mensen en computers door elkaar).
// Regels: 2 laag … A hoog, joker hoogst en vult elke set aan. Alleen hoger leggen, passen = klaar voor die slag.
// Staatsgreep: vier gelijke (zonder joker), na het ruilen altijd te leggen, ook buiten je beurt.
// Die stopt de ronde meteen: pleger wordt president, de president feut, de rest burger. Dan wordt opnieuw gedeeld.
(()=>{
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const SUITS=["♣","♦","♥","♠"];
const rn=r=>({11:"B",12:"V",13:"H",14:"A",15:"Joker"})[r]||String(r);
const rnPlural=r=>({11:"boeren",12:"vrouwen",13:"heren",14:"azen"})[r]||rn(r)+"'en";
const cn=c=>c.j?"Joker":rn(c.r)+c.s;
const rand=(a,b)=>a+Math.random()*(b-a);
const BOT_NAMES=["Henk","Ingrid","Kees","Fleur","Joop","Mien"];
const TCLASS={President:"pres",Vicepresident:"vp",Burger:"burger","Vice-feut":"vf",Feut:"feut"};

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
  return {n:4,seats:[{name:"Jij",human:true},...BOT_NAMES.map(name=>({name,human:false}))]};
}
function saveCfg(){try{localStorage.setItem("pres_cfg",JSON.stringify(cfg))}catch(e){}}
function renderSetup(){
  $("pCount").innerHTML=[4,5,6,7].map(n=>`<button type="button" class="seg${cfg.n===n?" on":""}" data-n="${n}" aria-pressed="${cfg.n===n}">${n}</button>`).join("");
  $("pSeatCfg").innerHTML=cfg.seats.slice(0,cfg.n).map((s,i)=>`<div class="seatcfg">
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
const sortHand=h=>h.sort((a,b)=>a.r-b.r||SUITS.indexOf(a.s)-SUITS.indexOf(b.s));
const humans=()=>G.players.map((p,i)=>p.human?i:-1).filter(i=>i>=0);
function log(t){G.log.unshift(t);if(G.log.length>40)G.log.length=40}
function take(p,cards){const ids=new Set(cards.map(c=>c.id));p.hand=p.hand.filter(c=>!ids.has(c.id))}
function groups(hand){const g={};hand.forEach(c=>{if(!c.j)(g[c.r]=g[c.r]||[]).push(c)});return g}
// Een set: allemaal dezelfde waarde, jokers vullen aan. Alleen jokers = jokerwaarde (hoogst).
function evalSet(cards){
  if(!cards.length)return null;
  const nat=cards.filter(c=>!c.j);
  if(nat.some(c=>c.r!==nat[0].r))return null;
  return {count:cards.length,value:nat.length?nat[0].r:15};
}
const isQuad=cards=>cards.length===4&&cards.every(c=>!c.j&&c.r===cards[0].r);
const quads=i=>Object.values(groups(G.players[i].hand)).filter(a=>a.length>=4).map(a=>a.slice(0,4));
function coupAllowed(i){const p=G.players[i];
  return G.phase==="play"&&!p.out&&p.title!=="President"}
function nextActive(i){for(let k=1;k<=G.n;k++){const j=(i+k)%G.n;if(!G.players[j].out)return j}return i}
const selCards=i=>i==null?[]:G.players[i].hand.filter(c=>G.sel.has(c.id));
function canPlay(i,cards){
  if(G.phase!=="play"||G.turn!==i)return false;
  if(isQuad(cards)&&coupAllowed(i))return true;
  const ev=evalSet(cards);if(!ev)return false;
  return !G.trick||(ev.count===G.trick.count&&ev.value>G.trick.value);
}

// ---------- Spelverloop ----------
function newGame(){
  stopTimers();
  const players=cfg.seats.slice(0,cfg.n).map((s,i)=>({name:s.name.trim()||`Speler ${i+1}`,human:s.human,hand:[],title:null,out:false,passed:false,pres:0}));
  G={players,n:players.length,round:0,log:[],sel:new Set(),selFor:null,viewer:null,vis:null,coupT:{},turnT:null,coupDlg:null,exQueue:[]};
  $("pSetup").hidden=true;$("pGame").hidden=false;
  startRound();
}
function stopTimers(){if(!G)return;clearTimeout(G.turnT);G.turnT=null;Object.values(G.coupT).forEach(clearTimeout);G.coupT={}}
function changed(){render();schedule()}

function startRound(){
  stopTimers();G.round++;
  G.players.forEach(p=>{p.hand=[];p.out=false;p.passed=false});
  deck().forEach((c,i)=>G.players[(i+G.round)%G.n].hand.push(c));
  G.players.forEach(p=>sortHand(p.hand));
  Object.assign(G,{phase:"deal",finish:[],trick:null,show:null,lastBy:null,coupBy:null,coupDlg:null,exQueue:[]});
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
function startExchange(pr){
  G.phase="exchange";G.exQueue=[];
  pr.forEach(({low,high,k})=>{
    const lo=G.players[low],hi=G.players[high];
    // de hoogste kaarten zijn altijd de hoogste: joker, dan aas, enz., ook als je daarmee een set breekt
    const best=[...lo.hand].sort((a,b)=>b.r-a.r).slice(0,k);
    move(low,high,best);
    log(`${lo.title} ${lo.name} geeft ${k>1?`de ${k} hoogste kaarten`:"de hoogste kaart"} aan ${hi.title} ${hi.name}.`);
    G.exQueue.push({from:high,to:low,k});
  });
  nextExchange();
}
function nextExchange(){
  while(G.exQueue.length&&!G.players[G.exQueue[0].from].human){
    const e=G.exQueue.shift();
    move(e.from,e.to,botGiveBack(G.players[e.from],e.k));
    log(`${G.players[e.from].name} geeft ${e.k>1?`${e.k} kaarten`:"1 kaart"} terug.`);
  }
  G.exQueue.length?changed():startPlay();
}
function giveBack(){
  const e=G.exQueue[0];if(!e||G.vis!==e.from)return;
  const cards=selCards(e.from);if(cards.length!==e.k)return;
  move(e.from,e.to,cards);G.sel.clear();G.exQueue.shift();
  log(`${G.players[e.from].name} geeft ${e.k>1?`${e.k} kaarten`:"1 kaart"} terug.`);
  nextExchange();
}

function startPlay(){
  G.phase="play";G.trick=null;G.lastBy=null;G.players.forEach(p=>p.passed=false);
  // eerste ronde: klaver 2 begint; daarna altijd de feut
  let s=G.round>1?G.players.findIndex(p=>p.title==="Feut"):-1,why="is feut en begint";
  if(s<0){s=G.players.findIndex(p=>p.hand.some(c=>c.r===2&&c.s==="♣"));why="heeft klaver 2 en begint"}
  G.turn=s;log(`${G.players[s].name} ${why}.`);
  changed();
}

function play(i,cards){
  const p=G.players[i];take(p,cards);p.hand.forEach(c=>c.fresh=false);G.sel.clear();
  const ev=evalSet(cards);
  G.trick={count:ev.count,value:ev.value};G.lastBy=i;G.show={cards,by:i};
  log(`${p.name}: ${cards.map(cn).join(" ")}`);
  if(!goOut(i))advanceFrom(i);
  changed();
}
function pass(i){
  const p=G.players[i];p.passed=true;p.hand.forEach(c=>c.fresh=false);G.sel.clear();
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
// Volgende speler die nog meedoet in deze slag; is er niemand meer, dan is de slag voorbij.
function advanceFrom(i){
  for(let k=1;k<G.n;k++){const j=(i+k)%G.n,p=G.players[j];
    if(!p.out&&!p.passed&&j!==G.lastBy){G.turn=j;return}}
  const w=G.lastBy;G.trick=null;G.players.forEach(p=>p.passed=false);
  G.turn=G.players[w].out?nextActive(w):w;
  log(`Slag voor ${G.players[w].name}. ${G.players[G.turn].name} begint.`);
}
function coup(i,cards){
  const p=G.players[i];take(p,cards);G.sel.clear();G.coupDlg=null;
  G.coupBy=i;
  const old=G.players.findIndex(q=>q.title==="President");
  G.players.forEach((q,j)=>q.title=j===i?"President":j===old?"Feut":"Burger");
  log(`STAATSGREEP door ${p.name} met vier ${rnPlural(cards[0].r)}! ${p.name} is president${old>=0?`, ${G.players[old].name} is feut`:""}, de rest is burger.`);
  G.show={cards,by:i,coup:true};
  endRound();changed();
}
function endRound(){
  stopTimers();G.phase="roundEnd";G.trick=null;G.coupDlg=null;
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
function botChoose(p){
  const J=p.hand.filter(c=>c.j),g=groups(p.hand),ranks=Object.keys(g).map(Number).sort((a,b)=>a-b);
  if(!G.trick){
    if(!ranks.length)return J;
    if(ranks.length===1)return p.hand;           // één waarde + jokers: alles in één keer
    return g[ranks[0]];                          // laagste set eerst
  }
  const {count:n,value:v}=G.trick,opts=[];
  for(const r of ranks){if(r<=v)continue;const have=g[r].length;
    if(have>=n)opts.push({cards:g[r].slice(0,n),key:r+(have>n?5:0)});
    else if(have+J.length>=n)opts.push({cards:[...g[r],...J.slice(0,n-have)],key:r+12,joker:true});
  }
  if(J.length>=n&&v<15)opts.push({cards:J.slice(0,n),key:30,joker:true});
  if(!opts.length)return null;
  const fin=opts.find(o=>o.cards.length===p.hand.length);if(fin)return fin.cards;
  opts.sort((a,b)=>a.key-b.key);const best=opts[0],big=p.hand.length>6;
  if(best.joker&&big&&Math.random()<.7)return null;   // jokers bewaren
  if(best.key>=13&&big&&Math.random()<.35)return null; // hoge kaarten even sparen
  return best.cards;
}
function botMove(i){
  if(!G||G.phase!=="play"||G.turn!==i)return;
  const q=coupAllowed(i)&&quads(i)[0];if(q)return coup(i,q);
  const c=botChoose(G.players[i]);
  c?play(i,c):pass(i);
}
function schedule(){
  const g=G;if(!g)return;
  clearTimeout(g.turnT);g.turnT=null;
  if(g.phase==="play"&&!g.players[g.turn].human){const t=g.turn;g.turnT=setTimeout(()=>{if(G===g)botMove(t)},rand(700,1400))}
  if(g.phase==="play")g.players.forEach((p,i)=>{
    if(p.human||g.coupT[i]||!coupAllowed(i)||!quads(i).length)return;
    // buiten de beurt: computers wachten even, zodat een mens ze voor kan zijn
    g.coupT[i]=setTimeout(()=>{delete g.coupT[i];if(G!==g||!coupAllowed(i))return;const q=quads(i)[0];if(q)coup(i,q)},rand(1500,4500));
  });
}

// ---------- Weergave ----------
// Wiens kaarten mogen zichtbaar zijn? Bij één mens altijd die; bij meer mensen alleen wie nu iets moet doen.
function neededViewer(){
  const H=humans();if(!H.length)return null;if(H.length===1)return H[0];
  if(G.coupDlg&&G.coupDlg.who!=null)return G.coupDlg.who;
  if(G.phase==="play"&&G.players[G.turn].human)return G.turn;
  if(G.phase==="exchange"&&G.exQueue[0])return G.exQueue[0].from;
  return null;
}
function cardHTML(c,asBtn,sel){
  const cls=`card${c.j?" joker":c.s==="♥"||c.s==="♦"?" red":""}${sel?" sel":""}${asBtn&&c.fresh?" fresh":""}`;
  const inner=c.j?`<b>★</b><i>JOKER</i>`:`<b>${rn(c.r)}</b><i>${c.s}</i>`;
  return asBtn?`<button type="button" class="${cls}" data-id="${c.id}" aria-pressed="${!!sel}" aria-label="${cn(c)}${c.fresh?" (nieuw)":""}">${inner}</button>`
              :`<span class="${cls}" role="img" aria-label="${cn(c)}">${inner}</span>`;
}
const titleTag=t=>t?`<span class="stitle t-${TCLASS[t]}">${t}</span>`:`<span class="stitle">geen titel</span>`;

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
  renderSeats(v);renderTable();renderActions(v);renderHand(v);
  $("pLog").innerHTML=G.log.slice(0,8).map(t=>`<div>${esc(t)}</div>`).join("");
  renderOverlay(cover?need:null);
}
function renderSeats(v){
  $("pSeats").innerHTML=G.players.map((p,i)=>{
    const turn=G.phase==="play"&&G.turn===i;
    const info=p.out?`uit #${G.finish.indexOf(i)+1}`:`${p.hand.length} kaart${p.hand.length===1?"":"en"}${G.phase==="play"&&p.passed?" · pas":""}`;
    return `<div class="seat${turn?" turn":""}${p.out&&G.phase==="play"?" out":""}${i===v?" mine":""}">
      <div class="sname">${p.human?"":'<span aria-label="computer">🤖</span> '}${esc(p.name)}</div>
      ${titleTag(p.title)}
      <div class="sinfo">${info}${p.pres?` · 👑${p.pres}`:""}</div></div>`}).join("");
}
function renderTable(){
  const P=G.players,s=G.show;let h="";
  if(G.phase==="roundEnd"){
    if(G.coupBy!=null){
      const order=["President","Feut","Burger"],ids=P.map((p,i)=>i).sort((a,b)=>order.indexOf(P[a].title)-order.indexOf(P[b].title));
      h=`<div class="coupban">STAATSGREEP!</div><div class="trick">${s.cards.map(c=>cardHTML(c)).join("")}</div>
        <div class="cap">${esc(P[G.coupBy].name)} grijpt de macht. De ronde stopt en er wordt opnieuw gedeeld.</div>
        <div class="result"><ol>${ids.map(i=>`<li><b>${esc(P[i].name)}</b> ${titleTag(P[i].title)}</li>`).join("")}</ol></div>`;
    }else h=`<div class="result"><h2>Ronde ${G.round} klaar</h2><ol>${G.finish.map(i=>`<li><b>${esc(P[i].name)}</b> ${titleTag(P[i].title)}</li>`).join("")}</ol></div>`;
  }else{
    if(s&&s.cards){
      h+=`${s.coup?'<div class="coupban">STAATSGREEP!</div>':""}<div class="trick${G.trick||s.coup?"":" old"}">${s.cards.map(c=>cardHTML(c)).join("")}</div>
        <div class="cap">${esc(P[s.by].name)}${s.coup?" pleegt een staatsgreep":" legt op"}</div>`;
    }else h+=`<div class="cap muted">Nog niets gelegd</div>`;
    if(G.phase==="play")h+=`<div class="sub">${G.trick?`Te slaan: ${G.trick.count}× hoger dan ${rn(G.trick.value)}`:`Nieuwe slag · ${esc(P[G.turn].name)} begint`}</div>`;
    else if(G.phase==="exchange")h+=`<div class="sub">Er wordt geruild</div>`;
  }
  $("pTable").innerHTML=h;
}
function renderActions(v){
  const P=G.players,A=[];let msg="";
  const btn=(act,label,extra="")=>`<button type="button" data-act="${act}" ${extra}>${label}</button>`;
  const dlg=G.coupDlg&&G.coupDlg.who!=null&&v===G.coupDlg.who;
  if(dlg){
    const q=coupAllowed(v)?quads(v):[];
    msg=!coupAllowed(v)?"Te laat: er kan nu geen staatsgreep meer.":q.length?"Kies je vier gelijke kaarten.":"Je hebt geen vier gelijke kaarten (jokers tellen niet mee).";
    q.forEach(c=>A.push(btn("coup",`Staatsgreep: vier ${rnPlural(c[0].r)}`,`class="hot" data-r="${c[0].r}"`)));
    A.push(btn("coupcancel","Terug",'class="ghost"'));
  }else{
    if(G.phase==="exchange"){
      const e=G.exQueue[0];
      if(e&&v===e.from){
        const kw=e.k>1?`${e.k} kaarten`:"1 kaart";
        msg=`Je kreeg ${e.k>1?"de 2 hoogste kaarten":"de hoogste kaart"} van ${esc(P[e.to].name)} (groen omrand). Kies ${kw} om terug te geven: kaarten die jij kwijt wilt.`;
        A.push(btn("give",`Geef ${kw} aan ${esc(P[e.to].name)}`,G.sel.size===e.k?"":"disabled"));
      }else if(e)msg=`${esc(P[e.from].name)} kiest ${e.k>1?"kaarten":"een kaart"} om terug te geven…`;
    }else if(G.phase==="play"){
      if(v===G.turn){
        const t=G.trick;
        msg=t?`Leg ${t.count} ${t.count>1?"kaarten":"kaart"} hoger dan ${rn(t.value)}, of pas.`:"Jij begint deze slag: leg één of meer kaarten van dezelfde waarde. Jokers vullen aan.";
        const sel=selCards(v),ok=canPlay(v,sel),cp=isQuad(sel)&&coupAllowed(v);
        A.push(btn("play",cp?"Staatsgreep!":"Spelen",(cp?'class="hot" ':"")+(ok?"":"disabled")));
        A.push(btn("pass","Passen",`class="ghost"${G.trick?"":" disabled"}`));
      }else msg=`${esc(P[G.turn].name)} is aan de beurt…`;
    }else if(G.phase==="roundEnd"){
      msg="De titels hieronder gelden voor de volgende ronde.";
      A.push(btn("next","Volgende ronde"));
    }
    if(v!=null&&coupAllowed(v)&&!(G.phase==="play"&&G.turn===v&&isQuad(selCards(v))))
      quads(v).forEach(q=>A.push(btn("coup",`Staatsgreep: vier ${rnPlural(q[0].r)}`,`class="hot" data-r="${q[0].r}"`)));
    if(humans().length>1&&G.phase==="play"&&!G.coupDlg)
      A.push(btn("coupdlg","Staatsgreep…",'class="ghost"'));
  }
  $("pActions").innerHTML=`<p class="msg">${msg}</p>${A.length?`<div class="btns">${A.join("")}</div>`:""}`;
}
function renderHand(v){
  if(v==null){
    $("pHand").innerHTML=`<p class="tag">${humans().length?"Kaarten zijn verborgen tot er een mens aan zet is.":"Alleen computers aan tafel: kijk mee."}</p>`;return}
  const p=G.players[v];
  $("pHand").innerHTML=`<div class="handlabel">${esc(p.name)} · ${p.hand.length} kaart${p.hand.length===1?"":"en"}</div>
    <div class="cards">${p.hand.map(c=>cardHTML(c,true,G.sel.has(c.id))).join("")}</div>`;
}
function renderOverlay(coverFor){
  const o=$("pOverlay"),P=G.players;
  if(coverFor!=null){
    const why=G.coupDlg&&G.coupDlg.who===coverFor?"wil een staatsgreep plegen":G.phase==="exchange"?"moet kaarten teruggeven":"is aan de beurt";
    $("pDialog").innerHTML=`<p class="tag">Geef het apparaat aan</p><h2 class="big">${esc(P[coverFor].name)}</h2><p class="tag">${why}. De rest kijkt even weg.</p>
      <button type="button" data-act="reveal">Ik ben ${esc(P[coverFor].name)}: toon mijn kaarten</button>`;
    o.hidden=false;return;
  }
  if(G.coupDlg&&G.coupDlg.who==null){
    const H=humans().filter(coupAllowed);
    $("pDialog").innerHTML=`<h2>Wie pleegt de staatsgreep?</h2><p class="tag">Vier gelijke kaarten, jokers tellen niet mee. De president kan geen staatsgreep plegen.</p>
      <div class="btns">${H.map(i=>`<button type="button" data-act="coupwho" data-i="${i}">${esc(P[i].name)}</button>`).join("")||'<p class="tag">Niemand kan nu een staatsgreep plegen.</p>'}</div>
      <button type="button" class="ghost" data-act="coupcancel">Annuleren</button>`;
    o.hidden=false;return;
  }
  o.hidden=true;
}

// ---------- Invoer ----------
$("pHand").onclick=e=>{
  const b=e.target.closest("[data-id]");if(!b||!G||G.vis==null||G.phase==="roundEnd")return;
  const id=+b.dataset.id;G.sel.has(id)?G.sel.delete(id):G.sel.add(id);render();
};
function onAct(e){
  const b=e.target.closest("[data-act]");if(!b||b.disabled||!G)return;
  const v=G.vis;
  switch(b.dataset.act){
    case "give":giveBack();break;
    case "play":{const c=selCards(v);if(!canPlay(v,c))return;
      isQuad(c)&&coupAllowed(v)?coup(v,c):play(v,c);break}
    case "pass":if(G.phase==="play"&&G.turn===v&&G.trick)pass(v);break;
    case "next":startRound();break;
    case "coup":{if(v==null||!coupAllowed(v))return;const q=quads(v).find(q=>q[0].r===+b.dataset.r);if(q)coup(v,q);break}
    case "coupdlg":G.coupDlg={who:null};render();break;
    case "coupwho":G.coupDlg={who:+b.dataset.i};render();break;
    case "coupcancel":G.coupDlg=null;render();break;
    case "reveal":G.viewer=neededViewer();render();break;
  }
}
$("pActions").onclick=onAct;$("pDialog").onclick=onAct;
})();
