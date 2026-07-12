import { buildInventoryMarkdown } from './erp/reports.js';
import { sendDingTalkMarkdown } from './dingtalk.js';

async function main() {
  console.log('📤 使用新机器人发送 Table 格式测试...');
  const md = buildInventoryMarkdown('table');
  console.log(md.text);
  console.log('');

  const result = await sendDingTalkMarkdown({
    title: md.title,
    text: md.text,
  });
  console.log('✅ 发送结果:', result);
}

main().catch((err) => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
