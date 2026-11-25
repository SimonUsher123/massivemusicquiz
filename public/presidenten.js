// Presidenten: het scherm. De spelregels staan in presidenten-engine.js.
// Twee manieren van spelen:
//  - op dit apparaat: het spel draait hier in de browser (mensen geven het apparaat door, computers vullen aan);
//  - online: het spel draait op de server (worker/index.js); elk apparaat krijgt alleen zijn eigen kaarten.
// In beide gevallen tekent dit bestand een "view" van het spel (zie view() in de engine).
import * as E from "./presidenten-engine.js";
const {rn,rnPlural,cn,T,AVATARS,BOT_NAMES,STYLES,evalSet,isQuad}=E;

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const TCLASS={President:"pres",Vicepresident:"vp",Burger:"burger","Vice-feut":"vf",Feut:"feut"};
const FLY=matchMedia("(prefers-reduced-motion: reduce)").matches?0:T.fly;
const CODE_CHARS="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
const joinCode=(new URLSearchParams(location.search).get("spel")||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
let startTab="quiz";try{startTab=localStorage.getItem("bq_tab")||"quiz"}catch(e){}
tab(joinCode?"pres":startTab);

// ---------- Instellingen ----------
let cfg=loadCfg();
function loadCfg(){
  let c=null;try{c=JSON.parse(localStorage.getItem("pres_cfg"))}catch(e){}
  if(!(c&&c.n>=4&&c.n<=7&&Array.isArray(c.seats)&&c.seats.length===7))
    c={n:4,sortDesc:false,seats:[{name:"Jij",human:true},...BOT_NAMES.slice(0,6).map(name=>({name,human:false}))]};
  if(typeof c.myName!=="string")c.myName="";
  if(!STYLES[c.style])c.style="normal";
  return c;
}
function saveCfg(){try{localStorage.setItem("pres_cfg",JSON.stringify(cfg))}catch(e){}}
function token(){
  // sessionStorage gaat voor, zodat je om te testen in een tweede tabblad een andere speler kunt zijn
  try{let t=sessionStorage.getItem("pres_token")||localStorage.getItem("pres_token");
    if(!t){t=Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(36).padStart(2,"0")).join("").slice(0,20);localStorage.setItem("pres_token",t)}
    return t}catch(e){return "anon"+Math.random().toString(36).slice(2,12)}
}
function renderSetup(){
  $("pCount").innerHTML=[4,5,6,7].map(n=>`<button type="button" class="seg${cfg.n===n?" on":""}" data-n="${n}" aria-pressed="${cfg.n===n}">${n}</button>`).join("");
  $("pSeatCfg").innerHTML=cfg.seats.slice(0,cfg.n).map((s,i)=>`<div class="seatcfg">
    <span class="mini-ava" aria-hidden="true">${AVATARS[i]}</span>
    <input type="text" value="${esc(s.name)}" data-i="${i}" maxlength="14" aria-label="Naam speler ${i+1}">
    <div class="toggle" role="group" aria-label="Soort speler ${i+1}">
      <button type="button" data-i="${i}" data-h="1" class="${s.human?"on":""}" aria-pressed="${s.human}">Mens</button>
      <button type="button" data-i="${i}" data-h="0" class="${s.human?"":"on"}" aria-pressed="${!s.human}">Computer</button></div></div>`).join("");
  $("pMyName").value=cfg.myName;
  $("pStyle").innerHTML=styleSeg(cfg.style,"style");
}
const styleSeg=(cur,attr)=>Object.entries(STYLES).map(([k,v])=>`<button type="button" class="seg${cur===k?" on":""}" data-${attr}="${k}" aria-pressed="${cur===k}">${v.label}</button>`).join("");
$("pStyle").onclick=e=>{const b=e.target.closest("[data-style]");if(!b)return;cfg.style=b.dataset.style;saveCfg();renderSetup()};
$("pCount").onclick=e=>{const b=e.target.closest("[data-n]");if(!b)return;cfg.n=+b.dataset.n;saveCfg();renderSetup()};
$("pSeatCfg").onclick=e=>{const b=e.target.closest("[data-h]");if(!b)return;cfg.seats[+b.dataset.i].human=b.dataset.h==="1";saveCfg();renderSetup()};
$("pSeatCfg").oninput=e=>{const i=e.target.dataset.i;if(i!=null){cfg.seats[+i].name=e.target.value;saveCfg()}};
$("pMyName").oninput=e=>{cfg.myName=e.target.value.trim().slice(0,14);saveCfg()};
$("pStart").onclick=startLocal;
$("pCreate").onclick=()=>{
  if(!cfg.myName){$("pMyName").focus();toast("Vul eerst je naam in.");return}
  connect(newCode(),true);
};
$("pQuit").onclick=()=>{
  if(S&&S.mode==="online"){
    if(S.host){if(confirm("Het spel stoppen voor iedereen? Jullie gaan terug naar de wachtruimte."))wsSend({t:"end"})}
    else if(confirm("Het spel verlaten? Met dezelfde link kom je later terug op je plek."))leaveOnline();
    return;
  }
  if(!confirm("Dit spel stoppen?"))return;
  stopLocal();showPanel("setup");
};
renderSetup();

