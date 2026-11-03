// 附件不限格式 + 附件卡片图标的回归测试（纯函数 / 无网络）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileCategoryOf, fileCardIconHtml, fileCardBadge } from '../js/file-card.js';
import { buildOpenAIMessages } from '../js/api.js';

test('卡片分类：主流格式各归其类，未知格式落到「其它」', () => {
  const cases = {
    'a.pdf': 'pdf', 'b.docx': 'word', 'c.xlsx': 'sheet', 'd.csv': 'sheet', 'e.pptx': 'slide',
    'f.zip': 'archive', 'g.7z': 'archive', 'h.mp3': 'audio', 'i.mp4': 'video', 'j.png': 'image',
    'k.py': 'code', 'l.txt': 'text', 'm.ttf': 'font', 'n.glb': 'model', 'o.xyz123': 'other', 'noext': 'other',
  };
  for (const [name, cat] of Object.entries(cases)) assert.equal(fileCategoryOf({ name }), cat, name);
  assert.equal(fileCategoryOf({ name: 'x.bin', source: 'binary', mime: 'application/octet-stream' }), 'other');
  assert.equal(fileCategoryOf({ name: 'clip', source: 'video', mime: 'video/mp4' }), 'video');
});

test('卡片图标：图片用原图、视频用首帧海报，其余用格式标签', () => {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const safe = (s) => (String(s || '').startsWith('data:') ? s : '');
  const img = fileCardIconHtml({ kind: 'image', name: 'p.png', dataUrl: 'data:image/png;base64,AAAA' }, { safeImgSrc: safe, esc });
  assert.match(img, /fc-image/);
  assert.match(img, /<img src="data:image\/png;base64,AAAA"/);
  const vid = fileCardIconHtml({ source: 'video', name: 'v.mov', poster: 'data:image/jpeg;base64,BBBB' }, { safeImgSrc: safe, esc });
  assert.match(vid, /fc-video/);
  assert.match(vid, /src="data:image\/jpeg;base64,BBBB"/);
  const pdf = fileCardIconHtml({ name: 'r<x>.pdf', source: 'pdf' }, { safeImgSrc: safe, esc });
  assert.match(pdf, /fc-pdf/);
  assert.match(pdf, />PDF</);
  assert.doesNotMatch(pdf, /<x>/);
  assert.equal(fileCardBadge({ name: 'long.abcdefgh' }), 'ABCD');
  assert.equal(fileCardBadge({ name: 'README' }), '文件');
});

test('任意格式附件：对话通道提示 uploads/ 路径与 read_file，不再写「不可读」', () => {
  const msgs = buildOpenAIMessages([{
    role: 'user', text: '看看这个',
    attachments: [{ kind: 'file', source: 'binary', name: 'model.bin', mime: 'application/octet-stream', size: 2048, dataUrl: 'data:application/octet-stream;base64,AAEC' }],
  }]);
  const text = JSON.stringify(msgs);
  assert.match(text, /uploads\/model\.bin/);
  assert.match(text, /read_file/);
  assert.doesNotMatch(text, /不可读/);
});
