// Mexen: het scherm. De spelregels staan in mexen-engine.js.
//  - tegen de computer: het spel draait hier in de browser;
//  - online: het spel draait op de server (worker/mex-room.js), iedereen op een eigen apparaat, met chat;
//  - alleen dobbelstenen: gewoon gooien;
//  - testmodus: 1 miljoen worpen met dezelfde dobbelsteenfunctie als het spel, plus statistische toetsen.
import * as E from "./mexen-engine.js";
import { runTest } from "./mexen-test.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CALM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ROLL_MS = CALM ? 150 : 750;

// ---------- Instellingen ----------
let cfg = (() => {
  let c = null; try { c = JSON.parse(localStorage.getItem("mex_cfg")); } catch (e) {}
  if (!(c && c.n >= E.MIN && c.n <= E.MAX)) c = { n: 4 };
  if (typeof c.myName !== "string") { try { c.myName = (JSON.parse(localStorage.getItem("pres_cfg")) || {}).myName || ""; } catch (e) { c.myName = ""; } }
  return c;
})();
const saveCfg = () => { try { localStorage.setItem("mex_cfg", JSON.stringify(cfg)); } catch (e) {} };
function token() {
  try {
    let t = sessionStorage.getItem("pres_token") || localStorage.getItem("pres_token");
    if (!t) { t = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20); localStorage.setItem("pres_token", t); }
    return t;
  } catch (e) { return "anon" + Math.random().toString(36).slice(2, 12); }
}

// ---------- Dobbelsteen tekenen ----------
const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const dieHTML = (v, cls = "") => `<span class="die ${cls}" ${v ? `data-v="${v}" role="img" aria-label="${v}"` : 'aria-hidden="true"'}>${
  Array.from({ length: 9 }, (_, k) => `<i${v && PIPS[v].includes(k + 1) ? ' class="on"' : ""}></i>`).join("")}</span>`;
const scoreText = (s) => (s === 1000 ? "MEX!" : s === 31 ? "31: wijs iemand aan" : s >= 100 ? `${s}` : String(s));
// laat stenen rollen in el en eindig op d; cb daarna
function tumble(el, d, cb) {
  const t0 = performance.now();
  el.classList.add("rolling");
  const step = () => {
    if (performance.now() - t0 >= ROLL_MS) { el.classList.remove("rolling"); el.innerHTML = d.map((v) => dieHTML(v)).join(""); cb && cb(); return; }
    el.innerHTML = [E.die(), E.die()].map((v) => dieHTML(v)).join("");
    setTimeout(step, 70);
  };
  step();
}

// ---------- Panelen ----------
const PANELS = ["setup", "lobby", "game", "free", "test"];
function showPanel(w) {
  PANELS.forEach((p) => ($("m" + p[0].toUpperCase() + p.slice(1)).hidden = p !== w));
  (w === "lobby" ? $("mLobby") : $("mGame")).appendChild($("mChat"));
  renderChat();
}
let toastT = null;
function toast(msg, sticky) { const t = $("mToast"); t.textContent = msg; t.hidden = !msg; clearTimeout(toastT); if (msg && !sticky) toastT = setTimeout(() => (t.hidden = true), 3500); }

function renderSetup() {
  $("mCount").innerHTML = [2, 3, 4, 5, 6, 7, 8].map((n) => `<button type="button" class="seg${cfg.n === n ? " on" : ""}" data-n="${n}" aria-pressed="${cfg.n === n}">${n}</button>`).join("");
  $("mMyName").value = cfg.myName;
}
$("mCount").onclick = (e) => { const b = e.target.closest("[data-n]"); if (!b) return; cfg.n = +b.dataset.n; saveCfg(); renderSetup(); };
$("mMyName").oninput = (e) => { cfg.myName = e.target.value.trim().slice(0, 14); saveCfg(); };
$("mStart").onclick = startLocal;
$("mCreate").onclick = () => { if (!cfg.myName) { $("mMyName").focus(); toast("Vul eerst je naam in."); return; } connect(newCode(), true); };
$("mFreeBtn").onclick = () => { showPanel("free"); renderFree(); };
$("mTestBtn").onclick = () => showPanel("test");
document.querySelectorAll("#mexView [data-mback]").forEach((b) => (b.onclick = () => showPanel("setup")));
$("mQuit").onclick = () => {
  if (S && S.mode === "online") {
    if (S.host) { if (confirm("Het spel stoppen voor iedereen? Jullie gaan terug naar de wachtruimte.")) wsSend({ t: "end" }); }
    else if (confirm("Het spel verlaten? Met dezelfde link kom je later terug op je plek.")) leaveOnline();
    return;
  }
  if (!confirm("Dit spel stoppen?")) return;
  stopLocal(); showPanel("setup");
};
renderSetup();

