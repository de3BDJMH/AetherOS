const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {chromium} = require('playwright');

const script = readFileSync(resolve(__dirname, '../AetherOS.user.js'), 'utf8');
const origin = 'https://game.diving-fish.com';
const accounts = ['alpha', 'beta', 'gamma'].map(username => ({username, name:username}));
const note = '每日小号 <b>材料</b>';

const fixture = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>dialog{margin:0;inset:0 auto auto 0}.character-list{display:grid;gap:8px}.character-card{display:flex;min-height:58px;align-items:center;padding:8px;border:1px solid gray;text-align:left}.character-card__body{display:grid}</style>
<main id="app"><button id="switch">切换角色</button><div class="character-gateway"></div></main>
<script>
function render() {
  const gateway=document.querySelector('.character-gateway');
  gateway.innerHTML='<p class="auth-meta">水鱼账号：测试</p><div class="character-list"></div>';
  const list=gateway.querySelector('.character-list');
  for(const role of ${JSON.stringify(accounts)}) {
    const card=document.createElement('button');
    card.className='character-card';
    card.innerHTML='<span class="character-card__body"><strong>'+role.name+'</strong><small>'+role.username+' · Lv.50</small></span>';
    card.onclick=()=>{window.selected=role.username;};
    list.append(card);
  }
}
document.querySelector('#switch').onclick=render;
</script>`;

async function check(browser, width) {
  const context = await browser.newContext({viewport:{width,height:850}});
  const page = await context.newPage();
  const errors = [],cloudCalls=[];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript({content:script});
  await context.route('**/*', route => {
    const {pathname, origin:host} = new URL(route.request().url());
    if (host === 'https://raw.githubusercontent.com') {
      return route.fulfill({headers:{'access-control-allow-origin':'*'},body:script.split('// ==/UserScript==')[0]});
    }
    if (host === 'https://web.example.invalid') {
      const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST','access-control-allow-headers':'authorization,content-type'};
      if (route.request().method()==='OPTIONS') return route.fulfill({status:204,headers});
      const payload=route.request().postDataJSON();
      if (pathname==='/api/aetheros/pins/sync') return route.fulfill({headers,json:{version:1,ack:0,revision:0,characters:{}}});
      if (pathname==='/api/aetheros/history/sync') return route.fulfill({headers,json:{version:1,cursor:0,accepted:[],records:[],has_more:false}});
      if (pathname==='/api/aetheros/custom-loadouts/sync') return route.fulfill({headers,json:{version:1,cursor:0,accepted:[],changes:[],has_more:false}});
      assert.equal(pathname,'/api/aetheros/role-preferences/sync');
      cloudCalls.push(payload);
      return route.fulfill({headers,json:{version:1,records:[...payload.changes,{key:'beta',stamp:10,edit_id:'00000000-0000-0000-0000-000000000010',value:'另一台设备的备注'}]}});
    }
    assert.equal(host, origin);
    assert.equal(route.request().method(), 'GET');
    if (pathname === '/api/aether/account') return route.fulfill({json:{code:0,data:{characters:accounts}}});
    assert.equal(pathname, '/aether/');
    return route.fulfill({contentType:'text/html; charset=utf-8',body:fixture});
  });
  const native = page.locator('.character-gateway');
  const cards = native.locator('.character-card');
  const roleOrder = () => cards.locator('strong').evaluateAll(nodes=>nodes.map(node=>node.firstChild.textContent));
  const pencil = name => native.getByRole('button',{name:'编辑 '+name+' 的备注'});
  const dialog=page.getByRole('dialog');
  const input=dialog.getByRole('textbox',{name:'备注'});
  const grip = name => native.getByRole('slider',{name:name+'的排序位置'});
  const open = async () => {
    await page.getByRole('button',{name:'切换角色',exact:true}).click();
    await pencil('alpha').waitFor();
  };
  try {
    await page.goto(origin+'/aether/');
    await page.evaluate(note=>localStorage.setItem('aether-role-preferences-v1',JSON.stringify({order:['gamma','alpha','beta'],notes:{gamma:note}})),note);
    await open();
    assert.deepEqual(await roleOrder(), ['gamma','alpha','beta']);
    assert.equal(await cards.first().locator('.aether-inline-role-note').textContent(),'('+note+')');
    assert.equal(await native.getByRole('textbox').count(),0);
    await pencil('alpha').click();
    await dialog.waitFor();
    const box=await dialog.boundingBox();
    assert(Math.abs(box.x+box.width/2-width/2)<2);
    assert(Math.abs(box.y+box.height/2-425)<2);
    assert.equal(await dialog.evaluate(node=>getComputedStyle(node,'::backdrop').backgroundColor),'rgba(3, 8, 18, 0.72)');

    await input.fill(note);
    await dialog.getByRole('button',{name:'保存',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.selected),undefined);

    await page.evaluate(()=>{
      const animate=Element.prototype.animate;
      window.roleAnimations=0;
      Element.prototype.animate=function(...args){
        if(this.classList.contains('character-card'))window.roleAnimations++;
        return animate.apply(this,args);
      };
    });
    const handle=await grip('alpha').boundingBox(),target=await cards.first().boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
    await page.mouse.down();
    await page.mouse.move(handle.x+handle.width/2,target.y+target.height/2,{steps:5});
    assert.deepEqual(await roleOrder(), ['alpha','gamma','beta']);
    assert(await page.evaluate(()=>window.roleAnimations)>=2);
    const beforeDrop=await page.evaluate(()=>JSON.parse(localStorage.getItem('aether-role-preferences-v1')).order);
    assert.deepEqual(beforeDrop,['gamma','alpha','beta']);
    await page.mouse.up();
    assert.deepEqual(await roleOrder(), ['alpha','gamma','beta']);
    assert.equal(await cards.first().locator('.aether-inline-role-note').textContent(),'('+note+')');
    await cards.first().locator('strong').click();
    assert.equal(await page.evaluate(()=>window.selected),'alpha');

    await page.reload();
    await open();
    assert.deepEqual(await roleOrder(), ['alpha','gamma','beta']);
    await open();
    assert.equal(await native.locator('.aether-inline-role-tools').count(),3);
    await grip('beta').press('ArrowUp');
    assert.deepEqual(await roleOrder(), ['alpha','beta','gamma']);
    await pencil('alpha').click();
    assert.equal(await input.inputValue(),note);
    await input.fill('取消后的备注');
    await dialog.getByRole('button',{name:'取消',exact:true}).click();
    await pencil('alpha').click();
    assert.equal(await input.inputValue(),note);
    await input.fill('');
    await input.press('Enter');
    await dialog.waitFor({state:'hidden'});
    assert.equal(await cards.first().locator('.aether-inline-role-note').count(),0);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('aether-role-preferences-v1')).notes.alpha),undefined);
    assert.equal(await native.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);

    await page.evaluate(()=>{
      localStorage.setItem('aether-pin-sync-v1',JSON.stringify({version:1,server:'https://web.example.invalid',token:'t'.repeat(32),client_id:'a'.repeat(32),initial:null,pending:[],revision:0}));
      window.dispatchEvent(new Event('aether-role-sync-now'));
    });
    await native.getByText('(另一台设备的备注)',{exact:true}).waitFor();
    assert(cloudCalls[0].changes.some(row=>row.key==='gamma'&&row.value===note&&row.stamp===0));
    assert(cloudCalls[0].changes.some(row=>row.key==='alpha'&&row.value===null));
    assert(cloudCalls[0].changes.some(row=>row.key===''&&row.value.join(',')==='alpha,beta,gamma'));

    await page.locator('#aether-multiview-launch').click();
    const root=page.locator('#aether-multiview');
    await root.locator('[data-amv-role]').first().waitFor();
    assert.equal(await root.getByRole('button',{name:'排序与备注',exact:true}).count(),0);
    assert.deepEqual(await errors,[]);
    console.log(width, '官网账号选择、旧备注沿用、官方切换、刷新与清除通过');
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({headless:true,channel:process.env.AETHER_TEST_BROWSER||undefined});
  try {
    for (const width of [1440,390]) await check(browser,width);
  } finally {
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
