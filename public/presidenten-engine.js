// Presidenten: de spelregels en computerspelers, zonder scherm. Draait in de browser (spelen op één apparaat)
// én in de Cloudflare-server (online spel), zodat beide precies hetzelfde spel spelen.
//
// Regels: 2 laag … A hoog. De joker vult elke set aan; los is hij een aas. Alleen hoger leggen, passen = klaar
// voor die slag. Niets gaat boven een aas: na een aas wint die speler de slag na 2 tellen en komt meteen weer uit.
// Staatsgreep: vier gelijke (zonder joker), na het ruilen altijd te leggen, ook buiten je beurt. Die stopt de ronde
// meteen: pleger wordt president, de president feut, de rest burger. Dan wordt opnieuw gedeeld.
//
// De spelstand G is gewone JSON (de server bewaart hem). Tijd komt altijd van buiten (`now`): wat er straks
// vanzelf moet gebeuren staat als tijdstip in G.wait en G.coupAt, en tick() voert het uit als het zover is.

export const VERSION="1.5";
export const TITLES=["President","Vicepresident","Burger","Vice-feut","Feut"];
export const SUITS=["♣","♦","♥","♠"];
export const ACE=14;
export const AVATARS=["😎","🧔","👩‍🦰","👴","🧑‍🎤","🤠","👵"];
export const BOT_NAMES=["Henk","Ingrid","Kees","Fleur","Joop","Mien","Sjaak"];
// tempo (ms): rustig, zodat je kunt volgen wat er gebeurt. fly = hoe lang een kaart over tafel vliegt.
export const T={fly:750,think:[500,1000],ace:2000,pass:1400,ex:1000,auto:700,coupBot:[2000,5000]};

// speelstijl van de computers: 0 = voorzichtig (bewaart jokers en hoge kaarten), 1 = opportunistisch
// (legt een joker bij voor een drietal, gooit hoge kaarten vroeg om te bluffen). "mix" = iedereen anders.
export const STYLES={careful:{label:"Voorzichtig",o:.1},normal:{label:"Normaal",o:.45},bold:{label:"Opportunistisch",o:.9},mix:{label:"Gemengd",o:null}};
export const styleValue=k=>{const s=STYLES[k]||STYLES.normal;return s.o==null?+(0.1+Math.random()*.8).toFixed(2):s.o};

export const rn=r=>({11:"B",12:"V",13:"H",14:"A",15:"Joker"})[r]||String(r);
export const rnPlural=r=>({11:"boeren",12:"vrouwen",13:"heren",14:"azen"})[r]||rn(r)+"'en";
export const cn=c=>c.j?"Joker":rn(c.r)+c.s;
const rand=(a,b)=>a+Math.random()*(b-a);

// ---------- Kaarten ----------
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a}
function deck(){const d=[];let id=0;
  for(const s of SUITS)for(let r=2;r<=14;r++)d.push({id:id++,r,s});
  d.push({id:id++,r:15,j:true},{id:id++,r:15,j:true});return shuffle(d)}
// intern altijd laag→hoog, jokers achteraan (r=15 alleen voor sorteren en "hoogste kaart" bij het ruilen)
export const sortHand=h=>h.sort((a,b)=>a.r-b.r||SUITS.indexOf(a.s)-SUITS.indexOf(b.s));
export function groups(hand){const g={};hand.forEach(c=>{if(!c.j)(g[c.r]=g[c.r]||[]).push(c)});return g}
// Een set: allemaal dezelfde waarde, jokers vullen aan. Alleen jokers: de speler kiest wat ze zijn
// (as = 2..A); zonder keuze tellen ze als aas.
export function evalSet(cards,as){
  if(!cards.length)return null;
  const nat=cards.filter(c=>!c.j);
  if(nat.some(c=>c.r!==nat[0].r))return null;
  if(nat.length)return {count:cards.length,value:nat[0].r};
  const v=+as;
  return {count:cards.length,value:v>=2&&v<=ACE?v:ACE};
}
export const onlyJokers=cards=>cards.length>0&&cards.every(c=>c.j);
export const isQuad=cards=>cards.length===4&&cards.every(c=>!c.j&&c.r===cards[0].r);
export const quadsIn=hand=>Object.values(groups(hand)).filter(a=>a.length>=4).map(a=>a.slice(0,4));

