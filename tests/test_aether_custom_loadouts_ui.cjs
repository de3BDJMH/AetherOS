const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const script=fs.readFileSync(path.resolve(__dirname,'../AetherOS.user.js'),'utf8');
const origin='https://game.diving-fish.com',roles=['角色甲','角色乙'],prefix='aether-custom-loadouts-v1:';
const gearSlots=['weapon','top','bottom','gloves','shoes','accessory'],skillSlots=['addon','custom','aether'],colors=['core','red','blue','green'];
const item=(uuid,slot,name)=>({uuid,slot,name,icon:{url:origin+'/api/aether/assets/'+uuid+'.webp',scale:1.25}}),talent=id=>({talent_id:id,name:'光谱 '+id,requirement_met:true});
const sword=item('sword','weapon','测试长剑'),staff=item('staff','weapon','测试法杖'),boots=item('boots','shoes','测试靴');
const snapshot=()=>({equipment:{weapon:sword},skills:{custom:'wave',addon:null,aether:null},spectra:{core:[],red:['alpha','beta'],blue:[],green:[]}});
const alternate=()=>({equipment:{weapon:staff,shoes:boots},skills:{custom:'bolt',addon:null,aether:null},spectra:{core:[],red:['beta','alpha'],blue:[],green:[]}});

