import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'assets/knowledge/index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const languages = [
  {
    language: 'zh',
    id: 'rendering-zh',
    title: '客户端渲染语法参考',
    file: 'assets/knowledge/rendering.zh.md',
    tags: 'rendering markdown syntax Markdown 表格 合并单元格 colspan rowspan KaTeX chart flow mind image HTML fence format',
  },
  {
    language: 'en',
    id: 'rendering-en',
    title: 'Client rendering syntax reference',
    file: 'assets/knowledge/rendering.en.md',
    tags: 'rendering markdown syntax table merged cells colspan rowspan KaTeX chart flow mind image HTML fence format 中文 合并单元格',
  },
];

const records = [];
for (const { language, id, title, file, tags } of languages) {
  records.push(...index.records.filter((record) => record.language === language && record.topic !== 'rendering'));
  records.push({
    id,
    language,
    topic: 'rendering',
    title,
    tags,
    content: fs.readFileSync(path.join(root, file), 'utf8').trimEnd() + '\n',
  });
}
const output = JSON.stringify({ ...index, version: 1, records }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  const current = fs.readFileSync(indexPath, 'utf8');
  if (current !== output) {
    console.error('assets/knowledge/index.json is out of date; run node tools/build-knowledge-index.mjs');
    process.exitCode = 1;
  } else console.log('Knowledge index matches the Markdown sources.');
} else {
  fs.writeFileSync(indexPath, output);
  console.log('Rebuilt assets/knowledge/index.json from the bilingual rendering guides.');
}
