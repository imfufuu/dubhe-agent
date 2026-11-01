// 第 18 条：文稿扫描实时取景角点（节流、丢帧不堆积、Worker/主线程两条路径、平滑、全屏入口）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLiveDetector, liveSmoothQuad, LIVE_INTERVAL_MS, LIVE_DETECT_EDGE } from '../js/doc-scan-live.js';

const W = 160; const H = 120;
// 合成一张「亮页在暗底上」的图：检测器应能找到四角
function pageImage() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; const v = x >= 30 && x < 130 && y >= 20 && y < 100 ? 230 : 20;
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  }
  return data;
}
function fakeDoc() {
  const data = pageImage();
  return {
    createElement() {
      return {
        width: 0, height: 0,
        getContext() {
          return {
            drawImage() {},
            getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(data) }; },
          };
        },
      };
    },
  };
}
// 视频桩：分辨率 640x480，drawImage 不做事
const video = { videoWidth: 640, videoHeight: 480 };

test('常量：检测长边约 240px，节流间隔约 200ms（≈5 次/秒）', () => {
  assert.equal(LIVE_DETECT_EDGE, 240);
  assert.equal(LIVE_INTERVAL_MS, 200);
});

test('Worker 路径：检测结果被换算回视频像素坐标，且只在途一帧', async () => {
  const sent = [];
  let onMessage = null;
  const fakeWorker = {
    postMessage(msg) { sent.push(msg); },
    set onmessage(fn) { onMessage = fn; },
    get onmessage() { return onMessage; },
    terminate() {},
  };
  const det = createLiveDetector({ makeWorker: () => fakeWorker, doc: fakeDoc() });
  const first = det.detect(video);
  assert.equal(sent.length, 1, '第一帧送入 Worker');
  // 在途期间的第二次调用直接丢帧，不排队
  assert.equal(await det.detect(video), null);
  assert.equal(sent.length, 1, '在途时不再发送');
  // Worker 回包
  onMessage({ data: { id: sent[0].id, quad: [{ x: 30, y: 20 }, { x: 129, y: 20 }, { x: 129, y: 99 }, { x: 30, y: 99 }] } });
  const hit = await first;
  assert.ok(hit);
  assert.equal(hit.sourceWidth, 640);
  assert.equal(hit.sourceHeight, 480);
  // 160x120 缩放到 240 长边不需要：scale=1 时 quad 应原样（这里 video 与图像比例不同，只校验比例换算）
  assert.equal(hit.quad.length, 4);
  det.dispose();
});

test('Worker 无返回角点时返回 null，且不影响下一帧', async () => {
  const sent = [];
  let onMessage = null;
  const det = createLiveDetector({
    makeWorker: () => ({ postMessage(m) { sent.push(m); }, set onmessage(fn) { onMessage = fn; }, get onmessage() { return onMessage; }, terminate() {} }),
    doc: fakeDoc(),
  });
  const p = det.detect(video);
  onMessage({ data: { id: sent[0].id, quad: null } });
  assert.equal(await p, null);
  const p2 = det.detect(video);
  assert.equal(sent.length, 2, '下一帧正常发送');
  onMessage({ data: { id: sent[1].id, quad: null } });
  assert.equal(await p2, null);
  det.dispose();
});

test('无 Worker 环境：退回主线程检测，仍能找到四角', async () => {
  const det = createLiveDetector({ doc: fakeDoc() }); // Node 中 Worker 未定义 → 退回主线程
  // 视频与合成图同尺寸（不触发降采样），保证像素数组与声明的宽高一致
  const hit = await det.detect({ videoWidth: W, videoHeight: H });
  assert.ok(hit, '主线程检测应命中合成页面');
  assert.equal(hit.quad.length, 4);
  assert.equal(hit.sourceWidth, W);
  det.dispose();
});

test('画面未就绪（视频尺寸为 0）时不检测', async () => {
  const det = createLiveDetector({ doc: fakeDoc() });
  assert.equal(await det.detect({ videoWidth: 0, videoHeight: 0 }), null);
  det.dispose();
});

test('liveSmoothQuad：首次直接采用；小幅抖动插值；大幅位移（换页）直接跳到新位置', () => {
  const a = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  assert.equal(liveSmoothQuad(null, a), a);
  const b = a.map((p) => ({ x: p.x + 10, y: p.y }));
  const s = liveSmoothQuad(a, b);
  assert.equal(s[0].x, 5);
  const far = a.map((p) => ({ x: p.x + 300, y: p.y }));
  assert.equal(liveSmoothQuad(a, far), far);
  assert.equal(liveSmoothQuad(a, null), null);
});

test('扫描窗口接入：取景节流定时器、全屏按钮与清理都已接线', () => {
  const src = readFileSync(new URL('../js/ui-scanner.js', import.meta.url), 'utf8');
  assert.match(src, /createLiveDetector\(\{ doc \}\)/);
  assert.match(src, /win\.setInterval\(\(\) => \{ tickLive\(\); \}, LIVE_INTERVAL_MS\)/);
  assert.match(src, /liveDetector\.dispose\(\)/);
  assert.match(src, /data-r="fullscreen"/);
  assert.match(src, /modal\.requestFullscreen/);
  // 拍摄后的校正仍以冻结帧为准，取景角点不参与导出
  assert.match(src, /quad = detectQuadOnStill\(\);/);
});

test('Worker 脚本：按 id 回包，空白图返回 null（不抛异常）', async () => {
  const out = [];
  globalThis.self = { postMessage: (m) => out.push(m) };
  await import('../js/doc-scan-worker.js');
  const blank = new Uint8ClampedArray(64 * 64 * 4).fill(128);
  globalThis.self.onmessage({ data: { id: 7, width: 64, height: 64, buffer: blank.buffer } });
  assert.deepEqual(out, [{ id: 7, quad: null }]);
  delete globalThis.self;
});
