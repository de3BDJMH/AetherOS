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
  const edit = native.getByRole('button',{name:'排序与备注',exact:true});
  const cards = native.locator('.character-card');
  const roleOrder = () => cards.locator('strong').allTextContents();
  const open = async () => {
    await page.getByRole('button',{name:'切换角色',exact:true}).click();
    await edit.waitFor();
  };
  try {
    await page.goto(origin+'/aether/');
    await page.evaluate(note=>localStorage.setItem('aether-role-preferences-v1',JSON.stringify({order:['gamma','alpha','beta'],notes:{gamma:note}})),note);
    await open();
    assert.deepEqual(await roleOrder(), ['gamma','alpha','beta']);
    assert.equal(await cards.first().locator('.aether-role-note').textContent(),note);
    await edit.click();
    assert.equal(await native.getByRole('button',{name:'上移 gamma'}).isDisabled(),true);
    await native.getByRole('textbox',{name:'alpha的备注'}).fill(note);
    await native.getByRole('button',{name:'上移 alpha'}).click();
    await native.getByRole('button',{name:'保存',exact:true}).click();
    assert.deepEqual(await roleOrder(), ['alpha','gamma','beta']);
    assert.equal(await cards.first().locator('.aether-role-note').textContent(),note);
    assert.equal(await cards.first().locator('b').count(),0);
    await cards.first().click();
    assert.equal(await page.evaluate(()=>window.selected),'alpha');

    await page.reload();
    await open();
    assert.deepEqual(await roleOrder(), ['alpha','gamma','beta']);
    await open();
    assert.equal(await native.locator('.aether-role-preferences').count(),1);
    assert.deepEqual(await roleOrder(), ['alpha','gamma','beta']);
    await edit.click();
    const input = native.getByRole('textbox',{name:'alpha的备注'});
    await input.fill('还未保存');
    await input.press('Escape');
    assert.equal(await cards.first().locator('.aether-role-note').textContent(),note);
    await edit.click();
    await input.fill('');
    await input.press('Enter');
    assert.equal(await cards.first().locator('.aether-role-note').count(),0);
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
