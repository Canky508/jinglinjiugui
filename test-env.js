require('dotenv').config({ path: './.env' });

console.log('=== 环境变量检查 ===');
console.log('VOLC_ACCESS_KEY:', process.env.VOLC_ACCESS_KEY ? '已配置 (' + process.env.VOLC_ACCESS_KEY.length + '字符)' : '未配置');
console.log('VOLC_SECRET_KEY:', process.env.VOLC_SECRET_KEY ? '已配置 (' + process.env.VOLC_SECRET_KEY.length + '字符)' : '未配置');
console.log('当前目录:', process.cwd());