const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'AetherOS.user.js'),'utf8'),start=source.indexOf('  const EQUIPMENT_QUALITY='),end=source.indexOf('  function initEquipmentQuality()',start),context={};
vm.runInNewContext(source.slice(start,end)+';globalThis.score=equipmentQuality;globalThis.catalog=EQUIPMENT_QUALITY;',context);
const cases=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/aether_quality_parity.json'),'utf8'));
for(const row of cases){const value=context.score(row.item);if(row.score===null)assert.equal(value,null,row.item.item_id);else assert(Math.abs(value.score-row.score)<.00011,row.item.item_id+': '+value.score+' / '+row.score);}
const item={item_id:'starter_fire_sword',kind:'equipment',slot:'weapon',override_stats:{atk:60}};
assert.equal(context.score(item).score,50);assert.equal(context.score({...item,reinforce_level:15}).score,50);assert.equal(context.score({...item,effective_stats:{atk:9999}}).score,50);
for(const atk of [54,66,NaN,Infinity,'60',null])assert.equal(context.score({...item,override_stats:{atk}}),null);
assert.equal(context.score({...item,item_id:'constructor'}),null);assert.equal(context.score({...item,item_id:'__proto__'}),null);assert.equal(context.score({...item,item_id:'unknown'}),null);assert.equal(context.score({...item,kind:'material'}),null);assert.equal(context.score({...item,slot:'top'}),null);
assert.equal(context.score({...item,override_stats:null,base_stats:{atk:65}}).score,100);assert.equal(context.score({...item,override_stats:{},base_stats:{atk:65}}),null);
for(const [atk,tier]of [[55,'gray'],[60,'blue'],[62,'purple'],[63.5,'gold'],[64.5,'prism'],[65,'prism']])assert.equal(context.score({...item,override_stats:{atk}}).tier,tier);
console.log(cases.length+' Web scoring parity cases; reinforcement independence, invalid data, fallback and grade boundaries passed');