// ---------- Sessie ----------
// S: {mode:"local",G,base,viewer,timer} of {mode:"online",code,ws,V,lobby,host,online,botified,...}
let S=null;
const ui={sel:new Set(),selFor:null,coupWho:undefined,lastSeq:null,anim:null,handRects:null,pop:new Set(),V:null,says:{},chatSeen:null,sayT:null};
function resetUi(){ui.sel.clear();ui.selFor=null;ui.coupWho=undefined;ui.lastSeq=null;ui.anim=null;ui.handRects=null;ui.pop.clear();ui.V=null;ui.says={};ui.chatSeen=null;renderChat()}
// ballonnetje boven een poppetje (chat, muiten, wolkje); verdwijnt vanzelf
function sayAt(i,text,cloud){ui.says[i]={text,cloud,until:Date.now()+(cloud?6000:5000)};
  clearTimeout(ui.sayT);ui.sayT=setTimeout(update,(cloud?6000:5000)+50)}
function showPanel(w){$("pSetup").hidden=w!=="setup";$("pLobby").hidden=w!=="lobby";$("pGame").hidden=w!=="game";if(w!=="game")$("pOverlay").hidden=true;
  // de chat verhuist mee naar de wachtruimte of de tafel (zelfde element, zodat half getypte tekst blijft staan)
  (w==="lobby"?$("pLobby"):$("pGame")).appendChild($("pChat"));renderChat()}
let toastT=null;
function toast(msg,sticky){const t=$("pToast");t.textContent=msg;t.hidden=!msg;clearTimeout(toastT);if(msg&&!sticky)toastT=setTimeout(()=>t.hidden=true,3500)}

// ---------- Op dit apparaat ----------
function startLocal(){
  stopLocal();if(S&&S.mode==="online")leaveOnline();
  const seats=cfg.seats.slice(0,cfg.n).map((s,i)=>({name:s.name.trim()||`Speler ${i+1}`,human:s.human,avatar:AVATARS[i],style:E.styleValue(cfg.style)}));
  const G=E.newGame(seats,Date.now()),H=E.humans(G);
  S={mode:"local",G,base:H.length?H[0]:0,viewer:null,timer:null};
  resetUi();showPanel("game");update();
}
function stopLocal(){if(S&&S.mode==="local"){clearTimeout(S.timer);S=null}}
function localTimer(){
  clearTimeout(S.timer);const nd=E.nextDue(S.G);
  if(nd!=null)S.timer=setTimeout(()=>{if(S&&S.mode==="local"){E.tick(S.G,Date.now());update()}},Math.max(0,nd-Date.now())+5);
}
// Wiens kaarten mogen zichtbaar zijn? Bij één mens altijd die; bij meer mensen alleen wie nu iets moet doen.
function localView(){
  const G=S.G,H=E.humans(G);let need=null;
  if(H.length===1)need=H[0];
  else if(H.length>1){
    if(typeof ui.coupWho==="number")need=ui.coupWho;
    else if(G.phase==="play"&&E.myTurn(G,G.turn)&&G.players[G.turn].human&&!E.autoActs(G,G.turn))need=G.turn;
    else if(G.phase==="exchange"&&G.exQueue[0]&&G.players[G.exQueue[0].from].human)need=G.exQueue[0].from;
  }
  if(H.length<=1)S.viewer=need;
  const v=need!=null&&S.viewer===need?need:null;
  return {V:E.view(G,v),cover:H.length>1&&need!=null&&S.viewer!==need?need:null};
}
function update(){
  if(!S)return;
  if(S.mode==="local"){const {V,cover}=localView();render(V,cover);localTimer()}
  else if(S.V)render(S.V,null);
}
// een actie van wie nu kijkt
function send(a){
  if(!S||!ui.V||ui.V.me==null)return;
  if(S.mode==="local"){const err=E.act(S.G,ui.V.me,a,Date.now());if(err)toast(err);update()}
  else wsSend({t:"act",a});
}

