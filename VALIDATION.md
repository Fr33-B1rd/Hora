# Daylight verification

## Activity verification and calendar acceptance · 2026-10-06

- Added per-date, per-venue user verification: price and source independently from time, title/service, duration and time source. States distinguish unverified, checked but unbooked, and user-reported booked. No automated merchant booking or fabricated source confirmation.
- Applied prices replace allowances; verified times pin the venue/start/duration. Fixed information participates in budget, route, opening-hours and calendar feasibility checks. An infeasible verification edit is rejected atomically and retains the previously saved records. Already committed locks cannot be overwritten through this form.
- Verification records persist locally across restart. Sources stay local; Calendar descriptions include user-reported status, amount, title and checked time. Old previews are rejected after verification revisions. Places Details reloads pinned venues missing from fresh search candidates.
- **35 tests passed, 0 failed**. New tests cover acknowledgment and source requirements, date/place scoping, free versus unknown price, checked versus booked states, fixed movie repair, budget/conflict rejection, atomic HTTP save, stale confirmation rejection, restart restoration and metadata-preserving Calendar writes.
- Isolated browser acceptance on port 14332: entered an explicitly synthetic 17:00–19:00 movie and 250 SEK price/source; application updated timeline, locked movie and preview status; final confirmation returned success through the fake Calendar provider. This did not write any Google account data.
- Real service on port 4318 generated three proposals for 2026-10-07 from T-Centralen and exposed the new verification panel. Real prices, movie showtimes and appointment confirmation have not been supplied; they remain unknown in the live account. Real Calendar creation and repair/update were then exercised after the user explicitly confirmed the concrete plan.
- **Real Calendar acceptance passed:** initial 3 tentative events were created on 2026-10-07. A fresh preview and repeated confirmation of the same plan still returned exactly 3 Daylight events. Added the authorized 13:15–13:30 online test meeting, replanned and confirmed the update. Final API reread returned 4 distinct activity kinds: meeting 13:15–13:30, movie 14:01–16:01 locked and unchanged, ramen 16:07–16:52, haircut 17:02–17:47 (all Europe/Stockholm). Four events remain in the user calendar as requested. Evidence: `artifacts/calendar-live-acceptance.json`; intermediate reads: `calendar-live-initial.json`, `calendar-live-repeat.json`. No merchant booking, purchase, invitations or event deletion. Synthetic verification fixtures are not merchant evidence.
- Test service on port 14332 was stopped. Automatic approval blocked cleanup of its generated `artifacts/verification-ui-test` directory; that isolated test directory remains, with fake provider credentials/data only.

## Stockholm closed loop · 2026-10-06

- Implemented the main workflow: natural-language intent → up to three real venue/route proposals → explicit tentative-plan acknowledgment → Calendar preview → confirm → meeting repair with locked commitments and before/after differences. The Shanghai fixture remains separate.
- Final automated suite: **30 passed, 0 failed**. Syntax checks passed for frontend and HTTP modules. HTTP end-to-end verification uses an isolated fake provider and temporary SQLite, covering generation, draft differences, acknowledgment, no writes during preview, confirmation after server restart, stable IDs, repeated confirmations, meeting repair, and newly appearing conflicts. Calendar unit tests additionally cover partial/lost-response recovery and manual-edit protection.
- Real browser validation used the exact T-Central Chinese sentence, 1000 SEK and 13:00–20:00. Actual Nemotron, Places, Routes and Calendar read returned three proposals. Final compact proposal used Tokyo Ramen → Filmstaden Sergel → Salong Alexander and returned at 16:57. These are query-time suggestions, not merchant bookings or verified film showtimes.
- Google sometimes returns no transit route between nearby places. The adapter now queries WALK explicitly in that case, labels the result, and never turns a provider/authorization failure into fabricated travel. All-walking routes carry zero transit fare. Walking duration is aggregated before rounding so it does not exceed total movement time because of step rounding.
- In the real UI, a 13:15–13:30 meeting caused ramen and haircut to move after the movie while the movie remained 14:01–16:01. The page showed before/after differences and three repaired proposals. No real calendar event was written.
- Final real-account preview successfully displayed the three tentative personal blocks and final confirmation button. Screenshot visually reviewed: `artifacts/journey-calendar-preview.png`. Real Calendar creation/update remains unexercised in this turn; mutation and retry evidence is from isolated providers.
- Reload after a server restart preserved user input and clearly required candidate regeneration. Minimal unexpired confirmation previews survive restart; raw Places text and route detail are not persisted. Expired previews are pruned on startup/new preview; disconnect clears outstanding previews.
- Limits: amounts are user-editable planning reserves; film showtimes, exact prices and merchant availability are not fetched. Known weekly hours constrain proposals; missing hours stay visibly unknown. This is a local personal-calendar planning loop, not merchant booking, news delivery or background monitoring. A managed meeting is a single locked block per day; additional external Calendar meetings are read as busy intervals. If a locked venue is absent from fresh search candidates, planning stops explicitly instead of moving it.

Earlier evidence below is historical and superseded where this section differs.

## Stockholm input and navigation repair · 2026-10-06

- Reproduced the reported browser state: URL still `#live`, visible page was the Shanghai fixture planner, and its model response rejected SEK. Navigation had changed the in-memory view without updating the URL.
- The default page and main “规划行程” navigation now open the Stockholm workflow. Shanghai fixture pages have explicit demo labels; hash navigation, browser history and reload use the same view.
- Live model schema now accepts a bounded departure-place query. Supported Stockholm currency aliases include SEK and 瑞典克朗. No generated coordinates or place IDs are trusted: all locations come from Google Places.
- The submitted intent now updates constraints and searches departure/haircut/ramen/cinema candidates. A unique departure match can be selected automatically; multiple matches remain choices. Each failed search is reported individually. Missing prices, windows and cinema showtime are displayed before route generation can proceed.
- `node --test tests/*.test.mjs`: 24 passed, 0 failed. The new regression checks SEK context, departure query propagation and validation, and separation from the Shanghai model schema. Syntax checks passed for edited modules.
- Browser navigation verified `#planner` for “上海演示”, then `#live` for “规划行程”. Real Nebius + Google calls using the user's exact T-Central sentence produced 1000 SEK, 13:00–20:00, three departure matches and five candidates for each activity. Default local date was changed to Stockholm today.
- No calendar events were written and no merchant availability or ticket purchase was claimed. Complete route planning still requires the user's selected venues and verified activity conditions.
- Final browser recheck used Stockholm today (2026-10-06), preserved the exact input and candidates after browser Back, and kept route generation disabled until required details are provided. Screenshot capture was unavailable in this browser session; verification used rendered DOM/accessibility state, not a visual screenshot.

## Google configuration and live Maps · 2026-10-06

- Saved the existing Maps key to ignored local `.env` after user confirmation; restricted upstream to Places API (New) and Routes API. Restarted only the Daylight server on port 4318.
- Real adapter queries returned Stockholm C and Odenplan. Real transit routing returned bus 595 from Centralen to Odenplan: 15 minutes total, 3,029 meters, 9 minutes walking for the requested departure. Fare was absent (`{}`); no fare or budget completeness is claimed.
- Browser search through the local app returned Stockholm C and updated the Maps status to queried. Screenshot: `artifacts/google-maps-live.png`.
- OAuth branding exists in External / Testing with one test user. Daylight Local Web OAuth client created after confirmation, credentials saved locally, and server restarted. Final Calendar consent completed after explicit scope confirmation. The browser returned to Daylight, displayed authorized status, and successfully read the selected day’s availability. No personal event content is recorded here, and no calendar events were created, changed, or deleted.

- Final proof: `artifacts/google-services-connected.png`. Scope declaration is limited to `calendar.events.owned`; application remains in Testing. Real calendar writes and merchant appointments are not verified by this connection test. No application code changed during credential setup.

## Previous integration evidence · 2026-10-05

## Stockholm integration update

Environment: Windows, Node.js v24.19.0. Running at `http://127.0.0.1:4318/#live`.

`node --test tests/*.test.mjs`: **23 passed, 0 failed** after the final backend changes.

Current evidence:

- Actual Nebius / NVIDIA `nvidia/nemotron-3-super-120b-a12b` request parsed a synthetic Stockholm afternoon into 800 SEK, 13:00–20:00, public transit, haircut/ramen/movie. Tool name was `propose_constraints`; program validation ran. Direct call: 1,061 reported tokens, 3,133 ms.
- Browser submitted the same synthetic request through the real local HTTP service. The UI displayed 800 SEK, 13:00–20:00, and tomorrow as 2026-10-06. The current server status changed from configured to tested. No real places, account information or calendar contents were included.
- A separate real HTTP/model call for immediate ticket purchase/payment returned `supported:false`. 981 reported tokens, 2,936 ms. No external-action tools exist on the model surface.
- Google adapter tests use mocked responses, not live Google accounts. They cover field masks, actual-departure single-leg routing, scheduled transit wait plus final walking, absent fares, provider failure, budgets, unavailable windows and fixed cinema locks.
- Stockholm timezone tests cover summer/winter offsets, rejected ambiguous/nonexistent wall times, and 23/25-hour DST days.
- Calendar mocked tests cover PKCE and one-use cookie-bound state, read-only availability, stable Google-compatible IDs, no invitations, conflict rejection before writing, locked activity protection, manual edits after preview, partial success retry, lost-success-response reconciliation, all-day events and encrypted persistent token storage.
- HTTP tests cover cross-origin mutation rejection, missing-map-key errors without fixture fallback, rejected invented confirmation tokens, and private `.env`/SQLite/key-file isolation. Test server uses an isolated temporary data directory.
- Browser showed Google Maps as waiting for a key and Google Calendar as waiting for OAuth configuration, with unavailable actions disabled. At a requested 390 px mobile viewport, document/client widths both measured 375 px (scrollbar excluded), with no horizontal overflow. Viewport was restored. No captured error-level browser logs during checked interactions.
- Screenshot: `artifacts/stockholm-integration.png`. Existing Shanghai fixture workflow remains independently available.

### Not yet live-verified as of 2026-10-05 (Maps superseded above)

Google Maps key and Google OAuth client credentials were absent. Consequently there has been **no real Places/Routes response, Google consent flow, calendar read or external calendar write** in this update. Mock tests do not establish actual Stockholm transit coverage, price accuracy or OAuth project configuration. Complete [GOOGLE_SETUP.md](GOOGLE_SETUP.md) before live acceptance.

This release supports selecting venues and entering verified estimates/windows. It does not discover merchant appointment slots or film showtimes automatically. Calendar busy intervals are treated as online meetings at the current location. Routes are provider estimates; known travel fares plus user-entered activity estimates are not a guaranteed total. Google writes are not atomic; successful event IDs survive retries, and external changes are rechecked before writes. No background calendar watcher, multi-user deployment, news data, merchant booking/payment or attendee invitation implementation is included.

## Historical fixture verification · 2026-10-04

Environment: Windows, Node.js v24.19.0. Local service: `http://127.0.0.1:4318`. No external model credentials configured; all observed behavior used explicit demo mode.

## Automated checks

`node --test tests/*.test.mjs`: **10 passed, 0 failed**. Syntax checks passed for the server, application and planner modules.

- Three distinct default proposals, with enough return-time margin for the relaxed proposal.
- Independent checks of budget, requested activities, opening windows, travel duration, arrival buffer, fixed showtimes, meetings and return deadline across 72 budget/start/deadline/transport combinations.
- Added meeting repairs a previously valid plan while preserving the locked cinema and start time.
- Meeting overlapping the locked movie yields no feasible plan and a specific explanation; removing that requested activity cannot silently erase the commitment.
- Invalid budgets/times and stale or altered proposals cannot be approved.
- Bounded Chinese input parsing, including spaces in `晚上 7 点前`; unsupported booking requests are declined.
- Calendar UID stability, Shanghai-to-UTC conversion, newline escaping and UTF-8 line folding.
- Real local HTTP requests validate demo status, parser results, input limits, origin checks and private-file isolation.

## Browser walkthrough

Used the Codex in-app browser against the running local service.

| Flow | Observed result |
| --- | --- |
| Overview and planning pages | Rendered; three proposals, timeline, SVG route and explanation available. |
| Natural-language request | Parsed supported activity/constraint fields. `预算 20 元，晚上 7 点前回家` resulted in ¥20 / 19:00 constraints and an explicit infeasible state. |
| Confirm initial proposal | Local itinerary and reminder items created, with movie lock. |
| New 14:00–15:00 meeting | Preview changed ramen from 13:18 to 15:00 and haircut from 14:22 to 16:04; city cinema stayed 17:00–18:50. |
| Apply repair and reload | Meeting and repaired activities persisted; locked movie remained 17:00. |
| New 17:15–17:45 meeting | Explicit direct conflict with locked 17:00–18:50 cinema; no automatic replacement. |
| Add memory | New personal note displayed; identified as a note that does not participate in itinerary filtering. |
| Activity reminder | 10-second page-local timer displayed the rest reminder. |
| Narrow viewport | At requested 390 px viewport, content/client widths both 375 px after scrollbar; no horizontal overflow. Bottom navigation and stacked itinerary rendered. Temporary override reset. |
| Calendar export | Export handler and feedback ran. Browser automation timed out while capturing the download event, and no downloaded file path was verified. ICS generation is covered by automated checks; import into a third-party calendar remains unverified. |
| Browser errors | No captured error-level console messages during the checked workflow. |

The in-app browser's pointer automation sometimes hit a different position; keyboard activation was used for the verified interactions. The normal viewport screenshot was saved to `artifacts/daylight-preview.png`. Test-created user state was reset and the overview tab left open for the user.

## Remaining boundaries

Nebius live inference, provider error responses from the actual service, external maps, news feeds, real bookings/payments/invitations, external calendar imports and background scheduling were not exercised. The demo does not claim these integrations are active. Automated checks establish correctness of the bounded fixture workflow, not real-world trip feasibility or broad assistant capability.

## 2026-10-06 内嵌路线地图验收

- 自动测试 40/40 通过。新增真实响应字段映射、Google 标准折线解码、缺失/损坏路径处理、分段交通方式、顺序/返回段，以及浏览器密钥隔离测试；原活动核实、重排、日历重复确认测试保持通过。
- 用户确认后启用 Maps JavaScript API，创建 Daylight Browser Map Key 并保存至本机 .env。Google Cloud 回读确认仅限 Maps JavaScript API 和 http://127.0.0.1:4318/*、http://localhost:4318/*；未复用或扩大服务端 Maps 密钥。
- 在真实 4318 服务通过浏览器生成 2026-10-07 斯德哥尔摩三套方案。Google 底图、起终点与三个编号标记、四段真实路线成功显示。紧凑方案通勤 13 分钟、17:49 返回；口碑方案通勤 18 分钟、17:54 返回。这是本次查询结果，不代表固定班次或未来价格。
- 切换口碑方案后，地图地点顺序从电影/拉面/理发变为电影/理发/拉面；编号、时间列表与返回段同步更新。点击第 2 站地图标记，时间线出现 map-selected；键盘选第 4 段显示 Tokyo Ramen → T-Centralen、17:50–17:54。
- 真实「刷新日历并重排」后，地图会话编号变化，绘制 14 个实际路径分段、4 段行程；锁定电影仍为 14:01–16:01。没有确认写入任何日历变更。
- 当前浏览器 959 CSS px 下验证地图在时间线上方、地图折叠/展开及全程适配；额外请求视口覆盖未改变实际宽度，因此未声称完成手机/宽桌面实机验收。对应响应式样式已提供。
- 无 Key 时明确显示未配置，路线详情与外链保留；不把地点直线连线当成真实道路。Google API 偶发超时和 Cloud 页面加载失败经重试恢复；不伪造离线服务结果。
- 截图：artifacts/maps-live-completed.png；Cloud 限制回读截图 artifacts/maps-key-saved.png。截图不包含密钥值。

