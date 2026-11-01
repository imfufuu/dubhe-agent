#!/usr/bin/env python3
"""本机桌面交互：窗口、进程、剪贴板、打开文件/网址、鼠标键盘。纯 stdlib，按平台选原生工具。

- Windows（优先）：PowerShell + user32（SetCursorPos / mouse_event / keybd_event）。参数经环境变量
  DUBHE_ARGS（JSON）传入，不拼接到脚本里，避免引号与注入问题；输出强制 UTF-8。
- macOS：osascript（窗口/激活/按键/输入）、pbcopy/pbpaste、ps；鼠标需要 cliclick。
- Linux X11：xdotool（输入）、wmctrl（窗口）、xclip/xsel（剪贴板）、ps；缺工具时给出安装提示。
- Linux Wayland：只支持进程、剪贴板（wl-clipboard）、打开文件；窗口枚举与注入输入受协议限制，明确拒绝。

只构造 argv 的函数都是纯函数，便于在任何平台上单元测试；真正执行在 run_desktop()。
鉴权、Host 校验与路由在 server.py，这里不处理 HTTP。
"""
import base64
import json
import os
import re
import shutil
import subprocess
import sys

IS_WINDOWS = os.name == "nt"
DEFAULT_TIMEOUT_S = 20
MAX_TEXT_CHARS = 20000
MAX_ROWS = 60

# 只读动作无需确认；其余会改变桌面状态，用户必须在前端确认
READONLY_ACTIONS = {"info", "windows", "processes", "clipboard_read"}
MUTATING_ACTIONS = {"focus", "clipboard_write", "open", "mouse_move", "click", "scroll", "key", "type"}
ALL_ACTIONS = READONLY_ACTIONS | MUTATING_ACTIONS

BUTTONS = {"left", "right", "middle"}
MODIFIERS = {"ctrl": "ctrl", "control": "ctrl", "shift": "shift", "alt": "alt", "option": "alt",
             "win": "meta", "meta": "meta", "cmd": "meta", "command": "meta", "super": "meta"}
NAMED_KEYS = {
    "enter": "Return", "return": "Return", "tab": "Tab", "esc": "Escape", "escape": "Escape",
    "space": "space", "backspace": "BackSpace", "delete": "Delete", "del": "Delete", "insert": "Insert",
    "home": "Home", "end": "End", "pageup": "Prior", "pagedown": "Next",
    "up": "Up", "down": "Down", "left": "Left", "right": "Right",
}
# Windows 虚拟键码
WIN_VK = {"ctrl": 0x11, "shift": 0x10, "alt": 0x12, "meta": 0x5B,
          "Return": 0x0D, "Tab": 0x09, "Escape": 0x1B, "space": 0x20, "BackSpace": 0x08, "Delete": 0x2E,
          "Insert": 0x2D, "Home": 0x24, "End": 0x23, "Prior": 0x21, "Next": 0x22,
          "Up": 0x26, "Down": 0x28, "Left": 0x25, "Right": 0x27}
MAC_KEYCODE = {"Return": 36, "Tab": 48, "Escape": 53, "space": 49, "BackSpace": 51, "Delete": 117,
               "Home": 115, "End": 119, "Prior": 116, "Next": 121, "Up": 126, "Down": 125, "Left": 123, "Right": 124}
MAC_MOD = {"ctrl": "control down", "shift": "shift down", "alt": "option down", "meta": "command down"}


# 与 local_relay 共用同一个异常类型：服务端只捕获 LR.LocalError 并转成 400
from local_relay import LocalError  # noqa: E402


# ── 键位解析（纯函数）─────────────────────────────────────

def parse_combo(combo):
    """'ctrl+shift+t' → {'mods': ['ctrl','shift'], 'key': 't'}；key 为规范名（字母小写 / Return 等）。"""
    raw = str(combo or "").strip()
    if not raw:
        raise LocalError("key 不能为空，例如 'enter'、'ctrl+c'、'alt+f4'")
    parts = [p.strip().lower() for p in raw.split("+") if p.strip()]
    if not parts:
        raise LocalError("key 不能为空")
    mods, key = [], None
    for i, part in enumerate(parts):
        if part in MODIFIERS:
            name = MODIFIERS[part]
            if name not in mods:
                mods.append(name)
            continue
        if i != len(parts) - 1:
            raise LocalError(f"组合键中 {part!r} 只能放在最后")
        if part in NAMED_KEYS:
            key = NAMED_KEYS[part]
        elif re.fullmatch(r"[a-z0-9]", part):
            key = part
        elif re.fullmatch(r"f([1-9]|1[0-2])", part):
            key = part.upper()
        else:
            raise LocalError(f"不支持的按键：{part!r}")
    if key is None:
        raise LocalError("组合键必须包含一个非修饰键，例如 'ctrl+c'")
    return {"mods": mods, "key": key}


