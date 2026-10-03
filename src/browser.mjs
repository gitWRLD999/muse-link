import {randomUUID} from 'node:crypto';

const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const string={type:'string'},locator={role:string,name:string,selector:string};
const operation=object({action:{type:'string',enum:['click','fill','select','check','press','wait']},...locator,value:string,key:string,checked:{type:'boolean'}},['action']);
export const regularChromeTools=[
  {name:'chrome_ready',description:'Prepare or recover an agent window in the real regular Chrome profile on SideScreen. Shares existing accounts; never drags a human window or falls back to Patchright. Call first, and after a missing tab or changed display. Inspect stop/focus receipts before continuing.',inputSchema:object({})},
  {name:'chrome_status',description:'Inspect profile-token match, SideScreen bounds, readiness and recovery. A configured Chrome account does not prove a site is logged in. A profile is shared across windows and monitors.',inputSchema:object({})},
  {name:'open_url',description:'Open a webpage in the real regular Chrome profile’s agent window using existing sessions and DOM. Call chrome_ready first. Do not substitute a test/Patchright profile for account access.',inputSchema:object({url:string,new_tab:{type:'boolean'}},['url'])},
  {name:'list_tabs',description:'List bridge-owned tabs, including popups opened by those tabs. Human tabs are not adopted.',inputSchema:object({})},
  {name:'select_tab',description:'Select a bridge-owned tab without bringing Chrome to the foreground.',inputSchema:object({tab_id:string},['tab_id'])},
  {name:'close_tab',description:'Close one bridge-owned tab, never a human tab. Call chrome_ready to create another if the last agent tab was closed.',inputSchema:object({tab_id:string},['tab_id'])},
  {name:'snapshot',description:'Read a compact accessibility snapshot of the selected agent tab without focus activation.',inputSchema:object({max_chars:{type:'integer',minimum:500,maximum:24000}})},
  {name:'find',description:'Find DOM controls by role/name or CSS. Returns text, count and visibility; password values are never read.',inputSchema:object(locator)},
  {name:'act',description:'One DOM action on a unique control and fresh page state. Unknown outcomes are never retried. Sign-in/password/MFA/security barriers need human completion, not another profile.',inputSchema:operation},
  {name:'steps',description:'Up to 12 bounded DOM operations, freshly resolving each control. Stops on failure. Inspect resulting state to verify the authorized workflow.',inputSchema:object({steps:{type:'array',items:operation,minItems:1,maxItems:12}},['steps'])},
  {name:'screenshot',description:'Capture the selected agent tab without activating its window.',inputSchema:object({})}
];

