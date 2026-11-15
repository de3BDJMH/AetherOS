const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{test}=require('node:test');
const source=fs.readFileSync(path.resolve(__dirname,'../src/aetheros.js'),'utf8'),start=source.indexOf('  function createReinforceHistory('),end=source.indexOf('  function createReinforceBridge(',start),create=Function(source.slice(start,end)+';return createReinforceHistory;')();
function setup(){const data=new Map(),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)},history=create(storage,()=>123456);return {data,storage,history};}
const info=(level=7,fails=5)=>({equipment:{reinforce_level:level,name:'测试装备'},next:{fails}}),result=(success,new_level,extra={})=>({code:0,data:{success,new_level,...extra}});
test('中途读取服务器失败次数，下一次成功计入原有失败',()=>{
 const {history:h}=setup();h.observe('角色','uuid',info());const ctx=h.begin('角色','uuid',info(),'attempt',false);h.finish(ctx,result(true,8));
 const row=h.read('角色','uuid').levels[8];assert.equal(row.attempts,6);assert.equal(row.material,1);assert.equal(row.voucher,0);assert.equal(row.success_at,123456);
 h.observe('角色','uuid',info(8,0));assert.equal(h.read('角色','uuid').levels[8].attempts,6);
});
test('失败后重新查询当前计数，材料和券分别累计，不重复记录回调',()=>{
 const {history:h}=setup();let ctx=h.begin('角色','uuid',info(),'attempt',false);h.finish(ctx,result(false,7,{fails:6}));h.finish(ctx,result(false,7,{fails:6}));
 h.observe('角色','uuid',info(7,6));ctx=h.begin('角色','uuid',info(7,6),'attempt',true);h.finish(ctx,result(true,8));
 const row=h.read('角色','uuid').levels[8];assert.equal(row.attempts,7);assert.equal(row.material,1);assert.equal(row.voucher,1);
});
test('官网连续强化按响应中的真实尝试次数计数，缺少次数时留空',()=>{
 const {history:h}=setup();let ctx=h.begin('角色','uuid',info(),'attempt_continuous',false);h.finish(ctx,result(true,8,{attempts:3}));
 assert.equal(h.read('角色','uuid').levels[8].attempts,8);assert.equal(h.read('角色','uuid').levels[8].material,3);
 ctx=h.begin('角色','other',info(),'attempt_continuous',false);h.finish(ctx,result(true,8));assert.equal(h.read('角色','other').levels[8].attempts,null);
});
test('刷新页面或穿脱后以角色和装备唯一标识继续记录，不按部位或名称合并',()=>{
 const {history:h,storage}=setup();const ctx=h.begin('角色','uuid',info(),'attempt',false);h.finish(ctx,result(false,7));
 const fresh=create(storage);assert.equal(fresh.read('角色','uuid').levels[8].fails,6);assert.deepEqual(fresh.read('角色','different').levels,{});assert.deepEqual(fresh.read('其他角色','uuid').levels,{});
 const next=fresh.begin('角色','uuid',info(7,6),'attempt',true);fresh.finish(next,result(true,8));assert.equal(fresh.read('角色','uuid').levels[8].attempts,7);
});
test('网络响应丢失不擅自计次；后续查询核对当前进度',()=>{
 const {history:h}=setup();let ctx=h.begin('角色','uuid',info(),'attempt',true);h.finish(ctx,null,true);assert.equal(h.read('角色','uuid').levels[8].pending,true);
 h.observe('角色','uuid',info(7,6));let row=h.read('角色','uuid').levels[8];assert.equal(row.fails,6);assert.equal(row.pending,false);assert.equal(row.voucher,0);
 ctx=h.begin('角色','uuid',info(7,6),'attempt',true);h.finish(ctx,null,true);h.observe('角色','uuid',info(8,0));row=h.read('角色','uuid').levels[8];assert.equal(row.complete,true);assert.equal(row.attempts,null);
});
test('旧装备过去的成功次数不倒推，不把异常响应记作成功',()=>{
 const {history:h}=setup();h.observe('角色','uuid',info(14,20));assert.deepEqual(Object.keys(h.read('角色','uuid').levels),['15']);
 const ctx=h.begin('角色','uuid',info(14,20),'attempt',false);h.finish(ctx,result('true',15));assert.equal(h.read('角色','uuid').levels[15].complete,false);
 h.observe('角色','uuid',{equipment:{reinforce_level:15,name:'测试装备'},maxed:true,next:null});assert.equal(h.read('角色','uuid').levels[15].attempts,null);
});
test('损坏的本机记录与存储不可用不影响强化操作',()=>{
 const {history:h,storage}=setup();storage.setItem('aether-reinforce-history-v1:'+JSON.stringify(['角色','uuid']),JSON.stringify({version:1,character:'角色',uuid:'uuid',levels:{8:null}}));assert.doesNotThrow(()=>h.observe('角色','uuid',info()));
 const denied=create({getItem(){throw Error();},setItem(){throw Error();}});assert.doesNotThrow(()=>denied.observe('角色','uuid',info()));assert.match(denied.warning,/无法保存/);
 assert.equal(h.begin('角色','uuid',{equipment:{reinforce_level:7},next:{fails:'5'}},'attempt',false),null);
});
