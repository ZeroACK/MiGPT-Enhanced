# MiGPT-Next 语音助手

把小爱音箱接到任意 OpenAI 兼容大模型（默认 DeepSeek）上：除智能家居控制、音箱自身媒体指令之外的**所有问答都交给大模型**。

## 目录结构

```
.
├── main.js                 # 入口：读配置 → 装配 hook → 启动引擎 + 设备词表刷新
├── config.json             # 全部可配置项（账号、音箱、模型、设备别名）— 已被 git 忽略
├── config.example.json     # 配置模板，复制为 config.json 后填写
├── prompt.md               # 提示词模板，含 {{query}} / {{time}} / {{history}} 占位符
├── .gitignore              # 忽略依赖、config.json、.mi.json、日志
├── migpt-next.service      # systemd 单元文件（日志交给 journald）
├── package.json
├── src/
│   ├── config.js           # 读取/校验 config.json，解析配置文件路径
│   ├── engine.js           # 引擎装配 + 自建轮询循环（可控心跳、单轮失败不退出）
│   ├── hook.js             # onMessage：回声过滤 → 固定短语 → 分流 → 抢话 → 回答
│   ├── router.js           # 分流核心：设备词表、媒体指令、疑问守卫、classifyRoute
│   ├── inventory.js        # 从米家拉设备清单 → 生成设备词表，每 10 分钟刷新
│   ├── prompt.js           # 读取 prompt.md、校验并渲染 {{占位符}}
│   ├── llm.js              # 流式请求（SSE）、分句、朗前清洗
│   ├── speech.js           # TTS 播放、按句流式朗读、回声保护、打断上一轮
│   ├── replies.js          # 固定应答短语
│   └── types.js            # 共享 JSDoc 类型（Engine / Message / AppConfig）
└── test/
    ├── fixtures.mjs        # 真实设备清单 + 假流式接口（记录发给模型的请求）
    ├── router.test.mjs     # 词表推导 + 分流用例
    ├── hook.test.mjs       # 钩子行为、回声拦截、抢话顺序、模板渲染
    ├── llm.test.mjs        # 分句、清洗、SSE 解析、非流式兜底、错误处理
    └── prompt.test.mjs     # 占位符渲染与校验
```

## 分流规则

每次说话都会先由 `src/router.js` 判断由谁处理：

| 判断顺序 | 条件 | 处理方 |
|---|---|---|
| 0 | 唤醒词本身（`小爱同学` / `小爱`） | 忽略；后面还有内容就只处理后面的部分 |
| 1 | 媒体指令前缀（播放 / 下一首 / 音量 / 听歌 …） | 音箱原生 |
| 2 | 信息类疑问（为什么 / 怎么 / 多少钱 / 几点 …） | 大模型 |
| 3 | 说到设备词 **且** 带控制动词（打开 / 关 / 调到 …） | 音箱原生 |
| 4 | 说到设备词但没动词（"我家空调"） | 大模型 |
| 5 | 其他疑问词（吗 / 呢 / 是不是 …） | 大模型 |
| 6 | 强动词开头且很短（"关闭"、"调到 26 度"） | 音箱原生 |
| 7 | 其余全部 | 大模型 |

设备词表来自**真实米家设备清单**：设备名（如 `客厅摄像头`、`客厅电视`）+ 由 MIoT model 推导的类别词（`xiaomi.tv.*`→电视、`xiaomi.light.*`→灯、`miir.aircondition.*`→空调…）。所以设备叫英文名也能听懂「电视关机」。

某句话被判断错时，不用改代码：

- 该走原生却被大模型抢答 → 在 `config.json` 的 `extraDeviceWords` 里加别名；
- 该走大模型却被当成设备指令 → 换个说法，或在米家里给设备起个更明确的名字。

## 配置

`config.json`（权限建议 `chmod 600`；已被 `.gitignore` 忽略，首次部署从模板复制）：

```bash
cp config.example.json config.json && chmod 600 config.json
```

```jsonc
{
  "debug": false,
  "speaker": {
    "did": "客厅音箱",        // 米家里的小爱音箱名称
    "userId": "123456789",     // 小米 ID，必填（同时作为登录 cookie）
    "password": "",             // 可空：passToken 失效时才用到
    "passToken": "V1:...",      // 长期登录令牌，优先使用
    "heartbeat": 300            // 轮询间隔 ms，最低 300，越快抢答越及时
  },
  "bargeInText": "嗯",          // 检测到要由大模型回答时先播这句打断原生回答；"" 关闭
  "openai": {
    "baseURL": "https://api.deepseek.com",
    "apiKey": "sk-...",
    "model": "deepseek-v4-flash",
    "params": { "thinking": { "type": "disabled" } }  // 额外请求字段：关掉思考，首字快一倍
  },
  "promptFile": "prompt.md",     // 提示词模板，相对 config.json 的路径
  "context": {
    "historyTurns": 5,           // 保留几轮对话（一轮 = 你一句 + 它一句），0 关闭
    "vars": {}                   // 模板里可额外使用的自定义占位符
  },
  "extraDeviceWords": ["冷气", "音响"]
}
```

- `passToken` 获取：<https://github.com/idootop/migpt-next/issues/4>
- `baseURL` 写裸域名或 `/v1` 结尾，**不要**带 `/chat/completions`。
- 登录成功后会在工作目录生成 `.mi.json` 缓存，权限同样建议 600。

