import test from 'node:test';
import assert from 'node:assert/strict';
import { createFS } from '../js/sandbox.js';
import { TOOL_DEFS, executeTool } from '../js/tools.js';
import { createZip } from '../js/zip.js';
import { resetRelayProbe } from '../js/net.js';

const encoder = new TextEncoder();
async function zipBytes(root = 'Hello-World-main-abc123') {
  const blob = createZip([
    { name: `${root}/README.md`, bytes: encoder.encode('# Hello World\n') },
    { name: `${root}/src/main.js`, bytes: encoder.encode('export const answer = 42;\n') },
    { name: `${root}/.github/workflows/ci.yml`, bytes: encoder.encode('name: CI\n') },
    { name: `${root}/assets/font.woff2`, bytes: new Uint8Array([0x80, 0x81, 0x82]) },
  ]);
  return new Uint8Array(await blob.arrayBuffer());
}

async function withMockRelay({ archiveBytes, metadata = { private: false, default_branch: 'main' }, metadataStatus = 200 } = {}, run) {
  const realFetch = globalThis.fetch;
  const calls = [];
  const archiveTargets = [];
  resetRelayProbe();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'https://app.test/');
    calls.push(url.href);
    if (url.pathname === '/api/health') {
      const capabilities = url.hostname === 'relay.dubhe-agent.workers.dev'
        ? ['fetch', 'search', 'crawl', 'file']
        : ['fetch', 'git'];
      return new Response(JSON.stringify({ ok: true, capabilities }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/api/fetch') {
      const target = url.searchParams.get('url');
      assert.match(target, /^https:\/\/api\.github\.com\/repos\//);
      if (metadataStatus !== 200) {
        return new Response(JSON.stringify({ error: 'Not Found' }), {
          status: metadataStatus, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ text: JSON.stringify(metadata), content_type: 'application/json', url: target }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/api/file') {
      const target = url.searchParams.get('url');
      archiveTargets.push(target);
      assert.equal(url.hostname, 'relay.dubhe-agent.workers.dev', 'ZIP 必须走已声明 file 的 Cloudflare Worker');
      return new Response(archiveBytes, {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'x-dubhe-file-name': 'source.zip',
          'x-dubhe-final-url': target,
          'content-length': String(archiveBytes.length),
        },
      });
    }
    throw new Error(`unexpected request: ${url.href}`);
  };
  try { return await run({ calls, archiveTargets }); }
  finally { globalThis.fetch = realFetch; resetRelayProbe(); }
}

function toolEvents() {
  const events = [];
  return { events, onUi: (event) => events.push(event) };
}

test('pull_github_project is registered under the file-download capability and documents snapshot limits', async () => {
  const def = TOOL_DEFS.find((tool) => tool.name === 'pull_github_project');
  assert.ok(def);
  assert.deepEqual(def.parameters.required, ['url']);
  assert.deepEqual(Object.keys(def.parameters.properties).sort(), ['path', 'ref', 'url']);
  assert.match(def.description, /Cloudflare Worker/);
  assert.match(def.description, /不含 Git 历史/);
  const registry = await import('../js/capabilities.js');
  assert.equal(registry.capabilityOf('pull_github_project').group, 'fileDownload');
  const context = await import('../js/executionContext.js');
  assert.ok(context.RELAY_DEPENDENT_TOOLS.includes('pull_github_project'));
});

test('execution constraints require the Worker file capability and respect all GitHub host scopes', async () => {
  const execution = await import('../js/execution.js');
  const args = { url: 'https://github.com/octocat/Hello-World' };
  const noFile = execution.buildCapabilityConstraints({ relayOk: true, webEnabled: true, overrides: { web: { file: false } } });
  const unavailable = execution.checkCapabilityConstraints({ name: 'pull_github_project', args, capabilities: noFile });
  assert.equal(unavailable.allowed, false);
  assert.equal(unavailable.constraintId, 'relay-file-unavailable');
  assert.match(unavailable.recovery, /\/api\/file/);

  const partialHost = execution.buildCapabilityConstraints({
    relayOk: true, webEnabled: true,
    overrides: { web: { file: true, allowedHosts: ['api.github.com'] } },
  });
  const hostDenied = execution.checkCapabilityConstraints({ name: 'pull_github_project', args, capabilities: partialHost });
  assert.equal(hostDenied.allowed, false);
  assert.equal(hostDenied.constraintId, 'web-host-not-allowed');

  const fullHost = execution.buildCapabilityConstraints({
    relayOk: true, webEnabled: true,
    overrides: { web: { file: true, allowedHosts: ['github.com'] } },
  });
  const allowed = execution.checkCapabilityConstraints({ name: 'pull_github_project', args, capabilities: fullHost });
  assert.equal(allowed.allowed, true, 'github.com scope also covers its API and codeload subdomains');
  assert.equal(allowed.constraintId, 'web-github-project-ok');

  const pathScoped = execution.buildCapabilityConstraints({
    relayOk: true, webEnabled: true,
    overrides: { web: { file: true, allowedHosts: ['github.com'] }, sandbox: { allowedPaths: ['outputs/'] } },
  });
  const defaultPathDenied = execution.checkCapabilityConstraints({ name: 'pull_github_project', args, capabilities: pathScoped });
  assert.equal(defaultPathDenied.allowed, false);
  assert.equal(defaultPathDenied.constraintId, 'path-outside-scope');
  const customPathAllowed = execution.checkCapabilityConstraints({
    name: 'pull_github_project', args: { ...args, path: 'outputs/demo' }, capabilities: pathScoped,
  });
  assert.equal(customPathAllowed.allowed, true);
});

test('imports a public GitHub default-branch ZIP through the Worker file route without overwriting', async () => {
  const fs = createFS();
  const events = toolEvents();
  const archiveBytes = await zipBytes();
  await withMockRelay({ archiveBytes }, async ({ calls, archiveTargets }) => {
    const result = await executeTool('pull_github_project', {
      url: 'https://github.com/octocat/Hello-World',
    }, { fs, onUi: events.onUi });

    assert.match(result, /^\[GitHub 项目已拉取\] octocat\/Hello-World@main/);
    assert.match(result, /uploads\/github\/octocat\/Hello-World/);
    assert.match(result, /中继 \/api\/file/);
    assert.match(result, /不含 Git 历史/);
    assert.equal(fs.read('uploads/github/octocat/Hello-World/README.md'), '# Hello World\n');
    assert.equal(fs.read('uploads/github/octocat/Hello-World/src/main.js'), 'export const answer = 42;\n');
    assert.equal(fs.read('uploads/github/octocat/Hello-World/.github/workflows/ci.yml'), 'name: CI\n');
    const fontDataUrl = fs.read('uploads/github/octocat/Hello-World/assets/font.woff2');
    assert.match(fontDataUrl, /^data:application\/octet-stream;base64,/);
    assert.deepEqual([...Uint8Array.from(atob(fontDataUrl.split(',')[1]), (ch) => ch.charCodeAt(0))], [0x80, 0x81, 0x82]);
    assert.equal(calls.filter((url) => url.includes('/api/fetch')).length, 1, '未指定 ref 时只查一次默认分支');
    assert.deepEqual(archiveTargets, ['https://codeload.github.com/octocat/Hello-World/zipball/main']);
    assert.ok(events.events.some((event) => event.status === 'ok' && event.fsChange === true));
  });
});

test('supports an explicit ref and destination path without calling repository metadata', async () => {
  const fs = createFS();
  const archiveBytes = await zipBytes('Hello-World-release-v2-abc123');
  await withMockRelay({ archiveBytes }, async ({ calls, archiveTargets }) => {
    const result = await executeTool('pull_github_project', {
      url: 'https://github.com/octocat/Hello-World.git', ref: 'v2.0.0', path: 'projects/demo',
    }, { fs, onUi: () => {} });
    assert.match(result, /projects\/demo/);
    assert.equal(fs.read('projects/demo/README.md'), '# Hello World\n');
    assert.equal(calls.filter((url) => url.includes('/api/fetch')).length, 0);
    assert.deepEqual(archiveTargets, ['https://codeload.github.com/octocat/Hello-World/zipball/v2.0.0']);
  });
});

test('rejects non-GitHub URLs, repository subpaths, invalid refs, and occupied destinations before network access', async () => {
  const fs = createFS();
  fs.write('projects/demo/keep.txt', 'keep me');
  const badUrls = [
    'https://example.com/owner/repo',
    'https://github.com/octocat/Hello-World/tree/main',
    'http://github.com/octocat/Hello-World',
    'https://attacker@github.com/octocat/Hello-World',
  ];
  for (const url of badUrls) {
    const result = await executeTool('pull_github_project', { url, ref: 'main', path: 'fresh/project' }, { fs, onUi: () => {} });
    assert.match(result, /pull_github_project 失败：/);
  }
  const badRef = await executeTool('pull_github_project', {
    url: 'https://github.com/octocat/Hello-World', ref: '../main', path: 'fresh/project',
  }, { fs, onUi: () => {} });
  assert.match(badRef, /ref 无效/);
  const collision = await executeTool('pull_github_project', {
    url: 'https://github.com/octocat/Hello-World', ref: 'main', path: 'projects/demo',
  }, { fs, onUi: () => {} });
  assert.match(collision, /目标目录 projects\/demo 已有文件/);
  assert.deepEqual(fs.keys(), ['projects/demo/keep.txt']);
});

test('rolls back partial filesystem writes if an import write fails', async () => {
  const fs = createFS();
  const write = fs.write.bind(fs);
  let attempts = 0;
  fs.write = (path, content) => {
    attempts++;
    if (attempts === 2) throw new Error('simulated storage failure');
    return write(path, content);
  };
  const archiveBytes = await zipBytes();
  await withMockRelay({ archiveBytes }, async () => {
    const result = await executeTool('pull_github_project', {
      url: 'https://github.com/octocat/Hello-World', ref: 'main', path: 'projects/demo',
    }, { fs, onUi: () => {} });
    assert.match(result, /已尝试回滚本次导入：simulated storage failure/);
    assert.deepEqual(fs.keys(), [], '没有残留半个项目');
  });
});

test('does not create files when GitHub metadata denies access or reports a private repository', async () => {
  const archiveBytes = await zipBytes();
  const fs = createFS();
  await withMockRelay({ archiveBytes, metadataStatus: 404 }, async ({ archiveTargets }) => {
    const result = await executeTool('pull_github_project', { url: 'https://github.com/octocat/private-repo' }, { fs, onUi: () => {} });
    assert.match(result, /私有仓库不支持/);
    assert.equal(archiveTargets.length, 0);
    assert.deepEqual(fs.keys(), []);
  });
  await withMockRelay({ archiveBytes, metadata: { private: true, default_branch: 'main' } }, async ({ archiveTargets }) => {
    const result = await executeTool('pull_github_project', { url: 'https://github.com/octocat/private-repo' }, { fs, onUi: () => {} });
    assert.match(result, /只支持公开仓库/);
    assert.equal(archiveTargets.length, 0);
    assert.deepEqual(fs.keys(), []);
  });
});

test('rejects non-GitHub ZIP content before writing any file', async () => {
  const fs = createFS();
  // Two top-level roots make a valid ZIP, but not a GitHub codeload archive.
  const blob = createZip([
    { name: 'first-root/a.txt', bytes: encoder.encode('a') },
    { name: 'second-root/b.txt', bytes: encoder.encode('b') },
  ]);
  const archiveBytes = new Uint8Array(await blob.arrayBuffer());
  await withMockRelay({ archiveBytes }, async () => {
    const result = await executeTool('pull_github_project', {
      url: 'https://github.com/octocat/Hello-World', ref: 'main', path: 'fresh/project',
    }, { fs, onUi: () => {} });
    assert.match(result, /ZIP 结构不像 GitHub 仓库源码归档/);
    assert.deepEqual(fs.keys(), []);
  });
});
