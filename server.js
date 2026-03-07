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
const MAX_ARCHIVE_STROKES = 900;
const MAX_REPLAY_POINTS_PER_STROKE = 160;
const MAX_STROKES_PER_WINDOW = 18;
const STROKE_WINDOW_MS = 10000;
const MIN_STROKE_INTERVAL_MS = 90;
const MAX_POINTS_PER_STROKE = 140;
const MAX_BRUSH_SIZE = 18;
const STORAGE_ROOT = process.env.STORAGE_DIR || __dirname;

const ARCHIVE_STORE_PATH = path.join(STORAGE_ROOT, "data", "archives.json");
const GENERATED_DIR = path.join(STORAGE_ROOT, "generated");
const GENERATED_ARCHIVES_DIR = path.join(GENERATED_DIR, "archives");
const GENERATED_ROOMS_DIR = path.join(GENERATED_DIR, "rooms");
const GENERATED_IMAGES_DIR = path.join(STORAGE_ROOT, "images");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/generated", express.static(path.join(STORAGE_ROOT, "generated")));
app.use("/images", express.static(path.join(STORAGE_ROOT, "images")));

function ensureDataDir() {
  fs.mkdirSync(path.dirname(ARCHIVE_STORE_PATH), { recursive: true });
  fs.mkdirSync(GENERATED_ARCHIVES_DIR, { recursive: true });
  fs.mkdirSync(GENERATED_ROOMS_DIR, { recursive: true });
  fs.mkdirSync(GENERATED_IMAGES_DIR, { recursive: true });
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
function slugify(value) {
  return String(value || "canvas")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "canvas";
}

function pickArchiveDescriptor(room, strokeCount, participantCount) {
  const descriptors = {
    "friday-graffiti": ["Graffiti", "Street Art", "Urban Canvas"],
    "neon-scribble-wall": ["Neon", "Electric", "Luminous"],
    "color-storm": ["Color Storm", "Vivid", "Chromatic"],
    "world-doodle-board": ["Global", "World", "Shared"],
    "geometry-jam": ["Geometric", "Shape", "Abstract"],
    "block-party-board": ["Block Party", "Chunky", "Playful"],
    "pixel-party": ["Pixel", "Retro", "Arcade"],
    "midnight-mural": ["Midnight", "Night", "Nocturne"],
  };
  const pool = descriptors[room.slug] || [room.name, "Collaborative", "Shared"];
  const intensity = (strokeCount > 180 ? 2 : strokeCount > 90 ? 1 : 0);
  const social = participantCount > 8 ? "Collaborative" : participantCount > 4 ? "Shared" : "Live";
  return `${pool[intensity % pool.length]} ${social}`;
}

function buildArchiveTitle(room, archiveId, roundNumber, strokeCount, participantCount) {
  const descriptor = pickArchiveDescriptor(room, strokeCount, participantCount);
  return `${descriptor} Canvas from ${room.name} Round ${roundNumber}`;
}

function buildArchiveImageAlt(title, participantCount, roomName) {
  return `${title} created on ${roomName} by ${participantCount} participants`;
}

function archiveImagePublicPath(archiveId, title) {
  return `/images/${archiveId}-${slugify(title)}.svg`;
}

function archiveImageFilePath(archiveId, title) {
  return path.join(GENERATED_IMAGES_DIR, `${archiveId}-${slugify(title)}.svg`);
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

function buildPreviewSvgMarkup(room) {
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
  return svg;
}


function buildArchiveSvgMarkup(archive) {
  const { bg1, bg2, stroke1, stroke2, accent1, accent2 } = themedPreviewConfig(archive.roomSlug);
  const replayStrokes = Array.isArray(archive.replayStrokes) ? archive.replayStrokes : [];
  const strokeMarkup = replayStrokes.map((stroke, index) => {
    const points = Array.isArray(stroke.points) ? stroke.points.slice(0, MAX_REPLAY_POINTS_PER_STROKE) : [];
    if (!points.length) return "";
    const pointString = points.map((point) => `${Math.round(point.x / 2)},${Math.round(point.y / 2.24)}`).join(" " );
    const size = Math.max(2, Math.min(10, Math.round((stroke.size || 6) / 1.5)));
    const color = stroke.tool === "eraser" ? "rgba(20,24,45,0.96)" : (stroke.color || stroke1);
    return `<polyline points="${escapeXml(pointString)}" fill="none" stroke="${escapeXml(color)}" stroke-width="${size}" stroke-linecap="round" stroke-linejoin="round" opacity="${0.78 + ((index % 3) * 0.07)}" />`;
  }).join("");

  return `
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
      <g>${strokeMarkup}</g>
      <rect x="16" y="16" width="320" height="36" rx="18" fill="rgba(12,14,26,0.76)" />
      <text x="32" y="39" fill="#f5f7ff" font-family="Arial, sans-serif" font-size="16" font-weight="700">${escapeXml(archive.roomName)} · Round ${archive.roundNumber}</text>
    </svg>`;
}

function makePreviewSvgFromState(room) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(buildPreviewSvgMarkup(room))}`;
}

function writeSvgFile(targetPath, svgMarkup) {
  ensureDataDir();
  fs.writeFileSync(targetPath, svgMarkup, "utf8");
}

function roomPreviewPublicPath(room) {
  return `/generated/rooms/${room.slug}.svg`;
}

function archivePreviewPublicPath(archiveId) {
  return `/generated/archives/${archiveId}.svg`;
}


function roomImageLandingPath(room) {
  return `/image/room/${room.slug}`;
}

function archiveImageLandingPath(archive) {
  return `/image/archive/${archive.id}`;
}

function roomDirectImageAlt(room) {
  return `${room.name} collaborative browser canvas art image`;
}

function archiveDirectImageAlt(archive) {
  return archive.imageAlt || `${archive.title} collaborative drawing archive image`;
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


for (const room of rooms.values()) {
  updateRoomPreview(room);
}

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

function normalizeArchiveRecord(archive) {
  if (!archive || typeof archive !== "object") return null;
  const room = rooms.get(archive.roomSlug) || createRoom("fallback", archive.roomName || "Canvas Room", "Archived round", []);
  const safeTitle = archive.title || buildArchiveTitle(room, archive.id || "canvas", archive.roundNumber || 1, archive.strokeCount || 0, archive.participantCount || 0);
  const imageUrl = archive.imageUrl || archiveImagePublicPath(archive.id || "canvas", safeTitle);
  const imageAlt = archive.imageAlt || buildArchiveImageAlt(safeTitle, archive.participantCount || 0, archive.roomName || room.name);
  const imageFile = archiveImageFilePath(archive.id || "canvas", safeTitle);
  if (!fs.existsSync(imageFile)) {
    const legacyFile = path.join(GENERATED_ARCHIVES_DIR, `${archive.id}.svg`);
    if (fs.existsSync(legacyFile)) fs.copyFileSync(legacyFile, imageFile);
  }
  return { ...archive, title: safeTitle, imageUrl, imageAlt, snapshotUrl: imageUrl };
}

archives = archives.map(normalizeArchiveRecord).filter(Boolean);

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
    replayUrl: `/archive/${archive.id}#replay`,
    featuredScore: archive.featuredScore || 0,
    participants: Array.isArray(archive.participants) ? archive.participants.slice(0, 12) : [],
    imageUrl: archive.imageUrl || archive.snapshotUrl,
    imageAlt: archive.imageAlt || `${archive.title} collaborative drawing`,
  };
}

function recentArchives(limit = 8) {
  return archives.slice(0, limit).map(serializeArchive);
}

