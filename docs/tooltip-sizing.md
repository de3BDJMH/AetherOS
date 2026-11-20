# 悬浮提示持续缩小

0.25.0/0.25.1 为四列比较在 `.equip-tooltip-surface` 外层设置了 `overflow:auto`。长内容超出后，该元素成为滚动容器。官网使用的 Vuetify connected 定位从浮层自身开始寻找滚动边界，于是把浮层当作自己的视口，再扣掉两侧边距。后续 ResizeObserver、滚动或视口变化继续定位时，宽度会逐次减少。

修复将滚动和最大内容高度移到内部 `.equip-tooltip`。外层使用 `overflow:visible`，继续由官网控制定位。内部滚动区域是浮层的后代，不会出现在外层的滚动祖先列表中。比较表放在标题后，保证长说明时仍能先看到数值。

## 复现和验证

`tests/test_aether_equipment_compare_connected_ui.cjs` 从官网实际入口 bundle 中提取 connected 定位函数及 DOM/几何辅助函数，配合 Vue 测试运行库执行；没有替换定位计算或访问真实游戏 API。该测试资源只在本机使用，不把官网 bundle 发布到仓库。当前核对的入口为 `index-B9vVchcb.js`。上游版本变化后需要重新核对提取边界。

PowerShell 示例，先把公开入口文件下载到临时目录，再指定本机 Vue 运行库：

```powershell
curl.exe --fail --location https://aliyun-static.diving-fish.com/aether/web/assets/index-B9vVchcb.js --output .tmp/official-entry.js
$env:AETHER_TEST_OFFICIAL_ENTRY = (Resolve-Path .tmp/official-entry.js).Path
$env:AETHER_TEST_VUE_PATH = 'path/to/vue.global.prod.js'
node tests/test_aether_equipment_compare_connected_ui.cjs
```

测试使用 65 段长说明，在 1440、1280、390 像素宽度下执行首次定位与 18 次后续定位，并继续等待观察是否漂移。`AETHER_COMPARE_SOURCE` 可指定旧版源码做前后对照。

- 0.25.1 在桌面复现出 `412 → 364 → … → 28 → 26` 的宽度收缩，最终 max-width 为 0。
- 0.25.2 桌面和 iPad 宽度保持 460，390 窄屏保持 366；浮层在视口内，长内容仅在内部滚动，后续定位不会继续缩小。

这补上了之前固定位置模拟提示没有覆盖的自动定位反馈；不以纯数值计算性能测试代替浮层定位测试。

## 0.26.0 的高度约束

外层的最大高度使用视口减去两侧定位边距，内部最大高度再减去实测外层 padding、border 和内部 margin。这样旧定位写入的较小 max-height 不会裁掉新增表格，根元素的实际高度也包含整块内容。

回归测试原子地写入旧的 100 像素外层高度限制，再检查子内容不越出外框。0.25.2 可复现内容越界，0.26.0 保持完整。现覆盖 1440×850、1280×850、390×850、1280×420、390×420、1280×650 及右下／左上锚点，检查表格可见、整框在视口内、长说明末尾可内部滚动访问。
