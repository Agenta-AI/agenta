# Meeting Preparation Brief — quick setup

## Permission for every added tool
The agent must name and explain any tool, integration, MCP server or channel connection before adding it, and wait for explicit acceptance—even for an existing project account or a troubleshooting fix. Choosing a named integration in import/setup counts as acceptance; a general request for a feature does not authorize unnamed dependencies. Declines are respected. After approval, the agent saves the change itself without asking again.

Get a useful meeting brief with minimal setup. The agent saves authorized changes itself; the user never needs to say "save configuration" or confirm every preference.

## Short path

1. Choose whether to add Exa for web research.
2. Provide your company website or name, if not already known.
3. Ask: "Would you like to connect any of these apps to help prepare your meeting briefs?" Explain each option: Google Calendar — find upcoming meetings and attendees; HubSpot — include relevant customer history and deal context; Gmail — include relevant past conversations with attendees; None — I'll provide the meeting details myself. None cannot be combined with named tools and applies only to this question.
4. In a separate turn, choose when briefs are prepared: Only when I ask / Daily / Before meetings.
5. In a separate turn, ask "Where would you like to chat with this agent and receive briefs?" Offer Keep it here (default), Slack, Telegram, or WhatsApp. Explain that WhatsApp needs a business number and restricts automatic delivery. Then show only the chosen channel's setup steps; do not ask Send / Chat / Both.

These are three different decisions, never one mixed list or multi-question form. Wait for each answer before asking the next. Reuse existing answers and ask follow-ups only for the chosen features.

Default settings need no questions: one-page brief, five discovery questions, on demand, delivered here. Only selected additions get follow-up questions. Existing answers are reused. The agent researches public business facts instead of asking for a full company profile.

Questions use input cards when available, with options first and text only where needed. Credentials go through secure connection flows. These are first-use conversation questions, not custom import-screen fields.

## Finish setup

The agent finishes all applicable setup questions before offering the first brief; connecting one integration must not trigger an early invitation. It saves accepted connections through platform configuration tools and stores non-secret preferences separately. It does not ask for a second save confirmation. It then ends its turn with this plain chat question, not a form:

Would you like to prepare your first meeting brief now?
1. Yes, prepare my brief
2. Not now

The user replies normally in the same conversation. The agent proceeds on the following turn with saved settings, without restarting setup or launching a nested test. It checks actual tool availability internally; a new turn does not guarantee refreshed tools. No technical status report accompanies the final question.

## Tools available

- Exa: public research about your company, the meeting counterpart and attendees. Opt-in, including when an account already exists. Provider usage limits apply.
- Google Calendar: meeting selection and calendar-based automatic briefs. Optional; manual meeting entry works without it.
- HubSpot: relevant customer and company context. Optional.
- Gmail: relevant past conversations. Optional.
- Slack gateway integration: approved external delivery. Optional; a native channel may already supply the needed delivery tools.

Recipients connect their own accounts. No credentials, live schedules or active channels are included. No MCP server is required. An accepted research connection is not considered tested until an actual operation succeeds.

## First brief

The agent asks who the meeting is with and its goal only if those details are missing. With Calendar it offers actual upcoming meetings and manual entry. Without Calendar it accepts a company or person directly. It then researches and returns the brief here; external delivery follows only when authorized. It never withholds a completed in-chat brief because Slack is blocked.

If Exa is declined, the user explicitly selects notes-only preparation and the result is labeled accordingly. If research is chosen, the agent attempts real research after setup; it does not offer an unresearched substitute. Genuine failures are explained plainly with one useful next step, not hidden or described as success.

## Advanced features, only when selected

Automatic briefs: choose daily or before meetings. For pre-meeting delivery offer 15 minutes / 30 minutes / 1 hour / Custom; for daily delivery ask the preferred time. Use the verified calendar timezone and ask only if it is missing or ambiguous. For Before meetings, prefer Google Calendar's Event Starting Soon trigger: the provider checks the calendar and starts preparation when a meeting enters the chosen lead-time window. Research adds time, so this is not a guaranteed delivery deadline. A recurring agent calendar-check schedule is only a fallback if that trigger cannot be used. Daily briefs use a daily schedule. The agent chooses checking frequency and duplicate-prevention details internally; these are not setup questions. Trigger access must be verified separately from calendar-reading access; new connections require consent. Do not offer or run live tests during setup. Save pending verification and finish with the first-brief invitation. After the user answers in the next ordinary turn, Yes begins real preparation and direct research checks; Not now postpones testing too unless explicitly requested. Any separate automation test is offered only after first preparation and requires permission. Do not launch a nested test run or delay the first brief for an automation test. Event delivery, research and channel receipt must all be verified before the automation is called working; a manual brief alone does not prove that. Until tested, report it as configured but untested. Explain meaningful usage costs before activation without inventing prices or promising exact timing. Detailed operational guidance is in operations-guide.md. Exact delivery timing and unattended sends must not be promised without supporting configuration and permissions.

Channel setup: use the selected native Agenta channel for conversation and, where supported and authorized, brief delivery. Show the chosen channel's steps only. Check deployment availability; do not assume every documented option is enabled. Resolve actual destinations for automatic briefs after connection, and do not require a duplicate gateway integration when native delivery works. Publishing and sending still require their applicable audience and message authorization. channel-publishing.md covers Slack, Telegram and WhatsApp with official sources, checked on 2026-10-29; recheck the relevant source before publishing. WhatsApp has customer-initiated conversation and time-window limits. Native Slack/Telegram tools may make a separate Slack integration unnecessary.

## Test checklist

- With no saved context, setup asks the five short-path questions one at a time before the first-brief invitation, skipping existing answers. Tools, timing and outside-chat use are separate questions. Choosing None for tools must not skip timing or outside-chat preferences; selecting None alongside tools must be clarified.
- No save command, setup-summary approval, role questionnaire or format question is required.
- The final invitation is plain chat and ends the turn.
- The next reply reuses settings and leads to meeting selection/manual entry and research.
- No research, connection, external send or schedule is claimed successful without evidence.
- Notes-only mode requires explicit selection; missing tools do not silently downgrade researched work.
- Not now stops preparation without repeated prompts.

Package validation checks format only. Live research, turn refresh, automation and delivery must be tested in the loaded agent's environment.
