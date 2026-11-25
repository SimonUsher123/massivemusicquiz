// Mexen: de spelregels en computerspelers, zonder scherm. Draait in de browser (tegen de computer) én in de
// Cloudflare-server (online), zodat beide precies hetzelfde spel spelen. Alles is open: iedereen ziet de worp.
//
// Regels
//  - Twee stenen. De hoogste steen is het tiental: 6 en 3 = 63. 32 is de laagste worp die telt.
//  - Dubbel = honderdtal: 1-1 = 100 … 6-6 = 600. Elk dubbel is hoger dan elke gewone worp.
//  - 2-1 = Mex: de hoogste worp. Elke mex in een ronde verdubbelt de inzet (1 → 2 → 4 …).
//  - 3-1: je wijst iemand aan die een slok drinkt, en gooit opnieuw (die worp telt niet mee).
//  - Het gaat om Mex, ten koste van alles. Gooi je een 1 of een 2, dan laat je die steen liggen en gooi je
//    alleen de andere. Je laat maar één steen liggen, en maar voor één worp: daarna gooi je weer allebei,
//    tenzij de steen die je net gooide weer een 1 of 2 is (die laat je dan liggen). De steen die al lag, mag
//    niet nog een keer blijven liggen.
//  - Doorgooien: iedereen gooit door tot Mex of tot het maximum aantal worpen, en geeft dan zelf de beurt door.
//    De voorgooier heeft maximaal 3 worpen; zijn aantal worpen is het maximum voor de rest.
//  - Quick: alleen bij de allereerste worp van de ronde (dus door de voorgooier) kan gekozen worden voor maar
//    één worp. Dan is het maximum voor iedereen 1. Verliest de voorgooier de ronde, dan drinkt hij dubbel.
//  - Adje (automatisch) als je: een 1 of 2 niet laat liggen, een andere steen laat liggen, vaker gooit dan mag
//    (ook na Mex), of te vroeg stopt. Het spel waarschuwt niet vooraf: opletten is het spel.
//  - De laagste drinkt de inzet. Gelijke laagsten gooien één keer af, zo nodig opnieuw. De verliezer begint
//    de volgende ronde. Er is geen einde: de stand houdt slokken en adjes bij.
//
// Onthouden hoort bij het spel: view() laat alleen de worp zien die nu op tafel ligt. Geen eerdere worpen, geen
// aantal worpen, geen maximum, geen inzet. Pas aan het eind van de ronde gaat de uitslag open.
//
// De spelstand G is gewone JSON (de server bewaart hem). Tijd komt altijd van buiten (`now`): wat er straks
// vanzelf moet gebeuren (een computer die gooit, de volgende ronde) staat als tijdstip in G.wait.

export const VERSION = "1.7.3";
export const AVATARS = ["😎", "🧔", "👩‍🦰", "👴", "🧑‍🎤", "🤠", "👵", "🧙"];
export const BOT_NAMES = ["Henk", "Ingrid", "Kees", "Fleur", "Joop", "Mien", "Sjaak", "Truus"];
export const MIN = 2, MAX = 8;
// tempo (ms)
export const T = { roll: 900, think: [700, 1300], hold: [500, 900], afterLast: 1300, point: [900, 1600], roundEnd: 6000 };

// ---------- Dobbelstenen ----------
// Eerlijke steen: cryptografisch toeval met afwijzing (bytes ≥ 252 weg), zodat elke kant precies 1/6 kans heeft.
// Dezelfde functie wordt in het spel én in de testmodus gebruikt.
const buf = new Uint8Array(4096);
let bufPos = buf.length;
export function die() {
  for (;;) {
    if (bufPos >= buf.length) { crypto.getRandomValues(buf); bufPos = 0; }
    const b = buf[bufPos++];
    if (b < 252) return (b % 6) + 1;
  }
}
export const roll2 = () => [die(), die()];

// Waarde van een worp: hoger = beter. Mex 1000, dubbel 100..600, gewoon 31..65.
export function score(d) {
  const hi = Math.max(d[0], d[1]), lo = Math.min(d[0], d[1]);
  if (hi === 2 && lo === 1) return 1000;
  if (hi === lo) return hi * 100;
  return hi * 10 + lo;
}
export const short = (s) => (s === 1000 ? "Mex" : String(s));