// ---------- Vragen over de stand ----------
export const humans=G=>G.players.map((p,i)=>p.human?i:-1).filter(i=>i>=0);
export const myTurn=(G,i)=>G.phase==="play"&&!G.hold&&G.turn===i;
export function coupAllowed(G,i){const p=G.players[i];return !!p&&G.phase==="play"&&!p.out&&p.title!=="President"}
// mens die nu niet zelf hoeft te klikken: automatisch passen (open spelen speel je gewoon zelf)
export function autoActs(G,i){const p=G.players[i];
  return !!p&&p.human&&myTurn(G,i)&&p.autoPass>0&&!!G.trick&&G.trick.value>p.autoPass}
export function canPlay(G,i,cards,as){
  if(!myTurn(G,i))return false;
  if(isQuad(cards)&&coupAllowed(G,i))return true;
  const ev=evalSet(cards,as);if(!ev)return false;
  return !G.trick||(ev.count===G.trick.count&&ev.value>G.trick.value);
}
// de hoogste kaarten zijn altijd de hoogste: joker, dan aas, enz., ook als je daarmee een set breekt
export const forced=(G,e)=>[...G.players[e.from].hand].sort((a,b)=>b.r-a.r).slice(0,e.k);
function nextActive(G,i){for(let k=1;k<=G.n;k++){const j=(i+k)%G.n;if(!G.players[j].out)return j}return i}
function log(G,t){G.log.unshift(t);if(G.log.length>40)G.log.length=40}
// gebeurtenissen voor het scherm (kaarten laten vliegen, pas-ballonnetje); alleen de laatste paar
function event(G,e){e.seq=++G.seq;G.ev.push(e);if(G.ev.length>20)G.ev.shift()}
// een mededeling die iedereen ziet (in het logboek en als ballonnetje bij de speler)
function say(G,i,text,cloud){log(G,text);event(G,{k:"say",by:i,text,cloud:!!cloud})}
// uitspraken bij de muitopties: een wolkje boven je poppetje dat iedereen ziet
export const SHOUTS={lijndans:"Ik heb lijndansvereniging 'op een rijtje'",laag:"Hou 'm laag!",muitje:"Muitje!"};
function take(p,cards){const ids=new Set(cards.map(c=>c.id));p.hand=p.hand.filter(c=>!ids.has(c.id))}

