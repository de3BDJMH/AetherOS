# AetherOS

Aether 官网的用户脚本：把同一水鱼账号下的多个角色放进一个桌面，保留官方界面与手动操作。也提供原页面可用的背包筛选和装备置顶。

## 安装

[安装 AetherOS](https://raw.githubusercontent.com/de3BDJMH/AetherOS/main/AetherOS.user.js) · [版本记录](https://github.com/de3BDJMH/AetherOS/releases)

- 电脑：先安装 Tampermonkey，再打开上面的安装链接，确认安装。
- iPad / iPhone：安装 Safari 的 Userscripts 扩展并启用，打开安装链接，从 Safari 扩展菜单进入 Userscripts，确认安装；允许脚本在 Aether 官网运行。
- 登录 [Aether 官网](https://game.diving-fish.com/aether/)，刷新后点击官网顶部导航栏的“多角色同屏”。背包筛选无需进入桌面即可使用。

从旧版升级需要先手动安装一次本版。脚本识别名称仍为“Aether 多角色同屏”，保留原 namespace，方便覆盖旧版。若之前安装的名称已乱码，请停用旧脚本，避免重复运行。

## 功能

- 自由打开角色窗口，拖动、缩放、重叠、最小化和最大化；窗口各自调整页面缩放比例。
- 底部头像任务栏，支持分屏贴靠、九宫格、边缘吸附，保存窗口布局。
- 桌面中的空闲黑屏侧栏隐藏，剧情画面保留。
- 装备按名称、星级、元素筛选，支持按单件装备置顶；消耗品按技能书、光谱、其他分类并筛选。材料页保持原样。
- 筛选复用官网已加载的背包数据，不额外查询游戏接口；官网分页、提示和手动操作继续使用。
- 背包强化列表每页显示 30 件，支持名称、星级、元素筛选，减少重复强化时的装备行重绘。强化接口、连续强化和免费券继续由官网处理；已装备页保持原样。

强化优化作用于官网返回的渲染列表，首次进入页面仍可能有原始列表的挂载开销。父组件构建完整列表和官网状态请求也继续存在。详见[排查与验证记录](docs/reinforcement-performance.md)。

## 强化助手

选择装备后，原材料数量旁显示“期望≈… · 至多…”，估算从当前等级到下一级的消耗，已计入当前失败次数和保底进度。按接口返回的当前成功率与保底规则计算；没有有限保底时会明确标注。

勾选官网的免费强化券后，可设置“最多使用几张”（默认 1 张），点击“连续用券”开始。成功即停，两次请求至少间隔 0.5 秒，并等待上次结果和官网信息刷新；如果官网动画或网络更慢，会继续等待，不并发提交。只使用券，券不足不会改用材料。

运行时有独立停止按钮。停止不会撤回已经发送的那一次请求；遇到网络异常或结果无法确认会停止，不自动重试，应先检查本次结果。切换装备、角色或离开强化页后不再继续。页面刷新不会自动恢复用券。强化响应只在当前页面内存中用于计算，不上传或保存到磁盘。

## 更新

版本和安装文件均由本仓库提供。成功检查后 24 小时内不重复请求，失败后至少间隔 1 小时自动重试；只在外层页面检查，不让每个角色窗口重复请求。发现新版会提示“更新脚本”，点击后由脚本管理器确认安装，安装完成再刷新官网。

官网右侧导航按钮组的最左边提供“多角色同屏”和“检查更新”，无需进入桌面即可使用；窄屏显示为刷新箭头图标。桌面左下角角色菜单仍提供“检查更新”和当前版本号。电脑脚本管理器也可通过 `@updateURL`、`@downloadURL` 检查更新。iOS 扩展支持情况不同时，仍可使用脚本内提示和安装链接。

检查只匿名读取公开版本信息，不发送游戏 Cookie、账号令牌或角色资料，不会自动执行下载的代码，也不会为更新刷新游戏。

## 范围

脚本适用于一个水鱼账号下的多个 Aether 角色，不提供多个独立水鱼账号的登录隔离。装备穿戴、战斗和领取继续由你手动操作；连续用券需要主动点击启动，按数量上限执行。桌面会增加浏览器资源占用，按需打开角色即可。

本地仅保存窗口设置、角色用户名、背包筛选、置顶装备 UUID 和更新检查状态。不需要 Mugen Bot，也不需要内部 API key。官方页面结构变动后可能需要适配。

## 维护与测试

修改 `src/aetheros.js`。信息头中的 `@version` 是版本来源，发布前运行：

```sh
python tools/release.py
python tools/release.py --check
node --check AetherOS.user.js
```

生成文件保留 UTF-8 编码标记，并转义运行文案，避免中文乱码。

安装测试工具后运行以下六个隔离测试即可，不需要游戏账号：

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/test_aether_userscript_updates.cjs
node tests/test_aether_multiview_ui.cjs
node tests/test_aether_backpack_ui.cjs
node tests/test_aether_reinforce_ui.cjs
node tests/test_aether_reinforce_forecast.cjs
node tests/test_aether_voucher_ui.cjs
```

默认使用 Chromium；设置 `AETHER_TEST_BROWSER=msedge` 可使用本机 Edge。背包与强化测试只下载公开 Vue 3.5.26 测试运行库，也可用 `AETHER_TEST_VUE_PATH` 指定已有文件。测试拦截全部游戏请求，使用模拟角色和背包，不接触真实游戏数据。
