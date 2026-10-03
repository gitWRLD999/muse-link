import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSideUsers,sideUserTools} from '../src/sideusers.mjs';
import {validate,sameScope} from '../src/assist.mjs';
import {engineForTool} from '../src/engines.mjs';
const decode=r=>JSON.parse(r.content[0].text);
function setup(){let time=0,changed=false,operations=[];const owner=randomUUID(),other=randomUUID();const scope={ok:true,windowHandle:7,processId:9,processStartTicks:'123',displayId:'side',bounds:{X:0,Y:0,Width:800,Height:600}};
  const side=async r=>{operations.push(r);return {content:[{type:'text',text:JSON.stringify(r.tool==='sidescreen_observe'?{ok:true,observationId:randomUUID(),state:{elements:[{element_token:'fresh',label:'Text',role:'Edit'}]}}:{ok:true})}]};};
  side.scope=async()=>changed?{...scope,processStartTicks:'456'}:scope;side.release=async()=>{operations.push({release:true});return {ok:true};};side.virtual=async r=>{operations.push(r);return {ok:true};};
  const users=createSideUsers(side,{validate,sameScope,now:()=>time});const call=async(tool,args={},callerId=owner)=>decode(await users.handle({method:'call',tool,arguments:args,callerId}));
  return {users,call,owner,other,operations,advance:()=>{time+=300001;},replace:()=>{changed=true;}};
}
test('SideUser leases enforce connection ownership, including legacy desktop calls',async()=>{
  const h=setup();const s=await h.call('sideuser_open',{window_handle:7,expected_display_id:'side',label:'Muse'});
  await assert.rejects(h.call('sideuser_open',{window_handle:7,expected_display_id:'side',label:'Other'},h.other));
  await assert.rejects(h.call('sideuser_observe',{session_id:s.sessionId},h.other));
  await assert.rejects(h.users.assertAccess({arguments:{window_handle:7},callerId:h.other}));
  await h.users.assertAccess({arguments:{window_handle:7},callerId:h.owner});
  assert.equal((await h.call('sideuser_status',{},h.other)).sessions.length,0);
});
test('observations are consumed once and virtual input uses the session cursor',async()=>{
  const h=setup(),s=await h.call('sideuser_open',{window_handle:7,expected_display_id:'side',label:'Muse'}),o=await h.call('sideuser_observe',{session_id:s.sessionId});
  const a={session_id:s.sessionId,observation_id:o.observationId,operation:'type',arguments:{element_token:'fresh',text:'Hello'}};
  assert.equal((await h.call('sideuser_act',a)).ok,true);assert.equal((await h.call('sideuser_act',a)).ok,false);
  const virtual=h.operations.filter(r=>r.operation);assert.equal(virtual.length,1);assert.equal(virtual[0].cursor_id,s.sessionId);
});
test('private clipboard and paste do not access the OS clipboard',async()=>{
  const h=setup(),s=await h.call('sideuser_open',{window_handle:7,expected_display_id:'side',label:'Muse'});
  await h.call('sideuser_clipboard',{session_id:s.sessionId,text:'Private café'});const o=await h.call('sideuser_observe',{session_id:s.sessionId});
  await h.call('sideuser_act',{session_id:s.sessionId,observation_id:o.observationId,operation:'paste',arguments:{element_token:'fresh'}});
  assert.equal(h.operations.find(r=>r.operation)?.arguments.text,'Private café');
  assert.equal((await h.call('sideuser_clipboard',{session_id:s.sessionId})).private,true);
});
test('macro duplicate IDs never replay and selectors stay freshly grounded',async()=>{
  const h=setup(),s=await h.call('sideuser_open',{window_handle:7,expected_display_id:'side',label:'Muse'});
  const a={session_id:s.sessionId,request_id:'once',steps:[{selector:{label:'Text',role:'Edit'},operation:'set_value',arguments:{value:'hello'}}]};
  assert.equal((await h.call('sideuser_run',a)).completed,1);assert.equal((await h.call('sideuser_run',a)).ok,false);
  assert.equal(h.operations.filter(r=>r.tool==='sidescreen_act').length,1);
});
test('lease expiry releases scope while process replacement refuses injection',async()=>{
  const h=setup(),s=await h.call('sideuser_open',{window_handle:7,expected_display_id:'side',label:'Muse'});h.advance();await assert.rejects(h.call('sideuser_observe',{session_id:s.sessionId}));assert.ok(h.operations.some(o=>o.release));
  const g=setup(),v=await g.call('sideuser_open',{window_handle:7,expected_display_id:'side',label:'Muse'});g.replace();await assert.rejects(g.call('sideuser_observe',{session_id:v.sessionId}));assert.ok(!g.operations.some(o=>o.release));
});
test('new tools route to assistance and reject arbitrary fields',async()=>{
  const config={engines:{agent:{kind:'agent',assist:'apps'}}};for(const t of sideUserTools)assert.equal(engineForTool(config,{engine:'agent',tool:t.name}),'apps');
  const h=setup();await assert.rejects(h.call('sideuser_open',{window_handle:7,expected_display_id:'side',label:'Muse',foreground:true}));
});
