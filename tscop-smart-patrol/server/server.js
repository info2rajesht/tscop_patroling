/**
 * ============================================================================
 * TSCOP / Fusion safeOS Smart Patrol Management System
 * Core Native Node.js Server (Port 3000)
 * Uses Node.js standard built-ins (http, fs, path, url) - zero external npm dependencies required!
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { handleApiRequest } = require('./routes/apiRoutes');
const { stepTelemetry } = require('./services/patrolSimulator');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DB_FILE = path.join(__dirname, 'data', 'db.json');

// MIME types lookup table
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.jsx': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Connected SSE clients for live telemetry streaming
const sseClients = new Set();

function broadcastEvent(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (_e) {
      sseClients.delete(client);
    }
  }
}

// Telemetry loop: pushes live GPS vehicle coordinates to all connected browsers every 2.5s
setInterval(() => {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(raw);
    const updatedVehicles = stepTelemetry(db.vehicles || []);
    db.vehicles = updatedVehicles;
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    broadcastEvent('telemetry:update', { vehicles: updatedVehicles, timestamp: new Date().toISOString() });
  } catch (_e) {
    // Ignore transient file lock
  }
}, 2500);

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. Server-Sent Events (SSE) Live Feed
  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // 2. REST API Handler
  if (pathname.startsWith('/api/')) {
    let bodyStr = '';
    req.on('data', chunk => {
      bodyStr += chunk;
      if (bodyStr.length > 2e6) req.destroy(); // 2MB safety limit
    });
    req.on('end', () => {
      let body = {};
      if (bodyStr.trim().length > 0) {
        try {
          body = JSON.parse(bodyStr);
        } catch (_e) {
          body = {};
        }
      }
      handleApiRequest(req, res, parsedUrl, body, broadcastEvent).catch(err => {
        console.error('API Error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });
    return;
  }

  // 3. Static Files Serving
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA routing
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log(` TSCOP Smart Patrol & Beat Management Server is running!`);
  console.log(` Web Command Center & Mobile Simulator: http://localhost:${PORT}`);
  console.log(` Historical Intelligence Engine        : Active`);
  console.log('================================================================');
});
