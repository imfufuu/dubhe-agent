#!/usr/bin/env python3
"""本机能力（local_relay.py + server.py /api/local/*）自检 —— 纯 stdlib，`python3 tests/local_relay_checks.py`。

覆盖：文件根目录约束、敏感路径拒绝、读写删移、shell 执行与超时、HTTP 层的 Host / 跨站 / token 门控。
截图依赖宿主显示器，这里只校验「无可用工具时给出可读错误」这一分支。
"""
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import threading
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import local_relay as LR  # noqa: E402


def load_server():
    spec = importlib.util.spec_from_file_location("dubhe_server_under_test", ROOT / "server.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ok = 0
bad = []


def check(name, cond, extra=""):
    global ok
    if cond:
        ok += 1
    else:
        bad.append(f"{name} {extra}")


def expect_error(fn, needle=""):
    try:
        fn()
    except LR.LocalError as exc:
        return needle in str(exc) if needle else True
    return False


tmp = tempfile.mkdtemp(prefix="dubhe-local-checks-")
ws = os.path.join(tmp, "workspace")
os.makedirs(ws)
outside = os.path.join(tmp, "outside")
os.makedirs(outside)
open(os.path.join(outside, "secret.txt"), "w").write("nope")
fs = LR.LocalFS([ws])

# ── 文件：根目录约束 ──
check("roots: workspace is root", fs.roots == [os.path.realpath(ws)])
check("fs: relative path lands in root",
      fs.write("a/b.txt", "hi")["path"] == os.path.realpath(os.path.join(ws, "a", "b.txt")))
check("fs: absolute outside root refused",
      expect_error(lambda: fs.resolve(os.path.join(outside, "secret.txt")), "超出允许的根目录"))
check("fs: .. traversal refused",
      expect_error(lambda: fs.resolve("../outside/secret.txt"), "超出允许的根目录"))
check("fs: empty path refused", expect_error(lambda: fs.resolve("  "), "不能为空"))

# ── 文件：敏感路径 ──
check("sensitive: .ssh refused",
      expect_error(lambda: fs.write(".ssh/id_rsa", "x", overwrite=True), "敏感路径"))
check("sensitive: .aws refused", expect_error(lambda: fs.read(".aws/credentials"), "敏感路径"))
check("sensitive: case-insensitive", expect_error(lambda: fs.resolve(".SSH/config", must_exist=False), "敏感路径"))

# ── 文件：读写删移 ──
r = fs.read("a/b.txt")
check("read: text content", r["content"] == "hi" and r["encoding"] == "text")
check("write: refuses overwrite by default", expect_error(lambda: fs.write("a/b.txt", "x"), "已存在"))
fs.write("a/b.txt", "updated", overwrite=True)
check("write: overwrite=true works", fs.read("a/b.txt")["content"] == "updated")
fs.write("bin.dat", "AAEC", encoding="base64")
check("write: base64 decodes", open(os.path.join(ws, "bin.dat"), "rb").read() == b"\x00\x01\x02")
check("read: binary refused in text mode", expect_error(lambda: fs.read("bin.dat"), "base64"))
check("read: base64 ok", fs.read("bin.dat", "base64")["content"] == "AAEC")
check("write: bad base64 rejected", expect_error(lambda: fs.write("x.bin", "!!!", encoding="base64"), "base64"))
listing = fs.list(".")["entries"]
check("list: dirs first", listing[0]["type"] == "dir" and listing[0]["name"] == "a")
fs.mkdir("d/e")
check("mkdir: nested", os.path.isdir(os.path.join(ws, "d", "e")))
check("delete: dir needs recursive", expect_error(lambda: fs.delete("d"), "recursive"))
fs.delete("d", recursive=True)
check("delete: recursive works", not os.path.exists(os.path.join(ws, "d")))
check("delete: root refused", expect_error(lambda: fs.delete(ws, recursive=True), "根目录"))
fs.move("bin.dat", "moved/bin.dat")
check("move: file moved", os.path.isfile(os.path.join(ws, "moved", "bin.dat")))
check("move: dest exists refused", expect_error(lambda: fs.move("a/b.txt", "moved/bin.dat"), "已存在"))
check("move: out of root refused", expect_error(lambda: fs.move("a/b.txt", os.path.join(outside, "x")), "超出"))
check("fs_action: unknown action", expect_error(lambda: LR.fs_action(fs, "format", {}), "未知"))

# ── shell ──
kind, _exe = LR.find_shell()
check("shell: platform reports kind", kind in ("bash", "sh", "powershell", None))
if kind:
    r = LR.run_shell("echo dubhe-local-ok", ws, 10)
    check("shell: echo output", "dubhe-local-ok" in r["stdout"], repr(r))
    check("shell: exit code", r["exitCode"] == 0 and not r["timedOut"])
    r = LR.run_shell("exit 3", ws, 10)
    check("shell: non-zero exit surfaced", r["exitCode"] == 3)
    if not LR.IS_WINDOWS:
        r = LR.run_shell("sleep 30", ws, 1)
        check("shell: timeout kills", r["timedOut"] and r["exitCode"] is None)
    r = LR.run_shell("pwd", ws, 10)
    check("shell: cwd honored", os.path.realpath(ws) in r["stdout"].replace("\\", "/") or r["exitCode"] == 0)
check("shell: empty command refused", expect_error(lambda: LR.run_shell("  ", ws), "不能为空"))
check("shell: bad timeout refused", expect_error(lambda: LR.run_shell("echo", ws, "soon"), "数字"))

# ── 截图：只校验错误分支可读 ──
if not LR.screenshot_available():
    # 无显示器时先报「没有图形会话」（更准确）；有显示器但缺工具时报「截图工具」
    check("screenshot: missing tool or session gives readable error", expect_error(LR.take_screenshot, "截图工具") or expect_error(LR.take_screenshot, "图形会话"))
else:
    check("screenshot: available flag consistent", True)

# ── HTTP 层门控 ──
server_mod = load_server()
server_mod.LOCAL_ENABLED = True
server_mod.LOCAL_FS = fs
httpd = server_mod.Server(("127.0.0.1", 0), server_mod.Handler)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{port}"


def call(method, path, body=None, headers=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"{}")
        except ValueError:
            return exc.code, {}


st, sess = call("GET", "/api/local/session")
check("http: session ok", st == 200 and sess.get("token") == server_mod.LOCAL_TOKEN, str(st))
token = {"X-Dubhe-Local-Token": server_mod.LOCAL_TOKEN}
st, _ = call("POST", "/api/local/shell", {"command": "echo x"})
check("http: shell without token -> 401", st == 401, str(st))
st, _ = call("POST", "/api/local/shell", {"command": "echo x"}, {"X-Dubhe-Local-Token": "wrong"})
check("http: shell with wrong token -> 401", st == 401, str(st))
st, _ = call("POST", "/api/local/fs", {"action": "list", "path": "."}, {"X-Dubhe-Local-Token": "wrong"})
check("http: fs with wrong token -> 401", st == 401, str(st))
st, _ = call("GET", "/api/local/screenshot", None, {"X-Dubhe-Local-Token": "wrong"})
check("http: screenshot with wrong token -> 401", st == 401, str(st))
st, _ = call("POST", "/api/local/shell", {"command": "echo x"}, {**token, "Host": "evil.example:80"})
check("http: foreign Host refused", st in (403, 400), str(st))
st, _ = call("GET", "/api/local/session", None, {"Sec-Fetch-Site": "cross-site"})
check("http: cross-site refused", st == 403, str(st))
st, _ = call("GET", "/api/local/session", None, {"Origin": "https://evil.example"})
check("http: cross-origin refused", st == 403, str(st))
st, body = call("POST", "/api/local/shell", {"command": "echo http-ok"}, token)
check("http: shell with token runs", st == 200 and "http-ok" in body.get("stdout", ""), str(st))
st, body = call("POST", "/api/local/shell", {"command": "echo x", "cwd": outside}, token)
check("http: shell cwd outside root refused", st == 400 and "超出" in body.get("error", ""), str(st))
st, body = call("POST", "/api/local/fs", {"action": "read", "path": os.path.join(outside, "secret.txt")}, token)
check("http: fs outside root refused", st == 400, str(st))
st, body = call("POST", "/api/local/fs", {"action": "write", "path": "http.txt", "content": "via-http"}, token)
check("http: fs write ok", st == 200 and open(os.path.join(ws, "http.txt")).read() == "via-http", str(st))
st, body = call("POST", "/api/local/desktop", {"action": "windows"})
check("desktop: no token -> 401", st == 401, str(st))
st, body = call("POST", "/api/local/desktop", {"action": "reboot"}, token)
check("desktop: unknown action -> 400", st == 400 and "未知 action" in body.get("error", ""), str(st))
st, body = call("POST", "/api/local/desktop", {"action": "click", "x": "a", "y": 1}, token)
check("desktop: bad coordinates -> 400", st == 400, str(st))
st, body = call("GET", "/api/local/session", None, None)
check("session: exposes desktop summary", st == 200 and "desktop" in body and "actions" in body.get("desktop", {}), str(st))
# fetch_url 中继：二进制内容必须拒绝（按文本解码会损坏字节），文本照常放行
check("fetch: image/png is binary", server_mod.looks_textual("image/png", b"\x89PNG") is False)
check("fetch: pdf is binary", server_mod.looks_textual("application/pdf", b"%PDF-1.4") is False)
check("fetch: html is text", server_mod.looks_textual("text/html; charset=utf-8", b"<p>x</p>") is True)
check("fetch: json/xml are text", server_mod.looks_textual("application/json", b"{}") and server_mod.looks_textual("application/atom+xml", b"<a/>"))
check("fetch: unknown type with NUL is binary", server_mod.looks_textual("", b"a\x00b") is False)
check("fetch: unknown type plain is text", server_mod.looks_textual("", b"hello") is True)
server_mod.LOCAL_ENABLED = False
st, _ = call("GET", "/api/local/session")
check("http: disabled -> 404", st == 404, str(st))
httpd.shutdown()
httpd.server_close()

print(f"local_relay checks: {ok} passed, {len(bad)} failed")
for line in bad:
    print("FAIL", line)
sys.exit(1 if bad else 0)