// ---------- Spelverloop ----------
// seats: [{name, human, avatar, style}] (style: 0..1, alleen voor computers)
export function newGame(seats,now){
  const players=seats.map((s,i)=>({name:s.name,human:!!s.human,avatar:s.avatar||AVATARS[i%AVATARS.length],
    style:typeof s.style==="number"?s.style:.45,stats:Object.fromEntries(TITLES.map(t=>[t,0])),hand:[],title:null,out:false,passed:false,pres:0,open:false,autoPass:0,acted:false}));
  const G={players,n:players.length,round:0,log:[],seq:0,ev:[],wait:null,coupAt:{},history:[]};
  startRound(G);plan(G,now);
  return G;
}
function startRound(G){
  G.round++;
  G.players.forEach(p=>{p.hand=[];p.out=false;p.passed=false;p.open=false;p.autoPass=0;p.acted=false});
  deck().forEach((c,i)=>G.players[(i+G.round)%G.n].hand.push(c));
  G.players.forEach(p=>sortHand(p.hand));
  Object.assign(G,{phase:"deal",turn:-1,finish:[],trick:null,pile:[],pileWinner:null,lastBy:null,hold:false,
    coupBy:null,coupShow:null,exQueue:[],exSum:{},coupAt:{}});
  log(G,`Ronde ${G.round}: de kaarten zijn gedeeld.`);
  event(G,{k:"deal"});
  const pr=pairs(G);
  if(pr.length){
    // ruilen in stappen: eerst geeft de lage titel zijn hoogste kaart(en), dan geeft de hoge titel er evenveel terug
    G.phase="exchange";
    pr.forEach(({low,high,k})=>G.exQueue.push({up:true,from:low,to:high,k},{up:false,from:high,to:low,k}));
  }else startPlay(G);
}
function pairs(G){
  const t=n=>G.players.findIndex(p=>p.title===n),r=[];
  const P=t("President"),F=t("Feut"),VP=t("Vicepresident"),VF=t("Vice-feut");
  if(P>=0&&F>=0)r.push({low:F,high:P,k:2});
  if(VP>=0&&VF>=0)r.push({low:VF,high:VP,k:1});
  return r;
}
function doExchange(G,cards){
  const e=G.exQueue.shift(),P=G.players;
  take(P[e.from],cards);cards.forEach(c=>c.fresh=true);P[e.to].hand.push(...cards);sortHand(P[e.to].hand);
  const sum=i=>G.exSum[i]=G.exSum[i]||{gave:[],got:[]};
  sum(e.from).gave.push(...cards);sum(e.to).got.push(...cards);
  log(G,e.up?`${P[e.from].name} geeft ${e.k>1?`de ${e.k} hoogste kaarten`:"de hoogste kaart"} aan ${P[e.to].name}.`
            :`${P[e.from].name} geeft ${e.k>1?`${e.k} kaarten`:"1 kaart"} terug aan ${P[e.to].name}.`);
  event(G,{k:"swap",from:e.from,to:e.to,cards});
  if(!G.exQueue.length)startPlay(G);
}
function startPlay(G){
  G.phase="play";G.trick=null;G.pile=[];G.pileWinner=null;G.lastBy=null;G.players.forEach(p=>p.passed=false);
  // eerste ronde: klaver 2 begint; daarna altijd de feut
  let s=G.round>1?G.players.findIndex(p=>p.title==="Feut"):-1,why="is feut en begint";
  if(s<0){s=G.players.findIndex(p=>p.hand.some(c=>c.r===2&&c.s==="♣"));why="heeft klaver 2 en begint"}
  G.turn=s;log(G,`${G.players[s].name} ${why}.`);
}
function play(G,i,cards,as){
  const p=G.players[i];take(p,cards);p.acted=true;p.hand.forEach(c=>c.fresh=false);
  const ev=evalSet(cards,as);
  if(G.pileWinner!=null){G.pile=[];G.pileWinner=null}
  G.trick={count:ev.count,value:ev.value};G.lastBy=i;
  G.pile.push({cards,by:i,value:ev.value});
  event(G,{k:"play",by:i,cards});
  log(G,`${p.name}: ${cards.map(cn).join(" ")}${cards.some(c=>c.j)?` (als ${rn(ev.value)})`:""}`);
  if(goOut(G,i))return;
  if(ev.value===ACE)G.hold="ace";   // hoger dan een aas kan niet: slag is na 2 tellen voorbij
  else advanceFrom(G,i);
}
function pass(G,i){
  const p=G.players[i];p.passed=true;p.acted=true;p.hand.forEach(c=>c.fresh=false);
  log(G,`${p.name} past.`);event(G,{k:"pass",by:i});
  advanceFrom(G,i);
}
function goOut(G,i){
  const p=G.players[i];if(p.hand.length)return false;
  p.out=true;G.finish.push(i);log(G,`${p.name} is uit (#${G.finish.length}).`);
  const left=G.players.map((q,j)=>j).filter(j=>!G.players[j].out);
  if(left.length<=1){left.forEach(j=>{G.players[j].out=true;G.finish.push(j)});endRound(G);return true}
  return false;
}
function endTrick(G){
  const w=G.lastBy;G.trick=null;G.hold=false;G.pileWinner=w;G.players.forEach(p=>p.passed=false);
  G.turn=G.players[w].out?nextActive(G,w):w;
  log(G,`Slag voor ${G.players[w].name}.`);
}
// Volgende speler die nog meedoet in deze slag; is er niemand meer, dan is de slag voorbij.
function advanceFrom(G,i){
  for(let k=1;k<G.n;k++){const j=(i+k)%G.n,p=G.players[j];
    if(!p.out&&!p.passed&&j!==G.lastBy){G.turn=j;return}}
  G.hold="pass";   // even laten staan wie er gepast heeft, daarna pas de slag afsluiten
}
function coup(G,i,cards){
  const p=G.players[i];take(p,cards);
  G.coupBy=i;G.coupShow={cards,by:i};
  const old=G.players.findIndex(q=>q.title==="President");
  G.players.forEach((q,j)=>q.title=j===i?"President":j===old?"Feut":"Burger");
  log(G,`STAATSGREEP door ${p.name} met vier ${rnPlural(cards[0].r)}! ${p.name} is president${old>=0?`, ${G.players[old].name} is feut`:""}, de rest is burger.`);
  event(G,{k:"coup",by:i,cards});
  endRound(G);
}
function endRound(G){
  G.phase="roundEnd";G.trick=null;G.hold=false;G.turn=-1;
  if(G.coupBy==null){const n=G.n;
    G.finish.forEach((i,pos)=>G.players[i].title=pos===0?"President":pos===1?"Vicepresident":pos===n-1?"Feut":pos===n-2?"Vice-feut":"Burger")}
  G.players.forEach(p=>{if(p.title==="President")p.pres++;if(p.stats&&p.title in p.stats)p.stats[p.title]++});
  // uitslag van deze ronde bewaren voor het scorebord
  G.history=G.history||[];
  G.history.push({round:G.round,coupBy:G.coupBy,titles:G.players.map(p=>p.title)});
  if(G.history.length>100)G.history.shift();
  if(G.coupBy==null)log(G,`Ronde ${G.round} klaar. ${G.players.find(p=>p.title==="President").name} is president.`);
}