// ---------- Online ----------
function newCode(){return Array.from(crypto.getRandomValues(new Uint8Array(4)),b=>CODE_CHARS[b%CODE_CHARS.length]).join("")}
const shareUrl=code=>`${location.origin}${location.pathname}?spel=${code}`;
function connect(code,create){
  stopLocal();if(S&&S.mode==="online")leaveOnline(null,true);
  S={mode:"online",code,create,ws:null,V:null,lobby:null,host:false,online:[],botified:[],retry:0,closed:false,ping:null};
  resetUi();
  history.replaceState(null,"",`?spel=${code}`);
  showPanel("lobby");$("lobbyMain").innerHTML=`<h2>Verbinden…</h2>`;
  openWs();
}
function openWs(){
  const s=S;
  const ws=new WebSocket(`${location.protocol==="https:"?"wss":"ws"}://${location.host}/ws/${s.code}`);
  s.ws=ws;
  ws.onopen=()=>{
    s.retry=0;toast("");
    ws.send(JSON.stringify({t:"hello",token:token(),name:cfg.myName,create:s.create}));
    clearInterval(s.ping);s.ping=setInterval(()=>{if(ws.readyState===1)ws.send("ping")},25000);
  };
  ws.onmessage=e=>{
    if(S!==s||e.data==="pong")return;
    let m;try{m=JSON.parse(e.data)}catch(x){return}
    if(m.t==="err"){
      if(m.code==="exists"&&s.create){s.code=newCode();history.replaceState(null,"",`?spel=${s.code}`);s.ws.onclose=null;s.ws.close();openWs();return}
      if(m.fatal){leaveOnline(m.msg);return}
      toast(m.msg);return;
    }
    s.create=false;s.host=m.host;s.hostName=m.hostName;s.humans=m.humans||1;s.chat=m.chat||[];
    chatArrived();
    if(m.t==="lobby"){s.lobby=m;s.V=null;ui.lastSeq=null;ui.sel.clear();showPanel("lobby");renderLobby()}
    else if(m.t==="state"){s.V=m.v;s.online=m.online||[];s.botified=m.botified||[];if($("pGame").hidden){showPanel("game");ui.lastSeq=null}update()}
  };
  ws.onclose=()=>{
    clearInterval(s.ping);
    if(S!==s||s.closed||s.ws!==ws)return;
    toast("Verbinding weg, opnieuw verbinden…",true);
    setTimeout(()=>{if(S===s&&!s.closed)openWs()},Math.min(8000,600*2**s.retry++));
  };
}
function wsSend(m){if(S&&S.mode==="online"&&S.ws&&S.ws.readyState===1)S.ws.send(JSON.stringify(m));else toast("Geen verbinding.")}
function leaveOnline(msg,quiet){
  if(S&&S.mode==="online"){S.closed=true;clearInterval(S.ping);try{S.ws.close()}catch(e){}}
  S=null;resetUi();
  history.replaceState(null,"",location.pathname);
  if(!quiet){showPanel("setup");renderSetup();if(msg)toast(msg)}
}
function renderLobby(){
  const L=S.lobby,url=shareUrl(L.code);
  const seats=L.seats.map((s,i)=>`<li><span class="mini-ava" aria-hidden="true">${AVATARS[i]}</span>
      <b>${esc(s.name)}</b>${s.you?' <span class="badge">jij</span>':""}${s.host?' <span class="badge">host</span>':""}
      ${s.online?"":'<span class="badge off">weg</span>'}</li>`).join("");
  const n=Math.max(4,L.n,L.seats.length),bots=Math.max(0,n-L.seats.length);
  const counts=[4,5,6,7].filter(k=>k>=L.seats.length).map(k=>`<button type="button" class="seg${n===k?" on":""}" data-l="n" data-n="${k}" aria-pressed="${n===k}">${k}</button>`).join("");
  $("lobbyMain").innerHTML=`<h2>Online spel <span class="code">${esc(L.code)}</span></h2>
    <div class="share"><input type="text" readonly value="${esc(url)}" aria-label="Link naar dit spel"><button type="button" data-l="share">Deel link</button></div>
    <label class="opt">Jouw naam <input type="text" id="lobbyName" maxlength="14" value="${esc(cfg.myName)}"></label>
    <ol class="lplayers">${seats}${bots?`<li class="bots">+ ${bots} computer${bots>1?"s":""}</li>`:""}</ol>
    ${L.host?`<div class="field"><span class="lbl">Aantal spelers</span><div class="seg-row">${counts}</div></div>
      <div class="field"><span class="lbl">Computers spelen</span><div class="seg-row wrap">${styleSeg(L.style,"lstyle")}</div></div>
      <button type="button" data-l="start">Start spel</button>`
      :`<p class="tag">Computers spelen: ${esc((STYLES[L.style]||STYLES.normal).label.toLowerCase())}. Wachten tot ${esc(L.hostName||"de host")} het spel start…</p>`}
    <button type="button" class="ghost" data-l="leave">Verlaten</button>`;
}
$("pLobby").onclick=async e=>{
  const st=e.target.closest("[data-lstyle]");if(st){wsSend({t:"style",style:st.dataset.lstyle});return}
  const b=e.target.closest("[data-l]");if(!b||!S||S.mode!=="online")return;
  const url=shareUrl(S.code);
  switch(b.dataset.l){
    case "share":
      if(navigator.share){try{await navigator.share({title:"Presidenten",text:"Speel mee met Presidenten",url});return}catch(x){}}
      try{await navigator.clipboard.writeText(url);toast("Link gekopieerd.")}catch(x){toast(url,true)}
      break;
    case "n":wsSend({t:"setN",n:+b.dataset.n});break;
    case "start":wsSend({t:"start"});break;
    case "leave":wsSend({t:"leave"});leaveOnline();break;
  }
};
$("pLobby").addEventListener("change",e=>{
  if(e.target.id!=="lobbyName")return;
  cfg.myName=e.target.value.trim().slice(0,14);saveCfg();
  if(cfg.myName)wsSend({t:"name",name:cfg.myName});
});
// meedoen via een link: eerst je naam, dan de wachtruimte
function askNameAndJoin(code){
  showPanel("lobby");
  $("lobbyMain").innerHTML=`<h2>Meedoen met spel <span class="code">${esc(code)}</span></h2>
    <label class="opt">Jouw naam <input type="text" id="joinName" maxlength="14" value="${esc(cfg.myName)}" autocomplete="nickname"></label>
    <button type="button" id="joinGo">Meedoen</button>
    <button type="button" class="ghost" id="joinCancel">Annuleren</button>`;
  const go=()=>{const n=$("joinName").value.trim().slice(0,14);if(!n){$("joinName").focus();return}
    cfg.myName=n;saveCfg();connect(code,false)};
  $("joinGo").onclick=go;$("joinName").onkeydown=e=>{if(e.key==="Enter")go()};
  $("joinCancel").onclick=()=>{history.replaceState(null,"",location.pathname);showPanel("setup")};
}

