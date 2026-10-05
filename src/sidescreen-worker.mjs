import {spawn} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createInterface} from 'node:readline';
import {runJson} from './process.mjs';

const target={window_handle:{type:'integer',minimum:1},expected_display_id:{type:'string',minLength:1}};
const selector={type:'object',properties:{label:{type:'string'},role:{type:'string'}},additionalProperties:false};
const argumentsSchema={type:'object',properties:{element_token:{type:'string'},x:{type:'number'},y:{type:'number'},button:{type:'string',enum:['left','right','middle']},count:{type:'integer',minimum:1,maximum:3},action:{type:'string',enum:['expand']},value:{type:'string'},text:{type:'string'},delay_ms:{type:'integer',minimum:0,maximum:200},direction:{type:'string',enum:['up','down','left','right']},amount:{type:'integer'},key:{type:'string'},modifiers:{type:'array',items:{type:'string'}},keys:{type:'array',items:{type:'string'}}},additionalProperties:false};
const tools=['click','set_value','type_text','scroll','press_key','hotkey'];
const observeProperties={...target,include_screenshot:{type:'boolean'},include_accessibility_tree:{type:'boolean'},max_elements:{type:'integer',minimum:1,maximum:512},max_depth:{type:'integer',minimum:1,maximum:50},max_image_dimension:{type:'integer',minimum:0,maximum:4096},query:{type:'string'}};
function schema(properties,required=Object.keys(target)){return {type:'object',properties,required,additionalProperties:false};}
export const sideScreenTools=[
  {name:'sidescreen_status',description:'Discover the current SideScreen ID and bounds; probe actual CUA readiness. Host focus is shared. Status is required before desktop work.',inputSchema:schema({},[])},
  {name:'sidescreen_windows',description:'List only windows on SideScreen; observation requires full containment. Never invent a handle.',inputSchema:schema({},[])},
  {name:'sidescreen_observe',description:'Fresh scoped CUA tokens; one action attempt, 120 seconds. Defaults to a compact tree WITHOUT screenshot. Request image for pixel actions. Capture coordinates are image pixels. Reobserve after action/refusal.',inputSchema:schema(observeProperties)},
  {name:'sidescreen_act',description:'One observed background action. Rejects global/foreground input. Check focus, stop and effect; never retry an unknown outcome.',inputSchema:schema({...target,observation_id:{type:'string'},tool:{type:'string',enum:tools},arguments:argumentsSchema},[...Object.keys(target),'observation_id','tool','arguments'])},
  {name:'sidescreen_find',description:'Fresh inspection filtered by exact label/role. Returns current matching controls and tokens without an image.',inputSchema:schema({...target,selector},[...Object.keys(target),'selector'])},
  {name:'sidescreen_wait',description:'Wait up to 15 seconds for a named control to appear/disappear, with fresh scoped inspections. Does not dispatch input.',inputSchema:schema({...target,selector,absent:{type:'boolean'},timeout_ms:{type:'integer',minimum:0,maximum:15000}},[...Object.keys(target),'selector'])},
  {name:'sidescreen_act_and_observe',description:'One grounded action followed by fresh state in the same request. Stops without further work if focus changes or dispatch fails. Never replays input.',inputSchema:schema({...target,observation_id:{type:'string'},tool:{type:'string',enum:tools},arguments:argumentsSchema,include_screenshot:{type:'boolean'}},[...Object.keys(target),'observation_id','tool','arguments'])},
  {name:'sidescreen_steps',description:'Up to 12 named-control background steps, freshly inspected and uniquely resolved before EACH action. Stops on refusal/focus change/unknown outcome; returns fresh final state.',inputSchema:schema({...target,steps:{type:'array',minItems:1,maxItems:12,items:schema({selector,tool:{type:'string',enum:tools},arguments:argumentsSchema},['selector','tool','arguments'])}},[...Object.keys(target),'steps'])}
];
function validate(rule,args) {
  if(!args || typeof args!=='object' || Array.isArray(args) || Object.keys(args).some(k=>!Object.hasOwn(rule.properties,k)))throw Error('Unsupported SideScreen arguments');
  for(const key of rule.required || [])if(!Object.hasOwn(args,key))throw Error(`Missing ${key}`);
  for(const [key,value] of Object.entries(args)) {
    const item=rule.properties[key];
    if(item.type==='integer' && (!Number.isInteger(value) || value<(item.minimum??-Infinity) || value>(item.maximum??Infinity)))throw Error(`Invalid ${key}`);
    if(item.type==='number' && (typeof value!=='number' || !Number.isFinite(value)))throw Error(`Invalid ${key}`);
    if(item.type==='string' && (typeof value!=='string' || value.length<(item.minLength??0)))throw Error(`Invalid ${key}`);
    if(item.type==='boolean' && typeof value!=='boolean')throw Error(`Invalid ${key}`);
    if(item.enum && !item.enum.includes(value))throw Error(`Invalid ${key}`);
    if(item.type==='object')validate(item,value);
    if(item.type==='array') {
      if(!Array.isArray(value)||value.length<(item.minItems??0)||value.length>(item.maxItems??Infinity))throw Error(`Invalid ${key}`);
      if(item.items?.type==='object')for(const entry of value)validate(item.items,entry);
      else if(item.items?.type==='string' && value.some(v=>typeof v!=='string'))throw Error(`Invalid ${key}`);
    }
  }
}
export function translateSideScreen(tool,args={}) {
  const rule=sideScreenTools.find(t=>t.name===tool)?.inputSchema;
  if(!rule)throw Error('Unknown SideScreen tool');validate(rule,args);
  const Action={sidescreen_status:'Status',sidescreen_windows:'Windows',sidescreen_observe:'CuaObserve',sidescreen_act:'CuaAct',sidescreen_act_and_observe:'CuaAct'}[tool];
  return {Action,WindowHandle:args.window_handle || 0,ExpectedDisplayId:args.expected_display_id,ObservationId:args.observation_id,Tool:args.tool,Arguments:args.arguments,IncludeScreenshot:args.include_screenshot===true,IncludeAccessibilityTree:args.include_accessibility_tree!==false,MaxElements:args.max_elements??256,MaxDepth:args.max_depth??20,MaxImageDimension:args.max_image_dimension??1280,Query:args.query};
}
export function resolveSideScreenDirectory(explicit,env=process.env) {
  const candidates=[explicit,env.SIDESCREEN_HOME,path.join(env.USERPROFILE||os.homedir(),'AgentTools','SideScreen'),path.join(env.LOCALAPPDATA||'', 'SideScreenTools')].filter(Boolean);
  const found=candidates.find(p=>existsSync(path.join(p,'SideScreen.Cua.exe')));
  if(explicit && found!==explicit)throw Error('Configured SideScreen helper is missing; correct its installed directory.');
  if(!found)throw Error('SideScreen helper not found. Install to a path visible to the interactive broker; packaged AppData paths can differ.');return found;
}
export function createSideScreenEngine({directory,run,env={},nativeFirst='auto'}={}) {
  let nativeReady=nativeFirst===true;
  let child,lines,pending,errors='';
  function stop(error) {pending?.reject(error);pending=undefined;lines?.close();lines=undefined;child?.kill();child=undefined;}
  async function executeRaw(request) {
    if(run)return run(request);
    if(!child) {
      child=spawn(path.join(resolveSideScreenDirectory(directory),'SideScreen.Cua.exe'),['--server'],{windowsHide:true,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
      const current=child;
      child.on('error',error=>{if(child===current)stop(error);});
      child.stdin.on('error',error=>{if(child===current)stop(error);});
      child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-2000);});
      child.on('close',()=>{if(child===current)stop(Error(errors||'SideScreen worker closed; outcome unknown. Observe before continuing.'));});
      lines=createInterface({input:child.stdout});
      lines.on('line',line=>{
        if(!pending)return;const call=pending;pending=undefined;
        try {if(Buffer.byteLength(line)>8*1024*1024)throw Error('SideScreen response too large');call.resolve(JSON.parse(line));}catch(error){call.reject(error);}
      });
    }
    return new Promise((resolve,reject)=>{
      if(pending)return reject(Error('Concurrent SideScreen call refused'));
      const timer=setTimeout(()=>stop(Error('SideScreen timed out; outcome unknown. Observe before continuing; never retry automatically.')),30000);
      pending={resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};
      child.stdin.write(JSON.stringify(request)+'\n');
    });
  }
  let tail=Promise.resolve();
  const execute=request=>{const result=tail.then(()=>executeRaw(request));tail=result.catch(()=>{});return result;};
  const observe=args=>execute(translateSideScreen('sidescreen_observe',{window_handle:args.window_handle,expected_display_id:args.expected_display_id,include_screenshot:args.include_screenshot===true}));
  const nativeObserve=args=>execute({Action:'NativeObserve',WindowHandle:args.window_handle,ExpectedDisplayId:args.expected_display_id});
  function nativeSupported(element,step) {
    const fields=Object.keys(step.arguments);
    return element?.sidescreen_route==='native-control-messages' && !element.sidescreen_text_refused &&
      (step.tool==='set_value' && element.actions?.includes('set_value') && fields.every(k=>k==='value') ||
       step.tool==='click' && element.actions?.some(a=>['invoke','toggle','select'].includes(a)) && fields.length===0);
  }
  function matching(observation,choice) {
    if(!choice || !Object.keys(choice).length)throw Error('Provide a label or role selector');
    return (observation.state?.elements||[]).filter(e=>(choice.label===undefined||e.label===choice.label)&&(choice.role===undefined||e.role===choice.role));
  }
  const handler=async request=>{
    if(request.method==='list')return {tools:sideScreenTools};
    if(request.method!=='call')throw Error('Unknown SideScreen method');
    const args=request.arguments||{},translated=translateSideScreen(request.tool,args);
    let result;
    if(request.tool==='sidescreen_find' || request.tool==='sidescreen_wait') {
      const deadline=Date.now()+(request.tool==='sidescreen_wait'?(args.timeout_ms??5000):0);
      while(true) {
        result=await observe(args);if(!result.ok)break;
        result.matches=matching(result,args.selector);result.matched=args.absent?result.matches.length===0:result.matches.length>0;
        result.state={...result.state,elements:result.matches};
        if(request.tool==='sidescreen_find'||result.matched)break;
        if(Date.now()>=deadline){result.ok=false;result.stop=true;result.error='Condition not met before deadline';break;}
        await new Promise(r=>setTimeout(r,250));
      }
    } else if(request.tool==='sidescreen_steps') {
      for(const step of args.steps)if(Object.keys(step.arguments).some(k=>['element_token','x','y'].includes(k)))throw Error('Steps resolve their own fresh token; pixel/token overrides refused');
      const receipts=[];
      let usedNative=false;
      let scope;
      const sameBatchWindow=before=>{if(!before.scope)return true;if(!scope)scope=before.scope;return JSON.stringify(scope)===JSON.stringify(before.scope);};
      for(const step of args.steps) {
        let before=nativeReady?await nativeObserve(args):await observe(args);
        if(!before.ok){result={...before,completed:receipts.length,receipts};break;}
        if(!sameBatchWindow(before)){result={ok:false,stop:true,error:'Window identity or geometry changed during steps; no input replayed',completed:receipts.length,receipts};break;}
        let matches=matching(before,step.selector);
        if(nativeReady && (matches.length!==1 || !nativeSupported(matches[0],step))) {
          before=await observe(args);
          if(!before.ok){result={...before,completed:receipts.length,receipts};break;}
          if(!sameBatchWindow(before)){result={ok:false,stop:true,error:'Window changed during backend preparation; no input dispatched',completed:receipts.length,receipts};break;}
          matches=matching(before,step.selector);
        }
        usedNative=before.backend==='native-control-messages';
        if(matches.length!==1){result={ok:false,stop:true,error:'Control missing or ambiguous; inspect again',completed:receipts.length,receipts,observation:before};break;}
        const receipt=await execute(translateSideScreen('sidescreen_act',{window_handle:args.window_handle,expected_display_id:args.expected_display_id,observation_id:before.observationId,tool:step.tool,arguments:{...step.arguments,element_token:matches[0].element_token}}));
        receipts.push(receipt);
        if(!receipt.ok||receipt.stop){result={ok:false,stop:true,completed:receipts.length,receipts};break;}
      }
      if(!result) {const observation=usedNative?await nativeObserve(args):await observe(args);result={ok:observation.ok,completed:receipts.length,receipts,observation};}
    } else {
      result=await execute(translated);
      if(request.tool==='sidescreen_status' && nativeFirst==='auto')nativeReady=result.nativeObservation===true;
      if(request.tool==='sidescreen_act_and_observe' && result.ok && !result.stop) {const observation=await observe(args);result={ok:observation.ok,receipt:result,observation};}
    }
    const content=[{type:'text',text:JSON.stringify(result)}],observation=result.observation||result;
    if(observation.ok && observation.screenshotPath)content.push({type:'image',mimeType:'image/png',data:readFileSync(observation.screenshotPath).toString('base64')});
    return {isError:result.ok===false,content};
  };
  handler.guard=async action=>{
    const before=await execute({Action:'FocusBegin'});
    if(!before.ok)throw Error(before.error||'Cannot monitor browser focus');
    let result,error;
    try{result=await action();}catch(e){error=e;}
    const after=await execute({Action:'FocusEnd',ObservationId:before.guardId});
    if(!after.ok)return {isError:true,content:[{type:'text',text:JSON.stringify({ok:false,stop:true,outcomeUnknown:true,error:'Foreground or keyboard focus changed. Stop and inspect; input was not replayed.',focus:after.focus})}]};
    if(error)throw error;
    return {...result,_meta:{...result._meta,focus:after.focus}};
  };
  // Private broker extension boundary; not an agent tool or global input escape.
  handler.scope=args=>execute({Action:'Scope',WindowHandle:args.window_handle,ExpectedDisplayId:args.expected_display_id});
  handler.chromeShield=binding=>runJson({command:path.join(resolveSideScreenDirectory(directory),'SideScreen.ChromeFocus.exe'),env},{WindowHandle:binding.target.window_handle,ExpectedDisplayId:binding.target.expected_display_id,ExpectedProcessId:binding.scoped.processId,ExpectedProcessStartTicks:binding.scoped.processStartTicks});
  handler.pointer=args=>execute({Action:'SideCursorAct',WindowHandle:args.window_handle,ExpectedDisplayId:args.expected_display_id,ObservationId:args.observation_id,Tool:args.operation,Arguments:{x:args.x,y:args.y,button:args.button||'left'}});
  handler.virtual=args=>execute({Action:'VirtualAct',WindowHandle:args.window_handle,ExpectedDisplayId:args.expected_display_id,ObservationId:args.observation_id,Tool:args.operation,Arguments:args.arguments,CursorId:args.cursor_id,CursorLabel:args.label});
  handler.release=(scope,cursorId)=>execute({Action:'VirtualRelease',WindowHandle:scope.windowHandle,ExpectedDisplayId:scope.displayId,ExpectedProcessId:scope.processId,ExpectedProcessStartTicks:scope.processStartTicks,CursorId:cursorId});
  handler.close=()=>stop(Error('SideScreen shutting down'));return handler;
}
