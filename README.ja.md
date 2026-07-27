
<p align="center">
  <a href="https://agenta.ai?utm_source=github&utm_medium=referral&utm_campaign=readme">
      <picture >
        <source width="275" media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/97e31bfc-b1fc-4d19-b443-5aedf6029017"  >
        <source width="275" media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/fdc5f23f-2095-4cfc-9511-14c6851c1262"  >
        <img alt="Agenta のロゴ" src="https://github.com/user-attachments/assets/fdc5f23f-2095-4cfc-9511-14c6851c1262" >
      </picture>
  </a>
  
<div align="center">
  <strong> <h1> エージェントを構築し、実行するためのオープンソース・ワークスペース </h1></strong>


<img width="1800" height="680" alt="agenta-github-banner" src="https://github.com/user-attachments/assets/afc83f8f-d644-4dc6-bae7-b26ed2512986" />

  ---


  対話するだけで、**あなたの作業を自動化する**エージェントを構築できます。**チーム**と共有し、普段使っているアプリと連携させ、**バックグラウンド**で実行しましょう。

</div>

</div>


<h3 align="center">
  <a href="https://agenta.ai/docs/?utm_source=github&utm_medium=referral&utm_campaign=readme"><b>ドキュメント</b></a> &bull;
  <a href="https://agenta.ai?utm_source=github&utm_medium=referral&utm_campaign=readme"><b>ウェブサイト</b></a> &bull;
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
        <img alt="Agenta のライブデモを試す" src="https://github.com/user-attachments/assets/a2069e7b-c3e0-4a5e-9e41-8ddc4660d1f2" >
      </picture>
  </a>
</p>

---

## Agenta とは？

Agenta は、あなたの作業を自動化・強化する専用エージェントを構築できるオープンソースのワークスペースです。

エージェントは対話しながら構築します。やってほしい作業を説明し、必要なアプリを連携させ、フィードバックを通じて改善していきます。

エージェントとチャットで直接やり取りでき、チームと共有することもできます。

繰り返し発生する作業には、バックグラウンドエージェントを構築できます。これらのエージェントは、設定したスケジュールに沿って、またはイベントが発生したときに実行されます。

## なぜ Agenta を使うのか？

### お使いの Claude や ChatGPT のサブスクリプションを活用

Agenta をセルフホストすると、既存の Claude や ChatGPT のサブスクリプションを使ってエージェントをローカルで実行できます。すべての作業を従量課金制の API 経由に切り替える必要はありません。

### ハーネスとモデルを自由に選択

