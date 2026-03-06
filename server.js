const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;
const ROOM_LIMIT = 50;
const LOBBY_LIMIT = 8;
const MAX_STROKES_PER_ROOM = 5000;
const ROUND_MINUTES_MIN = 12;
const ROUND_MINUTES_MAX = 28;
const MAX_RECENT_PREVIEW_STROKES = 60;
const MAX_ARCHIVES = 120;
const MAX_STROKES_PER_WINDOW = 18;
const STROKE_WINDOW_MS = 10000;
const MIN_STROKE_INTERVAL_MS = 90;
const MAX_POINTS_PER_STROKE = 140;
const MAX_BRUSH_SIZE = 18;
const ARCHIVE_STORE_PATH = path.join(__dirname, "data", "archives.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function ensureDataDir() {
  fs.mkdirSync(path.dirname(ARCHIVE_STORE_PATH), { recursive: true });
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeGuestName() {
  return `Guest-${randomBetween(1000, 9999)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function minutesFromNow(minMinutes, maxMinutes) {
  return Date.now() + 1000 * 60 * randomBetween(minMinutes, maxMinutes);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatArchiveDate(isoString) {
  const date = new Date(isoString);
  return date.toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function sanitizeGuestName(input) {
  const fallback = makeGuestName();
  if (typeof input !== "string") return fallback;
  const trimmed = input.trim().replace(/\s+/g, " ").slice(0, 24);
  if (!trimmed) return fallback;
  const cleaned = trimmed.replace(/[^a-zA-Z0-9 _\-.]/g, "").trim();
  if (!cleaned) return fallback;
  const blocked = [
    /admin/i,
    /moderator/i,
    /support/i,
    /owner/i,
    /staff/i,
    /fuck/i,
    /shit/i,
    /bitch/i,
    /nigg/i,
    /cunt/i,
    /rape/i,
  ];
  if (blocked.some((rule) => rule.test(cleaned))) return fallback;
  return cleaned;
}

function themedPreviewConfig(slug) {
  const configs = {
    "friday-graffiti": { bg1: "#20183f", bg2: "#14182d", stroke1: "#8a5cff", stroke2: "#ff4fbf", accent1: "#ffd54f", accent2: "#4de3a1" },
    "neon-scribble-wall": { bg1: "#171f3c", bg2: "#16172f", stroke1: "#ff4fbf", stroke2: "#4ea5ff", accent1: "#ffd54f", accent2: "#4de3a1" },
    "color-storm": { bg1: "#201739", bg2: "#171d30", stroke1: "#ffd54f", stroke2: "#8a5cff", accent1: "#ff4fbf", accent2: "#4ea5ff" },
    "world-doodle-board": { bg1: "#13263a", bg2: "#162030", stroke1: "#4de3a1", stroke2: "#4ea5ff", accent1: "#ff4fbf", accent2: "#ffd54f" },
    "geometry-jam": { bg1: "#1d1737", bg2: "#141b2d", stroke1: "#ffd54f", stroke2: "#4ea5ff", accent1: "#ff4fbf", accent2: "#8a5cff" },
    "block-party-board": { bg1: "#13223b", bg2: "#171b2f", stroke1: "#4ea5ff", stroke2: "#4de3a1", accent1: "#ff4fbf", accent2: "#ffd54f" },
    "pixel-party": { bg1: "#23153a", bg2: "#17192d", stroke1: "#ff4fbf", stroke2: "#ffd54f", accent1: "#4ea5ff", accent2: "#4de3a1" },
    "midnight-mural": { bg1: "#10162f", bg2: "#191737", stroke1: "#4ea5ff", stroke2: "#8a5cff", accent1: "#4de3a1", accent2: "#ffd54f" },
  };
  return configs[slug] || configs["friday-graffiti"];
}

function makePreviewSvgFromState(room) {
  const { bg1, bg2, stroke1, stroke2, accent1, accent2 } = themedPreviewConfig(room.slug);
  const recentStrokes = room.strokes.slice(-MAX_RECENT_PREVIEW_STROKES);
  const strokeMarkup = recentStrokes.map((stroke, index) => {
    const points = (stroke.points || []).slice(0, MAX_POINTS_PER_STROKE);
    if (!points.length) return "";
    const pointString = points.map((point) => `${Math.round(point.x / 2)},${Math.round(point.y / 2.24)}`).join(" ");
    const size = Math.max(2, Math.min(10, Math.round((stroke.size || 6) / 1.5)));
    const color = stroke.tool === "eraser" ? "rgba(20,24,45,0.96)" : (stroke.color || stroke1);
    return `<polyline points="${escapeXml(pointString)}" fill="none" stroke="${escapeXml(color)}" stroke-width="${size}" stroke-linecap="round" stroke-linejoin="round" opacity="${0.78 + ((index % 3) * 0.07)}" />`;
  }).join("");

  const placeholderShapes = recentStrokes.length
    ? ""
    : `
      <path d="M42 216 C92 122, 176 124, 242 206 S384 284, 450 178 S534 108, 566 144" fill="none" stroke="${stroke1}" stroke-width="12" stroke-linecap="round" />
      <path d="M84 108 C146 44, 236 76, 308 134 S460 214, 530 142" fill="none" stroke="${stroke2}" stroke-width="10" stroke-linecap="round" />
      <circle cx="174" cy="220" r="24" fill="${accent1}" opacity="0.96" />
      <rect x="382" y="174" width="84" height="84" rx="18" fill="${accent2}" opacity="0.9" />`;

  const label = `${room.name} · Round ${room.roundNumber}`;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 340" preserveAspectRatio="none">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${bg1}" />
          <stop offset="100%" stop-color="${bg2}" />
        </linearGradient>
      </defs>
      <rect width="600" height="340" fill="url(#g)" />
      <g opacity="0.2">
        <path d="M0 28 H600 M0 56 H600 M0 84 H600 M0 112 H600 M0 140 H600 M0 168 H600 M0 196 H600 M0 224 H600 M0 252 H600 M0 280 H600 M0 308 H600" stroke="#ffffff" stroke-width="1"/>
        <path d="M28 0 V340 M56 0 V340 M84 0 V340 M112 0 V340 M140 0 V340 M168 0 V340 M196 0 V340 M224 0 V340 M252 0 V340 M280 0 V340 M308 0 V340 M336 0 V340 M364 0 V340 M392 0 V340 M420 0 V340 M448 0 V340 M476 0 V340 M504 0 V340 M532 0 V340 M560 0 V340" stroke="#ffffff" stroke-width="1"/>
      </g>
      ${placeholderShapes}
      <g>${strokeMarkup}</g>
      <rect x="16" y="16" width="220" height="36" rx="18" fill="rgba(12,14,26,0.76)" />
      <text x="32" y="39" fill="#f5f7ff" font-family="Arial, sans-serif" font-size="16" font-weight="700">${escapeXml(label)}</text>
    </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function createRoom(slug, name, theme, countries) {
  const room = {
    slug,
    name,
    theme,
    countries,
    maxUsers: ROOM_LIMIT,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    roundEndsAt: minutesFromNow(ROUND_MINUTES_MIN, ROUND_MINUTES_MAX),
    roundNumber: 1,
    users: new Map(),
    viewers: new Map(),
    strokes: [],
    clearVotes: new Set(),
    archivedCount: randomBetween(3, 80),
    snapshotUrl: "",
    lastArchiveId: null,
  };
  room.snapshotUrl = makePreviewSvgFromState(room);
  return room;
}

const rooms = new Map([
  ["friday-graffiti", createRoom("friday-graffiti", "Friday Graffiti", "High-energy freestyle", ["South Africa", "UK", "USA", "Mexico"])],
  ["neon-scribble-wall", createRoom("neon-scribble-wall", "Neon Scribble Wall", "Fast abstract marks", ["South Africa", "USA", "Brazil", "Germany"])],
  ["color-storm", createRoom("color-storm", "Color Storm", "Circles, swirls, layered blocks", ["Japan", "France", "South Africa"])],
  ["world-doodle-board", createRoom("world-doodle-board", "World Doodle Board", "Welcoming default room", ["South Africa", "Korea", "USA", "Spain"])],
  ["geometry-jam", createRoom("geometry-jam", "Geometry Jam", "Shapes and clean scenes", ["South Africa", "Netherlands", "Australia"])],
  ["block-party-board", createRoom("block-party-board", "Block Party Board", "Chunky forms and icon art", ["Canada", "South Africa", "India"])],
  ["pixel-party", createRoom("pixel-party", "Pixel Party", "Bright browser chaos", ["South Africa", "USA", "India", "Argentina"])],
  ["midnight-mural", createRoom("midnight-mural", "Midnight Mural", "Dark neon collaboration", ["South Africa", "Germany", "Italy"])],
]);

function loadArchives() {
  ensureDataDir();
  try {
    if (!fs.existsSync(ARCHIVE_STORE_PATH)) return [];
    const raw = fs.readFileSync(ARCHIVE_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

let archives = loadArchives();

function saveArchives() {
  ensureDataDir();
  fs.writeFileSync(ARCHIVE_STORE_PATH, JSON.stringify(archives.slice(0, MAX_ARCHIVES), null, 2));
}

function serializeRoom(room) {
  return {
    slug: room.slug,
    name: room.name,
    theme: room.theme,
    countries: room.countries,
    maxUsers: room.maxUsers,
    activeDrawers: room.users.size,
    watchers: room.viewers.size,
    updatedAt: room.updatedAt,
    roundEndsAt: room.roundEndsAt,
    roundNumber: room.roundNumber,
    archivedCount: room.archivedCount,
    lastArchiveId: room.lastArchiveId,
    snapshotUrl: room.snapshotUrl,
  };
}

function serializeArchive(archive) {
  return {
    id: archive.id,
    roomSlug: archive.roomSlug,
    roomName: archive.roomName,
    roundNumber: archive.roundNumber,
    createdAt: archive.createdAt,
    participantCount: archive.participantCount,
    countryCount: archive.countryCount,
    peakDrawers: archive.peakDrawers,
    strokeCount: archive.strokeCount,
    snapshotUrl: archive.snapshotUrl,
    title: archive.title,
    url: `/archive/${archive.id}`,
  };
}

function recentArchives(limit = 8) {
  return archives.slice(0, limit).map(serializeArchive);
}

function getLobbyRooms() {
  return Array.from(rooms.values()).slice(0, LOBBY_LIMIT).map(serializeRoom);
}

function markRoomUpdated(room) {
  room.updatedAt = nowIso();
}

function updateRoomPreview(room) {
  room.snapshotUrl = makePreviewSvgFromState(room);
}

function broadcastLobby() {
  io.emit("lobby:update", getLobbyRooms());
}

function broadcastArchives() {
  io.emit("archives:update", recentArchives());
}

function broadcastRoomState(room) {
  io.to(room.slug).emit("room:state", {
    room: serializeRoom(room),
    users: Array.from(room.users.values()),
    viewers: Array.from(room.viewers.values()),
    clearVotes: room.clearVotes.size,
    clearVotesNeeded: Math.max(2, Math.ceil(Math.max(1, room.users.size) * 0.6)),
  });
}

function appendStroke(room, stroke) {
  room.strokes.push(stroke);
  if (room.strokes.length > MAX_STROKES_PER_ROOM) {
    room.strokes.splice(0, room.strokes.length - MAX_STROKES_PER_ROOM);
  }
  markRoomUpdated(room);
  updateRoomPreview(room);
}

function archiveRoom(room, reason) {
  if (!room.strokes.length) return null;
  const createdAt = nowIso();
  const participantIds = new Set(room.strokes.map((stroke) => stroke.userId));
  const archive = {
    id: `${room.slug}-${formatArchiveDate(createdAt)}`,
    roomSlug: room.slug,
    roomName: room.name,
    roundNumber: room.roundNumber,
    createdAt,
    participantCount: participantIds.size,
    countryCount: room.countries.length,
    peakDrawers: Math.max(room.users.size, participantIds.size),
    strokeCount: room.strokes.length,
    snapshotUrl: room.snapshotUrl,
    title: `${room.name} · Round ${room.roundNumber}`,
    reason,
  };
  archives.unshift(archive);
  archives = archives.slice(0, MAX_ARCHIVES);
  room.archivedCount += 1;
  room.lastArchiveId = archive.id;
  saveArchives();
  return archive;
}

function resetRoom(room, reason = "timer") {
  const archive = archiveRoom(room, reason);
  room.strokes = [];
  room.clearVotes.clear();
  room.roundEndsAt = minutesFromNow(ROUND_MINUTES_MIN, ROUND_MINUTES_MAX);
  room.roundNumber += 1;
  markRoomUpdated(room);
  updateRoomPreview(room);
  io.to(room.slug).emit("room:cleared", { room: serializeRoom(room), archive: archive ? serializeArchive(archive) : null });
  broadcastRoomState(room);
  broadcastLobby();
  if (archive) broadcastArchives();
}

function leaveExistingRoom(socket) {
  const oldSlug = socket.data.roomSlug;
  if (!oldSlug) return;
  const oldRoom = rooms.get(oldSlug);
  if (!oldRoom) return;
  oldRoom.users.delete(socket.id);
  oldRoom.viewers.delete(socket.id);
  oldRoom.clearVotes.delete(socket.id);
  socket.leave(oldRoom.slug);
  markRoomUpdated(oldRoom);
  broadcastRoomState(oldRoom);
  broadcastLobby();
}

function checkStrokeRateLimit(socket) {
  const now = Date.now();
  if (!Array.isArray(socket.data.strokeTimes)) socket.data.strokeTimes = [];
  socket.data.strokeTimes = socket.data.strokeTimes.filter((time) => now - time < STROKE_WINDOW_MS);
  if (socket.data.strokeTimes.length >= MAX_STROKES_PER_WINDOW) {
    return "Too many strokes too quickly. Slow down for a few seconds.";
  }
  if (socket.data.lastStrokeAt && now - socket.data.lastStrokeAt < MIN_STROKE_INTERVAL_MS) {
    return "You are drawing too fast. Please slow down slightly.";
  }
  socket.data.strokeTimes.push(now);
  socket.data.lastStrokeAt = now;
  return null;
}

app.get("/api/canvases/lobby", (_req, res) => {
  res.json({ ok: true, rooms: getLobbyRooms() });
});

app.get("/api/canvases/archives", (_req, res) => {
  res.json({ ok: true, archives: recentArchives(12) });
});

app.get("/api/canvases/archive/:id", (req, res) => {
  const archive = archives.find((item) => item.id === req.params.id);
  if (!archive) return res.status(404).json({ ok: false, error: "Archive not found" });
  return res.json({ ok: true, archive: serializeArchive(archive) });
});

app.get("/api/canvases/room/:slug", (req, res) => {
  const room = rooms.get(req.params.slug);
  if (!room) return res.status(404).json({ ok: false, error: "Room not found" });
  return res.json({
    ok: true,
    room: serializeRoom(room),
    strokes: room.strokes,
    users: Array.from(room.users.values()),
    viewers: Array.from(room.viewers.values()),
  });
});

app.post("/api/canvases/room/:slug/reset", (req, res) => {
  const room = rooms.get(req.params.slug);
  if (!room) return res.status(404).json({ ok: false, error: "Room not found" });
  resetRoom(room, "manual");
  return res.json({ ok: true, room: serializeRoom(room) });
});

app.get("/archive/:id", (req, res) => {
  const archive = archives.find((item) => item.id === req.params.id);
  if (!archive) {
    res.status(404).send("Archive not found");
    return;
  }

  const html = `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeXml(archive.title)} | ChromeThemer Canvases</title>
    <meta name="description" content="Archived collaborative canvas from ${escapeXml(archive.roomName)} with ${archive.strokeCount} strokes and ${archive.participantCount} contributors." />
    <style>
      body{margin:0;font-family:Inter,Arial,sans-serif;background:#101221;color:#f5f7ff;padding:32px}
      .wrap{max-width:1080px;margin:0 auto}
      .card{background:#181b31;border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:24px;box-shadow:0 20px 48px rgba(0,0,0,.28)}
      img{max-width:100%;display:block;border-radius:20px;border:1px solid rgba(255,255,255,.08)}
      .meta{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0 20px}
      .chip{padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#b9bfdc}
      a{color:#fff}
    </style>
  </head>
  <body>
    <div class="wrap">
      <p><a href="/">← Back to live canvases</a></p>
      <div class="card">
        <h1>${escapeXml(archive.title)}</h1>
        <div class="meta">
          <span class="chip">Created ${escapeXml(new Date(archive.createdAt).toUTCString())}</span>
          <span class="chip">${archive.participantCount} contributors</span>
          <span class="chip">${archive.countryCount} countries</span>
          <span class="chip">${archive.strokeCount} strokes</span>
        </div>
        <img src="${archive.snapshotUrl}" alt="${escapeXml(archive.title)} preview" />
        <p>This archived round from ChromeThemer Canvases captured a collaborative drawing session in <strong>${escapeXml(archive.roomName)}</strong>. It reached <strong>${archive.peakDrawers}</strong> peak active drawers and finished as round <strong>${archive.roundNumber}</strong>.</p>
      </div>
    </div>
  </body>
  </html>`;
  res.send(html);
});

io.on("connection", (socket) => {
  socket.emit("lobby:update", getLobbyRooms());
  socket.emit("archives:update", recentArchives());

  socket.on("room:join", (payload = {}) => {
    const slug = typeof payload.slug === "string" ? payload.slug : "friday-graffiti";
    const room = rooms.get(slug);
    if (!room) {
      socket.emit("room:error", { message: "Room does not exist." });
      return;
    }

    const requestedName = sanitizeGuestName(payload.name);
    const mode = payload.mode === "viewer" ? "viewer" : "drawer";

    if (mode === "drawer" && room.users.size >= room.maxUsers) {
      socket.emit("room:full", { slug, message: "This room is currently full. Please try another room." });
      return;
    }

    leaveExistingRoom(socket);
    socket.join(room.slug);
    socket.data.roomSlug = room.slug;
    socket.data.mode = mode;
    socket.data.guestName = requestedName;
    socket.data.strokeTimes = [];
    socket.data.lastStrokeAt = 0;

    const guest = {
      id: socket.id,
      name: requestedName,
      mode,
      joinedAt: nowIso(),
    };

    if (mode === "drawer") room.users.set(socket.id, guest);
    else room.viewers.set(socket.id, guest);

    markRoomUpdated(room);

    socket.emit("room:joined", {
      room: serializeRoom(room),
      strokes: room.strokes,
      users: Array.from(room.users.values()),
      self: guest,
    });

    io.to(room.slug).emit("presence:update", {
      room: serializeRoom(room),
      users: Array.from(room.users.values()),
      viewers: Array.from(room.viewers.values()),
    });

    broadcastRoomState(room);
    broadcastLobby();
  });

  socket.on("stroke:add", (payload = {}) => {
    const roomSlug = socket.data.roomSlug;
    const room = rooms.get(roomSlug);
    if (!room) {
      socket.emit("room:error", { message: "Join a room before drawing." });
      return;
    }
    if (socket.data.mode !== "drawer") {
      socket.emit("room:error", { message: "Viewers cannot draw." });
      return;
    }

    const rateLimitMessage = checkStrokeRateLimit(socket);
    if (rateLimitMessage) {
      socket.emit("room:error", { message: rateLimitMessage });
      return;
    }

    const points = Array.isArray(payload.points) ? payload.points.slice(0, MAX_POINTS_PER_STROKE) : [];
    if (points.length < 1) return;

    const safePoints = points.map((point) => ({
      x: Math.max(0, Math.min(1200, Number(point.x) || 0)),
      y: Math.max(0, Math.min(760, Number(point.y) || 0)),
    }));

    const stroke = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: socket.id,
      name: socket.data.guestName || makeGuestName(),
      color: typeof payload.color === "string" ? payload.color.slice(0, 24) : "#ff4fbf",
      size: Number.isFinite(payload.size) ? Math.max(1, Math.min(MAX_BRUSH_SIZE, payload.size)) : 6,
      points: safePoints,
      tool: payload.tool === "eraser" ? "eraser" : "pen",
      createdAt: nowIso(),
    };

    appendStroke(room, stroke);
    io.to(room.slug).emit("stroke:added", stroke);
    broadcastLobby();
    broadcastRoomState(room);
  });

  socket.on("room:vote-clear", () => {
    const roomSlug = socket.data.roomSlug;
    const room = rooms.get(roomSlug);
    if (!room || !room.users.has(socket.id)) return;

    room.clearVotes.add(socket.id);
    const needed = Math.max(2, Math.ceil(room.users.size * 0.6));
    io.to(room.slug).emit("room:clear-votes", { votes: room.clearVotes.size, needed });
    if (room.clearVotes.size >= needed) resetRoom(room, "vote-clear");
  });

  socket.on("disconnect", () => {
    const roomSlug = socket.data.roomSlug;
    const room = rooms.get(roomSlug);
    if (!room) return;
    room.users.delete(socket.id);
    room.viewers.delete(socket.id);
    room.clearVotes.delete(socket.id);
    markRoomUpdated(room);
    broadcastRoomState(room);
    broadcastLobby();
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.roundEndsAt <= now) resetRoom(room, "timer");
  }
}, 5000);

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ChromeThemer Canvases server listening on port ${PORT}`);
});
