#!/usr/bin/env python3
"""本机桌面交互（local_desktop.py）自检 —— 纯 stdlib，`python3 tests/local_desktop_checks.py`。

只验证可在任意平台执行的部分：键位解析、参数校验、各平台 argv / PowerShell 脚本构造、
Linux 会话与依赖检查、ps 解析、截图工具选择顺序。真正的点击与输入需要图形会话，不在 CI 中执行。
"""
import base64
import json
import os
import pathlib
import sys
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import local_desktop as LD  # noqa: E402
import local_relay as LR  # noqa: E402

ok = 0
bad = []


def check(name, cond, extra=""):
    global ok
    if cond:
        ok += 1
    else:
        bad.append(f"{name} {extra}")


def raises(fn, needle=None):
    try:
        fn()
    except LD.LocalError as exc:
        return needle is None or needle in str(exc)
    return False


# ── 动作分类：与 js/localmachine.js 的常量保持一致 ──
check("readonly set", LD.READONLY_ACTIONS == {"info", "windows", "processes", "clipboard_read"})
check("mutating set", LD.MUTATING_ACTIONS == {"focus", "clipboard_write", "open", "mouse_move", "click", "scroll", "key", "type"})
check("readonly and mutating disjoint", not (LD.READONLY_ACTIONS & LD.MUTATING_ACTIONS))
check("unknown action refused", raises(lambda: LD.check_supported("format_disk", "windows"), "未知 action"))

# ── 键位解析 ──
check("combo: enter", LD.parse_combo("enter") == {"mods": [], "key": "Return"})
check("combo: ctrl+c", LD.parse_combo("ctrl+c") == {"mods": ["ctrl"], "key": "c"})
check("combo: ctrl+shift+t order kept", LD.parse_combo("Ctrl+Shift+T") == {"mods": ["ctrl", "shift"], "key": "t"})
check("combo: win alias meta", LD.parse_combo("win+r")["mods"] == ["meta"])
check("combo: cmd alias meta", LD.parse_combo("cmd+space") == {"mods": ["meta"], "key": "space"})
check("combo: f5", LD.parse_combo("f5") == {"mods": [], "key": "F5"})
check("combo: alt+f4", LD.parse_combo("alt+f4") == {"mods": ["alt"], "key": "F4"})
check("combo: modifier-only refused", raises(lambda: LD.parse_combo("ctrl"), "非修饰键"))
check("combo: key not last refused", raises(lambda: LD.parse_combo("c+ctrl"), "只能放在最后"))
check("combo: unknown key refused", raises(lambda: LD.parse_combo("ctrl+@"), "不支持"))
check("combo: empty refused", raises(lambda: LD.parse_combo("  "), "不能为空"))

# Windows 虚拟键码
check("vk: ctrl+c", LD.win_vk_for("ctrl+c") == {"mods": [0x11], "key": ord("C")})
check("vk: enter", LD.win_vk_for("enter")["key"] == 0x0D)
check("vk: f5", LD.win_vk_for("f5")["key"] == 0x74)
check("vk: win+r", LD.win_vk_for("win+r") == {"mods": [0x5B], "key": ord("R")})

# xdotool / AppleScript 组合
check("xdotool: ctrl+shift+t", LD.xdotool_combo("ctrl+shift+t") == "ctrl+shift+t")
check("xdotool: win -> super", LD.xdotool_combo("win+e") == "super+e")
check("xdotool: enter -> Return", LD.xdotool_combo("enter") == "Return")
check("xdotool: F5 lowercase", LD.xdotool_combo("f5") == "f5")
check("applescript: cmd+shift+t", LD.applescript_keystroke("cmd+shift+t") == 'tell application "System Events" to keystroke "t" using {command down, shift down}')
check("applescript: enter key code", LD.applescript_keystroke("enter") == 'tell application "System Events" to key code 36')
check("applescript: F key refused", raises(lambda: LD.applescript_keystroke("f5"), "F 键"))

