import {randomUUID} from 'node:crypto';

const object = (properties, required = []) => ({type: 'object', properties, required, additionalProperties: false});
const string = {type: 'string'};
const locator = {role: string, name: string, selector: string};
const operation = object({action: {type: 'string', enum: ['click', 'fill', 'select', 'check', 'press', 'wait']}, ...locator, value: string, key: string, checked: {type: 'boolean'}}, ['action']);
export const regularChromeTools = [
  {name: 'chrome_status', description: 'Show the explicitly configured regular Chrome profile and agent-owned tabs. Never switches to an isolated browser.', inputSchema: object({})},
  {name: 'open_url', description: 'Navigate the agent tab in regular signed-in Chrome directly. Uses browser DOM, never the global mouse or address bar. Returns compact page state.', inputSchema: object({url: string, new_tab: {type: 'boolean'}}, ['url'])},
  {name: 'list_tabs', description: 'List this connection\'s agent-owned tabs in regular Chrome.', inputSchema: object({})},
  {name: 'select_tab', description: 'Select an agent-owned tab for tools without bringing Chrome to the foreground.', inputSchema: object({tab_id: string}, ['tab_id'])},
  {name: 'snapshot', description: 'Read a compact accessibility snapshot of the selected agent tab. No screenshot or focus activation.', inputSchema: object({max_chars: {type: 'integer', minimum: 500, maximum: 24000}})},
  {name: 'find', description: 'Find DOM controls by role/name or CSS in the selected agent tab. Returns text, count and visibility; password values are never read.', inputSchema: object(locator)},
  {name: 'act', description: 'One browser DOM action on a unique control, followed by fresh page state. A failed or unknown action is never retried.', inputSchema: operation},
  {name: 'steps', description: 'Execute up to 12 bounded DOM operations locally, re-resolving each target. Stops on the first failure and returns fresh state. Use for a known form or workflow.', inputSchema: object({steps: {type: 'array', items: operation, minItems: 1, maxItems: 12}}, ['steps'])},
  {name: 'screenshot', description: 'Capture the selected agent tab, without activating its window.', inputSchema: object({})}
];