// ---------- Spel ----------
const rand = (a, b) => a + Math.random() * (b - a);
export const humans = (G) => G.players.map((p, i) => (p.human ? i : -1)).filter((i) => i >= 0);

export function newGame(seats, now) {
  const G = {
    v: VERSION, round: 0, seq: 0, ev: [], log: [],
    players: seats.map((s) => ({ name: s.name, human: !!s.human, avatar: s.avatar, drinks: 0, adje: 0, lost: 0, mex: 0, pointed: 0 })),
    phase: "turn", starter: Math.floor(Math.random() * seats.length), wait: null,
  };
  startRound(G, G.starter, now);
  return G;
}

const order = (G, from) => G.players.map((_, k) => (from + k) % G.players.length);
// hold: index (0/1) van de steen die je bij de volgende worp wilt laten liggen;
// prev: index van de steen die bij de vorige worp bleef liggen (die mag niet nog eens)
const fresh = () => ({ d: null, s: 0, n: 0, quick: false, locked: false, point: false, hold: null, prev: null });

function startRound(G, from, now) {
  G.round++;
  G.starter = from;
  G.phase = "turn";
  G.R = { queue: order(G, from), res: {}, max: 3, maxSet: false, stake: 1, mexes: 0, throwoff: 0, first: null };
  G.turn = from;
  G.R.res[from] = fresh();
  G.loser = null; G.result = null;
  push(G, { k: "round", round: G.round, by: from });
  plan(G, now);
}

function push(G, e) { G.seq++; e.seq = G.seq; G.ev.push(e); if (G.ev.length > 30) G.ev.splice(0, G.ev.length - 30); }
// kort logboek met alleen wat iedereen toch hoort (31, quick, adje, verliezer): geen worpen of aantallen
function logl(G, t) { G.log.unshift(t); if (G.log.length > 4) G.log.length = 4; }
function adje(G, i, why) {
  G.players[i].adje++;
  push(G, { k: "adje", by: i, why });
  logl(G, `${G.players[i].name}: ADJE! (${why})`);
}

const limit = (G, r) => (G.R.throwoff || r.quick ? 1 : G.R.max);
const finished = (G, r) => r.n > 0 && (r.n >= limit(G, r) || r.s === 1000);
// staat er een 1 of 2 op een steen die net gegooid is (dus niet de steen die bleef liggen)?
const freshLow = (r) => !!r.d && [0, 1].some((k) => k !== r.prev && r.d[k] <= 2);
// Wat een mens mag proberen. Het spel zegt niet of het mág: te vaak gooien of te vroeg stoppen kan, en kost een adje.
const mine = (G, i) => { const r = G.R && G.R.res[i]; return G.phase === "turn" && G.turn === i && !!r && !r.locked && !r.point ? r : null; };
export function canRoll(G, i) { return !!mine(G, i); }
// (werkt op de spelstand én op view(): die kent geen aantal worpen, alleen of je al gegooid hebt)
const started = (r) => (r.n != null ? r.n > 0 : !r.first);
export function canDone(G, i) { const r = mine(G, i); return !!r && started(r); }
export function canQuick(G, i) { const r = mine(G, i); return !!r && !started(r) && !G.R.throwoff && i === G.R.queue[0]; }
export function canHold(G, i) { const r = mine(G, i); return !!r && started(r) && !!r.d && !G.R.throwoff; }
export function mustPoint(G, i) { const r = G.R && G.R.res[i]; return G.phase === "turn" && G.turn === i && !!r && r.point; }

function doRoll(G, i, now, quick) {
  const r = G.R.res[i];
  if (finished(G, r)) {
    // te vaak: die worp gaat niet door, wel een adje, en je beurt is voorbij
    adje(G, i, r.s === 1000 ? "na Mex nog gooien" : "te vaak gegooid");
    endTurn(G, i, now);
    return;
  }
  if (quick) { r.quick = true; push(G, { k: "quick", by: i }); logl(G, `${G.players[i].name} gaat voor een quick.`); }
  // laten liggen: één steen, één worp
  let keep = null;
  if (r.hold != null && r.d) {
    if (r.d[r.hold] <= 2) keep = r.hold;
    else adje(G, i, "verkeerde steen laten liggen");
  } else if (r.n > 0 && freshLow(r) && r.s !== 1000) {
    adje(G, i, "1 of 2 niet laten liggen");
  }
  const d = keep === 0 ? [r.d[0], die()] : keep === 1 ? [die(), r.d[1]] : roll2();
  const s = score(d);
  r.d = d; r.s = s; r.n++; r.hold = null; r.prev = keep;
  push(G, { k: "roll", by: i, d, s, keep });
  if (s === 31) {
    // 31: iemand aanwijzen, en deze worp telt niet
    r.n--; r.point = true;
    plan(G, now, T.roll);
    return;
  }
  if (s === 1000) { G.R.mexes++; G.R.stake *= 2; G.players[i].mex++; }
  // computers stoppen zelf netjes; mensen moeten zelf op "klaar" drukken
  if (!G.players[i].human && finished(G, r)) { r.locked = true; G.wait = now + T.roll + T.afterLast; }
  else plan(G, now, T.roll);
}

