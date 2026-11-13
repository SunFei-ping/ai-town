# AI应用开发实习生（内容方向）笔试作业 —— AI小镇｜提交人：SunFei-ping

## 一、作品本体（GitHub 仓库，main 分支）

- **GitHub 仓库**：https://github.com/SunFei-ping/ai-town
- **在线 Demo（免安装，示例镇无需 API Key）**：https://preview.ai-town-5ts.pages.dev
- **本地运行**：`npm install && npm run dev`，打开 http://127.0.0.1:4173（详见 README）
- **形态**：纯前端 + Cloudflare Pages / Workers；小镇、居民、记忆、剧情保存在浏览器 IndexedDB，服务端不持久化剧情正文
- 想开自己的小镇，在页面里填自己的 DeepSeek / OpenAI 兼容 API Key；不填时使用本地桩模型，不消耗额度

## 二、交付文档（公开可读，无需登录）

- **README**：https://github.com/SunFei-ping/ai-town#readme
- **图文教程（约 1033 字，6 张真实截图）**：
  - PDF：https://github.com/SunFei-ping/ai-town/blob/main/AI%E5%B0%8F%E9%95%87-%E5%9B%BE%E6%96%87%E6%95%99%E7%A8%8B.pdf
  - HTML 源文件：https://github.com/SunFei-ping/ai-town/blob/main/docs/showcase/tutorial.html
  - 截图目录：https://github.com/SunFei-ping/ai-town/tree/main/docs/showcase/assets
- **创作说明（181 字）**：本文第三节
- **设计与数据文档**：`docs/spcd.md`、`docs/data.md`、`docs/task.md`

## 三、创作说明（181 字）

我选这个题，是因为不想再做“AI 替我干活”的工具，而是想看“AI 自己生活”。五个居民、七天、每天一份小报，用户不是玩家，是订阅者；看点就是只能围观、不能指挥，以及每份小报里那五句没说出口的话。

开发主要用 Trae 写代码与文档、DeepSeek 生成剧情。踩过的坑：Cloudflare KV 只收字符串且 TTL 最少 60 秒；SSE 的 done 帧早于释放锁会让下一天撞锁；C5 词表误把常用词当秘密，对话被替换成省略号。

如果发布，我会起标题《我把五个 AI 关进海边小镇，7 天后他们开始瞒着彼此》，发在小红书和公众号，配小报截图。

## 四、这轮测出了什么

**真实模型 3 局 × 7 天**

- 21 个 tick、285 次模型调用，3/3 连续通过
- P50 9558ms，P95 13135ms，最大 15680ms（门槛 150 秒）
- 单轮最高成本 0.050268 元，总成本 0.138821 元（门槛 5 元/局）
- 指标由 `scripts/metrics.mjs` 输出到 `test-results/metrics.json`

**规则项（自动）**

- 4 条契约用例覆盖 3 类规则：零信息开场不超过 2 次、每份小报至少 1 条关系变化、5 条 unsaid 各不相同且含具体细节
- 示例镇 7 天逐日校验全部通过；缺条、重复、过短、无名词均有负向用例

**主观项（人工）**

- 海边小镇模板，3 局 × 7 天，真实模型，局内记忆与关系连续
- 3/3 评为「能看」，未达「想看下一集」
- 主要短板：场景与人物组合重复、头条句式单一；第 3 局出现过无人碰面的一天

**这轮修掉的坑**

- Cloudflare KV 只接受字符串，结构化值必须 JSON 序列化
- KV `expirationTtl` 最小 60 秒，限流键按 60 秒兜底
- `done` 帧早于释放 tick 锁，导致客户端推进下一天时撞锁
- C5 词表把 2 字常用词（「人的」「一个」「故事」）当秘密，正常对话被替换成「……」
- Pages 静态发布只上传了 `web/`，漏掉 `data/` 与 `shared/`，线上回落到 `index.html`

**验证边界（写进 README）**

- 3 局样本、每组只跑一次；主观评审只有项目负责人 1 人，非盲审
- 成本按适配层单价折算，不是云平台账单
- 只测了 DeepSeek 一个模型，未做多模型对比
- 未做高并发 / 多用户压力测试；KV 最终一致性未单独验证
- 主观分只有「能看」，没有达到「想看下一集」
