#  Timezone
# 🛡️ Loon 防指纹与环境伪装系统

> **版本:** Level 11 (异步阻塞核弹版)  
> **平台:** 专为 iOS [Loon](https://nsloon.app/) 深度定制  
> **作者:** WilsonBryanz  
> **作用目标:** 彻底击穿 Web 端高级风控 (如 Claude, OpenAI, Whoer, ippure 等)，实现 100% 落地 IP 物理环境对齐。

---

## 📑 1. 项目背景与作用说明

在高级出海网络环境中，传统的“改 IP”已无法应对顶级科技公司（如 Anthropic, OpenAI, Meta）的浏览器风控审查。风控探针会深入读取浏览器的底层时区 (`Date/Intl`)、系统语言 (`navigator.language`) 甚至硬件特征。

本项目旨在通过 **网络层 MitM (中间人解密)** 与 **DOM 底层注入 (JavaScript 劫持)** 相结合的方式，在流量到达浏览器之前，将目标网页的代码进行“换血”，从而向风控系统输出与当前代理节点完全一致的完美伪装环境。

## 🎯 2. 核心防御机制 (Features)

SRE级别的高强度实战对抗迭代，攻克了以下底层难题：

- **⚡️ QUIC 强制降级引擎**:  
  利用 `REJECT-NO-DROP` 规则精准阻断 Google/Meta/Cloudflare 的 UDP 443 流量，强制浏览器回退至传统的 TCP (HTTP/2) 隧道，确保 MitM 解密和脚本注入 100% 触发，防止流量逃逸。
- **🕵️ 动态感知探针 (跨过 ATS 封锁)**:  
  采用 `ipinfo.io` 纯 HTTPS 接口作为异步探针，完美绕过 iOS ATS (App Transport Security) 拦截。无论节点如何切换，均能在毫秒级获取最新的出口 IP 时区与国家代码。
- **🧬 深度原型链劫持 (防沙盒逃逸)**:
  - 重写 `Date` 与 `Intl.DateTimeFormat`，动态计算夏令时 (DST) 的精准偏移量。
  - 锁定 `hardwareConcurrency` (CPU 核数) 与 `deviceMemory`，防止异构硬件指纹追踪。
  - 拦截 `Node.prototype.appendChild`，在目标网站动态创建 `iframe` 的毫秒瞬间同步注入伪装，彻底封死沙盒逃逸探针。
- **💥 强制缓存击穿 (Cache-Busting)**:  
  在 HTTP 响应头强制注入 `Cache-Control: no-store, no-cache, max-age=0`，并擦除 `ETag`。彻底粉碎 Safari 顽固的本地/内存幽灵缓存，确保节点切换后刷新必生效。
- **🔒 严格异步死锁控制**:  
  严格遵守 Loon 官方 API 规范，通过回调闭包强制阻塞网络流，确保在获得 IP 探测结果后才调用 `$done()`，杜绝内核误杀探针导致的死锁。

## 🏛️ 3. 架构哲学：双引擎战略与边界隔离

在高级代理架构中，**原生 App 与 Web 网页的风控逻辑截然不同**，本系统严格遵循“分层处理”策略：

1. **针对 Web 网页端 & PWA 应用 (本项目的核心)**：
   - **对象**：浏览器访问的 Claude, ChatGPT, Whoer 等，以及通过 Safari “添加到主屏幕”的 PWA 应用。
   - **策略**：正面强攻。开启 `MitM` 证书解密，利用 `Timezone_Smart.js` 暴力修改 DOM 和底层 JS 环境。
2. **针对 Native 原生 App (隔离区)**：
   - **对象**：TikTok, Google 系 App, 银行 App 等带有严苛 **SSL 证书锁定 (SSL Pinning)** 的原生客户端。
   - **策略**：底层潜行。**绝对不将其加入 `[Mitm]` 白名单**（否则必断网报错）。针对 TikTok 等应用，采用独立的 API 参数重写脚本（如 `TikTok_Switcher.js` 仅修改 `mcc_mnc` 等 URL 参数），与本系统物理隔离。

## 🚀 4. 部署与使用指南

### 文件依赖

- `Timezone.ipx`: Loon 插件配置文件 (负责 QUIC 阻断、请求拦截与 MitM 白名单路由)。
- `Timezone_Smart.js`: 核心环境注入脚本。

### 必做操作：如何正确切换节点与测试

由于采用了防崩溃的惰性缓存 (Cache-Aside) 机制，测试时必须严格遵&#x5B88;**“双重刷新”**&#x534F;议：

1. 在代理工具中切换国家节点（例如：从美国切至韩国）。
2. **第一刷新 (触发侦测)**：打开 Safari 访问测试网站（此时网页可能依然显示旧节点环境，后台探针正在极速获取韩国 IP 数据）。
3. **第二刷新 (完美加载)**：等待 2-3 秒后，手动下拉刷新网页。新环境加载完毕，时区与语言瞬间完成物理级伪装对齐。

> **⚠️ SRE 终极排障提醒**:  
> 如果发现测试站 (如 `ippure.com`) 漏网，请务必检查该域名是否已同时添加至 `Timezone.ipx` 的 **`[Script]` 正则表达式** 与底部的 **`[Mitm] hostname`** 列表中。未加 MitM 的域名将直接裸奔。
