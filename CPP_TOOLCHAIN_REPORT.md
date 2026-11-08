# 本地 C++ 工具链检查报告

生成时间：2026-11-08T10:38:17.223Z · 主机：linux x64 6.1.189+ · 命令：`node tools/check-cpp-toolchain.mjs`

## 结论

- **应用内 C++ 可用：是**。浏览器「本地」模式使用随仓库分发的 Clang/LLD WASM（`@browsercc` + WASI shim），不要求本机安装编译器；默认「远程」模式经 godbolt.org 编译执行。
- 本机原生编译器可编译并运行 C++17：**是**（g++，输出 `cpp17-ok:17:1:b`）。
- 本机原生工具链「完整」：**否**；缺：cmake、ninja、gdb。缺失这些不影响浏览器内 WASM 编译，只影响在本机直接构建原生 C++ 项目。
- 浏览器 WASM 运行时资源与许可证、回归测试齐备：**是**。

## ① 主机工具

| 工具 | 可用 | 版本 | 路径 |
| --- | --- | --- | --- |
| g++ | ✅ | g++ (Debian 14.2.0-19) 14.2.0 | /usr/bin/g++ |
| gcc | ✅ | gcc (Debian 14.2.0-19) 14.2.0 | /usr/bin/gcc |
| clang++ | — | 未安装 |  |
| clang | — | 未安装 |  |
| cmake | — | 未安装 |  |
| make | ✅ | GNU Make 4.4.1 | /usr/bin/make |
| ninja | — | 未安装 |  |
| gdb | — | 未安装 |  |
| pkg-config | ✅ | 1.8.1 | /usr/bin/pkg-config |
| ar | ✅ | GNU ar (GNU Binutils for Debian) 2.44 | /usr/bin/ar |

C++17 真实编译/运行探针：`通过`，输出 `cpp17-ok:17:1:b`。

## ② 浏览器内 WASM 运行时资源

| 文件 | 存在 | 大小 |
| --- | --- | --- |
| browsercc/runtime/clang.js | ✅ | 72 KiB |
| browsercc/runtime/clang.wasm.gz | ✅ | 14659 KiB |
| browsercc/runtime/lld.js | ✅ | 70 KiB |
| browsercc/runtime/lld.wasm.gz | ✅ | 8495 KiB |
| browsercc/runtime/sysroot.tar.gz | ✅ | 5545 KiB |
| browsercc/runtime/index.js | ✅ | 5 KiB |
| browser-wasi-shim/runtime/index.js | ✅ | 0 KiB |
| browser-wasi-shim/runtime/wasi.js | ✅ | 16 KiB |
| browser-wasi-shim/runtime/fd.js | ✅ | 2 KiB |
| browser-wasi-shim/runtime/fs_mem.js | ✅ | 12 KiB |
| js/local-cpp-runtime.js | ✅ | 12 KiB |
| js/worker-cpp.js | ✅ | 5 KiB |

许可证：✅ LICENSE-WASI-SDK.txt · ✅ LICENSE-LLVM.TXT · ✅ LICENSE-EMSCRIPTEN.txt · ✅ LICENSE · ✅ LICENSE-MIT

回归测试：✅ tests/local-cpp-policy.test.mjs · ✅ tests/local-cpp.test.mjs · ✅ tests/cpp-remote.test.mjs

## 边界

远程模式会把源码发送到第三方 Compiler Explorer；本地模式的源码、附带文件与 stdin 只在浏览器 Worker 内处理。此报告只检查本机环境与应用自带资源，不代表 WASM 编译器在每种浏览器/设备上都能成功初始化（需浏览器运行时实测）。
