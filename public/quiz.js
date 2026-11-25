// Beukquiz: het scherm. Alleen (tegen 7 computers, alles in de browser) of online (worker/quiz-room.js:
// iedereen op een eigen apparaat, de server houdt tijd en punten bij). Nakijken en computers: quiz-core.js.
import {PLAY,PAUSE,LEAD,PER_ROUND,BOTS,words,lev,parseSong,check,botPlan,bonusFor,shuffle} from "./quiz-core.js";

const PW_HASH="ff5612d10fa460dc88c28154575727a7e063bd3491c7b59955fc3344ca057aa8";
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const CODE_CHARS="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SILENCE="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

// ---------- Inloggen ----------
async function sha256(t){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function store(k,v){try{v===undefined?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}
function load(k){try{return localStorage.getItem(k)}catch(e){return null}}
function showApp(){$("login").hidden=true;$("app").hidden=false;renderCats();renderBoard()}
$("login").addEventListener("submit",async e=>{
  e.preventDefault();
  if(await sha256($("pw").value)===PW_HASH){store("bq_pw",PW_HASH);showApp()}
  else{$("pwErr").hidden=false;$("pw").select()}
});

// ---------- iTunes-fragmenten (JSONP) ----------
function jsonp(url){return new Promise((res,rej)=>{
  const cb="cb"+Math.random().toString(36).slice(2),s=document.createElement("script");
  const done=()=>{clearTimeout(to);delete window[cb];s.remove()};
  const to=setTimeout(()=>{done();rej(new Error("timeout"))},9000);
  window[cb]=d=>{done();res(d)};s.onerror=()=>{done();rej(new Error("blocked"))};
  s.src=url+"&callback="+cb;document.body.appendChild(s);
})}
async function findPreview(song){
  try{
    const d=await jsonp("https://itunes.apple.com/search?entity=song&limit=10&country=NL&term="+encodeURIComponent(song.q));
    const key=song.artists[0][0][0];
    const hit=(d.results||[]).find(r=>r.previewUrl&&words(r.artistName).some(w=>lev(w,key)<=1));
    return hit?hit.previewUrl:null;
  }catch(e){return null}
}
// 10 werkende fragmenten uit een categorie; progress(n) tijdens het laden
async function loadSongs(k,isStale,progress){
  const out=[],pool=shuffle(CATEGORIES[k].songs).map(parseSong);
  for(let i=0;i<pool.length&&out.length<PER_ROUND;i+=6){
    const batch=pool.slice(i,i+6),urls=await Promise.all(batch.map(findPreview));
    if(isStale())return null;
    batch.forEach((s,j)=>{if(urls[j]&&out.length<PER_ROUND){s.url=urls[j];out.push(s)}});
    progress(out.length);
  }
  return out;
}

// ---------- Spelers (alleen) ----------
const players=[{name:"Jij",me:true,total:0,round:0,cups:[0,0,0],hist:[],prevRank:null}]
  .concat(BOTS.map(([n,s])=>({name:n,skill:s,total:0,round:0,cups:[0,0,0],hist:[],prevRank:null})));
const me=players[0];

// ---------- Categorie en laden ----------
const audio=$("audio");audio.volume=.8;
$("vol").addEventListener("input",e=>audio.volume=+e.target.value);
let catKey=null,order=[],loadToken=0,roundNo=0;

function show(id){["pick","ready","game","end","qLobby","qWait"].forEach(x=>$(x).hidden=x!==id);
  const lobby=id==="qLobby";document.querySelector("#quizView .board").hidden=lobby;
  // de chat verhuist mee (zelfde element, dus half getypte tekst blijft staan)
  if(lobby)$("qLobby").appendChild($("qChat"));else document.querySelector("#quizView .board").appendChild($("qChat"))}
// wachtruimte opnieuw tekenen zonder de chat weg te gooien
function lobbyHTML(h){const c=$("qChat");document.querySelector("#quizView .board").appendChild(c);$("qLobby").innerHTML=h;if(!$("qLobby").hidden)$("qLobby").appendChild(c)}
function renderCats(){
  $("cats").innerHTML=Object.entries(CATEGORIES).map(([k,c])=>`<button class="cat" data-k="${k}"><b>${c.name}</b><span>${c.songs.length} nummers</span></button>`).join("");
  $("cats").querySelectorAll(".cat").forEach(b=>b.onclick=()=>Q?qChoose(b.dataset.k):chooseCategory(b.dataset.k));
}
async function chooseCategory(k){
  catKey=k;const token=++loadToken;
  show("ready");$("readyTitle").textContent=CATEGORIES[k].name;
  $("startBtn").disabled=true;$("loadMsg").className="";$("loadMsg").textContent=`Fragmenten laden… 0 / ${PER_ROUND}`;
  order=await loadSongs(k,()=>token!==loadToken,n=>$("loadMsg").textContent=`Fragmenten laden… ${n} / ${PER_ROUND}`)||[];
  if(token!==loadToken)return;
  if(!order.length){$("loadMsg").className="err";$("loadMsg").textContent="Kon geen fragmenten ophalen. Controleer je internetverbinding en kies opnieuw.";return}
  $("loadMsg").textContent=`${order.length} nummers klaar. Druk op start als je er klaar voor bent.`;
  $("startBtn").disabled=false;
}
$("phoneMode").checked=load("bq_phone")==="1";
$("phoneMode").onchange=e=>store("bq_phone",e.target.checked?"1":undefined);
$("backBtn").onclick=()=>{loadToken++;show("pick")};
$("startBtn").onclick=()=>{
  // iPhone: geluid ontgrendelen tijdens de tik
  audio.src=SILENCE;audio.play().catch(()=>{});
  startRound();
};

// ---------- Spelverloop (alleen) ----------
let idx=0,typed=new Set(),state={},timers=[],tick=null,cupsGiven=0;

function startRound(){
  roundNo++;idx=0;players.forEach(p=>{p.round=0;p.hist=[]});
  show("game");
  state={};players.forEach(p=>state[p.name]={});updateMine();renderBoard();
  $("songNo").textContent=`${CATEGORIES[catKey].name} · Ronde ${roundNo}`;
  $("phase").textContent="Maak je klaar";$("clock").classList.add("pause");
  $("guess").disabled=true;$("guess").value="";$("typed").textContent="";$("feed").innerHTML="";$("reveal").hidden=true;
  countdown(LEAD,playSong);
}
function playSong(){
  const song=order[idx];
  typed=new Set();state={};cupsGiven=0;players.forEach(p=>state[p.name]={a:false,t:false,cup:0,full:false});
  $("songNo").textContent=`${CATEGORIES[catKey].name} · Nummer ${idx+1} / ${order.length}`;
  $("phase").textContent="Luisteren";$("clock").classList.remove("pause");
  $("reveal").hidden=true;$("feed").innerHTML="";$("typed").textContent="";
  $("guess").disabled=false;$("guess").value="";$("guess").focus();
  updateMine();renderBoard();
  audio.src=song.url;audio.currentTime=0;audio.play().catch(()=>{});
  scheduleBots();
  countdown(PLAY,()=>endSong(song));
}
function award(p){
  const s=state[p.name];
  if(s.a&&s.t&&!s.full){s.full=true;if(cupsGiven<3){cupsGiven++;s.cup=cupsGiven;p.cups[cupsGiven-1]++}
    feed(`${p.me?"Jij hebt":p.name+" heeft"} alles goed${s.cup?` · beker ${s.cup}`:""}`)}
}
function scheduleBots(){
  const slow=$("phoneMode").checked?1.4:1;
  players.filter(p=>!p.me).forEach(p=>{
    const plan=botPlan(p.skill,slow);
    if(plan.a!=null)timers.push(setTimeout(()=>{state[p.name].a=true;if(plan.t==null)feed(`${p.name} heeft de artiest`);award(p);renderBoard()},plan.a*1000));
    if(plan.t!=null)timers.push(setTimeout(()=>{if(!state[p.name].a)feed(`${p.name} heeft de titel`);state[p.name].t=true;award(p);renderBoard()},plan.t*1000));
  });
}
function countdown(sec,done){
  clearInterval(tick);const start=Date.now();
  const step=()=>{const left=Math.max(0,sec-(Date.now()-start)/1000);
    $("clock").textContent=Math.ceil(left);$("barFill").style.transform=`scaleX(${left/sec})`;
    if(left<=0){clearInterval(tick);done()}};
  step();tick=setInterval(step,200);
}
function endSong(song){
  audio.pause();timers.forEach(clearTimeout);timers=[];
  $("guess").disabled=true;
  players.forEach(p=>{const s=state[p.name];const pts=(s.a?.5:0)+(s.t?.5:0);p.round+=pts;p.total+=pts;p.hist.push(pts)});
  const s=state[me.name];
  $("reveal").hidden=false;
  $("reveal").innerHTML=`<span class="tag">Het was</span><b>${esc(song.show)}</b><span class="tag">Jij: ${fmt((s.a?.5:0)+(s.t?.5:0))} punt</span>`;
  renderBoard();
  $("phase").textContent="Pauze";$("clock").classList.add("pause");
  countdown(PAUSE,()=>{idx++;idx<order.length?playSong():endRound()});
}
function endRound(){
  const ranked=[...players].sort((a,b)=>b.round-a.round||b.cups[0]-a.cups[0]);
  const lines=[];
  ranked.forEach((p,i)=>{const r=i+1,bonus=bonusFor(p.prevRank,r);
    if(bonus){p.total+=bonus;lines.push(`${p.me?"Jij krijgt":p.name+" krijgt"} +${bonus} bonus (twee rondes op rij top ${Math.max(p.prevRank,r)})`)}
    p.prevRank=r});
  const myRank=ranked.indexOf(me)+1;
  show("end");
  $("end").innerHTML=`<h1>${myRank===1?"WINNAAR!":"Plek "+myRank}</h1>
    <p>Je scoorde ${fmt(me.round)} van ${order.length} punten deze ronde.</p>
    <p>${lines.length?lines.join("<br>"):"Twee rondes op rij in de top 3 levert een bonus op."}</p>
    <div class="btns"><button id="again">Nog een ronde ${CATEGORIES[catKey].name}</button><button class="ghost" id="other">Andere categorie</button></div>`;
  $("again").onclick=()=>chooseCategory(catKey);
  $("other").onclick=()=>show("pick");
  renderBoard();
}

// ---------- Jouw invoer ----------
$("form").addEventListener("submit",e=>{
  e.preventDefault();const v=$("guess").value;$("guess").value="";
  if($("guess").disabled)return;
  if(Q){qGuess(v);return}
  words(v).forEach(w=>typed.add(w));
  $("typed").textContent=[...typed].join(" · ");
  const r=check(order[idx],typed),s=state[me.name];
  if(r.a)s.a=true;if(r.t)s.t=true;
  award(me);updateMine();renderBoard();
});
function updateMine(){const s=Q?qMine():state[me.name]||{};
  $("chipA").classList.toggle("ok",!!s.a);$("chipT").classList.toggle("ok",!!s.t);
  $("myCup").innerHTML=s.cup?`<span class="cup">${s.cup}</span>`:""}
function feed(t){const d=document.createElement("div");d.textContent=t;$("feed").prepend(d)}
function fmt(n){return n.toFixed(1).replace(".",",")}

// stand: alleen of online, zelfde weergave
function renderBoard(){
  const list=Q&&Q.st&&Q.st.players?Q.st.players.map((p,i)=>({name:p.name,me:i===Q.st.me,total:p.total,cups:p.cups,hist:p.hist,cup:p.cur&&p.cur.cup,bot:p.bot,off:!p.online}))
    :players.map(p=>({name:p.name,me:!!p.me,total:p.total,cups:p.cups,hist:p.hist,cup:(state[p.name]||{}).cup}));
  const ranked=[...list].sort((a,b)=>b.total-a.total||b.cups[0]-a.cups[0]);
  $("board").innerHTML=ranked.map((p,i)=>{
    const dots=p.hist.map(h=>`<span class="dot ${h===1?"full":h?"half":""}"></span>`).join("");
    const cupNow=p.cup?` <span class="cup">${p.cup}</span>`:"";
    const tag=Q&&!p.bot?` <span class="human" title="speelt mee">👤</span>`:"";
    return `<div class="row${p.me?" me":""}${p.off?" off":""}"><span class="pos">${i+1}</span>
      <div class="name"><span>${esc(p.name)}${tag}${cupNow}</span><div class="dots">${dots}</div></div>
      <span class="cups">🏆${p.cups[0]}·${p.cups[1]}·${p.cups[2]}</span>
      <span class="pts">${fmt(p.total)}</span></div>`}).join("");
}

// ======================================================================
// ---------- Online quiz ----------
// ======================================================================
let Q=null;   // {code,create,ws,lobby,st,offset,timer,typed,typedK,audioK,...}
let unlocked=false;
function unlock(){if(unlocked)return;unlocked=true;audio.src=SILENCE;audio.play().catch(()=>{});$("qSound").hidden=true}
document.addEventListener("pointerdown",unlock,{once:true});
$("qSound").onclick=unlock;

function token(){
  try{let t=sessionStorage.getItem("pres_token")||localStorage.getItem("pres_token");
    if(!t){t=Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(36).padStart(2,"0")).join("").slice(0,20);localStorage.setItem("pres_token",t)}
    return t}catch(e){return "anon"+Math.random().toString(36).slice(2,12)}
}
function myName(){let n=load("bq_name");if(!n){try{n=(JSON.parse(load("pres_cfg"))||{}).myName}catch(e){}}return (n||"").slice(0,14)}
function setMyName(n){store("bq_name",n.trim().slice(0,14))}
const newCode=()=>Array.from(crypto.getRandomValues(new Uint8Array(4)),b=>CODE_CHARS[b%CODE_CHARS.length]).join("");
const shareUrl=code=>`${location.origin}${location.pathname}?quiz=${code}`;
let qToastT=null;
function qToast(msg,sticky){const t=$("qToast");t.textContent=msg;t.hidden=!msg;clearTimeout(qToastT);if(msg&&!sticky)qToastT=setTimeout(()=>t.hidden=true,3500)}

$("qName").value=myName();
$("qName").oninput=e=>setMyName(e.target.value);
$("qCreate").onclick=()=>{
  const n=$("qName").value.trim();if(!n){$("qName").focus();qToast("Vul eerst je naam in.");return}
  setMyName(n);unlock();qConnect(newCode(),true);
};

function qConnect(code,create){
  stopLocal();if(Q)qLeave(null,true);
  Q={code,create,ws:null,lobby:null,st:null,offset:0,timer:null,typed:new Set(),typedK:-1,audioK:-1,retry:0,closed:false,ping:null,chat:[],humans:1};
  history.replaceState(null,"",`?quiz=${code}`);
  show("qLobby");lobbyHTML(`<h2>Verbinden…</h2>`);
  $("qOnline").hidden=true;
  qOpen();
}
function stopLocal(){loadToken++;clearInterval(tick);timers.forEach(clearTimeout);timers=[];audio.pause()}
function qOpen(){
  const q=Q,ws=new WebSocket(`${location.protocol==="https:"?"wss":"ws"}://${location.host}/qws/${q.code}`);
  q.ws=ws;
  ws.onopen=()=>{q.retry=0;qToast("");
    ws.send(JSON.stringify({t:"hello",token:token(),name:myName(),create:q.create}));
    clearInterval(q.ping);q.ping=setInterval(()=>{if(ws.readyState===1)ws.send("ping")},25000)};
  ws.onmessage=e=>{
    if(Q!==q||e.data==="pong")return;
    let m;try{m=JSON.parse(e.data)}catch(x){return}
    if(m.t==="err"){
      if(m.code==="exists"&&q.create){q.code=newCode();history.replaceState(null,"",`?quiz=${q.code}`);ws.onclose=null;ws.close();qOpen();return}
      if(m.fatal){qLeave(m.msg);return}
      qToast(m.msg);return;
    }
    q.create=false;q.host=m.host;q.hostName=m.hostName;q.humans=m.humans||1;
    if(m.now)q.offset=m.now-Date.now();
    qChatArrived(m.chat||[]);
    if(m.t==="lobby"){q.lobby=m;q.st=null;qStopFrame();show("qLobby");qRenderLobby()}
    else if(m.t==="q"){q.st=m;qState()}
    $("qSound").hidden=unlocked;
  };
  ws.onclose=()=>{clearInterval(q.ping);
    if(Q!==q||q.closed||q.ws!==ws)return;
    qToast("Verbinding weg, opnieuw verbinden…",true);
    setTimeout(()=>{if(Q===q&&!q.closed)qOpen()},Math.min(8000,600*2**q.retry++));
  };
}
function qSend(m){if(Q&&Q.ws&&Q.ws.readyState===1)Q.ws.send(JSON.stringify(m));else qToast("Geen verbinding.")}
function qLeave(msg,quiet){
  if(Q){Q.closed=true;clearInterval(Q.ping);qStopFrame();try{Q.ws.close()}catch(e){}}
  Q=null;audio.pause();
  history.replaceState(null,"",location.pathname);
  $("qChat").hidden=true;$("qSound").hidden=true;
  if(!quiet){$("qOnline").hidden=false;$("pickTitle").textContent="Kies een categorie";$("pickTag").hidden=false;show("pick");renderBoard();if(msg)qToast(msg)}
}
function qRenderLobby(){
  const L=Q.lobby,url=shareUrl(L.code),n=Math.max(1,L.n,L.seats.length),bots=Math.max(0,n-L.seats.length);
  const seats=L.seats.map(s=>`<li><b>${esc(s.name)}</b>${s.you?' <span class="badge">jij</span>':""}${s.host?' <span class="badge">host</span>':""}${s.online?"":' <span class="badge off">weg</span>'}</li>`).join("");
  const counts=[1,2,3,4,5,6,7,8].filter(k=>k>=L.seats.length).map(k=>`<button type="button" class="seg${n===k?" on":""}" data-q="n" data-n="${k}" aria-pressed="${n===k}">${k}</button>`).join("");
  lobbyHTML(`<h2>Online quiz <span class="code">${esc(L.code)}</span></h2>
    <div class="share"><input type="text" readonly value="${esc(url)}" aria-label="Link naar deze quiz"><button type="button" data-q="share">Deel link</button></div>
    <label class="opt">Jouw naam <input type="text" id="qLobbyName" maxlength="14" value="${esc(myName())}"></label>
    <ol class="lplayers">${seats}${bots?`<li class="bots">+ ${bots} computer${bots>1?"s":""}</li>`:""}</ol>
    ${L.host?`<div class="field"><span class="lbl">Aantal spelers</span><div class="seg-row multi">${counts}</div></div>
      <label class="phone"><input type="checkbox" data-q="phone"${L.phone?" checked":""}> Telefoonmodus (computers typen 40% langzamer)</label>
      <button type="button" data-q="start">Start de quiz</button>`
      :`<p class="tag">Wachten tot ${esc(L.hostName||"de host")} de quiz start…${L.phone?" Telefoonmodus staat aan.":""}</p>`}
    <button type="button" class="ghost" data-q="leave">Verlaten</button>`);
}
$("qLobby").addEventListener("click",async e=>{
  const b=e.target.closest("[data-q]");if(!b||!Q)return;
  switch(b.dataset.q){
    case "share":{const url=shareUrl(Q.code);
      if(navigator.share){try{await navigator.share({title:"Beukquiz",text:"Doe mee met de Beukquiz",url});return}catch(x){}}
      try{await navigator.clipboard.writeText(url);qToast("Link gekopieerd.")}catch(x){qToast(url,true)}break}
    case "n":qSend({t:"setN",n:+b.dataset.n});break;
    case "start":qSend({t:"start"});break;
    case "leave":qSend({t:"leave"});qLeave();break;
  }
});
$("qLobby").addEventListener("change",e=>{
  if(e.target.dataset.q==="phone")qSend({t:"phone",on:e.target.checked});
  if(e.target.id==="qLobbyName"){const n=e.target.value.trim();if(n){setMyName(n);qSend({t:"name",name:n})}}
});
function qAskName(code){
  show("qLobby");$("qOnline").hidden=true;
  lobbyHTML(`<h2>Meedoen met quiz <span class="code">${esc(code)}</span></h2>
    <label class="opt">Jouw naam <input type="text" id="qJoinName" maxlength="14" value="${esc(myName())}" autocomplete="nickname"></label>
    <div class="btns"><button type="button" id="qJoinGo">Meedoen</button><button type="button" class="ghost" id="qJoinCancel">Annuleren</button></div>`);
  const go=()=>{const n=$("qJoinName").value.trim();if(!n){$("qJoinName").focus();return}setMyName(n);unlock();qConnect(code,false)};
  $("qJoinGo").onclick=go;$("qJoinName").onkeydown=e=>{if(e.key==="Enter")go()};
  $("qJoinCancel").onclick=()=>{history.replaceState(null,"",location.pathname);$("qOnline").hidden=false;show("pick")};
}

// --- spelfases ---
function qState(){
  const st=Q.st;
  renderBoard();
  if(st.phase==="pick"){
    qStopFrame();audio.pause();
    if(Q.host&&!Q.loading){$("pickTitle").textContent="Kies een categorie voor iedereen";$("pickTag").hidden=true;$("qOnline").hidden=true;show("pick")}
    else if(!Q.host){show("qWait");$("qWait").innerHTML=`<h2>Even wachten</h2><p>${esc(st.hostName||"De host")} kiest een categorie…</p>`}
  }else if(st.phase==="run"){
    Q.loading=false;
    if($("game").hidden){show("game");$("typed").textContent="";$("reveal").hidden=true}
    $("feed").innerHTML=st.feed.map(t=>`<div>${esc(t)}</div>`).join("");
    qStartFrame();qFrame();
  }else if(st.phase==="end"){
    qStopFrame();audio.pause();Q.loading=false;qEnd();
  }
}
function qChoose(k){
  if(!Q||!Q.host)return;
  const token=++loadToken;Q.loading=true;
  show("qWait");$("qWait").innerHTML=`<h2>${esc(CATEGORIES[k].name)}</h2><p id="qLoadMsg">Fragmenten laden… 0 / ${PER_ROUND}</p>`;
  loadSongs(k,()=>token!==loadToken||!Q,n=>{const el=$("qLoadMsg");if(el)el.textContent=`Fragmenten laden… ${n} / ${PER_ROUND}`}).then(list=>{
    if(!Q||token!==loadToken)return;
    if(!list||!list.length){Q.loading=false;qToast("Kon geen fragmenten ophalen. Kies opnieuw.");qState();return}
    qSend({t:"round",catName:CATEGORIES[k].name,songs:list.map(s=>({raw:s.raw,url:s.url}))});
  });
}
const qNow=()=>Date.now()+(Q?Q.offset:0);
function qMine(){const st=Q&&Q.st;if(!st||st.me<0)return {};const p=st.players[st.me];return p&&p.cur?p.cur:{}}
function qStartFrame(){if(!Q.timer)Q.timer=setInterval(qFrame,150)}
function qStopFrame(){if(Q&&Q.timer){clearInterval(Q.timer);Q.timer=null}}
// elk moment: welk nummer, luisteren of pauze, klok, en het fragment op de juiste plek laten spelen
function qFrame(){
  const st=Q&&Q.st;if(!st||st.phase!=="run")return;
  const n=st.urls.length,rel=qNow()-st.t0,lead=(LEAD+2)*1000;
  const bar=(left,total)=>{$("clock").textContent=Math.max(0,Math.ceil(left/1000));$("barFill").style.transform=`scaleX(${Math.max(0,Math.min(1,left/total))})`};
  if(rel<0){
    $("songNo").textContent=`${st.catName} · Ronde ${st.round}`;$("phase").textContent="Maak je klaar";$("clock").classList.add("pause");
    bar(-rel,lead);$("guess").disabled=true;audio.pause();updateMine();return;
  }
  const k=Math.min(n-1,Math.floor(rel/st.slot)),inSong=rel-k*st.slot,playing=inSong<st.play*1000&&rel<n*st.slot;
  $("songNo").textContent=`${st.catName} · Nummer ${k+1} / ${n}`;
  if(Q.typedK!==k){Q.typedK=k;Q.typed=new Set();$("typed").textContent="";$("guess").value=""}
  if(playing){
    $("phase").textContent="Luisteren";$("clock").classList.remove("pause");
    bar(st.play*1000-inSong,st.play*1000);
    if($("guess").disabled){$("guess").disabled=false;$("guess").focus()}
    $("reveal").hidden=true;
    if(Q.audioK!==k){
      // wie later inhaakt (of herlaadt) springt naar hetzelfde punt in het fragment als de rest
      Q.audioK=k;audio.src=st.urls[k];
      const seek=()=>{try{audio.currentTime=Math.max(0,(qNow()-st.t0-k*st.slot)/1000)}catch(e){}};
      audio.addEventListener("loadedmetadata",seek,{once:true});
      audio.play().catch(()=>{if(!unlocked)$("qSound").hidden=false});
    }
  }else{
    $("phase").textContent="Pauze";$("clock").classList.add("pause");
    bar(st.slot-inSong,st.slot-st.play*1000);
    $("guess").disabled=true;if(!audio.paused)audio.pause();
    const sh=st.shows[k],mine=st.me>=0?st.players[st.me].hist[k]:null;
    if(sh&&$("reveal").hidden){$("reveal").hidden=false;
      $("reveal").innerHTML=`<span class="tag">Het was</span><b>${esc(sh)}</b>${mine!=null?`<span class="tag">Jij: ${fmt(mine)} punt</span>`:""}`}
  }
  updateMine();
}
function qGuess(v){
  const st=Q.st;if(!st||st.phase!=="run")return;
  const k=Q.typedK;
  words(v).forEach(w=>Q.typed.add(w));
  $("typed").textContent=[...Q.typed].join(" · ");
  qSend({t:"guess",k,text:v});
}
function qEnd(){
  const st=Q.st,R=st.results||{ranked:[],bonus:{}},P=st.players;
  const myRank=R.ranked.indexOf(st.me)+1;
  const lines=Object.entries(R.bonus).map(([i,b])=>`${+i===st.me?"Jij krijgt":esc(P[i].name)+" krijgt"} +${b} bonus`);
  show("end");
  $("end").innerHTML=`<h1>${myRank===1?"WINNAAR!":"Plek "+myRank}</h1>
    <p>Je scoorde ${fmt(st.me>=0?P[st.me].round:0)} van ${st.urls.length} punten deze ronde.</p>
    <ol class="lplayers">${R.ranked.slice(0,8).map((i,n)=>`<li><b>${n+1}. ${esc(P[i].name)}</b> <span class="tag">${fmt(P[i].round)} punt</span></li>`).join("")}</ol>
    <p>${lines.length?lines.join("<br>"):"Twee rondes op rij in de top 3 levert een bonus op."}</p>
    ${Q.host?`<div class="btns"><button id="qNext">Volgende ronde</button><button class="ghost" id="qStop">Terug naar de wachtruimte</button></div>`
      :`<p class="tag">Wachten tot ${esc(st.hostName||"de host")} de volgende ronde start…</p><div class="btns"><button class="ghost" id="qBye">Verlaten</button></div>`}`;
  if(Q.host){$("qNext").onclick=()=>qSend({t:"next"});$("qStop").onclick=()=>{if(confirm("Terug naar de wachtruimte? De stand begint dan opnieuw."))qSend({t:"end"})}}
  else $("qBye").onclick=()=>{if(confirm("De quiz verlaten? Met dezelfde link kom je terug."))qLeave()};
}

// --- chat (als er meer dan één mens meedoet) ---
function qChatArrived(list){
  const last=list.length?list[list.length-1].id:0;
  if(Q.chatSeen!=null){const me=myName().toLowerCase();list.filter(c=>c.id>Q.chatSeen&&c.name.toLowerCase()!==me).slice(-1).forEach(c=>qToast(`💬 ${c.name}: ${c.text}`))}
  Q.chatSeen=last;
  Q.chat=list;const box=$("qChat");box.hidden=!(Q.humans>1);if(box.hidden)return;
  const el=$("qChatList"),atEnd=el.scrollHeight-el.scrollTop-el.clientHeight<30;
  el.innerHTML=list.map(c=>`<div><b>${esc(c.name)}</b> ${esc(c.text)}</div>`).join("")||'<div class="tag">Nog geen berichten.</div>';
  if(atEnd)el.scrollTop=el.scrollHeight;
}
$("qChatForm").onsubmit=e=>{e.preventDefault();const t=$("qChatText").value.trim();if(!t)return;qSend({t:"chat",text:t});$("qChatText").value=""};

// via een gedeelde link binnengekomen
const quizCode=(new URLSearchParams(location.search).get("quiz")||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
if(quizCode){myName()?qConnect(quizCode,false):qAskName(quizCode)}

// pas inloggen als alles hierboven geladen is
if(load("bq_pw")===PW_HASH) showApp(); else {$("login").hidden=false;$("pw").focus()}
