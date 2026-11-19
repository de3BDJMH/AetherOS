const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'AetherOS.user.js'),'utf8');
const snippet=source.slice(source.indexOf('  function initSpectrumLevelTooltips(){'),source.indexOf('  function initReinforceBulkRead(){'));
assert.ok(snippet.includes('const catalog=')&&!snippet.includes('__AETHEROS_SPECTRUM_LEVELS__'));
const vue=fs.readFileSync(process.env.AETHER_TEST_VUE_PATH||path.join(root,'.tmp/vue.global.prod.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/spectrum-levels.json'),'utf8'));
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#0d172b;color:#dce7f8;font:13px system-ui}.card{margin-top:320px;padding:14px;border:1px solid #334863;border-radius:12px}.item-chip-tooltip,.prism-socket-tt,.formula-tooltip-surface{position:fixed;z-index:50;padding:12px;border:1px solid #45617b;border-radius:10px;background:#15253c;color:#dce7f8}.prism-socket-tt,.formula-tooltip-surface{left:12px;top:60px}.item-chip-tooltip{width:240px;bottom:calc(100vh - 90px);left:50%;transform:translateX(-50%)}.tooltip-name,.prism-tt-inner{color:#6eeedc}.formula-stat-chip{color:#f9d466}button{margin:4px}</style><div id="app"></div><script src="/vue.js"></script><script>
const {h,createApp,Teleport,ref}=Vue;
const talent=ref({talent_id:'prism_core_fire',level:2}),next=ref(false),kind=ref('socket'),show=ref(true),formula=ref('火亲和 80 × 0.55% = 44%');
const Tooltip={__name:'VTooltip',setup(_,ctx){return()=>h(Teleport,{to:'body'},ctx.slots.default?.());}};
const Formula={__name:'FormulaTooltip',props:['formula'],setup(props){return()=>h(Tooltip,null,{default:()=>show.value?h('div',{class:'formula-tooltip-surface'},[h('span',{class:'formula-stat-chip'},props.formula)]):null});}};
const Description={__name:'PrismDescription',props:['talent','next'],setup(props){return()=>h('div',{class:'prism-desc'},[h(Formula,{formula:formula.value})]);}};
const Chip={__name:'ItemChip',props:['item'],setup(props){return()=>h('button',{class:'item-chip'},[props.item.name,h(Tooltip,null,{default:()=>show.value?h('div',{class:'item-chip-tooltip',style:{left:'50%',bottom:'calc(100vh - 90px)',transform:'translateX(-50%)'}},[h('div',{class:'tooltip-name'},props.item.name),h('div',{class:'tooltip-desc'},'官网原始说明')]):null})]);}};
createApp({setup(){return()=>h('main',[h('div',{class:'card'},'光谱悬浮提示'),kind.value==='formula'?h(Description,{talent:talent.value,next:next.value}):kind.value==='item'?h(Chip,{item:talent.value}):h(Tooltip,null,{default:()=>show.value?h('div',{class:'prism-socket-tt'},[h('span',{class:'prism-tt-inner'},(talent.value.name||'火之法则')+' · Lv'+talent.value.level)]):null})]);}}).mount('#app');
window.change=(value,type='socket',nextValue=false)=>{talent.value=value;kind.value=type;next.value=nextValue;};window.formula=value=>formula.value=value;window.show=value=>show.value=value;
</script>`;
async function main(){const browser=await chromium.launch({headless:true,channel:process.env.AETHER_TEST_BROWSER||'msedge'});try{
for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:800}}),page=await context.newPage(),errors=[],requests=[];page.on('pageerror',err=>errors.push(err.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/vue.js')return route.fulfill({body:vue,contentType:'application/javascript'});requests.push(url.pathname);return route.fulfill({body:fixture,contentType:'text/html'});});
 await page.addInitScript(snippet+'document.addEventListener("DOMContentLoaded",initSpectrumLevelTooltips);');await page.goto('https://game.diving-fish.com/aether/');
 const table=page.locator('[data-amv-spectrum-levels]');await table.waitFor();assert.equal(await table.count(),1);assert.equal(await table.locator('thead [data-current]').innerText(),'Lv2');assert.deepEqual(await table.locator('tbody tr').first().locator('td').allTextContents(),['0.5%','0.55%','0.6%','0.65%']);
 await page.evaluate(()=>change({talent_id:'prism_core_fire',level:3,name:'火之法则'}));await page.waitForFunction(()=>document.querySelector('[data-amv-spectrum-levels] thead [data-current]')?.textContent==='Lv3');
 await page.evaluate(()=>change({talent_id:'prism_core_fire',level:2},'formula'));await page.waitForFunction(()=>!!document.querySelector('.formula-tooltip-surface [data-amv-spectrum-levels]'));
 assert.match(await page.locator('.formula-stat-chip').innerText(),/火亲和 80/);assert.equal(await table.locator('thead [data-current]').innerText(),'Lv2');
 await page.evaluate(()=>{change({talent_id:'prism_core_fire',level:2},'formula',true);window.formula('火亲和 80 × 0.6% = 48%');});await page.waitForFunction(()=>document.querySelector('[data-amv-spectrum-levels] thead [data-current]')?.textContent==='Lv3');
 await page.evaluate(()=>change({item_id:'prism_core_lucky',name:'纯净光谱·超幸运',kind:'consumable',effect_type:'prism_talent'},'item'));await page.waitForFunction(()=>document.querySelector('[data-amv-spectrum-levels]')?.dataset.amvSpectrumLevels==='prism_core_lucky');
 assert.deepEqual(await table.locator('tbody td').allTextContents(),['0.1%','0.11%','0.12%','0.13%']);assert.equal(await table.locator('[data-current]').count(),0);assert.equal(await page.getByText('官网原始说明',{exact:true}).count(),1);
 const rect=await page.locator('.item-chip-tooltip').boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width+1&&rect.y+rect.height<=801,JSON.stringify(rect));
 await page.evaluate(()=>change({talent_id:'prism_blue_light_radiance',level:4,name:'净辉'},'formula'));await page.waitForFunction(()=>document.querySelector('[data-amv-spectrum-levels]')?.dataset.amvSpectrumLevels==='prism_blue_light_radiance');assert.deepEqual(await table.locator('tbody td').allTextContents(),['80','75','70','65']);
 await page.evaluate(()=>change({talent_id:'prism_red_fire_burn',level:1,name:'烈焰触媒'}));await page.waitForFunction(()=>document.querySelector('[data-amv-spectrum-levels]')?.dataset.amvSpectrumLevels==='prism_red_fire_burn');assert.match(await table.innerText(),/不可升级/);assert.equal(await table.locator('table').count(),0);
 await page.evaluate(()=>change({item_id:'unrelated',name:'普通材料'},'item'));await page.waitForFunction(()=>!document.querySelector('[data-amv-spectrum-levels]'));assert.equal(await page.locator('.amv-spectrum-tip').count(),0);
 await page.evaluate(()=>change({talent_id:'future_unknown',name:'未知新光谱',level:1},'formula'));await page.waitForTimeout(50);assert.equal(await table.count(),0);
 for(const [id,row]of Object.entries(catalog)){
  await page.evaluate(({id,name})=>change({talent_id:id,name,level:1},'formula'),{id,name:row.name});
  // 公式描述若数值相同，原组件可以复用；提示再次打开仍会读取当前光谱。
  await page.evaluate(()=>window.show(false));await page.evaluate(()=>window.show(true));
  await page.waitForFunction(id=>document.querySelector('[data-amv-spectrum-levels]')?.dataset.amvSpectrumLevels===id,id);
  assert.equal(await table.count(),1);assert.equal(await table.locator('tbody tr').count(),row.max_level===1?0:row.fields.length);
 }
 await page.evaluate(()=>change({talent_id:'prism_core_fire',name:'火之法则',level:2}));await page.waitForFunction(()=>document.querySelector('[data-amv-spectrum-levels]')?.dataset.amvSpectrumLevels==='prism_core_fire');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,['/aether/']);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:path.join(root,'.tmp/spectrum-tooltip-'+width+'.png'),fullPage:true});console.log(width,'73 种光谱、当前等级、动态公式、不可升级、未知降级及移动端通过');await context.close();
}
}finally{await browser.close();}}
main().catch(error=>{console.error(error);process.exitCode=1;});