function featuredArchives(limit = 12) {
  return archives
    .slice()
    .sort((a, b) => (b.featuredScore || 0) - (a.featuredScore || 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map(serializeArchive);
}

function computeFeaturedScore(archive) {
  return (archive.strokeCount * 1.2) + (archive.participantCount * 20) + (archive.peakDrawers * 10) + (archive.countryCount * 12);
}

function getLobbyRooms() {
  return Array.from(rooms.values()).slice(0, LOBBY_LIMIT).map(serializeRoom);
}

function markRoomUpdated(room) {
  room.updatedAt = nowIso();
}

function updateRoomPreview(room) {
  const svgMarkup = buildPreviewSvgMarkup(room);

  // Keep writing the room SVG file so generated assets still exist for
  // archive/gallery/SEO related features.
  writeSvgFile(path.join(GENERATED_ROOMS_DIR, `${room.slug}.svg`), svgMarkup);

  // Use an inline data URI for the live lobby preview so the room card updates
  // immediately as strokes change instead of showing a cached static thumbnail.
  room.snapshotUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`;
}

function broadcastLobby() {
  io.emit("lobby:update", getLobbyRooms());
}

function broadcastArchives() {
  io.emit("archives:update", recentArchives());
}

function broadcastFeatured() {
  io.emit("featured:update", featuredArchives());
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
  const participantNames = Array.from(new Set(room.strokes.map((stroke) => stroke.name).filter(Boolean))).slice(0, 18);
  const replayStrokes = room.strokes.slice(-MAX_ARCHIVE_STROKES).map((stroke) => ({
    color: stroke.color || "#ff4fbf",
    size: Math.max(1, Math.min(MAX_BRUSH_SIZE, Number(stroke.size) || 6)),
    tool: stroke.tool === "eraser" ? "eraser" : "pen",
    points: Array.isArray(stroke.points) ? stroke.points.slice(0, MAX_REPLAY_POINTS_PER_STROKE) : [],
    name: stroke.name || "Guest",
    createdAt: stroke.createdAt || createdAt,
  }));
  const archiveId = `${room.slug}-${formatArchiveDate(createdAt)}`;
  const title = buildArchiveTitle(room, archiveId, room.roundNumber, room.strokes.length, participantIds.size);
  const imageUrl = archiveImagePublicPath(archiveId, title);
  const imageAlt = buildArchiveImageAlt(title, participantIds.size, room.name);
  const archive = {
    id: archiveId,
    roomSlug: room.slug,
    roomName: room.name,
    roundNumber: room.roundNumber,
    createdAt,
    participantCount: participantIds.size,
    countryCount: room.countries.length,
    peakDrawers: Math.max(room.users.size, participantIds.size),
    strokeCount: room.strokes.length,
    snapshotUrl: imageUrl,
    imageUrl,
    imageAlt,
    title,
    reason,
    participants: participantNames,
    replayStrokes,
  };
  const archiveSvg = buildArchiveSvgMarkup(archive);
  writeSvgFile(path.join(GENERATED_ARCHIVES_DIR, `${archiveId}.svg`), archiveSvg);
  writeSvgFile(archiveImageFilePath(archiveId, title), archiveSvg);
  archive.featuredScore = computeFeaturedScore(archive);
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
  if (archive) { broadcastArchives(); broadcastFeatured(); }
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

app.get("/api/canvases/featured", (_req, res) => {
  res.json({ ok: true, featured: featuredArchives(18) });
});

app.get("/api/canvases/archive/:id", (req, res) => {
  const archive = archives.find((item) => item.id === req.params.id);
  if (!archive) return res.status(404).json({ ok: false, error: "Archive not found" });
  return res.json({ ok: true, archive: serializeArchive(archive), replayStrokes: archive.replayStrokes || [] });
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

  const replayJson = JSON.stringify(archive.replayStrokes || []).replace(/<\/script/gi, '<\\/script');
  const participantMarkup = (archive.participants || []).map((name) => `<span class="chip">${escapeXml(name)}</span>`).join("");
  const imageObjectJson = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ImageObject",
    name: archive.title,
    contentUrl: `https://canvases.chromethemer.com${archive.imageUrl || archive.snapshotUrl}`,
    description: archive.imageAlt || archive.title
  });
  const html = `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeXml(archive.title)} | ChromeThemer Canvases</title>
    <meta name="description" content="Archived collaborative canvas from ${escapeXml(archive.roomName)} with ${archive.strokeCount} strokes, ${archive.participantCount} contributors, and replay controls." />
    <meta property="og:image" content="https://canvases.chromethemer.com${archive.imageUrl || archive.snapshotUrl}" />
    <script type="application/ld+json">${imageObjectJson}</script>
    <style>
      :root{--bg:#101221;--panel:#181b31;--panel2:#1f2442;--text:#f5f7ff;--muted:#b9bfdc;--border:rgba(255,255,255,.08);--pink:#ff4fbf;--purple:#8a5cff;}
      body{margin:0;font-family:Inter,Arial,sans-serif;background:linear-gradient(180deg,#0f1220,#13172a);color:var(--text);padding:24px}
      .wrap{max-width:1180px;margin:0 auto}
      .card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-radius:24px;padding:24px;box-shadow:0 20px 48px rgba(0,0,0,.28)}
      .head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:18px}
      .meta,.controls,.participants{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0 20px}
      .chip,.btn{padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:var(--muted);text-decoration:none;font-weight:700}
      .btn.primary{background:linear-gradient(135deg,var(--pink),var(--purple));color:#fff;border:none}
      .grid{display:grid;grid-template-columns:1.1fr .9fr;gap:22px}
      img,canvas{max-width:100%;display:block;border-radius:20px;border:1px solid rgba(255,255,255,.08)}
      canvas{background:linear-gradient(180deg,#1a1d36,#15182b)}
      .stack{display:grid;gap:16px}
      .small{color:var(--muted);line-height:1.7}
      .slider{width:100%}
      .topnav{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}
      a{color:#fff}
      @media (max-width:900px){.grid{grid-template-columns:1fr}}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="topnav">
        <a class="btn" href="/">← Back to live canvases</a>
        <a class="btn" href="/featured">View featured drawings</a>
      </div>
      <div class="card">
        <div class="head">
          <div>
            <h1>${escapeXml(archive.title)}</h1>
            <p class="small">Archived collaborative round from <strong>${escapeXml(archive.roomName)}</strong> with replay controls, participant highlights, and round metadata.</p>
          </div>
          <a class="btn primary" href="#replay">Replay this drawing</a>
        </div>
        <div class="meta">
          <span class="chip">Created ${escapeXml(new Date(archive.createdAt).toUTCString())}</span>
          <span class="chip">${archive.participantCount} contributors</span>
          <span class="chip">${archive.countryCount} countries</span>
          <span class="chip">${archive.strokeCount} strokes</span>
          <span class="chip">Peak ${archive.peakDrawers} active drawers</span>
        </div>
        <div class="grid">
          <div class="stack">
            <img src="${archive.imageUrl || archive.snapshotUrl}" alt="${escapeXml(archive.imageAlt || `${archive.title} preview`)}" width="800" height="453" />
            <p class="small">This saved round can be indexed as a standalone content page. Over time, these archive pages can grow into a large set of crawlable collaborative-art URLs for ChromeThemer.</p>
          </div>
          <div class="stack" id="replay">
            <canvas id="replayCanvas" width="1200" height="760"></canvas>
            <div class="controls">
              <button class="btn primary" id="playBtn" type="button">Play replay</button>
              <button class="btn" id="pauseBtn" type="button">Pause</button>
              <button class="btn" id="resetBtn" type="button">Reset</button>
              <span class="chip" id="progressText">0 / ${archive.replayStrokes ? archive.replayStrokes.length : 0} strokes</span>
            </div>
            <input class="slider" id="progressRange" type="range" min="0" max="${archive.replayStrokes ? archive.replayStrokes.length : 0}" value="0" />
            <div class="participants">${participantMarkup || '<span class="chip">Guest contributors</span>'}</div>
          </div>
        </div>
      </div>
    </div>
    <script>
      window.__ARCHIVE_REPLAY__ = ${replayJson};
    </script>
    <script src="/archive-replay.js"></script>
  </body>
  </html>`;
  res.send(html);
});

