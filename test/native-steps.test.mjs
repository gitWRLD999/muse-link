import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSideScreenEngine} from '../src/sidescreen-worker.mjs';
const args={window_handle:7,expected_display_id:'side',steps:[{selector:{label:'Counter',role:'Button'},tool:'click',arguments:{}}]};
const decoded=r=>JSON.parse(r.content[0].text);
test('native-first steps use freshly supported native controls without starting CUA',async()=>{
  const calls=[];let serial=0;
  const engine=createSideScreenEngine({nativeFirst:true,run:async r=>{
    calls.push(r);if(r.Action==='NativeObserve')return {ok:true,backend:'native-control-messages',observationId:`n${++serial}`,state:{elements:[{label:'Counter',role:'Button',element_token:`t${serial}`,actions:['invoke'],sidescreen_route:'native-control-messages'}]}};
    return {ok:true};
  }});
  assert.equal(decoded(await engine({method:'call',tool:'sidescreen_steps',arguments:args})).ok,true);
  assert.deepEqual(calls.map(c=>c.Action),['NativeObserve','CuaAct','NativeObserve']);
  assert.equal(calls[1].ObservationId,'n1');assert.equal(calls[1].Arguments.element_token,'t1');
});
test('unsupported native controls fall back only to a fresh CUA observation before dispatch',async()=>{
  const calls=[];const engine=createSideScreenEngine({nativeFirst:true,run:async r=>{
    calls.push(r);if(r.Action==='NativeObserve')return {ok:true,backend:'native-control-messages',state:{elements:[{label:'Counter',role:'Button',actions:[],sidescreen_route:'native-control-messages'}]}};
    if(r.Action==='CuaObserve')return {ok:true,backend:'cua-driver',observationId:'cua',state:{elements:[{label:'Counter',role:'Button',element_token:'fresh-cua'}]}};
    return {ok:false,stop:true};
  }});
  const result=decoded(await engine({method:'call',tool:'sidescreen_steps',arguments:args}));
  assert.equal(result.ok,false);assert.deepEqual(calls.map(c=>c.Action),['NativeObserve','CuaObserve','CuaAct']);
  assert.equal(calls[2].Arguments.element_token,'fresh-cua');
});
test('native scope refusal does not attempt another backend',async()=>{
  const calls=[];const engine=createSideScreenEngine({nativeFirst:true,run:async r=>{calls.push(r);return {ok:false,stop:true,error:'Wrong display'};}});
  assert.equal(decoded(await engine({method:'call',tool:'sidescreen_steps',arguments:args})).completed,0);
  assert.equal(calls.length,1);
});
test('auto mode requires advertised helper capability and supports older helpers',async()=>{
  for(const enabled of [false,true]) {
    const calls=[];const engine=createSideScreenEngine({run:async r=>{
      calls.push(r);if(r.Action==='Status')return {ok:true,nativeObservation:enabled};
      return {ok:false,stop:true};
    }});
    await engine({method:'call',tool:'sidescreen_status',arguments:{}});
    await engine({method:'call',tool:'sidescreen_steps',arguments:args});
    assert.equal(calls[1].Action,enabled?'NativeObserve':'CuaObserve');
  }
});
