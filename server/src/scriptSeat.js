// Server-side bot partner from Stateloop's frozen blind scripts (flit.js for the
// Flit seat, bramble.js for the Bramble seat). A script sees only what a person
// sees on the screen (lib/observe.mjs) and presses keys as a person does, so it
// does not need to read its partner's plan, and its seat is recorded with its
// applied inputs: a round replays without the script.
//
// The scripts are not in this repository. The deploy step copies them at one
// exact commit into server/scripts/blind/, with PIN.json (commit and sha256 of
// each file). Without them, the server offers only the game's own bot (bot.js).
import fs from 'node:fs';
import crypto from 'node:crypto';

const DIR = new URL('../scripts/blind/', import.meta.url);
let loaded;   // undefined = not tried, null = not available, object = modules

export async function loadScripts() {
  if (loaded !== undefined) return loaded;
  loaded = null;
  try {
    const pin = JSON.parse(fs.readFileSync(new URL('PIN.json', DIR), 'utf8'));
    for (const [file, want] of Object.entries(pin.files)) {
      const got = crypto.createHash('sha256').update(fs.readFileSync(new URL(file, DIR))).digest('hex');
      if (got !== want) throw new Error(`${file} differs from PIN.json`);
    }
    const [flit, bramble, obs] = await Promise.all(['flit.js', 'bramble.js', 'lib/observe.mjs'].map((f) => import(new URL(f, DIR).href)));
    const pinSha = crypto.createHash('sha256').update(JSON.stringify(pin.files)).digest('hex');
    loaded = { flit, bramble, observe: obs.observe, pin, pinSha };
    console.log(`[nightloom] blind scripts: flit ${flit.FLIT_VERSION}, bramble ${bramble.BRAMBLE_VERSION}, commit ${pin.commit}`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[nightloom] blind scripts not loaded:', e.message);
    else console.log('[nightloom] blind scripts not present; the bot partner is the game\'s bot (bot.js)');
  }
  return loaded;
}

/** One bot seat played by a blind script. */
export class ScriptSeat {
  constructor(mods, role, seed) {
    this.mods = mods;
    this.role = role;
    this.agent = role === 'flit'
      ? mods.flit.createFlit({ seat: 1, seed: (seed ^ 0x51f7) >>> 0 })
      : mods.bramble.createBramble({ seat: 0, seed: (seed ^ 0xb7a3) >>> 0 });
  }

  get controller() { return `script:${this.agent.name}@${this.agent.version}`; }

  describe() {
    const pin = this.mods.pin;
    return { name: this.agent.name, version: this.agent.version, commit: pin.commit, repo: pin.repo, path: pin.path, files_sha256: this.mods.pinSha };
  }

  /** The input for the next step, from the state before it (as a person sees the screen). */
  input(world) {
    const k = this.agent.step(this.mods.observe(world.G, world.S));
    return { x: k.x, y: k.y, act: !!k.hold, pr: (k.grab ? 'g' : '') + (k.act ? 'a' : '') };
  }
}
