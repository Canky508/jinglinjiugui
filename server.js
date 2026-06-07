require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const VOLC_API_KEY = process.env.VOLC_API_KEY;
const VOLC_HOST = 'ark.cn-beijing.volces.com';
const VISION_MODEL = process.env.VOLC_VISION_MODEL_ID || process.env.VOLC_MODEL_ID;
const TEXT_MODEL = process.env.VOLC_TEXT_MODEL_ID || process.env.VOLC_MODEL_ID;
const IMAGE_MODEL = process.env.VOLC_IMAGE_MODEL_ID || process.env.VOLC_MODEL_ID;
const IMAGE_SIZE = process.env.VOLC_IMAGE_SIZE || '768x768';

// 方舟平台上的 DeepSeek 深度思考接入点（与 VOLC_API_KEY 共用，ep- 开头）
const REASON_MODEL = process.env.VOLC_REASON_MODEL_ID || process.env.VOLC_DEEPSEEK_MODEL_ID;

function isImageGenAvailable() {
  return !!(VOLC_API_KEY && IMAGE_MODEL);
}

function isReasonModelAvailable() {
  return !!(VOLC_API_KEY && REASON_MODEL);
}

function isTextGenAvailable() {
  return isReasonModelAvailable() || !!(VOLC_API_KEY && TEXT_MODEL);
}

