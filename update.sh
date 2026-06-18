#!/bin/bash
# ============================================================
# function-graph-master 一键更新部署脚本
# 用法: ./update.sh [commit信息]
# ============================================================

set -e  # 遇到错误立即退出

echo "========================================"
echo "  Function Graph Master - 更新部署"
echo "========================================"

# ---------- 1. 检查 Git 状态 ----------
echo "[1/5] 检查 Git 状态..."
if [ -n "$(git status --short)" ]; then
    echo "      发现未提交的更改"
    git add -A
    COMMIT_MSG="${1:-更新站点 $(date +%Y-%m-%d_%H:%M)}"
    git commit -m "$COMMIT_MSG"
    echo "      已提交: $COMMIT_MSG"
else
    echo "      没有未提交的更改"
fi

# ---------- 2. 推送到 GitHub ----------
echo "[2/5] 推送到 GitHub..."
if git push origin $(git branch --show-current) 2>/dev/null; then
    echo "      推送成功"
else
    echo "      推送失败（可能未配置 token，跳过）"
fi

# ---------- 3. 修复 esbuild 权限 ----------
echo "[3/5] 检查 esbuild..."
ESBUILD_PATH="node_modules/@esbuild/linux-x64/bin/esbuild"
if [ -f "$ESBUILD_PATH" ]; then
    # 复制到 /tmp 并赋予执行权限
    cp "$ESBUILD_PATH" /tmp/esbuild
    chmod +x /tmp/esbuild
    echo "      esbuild 已修复"
else
    echo "      错误: 找不到 esbuild，可能需要重新安装依赖"
    exit 1
fi

# ---------- 4. 构建 ----------
echo "[4/5] 开始构建..."
ESBUILD_BINARY_PATH=/tmp/esbuild npm run build
echo "      构建完成 ✓"

# ---------- 5. 完成 ----------
echo "[5/5] 构建成功！"
echo ""
echo "========================================"
echo "  dist/ 目录已准备好部署"
echo "========================================"
echo ""
echo "下一步: 用 deploy_website 工具部署 dist/ 目录"
echo ""
