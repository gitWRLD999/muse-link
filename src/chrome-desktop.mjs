import {randomUUID} from 'node:crypto';

const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
export const chromeDesktopTools=[
  {name:'chrome_desktop_observe',description:'See the whole owned Chrome window on SideScreen, including browser account bubbles and native controls outside webpage DOM. Returns an image and fresh CUA tokens. No window handle guessing or Chrome focus activation. An empty/unsupported tree is not permission for foreground input.',inputSchema:schema({include_screenshot:{type:'boolean'},max_elements:{type:'integer',minimum:1,maximum:512}})},
  {name:'chrome_desktop_act',description:'One background CUA action on the last observed owned Chrome window; verifies identity, active tab, geometry and focus, then returns fresh desktop state. Use returned controls for Chrome UI; webpage pixels use chrome_visual_act. Stops on unsupported native controls or unknown effects; never retries or borrows the human pointer.',inputSchema:schema({observation_id:{type:'string'},tool:{type:'string',enum:['click','set_value','type_text','scroll','press_key','hotkey']},arguments:{type:'object',additionalProperties:true}},['observation_id','tool','arguments'])}
];
const data=result=>JSON.parse(result.content.find(c=>c.type==='text').text);
export function matchChromeWindow(identity,windows) {
  if(!identity.windowOwned||!identity.activeOwned)throw Error('Desktop Chrome control requires an active owned tab and a window containing only bridge-owned tabs. Use select_tab/chrome_ready first.');
  const b=identity.window;
  const matches=windows.filter(w=>{
    const r=w.Bounds;
    return (w.Title===identity.title+' - Google Chrome'||w.Title===identity.title)&&
      ['X','Y','Width','Height'].every((k,i)=>Math.abs(r[k]-[b.x,b.y,b.width,b.height][i])<=2);
  });
  if(matches.length!==1)throw Error('Owned Chrome desktop window is missing or ambiguous. Observe again; do not choose another Chrome window.');
  return matches[0];
}
export function createChromeDesktop({identity,side,now=Date.now}) {
  const observations=new Map();
  async function bind() {
    const current=await identity(),status=data(await side({method:'call',tool:'sidescreen_status'}));
    if(!status.available||!status.ready)throw Error('SideScreen/CUA is unavailable.');
    const window=matchChromeWindow(current,data(await side({method:'call',tool:'sidescreen_windows'})).windows);
    const target={window_handle:window.Handle,expected_display_id:status.agentScreen.id};
    const scoped=await side.scope(target);if(!scoped.ok)throw Error(scoped.error||'Chrome desktop scope refused');
    return {identity:current,target,scoped};
  }
  const fingerprint=b=>JSON.stringify([b.identity.tab_id,b.identity.chrome_window_id,b.identity.url,b.identity.document,b.target,b.scoped.processId,b.scoped.processStartTicks,b.scoped.bounds]);
  async function observe(args={}) {
    const binding=await bind();
    const result=await side({method:'call',tool:'sidescreen_observe',arguments:{...binding.target,include_screenshot:args.include_screenshot!==false,max_elements:args.max_elements??256}});
    if(result.isError)return result;
    const after=await bind();if(fingerprint(after)!==fingerprint(binding))throw Error('Chrome document/window changed during desktop capture. Observe again.');
    const value=data(result),id=randomUUID();
    for(const [key,item] of observations)if(item.expires<now())observations.delete(key);
    if(observations.size>=64)observations.delete(observations.keys().next().value);
    observations.set(id,{binding,fingerprint:fingerprint(binding),driverId:value.observationId,expires:now()+120000});
    return {...result,content:[{type:'text',text:JSON.stringify({...value,observationId:id,route:'chrome-desktop-cua',profile:binding.identity.profile,tab_id:binding.identity.tab_id,limitations:'Background support depends on the control. Browser account UI is distinct from page DOM. No foreground or profile-switch fallback.'})},...result.content.filter(c=>c.type!=='text')]};
  }
  return async request=>{
    const args=request.arguments||{};
    if(request.tool==='chrome_desktop_observe')return observe(args);
    const item=observations.get(args.observation_id);observations.delete(args.observation_id);
    if(!item||item.expires<now())throw Error('Desktop observation expired or consumed. Observe again; no automatic replay.');
    if(fingerprint(await bind())!==item.fingerprint)throw Error('Chrome tab/window/display/process changed. Observe again.');
    if(!side.chromeShield)throw Error('Install the SideScreen Chrome activation guard before native browser input.');
    const shield=await side.chromeShield(item.binding);
    if(!shield.ok)throw Error(shield.error||'Chrome activation guard refused; no input dispatched.');
    const receipt=await side({method:'call',tool:'sidescreen_act',arguments:{...item.binding.target,observation_id:item.driverId,tool:args.tool,arguments:args.arguments}});
    if(receipt.isError)return receipt;
    const observed=await observe();
    return {...observed,content:[{type:'text',text:JSON.stringify({activationGuard:shield,receipt:data(receipt),observation:data(observed)})},...observed.content.filter(c=>c.type!=='text')]};
  };
}
