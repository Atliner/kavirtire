#!/usr/bin/env bash
# ساخت بسته‌ی نصب افزونه برای کروم
# استفاده:  bash tools/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="kavirtire-fastbuy"
VER=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
OUT="dist"
mkdir -p "$OUT"
python3 tools/make_icons.py >/dev/null
rm -f "$OUT/$NAME-v$VER.zip" "$OUT/$NAME-latest.zip"

# فقط فایل‌های افزونه را بسته‌بندی کن (بدون فایل‌های تست)
(cd extension && zip -rq "../$OUT/$NAME-v$VER.zip" . -x '*.DS_Store' '*/.*')
cp "$OUT/$NAME-v$VER.zip" "$OUT/$NAME-latest.zip"

echo "✅ بسته ساخته شد: $OUT/$NAME-v$VER.zip"
ls -lh "$OUT"/*.zip | awk '{print "   " $9 " — " $5}'