def win_vk_for(combo):
    parsed = parse_combo(combo)
    if parsed["key"] in WIN_VK:
        key_vk = WIN_VK[parsed["key"]]
    elif re.fullmatch(r"F\d+", parsed["key"]):
        key_vk = 0x70 + int(parsed["key"][1:]) - 1
    else:
        key_vk = ord(parsed["key"].upper())
    return {"mods": [WIN_VK[m] for m in parsed["mods"]], "key": key_vk}


def xdotool_combo(combo):
    parsed = parse_combo(combo)
    names = {"ctrl": "ctrl", "shift": "shift", "alt": "alt", "meta": "super"}
    keyname = parsed["key"]
    if re.fullmatch(r"F\d+", keyname):
        keyname = keyname.lower()
    elif len(keyname) == 1:
        keyname = keyname.lower()
    return "+".join([names[m] for m in parsed["mods"]] + [keyname])


def applescript_keystroke(combo):
    parsed = parse_combo(combo)
    mods = [MAC_MOD[m] for m in parsed["mods"]]
    using = f" using {{{', '.join(mods)}}}" if mods else ""
    if parsed["key"] in MAC_KEYCODE:
        return f'tell application "System Events" to key code {MAC_KEYCODE[parsed["key"]]}{using}'
    if re.fullmatch(r"F\d+", parsed["key"]):
        raise LocalError("macOS 功能键请用 cliclick 或减少修饰键；当前版本暂不支持 F 键")
    return f'tell application "System Events" to keystroke "{parsed["key"]}"{using}'


def _as_text(value, label="text"):
    text = "" if value is None else str(value)
    if len(text) > MAX_TEXT_CHARS:
        raise LocalError(f"{label} 超过 {MAX_TEXT_CHARS} 字符上限")
    return text


def _as_int(value, label):
    try:
        return int(value)
    except (TypeError, ValueError):
        raise LocalError(f"{label} 必须是整数")


def _as_button(value):
    button = str(value or "left").lower()
    if button not in BUTTONS:
        raise LocalError("button 只能是 left / right / middle")
    return button


def _quote_applescript(text):
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'


# ── Windows：PowerShell 脚本（参数走 DUBHE_ARGS）────────────

_PS_HEADER = (
    "$ErrorActionPreference='Stop'\n"
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n"
    "$a=$null; if ($env:DUBHE_ARGS) { $a = $env:DUBHE_ARGS | ConvertFrom-Json }\n"
)
_PS_INPUT_TYPE = (
    "Add-Type -TypeDefinition @'\n"
    "using System;\n"
    "using System.Runtime.InteropServices;\n"
    "public static class DubheInput {\n"
    "  [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x, int y);\n"
    "  [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr e);\n"
    "  [DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);\n"
    "}\n"
    "'@\n"
    "Add-Type -AssemblyName System.Windows.Forms\n"
)

