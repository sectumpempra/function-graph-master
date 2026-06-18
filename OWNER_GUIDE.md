# Owner 使用指南 - 快速更新部署

## 1. 首次配置（只做一次）

### 配置 GitHub Personal Access Token (PAT)

GitHub 已废弃密码验证，必须用 Token 推送。

**生成 Token:**
1. 打开 https://github.com/settings/tokens
2. 点击 "Generate new token (classic)"
3. 勾选权限: `repo` (完整仓库权限)
4. 生成后复制 token (以 `ghp_` 开头)

**配置到本地仓库:**
```bash
cd function-graph-master
git remote set-url origin https://sectumpempra:ghp_你的token@github.com/sectumpempra/function-graph-master.git
```

**验证配置:**
```bash
git push --dry-run
# 没有报错 = 配置成功
```

---

## 2. 日常更新流程

每次想更新网站时，按下面步骤来：

### 方式 A: 一键脚本（推荐）

```bash
cd function-graph-master

# 修改代码...
# 编辑 src/ 下的文件

# 运行更新脚本（自动提交+推送+构建）
./update.sh "你的提交说明"

# 脚本完成后，用 AI 的 deploy_website 工具部署 dist/ 目录
```

### 方式 B: 手动步骤

```bash
cd function-graph-master

# 1. 拉取最新代码
git pull

# 2. 修改代码...
# 编辑 src/ 下的文件

# 3. 提交更改
git add -A
git commit -m "描述这次修改"

# 4. 推送到 GitHub
git push

# 5. 构建
ESBUILD_BINARY_PATH=/tmp/esbuild npm run build

# 6. 部署 dist/ 目录（交给 AI 的 deploy_website 工具）
```

---

## 3. 环境注意事项

### npm install 超时问题

这个环境的 `npm install` 容易超时。**如果依赖没有变化，不要重新安装！**

- **依赖已安装** → 直接构建，不运行 `npm install`
- **需要新依赖** → 手动编辑 `package.json`，然后尝试 `npm install`，可能需要多次

### esbuild 权限问题

`update.sh` 脚本会自动处理。如果是手动操作：

```bash
# 每次新对话环境需要执行一次
cp node_modules/@esbuild/linux-x64/bin/esbuild /tmp/esbuild
chmod +x /tmp/esbuild

# 然后构建
ESBUILD_BINARY_PATH=/tmp/esbuild npm run build
```

---

## 4. 更新脚本说明

项目根目录下的 `update.sh` 会自动完成：

| 步骤 | 功能 |
|------|------|
| 1 | 检查并提交未保存的更改 |
| 2 | 推送到 GitHub（需配置 token） |
| 3 | 修复 esbuild 权限 |
| 4 | 运行 `npm run build` |
| 5 | 输出 dist/ 目录就绪提示 |

---

## 5. 常见问题

**Q: 提示 `Permission denied` 无法执行 update.sh?**
```bash
chmod +x update.sh
```

**Q: 推送失败 `Authentication failed`?**
- 检查 token 是否正确配置
- token 是否过期（GitHub 可设置有效期）
- 重新执行 `git remote set-url` 配置

**Q: 构建报错 `Cannot find module`?**
- node_modules 可能被清理了
- 需要重新 `npm install`（可能多次超时，需要耐心）

**Q: 只改了一个文件，也需要完整构建吗?**
- 是的，Vite 构建会处理所有文件
- 但 `npm install` 不需要重复执行

---

## 6. 快捷命令备忘

```bash
# 快速构建（最常用）
ESBUILD_BINARY_PATH=/tmp/esbuild npm run build

# 仅推送 GitHub（不改代码时）
git push

# 查看 Git 状态
git status

# 撤销所有未提交的更改
git checkout -- .
```
