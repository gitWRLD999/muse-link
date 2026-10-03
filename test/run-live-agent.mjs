// Opt-in orchestrator for the browser plus disposable desktop acceptance.
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,unlinkSync} from 'node:fs';
import path from 'node:path';
const directory=process.env.MUSE_TEST_SIDESCREEN||path.join(process.env.USERPROFILE,'AgentTools/SideScreen');
const output=path.join(process.env.USERPROFILE,'AgentTools/MuseLink/acceptance');
mkdirSync(output,{recursive:true});
const children=[],files=[];
try {
  for(const [kind,key] of [['Background','MUSE_NATIVE_PROBE'],['CuaWpf','MUSE_WPF_PROBE']]) {
    const file=path.join(output,`${kind}-${crypto.randomUUID()}.json`);files.push(file);
    const child=spawn(path.join(directory,`SideScreen.${kind}Probe.exe`),[file],{windowsHide:true,stdio:'ignore'});children.push(child);
    let failure;child.on('error',e=>{failure=e;});
    for(let n=0;n<100&&!existsSync(file)&&!failure&&child.exitCode===null;n++)await new Promise(r=>setTimeout(r,100));
    if(failure||!existsSync(file))throw failure||Error(`${kind} disposable fixture not ready`);
    process.env[key]=file;
  }
  await import('./live-agent.mjs');
}finally {
  for(const child of children)child.kill();
  for(const file of files)try{unlinkSync(file);}catch{}
}
