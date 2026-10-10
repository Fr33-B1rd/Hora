# 斯德哥尔摩真实服务配置

入口：<http://127.0.0.1:4318/#live>。使用 SEK 和 Europe/Stockholm。默认公共出发地是 Stockholm Centralstation，可在页面更换。

## 当前状态

2026-10-06 浏览器配置进展：当前 Google Cloud 项目为 My First Project。已确认启用 Google Calendar API、Places API (New) 和 Routes API。现有 Maps Platform API Key 已限制为 Places API (New) 与 Routes API，并在用户确认后写入本地 `.env`；本地服务已重启。真实 Places 查询成功返回 Stockholm C 和 Odenplan，真实 Routes 查询返回公交 595 线路（此次查询为 15 分钟，随出发时间变化，不是固定旅行时间）。Daylight Personal Assistant 的 OAuth 应用已创建，维持 External / Testing，已添加当前账户为唯一测试用户。Daylight Local Web OAuth 客户端已创建，凭据已写入本地 `.env`，仅允许 `http://127.0.0.1:4318/api/google/callback`，已标记为 AI agent client；用户确认后已完成 Google 账户授权，范围为 `calendar.events.owned`。真实 Calendar 只读查询成功；本次未创建、修改或删除任何日历事件。访问令牌按应用既有机制加密保存在本地数据目录。不要重复创建 Maps 密钥。凭据值不记入本文。

- Nebius / NVIDIA Nemotron 已使用现有项目的服务配置完成真实调用。凭据只在本项目 `.env` 中，不显示在浏览器。
- Google Places 与 Routes 已通过真实调用验证；Calendar 已完成真实账户连接与忙碌时段读取；用户确认具体验收安排后，真实主日历已完成创建、重复确认、会议重排更新及回读核对；35 项自动测试全部通过。2026-10-07 的四个验收事件按用户要求保留。
- 原有上海页面仍是虚构场景演示，与斯德哥尔摩真实服务页分开。

## 1. Maps

