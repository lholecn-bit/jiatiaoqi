#!/usr/bin/env bash
# 兼容保护：本脚本使用 bash 特性，请用 bash 运行（勿用 sh 执行）
if [ -z "${BASH_VERSION:-}" ]; then
    echo "[error] 请用 bash 运行本脚本：bash $0（或直接执行 ./$(basename "$0")）" >&2
    exit 1
fi
# ============================================================
# 夹挑棋 · 发版脚本（在代码仓库/开发机上运行）
#
# 用法：
#   ./release.sh 1.2.0             # 升版 + 提交 + 推送远端
#   ./release.sh 1.2.0 --no-push   # 升版 + 提交，不推送
#   ./release.sh 1.2.0 --dry-run   # 仅预览将要修改的位置，不写文件
#
# 自动同步版本号的位置（同一版本号全部一致）：
#   index.html          APP_VERSION 常量（页面底部展示，权威源）
#   package.json        根 version
#   package-lock.json   根 + packages[""] version
#   README.md           版本章节「当前版本：**vX.Y.Z**」
#
# 提交后打印"服务器上线"提示；服务器侧请用配套的 update.sh。
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

NEW=""
PUSH=1
DRY=0

usage() {
    sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-push) PUSH=0; shift ;;
        --dry-run) DRY=1; shift ;;
        -h|--help) usage 0 ;;
        *)
            if [[ -z "$NEW" ]]; then NEW="$1"; shift
            else usage 1; fi
            ;;
    esac
done

if [[ -z "$NEW" ]]; then
    echo "[release] 缺少版本号，示例：./release.sh 1.2.0" >&2
    usage 1
fi
if [[ ! "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "[release] 版本号格式非法（应为 x.y.z）：$NEW" >&2
    exit 1
fi

OLD="$(grep -oP "APP_VERSION = '\K[0-9]+\.[0-9]+\.[0-9]+" index.html | head -1)"
if [[ -z "$OLD" ]]; then
    echo "[release] 无法从 index.html 读取当前 APP_VERSION" >&2
    exit 1
fi
if [[ "$OLD" == "$NEW" ]]; then
    echo "[release] 已是版本 $NEW，无需操作。" >&2
    exit 0
fi

echo "[release] 版本 $OLD -> $NEW"
if (( DRY )); then
    echo "[release] --dry-run：以下文件将被修改（未写入）："
    W=0 python3 - "$OLD" "$NEW" <<'PY'
import re, json, sys
old, new = sys.argv[1], sys.argv[2]
work = {
 'index.html':      lambda s: re.sub(r"(const APP_VERSION = ')[0-9.]+(')", rf"\g<1>{new}\g<2>", s, count=1),
 'package.json':    lambda s: re.sub(r'("version": ")[0-9.]+(")', rf"\g<1>{new}\g<2>", s, count=1),
 'package-lock.json': None,
 'README.md':       lambda s: re.sub(r'(\*\*v)[0-9.]+(\*\*)', rf"\g<1>{new}\g<2>", s, count=1),
}
for f, fn in work.items():
    s = open(f, encoding='utf-8').read()
    if fn:
        t = fn(s)
    else:
        d = json.loads(s); d['version'] = new; d['packages']['']['version'] = new
        t = json.dumps(d, ensure_ascii=False, indent=2) + '\n'
    print('  -', f, '（有改动）' if t != s else '（无变化）')
PY
    exit 0
fi

changed=0
W=1 python3 - "$OLD" "$NEW" <<'PY'
import re, json, sys
old, new = sys.argv[1], sys.argv[2]
changed = False
def apply(path, fn):
    global changed
    s = open(path, encoding='utf-8').read()
    t = fn(s)
    if t == s:
        print(f'  - {path}: 无变化（旧版本号不存在？）')
        return
    changed = True
    open(path, 'w', encoding='utf-8').write(t)
    print(f'  - {path}: {old} -> {new}')
apply('index.html', lambda s: re.sub(r"(const APP_VERSION = ')[0-9.]+(')", rf"\g<1>{new}\g<2>", s, count=1))
apply('package.json', lambda s: re.sub(r'("version": ")[0-9.]+(")', rf"\g<1>{new}\g<2>", s, count=1))
d = json.load(open('package-lock.json', encoding='utf-8'))
d['version'] = new
d['packages']['']['version'] = new
lock_new = json.dumps(d, ensure_ascii=False, indent=2) + '\n'
if lock_new != open('package-lock.json', encoding='utf-8').read():
    open('package-lock.json', 'w', encoding='utf-8').write(lock_new)
    print('  - package-lock.json:', old, '->', new)
    changed = True
else:
    print('  - package-lock.json: 无变化')
apply('README.md', lambda s: re.sub(r'(\*\*v)[0-9.]+(\*\*)', rf"\g<1>{new}\g<2>", s, count=1))
sys.exit(0 if changed else 1)
PY

git add index.html package.json package-lock.json README.md
if git diff --cached --quiet; then
    echo "[release] 版本号各处均为 $NEW 或无实际改动，未生成提交。"
    exit 0
fi

git commit -m "release: v$NEW"

if (( PUSH )); then
    branch="$(git branch --show-current)"
    if git remote get-url origin >/dev/null 2>&1; then
        if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
            git push 2>&1 | tail -2 || echo "[release] 推送失败，请手动 git push"
        else
            git push -u origin "$branch" 2>&1 | tail -2 || echo "[release] 推送失败，请手动 git push -u origin $branch"
        fi
    else
        echo "[release] 未配置远端 origin，跳过推送。"
    fi
else
    echo "[release] --no-push：已提交未推送。"
fi

echo
echo "[release] v$NEW 发布完成 ✅（提交未推/已推见上）"
echo "下一步（服务器上执行，一键上线）："
echo "  cd <服务器仓库目录> && ./update.sh"
echo "  若线上页面由 deploy 副本提供（如 nginx root=/srv/jiatiaoqi）："
echo "  UPDATE_TO=/srv/jiatiaoqi ./update.sh"