app.get("/featured", (_req, res) => {
  const featured = featuredArchives(24);
  const cards = featured.map((archive) => `
    <article class="card item">
      <img src="${archive.imageUrl || archive.snapshotUrl}" alt="${escapeXml(archive.imageAlt || `${archive.title} preview`)}" width="800" height="453" />
      <div class="body">
        <h2><a href="${archive.url}">${escapeXml(archive.title)}</a></h2>
        <p>${archive.participantCount} contributors · ${archive.countryCount} countries · ${archive.strokeCount} strokes</p>
        <div class="chips">
          <span class="chip">Score ${Math.round(archive.featuredScore || 0)}</span>
          <span class="chip">Peak ${archive.peakDrawers}</span>
          <a class="chip link" href="${archive.replayUrl}">Replay</a>
        </div>
      </div>
    </article>`).join("");
  const html = `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Featured Drawings | ChromeThemer Canvases</title>
    <meta name="description" content="Featured collaborative drawings and replayable archive rounds from ChromeThemer Canvases." />
    <style>body{margin:0;font-family:Inter,Arial,sans-serif;background:linear-gradient(180deg,#0f1220,#13172a);color:#f5f7ff;padding:24px}.wrap{max-width:1240px;margin:0 auto}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{background:linear-gradient(180deg,#1f2442,#181b31);border:1px solid rgba(255,255,255,.08);border-radius:24px;overflow:hidden;box-shadow:0 18px 48px rgba(0,0,0,.24)}img{width:100%;display:block}.body{padding:18px}.chips{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.chip{padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#b9bfdc;text-decoration:none}a{color:#fff}.nav{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}.btn{padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#fff;text-decoration:none;font-weight:700}@media (max-width:980px){.grid{grid-template-columns:1fr 1fr}}@media (max-width:640px){.grid{grid-template-columns:1fr}}</style>
  </head>
  <body>
    <div class="wrap">
      <div class="nav"><a class="btn" href="/">← Back to live canvases</a></div>
      <h1>Featured Drawings</h1>
      <p>These are the strongest collaborative rounds so far, ranked by participation, activity, stroke density, and country mix. They are ideal for linking from a public ChromeThemer landing page.</p>
      <div class="grid">${cards || '<p>No featured drawings yet.</p>'}</div>
    </div>
  </body>
  </html>`;
  res.send(html);
});

io.on("connection", (socket) => {
  socket.emit("lobby:update", getLobbyRooms());
  socket.emit("archives:update", recentArchives());
  socket.emit("featured:update", featuredArchives());

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


app.get("/archives", (_req, res) => {
  const items = recentArchives(120).map((archive) => `
    <article class="card item">
      <img src="${archive.imageUrl || archive.snapshotUrl}" alt="${escapeXml(archive.imageAlt || `${archive.title} preview`)}" width="800" height="453" />
      <div class="body">
        <h2><a href="${archive.url}">${escapeXml(archive.title)}</a></h2>
        <p>${archive.participantCount} contributors · ${archive.countryCount} countries · ${archive.strokeCount} strokes · ${escapeXml(new Date(archive.createdAt).toUTCString())}</p>
        <div class="chips">
          <a class="chip link" href="${archive.replayUrl}">Replay</a>
          <span class="chip">Peak ${archive.peakDrawers}</span>
          <span class="chip">Round ${archive.roundNumber}</span>
        </div>
      </div>
    </article>`).join("");
  const html = `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Canvas Archive Index | ChromeThemer Canvases</title>
    <meta name="description" content="Browse the latest replayable collaborative canvas archives from ChromeThemer Canvases." />
    <style>body{margin:0;font-family:Inter,Arial,sans-serif;background:linear-gradient(180deg,#0f1220,#13172a);color:#f5f7ff;padding:24px}.wrap{max-width:1240px;margin:0 auto}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{background:linear-gradient(180deg,#1f2442,#181b31);border:1px solid rgba(255,255,255,.08);border-radius:24px;overflow:hidden;box-shadow:0 18px 48px rgba(0,0,0,.24)}img{width:100%;display:block;aspect-ratio:16/9;object-fit:cover}.body{padding:18px}.chips{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.chip{padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#b9bfdc;text-decoration:none}a{color:#fff}.nav{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}.btn{padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#fff;text-decoration:none;font-weight:700}@media (max-width:980px){.grid{grid-template-columns:1fr 1fr}}@media (max-width:640px){.grid{grid-template-columns:1fr}}</style>
  </head>
  <body>
    <div class="wrap">
      <div class="nav"><a class="btn" href="/">← Back to live canvases</a><a class="btn" href="/featured">Featured drawings</a></div>
      <h1>Canvas Archive Index</h1>
      <p>Browse replayable collaborative rounds, saved snapshots, and archive pages generated automatically as live canvases finish.</p>
      <div class="grid">${items || '<p>No archives yet.</p>'}</div>
    </div>
  </body>
  </html>`;
  res.send(html);
});

app.get("/sitemap.xml", (_req, res) => {
  const topicSlugs = Object.keys(drawingTopicConfig());
  const roomUrls = roomSeoItems();
  const entries = [
    '/', '/archives', '/featured', '/gallery', '/gallery/graffiti', '/gallery/abstract', '/gallery/pixel', '/gallery/world', '/drawing',
    ...topicSlugs.map((slug) => `/drawing/${slug}`),
    ...roomUrls.map((room) => `/rooms/${room.slug}`),
    ...archives.map((archive) => `/archive/${archive.id}`)
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://canvases.chromethemer.com/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>https://canvases.chromethemer.com/sitemap-images.xml</loc></sitemap>
</sitemapindex>`;

  res.type("application/xml").send(xml);
});

app.get("/sitemap-pages.xml", (_req, res) => {
  const topicSlugs = Object.keys(drawingTopicConfig());
  const roomUrls = roomSeoItems();
  const entries = [
    ...['/', '/archives', '/featured', '/gallery', '/gallery/graffiti', '/gallery/abstract', '/gallery/pixel', '/gallery/world', '/drawing'].map((url) => ({
      loc: `https://canvases.chromethemer.com${url}`,
      lastmod: nowIso(),
    })),
    ...topicSlugs.map((slug) => ({
      loc: `https://canvases.chromethemer.com/drawing/${slug}`,
      lastmod: nowIso(),
    })),
    ...roomUrls.map((room) => ({
      loc: `https://canvases.chromethemer.com/rooms/${room.slug}`,
      lastmod: room.updatedAt,
    })),
    ...roomUrls.map((room) => ({
      loc: `https://canvases.chromethemer.com/image/room/${room.slug}`,
      lastmod: room.updatedAt,
    })),
    ...archives.map((archive) => ({
      loc: `https://canvases.chromethemer.com/archive/${archive.id}`,
      lastmod: archive.createdAt,
    })),
    ...archives.map((archive) => ({
      loc: `https://canvases.chromethemer.com/image/archive/${archive.id}`,
      lastmod: archive.createdAt,
    }))
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${escapeXml(entry.lastmod)}</lastmod>
  </url>`).join('\n')}
</urlset>`;

  res.type("application/xml").send(xml);
});

