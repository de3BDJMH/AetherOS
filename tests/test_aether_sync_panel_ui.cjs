const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),script=fs.readFileSync(path.join(root,'AetherOS.user.js'),'utf8');
const game='https://game.diving-fish.com',cloud='https://cloud.example',configKey='aether-pin-sync-v1';
const code='AETHEROS1.'+Buffer.from(JSON.stringify({version:1,server:cloud,token:'t'.repeat(43)})).toString('base64url');
const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#091323;color:#e6ecff;font:14px system-ui}#open{margin:30px;padding:12px;background:#13273b;color:#afddd5;border:1px solid #8fbccc33;border-radius:8px}</style><div id="app"><button id="open" onclick="window.dispatchEvent(new CustomEvent(\'aether-pins-settings\',{detail:{character:\'role-a\'}}))">数据同步</button></div>';

async function main(){
  const browser=await chromium.launch({headless:true,channel:process.env.AETHER_TEST_BROWSER||'msedge'});
  try{for(const [width,height]of [[1200,900],[390,844],[320,568],[780,390]]){
    const context=await browser.newContext({viewport:{width,height},hasTouch:width<800}),page=await context.newPage(),errors=[],requests=[];
    let failure=false;const pins=new Map([['role-a',new Set(['kept'])]]);
    page.on('pageerror',error=>errors.push(error.message));
    await context.addInitScript({content:"sessionStorage.setItem('aether_active_character','role-a');localStorage.setItem('aether-bag-pins-v1:role-a','[\"kept\"]');window.confirm=()=>true;\n"+script});
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin==='https://raw.githubusercontent.com')return route.fulfill({headers:{'access-control-allow-origin':'*'},body:script.split('// ==/UserScript==')[0]});
      if(url.origin===game){assert.equal(url.pathname,'/aether/','opening/switching the sync UI must not read game accounts or inventory');return route.fulfill({contentType:'text/html',body:html});}
      assert.equal(url.origin,cloud);const headers={'access-control-allow-origin':game,'access-control-allow-headers':'Authorization, Content-Type','access-control-allow-methods':'POST'};
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
      assert.equal(request.method(),'POST');assert.equal(request.headers().cookie,undefined);assert.equal(request.headers()['x-aether-character'],undefined);
      requests.push(url.pathname);const body=request.postDataJSON();let data;
      if(url.pathname.endsWith('/pins/sync')){
        if(failure)return route.fulfill({status:401,headers,body:JSON.stringify({detail:'设备已撤销，请重新连接'})});
        for(const [role,ids]of Object.entries(body.initial?.characters||{})){if(!pins.has(role))pins.set(role,new Set());for(const id of ids)pins.get(role).add(id);}
        for(const op of body.operations){if(!pins.has(op.character))pins.set(op.character,new Set());op.pinned?pins.get(op.character).add(op.uuid):pins.get(op.character).delete(op.uuid);}
        data={version:1,revision:1,ack:Math.max(0,...body.operations.map(op=>op.seq)),characters:Object.fromEntries([...pins].map(([role,ids])=>[role,[...ids]]))};
      }else if(url.pathname.endsWith('/history/sync'))data={version:1,cursor:0,has_more:false,accepted:body.records,records:[]};
      else if(url.pathname.endsWith('/custom-loadouts/sync'))data={version:1,cursor:0,has_more:false,accepted:body.changes,changes:[]};
      else if(url.pathname.endsWith('/inventory/sync'))data={version:1,cursor:0,has_more:false,accepted:body.snapshots,snapshots:[]};
      else if(['/api/aetheros/role-preferences/sync','/api/aetheros/support-pins/sync'].includes(url.pathname))data={version:1,records:body.changes};
      else assert.fail('unexpected sync endpoint '+url.pathname);
      return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto(game+'/aether/');await page.locator('#open').click();await page.locator('[data-amv-pin-dialog]').waitFor({state:'visible'});
    const dialog=page.locator('[data-amv-pin-dialog]'),tab=id=>dialog.locator('[data-amv-sync-tab='+id+']'),panel=id=>dialog.locator('[data-amv-sync-page='+id+']');
    assert.equal(await dialog.getByRole('heading',{name:'数据同步',exact:true}).count(),1);
    assert.equal(await dialog.getByRole('tab').count(),3);assert.equal(await panel('connection').isVisible(),true);
    assert.equal(await dialog.getByRole('button',{name:'断开本机',exact:true}).isVisible(),false);
    await tab('overview').click();assert.equal(await dialog.locator('[data-amv-sync-row]').count(),6);
    assert.deepEqual(await dialog.locator('[data-amv-sync-state]').allTextContents(),Array(6).fill('仅本机'));
    await tab('read').click();assert.equal(await dialog.locator('[data-amv-history-current]').isVisible(),true);
    assert.equal(await dialog.getByRole('textbox',{name:'设备同步码'}).isVisible(),false);
    assert.equal(requests.length,0);await tab('connection').click();
    await dialog.getByRole('textbox',{name:'设备同步码'}).fill('bad-code');await dialog.getByRole('button',{name:'连接并同步',exact:true}).click();
    assert.match(await dialog.locator('[data-amv-sync-connection-feedback]').innerText(),/格式不正确/);assert.equal(requests.length,0);
    await dialog.getByRole('textbox',{name:'设备同步码'}).fill(code);await dialog.getByRole('button',{name:'连接并同步',exact:true}).click();
    await panel('overview').waitFor({state:'visible'});
    await page.waitForFunction(()=>['pins','history','loadouts','roles','support'].every(key=>document.querySelector('[data-amv-sync-row='+key+']')?.dataset.state==='ok'));
    assert.equal(await dialog.locator('[data-amv-sync-row=inventory]').getAttribute('data-state'),'waiting');
    assert.equal(await dialog.locator('#aetheros-device-code').inputValue(),'');
    assert.equal(await dialog.locator('[data-amv-sync-connection]').textContent(),'已连接');
    await tab('read').click();await tab('connection').click();await tab('overview').click();await page.waitForTimeout(100);assert.equal(requests.filter(path=>path.endsWith('/inventory/sync')).length,0,'tab changes do not read or sync inventory');
    await dialog.getByRole('button',{name:'立即同步',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-amv-sync-row][data-state=ok]').length===6);
    assert(requests.includes('/api/aetheros/inventory/sync'));
    const geometry=await dialog.locator('.amv-pin-card').evaluate(el=>{const r=el.getBoundingClientRect(),footer=el.querySelector('footer').getBoundingClientRect();return {top:r.top,bottom:r.bottom,overflow:el.scrollWidth>el.clientWidth+1,footerBottom:footer.bottom};});
    assert(geometry.top>=0&&geometry.bottom<=height+1&&!geometry.overflow&&geometry.footerBottom<=height+1,JSON.stringify(geometry));
    await page.screenshot({path:path.join(os.tmpdir(),'aether-sync-overview-'+width+'.png')});
    // Status events only update their own row. Error details remain available.
    await page.evaluate(()=>dispatchEvent(new CustomEvent('aether-loadout-sync-status',{detail:{message:'Web 尚未更新，装备预设保留在本机'}})));
    assert.equal(await dialog.locator('[data-amv-sync-row=loadouts]').getAttribute('data-state'),'error');
    await dialog.locator('[data-amv-sync-row=loadouts] summary').click();assert.match(await dialog.locator('[data-amv-sync-row=loadouts]>p').innerText(),/Web 尚未更新/);
    assert.equal(await dialog.locator('[data-amv-sync-row=history]').getAttribute('data-state'),'ok');
    failure=true;await dialog.getByRole('button',{name:'立即同步',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-amv-sync-row=pins]')?.dataset.state==='error');
    assert.equal(await dialog.locator('[data-amv-sync-connection]').textContent(),'需检查');
    await tab('connection').click();assert.match(await dialog.locator('[data-amv-sync-server]').innerText(),/cloud.example/);
    await page.screenshot({path:path.join(os.tmpdir(),'aether-sync-connection-'+width+'.png')});
    await dialog.getByRole('button',{name:'断开本机',exact:true}).click();await page.waitForFunction(key=>localStorage.getItem(key)===null,configKey);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),configKey),null);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('aether-bag-pins-v1:role-a'))),['kept']);
    await tab('overview').click();assert.deepEqual(await dialog.locator('[data-amv-sync-state]').allTextContents(),Array(6).fill('仅本机'));
    await tab('connection').focus();await page.keyboard.press('ArrowLeft');assert.equal(await tab('read').getAttribute('aria-selected'),'true');
    await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);assert.equal(await page.locator('#open').evaluate(el=>el===document.activeElement),true);
    await page.locator('#open').click();await tab('overview').click();await dialog.getByRole('button',{name:'物品查找',exact:true}).click();
    assert.equal(await dialog.isVisible(),false);await page.locator('[data-amv-inventory-dialog]').waitFor({state:'visible'});
    assert.deepEqual(errors,[]);await context.close();
    console.log(width,height,'three tabs, six statuses, explicit cached inventory sync, no game reads, error details, keyboard focus and disconnect preservation passed');
  }}finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