// ---------- Chat (online, als er meer dan één mens meedoet) ----------
function chatOn(){return !!(S&&S.mode==="online"&&S.humans>1)}
function chatArrived(){
  const list=S.chat||[],last=list.length?list[list.length-1].id:0;
  if(ui.chatSeen!=null)list.filter(c=>c.id>ui.chatSeen&&c.i!=null).forEach(c=>sayAt(c.i,c.text));
  ui.chatSeen=last;renderChat();
}
function renderChat(){
  const box=$("pChat");box.hidden=!chatOn();if(box.hidden)return;
  const list=$("chatList"),atEnd=list.scrollHeight-list.scrollTop-list.clientHeight<30;
  list.innerHTML=(S.chat||[]).map(c=>`<div><b>${esc(c.name)}</b> ${esc(c.text)}</div>`).join("")||'<div class="tag">Nog geen berichten.</div>';
  if(atEnd)list.scrollTop=list.scrollHeight;
}
$("chatForm").onsubmit=e=>{e.preventDefault();const t=$("chatText").value.trim();if(!t)return;wsSend({t:"chat",text:t});$("chatText").value=""};

// ---------- Weergave ----------
const myTurnV=(V,i)=>V.phase==="play"&&!V.hold&&V.turn===i;
function autoActsV(V,i){const p=V.players[i];
  return !!p&&p.human&&myTurnV(V,i)&&p.autoPass>0&&!!V.trick&&V.trick.value>p.autoPass}
function canPlayV(V,i,cards){
  if(!myTurnV(V,i))return false;
  if(isQuad(cards)&&V.canCoup)return true;
  const ev=evalSet(cards);if(!ev)return false;
  return !V.trick||(ev.count===V.trick.count&&ev.value>V.trick.value);
}
const handOf=(V,i)=>i==null?[]:V.players[i].hand||[];
const selCards=V=>handOf(V,V.me).filter(c=>ui.sel.has(c.id));
const humansV=V=>V.players.map((p,i)=>p.human?i:-1).filter(i=>i>=0);
function cardHTML(c,o={}){
  if(c.back)return `<span class="card back${o.mini?" mini":""}" aria-hidden="true"></span>`;
  const cls=`card${c.j?" joker":c.s==="♥"||c.s==="♦"?" red":""}${o.sel?" sel":""}${o.btn&&c.fresh?" fresh":""}${o.hid?" hid":""}${o.mini?" mini":""}`;
  const inner=c.j?`<b>★</b><i>${o.as?`als ${rn(o.as)}`:"JOKER"}</i>`:`<b>${rn(c.r)}</b><i>${c.s}</i>`;
  const label=cn(c)+(c.j&&o.as?` als ${rn(o.as)}`:"");
  return o.btn?`<button type="button" class="${cls}"${o.fan?` style="${o.fan}"`:""} data-id="${c.id}" aria-pressed="${!!o.sel}" ${o.lock?"disabled":""} aria-label="${label}${c.fresh?" (nieuw)":""}">${inner}</button>`
              :`<span class="${cls}" role="img" aria-label="${label}">${inner}</span>`;
}
const titleTag=t=>t?`<span class="stitle t-${TCLASS[t]}">${t}</span>`:"";
// kaart j van de bovenste zet is nog onderweg (de vliegende kopie staat er dan al voor)
const flying=j=>{const a=ui.anim;return !!(a&&a.t0&&!a.landed.has(j)&&Date.now()<a.t0+j*90+FLY+200)};

