# ChromeThemer Canvases Test Project

This is a working real-time prototype for the `/canvases/` idea.

## What it includes

- Express server
- Socket.IO real-time syncing
- 8 public rooms in a live lobby
- guest join flow
- drawer and viewer modes
- shared drawing canvas
- room cap support
- clear-vote support
- timed room resets
- ChromeThemer-style UI with a right sidebar ad area

## Quick start

1. Open a terminal in this project folder
2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

4. Open:

```text
http://localhost:3000
```

## How to test multiplayer

Open the site in:
- two browser windows
- or one normal window and one incognito window
- or two different devices on the same network

Join the same room in both windows and draw. Strokes should appear live for everyone in that room.

## Files

- `server.js` → backend server and room state
- `public/index.html` → main page
- `public/styles.css` → UI styling
- `public/app.js` → front-end room logic and drawing sync

## Important notes

This is still a prototype.

It now includes:
- archive metadata persisted to `storage/data/archives.json`
- generated archive images under `storage/images/`
- generated room and archive SVGs under `storage/generated/`
- atomic archive writes to reduce corruption risk

It does **not** yet include:
- external database storage
- moderation tools
- real snapshot generation from canvas state
- archived image export pages
- production rate limiting
- admin controls
- per-room SEO pages

## Recommended next step

After you test this locally, the next step would be to create:
- a deploy-ready version for your host or VPS
- room snapshots
- final round archive generation
- moderation and abuse controls


## New in this build
- Replayable archive pages
- Featured drawings page at /featured
- Richer archive cards with replay links
- Live room previews remain generated from real canvas state


## Storage and durability

This build moves archive metadata and generated assets into a dedicated `storage/` directory.

By default the app stores data in:

- `storage/data/archives.json`
- `storage/images/`
- `storage/generated/archives/`
- `storage/generated/rooms/`

You can override the storage root with the `STORAGE_DIR` environment variable.

Example:

```bash
STORAGE_DIR=/path/to/persistent/storage npm start
```

For Render or other hosts, point `STORAGE_DIR` at a persistent disk mount if you want archives and generated images to survive redeploys and restarts.
