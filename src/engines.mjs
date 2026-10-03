import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createSideScreenEngine} from './sidescreen.mjs';
import {runJson} from './process.mjs';
import {createRegularChrome, redactBrowserSecrets} from './browser.mjs';

export const desktopActions = ['/position', '/screen_size', '/windows', '/activate_window', '/screenshot', '/move', '/click', '/drag', '/scroll', '/type', '/press', '/hotkey', '/key_down', '/key_up', '/pixel', '/clipboard/set', '/clipboard/get'];
const require = createRequire(import.meta.url);

export function createEngines(config) {
  const clients = new Map(), sideScreens = new Map(), browsers = new Map(), health = new Map();
  async function client(name, spec) {
    if (clients.has(name)) return clients.get(name);
    let command = spec.command === 'node' ? process.execPath : spec.command;
    let args = spec.args || [];
    const env={...process.env,...spec.env};
    if (spec.kind === 'chrome') {
      command = process.execPath;
      const cli = fileURLToPath(new URL('./chrome-server.mjs',import.meta.url));
      args = [cli, '--extension', '--caps', 'vision,pdf', '--output-dir', config.artifactsDir];
      if (spec.profile) args.push('--profile-dir-name', spec.profile);
      if(config.engines.sidescreen?.kind==='sidescreen') {
        const side=config.engines.sidescreen;
        if(!sideScreens.has('sidescreen'))sideScreens.set('sidescreen',createSideScreenEngine({directory:side.directory,env:side.env}));
        const status=JSON.parse((await sideScreens.get('sidescreen')({method:'call',tool:'sidescreen_status',arguments:{}})).content[0].text);
        if(!status.available)throw Error('SideScreen display unavailable; browser connection was not launched.');
        env.MUSE_CHROME_BOUNDS=JSON.stringify(status.agentScreen);
      }
    }
    const c = new Client({name: 'Muse Link', version: '1.1.0'});
    const transport = new StdioClientTransport({command, args, cwd: spec.cwd || config.home, env, stderr: 'inherit'});
    try { await c.connect(transport); } catch (error) { await transport.close(); throw error; }
    clients.set(name, c);
    c.onclose = () => { if (clients.get(name) === c) clients.delete(name); };
    return c;
  }
  const engines = {
    status: () => ({ok: true, pid: process.pid, defaultEngine: Object.hasOwn(config.engines,'agent')?'agent':null, engines: Object.keys(config.engines), connected: [...clients.keys()], health:Object.fromEntries(health), routing:Object.fromEntries(Object.entries(config.engines).map(([name,spec])=>[name,{kind:spec.kind,profile:spec.profile||null,aliasOf:spec.aliasOf||null,role:spec.kind==='chrome'?'regular signed-in Chrome':name==='patchright'?'separate automation profile; use only when requested':spec.kind}]))}),
    async dispatch(request) {
      let spec = config.engines[request.engine];
      if (!Object.hasOwn(config.engines, request.engine) || !spec) throw Error('Unknown engine');
      if (!['list', 'call'].includes(request.method)) throw Error('Unknown method');
      if (request.method === 'call' && (typeof request.tool !== 'string' || !request.tool)) throw Error('tool is required');
      if (request.arguments !== undefined && (!request.arguments || typeof request.arguments !== 'object' || Array.isArray(request.arguments))) throw Error('arguments must be an object');
      const name=spec.aliasOf||request.engine;
      if(spec.aliasOf)spec=config.engines[name];
      if(spec.kind==='agent') {
        const browser=spec.browser||'regular_chrome',desktop=spec.desktop||'sidescreen';
        if(request.method==='list')return {tools:[...(await engines.dispatch({engine:browser,method:'list'})).tools,...(await engines.dispatch({engine:desktop,method:'list'})).tools]};
        return engines.dispatch({...request,engine:request.tool.startsWith('sidescreen_')?desktop:browser});
      }
      if (spec.kind === 'sidescreen') {
        if (!sideScreens.has(name)) sideScreens.set(name, createSideScreenEngine({directory: spec.directory,env:spec.env}));
        const result=await sideScreens.get(name)(request);
        if(request.method==='call'){const data=JSON.parse(result.content[0].text);health.set(name,{ok:data.ok!==false,ready:data.ready??(data.ok!==false),error:data.error||data.healthError||null,checkedAt:new Date().toISOString()});}
        return result;
      }
      if (spec.kind === 'desktop') {
        if (request.method === 'list') return {tools: desktopActions};
        if (!desktopActions.includes(request.tool)) throw Error('Unknown desktop action');
        return runJson(spec, {action: request.tool, arguments: request.arguments || {}});
      }
      const c = await client(name, spec);
      if(spec.kind==='chrome') {
        if(!browsers.has(name))browsers.set(name,createRegularChrome({profile:spec.profile,call:(tool,args)=>c.callTool({name:tool,arguments:args},undefined,{timeout:60000}),getScreen:config.engines.sidescreen?.kind==='sidescreen'?async()=>{
          const result=await sideScreens.get('sidescreen')({method:'call',tool:'sidescreen_status',arguments:{}});const status=JSON.parse(result.content[0].text);return status.available?status.agentScreen:null;
        }:undefined}));
        try {
          let invoke=()=>browsers.get(name)(request);
          if(request.method==='call' && config.engines.sidescreen?.kind==='sidescreen') {
            if(!sideScreens.has('sidescreen'))sideScreens.set('sidescreen',createSideScreenEngine({directory:config.engines.sidescreen.directory,env:config.engines.sidescreen.env}));
            const unguarded=invoke;invoke=()=>sideScreens.get('sidescreen').guard(unguarded);
          }
          const result=await invoke();if(request.method==='call')health.set(name,{ok:!result.isError,profile:spec.profile,checkedAt:new Date().toISOString()});return result;
        }
        catch(error){health.set(name,{ok:false,error:'Chrome connection/action failed; inspect with chrome_status',checkedAt:new Date().toISOString()});throw error;}
      }
      if (request.method === 'list') return c.listTools();
      return redactBrowserSecrets(await c.callTool({name: request.tool, arguments: request.arguments || {}}, undefined, {timeout: 120000}));
    },
    async close() {for(const side of sideScreens.values())side.close();await Promise.allSettled([...clients.values()].map(c => c.close())); }
  };
  return engines;
}
