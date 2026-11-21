import { listen } from '@colyseus/tools';
import server from './app.config.js';
import { storageInfo } from './recording.js';

// PORT comes from the environment (Railway sets it). Health: GET /__healthcheck
console.log('[nightloom] recordings:', JSON.stringify(storageInfo()));
listen(server);
