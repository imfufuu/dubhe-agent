# Local C++ toolchain assets

The browser-local C++ runner uses these pinned upstream artifacts:

- `browsercc@0.1.1` (MIT wrapper, see `browsercc/LICENSE` and its README/package metadata). The prebuilt Clang/LLD binaries are LLVM/Clang `llvmorg-20.1.2`; they run inside a same-origin module Worker. Bundled Emscripten JavaScript glue is covered by `LICENSE-EMSCRIPTEN.txt`.
- WASI SDK 25.0 sysroot and `libclang_rt` (see `LICENSE-WASI-SDK.txt`, `LICENSE-LLVM.TXT`, and the `wasi-libc-*` notices). The `sysroot` archive was built by Browsercc's published `build.sh`, which removes upstream `share/` notices before packaging; the relevant license and third-party notices are therefore reproduced here separately.
- `@bjorn3/browser_wasi_shim@0.4.2`, dual-licensed MIT OR Apache-2.0; both upstream license texts are in `browser-wasi-shim/`.

The `.wasm.gz` and `.tar.gz` assets are gzip-compressed copies of the corresponding Browsercc distribution artifacts. At runtime, only those same-origin static assets are fetched and decompressed in the Worker. User source, supplied files, stdin, and compiler output are not sent to a remote compiler or other external service.

The WASI Preview 1 target does not support C++ exceptions or threading in this toolchain. Programs have no preopened filesystem or network access. Compilation uses C++20 and supports multiple source translation units, headers, stdin, command-line arguments, captured stdout/stderr, process exit codes, and worker termination on timeout.
