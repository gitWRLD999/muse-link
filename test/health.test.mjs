import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEngines} from '../src/engines.mjs';

test('rejected stale-display actions do not turn a healthy SideScreen probe into a dead engine',async()=>{
  let ready=true;
  const helper=async request=>{
    const data=request.tool==='sidescreen_status'
      ?{ok:true,available:true,ready,healthError:ready?null:'CUA connection closed'}
      :{ok:false,stop:true,error:'Agent display changed; query Status again.'};
    return {isError:data.ok===false,content:[{type:'text',text:JSON.stringify(data)}]};
  };
  helper.close=()=>{};
  const engines=createEngines({engines:{sidescreen:{kind:'sidescreen'},agent:{kind:'agent'}}},{sideScreenFactory:()=>helper});
  const call=tool=>engines.dispatch({engine:'agent',method:'call',tool,arguments:{}});
  await call('sidescreen_status');
  const checkedAt=engines.status().health.sidescreen.checkedAt;
  const refusal=await call('sidescreen_observe');assert.equal(refusal.isError,true);
  let health=engines.status().health.sidescreen;
  assert.equal(health.ready,true);assert.equal(health.ok,true);assert.equal(health.checkedAt,checkedAt);
  assert.equal(health.lastOperation.ok,false);assert.match(health.lastOperation.error,/display changed/);
  ready=false;await call('sidescreen_status');health=engines.status().health.sidescreen;
  assert.equal(health.ready,false);assert.match(health.error,/connection closed/);
  ready=true;await call('sidescreen_status');assert.equal(engines.status().health.sidescreen.ready,true);
  await engines.close();
});

test('an action without a readiness probe reports unknown health rather than inventing readiness',async()=>{
  const helper=async()=>({content:[{type:'text',text:'{"ok":true, "windows":[]}'}]});helper.close=()=>{};
  const engines=createEngines({engines:{sidescreen:{kind:'sidescreen'}}},{sideScreenFactory:()=>helper});
  await engines.dispatch({engine:'sidescreen',method:'call',tool:'sidescreen_windows'});
  const health=engines.status().health.sidescreen;
  assert.equal(health.ready,null);assert.equal(health.checkedAt,null);assert.equal(health.lastOperation.ok,true);
  await engines.close();
});
