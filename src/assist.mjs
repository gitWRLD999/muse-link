import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createSideUsers,sideUserTools} from './sideusers.mjs';

const exec=promisify(execFile);
const target={window_handle:{type:'integer',minimum:1},expected_display_id:{type:'string',minLength:1}};
const s=(properties,required=Object.keys(target))=>({type:'object',properties,required,additionalProperties:false});
const text={type:'string',minLength:1,maxLength:256};
const observation={observation_id:{type:'string',minLength:1}};
const pixels={...target,...observation,x:{type:'number',minimum:0},y:{type:'number',minimum:0},button:{type:'string',enum:['left','right','middle']}};
export const assistTools=[
  {name:'agent_tools_status',description:'Report actual installation/readiness of winapp, UFO app APIs, CPU OmniParser, free SideCursor and MouseMux. CUA Driver remains the default scoped desktop input route.',inputSchema:s({},[])},
  {name:'mousemux_status',description:'Probe the official local MouseMux Input Mapper MCP server. Diagnostics only: raw graph/system tools are never forwarded. Installation, enabling MCP and arming are separate from a successful connection.',inputSchema:s({},[])},
  {name:'winapp_inspect',description:'Fast scoped Windows UI inspection using Microsoft winapp CLI. Read-only semantic slugs, bounds and types; these are not CUA action tokens.',inputSchema:s({...target,depth:{type:'integer',minimum:1,maximum:12},interactive:{type:'boolean'}})},
  {name:'winapp_find',description:'Read-only scoped winapp search by visible text, optionally UIA type. No global search, foreground injection or arbitrary CLI flags.',inputSchema:s({...target,query:text,type:text,max_results:{type:'integer',minimum:1,maximum:100}},[...Object.keys(target),'query'])},
  {name:'ufo_inspect',description:'Read a currently running Word document or Excel workbook bound to this exact SideScreen HWND. Returns a one-use 120-second observation for app API actions. Never opens Office or uses fuzzy title matching.',inputSchema:s({...target,sheet_name:text})},
  {name:'ufo_word_insert_table',description:'Insert a bounded table with Microsoft UFO Word COM API in the exact freshly observed document. No selection/focus/global Office actions; reobserve and verify afterwards.',inputSchema:s({...target,...observation,rows:{type:'integer',minimum:1,maximum:20},columns:{type:'integer',minimum:1,maximum:20}},[...Object.keys(target),'observation_id','rows','columns'])},
  {name:'ufo_excel_write_cells',description:'Write a bounded rectangular table with Microsoft UFO Excel COM API to an exact sheet in the observed workbook. Stops on changes; does not activate/select or save. Formula strings are refused.',inputSchema:s({...target,...observation,sheet_name:text,start_row:{type:'integer',minimum:1,maximum:1048576},start_column:{type:'integer',minimum:1,maximum:16384},values:{type:'array',minItems:1,maxItems:100,items:{type:'array',minItems:1,maxItems:20,items:{type:['string','number','boolean','null']}}}},[...Object.keys(target),'observation_id','sheet_name','start_row','start_column','values'])},
  {name:'omniparser_observe',description:'On-demand local CPU visual fallback: Microsoft OmniParser YOLOv9 icon regions plus EasyOCR text from a fresh CUA window screenshot. Returns image-pixel boxes; unknown icons have no invented captions. Prefer DOM/UIA for speed. This is observation, not a click.',inputSchema:s({...target})},
  {name:'sidecursor_move',description:'Move an independent free software pointer using a fresh sidescreen_observe screenshot with accessibility tree. Consumes that observation. Sends only a scoped client-area WM_MOUSEMOVE; never moves the human cursor. Requires a corroborated capture transform.',inputSchema:s(pixels,[...Object.keys(target),'observation_id','x','y'])},
  {name:'sidecursor_click',description:'One scoped software-pointer click using fresh image pixels from sidescreen_observe/omniparser_observe. Prefers a uniquely observed control via native/CUA background invocation; otherwise scoped client-area mouse messages. Free open source, limited app support, no universal isolation. Verify fresh state. Observation is one-use; no automatic retry.',inputSchema:s(pixels,[...Object.keys(target),'observation_id','x','y'])}
];
export function validate(rule,value,name='arguments') {
  if(rule.enum&&!rule.enum.includes(value))throw Error(`Invalid ${name}`);
  const types=Array.isArray(rule.type)?rule.type:[rule.type];
  if(types.includes('null')&&value===null)return;
  const type=Array.isArray(value)?'array':Number.isInteger(value)?'integer':typeof value;
  if(!types.includes(type)&&!(type==='integer'&&types.includes('number')))throw Error(`Invalid ${name}`);
  if((type==='integer'||type==='number')&&(!Number.isFinite(value)||value<(rule.minimum??-Infinity)||value>(rule.maximum??Infinity)))throw Error(`Invalid ${name}`);
  if(type==='string'&&(value.length<(rule.minLength??0)||value.length>(rule.maxLength??32768)||value.includes('\0')))throw Error(`Invalid ${name}`);
  if(type==='object') {
    if(!value||Object.keys(value).some(k=>!Object.hasOwn(rule.properties,k)))throw Error(`Unsupported ${name}`);
    for(const k of rule.required||[])if(!Object.hasOwn(value,k))throw Error(`Missing ${k}`);
    for(const [k,v] of Object.entries(value))validate(rule.properties[k],v,k);
  }
  if(type==='array') {
    if(value.length<(rule.minItems??0)||value.length>(rule.maxItems??Infinity))throw Error(`Invalid ${name}`);
    for(const v of value)validate(rule.items,v,name);
  }
}
export const sameScope=(a,b)=>a?.ok&&b?.ok&&a.windowHandle===b.windowHandle&&a.processId===b.processId&&a.processStartTicks===b.processStartTicks&&a.displayId===b.displayId&&JSON.stringify(a.bounds)===JSON.stringify(b.bounds);
const result=data=>({isError:data.ok===false,content:[{type:'text',text:JSON.stringify(data)}]});