在 [Google Cloud Console](https://console.cloud.google.com/) 的项目中启用 Places API (New) 和 Routes API，设置计费与配额，然后创建服务器 API 密钥。限制该密钥只可调用这两个 API；它由本地 Node 服务使用，不是浏览器 JavaScript 密钥。

在项目 `.env` 填写：

```dotenv
GOOGLE_MAPS_API_KEY=你的服务器密钥
```

密钥无需也不应发到聊天。地点搜索每次返回最多 5 个结果；规划最多 36 次逐段路由计算；每段公共交通无结果时最多追加一次步行查询，故最坏为 72 次 Routes 请求。查询数量和 API 计费独立于 Nebius 的模型额度。

官方参考：[Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search)、[Transit Routes](https://developers.google.com/maps/documentation/routes/transit-route)。公共交通按每段实际出发时间请求，不使用中途 waypoint。电影场次、理发可预约时段和精确商品价格不来自地图。

## 2. Google Calendar

在同一项目中启用 Google Calendar API，配置 OAuth 同意界面；测试状态下把你自己的 Google 账户加入测试用户。创建 **Web application** OAuth 客户端，并登记完整重定向地址：

```text
http://127.0.0.1:4318/api/google/callback
```

填写 `.env`：

```dotenv
GOOGLE_CLIENT_ID=你的客户端ID
GOOGLE_CLIENT_SECRET=你的客户端密钥
GOOGLE_REDIRECT_URI=http://127.0.0.1:4318/api/google/callback
```

从 `127.0.0.1` 入口开始连接，避免 localhost 与 127.0.0.1 的 cookie 主机不一致。重新启动 Daylight，在「斯德哥尔摩」点击「刷新状态」，然后由你点击「连接 Google Calendar」并完成 Google 授权。

当前请求 `calendar.events.owned` 权限：Google 的授权范围覆盖你拥有的日历事件；实现只操作 `primary` 主日历，只更新本应用创建的事件。读取当天事件以识别忙碌和本应用活动；没有申请联系人、邮件或整个 Google Drive 权限。详见 [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) 和 [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)。

## 3. 使用与验证

1. 输入中文需求并生成三套方案。模型解析预算、日期、时间、活动、交通及出发点；程序查询真实地点，检查常规营业窗口、忙碌时段与逐段交通。
2. 比较并选择方案。金额均为用户可修改的预算预留，未查询商家价格；电影未自动查询实时场次。时间线提供 Maps 导航与商家官网入口。「把活动信息核实清楚」可录入具体场次／服务、价格及来源；已查阅与实际预订成功分开，应用后重新验证路线、预算和会议。
3. 可选锁定电影个人时间。勾选「待核实个人计划」后预览，再确认写入主日历；只有用户报告已购票／预约成功的事件移除暂定标记，所有事件保留稳定 ID 和 10 分钟弹出提醒，不发送邀请。
4. 在页内填入线上会议时间并重排，或在 Google Calendar 添加会议后点击「刷新日历并重排」。重排结果对比原方案/已写日历；保留锁定电影，不能排下时明确失败。变更再次预览确认后才写入。

Calendar 多项写入不是事务。部分失败时显示已成功事件，可重试同一预览。预览有效期 15 分钟，服务重启后仍可恢复；过期后重新生成/预览，同一天同类活动保持相同事件 ID。每种活动每天管理一个时间块，页内每天支持一场锁定的 Daylight 会议；其他会议在 Google Calendar 创建后刷新即可。应用不自动删除日历事件；想移除已写入活动或更改锁定会议，请先在 Google Calendar 处理。详见 [Create events](https://developers.google.com/workspace/calendar/api/guides/create-events)。

## 本地数据

`data/daylight.sqlite` 保存加密的 OAuth 令牌、事件编号与重试记录；`data/local.key` 是本地加密密钥。它们不经 HTTP 提供，并已加入 `.gitignore`。本机账户拥有整个文件夹时仍能解密，不应共享该目录。

Google 地点名称、评价、营业数据和路线详情仅保留于 15 分钟服务会话，不写入数据库。浏览器 sessionStorage 保存输入、候选会话编号、选择与确认摘要，刷新可恢复有效会话。SQLite 保存最小写入预览（活动编号、用户预留金额、时间、冲突检查快照及 Place ID），有效期 15 分钟；启动或创建新预览时清理过期预览。另保存最近确认的需求、日期、事件链接用于恢复。核实记录按日期与地点编号保存在本地，重启后重新生成会恢复；任何核实修订都会使旧候选与写入预览失效。已核实或锁定地点不在新的搜索候选中时，会用 Places Details 重新取得地点信息。断开连接清除本地令牌和写入预览，不删除 Google 事件；也可在 Google 账户撤销授权。

本版仅绑定 127.0.0.1。不要直接公开此开发服务器。公开部署还需要账户隔离、正式隐私政策、OAuth 验证和服务条款检查。页面提供 [数据说明](http://127.0.0.1:4318/privacy.html)；Google 数据展示规则参考 [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)。

## 本轮边界

新闻、定时推送、会议邀请、商家预约和支付尚未接入。下一阶段应接入带来源和发布时间的新闻数据；会议邀请需新增明确参会者预览；商家预约需商户侧授权与预约平台支持，不能由 Google Maps 代替。

## 内嵌路线地图

真实规划页在时间线旁显示 Google 地图。服务端从每次实际 Routes 查询取得路线及步行/公交分段折线；切换、核实或重排后按当前选中方案更新，包含返回出发点。地图不另算一套导航路线。缺失形状时明确提示，不用直线补齐。

启用 Maps JavaScript API，另建浏览器专用 Key：

- 网站限制：`http://127.0.0.1:4318/*`、`http://localhost:4318/*`。
- API 限制：仅 Maps JavaScript API。
- 本机配置：`GOOGLE_MAPS_BROWSER_KEY=浏览器专用密钥`。服务端 `GOOGLE_MAPS_API_KEY` 仍只用于 Places/Routes，不可复用。
- 可选 `GOOGLE_MAPS_MAP_ID`；本地原型默认使用 Google 的 `DEMO_MAP_ID` 以支持高级编号标记。

浏览器 Key 本来就是公开给页面的，须限制网站来源及 API。`/api/maps/config` 只提供浏览器 Key；若与服务端 Key 相同，视为未配置。地图 SDK 仅在有候选方案时加载；页面内切换方案和编辑表单复用同一个地图实例。没有配置或加载失败时，时间线和每段导航链接仍可使用。重新加载页面会产生新的地图加载，费用与 Routes 请求分别计算。

地图脚本、字体、底图与连接只对所需 Google 域名开放内容安全策略，不开放任意脚本来源；来源策略仅传递页面所在来源，不传完整路径。

参考：[Routes 路径形状](https://developers.google.com/maps/documentation/routes/traffic_on_polylines)、[浏览器密钥限制](https://developers.google.com/maps/api-security-best-practices)。

2026-10-06 配置完成：Maps JavaScript API 已启用；Daylight Browser Map Key 已按上述两项网站来源和单一 API 限制创建、保存并在真实页面验收。服务端密钥限制保持 Places (New) + Routes。
