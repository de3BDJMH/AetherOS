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
<style>.character-list{display:grid;gap:8px}.character-card{display:flex;min-height:58px;align-items:center;padding:8px;border:1px solid gray;text-align:left}.character-card__body{display:grid}</style>
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
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript({content:script});
  await context.route('**/*', route => {
    const {pathname, origin:host} = new URL(route.request().url());
    if (host === 'https://raw.githubusercontent.com') {
      return route.fulfill({headers:{'access-control-allow-origin':'*'},body:script.split('// ==/UserScript==')[0]});
    }
    assert.equal(host, origin);
    assert.equal(route.request().method(), 'GET');
    if (pathname === '/api/aether/account') return route.fulfill({json:{code:0,data:{characters:accounts}}});
    assert.equal(pathname, '/aether/');
    return route.fulfill({contentType:'text/html; charset=utf-8',body:fixture});
  });
  const native = page.locator('.character-gateway');
  const cards = native.locator('.character-card');
  const roleOrder = () => cards.locator('strong').allTextContents();
  const input = name => native.getByRole('textbox',{name:name+'的备注'});
  const grip = name => native.getByRole('slider',{name:name+'的排序位置'});
  const open = async () => {
    await page.getByRole('button',{name:'切换角色',exact:true}).click();
    await input('alpha').waitFor();
  };
  try {
    await page.goto(origin+'/aether/');
    await page.evaluate(note=>localStorage.setItem('aether-role-preferences-v1',JSON.stringify({order:['gamma','alpha','beta'],notes:{gamma:note}})),note);
    await open();
    assert.deepEqual(await roleOrder(), ['gamma','alpha','beta']);
    assert.equal(await input('gamma').inputValue(),note);
    assert.equal(await native.getByRole('button').count(),3);
    const inputBox=await input('alpha').boundingBox(), card=await cards.nth(1).boundingBox();
    assert(inputBox.x>card.x+card.width/2 && inputBox.x+inputBox.width<=card.x+card.width);
    assert(Math.abs(inputBox.y+inputBox.height/2-card.y-card.height/2)<2);
    await input('alpha').fill(note);
    await input('alpha').press('Enter');
    assert.equal(await page.evaluate(()=>window.selected),undefined);

    const handle=await grip('alpha').boundingBox(),target=await cards.first().boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
    await page.mouse.down();
    await page.mouse.move(handle.x+handle.width/2,target.y+target.height/2,{steps:5});
    await page.mouse.up();
    assert.deepEqual(await roleOrder(), ['alpha','gamma','beta']);
    assert.equal(await input('alpha').inputValue(),note);
    await cards.first().locator('strong').click();
    assert.equal(await page.evaluate(()=>window.selected),'alpha');

    await page.reload();
    await open();
    assert.deepEqual(await roleOrder(), ['alpha','gamma','beta']);
    await open();
    assert.equal(await native.locator('.aether-inline-role-tools').count(),3);
    assert.deepEqual(await roleOrder(), ['alpha','gamma','beta']);
    await grip('beta').press('ArrowUp');
    assert.deepEqual(await roleOrder(), ['alpha','beta','gamma']);
    await input('alpha').fill('');
    await input('alpha').press('Tab');
    assert.equal(await input('alpha').inputValue(),'');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('aether-role-preferences-v1')).notes.alpha),undefined);
    assert.equal(await native.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);

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
