/**
 * Online Mexen: één Durable Object per spel (kamer), bereikbaar via /mws/<CODE>. Zelfde opzet als PresRoom in
 * index.js (wachtruimte, chat, computers vullen aan, terugkomen met je token), met de regels uit
 * public/mexen-engine.js. Mexen is open: iedereen krijgt dezelfde spelstand.
 */
import { newGame, act, tick, nextDue, view, setHuman, AVATARS, BOT_NAMES, MIN, MAX } from "../public/mexen-engine.js";

const IDLE_MS = 24 * 3600 * 1000;
const CHAT_KEEP = 40;
const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 14) || "Speler";

export class MexRoom {
  constructor(state, env) {
    this.state = state;
    this.room = null;
    // houdt de verbinding open zonder de kamer wakker te maken
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    state.blockConcurrencyWhile(async () => { this.room = (await state.storage.get("room")) || null; });
  }

  async fetch(request) {
    const code = new URL(request.url).pathname.split("/").pop();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
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

    if (m.t === "name" && seat) {
      seat.name = cleanName(m.name);
      if (room.G && room.seatOf[token] != null) room.G.players[room.seatOf[token]].name = seat.name;
    } else if (m.t === "setN" && isHost && !room.G) {
      room.n = Math.max(MIN, room.seats.length, Math.min(MAX, +m.n || MIN));
    } else if (m.t === "leave" && !room.G && seat) {
      room.seats = room.seats.filter((s) => s !== seat);
      ws.serializeAttachment({ code: att.code });
      if (isHost) room.host = room.seats[0] ? room.seats[0].token : null;
      if (!room.seats.length) { await this.state.storage.deleteAll(); this.room = null; return; }
      room.n = Math.max(room.n, MIN, room.seats.length);
    } else if (m.t === "chat" && seat) {
      // groepschat: iedereen in dit spel ziet het
      const text = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!text) return;
      room.chat = room.chat || [];
      room.chatSeq = (room.chatSeq || 0) + 1;
      room.chat.push({ id: room.chatSeq, name: seat.name, i: room.G ? room.seatOf[token] : null, text, at: now });
      if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    } else if (m.t === "start" && isHost && !room.G) {
      this.start(room, now);
    } else if (m.t === "end" && isHost && room.G) {
      room.G = null; room.seatOf = {};
    } else if (m.t === "act" && room.G && room.seatOf[token] != null) {
      const err = act(room.G, room.seatOf[token], m.a, now);
      if (err) { ws.send(JSON.stringify({ t: "err", msg: err })); return; }
    } else if (m.t === "botify" && isHost && room.G) {
      // iemand is weg: de computer neemt die plek over (en geeft hem terug zodra die persoon er weer is)
      const p = room.G.players[+m.i];
      if (p && room.seats.some((s) => room.seatOf[s.token] === +m.i)) { p.botified = !!m.on; setHuman(room.G, +m.i, !m.on, now); }
    } else return;
    await this.save();
    this.broadcast();
  }

  async hello(ws, att, m, now) {
    const token = String(m.token || "").slice(0, 64);
    if (!/^[a-z0-9]{8,64}$/.test(token)) return this.fail(ws, "Ongeldige speler.");
    if (!this.room) {
      if (!m.create) return this.fail(ws, "Dit spel bestaat niet (meer).", "gone");
      this.room = { code: att.code, host: token, seats: [], n: 4, G: null, seatOf: {}, chat: [], chatSeq: 0, touched: now };
    } else if (m.create && !this.room.seats.some((s) => s.token === token)) {
      return this.fail(ws, "Deze code is al in gebruik.", "exists");
    }
    const room = this.room;
    room.touched = now;
    const seat = room.seats.find((s) => s.token === token);
    if (!room.G) {
      if (!seat) {
        if (room.seats.length >= MAX) return this.fail(ws, "Dit spel zit al vol (8 spelers).", "full");
        room.seats.push({ token, name: cleanName(m.name) });
        if (!room.host) room.host = token;
      } else if (m.name) seat.name = cleanName(m.name);
      room.n = Math.max(room.n, Math.min(MAX, room.seats.length));
    } else {
      if (!seat) return this.fail(ws, "Dit spel is al begonnen.", "started");
      const i = room.seatOf[token], p = room.G.players[i];
      if (p && p.botified) { p.botified = false; setHuman(room.G, i, true, now); }
    }
    ws.serializeAttachment({ code: att.code, token });
    await this.save();
    this.broadcast();
  }

  start(room, now) {
    const n = Math.max(MIN, room.n, room.seats.length);
    const used = new Set(room.seats.map((s) => s.name.toLowerCase()));
    const bots = BOT_NAMES.filter((b) => !used.has(b.toLowerCase()));
    const seats = room.seats.map((s, i) => ({ name: s.name, human: true, avatar: AVATARS[i] }));
    for (let i = seats.length; i < n; i++) seats.push({ name: bots.shift() || `Computer ${i + 1}`, human: false, avatar: AVATARS[i] });
    room.seatOf = Object.fromEntries(room.seats.map((s, i) => [s.token, i]));
    room.G = newGame(seats, now);
  }

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
    const on = this.online(gone);
    const hostSeat = room.seats.find((s) => s.token === room.host);
    for (const w of this.state.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (w === gone || !a || !a.token) continue;
      const base = { code: room.code, host: a.token === room.host, hostName: hostSeat ? hostSeat.name : "",
        humans: room.seats.length, chat: (room.chat || []).slice(-30) };
      let msg;
      if (!room.G) {
        msg = { t: "lobby", ...base, n: room.n,
          seats: room.seats.map((s) => ({ name: s.name, you: s.token === a.token, host: s.token === room.host, online: on.has(s.token) })) };
      } else {
        const online = room.G.players.map(() => true);
        const botified = room.G.players.map((p) => !!p.botified);
        for (const s of room.seats) online[room.seatOf[s.token]] = on.has(s.token);
        msg = { t: "state", ...base, v: view(room.G, room.seatOf[a.token]), online, botified };
      }
      try { w.send(JSON.stringify(msg)); } catch {}
    }
  }

  async save() {
    if (!this.room) return;
    await this.state.storage.put("room", this.room);
    const due = this.room.G ? nextDue(this.room.G) : null;
    const idle = (this.room.touched || Date.now()) + IDLE_MS;
    // nooit een wekker in het verleden: die pakt Cloudflare soms pas veel later op
    await this.state.storage.setAlarm(Math.max(Date.now() + 25, Math.min(due == null ? Infinity : due, idle)));
  }

  async alarm() {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    if (now >= (room.touched || 0) + IDLE_MS && !this.state.getWebSockets().length) {
      await this.state.storage.deleteAll(); this.room = null; return;
    }
    // de wekker gaat soms een paar ms te vroeg af; met wat speling gebeurt de stap dan toch nu
    if (room.G && tick(room.G, now + 150)) this.broadcast();
    await this.save();
  }

  async webSocketClose(ws) { this.broadcast(ws); }
  async webSocketError(ws) { this.broadcast(ws); }
}
