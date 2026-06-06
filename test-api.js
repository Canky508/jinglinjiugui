const VolcEngineClient = require('./volcengine-client');

async function main() {
  const client = new VolcEngineClient();
  
  console.log('=== 测试火山引擎API ===\n');

  try {
    console.log('测试聊天完成接口...');
    const messages = [
      { role: 'system', content: '你是一个乐于助人的助手' },
      { role: 'user', content: '你好，请用一句话介绍你自己' }
    ];
    
    // 使用模型接入点ID，需要在火山引擎方舟控制台创建接入点
    const response = await client.chatCompletion('ep-xxxxxxxxxxxxx', messages);
    console.log('响应结果:', JSON.stringify(response, null, 2));
  } catch (error) {
    console.log('聊天接口测试失败:', error.message);
  }
}

main().catch(console.error);