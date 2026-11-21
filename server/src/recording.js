// Game-side recorder: one file per episode (one shift), in the format
// "nightloom-online-v1". It holds everything needed to replay the episode
// exactly from the seed: the applied inputs of both seats on every step,
// plus events, state hashes, keyframes, network data and a summary, which
// the converter (tools/convert.mjs) checks against its own replay.
//
// Storage: always a local folder (NIGHTLOOM_REC_DIR, default ./.recordings),
// plus an S3-compatible bucket when STATELOOP_S3_ENDPOINT, STATELOOP_S3_BUCKET,
// STATELOOP_S3_ACCESS_KEY_ID and STATELOOP_S3_SECRET_ACCESS_KEY are set
// (STATELOOP_S3_REGION, default auto; STATELOOP_S3_URL_STYLE path or virtual).
// The same variables as the Stateloop co-op host, so one bucket serves both.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { AwsClient } from 'aws4fetch';

export const FORMAT = 'nightloom-online-v1';
export const PREFIX = 'nightloom';
export const NAMES_PREFIX = 'nightloom-names';   // typed player names, apart from the play data
export const PLAYERS_PREFIX = 'nightloom-players'; // rounds played so far, per player id (no names)

const env = process.env;
const LOCAL_DIR = env.NIGHTLOOM_REC_DIR || path.join(process.cwd(), '.recordings');
const S3 = env.STATELOOP_S3_BUCKET && env.STATELOOP_S3_ENDPOINT
  ? {
    bucket: env.STATELOOP_S3_BUCKET,
    endpoint: env.STATELOOP_S3_ENDPOINT.replace(/\/$/, ''),
    pathStyle: !/^virtual/.test(env.STATELOOP_S3_URL_STYLE || 'path'),
    client: new AwsClient({
      accessKeyId: env.STATELOOP_S3_ACCESS_KEY_ID,
      secretAccessKey: env.STATELOOP_S3_SECRET_ACCESS_KEY,
      service: 's3',
      region: env.STATELOOP_S3_REGION || 'auto',
    }),
  }
  : null;

export function storageInfo() {
  return { local: LOCAL_DIR, bucket: S3 ? `${S3.bucket} @ ${S3.endpoint}` : null };
}

const pending = new Set();
/** Wait for uploads that are still running (before the process or a room ends). */
export function flushUploads() { return Promise.allSettled([...pending]); }

/** Read a small JSON file from the bucket (or the local folder). null when missing. */
export async function getJson(key) {
  if (S3) {
    const url = S3.pathStyle ? `${S3.endpoint}/${S3.bucket}/${key}` : `${S3.endpoint.replace('://', `://${S3.bucket}.`)}/${key}`;
    try {
      const res = await S3.client.fetch(url, { method: 'GET' });
      if (res.ok) return JSON.parse(await res.text());
      if (res.status !== 404) console.error(`[nightloom-recorder] read ${key}: ${res.status}`);
    } catch (e) {
      console.error(`[nightloom-recorder] read ${key}: ${e}`);
    }
  }
  try { return JSON.parse(fs.readFileSync(path.join(LOCAL_DIR, key), 'utf8')); } catch { return null; }
}

export function putJson(key, obj) {
  const job = put(key, Buffer.from(JSON.stringify(obj, null, 1)), 'application/json');
  pending.add(job);
  job.finally(() => pending.delete(job));
  return job;
}

async function put(key, body, type) {
  const file = path.join(LOCAL_DIR, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  if (!S3) return { key, bytes: body.length, uploaded: false };
  const url = S3.pathStyle ? `${S3.endpoint}/${S3.bucket}/${key}` : `${S3.endpoint.replace('://', `://${S3.bucket}.`)}/${key}`;
  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await S3.client.fetch(url, { method: 'PUT', body, headers: { 'content-type': type } });
      if (res.ok) return { key, bytes: body.length, uploaded: true };
      lastErr = `${res.status} ${(await res.text()).slice(0, 200)}`;
    } catch (e) {
      lastErr = String(e);
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  console.error(`[nightloom-recorder] upload failed for ${key}: ${lastErr}`);
  return { key, bytes: body.length, uploaded: false, error: lastErr };
}

export class EpisodeRecorder {
  /** header: everything known at the start (see NightRoom.startEpisode). */
  constructor(header) {
    this.header = { type: 'header', schema: FORMAT, ...header };
    this.lines = [JSON.stringify(this.header)];
    this.steps = 0;
    this.finished = false;
  }

  push(obj) { if (!this.finished) this.lines.push(JSON.stringify(obj)); }

  /** in: per actor [x, y, act, presses, src, skipped?] as applied on step t. */
  step(t, inputs) { this.steps++; this.push({ type: 'step', t, in: inputs }); }
  event(t, e) { this.push({ type: 'event', t, ...e }); }
  hash(t, h) { this.push({ type: 'hash', t, ...h }); }
  keyframe(t, state) { this.push({ type: 'keyframe', t, state }); }
  net(row) { this.push({ type: 'net', ...row }); }

  /** Ends the recording and stores it. names: {player_id: typed name}, stored
   * under a separate prefix, so the play data holds only player ids.
   * Returns the storage promise. */
  finish(summary, names = {}) {
    if (this.finished) return Promise.resolve(null);
    this.push({ type: 'summary', ...summary });
    this.finished = true;
    const h = this.header;
    const date = (h.room_created || new Date().toISOString()).slice(0, 10);
    const base = `${PREFIX}/${date}/${h.room}-${h.room_created_ms}/ep${String(h.episode).padStart(3, '0')}-${h.shift.id}`;
    const text = this.lines.join('\n') + '\n';
    const index = JSON.stringify({ header: h, summary: { type: 'summary', ...summary }, steps: this.steps, lines: this.lines.length,
      file: `${base}.jsonl.gz` }, null, 1);
    const job = (async () => {
      const a = await put(`${base}.jsonl.gz`, zlib.gzipSync(Buffer.from(text)), 'application/gzip');
      const b = await put(`${base}.json`, Buffer.from(index), 'application/json');
      if (Object.keys(names).length) await put(`${NAMES_PREFIX}/${base.slice(PREFIX.length + 1)}.json`, Buffer.from(JSON.stringify(names, null, 1)), 'application/json');
      console.log(`[nightloom-recorder] wrote ${base} (${this.steps} steps, ${a.bytes} bytes gz${a.uploaded ? ', uploaded' : ''})`);
      return { base, files: [a, b] };
    })();
    pending.add(job);
    job.finally(() => pending.delete(job));
    return job;
  }
}
