const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.resolve(__dirname,'../AetherOS.user.js'),'utf8');
const vue=fs.readFileSync(process.env.AETHER_TEST_VUE_PATH||path.resolve(__dirname,'../.tmp/vue.global.prod.js'),'utf8');
const origin='https://game.diving-fish.com';
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:10px;background:#101b2b;color:#e6ecff;font:14px system-ui}*{box-sizing:border-box}.bpl{max-width:640px;margin:auto}.bpl-toolbar{display:flex;gap:8px}.bpl-list{display:grid;gap:8px}.bpc{display:block;width:100%;padding:10px 40px 10px 10px;background:#183044;color:inherit;border:1px solid #537382;text-align:left;border-radius:8px}.bpc-name{font-weight:700}.bpc-meta{font-size:12px}button,input,select{font:inherit}button{cursor:pointer}.bpc:disabled{opacity:.4}</style>
<div id="app"></div><script src="/vue.js"></script><script>
const {createApp,h,computed,ref}=Vue;
const make=(username,name,pin=0,variant='friend',disabled=false)=>({
  key:variant==='self'?'self':variant+':'+username,payload:{username,variant},
  meta:{username,name,pin,level:50,atk:100,hp:1000},
  cardProps:{name,level:50,badge:{variant,label:variant},stats:{max_hp:1000,atk:100,spe:90},skills:[{name:'碧波'}],disabled},
});
const roster=[make('self','自己',2,'self'),make('npc','NPC',0,'npc'),...Array.from({length:24},(_,i)=>make('friend'+i,'好友'+i,0,'friend',i===23))];
const Card={name:'BattlerPickCard',__name:'BattlerPickCard',props:['name','disabled'],emits:['select'],setup(props,{emit}){
 return()=>h('button',{class:'bpc',disabled:props.disabled,onClick:()=>emit('select')},[h('span',{class:'bpc-name'},props.name),h('span',{class:'bpc-go'},' ›')]);
}};
const Picker={name:'BattlerPickList',__name:'BattlerPickList',props:{items:Array,pageSize:{type:Number,default:5}},emits:['select'],setup(props,{emit}){
 const search=ref(''),page=ref(1);
 const sorted=computed(()=>props.items.filter(item=>item.meta.name.includes(search.value)).slice().sort((a,b)=>b.meta.pin-a.meta.pin));
 const shown=computed(()=>sorted.value.slice((page.value-1)*props.pageSize,page.value*props.pageSize));
 Vue.watch([search,()=>props.items,()=>props.pageSize],()=>page.value=1);
 return()=>h('section',{class:'bpl'},[
   h('div',{class:'bpl-toolbar'},[h('input',{placeholder:'搜索',value:search.value,onInput:e=>search.value=e.target.value})]),
   h('div',{class:'bpl-list'},shown.value.map(item=>h(Card,{key:item.key,...item.cardProps,onSelect:()=>emit('select',item.payload)}))),
   h('button',{id:'next',onClick:()=>page.value++},'下一页'),
 ]);
}};
const mode=ref('battle');
createApp({setup(){return()=>h('main',[
 h('button',{id:'battle',onClick:()=>mode.value='battle'},'实际战斗'),
 h('button',{id:'training',onClick:()=>mode.value='training'},'训练场'),
 h(Picker,{key:mode.value,items:roster,onSelect:payload=>window.selected=payload}),
]);}}).mount('#app');
</script>`;

async function check(browser,width){
 const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.addInitScript({content:source});
 let syncs=[];
 await context.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin==='https://raw.githubusercontent.com')return route.fulfill({headers:{'access-control-allow-origin':'*'},body:source.split('// ==/UserScript==')[0]});
   if(url.origin==='https://web.example.invalid'){
     const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST','access-control-allow-headers':'authorization,content-type'};
     if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
     const data=req.postDataJSON();
     if(url.pathname.endsWith('/pins/sync'))return route.fulfill({headers,json:{version:1,ack:0,revision:0,characters:{}}});
     if(url.pathname.endsWith('/history/sync'))return route.fulfill({headers,json:{version:1,cursor:0,records:[],accepted:[],has_more:false}});
     if(url.pathname.endsWith('/custom-loadouts/sync'))return route.fulfill({headers,json:{version:1,cursor:0,changes:[],accepted:[],has_more:false}});
     if(url.pathname.endsWith('/role-preferences/sync'))return route.fulfill({headers,json:{version:1,records:[]}});
     assert(url.pathname.endsWith('/support-pins/sync'));
     syncs.push(data);
     return route.fulfill({headers,json:{version:1,records:[...data.changes,{key:'friend22',stamp:1,edit_id:'00000000-0000-0000-0000-000000000001',value:'pinned'}]}});
   }
   assert.equal(url.origin,origin);assert.equal(req.method(),'GET');
   if(url.pathname==='/vue.js')return route.fulfill({contentType:'text/javascript',body:vue});
   assert.equal(url.pathname,'/aether/');
   return route.fulfill({contentType:'text/html; charset=utf-8',body:fixture});
 });
 try{
   await page.goto(origin+'/aether/');
   await page.waitForFunction(()=>document.querySelectorAll('.bpc').length===20);
   assert.equal(await page.getByRole('button',{name:'置顶 自己',exact:true}).count(),0);
   assert.equal(await page.getByRole('button',{name:'置顶 NPC',exact:true}).count(),0);
   const search=page.getByPlaceholder('搜索');
   await search.fill('好友24');
   await page.waitForFunction(()=>!document.querySelector('.bpc'));
   await search.fill('好友21');
   await page.getByRole('button',{name:'置顶 好友21',exact:true}).click();
   await search.fill('');
   await page.waitForFunction(()=>document.querySelector('.bpc-name').textContent==='好友21');
   await page.getByRole('button',{name:'表格显示',exact:true}).click();
   const table=page.locator('.aether-support-table');
   await table.waitFor();
   assert.equal(await table.locator('tbody tr').count(),20);
   assert.equal(await table.locator('tbody tr').first().getByRole('button',{name:'好友21 friend',exact:true}).count(),1);
   await table.locator('tbody tr').first().locator('.aether-support-choose').click();
   assert.equal(await page.evaluate(()=>window.selected.username),'friend21');
   await page.getByLabel('助战列表每页数量').selectOption('50');
   await page.waitForFunction(()=>document.querySelectorAll('.aether-support-table tbody tr').length===26);
   assert.equal(await table.getByRole('button',{name:'好友23 friend',exact:true}).isDisabled(),true);
   await page.locator('#training').click();
   await page.waitForFunction(()=>document.querySelectorAll('.aether-support-table tbody tr').length===26);
   assert.equal(await page.getByRole('button',{name:'取消置顶 好友21',exact:true}).count(),1);
   await page.reload();
   await page.waitForFunction(()=>document.querySelectorAll('.aether-support-table tbody tr').length===26);
   assert.equal(await table.locator('tbody tr').first().locator('strong').textContent(),'好友21');
   await page.getByRole('button',{name:'取消置顶 好友21',exact:true}).last().click();
   await page.waitForFunction(()=>document.querySelector('.aether-support-table tbody tr strong').textContent==='自己');
   await page.getByRole('button',{name:'行显示',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.bpl-list').getAttribute('data-aether-view')==='rows');
   assert.equal(await page.locator('.bpc').count(),26);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   await page.evaluate(()=>{
     localStorage.setItem('aether-pin-sync-v1',JSON.stringify({version:1,server:'https://web.example.invalid',token:'x'.repeat(32),client_id:'a'.repeat(32),initial:null,pending:[],revision:0}));
     window.dispatchEvent(new Event('aether-support-sync-now'));
   });
   await page.getByRole('button',{name:'取消置顶 好友22',exact:true}).waitFor();
   assert(syncs.some(value=>value.changes.some(row=>row.key==='friend21'&&row.value===null)));
   assert.deepEqual(errors,[]);
   console.log(width,'实际战斗与训练场共用、置顶跨页、视图切换、筛选、禁用、云同步通过');
 }finally{await context.close();}
}
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.AETHER_TEST_BROWSER||undefined});
 try{for(const width of [1440,390])await check(browser,width);}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