WIN_SCRIPTS = {
    "info": (
        "Add-Type -AssemblyName System.Windows.Forms\n"
        "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen\n"
        "@{width=$b.Width; height=$b.Height; left=$b.Left; top=$b.Top} | ConvertTo-Json -Compress\n"
    ),
    "windows": (
        "Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowHandle -ne 0 } |\n"
        "  Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress\n"
    ),
    "processes": (
        "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 40 Id,ProcessName,\n"
        "  @{n='memMB';e={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json -Compress\n"
    ),
    "focus": (
        "$t=[System.Management.Automation.WildcardPattern]::Escape([string]$a.title)\n"
        "$p=Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like ('*'+$t+'*') } | Select-Object -First 1\n"
        "if (-not $p) { Write-Error '没有找到标题匹配的窗口'; exit 2 }\n"
        "$ws=New-Object -ComObject WScript.Shell\n"
        "if (-not $ws.AppActivate([int]$p.Id)) { Write-Error '窗口激活失败（系统可能禁止后台程序切换前台）'; exit 3 }\n"
        "Write-Output $p.MainWindowTitle\n"
    ),
    "clipboard_read": (
        "$c=Get-Clipboard -Raw\nif ($c) { Write-Output ([string]$c) }\n"
    ),
    "clipboard_write": (
        "Set-Clipboard -Value ([string]$a.text)\n"
    ),
    "mouse_move": _PS_INPUT_TYPE + (
        "[DubheInput]::SetCursorPos([int]$a.x,[int]$a.y) | Out-Null\n"
    ),
    "click": _PS_INPUT_TYPE + (
        "[DubheInput]::SetCursorPos([int]$a.x,[int]$a.y) | Out-Null\n"
        "$down=@{left=2; right=8; middle=32}[[string]$a.button]\n"
        "$up=@{left=4; right=16; middle=64}[[string]$a.button]\n"
        "$n=1; if ($a.double) { $n=2 }\n"
        "for ($i=0; $i -lt $n; $i++) {\n"
        "  [DubheInput]::mouse_event([uint32]$down,0,0,0,[UIntPtr]::Zero)\n"
        "  [DubheInput]::mouse_event([uint32]$up,0,0,0,[UIntPtr]::Zero)\n"
        "  Start-Sleep -Milliseconds 60\n"
        "}\n"
    ),
    "scroll": _PS_INPUT_TYPE + (
        "if ($null -ne $a.x) { [DubheInput]::SetCursorPos([int]$a.x,[int]$a.y) | Out-Null }\n"
        "[DubheInput]::mouse_event(0x0800,0,0,[int]([int]$a.dy*120),[UIntPtr]::Zero)\n"
    ),
    "key": _PS_INPUT_TYPE + (
        "$mods=@($a.mods) | Where-Object { $_ -ne $null }\n"
        "foreach ($m in $mods) { [DubheInput]::keybd_event([byte]$m,0,0,[UIntPtr]::Zero) }\n"
        "[DubheInput]::keybd_event([byte]$a.key,0,0,[UIntPtr]::Zero)\n"
        "[DubheInput]::keybd_event([byte]$a.key,0,2,[UIntPtr]::Zero)\n"
        "[array]::Reverse($mods)\n"
        "foreach ($m in $mods) { [DubheInput]::keybd_event([byte]$m,0,2,[UIntPtr]::Zero) }\n"
    ),
    # 任意 Unicode 文本：经剪贴板粘贴（Ctrl+V），结束后恢复原文本剪贴板
    "type": _PS_INPUT_TYPE + (
        "$old=Get-Clipboard -Raw\n"
        "Set-Clipboard -Value ([string]$a.text)\n"
        "[DubheInput]::keybd_event(0x11,0,0,[UIntPtr]::Zero)\n"
        "[DubheInput]::keybd_event(0x56,0,0,[UIntPtr]::Zero)\n"
        "[DubheInput]::keybd_event(0x56,0,2,[UIntPtr]::Zero)\n"
        "[DubheInput]::keybd_event(0x11,0,2,[UIntPtr]::Zero)\n"
        "Start-Sleep -Milliseconds 200\n"
        "if ($old) { Set-Clipboard -Value ([string]$old) }\n"
    ),
}


def win_ps_argv(action, args, exe):
    """返回 (argv, env)。脚本以 UTF-16LE base64 经 -EncodedCommand 传递，参数只进环境变量。"""
    script = _PS_HEADER + WIN_SCRIPTS[action]
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    argv = [exe, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded]
    return argv, {"DUBHE_ARGS": json.dumps(args, ensure_ascii=False)}


def build_win_payload(action, args):
    """校验并整理 Windows 动作的参数（纯函数，便于测试）。"""
    if action == "focus":
        title = _as_text(args.get("title"), "title").strip()
        if not title:
            raise LocalError("focus 需要 title（窗口标题的一部分）")
        return {"title": title}
    if action == "clipboard_write":
        return {"text": _as_text(args.get("text"))}
    if action == "type":
        text = _as_text(args.get("text"))
        if not text:
            raise LocalError("type 的 text 不能为空")
        return {"text": text}
    if action == "mouse_move":
        return {"x": _as_int(args.get("x"), "x"), "y": _as_int(args.get("y"), "y")}
    if action == "click":
        out = {"x": _as_int(args.get("x"), "x"), "y": _as_int(args.get("y"), "y"),
               "button": _as_button(args.get("button")), "double": bool(args.get("double"))}
        return out
    if action == "scroll":
        dy = _as_int(args.get("dy"), "dy")
        if not -50 <= dy <= 50 or dy == 0:
            raise LocalError("scroll 的 dy 取值 -50..50（非零，正数向上）")
        out = {"dy": dy}
        if args.get("x") is not None and args.get("y") is not None:
            out["x"] = _as_int(args.get("x"), "x")
            out["y"] = _as_int(args.get("y"), "y")
        return out
    if action == "key":
        spec = win_vk_for(args.get("key"))
        return {"mods": spec["mods"], "key": spec["key"]}
    return {}


