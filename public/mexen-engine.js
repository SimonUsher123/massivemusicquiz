// Mexen: de spelregels en computerspelers, zonder scherm. Draait in de browser (tegen de computer) én in de
// Cloudflare-server (online), zodat beide precies hetzelfde spel spelen. Alles is open: iedereen ziet de worp.
//
// Regels
//  - Twee stenen. De hoogste steen is het tiental: 6 en 3 = 63. 32 is de laagste gewone worp.
//  - Dubbel = honderdtal: 1-1 = 100 … 6-6 = 600. Elk dubbel is hoger dan elke gewone worp.
//  - 2-1 = Mex: de hoogste worp. Elke mex in een ronde verdubbelt de inzet (1 → 2 → 4 …).
//  - 3-1: je wijst iemand aan die een slok drinkt, en gooit opnieuw (die worp telt niet mee).
//  - De voorgooier gooit maximaal 3 keer; zijn aantal worpen is het maximum voor de rest van de ronde.
//    Je laatste worp telt (je kunt niet terug naar een eerdere).
//  - Quick: vóór je eerste worp kun je kiezen voor maar één worp. Verlies je de ronde daarmee, dan drink je
//    dubbel. Neemt de voorgooier een quick, dan is het maximum voor iedereen 1.
//  - De laagste drinkt de inzet. Gelijke laagsten gooien één keer af, zo nodig opnieuw. De verliezer begint
//    de volgende ronde. Er is geen einde: de stand houdt de slokken bij.
//
// Onthouden hoort bij het spel: tijdens een ronde laat view() alleen de worp zien van wie nu gooit. Wie klaar is,
// is klaar, zonder score. Pas aan het eind van de ronde gaat alles open.
//
// De spelstand G is gewone JSON (de server bewaart hem). Tijd komt altijd van buiten (`now`): wat er straks
// vanzelf moet gebeuren (een computer die gooit, de volgende ronde) staat als tijdstip in G.wait.

export const VERSION = "1.6.0";
export const AVATARS = ["😎", "🧔", "👩‍🦰", "👴", "🧑‍🎤", "🤠", "👵", "🧙"];
export const BOT_NAMES = ["Henk", "Ingrid", "Kees", "Fleur", "Joop", "Mien", "Sjaak", "Truus"];
export const MIN = 2, MAX = 8;
// tempo (ms)
export const T = { roll: 900, think: [700, 1300], afterLast: 1300, point: [900, 1600], roundEnd: 6000 };

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
    players: seats.map((s) => ({ name: s.name, human: !!s.human, avatar: s.avatar, drinks: 0, lost: 0, mex: 0, pointed: 0 })),
    phase: "turn", starter: Math.floor(Math.random() * seats.length), wait: null,
  };
  startRound(G, G.starter, now);
  return G;
}

const order = (G, from) => G.players.map((_, k) => (from + k) % G.players.length);
const fresh = () => ({ d: null, s: 0, n: 0, quick: false, locked: false, point: false });

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
// kort logboek met alleen wat iedereen toch hoort (mex, 31, quick, verliezer): geen scores van tussendoor
function logl(G, t) { G.log.unshift(t); if (G.log.length > 4) G.log.length = 4; }

const limit = (G, r) => (G.R.throwoff || r.quick ? 1 : G.R.max);
const busy = (r) => r.locked || r.point;
export function canRoll(G, i) { const r = G.R && G.R.res[i]; return G.phase === "turn" && G.turn === i && !!r && !busy(r) && r.n < limit(G, r); }
export function canStop(G, i) { const r = G.R && G.R.res[i]; return G.phase === "turn" && G.turn === i && !!r && !busy(r) && r.n > 0; }
export function canQuick(G, i) { const r = G.R && G.R.res[i]; return canRoll(G, i) && r.n === 0 && !G.R.throwoff && G.R.max > 1; }
export function mustPoint(G, i) { const r = G.R && G.R.res[i]; return G.phase === "turn" && G.turn === i && !!r && r.point; }
export const maxFor = (G, i) => (G.R && G.R.res[i] ? limit(G, G.R.res[i]) : G.R ? G.R.max : 3);

function doRoll(G, i, now, quick) {
  const r = G.R.res[i];
  if (quick) { r.quick = true; push(G, { k: "quick", by: i }); logl(G, `${G.players[i].name} gaat voor een quick.`); }
  const d = roll2(), s = score(d);
  r.d = d; r.s = s; r.n++;
  push(G, { k: "roll", by: i, d, s, n: r.n, quick: r.quick });
  if (s === 31) {
    // 31: iemand aanwijzen, en deze worp telt niet
    r.n--; r.point = true;
    plan(G, now, T.roll);
    return;
  }
  if (s === 1000) {
    G.R.mexes++; G.R.stake *= 2; G.players[i].mex++;
    logl(G, `${G.players[i].name} gooit Mex! Inzet nu ${G.R.stake}.`);
  }
  // klaar als het maximum bereikt is, of bij Mex (hoger kan niet)
  if (r.n >= limit(G, r) || s === 1000) { r.locked = true; G.wait = now + T.roll + T.afterLast; }
  else plan(G, now, T.roll);
}