function render(V,cover){
  ui.V=V;
  const v=V.me;
  if(ui.selFor!==v){ui.sel.clear();ui.selFor=v}
  const ids=new Set(handOf(V,v).map(c=>c.id));[...ui.sel].forEach(id=>{if(!ids.has(id))ui.sel.delete(id)});
  // nieuwe gebeurtenissen sinds de vorige keer: die laten we zien (vliegende kaarten, pas-ballonnetje)
  let fresh=[];
  if(ui.lastSeq==null)ui.lastSeq=V.seq;
  else if(V.seq>ui.lastSeq){fresh=V.ev.filter(e=>e.seq>ui.lastSeq);ui.lastSeq=V.seq}
  fresh.filter(e=>e.k==="pass").forEach(e=>ui.pop.add(e.by));
  fresh.filter(e=>e.k==="say").forEach(e=>sayAt(e.by,e.text,e.cloud));
  const lastPlay=[...fresh].reverse().find(e=>e.k==="play"||e.k==="coup");
  const swaps=fresh.filter(e=>e.k==="swap");
  if(lastPlay)ui.anim={kind:"play",by:lastPlay.by,cards:lastPlay.cards,fromRects:lastPlay.by===v?ui.handRects:null};
  if(lastPlay&&lastPlay.by===v)ui.handRects=null;

  $("pRound").textContent=`Ronde ${V.round}${S&&S.mode==="online"?` · spel ${S.code}`:""}`;
  renderSwap(V,v);
  renderSeats(V);renderFelt(V);renderTurn(V,v);renderHand(V,v);renderActions(V,v);renderOpts(V,v);
  $("pLog").innerHTML=V.log.map(t=>`<div>${esc(t)}</div>`).join("");
  renderOverlay(V,cover);
  ui.pop.clear();
  if(lastPlay)flyPlay(V);
  swaps.forEach(e=>flySwap(e,v));
}
function base(V){return S&&S.mode==="local"?S.base:(V.me!=null?V.me:0)}
function seatAngle(V,i){const k=(i-base(V)+V.n)%V.n;return (90+k*360/V.n)*Math.PI/180}   // k=0 onderaan, daarna met de klok mee
function renderSeats(V){
  const online=S&&S.mode==="online";
  $("pSeats").innerHTML=V.players.map((p,i)=>{
    const a=seatAngle(V,i),rx=innerWidth<640?37:45;   // op de telefoon iets naar binnen, anders vallen de zijkanten weg
    const x=50+rx*Math.cos(a),y=50+42*Math.sin(a),turn=myTurnV(V,i);
    const gone=online&&S.online[i]===false;
    const status=p.out&&V.phase!=="roundEnd"?`<span class="bubble out">${outTitle(V,i)}</span>`
      :V.phase==="play"&&p.passed?`<span class="bubble pas${ui.pop.has(i)?" pop":""}">pas</span>`
      :gone?'<span class="bubble off">weg</span>':"";
    // open kaarten liggen naast elkaar op tafel, voor de speler richting het midden
    const open=p.open&&!p.out&&p.hand?`<div class="openhand" style="--ox:${(-Math.cos(a)*90).toFixed(0)}px;--oy:${(-Math.sin(a)*78).toFixed(0)}px">${p.hand.map(c=>cardHTML(c,{mini:true})).join("")}</div>`:"";
    // dichte kaarten in de hand van het poppetje (max 7 getekend)
    const m=Math.min(p.count,7);
    const fan=!p.open&&m?`<span class="mfan" aria-hidden="true">${Array.from({length:m},(_,k)=>`<i style="--r:${(k-(m-1)/2)*11}deg"></i>`).join("")}</span>`:"";
    const take=online&&S.host&&gone&&!S.botified[i]?`<button type="button" class="ghost mini takeover" data-botify="${i}">Computer neemt over</button>`:"";
    const bot=!p.human?' <span class="bot" aria-label="computer">🤖</span>':"";
    const sy=ui.says[i]&&ui.says[i].until>Date.now()?ui.says[i]:null;
    const say=sy?`<div class="say${sy.cloud?" cloud":""}" role="status">${esc(sy.text)}</div>`:"";
    const muit=p.autoPass&&!p.out&&V.phase==="play"?`<span class="muit">autopas &gt; ${rn(p.autoPass)}</span>`:"";
    const passed=V.phase==="play"&&p.passed&&!p.out;
    return `<div class="seat${turn?" turn":""}${p.out&&V.phase==="play"?" out":""}${passed?" passed":""}${gone?" gone":""}" data-seat="${i}" style="left:${x}%;top:${y}%">
      ${say}<div class="ava">${p.avatar}${fan}${p.title==="President"?'<span class="crown" aria-hidden="true">👑</span>':""}${status}</div>
      <div class="nm">${esc(p.name)}${bot}${p.pres?` <span class="crowns">👑${p.pres}</span>`:""}</div>
      ${titleTag(p.title)}${muit}${open}${take}</div>`}).join("");
}
// wie al uit is, ziet de titel die hij gaat krijgen
function outTitle(V,i){const k=V.finish.indexOf(i),n=V.n;
  return k===0?"President":k===1?"Vicepresident":k===n-1?"Feut":k===n-2?"Vice-feut":"Burger"}
