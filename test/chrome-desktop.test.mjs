import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createChromeDesktop,matchChromeWindow} from '../src/chrome-desktop.mjs';

const chrome={tab_id:'owned',chrome_window_id:7,url:'http://localhost',document:'doc',profile:'Profile 1',title:'Fixture',activeOwned:true,windowOwned:true,window:{x:-1800,y:40,width:1200,height:900}};
const window={Handle:23,ProcessId:88,Title:'Fixture - Google Chrome',Bounds:{X:-1800,Y:40,Width:1200,Height:900}};
test('native Chrome binding refuses shared windows, inactive tabs and ambiguous identical windows',()=>{
  assert.equal(matchChromeWindow(chrome,[window]).Handle,23);
  assert.throws(()=>matchChromeWindow({...chrome,windowOwned:false},[window]),/bridge-owned/);
  assert.throws(()=>matchChromeWindow({...chrome,activeOwned:false},[window]),/active owned/);
  assert.throws(()=>matchChromeWindow(chrome,[window,{...window,Handle:24}]),/ambiguous/);
  assert.throws(()=>matchChromeWindow(chrome,[{...window,Title:'Human - Google Chrome'}]),/missing/);
});
function fixture() {
  let current=structuredClone(chrome),time=0;const effects=[];
  const result=j=>({content:[{type:'text',text:JSON.stringify(j)}]});
  const side=async r=>{
    if(r.tool==='sidescreen_status')return result({available:true,ready:true,agentScreen:{id:'display'}});
    if(r.tool==='sidescreen_windows')return result({windows:[window]});
    if(r.tool==='sidescreen_observe')return {content:[{type:'text',text:JSON.stringify({ok:true,observationId:'driver',state:{elements:[{element_token:'button',label:'Continue as Fixture'}]}})},{type:'image',data:'fixture',mimeType:'image/png'}]};
    effects.push(r);return result({ok:true,focus:{Preserved:true}});
  };
  side.scope=async()=>({ok:true,processId:88,processStartTicks:'100',bounds:window.Bounds});
  side.chromeShield=async()=>({ok:true});
  const handler=createChromeDesktop({side,identity:async()=>current,now:()=>time});
  return {effects,change:()=>current.tab_id='other',navigate:()=>current.document='new-document',expire:()=>time=120001,refuseShield:()=>side.chromeShield=async()=>({ok:false,error:'refused'}),call:async(tool,args={})=>handler({tool,arguments:args}),json:r=>JSON.parse(r.content[0].text)};
}
test('desktop actions bind to the observed owned tab and return a fresh screenshot',async()=>{
  const f=fixture(),obs=f.json(await f.call('chrome_desktop_observe'));
  const act=await f.call('chrome_desktop_act',{observation_id:obs.observationId,tool:'click',arguments:{element_token:'button'}});
  assert.equal(f.effects.length,1);assert.equal(f.effects[0].arguments.window_handle,23);
  assert.equal(f.effects[0].arguments.observation_id,'driver');assert.equal(act.content[1].type,'image');
  await assert.rejects(f.call('chrome_desktop_act',{observation_id:obs.observationId}),/consumed/);assert.equal(f.effects.length,1);
});
test('tab switches and expiry refuse native dispatch and consume the observation',async()=>{
  for(const mutate of ['change','navigate','expire']) {
    const f=fixture(),obs=f.json(await f.call('chrome_desktop_observe'));f[mutate]();
    await assert.rejects(f.call('chrome_desktop_act',{observation_id:obs.observationId}),/changed|expired/);
    assert.equal(f.effects.length,0);
  }
});
test('activation guard refusal prevents native input and consumes the observation',async()=>{
  const f=fixture(),obs=f.json(await f.call('chrome_desktop_observe'));f.refuseShield();
  await assert.rejects(f.call('chrome_desktop_act',{observation_id:obs.observationId,tool:'click',arguments:{element_token:'button'}}),/refused/);
  assert.equal(f.effects.length,0);
  await assert.rejects(f.call('chrome_desktop_act',{observation_id:obs.observationId}),/consumed/);
});