# ── 参数校验 ──
check("click: default left", LD.build_win_payload("click", {"x": 1, "y": 2})["button"] == "left")
check("click: bad button refused", raises(lambda: LD.build_win_payload("click", {"x": 1, "y": 2, "button": "wheel"}), "button"))
check("click: non-int refused", raises(lambda: LD.build_win_payload("click", {"x": "a", "y": 2}), "整数"))
check("scroll: zero refused", raises(lambda: LD.build_win_payload("scroll", {"dy": 0}), "dy"))
check("scroll: too big refused", raises(lambda: LD.build_win_payload("scroll", {"dy": 500}), "dy"))
check("scroll: negative ok", LD.build_win_payload("scroll", {"dy": -3}) == {"dy": -3})
check("focus: empty title refused", raises(lambda: LD.build_win_payload("focus", {"title": " "}), "title"))
check("type: empty text refused", raises(lambda: LD.build_win_payload("type", {"text": ""}), "不能为空"))
check("text limit", raises(lambda: LD.build_win_payload("type", {"text": "x" * (LD.MAX_TEXT_CHARS + 1)}), "上限"))
check("open: empty target refused", raises(lambda: LD.open_target(""), "target"))
check("open: local path needs resolver", raises(lambda: LD.open_target("C:/x.txt"), "未启用"))

# ── Windows PowerShell：参数只进环境变量，脚本不含用户文本 ──
evil = "x'); Remove-Item -Recurse C:\\ ; ('"
argv, env = LD.win_ps_argv("type", {"text": evil}, "powershell.exe")
check("win: argv uses EncodedCommand", "-EncodedCommand" in argv and argv[0] == "powershell.exe")
script = base64.b64decode(argv[argv.index("-EncodedCommand") + 1]).decode("utf-16-le")
check("win: user text not in script", evil not in script and "Remove-Item" not in script)
check("win: args in env json", json.loads(env["DUBHE_ARGS"]) == {"text": evil})
check("win: output forced UTF-8", "OutputEncoding" in script)
check("win: type uses clipboard paste with restore", "Set-Clipboard" in script and "0x56" in script and "$old" in script)
check("win: click uses user32 mouse_event", "mouse_event" in LD.WIN_SCRIPTS["click"] and "SetCursorPos" in LD.WIN_SCRIPTS["click"])
check("win: key releases modifiers in reverse", "[array]::Reverse($mods)" in LD.WIN_SCRIPTS["key"])
for name in ("info", "windows", "processes", "focus", "clipboard_read", "clipboard_write", "mouse_move", "click", "scroll", "key", "type"):
    check(f"win: script exists for {name}", name in LD.WIN_SCRIPTS)
check("win: scripts cover every action except open",
      set(LD.WIN_SCRIPTS) | {"open"} == LD.ALL_ACTIONS, str(set(LD.ALL_ACTIONS) ^ set(LD.WIN_SCRIPTS)))
check("win: focus escapes wildcard chars", "WildcardPattern]::Escape" in LD.WIN_SCRIPTS["focus"])

# ── Linux X11 argv ──
check("x11: windows via wmctrl", LD.posix_argv("windows", {}, "linux") == ["wmctrl", "-l"])
check("x11: focus via wmctrl -a", LD.posix_argv("focus", {"title": "Notes"}, "linux") == ["wmctrl", "-a", "Notes"])
click = LD.posix_argv("click", {"x": 5, "y": 6, "double": True, "button": "right"}, "linux")
check("x11: click args", click[:3] == ["xdotool", "mousemove", "--sync"] and click[3:5] == ["5", "6"] and click[-1] == "3" and click[click.index("--repeat") + 1] == "2", str(click))
scr = LD.posix_argv("scroll", {"dy": 3}, "linux")
check("x11: scroll up is button 4 x3", scr[-1] == "4" and scr[scr.index("--repeat") + 1] == "3", str(scr))
check("x11: scroll down is button 5", LD.posix_argv("scroll", {"dy": -2}, "linux")[-1] == "5")
txt = LD.posix_argv("type", {"text": "-rf 你好"}, "linux")
check("x11: type after -- separator", txt[-2] == "--" and txt[-1] == "-rf 你好", str(txt))
check("x11: key argv", LD.posix_argv("key", {"key": "ctrl+c"}, "linux") == ["xdotool", "key", "--clearmodifiers", "ctrl+c"])
check("x11: clipboard read", LD.posix_argv("clipboard_read", {}, "linux") == ["xclip", "-selection", "clipboard", "-o"])