// ruil-overzicht (weg/erbij) in de hoek van de tafel, zodat de rest van het scherm niet verspringt
function renderSwap(V,v){
  const sum=V.exSum,p=v!=null?V.players[v]:null;
  $("pSwap").innerHTML=sum&&p&&V.phase==="play"&&!p.acted?`<span>Weg</span>${sum.gave.map(c=>cardHTML(c,{mini:true})).join("")}<span>Erbij</span>${sum.got.map(c=>cardHTML(c,{mini:true})).join("")}`:"";
}
function renderFelt(V){
  const P=V.players;let pile="",msg="";
  if(V.phase==="roundEnd"){
    if(V.coupBy!=null){
      const order=["President","Feut","Burger"],ids=P.map((p,i)=>i).sort((a,b)=>order.indexOf(P[a].title)-order.indexOf(P[b].title));
      pile=`<div class="play top" style="--dy:0px;--sc:1;--op:1;--rot:0deg">${V.coupShow.cards.map((c,j)=>cardHTML(c,{hid:flying(j)})).join("")}</div>`;
      msg=`<div class="coupban">STAATSGREEP!</div><div class="result">${ids.map(i=>`<div><b>${esc(P[i].name)}</b> ${titleTag(P[i].title)}</div>`).join("")}</div>`;
    }else msg=`<div class="result"><div class="rh">Ronde ${V.round} klaar</div>${V.finish.map((i,n)=>`<div><span class="pos">${n+1}</span> <b>${esc(P[i].name)}</b> ${titleTag(P[i].title)}</div>`).join("")}</div>`;
  }else{
    const show=V.pile.slice(-4),last=show.length-1;
    pile=show.map((pl,k)=>{const d=last-k,top=d===0;
      const rot=((pl.by*37+pl.cards[0].id*13)%17)-8;
      return `<div class="play${top?" top":""}${V.pileWinner!=null?" won":""}" style="--dy:${-d*16}px;--sc:${1-d*.1};--op:${top?1:.55-d*.12};--rot:${rot}deg;z-index:${k+1}">
        ${pl.cards.map((c,j)=>cardHTML(c,{as:c.j?pl.value:0,hid:top&&flying(j)})).join("")}</div>`}).join("");
    if(V.phase==="exchange")msg=`<div class="tmsg">Er wordt geruild</div>`;
    else if(V.hold==="pass")msg=`<div class="tmsg">Iedereen past</div>`;
    else if(V.pileWinner!=null)msg=`<div class="tmsg">Slag voor ${esc(P[V.pileWinner].name)}</div>`;
    else if(V.pile.length){const t=V.pile[V.pile.length-1];msg=`<div class="tmsg">${esc(P[t.by].name)}</div>`}
  }
  $("pPile").innerHTML=pile;$("pMsg").innerHTML=msg;
}
function renderTurn(V,v){
  const P=V.players;let h="",cls="turnbar";
  if(V.phase==="play"&&!V.hold){
    if(v!=null&&V.turn===v){h=autoActsV(V,v)?"Automatisch passen…":"Jij bent aan de beurt";cls+=" me"}
    else h=`${esc(P[V.turn].name)} is aan de beurt`;
  }else if(V.phase==="exchange"){
    const e=V.ex;
    if(e&&v===e.from){h=e.up?`Geef je ${e.k>1?`${e.k} hoogste kaarten`:"hoogste kaart"} aan ${esc(P[e.to].name)}`:`Kies ${e.k>1?`${e.k} kaarten`:"1 kaart"} voor ${esc(P[e.to].name)}`;cls+=" me"}
    else if(e)h=`${esc(P[e.from].name)} ruilt met ${esc(P[e.to].name)}`;
  }else if(V.hold)h=`Slag voor ${esc(P[V.lastBy].name)}`;
  $("pTurn").className=cls;$("pTurn").innerHTML=h;
}
// waaier: kaarten overlappen, draaien naar buiten en zakken aan de randen iets weg
function fanPos(k,n){
  const w=Math.max(260,($("pHand").clientWidth||600)-24),cw=innerWidth<640?44:58;
  const step=n>1?Math.min(cw*.78,(w-cw*1.4)/(n-1)):0,o=k-(n-1)/2,ang=Math.min(3.5,36/n);
  return `--x:${(o*step).toFixed(1)}px;--y:${(o*o*ang*.22).toFixed(1)}px;--rot:${(o*ang).toFixed(2)}deg;z-index:${k+1}`;
}
function renderHand(V,v){
  if(v==null){
    $("pHand").innerHTML=`<p class="tag handmsg">${humansV(V).length?"Kaarten zijn verborgen tot er een mens aan zet is.":"Alleen computers aan tafel: kijk mee."}</p>`;return}
  const p=V.players[v],hand=handOf(V,v),e=V.ex;
  const lock=V.phase==="exchange"&&e&&e.up&&e.from===v&&e.forced?new Set(e.forced):null;
  const list=cfg.sortDesc?[...hand].reverse():hand;
  $("pHand").innerHTML=`<div class="cards${p.open?"":" fan"}">${list.map((c,k)=>cardHTML(c,{btn:true,sel:lock?lock.has(c.id):ui.sel.has(c.id),lock:!!lock,fan:p.open?null:fanPos(k,list.length)})).join("")}</div>
    <div class="handfoot">${hand.length?`<button type="button" class="ghost mini" data-act="sort" aria-label="Sorteervolgorde wisselen">${cfg.sortDesc?"Hoog → laag":"Laag → hoog"}</button>`:""}</div>`;
}
function renderActions(V,v){
  const P=V.players,A=[],local=S&&S.mode==="local";
  const btn=(act,label,extra="")=>`<button type="button" data-act="${act}" ${extra}>${label}</button>`;
  const coupBtns=()=>V.quads.forEach(r=>A.push(btn("coup",`Staatsgreep: vier ${rnPlural(r)}`,`class="hot" data-r="${r}"`)));
  if(local&&typeof ui.coupWho==="number"&&v===ui.coupWho){
    if(!V.quads.length||!V.canCoup)A.push(`<span class="tag">${V.canCoup?"Geen vier gelijke kaarten":"Te laat"}</span>`);
    if(V.canCoup)coupBtns();
    A.push(btn("coupcancel","Terug",'class="ghost"'));
  }else{
    if(V.phase==="exchange"){
      const e=V.ex;
      if(e&&v===e.from)A.push(btn("give",`Ruilen met ${esc(P[e.to].name)}`,e.up||ui.sel.size===e.k?"":"disabled"));
    }else if(V.phase==="play"&&v!=null&&myTurnV(V,v)&&!autoActsV(V,v)){
      const sel=selCards(V),ok=canPlayV(V,v,sel),cp=isQuad(sel)&&V.canCoup;
      A.push(btn("play",cp?"Staatsgreep!":"Spelen",(cp?'class="hot" ':"")+(ok?"":"disabled")));
      A.push(btn("pass","Passen",`class="ghost"${V.trick?"":" disabled"}`));
    }else if(V.phase==="roundEnd"&&(local||v!=null))A.push(btn("next","Volgende ronde"));
    if(v!=null&&V.canCoup&&!(myTurnV(V,v)&&isQuad(selCards(V))))coupBtns();
    if(local&&humansV(V).length>1&&V.phase==="play"&&ui.coupWho===undefined)A.push(btn("coupdlg","Staatsgreep…",'class="ghost"'));
  }
  $("pActions").innerHTML=A.join("");
}
function renderOpts(V,v){
  const off=v==null||V.phase!=="play"||V.players[v].out;
  $("pOpts").classList.toggle("off",off);   // onzichtbaar maar houdt zijn plek, zodat niets verspringt
  if(off)return;
  const p=V.players[v];
  $("pOpts").innerHTML=`<h3>Muitopties</h3>
    <label class="opt">Automatisch passen boven
      <select data-opt="autopass" aria-label="Automatisch passen boven">
        <option value="0">uit</option>${[2,3,4,5,6,7,8,9,10,11,12,13].map(r=>`<option value="${r}"${p.autoPass===r?" selected":""}>${rn(r)}</option>`).join("")}
      </select></label>
    <button type="button" class="ghost mini${p.open?" on":""}" data-act="open" aria-pressed="${!!p.open}">${p.open?"Open spelen: aan":"Open spelen"}</button>
    <button type="button" class="ghost mini" data-act="shout">☁️ Lijndansvereniging</button>`;
}
function renderOverlay(V,coverFor){
  const o=$("pOverlay"),P=V.players;
  if(coverFor!=null){
    const why=ui.coupWho===coverFor?"wil een staatsgreep plegen":V.phase==="exchange"?"moet ruilen":"is aan de beurt";
    $("pDialog").innerHTML=`<p class="tag">Geef het apparaat aan</p><div class="bigava" aria-hidden="true">${P[coverFor].avatar}</div><h2 class="big">${esc(P[coverFor].name)}</h2><p class="tag">${why}</p>
      <button type="button" data-act="reveal" data-i="${coverFor}">Ik ben ${esc(P[coverFor].name)}: toon mijn kaarten</button>`;
    o.hidden=false;return;
  }
  if(S&&S.mode==="local"&&ui.coupWho===null){
    const H=E.humans(S.G).filter(i=>E.coupAllowed(S.G,i));
    $("pDialog").innerHTML=`<h2>Wie pleegt de staatsgreep?</h2>
      <div class="btns">${H.map(i=>`<button type="button" data-act="coupwho" data-i="${i}">${P[i].avatar} ${esc(P[i].name)}</button>`).join("")||'<p class="tag">Niemand kan nu een staatsgreep plegen.</p>'}</div>
      <button type="button" class="ghost" data-act="coupcancel">Annuleren</button>`;
    o.hidden=false;return;
  }
  o.hidden=true;
}