async function main(){
  const browser=await chromium.launch({headless:true,channel:process.env.AETHER_TEST_BROWSER||undefined});
  try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:880}}),page=await context.newPage(),errors=[],calls=[];
    const world={state:snapshot(),inventory:[sword,staff,boots],reject:null};
    await context.addInitScript({content:`sessionStorage.setItem('aether_active_character','角色甲');window.confirm=()=>true;\n${script}`});
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin==='https://raw.githubusercontent.com')return route.fulfill({headers:{'access-control-allow-origin':'*'},body:script.split('// ==/UserScript==')[0]});
      assert.equal(url.origin,origin);
      if(url.pathname==='/aether/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#102037;color:#d9e6ff}.ae-dialog{margin:auto;max-width:700px}.ae-dialog__body{padding:10px}.preset-card[data-v-123abc]{border:1px solid #ffffff20;border-radius:10px;background:#ffffff0e;padding:9px}.preset-equip-row[data-v-123abc]{display:flex;gap:4px}button{cursor:pointer}</style><main id="app"><button id="open" onclick="document.getElementById('holder').innerHTML=document.getElementById('preset').innerHTML">装备预设</button></main><div id="holder"></div><template id="preset"><div class="ae-dialog"><div class="ae-dialog__title-text"><h2>装备预设</h2></div><div class="ae-dialog__body" data-v-123abc><div class="presets-list" data-v-123abc>官网原有槽位</div></div></div></template>`});
      if(url.pathname.startsWith('/api/aether/assets/'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aC8AAAAASUVORK5CYII=','base64')});
      const endpoint=url.pathname.replace('/api/aether',''),role=url.searchParams.get('_aether_character');
      assert(roles.includes(role));const body=request.postDataJSON();calls.push({endpoint,role,body});let data={};const state=world.state;
      if(request.method()==='GET'){
        if(endpoint==='/status')data={equipment_slots:gearSlots.map(slot=>({slot,item:state.equipment[slot]||null})),backpack:{equipment:world.inventory},skills:{slots:skillSlots.map(slot=>({slot,editable:true,skill:{name:'展示技能+'}})),available:Object.fromEntries(skillSlots.map(slot=>[slot,{selected:state.skills[slot],options:['wave','bolt'].map(code=>({skill_code:code,skill:{name:code},can_equip:true}))}]))}};
        else if(endpoint==='/prism')data={equipped:Object.fromEntries(colors.map(color=>[color,state.spectra[color].map(talent)])),slots:{core:3,red:5,blue:5,green:5},owned:{core:[],red:['alpha','beta'].map(talent),blue:[],green:[]}};
        else assert.fail(endpoint);
      }else{
        assert.equal(request.method(),'POST');
        if(world.reject===endpoint)return route.fulfill({contentType:'application/json',body:JSON.stringify({code:400,message:'模拟操作失败'})});
        if(endpoint==='/status/equip')state.equipment[body.slot]=world.inventory.find(row=>row.uuid===body.entry_uuid);
        else if(endpoint==='/status/unequip')delete state.equipment[body.slot];
        else if(endpoint==='/status/skills')state.skills[body.slot]=body.skill_code;
        else if(endpoint==='/prism/uninstall')state.spectra[body.spectrum].splice(body.index,1);
        else if(endpoint==='/prism/install')state.spectra[body.spectrum].push(body.talent_id);
        else assert.fail(endpoint);
      }
      return route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});
    });
    const feedback=page.locator('.aosp-loadout-feedback'),section=page.locator('.aosp-loadouts'),card=page.locator('.aosp-loadout-card');
    const awaitMessage=message=>page.waitForFunction(value=>document.querySelector('.aosp-loadout-feedback')?.textContent.includes(value),message);
    const open=async()=>{await page.locator('#open').click();await page.locator('.aosp-loadouts').waitFor({state:'attached'});};
    const tab=name=>page.locator('.aosp-loadout-switch').getByRole('button',{name,exact:true});
    const pickCustom=async()=>{if(width<861)await tab('自定义预设').click();await section.waitFor();};
    await page.goto(origin+'/aether/');assert.equal(calls.length,0);await open();assert.equal(await page.locator('.aosp-loadout-layout > .presets-list').innerText(),'官网原有槽位');
    if(width<861){assert.equal(await section.isVisible(),false);await pickCustom();assert.equal(await page.locator('.aosp-loadout-layout > .presets-list').isVisible(),false);await tab('官方预设').click();assert.equal(await page.locator('.aosp-loadout-layout > .presets-list').isVisible(),true);await pickCustom();}
    else {assert.equal(await tab('官方预设').isVisible(),false);const left=await page.locator('.aosp-loadout-layout > .presets-list').boundingBox(),right=await section.boundingBox();assert(left.x+left.width<=right.x&&Math.abs(left.y-right.y)<2);}
    await section.getByRole('button',{name:'添加自定义预设',exact:true}).click();await awaitMessage('已建立空预设');assert.equal(calls.length,0);assert.equal(await card.getByRole('button',{name:'应用',exact:true}).isDisabled(),true);
    const addBox=await section.getByRole('button',{name:'添加自定义预设',exact:true}).boundingBox(),emptyBox=await card.boundingBox();assert.equal(addBox.width,emptyBox.width);assert.equal(addBox.height,emptyBox.height);
    assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key))[0].empty,prefix+roles[0]),true);
    await page.reload();await open();await pickCustom();await card.getByText('空预设',{exact:true}).waitFor();assert.equal(calls.length,0);
    await card.getByRole('button',{name:'保存',exact:true}).click();await awaitMessage('已保存');assert.equal(await card.getByRole('button',{name:'应用',exact:true}).isDisabled(),false);
    assert.equal(calls.length,2);assert(calls.every(row=>row.body===null));
    const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),prefix+roles[0]);assert.equal(stored[0].equipment.weapon.uuid,'sword');assert.equal(stored[0].equipment.weapon.icon.url,sword.icon.url);assert.equal(stored[0].skills.custom.code,'wave');assert.deepEqual(stored[0].spectra.red.map(row=>row.id),['alpha','beta']);
    assert.equal(await card.getAttribute('data-v-123abc'),'');assert.equal(await card.locator('.preset-equip-cell').count(),6);assert.equal(await card.locator('img').getAttribute('src'),sword.icon.url);
    await page.evaluate(key=>{const rows=JSON.parse(localStorage.getItem(key));delete rows[0].equipment.weapon.icon;localStorage.setItem(key,JSON.stringify(rows));},prefix+roles[0]);calls.length=0;await open();await pickCustom();await card.locator('img').waitFor();assert.deepEqual(calls.map(row=>row.endpoint),['/status']);assert.equal(await card.locator('img').getAttribute('src'),sword.icon.url);
    await card.getByText('查看配装',{exact:true}).click();assert.match(await card.innerText(),/测试长剑/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    calls.length=0;await card.getByRole('button',{name:'应用',exact:true}).click();await awaitMessage('当前配装与');assert(calls.every(row=>row.body===null));
    world.state=alternate();world.reject='/prism/install';calls.length=0;await card.getByRole('button',{name:'应用',exact:true}).click();await awaitMessage('模拟操作失败');assert.match(await feedback.innerText(),/部分切换/);assert(!calls.some(row=>row.endpoint==='/status/skills'));assert.equal(world.state.equipment.weapon.uuid,'sword');assert.deepEqual(world.state.spectra.red,[]);
    world.reject=null;calls.length=0;await card.getByRole('button',{name:'应用',exact:true}).click();await awaitMessage('已应用并核对');assert.deepEqual(world.state,snapshot());assert.deepEqual(calls.filter(row=>row.body).map(row=>row.endpoint),['/prism/install','/prism/install','/status/skills']);
    world.state=alternate();calls.length=0;await card.getByRole('button',{name:'应用',exact:true}).click();await awaitMessage('已应用并核对');assert.deepEqual(world.state,snapshot());assert.deepEqual(calls.filter(row=>row.endpoint==='/prism/uninstall').map(row=>row.body.index),[1,0]);
    world.state=alternate();world.inventory=[staff,boots];calls.length=0;await card.getByRole('button',{name:'应用',exact:true}).click();await awaitMessage('已不可用');assert(calls.every(row=>row.body===null));world.inventory=[staff,boots,sword];
    await card.getByRole('button',{name:'改名',exact:true}).click();await section.getByRole('textbox').fill('水系预设');await section.locator('form').getByRole('button',{name:'保存',exact:true}).click();await awaitMessage('已改名');
    await page.evaluate(role=>sessionStorage.setItem('aether_active_character',role),roles[1]);await open();await pickCustom();assert.equal(await card.count(),0);
    await page.reload();await open();await pickCustom();await card.getByText('水系预设',{exact:true}).waitFor();
    await card.getByRole('button',{name:'保存',exact:true}).click();await awaitMessage('已保存');assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key))[0].equipment.weapon.uuid,prefix+roles[0]),'staff');
    await card.getByRole('button',{name:'删除',exact:true}).click();await awaitMessage('已删除');assert.equal(await card.count(),0);assert.deepEqual(errors,[]);
    if(width>=861){
      await page.evaluate(key=>{const rows=Array.from({length:12},(_,index)=>({id:'empty-'+index,name:'自定义 '+index,empty:true}));localStorage.setItem(key,JSON.stringify(rows));window.dispatchEvent(new StorageEvent('storage',{key}));const left=document.querySelector('.aosp-loadout-layout > .presets-list');for(let i=0;i<12;i++){const card=document.createElement('div');card.className='preset-card';card.style.height='100px';left.append(card);}},prefix+roles[0]);
      const positions=await page.evaluate(()=>{const left=document.querySelector('.aosp-loadout-layout > .presets-list'),right=document.querySelector('.aosp-loadouts');left.scrollTop=120;const other=right.scrollTop;right.scrollTop=220;return [left.scrollTop,right.scrollTop,other,document.querySelector('.aosp-loadout-layout').scrollTop];});
      assert.deepEqual(positions,[120,220,0,0]);
    }
    await context.close();console.log(width,'保存、查看、同配装不写入、装备和技能切换、光谱重排、失败后续接、角色隔离、改名覆盖及删除通过');
  }}finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
