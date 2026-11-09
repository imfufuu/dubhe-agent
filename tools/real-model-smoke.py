#!/usr/bin/env python3
"""Reproduce the real local-LLM smoke test recorded in REAL_MODEL_TEST_REPORT.md.

Prereqs: a GGUF from js/recommended-models.js and a llama.cpp CLI binary
(https://github.com/ggml-org/llama.cpp/releases). No Python deps needed.

  python3 tools/real-model-smoke.py --model-file /path/model.gguf \
      --llama-cli /path/llama-cli --json /tmp/smoke.json
"""
import argparse, json, os, re, subprocess, sys, time, urllib.request

SAMPLES = [
    {"id": "S1", "kind": "English fact", "input": "What is the capital of France? Answer in one short sentence.", "system": "You are a helpful assistant."},
    {"id": "S2", "kind": "Code generation", "input": "Write a Python function add(a, b) that returns their sum. Output code only.", "system": "You are a helpful assistant."},
    {"id": "S3", "kind": "Chinese", "input": "用一句话介绍你自己。", "system": "你是一个乐于助人的中文助手。"},
    {"id": "S4", "kind": "Simple reasoning", "input": "If all cats are animals and Tom is a cat, is Tom an animal? Answer yes or no.", "system": "You are a helpful assistant."},
]

def chatml(user, system):
    return f"<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-file", required=True)
    ap.add_argument("--llama-cli", required=True)
    ap.add_argument("--download-url", default="")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--tokens", type=int, default=64)
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    path = args.model_file
    if not os.path.exists(path) and args.download_url:
        print("downloading", args.download_url, file=sys.stderr)
        urllib.request.urlretrieve(args.download_url, path)
    if not os.path.exists(path):
        raise SystemExit("model file missing: " + path)
    with open(path, "rb") as f:
        if f.read(4) != b"GGUF":
            raise SystemExit("not a GGUF file")

    results = []
    for s in SAMPLES:
        t0 = time.time()
        proc = subprocess.run(
            [args.llama_cli, "-m", path, "-p", chatml(s["input"], s["system"]),
             "-n", str(args.tokens), "--temp", "0.2", "--top-p", "0.9",
             "-t", str(args.threads), "-st", "--no-warmup", "--no-display-prompt"],
            capture_output=True, text=True, timeout=300,
        )
        m = re.search(r"<\|im_start\|>assistant\s*\n(.*?)(?:\n\s*\[ Prompt:|\Z)", proc.stdout, re.S)
        answer = (m.group(1) if m else "").strip().split("\n[ Prompt:")[0].strip()
        perf = re.search(r"\[ Prompt: ([\d.]+) t/s \| Generation: ([\d.]+) t/s \]", proc.stdout)
        r = {**s, "output": answer, "exit": proc.returncode,
             "seconds": round(time.time() - t0, 2),
             "prompt_tps": perf.group(1) if perf else None,
             "gen_tps": perf.group(2) if perf else None}
        results.append(r)
        print(f"--- {r['id']} {r['kind']} ({r['seconds']}s) ---\nQ: {r['input']}\nA: {r['output']}")
        if not answer or proc.returncode != 0:
            print("FAILED", file=sys.stderr)
    blob = json.dumps(results, ensure_ascii=False, indent=2)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            f.write(blob)
    print("all samples produced non-empty output:", all(r["output"] and r["exit"] == 0 for r in results))
    return 0 if all(r["output"] and r["exit"] == 0 for r in results) else 1

if __name__ == "__main__":
    raise SystemExit(main())