function doPoint(G, i, to, now) {
  const r = G.R.res[i];
  r.point = false;
  G.players[to].drinks++; G.players[i].pointed++;
  push(G, { k: "point", by: i, to });
  logl(G, `${G.players[i].name} gooit 31 en wijst ${G.players[to].name} aan: slok!`);
  r.d = null; r.s = 0;   // die worp telt niet: opnieuw
  plan(G, now);
}

function endTurn(G, i, now) {
  const r = G.R.res[i];
  r.locked = true;
  if (!G.R.throwoff && i === G.R.queue[0] && !G.R.maxSet) {
    G.R.max = r.n; G.R.maxSet = true;
    if (r.n < 3) logl(G, `${G.players[i].name} stopt na ${r.n} worp${r.n > 1 ? "en" : ""}: maximum is ${r.n}.`);
  }
  push(G, { k: "stop", by: i });
  const q = G.R.queue, k = q.indexOf(i);
  if (k < q.length - 1) {
    G.turn = q[k + 1];
    G.R.res[G.turn] = fresh();
    plan(G, now);
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
    logl(G, `Gelijk laagst (${short(low)}): ${lows.map((i) => G.players[i].name).join(" en ")} gooien af.`);
    plan(G, now, T.afterLast);
    return;
  }
  const L = lows[0], P = G.players[L];
  // quick verloren (in de ronde zelf, ook als het daarna op afgooien uitkwam): dubbel
  const quick = !!G.R.first[L].quick;
  const st = G.R.stake * (quick ? 2 : 1);
  P.lost++; P.drinks += st;
  G.loser = L;
  G.result = { first: G.R.first, off: G.R.throwoff ? G.R.res : null, low: G.R.res[L].s, stake: st, quick, mexes: G.R.mexes };
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

// computer: gooi door zolang je (bijna) de laagste bent en worpen over hebt.
// Computers onthouden niet alles: ze kennen de laagste worp tot nu toe maar soms net verkeerd.
function botMove(G, i) {
  const r = G.R.res[i];
  if (r.point) return "point";
  const others = G.R.queue.filter((j) => j !== i && G.R.res[j] && G.R.res[j].locked).map((j) => G.R.res[j].s);
  const low = others.length ? Math.min(...others) : null;
  if (r.n === 0) {
    if (canQuick(G, i) && Math.random() < (low != null && low < 43 ? 0.25 : 0.05)) return "quick";
    return "roll";
  }
  if (r.n >= limit(G, r) || r.s === 1000) return "stop";
  if (low == null) return r.s < (r.n === 1 ? 54 : 43) ? "roll" : "stop";   // voorgooier
  return r.s > low ? "stop" : "roll";                                       // er is al iemand lager
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
  else if (m === "stop") endTurn(G, i, now);
  else doRoll(G, i, now, m === "quick");
  return true;
}

// een mens doet iets. Geeft een foutmelding terug, of niets als het gelukt is.
export function act(G, i, a, now) {
  if (!a) return "Onbekende actie.";
  switch (a.type) {
    case "roll": if (!canRoll(G, i)) return "Je kunt nu niet gooien."; doRoll(G, i, now, false); return;
    case "quick": if (!canQuick(G, i)) return "Een quick kan nu niet."; doRoll(G, i, now, true); return;
    case "stop": if (!canStop(G, i)) return "Je kunt nu niet stoppen."; endTurn(G, i, now); return;
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

// Wat een speler te zien krijgt. Tijdens de ronde: alleen de worp van wie nu gooit; van de rest alleen of ze
// klaar zijn, hoeveel worpen ze deden en of het een quick was. Worpen van eerder in de ronde staan er niet in.
export function view(G, me) {
  const V = { v: G.v, round: G.round, seq: G.seq, log: G.log, phase: G.phase, starter: G.starter, turn: G.turn,
    loser: G.loser, result: G.phase === "roundEnd" ? G.result : null, me: me == null ? null : me,
    players: G.players.map((p) => ({ name: p.name, human: p.human, avatar: p.avatar, drinks: p.drinks, lost: p.lost, mex: p.mex, pointed: p.pointed, botified: p.botified })),
    ev: G.ev.map((e) => (e.k === "roll" && !(G.phase === "turn" && e.by === G.turn) ? { k: "roll", seq: e.seq, by: e.by, old: true } : e)) };
  if (G.R) {
    const res = {};
    for (const [i, r] of Object.entries(G.R.res)) {
      const cur = G.phase === "turn" && +i === G.turn;
      res[i] = cur ? { ...r } : { n: r.n, quick: r.quick, locked: r.locked };
    }
    V.R = { queue: G.R.queue, max: G.R.max, maxSet: G.R.maxSet, stake: G.R.stake, mexes: G.R.mexes, throwoff: G.R.throwoff, res };
  }
  return V;
}
