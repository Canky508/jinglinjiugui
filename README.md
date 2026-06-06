# 金灵酒鬼

拍一瓶酒，老金帮你识酒、调酒、配菜、组酒局。

UI 参考 `ui设计图/首页设计图.html`：黑白红轻奢极简，暗色首页 + 亮色详情页。

## 今日 Demo

### 真实 AI 识酒（推荐）

**1. 配置火山引擎**

```bash
cd volcengine-api
cp .env.example .env
# 编辑 .env，填入 VOLC_API_KEY 和多模态接入点 VOLC_VISION_MODEL_ID
```

**2. 启动 AI 后端**

```bash
cd volcengine-api
npm start
```

看到 `金灵酒鬼 API 服务已启动` 后，访问 `http://localhost:3001/api/health` 应返回 `"ok": true`。

> 若 3000 端口已被占用（如静态服务），在 `.env` 设置 `PORT=3001`。Demo 会自动探测 3001/3000/3002。

**3. 启动 Demo 前端**

```bash
cd 金灵酒鬼/demo
npx serve .
```

或从根目录：`cd 金灵酒鬼 && npx serve .` → 打开 `http://localhost:端口/demo/`

**4. 使用**

- 首页显示 **「AI 识酒服务已连接」** 时，拍照或选示例酒款点「开始识酒」均走真实模型
- 识酒 → 自动生成调酒方案 + 三档下酒菜 + 老金点评
- AI 未连接时自动降级 Mock，不影响演示

**手机同 WiFi 访问：**

1. 电脑、手机连**同一 WiFi**
2. 查电脑局域网 IP（Windows 命令行执行 `ipconfig`，看「IPv4 地址」，一般是 `192.168.x.x`）
3. 电脑先启动 API + Demo（两个终端都要开着）
4. 手机浏览器打开（把 `192.168.x.x` 换成你的 IP，`5173` 换成 serve 实际端口）：

```
http://192.168.x.x:5173/
```

若从 `金灵酒鬼` 根目录启动 serve，则用：

```
http://192.168.x.x:5173/demo/
```

5. 首页出现 **「AI 识酒服务已连接」** 即可拍照识酒；若显示未连接，手动加 API 参数：

```
http://192.168.x.x:5173/?api=http://192.168.x.x:3001
```

> 手机打不开时：检查 Windows 防火墙是否放行 Node/serve 端口；`npx serve` 默认已监听局域网。

### 参考图片

高清图放在 `demo/assets/`（已同步）或 `ui设计图/images/`，命名见 `图片说明.md`。

> `VOLC_VISION_MODEL_ID` 必须是支持识图的多模态接入点；文本方案可用 `VOLC_TEXT_MODEL_ID` 单独配置。

### 仅 Mock 体验

浏览器打开 `demo/index.html`，选择示例酒款即可，无需后端。

### Demo 演示路径

1. 拍照识酒 / 选示例酒款
2. 识酒结果：口感、气味、年份、产地、参考价格
3. 调酒方案：材料、价格、步骤
4. 下酒菜：三档推荐 + 自定义菜品 AI 点评
5. 酒局分享卡 + 协作编辑占位
6. 附近酒馆 Mock 列表

## 公网部署（任何人可打开）

不用同一 WiFi，部署后分享链接即可。详见 **`DEPLOY.md`**，简要步骤：

1. **API** 部署到 [Render](https://render.com)（目录 `volcengine-api`，配置火山引擎环境变量）
2. 把 API 地址写入 `demo/config.js`
3. **前端** 部署到 [Vercel](https://vercel.com) / Netlify（目录 `金灵酒鬼/demo`）
4. 分享前端链接，例如 `https://xxx.vercel.app`

最快试手：Netlify Drop 直接拖拽 `demo` 文件夹（需先改好 `config.js`）。

## 文档

- `DEPLOY.md` — 公网部署完整步骤
- `MVP需求书.md` — 产品完整定义
- `AI提示词与Mock数据.md` — Prompt 与 Mock JSON

## 免责

参考价格仅供参考，不构成购买建议。适量饮酒，未成年人禁止饮酒。
