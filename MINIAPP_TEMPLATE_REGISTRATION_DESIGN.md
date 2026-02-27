## 背景与目标

- **背景**：`@ice/plugin-miniapp` 在构建时会内置注入一批小程序原生组件模板（如 `button`、`open-data`、`live-player` 等），即使业务未使用，也会出现在产物 `base.wxml` 中。
- **问题**：小程序审核的静态扫描会基于这些模板代码判断“存在隐私能力”，导致隐私合规风险（如手机号获取、隐私授权等）。
- **目标**：
  - 提供一套**可配置**的组件 / 属性过滤能力，允许业务按需关闭某些原生组件能力。
  - **不破坏**现有运行时渲染逻辑，尽量只在模板输出层做“无感清洗”。
  - 支持通过 `patch-package` 复用到其他项目。

---

## 总体方案概览

- **配置层**：在业务项目的 `miniapp()` 插件配置中，提供 `templateRegistration` 配置。
- **传递链路**：
  - `ice.config.mts` → `miniapp()` → `@ice/plugin-miniapp/esm/index.js`
  - → `miniapp/index.js` → `miniapp/webpack/combination.js`
  - → `MiniPlugin` 构造函数 → `MiniPlugin.generateTemplateFile`
- **实现层**：
  - 保持 `@ice/shared` 中 `internalComponents` 与模板生成逻辑**原样不动**。
  - 只在生成 `base.wxml` 的 `generateTemplateFile` 中，基于 `templateRegistration` 对模板字符串做**纯文本清洗**：
    - 删除指定组件标签（如 `open-data`、`official-account` 等），替换为 `<block></block>`。
    - 删除指定组件上的敏感属性（如 `button` 上的 `bindGetPhoneNumber` 等）。

---

## 配置设计：templateRegistration

### 配置位置

`ice.config.mts`：

```ts
import { defineConfig } from '@ice/app';
import miniapp from '@ice/plugin-miniapp';

export default defineConfig(() => ({
  plugins: [
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
    }),
  ],
}));
```

### 字段含义

- **`excludeComponents: string[]`**
  - 目标：整块替换组件标签（包括内容），规避高风险能力。
  - 值示例：`['open-data', 'official-account', 'ad', 'ad-custom', 'live-player', 'live-pusher']`
  - 在模板中匹配：
    - `<open-data ...>...</open-data>` → `<block></block>`
    - `<ad ... />` → `<block></block>`

- **`componentProps: Record<string, { exclude?: string[]; include?: string[] }>`**
  - 目标：按组件精细裁剪属性 / 事件。
  - 当前主要用到：
    - 对 `button` 组件去掉隐私相关事件与参数。
  - 匹配规则：
    - 对应组件名（`button`）与属性名（如 `bindGetPhoneNumber`）都做“归一化”：
      - 统一为小写，去掉非字母数字字符，如：`bindGetPhoneNumber` → `bindgetphonenumber`。
    - 模板里的属性名（如 `bindgetphonenumber`）统一归一化后做对比，命中则删除该属性。

---

## 实现细节：插件链路改造

### 1. 插件入口：`esm/index.js`

**修改目标**：从业务层读取 `templateRegistration` 并向下透传。

- 变更点：
  - 在 `miniappOptions` 解构中加入：
    - `const { nativeConfig = {}, templateRegistration = {} } = miniappOptions;`
  - 在调用 `getMiniappTask` 时，新增参数：
    - `templateRegistration`

### 2. 任务创建：`esm/miniapp/index.js`

**修改目标**：将 `templateRegistration` 继续传入 webpack Mini 组合配置。

- 在 `getMiniappTask` 里调用 `getMiniappWebpackConfig` 时：

```ts
const { plugins, module } = getMiniappWebpackConfig({
  rootDir,
  template,
  fileType,
  configAPI,
  projectConfigJson,
  nativeConfig,
  modifyBuildAssets,
  templateRegistration, // 新增
});
```

### 3. 组合配置：`esm/miniapp/webpack/combination.js`

**修改目标**：把 `templateRegistration` 写入 `MiniCombination.config`。

```ts
this.config = {
  sourceRoot: this.sourceRoot,
  fileType: rawConfig.fileType,
  env: rawConfig.env,
  template: rawConfig.template,
  templateRegistration: rawConfig.templateRegistration, // 新增
  modifyBuildAssets: rawConfig.modifyBuildAssets,
  ...
};
```

### 4. MiniPlugin 构造：`esm/miniapp/webpack/plugins/MiniPlugin.js`

**修改目标**：把 `templateRegistration` 存入 `this.options`，供后续使用。

```ts
this.options = {
  sourceDir: combination.sourceDir,
  framework: miniBuildConfig.framework || 'react',
  ...
  loaderMeta: options.loaderMeta || {},
  templateRegistration: miniBuildConfig.templateRegistration || {}, // 新增
};
```

---

