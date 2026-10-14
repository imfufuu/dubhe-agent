import assert from 'node:assert/strict';
import fs from 'node:fs';
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8000';
for (const engine of (process.env.BROWSERS || 'chromium,webkit').split(',')) {
  const browser = await engines[engine].launch(); let checks = 0;
  try {
    const page = await browser.newPage(); const external = [];
    page.on('request', req => { if (/^https?:/.test(req.url()) && !req.url().startsWith(base + '/')) external.push(req.url()); });
    await page.goto(base + '/docs.html');
    await page.evaluate(async () => {
      const { runDocumentTool } = await import('./js/document-tools.js');
      const files = new Map();
      const fs = { has: p => files.has(p), read: p => { if (!files.has(p)) throw Error('Missing ' + p); return files.get(p); }, write: (p, v) => files.set(p, v) };
      const canvas = document.createElement('canvas'); canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);files.set('uploads/picture.png',canvas.toDataURL());
      window.docFiles = files;
      window.documentCall = async args => { const raw = await runDocumentTool(args, { fs }); return JSON.parse(raw.slice(raw.indexOf('\n') + 1)); };
    });
    const call = args => page.evaluate(args => window.documentCall(args), args);
    const word = await call({ format: 'docx', action: 'create', out: 'outputs/sample.docx', data: { images:[{path:'uploads/picture.png',width:120,height:120,alt:'测试图片'}], title: '中文文档 & English', header: '页眉 Header', footer: '页脚 Footer', paragraphs: [{ text: '章节一', heading: 1 }, 'Preserve <literal> & 中文内容', { text: '项目 A', bullet: true }], tables: [{ rows: [['项目', '数量'], ['验证', '2']] }] } });
    assert.equal(word.path, 'outputs/sample.docx'); checks++;
    const wordRead = await call({ format: 'docx', action: 'inspect', path: word.path });
    assert.match(wordRead.text, /中文文档 & English/); assert.match(wordRead.text, /<literal>/); assert.match(wordRead.text, /页眉/); assert.match(wordRead.text, /页脚/); assert.equal(wordRead.tables, 1); checks++;
    const slides = await call({ format: 'pptx', action: 'create', out: 'outputs/sample.pptx', data: { title: '演示文稿', slides: [{ title: '结论先行', images:[{path:'uploads/picture.png',alt:'测试图片'}], body: ['事实', '行动'], notes: '备注内容' }, { title: '数据', table: { rows: [['项目', '数目'], ['任务', '2']] } }] } });
    const slideRead = await call({ format: 'pptx', action: 'inspect', path: slides.path });
    assert.equal(slideRead.slides, 2); assert.match(slideRead.text, /结论先行/); assert.match(slideRead.text, /备注内容/); checks++;
    const pdf = await call({ format: 'pdf', action: 'create', out: 'outputs/sample.pdf', data: { pages: ['Page one', 'Page two'] } });
    assert.equal(pdf.pageCount, 2); checks++;
    const extracted = await call({ format: 'pdf', action: 'extract', path: pdf.path, pages: [2, 1, 2], out: 'outputs/reordered.pdf' }); assert.equal(extracted.pageCount, 3); checks++;
    const rotated = await call({ format: 'pdf', action: 'rotate', path: extracted.path, pages: [1], angle: 90, out: 'outputs/rotated.pdf' });
    const rotatedRead = await call({ format: 'pdf', action: 'inspect', path: rotated.path }); assert.equal(JSON.parse(rotatedRead.text).pages[0].rotation, 90); checks++;
    const merged = await call({ format: 'pdf', action: 'merge', paths: [pdf.path, rotated.path], out: 'outputs/merged.pdf' }); assert.equal(merged.pageCount, 5); checks++;
    const marked = await call({ format: 'pdf', action: 'watermark', path: pdf.path, data: { text: 'DRAFT' }, out: 'outputs/marked.pdf' }); assert.equal(marked.pageCount, 2); checks++;
    const meta = await call({ format: 'pdf', action: 'metadata', path: pdf.path, data: { title: 'Local PDF', author: 'Test' }, out: 'outputs/meta.pdf' });
    const metaRead = await call({ format: 'pdf', action: 'inspect', path: meta.path }); assert.equal(metaRead.title, 'Local PDF'); checks++;
    await page.addScriptTag({ url: base + '/assets/vendor/office/pdf-lib-1.17.1.js' });
    await page.evaluate(async () => {
      const d = await PDFLib.PDFDocument.create(); const p = d.addPage(); const form = d.getForm();
      const field = form.createTextField('name'); field.addToPage(p, { x: 40, y: 600, width: 200, height: 30 });
      const check = form.createCheckBox('agree'); check.addToPage(p, { x: 40, y: 550, width: 20, height: 20 });
      docFiles.set('uploads/form.pdf', await d.saveAsBase64({ dataUri: true }));
    });
    const fields = await call({ format: 'pdf', action: 'form_fields', path: 'uploads/form.pdf' }); assert.equal(JSON.parse(fields.text).fields.length, 2); checks++;
    const filled = await call({ format: 'pdf', action: 'fill_form', path: 'uploads/form.pdf', out: 'outputs/filled.pdf', data: { fields: { name: 'Alice', agree: true } } });
    const values = await page.evaluate(async path => { const d = await PDFLib.PDFDocument.load(docFiles.get(path)); return [d.getForm().getTextField('name').getText(), d.getForm().getCheckBox('agree').isChecked()]; }, filled.path);
    assert.deepEqual(values, ['Alice', true]); checks++;
    await assert.rejects(call({ format: 'pdf', action: 'extract', path: pdf.path, pages: [0], out: 'outputs/bad.pdf' }), /page/); checks++;
    await assert.rejects(call({ format: 'pdf', action: 'rotate', path: pdf.path, angle: 90, out: pdf.path }), /never overwritten/); checks++;
    await assert.rejects(call({ format: 'doc', action: 'inspect', path: 'uploads/legacy.doc' }), /docx/); checks++;
    const skills = await page.evaluate(async () => { const { retrieveSkill } = await import('./js/skill-library.js'); return { index: await retrieveSkill({ query: 'PPTX' }), guide: await retrieveSkill({ action: 'read', id: 'slide-deck' }) }; });
    assert.match(skills.index, /slide-deck/); assert.doesNotMatch(skills.index, /slides\[\]\.images/); assert.match(skills.guide, /document_tool/); checks++;
    assert.deepEqual(external, []); checks++;
    if (engine === 'chromium') {
      fs.mkdirSync('/home/user/task4-document-fixtures', { recursive: true });
      for (const path of [word.path, slides.path, pdf.path]) {
        const raw = await page.evaluate(path => docFiles.get(path), path);
        fs.writeFileSync('/home/user/task4-document-fixtures/' + path.split('/').pop(), Buffer.from(raw.split(',')[1], 'base64'));
      }
    }
    console.log(`${engine}: ${checks} real local-document checks passed; no external document requests.`);
  } finally { await browser.close(); }
}
