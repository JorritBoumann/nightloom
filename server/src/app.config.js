import { defineServer, defineRoom, matchMaker } from 'colyseus';
import { NightRoom } from './NightRoom.js';

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
});

export default server;