官方接口依据：[路线折线](https://developers.google.com/maps/documentation/routes/traffic_on_polylines)、[地图脚本加载](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)、[高级标记事件](https://developers.google.com/maps/documentation/javascript/reference/advanced-markers)、[CSP](https://developers.google.com/maps/documentation/javascript/content-security-policy)。

## 2026-10-07 语音对话入口验收

- 自动测试 46/46 通过，含 6 组语音测试：显式启动、临时/最终转写区分、累计结果不重复、权限拒绝、取消与晚到事件、60 秒收音及停止超时、朗读与收音互斥、严格命令分流和基于实际方案的回复。语音 API 使用注入的模拟对象测试；这些测试不等于真实麦克风识别成功。HTTP 检查新增两个语音模块可正常加载。
- 当前 Codex 内置浏览器显示可用的「开始说话」和朗读控件；测试未启动麦克风、未授予新权限、未录制用户环境音。真实声音识别、发音质量和浏览器语音服务连通性仍待用户试说验收。
- 在语音转写文本框手动输入完整 Stockholm 请求，实际调用 Nemotron、Google 地点/交通和日历只读检查，返回 3 套方案与文字对话回复。
- 输入「选择第二个方案」后，选中口碑优先，时间线与地图同步为电影 → 理发 → 拉面、4 段路线；本次结果 17:54 返回。电影仍锁定为 14:01–16:01。
- 追加「预算改为900瑞典克朗，其他不变」后，上限从 1000 改为 900 SEK，保留 T-Centralen、2026-10-07、13:00–20:00 和三个活动，再次生成三套真实候选。
- 「刷新日历并重排」通过同一操作入口实际完成，地图显示新方案，回复明确尚未写入。输入「确认写入日历」仅返回手动预览确认说明，预览按钮保持禁用，没有出现最终确认按钮。本轮未调用真实日历写入。
- 点击「朗读回复」后页面进入正在朗读并提供停止按钮，随后停止/完成恢复。未对扬声器实际音频做听觉验收。检查时未捕获浏览器 error 日志。
- 修正中文输入法组合输入期间重建文本框的问题；对话新回复自动滚动到末尾，普通重绘保留用户查看历史的位置。当前桌面布局已查看，截图为 artifacts/voice-ui.png；未声称完成所有浏览器或移动端语音验收。
- 使用方式与兼容性边界见 README「语音对话」，数据处理说明已更新 privacy.html。该版是手动收音、确认转写后发送的行程对话，不是持续监听或实时语音通话。

## 2026-10-07 浏览器识别网络错误修复

- 用户在内置浏览器实际点击收音后收到 SpeechRecognition 的 network 错误。页面回读证实错误来自识别环节；没有足够证据确定具体远端网络/浏览器服务原因。上节仅做模拟识别测试的限制在此暴露。
- 将默认识别链路替换为 MediaRecorder → 本机 Daylight → faster-whisper small CPU int8。没有继续依赖浏览器 SpeechRecognition，也没有云端自动回退。只监听原 127.0.0.1 服务，无新公开端口或凭据。音频以内存 JSON/base64 和私有子进程标准输入传递，不写录音文件；子进程强制离线加载模型。
- 在独立 .venv-voice 安装运行组件，下载模型文件 model.bin 483,546,902 字节。最初 PyAV 19 与 faster-whisper 1.2.1 不兼容（metadata_errors 参数），固定为 PyAV 16.0.1 后重新验证。setup-voice.ps1 和 voice-requirements.txt 可复现安装，不修改原 Anaconda 包。
- 用 Windows 本机语音合成制作非私人测试句 Select plan two：1.98 秒 WAV 经真实 HTTP 接口识别为 Select plan 2.，耗时约 1.20 秒；转换为 WebM/Opus 后同样正确，约 1.05 秒。2 秒静音返回空文本，前端按没有听清处理。测试样本在 artifacts/voice-local-sample.wav、voice-local-sample.webm、voice-local-silence.wav，仅为人工合成测试数据。
- 用户亲自使用麦克风确认“能录音，转写也正确，但是繁体字”；页面回读草稿为「選擇第二個方案」。随后对中文输出加入 OpenCC t2s，单独核对「選擇第二個方案，預算九百瑞典克朗，請重新規劃行程。」正确转为简体。现有草稿通过页面改为简体，未提交请求；新录音由服务端自动转换。没有保存或重放用户音频。
- 最终 Node 自动测试 51/51 通过，新增录音停止后释放麦克风、权限等待取消、取消转写忽略晚到文本、错误分类、音频大小/语言验证、跨来源拦截、英语数字词及繁体选择指令。模型更新后 WebM 真实接口再次返回 200 和正确文本；服务回读 configured=true、ready=true。
- 页面显示「本机语音已就绪」；录音最多 60 秒、4 MiB，单个转写请求最多 120 秒，停止录音后才转写。取消或切后台会停止录音并中止请求。未改变日历确认逻辑，也未进行任何真实日历写入。本节替代上节中依赖浏览器云识别的现状描述；不宣称已做大规模口音、噪声或长录音准确率评测。
- 截图：artifacts/voice-local-ready.png。README 和 privacy.html 已同步数据边界及简体输出规则。


## 2026-10-07 生成行程 Failed to fetch 修复

- 排查时 4318 端口没有监听者，之前临时运行会话已不存在；网页保留旧界面，点击产生浏览器 Failed to fetch。现有日志没有提供确定的进程退出原因，因此仅确认服务停止，不将模型或 Maps 故障作为原因。
- 启动器新增独立后台模式，start-demo.bat 默认使用；启动后父启动命令已退出，在后续独立命令中仍确认 127.0.0.1:4318 同一进程监听并成功响应。重复运行启动器返回已运行，无额外监听进程。未配置开机启动、公开网络监听或自动监控。
- 新增 stop-demo.bat/ps1，读取本地进程记录并比对进程名及启动时间后停止；未在用户正在使用的服务上执行停止验收。
- 请求失败提示改为本机服务连接断开及启动入口，保留已有输入、候选与写入预览；不自动重发日历写入。
- 刷新后从浏览器点击生成三套行程，实际返回三套 Stockholm 方案，900 SEK 预算和原日期/需求保留，地图显示路线。本次未确认或写入日历。


## 2026-10-07 对话入口与本地发现

- 新增 `/api/chat`：模型维护本轮 slots，缺少预算、地标、日期、时段或少步行的分钟上限时追问；有效条件经短期 token 交给现有确定性规划器。模型只可提议回复、规划、查询活动/新闻、选择/读取方案或重排，不暴露日历确认/支付/预约工具。
- 真实浏览器按用户示例进行了四轮文字对话：三项活动 → 1000 kr/少走路 → T-Central、13:00–20:00 → 累计20分钟。得到三套方案，步行分别13/18/13分钟，预算上限1000 SEK；地图四段路线与候选一致。原14:01–16:01锁定电影保留，13:15–13:30会议避开。本轮没有真实日历写入。
- 同一段对话继续询问本地新闻与附近活动，真实读取 Visit Stockholm 页面和 SVT Stockholm RSS。最终返回4条活动、3条新闻，显示原题、机器翻译、来源链接、活动日期或发布日期、直线距离和查询时间。新闻只读取RSS标题及摘要，不宣称读过全文或进行独立事实核查。机器翻译可能生硬，应以原文为准。
- 标题翻译最初未返回预期JSON，改为强制结构化工具响应，并提供RSS摘要用于消歧。来源URL、日期、位置始终由来源适配器保留，不接受模型改写。失败时明确提示并保留原题；不换成示例新闻或假活动。
- 页面主导航改为「助手对话」，文字与录音转写共用同一个发送入口和会话。刷新后聊天内容和条件恢复；「新对话」只清除聊天，不改日历。麦克风识别沿用已经由用户验收的本机Whisper，本轮未重新采集用户语音；不宣称实时双向语音通话。
- 最终58/58自动测试通过，记录在 artifacts/conversation-tests.txt。新增多轮缺失信息、字段保留、事件日期/距离/类别、RSS来源与时效、翻译不可改来源、累计步行包含返回段，以及对话token到真实规划接口的模拟HTTP链路零日历写入检查。
- 服务通过项目后台启动器重启并继续监听127.0.0.1:4318。无需额外新闻Key。外部源格式变化、配额和模型质量仍是原型限制；目前活动只有官方精选，不等于全量城市活动。

- 最后从新闻话题切回行程，仍保留1000 SEK、20分钟步行及13:00–20:00时段，重新生成成功；再通过聊天选择第二方案，实际选中「口碑优先」，地图同步，18分钟步行、17:54返回。截图：artifacts/conversation-ready.png。


## 2026-10-07 自由活动与不限预算修复

- 根因：原状态将预算限制为数字/null，将活动限制为hair/ramen/movie；null被当作未回答。现改为unknown/limited/unlimited/flexible预算状态，以及最多4项通用活动（稳定id、名称、搜索query、估计时长、费用预留）。不限预算不替换成10000等虚构上限，之后可通过对话改回明确金额。
- 活动先后关系以有向边表示，校验重复/非法id和顺序环；每套候选与重排都过滤不符顺序的活动排列。中餐使用Chinese restaurant搜索条件，咖啡和书店同样走通用描述，不新增类别白名单。
- 少步行是软偏好，候选比较使用实际路线步行分钟；只有明确分钟数才设硬上限。候选和路线查询次数仍有限，不声称全局最优或全城覆盖。
- 模拟测试通过后，真实Nemotron验收发现稀疏patch会漏提取今天、活动列表或预算模式。改为要求完整状态字段、集中提示日期和顺序；最新真实API检查已正确提取今天博物馆→中餐、明天咖啡→书店/预算先看建议，以及完整单句不限预算需求。证据：artifacts/flexible-live-eval-final.json。此前失败记录保留，不能只凭模拟测试推断模型理解可靠。
- 真实浏览器三轮：今天博物馆然后中餐 → 没有预算限制 → T-Central、10:00–20:00、尽量少走路。预算回答后继续询问地点和时间，不再重复预算；取得3套真实Google地点和路线。实际候选包含Paradox Museum Stockholm、National Museum、Tang和Weidao；累计步行11/13/11分钟。费用为临时预留，未查商家报价，不作为真实消费结论。
- 原日期有旧电影、理发、拉面与会议。无关旧活动作为忙碌时间保留，结果提示保留数量；博物馆安排在上午，中餐因营业窗口和已有安排排到晚间。未自动取消旧行程，未声称已补全旧活动通勤。本轮未执行真实日历写入。
- 地图、朗读、核实面板、费用设置和日历预览都使用通用活动名称；不用undefined或内部id展示。用户预算不限仍需日历预览确认，不授权购买或预约。
- 自动测试65/65通过，记录artifacts/flexible-tests.txt。新增不限/建议/改回上限、多轮字段保留、通用搜索、顺序与循环拒绝、无限预算下高额预留、软/硬步行偏好、旧活动避让、通用日历标题、保留旧事件与重试幂等。模拟HTTP完成旧三项活动与新博物馆/中餐共存，并确认旧事件内容不变；这些日历写入仅在隔离模拟提供器中执行。


## 对话流程与结果复核修复（2026-10-07）

- 状态提取与回复生成分开：缺项由程序判定，模型承接回答；预算不再作为必填阻塞。最终解释基于服务器保存的结果，不能通过语言步骤修改状态或写日历。
- 真实 Nebius 多轮验证：KFC → KTH → 纪念品；“暂时没有规划预算”得到 flexible；“从tCentral出发”保留活动、品牌和顺序；“没有限制”“时间你来安排吧”得到暂定时间；“早上八点出发晚上12点回来”得到08:00–24:00。另测“我不确定要花多少钱，你先给建议”。结构化输出见本机 artifacts/agent-dialogue-live.json、agent-dialogue-variants.json。
- 浏览器真实 Maps/Calendar 只读验收：08:00–24:00生成三套候选，首站为真实KFC（Liljeholmsgränd 7），第二站KTH，第三站纪念品商店；没有使用麦当劳替代KFC。显示08:15–09:00等待营业与12:17–17:50的日历间隔。原三项活动保留导致位置衔接未核实，页面和回复说明暂不能保存。
- 指定名称无匹配时，最多追加一次精确名称搜索。用户委托时间而暂定窗口排不下时，最多扩大时段重试一次，累计路线请求不超过36次；明确指定的时间不自动扩大。
- 75/75自动测试通过，artifacts/agent-dialogue-tests.txt。新增测试包含品牌不符、精确重试、午夜日期、灵活预算/时间、回复失败回退、空档和衔接标记；HTTP验收同时验证未核实衔接时预览被拒绝，旧事件和写入次数不变。
- 验收中发现并修正了叙述把助手暂定时段称作用户指定时段的问题；无方案的回复也携带时段来源。自动测试中的模型和日历写入是模拟，真实语义验证单独记录，不以测试数量代表所有自然语言可靠性。
- 本次未写入或删除真实Google Calendar事件，未预约商家，未录音。真实麦克风本次未重测，文字与语音共用对话发送路径。
- 边界：名称匹配依赖模型提取正式名和别名，无法保证所有自然语言都无误；回复语气仍受模型影响。校园进入权限、纪念品库存和实际价格仍待核实。尚未自动把旧线下活动地点接入全天路线，以阻止未验证预览的方式明确该限制。

- 最后复测补充：每轮只应用 `changedFields` 声明的用户更新，时间调整不再覆盖活动时长与指定品牌；真实模型三轮中30/60/45分钟估计和KFC/KTH名称保持不变，见 artifacts/agent-dialogue-final.json。解释步骤不再接收逐站时刻，拒绝含结果未提供时刻的叙述，以免混淆交通与参观时间；详细时刻以确定性时间线为准。


## 2026-10-07：按需 skills 与模型执行循环

本轮主对话迁移至 `/api/agent`，不是旧 `/api/chat` 提取字段后固定追问的改名。项目内4个SKILL.md由运行时按需加载，并实际控制工具可见范围。网页沿用文字/本机转写输入，展示动作记录并采用服务端检查的方案和地图。

自动化：`node --test --test-timeout=45000 tests/*.test.mjs`，88/88通过，见 `artifacts/agent-runtime-tests.txt`。新增覆盖 skill 白名单、任意路径/未授权写入拒绝、搜索与选择分离、观察后改查询、约束变化后的有效重试、稀疏状态与暂定条件保持、日历私人字段最小化、执行上限、完成检查退回遗漏，以及 agent 方案进入已有预览接口而没有日历写入。4个skills均通过skill-creator格式校验。

真实模型与真实数据：`artifacts/agent-live-outing-v2.json`记录一次真实模型、Maps和日历读取的完整结果，包含T-Centralen起点、先书店后咖啡和两套候选。独立网页验收中，模型收到“37分钟步行太多”的反馈后重新搜索，改为Adlibris Pocket与Vete-katten Centralen，实际路线累计步行5分钟，保留先后顺序和13:00出发；地图同步。没有真实日历写入。

真实模型与隔离数据：`node --env-file=.env scripts/agent-live-smoke.mjs --live`已运行，见 `artifacts/agent-live-controlled.json`。地图/日历是明确的虚构provider观察，只有模型调用真实。首次指定书店查询返回不同名称，模型自行换查询、选中正确店名、规划；完成检查曾退回营业时间冲突，模型修订时间并重新规划。此结果验证调用与纠错路径，不证明该虚构书店存在。

真实验收也发现并保留了限制：早期版本搜索隐式改起点、无状态版本的防重复拦住合理重试，已修正。模型曾漏做选择第二套方案并声称检查完成，因此增加了独立完成检查；检查器本身也会误判，曾把已有查询说成未执行，现改为传递已解析观察、成功动作及当前选择，剔除历史助手回复的干扰。它仍是概率性检查，不能作为语义正确性的保证。模型回复仍可能冗长、误称暂定条件为用户条件或混淆交通偏好与实际步行；以地图/时间线的已计算事实为准。这些不是测试全通过就能消除的问题。

本轮未重新验收真实Google Calendar写入；写入安全回归使用隔离provider，真实调用保持只读。实际余票/座位/库存/参观权限仍没有自动核实能力。直接完整需求表单及手动核实/会议重排按钮保留原接口，只有主对话切至新agent。


最终版本复验补充：带完成检查的主对话已重新生成两套实际候选（T-Centralen → Adlibris Pocket → Vete-katten Centralen → T-Centralen），保留明确先后顺序与13:00–18:00窗口，网页地图显示真实步行路线。`artifacts/agent-live-discovery-reviewed.json`记录了完整的新执行循环：模型加载local-discovery，实际查询SVT与Visit Stockholm，返回7张来源卡片，修正无效/过长回复后通过完成检查，最终回复同时涵盖新闻与活动。正文中的新闻/活动不是预置demo文案。


### 未通过的最终复合指令验收

“选择第二套方案，检查两项活动的核实状态和日历变更。只检查，不要保存。”未稳定通过。一次完成检查正确发现漏选；进一步复验时模型只调用finish、自然语言声称已切换，检查器错误通过，而页面仍选中第一套。没有把这次计为成功，也没有手工点击第二套来替代agent执行。该失败说明：工具回路和skills已经实际运行，但当前模型对复合目标的执行及语义完成检查还不够可靠，88项确定性测试不覆盖这一可靠性结论。

已改善技能可发现性：plan-outing简介明确支持已有方案选择；verify-activity及calendar-review共用只读的select_plan工具，并说明跨skill任务组合。上述文件在下一轮动态读取，无需服务器重启。当前已知遗漏仍需后续解决，不能据本轮宣称完整自由对话或复合任务验收通过。


## 2026-10-07：无结果回复、工具依赖与活动证据修正

- 不新增按用户措辞匹配的分支；模型仍自行选择调查和下一步。每个工具观察附完整前置条件与当前选择，规划前一次性列出全部缺项；调整估计时长/金额保留地点查询结果并使旧日程失效。
- 运行循环预留最终回复和核对机会。额度、网络或核对失败时，程序使用最新且未过期的结果解释具体冲突和下一步；条件变更后不再拿旧冲突当当前事实。
- 新增活动 `availability` 语义分类（地点访问/需具体场次）；分类由模型完成，场次是否核实由本机有日期和地点的用户核实记录决定。未核实场次的可行路线标为草案，前端及预览接口阻止保存，核实表仍可用。普通地点访问保持暂定个人时间块语义。
- 首轮真实模型复验仍失败：模型抄错 Google 长地点 ID，多次查询后仍无法绑定。失败记录保留在 `artifacts/agent-food-recovery-live-first-failure.json`。随后为模型观察引入短地点句柄，宿主解析真实 ID；已查询地点与句柄随进度提供，未知句柄仍被拒绝。
- 自动化：95/95通过，见 `artifacts/agent-recovery-tests.txt`；新增单次完整预检、估计调整保留候选、短句柄映射、场次证据状态、额度收尾、零方案后网络失败保留真实日历冲突、旧结果失效等测试。隔离HTTP测试还验证草案预览400，应用用户场次证据并重排后预览200；写入次数始终0。4个skills通过格式检查。
- 最新多轮历史回放在日期缺失时正常结束并询问日期，见 `artifacts/agent-food-recovery-live.json`；这次只验证了澄清，不算完整规划成功。完整请求网页复验结果另附。
- 本轮真实服务调用仅搜索、模型推理和日历读取，没有确认写入、预约或购票。真实工作坊场次仍没有自动官方页面核实能力；语义分类和模型完成检查并非可靠性保证，不能宣称自由对话已全面验收。


最终网页复验（真实模型、Maps、Google Calendar读取）：完整美食请求在18条处理记录后正常返回，所有出发点/活动地点完成绑定；市场名称别名不符曾被拒绝，模型纠正后继续。只进行了一次实际排程调用，结果为0套候选，原因是已有日历占用及常规营业窗口。回复实际解释了这些原因、指出工作坊场次未核实并给出调整方向，不再停留于通用执行上限提示。见 `artifacts/agent-recovery-browser.txt` 和 `artifacts/agent-recovery-browser.png`。这验证了失败结果可交付，不代表工作坊确实举办或已找到可行行程。

仍观察到语义瑕疵：模型把自己选择的10:00–18:00说成用户计划，且将明确不限预算记成flexible（两者此处都没有硬金额上限）。完成检查没有拦住这些问题。没有把此次记为全部需求语义正确，也没有修饰或手动改写截图中的回复；后续需针对状态来源与语义提取可靠性继续改进。

## 2026-10-07：活动发现到五项规划的跨轮修复

- 正常追问先保存已知需求，未完成规划跨轮保留；没有当前排程结果时不能以一段生成文字冒充交付。可按用户意愿暂停任务，保留原需求。
- Visit Stockholm 详情解析明确日期、开始和结束时刻；日期范围不再解释成“全天/今晚有场次”。活动证据以短期服务端引用跨轮传递，所选活动关联来源、场地与固定场次；余票、价格和预约仍不等于已核实。
- 起点需用户原话依据，活动搜索中心只用于注明距离参照。活动查询不自动夹带新闻。
- 支持最多6项活动；5–6项采用有限候选搜索及时间窗口剪枝，路线额度仍36。批量准备地点候选保留逐项检查/替换入口；预算和单项时间窗口可独立更新。
- 活动来源推荐与新排程的事实结论由工具字段呈现。模型仍自主选择工具、候选和调整策略；完成复核不能创造场次、日历冲突或外部执行结果。
- 需求核对只检查当前规划任务用户原话中漏存的活动及活动时段，排除此前发现活动的问题、助手回复和来源推荐。起点/日期/预算等前置条件由程序检查，不能用“缺起点”否决正常追问。核对器返回类型化遗漏和原文引用，程序拒绝非用户引用、已有字段的“缺失”及顺序/可行性/价格等越界要求。广义时段的数字解释由程序披露，即使模型漏写假设也会显示。

自动化114/114通过（`artifacts/agent-chain-tests.txt`），4个skills格式检查通过。覆盖五项活动加固定演出、午间窗口、跨轮来源、日期不能推断全天、虚构时间表拦截、零方案事实呈现、批量候选配额、有限需求核对、广义时间解释披露、未完成修订保留上次核对结果但不得冒充当前方案等。隔离HTTP验收继续检查日历预览边界和写入次数为0。

实际浏览器单独标签页验证了“今天市区有什么活动 → 选择Engla Li并提出五项需求 → 正常追问起点”，原标签页对话未改写。截图及可见文本：`artifacts/agent-chain-browser.png`、`artifacts/agent-chain-browser.txt`。这张截图不是完整可行路线或日历写入的证明。

真实复验不是一次即通过：失败及部分结果按顺序保留在 `artifacts/agent-chain-live-first-failure.json` 至 `artifacts/agent-chain-live-tenth-partial.json` 的相应编号文件。它们暴露了日期臆测、虚构起点、只回复不执行、漏存活动、复核器臆造冲突、底层操作循环、遗漏午餐时段和假设未披露；这些记录没有覆盖或修饰为成功。最新完整回放在 `artifacts/agent-chain-live.json`。

第11轮完整回放通过新增断言并生成3套真实候选（`artifacts/agent-chain-live-eleventh-pass-with-delays.json`）：5项活动、Gamla Stan地铁站起点、11:30–23:00、预算不限、午餐窗口及其原话、Engla Li来源21:00–22:00均保留，未把其他推荐演出当作日历冲突。不过追问阶段仍有复核器把此前活动发现问题当成缺起点/预算而重复阻塞，随后收窄核对范围并把请求按规划任务隔离。该轮候选因旧日历位置衔接未知不能直接保存；存在长空档，不能称为已经完成实际活动预约或全部自由对话验收。

第12轮（`artifacts/agent-chain-live-twelfth-incomplete-revision.json`）正常追问后执行过4次实际排程，均未找到可行候选；之后修改了条件而没有完成最后一次重排，旧结果失效后回退丢失了已查明信息。现新增`lastAttempt`：只作为同日历史尝试呈现，明确后续调整未核对，不作为当前journey、不绘制可执行新路线、不允许写入。完整回放验收区分当前方案与明确标记的部分结果，不能把后者计作已找到可行方案。

第13轮（`artifacts/agent-chain-live-thirteenth-clarification-veto.json`）再次证明语义复核不能成为正常追问的否决门槛：它把没有时段要求的购物活动也当成缺少窗口，导致追问循环。最终实现撤掉了追问阶段的语义核对；原始规划请求与已提取字段一并跨轮保留，语义检查只在排程前进行。回归测试明确禁止追问调用语义核对服务。`artifacts/intake-settings-live.json`另记录小范围参数诊断，仅保存元数据和检查结论，未保存模型内部推理；两种调用方式都返回有效检查，未据此更换模型或宣称设置是根因。

第14轮（`artifacts/agent-chain-live-fourteenth-overconstrained.json`）已正常返回5项活动的核对结果，但暴露出另一语义问题：模型为没有时间要求的购物/散步附加了固定窗口，导致不必要的不可行结论。现对硬窗口来源增加钟点/时段表达的格式检查，仅引用活动名称不算时间依据；公开场次独立处理。不把这个有限语言格式检查用作意图路由，也不声称它覆盖所有自然语言；无法解析的相对时段须保留原需求并澄清。真实脚本新增断言：本例除午餐和固定演出外，其余3项不得附加硬时间窗口。

第15轮（`artifacts/agent-chain-live-fifteenth-review-mismatch.json`）发现检查器反过来要求没有时间偏好的活动补时间窗口，与上述格式规则冲突。现在写入端和语义核对端共用 `time-anchors.mjs`；不含时间表达的引用不能形成“缺失活动时段”问题，回归覆盖此误报。保留这些不利记录是为了区分程序防护已验证与模型自由表达仍然可能失败。

最终当前版本真实三轮验收通过（脚本退出0，`artifacts/agent-chain-live.json`）：发现活动 → 保存5项活动并正常询问起点 → 补充Gamla Stan地铁站、预算不限、11:30–23:00后实际准备地点并排程。午餐12:00–13:30作为原话“中午”的暂定解释保留并披露；Engla Li按来源21:00–22:00锁定；其余3项未附加人为硬窗口。最新结果为0套可行候选，实际工具原因是营业窗口和已有日历占用，回复明确说明有限候选未找到，不把它说成所有方案均不可行，也未捏造其他演唱会冲突。此结果验证完整失败交付链路，不能算已找到满足全部要求的行程。原日历未变更，服务保留运行。

边界：仍是单日、有限候选和有限来源；模型对地点/服务相关性及语义解释仍可能出错。Maps营业时间不证明当天提供海鲜自助餐或有库存。短期来源缓存15分钟，重启后需要重查。公开场次只接受有明确同日开始/结束时刻的记录，跨午夜或日期范围活动仍待核实。本轮不预约、不购票、不创建或修改真实日历。
## 2026-10-07: City Walk meeting-point conversation repair

Observed user dialogue: event discovery → City Walk + seafood buffet + souvenirs + KTH + groceries → departure Fridhemsplan with no hard time limit → clarification that departure is Fridhemsplan metro. Both final replies unnecessarily asked the user whether “Starts by Östermalm Saluhall” meant “Östermalms Food Hall”. The trace confirmed strict string matching rejected the map result repeatedly. The source coordinates had been discarded and the source meeting instructions were treated as an exact venue name.

Live source/Maps check confirmed Swedish display name `Östermalms Saluhall` under the same Google Place ID, 17 m from the official event coordinate. New matching uses those independent facts, retains the source wording, and exposes a receipt. It does not use a hardcoded City Walk alias or relax non-event identity checks.

Regression: 119/119 tests pass (`artifacts/event-venue-tests.txt`). Coverage includes multilingual meeting-point matching, rejecting coordinate conflicts and unrelated nearby venues, retaining aliases after an origin change, passing the match through actual scheduling and manual verification, invalidating it when refreshed source coordinates change, accepting long official activity titles, and rejecting a wrong first-ranked departure station. The modified plan-outing skill validates.

Live three-turn replay (`scripts/event-venue-live.mjs --live`, `artifacts/event-venue-live.json`) reached actual planning with all five activities, Fridhemsplan departure, flexible 09:00–23:00 hours, and the published City Walk 17:30–18:30 session. The venue receipt reported 17 m. Result: zero candidates due to existing calendar occupation and candidate opening windows, not a venue-name deadlock. No Calendar mutation endpoints were used. This verifies progress through the original blocker, not a feasible itinerary or merchant availability.

Unfavourable evidence remains: the first replay exhausted intake retries (`artifacts/event-venue-live-intake-failure.json`), motivating explicit field limits/errors and long-title support. In the next replay, clarification initially structured only one activity but preserved the complete raw request; continuation recovered all five. It also needed several corrections for KTH's name and undecided budget. Free-form intake is therefore not claimed universally reliable. A separate browser test asked an unnecessary timing follow-up despite delegated timing; its outcome is recorded separately. Source time verification still does not establish a walking tour's finish location or ticket availability.

The separate browser test then exposed an actual wrong-origin result: batch discovery chose the first Maps search result for `Fridhemsplan地铁站`, which was `T-Centralen`. Live Maps inspection reproduced that ranking (Fridhemsplan was third). Batch preparation now chooses a name-compatible candidate instead, and manual origin selection enforces the same check; unmatched names require further lookup rather than substitution. Latest-code live candidate preparation (`artifacts/origin-venue-live.json`) confirms Fridhemsplan departure and all five groups, including the City Walk venue receipt. This focused check uses live Maps/source data, not an LLM rerun or a successful full itinerary. A name-substring check is conservative but is not universal semantic identity resolution.

Final browser acceptance on the latest code: fresh event discovery, then all five activities with Fridhemsplan departure, an explicit test window 13:00–23:00 and unlimited budget. The nine-step trace resolved the venue from the 17 m coordinate/name match and delivered a checked five-activity result with actual Fridhemsplan departure, without asking the user to approve the translated meeting point. Zero candidates were found within the route budget; reported blockers were calendar occupation and opening windows. The model first omitted the explicit budget but repaired it after tool feedback. Evidence: `artifacts/event-venue-browser.txt`, `artifacts/event-venue-browser.png`. This explicit-window browser test does not establish that delegated timing is always handled without extra clarification. Original user dialogue was not changed; only the temporary test tab was reset and then closed. No calendar events were created, changed or deleted.
## 2026-10-07: Activity introductions and distance relevance

Activity detail extraction now retains up to 3,000 characters of source description as plain text. `present_events` accepts model-written introductions and conditional appeal statements with exact supporting source excerpts. This separates flexible recommendations from host-rendered date/place fields. Missing descriptions stay explicit; a source excerpt check provides provenance, not a proof of semantic entailment. The local-discovery skill asks for two or three useful, distinct recommendations, actual experience details, and conditional interest explanations when no user preferences are known.

Distances are hidden in both chat and source cards by default. Opt-in display requires a user-supplied search reference with an exact quote; an assistant-selected centre is not treated as the user location. Search itself still uses the existing bounded geographic source, so this change does not claim citywide coverage. Only selected event cards remain after presentation.

122/122 regression tests passed (`artifacts/event-presentation-tests.txt`), covering description extraction, recommendation/source association, missing introductions, fabricated supporting excerpts, retained source times, hidden default distances and explicitly requested user-reference distances. The local-discovery skill validates. No calendar writes are part of this change.

Live browser acceptance: “今天斯德哥尔摩有什么有趣的活动？” returned source-based Chinese introductions and conditional appeal for Engla Li and the historical City Walk, with no default distance text in either the response or cards. A comedy listing without an occurrence was explicitly prefixed as an unconfirmed alternative rather than a confirmed activity for that day. The three-step tool trace completed; the original user tabs/history were untouched. Evidence: `artifacts/event-introductions-browser.txt` and `artifacts/event-introductions-browser.png`. Model wording can still vary; the quote check is not a semantic fact checker.


## 2026-10-07 — Constraint diagnostics, targeted repair and experience evidence

Implemented:
- The planner preflights fixed sessions against the trip window and calendar before route requests. Fixed conflicts identify the activity and overlapping interval, including cross-day dates. Existing commitments are not moved or omitted.
- Failed candidates retain concrete opening windows, estimated finish, walking total or budget reserve. Repair options distinguish changes to provisional assumptions from changes requiring a user decision. Search limits are explicitly non-exhaustive.
- The model chooses targeted repairs through the existing tool loop. Up to three checked planning attempts share a 36-call route budget and exact date/transport/departure cache. The first attempt defaults to 18 calls. Cached routes remain usable with zero fresh-call allowance.
- The verify-activity skill can read a Maps-observed official website and observed same-host links (four pages per turn). HTTP links are upgraded to HTTPS on the same host/path; redirects remain same-host, public DNS is validated and pinned, and reads have size/time limits. Returned excerpts are limited to 3000 characters and 20 links, with truncation disclosed.
- Experience assessments retain an exact fetched quotation, URL, requirement, place, date and model interpretation status. This establishes provenance, not semantic correctness, booking, stock or dated access. Contradicted candidates cannot be silently reselected; changed requirements/dates expire interpretations.
- The itinerary UI renders specific failure evidence and repair options, plus experience uncertainty/source links on candidates. plan-outing and verify-activity skills describe decision criteria rather than enumerating user utterances.

Validation:
- `node --test --test-timeout=45000 tests/*.test.mjs`: 134/134 passed. Output: `artifacts/planning-repair-tests.txt`. Tests cover fixed/calendar conflict preflight with zero route calls, cross-day formatting, concrete cost/walking/opening failures, cache/budget limits, quoted-source provenance, changed requirement/date invalidation, and preserving actual failure evidence when the model becomes unavailable.
- Both modified skills passed skill-creator quick_validate; modified UI/module syntax checks passed.
- Live Google Places lookup returned KTH's official HTTP URL. The bounded reader successfully upgraded to HTTPS and returned 3000 characters and 20 observed links. `artifacts/place-website-live.json`. This verifies transport/source reading only; campus admission was NOT verified.
- Fresh read-only Calendar query for 2026-10-07 returned no busy intervals or own events. Historical test-event claims must not be treated as current blockers. No Calendar mutation occurred in this task.

Unfinished live acceptance (do not report a full pass):
- Browser request for museum then Chinese food, unlimited budget, delegated hours and maximum 30 minutes walking timed out at the first model response (45 seconds), before place tools ran.
- Repeatable live-model scenario `node --env-file=.env scripts/planning-repair-live.mjs --live-model` uses explicitly fictional place/route/source/calendar fixtures, checks budget paraphrases, delegated timing, low walking, an added meeting and a changed activity over three turns. Two normal attempts stopped in the FIRST turn with model response timeout. Preserve `artifacts/planning-repair-model-timeout.json` and `artifacts/planning-repair-model.json`; the later turns have not passed live acceptance.
- A separate `--low-effort` diagnostic also timed out. Its request option is NOT enabled in the product. Output: `artifacts/planning-repair-model-low-effort.json`. The model catalog request returned HTTP 200, and a minimal text request returned HTTP 200 in about 25 seconds. These facts do not establish why full tool requests timed out; no specific upstream root cause is claimed.
- An isolated synthetic UI preview on port 4319 was blocked by the in-app browser (ERR_BLOCKED_BY_CLIENT). The temporary server was stopped and the unused fixture server script removed. The new UI's visual result remains unverified; no bypass or production mock was added.

Resume: after resolving model-response latency, rerun the three-turn scenario above, then replay the real Stockholm outing in an isolated browser conversation. Verify actual targeted repair and official experience evidence; retain no-write Calendar scope. The main Daylight server remains on port 4318 with the updated implementation.

## 2026-10-08 — Visible progress, stop/continue and response diagnostics

Implemented:
- Conversation requests now start a bounded server task and poll real progress events. The page shows model response/tool work, completed steps and stop/continue controls. Refresh reconnects to the saved task ID; transient polling failures do not resend the creation request.
- Completed tool evidence and interpreted conditions are checkpointed in local service memory. Continuing uses the server's original request/checkpoint rather than a client-supplied replacement. Candidate observations can be reused, but itinerary/calendar validity must be rechecked. Recovery is available for 15 minutes after completion, subject to bounded cache eviction and service restart; expired entries are pruned on subsequent access. Privacy text documents this.
- Upstream model responses use SSE; fragmented arguments are assembled only after a complete successful stream. Truncated or length-limited tool calls never execute. Internal reasoning is discarded. Timing receipts distinguish response headers, first response, full model generation and tool duration.
- Generic intake checks now verify explicit activity precedence against exact user quotes and known IDs. Planning requires a known time provenance (user-fixed vs assistant-provisional), with missing decisions reported together. The calendar-review skill describes reading changed calendar availability before asking users to copy connected information.
- The old calendar confirmation box is now labelled as previously saved records, avoiding confusion with a newly generated candidate.

Validation:
- 144/144 automated tests passed: `artifacts/progress-tests.txt`. Covers fragmented/truncated streams, cancellation, server-authoritative checkpoint restoration, fresh calendar reads after resume, client reconnect without repeating POST, expired-task recovery, progress HTTP endpoints without calendar writes, explicit-order provenance and unknown-time preflight. Calendar skill validation and UI syntax checks passed.
- Real browser used the configured Nebius/NVIDIA model, Google Maps and read-only connected Calendar. Turn 1 planned museum then Chinese food with unlimited budget, delegated timing and a 30-minute walking cap. Turn 2 replaced the museum with a library and generated two checked alternatives. Turn 3 changed departure to 11:00; it was stopped, continued and the page refreshed while running. The same query completed with National Library then Xiang Yue, 15:18 return and 25 minutes walking. Original requests appeared once each; continued processing appeared as a separate explicit control action. No calendar mutation/booking/invitation endpoint was invoked. Evidence: `artifacts/progress-browser.txt`, `artifacts/progress-browser.png`. This demonstrates candidate planning and recovery, not verified library access, restaurant availability or pricing.
- Separate controlled fixture runs used the REAL model but fictional Maps/calendar/source providers. Preserve their failures: `progress-model-time-provenance-failure.json` (provisional time not labelled), `progress-model-calendar-clarification-failure.json` (unnecessary request for an already-calendar meeting time), `progress-model-length-failure.json` (incomplete length-limited output safely rejected). The first two motivated the generic changes above. The low-effort diagnostic (`planning-repair-model-low-effort.json`) omitted the walking cap and therefore failed acceptance; it was NOT adopted in the application. The prescribed three-turn fictional-calendar acceptance script has not passed in this run; the separate actual browser three-turn sequence did pass its observed UI checks.
- Timing samples from standard controlled fixture runs: first upstream responses roughly 0.9–1.5 seconds; completed initial turns 27.5 and 33.1 seconds. Their final model calls alone took 11.7 and 15.5 seconds. These are samples, not a latency guarantee or proof that streaming alone caused improvement over yesterday's timeouts.

Remaining boundaries:
- Model intake and output length remain variable; this change does not establish universal multi-turn reliability. The low-effort omission reinforces the need to validate constraint retention before changing model settings.
- Natural itinerary narration still uses a host-checked summary and can sound formulaic. Improving that prose while retaining evidence checks is separate remaining work.
- Recovery is not durable across service restarts; if the initial POST response itself is lost before returning a task ID, the current client cannot reliably reattach. Automatic retries cover polling, not blind replay of creation.
- Cancellation aborts model calls; an in-flight provider query that lacks abort support may finish before the agent stops. Completed results are then retained. No claim of instant provider cancellation.

## 2026-10-08 — IME composition leaves Send disabled

Observed the user's live page with a nonempty editable draft but a disabled Send button; other controls were enabled and no request was running. The input handler ignored composing input events without a compositionend handler, leaving the controller's text stale. Its normal edit callback also rebuilt the textarea on each keystroke.

The composer now commits the textarea value on compositionend (also supports the final non-composing input and change), updates Send in place during editing, and preserves the textarea while an IME owns composition. Sending re-reads the visible draft and remains blocked during composition/recording/in-flight requests. Leaving the panel clears the composition flag. No model, service or credential change was needed.

145/145 tests passed (`artifacts/send-button-tests.txt`). New UI-module regression simulates an IME with no final non-composing input, asynchronous repaint during composition, duplicate final input, whitespace deletion, failed send and successful retry, verifying exact sent text and editor identity. This is simulated IME event coverage, not automation of the user's native keyboard IME.

Live browser acceptance: a separate temporary tab successfully sent a Chinese greeting to the configured model and received a reply. The user's tab was reloaded with the updated module, its unsent draft restored verbatim and its previous unchecked auto-read preference restored; Send was verified enabled, without submitting the user's draft. Existing dialogue was preserved. Screenshot: `artifacts/send-button-browser.png`. No calendar events were changed. The test tab was closed.


## 2026-10-08 — Conversation decision loop (partial acceptance)

Added local bounded diagnostics, quote-grounded budget reconciliation, discussion vs task-completion separation, exclusive activity groups/selection, typed plan facts, evidence-receipt completion review and bounded prose repair. Updated plan-outing/local-discovery runtime skills. 159/159 tests passed (`artifacts/decision-loop-tests-final.txt`), both skills validated, updated service running on 4318. Calendar remained unchanged.

Controlled real-model replays reproduced an explicit unknown-budget emission and the host's incorrect pending-plan gate. One intermediate three-turn run passed state-flow assertions; subsequent evidence review exposed model/reviewer failures. Final real browser acceptance still failed: the model repeated a preference question and unsupported proximity/booking claims after a correction; the host withheld that prose and showed a review fallback. Do not report stable end-to-end acceptance. Full evidence, failed runs and next diagnostic branch: `artifacts/decision-loop-report.md`. Original user history preserved; test tab closed.


## 2026-10-08 — Resume after BSOD: committed turn state and unified delivery (partial acceptance)

Implemented a single pre-reply interpretation and actual state commit in lib/turn-intent.mjs and lib/agent.mjs. User/assistant messages retain conversational roles. User-message indices identify provenance without requiring the model to reproduce substrings; this is provenance, not proof of entailment. Required budget/time resolutions become sparse deltas through order-independent structural comparison. Assumptions survive even without numeric slot changes. Failures after a successful commit return an explicit saved-condition receipt.

Removed reviewTripIntent/reviewCompletion from the production agent loop; their modules remain for offline diagnostics. Tool validation, source boundaries, planning constraints and manual calendar approval remain. present_events now prepares cards and returns an observation; finish.sections covers each requested news/events category. The verify-activity skill can search a named venue directly. Weekdays are computed by the host. JSON and SSE length limits have a distinct output_limit outcome and incomplete calls do not execute.

Validation: 170/170 tests passed (artifacts/repair-tests-final.log); plan-outing, local-discovery and verify-activity skill files validate. Managed service restarted with final code on port 4318. No calendar write, booking, credential change or system/driver change occurred.

Preserved four successive frozen development matrices, each 8 known scenarios x 5 real Super-model calls with fictional business fixtures. Structural passes: r1 21/40, r2 26/40, r3 27/40, r4 34/40. Final r4 content review by the same assistant: 29/40 success; NOT independent human grading or unseen evaluation. Prior frozen Super A baseline was 8/40 structural and 5/40 reviewed. All failures and the original 160 comparison records are retained. These iterative results do not isolate one causal change or establish general reliability.

Additional actual final-runtime multi-turn testing: 3 groups x 3 turns. All groups retain 500 SEK, maximum 10 minutes walking and transit at the final turn; only 2/3 groups complete every reply. The third hits output_limit in turns 2 and 3. Return-time provenance remains unknown in 2/3 groups. After these runs, added deterministic tests/receipts disclosing successful commits even when later generation fails. The 40-trial matrix precedes the final assumptions-only persistence and failure-receipt patches; their unit tests pass, but the full matrix was not rerun. Final source snapshot: artifacts/repair-regression-20261008-r4/delivery.

Unresolved: ambiguous departure period vs no return ceiling, premature claims of unavailable information without querying, occasional source/clock narration errors, rejected intake requiring bounded structural repair, and continued-dialogue output limits. Browser automation rejected the localhost tab under URL policy; live UI acceptance was not performed or bypassed.

Report: artifacts/repair-regression-20261008-r4/report.html. Per-trial evidence/grades and protocol sit alongside it. Multi-turn evidence: artifacts/repair-multiturn-20261008/turns.json. Resume state: artifacts/daylight-development-state.json. Do not report the whole conversational loop as stable or fully accepted.


## 2026-10-08 — Output telemetry and bounded generation recovery (partial acceptance)

Implemented provider usage/finish telemetry without retaining reasoning text; 4096 initial output allowance, one shared 8192 retry per user turn only for explicit length termination, 45/75-second request deadlines within the existing whole-turn limit. Completed tools and committed state are not replayed; incomplete calls never execute. Actor uses temperature 1/top_p .95, intake remains .2; thinking unchanged. Non-tool actor prose no longer contaminates subsequent history. Output/intake failures expose the existing server-checkpoint resume action. Failure wording distinguishes unsaved new conditions from successful commits.

Validation: 181/181 tests passed (artifacts/output-budget-tests.log). Three fixed-output-cap arms each had 1/12 length failures; increasing the cap alone did not solve it. Additional sampling comparison: previous profile 10/12 structurally complete, candidate 12/12, but candidate still had stray protocol prose. Small selected diagnostic contexts, not held-out evaluation or proof of general improvement. A deliberate 16-token real-provider request recovered once at 8192. Three live-model conversations x three turns: 7/9 finished; one intake provenance error and one length failure after both 4096 and 8192. Final budget/walking state retained in 3/3 groups; whole conversation acceptance passed in only 1/3. Do not describe this as a root-cause fix.

Post-live changes (agent-runs.mjs, agent-tools.mjs, agent.mjs) only affect resume availability and error wording; covered by final unit suite, not a rerun of the full live matrix. Current delivery snapshot and details: artifacts/output-recovery-20261008/report.html. Frozen comparison protocols, raw responses, failures and runners retained. No business tools, calendar writes, bookings, credential or system changes in these tests. Live UI was not verified. Remaining priority: isolate malformed/repeated tool protocol output and provider usage mismatch; intake provenance and return-time semantics remain separate issues.


## 2026-10-09 — English-only product migration

Runtime policy, skills, semantic intake, tool explanations, user-facing copy and defaults now use English. Swedish proper names and source quotations remain verbatim. News titles are translated directly to English; original titles/URLs/dates remain attached. Speech input defaults to English and rejects unsupported language selection; OpenCC conversion was removed. The browser uses a fresh English conversation namespace; previous browser records and calendar data were not deleted or rewritten.

184/184 regression tests pass, including English multi-turn state serialization, Swedish diacritics, news translation provenance and speech-language boundaries. Real configured-model check: three turns all returned English and preserved Östermalmstorg, unlimited-to-500-SEK correction and a 10-minute walking cap. However the first turn omitted activities and the relative date from structured state while claiming to remember them. Keep this as a failed state-completeness check; do not claim full planning acceptance or improved intelligence from changing language. Evidence: artifacts/english-migration-20261009/live-check.json. No business services or calendar writes were invoked.

Managed service restarted at port 4318. Browser verified English labels, English speech selection, local speech ready, Swedish diacritics in input and Send enabled for a nonempty draft. No microphone recording was performed. Original files and migration evidence are under artifacts/english-migration-20261009.


## 2026-10-09 — Conversation reliability and latency

Cause analysis used the saved runs in data/diagnostics: a correctly extracted four-activity request was discarded because two changed fields lacked citations; one turn streamed to 4096 then 8192 tokens (80 s) before failing; another spent 20 model rounds and ended asking whether “National Museum” is Nationalmuseum; an events reply was cut mid-sentence by the provider-enforced length cap.

Changes: an uncited intake change is attributed to the current message and an invalid citation drops only its own field; streams stop early on runaway prose or tool arguments; the skill named by the intake intent is preloaded instead of costing a model round; duplicate calls in one response run once; named venues also match respaced/translated map names and aliases; a missing budget or open hours become disclosed assumptions at planning time instead of blocking; reply caps are 900/1200 characters and a capped reply ends at a whole sentence; the system prompt carries one copy of the state per round. Actor sampling is unchanged (the 2026-10-08 comparison favoured it).

189/189 tests pass. Live check with the real configured model and fictional map/event/calendar observations (`node --env-file=.env scripts/conversation-live.mjs --live`, no calendar writes), last of three runs: events question 9.2 s; four-activity request ended in an origin question; the follow-up produced two checked plans in 22.2 s with 4 model requests, no tool errors, and the festival at its published 19:00–21:00 occurrence. Earlier runs of the same script during the repair took 40–75 s for that turn. Three runs on one scripted conversation are not a held-out evaluation. Still observed: intake occasionally omits the activities (one run needed a second clarify, 35 s), and replies sometimes recite the timetable against policy. The live UI and real Google services were not re-verified; the managed service must be restarted to load these changes.


## 2026-10-09 — Browser conversation review and repair (events → plan)

Reviewed the conversation shown in the browser and its logs. Turn 1 searched one day from today for a "tomorrow" question and presented today's events as tomorrow's, with one card for four mentioned events. Turn 2 was discarded whole because one activity carried a time window whose quote had no timing words.

Changes: nearby_events takes a required date and returns only events with a session in the searched dates; discovered events are passed to the intake step; an unsupported activity window, an uncited order or one invalid field is dropped alone while the rest of the turn commits (field-by-field fallback); event introduction quotes are compared ignoring case and punctuation, and a bad quote costs only that introduction; precedence is kept only when the user used an ordering word; a new activity field hours=not_needed exempts meeting points and outdoor walks from opening hours; a stop's clock time is no longer accepted as the departure time, and an open departure defaults to an hour before the earliest timed stop; the planner reports a requested-time conflict separately from venue hours; a plan request whose prerequisites are met must run plan_itinerary before replying; over-long replies are trimmed at a sentence, stringified sections are parsed, and a single-category answer written in message is accepted.

197/197 tests pass. Browser replay on the restarted managed service with the real model, Maps and Visit Stockholm (no calendar write), final run: the events question returned three events for 2026-10-10 with matching cards and stated which had no confirmed Saturday session (under 30 s); the plan request asked for the departure point; the follow-up returned a checked plan with the KTH meeting at 10:00. Not fixed: the book release party (which is on 2026-10-09 only) was scheduled as a generic venue search result at Fasching with an invented time, hedged only by "verify the details"; the KTH stop resolved to KTH Flemingsberg rather than the main campus; the reply's appended assumptions list is long. One scripted conversation, three replays; not a general evaluation.


## 2026-10-09 — Harness changes: one planning tool, plain-text streamed reply, fixed evaluation set

Evaluation set: `evals/conversations.mjs` holds 25 scripted conversations (36 turns) with objective checks on stop reason, saved state, tools used, the checked plan and the reply. `scripts/eval-conversations.mjs --live` runs them with the real configured model against a fictional, deterministic world (places, routes, events, news, calendar); no real Maps, event source or calendar is touched. Reports are saved under artifacts/evals. Use `--root <snapshot>` to run an older copy of lib/ and agent/, `--compare <report>` to diff, `--repeat N` for repeated runs.

Planning tool: plan_itinerary now finds the departure point and missing candidate places itself, so a plan request needs a date, origin and activities and one call. A published occurrence longer than four hours is treated as opening time to drop in during, not a session of that length.

Reply: the finish tool is removed. Requests use tool_choice auto; text without a tool call is the reply, streamed to the chat while it is written (reply_delta progress events, 250 ms polling). The host holds a reply or a clarifying question back once when a plan request has its essentials recorded but the planner has not run, or when requested news/events were never looked up, and never delivers protocol-shaped output. A timetable written on a planning turn without a checked plan is delivered with a note that it is unverified. Host-appended assumption lists are gone from the reply; assumptions remain in the plan notes.

Results (conversations passing every check / median seconds per turn / model requests per turn), same model, same day:
- Baseline snapshot before these changes, 1 run: 20/25, 30.7 s, 5.4.
- After, four single runs during the work: 21/25, 21/25, 22/25, 21/25; medians 9.1–12.5 s.
- After, final code, 2 repeats: 43/50, 9.2 s (p90 15.7 s), 3.8.
Failures differ from run to run. With one baseline run, the pass-rate difference (80% vs 86%) is within noise; the latency difference is not. Counts exclude one check added late that proved faulty and was corrected afterwards without a rerun; two other checks were loosened after they rejected correct replies (a plain-text question, differently worded explanations).

Failures seen in the final repeats: the calendar-conflict reply asked a question without naming the calendar; one events turn answered without searching; "go with the second option" was described rather than switched (1 of 2); one plan missed the 10:00 meeting; one date was not saved; one save-to-calendar reply did not point to the confirmation step.

200/200 unit tests pass. Browser check on the restarted managed service: an events question streamed its reply into the chat (5 → 1485 characters over about two seconds) with four source cards. That reply used markdown and ran to the 1500-character cap, against the policy's short plain prose. Real Google and calendar flows were not re-verified after this refactor.


## 2026-10-09 — Label, don't gate; reply style

Interpretation is no longer rejected for lack of provenance. `update_trip` accepts the change and records a label per fact in `trip.labels`: `user` (they said it) or `assistant` (assumed). The host decides the label where it can check the user's words: a departure point by its name, a budget by its number, an activity time by the clock time itself (“10:00”, “10 am”, “at 10”) or a quoted timing phrase, an order by an ordering word; other facts take the label of whoever wrote them (the interpreted user turn, or the model and host defaults). Removed: citation checks on the intake, the origin-provenance refusal, the window-quote rejection, the choice-quote rejection, the pause-quote requirement, and dropping an uncited order. Kept: physical-consistency repairs (a stop's time is not the departure time; an interpretation cannot empty a saved trip or clear a time the user gave earlier), event-reference integrity, named-venue identity matching, and every restriction on calendar writes, bookings and payments.

