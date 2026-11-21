import fs from 'node:fs';
import { defineServer, defineRoom, matchMaker } from 'colyseus';
import { NightRoom } from './NightRoom.js';

// The browser client, built for this server (npm run build with COOP_SERVER_URL set,
// copied to server/public/index.html before the image is staged; not in git).
// It gives the team a direct play link. The Stateloop play page is the other way in.
const CLIENT = new URL('../public/index.html', import.meta.url);

// Origins allowed to call the HTTP matchmaking routes. The game runs in the
// Stateloop play frame (play.stateloop.ai). Add local origins with EXTRA_ORIGINS.
const ALLOWED = new Set(
  (process.env.ALLOWED_ORIGINS || 'https://play.stateloop.ai,https://creator.stateloop.ai,https://games.stateloop.ai')
    .split(',').map((s) => s.trim()).filter(Boolean),
);
for (const o of (process.env.EXTRA_ORIGINS || '').split(',')) if (o.trim()) ALLOWED.add(o.trim());

matchMaker.controller.getCorsHeaders = function (headers) {
  const origin = headers.get('origin') || '';
  // The SDK calls matchmaking with credentials: "include", so browsers need
  // the exact origin echoed back (Allow-Credentials is true by default).
  return { 'Access-Control-Allow-Origin': ALLOWED.has(origin) ? origin : 'null', Vary: 'Origin' };
};

const server = defineServer({
  rooms: {
    night: defineRoom(NightRoom),
  },
  express: (app) => {
    const page = (req, res) => {
      if (!fs.existsSync(CLIENT)) { res.status(404).type('text/plain').send('No client in this image.'); return; }
      res.set({ 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.type('html').send(fs.readFileSync(CLIENT));
    };
    app.get('/', page);
    app.get('/index.html', page);
    app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
  },
});

export default server;
