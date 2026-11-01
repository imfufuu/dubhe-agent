#!/usr/bin/env python3
"""本地中继的「本机能力」层：shell、截图、本机文件操作。纯 stdlib，跨平台（Windows / macOS / Linux）。

这里只放与 HTTP 无关的逻辑；鉴权（token、Host、Origin）与路由在 server.py。
设计要点：
- Windows 优先：shell 依次找 Git Bash → PATH 中的 bash（排除 WSL 启动器）→ PowerShell；
  进程树用 taskkill 结束，控制台输出统一按 UTF-8 解码。
- 文件操作只允许落在显式配置的根目录（默认：用户主目录）之内，并拒绝敏感路径（.ssh、.aws、.netrc 等）。
- 截图使用各平台原生工具，不引入第三方依赖。
"""
import base64
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time

IS_WINDOWS = os.name == "nt"

MAX_OUTPUT_CHARS = 64 * 1024        # shell 每路输出上限
MAX_READ_BYTES = 2 * 1024 * 1024    # 读文件上限
MAX_WRITE_BYTES = 5 * 1024 * 1024   # 写文件上限
MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024
MAX_LIST_ENTRIES = 500
DEFAULT_TIMEOUT_S = 60
MAX_TIMEOUT_S = 600

# 任何路径分量命中即拒绝（大小写不敏感）：凭据与密钥类目录/文件
SENSITIVE_NAMES = {
    ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".netrc", "_netrc",
    ".git-credentials", ".npmrc", ".pypirc", ".password-store", "id_rsa", "id_ed25519",
    "keychain", "credentials.json", "login.keychain-db",
}


class LocalError(Exception):
    """可直接回显给用户/模型的错误（不含堆栈）。"""


def os_name():
    if IS_WINDOWS:
        return "windows"
    return "macos" if sys.platform == "darwin" else "linux"


# ── shell ──────────────────────────────────────────────

def _is_wsl_launcher(path):
    low = path.lower()
    return "system32" in low or "windowsapps" in low


def find_shell():
    """返回 (kind, executable)。kind ∈ {bash, powershell, sh}；找不到时 (None, None)。"""
    override = os.environ.get("DUBHE_SHELL")
    if override and os.path.isfile(override):
        low = override.lower()
        if "powershell" in low or "pwsh" in low:
            return "powershell", override
        return "bash", override
    if IS_WINDOWS:
        roots = []
        for var in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
            base = os.environ.get(var)
            if not base:
                continue
            if var == "LOCALAPPDATA":
                base = os.path.join(base, "Programs")
            roots.append(os.path.join(base, "Git"))
        for root in roots:
            for rel in (("bin", "bash.exe"), ("usr", "bin", "bash.exe")):
                cand = os.path.join(root, *rel)
                if os.path.isfile(cand):
                    return "bash", cand
        found = shutil.which("bash")
        if found and not _is_wsl_launcher(found):
            return "bash", found
        for name in ("pwsh", "powershell"):
            found = shutil.which(name)
            if found:
                return "powershell", found
        return None, None
    for name in ("bash", "sh"):
        found = shutil.which(name)
        if found:
            return name, found
    return None, None


def shell_info():
    kind, exe = find_shell()
    return {"os": os_name(), "kind": kind, "available": kind is not None}


def _kill_tree(proc):
    """结束进程树：Windows 用 taskkill /T，POSIX 用进程组。失败时退化为 kill 直接子进程。"""
    try:
        if IS_WINDOWS:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False,
            )
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        proc.kill()
    except OSError:
        pass


def _clip(text):
    if len(text) <= MAX_OUTPUT_CHARS:
        return text, False
    return text[:MAX_OUTPUT_CHARS] + f"\n…（已截断，原始 {len(text)} 字符）", True


def run_shell(command, cwd, timeout_s=DEFAULT_TIMEOUT_S):
    """执行一条 shell 命令。cwd 必须已由调用方校验在允许根目录内。"""
    if not isinstance(command, str) or not command.strip():
        raise LocalError("command 不能为空")
    kind, exe = find_shell()
    if not kind:
        raise LocalError("未找到可用的 shell（Windows 请安装 Git for Windows，或设置 DUBHE_SHELL）")
    try:
        timeout = min(max(float(timeout_s or DEFAULT_TIMEOUT_S), 1.0), MAX_TIMEOUT_S)
    except (TypeError, ValueError):
        raise LocalError("timeout_s 必须是数字")
    if kind == "powershell":
        # 让 PowerShell 的管道输出走 UTF-8，避免中文乱码
        script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8;" + command
        argv = [exe, "-NoProfile", "-NonInteractive", "-Command", script]
    else:
        argv = [exe, "-c", command]
    popen_kw = {}
    if IS_WINDOWS:
        popen_kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        popen_kw["start_new_session"] = True
    t0 = time.time()
    proc = subprocess.Popen(
        argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **popen_kw,
    )
    timed_out = False
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        _kill_tree(proc)
        out, err = proc.communicate()
    stdout, t1 = _clip(out.decode("utf-8", errors="replace"))
    stderr, t2 = _clip(err.decode("utf-8", errors="replace"))
    return {
        "exitCode": None if timed_out else proc.returncode,
        "timedOut": timed_out,
        "stdout": stdout,
        "stderr": stderr,
        "truncated": t1 or t2,
        "shell": kind,
        "cwd": cwd,
        "durationMs": int((time.time() - t0) * 1000),
    }


