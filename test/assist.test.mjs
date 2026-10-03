import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistEngine,assistTools,sameScope} from '../src/assist.mjs';
import {engineForTool} from '../src/engines.mjs';
const scope={ok:true,windowHandle:7,processId:9,processStartTicks:'123',displayId:'side',bounds:{X:-1000,Y:0,Width:800,Height:600}};
const target={window_handle:7,expected_display_id:'side'};
const unwrap=r=>JSON.parse(r.content[0].text);
function harness({scopeReply,reply}={}) {
  let scopes=0,calls=[];
  const side=()=>{};side.scope=async()=>scopeReply?scopeReply(++scopes):scope;side.guard=fn=>fn();side.pointer=async args=>{calls.push(args);return {ok:true};};
  const worker={call:async r=>{calls.push(r);return reply?reply(r):{ok:true,documentId:'word:own'};},close(){}};
  const handler=createAssistEngine({python:'fake',winappBinary:'fake'},side,{worker,runWinapp:async args=>{calls.push(args);return {windows:[{hwnd:7,elements:[]}]};},mousemuxProbe:async()=>({ok:true,connected:false,ready:false})});
  const call=(tool,args)=>handler({method:'call',tool,arguments:args});return {call,calls,handler};
}
test('assistance tools route to the configured engine, with no raw MouseMux graph tools',()=>{
  const config={engines:{agent:{kind:'agent',assist:'apps'}}};
  for(const tool of assistTools)assert.equal(engineForTool(config,{engine:'agent',tool:tool.name}),'apps');
  assert.ok(!assistTools.some(t=>/graph|shell|clipboard|focus/.test(t.name)));
});
test('winapp scope is checked before launch and after result; changes stop the operation',async()=>{
  const bad=harness({scopeReply:()=>({ok:false,error:'outside'})});
  assert.equal(unwrap(await bad.call('winapp_inspect',target)).ok,false);assert.equal(bad.calls.length,0);
  const moved=harness({scopeReply:n=>n===1?scope:{...scope,processStartTicks:'456'}});
  assert.equal(unwrap(await moved.call('winapp_find',{...target,query:'Save'})).outcomeUnknown,true);
  assert.equal(moved.calls.length,1);
  assert.equal(sameScope(scope,{...scope,displayId:'other'}),false);
});
test('winapp refuses CLI switch injection and arbitrary target/global flags',async()=>{
  const h=harness();await assert.rejects(h.call('winapp_find',{...target,query:'--on'}));
  await assert.rejects(h.call('winapp_inspect',{...target,app:'human'}));assert.equal(h.calls.length,0);
});
test('Office tokens are one-use, target-bound and refused after process replacement',async()=>{
  const h=harness();const read=unwrap(await h.call('ufo_inspect',target));
  const action={...target,observation_id:read.observationId,rows:2,columns:2};
  assert.equal(unwrap(await h.call('ufo_word_insert_table',action)).ok,true);
  assert.equal(unwrap(await h.call('ufo_word_insert_table',action)).ok,false);
  assert.equal(h.calls.filter(c=>c.action==='ufo_word_insert_table').length,1);
});
test('Excel refuses formulas, irregular data and overflow before COM mutation',async()=>{
  const h=harness();let read=unwrap(await h.call('ufo_inspect',target));
  await assert.rejects(h.call('ufo_excel_write_cells',{...target,observation_id:read.observationId,sheet_name:'Sheet1',start_row:1,start_column:1,values:[['=danger']]}));
  read=unwrap(await h.call('ufo_inspect',target));
  await assert.rejects(h.call('ufo_excel_write_cells',{...target,observation_id:read.observationId,sheet_name:'Sheet1',start_row:1048576,start_column:1,values:[[1],[2]]}));
  assert.ok(!h.calls.some(c=>c.action==='ufo_excel_write_cells'));
});
test('software pointer schema rejects global delivery, missing pixels and non-finite numbers',async()=>{
  const h=harness();for(const args of [{...target,observation_id:'fresh',x:1,y:2,delivery_mode:'foreground'},{...target,observation_id:'fresh',x:NaN,y:2},{...target,x:1,y:2}])await assert.rejects(h.call('sidecursor_click',args));
  assert.equal(h.calls.length,0);
});