Assumptions are soft. When no plan fits, the planner retries once without an order or activity time labelled `assistant`, keeps the result if it works, updates the saved trip and reports what it dropped. Facts labelled `user` are never relaxed. The chat shows a “What I understood” panel listing each fact as “You said” or “I assumed” (dashed); clicking one starts a correction in the message box.

Reply style: the host removes markdown (tables, headings, list markers, emphasis) from the reply and the streamed draft, caps the reply at 900 characters at a sentence or line boundary, restates the style rule at the end of the prompt each round, and asks the model once to shorten a reply over 800 characters or with eight or more clock times.

204/204 unit tests pass. Evaluation set, now with added checks for labels, reply length and markdown (920 checks over 50 conversations, 2 repeats, same model): 43/50 conversations, 912/920 checks, median 8.6 s per turn, p90 18.2 s. No turn failed the length or markdown check in this run or the previous one (144 turns). The previous harness scored 43/50 on the smaller check set, so this is not a measured reliability gain. An intermediate run exposed that a user-stated 10:00 meeting could be labelled as assumed and then dropped by the planner; the clock-time check and the keep-earlier-time rule were added for that, and the conversation then passed in 1 of 2 final repeats (2 of 3 failed in a focused rerun before the last fix). “Go with the second option” passed 5/5 after the interpreter was told to leave state alone and the model was shown the plan options. Failures in the final repeats: that 10:00 meeting once, one meeting-point plan, one clarifying question instead of an answer (twice), one delegated choice not stated, and two flags from the unverified-timetable check that look like check false positives.