// ---------- Computerspelers ----------
function botGiveBack(p,k){
  // weg met losse lage kaarten; sets en jokers zo lang mogelijk houden
  const g=groups(p.hand),key=c=>c.j?1000:c.r+(g[c.r].length>=2?6:0)+(g[c.r].length>=4?50:0);
  return [...p.hand].sort((a,b)=>key(a)-key(b)).slice(0,k);
}
function botChoose(G,i){
  const p=G.players[i],o=p.style,J=p.hand.filter(c=>c.j),g=groups(p.hand),ranks=Object.keys(g).map(Number).sort((a,b)=>a-b);
  if(!G.trick){
    if(!ranks.length)return J;
    if(ranks.length===1)return p.hand;           // één waarde + jokers: alles in één keer
    const low=g[ranks[0]],big=p.hand.length>5;
    // bluf: af en toe met iets hoogs uitkomen om de tafel naar je hand te zetten
    const high=ranks.filter(r=>r>=10&&r<=13);
    if(big&&high.length&&Math.random()<o*.3)return g[high[0]];
    // opportunistisch: een joker bij een paar leggen, dan wordt het een lastig drietal
    if(J.length&&low.length>=2&&low.length<4&&big&&Math.random()<o*.5)return [...low,J[0]];
    return low;                                  // laagste set eerst
  }
  const {count:n,value:v}=G.trick,opts=[];
  for(const r of ranks){if(r<=v)continue;const have=g[r].length;
    if(have>=n)opts.push({cards:g[r].slice(0,n),r,broke:have>n});
    else if(have+J.length>=n)opts.push({cards:[...g[r],...J.slice(0,n-have)],r,joker:true});
  }
  if(J.length>=n&&v<ACE)opts.push({cards:J.slice(0,n),r:ACE,joker:true});
  if(!opts.length)return null;
  const fin=opts.find(x=>x.cards.length===p.hand.length);if(fin)return fin.cards;
  const cost=x=>x.r+(x.broke?4:0)+(x.joker?8*(1-o)+1:0);
  opts.sort((a,b)=>cost(a)-cost(b));
  const best=opts[0];
  // hoe voorzichtiger, hoe langer hoge kaarten en jokers bewaard blijven (tenzij iemand bijna uit is)
  const others=G.players.filter((q,j)=>j!==i&&!q.out).map(q=>q.hand.length);
  const endgame=p.hand.length<=4||Math.min(...others)<=2;
  if(!endgame){
    if(best.joker&&Math.random()>o*.9)return null;
    if(best.r>=13&&Math.random()<.85*(1-o))return null;
    if(best.r===12&&Math.random()<.5*(1-o))return null;
    if(best.broke&&best.r>=9&&Math.random()<.7*(1-o))return null;
  }
  return best.cards;
}
function botMove(G,i){
  if(!myTurn(G,i))return;
  const p=G.players[i];
  if(!p.human){const q=coupAllowed(G,i)&&quadsIn(p.hand)[0];if(q)return coup(G,i,q)}
  const c=botChoose(G,i);
  c?play(G,i,c):pass(G,i);
}