// ---------- Kaarten laten vliegen ----------
function center(el){const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}}
const seatEl=i=>document.querySelector(`#pSeats [data-seat="${i}"] .ava`);
function flyPlay(V){
  const a=ui.anim;if(!a||!FLY)return;
  // een vorige vlucht die nog niet klaar is: meteen laten landen, zodat er nooit iets blijft hangen
  document.querySelectorAll(".flyer.play-fly").forEach(f=>f.remove());
  const from=seatEl(a.by),top=document.querySelector("#pPile .play.top");
  const targets=top?[...top.querySelectorAll(".card")]:[];
  if(!from||!targets.length)return;
  const rot=parseFloat(getComputedStyle(top).getPropertyValue("--rot"))||0;
  a.t0=Date.now();a.landed=new Set();
  targets.forEach(t=>t.classList.add("hid"));
  const s=center(from);
  targets.forEach((t,j)=>{
    // de kopie landt precies zoals de echte kaart ligt: zelfde maat, zelfde draai
    const c=center(t),w=t.offsetWidth,h=t.offsetHeight,cl=t.cloneNode(true);
    cl.classList.remove("hid");cl.classList.add("flyer","play-fly");
    Object.assign(cl.style,{left:(c.x-w/2)+"px",top:(c.y-h/2)+"px",width:w+"px",height:h+"px"});
    document.body.appendChild(cl);
    // eigen kaarten vliegen vanuit je hand, die van anderen vanaf hun poppetje
    const src=a.fromRects&&a.cards[j]&&a.fromRects[a.cards[j].id];
    const sx=src?src.x:s.x,sy=src?src.y:s.y,sc=src?src.w/w:.35,sr=src?0:-25;
    cl.animate([{transform:`translate(${sx-c.x}px,${sy-c.y}px) scale(${sc}) rotate(${sr}deg)`},{transform:`rotate(${rot}deg)`}],
      {duration:FLY,delay:j*90,easing:"cubic-bezier(.2,.7,.2,1)",fill:"both"}).onfinish=()=>{
        a.landed.add(j);
        const cur=document.querySelectorAll("#pPile .play.top .card")[j];
        if(cur)cur.classList.remove("hid");
        cl.remove();
      };
  });
  // vangnet als een animatie niet afloopt (bijv. tabblad op de achtergrond)
  setTimeout(()=>{if(ui.anim===a){targets.forEach((t,j)=>a.landed.add(j));document.querySelectorAll("#pPile .hid").forEach(e=>e.classList.remove("hid"))}},FLY+targets.length*90+400);
}
function flySwap(e,v){
  if(!FLY)return;
  const f=seatEl(e.from),t=seatEl(e.to);if(!f||!t)return;
  const s=center(f),d=center(t),faceUp=v===e.from||v===e.to;
  e.cards.forEach((c,j)=>{
    const tmp=document.createElement("div");
    tmp.innerHTML=faceUp&&!c.back?cardHTML(c):'<span class="card back" aria-hidden="true"></span>';
    const el=tmp.firstChild;el.classList.add("flyer");
    Object.assign(el.style,{left:(s.x-29)+"px",top:(s.y-42)+"px"});
    document.body.appendChild(el);
    el.animate([{transform:"scale(.5)",opacity:0},{transform:"scale(1)",opacity:1,offset:.25},{transform:`translate(${d.x-s.x}px,${d.y-s.y}px) scale(.6)`,opacity:.9}],
      {duration:FLY*1.4,delay:j*140,easing:"ease-in-out",fill:"both"}).onfinish=()=>el.remove();
  });
}

