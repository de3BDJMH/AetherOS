const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),cache=process.env.AETHER_TEST_NATIVE_CACHE||path.join(root,'.tmp/decompose-native-assets'),source=fs.readFileSync(process.env.AETHER_TEST_SCRIPT||path.join(root,'AetherOS.user.js'),'utf8');fs.mkdirSync(cache,{recursive:true});
const game='https://game.diving-fish.com',assets='https://aliyun-static.diving-fish.com/aether/web/assets/',count=2000;
// Immutable public frontend modules checked 2026-11-21. Use their actual Vue,
// Pinia, Vuetify expansion panels, transitions, ItemChip, DecomposerPanel, CSS
// and font assets. Replace only app bootstrap, player data and reward preview.
const entry='index-B9vVchcb.js',panel='index-BzSzUZUc.js';
const data={active_sets:{},backpack:{equipment:Array.from({length:count},(_,index)=>({uuid:'gear-'+index,name:'测试装备 '+index,kind:'equipment',value:100,sellable:true,locked:index%25===24,rarity:1+index%6,slot:'weapon',reinforce_level:0,override_stats:{atk:100,armor:50}}))}};
let server,browser,watchdog;const errors=[],requests=[];
async function main(){
  server=await chromium.launchServer({headless:true,channel:process.env.AETHER_TEST_BROWSER||'msedge'});browser=await chromium.connect(server.wsEndpoint());
  // A hung renderer must not leave a test browser behind or affect the user's browser.
  watchdog=setTimeout(()=>{server.process().kill('SIGKILL');process.exit(2);},90000);
  const context=await browser.newContext({viewport:{width:1280,height:850}}),page=await context.newPage();
  if(process.env.AETHER_TEST_CPU_RATE){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.AETHER_TEST_CPU_RATE)});}
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!/font/i.test(message.text()))errors.push(message.text());});
  await context.addInitScript({content:`sessionStorage.setItem('aether_active_character','bench');window.metrics={renders:0,chips:0,heartbeats:0,fetches:0,queries:{},longTasks:[]};const nativeQuery=Element.prototype.querySelectorAll;Element.prototype.querySelectorAll=function(selector){if(selector.includes('prism-socket-tt')){const start=performance.now(),value=nativeQuery.call(this,selector),key=this===document.body?'body':'other',row=metrics.queries[key]||(metrics.queries[key]={calls:0,ms:0});row.calls++;row.ms+=performance.now()-start;return value;}return nativeQuery.call(this,selector);};new PerformanceObserver(list=>{for(const entry of list.getEntries())metrics.longTasks.push(entry.duration);}).observe({entryTypes:['longtask']});setInterval(()=>metrics.heartbeats++,100);\n`+source});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin==='https://raw.githubusercontent.com')return route.fulfill({headers:{'access-control-allow-origin':'*'},body:source.split('// ==/UserScript==')[0]});
    if(url.origin==='https://aliyun-static.diving-fish.com'&&url.pathname.startsWith('/aether/web/assets/')&&request.method()==='GET'){
      const name=path.basename(url.pathname),file=path.join(cache,name);let content;if(fs.existsSync(file))content=fs.readFileSync(file);else{const response=await route.fetch({headers:{}});assert.equal(response.status(),200,'public asset '+name);content=await response.body();fs.writeFileSync(file,content);}
      const ext=path.extname(name),headers={'access-control-allow-origin':'*','content-type':ext==='.js'?'application/javascript':ext==='.css'?'text/css':ext==='.woff2'?'font/woff2':'application/octet-stream'};
      if(name===entry){
        const boot='const Ym=yp(Aw);Gb(Ym);Ym.mount("#app");"serviceWorker"in navigator&&window.addEventListener("load",()=>{navigator.serviceWorker.register("/aether/sw.js").catch(()=>{})});';
        const text=content.toString('utf8');assert(text.includes(boot),'entry bootstrap changed');content=Buffer.from(text.replace(boot,'')+'\nexport{yp as benchCreateApp,By as benchVuetify,_p as benchCreatePinia};');
      }else if(name===panel){
        let text=content.toString('utf8');assert(text.includes('import{u as it,a as Zs,'),'player import changed');text=text.replace('import{u as it,a as Zs,','import{u as nativePlayerUnused,a as Zs,').replace('const Ya={','const it=()=>window.__benchStore;const Ya={');
        content=Buffer.from(text+'\nconst realSetup=$h.setup;$h.setup=function(props,ctx){const render=realSetup.call(this,props,ctx);return function(...args){metrics.renders++;return render.apply(this,args);};};const chipSetup=Hi.setup;Hi.setup=function(props,ctx){const render=chipSetup.call(this,props,ctx);return function(...args){metrics.chips++;return render.apply(this,args);};};export{hh as benchDecomposer};');
      }
      return route.fulfill({headers,body:content});
    }
    assert.equal(url.origin,game);requests.push({method:request.method(),path:url.pathname});
    if(url.pathname==='/api/aether/decompose/preview'&&request.method()==='POST'){const n=request.postDataJSON().uuids.length;return route.fulfill({json:{code:0,data:{rewards_estimate:{thunder_gem:{min:n*2,max:n*3}}}}});}
    assert.equal(url.pathname,'/aether/','real game API or destructive operation blocked');assert.equal(request.method(),'GET');
    return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${assets}index-Bo8Fm9G6.css"><link rel="stylesheet" href="${assets}index-D1f-QeuQ.css"><style>body{margin:16px;background:#101b2e;color:#e6ecff}.console-header{display:flex;justify-content:flex-end;min-height:40px}</style><div id="app" class="v-theme--dark"></div><script type="module">import{benchCreateApp,benchVuetify,benchCreatePinia,f as ref,b as h}from'${assets}${entry}';window.__benchStore={statusData:ref(${JSON.stringify(data)}),async fetchStatus(){metrics.fetches++;return this.statusData.value;}};const{benchDecomposer}=await import('${assets}${panel}');const app=benchCreateApp({setup(){return()=>h('main',{class:'aether-console'},[h('header',{class:'console-header'},[h('div',{class:'header-actions'})]),h(benchDecomposer)]);}});app.use(benchCreatePinia()).use(benchVuetify);app.mount('#app');</script>`});
  });
  await page.goto(game+'/aether/',{waitUntil:'domcontentloaded'});await page.waitForFunction(n=>document.querySelectorAll('.item-chip').length===n,count,{timeout:60000});await page.waitForTimeout(700);
  const mounted=await page.evaluate(()=>JSON.parse(JSON.stringify(metrics)));assert((mounted.queries.body?.calls||0)<=20,'repeated body scans at entry: '+JSON.stringify(mounted.queries));assert.equal(mounted.fetches,1);assert.equal(mounted.chips,count);
  await page.locator('.item-chip').first().click();await page.waitForFunction(()=>document.querySelectorAll('.item-chip--selected').length===1);await page.waitForFunction(()=>document.querySelector('.footer-reward')?.textContent.includes('2–3'));
  // Preserve the actual native all/none handlers across all six rarity groups.
  for(let group=0;group<6;group++)await page.getByRole('button',{name:'全选',exact:true}).first().click();
  const eligible=data.backpack.equipment.filter(item=>!item.locked).length;await page.waitForFunction(n=>document.querySelectorAll('.item-chip--selected').length===n,eligible);assert.equal(await page.locator('.item-chip').count(),count);
  await page.getByRole('button',{name:'取消全选',exact:true}).first().click();assert((await page.locator('.item-chip--selected').count())<eligible);await page.getByRole('button',{name:'全选',exact:true}).first().click();await page.waitForFunction(n=>document.querySelectorAll('.item-chip--selected').length===n,eligible);
  await page.getByRole('button',{name:'分解',exact:true}).click();await page.locator('.confirm-card').waitFor({state:'visible'});assert.equal(await page.locator('.confirm-card strong').textContent(),String(eligible));await page.getByRole('button',{name:'取消',exact:true}).click();
  assert.deepEqual(errors,[]);assert(requests.every(row=>row.method==='GET'&&row.path==='/aether/'||row.method==='POST'&&row.path==='/api/aether/decompose/preview'));
  const after=await page.evaluate(()=>JSON.parse(JSON.stringify(metrics)));assert(after.heartbeats>mounted.heartbeats,'renderer heartbeat must continue');fs.writeFileSync(path.join(os.tmpdir(),'aether-decompose-native-performance.json'),JSON.stringify({mounted,after,requests},null,2));console.log(JSON.stringify({items:count,entryBodyScans:mounted.queries.body?.calls,entryQueryMs:mounted.queries.body?.ms,maxEntryLongTaskMs:Math.max(0,...mounted.longTasks),selectedAfterAll:eligible,heartbeats:after.heartbeats}));await context.close();
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{clearTimeout(watchdog);await browser?.close().catch(()=>{});await server?.close().catch(()=>{});});
