import {randomUUID} from 'node:crypto';
const schema=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const session={session_id:{type:'string',minLength:32,maxLength:32}};
const target={window_handle:{type:'integer',minimum:1},expected_display_id:{type:'string',minLength:1}};
const point=schema({x:{type:'number',minimum:0},y:{type:'number',minimum:0}});
const argumentsSchema=schema({element_token:{type:'string'},x:{type:'number',minimum:0},y:{type:'number',minimum:0},button:{type:'string',enum:['left','right','middle']},count:{type:'integer',minimum:1,maximum:2},points:{type:'array',minItems:2,maxItems:64,items:point},duration_ms:{type:'integer',minimum:0,maximum:1500},delta:{type:'integer',minimum:-12000,maximum:12000},axis:{type:'string',enum:['vertical','horizontal']},text:{type:'string',maxLength:32768},value:{type:'string',maxLength:32768},key:{type:'string',minLength:1,maxLength:32},modifiers:{type:'array',maxItems:2,items:{type:'string',enum:['Control','Shift']}}},[]);
const selector=schema({label:{type:'string',maxLength:256},role:{type:'string',maxLength:64}},[]);
const action={operation:{type:'string',enum:['move','click','drag','scroll','type','press','set_value','invoke','paste']},arguments:argumentsSchema};
const namedStep=schema({selector,operation:{type:'string',enum:['set_value','invoke','type','press','paste']},arguments:argumentsSchema},['selector','operation','arguments']);
export const sideUserTools=[
  {name:'sideuser_open',description:'Lease one fully contained SideScreen window to this MCP connection. Returns session ID and exact process identity; another agent cannot operate that window through Muse Link. Other app windows remain available. Give each agent a short visible cursor label.',inputSchema:schema({...target,label:{type:'string',minLength:1,maxLength:64}})},
  {name:'sideuser_observe',description:'Fresh CUA tree and optional screenshot for this agent window. Binds its one-use observation to the session. Capture pixels are required for pointer gestures. Prefer set_value/invoke for semantic controls.',inputSchema:schema({...session,include_screenshot:{type:'boolean'}},['session_id'])},
  {name:'sideuser_act',description:'One scoped virtual move/click/double-click/drag/wheel or native edit keyboard event, followed by fresh state. set_value/invoke use semantic CUA/native routes; paste types private clipboard text. Refuses global shortcuts. Stop on unknown outcome; no automatic input retry.',inputSchema:schema({...session,observation_id:{type:'string'},...action},['session_id','observation_id','operation','arguments'])},
  {name:'sideuser_run',description:'Up to 12 exact label/role steps, observed and uniquely resolved before each action. Stops on ambiguity or unknown outcome. A request_id is one-use per session, preventing duplicated macros after transport retries. No arbitrary code or global input.',inputSchema:schema({...session,request_id:{type:'string',minLength:1,maxLength:128},steps:{type:'array',minItems:1,maxItems:12,items:namedStep}})},
  {name:'sideuser_clipboard',description:'Get or set text in this session’s private clipboard. Does not read or change the Windows clipboard. Use paste with a fresh native Edit token; set_value for other supported controls.',inputSchema:schema({...session,text:{type:'string',maxLength:32768}},['session_id'])},
  {name:'sideuser_status',description:'Return sessions owned by this MCP connection, their scopes and lease lifetime. Desktop input is serialized; cursor, modifier state, observations and clipboard belong to each session.',inputSchema:schema({},[])},
  {name:'sideuser_close',description:'Release this connection’s window lease and virtual focus/capture state. Stops input; the app window stays open. Idle leases expire after five minutes; close when finished.',inputSchema:schema(session)}
];
const result=data=>({isError:data.ok===false,content:[{type:'text',text:JSON.stringify(data)}]});
const decode=reply=>JSON.parse(reply.content[0].text);
const client=request=>{if(!/^[a-f0-9-]{36}$/i.test(request.callerId||''))throw Error('A stable MCP connection caller ID is required for SideUser');return request.callerId;};
export function createSideUsers(side,{validate,sameScope,now=Date.now}={}) {
  const sessions=new Map(),leases=new Map();
  async function dispose(s) {
    sessions.delete(s.id);leases.delete(s.scope.windowHandle);s.clipboard='';s.observations.clear();
    try{const scope=await side.scope(s.target);if(sameScope(scope,s.scope))await side.release(scope,s.id);}catch{/* Expired root locks clear without global input. */}
  }
  async function expire(){for(const s of sessions.values())if(s.expires<=now())await dispose(s);}
  async function assertAccess(request) {
    await expire();const hwnd=request.arguments?.window_handle;if(!hwnd)return;
    const owner=leases.get(hwnd);if(owner&&owner.owner!==request.callerId)throw Error('Window is leased to another agent. Use a different SideScreen window.');
  }
  async function resolve(request) {
    await expire();const s=sessions.get(request.arguments.session_id);
    if(!s||s.owner!==client(request))throw Error('Session missing, expired or owned by another MCP connection. Open a new session.');
    const scope=await side.scope(s.target);if(!sameScope(scope,s.scope)){await dispose(s);throw Error('Window identity or geometry changed; lease closed. Observe and open a new session.');}
    s.expires=now()+300000;return s;
  }
  async function observe(s,image=false) {
    const reply=await side({method:'call',tool:'sidescreen_observe',arguments:{...s.target,include_screenshot:image}});
    const data=decode(reply);if(data.ok){s.observations.set(data.observationId,now()+120000);for(const [id,time]of s.observations)if(time<now())s.observations.delete(id);while(s.observations.size>16)s.observations.delete(s.observations.keys().next().value);}
    return reply;
  }
  async function act(s,args,withState=true) {
    const expiry=s.observations.get(args.observation_id);s.observations.delete(args.observation_id);
    if(!expiry||expiry<now())return {ok:false,stop:true,error:'Observation expired, consumed or not owned by this session. Observe again.'};
    let receipt;
    if(args.operation==='set_value'||args.operation==='invoke') {
      const tool=args.operation==='invoke'?'click':'set_value';
      const allowed=tool==='click'?['element_token']:['element_token','value'];if(Object.keys(args.arguments).some(k=>!allowed.includes(k)))throw Error('Semantic action fields are restricted');
      receipt=decode(await side({method:'call',tool:'sidescreen_act',arguments:{...s.target,observation_id:args.observation_id,tool,arguments:args.arguments}}));
    }else {
      const payload=args.operation==='paste'?{element_token:args.arguments.element_token,text:s.clipboard}:args.arguments;
      if(args.operation==='paste'&&(Object.keys(args.arguments).some(k=>k!=='element_token')||!payload.element_token))throw Error('Paste requires only a fresh native Edit token');
      receipt=await side.virtual({...s.target,observation_id:args.observation_id,operation:args.operation==='paste'?'type':args.operation,arguments:payload,cursor_id:s.id,label:s.label});
    }
    if(!receipt.ok||receipt.stop)return {...receipt,stop:true};
    if(!withState)return {ok:true,receipt};
    const observation=await observe(s);return {ok:decode(observation).ok,receipt,observation:decode(observation)};
  }
  async function handle(request) {
    const tool=sideUserTools.find(t=>t.name===request.tool);if(!tool)throw Error('Unknown SideUser tool');const args=request.arguments||{};validate(tool.inputSchema,args);
    const owner=client(request);await expire();
    if(request.tool==='sideuser_status')return result({ok:true,serialization:'one input operation at a time',sessions:[...sessions.values()].filter(s=>s.owner===owner).map(s=>({sessionId:s.id,label:s.label,scope:s.scope,expiresInSeconds:Math.max(0,Math.ceil((s.expires-now())/1000))}))});
    if(request.tool==='sideuser_open') {
      if(leases.has(args.window_handle))throw Error('Window already has a SideUser lease. Close it or choose another window.');
      if(sessions.size>=16)throw Error('At most 16 active SideUser sessions are supported');
      const scope=await side.scope(args);if(!scope.ok)return result(scope);
      if(leases.has(scope.windowHandle))throw Error('Window was leased while inspecting its scope');
      const id=randomUUID().replaceAll('-',''),s={id,owner,label:args.label,scope,target:{window_handle:args.window_handle,expected_display_id:args.expected_display_id},expires:now()+300000,clipboard:'',observations:new Map(),requests:new Set()};sessions.set(id,s);leases.set(scope.windowHandle,s);
      return result({ok:true,sessionId:id,label:s.label,scope,expiresInSeconds:300});
    }
    const s=await resolve(request);
    if(request.tool==='sideuser_observe')return observe(s,args.include_screenshot);
    if(request.tool==='sideuser_clipboard'){if(Object.hasOwn(args,'text'))s.clipboard=args.text;return result({ok:true,text:s.clipboard,private:true});}
    if(request.tool==='sideuser_close'){await dispose(s);return result({ok:true,closed:true});}
    if(request.tool==='sideuser_act')return result(await act(s,args));
    if(s.requests.has(args.request_id))return result({ok:false,stop:true,error:'Macro request_id already attempted; input is never replayed. Inspect the app.'});
    if(s.requests.size>=128)throw Error('Macro history is full; close and reopen the session');
    for(const step of args.steps)if(!Object.keys(step.selector).length||Object.keys(step.arguments).some(k=>['element_token','x','y','points'].includes(k)))throw Error('Macro steps require named selectors; token/pixel overrides are refused');
    s.requests.add(args.request_id);const receipts=[],deadline=now()+90000;
    for(const step of args.steps) {
      if(now()>=deadline)return result({ok:false,stop:true,completed:receipts.length,receipts,error:'Macro deadline reached; inspect before continuing'});
      if(!sameScope(s.scope,await side.scope(s.target)))return result({ok:false,stop:true,completed:receipts.length,error:'Window changed during macro'});
      const before=decode(await observe(s));if(!before.ok)return result({...before,completed:receipts.length});
      const matches=(before.state?.elements||[]).filter(e=>(step.selector.label===undefined||e.label===step.selector.label)&&(step.selector.role===undefined||e.role===step.selector.role));
      if(matches.length!==1)return result({ok:false,stop:true,completed:receipts.length,error:'Control missing or ambiguous; inspect again',observation:before});
      const receipt=await act(s,{observation_id:before.observationId,operation:step.operation,arguments:{...step.arguments,element_token:matches[0].element_token}},false);receipts.push(receipt.receipt||receipt);
      if(!receipt.ok||receipt.stop)return result({ok:false,stop:true,completed:receipts.length,receipts});
    }
    return result({ok:true,completed:receipts.length,receipts,observation:decode(await observe(s))});
  }
  return {handle,assertAccess,async close(){for(const s of [...sessions.values()])await dispose(s);}};
}
