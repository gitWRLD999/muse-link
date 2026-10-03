// Opt-in read-only account access check through the installed Muse MCP proxy.
// Do not click sign-in/consent or submit any application. Keep page data local.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const cli=process.env.MUSE_CHANNEL_CLI||path.resolve('bin/muse-link.mjs');
const client=new Client({name:'Simulated Muse profile access',version:'1.3.1'});
const transport=new StdioClientTransport({command:process.execPath,args:[cli,'mcp','agent'],stderr:'inherit'});
const report={checks:[],pages:[]},created=[];let previous;
async function call(name,args={}) {
  const result=await client.callTool({name,arguments:args},undefined,{timeout:120000});
  const part=result.content.find(c=>c.type==='text');let data;
  try{data=JSON.parse(part.text);}catch{throw Error(name+': '+part.text.split(/\n### Ran /)[0].replace(/https?:\/\/\S+/g,'[URL]'));}
  assert.ok(!result.isError,data.error||name+' failed');assert.ok(result._meta?.focus?.Preserved,name+' preserves focus');
  return data;
}
try {
  await client.connect(transport);const tools=await client.listTools();
  assert.equal(tools.tools.length,36);report.checks.push('36 current tools discovered');
  assert.match(client.getInstructions(),/chrome_ready.*open_url/);report.checks.push('MCP initialization supplies the current regular-profile workflow');
  const status=await call('chrome_status');assert.ok(status.ready&&status.profile==='Profile 1'&&status.profileTokenMatched);previous=status.selected_tab;
  report.checks.push('Regular Profile 1 token matches and the SideScreen window is ready');
  for(const [label,url] of [['Google Account','https://myaccount.google.com/'],['Application',process.env.MUSE_TEST_APP_URL||'https://example.com/']]) {
    const opened=await call('open_url',{url,new_tab:true});created.push(opened.tab_id);
    await new Promise(resolve=>setTimeout(resolve,1500));const page=await call('snapshot');
    const actual=new URL(page.url);
    report.pages.push({label,origin:actual.origin,path:actual.pathname,title:page.title,
      needsSignIn:actual.hostname==='accounts.google.com'||/\/auth\/|\/signin/.test(actual.pathname)||/button "(?:sign in|log in|login)"|link "(?:sign in|log in|login)"/i.test(page.snapshot),
      accountDashboard:label==='Google Account'&&actual.hostname==='myaccount.google.com'&&/welcome|Google Account:/i.test(page.snapshot),
      securityAlert:label==='Google Account'&&/critical security alert|suspicious activity/i.test(page.snapshot),
      authenticatedApp:label==='Application'&&/sign out|log out|logout/i.test(page.snapshot),focusPreserved:true});
  }
  // Exercise closed-tab recovery through the actual agent channel.
  for(const tab of created)await call('close_tab',{tab_id:tab});created.length=0;
  assert.equal((await call('chrome_status')).ready,false);report.checks.push('Closing the selected tab reports recovery rather than using a human tab');
  const replacement=await call('chrome_ready');created.push(replacement.selected_tab);assert.ok(replacement.ready&&replacement.profileTokenMatched);
  report.checks.push('A replacement tab is created in the same authenticated Chrome profile');
  report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally {
  for(const tab of created)try{await call('close_tab',{tab_id:tab});}catch{}
  if(previous)try{await call('select_tab',{tab_id:previous});}catch{}
  await client.close();
  const directory=path.join(process.env.USERPROFILE,'AgentTools','MuseLink','acceptance');mkdirSync(directory,{recursive:true});
  writeFileSync(path.join(directory,'profile-access.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
