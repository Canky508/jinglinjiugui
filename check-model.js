require('dotenv').config();
const axios = require('axios');

const id = process.env.VOLC_VISION_MODEL_ID || process.env.VOLC_MODEL_ID;
const headers = { Authorization: `Bearer ${process.env.VOLC_API_KEY}` };
const host = 'https://ark.cn-beijing.volces.com';

async function main() {
  console.log('接入点 ID:', id);
  for (const path of [`/api/v3/endpoints/${id}`, '/api/v3/models']) {
    try {
      const res = await axios.get(host + path, { headers, timeout: 15000 });
      console.log('\n===', path, '===');
      console.log(JSON.stringify(res.data, null, 2).slice(0, 2000));
    } catch (e) {
      console.log('\n===', path, '===');
      console.log('error:', e.response?.status, e.response?.data?.error?.message || e.message);
    }
  }
}

main();
