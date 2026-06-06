require('dotenv').config();
const axios = require('axios');

class VolcEngineClient {
  constructor() {
    this.apiKey = process.env.VOLC_API_KEY;
    this.host = 'ark.cn-beijing.volces.com';
  }

  async request(method, path, body = null) {
    if (!this.apiKey) {
      throw new Error('请先配置VOLC_API_KEY');
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };

    const url = `https://${this.host}${path}`;

    try {
      const response = await axios({
        method,
        url,
        headers,
        data: body
      });
      return response.data;
    } catch (error) {
      console.error('API请求失败:', error.response?.data || error.message);
      throw error;
    }
  }

  async chatCompletion(modelId, messages) {
    const path = `/api/v3/chat/completions`;
    
    const body = {
      model: modelId,
      messages: messages,
      temperature: 0.7,
      max_tokens: 2048
    };

    return await this.request('POST', path, body);
  }
}

module.exports = VolcEngineClient;