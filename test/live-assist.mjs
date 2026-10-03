// Opt-in real simulated Muse channel. Uses only disposable native/WPF test apps.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {startBroker} from '../src/broker.mjs';
import {loadConfig} from '../src/config.mjs';
import {createSideScreenEngine} from '../src/sidescreen.mjs';

const home=path.join(process.env.USERPROFILE,'AgentTools'),out=path.join(home,'MuseLink/acceptance/extras');mkdirSync(out,{recursive:true});
const original=loadConfig(),sideDirectory=process.env.MUSE_TEST_SIDESCREEN||path.join(home,'SideScreen');
const assist={kind:'assist',winappBinary:path.join(home,'WinApp/winapp.exe'),python:path.join(home,'AgentPerception/venv/Scripts/python.exe'),ufoDirectory:path.join(home,'UFO'),omniDirectory:path.join(home,'OmniParser'),modelFile:path.join(home,'AgentPerception/weights/icon_detect_v3/model.pt'),ocrDirectory:path.join(home,'AgentPerception/ocr')};
const config={...original,port:18923,stateDir:path.join(out,'state'),engines:{...original.engines,agent:{...original.engines.agent,assist:'assist'},sidescreen:{...original.engines.sidescreen,directory:sideDirectory},assist}};
const broker=await startBroker(config);
const transport=new StdioClientTransport({command:process.execPath,args:[process.env.MUSE_CHANNEL_CLI||path.resolve('bin/muse-link.mjs'),'mcp','agent'],env:{...process.env,MUSE_LINK_PORT:String(config.port),MUSE_LINK_STATE_DIR:config.stateDir},stderr:'inherit'});
const client=new Client({name:'Simulated Muse additional tools',version:'1.2.0'}),processes=[];
const fixtureGuard=createSideScreenEngine({directory:sideDirectory,env:original.engines.sidescreen.env});
const report={checks:[],timings:[],channel:'persistent MCP → loopback broker → actual scoped Windows/CPU providers'};
function check(value,label){assert.ok(value,label);report.checks.push(label);}
async function call(name,args={}) {
  const start=performance.now(),r=await client.callTool({name,arguments:args},undefined,{timeout:120000});
  report.timings.push({tool:name,ms:Math.round(performance.now()-start),focus:r._meta?.focus});
  const text=r.content.find(c=>c.type==='text')?.text;let data;try{data=JSON.parse(text);}catch{data={ok:false,error:text};}
  return {r,data};
}
try {
  await client.connect(transport);
  const listed=await client.listTools();check(listed.tools.length===34,'Muse discovers 17 base tools, 10 assistance tools and 7 SideUser tools');
  const health=await call('agent_tools_status');check(health.data.winapp.installed&&health.data.ufo.ready&&health.data.omniparser.ready,'Actual winapp, UFO imports and downloaded OmniParser/OCR models ready');
  check(!health.data.mousemux.ready,'Unavailable/unverified vendor actuation is not reported as ready');
  const status=(await call('sidescreen_status')).data;check(status.available&&status.ready,'CUA Driver and fresh SideScreen display ready');
  for(const kind of process.env.MUSE_TEST_OFFICE_ONLY==='1'?[]:['Background','CuaWpf']) {
    const file=path.join(out,`${kind}.json`),probe=()=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    try{await import('node:fs').then(m=>m.unlinkSync(file));}catch{}
    const p=spawn(path.join(sideDirectory,`SideScreen.${kind}Probe.exe`),[file],{windowsHide:true,stdio:'ignore'});processes.push(p);
    for(let n=0;n<60;n++){try{probe();break;}catch{await new Promise(r=>setTimeout(r,100));}}
    const args={window_handle:probe().handle,expected_display_id:status.agentScreen.id};
    const inspect=await call('winapp_inspect',{...args,depth:8});check(inspect.data.ok&&inspect.r._meta.focus.Preserved,`${kind}: real winapp UI tree preserves focus`);
    const label=kind==='Background'?'Increment counter':'Increment WPF counter';
    const found=await call('winapp_find',{...args,query:label,type:'Button'});check(found.data.ok,`${kind}: actual winapp search succeeds`);
    const observed=await call('sidescreen_observe',{...args,include_screenshot:true});check(observed.data.ok,`${kind}: CUA screenshot binds pointer coordinates`);
    const button=observed.data.state.elements.filter(e=>e.role==='Button'&&e.label===label);check(button.length===1,`${kind}: uniquely grounded disposable button`);
    const b=button[0].screenshot_frame;
    // CUA supplies image-pixel bounds specifically bound to this capture.
    if(!b)throw Error('Driver button bounds unavailable: '+JSON.stringify(button[0]));
    const click={...args,observation_id:observed.data.observationId,x:b.x+b.w/2,y:b.y+b.h/2};
    const pointer=await call('sidecursor_click',click);report.pointer=pointer.data;check(pointer.data.ok&&pointer.data.focus.Preserved,`${kind}: independent pointer preserves foreground/keyboard focus`);
    await new Promise(r=>setTimeout(r,100));check(probe().clicks===1,`${kind}: pointer triggers the real handler exactly once`);
    if(process.env.MUSE_PREVIEW_PROBE)check(JSON.parse(execFileSync(process.env.MUSE_PREVIEW_PROBE,[path.join(sideDirectory,'SideScreen.exe')],{encoding:'utf8',windowsHide:true})).ok,`${kind}: production preview renders the independent blue agent marker`);
    check((await call('sidecursor_click',click)).r.isError,`${kind}: consumed pointer observation is refused`);
    check((await call('winapp_inspect',{...args,expected_display_id:'wrong'})).r.isError,`${kind}: wrong display is refused before winapp`);
    if(kind==='Background') {
      let canvasObservation=await call('sidescreen_observe',{...args,include_screenshot:true});
      // The canvas has no accessibility action. Correlate the disposable app's
      // real native center with the fresh capture's observed reference frame.
      const canvasPixels=o=>{const reference=o.data.state.elements.find(e=>e.label===label&&e.screenshot_frame&&e.frame);if(!reference)throw Error('Fresh reference frame missing');const p=probe().canvasScreenCenter,b=reference.frame,i=reference.screenshot_frame;return {x:i.x+(p.x-b.x)*i.w/b.w,y:i.y+(p.y-b.y)*i.h/b.h};};
      check(canvasObservation.data.ok&&probe().canvasScreenCenter,'Canvas: fresh capture and native fixture geometry ground the fallback');
      const moved=await call('sidecursor_move',{...args,observation_id:canvasObservation.data.observationId,...canvasPixels(canvasObservation)});
      report.rawPointer=moved.data;
      check(moved.data.ok&&moved.data.focus.Preserved,'Canvas: independent pointer movement preserves focus');
      const point=probe();check(Math.abs(point.canvasPointer.x-point.canvasWidth/2)<=2&&Math.abs(point.canvasPointer.y-point.canvasHeight/2)<=2,'Canvas: actual mouse-move handler receives calibrated client pixels');
      canvasObservation=await call('sidescreen_observe',{...args,include_screenshot:true});
      const clicked=await call('sidecursor_click',{...args,observation_id:canvasObservation.data.observationId,...canvasPixels(canvasObservation)});
      check(clicked.data.ok&&clicked.data.focus.Preserved&&clicked.data.backend==='sidecursor-window-messages','Canvas: raw scoped pointer click uses the free background backend');
      check(probe().canvasClicks===1,'Canvas: raw pointer invokes the real mouse-down handler exactly once');
      const visual=await call('omniparser_observe',args);check(visual.data.ok&&visual.r.content.some(c=>c.type==='image'), 'CPU OmniParser returns a real scoped image and detected regions');
      check(visual.data.elements.some(e=>e.kind==='text'&&/Increment/i.test(e.label)), 'EasyOCR reads the actual native button text');
      check(visual.data.elements.some(e=>e.kind==='icon'), 'Microsoft YOLOv9 weights detect actual interactive regions');
      check(visual.r._meta.focus.Preserved,'Visual inference preserves foreground/keyboard focus');
      report.visual={timingMs:visual.data.timingMs,elements:visual.data.elements.length,captionModel:visual.data.captionModel};
      const notOffice=await call('ufo_inspect',args);check(notOffice.r.isError,'UFO refuses a non-Office window without launching or fuzzy matching');
    }
  }
  if(process.env.MUSE_TEST_OFFICE==='1')for(const app of ['word','excel']) {
    const file=path.join(out,`Office-${app}.json`);try{await import('node:fs').then(m=>m.unlinkSync(file));}catch{}
    const fixture=await fixtureGuard.guard(async()=>{
      const p=spawn(assist.python,[path.resolve('test/office-probe.py'),app,String(status.agentScreen.x),String(status.agentScreen.y),file],{windowsHide:true,stdio:['pipe','pipe','pipe']});p.officeFixture=true;processes.push(p);
      p.stderr.on('data',d=>{report.officeFixtureError=String(d).slice(-1000);});
      for(let n=0;n<150;n++){try{JSON.parse(readFileSync(file,'utf8'));return {content:[{type:'text',text:'created'}]};}catch{if(p.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}}
      return {isError:true,content:[{type:'text',text:'Office fixture could not be created'}]};
    });
    check(!fixture.isError,`${app}: private Office window is placed/shown without activation`);
    report.officeFixture=JSON.parse(readFileSync(file,'utf8'));
    const args={window_handle:JSON.parse(readFileSync(file,'utf8')).hwnd,expected_display_id:status.agentScreen.id};
    const observed=await call('ufo_inspect',args);report.officeInspection={ok:observed.data.ok,app:observed.data.app,applicationName:observed.data.applicationName,error:observed.data.error};check(observed.data.ok&&observed.data.app===app,`${app}: exact-window COM inspection works through Muse`);
    const action=app==='word'?{...args,observation_id:observed.data.observationId,rows:2,columns:3}:{...args,observation_id:observed.data.observationId,sheet_name:'AgentTest',start_row:2,start_column:1,values:[['Muse café Ω',42],[true,'literal']]};
    const tool=app==='word'?'ufo_word_insert_table':'ufo_excel_write_cells';
    const acted=await call(tool,action);check(acted.data.ok&&acted.r._meta.focus.Preserved,`${app}: actual UFO mutation preserves foreground/keyboard focus`);
    const fresh=await call('ufo_inspect',args);
    check(app==='word'?fresh.data.state.tableCount===1:fresh.data.state.values[1][0]==='Muse café Ω'&&fresh.data.state.values[1][1]===42,`${app}: fresh real document state verifies the API effect`);
    check((await call(tool,action)).r.isError,`${app}: one-use app observation refuses repeated mutation`);
    const p=processes.at(-1);p.stdin.end('\n');await new Promise(r=>p.once('close',r));
  }
  report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally {await client.close();for(const p of processes){if(p.officeFixture&&p.exitCode===null){p.stdin.end('\n');await Promise.race([new Promise(r=>p.once('close',r)),new Promise(r=>setTimeout(r,5000))]);}p.kill();}fixtureGuard.close();await broker.close();writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
