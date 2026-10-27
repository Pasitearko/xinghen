# 星痕

Linux 版的飞星。只在自己电脑上运行的日记与生活空间：一个 Node 进程同时提供网页和接口，数据全部留在本机，开机（登录）后自动在后台待命，打开浏览器就能写。

- **首页**：问候、时钟、农历与节气、今天写了多少、日历、那年今日、每日焦点资讯
- **日记**：只有今天可写，过去的日子自动封存只读；自动保存，断电、关标签页都不丢稿；写的时候粗体、斜体、引用、标题、待办和图片直接显示效果（存下来仍是 Markdown）；写不出来时有 168 道灵感题可以换着问自己
- **品味库**：收藏链接、作品和一闪而过的想法，带图、标签、分类
- **自习室**：番茄钟、待办、今日日程，专注记录按天统计
- **档案室**：一年的书写热力图、心情与天气统计、全部日记、专注趋势、备份与导入
- **本地音乐**：读取音乐文件夹，支持内嵌封面、同名 `.lrc` 歌词（含双语）、键盘媒体键

## 需要什么

- Node.js **23.6 或更新**（直接运行 TypeScript，并用内置的 `node:sqlite`，不需要编译任何原生模块）
- pnpm（推荐）或 npm，只在第一次安装依赖时联网
- 任意现代浏览器（Chromium / Firefox）

```bash
# Arch / CachyOS
sudo pacman -S nodejs pnpm
```

## 启动

```bash
cd 飞星所在的目录
./feixing
```

第一次运行会自动安装依赖、构建网页、在后台启动服务并打开浏览器，地址是 <http://127.0.0.1:8001>。之后再运行 `./feixing` 只会打开浏览器。

| 命令 | 作用 |
| --- | --- |
| `./feixing` | 没启动就启动，然后打开浏览器 |
| `./feixing start` / `stop` / `restart` | 后台启动、停止、重启 |
| `./feixing status` | 是否在运行，数据、音乐、备份各放在哪 |
| `./feixing logs` | 查看日志 |
| `./feixing build` | 重新构建网页（改了源码后 `start` 也会自动构建） |
| `./feixing import <路径>` | 导入旧数据，加 `--dry` 只预览不写入 |
| `./feixing install` | 登录后自动启动，并加到应用菜单 |
| `./feixing uninstall` | 取消自动启动（不删数据） |
| `./feixing dev` | 开发模式，Vite 热更新在 <http://127.0.0.1:5199> |

### 开机自动启动

```bash
./feixing install
```

这会写入一个 systemd 用户服务（`~/.config/systemd/user/feixing.service`）和一个应用菜单图标（`~/.local/share/applications/feixing.desktop`）。服务只监听 `127.0.0.1`，局域网里的其他设备访问不到；空闲时几乎不占 CPU。日志用 `journalctl --user -u feixing -f` 查看。

## 从 Windows 版迁移

两种方式都是**合并导入**：已经有的不会重复，也不会覆盖，可以放心多导几次。

1. **备份 zip（推荐）**：在旧版飞星的「档案室 → 网站记录与备份」导出完整备份，把 zip 拷到这台电脑，在新版「档案室 → 备份 → 导入与迁移」里选择文件，先看预览再确认。
2. **整个数据文件夹**：把 Windows 上的 `%LOCALAPPDATA%\Feixing` 整个拷过来（里面有 `feixing.db` 和 `uploads/`），然后：

   ```bash
   ./feixing import ~/下载/Feixing --dry   # 先预览
   ./feixing import ~/下载/Feixing
   ```

更早的 JSON 导出也能导入，里面内联的 base64 图片会落成本机文件。

## 数据放在哪

遵循 XDG 规范，代码目录里不存任何私人数据：

```
~/.local/share/feixing/
├── feixing.db        日记、收藏、自习、资料（SQLite）
├── uploads/          图片附件
├── backups/          自动备份（每天一份，保留最近 7 份）和手动导出
├── music/            默认的音乐文件夹
└── music-index.json  曲库索引（删掉也没关系，下次会重新扫）
```

想整体搬家，停掉服务后拷走这个文件夹就行。备份 zip 里是完整数据加全部图片，可以直接在另一台电脑导入。

## 音乐

把音乐放进 `~/.local/share/feixing/music/`，或者在配置里把 `FEIXING_MUSIC_DIR` 指向已有的音乐目录（比如 `~/Music`），然后在播放器的歌单里点「重新扫描」。

扫描结果存成索引，切歌、取封面和歌词都直接查索引；扫描在后台进行，只重新读新增或改过的文件，曲库再大也不会拖慢写日记。每次启动后第一次打开播放器时会在后台自动核对一遍。

- 支持 mp3、flac、m4a、ogg、opus、wav
- 标题、歌手、封面优先读取文件内嵌的标签（ID3v2 / FLAC），没有标签就按文件名「歌手 - 曲名」猜
- 同名 `.lrc` 文件作为歌词，原文和翻译分两行或同一时间戳都能识别；UTF-8、UTF-16、GBK 编码都行
- 封面依次找：内嵌封面、同名图片、文件夹里的 `cover.jpg` / `folder.jpg`
- 键盘媒体键和桌面的媒体控件（MPRIS）可以控制播放