// ---------- Tijd ----------
// Wat moet er straks vanzelf gebeuren? Een lopende wachttijd voor dezelfde stap blijft staan (een mens die
// intussen een optie aanzet, laat de computer niet opnieuw beginnen met nadenken).
function plan(G,now){
  let want=null;
  const head=G.exQueue&&G.exQueue[0];
  if(G.phase==="exchange"&&head&&!G.players[head.from].human)want={k:"ex",ms:T.ex};
  if(G.phase==="play"){
    if(G.hold)want={k:"hold",ms:G.hold==="ace"?T.fly+T.ace:T.pass};
    else{const t=G.turn,p=G.players[t];
      if(!p.human)want={k:"bot",i:t,ms:T.fly+rand(...T.think)};
      else if(autoActs(G,t))want={k:"auto",i:t,ms:T.fly+T.auto};
    }
  }
  if(!want)G.wait=null;
  else if(!(G.wait&&G.wait.k===want.k&&G.wait.i===want.i&&G.wait.seq===G.seq))
    G.wait={k:want.k,i:want.i,seq:G.seq,at:now+want.ms};
  // computers met vier gelijke plegen buiten hun beurt een staatsgreep, na even wachten zodat een mens ze voor kan zijn
  const next={};
  if(G.phase==="play")G.players.forEach((p,i)=>{
    if(p.human||!coupAllowed(G,i)||!quadsIn(p.hand).length)return;
    next[i]=G.coupAt[i]!=null?G.coupAt[i]:now+rand(...T.coupBot);
  });
  G.coupAt=next;
}
export function nextDue(G){
  const t=[G.wait&&G.wait.at,...Object.values(G.coupAt||{})].filter(x=>x!=null);
  return t.length?Math.min(...t):null;
}
// voert uit wat er op `now` aan de beurt is; geeft true als de stand veranderd is
export function tick(G,now){
  let changed=false;
  for(let guard=0;guard<40;guard++){
    const w=G.wait;
    if(w&&w.at<=now){
      G.wait=null;changed=true;
      if(w.k==="ex"){const e=G.exQueue[0];if(e)doExchange(G,e.up?forced(G,e):botGiveBack(G.players[e.from],e.k))}
      else if(w.k==="hold"){if(G.hold)endTrick(G)}
      else if(w.k==="bot")botMove(G,w.i);
      else if(w.k==="auto"&&autoActs(G,w.i))pass(G,w.i);
      plan(G,now);continue;
    }
    const due=Object.entries(G.coupAt||{}).find(([,at])=>at<=now);
    if(due){
      const i=+due[0];delete G.coupAt[i];
      const q=coupAllowed(G,i)&&quadsIn(G.players[i].hand)[0];
      if(q){coup(G,i,q);changed=true}
      plan(G,now);continue;
    }
    break;
  }
  return changed;
}

