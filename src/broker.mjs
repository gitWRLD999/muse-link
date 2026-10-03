import http from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createEngines} from './engines.mjs';

export function authorized(req, token, port) {
  if (req.headers.origin !== undefined) return false;
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return false;
  const actual = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function serial(fn) {
  let tail = Promise.resolve();
  return (...args) => { const run = tail.then(() => fn(...args)); tail = run.catch(() => {}); return run; };
}
export function makeHandler(token, port, dispatch) {
  return async (req, res) => {
    const reply = (status, data) => {
      if (res.destroyed) return;
      res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify(data));
    };
    if (!authorized(req, token, port)) return reply(403, {ok: false, error: 'Forbidden'});
    if (req.method !== 'POST' || req.url !== '/rpc') return reply(404, {ok: false, error: 'Use POST /rpc'});
    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) return reply(413, {ok: false, error: 'Request too large'});
        chunks.push(chunk);
      }
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw Error('Expected JSON object');
      reply(200, await dispatch(request));
    } catch (error) { reply(400, {ok: false, error: error.message}); }
  };
}

function protectState(directory) {
  mkdirSync(directory, {recursive: true, mode: 0o700});
  if (process.platform !== 'win32') { chmodSync(directory, 0o700); return; }
  const identity = execFileSync('whoami.exe', [], {encoding: 'utf8', windowsHide: true}).trim();
  execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)F`, 'SYSTEM:(OI)(CI)F'], {stdio: 'pipe', windowsHide: true});
}

export async function startBroker(config) {
  if (process.platform === 'win32') {
    const session = execFileSync('powershell.exe', ['-NoProfile', '-Command', `[Diagnostics.Process]::GetProcessById(${process.pid}).SessionId`], {encoding: 'utf8', windowsHide: true}).trim();
    if (session === '0' && Object.values(config.engines).some(spec => spec.kind !== 'mcp')) throw Error('Desktop engines require a signed-in Windows session; start the broker there, then connect over SSH.');
  }
  protectState(config.stateDir);
  mkdirSync(config.home, {recursive: true});
  const token = randomBytes(32).toString('hex');
  const engines = createEngines(config);
  let stopping = false;
  const queues=new Map(), recent=[];
  function resource(request) {
    const spec=config.engines[request.engine];
    if(spec?.kind==='agent') {
      const name=request.tool?.startsWith('sidescreen_')?(spec.desktop||'sidescreen'):(spec.browser||'regular_chrome');
      return config.engines[name]?.aliasOf||name;
    }
    return spec?.aliasOf||request.engine;
  }
  const dispatch = request => {
    const queued=performance.now(),key=resource(request);
    if(!queues.has(key))queues.set(key,serial(async (request,queued)=>{
      if(stopping)throw Error('Broker is stopping');
      const started=performance.now();
      try {
        const result=await engines.dispatch(request),ended=performance.now();
        const timing={engine:request.engine,tool:request.tool||request.method,queueWaitMs:Math.round(started-queued),executionMs:Math.round(ended-started),totalMs:Math.round(ended-queued)};
        recent.push({...timing,ok:!result.isError});if(recent.length>50)recent.shift();
        return {...result,_meta:{...result._meta,museLink:timing}};
      }catch(error){recent.push({engine:request.engine,tool:request.tool||request.method,ok:false,totalMs:Math.round(performance.now()-queued)});if(recent.length>50)recent.shift();throw error;}
    }));
    return queues.get(key)(request,queued);
  };
  const server = http.createServer(makeHandler(token, config.port, request => request.method === 'status' ? {...engines.status(),recentTimings:recent} : dispatch(request)));
  server.requestTimeout = 150000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', resolve);
  });
  // Never rotate a running broker's credentials when a second instance fails to bind.
  const tokenPath = path.join(config.stateDir, 'token');
  const metaPath = path.join(config.stateDir, 'broker.json');
  const brokerId = randomBytes(16).toString('hex');
  try {
    writeFileSync(tokenPath, token, {mode: 0o600});
    writeFileSync(metaPath, JSON.stringify({pid: process.pid, brokerId, port: config.port, startedAt: new Date().toISOString()}), {mode: 0o600});
  } catch (error) { server.close(); throw error; }
  return {
    server,
    async close() {
      if (stopping) return;
      stopping = true;
      server.close(); server.closeIdleConnections();
      await engines.close();
      server.closeAllConnections();
      try {
        if (JSON.parse(readFileSync(metaPath, 'utf8')).brokerId === brokerId) {
          rmSync(tokenPath, {force: true}); rmSync(metaPath, {force: true});
        }
      } catch { /* A different instance owns the state, or it has already been removed. */ }
    }
  };
}