Browser check on the restarted managed service with real Maps: one plan request returned a four-sentence plain reply in 17 s; the panel showed date, origin, activities and the 15:00 coffee as “You said” and departure, return and budget as “I assumed”; clicking “Leave at 10:00” put “I will leave at ” in the message box. Calendar confirmation and voice were not re-verified.


## 2026-10-09 — Leave time, return time and budget are optional

A leave time, a return time and a budget now limit a plan only when the user stated them. The planner no longer writes defaults for them into the trip, no longer records them as assumptions, and no longer requires a time or budget “mode” before planning; readiness needs only a date, a departure point and activities. When one is absent the search runs without that limit (internally: departure an hour before the earliest timed stop and no later than 10:00, end of day 24:00, no spending cap) and the result reports the limit as absent (`open`, null in `constraints` and `userLimits`). `clarify` rejects questions about time or budget, the prompts tell the model not to ask for or mention them, and the “What I understood” panel shows them only when given. A later message that says nothing about timing cannot clear hours the user gave earlier. A change to a trip that already had a checked plan is re-planned before it is answered. A date is labelled as the user's when they said “today”, “tomorrow” or the date itself.

206/206 unit tests pass. Evaluation set before the last three small fixes (2 repeats, 1064 checks): 42/50 conversations, 1051 checks, median 9.5 s. The two checks added for this change — no question about leave time, return time or budget; no unstated limit presented as a condition — passed on all 72 turns. A focused rerun of five affected conversations (2 repeats) passed 8/10; its two failures were a date not saved and stated hours cleared by a budget message, the second of which the keep-earlier-hours rule now covers (unit-tested, not re-run live). The friend-at-KTH conversation failed in both repeats: with a three-hour market visit estimated by the model, the day does not fit and the assistant asks to shorten it instead of shortening its own estimate.

