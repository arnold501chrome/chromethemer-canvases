(function () {
  function init() {
    const strokes = Array.isArray(window.__ARCHIVE_REPLAY__) ? window.__ARCHIVE_REPLAY__ : [];
    const canvas = document.getElementById('replayCanvas');
    const playBtn = document.getElementById('playBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const resetBtn = document.getElementById('resetBtn');
    const progressText = document.getElementById('progressText');
    const progressRange = document.getElementById('progressRange');

    if (!canvas || !playBtn || !pauseBtn || !resetBtn || !progressText || !progressRange) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let index = 0;
    let playing = false;
    let lastTs = 0;
    const msPerStroke = 70;

    function paintBackground() {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, '#1a1d36');
      gradient.addColorStop(1, '#15182b');
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function clearBoard() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      paintBackground();
    }

    function drawStroke(stroke) {
      if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) return;
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = Number(stroke.size) || 6;
      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color || '#ff4fbf';
      }
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i += 1) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }

    function syncUi() {
      progressRange.max = String(strokes.length);
      progressRange.value = String(index);
      progressText.textContent = index + ' / ' + strokes.length + ' strokes';
    }

    function redrawTo(target) {
      clearBoard();
      const safeTarget = Math.max(0, Math.min(strokes.length, Number(target) || 0));
      for (let i = 0; i < safeTarget; i += 1) {
        drawStroke(strokes[i]);
      }
      index = safeTarget;
      syncUi();
    }

    function step(ts) {
      if (!playing) return;
      if (!lastTs) lastTs = ts;
      if (ts - lastTs >= msPerStroke) {
        if (index >= strokes.length) {
          playing = false;
          lastTs = 0;
          syncUi();
          return;
        }
        drawStroke(strokes[index]);
        index += 1;
        syncUi();
        lastTs = ts;
      }
      window.requestAnimationFrame(step);
    }

    function play() {
      if (playing) return;
      playing = true;
      lastTs = 0;
      window.requestAnimationFrame(step);
    }

    function pause() {
      playing = false;
      lastTs = 0;
    }

    playBtn.addEventListener('click', play);
    pauseBtn.addEventListener('click', pause);
    resetBtn.addEventListener('click', function () {
      pause();
      redrawTo(0);
    });
    progressRange.addEventListener('input', function (event) {
      pause();
      redrawTo(event.target.value);
    });

    redrawTo(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