# ── 截图 ───────────────────────────────────────────────

def _screenshot_argv(out):
    if IS_WINDOWS:
        q = out.replace("'", "''")
        script = (
            "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;"
            "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;"
            "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;"
            "$g=[System.Drawing.Graphics]::FromImage($bmp);"
            "$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size);"
            f"$bmp.Save('{q}',[System.Drawing.Imaging.ImageFormat]::Png);"
            "$g.Dispose();$bmp.Dispose()"
        )
        exe = shutil.which("powershell") or shutil.which("pwsh")
        return [exe, "-NoProfile", "-NonInteractive", "-Command", script] if exe else None
    if sys.platform == "darwin":
        exe = shutil.which("screencapture")
        return [exe, "-x", "-t", "png", out] if exe else None
    for argv in (
        ["gnome-screenshot", "-f", out],
        ["grim", out],
        ["scrot", "-o", out],
        ["import", "-window", "root", out],
    ):
        if shutil.which(argv[0]):
            return argv
    return None


def screenshot_available():
    return _screenshot_argv(os.path.join(tempfile.gettempdir(), "probe.png")) is not None


def take_screenshot():
    """抓取整个虚拟屏幕，返回 PNG 字节。无可用工具或无显示器时抛 LocalError。"""
    fd, out = tempfile.mkstemp(prefix="dubhe-shot-", suffix=".png")
    os.close(fd)
    try:
        argv = _screenshot_argv(out)
        if not argv:
            raise LocalError("未找到截图工具（Linux 需安装 gnome-screenshot / grim / scrot 之一）")
        try:
            r = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, timeout=60)
        except subprocess.TimeoutExpired:
            raise LocalError("截图超时")
        if r.returncode != 0:
            msg = (r.stderr or b"").decode("utf-8", errors="replace").strip()[:300]
            raise LocalError(f"截图失败：{msg or '退出码 ' + str(r.returncode)}")
        size = os.path.getsize(out) if os.path.exists(out) else 0
        if size <= 0:
            raise LocalError("截图失败：没有生成图片（可能没有可用显示器）")
        if size > MAX_SCREENSHOT_BYTES:
            raise LocalError("截图过大，已拒绝")
        with open(out, "rb") as fh:
            data = fh.read()
        if not data.startswith(b"\x89PNG"):
            raise LocalError("截图失败：输出不是 PNG")
        return data
    finally:
        try:
            os.remove(out)
        except OSError:
            pass


# ── 本机文件 ───────────────────────────────────────────

def _is_within(path, root):
    try:
        return os.path.commonpath([path, root]) == root
    except ValueError:  # 不同盘符
        return False


