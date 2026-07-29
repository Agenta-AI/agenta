
<p align="center">
  <a href="https://agenta.ai?utm_source=github&utm_medium=referral&utm_campaign=readme">
      <picture >
        <source width="275" media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/97e31bfc-b1fc-4d19-b443-5aedf6029017"  >
        <source width="275" media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/fdc5f23f-2095-4cfc-9511-14c6851c1262"  >
        <img alt="Agenta 徽标" src="https://github.com/user-attachments/assets/fdc5f23f-2095-4cfc-9511-14c6851c1262" >
      </picture>
  </a>
  
<div align="center">
  <strong> <h1> 用于构建和运行智能体的开源工作空间 </h1></strong>


<img width="1800" height="680" alt="agenta-github-banner" src="https://github.com/user-attachments/assets/afc83f8f-d644-4dc6-bae7-b26ed2512986" />

  ---


  通过对话构建能**自动完成工作**的智能体。把它们共享给**你的团队**，连接你日常使用的应用，并让它们在**后台**运行。

</div>

</div>


<h3 align="center">
  <a href="https://agenta.ai/docs/?utm_source=github&utm_medium=referral&utm_campaign=readme"><b>文档</b></a> &bull;
  <a href="https://agenta.ai?utm_source=github&utm_medium=referral&utm_campaign=readme"><b>官网</b></a> &bull;
  <a href="https://cloud.agenta.ai?utm_source=github&utm_medium=referral&utm_campaign=readme"><b>Agenta Cloud</b></a>
</h3>

<p align="center">
  <a href="./README.md"><img alt="README in English" src="https://img.shields.io/badge/English-d9d9d9"></a>
  <a href="./README.cn.md"><img alt="简体中文版自述文件" src="https://img.shields.io/badge/简体中文-d9d9d9"></a>
  <a href="./README.ja.md"><img alt="日本語のREADME" src="https://img.shields.io/badge/日本語-d9d9d9"></a>
  <a href="./README.kr.md"><img alt="README in Korean" src="https://img.shields.io/badge/한국어-d9d9d9"></a>
</p>

---

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license." />
  <a href="https://agenta.ai/docs/?utm_source=github&utm_medium=referral&utm_campaign=readme">
    <img src="https://img.shields.io/badge/Doc-online-green" alt="Doc">
  </a>
  <a href="https://github.com/Agenta-AI/agenta/blob/main/CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/PRs-Welcome-brightgreen" alt="PRs welcome" />
  </a>
  <a href="https://pypi.org/project/agenta/">
    <img src="https://img.shields.io/pypi/dm/agenta" alt="PyPI - Downloads">
  </a>
</br>
</p>

<p align="center">
    <a href="https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw">
        <img src="https://custom-icon-badges.demolab.com/badge/Slack-4A154B?logo=slack&logoColor=fff" alt="Join us on Slack" />
    </a>
    <a href="https://www.linkedin.com/company/agenta-ai/">
        <img src="https://custom-icon-badges.demolab.com/badge/LinkedIn-0A66C2?logo=linkedin-white&logoColor=fff" alt="Follow Agenta on LinkedIn" />
    </a>
    <a  href="https://twitter.com/agenta_ai">
        <img src="https://img.shields.io/twitter/follow/agenta_ai?style=social" height="28" alt="Follow @agenta_ai on X" />
    </a>
</p>

<p align="center">
  <a href="https://cloud.agenta.ai?utm_source=github&utm_medium=referral&utm_campaign=readme">
      <picture >
        <source width="200" media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/a2069e7b-c3e0-4a5e-9e41-8ddc4660d1f2"  >
        <source width="200" media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/a2069e7b-c3e0-4a5e-9e41-8ddc4660d1f2"  >
        <img alt="试用 Agenta 在线演示" src="https://github.com/user-attachments/assets/a2069e7b-c3e0-4a5e-9e41-8ddc4660d1f2" >
      </picture>
  </a>
</p>

---

## 什么是 Agenta？

Agenta 是一个开源工作空间，你可以在其中构建专门的智能体，用来自动化并增强你的工作。

你通过对话来构建智能体。你描述需要完成的工作，连接它们所需的应用，并通过反馈不断改进它们。

你可以在对话中直接与智能体协作，也可以把它们共享给你的团队。

