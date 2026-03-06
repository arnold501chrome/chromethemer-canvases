(() => {
  const socket = io({ transports: ["polling"] });

  const state = {
    rooms: [],
    archives: [],
    featured: [],
    selectedRoomSlug: "friday-graffiti",
    joinedRoomSlug: null,
    self: null,
    currentTool: "pen",
    currentColor: "#ff4fbf",
    currentSize: 6,
    isDrawing: false,
    currentPoints: [],
    clearVotes: { votes: 0, needed: 0 },
    noticeTimeout: null,
  };

  const roomGrid = document.getElementById("roomGrid");
  const archiveGrid = document.getElementById("archiveGrid");
  const heroRooms = document.getElementById("heroRooms");
  const heroCap = document.getElementById("heroCap");
  const heroPresence = document.getElementById("heroPresence");
  const heroPreviewImage = document.getElementById("heroPreviewImage");
  const heroPreviewBadge = document.getElementById("heroPreviewBadge");
  const joinStatus = document.getElementById("joinStatus");
  const guestNameInput = document.getElementById("guestNameInput");
  const joinModeSelect = document.getElementById("joinModeSelect");
  const joinRoomBtn = document.getElementById("joinRoomBtn");
  const scrollToWorkspaceBtn = document.getElementById("scrollToWorkspaceBtn");
  const boardHint = document.getElementById("boardHint");
  const voteClearBtn = document.getElementById("voteClearBtn");
  const userList = document.getElementById("userList");
  const archiveCountChip = document.getElementById("archiveCountChip");
  const featuredGrid = document.getElementById("featuredGrid");
  const featuredCountChip = document.getElementById("featuredCountChip");

  const overlayRoom = document.getElementById("overlayRoom");
  const overlayDrawing = document.getElementById("overlayDrawing");
  const overlayEnds = document.getElementById("overlayEnds");
  const overlayRound = document.getElementById("overlayRound");
  const sidebarRoomTitle = document.getElementById("sidebarRoomTitle");
  const sidebarDescription = document.getElementById("sidebarDescription");
  const sidebarDrawing = document.getElementById("sidebarDrawing");
  const sidebarWatching = document.getElementById("sidebarWatching");
  const sidebarCountries = document.getElementById("sidebarCountries");
  const sidebarUpdated = document.getElementById("sidebarUpdated");
  const sidebarCountryList = document.getElementById("sidebarCountryList");
  const sidebarCap = document.getElementById("sidebarCap");
  const sidebarArchiveCount = document.getElementById("sidebarArchiveCount");
  const clearVotesInfo = document.getElementById("clearVotesInfo");
  const roundInfo = document.getElementById("roundInfo");

  const baseCanvas = document.getElementById("baseLayer");
  const drawCanvas = document.getElementById("drawLayer");
  const baseCtx = baseCanvas.getContext("2d");
  const drawCtx = drawCanvas.getContext("2d");

  const toolButtons = Array.from(document.querySelectorAll(".ct-tool[data-tool]"));
  const sizeButtons = Array.from(document.querySelectorAll(".ct-tool[data-size]"));
  const colorSwatches = Array.from(document.querySelectorAll(".ct-swatch"));

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return "--";
    const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    return `${diffHours}h ago`;
  }

  function formatTimeLeft(target) {
    if (!target) return "--:--";
    const total = Math.max(0, Math.floor((target - Date.now()) / 1000));
    const minutes = String(Math.floor(total / 60)).padStart(2, "0");
    const seconds = String(total % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function selectedRoom() {
    return state.rooms.find((room) => room.slug === state.selectedRoomSlug) || state.rooms[0] || null;
  }

  function showNotice(message, tone = "default") {
    joinStatus.textContent = message;
    joinStatus.classList.remove("is-success", "is-danger");
    if (tone === "success") joinStatus.classList.add("is-success");
    if (tone === "danger") joinStatus.classList.add("is-danger");
    if (state.noticeTimeout) window.clearTimeout(state.noticeTimeout);
    state.noticeTimeout = window.setTimeout(() => {
      joinStatus.classList.remove("is-success", "is-danger");
    }, 2200);
  }

  function updateSidebarFromRoom(room) {
    if (!room) return;
    overlayRoom.textContent = `Room: ${room.name}`;
    overlayDrawing.textContent = `${room.activeDrawers} drawing right now`;
    overlayEnds.textContent = `Round ends in ${formatTimeLeft(room.roundEndsAt)}`;
    overlayRound.textContent = `Round ${room.roundNumber}`;
    sidebarRoomTitle.textContent = room.name;
    sidebarDescription.textContent = room.theme;
    sidebarDrawing.textContent = `${room.activeDrawers} drawing`;
    sidebarWatching.textContent = `${room.watchers} watching`;
    sidebarCountries.textContent = `${room.countries.length} countries`;
    sidebarUpdated.textContent = formatTimeAgo(room.updatedAt);
    sidebarCountryList.textContent = `Countries visible: ${room.countries.join(", ")}`;
    sidebarCap.textContent = `Room cap: ${room.maxUsers} active drawers`;
    sidebarArchiveCount.textContent = `Archived rounds: ${room.archivedCount}`;
    roundInfo.textContent = `Current round: ${room.roundNumber} · Ends in ${formatTimeLeft(room.roundEndsAt)}`;
    heroPreviewImage.src = room.snapshotUrl;
    heroPreviewBadge.textContent = `Live preview · ${room.name}`;
  }

  function renderUserList(users = []) {
    if (!users.length) {
      userList.innerHTML = '<span class="ct-muted">No active drawers yet.</span>';
      return;
    }
    userList.innerHTML = users.map((user) => {
      const me = state.self && user.id === state.self.id ? " me" : "";
      const label = state.self && user.id === state.self.id ? `${escapeHtml(user.name)} · You` : escapeHtml(user.name);
      return `<span class="ct-user-chip${me}">${label}</span>`;
    }).join("");
  }

  function roomCardHtml(room) {
    const isSelected = room.slug === state.selectedRoomSlug ? " is-selected" : "";
    const isJoined = room.slug === state.joinedRoomSlug ? " Joined" : "";
    return `
      <article class="ct-panel ct-room${isSelected}" data-slug="${room.slug}">
        <div class="ct-room__media">
          <div class="ct-room__topline">
            <span class="ct-live">Live now</span>
            <span class="ct-pill">Round ${room.roundNumber}</span>
          </div>
          <div class="ct-preview">
            <img src="${room.snapshotUrl}" alt="${escapeHtml(room.name)} preview" />
          </div>
        </div>
        <div class="ct-room__body">
          <h3>${escapeHtml(room.name)}</h3>
          <div class="ct-room__meta">
            <span>${room.activeDrawers} drawing</span>
            <span>${room.watchers} watching</span>
            <span>Ends in ${formatTimeLeft(room.roundEndsAt)}</span>
          </div>
          <p>${escapeHtml(room.theme)}</p>
          <div class="ct-room__foot">
            <div class="ct-avatars"><span>🎨</span><span>🌍</span><span>✨</span><span>🖍️</span></div>
            <button class="ct-btn ct-btn--primary" type="button">Join canvas${isJoined}</button>
          </div>
        </div>
      </article>
    `;
  }

  function archiveCardHtml(archive, featured = false) {
    return `
      <article class="ct-panel ct-archive${featured ? ' ct-archive--featured' : ''}">
        <div class="ct-preview"><img src="${archive.snapshotUrl}" alt="${escapeHtml(archive.title)} preview" /></div>
        <div class="ct-archive__body">
          <h3><a href="${archive.url}" target="_blank" rel="noopener">${escapeHtml(archive.title)}</a></h3>
          <p>${archive.participantCount} contributors · ${archive.countryCount} countries · ${archive.strokeCount} strokes · ${formatTimeAgo(archive.createdAt)}</p>
          <p class="ct-archive__links"><a href="${archive.replayUrl || archive.url}" target="_blank" rel="noopener">Replay drawing</a>${featured ? ` · <span>Score ${Math.round(archive.featuredScore || 0)}</span>` : ''}</p>
        </div>
      </article>
    `;
  }

  function renderArchives() {
    archiveCountChip.textContent = `${state.archives.length} recent archives`;
    if (!state.archives.length) {
      archiveGrid.innerHTML = '<article class="ct-panel ct-archive"><div class="ct-preview"><div class="ct-preview__placeholder">No finished rounds yet</div></div><div class="ct-archive__body"><h3>Archives appear when rounds finish</h3><p>As soon as a room ends, the final canvas snapshot becomes a crawlable archive page.</p></div></article>';
      return;
    }
    archiveGrid.innerHTML = state.archives.map((archive) => archiveCardHtml(archive)).join("");
  }

  function renderFeatured() {
    featuredCountChip.textContent = `${state.featured.length} featured drawings`;
    if (!state.featured.length) {
      featuredGrid.innerHTML = '<article class="ct-panel ct-archive"><div class="ct-preview"><div class="ct-preview__placeholder">No featured drawings yet</div></div><div class="ct-archive__body"><h3>Featured drawings appear as archives build up</h3><p>Once enough rounds have been saved, the highest-scoring ones will appear here for replay and sharing.</p></div></article>';
      return;
    }
    featuredGrid.innerHTML = state.featured.map((archive) => archiveCardHtml(archive, true)).join("");
  }

  function renderLobby() {
    heroRooms.textContent = `${state.rooms.length} live rooms`;
    heroCap.textContent = state.rooms[0] ? `${state.rooms[0].maxUsers} max per room` : "50 max per room";
    roomGrid.innerHTML = state.rooms.map(roomCardHtml).join("");

    roomGrid.querySelectorAll(".ct-room").forEach((card) => {
      card.addEventListener("click", () => {
        joinSelectedRoom(card.dataset.slug, true);
      });
    });

    updateSidebarFromRoom(selectedRoom());
    syncBoardHint();
  }

  function resizeCanvasForDisplay() {
    baseCanvas.width = 1200;
    baseCanvas.height = 760;
    drawCanvas.width = 1200;
    drawCanvas.height = 760;
  }

  function clearBaseCanvas() { baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height); }
  function clearDrawCanvas() { drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height); }

  function drawStroke(ctx, stroke) {
    if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) return;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = stroke.size || 6;
    if (stroke.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = stroke.color || "#ff4fbf";
    }
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i += 1) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function redrawHistory(strokes) {
    clearBaseCanvas();
    (strokes || []).forEach((stroke) => drawStroke(baseCtx, stroke));
  }

  function getPoint(event) {
    const rect = drawCanvas.getBoundingClientRect();
    const scaleX = drawCanvas.width / rect.width;
    const scaleY = drawCanvas.height / rect.height;
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
  }

  function canDraw() {
    return Boolean(state.self && state.self.mode === "drawer" && state.joinedRoomSlug === state.selectedRoomSlug);
  }

  function syncBoardHint() {
    if (!boardHint) return;
    const room = selectedRoom();
    if (canDraw()) {
      boardHint.classList.add("is-hidden");
      return;
    }
    if (state.self && state.self.mode === "viewer" && state.joinedRoomSlug === state.selectedRoomSlug) {
      boardHint.innerHTML = `You joined <strong>${room ? room.name : "this room"}</strong> as a viewer. Switch to drawer mode if you want to draw.`;
    } else {
      boardHint.innerHTML = `Click <strong>Join canvas</strong> on any room card to enter <strong>${room ? room.name : "a room"}</strong> and start drawing instantly.`;
    }
    boardHint.classList.remove("is-hidden");
  }

  function beginStroke(event) {
    if (!canDraw()) return;
    state.isDrawing = true;
    state.currentPoints = [getPoint(event)];
    clearDrawCanvas();
    drawStroke(drawCtx, {
      points: [state.currentPoints[0], { ...state.currentPoints[0], x: state.currentPoints[0].x + 0.01, y: state.currentPoints[0].y + 0.01 }],
      size: state.currentSize,
      color: state.currentColor,
      tool: state.currentTool,
    });
  }

  function moveStroke(event) {
    if (!state.isDrawing || !canDraw()) return;
    const point = getPoint(event);
    state.currentPoints.push(point);
    clearDrawCanvas();
    drawStroke(drawCtx, {
      points: state.currentPoints,
      size: state.currentSize,
      color: state.currentColor,
      tool: state.currentTool,
    });
  }

  function endStroke() {
    if (!state.isDrawing || !canDraw()) return;
    state.isDrawing = false;
    if (state.currentPoints.length) {
      const stroke = {
        points: state.currentPoints,
        size: state.currentSize,
        color: state.currentColor,
        tool: state.currentTool,
      };
      drawStroke(baseCtx, stroke);
      socket.emit("stroke:add", stroke);
    }
    state.currentPoints = [];
    clearDrawCanvas();
  }

  function joinSelectedRoom(slugOverride = null, shouldScroll = true) {
    const room = state.rooms.find((item) => item.slug === slugOverride) || selectedRoom();
    if (!room) return;
    state.selectedRoomSlug = room.slug;
    if (!guestNameInput.value.trim()) guestNameInput.value = `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
    socket.emit("room:join", { slug: room.slug, name: guestNameInput.value.trim(), mode: joinModeSelect.value });
    renderLobby();
    updateSidebarFromRoom(room);
    syncBoardHint();
    if (shouldScroll) document.getElementById("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  socket.on("connect", () => {
    heroPresence.textContent = "Connected";
    heroPresence.classList.add("is-success");
  });

  socket.on("disconnect", () => {
    heroPresence.textContent = "Disconnected";
    heroPresence.classList.remove("is-success");
    showNotice("Connection lost", "danger");
    syncBoardHint();
  });

  socket.on("lobby:update", (rooms) => {
    state.rooms = Array.isArray(rooms) ? rooms : [];
    if (!state.rooms.find((room) => room.slug === state.selectedRoomSlug) && state.rooms[0]) state.selectedRoomSlug = state.rooms[0].slug;
    renderLobby();
  });

  socket.on("archives:update", (archives) => {
    state.archives = Array.isArray(archives) ? archives : [];
    renderArchives();
  });

  socket.on("featured:update", (featured) => {
    state.featured = Array.isArray(featured) ? featured : [];
    renderFeatured();
  });

  socket.on("room:joined", ({ room, strokes, users, self }) => {
    state.joinedRoomSlug = room.slug;
    state.selectedRoomSlug = room.slug;
    state.self = self;
    renderLobby();
    redrawHistory(strokes);
    renderUserList(users || []);
    showNotice(`Joined ${room.name} as ${self.mode}`, "success");
    syncBoardHint();
  });

  socket.on("room:state", ({ room, users, clearVotes, clearVotesNeeded }) => {
    const idx = state.rooms.findIndex((item) => item.slug === room.slug);
    if (idx >= 0) state.rooms[idx] = room;
    renderLobby();
    if (room.slug === state.selectedRoomSlug) {
      updateSidebarFromRoom(room);
      renderUserList(users || []);
    }
    state.clearVotes = { votes: clearVotes || 0, needed: clearVotesNeeded || 0 };
    clearVotesInfo.textContent = `Clear votes: ${state.clearVotes.votes} / ${state.clearVotes.needed}`;
    syncBoardHint();
  });

  socket.on("presence:update", ({ room, users }) => {
    const idx = state.rooms.findIndex((item) => item.slug === room.slug);
    if (idx >= 0) state.rooms[idx] = room;
    renderLobby();
    if (room.slug === state.selectedRoomSlug) {
      updateSidebarFromRoom(room);
      renderUserList(users || []);
    }
  });

  socket.on("stroke:added", (stroke) => {
    drawStroke(baseCtx, stroke);
  });

  socket.on("room:cleared", ({ room, archive }) => {
    clearBaseCanvas();
    clearDrawCanvas();
    const idx = state.rooms.findIndex((item) => item.slug === room.slug);
    if (idx >= 0) state.rooms[idx] = room;
    renderLobby();
    if (room.slug === state.selectedRoomSlug) updateSidebarFromRoom(room);
    if (archive) {
      state.archives.unshift(archive);
      state.archives = state.archives.slice(0, 12);
      renderArchives();
      showNotice(`${room.name} moved to archive. Round ${room.roundNumber - 1} saved.`, "success");
      fetch('/api/canvases/featured').then((res) => res.json()).then((data) => { state.featured = Array.isArray(data.featured) ? data.featured : []; renderFeatured(); }).catch(() => {});
    }
  });

  socket.on("room:clear-votes", ({ votes, needed }) => {
    state.clearVotes = { votes, needed };
    clearVotesInfo.textContent = `Clear votes: ${votes} / ${needed}`;
  });

  socket.on("room:full", ({ message }) => {
    showNotice(message, "danger");
    syncBoardHint();
  });

  socket.on("room:error", ({ message }) => {
    showNotice(message, "danger");
    syncBoardHint();
  });

  joinRoomBtn.addEventListener("click", () => joinSelectedRoom());
  scrollToWorkspaceBtn.addEventListener("click", () => {
    document.getElementById("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  joinModeSelect.addEventListener("change", syncBoardHint);
  voteClearBtn.addEventListener("click", () => socket.emit("room:vote-clear"));

  toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.currentTool = button.dataset.tool;
      toolButtons.forEach((btn) => btn.classList.toggle("is-selected", btn === button));
    });
  });

  sizeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.currentSize = Number(button.dataset.size);
      sizeButtons.forEach((btn) => btn.classList.toggle("is-selected", btn === button));
    });
  });

  colorSwatches.forEach((swatch) => {
    swatch.addEventListener("click", () => {
      state.currentColor = swatch.dataset.color;
      state.currentTool = "pen";
      toolButtons.forEach((btn) => btn.classList.toggle("is-selected", btn.dataset.tool === "pen"));
      colorSwatches.forEach((item) => item.classList.toggle("is-selected", item === swatch));
    });
  });

  drawCanvas.addEventListener("pointerdown", beginStroke);
  drawCanvas.addEventListener("pointermove", moveStroke);
  drawCanvas.addEventListener("pointerup", endStroke);
  drawCanvas.addEventListener("pointerleave", endStroke);
  drawCanvas.addEventListener("pointercancel", endStroke);

  window.setInterval(() => {
    const room = selectedRoom();
    if (room) {
      overlayEnds.textContent = `Round ends in ${formatTimeLeft(room.roundEndsAt)}`;
      sidebarUpdated.textContent = formatTimeAgo(room.updatedAt);
      roundInfo.textContent = `Current round: ${room.roundNumber} · Ends in ${formatTimeLeft(room.roundEndsAt)}`;
    }
  }, 1000);

  resizeCanvasForDisplay();
  syncBoardHint();
  renderArchives();
  renderFeatured();
  fetch('/api/canvases/featured').then((res) => res.json()).then((data) => { state.featured = Array.isArray(data.featured) ? data.featured : []; renderFeatured(); }).catch(() => {});
})();