# ── Linux 会话与依赖检查（mock 环境变量与 which）──
def with_env(env, which_map, fn):
    saved = dict(os.environ)
    try:
        os.environ.pop("DISPLAY", None)
        os.environ.pop("WAYLAND_DISPLAY", None)
        os.environ.update(env)
        with mock.patch.object(LD.shutil, "which", side_effect=lambda t: which_map.get(t)):
            return fn()
    finally:
        os.environ.clear()
        os.environ.update(saved)


all_tools = {t: f"/usr/bin/{t}" for t in ("xdotool", "wmctrl", "xclip", "wl-copy", "wl-paste", "xdg-open")}
check("linux: no session refused", raises(lambda: with_env({}, all_tools, lambda: LD.check_supported("processes", "linux")), "没有图形会话"))
check("linux: x11 windows ok", with_env({"DISPLAY": ":0"}, all_tools, lambda: LD.check_supported("windows", "linux")) is None)
check("linux: x11 missing xdotool explains", raises(lambda: with_env({"DISPLAY": ":0"}, {"wmctrl": "/x"}, lambda: LD.check_supported("click", "linux")), "xdotool"))
check("linux: wayland refuses windows", raises(lambda: with_env({"WAYLAND_DISPLAY": "wayland-0"}, all_tools, lambda: LD.check_supported("windows", "linux")), "Wayland"))
check("linux: wayland refuses click", raises(lambda: with_env({"WAYLAND_DISPLAY": "wayland-0"}, all_tools, lambda: LD.check_supported("click", "linux")), "Wayland"))
check("linux: wayland processes ok", with_env({"WAYLAND_DISPLAY": "wayland-0"}, all_tools, lambda: LD.check_supported("processes", "linux")) is None)
check("linux: wayland clipboard needs wl-copy", with_env({"WAYLAND_DISPLAY": "wayland-0"}, {}, lambda: raises(lambda: LD.check_supported("clipboard_write", "linux"), "wl-clipboard")))
check("linux: both displays treated as x11", with_env({"DISPLAY": ":0", "WAYLAND_DISPLAY": "w"}, {}, lambda: LR.linux_session()) == "x11")
check("linux: session detection none", with_env({}, {}, lambda: LR.linux_session()) == "none")

# ── 截图工具顺序：X11 与 Wayland 不同 ──
def first_shot(env, tools):
    return with_env(env, {t: f"/usr/bin/{t}" for t in tools}, lambda: (LR._screenshot_argv("/tmp/x.png") or [None])[0])
check("shot x11 prefers scrot", first_shot({"DISPLAY": ":0"}, ["scrot", "grim"]) == "scrot")
check("shot x11 falls back to import", first_shot({"DISPLAY": ":0"}, ["import"]) == "import")
check("shot wayland prefers grim", first_shot({"WAYLAND_DISPLAY": "w"}, ["scrot", "grim"]) == "grim")
check("shot no session -> none", with_env({}, {"scrot": "/x"}, lambda: LR._screenshot_argv("/tmp/x.png")) is None)

# ── ps 解析：进程名可含空格，rss 取末列 ──
rows = LD._parse_ps_rows("  123 /Applications/Foo Bar.app/Contents/MacOS/foo  204800\n 9 bash 1024\n")
check("ps: spaces in name", rows[0] == {"pid": 123, "name": "/Applications/Foo Bar.app/Contents/MacOS/foo", "memMB": 200.0}, str(rows))
check("ps: simple row", rows[1] == {"pid": 9, "name": "bash", "memMB": 1.0}, str(rows))
check("wmctrl parse", LD._parse_wmctrl("0x01 0 host Notes - Editor\n0x02 -1 host Desktop\n") == [{"id": "0x01", "title": "Notes - Editor"}, {"id": "0x02", "title": "Desktop"}])

# ── 摘要 ──
summary = LD.desktop_summary()
check("summary has actions", set(summary["actions"]) == LD.ALL_ACTIONS and summary["readonly"] == sorted(LD.READONLY_ACTIONS))

# 不实际执行桌面动作：只确认未知动作在统一入口被拒绝
check("run_desktop refuses unknown action", raises(lambda: LD.run_desktop("reboot", {}), "未知 action"))

print(f"local_desktop checks: {ok} passed, {len(bad)} failed")
for line in bad:
    print("FAIL", line)
sys.exit(1 if bad else 0)
