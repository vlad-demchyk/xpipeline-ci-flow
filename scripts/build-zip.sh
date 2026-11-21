#!/bin/sh
# Builds dist/xpipeline-ci-flow-<version>.zip for Claude Desktop: Customize → Plugins → Add → Upload plugin.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
version=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$root/.claude-plugin/plugin.json','utf8')).version)")
out="$root/dist/xpipeline-ci-flow-$version.zip"
mkdir -p "$root/dist"
rm -f "$out"
cd "$root"
zip -qr "$out" .claude-plugin/plugin.json skills agents hooks templates scripts README.md LICENSE -x '*.DS_Store'
echo "$out"
