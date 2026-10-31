const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'index.js'),'utf8');
function operations(call) {
 const context = vm.createContext({});
 vm.runInContext(source+';globalThis.operations = operations;', context);
 return {ops:context.operations, ctx:{mcp:()=>({call})}};
}
const result = value => ({content:[{type:'text',text:JSON.stringify(value)}]});
test('scores open issues and excludes completed ones',async()=>{
 const {ops,ctx}=operations(async()=>result({issues:[{id:'a',title:'Low',priority:4},{id:'b',title:'High',priority:1},{id:'c',status:'Done'}]}));
 assert.deepEqual(JSON.parse(JSON.stringify(await ops.my_open_issues({},ctx))).map(i=>i.id),['b','a']);
});
test('preserves existing labels and adds only once',async()=>{
 let saved;
 const {ops,ctx}=operations(async(name,args)=>{assert.equal(name,'save_issue');saved=args;return result({success:true});});
 await ops.bulk_label({ids:['a','a'],label:'Urgent'},ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(saved)),{id:'a',addLabels:['Urgent']});
});
test('reports partial completion and does not retry an uncertain write',async()=>{
 const writes=[];
 const {ops,ctx}=operations(async(name,args)=>{
  if(name==='get_issue')return result({labels:[]});
  writes.push(args.id);if(args.id==='b')throw new Error('timeout');return result({success:true});
 });
 const response=await ops.bulk_label({ids:['a','b','c']},ctx);
 assert.deepEqual(writes,['a','b']);assert.equal(response.uncertain,'b');assert.deepEqual(Array.from(response.labeled),['a']);
});
test('refuses oversized batches before calling Linear',async()=>{
 const {ops,ctx}=operations(()=>{throw new Error('must not call')});
 await assert.rejects(ops.bulk_label({ids:['1','2','3','4','5','6']},ctx),/one and five/);
});

test('treats an unreadable write response as uncertain',async()=>{
 const {ops,ctx}=operations(async(name)=>name==='get_issue'?result({labels:[]}):{content:[{type:'text',text:'Updated'}]});
 const response=await ops.bulk_label({ids:['a']},ctx);
 assert.equal(response.uncertain,'a');assert.match(response.error,/Check Linear/);
});

test('handles current Linear priority objects and status types',async()=>{
 const {ops,ctx}=operations(async()=>result({issues:[{id:'a',priority:{value:0},statusType:'backlog'},{id:'b',priority:{value:1},statusType:'started'},{id:'c',priority:{value:1},statusType:'completed'}]}));
 const issues=JSON.parse(JSON.stringify(await ops.my_open_issues({},ctx)));
 assert.deepEqual(issues.map(i=>[i.id,i.score]),[['b',4],['a',0]]);
});