function ensureConfig() {
  const missing = [];
  if (!VOLC_API_KEY) missing.push('VOLC_API_KEY');
  if (!VISION_MODEL) missing.push('VOLC_VISION_MODEL_ID 或 VOLC_MODEL_ID（识酒视觉）');
  if (!isTextGenAvailable()) {
    missing.push('VOLC_REASON_MODEL_ID（方舟 DeepSeek 深度思考）或 VOLC_TEXT_MODEL_ID');
  }
  return missing;
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('响应中未找到 JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

async function callVolc(modelId, messages, maxTokens = 2048, opts = {}) {
  const { retries = 3, timeout = 120000 } = opts;
  if (!VOLC_API_KEY) throw new Error('未配置 VOLC_API_KEY');
  if (!modelId) throw new Error('未配置模型接入点 ID');
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${VOLC_API_KEY}`
  };
  const body = { model: modelId, messages, temperature: 0.35, max_tokens: maxTokens };
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await axios.post(`https://${VOLC_HOST}/api/v3/chat/completions`, body, {
        headers,
        timeout,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });
      const msg = response.data.choices?.[0]?.message;
      return msg?.content || msg?.reasoning_content ||
        response.data.choices?.[0]?.content?.[0]?.text || '';
    } catch (error) {
      lastError = error;
      const retryable = ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(error.code);
      if (retryable && attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function callReasonModel(messages, maxTokens = 2048, opts = {}) {
  if (!REASON_MODEL) throw new Error('未配置 VOLC_REASON_MODEL_ID（方舟 DeepSeek 接入点）');
  return callVolc(REASON_MODEL, messages, maxTokens, { ...opts, retries: opts.retries ?? 2 });
}

async function callTextModel(messages, maxTokens = 2048, opts = {}) {
  if (isReasonModelAvailable()) return callReasonModel(messages, maxTokens, opts);
  return callVolc(TEXT_MODEL, messages, maxTokens, opts);
}

async function generateImage(prompt) {
  if (!isImageGenAvailable()) throw new Error('未配置生图模型 VOLC_IMAGE_MODEL_ID');
  const response = await axios.post(`https://${VOLC_HOST}/api/v3/images/generations`, {
    model: IMAGE_MODEL,
    prompt: String(prompt).slice(0, 600),
    size: IMAGE_SIZE,
    response_format: 'url',
    watermark: false,
    sequential_image_generation: 'disabled'
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${VOLC_API_KEY}`
    },
    timeout: 120000
  });
  const url = response.data?.data?.[0]?.url;
  if (!url) throw new Error('生图 API 未返回图片 URL');
  return url;
}

function buildCocktailImagePrompt(wine, cocktail) {
  const materials = (cocktail.materials || []).map(m => m.name).filter(Boolean).join('、');
  return `专业美食摄影，鸡尾酒「${cocktail.planName || '特调'}」成品特写，${wine.wineName || ''}基酒特调，配料含${materials || '果汁与气泡水'}，${cocktail.style || '鸡尾酒'}风格，精致玻璃杯，浅色渐变背景产品抠图感，暖色柔光，高端酒吧 aesthetic，画面干净，无文字无水印无人物`;
}

function buildDishImagePrompt(wine, cocktail, dish) {
  return `专业美食摄影，中式下酒菜「${dish.name}」特写，精致摆盘，暖色食欲感灯光，浅色背景，与${wine.wineName || '美酒'}酒局搭配，画面干净，无文字无水印无人物`;
}

async function mapWithConcurrency(items, fn, limit = 2) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function formatApiError(error) {
  const msg = error.response?.data?.error?.message || error.message || '';
  if (/overdue balance/i.test(msg)) return '火山引擎账户欠费，请充值后重试';
  if (/does not support multimodal|image_url/i.test(msg)) return '当前模型不支持识图，请配置 VOLC_VISION_MODEL_ID 为多模态接入点';
  if (/authentication|api key|unauthorized/i.test(msg)) return 'API Key 无效，请检查 VOLC_API_KEY';
  if (/image model|images\/generations|seedream/i.test(msg)) return '生图模型未开通或接入点无效，请配置 VOLC_IMAGE_MODEL_ID（豆包 Seedream 文生图）';
  if (/deepseek|reason/i.test(msg)) return '方舟 DeepSeek 调用失败，请检查 VOLC_REASON_MODEL_ID 接入点是否有效';
  return msg || '请求失败';
}

function parseImageDataUrl(imageBase64) {
  const imageUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
  const raw = imageUrl.split(',')[1] || '';
  const bytes = Math.ceil(raw.length * 0.75);
  if (bytes > 6 * 1024 * 1024) {
    throw new Error('图片过大，请压缩后重试（建议小于 2MB）');
  }
  return imageUrl;
}

const FORBIDDEN_PERSONA_RE = /老金|金叔|听叔|叔给你|叔教你|叔认|叔能|叔一句|师傅|听叔的|给你调的/g;

function sanitizePersonaText(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/老金改良版/g, '改良版')
    .replace(FORBIDDEN_PERSONA_RE, '')
    .replace(/[，,]{2,}/g, '，')
    .replace(/^[，,、\s]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeWine(wine) {
  const w = { ...wine };
  if (w.bartenderTake) w.bartenderTake = sanitizePersonaText(w.bartenderTake);
  if (w.taste?.summary) w.taste.summary = sanitizePersonaText(w.taste.summary);
  if (w.aroma?.summary) w.aroma.summary = sanitizePersonaText(w.aroma.summary);
  return w;
}

function sanitizeDishAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  const a = { ...analysis };
  ['analysis', 'tastePairing', 'utility', 'swapSuggestion'].forEach(k => {
    if (a[k]) a[k] = sanitizePersonaText(a[k]);
  });
  if (a.improvedRecipe?.name) a.improvedRecipe.name = sanitizePersonaText(a.improvedRecipe.name);
  if (Array.isArray(a.improvedRecipe?.steps)) {
    a.improvedRecipe.steps = a.improvedRecipe.steps.map(s => sanitizePersonaText(s));
  }
  return a;
}

function sanitizePlan(plan) {
  const p = JSON.parse(JSON.stringify(plan || {}));
  const c = p.cocktail || {};
  ['planSubtitle', 'flavorNote'].forEach(k => { if (c[k]) c[k] = sanitizePersonaText(c[k]); });
  if (Array.isArray(c.steps)) c.steps = c.steps.map(s => sanitizePersonaText(s));
  p.cocktail = c;
  if (p.tiers && typeof p.tiers === 'object') {
    for (const tier of Object.values(p.tiers)) {
      for (const dish of tier?.dishes || []) {
        if (dish.reason) dish.reason = sanitizePersonaText(dish.reason);
      }
    }
  }
  if (p.dishAnalysis && typeof p.dishAnalysis === 'object') {
    for (const a of Object.values(p.dishAnalysis)) {
      if (!a || typeof a !== 'object') continue;
      ['analysis', 'tastePairing', 'utility', 'swapSuggestion'].forEach(k => {
        if (a[k]) a[k] = sanitizePersonaText(a[k]);
      });
      if (a.improvedRecipe?.name) a.improvedRecipe.name = sanitizePersonaText(a.improvedRecipe.name);
      if (Array.isArray(a.improvedRecipe?.steps)) {
        a.improvedRecipe.steps = a.improvedRecipe.steps.map(s => sanitizePersonaText(s));
      }
    }
  }
  return p;
}

function normalizeWine(wine) {
  const cleaned = sanitizeWine(wine);
  return {
    wineName: cleaned.wineName || '未识别酒款',
    wineType: cleaned.wineType || '',
    brand: cleaned.brand || '',
    origin: cleaned.origin || '',
    vintage: cleaned.vintage || '',
    abv: cleaned.abv || '',
    color: cleaned.color || '',
    taste: { summary: cleaned.taste?.summary || '口感信息生成中', ...cleaned.taste },
    aroma: { primary: cleaned.aroma?.primary || [], summary: cleaned.aroma?.summary || '', ...cleaned.aroma },
    referencePrice: {
      min: cleaned.referencePrice?.min ?? 0,
      max: cleaned.referencePrice?.max ?? 0,
      currency: cleaned.referencePrice?.currency || 'CNY',
      note: cleaned.referencePrice?.note || '国内市场参考区间，仅供参考'
    },
    servingTips: cleaned.servingTips || '',
    confidence: cleaned.confidence || 'medium',
    visibleEvidence: Array.isArray(cleaned.visibleEvidence) ? cleaned.visibleEvidence : [],
    bartenderTake: cleaned.bartenderTake || '这瓶有点意思——颜色、酒标都对得上号，先记下了。'
  };
}

function isPureDrinkPlan(cocktail) {
  const style = (cocktail.style || '').toLowerCase();
  const name = cocktail.planName || '';
  if (/纯饮|直饮|原酒|温饮|neat/i.test(style)) return true;
  if (/纯饮|直饮|窖香纯饮|经典局|就是这么喝|别兑|不要混/i.test(name)) return true;
  const mats = Array.isArray(cocktail.materials) ? cocktail.materials : [];
  if (mats.length < 3) return true;
  const mixerCount = mats.filter(m => /汁|汽水|苏打|汤力|糖浆|蜜|苦精|利口|茶|柠|橙|柚|姜|薄荷|气泡|可乐|干姜|蜂蜜|糖浆|冰块/i.test(m.name || '')).length;
  if (mixerCount < 2) return true;
  const steps = Array.isArray(cocktail.steps) ? cocktail.steps : [];
  if (steps.length < 4) return true;
  const flavor = cocktail.flavorNote || '';
  if (/建议纯饮|纯饮即可|不要调配|暴殄天物|别混|别兑/i.test(flavor)) return true;
  return false;
}

function normalizePlan(plan) {
  plan = sanitizePlan(plan);
  const cocktail = plan.cocktail || {};
  return {
    cocktail: {
      planName: cocktail.planName || '今晚微醺局',
      planSubtitle: cocktail.planSubtitle || '',
      style: cocktail.style || '鸡尾酒',
      difficulty: cocktail.difficulty || '入门',
      materials: Array.isArray(cocktail.materials) ? cocktail.materials : [],
      tools: Array.isArray(cocktail.tools) ? cocktail.tools : [],
      steps: Array.isArray(cocktail.steps) ? cocktail.steps : [],
      totalCost: cocktail.totalCost ?? 0,
      flavorNote: cocktail.flavorNote || ''
    },
    tiers: plan.tiers || {},
    dishAnalysis: plan.dishAnalysis || {}
  };
}

const BARTENDER_PERSONA = `你是金灵酒鬼的驻店调酒师：二十多岁的年轻女性，幽默风趣、有点调皮可爱，像吧台边懂酒又会聊天的闺蜜朋友。说话接地气、好懂，善用比喻和轻巧调侃，鉴别酒款时专业准确。事实字段准确，看不清不编造。个性文案1-3句，先结论后道理。可幽默但不低俗，不嘲讽用户，不鼓励酗酒。

【口吻硬性要求】
- 用第三人称或直接点评口吻，如「这杯」「这款」「果香很干净」「趁热喝更顺口」
- 严禁任何大叔/长辈人设：禁止「老金」「金叔」「叔」「师傅」「听叔的」「叔给你」「给你调的」等
- 严禁第一人称自我称呼（禁止「我」「咱」「姐姐我」等）
- 语气像年轻女调酒师，活泼但不油腻`;

const WINE_VISION_PROMPT = `你是酒标视觉识别助手。仅根据照片可见内容提取事实，看不清的字段留空字符串，不编造。模糊则 confidence=low。只输出 JSON，无 markdown：
{"wineName":"","wineType":"","brand":"","origin":"","vintage":"","abv":"","color":"","confidence":"high|medium|low","visibleEvidence":[]}`;

const WINE_ENRICH_PROMPT = `${BARTENDER_PERSONA}

根据下方识酒事实，撰写品鉴文案。非酒类或信息不足时如实说明，勿编造酒款。只输出 JSON，无 markdown：
{"taste":{"sweetness":"","acidity":"","tannin":"","body":"","finish":"","summary":""},"aroma":{"primary":[],"secondary":[],"summary":""},"referencePrice":{"min":0,"max":0,"currency":"CNY","note":"国内市场参考区间，仅供参考"},"servingTips":"","bartenderTake":""}`;

const WINE_PROMPT_LEGACY = `${BARTENDER_PERSONA}

分析酒瓶照片，仅据可见内容判断，看不清不编造；模糊则 confidence=low 并提醒补拍。bartenderTake 1-2句俏皮点评（无自我称呼）。只输出 JSON，无 markdown：
{"wineName":"","wineType":"","brand":"","origin":"","vintage":"","abv":"","color":"","taste":{"sweetness":"","acidity":"","tannin":"","body":"","finish":"","summary":""},"aroma":{"primary":[],"secondary":[],"summary":""},"referencePrice":{"min":0,"max":0,"currency":"CNY","note":"国内市场参考区间，仅供参考"},"servingTips":"","confidence":"high|medium|low","visibleEvidence":[],"bartenderTake":""}`;

const PLAN_PROMPT = `${BARTENDER_PERSONA}

根据识酒结果生成：①创意特调鸡尾酒方案 ②三档下酒菜 ③「麻辣小龙虾」点评。

【调酒硬性要求 — 必须遵守】
- 必须输出可在家执行的调配方案，禁止仅「纯饮/加冰直饮/温饮/分酒器斟酒」等无调配步骤的方案
- style 填「鸡尾酒」「特调」「Long Drink」「经典改编」等，禁止填「纯饮」
- materials 至少3项：识出的基酒 + 至少2种辅料（果汁/气泡水/苏打/汤力/糖浆/苦精/利口酒/茶/柑橘/姜饮等），写清用量与参考单价
- steps 至少4步，写清用量、顺序、搅拌/摇晃/加冰/装饰等具体操作
- 白酒/浓香/酱香也要给创意特调（例：浓香+柚子汁+苏打；酱香+青柠+干姜汽水+蜂蜜；或茶酒、Highball、酸酒改编），体现「认出这瓶酒才能配出这道特调」
- planName 2-6字有画面感，体现调配创意，勿用「纯饮法」「窖香纯饮」等
- flavorNote 说明辅料如何呼应这款酒的香气/口感，可口语化

配菜 reason 接地气幽默；dishAnalysis 风趣专业。全程年轻女调酒师口吻，禁止「老金」「金叔」「叔」「师傅」「听叔的」「给你调的」等长辈或大叔用语。
请严格只输出一个 JSON 对象，不要 markdown：
{"cocktail":{"planName":"","planSubtitle":"","style":"","difficulty":"","materials":[{"name":"","amount":"","unitPrice":0,"subtotal":0}],"tools":[],"steps":[],"totalCost":0,"flavorNote":""},"tiers":{"casual":{"label":"平民下酒菜","dishes":[{"name":"","reason":"","calories":"","cost":"","recipe":[]}]},"lifestyle":{"label":"精致小生活","dishes":[{"name":"","reason":"","calories":"","cost":"","recipe":[]}]},"premium":{"label":"高端酒局","dishes":[{"name":"","reason":"","calories":"","cost":"","recipe":[]}]}},"dishAnalysis":{"麻辣小龙虾":{"rating":"强烈推荐|可以|建议换一道","ratingClass":"good|ok|bad","analysis":"","tastePairing":"","utility":"","calories":"","improvedRecipe":{"name":"","steps":[]},"swapSuggestion":""}}}`;

const DISH_PROMPT = `${BARTENDER_PERSONA}

根据当前酒款与调酒方案，点评用户想吃的下酒菜。analysis 风趣接地气、勿自我称呼；ratingClass 与 rating 对应（强烈推荐=good，可以=ok，建议换一道=bad）。
请严格只输出一个 JSON 对象，不要 markdown：
{"rating":"强烈推荐|可以|建议换一道","ratingClass":"good|ok|bad","analysis":"","tastePairing":"","utility":"","calories":"","improvedRecipe":{"name":"","steps":[]},"swapSuggestion":""}`;

const API_BUILD = '2026-06-07-v2';

app.get('/api/health', (req, res) => {
  const missing = ensureConfig();
  res.json({
    ok: missing.length === 0,
    build: API_BUILD,
    service: 'jinling-jiugui-api',
    visionModel: VISION_MODEL || null,
    reasonModel: REASON_MODEL || null,
    textModel: isReasonModelAvailable() ? REASON_MODEL : (TEXT_MODEL || null),
    textProvider: isReasonModelAvailable() ? 'volc-deepseek' : 'volc',
    imageModel: IMAGE_MODEL || null,
    imageGenAvailable: isImageGenAvailable(),
    recognizePipeline: isReasonModelAvailable() ? 'vision-fast+volc-deepseek' : 'vision-single',
    missing
  });
});

app.post('/api/recognize-wine', async (req, res) => {
  try {
    const missing = ensureConfig();
    if (missing.length) return res.status(503).json({ error: `服务未配置：${missing.join('、')}` });

    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: '缺少 imageBase64' });
    const imageUrl = parseImageDataUrl(imageBase64);
    const kb = Math.round((imageUrl.split(',')[1]?.length || 0) * 0.75 / 1024);
    const t0 = Date.now();
    let wine;

    if (isReasonModelAvailable()) {
      console.log('[识酒] 阶段1 视觉快识:', VISION_MODEL, `| 图片约 ${kb}KB`);
      const visionContent = await callVolc(VISION_MODEL, [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: WINE_VISION_PROMPT }
        ]
      }], 450, { retries: 2, timeout: 55000 });
      const facts = extractJSON(visionContent);
      const t1 = Date.now();
      console.log('[识酒] 阶段1 完成', t1 - t0, 'ms |', facts.wineName || '未识别');

      console.log('[识酒] 阶段2 方舟 DeepSeek 文案:', REASON_MODEL);
      const enrichContent = await callReasonModel([{
        role: 'user',
        content: `${WINE_ENRICH_PROMPT}\n\n识酒事实：\n${JSON.stringify(facts, null, 2)}`
      }], 1100, { timeout: 90000 });
      const enriched = extractJSON(enrichContent);
      wine = normalizeWine({ ...facts, ...enriched });
      console.log('[识酒] 阶段2 完成', Date.now() - t1, 'ms | 总耗时', Date.now() - t0, 'ms');
    } else {
      console.log('[识酒] 单阶段视觉:', VISION_MODEL, `| 图片约 ${kb}KB`);
      const content = await callVolc(VISION_MODEL, [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: WINE_PROMPT_LEGACY }
        ]
      }], 1100, { retries: 2, timeout: 90000 });
      wine = normalizeWine(extractJSON(content));
      console.log('[识酒] 完成', Date.now() - t0, 'ms |', wine.wineName);
    }

    res.json({ wine, source: 'ai', pipeline: isReasonModelAvailable() ? 'vision+volc-deepseek' : 'vision' });
  } catch (error) {
    console.error('识酒失败:', error.response?.data || error.message);
    res.status(500).json({ error: formatApiError(error) || '识酒失败，请确认已配置支持视觉的模型接入点' });
  }
});

app.post('/api/generate-plan', async (req, res) => {
  try {
    const missing = ensureConfig();
    if (missing.length) return res.status(503).json({ error: `服务未配置：${missing.join('、')}` });

    const { wine } = req.body;
    if (!wine) return res.status(400).json({ error: '缺少 wine' });

    const textLabel = isReasonModelAvailable() ? `方舟 DeepSeek ${REASON_MODEL}` : TEXT_MODEL;
    console.log('[方案] 调用文本模型:', textLabel, '| 酒款:', wine.wineName);
    const wineCtx = `识酒结果：\n${JSON.stringify(wine, null, 2)}`;
    let content = await callTextModel([{
      role: 'user',
      content: `${PLAN_PROMPT}\n\n${wineCtx}`
    }], 3500, { timeout: 120000 });
    let plan = normalizePlan(extractJSON(content));
    if (isPureDrinkPlan(plan.cocktail)) {
      console.log('[方案] 检测到纯饮方案，重试要求特调...');
      content = await callTextModel([{
        role: 'user',
        content: `${PLAN_PROMPT}\n\n【重要】上次输出过于简单（仅纯饮或材料不足）。必须输出含至少3种材料、4步操作、2种以上辅料的创意特调鸡尾酒，结合下方酒款风味设计。\n\n${wineCtx}`
      }], 3500, { timeout: 120000 });
      plan = normalizePlan(extractJSON(content));
    }
    console.log('[方案] 完成:', plan.cocktail.planName);
    res.json({ ...plan, source: 'ai' });
  } catch (error) {
    console.error('生成方案失败:', error.response?.data || error.message);
    res.status(500).json({ error: formatApiError(error) || '生成方案失败' });
  }
});

app.post('/api/generate-image', async (req, res) => {
  try {
    if (!isImageGenAvailable()) {
      return res.status(503).json({ error: '未配置生图模型，请在环境变量设置 VOLC_IMAGE_MODEL_ID（火山方舟 Seedream 接入点）' });
    }
    const { type, wine, cocktail, dish, prompt } = req.body;
    let imagePrompt = prompt;
    if (!imagePrompt) {
      if (type === 'cocktail' && wine && cocktail) imagePrompt = buildCocktailImagePrompt(wine, cocktail);
      else if (type === 'dish' && wine && dish) imagePrompt = buildDishImagePrompt(wine, cocktail || {}, dish);
      else return res.status(400).json({ error: '缺少 type/prompt 或 wine+cocktail/dish' });
    }
    console.log('[生图]', type || 'custom', '|', (imagePrompt || '').slice(0, 40));
    const imageUrl = await generateImage(imagePrompt);
    res.json({ imageUrl, source: 'ai' });
  } catch (error) {
    console.error('生图失败:', error.response?.data || error.message);
    res.status(500).json({ error: formatApiError(error) || '生图失败' });
  }
});

app.post('/api/generate-plan-images', async (req, res) => {
  try {
    if (!isImageGenAvailable()) {
      return res.status(503).json({ error: '未配置生图模型 VOLC_IMAGE_MODEL_ID' });
    }
    const { wine, cocktail, tiers } = req.body;
    if (!wine || !cocktail) return res.status(400).json({ error: '缺少 wine 或 cocktail' });

    const dishList = [];
    if (tiers && typeof tiers === 'object') {
      for (const tier of Object.values(tiers)) {
        for (const dish of tier?.dishes || []) {
          if (dish?.name && !dishList.some(d => d.name === dish.name)) dishList.push(dish);
        }
      }
    }

    console.log('[生图] 批量 | 调酒 1 张 + 下酒菜', dishList.length, '张');
    let cocktailImageUrl = null;
    try {
      cocktailImageUrl = await generateImage(buildCocktailImagePrompt(wine, cocktail));
    } catch (e) {
      console.error('[生图] 调酒图失败:', e.message);
    }

    const dishResults = await mapWithConcurrency(dishList, async (dish) => {
      try {
        const imageUrl = await generateImage(buildDishImagePrompt(wine, cocktail, dish));
        return { name: dish.name, imageUrl };
      } catch (e) {
        console.error('[生图] 菜品失败:', dish.name, e.message);
        return { name: dish.name, imageUrl: null };
      }
    }, 2);

    const dishImages = {};
    for (const r of dishResults) {
      if (r?.name && r.imageUrl) dishImages[r.name] = r.imageUrl;
    }

    res.json({
      cocktailImageUrl,
      dishImages,
      imageModel: IMAGE_MODEL,
      source: 'ai'
    });
  } catch (error) {
    console.error('批量生图失败:', error.response?.data || error.message);
    res.status(500).json({ error: formatApiError(error) || '批量生图失败' });
  }
});

app.post('/api/analyze-dish', async (req, res) => {
  try {
    const missing = ensureConfig();
    if (missing.length) return res.status(503).json({ error: `服务未配置：${missing.join('、')}` });

    const { wine, cocktail, dishName } = req.body;
    if (!wine || !dishName) return res.status(400).json({ error: '缺少 wine 或 dishName' });

    console.log('[点评] 菜品:', dishName, '| 酒款:', wine.wineName);
    const content = await callTextModel([{
      role: 'user',
      content: `${DISH_PROMPT}\n\n酒款：${JSON.stringify(wine)}\n调酒方案：${JSON.stringify(cocktail || {})}\n用户想吃的菜：${dishName}`
    }], 1500, { timeout: 90000 });
    const analysis = sanitizeDishAnalysis(extractJSON(content));
    res.json({ dishName, analysis, source: 'ai' });
  } catch (error) {
    console.error('菜品点评失败:', error.response?.data || error.message);
    res.status(500).json({ error: formatApiError(error) || '菜品点评失败' });
  }
});

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, model } = req.body;
    
    const modelId = model || process.env.VOLC_MODEL_ID;
    
    console.log(`收到请求: 使用模型 ${modelId}`);
    
    const filteredMessages = messages.map(msg => {
      if (msg.content && Array.isArray(msg.content)) {
        const textContent = msg.content.filter(item => item.type === 'text').map(item => item.text).join(' ');
        return { role: msg.role, content: textContent };
      }
      return msg;
    }).filter(msg => msg.content && msg.content.trim());
    
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${VOLC_API_KEY}`
    };

    const body = {
      model: modelId,
      messages: filteredMessages,
      temperature: 0.7,
      max_tokens: 2048
    };

    const response = await axios.post(`https://${VOLC_HOST}/api/v3/chat/completions`, body, { headers });
    
    const content = response.data.choices?.[0]?.message?.content || 
                    response.data.choices?.[0]?.content?.[0]?.text ||
                    response.data.data?.content || '';

    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Date.now(),
      model: modelId,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: response.data.usage?.prompt_tokens || 0,
        completion_tokens: response.data.usage?.completion_tokens || 0,
        total_tokens: response.data.usage?.total_tokens || 0
      }
    };

    res.json(openaiResponse);
  } catch (error) {
    console.error('代理请求失败:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: {
        message: error.response?.data?.error?.message || error.response?.data?.message || '代理服务错误',
        type: 'proxy_error'
      }
    });
  }
});