export function redactBrowserSecrets(value) {
  if(typeof value==='string')return value.replace(/([?&](?:token|mcpRelayUrl)=)[^\s&)"\\]+/g,'$1[redacted]');
  if(Array.isArray(value))return value.map(redactBrowserSecrets);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redactBrowserSecrets(v)]));
  return value;
}
export function parseCodeResult(result) {
  const text=result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')||'';
  if(result.isError)throw Error(redactBrowserSecrets(text.split(/\n### Ran /)[0])||'Chrome tool failed; inspect before continuing.');
  const match=text.match(/### Result\s*\n([\s\S]*?)(?=\n### |$)/);
  if(!match)throw Error('Chrome returned no structured result; inspect before continuing.');
  return JSON.parse(match[1].trim());
}

export function createRegularChrome({call,profile,getScreen,getProfileInfo,tokenHash}) {
  const owner=randomUUID();let selected=randomUUID();
  async function run(body,{repair=false,inspection=false}={}) {
    const screen=getScreen?await getScreen():null;
    if(getScreen&&!screen)throw Error('SideScreen display unavailable; browser operation refused. Do not switch profiles.');
    const profileInfo=getProfileInfo?await getProfileInfo():{directory:profile||null,source:'configuration',siteLogin:'not-checked'};
    const code=`async (page) => {
      const context=page.context(),owner=${JSON.stringify(owner)},screen=${JSON.stringify(screen)};
      const owned=p=>p.__museLinkOwner===owner;
      const extension=p=>p.url().startsWith('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/');
      let target=context.pages().find(p=>owned(p)&&p.__museLinkTab===${JSON.stringify(selected)});
      if(!target&&!page.__museLinkOwner&&!page.__museLinkControl&&extension(page)) {
        target=page;target.__museLinkOwner=owner;target.__museLinkTab=${JSON.stringify(selected)};
      }
      // Only popups with an owned opener may join the owned-tab list.
      for(const p of context.pages())if(!p.__museLinkOwner&&!p.__museLinkControl) {
        const opener=await p.opener();if(opener&&owned(opener)){p.__museLinkOwner=owner;p.__museLinkTab=crypto.randomUUID();}
      }
      if(!target&&${repair}){target=await context.newPage();target.__museLinkOwner=owner;target.__museLinkTab=${JSON.stringify(selected)};}
      let controller=context.pages().find(p=>p.__museLinkControl===owner);
      const control=async()=>{
        if(!controller){controller=await context.newPage();controller.__museLinkControl=owner;await controller.goto('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/status.html');}
        return controller;
      };
      const geometry=async p=>{
        const c=await control();
        if(!p.__museLinkChromeId){
          const marker=p.__museLinkTab||('controller-'+owner);
          await p.evaluate(id=>{window.__museLinkGeometryId=id;},marker);
          p.__museLinkChromeId=await c.evaluate(async marker=>{
            for(let i=0;i<20;i++){
              const ownerTab=await chrome.tabs.getCurrent();const matches=[];
              if(ownerTab.groupId>=0)for(const t of await chrome.tabs.query({groupId:ownerTab.groupId})){
                try{const r=await chrome.debugger.sendCommand({tabId:t.id},'Runtime.evaluate',{expression:'window.__museLinkGeometryId',returnByValue:true});if(r.result?.value===marker)matches.push(t.id);}catch{}
              }
              if(matches.length===1)return matches[0];if(matches.length>1)throw Error('Agent tab identity is ambiguous');
              await new Promise(r=>setTimeout(r,100));
            }
            throw Error('Agent tab identity missing; inspect chrome_status');
          },marker);
        }
        // Inactive web tabs can report outerWidth/outerHeight=0. Read the
        // actual Chrome window for the verified tab instead of page JS.
        return c.evaluate(async id=>{const t=await chrome.tabs.get(id),w=await chrome.windows.get(t.windowId);return {x:w.left,y:w.top,width:w.width,height:w.height};},p.__museLinkChromeId);
      };
      const inside=box=>!screen||(box.width>0&&box.height>0&&box.x>=screen.x&&box.y>=screen.y&&box.x+box.width<=screen.x+screen.width&&box.y+box.height<=screen.y+screen.height);
      const scope=async(p=target,allowRepair=false)=>{
        if(!p)throw Error('Agent tab is gone. Call chrome_ready to open a new agent tab in the same profile; do not drag your main Chrome window.');
        if(!screen||inside(await geometry(p)))return;
        if(!allowRepair)throw Error('Agent window is outside current SideScreen bounds. Call chrome_ready; do not move a human window or switch profiles.');
        await control();
        const allowedTabIds=[];
        for(const member of context.pages())if(owned(member)||member===controller){await geometry(member);allowedTabIds.push(member.__museLinkChromeId);}
        await controller.evaluate(async ({screen,allowedTabIds})=>{
          let tab=await chrome.tabs.getCurrent();
          for(let i=0;tab.groupId<0&&i<20;i++){await new Promise(r=>setTimeout(r,100));tab=await chrome.tabs.getCurrent();}
          if(tab.groupId<0)throw Error('Agent group missing; refusing to move unrelated tabs');
          if((await chrome.tabs.query({groupId:tab.groupId})).some(t=>!allowedTabIds.includes(t.id)))throw Error('Agent group contains an unowned tab; refusing to move it');
          const destination={left:screen.x+40,top:screen.y+40,width:Math.min(1400,screen.width-80),height:Math.min(940,screen.height-80)};
          const windowTabs=await chrome.tabs.query({windowId:tab.windowId});
          if(windowTabs.every(t=>t.groupId===tab.groupId)) {
            await chrome.windows.update(tab.windowId,{state:'normal'});await chrome.windows.update(tab.windowId,destination);
          }else{
            // Move only the verified agent group; the human window stays put.
            const created=await chrome.windows.create({...destination,focused:false,type:'normal'});
            await chrome.tabGroups.move(tab.groupId,{windowId:created.id,index:0});
            const blanks=(created.tabs||[]).map(t=>t.id);if(blanks.length)await chrome.tabs.remove(blanks);
          }
        },{screen,allowedTabIds});
        if(!inside(await geometry(p)))throw Error('Agent placement could not be verified. Stop and inspect chrome_status.');
      };
      let tokenVerified=null;
      if(${JSON.stringify(tokenHash||null)}) {
        const c=await control();
        tokenVerified=await c.evaluate(async expected=>{
          const token=localStorage.getItem('auth-token');if(!token)return false;
          const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
          return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')===expected;
        },${JSON.stringify(tokenHash||null)});
        if(!tokenVerified)throw Error('Profile extension token mismatch. Stop; do not use another Chrome or automation profile.');
      }
      if(target&&(${repair}||extension(target)))await scope(target,true);
      else if(!${inspection})await scope();
      const tabs=async()=>Promise.all(context.pages().filter(p=>owned(p)).map(async p=>({tab_id:p.__museLinkTab,url:p.url(),title:await p.title(),window:await geometry(p)})));
      const status=async()=>({engine:'regular_chrome',profile:${JSON.stringify(profile||null)},profilePinned:${!!profile},profileEvidence:${JSON.stringify(profileInfo)},profileTokenMatched:tokenVerified,route:'playwright-extension',ready:!!target&&inside(await geometry(target)),agentScreen:screen,selected_tab:target?target.__museLinkTab:null,tabs:await tabs(),recovery:'chrome_ready',accountAccess:'Profile cookies are shared across windows. Do not move main Chrome or substitute Patchright. Site sign-in/password/MFA or a security block needs human completion.'});
      const state=async()=>({tab_id:target.__museLinkTab,url:target.url(),title:await target.title(),window:await geometry(target),snapshot:(await target.locator('body').ariaSnapshot({timeout:5000})).slice(0,12000)});
      const selectVisible=async()=>{
        await target.evaluate(id=>{window.__museLinkTabId=id;},target.__museLinkTab);const c=await control();
        const tabId=await c.evaluate(async id=>{
          let tab=await chrome.tabs.getCurrent();for(let i=0;tab.groupId<0&&i<20;i++){await new Promise(r=>setTimeout(r,100));tab=await chrome.tabs.getCurrent();}
          if(tab.groupId<0)throw Error('Agent group missing; refusing unrelated tabs');
          const matches=[];
          for(const t of await chrome.tabs.query({groupId:tab.groupId})){
            if(t.id===tab.id)continue;
            try{const r=await chrome.debugger.sendCommand({tabId:t.id},'Runtime.evaluate',{expression:'window.__museLinkTabId',returnByValue:true});if(r.result?.value===id)matches.push(t);}catch{}
          }
          if(matches.length!==1)throw Error('Agent tab missing or ambiguous');await chrome.tabs.update(matches[0].id,{active:true});return matches[0].id;
        },target.__museLinkTab);return {controller:c,tabId};
      };
      const resolve=step=>{
        if(!!step.selector===!!step.role)throw Error('Provide exactly one of role or selector.');
        return step.selector?target.locator(step.selector):target.getByRole(step.role,{name:step.name,exact:true});
      };
      const apply=async step=>{
        await scope();await selectVisible();const c=resolve(step);if(await c.count()!==1)throw Error('Target is missing or ambiguous; inspect again.');
        switch(step.action){
          case 'click':await c.click({timeout:5000});break;
          case 'fill':if(typeof step.value!=='string')throw Error('value is required');await c.fill(step.value,{timeout:5000});break;
          case 'select':await c.selectOption(step.value,{timeout:5000});break;
          case 'check':await c.setChecked(step.checked!==false,{timeout:5000});break;
          case 'press':await c.press(step.key,{timeout:5000});break;
          case 'wait':await c.waitFor({state:'visible',timeout:5000});break;
          default:throw Error('Unsupported action');
        }
      };
      ${body}
    }`;
    return parseCodeResult(await call('browser_run_code_unsafe',{code}));
  }
  return async request=>{
    if(request.method==='list')return {tools:regularChromeTools};
    let args=request.arguments||{},tool=request.tool;
    if(tool==='browser_navigate'){tool='open_url';args={url:args.url};}
    if(tool==='browser_snapshot'){tool='snapshot';args={};}
    if(tool==='browser_take_screenshot'){tool='screenshot';args={};}
    const schema=regularChromeTools.find(t=>t.name===tool)?.inputSchema;
    if(!schema)throw Error('Unknown regular Chrome tool. Use agent list for current schemas, then chrome_ready and open_url; old raw Playwright lists are obsolete.');
    if(Object.keys(args).some(k=>!Object.hasOwn(schema.properties,k)))throw Error('Unsupported Chrome arguments');
    for(const key of schema.required)if(!Object.hasOwn(args,key))throw Error(`Missing ${key}`);
    let result;
    if(tool==='chrome_ready'||tool==='chrome_status'||tool==='list_tabs')result=await run('return await status();',{repair:tool==='chrome_ready',inspection:true});
    else if(tool==='open_url'){
      const url=new URL(args.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Use an HTTP(S) URL without credentials');
      const next=args.new_tab?randomUUID():selected;
      result=await run(`${args.new_tab?`const p=await context.newPage();p.__museLinkOwner=owner;p.__museLinkTab=${JSON.stringify(next)};await scope(p);target=p;`:''}await selectVisible();await target.goto(${JSON.stringify(url.href)},{waitUntil:'domcontentloaded',timeout:30000});return await state();`);
      selected=next; // A failed creation/navigation retains the previous selection.
    }else if(tool==='select_tab'){
      result=await run(`const p=context.pages().find(p=>owned(p)&&p.__museLinkTab===${JSON.stringify(args.tab_id)});if(!p)throw Error('Unknown bridge-owned tab');await scope(p);target=p;await selectVisible();return await state();`,{inspection:true});selected=args.tab_id;
    }else if(tool==='close_tab')result=await run(`const p=context.pages().find(p=>owned(p)&&p.__museLinkTab===${JSON.stringify(args.tab_id)});if(!p)throw Error('Unknown bridge-owned tab');await scope(p);await p.close();return {ok:true,closed_tab:${JSON.stringify(args.tab_id)},recovery:'chrome_ready'};`,{inspection:true});
    else if(tool==='snapshot'){
      const max=args.max_chars??12000;if(!Number.isInteger(max)||max<500||max>24000)throw Error('max_chars must be 500..24000');
      result=await run(`return {...await state(),snapshot:(await target.locator('body').ariaSnapshot()).slice(0,${max})};`);
    }else if(tool==='find')result=await run(`const controls=resolve(${JSON.stringify(args)}),count=await controls.count();return {count,matches:await Promise.all(Array.from({length:Math.min(count,30)},async(_,i)=>{const c=controls.nth(i);return {index:i,text:(await c.innerText({timeout:3000}).catch(()=>'')).slice(0,500),visible:await c.isVisible()};}))};`);
    else if(tool==='act'||tool==='steps'){
      const steps=tool==='act'?[args]:args.steps;
      if(!Array.isArray(steps)||steps.length<1||steps.length>12)throw Error('Provide 1..12 steps');
      for(const step of steps)if(!step||Object.keys(step).some(k=>!Object.hasOwn(operation.properties,k))||!operation.properties.action.enum.includes(step.action))throw Error('Invalid operation');
      result=await run(`const receipts=[];for(const step of ${JSON.stringify(steps)}){try{await apply(step);receipts.push({action:step.action,ok:true});}catch(e){return {ok:false,stop:true,completed:receipts.length,error:e.message,receipts,state:await state().catch(()=>null)};}}return {ok:true,completed:receipts.length,receipts,state:await state()};`);
    }else if(tool==='screenshot'){
      const data=await run('const active=await selectVisible();return await active.controller.evaluate(id=>chrome.debugger.sendCommand({tabId:id},"Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false}),active.tabId);');
      return {content:[{type:'image',mimeType:'image/png',data:data.data}]};
    }
    return {isError:result?.ok===false,content:[{type:'text',text:JSON.stringify(redactBrowserSecrets(result))}]};
  };
}
