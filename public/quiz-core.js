// Beukquiz: wat browser en server allebei nodig hebben. Antwoorden nakijken, tempo, computerspelers, bonus.
// De browser gebruikt dit voor de quiz alleen; de server (worker/quiz-room.js) voor de online quiz.

export const PLAY=15, PAUSE=5, LEAD=5, PER_ROUND=10;   // seconden luisteren, pauze, aanloop; nummers per ronde
export const SLOT=(PLAY+PAUSE)*1000;                   // ms per nummer
// computerspelers: naam en hoe goed ze zijn (kans dat ze het weten, en hoe snel)
export const BOTS=[["DJ Henk",.85],["Ingrid",.7],["Muziekmeester",.6],["Kees",.5],["Fleur",.45],["Babbelaar",.35],["Opa Joop",.25]];

// ---------- Tekst vergelijken ----------
const STOP=new Set(["the","a","an","and","feat","ft","n","o","de","het","een"]);
const NUM={"0":"zero","1":"one","2":"two","3":"three","4":"four","5":"five","6":"six","7":"seven","8":"eight","9":"nine","10":"ten","30":"thirty"};
for(const [k,v] of Object.entries({...NUM})) NUM[v]=k;
export function words(s){return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[.'’\-\/!?]/g,"").replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(Boolean)}
function required(s){const all=words(s);const req=all.filter(w=>!STOP.has(w)&&(w.length>1||/\d/.test(w)));return req.length?req:all}
export function lev(a,b){const m=a.length,n=b.length,d=[];for(let i=0;i<=m;i++){d[i]=[i];for(let j=1;j<=n;j++)d[i][j]=i?0:j}
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++){const c=a[i-1]===b[j-1]?0:1;
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+c);
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1)}
  return d[m][n]}
function tol(len){return len<=3?0:len<=7?1:2}
function hasWord(target,typed){const alts=[target];if(NUM[target])alts.push(NUM[target]);
  return alts.some(alt=>[...typed].some(w=>lev(w,alt)<=tol(alt.length)))}
// "Artiest|Titel" (zie songs.js) → wat er getoond wordt, wat er getypt moet worden, en een zoekterm
export function parseSong(str){
  const [art,title]=str.split("|");
  return {raw:str, show:art.split(" / ")[0].replace(/ \+ /g," & ")+" – "+title,
    artists:art.split(" + ").map(a=>a.split(" / ").map(required)),
    title:required(title.replace(/\(.*?\)/g,"")),
    q:art.split(" + ").map(a=>a.split(" / ")[0]).join(" ")+" "+title.replace(/\(.*?\)/g,"")};
}
// typed: een Set met alle woorden die iemand bij dit nummer heeft getypt
export function check(song,typed){
  return {a:song.artists.every(alts=>alts.some(ws=>ws.every(w=>hasWord(w,typed)))),
          t:song.title.every(w=>hasWord(w,typed))};
}

// ---------- Computerspelers ----------
// wanneer (s na de start van het nummer) een computer de artiest en de titel heeft; null = weet het niet
export function botPlan(skill,slow){
  const knowA=Math.random()<skill,knowT=Math.random()<skill*.9;
  const tA=(2+Math.random()*12*(1.2-skill))*slow,tT=tA+Math.random()*4*slow;
  return {a:knowA&&tA<PLAY?tA:null,t:knowT&&tT<PLAY?tT:null};
}

// ---------- Bonus ----------
// twee rondes op rij in de top 3: +3 (twee keer winnen), +2 (top 2), +1 (top 3)
export function bonusFor(prevRank,rank){
  if(!(prevRank&&prevRank<=3&&rank<=3))return 0;
  const lvl=Math.max(prevRank,rank);return lvl===1?3:lvl===2?2:1;
}
export function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a}