app.get('/v1/models', async (req, res) => {
  res.json({
    object: 'list',
    data: [
      { id: 'ep-20260605192926-96cvs', object: 'model', created: Date.now(), owned_by: 'volcengine' },
      { id: 'ep-20260605192906-5fjbw', object: 'model', created: Date.now(), owned_by: 'volcengine' },
      { id: 'ep-20260605193030-gqp2d', object: 'model', created: Date.now(), owned_by: 'volcengine' },
      { id: 'ep-20260605193050-g5mpn', object: 'model', created: Date.now(), owned_by: 'volcengine' },
      { id: 'ep-20260605193221-jzl66', object: 'model', created: Date.now(), owned_by: 'volcengine' },
      { id: 'ep-20260605193248-zvzp', object: 'model', created: Date.now(), owned_by: 'volcengine' },
      { id: 'ep-20260605193311-hrmrj', object: 'model', created: Date.now(), owned_by: 'volcengine' },
      { id: 'ep-20260605194110-l44nh', object: 'model', created: Date.now(), owned_by: 'volcengine' },
      { id: 'ep-20260605194130-xqjcd', object: 'model', created: Date.now(), owned_by: 'volcengine' },
      { id: 'ep-20260605194929-dl8tb', object: 'model', created: Date.now(), owned_by: 'volcengine' }
    ]
  });
});

app.listen(PORT, () => {
  const missing = ensureConfig();
  console.log('\n' + '='.repeat(60));
  console.log('🍷 金灵酒鬼 API 服务已启动');
  console.log(`📍 地址: http://localhost:${PORT}`);
  console.log(`🔍 健康检查: http://localhost:${PORT}/api/health`);
  console.log(`👁  识酒模型: ${VISION_MODEL || '未配置'}`);
  console.log(`📝 方案模型: ${TEXT_MODEL || '未配置'}`);
  console.log(`🎨 生图模型: ${IMAGE_MODEL || '未配置'}`);
  if (missing.length) console.log(`⚠️  缺少配置: ${missing.join('、')}`);
  console.log('='.repeat(60));
  console.log('Demo 访问: http://localhost:端口/demo/?api=http://localhost:' + PORT);
  console.log('='.repeat(60) + '\n');
});
