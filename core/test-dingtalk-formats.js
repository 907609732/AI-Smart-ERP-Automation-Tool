import { buildInventoryMarkdown } from './erp/reports.js';
import { sendDingTalkMarkdown } from './dingtalk.js';

const formats = ['list', 'table', 'grouped'];

async function main() {
  for (const fmt of formats) {
    const md = buildInventoryMarkdown(fmt);
    console.log(`\n========== 格式: ${fmt} ==========`);
    console.log(md.text);
    console.log('');

    // 实际发送到钉钉，方便在手机上对比效果
    console.log(`📤 正在发送 ${fmt} 格式到钉钉...`);
    try {
      const result = await sendDingTalkMarkdown({
        title: `${md.title} [${fmt}]`,
        text: md.text,
      });
      console.log('✅ 发送成功:', result.errmsg);
    } catch (e) {
      console.log('❌ 发送失败:', e.message);
    }

    // 每条消息间隔 2 秒，避免被钉钉限流
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('\n🎉 三种格式已发送完毕，请在钉钉群里查看效果并挑选喜欢的样式。');
}

main().catch((err) => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
