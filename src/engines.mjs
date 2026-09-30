import {createRequire} from 'node:module';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createSideScreenEngine} from './sidescreen.mjs';
import {runJson} from './process.mjs';

export const desktopActions = ['/position', '/screen_size', '/windows', '/activate_window', '/screenshot', '/move', '/click', '/drag', '/scroll', '/type', '/press', '/hotkey', '/key_down', '/key_up', '/pixel', '/clipboard/set', '/clipboard/get'];
const require = createRequire(import.meta.url);

export function createEngines(config) {
  const clients = new Map(), sideScreens = new Map();
  async function client(name, spec) {
    if (clients.has(name)) return clients.get(name);
    let command = spec.command === 'node' ? process.execPath : spec.command;
    let args = spec.args || [];
    if (spec.kind === 'chrome') {
      command = process.execPath;
      const cli = path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
      args = [cli, '--extension', '--caps', 'vision,pdf', '--output-dir', config.artifactsDir];
      if (spec.profile) args.push('--profile-dir-name', spec.profile);
    }
    const c = new Client({name: 'Muse Link', version: '1.0.0'});
    const transport = new StdioClientTransport({command, args, cwd: spec.cwd || config.home, env: {...process.env, ...spec.env}, stderr: 'inherit'});
    try { await c.connect(transport); } catch (error) { await transport.close(); throw error; }
    clients.set(name, c);
    c.onclose = () => { if (clients.get(name) === c) clients.delete(name); };
    return c;
  }
  return {
    status: () => ({ok: true, pid: process.pid, engines: Object.keys(config.engines), connected: [...clients.keys()]}),
    async dispatch(request) {
      const spec = config.engines[request.engine];
      if (!Object.hasOwn(config.engines, request.engine) || !spec) throw Error('Unknown engine');
      if (!['list', 'call'].includes(request.method)) throw Error('Unknown method');
      if (request.method === 'call' && (typeof request.tool !== 'string' || !request.tool)) throw Error('tool is required');
      if (request.arguments !== undefined && (!request.arguments || typeof request.arguments !== 'object' || Array.isArray(request.arguments))) throw Error('arguments must be an object');
      if (spec.kind === 'sidescreen') {
        if (!sideScreens.has(request.engine)) sideScreens.set(request.engine, createSideScreenEngine({directory: spec.directory}));
        return sideScreens.get(request.engine)(request);
      }
      if (spec.kind === 'desktop') {
        if (request.method === 'list') return {tools: desktopActions};
        if (!desktopActions.includes(request.tool)) throw Error('Unknown desktop action');
        return runJson(spec, {action: request.tool, arguments: request.arguments || {}});
      }
      const c = await client(request.engine, spec);
      if (request.method === 'list') return c.listTools();
      return c.callTool({name: request.tool, arguments: request.arguments || {}}, undefined, {timeout: 120000});
    },
    async close() { await Promise.allSettled([...clients.values()].map(c => c.close())); }
  };
}
