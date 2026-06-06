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

function ensureConfig() {
  const missing = [];
  if (!VOLC_API_KEY) missing.push('VOLC_API_KEY');
  if (!VISION_MODEL) missing.push('VOLC_VISION_MODEL_ID 或 VOLC_MODEL_ID（识酒视觉）');
  if (!TEXT_MODEL) missing.push('VOLC_TEXT_MODEL_ID 或 VOLC_MODEL_ID（文本方案）');
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

async function callVolc(modelId, messages, maxTokens = 2048) {
  if (!VOLC_API_KEY) throw new Error('未配置 VOLC_API_KEY');
  if (!modelId) throw new Error('未配置模型接入点 ID');
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${VOLC_API_KEY}`
  };
  const body = { model: modelId, messages, temperature: 0.4, max_tokens: maxTokens };
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios.post(`https://${VOLC_HOST}/api/v3/chat/completions`, body, {
        headers,
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });
      return response.data.choices?.[0]?.message?.content ||
        response.data.choices?.[0]?.content?.[0]?.text || '';
    } catch (error) {
      lastError = error;
      const retryable = ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(error.code);
      if (retryable && attempt < 2) {
        await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function formatApiError(error) {
  const msg = error.response?.data?.error?.message || error.message || '';
  if (/overdue balance/i.test(msg)) return '火山引擎账户欠费，请充值后重试';
  if (/does not support multimodal|image_url/i.test(msg)) return '当前模型不支持识图，请配置 VOLC_VISION_MODEL_ID 为多模态接入点';
  if (/authentication|api key|unauthorized/i.test(msg)) return 'API Key 无效，请检查 VOLC_API_KEY';
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

function normalizeWine(wine) {
  return {
    wineName: wine.wineName || '未识别酒款',
    wineType: wine.wineType || '',
    brand: wine.brand || '',
    origin: wine.origin || '',
    vintage: wine.vintage || '',
    abv: wine.abv || '',
    color: wine.color || '',
    taste: { summary: wine.taste?.summary || '口感信息生成中', ...wine.taste },
    aroma: { primary: wine.aroma?.primary || [], summary: wine.aroma?.summary || '', ...wine.aroma },
    referencePrice: {
      min: wine.referencePrice?.min ?? 0,
      max: wine.referencePrice?.max ?? 0,
      currency: wine.referencePrice?.currency || 'CNY',
      note: wine.referencePrice?.note || '国内市场参考区间，仅供参考'
    },
    servingTips: wine.servingTips || '',
    confidence: wine.confidence || 'medium',
    visibleEvidence: Array.isArray(wine.visibleEvidence) ? wine.visibleEvidence : [],
    bartenderTake: wine.bartenderTake || '这瓶有点意思，叔先帮你瞅瞅。'
  };
}

function normalizePlan(plan) {
  const cocktail = plan.cocktail || {};
  return {
    cocktail: {
      planName: cocktail.planName || '老金推荐局',
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

const LAOJIN_PERSONA = `你是「金灵酒鬼」首席酒局顾问老金：45岁吧台老师傅，入行20年，有趣调皮但专业靠谱。说话像跟熟客唠嗑，善用比喻，偶尔「听叔一句」。事实字段准确，看不清不编；个性文案1-3句，先结论后道理。可幽默但不低俗，不嘲讽用户，不鼓励酗酒。`;

const WINE_PROMPT = `${LAOJIN_PERSONA}

请分析用户上传的酒瓶照片。只根据可见内容判断，看不清不要编造；酒标模糊则 confidence 标 low，并在 bartenderTake 里轻松提醒补拍。
taste.summary/aroma.summary 客观好懂；bartenderTake 为老金个人点评；visibleEvidence 为专业依据。
请严格只输出一个 JSON 对象，不要 markdown：
{"wineName":"","wineType":"","brand":"","origin":"","vintage":"","abv":"","color":"","taste":{"sweetness":"","acidity":"","tannin":"","body":"","finish":"","summary":""},"aroma":{"primary":[],"secondary":[],"summary":""},"referencePrice":{"min":0,"max":0,"currency":"CNY","note":"国内市场参考区间，仅供参考"},"servingTips":"","confidence":"high|medium|low","visibleEvidence":[],"bartenderTake":""}`;

const PLAN_PROMPT = `${LAOJIN_PERSONA}

根据识酒结果生成：①调酒/饮用方案 ②三档下酒菜 ③「麻辣小龙虾」点评。
planName 2-6字有个性；planSubtitle 可选老金副标题；steps 可口语化但可执行；flavorNote 含搭配逻辑+老金总结；配菜 reason 用老金口吻；dishAnalysis.analysis 用老金口吻，rating 须符合搭配逻辑。
请严格只输出一个 JSON 对象，不要 markdown：
{"cocktail":{"planName":"","planSubtitle":"","style":"","difficulty":"","materials":[{"name":"","amount":"","unitPrice":0,"subtotal":0}],"tools":[],"steps":[],"totalCost":0,"flavorNote":""},"tiers":{"casual":{"label":"平民下酒菜","dishes":[{"name":"","reason":"","calories":"","cost":"","recipe":[]}]},"lifestyle":{"label":"精致小生活","dishes":[{"name":"","reason":"","calories":"","cost":"","recipe":[]}]},"premium":{"label":"高端酒局","dishes":[{"name":"","reason":"","calories":"","cost":"","recipe":[]}]}},"dishAnalysis":{"麻辣小龙虾":{"rating":"强烈推荐|可以|建议换一道","ratingClass":"good|ok|bad","analysis":"","tastePairing":"","utility":"","calories":"","improvedRecipe":{"name":"","steps":[]},"swapSuggestion":""}}}`;

const DISH_PROMPT = `${LAOJIN_PERSONA}

根据当前酒款与调酒方案，点评用户想吃的下酒菜。analysis 用老金口吻；ratingClass 与 rating 对应（强烈推荐=good，可以=ok，建议换一道=bad）。
请严格只输出一个 JSON 对象，不要 markdown：
{"rating":"强烈推荐|可以|建议换一道","ratingClass":"good|ok|bad","analysis":"","tastePairing":"","utility":"","calories":"","improvedRecipe":{"name":"","steps":[]},"swapSuggestion":""}`;

app.get('/api/health', (req, res) => {
  const missing = ensureConfig();
  res.json({
    ok: missing.length === 0,
    service: 'jinling-jiugui-api',
    visionModel: VISION_MODEL || null,
    textModel: TEXT_MODEL || null,
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
    console.log('[识酒] 调用视觉模型:', VISION_MODEL, `| 图片约 ${kb}KB`);
    const content = await callVolc(VISION_MODEL, [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: WINE_PROMPT }
      ]
    }], 1800);
    const wine = normalizeWine(extractJSON(content));
    console.log('[识酒] 完成:', wine.wineName);
    res.json({ wine, source: 'ai' });
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

    console.log('[方案] 调用文本模型:', TEXT_MODEL, '| 酒款:', wine.wineName);
    const content = await callVolc(TEXT_MODEL, [{
      role: 'user',
      content: `${PLAN_PROMPT}\n\n识酒结果：\n${JSON.stringify(wine, null, 2)}`
    }], 3000);
    const plan = normalizePlan(extractJSON(content));
    console.log('[方案] 完成:', plan.cocktail.planName);
    res.json({ ...plan, source: 'ai' });
  } catch (error) {
    console.error('生成方案失败:', error.response?.data || error.message);
    res.status(500).json({ error: formatApiError(error) || '生成方案失败' });
  }
});

app.post('/api/analyze-dish', async (req, res) => {
  try {
    const missing = ensureConfig();
    if (missing.length) return res.status(503).json({ error: `服务未配置：${missing.join('、')}` });

    const { wine, cocktail, dishName } = req.body;
    if (!wine || !dishName) return res.status(400).json({ error: '缺少 wine 或 dishName' });

    console.log('[点评] 菜品:', dishName, '| 酒款:', wine.wineName);
    const content = await callVolc(TEXT_MODEL, [{
      role: 'user',
      content: `${DISH_PROMPT}\n\n酒款：${JSON.stringify(wine)}\n调酒方案：${JSON.stringify(cocktail || {})}\n用户想吃的菜：${dishName}`
    }], 1500);
    const analysis = extractJSON(content);
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
  if (missing.length) console.log(`⚠️  缺少配置: ${missing.join('、')}`);
  console.log('='.repeat(60));
  console.log('Demo 访问: http://localhost:端口/demo/?api=http://localhost:' + PORT);
  console.log('='.repeat(60) + '\n');
});
