// The app's server: the repo's Express API (../server), started on an empty
// database for `test` and `verify` (its path in DB) and by hand with
// `bun server.ts`. app.ts names where it listens, in API.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { API } from './app.ts';

const db = resolve(process.env.DB ?? 'data.db');
const { port } = new URL(API);

// The signing and encryption keys: the environment's, else a random pair kept in a file beside the
// database (mode 600, git-ignored). A database that predates this file keeps the old fixed keys,
// so its encrypted calendar passwords stay readable; rotate by setting both variables.
const keyFile = resolve(dirname(db), '.notient-secrets.json');
const secrets = (): { jwt: string; master: string } => {
  if (process.env.JWT_SECRET && process.env.ENCRYPTION_MASTER_KEY) return { jwt: process.env.JWT_SECRET, master: process.env.ENCRYPTION_MASTER_KEY };
  let kept: { jwt?: string; master?: string } = {};
  if (existsSync(keyFile)) kept = JSON.parse(readFileSync(keyFile, 'utf8'));
  else {
    const legacy = existsSync(db);
    kept = legacy
      ? { jwt: 'notient-test-secret', master: 'notient-test-master-key-32-chars!' }
      : { jwt: randomBytes(32).toString('hex'), master: randomBytes(32).toString('hex') };
    writeFileSync(keyFile, JSON.stringify(kept), { mode: 0o600 });
    if (legacy) console.warn(`server.ts: ${db} predates ${keyFile}; its keys are the old fixed defaults. Set JWT_SECRET and ENCRYPTION_MASTER_KEY (and re-add CalDAV accounts) to rotate.`);
  }
  return { jwt: process.env.JWT_SECRET ?? kept.jwt!, master: process.env.ENCRYPTION_MASTER_KEY ?? kept.master! };
};
const keys = secrets();

const child = Bun.spawn(['node', 'index.js'], {
  cwd: dirname(new URL(import.meta.url).pathname) + '/../server',
  env: {
    ...process.env,
    // Bind every interface: the web app may be reached on the LAN, a VPN
    // address, or loopback, and the API has to answer on whichever it used.
    HOST: '0.0.0.0',
    PORT: String(Number(port)),
    WEB_DIST: resolve(dirname(new URL(import.meta.url).pathname), 'target/app-dist'),
    DATA_DIR: dirname(db),
    DB_PATH: db,
    PUBLIC_URL: API,
    // One test run makes well over the server's default 1000 requests per IP and window.
    API_RATE_MAX: process.env.API_RATE_MAX ?? '100000',
    JWT_SECRET: keys.jwt,
    ENCRYPTION_MASTER_KEY: keys.master,
  },
  stdout: 'inherit',
  stderr: 'inherit',
});
const stop = () => child.kill();
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });

for (let i = 0; i < 150; i++) {
  try {
    const res = await fetch(`${API}/health`);
    if (res.ok) break;
  } catch { /* not up yet */ }
  if (i === 149) {
    console.error(`server.ts: nothing answered at ${API}/health`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 100));
}
console.log(`server.ts: ${API} (db ${db})`);
setInterval(() => {}, 1 << 30);