export function pythonWorker(spec) {
  let child,lines,pending;
  function close(error=Error('App worker closed; outcome unknown. Observe before continuing.')){pending?.reject(error);pending=undefined;lines?.close();lines=undefined;child?.kill();child=undefined;}
  const call=request=>new Promise((resolve,reject)=>{
    if(pending)return reject(Error('Concurrent app worker call refused'));
    if(!child) {
      child=spawn(spec.python,['-u',fileURLToPath(new URL('../scripts/agent-apps.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',MUSE_UFO_ROOT:spec.ufoDirectory,MUSE_OMNI_ROOT:spec.omniDirectory,MUSE_OMNI_MODEL:spec.modelFile,MUSE_EASYOCR_MODELS:spec.ocrDirectory}});
      const current=child;
      child.on('error',e=>{if(child===current)close(e);});child.stdin.on('error',e=>{if(child===current)close(e);});
      child.on('close',()=>{if(child===current)close();});child.stderr.resume();
      lines=createInterface({input:child.stdout});
      lines.on('line',line=>{if(!pending)return;const p=pending;pending=undefined;try{if(Buffer.byteLength(line)>4*1024*1024)throw Error('App response too large');p.resolve(JSON.parse(line));}catch(e){p.reject(e);}});
    }
    const timer=setTimeout(()=>close(Error('App worker timed out; outcome unknown. Reobserve before continuing.')),90000);
    pending={resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}};
    child.stdin.write(JSON.stringify(request)+'\n');
  });
  return {call,close};
}
export function createAssistEngine(spec,side,{runWinapp,worker,mousemuxProbe}={}) {
  const users=side.users||(side.users=createSideUsers(side,{validate,sameScope}));
  const apps=worker||pythonWorker(spec), observations=new Map();
  let muxClient,muxTransport;
  async function probeMux() {
    if(mousemuxProbe)return mousemuxProbe();
    const url=new URL(spec.mousemuxUrl||'http://127.0.0.1:41760/mcp');
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash)throw Error('MouseMux must use its local 127.0.0.1 endpoint');
    try {
      if(!muxClient){muxClient=new Client({name:'Muse Link MouseMux diagnostics',version:'1.2.0'});muxTransport=new StreamableHTTPClientTransport(url);await muxClient.connect(muxTransport,{timeout:3000});}
      const tools=await muxClient.listTools({}, {timeout:3000});
      return {ok:true,connected:true,ready:false,actuationEnabled:false,availableTools:tools.tools.map(t=>t.name),reason:'Vendor connected; live scoped actuation has not been verified. Use the free SideCursor/CUA routes.'};
    }catch{await muxTransport?.close().catch(()=>{});muxClient=undefined;return {ok:true,connected:false,ready:false,actuationEnabled:false,reason:'MouseMux Input Mapper MCP is unavailable. Complete the signed vendor install and enable MCP on 127.0.0.1:41760.'};}
  }
  async function scoped(args,operation) {
    const before=await side.scope(args);if(!before.ok)return result(before);
    return side.guard(async()=>{
      const data=await operation(before);
      const after=await side.scope(args);
      if(!sameScope(before,after))return result({ok:false,stop:true,outcomeUnknown:true,error:'Window process/display/geometry changed. Reobserve; do not replay input.'});
      return result(data);
    });
  }
  const handler=async request=>{
    if(request.method==='list')return {tools:[...assistTools,...sideUserTools]};
    if(request.tool?.startsWith('sideuser_'))return users.handle(request);
    await users.assertAccess(request);
    const tool=assistTools.find(t=>t.name===request.tool);if(!tool)throw Error('Unknown agent assistance tool');
    const args=request.arguments||{};validate(tool.inputSchema,args);
    if(request.tool==='mousemux_status')return result(await probeMux());
    if(request.tool==='agent_tools_status') {
      const health=existsSync(spec.python)?await apps.call({action:'status'}):{ok:false,error:'Python app runtime missing'};
      return result({ok:true,winapp:{installed:existsSync(spec.winappBinary),binary:spec.winappBinary},ufo:health.ufo||{ready:false},omniparser:health.omniparser||{ready:false},sidecursor:{installed:true,backend:'scoped window messages',universalIsolation:false},mousemux:await probeMux(),preferredRoutes:['regular Chrome DOM','CUA/native semantic background input','winapp inspection','UFO exact-window app API','OmniParser visual fallback','SideCursor supported window messages']});
    }
    if(request.tool.startsWith('sidecursor_'))return result(await side.pointer({...args,operation:request.tool==='sidecursor_move'?'move':'click'}));
    if(request.tool==='omniparser_observe') {
      const imageResult=await side({method:'call',tool:'sidescreen_observe',arguments:{...args,include_screenshot:true}});
      const capture=JSON.parse(imageResult.content[0].text);if(!capture.ok)return imageResult;
      const parsed=await scoped(args,async()=>{
        const start=Date.now();const parsed=await apps.call({action:'parse',screenshot: capture.screenshotPath});
        if(Date.now()-start>=110000)return {ok:false,stop:true,error:'Visual parse exceeded the observation lifetime. Reobserve before input.'};
        return {...parsed,observationId:capture.observationId,image:capture.image,expiresInSeconds:Math.max(0,120-Math.ceil((Date.now()-start)/1000))};
      });
      if(!parsed.isError)parsed.content.push(...imageResult.content.filter(c=>c.type==='image'));return parsed;
    }
    return scoped(args,async scope=>{
      if(request.tool.startsWith('winapp_')) {
        const command=request.tool==='winapp_inspect'?['ui','inspect','-w',String(args.window_handle),'--json','--depth',String(args.depth||4),...(args.interactive?['--interactive']:[])]:['ui','search',args.query,'-w',String(args.window_handle),'--json','--max',String(args.max_results||50),...(args.type?['--type',args.type]:[])];
        // Selector text must not be interpreted as a CLI switch.
        if(args.query?.startsWith('-')||args.type?.startsWith('-'))throw Error('Search text/type may not start with a CLI switch');
        const raw=runWinapp?await runWinapp(command):await exec(spec.winappBinary,command,{windowsHide:true,timeout:15000,maxBuffer:2*1024*1024,env:{...process.env,WINAPP_CLI_TELEMETRY_OPTOUT:'1'}}).then(r=>r.stdout);
        const data=typeof raw==='string'?JSON.parse(raw):raw;
        if(data.error||data.windows?.some(w=>Number(w.hwnd)!==args.window_handle))throw Error('winapp returned an error or a different target window');
        for(const window of data.windows||[])if(window.elements?.length>512){window.elements=window.elements.slice(0,512);window.truncated=true;}
        return {ok:true,backend:'microsoft-winapp',scope,state:data};
      }
      const now=Date.now();for(const [id,o]of observations)if(o.expires<now)observations.delete(id);
      if(request.tool==='ufo_inspect') {
        const data=await apps.call({action:'office_inspect',hwnd:args.window_handle,sheet_name:args.sheet_name});
        if(!data.ok)return data;
        const id=randomUUID();observations.set(id,{scope,documentId:data.documentId,expires:now+120000});
        return {...data,observationId:id,expiresInSeconds:120};
      }
      const previous=observations.get(args.observation_id);observations.delete(args.observation_id);
      if(!previous||previous.expires<Date.now()||!sameScope(previous.scope,scope))return {ok:false,stop:true,error:'Office observation expired, consumed, or target changed. Inspect again.'};
      if(request.tool==='ufo_excel_write_cells') {
        if(args.values.some(row=>row.length!==args.values[0].length||row.some(v=>typeof v==='string'&&/^\s*[=+@-]/.test(v))))throw Error('Use a rectangular table of literal cell values; formula strings are refused');
        if(args.start_row+args.values.length-1>1048576||args.start_column+args.values[0].length-1>16384)throw Error('Cell range is outside the sheet');
      }
      return apps.call({action:request.tool,hwnd:args.window_handle,document_id:previous.documentId,...args});
    });
  };
  handler.close=async()=>{await users.close();apps.close();await muxClient?.close().catch(()=>{});};return handler;
}