app.get("/sitemap-images.xml", (_req, res) => {
  const topicSlugs = Object.keys(drawingTopicConfig());
  const topicEntries = topicSlugs.flatMap((slug) => buildTopicVisualItems(slug).slice(0, 20).map((item) => ({
    page: `https://canvases.chromethemer.com/drawing/${slug}`,
    lastmod: item.createdAt || nowIso(),
    imageLoc: `https://canvases.chromethemer.com${item.imageUrl}`,
    imageTitle: item.title,
    imageCaption: item.caption,
  })));

  const roomEntries = roomSeoItems().map((room) => ({
    page: `https://canvases.chromethemer.com/rooms/${room.slug}`,
    lastmod: room.updatedAt,
    imageLoc: `https://canvases.chromethemer.com${room.snapshotUrl}`,
    imageTitle: `${room.name} live collaborative canvas preview`,
    imageCaption: `${room.name} collaborative browser drawing canvas preview`,
  }));

  const archiveEntries = archives.map((archive) => ({
    page: `https://canvases.chromethemer.com/archive/${archive.id}`,
    lastmod: archive.createdAt,
    imageLoc: `https://canvases.chromethemer.com${archive.imageUrl || archive.snapshotUrl}`,
    imageTitle: archive.title,
    imageCaption: archive.imageAlt || archive.title,
  }));

  const roomImageLandingEntries = roomSeoItems().map((room) => ({
    page: `https://canvases.chromethemer.com/image/room/${room.slug}`,
    lastmod: room.updatedAt,
    imageLoc: `https://canvases.chromethemer.com${room.snapshotUrl}`,
    imageTitle: `${room.name} full browser canvas image`,
    imageCaption: `${room.name} live collaborative canvas image file and landing page`,
  }));

  const archiveImageLandingEntries = archives.map((archive) => ({
    page: `https://canvases.chromethemer.com/image/archive/${archive.id}`,
    lastmod: archive.createdAt,
    imageLoc: `https://canvases.chromethemer.com${archive.imageUrl || archive.snapshotUrl}`,
    imageTitle: `${archive.title} full collaborative drawing image`,
    imageCaption: `${archive.title} image landing page for Google Images discovery`,
  }));

  const entries = [...roomEntries, ...archiveEntries, ...roomImageLandingEntries, ...archiveImageLandingEntries, ...topicEntries];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.map((entry) => `  <url>
    <loc>${escapeXml(entry.page)}</loc>
    <lastmod>${escapeXml(entry.lastmod)}</lastmod>
    <image:image>
      <image:loc>${escapeXml(entry.imageLoc)}</image:loc>
      <image:title>${escapeXml(entry.imageTitle)}</image:title>
      <image:caption>${escapeXml(entry.imageCaption)}</image:caption>
    </image:image>
  </url>`).join('\n')}
</urlset>`;

  res.type("application/xml").send(xml);
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\n\nSitemap: https://canvases.chromethemer.com/sitemap.xml\nSitemap: https://canvases.chromethemer.com/sitemap-pages.xml\nSitemap: https://canvases.chromethemer.com/sitemap-images.xml\n`);
});

function galleryBuckets() {
  const all = archives.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const bySlug = {
    graffiti: all.filter((a) => ["friday-graffiti", "neon-scribble-wall", "midnight-mural"].includes(a.roomSlug)),
    abstract: all.filter((a) => ["color-storm", "geometry-jam"].includes(a.roomSlug)),
    pixel: all.filter((a) => ["pixel-party", "block-party-board"].includes(a.roomSlug)),
    world: all.filter((a) => ["world-doodle-board"].includes(a.roomSlug)),
  };

  return { all, bySlug };
}

