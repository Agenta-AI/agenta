# Agenta channel publishing guide

Verified against official Agenta documentation on 2026-10-29. This is a documentation snapshot, not proof that a recipient's deployment has every feature. No channel is activated by loading this template.

## How to use this guide
During setup, offer a single channel choice: Keep it here (Agenta chat), Slack, Telegram, or WhatsApp. Explain that WhatsApp requires a business number and restricts automatic delivery. Do not ask separate Send / Chat / Both questions: a supported native channel can serve conversation and authorized delivery. Ask one decision at a time. After selection, provide only the chosen channel's steps below. Check deployment availability rather than assuming every documented option is enabled. For automatic briefs, resolve an accessible destination after connection and verify delivery permissions. Selection is not permission to publish to an unspecified audience or send an unapproved message. Before publishing, recheck the official source for that channel using available web retrieval. If a source moved, search the official Agenta docs. If retrieval fails, label these as last-verified steps rather than claiming they are current. Ask for a screenshot only when documentation and the user's interface differ or the requested option is undocumented. Never ask for credentials in chat; secrets go only in the channel's secure configuration fields. Confirm the intended audience before publishing and keep private meeting/CRM/email content out of broader channels unless authorized.

## Slack: publish an interactive agent
1. Open the intended agent and click **Publish**, then choose **Slack**.
2. Select **Add to Slack** to use the Agenta Slack app. This appears only if the deployment has that app configured. Alternatively connect your own Slack app using the manifest Agenta provides; follow the current on-screen setup.
3. Review and authorize the requested workspace access. Each connection answers as one agent.
4. Review connections in **Settings → Channels**, including which agent the bot answers as.
5. Test by addressing the agent in a channel, thread or direct message. It replies in a thread. In threads/group conversations it answers when addressed, not to every teammate message. Tool approvals appear in the thread.

Source: https://agenta.ai/docs/changelog/talk-to-your-agent-in-slack

## Telegram: publish an interactive agent
1. Open the agent, click **Publish**, and choose **Telegram**.
2. Scan the QR code or open the provided link, then press **Start** in Telegram. This route uses Agenta's hosted bot and does not need a personal BotFather token.
3. If the hosted bot is unavailable (for example on a self-hosted deployment without operator setup), choose **Use your own bot** and enter its BotFather token in the secure configuration UI, never agent chat.
4. Test with a message. A Telegram chat is one conversation; in groups the agent responds when addressed.

Sources:
- https://agenta.ai/docs/changelog/talk-to-your-agent-in-telegram
- Operator setup reference: https://agenta.ai/docs/self-host/channels/telegram-hosted-bot (consult this for self-hosted configuration; not reproduced here).

## Native Slack/Telegram delivery from automations
A native channel connection can provide tools to list destinations, send, read and search messages from Agenta chat, channel conversations and automations. Inspect the actual available tools; do not invent their callable names. Verify destination reachability and permissions before a test send. Native publishing is separate from adding a Composio Slack gateway connection; do not make the user connect both when one satisfies their chosen use case.

By default the bot can post to channels it is in and read them. In the channel connection's **Advanced** section, review **Can post outside the conversation** and **Channels it can search and read**. Telegram bots can read only messages they received, not arbitrary chat history. A channel connection alone does not create a schedule. Pre-meeting delivery still needs calendar access, timing, deduplication and a verified permitted send. Existing approval rules still apply.

Source: https://agenta.ai/docs/changelog/agents-work-with-your-channels

## WhatsApp: publish behind a business number
This is a customer-facing channel, not a general outbound reminder destination.
1. Have a Meta Business account, a Meta app with the WhatsApp product, and a WhatsApp Cloud API number. Meta's test number can be used for an initial test.
2. In Meta, obtain the **phone number ID** (not the phone number), a system-user access token with `whatsapp_business_messaging` and `whatsapp_business_management`, and the app secret. Give the system user access to the WhatsApp account. Do not use the short-lived temporary API Setup token. Enter secrets only in secure setup UI.
3. In Agenta open the agent's **Publish → WhatsApp** path; the detailed guide describes its **Channels → WhatsApp → Connect** section. Follow whichever documented entry point your deployment presents.
4. Enter **Phone number ID**, **Access token** and **App secret**, then connect. Agenta validates number/token access. Copy the returned callback URL and verify token directly to Meta configuration; do not paste secrets into agent chat.
5. In Meta open **WhatsApp → Configuration → Webhook → Edit**, enter Agenta's callback URL and verify token, then **Verify and save**. Subscribe to the **messages** field.
6. Send a test from your phone. With Meta's test number, add your phone as a recipient in **WhatsApp → API Setup** first.

Limitations relevant to this template: no WhatsApp groups; the agent replies to customer-initiated conversations and does not initiate contact with a number that has never messaged it. Free-form replies are limited to 24 hours after the customer's last message. Late replies are held until the customer returns; an approved **Re-open template** and **Template language** can prompt their return. STOP/UNSUBSCRIBE opts out, START opts back in. Do not promise arbitrary scheduled pre-meeting pushes through WhatsApp. Meta bills message usage. Disconnecting in Agenta does not remove Meta's webhook; remove the callback in Meta if stopping webhook traffic is intended.

Sources:
- https://agenta.ai/docs/guides/connect-whatsapp
- https://agenta.ai/docs/changelog/whatsapp-channel

## Verification and maintenance
After the recipient chooses and configures a channel, test only with permission, confirm the expected reply or delivery, and report observed results. Do not claim publishing succeeded merely because the setup form was completed. Do not activate channels or schedules automatically. On changed UI, feature restrictions or new channels, recheck official documentation before issuing new instructions. The guide was documentation-checked; no channels were deployed or live-tested when this ZIP was built.