Browser check on the restarted managed service with real Maps: “Tomorrow I want to visit a museum and have sushi, starting from Slussen. Make a plan.” returned a checked plan in 21 s without asking anything; the panel listed only the date, departure point and the two activities; the plan header read “No budget limit”. The reply still said “this assumes flexible timing”.


## 2026-10-10 — Hermes Agent trial and research tracker

Hermes Agent v0.21.6 was installed inside WSL (Ubuntu 24.04, `~/.hermes`, 2.5 GB) with the official installer, without the browser and computer-use extras. `scripts/hermes.sh` launches it with the Nebius key read from the project `.env`; the key is not copied. Provider `nebius`, model `nvidia/nemotron-3-super-120b-a12b`.

Trial results with the real model: plain reply 5.6 s; a tool call that read a local file 7.6 s; a preference stated in one session (“I hate pork and I love salmon”) was written to `USER.md` and applied in a new session (only the salmon deal was recommended); a one-shot scheduled job with the bundled arXiv skill produced a three-paper digest in 33 s to a local file. Telegram delivery was not tested: it needs the user's bot token.

Research tracker (`hermes/`): `scripts/daylight_research.py` keeps topics, queries the arXiv API, remembers which papers were already offered, and prints `{"wakeAgent": false}` when nothing is new so the scheduled job costs no model call; `skills/research-tracker/SKILL.md` covers managing topics by chat, storing feedback as per-topic notes, and writing the digest; `install.sh` copies both into Hermes and creates the daily job. 5/5 Python unit tests pass (no network). End to end with the real arXiv API and model: a topic added by chat; first scheduled run wrote a two-topic, eight-paper digest in 14 s; the second run was skipped by the script gate in 4 s; feedback given by chat was stored as a topic note. Observed weakness: relevance filtering is loose (for example a data-selection benchmark listed under tool-using agents); the skill text was tightened afterwards and not re-measured. The digest job is installed with local-file delivery and a daily 08:00 schedule in WSL's UTC+8 clock; nothing fires until the Hermes gateway is running.


## 2026-10-10 — Telegram delivery, relevance screening, planner as a Hermes tool server

Telegram: the gateway runs in the foreground in WSL; the research digest job delivers to the user's home chat. One test digest was delivered (Hermes log: `delivered to telegram`), and the user confirmed it arrived. An installer bug had created four copies of the digest job (`grep -q` under `pipefail`); three were removed before any scheduled run and the installer now reads the job list before matching.

