#!/usr/bin/env node
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {loadConfig} from '../src/config.mjs';
import {rpc} from '../src/rpc.mjs';

const help = `Muse Link: SSH-to-MCP bridge for a signed-in desktop
  muse-link init                          Create a portable default config
  muse-link serve                         Start the interactive broker
  muse-link status                        Read broker status
  muse-link <engine> list                  List tools
  muse-link <engine> <tool> [JSON]          Call a tool once
  muse-link --stdin                       Read one JSON request
  muse-link mcp <engine>                   MCP stdio proxy (also over SSH)
  muse-link channel                        Persistent JSON-lines CLI (one SSH)
Config: MUSE_LINK_HOME, MUSE_LINK_CONFIG, MUSE_LINK_PORT, MUSE_LINK_STATE_DIR
Windows durability: scripts/Install-Startup.ps1; see README.`;

async function main() {
  const [command, action, json = '{}'] = process.argv.slice(2);
  if (!command || ['--help', '-h', 'help'].includes(command)) { console.log(help); return; }
  const config = loadConfig();
  if (command === 'init') {
    mkdirSync(path.dirname(config.configPath), {recursive: true});
    writeFileSync(config.configPath, JSON.stringify({port: config.port, engines: {agent:{kind:'agent'},regular_chrome:{kind:'chrome',profile:'Default'},chrome: {kind: 'chrome',aliasOf:'regular_chrome'}, sidescreen: {kind: 'sidescreen'}}}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.log(`Created ${config.configPath}`); return;
  }
  if (command === 'serve') {
    const {startBroker} = await import('../src/broker.mjs');
    const broker = await startBroker(config);
    console.error(`Muse Link ready on 127.0.0.1:${config.port}. Keep the Windows user session signed in.`);
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
      if (stopping) return; stopping = true;
      await broker.close(); process.exit(0);
    });
    return;
  }
  if (command === 'mcp') { const {startMcp} = await import('../src/mcp.mjs'); await startMcp(config, action); return; }
  if(command==='channel') {
    for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
      if(!line.trim())continue;
      try {
        if(Buffer.byteLength(line)>1024*1024)throw Error('Request too large');
        const result=await rpc(config,JSON.parse(line));
        // CLI channels return file paths, MCP channels preserve image content.
        if(Array.isArray(result.content))result.content=result.content.map(item=>{
          if(item.type!=='image'||!item.data)return item;
          mkdirSync(config.artifactsDir,{recursive:true});
          const filename=path.join(config.artifactsDir,`${Date.now()}-${crypto.randomUUID()}.${item.mimeType==='image/jpeg'?'jpg':'png'}`);
          writeFileSync(filename,Buffer.from(item.data,'base64'));
          return {type:'text',text:JSON.stringify({imagePath:filename,mimeType:item.mimeType})};
        });
        if(result.result?.png_base64){mkdirSync(config.artifactsDir,{recursive:true});const filename=path.join(config.artifactsDir,`${Date.now()}-${crypto.randomUUID()}.png`);writeFileSync(filename,Buffer.from(result.result.png_base64,'base64'));result.result={path:filename};}
        console.log(JSON.stringify(result));
      }catch(error){console.log(JSON.stringify({ok:false,error:error.message}));}
    }
    return;
  }
  let request;
  if (command === '--stdin') {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length; if (size > 1024 * 1024) throw Error('Request too large'); chunks.push(chunk);
    }
    request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } else if (command === 'status') request = {method: 'status'};
  else {
    if (!action) throw Error(help);
    request = {engine: command, method: action === 'list' ? 'list' : 'call', tool: action, arguments: JSON.parse(json)};
  }
  const result = await rpc(config, request);
  const saveImage = (base64, extension) => {
    mkdirSync(config.artifactsDir, {recursive: true});
    const filename = path.join(config.artifactsDir, `${Date.now()}-${crypto.randomUUID()}.${extension}`);
    writeFileSync(filename, Buffer.from(base64, 'base64')); return filename;
  };
  if (result.result?.png_base64) result.result = {path: saveImage(result.result.png_base64, 'png')};
  if (Array.isArray(result.content)) result.content = result.content.map(item => item.type === 'image' && item.data
    ? {type: 'text', text: JSON.stringify({imagePath: saveImage(item.data, item.mimeType === 'image/jpeg' ? 'jpg' : 'png'), mimeType: item.mimeType})} : item);
  console.log(JSON.stringify(result));
  if (result.ok === false || result.isError) process.exitCode = 1;
}
main().catch(error => { console.error(JSON.stringify({ok: false, error: error.message})); process.exitCode = 1; });