## 每日焦点

首页只追 **Anthropic、OpenAI、DeepSeek** 的模型发布、模型升级，**Codex、Claude、DeepSeek** 的产品与版本动态，以及三家官网原文动态。三家各占一列；联合事件可同时关联多家，相关栏目引用同一个事件。

- 只显示**最近 24 小时**发布的内容，每 3 小时自动更新一次（开机时如果离上次更新超过 3 小时也会更新）；超过 36 小时的条目直接删除，不留历史
- 官网原文动态保留；媒体、社区和聚合只收模型发布/升级及指定产品与版本动态，排除融资、人物访谈、评测、教程和传闻。旧缓存也按新规则过滤
- 同一事件合并多条报道，优先展示官方原文，可展开查看相关报道；同一模型的首发、后续升级和不同版本分别判断，不因模型名相同就合并。更新日志的不同锚点分别保留，Codex 订阅和 GitHub 的同一版本合并
- 每列按热度排：报道越多越靠前，官方发布再加一档，随最新一条报道的时间慢慢降温；每列最多 12 条
- 只写了日期没写时刻的官方文章（OpenAI 的 RSS 就是这样），按本机第一次看到的时间算，不会因为被当成当天 0 点而漏掉
- 在「设置 → 资讯来源」里可以单独开关每个来源

| 分类 | 来源 |
| --- | --- |
| 官方 | OpenAI News 与 API 日志、Codex 官方更新与 GitHub Releases、Anthropic News、Claude 产品日志与官网文章、Claude Platform RSS、Claude Code Releases、DeepSeek 官网与 API 日志、Hugging Face 上 deepseek-ai 和 openai 发布的新模型 |
| 媒体 | 量子位、雷峰网、爱范儿、IT之家、cnBeta、InfoQ 中文、The Verge、TechCrunch、The Decoder |
| 社区 | Hacker News（80 分以上）、Simon Willison |
| 聚合 | Google 新闻按公司名搜索最近一天的报道（三个搜索，分别对应三家） |

需要代理才能访问的话，在配置文件里写上 `HTTPS_PROXY`（启动器检测到代理变量会自动让 Node 走代理）。

## 配置

`./feixing install` 会生成 `~/.config/feixing/env`，也可以自己创建。每行一个 `KEY=VALUE`，改完运行 `./feixing restart`：

```ini
FEIXING_PORT=8001                    # 端口
FEIXING_MUSIC_DIR=/home/你/Music      # 音乐目录
FEIXING_DATA_DIR=/home/你/.local/share/feixing
FEIXING_TZ=Asia/Shanghai             # 「今天」按哪个时区算，默认跟随系统
HTTPS_PROXY=http://127.0.0.1:7890    # 抓资讯用的代理
```

## 和 Windows 版相比

- **技术栈**：去掉了 Python 后端，改成一个 Node 进程（内置 SQLite + 原生 HTTP），不需要虚拟环境，没有原生依赖。前端是 React 19 + Vite + Motion。
- **为大屏重新排版**：主要按 2560 宽的显示器设计，首页一屏放下时钟、今天、日历和三列资讯；日记是「篇目与灵感题 / 信纸 / 页边」三栏书桌；窄屏和手机上自动收成单栏。
- **加载更快**：每个页面按需加载，鼠标悬停在导航上时会预先加载；静态文件预压缩成 Brotli / Gzip 放在内存里；图片上传前在浏览器里压缩，收藏的网格只加载 720px 的缩略图。
- **更稳**：保存带版本号，两个标签页同时编辑不会互相覆盖；草稿在本地另存一份，关页面时最后一次保存会补发。
- **更安全**：只接受本机来源的写请求，其他网站没法偷偷调用接口。

## 开发

```bash
pnpm install
pnpm dev        # 后端 8001 + Vite 5199
pnpm check      # TypeScript 类型检查
pnpm test       # 导入与备份的测试
```

目录结构：`server/` 是后端（`routes/` 下每个文件对应一组接口），`web/src/` 是前端（`pages/` 页面，`components/` 公共组件，`lib/` 状态与工具）。

## 致谢

- 动效参考了 [React Bits](https://github.com/DavidHDev/react-bits)（MIT）和 [starc007/ui-components](https://github.com/starc007/ui-components) 的思路：滑动选项卡、数字滚动、弹性勾选、共享元素展开、聚光灯悬停等，均按飞星的风格重写。
- 西文与数字用 [Source Serif 4](https://github.com/adobe-fonts/source-serif)（SIL OFL 1.1，许可见 `web/src/styles/fonts/`），中文用系统里的思源宋体（Noto Serif CJK），两者是同一家族的姊妹字体。
- 图标来自 [Lucide](https://lucide.dev)（ISC），动画库是 [Motion](https://motion.dev)（MIT），日记编辑器基于 [CodeMirror 6](https://codemirror.net)（MIT）。
- `web/wallpapers/` 里的壁纸沿用自 Windows 版，收集自网络，版权归原作者所有，仅作个人非商业使用。如果其中有你的作品且不希望出现在这里，请发邮件到 jiuliyearli@gmail.com 或提 Issue，确认后会尽快删除。
