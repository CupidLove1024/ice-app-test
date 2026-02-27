# miniapp 隐私组件过滤方案迁移说明

本文档用于把当前项目的 `@ice/plugin-miniapp` 隐私合规过滤方案迁移到新项目。

## 一、迁移目标

将以下内容迁移到新项目：

- `patches/@ice+plugin-miniapp+1.2.7.patch`
- `package.json` 中的 `patch-package` 依赖与 `postinstall` 脚本
- `ice.config.mts` 中 `miniapp({ templateRegistration: ... })` 配置

## 二、迁移步骤

### 1. 检查新项目的插件版本

确认新项目 `@ice/plugin-miniapp` 版本，优先与当前方案一致（`1.2.7`）。

- 版本一致：可直接复用 patch 文件
- 版本不一致：可先尝试应用；失败则按“版本不一致处理”重生 patch

### 2. 拷贝 patch 文件

将当前项目的 patch 文件复制到新项目根目录：

- `patches/@ice+plugin-miniapp+1.2.7.patch`

如果新项目没有 `patches` 目录，请先创建。

### 3. 安装 patch-package 并配置自动执行

在新项目执行：

```bash
npm i -D patch-package
```

确保 `package.json` 存在以下配置：

```json
{
  "scripts": {
    "postinstall": "patch-package"
  }
}
```

### 4. 同步 miniapp 配置

将以下配置迁移到新项目 `ice.config.mts`（按需调整）：

```ts
miniapp({
  templateRegistration: {
    excludeComponents: [
      'open-data',
      'official-account',
      'ad',
      'ad-custom',
      'live-player',
      'live-pusher',
    ],
    componentProps: {
      button: {
        exclude: [
          'bindGetUserInfo',
          'bindGetPhoneNumber',
          'bindGetRealTimePhoneNumber',
          'bindAgreePrivacyAuthorization',
          'bindContact',
          'bindOpenSetting',
          'bindLaunchApp',
          'app-parameter',
        ],
      },
    },
  },
})
```

### 5. 安装依赖并应用补丁

执行：

```bash
npm install
```

由于配置了 `postinstall`，安装后会自动执行 `patch-package` 并应用补丁。

### 6. 构建验证

执行：

```bash
npm run build:wechat
```

检查 `build/base.wxml` 中是否仍包含敏感关键字（应无匹配）：

- `bindgetphonenumber`
- `bindagreeprivacyauthorization`
- `open-data`
- `official-account`
- `live-player`
- `live-pusher`

---

## 三、版本不一致处理（补丁应用失败时）

如果新项目不是 `@ice/plugin-miniapp@1.2.7`，且应用 patch 失败，按以下流程重生补丁：

1. 手工修改新项目 `node_modules/@ice/plugin-miniapp`（与当前方案相同改法）。
2. 执行：

```bash
npx patch-package @ice/plugin-miniapp
```

3. 生成新的版本补丁文件（例如 `@ice+plugin-miniapp+1.2.8.patch`）。
4. 提交 `patches/` 目录与 `package.json` 的 `postinstall` 配置。

---

## 四、建议增加 CI 门禁（可选但推荐）

在 CI 构建后增加关键字扫描，命中即失败，防止后续升级引入回归。

可扫描文件：

- `build/base.wxml`

建议规则：

- 出现隐私高风险关键字即失败并提示修改 `templateRegistration` 配置或更新补丁。

