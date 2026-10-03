import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {createRegularChrome} from '../src/browser.mjs';

// Execute the shipped Playwright callbacks against a browser model with a
// separate human tab. Assertions concern effects, not generated source text.
function fixture({shared=false,wrongToken=false,zeroMetrics=false}={}) {
  let id=0,windowId=1;const pages=[],effects=[];
  const screen={x:-1920,y:0,width:1920,height:1080};
  const windows=new Map([[1,shared?{x:0,y:0,width:1400,height:940}:{x:-1880,y:40,width:1400,height:940}]]);
  let initial;
  const context={pages:()=>pages.filter(p=>!p.closed),newPage:async()=>make('about:blank',10,context.pages().find(p=>p.groupId===10)?.windowId||1)};
  function make(url,groupId,win=1,opener=null) {
    const p={id:++id,groupId,windowId:win,closed:false,document:{},url:()=>url,title:async()=>url,
      context:()=>context,opener:async()=>opener,close:async()=>{p.closed=true;effects.push(['close',p.id]);},
      goto:async next=>{if(next.includes('/fail'))throw Error('Navigation unknown');url=next;p.document={};effects.push(['navigate',p.id,next]);},
      locator:()=>({ariaSnapshot:async()=>'- heading "Test page"'}),
      evaluate:async(fn,arg)=>{
        const sandbox={...windows.get(p.windowId),screenX:windows.get(p.windowId).x,screenY:windows.get(p.windowId).y,outerWidth:windows.get(p.windowId).width,outerHeight:windows.get(p.windowId).height,window:p.document,crypto:webcrypto,TextEncoder,Uint8Array,setTimeout,
          localStorage:{getItem:()=>wrongToken?'other-profile-token':'profile-one-token'},
          chrome:{
            tabs:{get:async n=>pages.find(t=>t.id===n),getCurrent:async()=>p,query:async q=>pages.filter(t=>!t.closed&&Object.entries(q).every(([k,v])=>t[k]===v)),remove:async ids=>{for(const n of Array.isArray(ids)?ids:[ids]){const t=pages.find(t=>t.id===n);t.closed=true;}},update:async(n,patch)=>{effects.push(['tab-update',n,patch]);return pages.find(t=>t.id===n);}},
            debugger:{sendCommand:async({tabId},method,args)=>({result:{value:pages.find(t=>t.id===tabId).document[args.expression.replace('window.','')]}})},
            windows:{get:async n=>{const w=windows.get(n);return {left:w.x,top:w.y,width:w.width,height:w.height};},update:async(n,patch)=>{effects.push(['window-update',n,patch]);const w=windows.get(n);if(patch.left!==undefined)Object.assign(w,{x:patch.left,y:patch.top,width:patch.width,height:patch.height});},create:async options=>{effects.push(['window-create',options]);const n=++windowId;windows.set(n,{x:options.left,y:options.top,width:options.width,height:options.height});return {id:n,tabs:[make('about:blank',-1,n)]};}},
            tabGroups:{move:async(group,q)=>{effects.push(['group-move',group,q]);for(const t of pages)if(t.groupId===group)t.windowId=q.windowId;}}
          }};
        if(zeroMetrics)Object.assign(sandbox,{screenX:0,screenY:0,outerWidth:0,outerHeight:0});
        return vm.runInNewContext('('+fn.toString()+')',sandbox)(arg);
      }};
    pages.push(p);return p;
  }
  initial=make('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html',10);
  const human=make('https://human.example/private',-1);
  const browser=createRegularChrome({profile:'Profile 1',getScreen:async()=>screen,tokenHash:createHash('sha256').update('profile-one-token').digest('hex'),call:async(_,args)=>{
    const p=initial.closed?context.pages().find(p=>p.__museLinkControl)||human:initial;
    const value=await vm.runInNewContext('('+args.code+')',{crypto:webcrypto})(p);
    return {content:[{type:'text',text:'### Result\n'+JSON.stringify(value)}]};
  }});
  return {call:async(tool,args={})=>{const r=await browser({method:'call',tool,arguments:args});return JSON.parse(r.content[0].text);},pages,human,initial,windows,effects,screen};
}