// ---------- Sessie ----------
let S = null;
const ui = { V: null, lastSeq: null, shown: null, rollingUntil: 0, says: {}, sayT: null, chatSeen: null, pointing: false };
function resetUi() { Object.assign(ui, { V: null, lastSeq: null, shown: null, rollingUntil: 0, says: {}, chatSeen: null, pointing: false }); renderChat(); }
function sayAt(i, text) { ui.says[i] = { text, until: Date.now() + 4500 }; clearTimeout(ui.sayT); ui.sayT = setTimeout(update, 4550); }

function startLocal() {
  stopLocal(); if (S && S.mode === "online") leaveOnline(null, true);
  const me = cfg.myName || "Jij", bots = E.BOT_NAMES.filter((b) => b.toLowerCase() !== me.toLowerCase());
  const seats = Array.from({ length: cfg.n }, (_, i) => (i === 0 ? { name: me, human: true, avatar: E.AVATARS[0] } : { name: bots[i - 1], human: false, avatar: E.AVATARS[i] }));
  S = { mode: "local", G: E.newGame(seats, Date.now()), timer: null };
  resetUi(); showPanel("game"); update();
}
function stopLocal() { if (S && S.mode === "local") { clearTimeout(S.timer); S = null; } }
function update() {
  if (!S) return;
  if (S.mode === "local") {
    render(E.view(S.G, 0));
    clearTimeout(S.timer);
    const nd = E.nextDue(S.G);
    if (nd != null) S.timer = setTimeout(() => { if (S && S.mode === "local") { E.tick(S.G, Date.now()); update(); } }, Math.max(0, nd - Date.now()) + 5);
  } else if (S.V) render(S.V);
}
function send(a) {
  if (!S || !ui.V || ui.V.me == null) return;
  if (S.mode === "local") { const err = E.act(S.G, 0, a, Date.now()); if (err) toast(err); update(); }
  else wsSend({ t: "act", a });
}