# ── macOS / Linux 命令 ─────────────────────────────────

def posix_argv(action, args, plat):
    """返回 argv 列表（或 AppleScript 字符串的 argv）；缺少依赖由调用方检查。"""
    if plat == "macos":
        if action == "windows":
            return ["osascript", "-e", 'tell application "System Events" to get name of (processes whose visible is true)']
        if action == "focus":
            name = _as_text(args.get("title"), "title").strip()
            if not name:
                raise LocalError("focus 需要 title（应用名，例如 Safari）")
            return ["osascript", "-e", f"tell application {_quote_applescript(name)} to activate"]
        if action == "processes":
            return ["ps", "-axo", "pid=,comm=,rss="]
        if action == "clipboard_read":
            return ["pbpaste"]
        if action == "clipboard_write":
            return ["pbcopy"]
        if action == "type":
            return ["osascript", "-e", f'tell application "System Events" to keystroke {_quote_applescript(_as_text(args.get("text"), "text"))}']
        if action == "key":
            return ["osascript", "-e", applescript_keystroke(args.get("key"))]
        return None  # 鼠标与滚轮由 build_cliclick 处理
    # Linux X11
    if action == "windows":
        return ["wmctrl", "-l"]
    if action == "focus":
        title = _as_text(args.get("title"), "title").strip()
        if not title:
            raise LocalError("focus 需要 title（窗口标题的一部分）")
        return ["wmctrl", "-a", title]
    if action == "processes":
        return ["ps", "-eo", "pid=,comm=,rss=", "--sort=-rss"]
    if action == "clipboard_read":
        return ["xclip", "-selection", "clipboard", "-o"]
    if action == "clipboard_write":
        return ["xclip", "-selection", "clipboard"]
    if action == "mouse_move":
        return ["xdotool", "mousemove", "--sync", str(_as_int(args.get("x"), "x")), str(_as_int(args.get("y"), "y"))]
    if action == "click":
        x = _as_int(args.get("x"), "x"); y = _as_int(args.get("y"), "y")
        btn = {"left": "1", "middle": "2", "right": "3"}[_as_button(args.get("button"))]
        repeat = "2" if args.get("double") else "1"
        return ["xdotool", "mousemove", "--sync", str(x), str(y), "click", "--repeat", repeat, "--delay", "80", btn]
    if action == "scroll":
        dy = _as_int(args.get("dy"), "dy")
        if not -50 <= dy <= 50 or dy == 0:
            raise LocalError("scroll 的 dy 取值 -50..50（非零，正数向上）")
        cmd = ["xdotool"]
        if args.get("x") is not None and args.get("y") is not None:
            cmd += ["mousemove", "--sync", str(_as_int(args.get("x"), "x")), str(_as_int(args.get("y"), "y"))]
        return cmd + ["click", "--repeat", str(abs(dy)), "--delay", "30", "4" if dy > 0 else "5"]
    if action == "key":
        return ["xdotool", "key", "--clearmodifiers", xdotool_combo(args.get("key"))]
    if action == "type":
        return ["xdotool", "type", "--delay", "12", "--clearmodifiers", "--", _as_text(args.get("text"), "text")]
    return None


def build_cliclick(action, args):
    if action == "mouse_move":
        return ["cliclick", f"m:{_as_int(args.get('x'), 'x')},{_as_int(args.get('y'), 'y')}"]
    if action == "click":
        x = _as_int(args.get("x"), "x"); y = _as_int(args.get("y"), "y")
        button = _as_button(args.get("button"))
        verb = {"left": "c", "right": "rc", "middle": "c"}[button]
        if args.get("double"):
            verb = "dc"
        return ["cliclick", f"{verb}:{x},{y}"]
    raise LocalError("macOS 上滚轮需要 cliclick 以外的方案，暂不支持 scroll")


def linux_session():
    """'x11' | 'wayland' | 'none'。同时有 WAYLAND_DISPLAY 与 DISPLAY 时按 X11 处理（XWayland）。"""
    if os.environ.get("DISPLAY"):
        return "x11"
    if os.environ.get("WAYLAND_DISPLAY"):
        return "wayland"
    return "none"