function renderGalleryPage(title, description, items, canonicalPath) {
  const cards = items.map((archive) => `
    <article class="gallery-card">
      <a class="gallery-card__media" href="${archive.imageUrl || archive.snapshotUrl}" aria-label="Open full image for ${escapeXml(archive.title)}">
        <img
          src="${archive.imageUrl || archive.snapshotUrl}"
          alt="${escapeXml(archiveDirectImageAlt(archive))}"
          loading="lazy"
          width="800"
          height="453"
        />
      </a>
      <div class="gallery-card__body">
        <h2 class="gallery-card__title"><a href="${archive.url}">${escapeXml(archive.title)}</a></h2>
        <p class="gallery-card__meta">${archive.participantCount} contributors · ${archive.countryCount} countries · ${archive.strokeCount} strokes</p>
        <p class="gallery-card__copy">${escapeXml(archive.title)} is a saved collaborative canvas from ${escapeXml(archive.roomName)} and now acts as a stronger image-first archive page with direct file access, replay access, and related room discovery.</p>
        <div class="gallery-card__chips">
          <a class="gallery-chip gallery-chip--link" href="${archive.replayUrl}">Replay</a>
          <a class="gallery-chip gallery-chip--link" href="${archiveImageLandingPath(archive)}">Image page</a>
          <a class="gallery-chip gallery-chip--link" href="${archive.imageUrl || archive.snapshotUrl}">Open image</a>
          <span class="gallery-chip">Round ${archive.roundNumber}</span>
          <span class="gallery-chip">Peak ${archive.peakDrawers}</span>
        </div>
      </div>
    </article>
  `).join("");

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeXml(title)} | ChromeThemer Canvases</title>
    <meta name="description" content="${escapeXml(description)}" />
    <link rel="canonical" href="https://canvases.chromethemer.com${canonicalPath}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeXml(title)} | ChromeThemer Canvases" />
    <meta property="og:description" content="${escapeXml(description)}" />
    <meta property="og:url" content="https://canvases.chromethemer.com${canonicalPath}" />
    <style>
      :root{--bg:#0f1220;--panel:#181b31;--panel2:#1f2442;--text:#f5f7ff;--muted:#b9bfdc;--border:rgba(255,255,255,.08);--pink:#ff4fbf;--purple:#8a5cff}
      *{box-sizing:border-box} body{margin:0;font-family:Inter,Arial,sans-serif;background:linear-gradient(180deg,#0f1220,#13172a);color:var(--text);padding:24px}
      .wrap{max-width:1280px;margin:0 auto}
      .nav{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
      .btn{padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#fff;text-decoration:none;font-weight:700}
      .hero{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-radius:28px;padding:26px;box-shadow:0 18px 48px rgba(0,0,0,.24);margin-bottom:22px}
      .hero p,.gallery-copy p{color:var(--muted);max-width:78ch;line-height:1.7}
      .gallery-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,360px));gap:22px;justify-content:start}
      .gallery-card{max-width:360px;width:100%;background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-radius:24px;overflow:hidden;box-shadow:0 18px 48px rgba(0,0,0,.22)}
      .gallery-card__media img{width:100%;display:block;aspect-ratio:16/9;object-fit:cover}
      .gallery-card__body{padding:18px}
      .gallery-card__title{margin:0 0 10px;font-size:1.06rem;line-height:1.35}
      .gallery-card__title a{color:#fff;text-decoration:none}
      .gallery-card__meta{margin:0 0 12px;color:var(--muted);line-height:1.6}
      .gallery-card__copy{margin:0 0 14px;color:var(--muted);line-height:1.7}
      .gallery-card__chips{display:flex;gap:10px;flex-wrap:wrap}
      .gallery-chip{padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:var(--muted);text-decoration:none;font-weight:700}
      .gallery-chip--link{color:#fff}
    </style>
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `https://canvases.chromethemer.com${canonicalPath}`
    })}</script>
  </head>
  <body>
    <div class="wrap">
      <div class="nav">
        <a class="btn" href="/">← Back to live canvases</a>
        <a class="btn" href="/archives">Archive index</a>
        <a class="btn" href="/featured">Featured drawings</a>
      </div>
      <section class="hero">
        <h1>${escapeXml(title)}</h1>
        <p>${escapeXml(description)}</p>
        <p>These archive galleries now do more than list saved rounds. Each card exposes a direct image file, a dedicated image landing page, and a richer archive summary so search engines can discover the same artwork through more than one crawlable context without changing the live app.</p>
      </section>
      <section class="gallery-copy">
        <p>Browse collaborative graffiti walls, abstract browser canvases, pixel boards, and global doodle rooms. Every archive card links to the archive replay, the underlying image file, and a dedicated image page built to strengthen Google Images discovery.</p>
      </section>
      <section class="gallery-grid">
        ${cards || '<p>No gallery items yet.</p>'}
      </section>
    </div>
  </body>
  </html>`;
}



function serializeRoomSeo(room) {
  return {
    slug: room.slug,
    name: room.name,
    theme: room.theme,
    countries: Array.isArray(room.countries) ? room.countries.slice(0, 8) : [],
    snapshotUrl: roomPreviewPublicPath(room),
    archiveCount: room.archivedCount || 0,
    updatedAt: room.updatedAt || room.createdAt || nowIso(),
    roundNumber: room.roundNumber || 1,
    drawingCount: room.users ? room.users.size : 0,
    viewerCount: room.viewers ? room.viewers.size : 0,
  };
}

function roomSeoItems() {
  return Array.from(rooms.values()).map(serializeRoomSeo);
}

function drawingTopicConfig() {
  return {
    'abstract-art': {
      title: 'Abstract Art Drawings',
      heading: 'Abstract Art Drawings From Collaborative Browser Canvases',
      description: 'Browse abstract collaborative drawings, colorful browser canvas art, and live shared compositions generated inside ChromeThemer Canvases.',
      intro: 'These abstract drawing pages combine live room previews with archived collaborative artwork. They are designed to surface long-tail image search traffic around browser canvas art, abstract doodles, and shared digital drawings.',
      roomSlugs: ['color-storm', 'geometry-jam', 'midnight-mural'],
      keywords: ['abstract art drawing', 'abstract browser canvas art', 'collaborative abstract doodle']
    },
    'graffiti-wall': {
      title: 'Graffiti Wall Drawings',
      heading: 'Graffiti Wall Drawings and Shared Browser Murals',
      description: 'Explore graffiti wall drawings, collaborative digital murals, and neon scribble boards created in live browser canvas rooms.',
      intro: 'This page groups graffiti-style collaborative canvases so Google can understand the visual theme, image captions, and room context around live browser wall art.',
      roomSlugs: ['friday-graffiti', 'neon-scribble-wall', 'midnight-mural'],
      keywords: ['graffiti wall drawing', 'online graffiti wall', 'collaborative graffiti canvas']
    },
    'browser-canvas-art': {
      title: 'Browser Canvas Art',
      heading: 'Browser Canvas Art Created Live With Other Visitors',
      description: 'See browser canvas art, shared online drawing boards, and collaborative web-based canvas images from ChromeThemer Canvases.',
      intro: 'These images come from real collaborative rooms running directly in the browser. Each visual links into a live room or replayable archive page.',
      roomSlugs: ['world-doodle-board', 'color-storm', 'geometry-jam', 'block-party-board', 'pixel-party'],
      keywords: ['browser canvas art', 'online canvas drawing', 'shared browser drawing board']
    },
    'collaborative-doodle': {
      title: 'Collaborative Doodle Boards',
      heading: 'Collaborative Doodle Boards and Shared Drawing Rooms',
      description: 'Discover collaborative doodle boards, public browser sketch rooms, and playful multi-user canvas drawings saved from live sessions.',
      intro: 'Collaborative doodle keywords are a strong fit for this project because the rooms constantly create fresh visuals, archive pages, and image-entry points.',
      roomSlugs: ['world-doodle-board', 'block-party-board', 'pixel-party', 'friday-graffiti'],
      keywords: ['collaborative doodle board', 'shared online doodle board', 'multi user drawing room']
    }
  };
}

function buildTopicVisualItems(topicKey) {
  const config = drawingTopicConfig()[topicKey];
  if (!config) return [];
  const items = [];
  const seen = new Set();

  for (const archive of archives) {
    if (!config.roomSlugs.includes(archive.roomSlug)) continue;
    const key = `archive:${archive.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      type: 'archive',
      key,
      title: archive.title,
      imageUrl: archive.imageUrl || archive.snapshotUrl,
      alt: archive.imageAlt || archive.title,
      caption: `${archive.title} — collaborative drawing archive from ${archive.roomName} with ${archive.participantCount} participants and ${archive.strokeCount} strokes.`,
      href: `/archive/${archive.id}`,
      roomHref: `/rooms/${archive.roomSlug}`,
      roomName: archive.roomName,
      roomSlug: archive.roomSlug,
      createdAt: archive.createdAt,
      meta: `${archive.participantCount} contributors · ${archive.countryCount} countries · ${archive.strokeCount} strokes`,
      schemaType: 'ImageObject'
    });
  }

  for (const slug of config.roomSlugs) {
    const room = rooms.get(slug);
    if (!room) continue;
    const key = `room:${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      type: 'room',
      key,
      title: `${room.name} live browser canvas preview`,
      imageUrl: roomPreviewPublicPath(room),
      alt: `${room.name} collaborative browser drawing canvas preview`,
      caption: `${room.name} is a live collaborative drawing room focused on ${room.theme.toLowerCase()}.`,
      href: `/rooms/${room.slug}`,
      roomHref: `/rooms/${room.slug}`,
      roomName: room.name,
      roomSlug: room.slug,
      createdAt: room.updatedAt || room.createdAt,
      meta: `${room.users.size} drawing now · ${room.viewers.size} viewers · ${room.archivedCount} archived rounds`,
      schemaType: 'ImageObject'
    });
  }

  return items.slice(0, 36);
}

function renderStructuredDataScripts(pageUrl, pageTitle, description, items) {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: pageTitle,
        description,
        url: pageUrl
      },
      ...items.slice(0, 12).map((item) => ({
        '@type': 'ImageObject',
        contentUrl: `https://canvases.chromethemer.com${item.imageUrl}`,
        name: item.title,
        description: item.caption,
        acquireLicensePage: item.href ? `https://canvases.chromethemer.com${item.href}` : undefined,
        creator: {
          '@type': 'Organization',
          name: 'ChromeThemer Canvases'
        }
      }))
    ]
  };
  return `<script type="application/ld+json">${JSON.stringify(graph)}</script>`;
}

