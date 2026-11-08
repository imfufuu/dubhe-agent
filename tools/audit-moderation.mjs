#!/usr/bin/env node
// 多语言文本审核「重复验证」审计报告生成器。
//   node tools/audit-moderation.mjs        # 跑 3 轮端到端验证并写 MODERATION_AUDIT.md
// 语料与回归测试共用 tests/helpers/moderation-samples.mjs；改词库后重跑本脚本即可复核。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { policyTextHeuristic } from '../js/local-text-policy.js';
import { CATEGORY_SAMPLES, CATEGORY_LABELS, SAFE_SAMPLES, variants } from '../tests/helpers/moderation-samples.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUNDS = 3;
const rows = [];
let totalChecks = 0, totalMiss = 0;
const t0 = Date.now();

for (const [category, samples] of Object.entries(CATEGORY_SAMPLES)) {
  const byLang = new Map();
  let checks = 0, miss = 0;
  const examples = [];
  for (let round = 1; round <= ROUNDS; round++) {
    for (const [lang, sentence] of samples) {
      for (const [vi, text] of variants(sentence).entries()) {
        const result = policyTextHeuristic(text);
        checks++;
        byLang.set(lang, (byLang.get(lang) || 0) + 1);
        if (!result.blocked) {
          miss++;
          if (examples.length < 3) examples.push(`${lang}/v${vi}: ${JSON.stringify(text.slice(0, 60))}`);
        }
      }
    }
  }
  totalChecks += checks; totalMiss += miss;
  rows.push({ category, label: CATEGORY_LABELS[category], languages: byLang.size, checks, miss, rate: ((checks - miss) / checks * 100).toFixed(1), examples });
}

const falsePositives = [];
for (const [lang, text] of SAFE_SAMPLES) if (policyTextHeuristic(text).blocked) falsePositives.push(`${lang}: ${text}`);

const verdict = totalMiss === 0 && falsePositives.length === 0 ? '**通过**' : '**未通过**';
const langs = [...new Set([...Object.values(CATEGORY_SAMPLES).flat(), ...SAFE_SAMPLES].map(([l]) => l))].sort();
const md = `# 多语言文本审核加固 · 重复验证报告

生成时间：${new Date().toISOString()} · 命令：\`node tools/audit-moderation.mjs\`

## 结论

${verdict}：${Object.keys(CATEGORY_SAMPLES).length} 个敏感话题类别、${langs.length} 种语言（${langs.join(' / ')}），
每句 6 种写法（原文 / 大写 / 全角 / leet / 逐字插空格 / 零宽字符插入），连续 **${ROUNDS} 轮**重复验证，
共 **${totalChecks}** 次端到端 \`policyTextHeuristic\` 检查，漏拦 **${totalMiss}** 条；
正常句与中性科普/求助/翻译语境 ${SAFE_SAMPLES.length} 条，误伤 **${falsePositives.length}** 条。
耗时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒。

## 分类明细

| 类别 | 话题 | 语言数 | 检查次数 | 漏拦 | 屏蔽率 |
|---|---|---:|---:|---:|---:|
${rows.map((r) => `| \`${r.category}\` | ${r.label} | ${r.languages} | ${r.checks} | ${r.miss} | ${r.rate}% |`).join('\n')}

${rows.some((r) => r.examples.length) ? `漏拦样例：\n${rows.filter((r) => r.examples.length).map((r) => `- ${r.category}: ${r.examples.join(' · ')}`).join('\n')}\n` : ''}${falsePositives.length ? `误伤样例：\n${falsePositives.map((x) => `- ${x}`).join('\n')}\n` : ''}
## 口径与边界

- 审核链：既有 \`policyTextHeuristic\`（policy-v4）→ 新增 \`hardenedTextFindings\`（多语言加固层），只增加拦截、不放松旧规则。
- 加固层覆盖：色情 / 未成年人性内容 / 犯罪实施 / 自残自杀 / 排泄物相关 / 民族与种族歧视 / 不安全化学问题 / 恶劣人身攻击 / 商业诋毁与商业秘密窥探 / 诱导性越狱提示词 / 反社会言论。
- 抗规避：NFKC 全角与兼容字符、去变音符与零宽符、leet 数字、插空格与标点、重复字符压缩、常见简繁映射、显式 base64 载荷解码复检。
- 误伤控制：明确的教育 / 新闻 / 医学 / 求助 / 预防 / 翻译语境豁免「意图型」规则；越狱、未成年人性内容、自残、仇恨口号、反社会言论等强信号仍拦截。
- 边界：这是保守的**词法**策略，不是语义审核，也不代表任何上游模型或网关的内容政策；新语言、新黑话需要继续补充词库并重跑本脚本。
`;
fs.writeFileSync(path.join(ROOT, 'MODERATION_AUDIT.md'), md);
console.log(md);
process.exitCode = totalMiss === 0 && falsePositives.length === 0 ? 0 : 1;