## 提示词模板 `prompt.md`

提示词单独放在 Markdown 文件里，改文案不用动代码。每次收到一句话，程序会把模板渲染成一份新的 system prompt 再发给模型：

| 占位符 | 内容 |
|---|---|
| `{{query}}` | 用户这一次说的话（已去掉「小爱同学」唤醒词） |
| `{{time}}` | 当前时间（Asia/Shanghai，含星期） |
| `{{history}}` | 最近对话，按 `context.historyTurns`（轮数，一轮 = 一问一答）截取，形如 `用户：…` / `助手：…` |

- 模板里写了 `{{history}}`，历史就只以文本形式注入模板；**没写**才把历史作为独立消息发给模型，避免重复。
- 还可用 `context.vars` 自定义占位符，例如 `"vars": { "name": "小助手" }` → 模板里写 `{{name}}`。
- 启动时会校验占位符：写错（如 `{{qurey}}`）会直接报错并列出可用名字，不会把 `{{qurey}}` 原样发给模型。
- 文件路径可在 `config.json` 用 `promptFile` 改，或用环境变量 `MIGPT_PROMPT` 覆盖。

## 流式输出

`src/llm.js` 直接请求 `POST {baseURL}/chat/completions` 并带 `stream: true`，边收边播：

1. 模型每返回一段文字，就按 `。！？!?；;…` 和换行切分；没有标点但已超过 80 字也会先播，避免一直等；
2. 每句先去掉 Markdown 和 emoji，再交给音箱 TTS；
3. TTS 请求受理即返回、且新的 TTS 会打断上一句，所以每句播完才发下一句：先按字数估算时长（`speech.leadUpMs` + `speech.msPerChar`），再查一次播放状态确认，确认结束才继续；
4. 用户下一句话进来时（非回声），在播的回答立刻中止，不会和用户抢着说；
5. 请求失败会播一句「抱歉，我这边出了点问题，请稍后再说一次吧」，并写日志；
6. 接口不支持流式（没返回 `text/event-stream`）时自动按普通 JSON 应答兜底。

## 时延

回答要等模型，等待的大头是「模型开始输出」而不是「音箱出声」。为此做了这几件事：

- **提示词常驻内存**：`prompt.md` 只在启动时读一次（`main.js` 里 `loadPrompt`），每轮只在内存里做一次正则渲染；
- **发起请求先于插话**：检测到要回答时立即把请求发出去，同时播 `bargeInText`，TTS 的那次网络往返不再串在模型前面；
- **`openai.params` 关掉思考**：DeepSeek 的 `thinking` 默认会先输出一段推理内容，程序只能等正文。设成 `{"thinking":{"type":"disabled"}}` 后实测首字从约 1.3–1.7s 降到约 0.45–0.75s；
- **轮询 300ms**：把「你说完」到「发现你说完」的平均延迟压到 0.15s 左右；
- 每轮都会打一行 `[migpt] timings: ttft=…ms first-audio=…ms total=…ms`，想继续调参就看这行。

## 运行

```bash
cd ~/migpt-next
npm install          # 首次
node main.js         # 前台运行，Ctrl+C 退出
```

启动正常时输出：

```
[migpt] config: ~/migpt-next/config.json
[migpt] prompt: ~/migpt-next/prompt.md (618 chars, in memory)
✅ 服务已启动...
[migpt] routing vocabulary: 31 words (客厅摄像头、摄像头、监控、…)
[migpt] polling every 300ms
```

## 作为 systemd 服务

```bash
sudo cp migpt-next.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now migpt-next
journalctl -u migpt-next -f          # 看日志
sudo systemctl restart migpt-next    # 改完代码/配置后生效
```

## 测试

```bash
npm test        # node --test test/*.test.mjs
```

测试不联网、不碰音箱：用桩引擎记录"说了什么"，用假流式接口（`test/fixtures.mjs`）模拟 SSE 并检查实际发给模型的 `messages`，并用真实设备清单的 model 字符串校验词表推导。

## 抢答机制：300ms 轮询 + 先插话再流式回答

`@mi-gpt/next` 自带的循环把 `heartbeat` 钳到 `Math.max(1000, heartbeat)`，配置更小也没用。本项目没有用它：`src/engine.js` 调用基类的 `start`（只做 banner / 状态 / ChatBot 初始化），再用库里公开的子路径导出自己跑循环：

- 轮询间隔取 `speaker.heartbeat`，下限 300ms（当前配置 300ms，即每秒约 3 次）；
- 单次轮询或单条消息处理失败只打日志，不会让进程退出。

检测到「需要大模型回答」的句子时，先把请求发给模型，同时播一句 `bargeInText`（默认"嗯"）把音箱正在说的原生回答打断；模型的首句一流出来就按句接着播，不用等整段生成完。填充词不进回声黑名单，所以你自己说"嗯"不会被当成回声吞掉。设备指令不插话，原生回答正常播放。

## 说明：为什么只能"事后"拦截

小爱音箱是瘦客户端：语音在云端完成识别和意图判断，音箱先自己执行/回答，会话记录随后才写入。MiGPT 以自己账号轮询这份记录，所以拿到消息时原生回答往往已经开始。`speaker.play` 会打断当前播放，因此用「300ms 轮询 + 先播填充词」把原生回答截断，再把大模型的回答接上去。这是设备架构决定的，不是本项目的实现问题。
