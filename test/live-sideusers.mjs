// Actual Muse stdio channel, two independent agent clients, disposable windows.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {startBroker} from '../src/broker.mjs';
import {loadConfig} from '../src/config.mjs';
const home=path.join(process.env.USERPROFILE,'AgentTools'),out=path.join(home,'MuseLink/acceptance/sideusers');mkdirSync(out,{recursive:true});
const original=loadConfig(),directory=process.env.MUSE_TEST_SIDESCREEN||path.join(home,'SideScreen');
const config={...original,port:18924,stateDir:path.join(out,'state'),engines:{...original.engines,sidescreen:{...original.engines.sidescreen,directory}}};
const broker=await startBroker(config),clients=[],transports=[],fixtures=[],files=[];
const report={channel:'two actual MCP stdio clients → broker → CUA + native virtual input',checks:[],timings:[]};
function check(value,label){assert.ok(value,label);report.checks.push(label);}
async function call(client,name,args={}){const started=performance.now(),r=await client.callTool({name,arguments:args},undefined,{timeout:120000});report.timings.push({tool:name,ms:Math.round(performance.now()-started)});return {r,data:JSON.parse(r.content[0].text)};}
async function refused(fn,label){let denied=false;try{const r=await fn();denied=!!r.r.isError||r.data.ok===false;}catch{denied=true;}check(denied,label);}
try {
  for(const label of ['Muse A','Muse B']){const client=new Client({name:label,version:'1.3.0'}),transport=new StdioClientTransport({command:process.execPath,args:[process.env.MUSE_CHANNEL_CLI||path.resolve('bin/muse-link.mjs'),'mcp','agent'],env:{...process.env,MUSE_LINK_PORT:String(config.port),MUSE_LINK_STATE_DIR:config.stateDir},stderr:'inherit'});clients.push(client);transports.push(transport);await client.connect(transport);}
  check((await clients[0].listTools()).tools.filter(t=>t.name.startsWith('sideuser_')).length===7,'Muse discovers seven SideUser tools');
  const status=(await call(clients[0],'sidescreen_status')).data;check(status.ready&&status.virtualInputInstalled,'Installed CUA and original adapter ready');
  const opened=[];
  for(const [index,arch] of ['x64','x86'].entries()) {
    const file=path.join(out,`${arch}-${crypto.randomUUID()}.json`);files.push(file);const fixture=spawn(path.join(directory,`SideScreen.VirtualProbe-${arch}.exe`),[file],{windowsHide:true,stdio:'ignore'});fixtures.push(fixture);
    const state=()=>JSON.parse(readFileSync(file,'utf8'));for(let i=0;i<100;i++){try{state();break;}catch{await new Promise(r=>setTimeout(r,100));}}
    const target={window_handle:state().handle,expected_display_id:status.agentScreen.id};
    const session=(await call(clients[index],'sideuser_open',{...target,label:index?'Muse B':'Muse A'})).data;check(session.ok,'Own window leased '+arch);opened.push({id:session.sessionId,state,target});
  }
  await refused(()=>call(clients[1],'sideuser_open',{...opened[0].target,label:'collision'}),'A second agent cannot lease the same window');
  await refused(()=>call(clients[1],'sidescreen_observe',opened[0].target),'Legacy desktop tools respect another agent’s lease');
  await refused(()=>call(clients[1],'winapp_inspect',opened[0].target),'Assistance tools respect another agent’s lease');
  await refused(()=>call(clients[1],'sideuser_observe',{session_id:opened[0].id}),'Session IDs cannot cross MCP connections');
  for(const [i,entry]of opened.entries()) {
    const client=clients[i],s={session_id:entry.id};let o=(await call(client,'sideuser_observe',{...s,include_screenshot:true})).data;
    const button=o.state.elements.find(e=>e.label==='Virtual button'&&e.role==='Button');check(!!button?.screenshot_frame,'Actual screenshot grounds standard button');const b=button.screenshot_frame;
    const input={...s,observation_id:o.observationId,operation:'click',arguments:{x:b.x+b.w/2,y:b.y+b.h/2}};
    const clicked=(await call(client,'sideuser_act',input)).data;check(clicked.ok&&clicked.receipt.focus.Preserved&&clicked.receipt.focus.CursorPreserved,'Virtual click preserves physical cursor and focus '+i);check(entry.state().clicks===1&&clicked.receipt.blockedActivationAttempts>=2,'Actual button handler and activation suppression '+i);
    await refused(()=>call(client,'sideuser_act',input),'Duplicate observation never replays '+i);
    await call(client,'sideuser_clipboard',{...s,text:`Muse ${i} café Ω`});o=(await call(client,'sideuser_observe',s)).data;const token=o.state.elements.find(e=>e.label==='Virtual text'&&e.role==='Edit')?.element_token;check(!!token,'Native edit token grounded '+i);
    const pasted=(await call(client,'sideuser_act',{...s,observation_id:o.observationId,operation:'paste',arguments:{element_token:token}})).data;check(pasted.ok&&entry.state().text===`Muse ${i} café Ω`,'Private clipboard reaches real native edit '+i);
    const macro={...s,request_id:'select-and-replace',steps:[{selector:{label:'Virtual text',role:'Edit'},operation:'press',arguments:{key:'A',modifiers:['Control']}},{selector:{label:'Virtual text',role:'Edit'},operation:'type',arguments:{text:`Macro ${i}`}}]};
    const ran=(await call(client,'sideuser_run',macro)).data;check(ran.ok&&ran.completed===2&&entry.state().text===`Macro ${i}`&&entry.state().asyncControl,'Named macro uses fresh controls and virtual modifiers '+i);
    await refused(()=>call(client,'sideuser_run',macro),'Macro retry ID prevents duplicate input '+i);
    check((await call(client,'sideuser_status')).data.sessions.length===1,'Status lists only this connection’s window '+i);
  }
  if(process.env.MUSE_PREVIEW_USERS_PROBE)check(JSON.parse(execFileSync(process.env.MUSE_PREVIEW_USERS_PROBE,[path.join(directory,'SideScreen.exe'),...opened.map(s=>s.id)],{encoding:'utf8',windowsHide:true})).ok,'Production preview draws both separate labeled agent cursors');
  for(const [i,entry]of opened.entries()) {
    check((await call(clients[i],'sideuser_close',{session_id:entry.id})).data.closed,'Session closes and releases virtual state '+i);
    const transferred=(await call(clients[1-i],'sideuser_open',{...entry.target,label:'Next agent'})).data;check(transferred.ok,'Released window can be leased by the next agent '+i);await call(clients[1-i],'sideuser_close',{session_id:transferred.sessionId});
  }
  console.log(`PASS: ${report.checks.length} actual Muse SideUser checks`);
}finally {
  for(const client of clients)await client.close().catch(()=>{});await broker.close();for(const transport of transports)await transport.close().catch(()=>{});
  for(const fixture of fixtures)fixture.kill();for(const file of files)try{unlinkSync(file);}catch{}
  writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
}