// ---------- Wat een mens doet ----------
// a: {type:"play",ids} | {type:"pass"} | {type:"give",ids} | {type:"coup",r} | {type:"next"}
//    | {type:"open",on} | {type:"autopass",r} | {type:"shout",k} (wolkje boven je poppetje, k uit SHOUTS)
//    play met alleen jokers heeft ook `as` nodig: welke kaart de jokers zijn (2..14)
// Geeft een foutmelding terug, of null als het gelukt is.
export function act(G,i,a,now){
  const p=G.players[i];if(!p||!a)return "Onbekende speler.";
  const pick=ids=>{if(!Array.isArray(ids))return null;const s=new Set(ids),c=p.hand.filter(x=>s.has(x.id));
    return c.length===s.size&&c.length===ids.length?c:null};
  switch(a.type){
    case "play":{const c=pick(a.ids);
      if(c&&onlyJokers(c)&&!(+a.as>=2&&+a.as<=ACE))return "Kies wat je joker is.";
      if(!c||!canPlay(G,i,c,a.as))return "Dat mag nu niet.";
      isQuad(c)&&coupAllowed(G,i)?coup(G,i,c):play(G,i,c,a.as);break}
    case "pass":if(!myTurn(G,i)||!G.trick)return "Je kunt nu niet passen.";pass(G,i);break;
    case "give":{const e=G.exQueue&&G.exQueue[0];if(G.phase!=="exchange"||!e||e.from!==i)return "Je hoeft nu niet te ruilen.";
      const c=e.up?forced(G,e):pick(a.ids);if(!c||c.length!==e.k)return `Kies ${e.k} kaart${e.k>1?"en":""}.`;
      doExchange(G,c);break}
    case "coup":{if(!coupAllowed(G,i))return "Je kunt nu geen staatsgreep plegen.";
      const q=quadsIn(p.hand).find(q=>q[0].r===+a.r);if(!q)return "Je hebt geen vier gelijke.";
      coup(G,i,q);break}
    case "next":if(G.phase!=="roundEnd")return "De ronde is nog bezig.";startRound(G);break;
    case "open":{const on=!!a.on;if(on===p.open)break;p.open=on;
      say(G,i,on?`${p.name} legt de kaarten open op tafel`:`${p.name} pakt de kaarten weer op`);break}
    case "autopass":{const r=+a.r,v=r>=2&&r<=13?r:0;if(v===p.autoPass)break;p.autoPass=v;
      say(G,i,v?`${p.name} loopt te muiten en heeft autopas boven ${rn(v)}`:`${p.name} muit niet meer`);break}
    case "shout":{const text=SHOUTS[a.k];if(!text)return "Onbekende uitspraak.";
      if(p.shoutAt!=null&&now-p.shoutAt<3000)return "Even geduld.";p.shoutAt=now;
      log(G,`${p.name}: ${text}`);event(G,{k:"say",by:i,text,cloud:true});break}
    default:return "Onbekende actie.";
  }
  plan(G,now);
  return null;
}
// een speler aan de computer geven (iemand is weg) of terug aan de mens
export function setHuman(G,i,human,now){const p=G.players[i];if(!p)return;p.human=!!human;plan(G,now)}

// ---------- Wat een speler te zien krijgt ----------
// me: de stoel van wie kijkt (null = niemand, dan alleen open kaarten). Kaarten van anderen blijven op de server.
export function view(G,me){
  const P=G.players,head=G.exQueue&&G.exQueue[0];
  const mine=me!=null&&P[me];
  return {
    me:me==null?null:me,n:G.n,round:G.round,phase:G.phase,turn:G.turn,hold:G.hold,lastBy:G.lastBy,
    trick:G.trick,pile:G.pile,pileWinner:G.pileWinner,finish:G.finish,coupBy:G.coupBy,coupShow:G.coupShow,
    log:G.log.slice(0,6),seq:G.seq,history:(G.history||[]).slice(-12),
    players:P.map((p,j)=>({name:p.name,human:p.human,avatar:p.avatar,title:p.title,out:p.out,passed:p.passed,
      pres:p.pres,stats:p.stats||null,open:p.open,count:p.hand.length,acted:p.acted,
      hand:j===me||p.open?p.hand:null,autoPass:p.autoPass})),
    ex:head?{up:head.up,from:head.from,to:head.to,k:head.k,forced:head.up&&head.from===me?forced(G,head).map(c=>c.id):null}:null,
    exSum:mine?G.exSum[me]||null:null,
    canCoup:!!mine&&coupAllowed(G,me),
    quads:mine?quadsIn(mine.hand).map(q=>q[0].r):[],
    ev:G.ev.map(e=>e.k==="swap"&&e.from!==me&&e.to!==me?{...e,cards:e.cards.map(()=>({back:true}))}:e),
  };
}
