
const path = require("path");
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

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

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

function makePreviewSvg(config) {
  const { bg1, bg2, stroke1, stroke2, accent1, accent2 } = config;
  return `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 340" preserveAspectRatio="none">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${bg1}" />
          <stop offset="100%" stop-color="${bg2}" />
        </linearGradient>
      </defs>
      <rect width="600" height="340" fill="url(#g)" />
      <path d="M42 216 C92 122, 176 124, 242 206 S384 284, 450 178 S534 108, 566 144" fill="none" stroke="${stroke1}" stroke-width="12" stroke-linecap="round" />
      <path d="M84 108 C146 44, 236 76, 308 134 S460 214, 530 142" fill="none" stroke="${stroke2}" stroke-width="10" stroke-linecap="round" />
      <circle cx="174" cy="220" r="24" fill="${accent1}" opacity="0.96" />
      <rect x="382" y="174" width="84" height="84" rx="18" fill="${accent2}" opacity="0.9" />
    </svg>
  `)}`;
}

function createRoom(slug, name, theme, countries, previewConfig) {
  return {
    slug,
    name,
    theme,
    countries,
    maxUsers: ROOM_LIMIT,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    roundEndsAt: minutesFromNow(15, 45),
    users: new Map(),
    viewers: new Map(),
    strokes: [],
    clearVotes: new Set(),
    archivedCount: randomBetween(3, 80),
    snapshotUrl: makePreviewSvg(previewConfig),
  };
}

const rooms = new Map([
  ["friday-graffiti", createRoom("friday-graffiti", "Friday Graffiti", "High-energy freestyle", ["South Africa", "UK", "USA", "Mexico"], {
    bg1: "#20183f", bg2: "#14182d", stroke1: "#8a5cff", stroke2: "#ff4fbf", accent1: "#ffd54f", accent2: "#4de3a1",
  })],
  ["neon-scribble-wall", createRoom("neon-scribble-wall", "Neon Scribble Wall", "Fast abstract marks", ["South Africa", "USA", "Brazil", "Germany"], {
    bg1: "#171f3c", bg2: "#16172f", stroke1: "#ff4fbf", stroke2: "#4ea5ff", accent1: "#ffd54f", accent2: "#4de3a1",
  })],
  ["color-storm", createRoom("color-storm", "Color Storm", "Circles, swirls, layered blocks", ["Japan", "France", "South Africa"], {
    bg1: "#201739", bg2: "#171d30", stroke1: "#ffd54f", stroke2: "#8a5cff", accent1: "#ff4fbf", accent2: "#4ea5ff",
  })],
  ["world-doodle-board", createRoom("world-doodle-board", "World Doodle Board", "Welcoming default room", ["South Africa", "Korea", "USA", "Spain"], {
    bg1: "#13263a", bg2: "#162030", stroke1: "#4de3a1", stroke2: "#4ea5ff", accent1: "#ff4fbf", accent2: "#ffd54f",
  })],
  ["geometry-jam", createRoom("geometry-jam", "Geometry Jam", "Shapes and clean scenes", ["South Africa", "Netherlands", "Australia"], {
    bg1: "#1d1737", bg2: "#141b2d", stroke1: "#ffd54f", stroke2: "#4ea5ff", accent1: "#ff4fbf", accent2: "#8a5cff",
  })],
  ["block-party-board", createRoom("block-party-board", "Block Party Board", "Chunky forms and icon art", ["Canada", "South Africa", "India"], {
    bg1: "#13223b", bg2: "#171b2f", stroke1: "#4ea5ff", stroke2: "#4de3a1", accent1: "#ff4fbf", accent2: "#ffd54f",
  })],
  ["pixel-party", createRoom("pixel-party", "Pixel Party", "Bright browser chaos", ["South Africa", "USA", "India", "Argentina"], {
    bg1: "#23153a", bg2: "#17192d", stroke1: "#ff4fbf", stroke2: "#ffd54f", accent1: "#4ea5ff", accent2: "#4de3a1",
  })],
  ["midnight-mural", createRoom("midnight-mural", "Midnight Mural", "Dark neon collaboration", ["South Africa", "Germany", "Italy"], {
    bg1: "#10162f", bg2: "#191737", stroke1: "#4ea5ff", stroke2: "#8a5cff", accent1: "#4de3a1", accent2: "#ffd54f",
  })],
]);

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
    archivedCount: room.archivedCount,
    snapshotUrl: room.snapshotUrl,
  };
}

function getLobbyRooms() {
  return Array.from(rooms.values()).slice(0, LOBBY_LIMIT).map(serializeRoom);
}

function markRoomUpdated(room) {
  room.updatedAt = nowIso();
}

function broadcastLobby() {
  io.emit("lobby:update", getLobbyRooms());
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
}

function resetRoom(room) {
  room.strokes = [];
  room.clearVotes.clear();
  room.roundEndsAt = minutesFromNow(15, 45);
  room.archivedCount += 1;
  markRoomUpdated(room);
  io.to(room.slug).emit("room:cleared", { room: serializeRoom(room) });
  broadcastRoomState(room);
  broadcastLobby();
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

app.get("/api/canvases/lobby", (_req, res) => {
  res.json({ ok: true, rooms: getLobbyRooms() });
});

app.get("/api/canvases/room/:slug", (req, res) => {
  const room = rooms.get(req.params.slug);
  if (!room) {
    return res.status(404).json({ ok: false, error: "Room not found" });
  }

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
  if (!room) {
    return res.status(404).json({ ok: false, error: "Room not found" });
  }

  resetRoom(room);
  return res.json({ ok: true, room: serializeRoom(room) });
});

io.on("connection", (socket) => {
  socket.emit("lobby:update", getLobbyRooms());

  socket.on("room:join", (payload = {}) => {
    const slug = typeof payload.slug === "string" ? payload.slug : "friday-graffiti";
    const room = rooms.get(slug);

    if (!room) {
      socket.emit("room:error", { message: "Room does not exist." });
      return;
    }

    const requestedName = typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim().slice(0, 24)
      : makeGuestName();
    const mode = payload.mode === "viewer" ? "viewer" : "drawer";

    if (mode === "drawer" && room.users.size >= room.maxUsers) {
      socket.emit("room:full", {
        slug,
        message: "This room is currently full. Please try another room.",
      });
      return;
    }

    leaveExistingRoom(socket);

    socket.join(room.slug);
    socket.data.roomSlug = room.slug;
    socket.data.mode = mode;
    socket.data.guestName = requestedName;

    const guest = {
      id: socket.id,
      name: requestedName,
      mode,
      joinedAt: nowIso(),
    };

    if (mode === "drawer") {
      room.users.set(socket.id, guest);
    } else {
      room.viewers.set(socket.id, guest);
    }

    markRoomUpdated(room);

    socket.emit("room:joined", {
      room: serializeRoom(room),
      strokes: room.strokes,
      users: Array.from(room.users.values()),
      viewers: Array.from(room.viewers.values()),
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

    const rawPoints = Array.isArray(payload.points) ? payload.points : [];
    const points = rawPoints
      .slice(0, 256)
      .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
      .map((point) => ({
        x: Math.max(0, Math.min(1200, Number(point.x))),
        y: Math.max(0, Math.min(760, Number(point.y))),
      }));

    if (!points.length) return;

    const stroke = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      userId: socket.id,
      name: socket.data.guestName || makeGuestName(),
      color: typeof payload.color === "string" ? payload.color : "#ff4fbf",
      size: Number.isFinite(payload.size) ? Math.max(1, Math.min(30, Number(payload.size))) : 6,
      points,
      tool: payload.tool === "eraser" ? "eraser" : "pen",
      createdAt: nowIso(),
    };

    appendStroke(room, stroke);
    io.to(room.slug).emit("stroke:added", stroke);
    broadcastLobby();
  });

  socket.on("room:vote-clear", () => {
    const roomSlug = socket.data.roomSlug;
    const room = rooms.get(roomSlug);
    if (!room || !room.users.has(socket.id)) return;

    room.clearVotes.add(socket.id);
    const needed = Math.max(2, Math.ceil(Math.max(1, room.users.size) * 0.6));

    io.to(room.slug).emit("room:clear-votes", {
      votes: room.clearVotes.size,
      needed,
    });

    if (room.clearVotes.size >= needed) {
      resetRoom(room);
    }
  });

  socket.on("disconnect", () => {
    leaveExistingRoom(socket);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.roundEndsAt <= now) {
      resetRoom(room);
    }
  }
}, 5000);

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ChromeThemer Canvases server listening on port ${PORT}`);
});
