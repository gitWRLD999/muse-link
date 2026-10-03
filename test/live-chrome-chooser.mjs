// Opt-in: Chrome's actual FedCM dialog, with loopback-only fictional accounts.
// No Google credentials, account tokens or third-party sign-in are used.
import http from 'node:http';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const report={checks:[],requests:[]},title='Muse Chrome chooser '+crypto.randomUUID().slice(0,8);
let rpOrigin,idpOrigin;
const idp=http.createServer((req,res)=>{
  const p=new URL(req.url,idpOrigin).pathname;report.requests.push({kind:'idp',path:p});
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  res.setHeader('Access-Control-Allow-Origin',rpOrigin);res.setHeader('Access-Control-Allow-Credentials','true');
  if(p==='/.well-known/web-identity')res.end(JSON.stringify({provider_urls:[idpOrigin+'/config.json'],accounts_endpoint:idpOrigin+'/accounts',login_url:idpOrigin+'/login'}));
  else if(p==='/config.json')res.end(JSON.stringify({accounts_endpoint:'/accounts',client_metadata_endpoint:'/metadata',id_assertion_endpoint:'/token',login_url:'/login'}));
  else if(p==='/accounts')res.end(JSON.stringify({accounts:[{id:'fictional-a',email:'agent-one@example.invalid',name:'Muse Fixture One',given_name:'Fixture One'},{id:'fictional-b',email:'agent-two@example.invalid',name:'Muse Fixture Two',given_name:'Fixture Two'}]}));
  else if(p==='/metadata')res.end(JSON.stringify({privacy_policy_url:rpOrigin+'/privacy',terms_of_service_url:rpOrigin+'/terms'}));
  else if(p==='/token')res.end(JSON.stringify({token:'fictional-loopback-test-only'}));
  else if(p==='/login'){res.setHeader('Content-Type','text/html');res.setHeader('Set-Login','logged-in');res.end('<title>Fictional identity fixture</title><p>Local test accounts only.</p>');}
  else{res.statusCode=404;res.end('{}');}
});
const rp=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>${title}</title><style>body{font:20px sans-serif;padding:30px}button,input{font:20px sans-serif;margin:15px;padding:15px}</style><h1>Local Chrome chooser fixture</h1><label>Fixture text<input id="text" onkeydown="keyState.textContent='Last key: '+event.key+' trusted: '+event.isTrusted"></label><button id="counter" onclick="count.textContent=Number(count.textContent)+1;clickState.textContent='Trusted click: '+event.isTrusted">Increment</button><p id="count">0</p><button onclick="showChooser()">Show native Chrome account chooser</button><p id="out">No identity selected</p><p id="clickState"></p><p id="keyState"></p><div style="height:1600px"></div><p>Scroll fixture end</p><script>async function showChooser(){try{const c=await navigator.credentials.get({identity:{providers:[{configURL:'${idpOrigin}/config.json',clientId:'muse-fixture'}],mode:'active'},mediation:'required'});out.textContent=c?.token==='fictional-loopback-test-only'?'Fictional identity selected':'Unexpected fixture result';}catch(e){out.textContent=e.name+': '+e.message;}}</script>`);
});
await new Promise(r=>idp.listen(0,'127.0.0.1',r));idpOrigin=`http://127.0.0.1:${idp.address().port}`;
await new Promise(r=>rp.listen(0,'127.0.0.1',r));rpOrigin=`http://localhost:${rp.address().port}`;
const client=new Client({name:'Simulated Muse native Chrome',version:'1.4.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[process.env.MUSE_CHANNEL_CLI||path.resolve('bin/muse-link.mjs'),'mcp','agent'],stderr:'inherit'});
const created=[];let previous;
async function call(name,args={}) {
  const started=performance.now(),r=await client.callTool({name,arguments:args},undefined,{timeout:120000});
  let j;try{j=JSON.parse(r.content.find(c=>c.type==='text')?.text||'{}');}catch{j={error:r.content.find(c=>c.type==='text')?.text};}
  report.checks.push({tool:name,ok:!r.isError,ms:Math.round(performance.now()-started),focus:r._meta?.focus||j.focus,error:j.error});
  console.error(JSON.stringify({tool:name,ok:!r.isError,ms:report.checks.at(-1).ms,error:j.error}));
  if(r.isError)throw Error(name+': '+(j.error||JSON.stringify(j)));
  if(r.content.some(c=>c.type==='image')) {
    const image=r.content.find(c=>c.type==='image');writeFileSync(path.join(output,name+'.png'),Buffer.from(image.data,'base64'));
  }
  return j;
}
const output=path.join(process.env.USERPROFILE,'AgentTools/MuseLink/acceptance/native-chrome');mkdirSync(output,{recursive:true});
try {
  await client.connect(transport);const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='chrome_desktop_observe'));
  let status=await call('chrome_status');if(!status.ready)status=await call('chrome_ready');previous=status.selected_tab;
  const login=await call('open_url',{url:idpOrigin+'/login',new_tab:true});created.push(login.tab_id);
  const page=await call('open_url',{url:rpOrigin,new_tab:true});created.push(page.tab_id);
  const image=await call('chrome_visual_observe');report.visual=image;
  const desktop=await call('chrome_desktop_observe');report.desktop={controls:desktop.state?.elements?.map(e=>({label:e.label,role:e.role,actions:e.actions})),screenshot:desktop.screenshotPath};
  await call('act',{action:'click',role:'button',name:'Show native Chrome account chooser'});
  await new Promise(r=>setTimeout(r,1500));
  const chooser=await call('chrome_desktop_observe');report.chooser={observation_id:chooser.observationId,controls:chooser.state?.elements?.map(e=>({token:e.element_token,label:e.label,role:e.role,actions:e.actions})),screenshot:chooser.screenshotPath};
  const token=(observation,name)=>{const matches=observation.state.elements.filter(e=>e.label===name&&e.role==='Button');assert.equal(matches.length,1);return matches[0].element_token;};
  if(process.env.MUSE_CHOOSER_AUTOMATED==='1') {
    const account=await call('chrome_desktop_act',{observation_id:chooser.observationId,tool:'click',arguments:{element_token:token(chooser,'Muse Fixture One\nagent-one@example.invalid')}});
    assert.ok(account.receipt.focus.Preserved&&account.receipt.focus.CursorPreserved);report.checks.push({check:'Fictional account selection preserves foreground, keyboard focus and cursor',ok:true});
    const continued=await call('chrome_desktop_act',{observation_id:account.observation.observationId,tool:'click',arguments:{element_token:token(account.observation,'Continue')}});
    assert.ok(continued.receipt.focus.Preserved&&continued.receipt.focus.CursorPreserved);report.checks.push({check:'Final native Continue preserves foreground, keyboard focus and cursor',ok:true});
    assert.ok(continued.observation.state.elements.some(e=>e.label==='Fictional identity selected'));assert.ok(report.requests.some(r=>r.path==='/token'));
    report.checks.push({check:'Chrome completed actual FedCM against fictional loopback identity provider',ok:true});
    // Coordinates come from the inspected fixture PNG, at the fixed layout above.
    let visual=await call('chrome_visual_observe');assert.ok(visual.image.width>=600&&visual.image.height>=450);
    const pageInput=async args=>{
      visual=await call('chrome_visual_act',{observation_id:visual.observation_id,...args});
      const focus=report.checks.at(-1).focus;assert.ok(focus?.Preserved&&focus.CursorPreserved);
    };
    await pageInput({action:'click',x:270,y:180});
    await pageInput({action:'type',text:'Muse café Ω'});
    assert.ok((await call('snapshot')).snapshot.includes('Muse café Ω'));
    await pageInput({action:'press',key:'Backspace'});
    const typed=await call('snapshot');assert.ok(!typed.snapshot.includes('Ω'));assert.ok(typed.snapshot.includes('Last key: Backspace trusted: true'));
    await pageInput({action:'click',x:520,y:180});
    assert.ok((await call('snapshot')).snapshot.includes('Trusted click: true'));
    await pageInput({action:'scroll',x:1000,y:580,delta_y:320});assert.ok(visual.viewport.pageY>0);
    report.checks.push({check:'Trusted visual click, Unicode typing, Backspace and scrolling preserve human input',ok:true});
  }
  console.log(JSON.stringify({reportPath:path.join(output,'report.json'),nativeControls:report.chooser.controls.filter(e=>/Choose|Fixture|Continue/.test(e.label)),checks:report.checks,requests:report.requests},null,2));
  // Keep this MCP connection alive for separate observe/act test cells.
  if(process.env.MUSE_CHOOSER_INTERACTIVE==='1') {
    const {createInterface}=await import('node:readline');const lines=createInterface({input:process.stdin});
    for await(const line of lines){if(line==='quit')break;try{const {tool,args}=JSON.parse(line),result=await call(tool,args);console.log(JSON.stringify(result));}catch(e){console.log(JSON.stringify({error:e.message}));}}
  }
  report.ok=true;
}catch(e){report.ok=false;report.error=e.message;console.log(JSON.stringify({error:e.message,requests:report.requests}));process.exitCode=1;}
finally {
  for(const id of created)try{await call('close_tab',{tab_id:id});}catch{}
  if(previous)try{await call('select_tab',{tab_id:previous});}catch{}
  await client.close();idp.closeAllConnections();rp.closeAllConnections();await Promise.all([new Promise(r=>idp.close(r)),new Promise(r=>rp.close(r))]);
  writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
}