// ---------- Online ----------
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
const shareUrl = (code) => `${location.origin}${location.pathname}?mex=${code}`;
function connect(code, create) {
  stopLocal(); if (S && S.mode === "online") leaveOnline(null, true);
  S = { mode: "online", code, create, ws: null, V: null, lobby: null, host: false, online: [], botified: [], retry: 0, closed: false, ping: null, chat: [], humans: 1 };
  resetUi();
  history.replaceState(null, "", `?mex=${code}`);
  showPanel("lobby"); $("mLobbyMain").innerHTML = `<h2>Verbinden…</h2>`;
  openWs();
}
function openWs() {
  const s = S, ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/mws/${s.code}`);
  s.ws = ws;
  ws.onopen = () => {
    s.retry = 0; toast("");
    ws.send(JSON.stringify({ t: "hello", token: token(), name: cfg.myName, create: s.create }));
    clearInterval(s.ping); s.ping = setInterval(() => { if (ws.readyState === 1) ws.send("ping"); }, 25000);
  };
  ws.onmessage = (e) => {
    if (S !== s || e.data === "pong") return;
    let m; try { m = JSON.parse(e.data); } catch (x) { return; }
    if (m.t === "err") {
      if (m.code === "exists" && s.create) { s.code = newCode(); history.replaceState(null, "", `?mex=${s.code}`); s.ws.onclose = null; s.ws.close(); openWs(); return; }
      if (m.fatal) { leaveOnline(m.msg); return; }
      toast(m.msg); return;
    }
    s.create = false; s.host = m.host; s.hostName = m.hostName; s.humans = m.humans || 1; s.chat = m.chat || [];
    chatArrived();
    if (m.t === "lobby") { s.lobby = m; s.V = null; ui.lastSeq = null; showPanel("lobby"); renderLobby(); }
    else if (m.t === "state") { s.V = m.v; s.online = m.online || []; s.botified = m.botified || []; if ($("mGame").hidden) { showPanel("game"); ui.lastSeq = null; } update(); }
  };
  ws.onclose = () => {
    clearInterval(s.ping);
    if (S !== s || s.closed || s.ws !== ws) return;
    toast("Verbinding weg, opnieuw verbinden…", true);
    setTimeout(() => { if (S === s && !s.closed) openWs(); }, Math.min(8000, 600 * 2 ** s.retry++));
  };
}
function wsSend(m) { if (S && S.mode === "online" && S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(m)); else toast("Geen verbinding."); }
function leaveOnline(msg, quiet) {
  if (S && S.mode === "online") { S.closed = true; clearInterval(S.ping); try { S.ws.close(); } catch (e) {} }
  S = null; resetUi();
  history.replaceState(null, "", location.pathname);
  if (!quiet) { showPanel("setup"); renderSetup(); if (msg) toast(msg); }
}
function renderLobby() {
  const L = S.lobby, url = shareUrl(L.code);
  const seats = L.seats.map((s, i) => `<li><span class="mini-ava" aria-hidden="true">${E.AVATARS[i]}</span>
      <b>${esc(s.name)}</b>${s.you ? ' <span class="badge">jij</span>' : ""}${s.host ? ' <span class="badge">host</span>' : ""}
      ${s.online ? "" : '<span class="badge off">weg</span>'}</li>`).join("");
  const n = Math.max(E.MIN, L.n, L.seats.length), bots = Math.max(0, n - L.seats.length);
  const counts = [2, 3, 4, 5, 6, 7, 8].filter((k) => k >= L.seats.length).map((k) => `<button type="button" class="seg${n === k ? " on" : ""}" data-l="n" data-n="${k}" aria-pressed="${n === k}">${k}</button>`).join("");
  $("mLobbyMain").innerHTML = `<h2>Online mexen <span class="code">${esc(L.code)}</span></h2>
    <div class="share"><input type="text" readonly value="${esc(url)}" aria-label="Link naar dit spel"><button type="button" data-l="share">Deel link</button></div>
    <label class="opt">Jouw naam <input type="text" id="mLobbyName" maxlength="14" value="${esc(cfg.myName)}"></label>
    <ol class="lplayers">${seats}${bots ? `<li class="bots">+ ${bots} computer${bots > 1 ? "s" : ""}</li>` : ""}</ol>
    ${L.host ? `<div class="field"><span class="lbl">Aantal spelers</span><div class="seg-row multi">${counts}</div></div>
      <button type="button" data-l="start">Start spel</button>`
      : `<p class="tag">Wachten tot ${esc(L.hostName || "de host")} het spel start…</p>`}
    <button type="button" class="ghost" data-l="leave">Verlaten</button>`;
}
$("mLobby").onclick = async (e) => {
  const b = e.target.closest("[data-l]"); if (!b || !S || S.mode !== "online") return;
  const url = shareUrl(S.code);
  switch (b.dataset.l) {
    case "share":
      if (navigator.share) { try { await navigator.share({ title: "Mexen", text: "Kom mexen", url }); return; } catch (x) {} }
      try { await navigator.clipboard.writeText(url); toast("Link gekopieerd."); } catch (x) { toast(url, true); }
      break;
    case "n": wsSend({ t: "setN", n: +b.dataset.n }); break;
    case "start": wsSend({ t: "start" }); break;
    case "leave": wsSend({ t: "leave" }); leaveOnline(); break;
  }
};
$("mLobby").addEventListener("change", (e) => {
  if (e.target.id !== "mLobbyName") return;
  cfg.myName = e.target.value.trim().slice(0, 14); saveCfg();
  if (cfg.myName) wsSend({ t: "name", name: cfg.myName });
});
function askNameAndJoin(code) {
  showPanel("lobby");
  $("mLobbyMain").innerHTML = `<h2>Meedoen met mexen <span class="code">${esc(code)}</span></h2>
    <label class="opt">Jouw naam <input type="text" id="mJoinName" maxlength="14" value="${esc(cfg.myName)}" autocomplete="nickname"></label>
    <button type="button" id="mJoinGo">Meedoen</button>
    <button type="button" class="ghost" id="mJoinCancel">Annuleren</button>`;
  const go = () => { const n = $("mJoinName").value.trim().slice(0, 14); if (!n) { $("mJoinName").focus(); return; } cfg.myName = n; saveCfg(); connect(code, false); };
  $("mJoinGo").onclick = go; $("mJoinName").onkeydown = (e) => { if (e.key === "Enter") go(); };
  $("mJoinCancel").onclick = () => { history.replaceState(null, "", location.pathname); showPanel("setup"); };
}

// ---------- Chat ----------
const chatOn = () => !!(S && S.mode === "online" && S.humans > 1);
function chatArrived() {
  const list = S.chat || [], last = list.length ? list[list.length - 1].id : 0;
  if (ui.chatSeen != null) list.filter((c) => c.id > ui.chatSeen && c.i != null).forEach((c) => sayAt(c.i, c.text));
  ui.chatSeen = last; renderChat();
}
function renderChat() {
  const box = $("mChat"); box.hidden = !chatOn(); if (box.hidden) return;
  const list = $("mChatList"), atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
  list.innerHTML = (S.chat || []).map((c) => `<div><b>${esc(c.name)}</b> ${esc(c.text)}</div>`).join("") || '<div class="tag">Nog geen berichten.</div>';
  if (atEnd) list.scrollTop = list.scrollHeight;
}
$("mChatForm").onsubmit = (e) => { e.preventDefault(); const t = $("mChatText").value.trim(); if (!t) return; wsSend({ t: "chat", text: t }); $("mChatText").value = ""; };

// ---------- Weergave ----------
const myTurn = (V) => V.me != null && V.phase === "turn" && V.turn === V.me;
const cur = (V) => (V.R && V.R.res[V.turn]) || null;
function render(V) {
  ui.V = V;
  // nieuwe worpen: laten rollen
  let fresh = [];
  if (ui.lastSeq == null) ui.lastSeq = V.seq;
  else if (V.seq > ui.lastSeq) { fresh = V.ev.filter((e) => e.seq > ui.lastSeq); ui.lastSeq = V.seq; }
  fresh.filter((e) => e.k === "point").forEach((e) => sayAt(e.by, `👉 ${V.players[e.to].name}, drinken!`));
  fresh.filter((e) => e.k === "quick").forEach((e) => sayAt(e.by, "Quick!"));
  fresh.filter((e) => e.k === "roll" && e.s === 1000).forEach((e) => sayAt(e.by, "MEX! 🍻"));
  const roll = [...fresh].reverse().find((e) => e.k === "roll" && e.d);
  if (!V.players.length) return;
  $("mRound").textContent = `Ronde ${V.round}${S && S.mode === "online" ? ` · spel ${S.code}` : ""}`;
  renderSeats(V); renderTurn(V); renderActions(V); renderStats(V);
  $("mLog").innerHTML = V.log.map((t) => `<div>${esc(t)}</div>`).join("");
  renderCenter(V, roll);
}
function base(V) { return V.me != null ? V.me : 0; }
function renderSeats(V) {
  const n = V.players.length, online = S && S.mode === "online", R = V.R;
  $("mSeats").innerHTML = V.players.map((p, i) => {
    const k = (i - base(V) + n) % n, a = (90 + (k * 360) / n) * Math.PI / 180;
    const rx = innerWidth < 640 ? 37 : 45, x = 50 + rx * Math.cos(a), y = 50 + 42 * Math.sin(a);
    const r = R && R.res[i], turn = V.phase === "turn" && V.turn === i;
    const inRound = R && R.queue.includes(i);
    const gone = online && S.online[i] === false;
    // tijdens de ronde géén scores: alleen of je klaar bent (en hoeveel worpen / quick)
    let st = "";
    if (V.phase === "roundEnd" && V.result) {
      const f = V.result.first[i];
      st = `<span class="mres${i === V.loser ? " lose" : ""}">${f ? E.short(f.s) : ""}${f && f.quick ? " ⚡" : ""}</span>`;
    } else if (r && r.locked) st = `<span class="mres done">✓${r.quick ? " ⚡" : ""}</span>`;
    else if (turn && r && r.quick) st = `<span class="mres">⚡ quick</span>`;
    const sy = ui.says[i] && ui.says[i].until > Date.now() ? ui.says[i] : null;
    const take = online && S.host && gone && !S.botified[i] ? `<button type="button" class="ghost mini takeover" data-botify="${i}">Computer neemt over</button>` : "";
    const pointable = ui.pointing && myTurn(V) && i !== V.me;
    return `<div class="seat${turn ? " turn" : ""}${!inRound && V.phase === "turn" ? " passed" : ""}${gone ? " gone" : ""}${pointable ? " pointable" : ""}" style="left:${x}%;top:${y}%">
      ${sy ? `<div class="say" role="status">${esc(sy.text)}</div>` : ""}
      ${pointable ? `<button type="button" class="ava" data-point="${i}" aria-label="Wijs ${esc(p.name)} aan">${p.avatar}</button>` : `<div class="ava">${p.avatar}${i === V.starter && V.phase === "turn" ? '<span class="crown" aria-hidden="true">🎲</span>' : ""}${gone ? '<span class="bubble off">weg</span>' : ""}</div>`}
      <div class="nm">${esc(p.name)}${p.human ? "" : ' <span class="bot" aria-label="computer">🤖</span>'}</div>
      <div class="sips">🍺 ${p.drinks}</div>${st}${take}</div>`;
  }).join("");
}
function renderCenter(V, roll) {
  const c = $("mCenter");
  let info = "";
  const R = V.R, r = cur(V);
  if (V.phase === "roundEnd" && V.result) {
    const L = V.players[V.loser], res = V.result;
    c.dataset.k = "end";
    c.innerHTML = `<div class="dice small">${dieHTML(0, "blank")}${dieHTML(0, "blank")}</div>
      <div class="cscore lose">${esc(L.name)} drinkt ${res.stake}</div>
      <div class="cinfo">${E.short(res.low)}${res.quick ? " · quick, dus dubbel" : ""}${res.mexes ? ` · ${res.mexes}× mex` : ""}</div>
      ${S && S.mode === "local" || V.me != null ? '<button type="button" class="ghost mini" data-act="next">Volgende ronde</button>' : ""}`;
    ui.shown = null; return;
  }
  if (!R) return;
  const who = V.players[V.turn];
  const maxTxt = R.throwoff ? "afgooien: 1 worp" : r && r.quick ? "quick: 1 worp" : R.maxSet ? `max ${R.max}` : "voorgooier, max 3";
  info = `${esc(who.name)} · worp ${r ? r.n : 0} (${maxTxt})${R.stake > 1 ? ` · inzet ${R.stake}` : ""}`;
  const key = `${V.round}.${R.throwoff}.${V.turn}.${r && r.d ? r.d.join("") + r.n : "-"}`;
  if (roll && roll.by === V.turn && r && r.d) {
    // nieuwe worp van wie nu gooit: rollen
    ui.shown = key; ui.rollingUntil = Date.now() + ROLL_MS;
    c.innerHTML = `<div class="dice" id="mDice"></div><div class="cscore" id="mScore">&nbsp;</div><div class="cinfo">${info}</div>`;
    tumble($("mDice"), r.d, () => { const sc = $("mScore"); if (sc) { sc.textContent = scoreText(r.s); sc.className = `cscore${r.s === 1000 ? " mex" : r.s === 31 ? " hot" : r.s >= 100 ? " dbl" : ""}`; } renderActions(ui.V); });
    return;
  }
  if (ui.shown === key && Date.now() < ui.rollingUntil) return;   // rolt nog
  ui.shown = key;
  c.innerHTML = r && r.d
    ? `<div class="dice">${r.d.map((v) => dieHTML(v)).join("")}</div><div class="cscore${r.s === 1000 ? " mex" : r.s === 31 ? " hot" : r.s >= 100 ? " dbl" : ""}">${scoreText(r.s)}</div><div class="cinfo">${info}</div>`
    : `<div class="dice">${dieHTML(0, "blank")}${dieHTML(0, "blank")}</div><div class="cscore">&nbsp;</div><div class="cinfo">${info}</div>`;
}
function renderTurn(V) {
  let h = "", cls = "turnbar";
  if (V.phase === "turn") {
    const r = cur(V);
    if (myTurn(V)) { h = E.mustPoint(V, V.me) ? "31! Tik op wie moet drinken" : r && r.locked ? "Klaar" : "Jij bent aan de beurt"; cls += " me"; }
    else h = `${esc(V.players[V.turn].name)} ${V.R.throwoff ? "gooit af" : "gooit"}`;
  } else if (V.phase === "roundEnd") h = `Ronde ${V.round} klaar`;
  $("mTurn").className = cls; $("mTurn").innerHTML = h;
}
function renderActions(V) {
  const A = [], me = V.me, rolling = Date.now() < ui.rollingUntil;
  ui.pointing = false;
  if (myTurn(V)) {
    if (E.mustPoint(V, me)) {
      ui.pointing = !rolling;
      if (!rolling) A.push(`<div class="pointrow" role="group" aria-label="Wie moet drinken">${V.players.map((p, i) => (i === me ? "" : `<button type="button" class="seg" data-point="${i}">${p.avatar} ${esc(p.name)}</button>`)).join("")}</div>`);
    } else {
      const dis = (ok) => (ok && !rolling ? "" : "disabled");
      A.push(`<button type="button" data-act="roll" ${dis(E.canRoll(V, me))}>🎲 Gooien</button>`);
      if (E.canQuick(V, me)) A.push(`<button type="button" class="ghost" data-act="quick" ${dis(true)} title="Eén worp. Verlies je, dan drink je dubbel.">⚡ Quick</button>`);
    }
    if (rolling) setTimeout(() => ui.V === V && (renderActions(V), renderSeats(V)), ui.rollingUntil - Date.now() + 20);
  }
  $("mActions").innerHTML = A.join("");
}
function renderStats(V) {
  const P = V.players, order = P.map((_, i) => i).sort((a, b) => P[b].drinks - P[a].drinks);
  $("mStatsN").textContent = V.round > 1 ? `na ${V.round - (V.phase === "roundEnd" ? 0 : 1)} rondes` : "";
  $("mStatsBody").innerHTML = `<div class="scroll"><table class="stats"><thead><tr><th></th><th scope="col">Slokken</th><th scope="col">Verloren</th><th scope="col">Mex</th><th scope="col">31</th></tr></thead><tbody>${
    order.map((i) => `<tr${i === V.me ? ' class="me"' : ""}><th scope="row">${P[i].avatar} ${esc(P[i].name)}</th><td>${P[i].drinks}</td><td>${P[i].lost}</td><td>${P[i].mex}</td><td>${P[i].pointed}</td></tr>`).join("")}</tbody></table></div>`;
}
function onAct(e) {
  const bt = e.target.closest("[data-botify]");
  if (bt) { wsSend({ t: "botify", i: +bt.dataset.botify, on: true }); return; }
  const pt = e.target.closest("[data-point]");
  if (pt) { send({ type: "point", to: +pt.dataset.point }); return; }
  const b = e.target.closest("[data-act]"); if (!b || b.disabled || !ui.V) return;
  if (["roll", "quick", "next"].includes(b.dataset.act)) {
    if (b.dataset.act === "quick" && !confirm("Quick: maar één worp. Verlies je de ronde, dan drink je dubbel. Doen?")) return;
    send({ type: b.dataset.act });
  }
}
$("mActions").onclick = onAct; $("mSeats").onclick = onAct; $("mCenter").onclick = onAct;
addEventListener("resize", () => { if (S && !$("mGame").hidden && ui.V) renderSeats(ui.V); });

// ---------- Alleen dobbelstenen ----------
const free = { hist: [], busy: false };
function renderFree() {
  if (!$("mFreeDice").innerHTML) $("mFreeDice").innerHTML = `<span class="dice big">${dieHTML(6)}${dieHTML(6)}</span>`;
  $("mFreeHist").innerHTML = free.hist.length ? `<span class="tag">Laatste worpen</span> ${free.hist.map((s) => `<span class="chipx${s === 1000 ? " mex" : ""}">${E.short(s)}</span>`).join("")}` : "";
}
$("mFreeDice").onclick = () => {
  if (free.busy) return; free.busy = true;
  const d = E.roll2(), s = E.score(d);
  $("mFreeScore").innerHTML = "&nbsp;";
  tumble($("mFreeDice").firstElementChild, d, () => {
    free.busy = false;
    $("mFreeScore").textContent = scoreText(s); $("mFreeScore").className = `freescore${s === 1000 ? " mex" : s === 31 ? " hot" : ""}`;
    free.hist.unshift(s); if (free.hist.length > 5) free.hist.length = 5; renderFree();
  });
};

// ---------- Testmodus ----------
$("mTestRun").onclick = async () => {
  const btn = $("mTestRun"); btn.disabled = true; $("mTestBar").hidden = false; $("mTestOut").innerHTML = "";
  const html = await runTest(1_000_000, E.die, (f) => { $("mTestFill").style.transform = `scaleX(${f})`; });
  $("mTestOut").innerHTML = html; $("mTestBar").hidden = true; btn.disabled = false; btn.textContent = "Nog een miljoen";
};

// via een gedeelde link: meteen naar dat spel
const joinCode = (new URLSearchParams(location.search).get("mex") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
if (joinCode) { cfg.myName ? connect(joinCode, false) : askNameAndJoin(joinCode); }
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") window.__mex = { get S() { return S; }, update };