def current_platform():
    if IS_WINDOWS:
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return "linux"


LINUX_NEEDS = {
    "windows": ("wmctrl",),
    "focus": ("wmctrl",),
    "clipboard_read": ("xclip",),
    "clipboard_write": ("xclip",),
    "mouse_move": ("xdotool",),
    "click": ("xdotool",),
    "scroll": ("xdotool",),
    "key": ("xdotool",),
    "type": ("xdotool",),
}
WAYLAND_OK = {"info", "processes", "clipboard_read", "clipboard_write"}


def check_supported(action, plat=None):
    """返回 None 或抛 LocalError（说明缺什么、怎么补）。不做任何副作用。"""
    if action not in ALL_ACTIONS:
        raise LocalError(f"未知 action：{action}；可用：{', '.join(sorted(ALL_ACTIONS))}")
    plat = plat or current_platform()
    if plat == "linux":
        session = linux_session()
        if session == "none":
            raise LocalError("没有图形会话（DISPLAY 与 WAYLAND_DISPLAY 都为空）：请在桌面会话里启动 server.py")
        if session == "wayland":
            if action not in WAYLAND_OK:
                raise LocalError(
                    "当前是 Wayland 会话：窗口枚举、切换与模拟输入受协议限制，本工具不支持。"
                    "可改用 X11 会话（登录时选择 Xorg），或让应用经 XWayland 运行后再试。"
                )
            needs = {"clipboard_read": ("wl-paste",), "clipboard_write": ("wl-copy",)}.get(action, ())
            hint = "sudo apt install wl-clipboard"
        else:
            needs = LINUX_NEEDS.get(action, ())
            hint = "sudo apt install xdotool wmctrl xclip"
        missing = [tool for tool in needs if shutil.which(tool) is None]
        if missing:
            raise LocalError(f"缺少 {', '.join(missing)}，请先安装：{hint}")
    if plat == "macos" and action in ("mouse_move", "click") and shutil.which("cliclick") is None:
        raise LocalError("鼠标操作需要 cliclick：brew install cliclick")
    if plat == "macos" and action == "scroll":
        raise LocalError("macOS 上暂不支持滚轮操作")
    return None


def _run(argv, *, env=None, input_text=None, timeout=DEFAULT_TIMEOUT_S):
    full_env = None
    if env:
        full_env = dict(os.environ)
        full_env.update(env)
    try:
        r = subprocess.run(argv, input=(input_text.encode("utf-8") if input_text is not None else None),
                           capture_output=True, timeout=timeout, env=full_env, stdin=None if input_text is not None else subprocess.DEVNULL)
    except FileNotFoundError:
        raise LocalError(f"未找到命令：{argv[0]}")
    except subprocess.TimeoutExpired:
        raise LocalError("操作超时")
    out = (r.stdout or b"").decode("utf-8", errors="replace")
    err = (r.stderr or b"").decode("utf-8", errors="replace").strip()
    if r.returncode != 0:
        raise LocalError(err[:400] or f"退出码 {r.returncode}")
    return out


def _parse_json_rows(text):
    text = (text or "").strip()
    if not text:
        return []
    data = json.loads(text)
    return data if isinstance(data, list) else [data]


def _parse_ps_rows(text):
    """解析 `ps -o pid=,comm=,rss=`：pid 为首列、rss（KB）为末列，中间全部是进程名（可含空格）。"""
    rows = []
    for line in (text or "").splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        pid, rss = parts[0], parts[-1]
        name = " ".join(parts[1:-1])
        mem_mb = round(int(rss) / 1024, 1) if rss.isdigit() else None
        rows.append({"pid": int(pid) if pid.isdigit() else pid, "name": name, "memMB": mem_mb})
        if len(rows) >= MAX_ROWS:
            break
    return rows


def _parse_wmctrl(text):
    rows = []
    for line in (text or "").splitlines():
        parts = line.split(None, 3)
        if len(parts) == 4:
            rows.append({"id": parts[0], "title": parts[3]})
    return rows[:MAX_ROWS]