test('recover into an inactive SideScreen window while the human window and tab stay unchanged',async()=>{
  const f=fixture({shared:true});const before=JSON.stringify(f.windows.get(1));
  const r=await f.call('chrome_ready');assert.equal(r.ready,true);assert.equal(r.profileTokenMatched,true);
  assert.equal(JSON.stringify(f.windows.get(1)),before);assert.equal(f.human.windowId,1);assert.equal(f.human.url(),'https://human.example/private');
  assert.equal(f.effects.find(e=>e[0]==='window-create')[1].focused,false);
  assert.ok(!r.tabs.some(t=>t.url.includes('human.example')));assert.ok(!f.effects.some(e=>e[0]==='window-update'));
});
test('a closed selected tab reports recovery and chrome_ready creates its replacement without adopting a human tab',async()=>{
  const f=fixture();const first=await f.call('chrome_ready');await f.call('open_url',{url:'https://agent.example/'});
  await f.call('close_tab',{tab_id:first.selected_tab});assert.equal((await f.call('chrome_status')).ready,false);
  await assert.rejects(f.call('snapshot'),/chrome_ready/);const next=await f.call('chrome_ready');assert.equal(next.ready,true);
  assert.equal(f.human.closed,false);assert.equal(f.human.__museLinkOwner,undefined);
  await assert.rejects(f.call('close_tab',{tab_id:'human'}),/Unknown bridge-owned/);
});
test('failed new-tab navigation keeps the previously selected tab and never repeats navigation',async()=>{
  const f=fixture();const first=await f.call('chrome_ready');await f.call('open_url',{url:'https://agent.example/'});
  await assert.rejects(f.call('open_url',{url:'https://agent.example/fail',new_tab:true}),/Navigation unknown/);
  assert.equal((await f.call('chrome_status')).selected_tab,first.selected_tab);
  assert.equal((await f.call('snapshot')).url,'https://agent.example/');
  assert.equal(f.effects.filter(e=>e[0]==='navigate'&&e[2]==='https://agent.example/').length,1);
});
test('profile-token mismatch refuses work without navigating an account website or leaking the token',async()=>{
  const f=fixture({wrongToken:true});await assert.rejects(f.call('chrome_ready'),e=>e.message.includes('token mismatch')&&!e.message.includes('other-profile-token'));
  assert.ok(!f.effects.some(e=>e[0]==='navigate'&&e[2].startsWith('https:')));
});
test('display topology changes refuse normal navigation and chrome_ready repairs only owned tabs',async()=>{
  const f=fixture();await f.call('chrome_ready');await f.call('open_url',{url:'https://agent.example/'});
  f.screen.x=-3840;assert.equal((await f.call('chrome_status')).ready,false);
  await assert.rejects(f.call('open_url',{url:'https://agent.example/next'}),/chrome_ready/);
  const ready=await f.call('chrome_ready');assert.equal(ready.ready,true);assert.equal(f.human.windowId,1);
  assert.ok(!f.effects.some(e=>e[0]==='navigate'&&e[2].endsWith('/next')));
});
test('an unowned tab dragged into the MCP group prevents relocation',async()=>{
  const f=fixture();await f.call('chrome_ready');await f.call('open_url',{url:'https://agent.example/'});
  f.human.groupId=10;f.screen.x=-3840;
  // A webpage can forge DOM state, but it cannot grant Node Page ownership.
  f.human.document.__museLinkOwner=f.initial.__museLinkOwner;
  await assert.rejects(f.call('chrome_ready'),/unowned tab/);assert.equal(f.human.windowId,1);
  assert.ok(!f.effects.some(e=>e[0]==='window-create'||e[0]==='window-update'));
});
test('inactive tab metrics cannot falsely report a missing screen and activation stays inside the agent window',async()=>{
  const f=fixture({zeroMetrics:true});assert.equal((await f.call('chrome_ready')).ready,true);
  const r=await f.call('open_url',{url:'https://agent.example/'});assert.equal(r.window.x,-1880);
  assert.equal((await f.call('chrome_status')).ready,true);
  assert.ok(f.effects.some(e=>e[0]==='tab-update'&&e[1]!==f.human.id&&e[2].active));
  assert.ok(!f.effects.some(e=>e[0].startsWith('window-')));
});
