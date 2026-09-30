import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {authorized, makeHandler, serial, startBroker} from '../src/broker.mjs';
import {loadConfig} from '../src/config.mjs';
import {runJson} from '../src/process.mjs';
import {rpc} from '../src/rpc.mjs';
import {createSideScreenEngine} from '../src/sidescreen.mjs';
import {createEngines, desktopActions} from '../src/engines.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function temporary(t, cleanup = true) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'muse-link-'));
  if (cleanup) t.after(() => rmSync(home, {recursive: true, force: true, maxRetries: 10, retryDelay: 100})); return home;
}
async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function fixture(t) {
  const home = temporary(t, false), port = await freePort();
  const config = {home, port, stateDir: path.join(home, 'state'), artifactsDir: path.join(home, 'artifacts'), engines: {
    test: {kind: 'mcp', command: process.execPath, args: [path.join(root, 'test/fake-mcp.mjs')]}
  }};
  const broker = await startBroker(config);
  t.after(async () => { await broker.close(); rmSync(home, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}); });
  return {config, broker};
}

test('auth refuses browser origins, wrong host, and incorrect bearer', () => {
  const req = {headers: {host: '127.0.0.1:18921', authorization: 'Bearer secret'}};
  assert.equal(authorized(req, 'secret', 18921), true);
  for (const patch of [{origin: ''}, {origin: 'https://example.com'}, {host: 'attacker:18921'}, {authorization: 'Bearer other'}, {authorization: ''}])
    assert.equal(authorized({headers: {...req.headers, ...patch}}, 'secret', 18921), false);
});
test('action queue serializes across engines and survives failure', async () => {
  const events = [];
  const invoke = serial(async n => { events.push(`start${n}`); await new Promise(r => setTimeout(r, 10)); if (n === 2) throw Error('failed'); events.push(`end${n}`); return n; });
  const result = await Promise.allSettled([invoke(1), invoke(2), invoke(3)]);
  assert.equal(result[1].status, 'rejected'); assert.equal(result[2].value, 3);
  assert.deepEqual(events, ['start1', 'end1', 'start2', 'start3', 'end3']);
});
test('HTTP parser preserves UTF-8 split across chunks and rejects invalid/oversize JSON', async t => {
  const server = http.createServer((req, res) => makeHandler('token', server.address().port, async r => r)(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => {server.close(); server.closeAllConnections();});
  const port = server.address().port;
  const body = Buffer.from(JSON.stringify({text: '😀é'}));
  const result = await new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port, path: '/rpc', method: 'POST', headers: {Authorization: 'Bearer token'}}, res => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject); req.write(body.subarray(0, 11)); setImmediate(() => req.end(body.subarray(11)));
  });
  assert.equal(result.text, '😀é');
  for (const [body, expected] of [['[]', 400], ['{', 400], ['x'.repeat(1024 * 1024 + 1), 413]]) {
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {method: 'POST', headers: {Authorization: 'Bearer token'}, body});
    assert.equal(res.status, expected); await res.text();
  }
  const denied = await fetch(`http://127.0.0.1:${port}/rpc`, {method: 'POST', body: '{}'}); assert.equal(denied.status, 403);
  const missing = await fetch(`http://127.0.0.1:${port}/other`, {headers: {Authorization: 'Bearer token'}}); assert.equal(missing.status, 404);
});
test('portable config rejects malformed ports and engine launch definitions', t => {
  const home = temporary(t);
  assert.equal(loadConfig({MUSE_LINK_HOME: home}).stateDir, path.join(home, 'state'));
  for (const port of ['0', '-1', 'NaN', '65536']) assert.throws(() => loadConfig({MUSE_LINK_HOME: home, MUSE_LINK_PORT: port}));
  for (const engines of [{bad: {kind: 'mcp'}}, {bad: {kind: 'mcp', command: 'node', args: [12]}}, {bad: {kind: 'mcp', command: 'node', env: {TOKEN: 1}}}]) {
    writeFileSync(path.join(home, 'config.json'), JSON.stringify({engines})); assert.throws(() => loadConfig({MUSE_LINK_HOME: home}));
  }
});
test('real broker/MCP engine round trip, errors, and unknown-engine confinement', async t => {
  const {config} = await fixture(t);
  assert.deepEqual((await rpc(config, {method: 'status'})).engines, ['test']);
  assert.equal((await rpc(config, {engine: 'test', method: 'list'})).tools[0].name, 'echo');
  const result = await rpc(config, {engine: 'test', method: 'call', tool: 'echo', arguments: {text: 'hello😀'}});
  assert.equal(JSON.parse(result.content[0].text).text, 'hello😀');
  assert.equal((await rpc(config, {engine: 'test', method: 'call', tool: 'echo', arguments: {fail: true}})).isError, true);
  await assert.rejects(rpc(config, {engine: '__proto__', method: 'list'}), /Unknown engine/);
  await assert.rejects(rpc(config, {engine: 'test', method: 'execute', command: 'anything'}), /Unknown method/);
});
test('a second broker failing to bind does not replace live credentials', async t => {
  const {config} = await fixture(t);
  const before = readFileSync(path.join(config.stateDir, 'token'), 'utf8');
  await assert.rejects(startBroker(config), /EADDRINUSE/);
  assert.equal(readFileSync(path.join(config.stateDir, 'token'), 'utf8'), before);
  assert.equal((await rpc(config, {method: 'status'})).ok, true);
});
test('MCP stdio proxy forwards real tools and preserves tool errors', async t => {
  const {config} = await fixture(t);
  const client = new Client({name: 'proxy-test', version: '1'});
  const transport = new StdioClientTransport({command: process.execPath, args: [path.join(root, 'bin/muse-link.mjs'), 'mcp', 'test'], env: {
    ...process.env, MUSE_LINK_HOME: config.home, MUSE_LINK_PORT: String(config.port)
  }});
  t.after(() => client.close()); await client.connect(transport);
  // Calling before listTools must still initialize the adapter.
  assert.equal((await client.callTool({name: 'echo', arguments: {text: 'proxy'}})).isError, false);
  assert.equal((await client.listTools()).tools[0].name, 'echo');
  assert.equal((await client.callTool({name: 'echo', arguments: {fail: true}})).isError, true);
});
test('SideScreen preserves scoped observations and refuses generic desktop input', async () => {
  const calls = [];
  const engine = createSideScreenEngine({run: async request => {calls.push(request); return {ok: true};}});
  assert.equal((await engine({method: 'list'})).tools.length, 4);
  await engine({method: 'call', tool: 'sidescreen_observe', arguments: {window_handle: 123, expected_display_id: 'DISPLAY5'}});
  assert.equal(calls[0].Action, 'CuaObserve'); assert.equal(calls[0].WindowHandle, 123);
  await assert.rejects(engine({method: 'call', tool: 'desktop_action', arguments: {}}), /Unknown SideScreen tool/);
  await assert.rejects(engine({method: 'call', tool: 'sidescreen_act', arguments: {window_handle: 123}}), /Missing/);
  assert.equal(calls.length, 1);
});
test('JSON adapter bounds output and reports timeout without retrying', async () => {
  assert.deepEqual(await runJson({command: process.execPath, args: ['-e', "process.stdin.resume(); process.stdin.on('end',()=>console.log(JSON.stringify({ok:true})))"]}, {}), {ok: true});
  await assert.rejects(runJson({command: process.execPath, args: ['-e', "process.stdout.write('x'.repeat(10000));"]}, {}, {maxBytes: 100}), /too large/);
  await assert.rejects(runJson({command: process.execPath, args: ['-e', 'setTimeout(()=>{},10000)']}, {}, {timeout: 100}), /outcome unknown/);
});
test('shutdown removes its credentials', async t => {
  const {config, broker} = await fixture(t); await broker.close();
  assert.equal(existsSync(path.join(config.stateDir, 'token')), false);
});
test('external desktop adapter supports legacy JSON and refuses arbitrary actions', async () => {
  const engines = createEngines({engines: {desktop: {kind: 'desktop', command: process.execPath, args: ['-e', "let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>console.log(JSON.stringify({ok:true,result:JSON.parse(text)}))); "]}}});
  assert.deepEqual((await engines.dispatch({engine: 'desktop', method: 'list'})).tools, desktopActions);
  assert.equal((await engines.dispatch({engine: 'desktop', method: 'call', tool: '/windows', arguments: {}})).result.action, '/windows');
  await assert.rejects(engines.dispatch({engine: 'desktop', method: 'call', tool: '/execute'}), /Unknown desktop action/);
});
