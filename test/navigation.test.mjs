import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRegularChrome,parseCodeResult,redactBrowserSecrets} from '../src/browser.mjs';
import {createSideScreenEngine,translateSideScreen} from '../src/sidescreen.mjs';

test('connection tokens and relay addresses are redacted recursively',()=>{
  const result=redactBrowserSecrets({content:[{text:'chrome-extension://id/connect.html?token=secret&mcpRelayUrl=ws%3A%2F%2Flocalhost'}]});
  assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('ws%3A'));
});
test('browser failures never echo generated code or form values',()=>{
  assert.throws(()=>parseCodeResult({isError:true,content:[{type:'text',text:'### Error\nTarget closed\n### Ran Playwright code\nfill("private-password")'}]}),error=>error.message.includes('Target closed')&&!error.message.includes('private-password'));
});
test('navigation refuses file URLs before any browser call',async()=>{
  let calls=0;const browser=createRegularChrome({profile:'Profile 1',call:async()=>{calls++;}});
  await assert.rejects(browser({method:'call',tool:'open_url',arguments:{url:'file:///C:/private'}}),/HTTP/);assert.equal(calls,0);
});
test('named desktop steps observe afresh, stop on failed dispatch, and never retry',async()=>{
  const calls=[];let observations=0,actions=0;
  const engine=createSideScreenEngine({run:async request=>{
    calls.push(request);
    if(request.Action==='CuaObserve'){observations++;return {ok:true,observationId:`obs${observations}`,state:{elements:[{element_token:`token${observations}`,label:'Counter',role:'Button'}]}};}
    actions++;return {ok:actions!==2,stop:actions===2};
  }});
  const step={selector:{label:'Counter',role:'Button'},tool:'click',arguments:{}};
  const result=JSON.parse((await engine({method:'call',tool:'sidescreen_steps',arguments:{window_handle:7,expected_display_id:'screen',steps:[step,step,step]}})).content[0].text);
  assert.equal(result.ok,false);assert.equal(actions,2);assert.equal(observations,2);
  assert.deepEqual(calls.filter(c=>c.Action==='CuaAct').map(c=>[c.ObservationId,c.Arguments.element_token]),[['obs1','token1'],['obs2','token2']]);
});
test('batch token injection is rejected before dispatch and bounds are validated',async()=>{
  let calls=0;const engine=createSideScreenEngine({run:async()=>{calls++;return {ok:true};}});
  await assert.rejects(engine({method:'call',tool:'sidescreen_steps',arguments:{window_handle:7,expected_display_id:'screen',steps:[{selector:{label:'Counter'},tool:'click',arguments:{element_token:'stale'}}]}}),/overrides/);
  assert.equal(calls,0);
  assert.throws(()=>translateSideScreen('sidescreen_observe',{window_handle:7,expected_display_id:'screen',max_elements:513}));
  assert.throws(()=>translateSideScreen('sidescreen_act',{window_handle:7,expected_display_id:'screen',observation_id:'obs',tool:'click',arguments:{delivery_mode:'foreground'}}));
});
