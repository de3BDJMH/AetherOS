const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{test}=require('node:test');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'src/aetheros.js'),'utf8'),fixtures=require('./fixtures/aether_skillbook_elements.json');
// 样本只包含公开物品规则；不读取本地账号、背包或凭证。
const start=source.indexOf('    function related(item,kind,skills)'),end=source.indexOf('    function character()',start);
assert.ok(start>=0&&end>start);
const related=vm.runInNewContext('const elements=Object.fromEntries(["fire","water","lightning","earth","wind","light","dark","none"].map(key=>[key,true]));'+source.slice(start,end)+'related;');
const classify=(item,skills=new Map())=>[...related(item,'consumables',skills)].sort();
test('当前全部技能书的背包规则与完整物品及技能图鉴一致',()=>{
 assert.equal(fixtures.length,37);
 for(const {expected_elements,...item}of fixtures)assert.deepEqual(classify(item),expected_elements,item.name);
});
test('兼容需求列表、旧亲和对象与可用技能数据，按要求值识别多元素',()=>{
 const base={effect_type:'skill_grant',skill_grant:'example'};
 assert.deepEqual(classify({...base,requirement:[{key:'affinities.fire',required:5,actual:0,met:false},{key:'affinities.water',required:10,actual:50,met:true}]}),['fire','water']);
 assert.deepEqual(classify({...base,requirement:{affinities:{earth:5}}}),['earth']);
 assert.deepEqual(classify({...base,requirement:{light:5}}),['light']);
 assert.deepEqual(classify(base,new Map([['example',{skill:{damage_type:'wind'},requirement:[{key:'affinities.dark',required:5}]}]])),['dark','wind']);
 assert.deepEqual(classify({...base,element:'fire',skill:{damage_type:'lightning'}}),['fire','lightning']);
});
test('不把无元素技能、无门槛或其他需求猜成元素',()=>{
 const item={effect_type:'skill_grant',name:'火焰水流',skill:{damage_type:'physical'},requirement:[null,{}, {key:'level',required:50},{key:'affinities.fire',required:0,actual:50},{key:'affinities.water',required:-1},{key:'affinities.dark',required:'5'},{key:'affinities.unknown',required:10}]};
 assert.deepEqual(classify(item),[]);
 for(const requirement of [null,undefined,'fire',4,[],{}])assert.deepEqual(classify({effect_type:'skill_grant',requirement}),[]);
});
test('明确无元素的光谱保留原分类，物品内容保持不变',()=>{
 const prism={effect_type:'prism_talent',element:null,requirement:[{key:'affinities.fire',required:50}]};
 assert.deepEqual(classify(prism),[]);
 const items=[prism,...fixtures],before=JSON.stringify(items);
 items.forEach(item=>classify(item));assert.equal(JSON.stringify(items),before);
 assert.deepEqual([...related({affinity_bonus:{water:4},slot:'top'},'equipment',new Map())],['water']);
});
