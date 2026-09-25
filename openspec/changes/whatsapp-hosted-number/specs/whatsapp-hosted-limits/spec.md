# WhatsApp hosted limits

## Purpose

Run one Agenta-owned WhatsApp number per deployment safely: authenticate its traffic, bound its cost per project, keep replies inside Meta's rules, and switch it off cleanly.

## ADDED Requirements

### Requirement: Deployment configuration
Agenta SHALL enable the hosted WhatsApp number only when `WHATSAPP_HOSTED_PHONE_NUMBER_ID`, `WHATSAPP_HOSTED_ACCESS_TOKEN`, `WHATSAPP_HOSTED_APP_SECRET`, `WHATSAPP_HOSTED_VERIFY_TOKEN` and `WHATSAPP_HOSTED_DISPLAY_NUMBER` are all set. `WHATSAPP_HOSTED_DAILY_MESSAGE_CAP` SHALL be optional with a default of 100.

#### Scenario: All settings present
- **WHEN** the five required settings are set on the deployment
- **THEN** the WhatsApp channel catalog entry SHALL report hosted setup as available

#### Scenario: Kill switch
- **WHEN** an operator unsets any required setting and restarts the services
- **THEN** the hosted tab SHALL disappear, the bind-link route SHALL answer 404, hosted events SHALL be refused, and bring-your-own WhatsApp connections SHALL keep working

### Requirement: Hosted webhook
Agenta SHALL answer Meta's verify handshake for the hosted number when `hub.verify_token` equals the deployment's hosted verify token, and SHALL accept a hosted event only when `X-Hub-Signature-256` matches the HMAC-SHA256 of the raw body keyed with the deployment's hosted app secret. The hosted and bring-your-own numbers SHALL share the route `/channels/whatsapp/events/`.

#### Scenario: Handshake with the hosted verify token
- **WHEN** Meta sends the GET handshake with the hosted verify token
- **THEN** Agenta SHALL echo `hub.challenge` as plain text

#### Scenario: Forged hosted event
- **WHEN** an event names the hosted phone number ID with a signature that does not match the hosted app secret
- **THEN** Agenta SHALL refuse it and SHALL NOT read a code or write a binding

#### Scenario: Bring-your-own event on the same route
- **WHEN** an event names a customer's own phone number ID
- **THEN** Agenta SHALL verify and route it exactly as before this change

### Requirement: Per-project daily message cap
The outbox SHALL count the messages a project's hosted WhatsApp connection sent in the last 24 hours before each send. At the cap it SHALL send one fixed notice and mark the reply failed with the reason `daily_cap`. Above the cap it SHALL mark replies failed with `daily_cap` and send nothing. Every sent message SHALL count, including split parts, the working message, notices and re-open templates. Bring-your-own connections SHALL have no cap.

#### Scenario: Under the cap
- **WHEN** a project sent 40 messages in the last 24 hours and its agent answers
- **THEN** Agenta SHALL send the answer

#### Scenario: Reaching the cap
- **WHEN** a project sent exactly 100 messages in the last 24 hours and its agent answers
- **THEN** Agenta SHALL send "This agent reached today's message limit on Agenta's WhatsApp. It will answer again within 24 hours. To remove the limit, connect your own WhatsApp number in Agenta." and mark the answer failed with `daily_cap`

#### Scenario: Past the cap
- **WHEN** a project already received the limit notice in the last 24 hours and its agent answers again
- **THEN** Agenta SHALL send nothing and mark the answer failed with `daily_cap`, visible in Settings > Channels outbound events

#### Scenario: One project at the cap
- **WHEN** project A is at its cap and a phone bound to project B writes
- **THEN** project B's agent SHALL answer normally

### Requirement: Service window on the shared number
The hosted number SHALL follow the bring-your-own service window rules unchanged: hold replies after the window closes, release them when the phone writes again, and honor STOP and START. When a reply is held, the hosted adapter SHALL send Agenta's own approved utility template `agenta_reply_ready` in English, once per held stretch, instead of an operator-chosen template.

#### Scenario: Answer after the window closed
- **WHEN** a bound phone's agent finishes an answer 25 hours after the phone's last message
- **THEN** Agenta SHALL hold the answer, send "Your Agenta agent has a reply for you. Send any message to see it." once, and deliver the held answer when the phone writes again

#### Scenario: Template counts against the cap
- **WHEN** the re-open template is sent
- **THEN** it SHALL count as one message toward the project's daily cap
