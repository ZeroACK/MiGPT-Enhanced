# MiGPT-Next 语音助手

把小爱音箱接到任意 OpenAI 兼容大模型（默认 DeepSeek）上：除智能家居控制、音箱自身媒体指令之外的**所有问答都交给大模型**，不再需要「你说」「问一下 DEEPSEEK」这类唤醒词。

## 目录结构

```
.
├── main.js                 # 入口：读配置 → 装配 hook → 启动引擎 + 设备词表刷新
├── config.json             # 全部可配置项（账号、音箱、模型、提示词、设备别名）— 已被 git 忽略
├── config.example.json     # 配置模板，复制为 config.json 后填写
├── .gitignore              # 忽略依赖、config.json、.mi.json、日志
├── migpt-next.service      # systemd 单元文件（日志交给 journald）
├── package.json
├── src/
│   ├── config.js           # 读取/校验 config.json，解析配置文件路径
│   ├── hook.js             # onMessage：回声过滤 → 固定短语 → 分流 → 回答
│   ├── router.js           # 分流核心：设备词表、媒体指令、疑问守卫、classifyRoute
│   ├── inventory.js        # 从米家拉设备清单 → 生成设备词表，每 10 分钟刷新
│   ├── speech.js           # TTS 播放、失败回退、回声保护
│   ├── replies.js          # 固定应答短语
│   └── types.js            # 共享 JSDoc 类型（Engine / Message / AppConfig）
└── test/
    ├── fixtures.mjs        # 与真实米家设备一致（含 MIoT model）的测试数据
    ├── router.test.mjs     # 词表推导 + 17 条分流用例
    └── hook.test.mjs       # 钩子行为、回声拦截、TTS 回退
```

## 分流规则

每次说话都会先由 `src/router.js` 判断由谁处理：

| 判断顺序 | 条件 | 处理方 |
|---|---|---|
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
    "heartbeat": 1000           // 轮询间隔 ms，最小按 1000 处理
  },
  "openai": {
    "baseURL": "https://api.deepseek.com",
    "apiKey": "sk-...",
    "model": "deepseek-v4-flash"
  },
  "prompt": { "system": "你名字叫…" },
  "context": { "historyMaxLength": 10 },
  "extraDeviceWords": ["冷气", "音响"]
}
```

- `passToken` 获取：<https://github.com/idootop/migpt-next/issues/4>
- `baseURL` 写裸域名或 `/v1` 结尾，**不要**带 `/chat/completions`。
- 登录成功后会在工作目录生成 `.mi.json` 缓存，权限同样建议 600。

## 运行

```bash
cd ~/migpt-next
npm install          # 首次
node main.js         # 前台运行，Ctrl+C 退出
```

启动正常时输出：

```
[migpt] config: ~/migpt-next/config.json
✅ 服务已启动...
[migpt] routing vocabulary: 31 words (客厅摄像头、摄像头、监控、…)
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

测试不联网、不碰音箱：用桩引擎记录"说了什么"，并用真实设备清单的 model 字符串校验词表推导。

## 说明：为什么只能"事后"拦截

小爱音箱会先自己回答，再产生会话记录；`@mi-gpt/next` 只能轮询历史（`heartbeat` 最小 1000ms），因此 MiGPT 的回复总是略晚一步，靠 TTS 播放打断原生回答。这是库和设备的限制，不是本项目的实现问题。
