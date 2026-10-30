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
 const {ops,ctx}=operations(async(name,args)=>name==='get_issue'?result({labels:['Bug','Urgent']}):(saved=args,result({success:true})));
 await ops.bulk_label({ids:['a','a'],label:'Urgent'},ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(saved)),{id:'a',labels:['Bug','Urgent']});
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
