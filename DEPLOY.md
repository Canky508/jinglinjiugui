# 金灵酒鬼 · 手把手部署教程

> 目标：部署后任何人用手机打开链接就能用，不需要连你家 WiFi。  
> 预计耗时：**30–45 分钟**（首次）

---

## 部署架构（先理解）

```
用户手机/电脑
    ↓ 打开
前端（Vercel / Netlify）  ←  金灵酒鬼/demo/index.html
    ↓ 调用 API
后端（Render）            ←  volcengine-api/server.js
    ↓ 调用
火山引擎豆包模型          ←  识酒 + 生成方案
```

你需要准备：
- 一个 **GitHub** 账号（推荐）
- 一个 **Render** 账号（部署 API，免费）
- 一个 **Vercel** 或 **Netlify** 账号（部署前端，免费）
- 火山引擎 **API Key** 和 **接入点 ID**（已充值）

---

## 第 0 步：准备代码上传 GitHub

### 0.1 确认不要泄露密钥

`volcengine-api/.env` 里有 API Key，**绝不能提交到 GitHub**。  
项目已配置 `.gitignore` 忽略 `.env`。

### 0.2 创建 GitHub 仓库

1. 打开 [github.com/new](https://github.com/new)
2. 仓库名例如：`jinling-jiugui`
3. 选 **Private**（推荐，避免暴露项目结构）
4. 不要勾选 README，创建空仓库

### 0.3 上传这两个文件夹

只需上传部署用到的部分：

```
你的仓库/
├── volcengine-api/     ← 整个文件夹（不含 node_modules）
└── 金灵酒鬼/
    └── demo/           ← 整个 demo 文件夹（含 assets 图片）
```

**方式 A · GitHub 网页上传（最简单）**

1. 进入仓库 → **Add file → Upload files**
2. 把 `volcengine-api` 文件夹拖进去（可先删掉里面的 `node_modules` 再拖，体积小很多）
3. 再把 `金灵酒鬼/demo` 按同样路径拖进去
4. Commit

**方式 B · 命令行（熟悉 Git 再用）**

```bash
cd "你的本地项目路径"
git init
git add volcengine-api 金灵酒鬼/demo
git commit -m "init jinling jiugui deploy"
git branch -M main
git remote add origin https://github.com/你的用户名/jinling-jiugui.git
git push -u origin main
```

✅ **检查点**：GitHub 上能看到 `volcengine-api/server.js` 和 `金灵酒鬼/demo/index.html`

---

## 第 1 步：部署 API 到 Render

1. 打开 [render.com](https://render.com)，用 GitHub 登录
2. 点击 **New +** → **Web Service**
3. 连接你刚创建的 GitHub 仓库
4. 填写配置：

| 配置项 | 填什么 |
|--------|--------|
| **Name** | `jinling-api`（随意） |
| **Region** | Singapore 或离你近的 |
| **Branch** | `main` |
| **Root Directory** | `volcengine-api` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | **Free** |

5. 展开 **Environment Variables**，添加：

| Key | Value（你的真实值） |
|-----|---------------------|
| `VOLC_API_KEY` | 方舟 API Key |
| `VOLC_VISION_MODEL_ID` | 视觉接入点，如 `ep-xxx`（识酒用） |
| `VOLC_TEXT_MODEL_ID` | 文本接入点，如 `ep-xxx`（方案用，可与视觉相同） |

> 若只有一个接入点，可只填 `VOLC_MODEL_ID=ep-xxx`，识酒和方案共用。

6. 点击 **Create Web Service**，等待 Deploy 完成（约 2–5 分钟）
7. 顶部出现地址，例如：`https://jinling-api.onrender.com`

✅ **检查点**：浏览器打开

```
https://jinling-api.onrender.com/api/health
```

应看到：

```json
{"ok":true,"service":"jinling-jiugui-api",...}
```

❌ 若 `ok: false`，检查环境变量是否填对。  
❌ 若 502，等 1 分钟 Render 还在启动。

---

## 第 2 步：配置前端连接 API

编辑本地 `金灵酒鬼/demo/config.js`：

```javascript
window.JINLING_API = 'https://jinling-api.onrender.com';
```

把地址换成你 **第 1 步** 得到的 Render 地址，**不要**末尾斜杠 `/`。

保存后，若用 GitHub 部署前端，需要把改过的 `config.js` 再上传/推送一次。

---

## 第 3 步：部署前端

### 方案 A · Vercel（推荐，连 GitHub 自动更新）

1. 打开 [vercel.com](https://vercel.com)，GitHub 登录
2. **Add New → Project**，选你的仓库
3. **Configure Project**：

| 配置项 | 填什么 |
|--------|--------|
| **Root Directory** | 点 Edit，填 `金灵酒鬼/demo` |
| **Framework Preset** | Other |
| **Build Command** | 留空 |
| **Output Directory** | `.` 或留空 |

4. 点击 **Deploy**
5. 完成后得到链接，例如：`https://jinling-jiugui.vercel.app`

### 方案 B · Netlify Drop（不用 Git，最快试手）

1. 确保 `demo/config.js` 已填好 API 地址
2. 打开 [app.netlify.com/drop](https://app.netlify.com/drop)
3. 把整个 `金灵酒鬼/demo` 文件夹拖进网页
4. 几秒后得到 `https://随机名.netlify.app`

✅ **检查点**：用手机或电脑打开前端链接，首页应显示：

> **✓ AI 识酒服务已连接**

若显示「AI 未连接」：
- 确认 `config.js` 地址正确
- 确认 Render API `/api/health` 返回 ok
- 或临时用：`https://你的前端/?api=https://你的API.onrender.com`

---

## 第 4 步：完整走一遍

1. 打开公网链接
2. 选「麦卡伦12年」或 **拍照识酒**
3. 点 **开始识酒**（首次可能等 30–60 秒，Render 免费版冷启动）
4. 看识酒结果 → 调酒方案 → 下酒菜 → 酒局分享

✅ 全流程走通 = 部署成功。

---

## 第 5 步：分享给别人

直接把前端链接发到微信、抖音、答辩 PPT 二维码：

```
https://jinling-jiugui.vercel.app
```

对方无需安装、无需同一 WiFi，手机浏览器即可用。

---

## 常见问题

| 现象 | 原因 | 处理 |
|------|------|------|
| AI 未连接 | config.js 没填或填错 | 改 config.js 重新部署 |
| 识酒很慢/超时 | Render 冷启动 | 等 1 分钟重试 |
| 识酒报错欠费 | 火山账户余额 | 控制台充值 |
| 图片不显示 | assets 没上传 | 确认 demo/assets 在仓库里 |
| 模型不支持识图 | 接入点不是视觉模型 | 换 VOLC_VISION_MODEL_ID |

---

## 费用

| 服务 | 费用 |
|------|------|
| Vercel / Netlify 静态页 | 个人免费额度通常够用 |
| Render API 免费档 | 免费，有休眠 |
| 火山引擎豆包 | 按调用计费，需充值 |

---

## 更新部署

- **改了 API 代码**：推 GitHub → Render 自动重新部署
- **改了前端**：推 GitHub → Vercel 自动重新部署；Netlify Drop 需重新拖拽
- **换了 API 地址**：改 `config.js` 再部署前端
