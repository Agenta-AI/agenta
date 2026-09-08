# Channels research: Chinese-ecosystem and open-source agent-publishing platforms

Light first-pass (breadth over depth), 2026-07-20. Covers **Coze** (ByteDance's agent-building platform, in two separately operated editions: international coze.com and Chinese coze.cn), **Dify** (the open-source LLM app platform and its messaging-integration story), and the **platform primitives** of the Chinese workplace-messaging platforms a bot would land in: WeCom (WeChat Work), personal WeChat, Feishu/Lark, and DingTalk.

Framing: the feature under study is "channels" — connect an agent to a messaging surface, where an @mention opens a session, the whole team talks to it in one thread, and the session can continue on other surfaces, optionally with approvals in-channel. For each vendor and platform below, the questions are: what channels exist, how connection works, what the session/conversation model is, how group chats and @mentions behave, what identity the bot sees, and whether approval-style human-in-the-loop UI exists.

Claims are cited inline. Claims I could not verify against a primary source are marked **[unverified]**.

---

## 1. Coze (ByteDance)

Coze is ByteDance's no-code/low-code agent platform. You build an agent (prompt + plugins + workflows + knowledge base), then "publish" it to channels. Publishing is a first-class, checkbox-per-channel step in the product: on the agent's publish page you configure each channel once (paste tokens, OAuth), then tick the channels you want each release to go to. The two editions have **completely different channel lists** because they live in different regulatory and ecosystem worlds.

### 1.1 coze.com (international) — channel list

From the official channels-capability page (https://www.coze.com/open/docs/guides/channels) and the per-channel guides, the international edition publishes agents to:

- **Cici** (ByteDance's own consumer assistant app — the international sibling of Doubao)
- **Discord** (https://www.coze.com/open/docs/guides/discord)
- **Telegram** (https://www.coze.com/open/docs/guides/telegram)
- **Slack** (https://www.coze.com/open/docs/guides/slack)
- **Lark** (international Feishu) (https://www.coze.com/open/docs/guides/lark)
- **LINE**, **WhatsApp**, **Facebook Messenger**, **Instagram**, **Reddit**
- Plus non-messaging surfaces: **Chat SDK** (web widget), **API**, **LarkBase**, and "custom channels" (a partner-integration program where a channel vendor registers with Coze and exposes a webhook-based integration — https://www.coze.com/open/docs/guides/channel_integration_overview).

There is a per-channel capability matrix on the channels page. The decision-relevant rows:

| Capability | Lark | Cici | Discord | Telegram | LINE | Slack | Instagram | Messenger |
|---|---|---|---|---|---|---|---|---|
| Private chat | yes | yes | yes | yes | yes | yes | yes | yes |
| **Group chat** | yes | no | yes | yes | no | yes | no | no |
| Streamed responses | yes | yes | yes | yes | no | yes | no | no |
| Receive images | yes | yes | yes | yes | no | no | no | no |
| Cards | no | yes | yes | no | no | no | no | no |
| Send files | yes | no | yes | yes | no | no | no | no |

(Source: https://www.coze.com/open/docs/guides/channels. Messenger group chat is additionally called out as blocked by Meta restrictions in the Messenger guide.)

### 1.2 coze.com — connection UX

The connection UX is consistently "bring the platform's own bot credentials to Coze":

- **Telegram**: create a bot with BotFather, paste the token into the channel config, publish. (https://www.coze.com/open/docs/guides/telegram)
- **Discord**: create an app in the Discord developer portal, enable MESSAGE CONTENT INTENT, paste the bot token. Coze notes Discord's own platform rules leak through: past 100 servers the bot needs Discord verification, and an agent with no interactions for a week goes offline and must be re-published. (https://www.coze.com/open/docs/guides/discord)
- **Slack**: create a Slack app from scratch, add eight scopes (`app_mentions:read`, `channels:history`, `chat:write`, `commands`, `groups:history`, `im:history`, `mpim:history`, `users:read`), install to workspace, then paste bot token + client id/secret + signing secret into Coze, and paste Coze's OAuth redirect / event / slash URLs back into Slack. So each customer builds their *own* Slack app; Coze does not offer a shared multi-tenant Slack app. (https://www.coze.com/open/docs/guides/slack)
- **Lark**: the opposite model — a **shared "Coze" application on the Lark app marketplace**. First publish triggers install-and-authorize of the Coze app into the Lark tenant (a one-time admin action), then the agent appears as an app the tenant admin must approve in the Lark Admin console before users can chat with it. (https://www.coze.com/open/docs/guides/lark)
- **Messenger/Instagram/WhatsApp**: standard Meta developer-app flows with Coze-hosted callback URLs (`https://api.coze.com/adapter/messenger/webhook` etc.), including Meta's business-verification gate before anyone outside the developer can use the bot, and WhatsApp's 24-hour temporary token / long-lived token dance. (https://www.coze.com/open/docs/guides/messenger, ...guides/instagram, ...guides/whatsapp)

### 1.3 coze.com — sessions, group chats, @mentions

- **Session model**: The docs expose no channel-side session controls. Conversation history is implied per user/chat per channel, and the only user-facing session operation is clearing context ("Clear context" is supported on every channel per the capability matrix; on Feishu/Lark it is the `/clear` chat command — see 1.5). Whether a group chat is one shared session or per-user sessions is not documented for coze.com. **[unverified]**
- **Group chats**: Supported only on Lark, Discord, Telegram, Slack. For **Telegram groups** the doc is explicit about the UX cost: the bot must be added as group **Admin** to see and answer normal messages; with plain member rights every message to it must start with `/` and @mention the bot (https://www.coze.com/open/docs/guides/telegram). For Slack, the scope list (`app_mentions:read`, `channels:history`) implies the standard Slack mention/history model; the doc gives no detail on when the bot answers in a channel. **[unverified]**
- **Multi-user identity**: nothing documented about distinguishing group members inside the agent context. **[unverified]**
- **Cross-surface continuation**: not offered. A channel conversation lives in that channel; the Coze API has its own conversation objects but there is no documented way to open a channel session from the API or continue a Telegram thread on the web. **[unverified — absence of evidence in docs]**

### 1.4 coze.com — approvals / human-in-loop

No approval primitive exists on messaging channels. The closest thing is the **Question node** in chatflows (agent asks the user a clarifying question mid-workflow and waits for the reply), which does work on messaging channels for agents; the **Input node** (structured form input mid-workflow) works only on Chat SDK/API, *not* on the communication platforms (https://www.coze.com/open/docs/guides/channels, workflow-node matrix). So "pause for a human decision in the channel" reduces to "ask a question in chat" — no card/button approval UI.

### 1.5 coze.cn (China) — channel list

The Chinese edition (rebranded around "扣子编程 / Coze Programming"; docs now at docs.coze.cn) has a completely different official channel list (https://docs.coze.cn/guides_publish_overview):

- **Feishu** (agent appears as a tenant app; needs tenant-admin review on first publish) (https://docs.coze.cn/guides_publish_to_feishu)
- **WeChat trio** — the only official ways onto WeChat:
  - **微信客服 / WeChat Customer Service** — Tencent's official customer-service product (kf.weixin.qq.com, runs on WeCom infrastructure): requires enterprise verification; connection = paste corp ID, Token, EncodingAESKey, secret and wire a Coze webhook into the WeChat KF developer console (https://docs.coze.cn/guides_publish_app_to_wechat_customerService)
  - **微信服务号 / WeChat Service Account** (an Official Account subtype for businesses, verified accounts only; one agent per account; OAuth-style scan-to-authorize connection) (https://docs.coze.cn/guides_wechat_service_account)
  - **微信订阅号 / WeChat Subscription Account** (the media-style Official Account subtype) (https://docs.coze.cn/guides_wechat_subscription)
- **掘金 / Juejin** (ByteDance's dev community; users talk to the agent by @-ing it in comments)
- **Mini-programs**: publish an app as a **Douyin mini-program** or **WeChat mini-program** (these are hosted mini-apps, not chat bots) (https://docs.coze.cn/guides_publish_to_douyin_app, ...guides_publish_to_wechat_app)
- **API / Chat SDK**, the **Coze store**, templates, and an enterprise-internal store.
- **Custom channels** (same partner-integration program as coze.com) and, on enterprise plans, "public channels" shared across tenants.

Two notable things about this list. First, earlier third-party tutorials (2024-era) list **Doubao** (ByteDance's consumer assistant) and Douyin messaging as coze.cn channels; the current official channel table does not include Doubao, so that channel appears to have been dropped or folded into ByteDance-internal distribution **[unverified — inferred from the current docs vs. older tutorials like https://docs.feishu.cn/v/wiki/V99wwGgc1i4rpZkLAnZc21R1nHc/a7]**. Second, there is **no personal-WeChat channel and no WeCom-group-bot channel** — the official surface area on the WeChat side is exactly the three Tencent-sanctioned bot products above.

Publishing on coze.cn also goes through **two review gates**: Coze's own content review of every release, then the target channel's review (Feishu tenant admin, WeChat platform review, mini-program platform review). This is a structural difference from Western channel publishing, where only the platform app-review (if any) applies. (https://docs.coze.cn/guides_publish_overview)

### 1.6 coze.cn — capability differences and session behavior

The channel-capability page (https://docs.coze.cn/guides_channels_differences) shows how much thinner the WeChat channels are than Feishu:

| Capability | WeChat (客服/服务号/订阅号) | Feishu | Juejin | Chat SDK / API |
|---|---|---|---|---|
| Streaming output | no | yes | no | yes |
| File upload | no | yes | yes | yes |
| Voice input | partially (not 客服) | yes | no | yes |
| Opening question | partially (not 客服) | yes | no | yes |
| Triggers (scheduled) | no | yes | no | no |
| Cards | no | no (explicitly: no card rendering on messaging channels) | no | yes |
| Clear context | yes | yes | yes | yes |

Session behavior facts from the Feishu/WeChat guides:

- On Feishu, a user clears their conversation memory by typing **`/clear`** in the chat — i.e., there is a per-user rolling session with history influencing replies (https://docs.coze.cn/guides_publish_to_feishu, FAQ).
- WeChat Official Account replies cannot stream and are also subject to WeChat's infamous reply-window timeout: for long generations the user must type "继续" ("continue") to pull the rest — Coze documents this as a WeChat platform limitation it cannot remove (https://docs.coze.cn/guides_wechat_service_account, FAQ).
- Feishu may silently swallow bot replies that contain emails/phone numbers (privacy filter) — the agent looks stuck "replying" while Coze's analytics show a completed reply (https://docs.coze.cn/guides_publish_to_feishu, FAQ).
- Sharing a Feishu-published agent is restricted to the same Feishu tenant (no cross-tenant sharing) (https://docs.coze.cn/guides_publish_to_feishu).

Group-chat/@mention semantics on coze.cn's Feishu channel are not documented on the publish page; Feishu-side platform rules apply (see §3.2). **[unverified for Coze specifically]**

Separately from *channel publishing*, coze.cn has an "external integrations" facility where workflows can push messages *out* through a **Feishu custom-bot webhook** (text/rich-text/card messages, @-specific-members, @-all) — a notification primitive, not a conversational channel (https://docs.coze.cn/guides_feishu_message_integration).

### 1.7 Coze — takeaways

- Coze treats channels as **publish targets with per-channel credential config**, not as a conversation fabric: no cross-surface session continuation, no in-channel approvals, no multi-user session semantics documented anywhere.
- The **group-chat story is thin everywhere**: only 4 of 10 coze.com channels support groups at all, and the docs never define what a group session *is*.
- The **two-sided review pipeline** (Coze content review + channel review) and the tenant-admin approval step on Feishu/Lark are the main UX taxes unfamiliar to Western SaaS.

---

## 2. Dify (open-source LLM app platform)

### 2.1 First-party publishing surface

Dify's own publishing story is: hosted **WebApp** (share a link), **embed in site** (iframe/script), and **API**. Dify has **no built-in messaging channels** — no first-party "publish to Slack/WeChat/Feishu" checkbox comparable to Coze. (https://docs.dify.ai)

What Dify does have since the 1.0 plugin system is the **"Extension" plugin type with Endpoints**: a plugin can register an HTTP endpoint on the Dify instance and bridge a Dify app to an external chat platform. The worked official example is a **Slack Bot plugin** (in the official marketplace: https://marketplace.dify.ai/plugin/langgenius/slack; dev guide: https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/develop-a-slack-bot-plugin; source: https://github.com/langgenius/dify-official-plugins/tree/main/extensions/slack_bot). The pattern: the plugin endpoint receives the platform's event webhook (e.g., Slack `app_mention`), calls the bound Dify app, and posts the answer back. Marketplace extensions exist for other platforms too, but coverage and depth vary; the Slack one is the flagship example.

### 2.2 Community bridges (the real channel story)

In practice, Dify-to-IM connectivity in the Chinese ecosystem runs through community bridge projects, and Dify's own docs endorse this: the official use-case doc for IM platforms is literally "connect Dify to Slack/Lark/Discord/Telegram **by using LangBot**" (https://docs.dify.ai/en/learn-more/use-cases/connect-dify-to-various-im-platforms-by-using-langbot).

**LangBot** (https://github.com/langbot-app/LangBot, https://langbot.app/en) is the maintained, production-grade bridge:

- One self-hosted gateway, adapters for **QQ, personal WeChat, WeCom (incl. the new WeCom smart-bot API and WeChat customer service), WeChat Official Account, Feishu/Lark, DingTalk, Discord, Slack, Telegram, LINE, KOOK, Matrix, email**.
- Backend adapters for **Dify, Coze, n8n, Langflow** and raw LLM APIs — you paste a Dify API endpoint + app type + API key into a LangBot "pipeline" and the bot works on every configured platform (https://dev.to/rockchinq/finally-got-my-dify-agent-working-in-discord-telegram-and-slack-4g2d).
- The pipeline model gives per-platform trigger rules (respond-on-@mention in groups, prefix triggers, group whitelists). Session-to-Dify mapping: LangBot keeps a session per chat scope and passes Dify's `conversation_id` to continue the same Dify conversation for that scope; exact per-user-in-group granularity is configurable per pipeline. **[unverified in detail — inferred from project docs; needs a code-level pass]**

**dify-on-wechat** (https://github.com/hanfangyuan4396/dify-on-wechat) is the WeChat-specific bridge, a fork of the older chatgpt-on-wechat. It targeted **personal WeChat** through unofficial clients (itchat = web protocol, gewechat = iPad protocol) plus WeCom app mode, WeChat Official Accounts, and WeChatFerry (Windows hook). Its session model: single chats trigger on a configurable prefix, group chats trigger on @bot or a prefix with a group whitelist, `#reset` clears context, and each chat scope maps to a Dify conversation. Critically, the README now states **both itchat and gewechat are dead — personal WeChat can no longer be accessed** — and warns of account-ban risk (封号) on the remaining grey paths; the project frames itself as "personal entertainment only." That is the current state of the grey-area personal-WeChat bridge world: functionally collapsed as of 2025 and never safe for a commercial product.

### 2.3 Dify — takeaways

- Dify validates a **gateway/bridge architecture**: platform-agnostic app API (with `conversation_id` as the continuation primitive) + a separate channel gateway (LangBot or a plugin endpoint) owning webhooks, triggers, and session mapping. This is structurally the closest analog to what an Agenta channels feature would build.
- Nobody in this ecosystem does cross-surface session continuation or in-channel approvals either; the bridges do trigger rules + context relay only.

---

## 3. Platform primitives: what the Chinese messaging platforms actually offer a bot

### 3.1 WeCom (企业微信 / WeChat Work)

WeCom is Tencent's workplace messenger. It interoperates with consumer WeChat (WeCom staff can message WeChat users) which is why it is also the sanctioned back door to WeChat users via 微信客服.

Bot-relevant primitives:

- **Group robot (群机器人)**: webhook URL per group; historically send-only (push text/markdown/card into a group). A callback mode for receiving group messages exists for it now (https://cloud.tencent.com/document/product/1263/71731, https://developer.work.weixin.qq.com/document/path/99110 **[unverified exact path]**).
- **Self-built app (自建应用)**: the classic enterprise-app model — XML-encrypted callbacks, 1:1 chats between employee and the app, proactive push to employees, org-directory identity (`userid`). Apps do not naturally sit in user-created group chats (app-created "appchat" groups only).
- **Smart robot (智能机器人)** — the new (2025) official AI-bot API, and the big change: JSON callbacks fire when a user **@mentions the bot in a group chat or messages it 1:1** (text, mixed rich text, image, voice, file, video); the developer can reply with **streaming messages** (WeCom polls the developer's callback for stream refreshes for up to 6 minutes) or with **template cards**, and each interaction hands the developer a single-use `response_url` valid for one hour — a Slack-like model (https://developer.work.weixin.qq.com/document/path/101039 overview, https://developer.work.weixin.qq.com/document/path/100719 receive, https://developer.work.weixin.qq.com/document/path/101138 active reply). The WeCom team even ships and maintains an official OpenClaw plugin on this API with streaming, group chat, quoted messages and template-card interactions (https://github.com/WecomTeam/wecom-openclaw-plugin), and an official "WeCom supports OpenClaw" landing page exists (https://work.weixin.qq.com/nl/index/openclaw).
- **Threads**: none. WeCom chats are flat; the only reply-context primitive is quoting a message.
- **Identity**: full member identity (userid mapped to the org directory) for internal users; external WeChat users appear via the external-contact system with an `external_userid`.
- **Approval UI**: **template cards** with buttons (`button_interaction`, `vote_interaction`, `multiple_interaction`) and event callbacks on click — a workable approve/deny primitive; plus WeCom's own OA approval module (审批) with its dedicated API for formal approval flows (https://developer.work.weixin.qq.com/document/path/91853 **[unverified exact path]**).
- **Access requirements**: a verified WeCom tenant (enterprise verification for anything customer-facing); admin console configuration of callback URLs with token/AES-key crypto. Third-party SaaS can also ship as a **third-party app (第三方应用)** on the WeCom marketplace, which requires Tencent's provider onboarding and app review. **[unverified detail for the smart-robot API's availability to third-party apps]**

### 3.2 Feishu / Lark

Feishu (Lark outside China) is ByteDance's workplace suite and by far the richest bot platform of the three.

- **Bot model**: a tenant app (self-built or marketplace) with a bot capability. Events arrive by webhook or an outbound **WebSocket long-connection mode** (no public URL needed). Core event: `im.message.receive_v1` (https://open.feishu.cn/document/server-docs/im-v1/message/events/receive).
- **Group chat + @mention**: by default a bot in a group only receives messages that @mention it; broader "receive all group messages" requires a separate, higher-privilege scope (`im:message.group_msg` family; the mention-only scopes are `im:message.group_at_msg:readonly` etc.). This mention-gated default matches the "@ the agent to wake it" UX exactly.
- **Threads**: Feishu **has real threads** ("topics"/话题). Messages can be replied to `in_thread`; topic-mode groups exist where every root message is a thread; events carry a `thread_id` usable as a session key. This is the only Chinese platform with a Slack-like thread primitive (see e.g. the reply-in-thread behavior documented by bridge projects: https://docs.openclaw.ai/channels/feishu, https://github.com/zarazhangrui/lark-coding-agent-bridge).
- **Identity**: rich — `open_id`/`union_id`/`user_id` per sender, tenant context, and separate identity spaces per app. Every group member who talks to the bot is individually identifiable.
- **Cards**: **interactive cards** are a flagship primitive — JSON card DSL, buttons/selects/forms with server callbacks, in-place card updates, and a native **streaming "typewriter" card API (CardKit)** used for token-streaming AI replies. Card button clicks need the interactivity permission configured or clicks fail with error 200340 (observed by bridge developers). Approve/deny-in-channel is a standard Feishu card pattern, and Feishu additionally has a whole **Approval (审批) product + API** with pre-built approval cards for formal workflows.
- **Review requirements**: self-built apps inside one tenant need only tenant-admin availability settings (fast, no ByteDance review). Marketplace distribution across tenants requires Feishu's app review. Coze's Feishu channel piggybacks on a marketplace "Coze" app, which is why a tenant-admin approval appears on first publish.

### 3.3 DingTalk

DingTalk is Alibaba's workplace messenger.

- **Bot model**: two tiers. (a) **Custom group robot (自定义机器人)**: per-group webhook, send-only, secured by keyword/signature/IP allowlist — the notification workhorse. (b) **Enterprise-app robot**: a bot attached to an enterprise app that can **receive** messages, in 1:1 and in groups; delivery via callback **or "Stream mode"** — an outbound WebSocket so no public endpoint is needed (https://open.dingtalk.com/document/dingstart/robot-receive-message).
- **Group chat + @mention**: in groups the app robot receives a message **when it is @mentioned**; replies go through a per-conversation `sessionWebhook` handed to the callback (https://open.dingtalk.com/document/dingstart/the-application-robot-in-the-enterprise-sends-group-chat-messages).
- **Threads**: none. Flat chats with quoting only.
- **Identity**: sender `staffId`/userid within the org for internal users.
- **Cards / approvals**: **ActionCard** messages (buttons with URLs) and the newer **interactive cards / "AI cards"** with callback-driven state updates and streaming AI-reply support. DingTalk also has its own heavyweight OA **approval workflow (审批)** product + API. DingTalk is additionally pushing an "AI assistant" (AI 助理) framework as the packaged way to ship agents into DingTalk. **[unverified detail on AI-assistant review requirements]**
- **Review requirements**: enterprise-internal apps are self-serve within the org; ISV/marketplace distribution requires Alibaba's review program.

### 3.4 Personal WeChat (grey area)

- There is **no official bot API for personal WeChat accounts**, full stop. Tencent's sanctioned bot surfaces are Official Accounts (subscription/service), WeChat Customer Service (微信客服), and mini-programs — all business identities, none of them a "bot user in your group chat."
- The unofficial ecosystem (itchat web protocol, wechaty puppets, gewechat/iPad protocol, WeChatFerry Windows hooks) is what powered chatgpt-on-wechat/dify-on-wechat. As of 2025 the major free protocols are **dead or ban-heavy**: dify-on-wechat's own README says itchat and gewechat no longer work and personal WeChat can no longer be accessed, with explicit account-ban (封号) warnings on remaining paths (https://github.com/hanfangyuan4396/dify-on-wechat). Commercial iPad-protocol vendors exist but violate Tencent ToS. **A Western SaaS should treat personal WeChat as out of scope.**
- Group chats on personal WeChat have **no threads, no cards, no bot identity** — a bridge bot is just a regular account replying on @mention by text parsing.

---

## 4. Synthesis for the Agenta channels feature

- The Chinese platforms that are *feasible and worthwhile* for a Western SaaS are **Feishu/Lark** (one codebase serves both; richest primitives: mention-gated group events, real threads, streaming cards, card-button approvals, WebSocket delivery) and, with more effort, **DingTalk** (Stream mode makes delivery easy; AI cards give streaming + buttons; no threads) and **WeCom's new smart-robot API** (Slack-like mention-callback + streaming + template-card buttons; no threads; requires verified Chinese enterprise tenancy). Personal WeChat is a non-starter; WeChat Official Accounts / 微信客服 are 1:1 customer-service surfaces (no groups, no streaming, reply-window limits), useful for support-bot use cases only.
- Nobody in this ecosystem — Coze included — implements the studied feature's differentiators: cross-surface session continuation, team-shared sessions with per-member identity, or approvals routed through the channel. The primitives to build them exist on Feishu (threads + cards) and partially on DingTalk/WeCom (cards, sessionWebhook/response_url), but the vendors stop at "publish the bot."
- Architecture precedent: Dify + LangBot demonstrates the clean split — platform-agnostic conversation API keyed by `conversation_id`, separate channel gateway owning webhooks/triggers/session-mapping. Coze demonstrates the productized-but-shallow alternative: per-channel credential config inside the builder, with capability matrices documenting what each channel loses.

## 5. Open questions for a deeper pass

1. What exactly is a "session" for Coze's Feishu/Lark group-chat support — one shared context per group, or per-user contexts inside the group? (Requires hands-on testing; docs are silent.)
2. Is WeCom's smart-robot (智能机器人) API available to third-party SaaS apps (第三方应用) or only to a tenant's own self-built configuration? This decides whether a Western SaaS can ship a one-click WeCom install.
3. LangBot's precise session-scope model (per-user-in-group vs per-group) and how it maps scopes to Dify `conversation_id`s — worth a code read as design input for our channel-session mapping.
4. Feishu marketplace review timeline/requirements for a foreign ISV (Lark international marketplace vs Feishu China marketplace are separate programs) — what would it take Agenta to ship a shared Lark app like Coze's?
5. DingTalk's "AI assistant" (AI 助理) framework: does it add session/thread primitives beyond the enterprise-robot API, and what review does it require?
6. Whether Coze has since added group-session or approval features on coze.cn's enterprise plans (the enterprise docs are partially gated).