def run_desktop(action, args=None):
    """执行一个桌面动作，返回 {ok, action, result}。失败抛 LocalError。"""
    args = args or {}
    plat = current_platform()
    check_supported(action, plat)
    if plat == "windows":
        exe = shutil.which("powershell") or shutil.which("pwsh")
        if not exe:
            raise LocalError("未找到 PowerShell")
        payload = build_win_payload(action, args) if action not in ("info", "windows", "processes", "clipboard_read") else {}
        argv, env = win_ps_argv(action, payload, exe)
        text = _run(argv, env=env, timeout=DEFAULT_TIMEOUT_S)
        if action == "info":
            info = json.loads(text.strip() or "{}")
            result = info
        elif action == "windows":
            result = [{"pid": r.get("Id"), "process": r.get("ProcessName"), "title": r.get("MainWindowTitle")} for r in _parse_json_rows(text)][:MAX_ROWS]
        elif action == "processes":
            result = [{"pid": r.get("Id"), "name": r.get("ProcessName"), "memMB": r.get("memMB")} for r in _parse_json_rows(text)][:MAX_ROWS]
        elif action == "clipboard_read":
            result = text[:MAX_TEXT_CHARS]
        elif action == "focus":
            result = text.strip()
        else:
            result = "ok"
        return {"ok": True, "action": action, "result": result}
    if plat == "macos":
        if action in ("mouse_move", "click"):
            _run(build_cliclick(action, args))
            return {"ok": True, "action": action, "result": "ok"}
        argv = posix_argv(action, args, "macos")
        if argv is None:
            raise LocalError(f"macOS 暂不支持 {action}")
        if action == "clipboard_write":
            _run(argv, input_text=_as_text(args.get("text"), "text"))
            text = ""
        elif action == "clipboard_read":
            text = _run(argv)[:MAX_TEXT_CHARS]
        else:
            text = _run(argv)
        if action == "windows":
            result = [{"title": s.strip()} for s in text.split(",") if s.strip()][:MAX_ROWS]
        elif action == "processes":
            result = _parse_ps_rows(text)
        elif action == "clipboard_read":
            result = text
        else:
            result = "ok"
        return {"ok": True, "action": action, "result": result}
    # Linux
    if action == "info":
        return {"ok": True, "action": action, "result": {"session": linux_session(), "os": "linux"}}
    argv = posix_argv(action, args, "linux")
    if argv is None:
        raise LocalError(f"Linux 暂不支持 {action}")
    if action == "clipboard_read" and linux_session() == "wayland":
        argv = ["wl-paste", "-n"]
    if action == "clipboard_write":
        if linux_session() == "wayland":
            argv = ["wl-copy"]
        _run(argv, input_text=_as_text(args.get("text"), "text"))
        return {"ok": True, "action": action, "result": "ok"}
    if action == "processes":
        return {"ok": True, "action": action, "result": _parse_ps_rows(_run(argv))}
    if action == "windows":
        return {"ok": True, "action": action, "result": _parse_wmctrl(_run(argv))}
    text = _run(argv)
    if action == "clipboard_read":
        return {"ok": True, "action": action, "result": text[:MAX_TEXT_CHARS]}
    return {"ok": True, "action": action, "result": "ok"}


def desktop_summary():
    """会话摘要：平台、图形会话类型、可用动作与是否需要确认（供前端与 session 端点展示）。"""
    plat = current_platform()
    session = linux_session() if plat == "linux" else "native"
    return {
        "platform": plat,
        "session": session,
        "actions": sorted(ALL_ACTIONS),
        "readonly": sorted(READONLY_ACTIONS),
    }


def open_target(target, fs_resolve=None):
    """用系统默认程序打开：http(s) 网址，或（经 fs_resolve 校验的）允许根内路径。"""
    raw = str(target or "").strip()
    if not raw:
        raise LocalError("open 需要 target（网址或文件/文件夹路径）")
    if re.match(r"^https?://", raw, re.I):
        url = raw
    else:
        if fs_resolve is None:
            raise LocalError("本机路径未启用")
        url = fs_resolve(raw)
        if not os.path.exists(url):
            raise LocalError(f"路径不存在：{raw}")
    plat = current_platform()
    if plat == "windows":
        os.startfile(url)  # noqa: S606 — 路径已限定在允许根内，网址已限定 http(s)
    elif plat == "macos":
        _run(["open", url], timeout=15)
    else:
        if linux_session() == "none":
            raise LocalError("没有图形会话，无法打开")
        if shutil.which("xdg-open") is None:
            raise LocalError("未找到 xdg-open（sudo apt install xdg-utils）")
        subprocess.Popen(["xdg-open", url], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return {"ok": True, "action": "open", "result": url}
