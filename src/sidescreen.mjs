import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const target={window_handle:{type:'integer',minimum:1},expected_display_id:{type:'string',minLength:1}};
export const sideScreenTools=[
  {name:'sidescreen_status',description:'Discover the current SideScreen virtual display and optional CUA installation. inputIsolation=false: this host shares Windows focus. Observe and act only on this virtual display.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'sidescreen_windows',description:'List visible windows on SideScreen. Observation additionally requires full containment. Never invent a handle.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'sidescreen_observe',description:'Get CUA accessibility tokens and a window screenshot on SideScreen. This inspection expires after two minutes and allows one action attempt. Default includes an image. Observe again after each action/refusal.',inputSchema:{type:'object',properties:{...target,include_screenshot:{type:'boolean'}},required:Object.keys(target),additionalProperties:false}},
  {name:'sidescreen_act',description:'One observed background action confined to SideScreen. Foreground/desktop/global input is refused. Classic native edits use SideScreen messages; CUA routes are experimental. Check focus, stop, and driver.effect; a successful dispatch is not proof the task succeeded. Reobserve after the action. Never retry an unknown outcome.',inputSchema:{type:'object',properties:{...target,observation_id:{type:'string',minLength:1},tool:{type:'string',enum:['click','set_value','type_text','scroll','press_key','hotkey']},arguments:{type:'object',properties:{element_token:{type:'string'},x:{type:'number'},y:{type:'number'},button:{type:'string',enum:['left','right','middle']},count:{type:'integer',minimum:1,maximum:3},action:{type:'string',enum:['expand']},value:{type:'string'},text:{type:'string'},delay_ms:{type:'integer',minimum:0,maximum:200},direction:{type:'string',enum:['up','down','left','right']},amount:{type:'integer'},key:{type:'string'},modifiers:{type:'array',items:{type:'string'}},keys:{type:'array',items:{type:'string'}}},additionalProperties:false}},required:[...Object.keys(target),'observation_id','tool','arguments'],additionalProperties:false}}
];

export function translateSideScreen(tool,args={}) {
  const schema=sideScreenTools.find(t=>t.name===tool)?.inputSchema;
  if(!schema)throw Error('Unknown SideScreen tool');
  if(!args || typeof args!=='object' || Array.isArray(args) || Object.keys(args).some(k=>!Object.hasOwn(schema.properties,k)))throw Error('Unsupported SideScreen arguments');
  for(const key of schema.required || [])if(!Object.hasOwn(args,key))throw Error(`Missing ${key}`);
  const Action={sidescreen_status:'Status',sidescreen_windows:'Windows',sidescreen_observe:'CuaObserve',sidescreen_act:'CuaAct'}[tool];
  return {Action,WindowHandle:args.window_handle || 0,ExpectedDisplayId:args.expected_display_id,ObservationId:args.observation_id,Tool:args.tool,Arguments:args.arguments,IncludeScreenshot:args.include_screenshot!==false};
}

export function createSideScreenEngine({directory=process.env.SIDESCREEN_HOME || path.join(process.env.LOCALAPPDATA || '', 'SideScreenTools'),run}={}) {
  async function execute(request) {
    if(run)return run(request);
    return new Promise((resolve,reject)=>{
      const child=spawn(path.join(directory,'SideScreen.Cua.exe'),[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      let output='',errors='',settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
      const timer=setTimeout(()=>{child.kill();finish(Error('SideScreen timed out; outcome unknown. Observe before continuing; never retry automatically.'));},30000);
      child.on('error',error=>finish(error));child.stdin.on('error',error=>finish(error));
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>8*1024*1024){child.kill();finish(Error('SideScreen response too large; observe before continuing.'));}});
      child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-4000);});
      child.on('close',()=>{try{finish(null,JSON.parse(output));}catch{finish(Error(errors || 'Invalid SideScreen response; outcome unknown.'));}});
      child.stdin.end(JSON.stringify(request));
    });
  }
  return async request=>{
    if(request.method==='list')return {tools:sideScreenTools};
    if(request.method!=='call')throw Error('Unknown SideScreen method');
    const result=await execute(translateSideScreen(request.tool,request.arguments));
    const content=[{type:'text',text:JSON.stringify(result)}];
    if(result.ok && result.screenshotPath)content.push({type:'image',mimeType:'image/png',data:readFileSync(result.screenshotPath).toString('base64')});
    return {isError:result.ok===false,content,structuredContent:result};
  };
}
