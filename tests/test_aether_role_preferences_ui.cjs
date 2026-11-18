const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {chromium} = require('playwright');

const script = readFileSync(resolve(__dirname, '../AetherOS.user.js'), 'utf8');
const origin = 'https://game.diving-fish.com';
const accounts = ['alpha', 'beta', 'gamma'].map(username => ({username, name:username}));
const note = '每日小号 <b>材料</b>';

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
    return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><main id="app"></main>'});
  });
  const root = page.locator('#aether-multiview');
  const edit = root.getByRole('button',{name:'排序与备注',exact:true});
  const roles = root.locator('[data-amv-role]');
  const taskNames = () => root.locator('[data-amv-task]').evaluateAll(nodes => nodes.map(node=>node.getAttribute('aria-label')));
  const roleOrder = () => roles.evaluateAll(nodes=>nodes.map(node=>node.dataset.amvRole));
  const launch = async () => {
    await page.locator('#aether-multiview-launch').click();
    await page.waitForFunction(() => !document.querySelector('[data-amv-all]').disabled);
    if (!await edit.isVisible()) await root.getByRole('button',{name:'打开角色',exact:true}).click();
  };
  try {
    await page.goto(origin+'/aether/');
    await launch();
    assert.deepEqual(await roleOrder(), ['alpha','beta','gamma']);
    await edit.click();
    assert.equal(await root.getByRole('button',{name:'上移 alpha'}).isDisabled(),true);
    await root.getByRole('textbox',{name:'beta的备注'}).fill(note);
    await root.getByRole('button',{name:'上移 beta'}).click();
    await root.getByRole('button',{name:'保存',exact:true}).click();
    assert.deepEqual(await roleOrder(), ['beta','alpha','gamma']);
    assert.equal(await roles.first().locator('.amv-role-note').textContent(),note);
    assert.equal(await roles.first().locator('b').count(),0);
    await root.getByRole('button',{name:'打开全部',exact:true}).click();
    assert.deepEqual(await taskNames(), ['beta','alpha','gamma']);
    assert.match(await root.locator('[data-amv-task]').first().getAttribute('title'),/每日小号/);
    await root.getByRole('button',{name:'打开角色',exact:true}).click();
    await edit.click();
    await root.getByRole('button',{name:'上移 gamma'}).click();
    await root.getByRole('button',{name:'保存',exact:true}).click();
    assert.deepEqual(await taskNames(), ['beta','gamma','alpha']);

    await page.reload();
    await launch();
    assert.deepEqual(await roleOrder(), ['beta','gamma','alpha']);
    assert.equal(await roles.first().locator('.amv-role-note').textContent(),note);
    await edit.click();
    const input = root.getByRole('textbox',{name:'beta的备注'});
    await input.fill('还未保存');
    await root.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await roles.first().locator('.amv-role-note').textContent(),note);
    await edit.click();
    await input.fill('');
    await input.press('Enter');
    assert.equal(await roles.first().locator('.amv-role-note').count(),0);
    assert.equal(await root.locator('.amv-roles').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
    assert.deepEqual(errors,[]);
    console.log(width, '账号排序、任务栏同步、备注保存和清除通过');
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