对于重复性的工作，你可以构建后台智能体。这类智能体会定时运行，或在某个事件发生时触发运行。

## 为什么选择 Agenta？

### 使用你的 Claude 或 ChatGPT 订阅

当你自托管 Agenta 时，可以使用现有的 Claude 或 ChatGPT 订阅在本地运行智能体。你不必把所有任务都改为通过按量计费的 API 运行。

### 自由选择运行框架和模型

无需重建智能体即可切换运行框架（harness）和模型。Agenta 已经支持几乎所有模型，无论是自托管的，还是通过 API 访问的。目前 Agenta 支持 Claude Code 和 Pi 两种运行框架，并且[计划支持更多](https://agenta.ai/docs/?utm_source=github&utm_medium=referral&utm_campaign=readme)。

### 基于开放的智能体标准来构建

使用 `AGENTS.md`、技能（skills）和 MCP 服务器来定义你的智能体。你可以把智能体生态中的技能和 MCP 服务器引入 Agenta。

### 让你的智能体随时间变得更可靠

Agenta 会追踪每一次运行，并为每个智能体的配置保存版本历史。借助这些历史记录，你可以分析失败原因、对比改动，并持续改进你的智能体。

## 功能特性

**为你和你的智能体打造的工作空间。** 在共享工作空间中与智能体一起处理文件。你们可以一起撰写文档、整理研究资料，或维护一个 Wiki。

**人工审批与权限控制。** 为每个工具单独设置权限。你可以决定后台智能体哪些操作能自动执行、哪些需要你批准、哪些被禁止。

**后台智能体。** 让智能体定时运行，或在已连接的应用中发生某个事件时启动它们。

**追踪、用量与成本。** 检查每一次模型调用和工具调用。跟踪每个智能体的模型请求、token 用量以及预估成本。

**团队访问权限。** 开源版本允许你把智能体共享给团队，并按角色控制访问权限。

**集成能力。** 通过 MCP 把智能体连接到你日常使用的应用，或通过 Composio 集成 1000 多个应用，包括 Gmail、Slack、Notion 和 GitHub。

## 快速开始

### 试用 Agenta Cloud

体验 Agenta 最快的方式。

<p align="center">
  <a href="https://cloud.agenta.ai?utm_source=github&utm_medium=referral&utm_campaign=readme">
      <picture >
        <source width="200" media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/3aa96780-b7e5-4b6f-bfee-8feaa36ff3b2"  >
        <source width="200" media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/3aa96780-b7e5-4b6f-bfee-8feaa36ff3b2"  >
        <img alt="试用 Agenta Cloud" src="https://github.com/user-attachments/assets/3aa96780-b7e5-4b6f-bfee-8feaa36ff3b2" >
      </picture>
  </a>
</p>

### 自托管 Agenta

将以下内容粘贴到你的智能体中，它会引导你完成安装和测试：

```text
1. Install the Agenta self-hosting skill: npx skills add Agenta-AI/agenta-skills
2. Help me self-host Agenta with its repository.
```

更多细节请阅读[自托管文档](https://agenta.ai/docs/self-host/quick-start?utm_source=github&utm_medium=referral&utm_campaign=readme)。

## 路线图

**运行框架**

- [x] Claude Code
- [x] Pi
- [ ] Codex
- [ ] Gemini
- [ ] OpenCode
- [ ] [创建 issue，申请优先支持你需要的功能](https://github.com/Agenta-AI/agenta/issues)

**模型**

- [x] OpenAI
- [x] Anthropic
- [x] OpenRouter
- [x] Mistral AI
- [x] Cohere
- [x] Anyscale
- [x] Perplexity AI
- [x] DeepInfra
- [x] Together AI
- [x] Groq
- [x] Google Gemini
- [x] Azure
- [x] AWS Bedrock
- [x] MiniMax
- [x] 兼容 OpenAI 的模型
- [x] 自托管模型（Ollama）
- [ ] [创建 issue，申请优先支持你需要的功能](https://github.com/Agenta-AI/agenta/issues)

**智能体运行时**

- [x] 本地运行时
- [x] Daytona 沙箱
- [x] Docker 沙箱
- [ ] E2B 沙箱
- [ ] AgentComputer
- [ ] Vercel
- [ ] Cloudflare
- [ ] Modal
- [ ] BoxLite
- [ ] [创建 issue，申请优先支持你需要的功能](https://github.com/Agenta-AI/agenta/issues)

**功能**

- [x] 定时任务
- [x] 来自已连接应用的事件
- [x] MCP 服务器（API 密钥 + 免认证）
- [ ] 通用 webhook 触发器
- [ ] 更多 MCP 传输方式（OAuth）
- [ ] 渠道（Slack、Telegram、Discord、Teams）
- [ ] 移动版

查看[完整路线图](https://agenta.ai/docs/?utm_source=github&utm_medium=referral&utm_campaign=readme)。想参与其中某一项吗？欢迎[发起讨论](https://github.com/Agenta-AI/agenta/discussions)或参与贡献。

## Agenta 有何不同

### n8n、Activepieces 和 Zapier

这些产品用于按预定义的步骤构建工作流。而 Agenta 面向的是那些需要智能体自行规划、使用工具并灵活调整方法的工作。对于可预测的流程，请使用工作流构建工具；当工作需要判断力，或当你希望同一个智能体既能在对话中与你协作、又能在后台运行时，请使用 Agenta。

### Claude Cowork

Claude Cowork 提供的是一个围绕 Claude 构建的工作空间。而 Agenta 是开源的：你可以自由选择运行框架和模型，检查智能体的各个组成部分，并以交互方式或在后台运行它们。

### Claude Code、Codex、Pi 和 OpenCode

这些编程智能体提供了执行层，负责规划工作并使用工具。Agenta 围绕这个执行层提供共享工作空间，并加入文件、团队访问权限、触发器、版本管理和运行追踪等能力。Agenta 目前支持 Claude Code 和 Pi，更多运行框架的支持已列入路线图。

## 社区与贡献

Agenta 是基于 MIT 许可证的开源项目。你可以查看代码、自行运行，并帮助塑造我们接下来的方向。

- [阅读文档](https://agenta.ai/docs/?utm_source=github&utm_medium=referral&utm_campaign=readme)
- [报告问题](https://github.com/Agenta-AI/agenta/issues)
- [请求功能或分享想法](https://github.com/Agenta-AI/agenta/discussions)
- [阅读贡献指南](CONTRIBUTING.md)
- [加入 Slack 社区](https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw)

如果 Agenta 对你有帮助，请给仓库点个 Star，并告诉我们你构建了什么。

## ⭐ 给 Agenta 点个 Star

**欢迎给 Agenta 点个 Star！** 这有助于我们发展社区，也能让更多开发者看到 Agenta。
</br>
</br>
<p align="center">
    <a href="https://github.com/agenta-ai/agenta">

  <img width="300" alt="给 Agenta 点 Star" src="https://github.com/user-attachments/assets/2c8e580a-c930-4312-bf1b-08f631b41c62" />
    <a href="https://cloud.agenta.ai?utm_source=github&utm_medium=referral&utm_campaign=readme">

</p>

## 贡献者 ✨

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-69-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

感谢这些了不起的贡献者（[emoji 说明](https://allcontributors.org/docs/en/emoji-key)）：

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/SamMethnani"><img src="https://avatars.githubusercontent.com/u/57623556?v=4?s=100" width="100px;" alt="Sameh Methnani"/><br /><sub><b>Sameh Methnani</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=SamMethnani" title="Code">💻</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=SamMethnani" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/suadsuljovic"><img src="https://avatars.githubusercontent.com/u/8658374?v=4?s=100" width="100px;" alt="Suad Suljovic"/><br /><sub><b>Suad Suljovic</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=suadsuljovic" title="Code">💻</a> <a href="#design-suadsuljovic" title="Design">🎨</a> <a href="#mentoring-suadsuljovic" title="Mentoring">🧑‍🏫</a> <a href="https://github.com/Agenta-AI/agenta/pulls?q=is%3Apr+reviewed-by%3Asuadsuljovic" title="Reviewed Pull Requests">👀</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/burtenshaw"><img src="https://avatars.githubusercontent.com/u/19620375?v=4?s=100" width="100px;" alt="burtenshaw"/><br /><sub><b>burtenshaw</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=burtenshaw" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://abram.tech"><img src="https://avatars.githubusercontent.com/u/55067204?v=4?s=100" width="100px;" alt="Abram"/><br /><sub><b>Abram</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=aybruhm" title="Code">💻</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=aybruhm" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://israelabebe.com"><img src="https://avatars.githubusercontent.com/u/7479824?v=4?s=100" width="100px;" alt="Israel Abebe"/><br /><sub><b>Israel Abebe</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3Avernu" title="Bug reports">🐛</a> <a href="#design-vernu" title="Design">🎨</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=vernu" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/SohaibAnwaar"><img src="https://avatars.githubusercontent.com/u/29427728?v=4?s=100" width="100px;" alt="Master X"/><br /><sub><b>Master X</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=SohaibAnwaar" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://main-portfolio-26wv6oglp-witehound.vercel.app/"><img src="https://avatars.githubusercontent.com/u/26417477?v=4?s=100" width="100px;" alt="corinthian"/><br /><sub><b>corinthian</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=witehound" title="Code">💻</a> <a href="#design-witehound" title="Design">🎨</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Pajko97"><img src="https://avatars.githubusercontent.com/u/25198892?v=4?s=100" width="100px;" alt="Pavle Janjusevic"/><br /><sub><b>Pavle Janjusevic</b></sub></a><br /><a href="#infra-Pajko97" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://kaosiso-ezealigo.netlify.app"><img src="https://avatars.githubusercontent.com/u/99529776?v=4?s=100" width="100px;" alt="Kaosi Ezealigo"/><br /><sub><b>Kaosi Ezealigo</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3Abekossy" title="Bug reports">🐛</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=bekossy" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/albnunes"><img src="https://avatars.githubusercontent.com/u/46302915?v=4?s=100" width="100px;" alt="Alberto Nunes"/><br /><sub><b>Alberto Nunes</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3Aalbnunes" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://www.linkedin.com/in/mohammed-maaz-6290b0116/"><img src="https://avatars.githubusercontent.com/u/17180132?v=4?s=100" width="100px;" alt="Maaz Bin Khawar"/><br /><sub><b>Maaz Bin Khawar</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=MohammedMaaz" title="Code">💻</a> <a href="https://github.com/Agenta-AI/agenta/pulls?q=is%3Apr+reviewed-by%3AMohammedMaaz" title="Reviewed Pull Requests">👀</a> <a href="#mentoring-MohammedMaaz" title="Mentoring">🧑‍🏫</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/devgenix"><img src="https://avatars.githubusercontent.com/u/56418363?v=4?s=100" width="100px;" alt="Nehemiah Onyekachukwu Emmanuel"/><br /><sub><b>Nehemiah Onyekachukwu Emmanuel</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=devgenix" title="Code">💻</a> <a href="#example-devgenix" title="Examples">💡</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=devgenix" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/philipokiokio"><img src="https://avatars.githubusercontent.com/u/55271518?v=4?s=100" width="100px;" alt="Philip Okiokio"/><br /><sub><b>Philip Okiokio</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=philipokiokio" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://sweetdevil144.github.io/My-Website/"><img src="https://avatars.githubusercontent.com/u/117591942?v=4?s=100" width="100px;" alt="Abhinav Pandey"/><br /><sub><b>Abhinav Pandey</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=Sweetdevil144" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/RamchandraWarang9822"><img src="https://avatars.githubusercontent.com/u/92023869?v=4?s=100" width="100px;" alt="Ramchandra Warang"/><br /><sub><b>Ramchandra Warang</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=RamchandraWarang9822" title="Code">💻</a> <a href="https://github.com/Agenta-AI/agenta/issues?q=author%3ARamchandraWarang9822" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/lazyfuhrer"><img src="https://avatars.githubusercontent.com/u/64888892?v=4?s=100" width="100px;" alt="Biswarghya Biswas"/><br /><sub><b>Biswarghya Biswas</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=lazyfuhrer" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/okieLoki"><img src="https://avatars.githubusercontent.com/u/96105929?v=4?s=100" width="100px;" alt="Uddeepta Raaj Kashyap"/><br /><sub><b>Uddeepta Raaj Kashyap</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=okieLoki" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://www.linkedin.com/in/nayeem-abdullah-317098141"><img src="https://avatars.githubusercontent.com/u/32274108?v=4?s=100" width="100px;" alt="Nayeem Abdullah"/><br /><sub><b>Nayeem Abdullah</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=nayeem01" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/kangsuhyun-yanolja"><img src="https://avatars.githubusercontent.com/u/124246127?v=4?s=100" width="100px;" alt="Kang Suhyun"/><br /><sub><b>Kang Suhyun</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=kangsuhyun-yanolja" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/yeokyeong-yanolja"><img src="https://avatars.githubusercontent.com/u/128676129?v=4?s=100" width="100px;" alt="Yoon"/><br /><sub><b>Yoon</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=yeokyeong-yanolja" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://mrkirthi24.netlify.app/"><img src="https://avatars.githubusercontent.com/u/53830546?v=4?s=100" width="100px;" alt="Kirthi Bagrecha Jain"/><br /><sub><b>Kirthi Bagrecha Jain</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=mrkirthi-24" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/navdeep1840"><img src="https://avatars.githubusercontent.com/u/80774259?v=4?s=100" width="100px;" alt="Navdeep"/><br /><sub><b>Navdeep</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=navdeep1840" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://www.linkedin.com/in/rhythm-sharma-708a421a8/"><img src="https://avatars.githubusercontent.com/u/64489317?v=4?s=100" width="100px;" alt="Rhythm Sharma"/><br /><sub><b>Rhythm Sharma</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=Rhythm-08" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://osinachi.me"><img src="https://avatars.githubusercontent.com/u/40396070?v=4?s=100" width="100px;" alt="Osinachi Chukwujama "/><br /><sub><b>Osinachi Chukwujama </b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=vicradon" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://liduos.com/"><img src="https://avatars.githubusercontent.com/u/47264881?v=4?s=100" width="100px;" alt="莫尔索"/><br /><sub><b>莫尔索</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=morsoli" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://luccithedev.com"><img src="https://avatars.githubusercontent.com/u/22600781?v=4?s=100" width="100px;" alt="Agunbiade Adedeji"/><br /><sub><b>Agunbiade Adedeji</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=dejongbaba" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://techemmy.github.io/"><img src="https://avatars.githubusercontent.com/u/43725109?v=4?s=100" width="100px;" alt="Emmanuel Oloyede"/><br /><sub><b>Emmanuel Oloyede</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=techemmy" title="Code">💻</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=techemmy" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Dhaneshwarguiyan"><img src="https://avatars.githubusercontent.com/u/116065351?v=4?s=100" width="100px;" alt="Dhaneshwarguiyan"/><br /><sub><b>Dhaneshwarguiyan</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=Dhaneshwarguiyan" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/PentesterPriyanshu"><img src="https://avatars.githubusercontent.com/u/98478305?v=4?s=100" width="100px;" alt="Priyanshu Prajapati"/><br /><sub><b>Priyanshu Prajapati</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=PentesterPriyanshu" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://venkataravitejagullapudi.github.io/"><img src="https://avatars.githubusercontent.com/u/70102577?v=4?s=100" width="100px;" alt="Raviteja"/><br /><sub><b>Raviteja</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=VenkataRavitejaGullapudi" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/ArijitCloud"><img src="https://avatars.githubusercontent.com/u/81144422?v=4?s=100" width="100px;" alt="Arijit"/><br /><sub><b>Arijit</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=ArijitCloud" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Yachika9925"><img src="https://avatars.githubusercontent.com/u/147185379?v=4?s=100" width="100px;" alt="Yachika9925"/><br /><sub><b>Yachika9925</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=Yachika9925" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Dhoni77"><img src="https://avatars.githubusercontent.com/u/53973174?v=4?s=100" width="100px;" alt="Aldrin"/><br /><sub><b>Aldrin</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=Dhoni77" title="Tests">⚠️</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/seungduk-yanolja"><img src="https://avatars.githubusercontent.com/u/115020208?v=4?s=100" width="100px;" alt="seungduk.kim.2304"/><br /><sub><b>seungduk.kim.2304</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=seungduk-yanolja" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://dandrei.com/"><img src="https://avatars.githubusercontent.com/u/59015981?v=4?s=100" width="100px;" alt="Andrei Dragomir"/><br /><sub><b>Andrei Dragomir</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=andreiwebdev" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://diegolikescode.me/"><img src="https://avatars.githubusercontent.com/u/57499868?v=4?s=100" width="100px;" alt="diego"/><br /><sub><b>diego</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=diegolikescode" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/brockWith"><img src="https://avatars.githubusercontent.com/u/105627491?v=4?s=100" width="100px;" alt="brockWith"/><br /><sub><b>brockWith</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=brockWith" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://denniszelada.wordpress.com/"><img src="https://avatars.githubusercontent.com/u/219311?v=4?s=100" width="100px;" alt="Dennis Zelada"/><br /><sub><b>Dennis Zelada</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=denniszelada" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/romainrbr"><img src="https://avatars.githubusercontent.com/u/10381609?v=4?s=100" width="100px;" alt="Romain Brucker"/><br /><sub><b>Romain Brucker</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=romainrbr" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://heonheo.com"><img src="https://avatars.githubusercontent.com/u/76820291?v=4?s=100" width="100px;" alt="Heon Heo"/><br /><sub><b>Heon Heo</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=HeonHeo23" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Drewski2222"><img src="https://avatars.githubusercontent.com/u/39228951?v=4?s=100" width="100px;" alt="Drew Reisner"/><br /><sub><b>Drew Reisner</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=Drewski2222" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://speakerdeck.com/eltociear"><img src="https://avatars.githubusercontent.com/u/22633385?v=4?s=100" width="100px;" alt="Ikko Eltociear Ashimine"/><br /><sub><b>Ikko Eltociear Ashimine</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=eltociear" title="Documentation">📖</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/vishalvanpariya"><img src="https://avatars.githubusercontent.com/u/27823328?v=4?s=100" width="100px;" alt="Vishal Vanpariya"/><br /><sub><b>Vishal Vanpariya</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=vishalvanpariya" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/youcefs21"><img src="https://avatars.githubusercontent.com/u/34604972?v=4?s=100" width="100px;" alt="Youcef Boumar"/><br /><sub><b>Youcef Boumar</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=youcefs21" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/LucasTrg"><img src="https://avatars.githubusercontent.com/u/47852577?v=4?s=100" width="100px;" alt="LucasTrg"/><br /><sub><b>LucasTrg</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=LucasTrg" title="Code">💻</a> <a href="https://github.com/Agenta-AI/agenta/issues?q=author%3ALucasTrg" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://ashrafchowdury.me"><img src="https://avatars.githubusercontent.com/u/87828904?v=4?s=100" width="100px;" alt="Ashraf Chowdury"/><br /><sub><b>Ashraf Chowdury</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3Aashrafchowdury" title="Bug reports">🐛</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=ashrafchowdury" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/jp-agenta"><img src="https://avatars.githubusercontent.com/u/174311389?v=4?s=100" width="100px;" alt="jp-agenta"/><br /><sub><b>jp-agenta</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=jp-agenta" title="Code">💻</a> <a href="https://github.com/Agenta-AI/agenta/issues?q=author%3Ajp-agenta" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://mrunhap.github.io"><img src="https://avatars.githubusercontent.com/u/24653356?v=4?s=100" width="100px;" alt="Mr Unhappy"/><br /><sub><b>Mr Unhappy</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3Amrunhap" title="Bug reports">🐛</a> <a href="#infra-mrunhap" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/morenobonaventura"><img src="https://avatars.githubusercontent.com/u/2118854?v=4?s=100" width="100px;" alt="Moreno Bonaventura"/><br /><sub><b>Moreno Bonaventura</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3Amorenobonaventura" title="Bug reports">🐛</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://ikazoy.me/"><img src="https://avatars.githubusercontent.com/u/385109?v=4?s=100" width="100px;" alt="Yoshiki Ozaki"/><br /><sub><b>Yoshiki Ozaki</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3Aikazoy" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/ahmed-agenta"><img src="https://avatars.githubusercontent.com/u/194256084?v=4?s=100" width="100px;" alt="ahmed-agenta"/><br /><sub><b>ahmed-agenta</b></sub></a><br /><a href="#design-ahmed-agenta" title="Design">🎨</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/VahantSharma"><img src="https://avatars.githubusercontent.com/u/172914890?v=4?s=100" width="100px;" alt="Vahant Sharma"/><br /><sub><b>Vahant Sharma</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=VahantSharma" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/muzman123"><img src="https://avatars.githubusercontent.com/u/66068301?v=4?s=100" width="100px;" alt="Muhammad Muzammil"/><br /><sub><b>Muhammad Muzammil</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=muzman123" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/CyrusNamjoo"><img src="https://avatars.githubusercontent.com/u/209579763?v=4?s=100" width="100px;" alt="Sirous Namjoo"/><br /><sub><b>Sirous Namjoo</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=CyrusNamjoo" title="Documentation">📖</a> <a href="#example-CyrusNamjoo" title="Examples">💡</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/adityadewan22-hub"><img src="https://avatars.githubusercontent.com/u/225586510?v=4?s=100" width="100px;" alt="adityadewan22-hub"/><br /><sub><b>adityadewan22-hub</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=adityadewan22-hub" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/majiayu000"><img src="https://avatars.githubusercontent.com/u/19658300?v=4?s=100" width="100px;" alt="lif"/><br /><sub><b>lif</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=majiayu000" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="http://karimkohel.com"><img src="https://avatars.githubusercontent.com/u/46066647?v=4?s=100" width="100px;" alt="karim kohel"/><br /><sub><b>karim kohel</b></sub></a><br /><a href="#example-karimkohel" title="Examples">💡</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=karimkohel" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Vishesh-Paliwal"><img src="https://avatars.githubusercontent.com/u/142072830?v=4?s=100" width="100px;" alt="Vishesh Paliwal"/><br /><sub><b>Vishesh Paliwal</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=Vishesh-Paliwal" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/aviu16"><img src="https://avatars.githubusercontent.com/u/162624394?v=4?s=100" width="100px;" alt="Eve"/><br /><sub><b>Eve</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=aviu16" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://endoze.github.io"><img src="https://avatars.githubusercontent.com/u/997161?v=4?s=100" width="100px;" alt="Endoze"/><br /><sub><b>Endoze</b></sub></a><br /><a href="#infra-endoze" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=endoze" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/anshk8"><img src="https://avatars.githubusercontent.com/u/141085661?v=4?s=100" width="100px;" alt="Ansh Kakkar"/><br /><sub><b>Ansh Kakkar</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3Aanshk8" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Devarsh05"><img src="https://avatars.githubusercontent.com/u/116822773?v=4?s=100" width="100px;" alt="Devarsh Prajapati"/><br /><sub><b>Devarsh Prajapati</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3ADevarsh05" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/axelray-dev"><img src="https://avatars.githubusercontent.com/u/110029405?v=4?s=100" width="100px;" alt="AxelRay"/><br /><sub><b>AxelRay</b></sub></a><br /><a href="#platform-axelray-dev" title="Packaging/porting to new platform">📦</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=axelray-dev" title="Documentation">📖</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Sanket2329"><img src="https://avatars.githubusercontent.com/u/196506711?v=4?s=100" width="100px;" alt="Sanket Shakya"/><br /><sub><b>Sanket Shakya</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=Sanket2329" title="Code">💻</a> <a href="#platform-Sanket2329" title="Packaging/porting to new platform">📦</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=Sanket2329" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/unfitcoder101"><img src="https://avatars.githubusercontent.com/u/175036458?v=4?s=100" width="100px;" alt="unfitcoder101"/><br /><sub><b>unfitcoder101</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3Aunfitcoder101" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Shunmuka"><img src="https://avatars.githubusercontent.com/u/137101604?v=4?s=100" width="100px;" alt="Shunmuka Valsa"/><br /><sub><b>Shunmuka Valsa</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=Shunmuka" title="Code">💻</a> <a href="#platform-Shunmuka" title="Packaging/porting to new platform">📦</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/NamHT4Devlop"><img src="https://avatars.githubusercontent.com/u/122743792?v=4?s=100" width="100px;" alt="Hồ Trung Nam"/><br /><sub><b>Hồ Trung Nam</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=NamHT4Devlop" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Koushik-Salammagari"><img src="https://avatars.githubusercontent.com/u/138836560?v=4?s=100" width="100px;" alt="Koushik-Salammagari"/><br /><sub><b>Koushik-Salammagari</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3AKoushik-Salammagari" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/truecallerabreham"><img src="https://avatars.githubusercontent.com/u/180291642?v=4?s=100" width="100px;" alt="Abreham Melese"/><br /><sub><b>Abreham Melese</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3Atruecallerabreham" title="Bug reports">🐛</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

本项目遵循 [all-contributors](https://github.com/all-contributors/all-contributors) 规范。欢迎任何形式的贡献！