export function redactBrowserSecrets(value) {
  if (typeof value === 'string') return value.replace(/([?&](?:token|mcpRelayUrl)=)[^\s&)"\\]+/g, '$1[redacted]');
  if (Array.isArray(value)) return value.map(redactBrowserSecrets);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactBrowserSecrets(v)]));
  return value;
}
export function parseCodeResult(result) {
  if (result.isError) {
    const text=result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n')||'';
    throw Error(redactBrowserSecrets(text.split(/\n### Ran /)[0]) || 'Chrome tool failed; inspect before continuing.');
  }
  const text = result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
  const match = text.match(/### Result\s*\n([\s\S]*?)(?=\n### |$)/);
  if (!match) throw Error('Chrome returned no structured result; inspect before continuing.');
  return JSON.parse(match[1].trim());
}

export function createRegularChrome({call, profile, getScreen}) {
  let selected = randomUUID();
  async function run(body) {
    const screen=getScreen?await getScreen():null;
    if(getScreen && !screen)throw Error('SideScreen display unavailable; browser operation refused');
    const code = `async (page) => {
      const context = page.context();
      let target = context.pages().find(p => p.__museLinkTab === ${JSON.stringify(selected)});
      if (!target) {
        if (!page.__museLinkTab && page.url().startsWith('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/')) {
          target = page; target.__museLinkTab = ${JSON.stringify(selected)};
        } else throw new Error('Agent tab is gone. Use open_url with new_tab:true; no human tab will be reused.');
      }
      const geometry=()=>target.evaluate(()=>({x:screenX,y:screenY,width:outerWidth,height:outerHeight}));
      const scope=async()=>{
        const screen=${JSON.stringify(screen)};if(!screen)return;
        const inside=box=>box.width>0&&box.height>0&&box.x>=screen.x&&box.y>=screen.y&&box.x+box.width<=screen.x+screen.width&&box.y+box.height<=screen.y+screen.height;
        let box=await geometry();
        if(!inside(box) && target.url().startsWith('chrome-extension://') && !target.__museLinkPlaced) {
          await target.evaluate(async screen=>{
            const tab=await chrome.tabs.getCurrent(),tabs=await chrome.tabs.query({windowId:tab.windowId});
            if(tabs.some(t=>t.id!==tab.id&&(tab.groupId<0||t.groupId!==tab.groupId)))throw new Error('Refusing to move a window containing unrelated tabs');
            await chrome.windows.update(tab.windowId,{state:'normal'});
            await chrome.windows.update(tab.windowId,{left:screen.x+40,top:screen.y+40,width:Math.min(1400,screen.width-80),height:Math.min(940,screen.height-80)});
          },screen);
          target.__museLinkPlaced=true;box=await geometry();
        }
        if(!inside(box))throw new Error('Agent browser window must remain fully inside SideScreen.');
      };
      await scope();
      const state = async () => ({tab_id: target.__museLinkTab, url: target.url(), title: await target.title(),window:await geometry(), snapshot: (await target.locator('body').ariaSnapshot({timeout: 5000})).slice(0, 12000)});
      const selectVisible = async () => {
        await target.evaluate(id=>{window.__museLinkTabId=id;},target.__museLinkTab);
        let controller=context.pages().find(p=>p.__museLinkControl);
        if(!controller) {
          controller=await context.newPage();controller.__museLinkControl=true;
          await controller.goto('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/status.html');
        }
        const tabId=await controller.evaluate(async id=>{
          let owner=await chrome.tabs.getCurrent();
          for(let attempt=0;owner.groupId<0 && attempt<20;attempt++){await new Promise(r=>setTimeout(r,100));owner=await chrome.tabs.getCurrent();}
          if(owner.groupId<0)throw new Error('Agent tab group missing; refusing unrelated tabs');
          const matches=[];
          for(const tab of await chrome.tabs.query({groupId:owner.groupId})) {
            if(tab.id===owner.id)continue;
            try {
              const result=await chrome.debugger.sendCommand({tabId:tab.id},'Runtime.evaluate',{expression:'window.__museLinkTabId',returnByValue:true});
              if(result.result?.value===id)matches.push(tab);
            }catch{}
          }
          if(matches.length!==1)throw new Error('Agent tab missing or ambiguous');
          await chrome.tabs.update(matches[0].id,{active:true});
          return matches[0].id;
        },target.__museLinkTab);
        return {controller,tabId};
      };
      const resolve = (step) => {
        if (!!step.selector === !!step.role) throw new Error('Provide exactly one of role or selector.');
        return step.selector ? target.locator(step.selector) : target.getByRole(step.role, {name: step.name, exact: true});
      };
      const apply = async (step) => {
        await scope();
        const control = resolve(step);
        if (await control.count() !== 1) throw new Error('Target is missing or ambiguous; inspect again.');
        switch (step.action) {
          case 'click': await control.click({timeout: 5000}); break;
          case 'fill': if (typeof step.value !== 'string') throw new Error('value is required'); await control.fill(step.value, {timeout: 5000}); break;
          case 'select': await control.selectOption(step.value, {timeout: 5000}); break;
          case 'check': await control.setChecked(step.checked !== false, {timeout: 5000}); break;
          case 'press': await control.press(step.key, {timeout: 5000}); break;
          case 'wait': await control.waitFor({state: 'visible', timeout: 5000}); break;
          default: throw new Error('Unsupported action');
        }
      };
      ${body}
    }`;
    return parseCodeResult(await call('browser_run_code_unsafe', {code}));
  }
  return async request => {
    if (request.method === 'list') return {tools: regularChromeTools};
    let args = request.arguments || {}, tool = request.tool;
    if(tool==='browser_navigate'){tool='open_url';args={url:args.url};}
    if(tool==='browser_snapshot'){tool='snapshot';args={};}
    if(tool==='browser_take_screenshot'){tool='screenshot';args={};}
    const schema = regularChromeTools.find(t => t.name === tool)?.inputSchema;
    if (!schema) throw Error('Unknown regular Chrome tool');
    if (Object.keys(args).some(k => !Object.hasOwn(schema.properties, k))) throw Error('Unsupported Chrome arguments');
    for (const key of schema.required) if (!Object.hasOwn(args, key)) throw Error(`Missing ${key}`);
    let result;
    if (tool === 'open_url') {
      const url = new URL(args.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('Use an HTTP(S) URL without credentials');
      if (args.new_tab) {
        selected = randomUUID();
        const screen=getScreen?await getScreen():null;if(getScreen&&!screen)throw Error('SideScreen unavailable');
        const code = `async (page) => { const p=await page.context().newPage(); p.__museLinkTab=${JSON.stringify(selected)};const screen=${JSON.stringify(screen)};const box=await p.evaluate(()=>({x:screenX,y:screenY,width:outerWidth,height:outerHeight}));if(screen&&(box.x<screen.x||box.y<screen.y||box.x+box.width>screen.x+screen.width||box.y+box.height>screen.y+screen.height))throw new Error('Agent browser window must remain inside SideScreen'); await p.goto(${JSON.stringify(url.href)}, {waitUntil:'domcontentloaded',timeout:30000}); return {tab_id:p.__museLinkTab,url:p.url(),title:await p.title(),window:box,snapshot:(await p.locator('body').ariaSnapshot()).slice(0,12000)}; }`;
        result = parseCodeResult(await call('browser_run_code_unsafe', {code}));
      } else result = await run(`await target.goto(${JSON.stringify(url.href)}, {waitUntil:'domcontentloaded',timeout:30000}); return await state();`);
    } else if (tool === 'chrome_status' || tool === 'list_tabs') {
      result = await run(`return {engine:'regular_chrome',profile:${JSON.stringify(profile || null)},profilePinned:${!!profile},route:'playwright-extension',selected_tab:${JSON.stringify(selected)},tabs:await Promise.all(context.pages().filter(p=>p.__museLinkTab).map(async p=>({tab_id:p.__museLinkTab,url:p.url(),title:await p.title()})))};`);
    } else if (tool === 'select_tab') {
      const found = await run(`return context.pages().some(p=>p.__museLinkTab===${JSON.stringify(args.tab_id)});`);
      if (!found) throw Error('Unknown agent-owned tab'); selected = args.tab_id;
      result = await run('await selectVisible(); return await state();');
    } else if (tool === 'snapshot') {
      const max = args.max_chars ?? 12000;
      if (!Number.isInteger(max) || max < 500 || max > 24000) throw Error('max_chars must be 500..24000');
      result = await run(`return {...await state(),snapshot:(await target.locator('body').ariaSnapshot()).slice(0,${max})};`);
    } else if (tool === 'find') {
      result = await run(`const controls=resolve(${JSON.stringify(args)}); const count=await controls.count(); return {count,matches:await Promise.all(Array.from({length:Math.min(count,30)},async(_,i)=>{const c=controls.nth(i);return {index:i,text:(await c.innerText({timeout:3000}).catch(()=>'' )).slice(0,500),visible:await c.isVisible()};}))};`);
    } else if (tool === 'act' || tool === 'steps') {
      const steps = tool === 'act' ? [args] : args.steps;
      if (!Array.isArray(steps) || steps.length < 1 || steps.length > 12) throw Error('Provide 1..12 steps');
      for (const step of steps) if (!step || Object.keys(step).some(k => !Object.hasOwn(operation.properties, k)) || !operation.properties.action.enum.includes(step.action)) throw Error('Invalid operation');
      result = await run(`const receipts=[]; for(const step of ${JSON.stringify(steps)}) {try {await apply(step);receipts.push({action:step.action,ok:true});} catch(e){return {ok:false,stop:true,completed:receipts.length,error:e.message,receipts,state:await state().catch(()=>null)};}} return {ok:true,completed:receipts.length,receipts,state:await state()};`);
    } else if (tool === 'screenshot') {
      const data = await run('const active=await selectVisible(); return await active.controller.evaluate(id=>chrome.debugger.sendCommand({tabId:id},"Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false}),active.tabId);');
      return {content: [{type:'image', mimeType:'image/png', data:data.data}]};
    }
    result = redactBrowserSecrets(result);
    return {isError: result?.ok === false, content: [{type:'text', text:JSON.stringify(result)}]};
  };
}
