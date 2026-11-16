# Versions and DeepSeek Harness compatibility

Each DSH-SLOP release supports exactly one DeepSeek Harness release. That version is declared in `packages/bundle/package.json` as `engines.dsh`, and Harness refuses to install the plugin on any other version. Check the running version with `dsh --version`, or in the desktop App's About dialog.

| DSH-SLOP | DeepSeek Harness | Harness tag and commit | Plugin archive |
| --- | --- | --- | --- |
| [v0.0.17](https://github.com/demsheng/dsh-slop/releases/tag/v0.0.17) | **0.2.2-rc.3** | `dsh-v0.2.2-rc.3`, `38a6a5c965aa99ab525161efb7cc5cf1fe62fced` | `dsh-slop-0.0.17.tgz` |
| [v0.0.16](https://github.com/demsheng/dsh-slop/releases/tag/v0.0.16) | **0.2.1-rc.5** | `dsh-v0.2.1-rc.5`, `b830ec950faba0a46dda564be3e2d854afed94f1` | `dsh-slop-0.0.16.tgz` |

## Download the matching Harness version

**Desktop App.** The desktop App installs and updates itself. Download it from the official page, then confirm its version before installing DSH-SLOP:

- https://www.deepseek.com/download/

**Command-line installation.** The pinned version is published on npm, and npm can install exactly that version:

```sh
dsh --version
npm install --global @deepseek-ai/dsh@0.2.2-rc.3   # v0.0.17
npm install --global @deepseek-ai/dsh@0.2.1-rc.5   # v0.0.16
```

| Harness | npm package | Registry tarball | Source |
| --- | --- | --- | --- |
| 0.2.2-rc.3 | [npm view](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.2.2-rc.3) | [tarball](https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.2-rc.3.tgz) | [dsh-v0.2.2-rc.3](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.3) |
| 0.2.1-rc.5 | [npm view](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.2.1-rc.5) | [tarball](https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.5.tgz) | [dsh-v0.2.1-rc.5](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.5) |

The `.tgz` works as the plugin archive's standalone runtime dependency pin, but the supported route to run Harness is the desktop App or the npm CLI on that exact version. The plugin archive is not published on npm; install it from the matching DSH-SLOP release.

## 中文

每个 DSH-SLOP 版本只对应一个 DeepSeek Harness 版本，写在 `packages/bundle/package.json` 的 `engines.dsh` 里，版本不一致时 Harness 会拒绝安装。用 `dsh --version` 或桌面 App 的「关于」确认当前版本。

| DSH-SLOP | DeepSeek Harness | Harness 标签与提交 | 插件安装包 |
| --- | --- | --- | --- |
| [v0.0.17](https://github.com/demsheng/dsh-slop/releases/tag/v0.0.17) | **0.2.2-rc.3** | `dsh-v0.2.2-rc.3`，`38a6a5c965aa99ab525161efb7cc5cf1fe62fced` | `dsh-slop-0.0.17.tgz` |
| [v0.0.16](https://github.com/demsheng/dsh-slop/releases/tag/v0.0.16) | **0.2.1-rc.5** | `dsh-v0.2.1-rc.5`，`b830ec950faba0a46dda564be3e2d854afed94f1` | `dsh-slop-0.0.16.tgz` |

**下载对应版本的 Harness：**

- 桌面端：https://www.deepseek.com/download/ （安装包始终是最新版，安装后在 App 里确认版本）
- 命令行：

```sh
dsh --version
npm install --global @deepseek-ai/dsh@0.2.2-rc.3   # v0.0.17
npm install --global @deepseek-ai/dsh@0.2.1-rc.5   # v0.0.16
```

| Harness | npm 页面 | registry 包 | 源码 |
| --- | --- | --- | --- |
| 0.2.2-rc.3 | [npm](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.2.2-rc.3) | [tarball](https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.2-rc.3.tgz) | [dsh-v0.2.2-rc.3](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.3) |
| 0.2.1-rc.5 | [npm](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.2.1-rc.5) | [tarball](https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.5.tgz) | [dsh-v0.2.1-rc.5](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.5) |

插件包没有发布到 npm，请从对应版本的 DSH-SLOP Release 下载。