// ---------- Invoer ----------
$("pHand").onclick=e=>{
  const s=e.target.closest('[data-act="sort"]');
  if(s){cfg.sortDesc=!cfg.sortDesc;saveCfg();update();return}
  const b=e.target.closest("[data-id]");const V=ui.V;
  if(!b||b.disabled||!V||V.me==null||V.phase==="roundEnd")return;
  const id=+b.dataset.id;ui.sel.has(id)?ui.sel.delete(id):ui.sel.add(id);update();
};
// waar je eigen kaarten in je hand zaten, zodat ze vanaf daar de tafel op vliegen
function grabHand(cards){
  ui.handRects={};
  cards.forEach(c=>{const el=document.querySelector(`#pHand [data-id="${c.id}"]`);
    if(el){const r=el.getBoundingClientRect();ui.handRects[c.id]={x:r.left+r.width/2,y:r.top+r.height/2,w:r.width}}});
}
function onAct(e){
  const bt=e.target.closest("[data-botify]");
  if(bt){wsSend({t:"botify",i:+bt.dataset.botify,on:true});return}
  const b=e.target.closest("[data-act]");const V=ui.V;if(!b||b.disabled||!V)return;
  const v=V.me;
  switch(b.dataset.act){
    case "give":{const h=V.ex;if(!h||v!==h.from)return;
      const ids=h.up?h.forced||[]:selCards(V).map(c=>c.id);if(ids.length!==h.k)return;
      ui.sel.clear();send({type:"give",ids});break}
    case "play":{const c=selCards(V);if(!canPlayV(V,v,c))return;grabHand(c);ui.sel.clear();send({type:"play",ids:c.map(x=>x.id)});break}
    case "pass":if(myTurnV(V,v)&&V.trick){ui.sel.clear();send({type:"pass"})}break;
    case "next":send({type:"next"});break;
    case "coup":{const r=+b.dataset.r;grabHand(handOf(V,v).filter(c=>!c.j&&c.r===r).slice(0,4));ui.sel.clear();ui.coupWho=undefined;send({type:"coup",r});break}
    case "shout":send({type:"shout"});break;
    case "coupdlg":ui.coupWho=null;update();break;
    case "coupwho":ui.coupWho=+b.dataset.i;update();break;
    case "coupcancel":ui.coupWho=undefined;update();break;
    case "reveal":if(S&&S.mode==="local"){S.viewer=+b.dataset.i;update()}break;
    case "open":if(v!=null){const p=V.players[v];
      if(!p.open&&!confirm("Open spelen? Iedereen ziet dan je kaarten op tafel. Je speelt ze gewoon zelf."))return;
      send({type:"open",on:!p.open})}break;
  }
}
addEventListener("resize",()=>update());
$("pActions").onclick=onAct;$("pDialog").onclick=onAct;$("pOpts").onclick=onAct;$("pSeats").onclick=onAct;
$("pOpts").onchange=e=>{if(e.target.dataset.opt==="autopass")send({type:"autopass",r:+e.target.value})};

// via een gedeelde link binnengekomen: meteen naar dat spel
if(joinCode){cfg.myName?connect(joinCode,false):askNameAndJoin(joinCode)}
