const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'AetherOS.user.js'),'utf8');
const snippet=source.slice(source.indexOf('  function initSpectrumLevelTooltips(){'),source.indexOf('  function initReinforceBulkRead(){'));
assert.ok(snippet.includes('const catalog=')&&!snippet.includes('__AETHEROS_SPECTRUM_LEVELS__'));
const vue=fs.readFileSync(process.env.AETHER_TEST_VUE_PATH||path.join(root,'.tmp/vue.global.prod.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/spectrum-levels.json'),'utf8'));
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#0d172b;color:#dce7f8;font:13px system-ui}.card{margin-top:320px;padding:14px;border:1px solid #334863;border-radius:12px}.item-chip-tooltip,.prism-socket-tt,.formula-tooltip-surface{position:fixed;z-index:50;padding:12px;border:1px solid #45617b;border-radius:10px;background:#15253c;color:#dce7f8}.prism-socket-tt,.formula-tooltip-surface{left:12px;top:60px}.item-chip-tooltip{width:240px;bottom:calc(100vh - 90px);left:50%;transform:translateX(-50%)}.tooltip-name,.prism-tt-inner{color:#6eeedc}.formula-stat-chip{color:#f9d466}.equip-tooltip-surface{position:fixed;top:30px;left:12px;background:#0c1222;padding:12px 16px;border:1px solid #64c8ff4d;border-radius:12px;color:#e0f2fe}.equip-tooltip{max-width:220px;display:flex;flex-direction:column;gap:.3rem;font-size:.9rem}.equip-tooltip>strong{display:block;color:#ffc84a}.tooltip-muted{color:#a9b7d6}.tooltip-line-flex{display:flex;justify-content:space-between;gap:.5rem}button{margin:4px}</style><div id="app"></div><script src="/vue.js"></script><script>
const {h,createApp,Teleport,ref}=Vue;
const talent=ref({talent_id:'prism_core_fire',level:2}),next=ref(false),kind=ref('socket'),show=ref(true),formula=ref('火亲和 80 × 0.55% = 44%');
const Tooltip={__name:'VTooltip',setup(_,ctx){return()=>h(Teleport,{to:'body'},ctx.slots.default?.());}};
const Formula={__name:'FormulaTooltip',props:['formula'],setup(props){return()=>h(Tooltip,null,{default:()=>show.value?h('div',{class:'formula-tooltip-surface'},[h('span',{class:'formula-stat-chip'},props.formula)]):null});}};
const Description={__name:'PrismDescription',props:['talent','next'],setup(props){return()=>h('div',{class:'prism-desc'},[h(Formula,{formula:formula.value})]);}};
const Chip={__name:'ItemChip',props:['item'],setup(props){return()=>h('button',{class:'item-chip'},[props.item.name,h(Tooltip,null,{default:()=>show.value?h('div',{class:'item-chip-tooltip',style:{left:'50%',bottom:'calc(100vh - 90px)',transform:'translateX(-50%)'}},[h('div',{class:'tooltip-name'},props.item.name),h('div',{class:'tooltip-desc'},'官网原始说明'),props.item.kind?h('div',{class:'tooltip-meta'},[h('span',{class:'tooltip-kind'},props.item.kind==='equipment'?'装备':'消耗品')]):null]):null})]);}};
// 官网背包将商品保存在父组件列表里，VTooltip 只有 UUID key，没有 item prop。
const Backpack={__name:'BackpackPanel',props:['backpackConsumables','sheet'],setup(props){return()=>h('section',{class:'bag-card'},props.backpackConsumables.map(item=>props.sheet?h(Tooltip,{key:item.uuid},{default:()=>h('div',{class:'item-sheet'},[h('header',{class:'item-sheet__head'},[h('strong',{class:'item-sheet__title'},item.name)]),h('div',{class:'item-sheet__body'},[h('div',{class:'equip-tooltip item-sheet__info'},[h('small',{class:'tooltip-muted'},'背包原始说明'),h('div',{class:'tooltip-line-flex'},'使用条件 水亲和 ≥ 25')])]),h('footer',{class:'item-sheet__actions'},[h('button',{id:'native-use',onClick:()=>window.used=(window.used||0)+1},'使用')])])}):h(Tooltip,{key:item.uuid},{default:()=>h('div',{class:'equip-tooltip-surface'},[h('div',{class:'equip-tooltip'},[h('strong',item.name),h('small',{class:'tooltip-muted'},'背包原始说明'),h('div',{class:'tooltip-line-flex'},'×10'),h('div',{class:'tooltip-line'},'使用条件 水亲和 ≥ 25'),h('div',{class:'tooltip-line'},'点击使用')])])})));}};
createApp({setup(){return()=>h('main',[h('div',{class:'card'},'光谱悬浮提示'),kind.value==='bag'||kind.value==='sheet'?h(Backpack,{backpackConsumables:[talent.value],sheet:kind.value==='sheet'}):kind.value==='formula'?h(Description,{talent:talent.value,next:next.value}):kind.value==='item'?h(Chip,{item:talent.value}):h(Tooltip,null,{default:()=>show.value?h('div',{class:'prism-socket-tt v-overlay__content'},[h('span',{class:'prism-tt-inner'},(talent.value.name||'火之法则')+' · Lv'+talent.value.level)]):null})]);}}).mount('#app');
window.change=(value,type='socket',nextValue=false)=>{talent.value=value;kind.value=type;next.value=nextValue;};window.formula=value=>formula.value=value;window.show=value=>show.value=value;
</script>`;
async function main(){const browser=await chromium.launch({headless:true,channel:process.env.AETHER_TEST_BROWSER||'msedge'});try{
for(const width of [1440,1024,390]){
 const context=await browser.newContext({viewport:{width,height:800}}),page=await context.newPage(),errors=[],requests=[];page.on('pageerror',err=>errors.push(err.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/vue.js')return route.fulfill({body:vue,contentType:'application/javascript'});requests.push(url.pathname);return route.fulfill({body:fixture,contentType:'text/html'});});
 await page.addInitScript(snippet+'document.addEventListener("DOMContentLoaded",initSpectrumLevelTooltips);');await page.goto('https://game.diving-fish.com/aether/');
 // 使用官网的透明容器样式，放到脚本样式之后，覆盖延迟加载 CSS 的情况。
 await page.addStyleTag({content:'.v-overlay__content{color:#000}.prism-socket-tt.v-overlay__content{background:transparent!important;padding:0!important;border:none!important;box-shadow:none!important}.prism-socket-tt .prism-tt-inner{display:inline-block;white-space:nowrap;font-size:.7rem;font-weight:600;color:#e6ecff;background:#0c1432f5;border:1px solid #9eb4ff88;border-radius:.45rem;padding:.2rem .5rem;box-shadow:0 6px 18px #0206178c}'});
 const table=page.locator('[data-amv-spectrum-levels]');await table.waitFor();
 const contrast=await page.locator('.prism-socket-tt').evaluate(node=>{const style=getComputedStyle(node),cell=getComputedStyle(node.querySelector('tbody td')),title=getComputedStyle(node.querySelector('.prism-tt-inner'));return {background:style.backgroundColor,color:cell.color,width:node.getBoundingClientRect().width,titleBackground:title.backgroundColor};});
 assert.equal(contrast.background,'rgb(16, 28, 48)','槽位提示必须有独立、不透明的深色背景');assert.equal(contrast.color,'rgb(230, 237, 249)','表格文字必须是浅色');assert.equal(contrast.titleBackground,'rgba(0, 0, 0, 0)','标题并入整块提示');assert.ok(contrast.width>=Math.min(350,width-20));
assert.equal(await table.count(),1);assert.equal(await table.locator('thead [data-current]').innerText(),'Lv2');assert.deepEqual(await table.locator('tbody tr').first().locator('td').allTextContents(),['0.5%','0.55%','0.6%','0.65%']);
 await page.evaluate(()=>change({uuid:'bag-spectrum',item_id:'prism_core_water',effect_type:'prism_talent',name:'光谱·水之法则'},'bag'));
 await page.waitForFunction(()=>document.querySelector('.equip-tooltip-surface [data-amv-spectrum-levels]')?.dataset.amvSpectrumLevels==='prism_core_water');
 await page.screenshot({path:path.join(root,'.tmp/backpack-spectrum-tooltip-'+width+'.png'),fullPage:true});
 assert.equal(await page.getByText('背包原始说明',{exact:true}).count(),1);assert.equal(await page.getByText('点击使用',{exact:true}).count(),1);
 assert.deepEqual(await table.locator('tbody tr').first().locator('td').allTextContents(),['0.5%','0.55%','0.6%','0.65%']);
 await page.evaluate(()=>change({uuid:'bag-spectrum',item_id:'prism_core_water',effect_type:'prism_talent',name:'仅靠ID识别的测试名称'},'bag'));
 await page.waitForFunction(()=>document.querySelector('.equip-tooltip strong')?.textContent==='仅靠ID识别的测试名称');assert.equal(await table.getAttribute('data-amv-spectrum-levels'),'prism_core_water');
 await page.evaluate(()=>change({uuid:'ordinary-item',item_id:'ordinary-item',name:'普通材料'},'bag'));await page.waitForFunction(()=>!document.querySelector('[data-amv-spectrum-levels]'));
 await page.evaluate(()=>change({uuid:'bag-spectrum',item_id:'prism_core_water',effect_type:'prism_talent',name:'光谱·水之法则'},'sheet'));await page.waitForFunction(()=>!!document.querySelector('.item-sheet__info [data-amv-spectrum-levels]'));
 assert.equal(await page.locator('.item-sheet__actions [data-amv-spectrum-levels]').count(),0);await page.locator('#native-use').click();assert.equal(await page.evaluate(()=>window.used),1);
 await page.evaluate(()=>change({talent_id:'prism_core_fire',level:2,name:'火之法则'}));await page.waitForFunction(()=>document.querySelector('[data-amv-spectrum-levels]')?.dataset.amvSpectrumLevels==='prism_core_fire');
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
 // Reuse the same ItemChip tooltip while its explicit type changes.
 await page.evaluate(()=>change({item_id:'prism_core_water',kind:'consumable',name:'光谱·水之法则'},'item'));await table.waitFor();
 await page.evaluate(()=>change({item_id:'ordinary-gear',kind:'equipment',name:'光谱·水之法则'},'item'));await table.waitFor({state:'detached'});assert.equal(await page.locator('.item-chip-tooltip.amv-spectrum-tip').count(),0);
 await page.evaluate(()=>change({item_id:'prism_core_fire',kind:'consumable',name:'光谱·火之法则'},'item'));await table.waitFor();assert.equal(await table.getAttribute('data-amv-spectrum-levels'),'prism_core_fire');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,['/aether/']);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:path.join(root,'.tmp/spectrum-tooltip-'+width+'.png'),fullPage:true});console.log(width,'73 种光谱、当前等级、动态公式、不可升级、未知降级及移动端通过');await context.close();
}
}finally{await browser.close();}}
main().catch(error=>{console.error(error);process.exitCode=1;});