function doPoint(G, i, to, now) {
  const r = G.R.res[i];
  r.point = false;
  G.players[to].drinks++; G.players[i].pointed++;
  push(G, { k: "point", by: i, to });
  logl(G, `${G.players[i].name} gooit 31 en wijst ${G.players[to].name} aan: slok!`);
  r.d = null; r.s = 0; r.hold = null; r.prev = null;   // die worp telt niet: opnieuw, met allebei de stenen
  plan(G, now);
}

function doDone(G, i, now) {
  const r = G.R.res[i];
  if (!finished(G, r)) adje(G, i, "te vroeg gestopt");
  endTurn(G, i, now);
}

function endTurn(G, i, now) {
  const r = G.R.res[i];
  r.locked = true;
  if (!G.R.throwoff && i === G.R.queue[0] && !G.R.maxSet) { G.R.max = Math.max(1, r.n); G.R.maxSet = true; }
  push(G, { k: "stop", by: i });
  const q = G.R.queue, k = q.indexOf(i);
  if (k < q.length - 1) {
    G.turn = q[k + 1];
    G.R.res[G.turn] = fresh();
    plan(G, now, T.afterLast / 2);
  } else settle(G, now);
}

function settle(G, now) {
  const q = G.R.queue, low = Math.min(...q.map((i) => G.R.res[i].s));
  const lows = q.filter((i) => G.R.res[i].s === low);
  if (!G.R.first) G.R.first = JSON.parse(JSON.stringify(G.R.res));   // de eigenlijke ronde (voor de uitslag)
  if (lows.length > 1) {
    // afgooien: alleen de gelijke laagsten, één worp
    G.R.throwoff++;
    G.R.queue = lows; G.R.res = {};
    G.turn = lows[0]; G.R.res[G.turn] = fresh();
    push(G, { k: "throwoff", who: lows });
    logl(G, `Gelijk: ${lows.map((i) => G.players[i].name).join(" en ")} gooien af.`);
    plan(G, now, T.afterLast);
    return;
  }
  const L = lows[0], P = G.players[L];
  // quick verloren (in de ronde zelf, ook als het daarna op afgooien uitkwam): dubbel
  const quick = !!G.R.first[L].quick;
  const st = G.R.stake * (quick ? 2 : 1);
  P.lost++; P.drinks += st;
  G.loser = L;
  G.result = { first: G.R.first, low: G.R.res[L].s, stake: st, quick, mexes: G.R.mexes };
  push(G, { k: "lose", by: L, stake: st });
  logl(G, `${P.name} verliest ronde ${G.round}${quick ? " met een quick" : ""}: ${st} slok${st > 1 ? "ken" : ""}.`);
  G.phase = "roundEnd"; G.wait = now + T.roundEnd;
}

// wat gebeurt er vanzelf, en wanneer
function plan(G, now, extra = 0) {
  G.wait = null;
  if (G.phase !== "turn") return;
  const r = G.R.res[G.turn];
  if (r && r.locked) { G.wait = now + extra + T.afterLast; return; }
  if (!G.players[G.turn].human) G.wait = now + extra + rand(...(r && r.point ? T.point : T.think));
}
export function nextDue(G) { return G.wait; }