function renderDrawingHubPage() {
  const topics = Object.entries(drawingTopicConfig()).map(([slug, cfg]) => ({ slug, ...cfg }));
  const cards = topics.map((topic) => `
    <article class="topic-card">
      <div class="topic-card__body">
        <h2><a href="/drawing/${topic.slug}">${escapeXml(topic.title)}</a></h2>
        <p>${escapeXml(topic.description)}</p>
        <div class="topic-card__chips">${topic.keywords.map((k) => `<span>${escapeXml(k)}</span>`).join('')}</div>
      </div>
    </article>`).join('');

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Drawing Topics | ChromeThemer Canvases</title>
    <meta name="description" content="Browse drawing topic pages built to help ChromeThemer Canvases earn long-tail search and Google Images traffic." />
    <link rel="canonical" href="https://canvases.chromethemer.com/drawing" />
    <style>:root{--bg:#0f1220;--panel:#181b31;--panel2:#1f2442;--text:#f5f7ff;--muted:#b9bfdc;--border:rgba(255,255,255,.08)}*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:linear-gradient(180deg,#0f1220,#13172a);color:var(--text);padding:24px}.wrap{max-width:1160px;margin:0 auto}.nav{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}.btn{padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#fff;text-decoration:none;font-weight:700}.hero,.topic-card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-radius:24px;box-shadow:0 18px 48px rgba(0,0,0,.24)}.hero{padding:26px;margin-bottom:22px}.hero p,.topic-card p{color:var(--muted);line-height:1.7}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}.topic-card__body{padding:20px}.topic-card__body h2{margin:0 0 10px}.topic-card__body a{color:#fff;text-decoration:none}.topic-card__chips{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.topic-card__chips span{padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:var(--muted);font-size:.92rem}</style>
    ${renderStructuredDataScripts('https://canvases.chromethemer.com/drawing', 'Drawing Topics', 'Drawing topic pages for ChromeThemer Canvases', [])}
  </head>
  <body>
    <div class="wrap">
      <div class="nav"><a class="btn" href="/">← Back to live canvases</a><a class="btn" href="/archives">Archive index</a></div>
      <section class="hero">
        <h1>Drawing Topics</h1>
        <p>These landing pages group related collaborative canvas images into crawlable topic clusters. Each page is built to support long-tail image discovery, archive discovery, and room discovery.</p>
      </section>
      <section class="grid">${cards}</section>
    </div>
  </body>
  </html>`;
}

function renderDrawingTopicPage(topicKey) {
  const config = drawingTopicConfig()[topicKey];
  if (!config) return null;
  const items = buildTopicVisualItems(topicKey);
  const pageUrl = `https://canvases.chromethemer.com/drawing/${topicKey}`;
  const cards = items.map((item) => `
    <figure class="drawing-card">
      <a class="drawing-card__media" href="${item.imageUrl}" aria-label="Open full image for ${escapeXml(item.title)}">
        <img src="${item.imageUrl}" alt="${escapeXml(item.alt)}" loading="lazy" width="1200" height="760" />
      </a>
      <figcaption class="drawing-card__body">
        <h2><a href="${item.href}">${escapeXml(item.title)}</a></h2>
        <p>${escapeXml(item.caption)}</p>
        <div class="drawing-card__meta">${escapeXml(item.meta)}</div>
        <div class="drawing-card__links"><a href="${item.href}">Open page</a> · <a href="${item.roomHref}">Room page</a> · <a href="${item.type === 'archive' ? archiveImageLandingPath({ id: item.key.replace('archive:', '') }) : `/image/room/${item.roomSlug}`}">Image page</a> · <a href="${item.imageUrl}">Open image</a></div>
      </figcaption>
    </figure>`).join('');

  const relatedLinks = Object.entries(drawingTopicConfig())
    .filter(([slug]) => slug !== topicKey)
    .map(([slug, cfg]) => `<a class="chip" href="/drawing/${slug}">${escapeXml(cfg.title)}</a>`)
    .join('');

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeXml(config.title)} | ChromeThemer Canvases</title>
    <meta name="description" content="${escapeXml(config.description)}" />
    <link rel="canonical" href="${pageUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeXml(config.title)} | ChromeThemer Canvases" />
    <meta property="og:description" content="${escapeXml(config.description)}" />
    <meta property="og:url" content="${pageUrl}" />
    ${items[0] ? `<meta property="og:image" content="https://canvases.chromethemer.com${items[0].imageUrl}" />` : ''}
    <style>:root{--bg:#0f1220;--panel:#181b31;--panel2:#1f2442;--text:#f5f7ff;--muted:#b9bfdc;--border:rgba(255,255,255,.08)}*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:linear-gradient(180deg,#0f1220,#13172a);color:var(--text);padding:24px}.wrap{max-width:1260px;margin:0 auto}.nav{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}.btn,.chip{padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#fff;text-decoration:none;font-weight:700}.hero{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-radius:28px;padding:26px;box-shadow:0 18px 48px rgba(0,0,0,.24);margin-bottom:22px}.hero p,.copy p{color:var(--muted);line-height:1.75;max-width:78ch}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,380px));gap:22px;align-items:start}.drawing-card{margin:0;background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-radius:24px;overflow:hidden;box-shadow:0 18px 42px rgba(0,0,0,.22)}.drawing-card__media img{width:100%;display:block;aspect-ratio:16/9;object-fit:cover;background:#171c32}.drawing-card__body{padding:18px}.drawing-card__body h2{margin:0 0 10px;font-size:1.08rem;line-height:1.4}.drawing-card__body h2 a,.drawing-card__links a{color:#fff;text-decoration:none}.drawing-card__body p,.drawing-card__meta{color:var(--muted);line-height:1.7}.drawing-card__links{margin-top:12px}.related,.copy{margin-top:22px}.chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}@media (max-width:720px){body{padding:16px}.grid{grid-template-columns:1fr}}</style>
    ${renderStructuredDataScripts(pageUrl, config.title, config.description, items)}
  </head>
  <body>
    <div class="wrap">
      <div class="nav"><a class="btn" href="/">← Back to live canvases</a><a class="btn" href="/drawing">All drawing topics</a><a class="btn" href="/archives">Archive index</a></div>
      <section class="hero">
        <h1>${escapeXml(config.heading)}</h1>
        <p>${escapeXml(config.description)}</p>
        <p>${escapeXml(config.intro)}</p>
      </section>
      <section class="grid">${cards || '<p>No drawings are available yet, but live room previews are being generated continuously.</p>'}</section>
      <section class="copy">
        <h2>How these drawing pages help discovery</h2>
        <p>Each visual on this page includes a descriptive filename, relevant alt text, surrounding context, and direct links into either a live room page or a replayable archive page. That gives ChromeThemer Canvases many more keyword combinations to target beyond the main gallery and archive index.</p>
      </section>
      <section class="related">
        <h2>Related drawing topics</h2>
        <div class="chips">${relatedLinks}</div>
      </section>
    </div>
  </body>
  </html>`;
}

function roomSeoProfile(room) {
  const slug = String(room.slug || 'canvas-room');
  const name = room.name || 'Canvas Room';
  const theme = (room.theme || 'collaborative drawing').toLowerCase();
  const text = `${slug} ${name} ${theme}`.toLowerCase();
  const topicMatches = [];
  if (/graffiti|scribble|mural/.test(text)) topicMatches.push('graffiti-wall');
  if (/abstract|storm|geometry|shape|neon/.test(text)) topicMatches.push('abstract-art');
  if (/browser|world|board|canvas/.test(text)) topicMatches.push('browser-canvas-art');
  if (/doodle|party|board|pixel/.test(text)) topicMatches.push('collaborative-doodle');
  const primaryTopic = topicMatches[0] || 'browser-canvas-art';
  const primaryTopicCfg = drawingTopicConfig()[primaryTopic] || drawingTopicConfig()['browser-canvas-art'];
  const keywordLabel = primaryTopicCfg ? primaryTopicCfg.title : 'Browser canvas art';
  const intro = `${name} is a standalone collaborative canvas page built to surface live browser drawing previews, room-specific archive snapshots, and long-tail image search intent around ${theme}. This page groups the current room image with recent saved rounds so visitors and search engines can understand the style, subject, and activity around this canvas.`;
  const caption = `${name} live collaborative browser drawing canvas preview showing ${theme} with shared strokes, layered marks, and a public room snapshot.`;
  const archiveIntro = `Recent drawings from ${name} help turn this room into a stronger standalone indexable page by pairing the live preview with archived collaborative images and descriptive captions.`;
  return { primaryTopic, keywordLabel, intro, caption, archiveIntro };
}

function pickRelatedRooms(room, limit = 3) {
  const profile = roomSeoProfile(room);
  return Array.from(rooms.values())
    .filter((candidate) => candidate.slug !== room.slug)
    .map((candidate) => {
      const other = roomSeoProfile(candidate);
      let score = 0;
      if (other.primaryTopic === profile.primaryTopic) score += 4;
      const roomTheme = (room.theme || '').toLowerCase();
      const candidateTheme = (candidate.theme || '').toLowerCase();
      if (roomTheme && candidateTheme && roomTheme.split(/[^a-z0-9]+/).some((token) => token && candidateTheme.includes(token))) score += 2;
      if ((candidate.slug || '').includes('board') && (room.slug || '').includes('board')) score += 1;
      if ((candidate.slug || '').includes('graffiti') && (room.slug || '').includes('graffiti')) score += 2;
      return { room: candidate, score };
    })
    .sort((a, b) => b.score - a.score || a.room.name.localeCompare(b.room.name))
    .slice(0, limit)
    .map((item) => item.room);
}

function renderRoomSeoPage(room) {
  const recent = archives.filter((item) => item.roomSlug === room.slug).slice(0, 12).map(serializeArchive);
  const roomUrl = `https://canvases.chromethemer.com/rooms/${room.slug}`;
  const profile = roomSeoProfile(room);
  const topicCfg = drawingTopicConfig()[profile.primaryTopic];
  const pageTitle = `${room.name} Live Collaborative Canvas`;
  const description = `${room.name} is a live collaborative browser canvas on ChromeThemer. Browse the room preview, recent archives, related rooms, and shared drawing activity around ${profile.keywordLabel.toLowerCase()}.`;
  const cards = recent.map((archive) => `
    <figure class="archive-card">
      <a class="archive-card__media" href="${archive.imageUrl || archive.snapshotUrl}"><img src="${archive.imageUrl || archive.snapshotUrl}" alt="${escapeXml(archive.imageAlt || archive.title)}" loading="lazy" width="800" height="453" /></a>
      <figcaption class="archive-card__body">
        <h2><a href="${archive.url}">${escapeXml(archive.title)}</a></h2>
        <p>${escapeXml(archive.title)} is a saved collaborative drawing from ${escapeXml(room.name)} with ${archive.participantCount} contributors, ${archive.countryCount} countries, and ${archive.strokeCount} strokes.</p>
        <div class="archive-meta">${archive.participantCount} contributors · ${archive.countryCount} countries · ${archive.strokeCount} strokes · <a href="${archive.url}">Archive page</a> · <a href="${archiveImageLandingPath(archive)}">Image page</a> · <a href="${archive.imageUrl || archive.snapshotUrl}">Open image</a></div>
      </figcaption>
    </figure>`).join('');
  const relatedRooms = pickRelatedRooms(room).map((candidate) => {
    const candidateProfile = roomSeoProfile(candidate);
    return `<article class="related-card">
      <a class="related-card__media" href="/rooms/${candidate.slug}"><img src="${roomPreviewPublicPath(candidate)}" alt="${escapeXml(candidate.name)} collaborative browser drawing preview" loading="lazy" width="800" height="453" /></a>
      <div class="related-card__body">
        <h3><a href="/rooms/${candidate.slug}">${escapeXml(candidate.name)}</a></h3>
        <p>${escapeXml(candidate.name)} is another live room focused on ${escapeXml(candidate.theme.toLowerCase())} and related to ${escapeXml(profile.keywordLabel.toLowerCase())}.</p>
        <div class="archive-meta"><a href="/rooms/${candidate.slug}">Open room page</a> · <a href="/drawing/${candidateProfile.primaryTopic}">View topic page</a></div>
      </div>
    </article>`;
  }).join('');
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeXml(pageTitle)} | ChromeThemer Canvases</title>
    <meta name="description" content="${escapeXml(description)}" />
    <link rel="canonical" href="${roomUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeXml(pageTitle)} | ChromeThemer Canvases" />
    <meta property="og:description" content="${escapeXml(description)}" />
    <meta property="og:url" content="${roomUrl}" />
    <meta property="og:image" content="https://canvases.chromethemer.com${roomPreviewPublicPath(room)}" />
    <link rel="image_src" href="https://canvases.chromethemer.com${roomPreviewPublicPath(room)}" />
    <style>:root{--bg:#0f1220;--panel:#181b31;--panel2:#1f2442;--text:#f5f7ff;--muted:#b9bfdc;--border:rgba(255,255,255,.08)}*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:linear-gradient(180deg,#0f1220,#13172a);color:var(--text);padding:24px}.wrap{max-width:1220px;margin:0 auto}.nav{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}.btn,.chip{padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#fff;text-decoration:none;font-weight:700}.hero,.panel,.archive-card,.related-card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-radius:24px;box-shadow:0 18px 48px rgba(0,0,0,.24)}.hero{padding:26px;margin-bottom:22px}.hero p,.panel p,.archive-card p,.related-card p{color:var(--muted);line-height:1.75}.grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:22px}.preview{overflow:hidden}.preview img,.related-card__media img{width:100%;display:block;aspect-ratio:16/9;object-fit:cover;background:#171c32}.preview__body,.panel,.archive-card__body,.related-card__body{padding:18px}.archive-grid,.related-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,360px));gap:20px;margin-top:22px}.archive-card,.related-card{overflow:hidden;margin:0}.archive-card__media img{width:100%;display:block;aspect-ratio:16/9;object-fit:cover}.archive-card__body h2,.related-card__body h3{margin:0 0 10px;font-size:1.05rem}.archive-card__body a,.related-card__body a{color:#fff;text-decoration:none}.chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}.chips span,.chip{padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:var(--muted)}.section-title{margin:28px 0 10px}.archive-meta{color:var(--muted);line-height:1.7}.copy{margin-top:22px}.copy p{color:var(--muted);line-height:1.75}.list{margin:12px 0 0;padding-left:18px;color:var(--muted)}@media (max-width:900px){.grid{grid-template-columns:1fr}}</style>
    ${renderStructuredDataScripts(roomUrl, pageTitle, description, [{ imageUrl: roomPreviewPublicPath(room), title: pageTitle, caption: profile.caption, href: `/rooms/${room.slug}` }, ...recent])}
  </head>
  <body>
    <div class="wrap">
      <div class="nav"><a class="btn" href="/">← Back to live canvases</a><a class="btn" href="/drawing">Drawing topics</a><a class="btn" href="/drawing/${profile.primaryTopic}">${escapeXml(topicCfg ? topicCfg.title : 'Related drawing topic')}</a><a class="btn" href="/archives">Archive index</a></div>
      <section class="hero">
        <h1>${escapeXml(room.name)}</h1>
        <p>${escapeXml(profile.intro)}</p>
        <div class="chips"><span>${escapeXml(room.theme)}</span><span>${room.users.size} drawing now</span><span>${room.viewers.size} viewers</span><span>${room.archivedCount} archived rounds</span><span>${escapeXml(profile.keywordLabel)}</span></div>
      </section>
      <section class="grid">
        <article class="preview panel">
          <a href="${roomPreviewPublicPath(room)}" aria-label="Open full image for ${escapeXml(room.name)}">
            <img src="${roomPreviewPublicPath(room)}" alt="${escapeXml(profile.caption)}" width="1200" height="760" />
          </a>
          <div class="preview__body">
            <h2>Live room preview</h2>
            <p>${escapeXml(profile.caption)}</p>
            <p>This preview image updates from the current room state and gives search engines an indexable canvas image tied directly to ${escapeXml(room.name)}.</p>
            <p><a class="chip" href="${roomImageLandingPath(room)}">Open image landing page</a> <a class="chip" href="${roomPreviewPublicPath(room)}">Open full image file</a></p>
          </div>
        </article>
        <aside class="panel">
          <h2>Room details</h2>
          <p>This room is part of the ChromeThemer Canvases network of collaborative browser drawing boards and is closely related to <a class="chip" href="/drawing/${profile.primaryTopic}">${escapeXml(topicCfg ? topicCfg.title : profile.keywordLabel)}</a>.</p>
          <ul class="list">
            <li>Countries shown: ${escapeXml((room.countries || []).join(', ') || 'Global mix')}</li>
            <li>Current round: ${room.roundNumber}</li>
            <li>Last updated: ${escapeXml(new Date(room.updatedAt || room.createdAt).toUTCString())}</li>
            <li>SEO focus: ${escapeXml(profile.keywordLabel)}</li>
          </ul>
          <p><a class="btn" href="/">Open the live canvases homepage</a></p>
        </aside>
      </section>
      <section class="copy">
        <h2 class="section-title">Why this room page is stronger for search</h2>
        <p>${escapeXml(profile.archiveIntro)}</p>
        <p>Each room page now combines a keyword-aware intro, a large preview image, room-specific archive cards, and internal links to related topic pages and nearby rooms. That expands the number of useful entry points without changing the live app itself.</p>
      </section>
      <h2 class="section-title">Recent archived drawings from ${escapeXml(room.name)}</h2>
      <section class="archive-grid">${cards || '<p>No archived rounds for this room yet.</p>'}</section>
      <h2 class="section-title">Related live rooms</h2>
      <section class="related-grid">${relatedRooms || '<p>Related room suggestions will appear as more live rooms are available.</p>'}</section>
    </div>
  </body>
  </html>`;
}


function renderImageLandingPage({ pageTitle, description, canonicalPath, imageUrl, imageAlt, imageCaption, backHref, backLabel, relatedLinks = [] }) {
  const pageUrl = `https://canvases.chromethemer.com${canonicalPath}`;
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeXml(pageTitle)} | ChromeThemer Canvases</title>
    <meta name="description" content="${escapeXml(description)}" />
    <link rel="canonical" href="${pageUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeXml(pageTitle)} | ChromeThemer Canvases" />
    <meta property="og:description" content="${escapeXml(description)}" />
    <meta property="og:url" content="${pageUrl}" />
    <meta property="og:image" content="https://canvases.chromethemer.com${imageUrl}" />
    <link rel="image_src" href="https://canvases.chromethemer.com${imageUrl}" />
    <style>:root{--bg:#0f1220;--panel:#181b31;--panel2:#1f2442;--text:#f5f7ff;--muted:#b9bfdc;--border:rgba(255,255,255,.08)}*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:linear-gradient(180deg,#0f1220,#13172a);color:var(--text);padding:24px}.wrap{max-width:1120px;margin:0 auto}.nav,.chips{display:flex;gap:12px;flex-wrap:wrap}.nav{margin-bottom:18px}.btn,.chip{padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#fff;text-decoration:none;font-weight:700}.hero,.panel{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-radius:24px;box-shadow:0 18px 48px rgba(0,0,0,.24)}.hero,.panel{padding:24px}.hero{margin-bottom:22px}.hero p,.panel p{color:var(--muted);line-height:1.75;max-width:78ch}.image-wrap{overflow:hidden;border-radius:20px;margin-top:18px;background:#171c32}.image-wrap img{width:100%;display:block;aspect-ratio:16/9;object-fit:cover}.related{margin-top:22px}</style>
    <script type="application/ld+json">${JSON.stringify({ '@context':'https://schema.org', '@graph':[ { '@type':'WebPage', name:pageTitle, description, url:pageUrl }, { '@type':'ImageObject', contentUrl:`https://canvases.chromethemer.com${imageUrl}`, name:pageTitle, description:imageCaption, creator:{'@type':'Organization',name:'ChromeThemer Canvases'} } ] })}</script>
  </head>
  <body>
    <div class="wrap">
      <div class="nav"><a class="btn" href="/">← Back to live canvases</a><a class="btn" href="${backHref}">${escapeXml(backLabel)}</a><a class="btn" href="${imageUrl}">Open full image file</a></div>
      <section class="hero">
        <h1>${escapeXml(pageTitle)}</h1>
        <p>${escapeXml(description)}</p>
        <p>${escapeXml(imageCaption)}</p>
        <div class="image-wrap"><a href="${imageUrl}"><img src="${imageUrl}" alt="${escapeXml(imageAlt)}" width="1200" height="760" /></a></div>
      </section>
      <section class="panel">
        <h2>Why this image page exists</h2>
        <p>This dedicated image landing page gives the same canvas artwork another clean crawlable context. Large art sites use these image-first pages so Google Images can discover the file, the caption, and the related destination page separately without needing a brand new image.</p>
        <div class="chips">${relatedLinks.join('')}</div>
      </section>
    </div>
  </body>
  </html>`;
}


app.get('/gallery', (_req, res) => {
  const { all } = galleryBuckets();
  res.send(renderGalleryPage(
    'Collaborative Drawing Gallery',
    'Browse collaborative canvas images, archive replays, and visual community drawings generated inside ChromeThemer Canvases. This gallery page is built to support image discovery and long-tail traffic.',
    all.slice(0, 60).map(serializeArchive),
    '/gallery'
  ));
});

app.get('/gallery/:slug', (req, res) => {
  const { bySlug } = galleryBuckets();
  const config = {
    graffiti: {
      title: 'Online Graffiti Wall Gallery',
      description: 'Explore graffiti-style collaborative drawings, layered browser wall art, and public digital graffiti boards created inside ChromeThemer Canvases.'
    },
    abstract: {
      title: 'Abstract Collaborative Drawing Gallery',
      description: 'Browse abstract collaborative canvases, color-heavy room archives, and geometric shared drawings from live browser sessions.'
    },
    pixel: {
      title: 'Pixel and Block Drawing Gallery',
      description: 'Discover pixel-inspired collaborative drawings, block party canvases, and retro-style browser artwork saved from live rounds.'
    },
    world: {
      title: 'Global Shared Canvas Gallery',
      description: 'See collaborative world doodle boards and shared browser drawings created by contributors across different rooms and sessions.'
    }
  };

  const slug = req.params.slug;
  const bucket = bySlug[slug];
  const bucketConfig = config[slug];
  if (!bucket || !bucketConfig) {
    res.status(404).send('Gallery not found');
    return;
  }

  res.send(renderGalleryPage(
    bucketConfig.title,
    bucketConfig.description,
    bucket.slice(0, 60).map(serializeArchive),
    `/gallery/${slug}`
  ));
});



app.get('/drawing', (_req, res) => {
  res.send(renderDrawingHubPage());
});

app.get('/drawing/:slug', (req, res) => {
  const html = renderDrawingTopicPage(req.params.slug);
  if (!html) {
    res.status(404).send('Drawing topic not found');
    return;
  }
  res.send(html);
});

app.get('/rooms/:slug', (req, res) => {
  const room = rooms.get(req.params.slug);
  if (!room) {
    res.status(404).send('Room not found');
    return;
  }
  res.send(renderRoomSeoPage(room));
});

app.get('/image/room/:slug', (req, res) => {
  const room = rooms.get(req.params.slug);
  if (!room) {
    res.status(404).send('Image page not found');
    return;
  }
  const profile = roomSeoProfile(room);
  const topicCfg = drawingTopicConfig()[profile.primaryTopic];
  res.send(renderImageLandingPage({
    pageTitle: `${room.name} Canvas Image`,
    description: `${room.name} image landing page for collaborative browser canvas discovery, Google Images indexing, and related room navigation.`,
    canonicalPath: roomImageLandingPath(room),
    imageUrl: roomPreviewPublicPath(room),
    imageAlt: roomDirectImageAlt(room),
    imageCaption: profile.caption,
    backHref: `/rooms/${room.slug}`,
    backLabel: `${room.name} room page`,
    relatedLinks: [
      `<a class="chip" href="/rooms/${room.slug}">Room page</a>`,
      `<a class="chip" href="/drawing/${profile.primaryTopic}">${escapeXml(topicCfg ? topicCfg.title : 'Related topic')}</a>`
    ]
  }));
});

app.get('/image/archive/:id', (req, res) => {
  const archive = archives.find((entry) => entry.id === req.params.id);
  if (!archive) {
    res.status(404).send('Image page not found');
    return;
  }
  const serialized = serializeArchive(archive);
  res.send(renderImageLandingPage({
    pageTitle: `${archive.title} Image`,
    description: `${archive.title} image landing page for collaborative canvas archive discovery and Google Images indexing.`,
    canonicalPath: archiveImageLandingPath(archive),
    imageUrl: archive.imageUrl || archive.snapshotUrl,
    imageAlt: archiveDirectImageAlt(archive),
    imageCaption: `${archive.title} from ${archive.roomName} with ${archive.participantCount} contributors, ${archive.countryCount} countries, and ${archive.strokeCount} strokes.`,
    backHref: serialized.url,
    backLabel: 'Archive page',
    relatedLinks: [
      `<a class="chip" href="${serialized.url}">Archive page</a>`,
      `<a class="chip" href="/rooms/${archive.roomSlug}">Room page</a>`
    ]
  }));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ChromeThemer Canvases server listening on port ${PORT}`);
});