Research tracker: new papers are screened by a small model before the digest is written (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` on Token Factory, one call per topic, falls back to no screening on any failure). The default query now requires each meaningful word in the title or abstract. On live data for the two test topics, screening kept 2 of 8 papers in each (15 s for both). The first attempt returned nothing because the model spent its 1,500-token allowance on reasoning; the allowance is now 6,000. 7/7 Python unit tests pass. One relevant paper (on verifier brittleness in agent evaluation) was dropped in the final run, so recall is not perfect.

Planner: `mcp/planner-server.mjs` exposes `plan_day`, `find_events` and `local_news` over the Model Context Protocol (stdio), reusing the existing scheduler, Maps, events and calendar code; it has no tool that writes a calendar, books or pays. Everything in a `plan_day` call is treated as a stated requirement. With no leave time given, a plan whose every option starts with a wait of 30 minutes or more is re-checked with a later departure. Hermes runs the server on its own Node 26 with the project `.env`; `hermes/skills/outing-planner` tells the model how to use it. 211/211 Node tests pass (5 new).

Through Hermes with Nemotron Super and real Maps: “Tomorrow I want to visit a museum and have sushi, starting from Slussen” returned a checked plan in 18–25 s; a request without a departure point got one question in 6 s; six plan requests in a row succeeded after two faults were fixed. Fault 1: Hermes loads tool-server tools on demand, so calls by name failed until `tools.tool_search.enabled` was set to `off` (3 of 6 and then 6 of 6 requests had failed). Fault 2: Hermes names the tools `mcp__daylight__…` with double underscores, not as its documentation shows. “What's on tomorrow” returned no events for 2026-10-11; not investigated. The running gateway predates these changes and must be restarted to use the planner from Telegram; that path was not tested.

Discount tracker, data check only: Coop's robots.txt does not disallow store offer pages, and a store page (Coop Odenplan) shows 18 weekly offers in a browser, but the offers are loaded by script from Coop's internal API and are absent from the page HTML. ICA and Willys refuse automated requests (HTTP 403). No official offers API was found for any chain, and no retailer terms of use were reviewed.


## 2026-10-10 — Discount tracker on Lidl Sverige

Source check: Lidl's robots.txt disallows only site search, one script, one asset folder and paths beginning with a digit; weekly offer pages live under `/c/…`. The offers are embedded in the page HTML as structured product data, so one plain request per page is enough. No general website terms of use were found or read; the user decided to proceed on that basis.

`hermes/scripts/daylight_deals.py` reads the home page for this week's offer pages (up to 8), fetches each at most once a day, three seconds apart, with a user agent naming the tool; keeps food items only; records name, price, previous price, percentage, unit price, pack, Lidl Plus requirement and in-store dates; remembers which offers were sent; and prints `{"wakeAgent": false}` when nothing is new. Preferences: `like`/`dislike` entries with match terms are applied deterministically, then a small model (Nemotron Nano) judges the remaining offers against the stated dislikes and Hermes's general memory of the user, in batches of 35 with one retry. `hermes/skills/discount-tracker` covers recording preferences by chat and writing the message. A daily job runs at 07:30 (machine clock, UTC+8) and delivers to Telegram.

12/12 Python unit tests pass (5 for this tracker, no network). Live, 2026-10-10: 8 weekly pages, 131 food offers. With only the general memory “User hates pork”, three consecutive screened runs removed 15, 16 and 14 offers (pork schnitzel, ribs, ham, porchetta, guanciale, pancetta, salami, prosciutto) and left no offer with an obvious pork word in its name. Before batching, screening the 131 offers in one call failed 1 time in 2 by running out of tokens. The first real job run delivered a message to Telegram in 12 s listing eight produce offers; screening may have failed in that run (it predates batching), and it had no “left out” line. The second run was skipped by the script gate. A preference stated by chat was stored, but with an English match term only and without being saved to general memory as the skill asks; the test preferences were removed afterwards. Not checked: whether offers differ by store or region, and behaviour across a week boundary. Lidl's pages were fetched three times today during development (27 requests in total).


## 2026-10-10 — Telegram use: two faults found by the user

Missing credentials: Hermes had set `gateway.multiplex_profiles: true` (with `auto_multiplex_migration`), in which mode the gateway reads secrets only from `~/.hermes/.env` and ignores the Nebius key passed in the process environment by `scripts/hermes.sh`. Both settings are now false and the installer sets them. The user restarted the gateway and the bot then answered news, events, planning and memory requests from Telegram.

Wrong behaviour on “check for groceries discounts info”: the bot never loaded the discount-tracker skill and answered from a web search with Wolt delivery promotions, in markdown, with a detail carried over from an earlier topic. Causes: the skill only covered stating preferences and the scheduled digest, with no way to answer a question on demand, and nothing told the model to prefer its own skills over web search. Changes: `daylight_deals.py current [--find WORD]` lists this week's offers with preferences applied and marks nothing as sent; the skill has a section for discount questions and a description that names them; a marked “Daylight” block appended to Hermes's `SOUL.md` says which skill answers what, to write plain text for chat, and not to search other shops' promotions unless the user names the shop. 13/13 Python unit tests pass.

Re-test from the command line without preloading any skill: the same question was answered from Lidl data in 17 s (eight offers, plain text); “is chicken on offer anywhere?” found the chicken breast offer in 15 s; a question about meat offers listed chicken only and said pork was left out because the user dislikes it. Still wrong: when run from the bot's own terminal the small-model screen does not run (the Nebius key is not passed to that subprocess), so filtering there depends on the main model applying memory, and the bot did not register the remembered dislike in the tracker's stored preferences as instructed. During the user's Telegram session the bot had also written a skill of its own, `stockholm-day-planning`, which competes with `outing-planner`; it was moved to `~/.hermes/skills-set-aside/`, not deleted. Not re-tested from Telegram.


## 2026-10-10 — Web page to Hermes agent, proven

Hermes's API server (part of the gateway, loopback only, port 8642) was enabled with a generated key stored in `~/.hermes/.env`; the same key is in the project `.env` as `HERMES_API_KEY` for the web server. The gateway was restarted from this session, so it now runs as a background task here and no longer in the user's terminal window.

Direct tests inside WSL: health responds; `/v1/models` returns 401 without the key and 200 with it; a plain reply took 3.8 s (about 18,600 prompt tokens per request, which is Hermes's own system prompt and tool list); a streamed question about chicken offers took 10.6 s and carried `hermes.tool.progress` events for loading the discount-tracker skill and running its script; a second request with the same `X-Hermes-Session-Id` recalled the first; “Which food do I avoid?” returned “pork” from the memory shared with Telegram; `/api/jobs` listed the two scheduled digests with their Telegram delivery.

Bridge: `lib/hermes.mjs` and two routes in `lib/http.mjs` (`GET /api/assistant/status`, `POST /api/assistant`) forward one message to the agent with a per-tab session id and stream the reply back as server-sent events; the key never reaches the browser. 214/214 Node tests pass (3 new). Windows reaches the WSL port through localhost.

From a browser page on `http://127.0.0.1:4318`: a question about salmon and chicken offers streamed back in 11.7 s (first text at 11.4 s, 15 text chunks, three tool-progress events) with a correct answer from Lidl data, and a follow-up in the same session was answered in 2.3 s. The first visible text arrives late because the model's tool work comes first; only the progress events fill that gap. No web UI uses the bridge yet.


## 2026-10-10 — New web app on the Hermes bridge: chat and “What I know”

`public/index.html`, `daylight.mjs` and `daylight.css` replace the front page. The previous page is still served at `/legacy.html` and no old code was deleted. The chat sends each message to the Hermes agent through `POST /api/assistant`, shows tool-progress events as plain labels while the model works, then streams the text. “What I know” reads and edits the same files Hermes and the job scripts use, located by `DAYLIGHT_HERMES_HOME`: Hermes's `USER.md` and `MEMORY.md`, the discount tracker's likes and dislikes, the research tracker's topics, and the scheduled jobs through Hermes's jobs API (pause, resume, run now; no create or delete). `lib/profile.mjs` and `GET/POST /api/profile` implement it. 219/219 Node tests pass (5 new for the profile).

Browser checks on the restarted web server, real assistant: the suggested question “What's on offer this week?” showed “Opening grocery offers”, then “Reading Lidl's offers”, then streamed eight Lidl offers from 13.3 s, finishing at 14 s. The page listed the real memory entry, both research topics with their notes, and both scheduled jobs. Through the page's own controls: a food to avoid was added with Swedish match words and removed; a memory entry was added (47 of 1,375 characters) and forgotten; adding a duplicate memory showed “That is already remembered.”; pausing and resuming the research digest updated the row both ways. No console errors apart from the expected 400 for the duplicate.

Found and fixed during the check: Hermes's jobs API omits paused jobs unless `include_disabled=true` is passed, so the first pause made the research digest disappear from the page and left it paused; it was resumed from the command line and the listing now includes paused jobs and hides finished one-off jobs. Not tested: “Run now” (it would send a Telegram message), narrow-screen layout, and the page against a Linux-local Hermes home. In the chat reply the assistant wrote that no pork offers were present, which is untrue for this week; the offers shown were correct. Not built yet: the plan view with map, calendar confirmation, and removal of the old loop and pages.


## 2026-10-10 — Plan view with map and calendar steps; old loop and legacy pages removed

Plan view. The planner tool server now saves each checked plan (`data/plans/`, ten kept); the web server serves the newest at `GET /api/plans/latest`; the chat page shows it under the reply as a card with option tabs, a timeline, the route on a Google map, and calendar steps. In the browser against the real assistant, “Plan tomorrow: a museum and sushi, starting from Slussen” answered in 14 s and the card showed three options; switching to option 2 redrew the timeline and the route. “Add to calendar…” required the acknowledgement tick (“Tick the box to continue.” without it), and the preview listed two tentative blocks for Sunday 11 October. Cancel returned to the start. No console errors. **The Confirm button was not pressed against the real calendar**; the write is covered only by the automated test below, against a fake calendar.

Removal, after two snapshot commits (`4434a29`, `17e549a`): the old in-process agent loop and its intake (`lib/agent*.mjs`, `conversation.mjs`, `turn-intent.mjs`, `model*.mjs`), the form-based planner (`live-planner.mjs`), local voice transcription, the Shanghai demo and every legacy page and script in `public/`, the old loop's evaluation set, the one-off migration and probe scripts, and the tests that covered only those. `lib/http.mjs` went from 277 to 105 lines and now has: status, map config, assistant relay, latest plan, profile, calendar connect/preview/confirm, static files. The verification-record (`/api/journey/verify`) and meeting-replan routes went with the old page, so those two features no longer exist in the product. Kept because the planner tool server uses them: `agent-tools.mjs`, `journey.mjs`, `trip-state.mjs`, `reply.mjs`, maps, events, news, calendar, store.

Tests: 220 before, 75 after, all passing; Python suite unchanged at 13. The drop is the removed code's tests, not lost coverage of what remains, with one exception worth stating: `agent-tools.mjs` was exercised mostly through the old loop's tests and is now covered only through the planner tool server's six tests. New `tests/server.test.mjs` starts the real server twice: once to check that private files, removed routes and other origins are refused and that an unconfigured assistant is reported as such; once with a fake calendar to take a saved plan through refused-without-acknowledgement → preview (0 writes) → server restart → confirm (2 events, both “Tentative”, no attendees) → repeated confirm (still 2) → a new calendar conflict blocks both a pending confirmation and a new preview.

Also rewritten in English for the current system: `README.md`, `GOOGLE_SETUP.md`, `public/privacy.html`. After restarting the web server on the slimmed code: `/legacy.html` returns 404, the earlier conversation and its plan card were restored from the tab's storage with the map, and a grocery question was answered from Lidl data in 10 s.

Not done: no evaluation set exists for the Hermes path yet (the old one tested the deleted loop); the plan card was not checked at phone width; `models/` and `.venv-voice/` (untracked, from the removed voice feature) are still on disk.


## 2026-10-10 — Evaluation set for the assistant; everyday actions moved from skills to tools

Evaluation set. `evals/cases.mjs` holds 20 conversations run against the live agent by `scripts/eval-assistant.mjs`: groceries 7, research 4, planner 6, memory 2, manner 1. Each starts from a seeded world (memory entries, food preferences, topics) and is judged on tools run, state written and reply content; five checks apply to every reply (not empty, no `[SILENT]`, no markdown, at most 1500 characters, no internal names). Plan replies are checked against the saved plan: any clock time the planner did not produce fails. The user's memory, preferences, topics and schedule are copied to `data/eval-backup/` first and restored afterwards, also after an interrupted run; memory and the job list were read back after the runs below and matched.

Baseline, before any change: **9/20**, median 10 s and 38k prompt tokens per turn. What it showed:
- The agent followed a skill's rules only when it opened the skill, and it often did not. “I hate pork”, “I love salmon” and “I'm vegetarian” were saved to memory but never reached the offers tracker; “pork is fine again” left the stored dislike in place.
- “Stop tracking retrieval-augmented generation” made the agent **delete a scheduled job** instead of the topic. The job was `trial-arxiv`, a finished one-off left from the first Hermes trial; the two Daylight jobs were untouched. The first version of the harness did not protect the schedule, so this deletion is real and was not undone.
- Feedback on a topic ran the script's `feed` command by hand, which marks papers as sent, and returned a 2132-character digest.
- Planner replies skipped the skill entirely: markdown, all three options listed, nothing said about the calendar being the user's step; a named venue and a stated order were not passed on.
- With a skill opened, a simple question cost three to four model calls (80–120k prompt tokens), often running the same script twice by two different routes.

Change. Conversation actions are now tools on the existing tool server (`mcp/everyday-tools.mjs`): `grocery_offers`, `food_preference`, `research_topics`, beside `plan_day`, `find_events`, `local_news`. They run the same job scripts as the scheduler, so chat and the morning digests share state. Every tool result carries a `howToAnswer` list. The skills keep only the scheduled-digest instructions. Standing instructions now forbid changing the schedule unless asked in those words. Related fixes:
- The job scripts find the small model's key through a path the installer records (`~/.hermes/daylight/config.json` holds the path to the project `.env`, never the key), so remembered facts are applied when the user asks in chat, not only in the morning job.
- Screening runs its batches in parallel and remembers verdicts until the user's preferences or memory change.
- Withdrawing a preference returns the memory entries that are now out of date, so the agent removes them instead of adding a contradicting one.
- A named venue put in the wrong field is recognised when the top search result has exactly that name.
- An order (“first… then…”) or a return time (“back by 17:00”) present in the user's own words is enforced by code when the model omits it.

Results, same day, same data: 15/20 after the tools; 38/40 over two runs after the follow-up fixes; **40/40 over two further runs** after the planner safety nets. Median 6.7 s and 40k prompt tokens per turn; slowest turn 22.7 s (first screening of the week's offers for a new preference; one earlier run had a 72 s turn of the same kind before parallel screening). Skill-free answers take one tool call where they took three or four.

Read these numbers with care:
- Checks changed between baseline and final. Two were wrong and were corrected (they counted the closing “left out 15 pork items” line as showing pork). Two were relaxed on purpose: a dislike known only from memory, or a diet, no longer has to be copied into the tracker's list, because the small model now applies memory directly; the reply must still show no such offer. The baseline's failures on those cases had other causes as well, but 9/20 and 40/40 were not judged by an identical rulebook.
- 40/40 on a set written the same day by the one fixing the failures is a floor against regressions, not a measure of quality. The set has one phrasing per situation and no long conversations.
- `plan-with-stated-limits` passed only after code began enforcing order and return time from the user's words; before that the model dropped one of the four conditions in 4 of 5 runs. Conditions the code cannot read (a venue listed under a different name, a budget, a start time) still depend on the model.
- The return-time reader has a known over-read, recorded in the tests: “I get back from work by 15:00” is taken as the outing's return time.

Tests: 88 Node, 15 Python, all passing (new: tool handlers against a fake script runner, harness state protection, named-venue and stated-words rules, verdict memory, key lookup).

Not done: Telegram was not re-tested after these changes, only the API the web page uses; the scheduled digests were not re-run with the shortened skills; the base prompt is still about 20k tokens per model call, most of it Hermes's bundled tools and skills.


## 2026-10-12 — Job seeker

What was built. `hermes/scripts/daylight_jobs.py` (reader, rules, screening, state in `~/.hermes/daylight/jobs.json`), three tools on the tool server (`mcp/job-tools.mjs`: `job_search_profile`, `job_matches`, `job_application_advice`), a scheduled job every three hours (`daylight-job-matches`, silent unless a new posting fits), a skill for its message, CV upload and a “Job search” card on the “What I know” page (`lib/documents.mjs`, `editCareer` in `lib/profile.mjs`), and five evaluation conversations.

Sources and terms, checked on the providers' own pages on 2026-10-12: Arbetsförmedlingen's JobSearch API (Sweden; no key; “free for anyone to use” per Arbetsförmedlingen, the exact data licence was not found stated), Himalayas and Jobicy (remote roles; no key; both require credit and a link back, Jobicy at most one sync an hour, Himalayas refreshes daily). The script reads Sweden on each run and the two remote boards at most once a day, credits each match's source and keeps its original link. Adzuna and Jooble were looked at and not used: their terms restrict use to publishing their listings or to a short trial. LinkedIn and Indeed were not considered because they forbid automated reading.

How a match is decided, and why it changed three times during live trials with a fictional CV (`deploy/demo/cv-maria-lind.md`, roles “data scientist, machine learning engineer”, Stockholm, English):
1. One prompt asking the small model for a 0–100 fit: 6 of 10 postings “matched”, including an open application for embedded software. Too lenient.
2. Requirement-by-requirement with evidence quoted from the CV, verified in code: weak matches disappeared, but every match showed “no gaps”, because a model shown posting and CV together listed only the requirements the CV met.
3. Two readings: requirements extracted from the posting without the CV in view, then checked against the CV. Gaps appeared, but the small model was erratic at checking (it marked “Python” unmet for a CV listing Python) and nothing matched.
4. Current: small model extracts, the larger Nemotron checks. On the same data: 110 postings read; 101 ruled out by code from stated preferences (87 remote roles not open to applicants in Sweden, 9 outside Stockholm, 2 off-title, 2 older than a month, 1 in Swedish); 9 judged; 4 matched, each with quoted CV lines and plausible gaps (for example “experience with medical image segmentation”); an open application, a platform-engineer role and a data-engineer role were correctly marked as not the kind of role wanted. A first look takes 40–65 s; later looks only read what is new.

A requirement counts as met only when at least 70 percent of the quoted evidence's words are in the CV; fit is met ÷ listed; a match needs the role to be wanted, at least three requirements, and two thirds met.

Web page, checked in the browser against the local server: a text file uploaded through the file picker was read and listed; preferences saved from the form; after a real look through the tool server the card listed two matches with “Meets 5 of 6 main requirements”, the supporting CV quotes, what is not in the CV, the source and a Dismiss button. No console errors. Word files and PDFs are covered by automated tests only (a Word file built in the test; PDF through a stand-in for `pdftotext`): **no real PDF or Word CV has been uploaded yet**, and the local Windows machine has no `pdftotext`, so PDF reading is untested end to end.

Conversations (evaluation set, `--area jobs`, against a development copy of the assistant with no Telegram settings): 13/15 over three runs, then the one failing case 3/3 after its check was corrected. The corrected check had flagged honest advice (“Missing: Kubernetes in production”, “be ready to discuss how you would learn it”) as dishonest; it now flags only an instruction to put a missing skill into the CV, and was tried on a deliberately dishonest reply, which it catches. One real fault was found and fixed: “Drop the Handelskonsult one, I don't want consultancies” was handled as a preference change, which cleared every match; ruling something out now keeps the matches it does not touch, and the tool descriptions say to dismiss a named match.

Tests: 99 Node, 23 Python, all passing.

Not done or not verified:
- The scheduled run has not fired on its own yet, and its Telegram message has not been seen. The run itself was exercised through the tests and through `current --refresh`.
- Only one CV and one set of preferences were tried live. Match quality for other professions, for Swedish-speaking users, or for junior roles is unknown.
- The checks are heuristics: “wanted” and “met” are model judgments constrained by code, not ground truth. Five conversations is a thin evaluation.
- The other twenty evaluation conversations were not re-run after this change.
- For testing, the tool server reads the real assistant home even when the assistant runs from the development copy (Hermes does not pass its home to tool servers), so the evaluation's test data was written to the real local home and restored afterwards. A first, mis-aimed run left two test preferences in the local job profile, which did not exist before today; that file was then deleted.


## 2026-10-12 — Calendar in conversation: read a day, add an event after a separate yes

What was built. Three tools on the tool server (`mcp/calendar-tools.mjs`): `calendar_day` (a day's events with titles and times), `calendar_propose` (prepares one event, names what it overlaps, writes nothing) and `calendar_confirm` (writes it). `plan_day` now returns `alreadyInCalendar` so a plan's reply can say what it was fitted around. A “Calendar” card on the “What I know” page connects and disconnects Google Calendar. By the user's decision, event titles are now sent to the model; descriptions and guests still are not.

The rule that nothing is written without the user's confirmation is held by code, because the model does not reliably keep it:
- a proposal is stored on the server, expires after 15 minutes and can be written once;
- the confirming call must quote the user's message, and only a plain yes passes (“yes”, “ok”, “go ahead”…); anything with “no”, “but”, “change”, “make it”, “maybe” does not;
- a confirmation arriving within 4 seconds of the proposal is refused as being the same turn.
In the evaluation run the model did call propose and confirm in one turn (when the user said “Yes, but make it 12:30”), and the code refused it: nothing was written and the reply asked again with the corrected time.

Tested with a stand-in calendar kept in a file (`tests/calendar-provider.mjs`, with every other request going out as usual), never a real calendar. Six conversations, two runs: 11/12, then the failing one 3/3 after the tool result was made to insist that existing events are named first.
- “Put a meeting with Anna in my calendar tomorrow from 10 to 11” → asked first, 0 writes; “Yes.” → 1 event, tomorrow 10:00–11:00, titled with Anna, no guests.
- Declined (“No, leave it”) → 0 writes.
- “Yes, but make it 12:30 to 13:30” → 0 writes of the old time.
- An event overlapping a seeded “Board meeting” → the overlap was named and the user asked.
- “What do I have on tomorrow?” → both seeded events with times.
- “I'm thinking of going out tomorrow afternoon. Any advice?” with a seeded “Board meeting 13:00–15:00” → the reply names the meeting before asking where the user starts.

Whole evaluation set after this change, same setup: 31 conversations, all passing (29/31 on the first pass; the two failures were the runner looking for saved plans in the wrong folder, and passed when pointed at the right one). The development copy of the assistant now also gives its tools their own home, which removes the cross-contamination noted in the previous entry.

Tests: 106 Node, 23 Python, all passing.

Not done or not verified:
- **Nothing has been written to a real Google Calendar by these tools.** The request shape is the one the existing plan confirmation already uses successfully, but the first real event will be on the VM.
- Changing or deleting an event is not possible; the assistant says so.
- The yes-detector is a word list in English and a little Swedish. An unusual yes (“yes — though not the notes”) is refused and the user is asked again; an unusual no that begins with an agreeing word and contains none of the listed negatives could pass.
- The 4-second rule assumes a person does not answer within 4 seconds of the question appearing.
- Recurring events, other calendars than the primary one, and time zones other than Europe/Stockholm are not handled.
- Saved plans in `data/plans/` now include the titles of that day's events, since the planner keeps the day it read.


## 2026-10-13 — Group use: shared to-do list, reminders, and a script to switch on group summarising

What was built.
- `mcp/todo-tools.mjs`: one `todo` tool (add, show, done, reopen, remove) over named lists kept in `~/.hermes/daylight/todos.json`. A group uses its own name as the list, each change records who made it, numbers are never reused across lists, and an unclear reference (“the call one” when two match) is returned as a question, not guessed.
- Standing instructions for reminders (a one-time scheduled job delivered to the chat the request came from) and for behaviour in a group: answer only when addressed, summarise from observed context with attribution, share the group's to-do list, and keep the owner's memory, CV, job search, food preferences and calendar private.
- `deploy/group-on.sh <chat id>`: sets three Hermes settings and restarts. Read from Hermes's own Telegram adapter (v0.21.6): `TELEGRAM_OBSERVE_UNMENTIONED_GROUP_MESSAGES` stores messages the bot was not mentioned in as context shared at chat scope, but only for chats listed in `TELEGRAM_GROUP_ALLOWED_CHATS`, and only for messages that `TELEGRAM_REQUIRE_MENTION` would otherwise skip. With these on, a triggered group turn carries each speaker's name.
- `deploy/setup-vm.sh` now sets `HERMES_TIMEZONE=Europe/Stockholm`.

Tested through the assistant's API with the development copy (private-chat context): three conversations, two runs, 6/6. Two to-do items added in separate messages were both listed in a later conversation; “I've renewed the passport, tick that off” marked the right item done and left the other open; “Remind me next Friday at 9:00 to call the dentist” created exactly one new scheduled job, left the three Daylight jobs untouched, and confirmed “Friday October 16 2026 at 09:00 Stockholm time”. The evaluation runner removes the job afterwards.

Tests: 109 Node, 23 Python, all passing.

**Not tested at all, because it needs a real Telegram group and the bot lives on the VM:**
- Whether observed group messages actually reach the model, and whether a summary is any good.
- Whether a reminder set in a group is delivered to that group. Through the API the assistant said “delivered to your home channel”, which is the fallback when there is no originating chat.
- Whether the privacy instruction holds in a group. It is an instruction only: nothing in code stops a group member from asking for the owner's calendar or job matches, because a tool cannot tell which chat called it.
- Whether `HERMES_TIMEZONE` governs the scheduler. If it does not, the VM's clock (UTC) does, and “at 9” fires at 11:00 Stockholm summer time.
- The reminder took two calls to the scheduling tool for one job (the first presumably refused); the cause was not looked into.

Known limits: the assistant sees only what is said in the group after this is switched on; the to-do lists are not yet shown on the “What I know” page; one conversation and one memory are shared by the whole group and with the owner's private chat.


## 2026-10-13 — Voice on the web page: heard on the server, and a separate short line spoken

Design (the user's): what is spoken is not what is written. The full answer stays on screen; the voice gives a brief acknowledgement the moment the speaker stops, one phrase about what is actually happening if the wait passes three seconds, and one short line made for the ear when the answer is ready. That line is shown under the answer (“Said aloud: …”).

What was built.
- Hearing: `lib/speech.mjs` keeps one Python worker (`lib/transcribe.py`, faster-whisper) loaded; the page records until a pause follows speech (`public/voice.mjs`) and posts the clip to `POST /api/voice/hear`. Place names, the user's research topics and job roles are passed to the model as words to expect.
- The spoken line: `spokenLine` in `lib/voice.mjs` asks the main Nemotron model for one or two sentences. Code refuses a line containing a number that is not in the written answer, a link, or markup, and falls back to “Here's what I found. The details are on the screen.”
- A question to the user is never paraphrased: it is spoken word for word. This rule was added after the live trial below.
- Speaking: Google Cloud Text-to-Speech (Chirp 3 HD) through a service account, signed in from Node without a library; repeated phrases are kept in memory. `POST /api/voice/say` will speak only the assistant's own fixed phrases, so the page cannot be used to synthesise arbitrary text. Without a key the browser's own voice speaks the same lines.
- `deploy/voice-on.sh` installs the listener, optionally the voice key, and checks both.

Measured on the VM (2 shared cores, AMD EPYC 7B12, 3.9 GB), with `deploy/measure-whisper.sh`: `base.en` took 1.3–1.5 s per clip and 365 MB; `small.en` and `small` took 3.9–4.5 s and 870–940 MB. All three transcribed an 11-second real voice exactly. Two synthetic (robot-voice) clips were partly misheard by every model, so they say little about accuracy; “Slussen” and “Medborgarplatsen” survived in all of them with the hint words. Chosen: `base.en`.

Live trial of the spoken line with the real model, five written answers: 1.2–3.2 s each, natural and free of lists, times and links (for example, for three events with links and times: “I found a jazz festival at multiple venues, a comedy show tonight, and free entry at a modern art museum this evening. Want more details on any of them?”). One line was wrong in a way that matters: for a calendar event that was only being proposed it said “I've scheduled a meeting with Anna”. Hence the rule that a closing question is spoken verbatim, preceded by “The details are on the screen.”

Checked on the local server with voice not configured: the page loads without errors and shows no microphone button; `/api/voice/say` returns the phrase for a progress step and refuses arbitrary text (400); `/api/voice/line` returns a line with no audio.

Tests: 117 Node, 23 Python, all passing (worker protocol against a stand-in process, the number check, question handling, service-account signing verified against the public key, the clip queue, the end-of-speech rule).

**Not tested: anything that needs a microphone, a speaker, the Python worker or Google's speech service.** Specifically: recording in a real browser, the worker reading a real browser recording (WebM/Opus), recognition of the user's own voice and accent, the Chirp request and its audio, how the timing of acknowledgement, waiting phrase and spoken line feels, and whether the browser allows audio to start after the asynchronous steps. All of it will first run on the VM.

Known limits: English only; one recording at a time; the model's line is checked for numbers, not for other invented claims; “base.en” is the least accurate Whisper size and was chosen for speed on this machine.


## 2026-10-13 — New look for the web page

The page keeps its structure and is restyled as an instrument: paper and ink, hairlines and right angles, one signal colour (lime) used only as a fill behind dark text, a geometric typeface for words and monospace for everything the machine reports (steps, counts, labels). Dark mode follows the system setting. Motion marks a change of state only: a new message rises in, a section draws its rule and cards on opening, the mark in the corner orbits slowly and quickly while the assistant works, the working indicator is three level bars over a sweeping line, the online dot pings. All of it is switched off for users who ask for reduced motion.

Checked in the browser on the local server: the welcome screen, a conversation with a spoken-line caption and step line, the "What I know" page, dark mode for both, and phone width (375 px) for the chat. No console errors from the page.

Not checked, because the assistant was not running locally: the working indicator and message animation during a real reply, the plan card with its map, the microphone button's states, and "What I know" at phone width. Contrast was judged by eye, not measured.

The two typefaces come from Google Fonts, so opening the page now makes a request to Google; the data page says so, and the page falls back to system fonts without them.


## 2026-10-13 — The day dial, and a page lit by the real sun

The page now has an idea of its own, taken from the product's name and the brief (“always on”): it shows the assistant's day.
- **The dial** on the opening screen is a 24-hour face, midnight at the bottom and noon at the top. It draws today's daylight over Stockholm as an arc, the sun where it is now, and a mark at every time a scheduled job runs (filled if still to come today, hollow if done). On opening, the face draws itself and the sun sweeps from midnight to the present.
- **The strip** under every heading is the same day flattened: daylight, the runs, and a beacon at now.
- **The mark** beside the name is the same face in miniature, with the sun at the real time.
- **The page's light follows the sun**: light between sunrise and sunset, dark otherwise, with a warm glow at dawn and dusk and a blue one at night, placed where the sun is in its day. A control in the sidebar cycles between following the sun, day and night; the choice is kept in the browser.

`public/dial.mjs` computes Stockholm's clock, sunrise and sunset (the standard short formula), the phase of the day and each job's run times from its schedule. Tested (`tests/dial.test.mjs`): midsummer and midwinter sunrise and sunset within 8 minutes of the almanac values I had (03:31/22:08 and 08:43/14:48), mid-October day length about ten and a half hours, the light switching just after sunset and just before sunrise, and the run times for the three schedules in use. My remembered almanac figure for mid-October sunrise disagreed with the formula by 9 minutes; the formula agrees with the two solstice figures, so I trusted it and tested day length there instead.

Checked in the browser on the local server: the opening screen by day (14:20) and by night (21:40) with three sample jobs placed on the dial, the real current state (06:15 in Stockholm: dark, pre-dawn), the “What I know” page with the strip, and the light control. Two faults found and fixed on the way: job marks drawn as rotated squares were thrown off position by the styles that animate them (now drawn as outlines), and the highlighted line of the headline covered the line above it.

Not checked: the dial with the real jobs from a running assistant (locally there were none, so sample jobs were placed by hand), the once-a-minute update over a long time, behaviour at the moment of sunrise or sunset, phone width for the new opening screen, and how the entry animation performs on a slow device.

Worth knowing: the light follows Stockholm's sun, not the viewer's. Someone opening the page from another time zone during their day may find it in night mode; the dial states the Stockholm time, and the control overrides it.

Tests: 122 Node, 23 Python, all passing.


## 2026-10-13 — A living background

The page's dot grid is now drawn on a canvas (`public/atmosphere.mjs`) and moves:
- a slow wave of light travels outward from where the sun is in its day;
- the pointer bends the grid like a lens: nearby dots are pushed away, grow and take the signal colour;
- by night about one dot in twenty-five is a star with its own slow twinkle;
- while the assistant is working, quick rings run outward across the field.
It runs at about thirty frames a second, stops when the tab is hidden, and draws a single still frame for anyone whose system asks for reduced motion. Without it (or if the canvas cannot start) the old static grid remains.

Tested (`tests/atmosphere.test.mjs`): a dot never leaves its grid point unless the pointer is near, never grows or brightens without limit, the same dots are stars every time, and the working rings reach a dot when they should.

Seen in the browser on the local server: the lens around the pointer by day, and the star field by night; no console errors. **Not measured: how smoothly it runs.** The preview pane throttles animation to about one frame a second when it is not in front, so the motion itself, and its cost on a slow laptop or a large screen, have only been reasoned about (roughly three thousand small rectangles per frame). The working rings were not seen live, since the assistant was not running locally.

Tests: 126 Node, 23 Python, all passing.


## 2026-10-13 — Chat heading removed; a curled page corner starts a new conversation

At the user's request the chat screen no longer has its heading (“Chat”), its subtitle or the day strip, and the “New conversation” button is replaced by a curled corner at the top right of the page. At rest it is a small folded corner showing the signal colour underneath. Pointing at it (or focusing it with the keyboard) lifts it further and shows “New conversation”. Clicking it turns the page: the fold sweeps from the corner across the whole sheet, the new conversation is put in place underneath, and the sheet fades. The corner is hidden when there is nothing to turn, disabled while a reply is being written, and under reduced motion a click starts the new conversation at once. The “What I know” page keeps its heading and strip.

Checked in the browser on the local server: the corner at rest, the lifted state with its label, a frame from the middle of the turn, and a real click (two messages before; none after, the opening screen shown, the turning sheet removed, the stored conversation empty; no console errors). The motion itself was seen only as stills, because the preview pane throttles animation; its smoothness, and the corner on a phone-width screen, are unchecked.

Tests: 126 Node, 23 Python, all passing.


## 2026-10-13 — A character for the assistant

A small day-spirit drawn as vector shapes in `public/mascot.mjs`: dark hair in two buns tied with signal-coloured bands, a hair clip and a brooch in the same diamond that marks the assistant's runs on the dial, large eyes with a lime lower iris, a pale poncho, and behind her head a dotted ring with the sun at the real time, the day dial in miniature. She keeps her own colours on any background; on a dark page her hair gets a light rim. Four moods change eyes and mouth: idle (blinks, bobs, her stray hair sways), thinking (looks up, the ring turns, three dots rise), speaking, happy. Pointing at her on the opening screen makes her smile and wave.

Where she appears: beside the greeting on the opening screen, and in the bubble while the assistant is working. Standalone pictures are written to `public/mascot.svg` and `public/mascot-dark.svg`, and the README shows the first.

Seen in the browser on the local server: the standalone picture on light and on dark, the opening screen with her beside the greeting, and the thinking, speaking and happy moods placed by hand. The first dark version was wrong (her colours inverted with the theme and her face disappeared) and was redrawn with fixed colours. Her animations were seen only as stills, since the preview throttles animation; the speaking mood is drawn but not yet used by the page.

Tests: 126 Node, 23 Python, all passing.


## 2026-10-13 — The page redesigned around the user's character

The user supplied a character illustration (a small winged girl in Egyptian dress with the Eye of Horus above her head) and asked for the design to be rebuilt around it. The vector mascot from earlier today was removed.

- **Her artwork is used as it is.** `design/cutout.py` (Pillow, run in WSL) removes the near-white background by flood fill from the picture's edges, so the white of her dress is kept, then removes the ground shadow and the pale glow marks by rule. It writes `public/character.webp` (817×880, 126 KB, transparent) and `public/character-head.webp` (256×256, 28 KB). The original is kept at `design/character-original.webp`.
- **Where she stands.** On the opening screen she is in front of the day dial, which becomes her halo: the ring of hours, the daylight arc, the sun and the job marks surround her; the time, date and sunrise/sunset moved to a caption beneath. She floats gently and arrives after the dial has drawn itself. A warm disc behind her (stronger in night colours) keeps her dark hair readable on a dark page. Her face appears beside the reply while the assistant is working, inside a turning dashed ring.
- **The palette is hers.** Ink is the navy of her hair, the one signal colour is the gold of her collar (replacing lime), a lapis accent from her eyes is used for link underlines, the working sweep and the avatar's ring, and the paper is warmer. Night colours are deep blue instead of near-black.

Seen in the browser on the local server: the opening screen in day and in night colours with her in the dial, and the working bubble with her face. The first night version left her hair lost against the background; the disc behind her was enlarged and brightened and she now reads clearly. No console errors.

Not checked: phone width; her float and arrival as motion (stills only); the cut-out's edge at full size on a very large screen (a faint pale fringe is possible where her outline met the white background).

Open question recorded for the public repository: the illustration's origin and whether it may be redistributed under the repository's licence are for the user to confirm; it is the one file in the project not written here.

Tests: 126 Node, 23 Python, all passing.

## 2026-10-13 — Hora name and three character interactions

- Named the assistant Hora in the UI, document title, repository persona and installed Hermes persona. Only the name sentence was replaced in the installed SOUL.md; its prior contents are backed up at data/SOUL.before-hora.md. No scheduler or service configuration changed.
- Added transparent imagegen assets: public/hora-typing.png (two registered back-view keyboard poses) and public/hora-pull.png (a single crook pose). Exact generation prompts, reference and animation layout are in design/hora-assets.json. Images are served only through the existing static allowlist with image/png MIME type.
- The pending answer alternates the typing poses every 320 ms, retaining the actual tool-progress text. It stops when reply text arrives or the request ends. This is a two-frame sprite animation, not skeletal animation.
- Hover/focus on the existing page curl reveals Hora. Clicking pauses briefly while she catches it, then her hook follows the fold midpoint. Existing new-conversation semantics remain; input is blocked during the turn, the completion callback is idempotent, and a timeout releases the UI if the browser skips transitionend. Reduced motion skips the turn and disables sprite/peek motion via the existing media query.
- Home now has her upper face peeking over an introduction card and four conversation shortcuts. The day dial remains alongside/below it. Dark mode adds a soft glow to keep the navy ahoge readable.

Validation: all 126 existing Node tests passed; final JavaScript syntax and diff whitespace checks passed. Browser checks covered the real home page in light/dark themes, a 390 x 844 mobile viewport, and an isolated fixture on port 4320 for the pending/reply/new-conversation states. Both sprite background positions were observed (0% and 100%, 0.64 s period). The shortcut started a pending turn, its controls disabled, the reply replaced the sprite, and two page-turn runs returned to the introduction with zero old turns, zero overlays, and no inert attribute left on the app. No console errors observed. The temporary fixture and tab were stopped/closed; the real page remains on port 4318 with the original automatic theme restored.

Evidence: artifacts/hora-home.jpg, artifacts/hora-home-night.jpg, artifacts/hora-mobile.jpg, artifacts/hora-typing-mobile.jpg, artifacts/hora-curl.jpg. The fixture lives at artifacts/hora-ui-preview.mjs (ignored local diagnostic artifact).

Scope: Hermes was offline during these checks. The animated waiting/reply sequence used a clearly labelled canned response and no provider calls, calendar operations, or model-quality evaluation. Browser screenshots show key states; motion smoothness across different devices and the OS reduced-motion setting were not manually assessed. Python components were unchanged and were not rerun.

## 2026-10-13 — Retro desktop typing revision

Replaced only public/hora-typing.png with a transparent two-frame sprite featuring a bulky beige CRT, separate tower and keyboard. Legs are brought forward into a narrower V, targeting a 70-degree total opening as an illustrated approximation rather than a measured skeletal angle. Both feet remain visible, with the left partly occluded by the character. The original laptop sheet is retained at design/hora-typing-laptop.png; built-in imagegen prompt history is in design/hora-typing-retro.json. The existing two-frame CSS animation and UI wiring are unchanged.

Verified the final raster by visual inspection, confirmed a 2:1 canvas with alpha, and checked the live asset returns HTTP 200 with image/png. No application code changed; the automated suite was not rerun for this asset-only revision.

## 2026-10-13 — Front-facing grip and sequential staff reach

- New public/hora-peek.png: front-facing upper face and both gripping hands. Responsive portrait width increased from 280 to 440 px; the hands overlap the actual card edge at 81.5% of the image height. The breathing scale pivots at that edge, with pointer events disabled on the artwork so shortcuts remain usable.
- New public/hora-reach.png: twelve poses in a 4-column, 3-row transparent sheet, taking out the staff, raising it, lifting the heels, reaching, catching and leaning back. A 1320 ms sequential animation precedes the existing 780 ms page turn. The animation-end event starts the pull, with bounded fallbacks; the final pose stays fixed during the pull. Reduced-motion behavior remains immediate. This is frame animation, not skeletal interpolation.
- New PNGs are explicitly allowlisted and preloaded. Imagegen references and prompts are in design/hora-peek-reach.json and design/hora-assets.json. Earlier artwork remains available.

Validation: 126 Node tests pass. Both new assets return HTTP 200 with image/png. Real homepage inspected on port 4318; isolated provider-free preview on port 4320 checked the complete action. A requestAnimationFrame observer recorded all twelve expected sprite positions, pull start at 1334 ms and completion at 2117 ms. No premature conversation reset; after completion the intro was visible, old turn count was zero and the app was not inert. The fade overlay subsequently disappeared. At 390 x 844, document width equals viewport width (390 px). No browser console errors observed. Preview process/tab stopped, temporary viewport reset. No live model or calendar requests were made.

Evidence: artifacts/hora-reach-timing.json, artifacts/hora-peek-front.jpg, artifacts/hora-peek-front-mobile.jpg. Diagnostic observer: artifacts/hora-probe.mjs, served only by the ignored local preview fixture. OS reduced-motion setting was not manually toggled in this run.

## 2026-10-13 — Effort expressions during the page turn

Edited public/hora-reach.png with built-in imagegen: preparation retains the cheerful face; raising/reaching closes the lips and furrows the brows; the last three pull poses squeeze both eyes into >_< with a pressed mouth. The 4 x 3 frame order, CSS timing and turn lifecycle remain unchanged. Previous sheet preserved at design/hora-reach-before-expressions.png; exact prompt in design/hora-reach-expressions.json.

Visually inspected the generated sheet; verified PNG dimensions against the previous sheet, alpha, and HTTP 200 image/png delivery. This was an asset-only change; no application tests or live model calls were rerun.


## 2026-10-13 — Review and merge of the Hora changes

The Hora work above was made in this folder by another tool and left uncommitted. Reviewed before merging:
- **Code.** `public/daylight.mjs`, `public/daylight.css`, `public/index.html`, `lib/http.mjs` and `hermes/SOUL.daylight.md` read through. The page-turn sequence guards against finishing twice, releases the page (`inert`) on every path including the timeout, and keeps the reduced-motion shortcut. Nothing outside the page and the persona's first sentence was touched. 126 Node tests pass; no whitespace errors.
- **Artwork.** The three sheets were looked at: the front-facing portrait with both hands, the two typing frames at the beige desktop computer, and the twelve poses with the changing expressions. A few stray red pixels sit on the edges of some poses in the reach sheet; they were left as they are.
- **Changed on merge.** The four PNGs (about 1.5 MB each, 4.7 MB preloaded on first visit) were moved to `design/` as originals and the page now serves WebP copies written by `design/to-webp.py`: 277, 446 and 267 KB, same pixel sizes, transparency kept, so the frame layouts are unchanged. `hora-pull.png` is no longer used by the page and is not served. The unused head portrait from the earlier design was removed. `design/` is kept in the repository but left out of the archive that goes to the server. The page no longer scrolls sideways while the corner is being pulled. The README's “laptop” was corrected to the desktop computer.

Checked in the browser on the local server with the WebP copies: the opening card with Hora gripping it and the dial beside it; the typing sprite in a pending bubble; a real click on the corner, during which the page was inert and the reach sheet was showing, and after which the conversation was empty, the opening card was back, the turning sheet was gone and the page was usable again. Title and name read “Hora · Daylight” and “Hora”. No console errors.

Not checked here: the motion as motion (the preview throttles animation; the other tool's notes record all twelve frames observed), phone width, and anything with the assistant running. The other tool also changed the first sentence of the locally installed Hermes persona (`~/.hermes/SOUL.md` in WSL) and left a copy of the earlier text at `data/SOUL.before-hora.md`; the VM's persona is unchanged until `hermes/install.sh` is run there.


## 2026-10-14 — Reposting a digest on request

Asked in a group, “paste today's research digest here” had no good answer: the assistant has no way to fetch papers in conversation (by design, since fetching marks papers as sent), so it would either decline or improvise a search outside Daylight. Rather than add on-demand fetching, the user proposed reposting the digest already sent.

`mcp/digest-tools.mjs` adds `latest_digest` (research, groceries or jobs). Hermes keeps every scheduled run under `cron/output/<job id>/`, with the delivered message after “## Response”; the tool returns the newest real one word for word, skipping runs that found nothing ([SILENT]) and saying so, and says when the newest digest is from an earlier day. Nothing is fetched and nothing is marked. Standing instructions: use it for “show/repost the digest”, post the text unchanged, and in a group only the research digest (the other two describe the owner's food and job search).

Tests (`tests/digest-tools.test.mjs`): only the delivered message is taken from a saved run; today's digest comes back unchanged; quiet runs are skipped and named; a digest that never ran or is not set up is said plainly. 131 Node tests pass.

Live check with the development assistant and a real saved digest placed as today's run, three phrasings (“Paste today's research digest here.”, “Can you post this morning's papers in the chat?”, “What did today's research digest say?”): every time it used the tool and reproduced all 8 paper links, adding none; 7–10 s each. Not checked in a real Telegram group.


## 2026-10-14 — She answers as Hora, and “what can you do” is about her

Two faults reported by the user: asked who it is, the assistant said Hermes Agent; asked what it can do, it listed Hermes's general abilities. Cause of the first: Hermes's default persona file (`SOUL.md`) opens with “You are Hermes Agent, built by Nous Research.”, and the Daylight block naming her Hora was appended after it, so the first identity won.

- `hermes/install.sh` now puts the Daylight block first in `SOUL.md` and changes only Hermes's opening sentence to “You are Hora, a personal assistant built on Hermes Agent by Nous Research.”, keeping its style advice. The original file is kept once as `SOUL.md.before-daylight`. Re-running the installer is safe.
- A new tool, `about_hora` (`mcp/about-tools.mjs`), answers “who are you / what can you do / how do I start” from what is actually set up: seven abilities, an example of what to say for each, and for anything not ready the one step that sets it up (upload a CV on the web page, name a research topic, connect the calendar). In a group it leaves out the owner's own settings. The standing instructions say to use it, and not to list general tools (files, code, browsing, the terminal) unless asked what else she can do.

Live check with the development assistant: “Who are you?” twice → “I'm Hora, a personal assistant in Daylight that keeps working while you are away. Would you like to hear what I can do?”; “What can you do?” twice → the seven abilities with an example each and the two missing steps (CV, research topic), no general tools; “How do I get started?”, after a tightening of the answer instructions, twice → two numbered steps and one line saying everything else works already. Never named Hermes. 5–7 s each. Not checked in Telegram or on the VM.

Tests: 134 Node, 23 Python, all passing.
