/**
 * Online Beukquiz: één Durable Object per quiz (route /qws/<CODE>).
 *
 * Verloop: wachtruimte → host kiest categorie (de browser van de host zoekt de fragmenten op en stuurt ze mee)
 * → ronde: nummer k speelt van t0 + k·SLOT tot + PLAY, daarna PAUSE. Alle apparaten spelen het fragment af op
 * dezelfde servertijd. Antwoorden worden hier nagekeken (public/quiz-core.js); de titel van een nummer gaat pas
 * naar de apparaten als het nummer voorbij is. Computers spelen mee met dezelfde logica als in de quiz alleen.
 */
import { PLAY, LEAD, SLOT, BOTS, words, parseSong, check, botPlan, bonusFor } from "../public/quiz-core.js";

const MAXP = 8, IDLE_MS = 24 * 3600 * 1000, CHAT_KEEP = 40;
const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 14) || "Speler";

export class QuizRoom {
  constructor(state) {
    this.state = state;
    this.room = null;
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    state.blockConcurrencyWhile(async () => { this.room = (await state.storage.get("room")) || null; });
  }

  async fetch(request) {
    const code = new URL(request.url).pathname.split("/").pop();
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ code });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment() || {};
    const now = Date.now();
    if (m.t === "hello") return this.hello(ws, att, m, now);
    const room = this.room, token = att.token;
    if (!room || !token) return;
    room.touched = now;
    const isHost = token === room.host;
    const seat = room.seats.find((s) => s.token === token);
    const lobby = room.phase === "lobby";

    if (m.t === "name" && seat) {
      seat.name = cleanName(m.name);
      const p = room.players && room.players.find((q) => q.token === token);
      if (p) p.name = seat.name;
    } else if (m.t === "setN" && isHost && lobby) {
      room.n = Math.max(1, room.seats.length, Math.min(MAXP, +m.n || 1));
    } else if (m.t === "phone" && isHost && lobby) {
      room.phone = !!m.on;
    } else if (m.t === "leave" && lobby && seat) {
      room.seats = room.seats.filter((s) => s !== seat);
      ws.serializeAttachment({ code: att.code });
      if (isHost) room.host = room.seats[0] ? room.seats[0].token : null;
      if (!room.seats.length) { await this.state.storage.deleteAll(); this.room = null; return; }
    } else if (m.t === "chat" && seat) {
      const text = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!text) return;
      room.chatSeq = (room.chatSeq || 0) + 1;
      room.chat.push({ id: room.chatSeq, name: seat.name, text, at: now });
      if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    } else if (m.t === "start" && isHost && lobby) {
      this.buildPlayers(room);
      room.phase = "pick";
    } else if (m.t === "round" && isHost && (room.phase === "pick" || room.phase === "end")) {
      const songs = Array.isArray(m.songs) ? m.songs.slice(0, 10)
        .filter((s) => s && typeof s.raw === "string" && s.raw.includes("|") && /^https:\/\//.test(String(s.url || "")))
        .map((s) => ({ raw: s.raw.slice(0, 200), url: String(s.url).slice(0, 500) })) : [];
      if (!songs.length) { ws.send(JSON.stringify({ t: "err", msg: "Geen fragmenten ontvangen." })); return; }
      this.startRound(room, String(m.catName || "").slice(0, 30), songs, now);
    } else if (m.t === "next" && isHost && room.phase === "end") {
      room.phase = "pick";
    } else if (m.t === "end" && isHost && !lobby) {
      room.phase = "lobby"; room.players = null; room.round = 0;
    } else if (m.t === "guess" && room.phase === "run") {
      if (!this.guess(room, token, +m.k, String(m.text || "").slice(0, 200), now)) return;
    } else return;
    await this.save();
    this.broadcast();
  }

  async hello(ws, att, m, now) {
    const token = String(m.token || "").slice(0, 64);
    if (!/^[a-z0-9]{8,64}$/.test(token)) return this.fail(ws, "Ongeldige speler.");
    if (!this.room) {
      if (!m.create) return this.fail(ws, "Deze quiz bestaat niet (meer).", "gone");
      this.room = { code: att.code, host: token, seats: [], n: 4, phone: false, phase: "lobby", players: null,
        round: 0, chat: [], chatSeq: 0, touched: now };
    } else if (m.create && !this.room.seats.some((s) => s.token === token)) {
      return this.fail(ws, "Deze code is al in gebruik.", "exists");
    }
    const room = this.room;
    room.touched = now;
    const seat = room.seats.find((s) => s.token === token);
    if (room.phase === "lobby") {
      if (!seat) {
        if (room.seats.length >= MAXP) return this.fail(ws, "Deze quiz zit al vol (8 spelers).", "full");
        room.seats.push({ token, name: cleanName(m.name) });
        if (!room.host) room.host = token;
      } else if (m.name) seat.name = cleanName(m.name);
      room.n = Math.max(room.n, room.seats.length);
    } else if (!seat) return this.fail(ws, "Deze quiz is al begonnen.", "started");
    ws.serializeAttachment({ code: att.code, token });
    await this.save();
    this.broadcast();
  }

  buildPlayers(room) {
    const n = Math.max(1, room.n, room.seats.length);
    const used = new Set(room.seats.map((s) => s.name.toLowerCase()));
    const bots = BOTS.filter(([b]) => !used.has(b.toLowerCase()));
    room.players = room.seats.map((s) => ({ name: s.name, token: s.token, bot: false }));
    for (let i = room.players.length; i < n && bots.length; i++) {
      const [name, skill] = bots.shift();
      room.players.push({ name, token: null, bot: true, skill });
    }
    room.players.forEach((p) => Object.assign(p, { total: 0, round: 0, cups: [0, 0, 0], hist: [], prevRank: null }));
    room.round = 0;
  }

  // ---------- Ronde ----------
  startRound(room, catName, songs, now) {
    room.round++;
    Object.assign(room, { phase: "run", catName, songs, shows: songs.map(() => null), t0: now + (LEAD + 2) * 1000,
      songIdx: 0, doneIdx: -1, results: null });
    room.players.forEach((p) => { p.round = 0; p.hist = []; });
    this.openSong(room, 0);
  }
  openSong(room, k) {
    room.songIdx = k;
    room.cur = room.players.map(() => ({ a: false, t: false, cup: 0, full: false, words: [] }));
    room.cupsGiven = 0;
    room.feed = [];
    const start = room.t0 + k * SLOT, slow = room.phone ? 1.4 : 1;
    room.events = [];
    room.players.forEach((p, i) => {
      if (!p.bot) return;
      const plan = botPlan(p.skill, slow);
      if (plan.a != null) room.events.push({ at: start + plan.a * 1000, i, w: "a", noT: plan.t == null });
      if (plan.t != null) room.events.push({ at: start + plan.t * 1000, i, w: "t" });
    });
    room.events.sort((a, b) => a.at - b.at);
  }
  award(room, i) {
    const s = room.cur[i], p = room.players[i];
    if (s.a && s.t && !s.full) {
      s.full = true;
      if (room.cupsGiven < 3) { room.cupsGiven++; s.cup = room.cupsGiven; p.cups[room.cupsGiven - 1]++; }
      room.feed.unshift(`${p.name} heeft alles goed${s.cup ? ` · beker ${s.cup}` : ""}`);
    }
  }
  botHit(room, ev) {
    const s = room.cur[ev.i], p = room.players[ev.i];
    if (ev.w === "a") { s.a = true; if (ev.noT) room.feed.unshift(`${p.name} heeft de artiest`); }
    else { if (!s.a) room.feed.unshift(`${p.name} heeft de titel`); s.t = true; }
    this.award(room, ev.i);
  }
  guess(room, token, k, text, now) {
    const i = room.players.findIndex((p) => p.token === token);
    if (i < 0 || k !== room.songIdx || room.doneIdx >= k) return false;
    const start = room.t0 + k * SLOT;
    if (now < start - 300 || now > start + PLAY * 1000 + 300) return false;
    const s = room.cur[i];
    words(text).forEach((w) => { if (!s.words.includes(w) && s.words.length < 80) s.words.push(w); });
    const r = check(parseSong(room.songs[k].raw), new Set(s.words));
    if (r.a) s.a = true;
    if (r.t) s.t = true;
    this.award(room, i);
    return true;
  }
  finishSong(room, k) {
    room.players.forEach((p, i) => {
      const s = room.cur[i], pts = (s.a ? .5 : 0) + (s.t ? .5 : 0);
      p.round += pts; p.total += pts; p.hist.push(pts);
    });
    room.shows[k] = parseSong(room.songs[k].raw).show;
    room.doneIdx = k;
  }
  endRound(room) {
    const P = room.players;
    const ranked = P.map((p, i) => i).sort((a, b) => P[b].round - P[a].round || P[b].cups[0] - P[a].cups[0]);
    const bonus = {};
    ranked.forEach((i, pos) => {
      const b = bonusFor(P[i].prevRank, pos + 1);
      if (b) { P[i].total += b; bonus[i] = b; }
      P[i].prevRank = pos + 1;
    });
    room.results = { ranked, bonus };
    room.phase = "end";
  }
  // wat er nu (op tijd `now`) moet gebeuren: computer heeft iets, nummer is afgelopen, volgend nummer begint
  nextStep(room) {
    if (room.phase !== "run") return null;
    const k = room.songIdx, ev = room.events[0];
    const opts = [];
    if (ev) opts.push({ at: ev.at, k: "bot" });
    if (room.doneIdx < k) opts.push({ at: room.t0 + k * SLOT + PLAY * 1000, k: "finish" });
    else opts.push({ at: room.t0 + (k + 1) * SLOT, k: "next" });
    return opts.sort((a, b) => a.at - b.at)[0];
  }
  tick(room, now) {
    let changed = false;
    for (let guard = 0; guard < 300; guard++) {
      const step = this.nextStep(room);
      if (!step || step.at > now) break;
      if (step.k === "bot") this.botHit(room, room.events.shift());
      else if (step.k === "finish") this.finishSong(room, room.songIdx);
      else if (room.songIdx + 1 < room.songs.length) this.openSong(room, room.songIdx + 1);
      else this.endRound(room);
      changed = true;
    }
    return changed;
  }

  // ---------- Versturen ----------
  fail(ws, msg, code) {
    ws.send(JSON.stringify({ t: "err", msg, code: code || "fatal", fatal: true }));
    ws.close(4000, code || "fatal");
  }
  online(gone) {
    const set = new Set();
    for (const w of this.state.getWebSockets()) { if (w === gone) continue; const a = w.deserializeAttachment(); if (a && a.token) set.add(a.token); }
    return set;
  }
  broadcast(gone) {
    const room = this.room;
    if (!room) return;
    const on = this.online(gone), hostSeat = room.seats.find((s) => s.token === room.host);
    for (const w of this.state.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (w === gone || !a || !a.token) continue;
      const base = { code: room.code, host: a.token === room.host, hostName: hostSeat ? hostSeat.name : "",
        humans: room.seats.length, chat: room.chat.slice(-30), now: Date.now() };
      let msg;
      if (room.phase === "lobby") {
        msg = { t: "lobby", ...base, n: room.n, phone: !!room.phone,
          seats: room.seats.map((s) => ({ name: s.name, you: s.token === a.token, host: s.token === room.host, online: on.has(s.token) })) };
      } else {
        const me = room.players.findIndex((p) => p.token === a.token);
        const run = room.phase === "run" || room.phase === "end";
        msg = { t: "q", ...base, phase: room.phase, round: room.round, catName: room.catName || "",
          t0: room.t0 || 0, play: PLAY, slot: SLOT, me,
          urls: run ? room.songs.map((s) => s.url) : [], shows: run ? room.shows : [],
          songIdx: run ? room.songIdx : 0, doneIdx: run ? room.doneIdx : -1,
          players: room.players.map((p, i) => ({ name: p.name, bot: p.bot, total: p.total, round: p.round, cups: p.cups, hist: p.hist,
            online: p.bot || on.has(p.token),
            cur: run && room.cur ? { a: room.cur[i].a, t: room.cur[i].t, cup: room.cur[i].cup } : null })),
          myWords: run && room.cur && me >= 0 ? room.cur[me].words : [],
          feed: run ? room.feed.slice(0, 6) : [], results: room.results || null };
      }
      try { w.send(JSON.stringify(msg)); } catch {}
    }
  }
  async save() {
    if (!this.room) return;
    await this.state.storage.put("room", this.room);
    const step = this.nextStep(this.room);
    const idle = (this.room.touched || Date.now()) + IDLE_MS;
    // nooit een wekker in het verleden: die pakt Cloudflare soms pas veel later op
    await this.state.storage.setAlarm(Math.max(Date.now() + 25, Math.min(step ? step.at : Infinity, idle)));
  }
  async alarm() {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    if (now >= (room.touched || 0) + IDLE_MS && !this.state.getWebSockets().length) {
      await this.state.storage.deleteAll(); this.room = null; return;
    }
    // de wekker gaat soms een paar ms te vroeg af; met wat speling gebeurt de stap dan toch nu
    if (this.tick(room, now + 150)) this.broadcast();
    await this.save();
  }
  async webSocketClose(ws) { this.broadcast(ws); }
  async webSocketError(ws) { this.broadcast(ws); }
}