// computer: speelt foutloos. Laat een 1 of 2 liggen, gooit door tot Mex of het maximum; als voorgooier af en toe een quick.
function botMove(G, i) {
  const r = G.R.res[i];
  if (r.point) return "point";
  if (r.n === 0) return canQuick(G, i) && Math.random() < 0.08 ? "quick" : "roll";
  if (finished(G, r)) return "done";
  if (r.hold == null && freshLow(r) && !G.R.throwoff) r.hold = [0, 1].find((k) => k !== r.prev && r.d[k] <= 2);
  return "roll";
}
function botTarget(G, i) {
  const opts = G.players.map((_, j) => j).filter((j) => j !== i);
  const w = opts.map((j) => (G.players[j].human ? 2 : 1)), tot = w.reduce((a, b) => a + b, 0);
  let x = Math.random() * tot;
  for (let k = 0; k < opts.length; k++) { x -= w[k]; if (x < 0) return opts[k]; }
  return opts[0];
}

export function tick(G, now) {
  if (G.wait == null || now < G.wait) return false;
  G.wait = null;
  if (G.phase === "roundEnd") { startRound(G, G.loser, now); return true; }
  if (G.phase !== "turn") return false;
  const i = G.turn, r = G.R.res[i];
  if (r.locked) { endTurn(G, i, now); return true; }
  if (G.players[i].human) return false;
  const m = botMove(G, i);
  if (m === "point") doPoint(G, i, botTarget(G, i), now);
  else if (m === "done") endTurn(G, i, now);
  else doRoll(G, i, now, m === "quick");
  return true;
}

// een mens doet iets. Geeft een foutmelding terug, of niets als het gelukt is.
// Let op: foutmeldingen hier gaan alleen over wat écht niet kan (niet jouw beurt), nooit over spelregels.
export function act(G, i, a, now) {
  if (!a) return "Onbekende actie.";
  switch (a.type) {
    case "roll": if (!canRoll(G, i)) return "Je bent nu niet aan de beurt."; doRoll(G, i, now, false); return;
    case "quick": if (!canQuick(G, i)) return "Een quick kan alleen bij de eerste worp van de ronde."; doRoll(G, i, now, true); return;
    case "done": if (!canDone(G, i)) return "Eerst gooien."; doDone(G, i, now); return;
    case "hold": {
      if (!canHold(G, i)) return "Je kunt nu geen steen laten liggen.";
      const k = a.i === 0 || a.i === 1 ? a.i : null, r = G.R.res[i];
      if (k != null && k === r.prev) return "Die steen lag al: die gooi je nu mee.";
      r.hold = r.hold === k ? null : k;   // nog eens tikken = weer oppakken
      return;
    }
    case "point": {
      const to = +a.to;
      if (!mustPoint(G, i)) return "Je hoeft nu niemand aan te wijzen.";
      if (!(to >= 0 && to < G.players.length) || to === i) return "Kies iemand anders.";
      doPoint(G, i, to, now); return;
    }
    case "next": if (G.phase !== "roundEnd") return; G.wait = now; tick(G, now); return;
  }
  return "Onbekende actie.";
}

export function setHuman(G, i, human, now) {
  const p = G.players[i]; if (!p) return;
  p.human = !!human;
  if (G.phase === "turn" && G.turn === i) plan(G, now);
}

// Wat een speler te zien krijgt: de stenen die nu op tafel liggen (en welke vast ligt), wie aan de beurt is,
// wie al klaar is. Geen aantal worpen, geen maximum, geen inzet, geen eerdere worpen.
export function view(G, me) {
  const V = { v: G.v, round: G.round, seq: G.seq, log: G.log, phase: G.phase, starter: G.starter, turn: G.turn,
    loser: G.loser, result: G.phase === "roundEnd" ? G.result : null, me: me == null ? null : me,
    players: G.players.map((p) => ({ name: p.name, human: p.human, avatar: p.avatar, drinks: p.drinks, adje: p.adje, lost: p.lost, mex: p.mex, pointed: p.pointed, botified: p.botified })),
    ev: G.ev.map((e) => (e.k === "roll" ? (G.phase === "turn" && e.by === G.turn ? { k: "roll", seq: e.seq, by: e.by, d: e.d, s: e.s, keep: e.keep } : { k: "roll", seq: e.seq, by: e.by, old: true }) : e)) };
  if (G.R) {
    const res = {};
    for (const [i, r] of Object.entries(G.R.res)) {
      const cur = G.phase === "turn" && +i === G.turn;
      res[i] = cur ? { d: r.d, s: r.s, quick: r.quick, point: r.point, locked: r.locked, hold: r.hold, prev: r.prev, first: r.n === 0 } : { quick: r.quick, locked: r.locked };
    }
    V.R = { queue: G.R.queue, throwoff: G.R.throwoff, res };
  }
  return V;
}