class LocalFS:
    """受根目录约束的文件操作。所有路径先 realpath，再检查是否落在某个根之内。"""

    def __init__(self, roots):
        cleaned = []
        for r in roots:
            real = os.path.realpath(os.path.abspath(os.path.expanduser(str(r))))
            if os.path.isdir(real) and real not in cleaned:
                cleaned.append(real)
        if not cleaned:
            raise LocalError("没有可用的本机根目录")
        self.roots = cleaned

    def describe(self):
        return {"roots": list(self.roots), "os": os_name()}

    def resolve(self, raw, must_exist=True):
        if not isinstance(raw, str) or not raw.strip():
            raise LocalError("path 不能为空")
        p = os.path.expanduser(raw.strip())
        if not os.path.isabs(p):
            p = os.path.join(self.roots[0], p)
        real = os.path.realpath(os.path.abspath(p))
        parts = [s.lower() for s in pathlib.PurePath(real).parts]
        if any(part in SENSITIVE_NAMES for part in parts):
            raise LocalError(f"出于安全考虑拒绝访问敏感路径：{raw}")
        if not any(_is_within(real, root) for root in self.roots):
            raise LocalError(f"路径超出允许的根目录：{raw}")
        if must_exist and not os.path.lexists(real):
            raise LocalError(f"路径不存在：{raw}")
        return real

    def _is_root(self, real):
        return real in self.roots

    def list(self, path):
        real = self.resolve(path)
        if not os.path.isdir(real):
            raise LocalError("list 需要目录路径")
        entries = []
        with os.scandir(real) as it:
            for e in sorted(it, key=lambda x: (not x.is_dir(follow_symlinks=False), x.name.lower())):
                try:
                    st = e.stat(follow_symlinks=False)
                    kind = "dir" if e.is_dir(follow_symlinks=False) else ("link" if e.is_symlink() else "file")
                    entries.append({"name": e.name, "type": kind, "size": st.st_size, "mtime": int(st.st_mtime)})
                except OSError:
                    entries.append({"name": e.name, "type": "unknown", "size": 0, "mtime": 0})
                if len(entries) >= MAX_LIST_ENTRIES:
                    break
        return {"path": real, "entries": entries, "truncated": len(entries) >= MAX_LIST_ENTRIES}

    def stat(self, path):
        real = self.resolve(path)
        st = os.stat(real)
        return {"path": real, "type": "dir" if os.path.isdir(real) else "file", "size": st.st_size, "mtime": int(st.st_mtime)}

    def read(self, path, encoding="text"):
        real = self.resolve(path)
        if not os.path.isfile(real):
            raise LocalError("read 需要文件路径")
        size = os.path.getsize(real)
        if size > MAX_READ_BYTES:
            raise LocalError(f"文件过大（{size} 字节，上限 {MAX_READ_BYTES}）")
        with open(real, "rb") as fh:
            data = fh.read()
        if encoding == "base64":
            return {"path": real, "size": size, "encoding": "base64", "content": base64.b64encode(data).decode("ascii")}
        if b"\x00" in data[:8192]:
            raise LocalError("这是二进制文件，请使用 encoding=base64 读取")
        return {"path": real, "size": size, "encoding": "text", "content": data.decode("utf-8", errors="replace")}

    def write(self, path, content, encoding="text", overwrite=False):
        real = self.resolve(path, must_exist=False)
        if os.path.isdir(real):
            raise LocalError("目标是目录")
        if os.path.lexists(real) and not overwrite:
            raise LocalError(f"文件已存在（如需覆盖请传 overwrite=true）：{path}")
        if encoding == "base64":
            try:
                data = base64.b64decode(content or "", validate=True)
            except (ValueError, TypeError):
                raise LocalError("base64 内容非法")
        else:
            data = (content or "").encode("utf-8")
        if len(data) > MAX_WRITE_BYTES:
            raise LocalError(f"内容过大（上限 {MAX_WRITE_BYTES} 字节）")
        os.makedirs(os.path.dirname(real), exist_ok=True)
        with open(real, "wb") as fh:
            fh.write(data)
        return {"path": real, "size": len(data)}

    def mkdir(self, path):
        real = self.resolve(path, must_exist=False)
        os.makedirs(real, exist_ok=True)
        return {"path": real}

    def move(self, path, dest):
        src = self.resolve(path)
        if self._is_root(src):
            raise LocalError("不能移动根目录")
        dst = self.resolve(dest, must_exist=False)
        if os.path.lexists(dst):
            raise LocalError("目标已存在")
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(src, dst)
        return {"from": src, "to": dst}

    def delete(self, path, recursive=False):
        real = self.resolve(path)
        if self._is_root(real):
            raise LocalError("不能删除根目录")
        if os.path.isdir(real) and not os.path.islink(real):
            if not recursive:
                raise LocalError("删除目录需要 recursive=true")
            shutil.rmtree(real)
        else:
            os.remove(real)
        return {"deleted": real}


def fs_action(fs, action, args):
    """统一分发：action ∈ list/stat/read/write/mkdir/move/delete。"""
    args = args or {}
    if action == "list":
        return fs.list(args.get("path") or ".")
    if action == "stat":
        return fs.stat(args.get("path"))
    if action == "read":
        return fs.read(args.get("path"), args.get("encoding") or "text")
    if action == "write":
        return fs.write(args.get("path"), args.get("content", ""), args.get("encoding") or "text", bool(args.get("overwrite")))
    if action == "mkdir":
        return fs.mkdir(args.get("path"))
    if action == "move":
        return fs.move(args.get("path"), args.get("dest"))
    if action == "delete":
        return fs.delete(args.get("path"), bool(args.get("recursive")))
    raise LocalError(f"未知 action：{action}")