エージェントを作り直すことなく、ハーネスとモデルを切り替えられます。Agenta は、セルフホスト型か API 経由かを問わず、ほぼすべてのモデルにすでに対応しています。現在サポートしているハーネスは Claude Code と Pi で、[今後さらに追加を予定](https://agenta.ai/docs/?utm_source=github&utm_medium=referral&utm_campaign=readme)しています。

### オープンなエージェント標準で構築

エージェントは `AGENTS.md`、スキル、MCP サーバーで定義します。エージェントのエコシステムにあるスキルや MCP サーバーを Agenta に取り込むこともできます。

### エージェントの信頼性を継続的に高める

Agenta はすべての実行をトレースし、各エージェント設定のバージョン履歴を保持します。この履歴を使って、失敗の原因を把握し、変更を比較し、エージェントを継続的に改善できます。

## 主な機能

**あなたとエージェントのためのワークスペース。** 共有ワークスペース上で、エージェントと一緒にファイルを扱えます。ドキュメントの作成、リサーチの整理、Wiki の運用などを共同で行えます。

**人間による承認と権限管理。** ツールごとに権限を設定できます。バックグラウンドエージェントが自動で実行できる操作、承認が必要な操作、禁止する操作を選べます。

**バックグラウンドエージェント。** エージェントをスケジュールで実行したり、連携アプリでイベントが発生したときに起動したりできます。

**トレース、使用量、コスト。** すべてのモデル呼び出しとツール呼び出しを確認できます。エージェントごとにモデルへのリクエスト、トークン使用量、推定コストを追跡できます。

**チームでの利用。** オープンソース版では、エージェントをチームと共有し、ロールごとにアクセス権を管理できます。

**インテグレーション。** MCP を使って、普段使うアプリとエージェントを接続できます。また、Composio を使えば、エージェントを Gmail、Slack、Notion、GitHub など 1,000 以上のアプリと連携できます。

## はじめる

### Agenta Cloud を試す

Agenta を最も手早く試せる方法です。

<p align="center">
  <a href="https://cloud.agenta.ai?utm_source=github&utm_medium=referral&utm_campaign=readme">
      <picture >
        <source width="200" media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/3aa96780-b7e5-4b6f-bfee-8feaa36ff3b2"  >
        <source width="200" media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/3aa96780-b7e5-4b6f-bfee-8feaa36ff3b2"  >
        <img alt="Agenta Cloud を試す" src="https://github.com/user-attachments/assets/3aa96780-b7e5-4b6f-bfee-8feaa36ff3b2" >
      </picture>
  </a>
</p>

### Agenta をセルフホストする

以下をエージェントに貼り付けると、セットアップとテストを案内してくれます。

```text
1. Install the Agenta self-hosting skill: npx skills add Agenta-AI/agenta-skills
2. Help me self-host Agenta with its repository.
```

詳しくは[セルフホスティングのドキュメント](https://agenta.ai/docs/self-host/quick-start?utm_source=github&utm_medium=referral&utm_campaign=readme)をご覧ください。

## ロードマップ

**ハーネス**

- [x] Claude Code
- [x] Pi
- [ ] Codex
- [ ] Gemini
- [ ] OpenCode
- [ ] [Issue を作成して優先度を上げる](https://github.com/Agenta-AI/agenta/issues)

**モデル**

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
- [x] OpenAI 互換モデル
- [x] セルフホスト型モデル（Ollama）
- [ ] [Issue を作成して優先度を上げる](https://github.com/Agenta-AI/agenta/issues)

**エージェントランタイム**

- [x] ローカルランタイム
- [x] Daytona サンドボックス
- [x] Docker サンドボックス
- [ ] E2B サンドボックス
- [ ] AgentComputer
- [ ] Vercel
- [ ] Cloudflare
- [ ] Modal
- [ ] BoxLite
- [ ] [Issue を作成して優先度を上げる](https://github.com/Agenta-AI/agenta/issues)

**機能**

- [x] スケジュール
- [x] 連携アプリからのイベント
- [x] MCP サーバー（API キー + 認証なし）
- [ ] 汎用 Webhook トリガー
- [ ] MCP のトランスポート追加（OAuth）
- [ ] チャンネル（Slack、Telegram、Discord、Teams）
- [ ] モバイル版

[完全なロードマップ](https://agenta.ai/docs/?utm_source=github&utm_medium=referral&utm_campaign=readme)をご覧ください。いずれかの項目に協力していただける場合は、[ディスカッションを開始](https://github.com/Agenta-AI/agenta/discussions)するか、開発に参加してください。

## 他のツールとの違い

### n8n、Activepieces、Zapier

これらの製品は、あらかじめ定義したステップでワークフローを構築するためのものです。一方 Agenta は、エージェントが自ら計画を立て、ツールを使い、状況に応じてやり方を調整する必要のある作業のために設計されています。手順が決まっている処理にはワークフロービルダーを使ってください。判断が必要な作業や、同じエージェントとチャットで協働し、そのエージェントをバックグラウンドでも実行したい場合には Agenta が適しています。

### Claude Cowork

Claude Cowork は Claude を中心に据えたワークスペースを提供します。Agenta はオープンソースであり、ハーネスとモデルを自由に選び、エージェントの構成要素を確認し、対話形式でもバックグラウンドでも実行できます。

### Claude Code、Codex、Pi、OpenCode

これらのコーディングエージェントは、作業を計画しツールを使う実行レイヤーを提供します。Agenta は、その実行レイヤーに、ファイル、チームアクセス、トリガー、バージョン、トレースを備えた共有ワークスペースを提供します。Agenta は現在 Claude Code と Pi に対応しており、より多くのハーネスへの対応をロードマップに掲げています。

## コミュニティとコントリビューション

Agenta は MIT ライセンスのオープンソースです。コードを確認し、自分で実行し、私たちが次に何を作るかを一緒に形づくることができます。

- [ドキュメントを読む](https://agenta.ai/docs/?utm_source=github&utm_medium=referral&utm_campaign=readme)
- [バグを報告する](https://github.com/Agenta-AI/agenta/issues)
- [機能をリクエストする／アイデアを共有する](https://github.com/Agenta-AI/agenta/discussions)
- [コントリビューションガイドを読む](CONTRIBUTING.md)
- [Slack コミュニティに参加する](https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw)

Agenta が役に立ったら、リポジトリにスターを付けて、あなたが作ったものを教えてください。

## ⭐ Agenta にスターを

**ぜひスターを付けてください！** コミュニティの成長につながり、より多くの開発者に Agenta を届けられます。
</br>
</br>
<p align="center">
    <a href="https://github.com/agenta-ai/agenta">

  <img width="300" alt="Agenta にスターを付ける" src="https://github.com/user-attachments/assets/2c8e580a-c930-4312-bf1b-08f631b41c62" />
    <a href="https://cloud.agenta.ai?utm_source=github&utm_medium=referral&utm_campaign=readme">

</p>

## コントリビューター ✨

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-69-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

すばらしいコントリビューターの皆さんに感謝します（[絵文字の凡例](https://allcontributors.org/docs/en/emoji-key)）：

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

このプロジェクトは [all-contributors](https://github.com/all-contributors/all-contributors) 仕様に準拠しています。どのような形の貢献も歓迎します！
