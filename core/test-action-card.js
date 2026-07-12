import { buildInventoryActionCard } from './erp/reports.js';
import { sendDingTalkActionCard } from './dingtalk.js';

async function main() {
  console.log('📤 发送 ActionCard + 文本图表...');
  const card = buildInventoryActionCard();
  console.log('标题:', card.title);
  console.log('正文:\n', card.text);
  console.log('按钮:', card.singleTitle, '→', card.singleUrl);

  const result = await sendDingTalkActionCard({
    title: card.title,
    text: card.text,
    singleTitle: card.singleTitle,
    singleUrl: card.singleUrl,
  });
  console.log('✅ 发送结果:', result);
}

main().catch((err) => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
