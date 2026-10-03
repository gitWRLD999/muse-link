// Opt-in integration test: same persistent stdio MCP proxy used by remote Muse.
// Desktop targets are disposable probes, never a user's application.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const home=path.join(process.env.USERPROFILE,'AgentTools/MuseLink');
const report={channel:'persistent MCP stdio → authenticated broker → regular Chrome/SideScreen',checks:[],timings:[]};
const pageTitle='Muse Link acceptance '+crypto.randomUUID().slice(0,8);
const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html');res.setHeader('Set-Cookie','muse_test=present; SameSite=Lax');
  res.end(`<!doctype html><title>${pageTitle}</title><label>Agent text<input id="text"></label><button onclick="document.querySelector('#count').textContent=++window.count">Increment browser counter</button><label><input type="checkbox">Agent checkbox</label><p>Count: <span id="count">0</span></p><p>Cookie: ${req.headers.cookie?.includes('muse_test=present')?'present':'new'}</p><script>window.count=0</script>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const client=new Client({name:'Simulated Muse',version:'1.2.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[process.env.MUSE_CHANNEL_CLI||path.resolve('bin/muse-link.mjs'),'mcp','agent'],stderr:'inherit'});
function check(value,name){assert.ok(value,name);report.checks.push(name);}
async function call(name,args={}) {
  const started=performance.now();const result=await client.callTool({name,arguments:args},undefined,{timeout:120000});
  report.timings.push({tool:name,ms:Math.round(performance.now()-started),broker:result._meta?.museLink,focus:result._meta?.focus});
  const text=result.content.find(c=>c.type==='text')?.text;let data=null;
  if(text){try{data=JSON.parse(text);}catch{data={ok:false,error:text};}}
  return {result,data};
}
try {
  await client.connect(transport);
  const tools=await client.listTools();const extra=tools.tools.some(t=>t.name==='agent_tools_status')?17:0;check(tools.tools.length===17+extra,'Combined channel discovers 9 browser + 8 desktop tools and configured assistance tools');
  const status=await call('chrome_status');check(!status.result.isError,'Pinned Chrome connection is ready');check(status.data.profile==='Profile 1','Regular Chrome is explicitly Profile 1');
  const opened=await call('open_url',{url});check(!opened.result.isError && opened.data.title===pageTitle,'Navigate directly through the Muse channel');
  check(opened.result._meta.focus.Preserved,'Browser navigation preserves foreground and keyboard focus');
  const steps=await call('steps',{steps:[{action:'fill',role:'textbox',name:'Agent text',value:'Muse café Ω'},{action:'click',role:'button',name:'Increment browser counter'},{action:'check',role:'checkbox',name:'Agent checkbox'}]});
  check(steps.data.ok && steps.data.completed===3,'Three DOM operations finish in one model call');
  check(steps.data.state.snapshot.includes('Muse café Ω') && /Count:\s*1/.test(steps.data.state.snapshot) && steps.data.state.snapshot.includes('checked'),'Browser state verifies Unicode, counter and checkbox');
  check(steps.result._meta.focus.Preserved,'Browser batch preserves foreground and keyboard focus');
  const before=steps.data.state.tab_id;
  const next=await call('open_url',{url,new_tab:true});check(!next.result.isError && next.data.snapshot.includes('Cookie: present'),'Agent tabs share the regular profile cookie session');
  const selected=await call('select_tab',{tab_id:before});check(!selected.result.isError && selected.result._meta.focus.Preserved,'Select agent tab without bringing Chrome to the foreground');
  const image=await call('screenshot');if(image.result.isError)throw Error(image.data?.error||'Screenshot failed');const imagePart=image.result.content.find(c=>c.type==='image');check(imagePart?.data,'MCP delivers a real screenshot image');
  mkdirSync(path.join(home,'acceptance'),{recursive:true});writeFileSync(path.join(home,'acceptance/browser.png'),Buffer.from(imagePart.data,'base64'));
  const side=await call('sidescreen_status');check(side.data.ready&&side.data.available,'SideScreen helper and CUA daemon are healthy');
  const windows=await call('sidescreen_windows');
  const bound=windows.data.windows.filter(w=>w.Title===pageTitle+' - Google Chrome');check(bound.length===1,'Browser agent window is on SideScreen');
  check(side.data.agentScreen.x<=bound[0].Bounds.X && bound[0].Bounds.Right<=side.data.agentScreen.x+side.data.agentScreen.width && side.data.agentScreen.y<=bound[0].Bounds.Y && bound[0].Bounds.Bottom<=side.data.agentScreen.y+side.data.agentScreen.height,'Browser window is contained in SideScreen');
  for(const [file,kind,label] of [[process.env.MUSE_NATIVE_PROBE,'native','Agent text'],[process.env.MUSE_WPF_PROBE,'WPF','']]) {
    if(!file)continue;
    const probe=()=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    const scoped={window_handle:probe().handle,expected_display_id:side.data.agentScreen.id};
    const observed=await call('sidescreen_observe',{...scoped,include_screenshot:true});check(observed.data.ok && observed.result.content.some(c=>c.type==='image'),`${kind}: fresh scoped state and screenshot`);
    const edit=observed.data.state.elements.filter(e=>e.role==='Edit' && (!label || e.label===label));check(edit.length===1,`${kind}: unique observed edit`);
    const value=`${kind} Muse café Ω`;
    const action={...scoped,observation_id:observed.data.observationId,tool:'set_value',arguments:{element_token:edit[0].element_token,value}};
    const acted=await call('sidescreen_act_and_observe',action);check(acted.data.ok && probe().text===value,`${kind}: Unicode reaches the real app`);check(acted.data.receipt.focus.Preserved,`${kind}: foreground and keyboard focus preserved`);
    const reused=await call('sidescreen_act',action);check(reused.result.isError,`${kind}: stale observation is refused`);
    const button=kind==='native'?'Increment counter':'Increment WPF counter',checkbox=kind==='native'?'Agent checkbox':'WPF checkbox';
    const batch=await call('sidescreen_steps',{...scoped,steps:[{selector:{label:button,role:'Button'},tool:'click',arguments:{}},{selector:{label:checkbox,role:'CheckBox'},tool:'click',arguments:{}}]});
    check(batch.data.ok && probe().clicks===1 && probe().check,`${kind}: locally batched button/checkbox actions verified`);
    check(batch.data.receipts.every(r=>r.focus.Preserved),`${kind}: every batch action preserves focus`);
    const wait=await call('sidescreen_wait',{...scoped,selector:{label:button,role:'Button'},timeout_ms:1000});check(wait.data.matched,`${kind}: semantic wait matches real control`);
    const wrong=await call('sidescreen_observe',{...scoped,expected_display_id:'wrong-display'});check(wrong.result.isError,`${kind}: wrong display refused`);
  }
  report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{await client.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));mkdirSync(path.join(home,'acceptance'),{recursive:true});writeFileSync(path.join(home,'acceptance/report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