## 模板清洗逻辑：MiniPlugin.generateTemplateFile

### 1. 入口拦截点

原始逻辑：

```ts
generateTemplateFile(compilation, compiler, filePath, templateFn, ...options) {
  const { RawSource } = compiler.webpack.sources;
  let templStr = templateFn(...options);
  const fileTemplName = this.getTemplatePath(this.getComponentName(filePath));
  ...
  compilation.assets[fileTemplName] = new RawSource(templStr);
}
```

新增逻辑：

- 仅对 `base` 模板文件执行清洗：

```ts
const fileTemplName = this.getTemplatePath(this.getComponentName(filePath));
if (this.isBaseTemplate(fileTemplName)) {
  templStr = this.applyTemplateRegistration(templStr);
}
```

### 2. 判断是否 base 模板

```ts
isBaseTemplate(fileTemplName) {
  const templExt = this.options.fileType.templ; // .wxml / .axml 等
  return new RegExp(`(^|/)base\\${templExt}$`).test(fileTemplName);
}
```

### 3. 组件名 / 属性名归一化

```ts
normalizeTemplateComponentName(name = '') {
  // fooBar → foo-bar → foobar（在 tag 层只做小写 + 中划线）
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

normalizeTemplatePropName(name = '') {
  // bindGetPhoneNumber / bindgetphonenumber / bind-get-phone-number → bindgetphonenumber
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}
```

### 4. 清洗逻辑：applyTemplateRegistration

```ts
applyTemplateRegistration(templStr) {
  const { templateRegistration = {} } = this.options;
  const excludedComponents = (templateRegistration.excludeComponents || [])
    .map((name) => this.normalizeTemplateComponentName(name));
  const componentProps = templateRegistration.componentProps || {};

  let nextTemplate = templStr;

  // 1. 删除整块组件标签
  excludedComponents.forEach((componentName) => {
    const tag = this.escapeRegExp(componentName);
    nextTemplate = nextTemplate.replace(
      new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'gi'),
      '<block></block>',
    );
    nextTemplate = nextTemplate.replace(
      new RegExp(`<${tag}(\\s[^>]*)?\\/>`, 'gi'),
      '<block></block>',
    );
  });

  // 2. 删除指定组件上的敏感属性
  Object.entries(componentProps).forEach(([componentName, rule]) => {
    const excludes = (rule?.exclude) || [];
    if (!excludes.length) return;

    const normalizedName = this.normalizeTemplateComponentName(componentName);
    const tag = this.escapeRegExp(normalizedName);
    const excludeSet = new Set(
      excludes.map((propName) => this.normalizeTemplatePropName(propName)),
    );

    nextTemplate = nextTemplate.replace(
      new RegExp(`<${tag}\\b([^>]*)>`, 'gi'),
      (_full, attrs) => {
        let nextAttrs = attrs || '';

        // 按属性维度匹配并删除敏感属性
        nextAttrs = nextAttrs.replace(
          /\s([:@\w-]+)="[^"]*"/gi,
          (attrFull, attrName) => {
            const normalizedAttrName = this.normalizeTemplatePropName(attrName);
            if (excludeSet.has(normalizedAttrName)) {
              return '';
            }
            return attrFull;
          },
        );

        return `<${normalizedName}${nextAttrs}>`;
      },
    );
  });

  return nextTemplate;
}
```

### 5. 安全边界与兼容性

- **不改动**：
  - `@ice/shared` 内置组件定义（`internalComponents`）；
  - `BaseTemplate` / `UnRecursiveTemplate` 的模板生成流程；
  - 小程序运行时 / React 渲染逻辑。
- **仅改动**：
  - `base.wxml` 的最终输出文本内容。
- 若不配置 `templateRegistration`：
  - 整个清洗逻辑不生效，保持原行为。

---

## 隐私扫描验证点

当前方案构建后，`build/base.wxml` 中应**不再出现**：

- 能力事件 / 属性：
  - `bindgetphonenumber`
  - `bindagreeprivacyauthorization`
  - `bindgetuserinfo`
  - `bindgetrealtimephonenumber`
  - `bindcontact`
  - `bindopensetting`
  - `bindlaunchapp`
  - `app-parameter`
- 高风险组件：
  - `open-data`
  - `official-account`
  - `live-player`
  - `live-pusher`
  - `ad`
  - `ad-custom`

建议在 CI 中增加关键词扫描，命中即失败，以防后续依赖升级带来回归。

---

## 与现有项目的关系

- 当前项目：
  - 已通过 `patch-package` 对 `@ice/plugin-miniapp@1.2.7` 打补丁。
  - 补丁文件：`patches/@ice+plugin-miniapp+1.2.7.patch`。
  - 迁移说明：`MINIAPP_PATCH_MIGRATION.md`。
- 新项目：
  - 建议复用同一个补丁文件与 `templateRegistration` 配置，或按此设计文档重新实现兼容版本。

