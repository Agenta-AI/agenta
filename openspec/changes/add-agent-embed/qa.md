# Agent embed: live QA scenarios

Run these as a recorded browser pass on a test deployment, with a throwaway project and a small test page served from an allowed origin. Use a second test page on an origin that is not allowed. Each scenario lists what must be seen in the browser.

## Setup

```gherkin
Background:
  Given a project with an agent whose tools need no external account
  And an embed connection for that agent with allowed origin "https://qa-allowed.example"
  And a test page on "https://qa-allowed.example" that includes the iframe snippet
  And a test page on "https://qa-blocked.example" that includes the same snippet
```

## Loading and origins

```gherkin
Scenario: Widget loads on an allowed site
  When I open the allowed test page
  Then the chat shows the embed's name and greeting

Scenario: Widget is blocked on another site
  When I open the blocked test page
  Then the iframe shows no chat
  And a fetch to the ingress from that page fails the CORS preflight

Scenario: An embed with no domain list loads anywhere
  Given a second embed for the agent with "Only allow embedding the agent on specific domains" turned off
  When I open a page with its snippet on the allowed origin and on the blocked origin
  Then both show the chat
  And the widget page's header is "frame-ancestors *"
  And a host-provided visitor key from either page is used

Scenario: A wildcard domain allows subdomains only
  Given a third embed that allows "https://*.qa-allowed.example"
  Then the widget page's header lists "https://*.qa-allowed.example"
  And a page on "https://sub.qa-allowed.example" shows the chat
  And a page on "https://qa-allowed.example" shows no chat
```

## Anonymous history

```gherkin
Scenario: First message streams a reply
  Given I open the allowed test page in a fresh browser profile
  When I send "Hello"
  Then the reply appears word by word, not all at once

Scenario: Reload keeps the conversation
  Given I have sent a message and received a reply
  When I reload the page
  Then the same conversation is open with both messages

Scenario: New chat keeps the old one
  When I choose "New chat" and send "Second conversation"
  Then the conversation list shows two conversations
  And opening the first one shows its original messages

Scenario: Another browser does not see my conversations
  When I open the allowed test page in a second fresh browser profile
  Then the conversation list is empty
```

## Host-provided key and context

```gherkin
Scenario: Same history on two devices
  Given the test page sends agenta:init with a 40-character random visitorKey
  And I send "Remember this" in profile one
  When I open the same page with the same visitorKey in profile two
  Then the conversation with "Remember this" is listed

Scenario: Short key is refused
  Given the test page sends agenta:init with visitorKey "user-42"
  When I send a message
  Then the widget shows an error and no reply is produced

Scenario: The agent sees host context
  Given the test page sends agenta:context with {"page": "/invoices"}
  When I ask "Which page am I on?"
  Then the agent answers with "/invoices"
  And my own message in the widget shows only "Which page am I on?"
```

## Agent features in the widget

```gherkin
Scenario: Approval in the widget
  Given the agent has a tool that requires approval
  When I ask the agent to use that tool
  Then an approval card appears in the widget
  And after I approve, the run continues and the agent replies

Scenario: File upload reaches the agent
  When I attach a small text file and ask for its first line
  Then the agent answers with the file's first line

Scenario: Message during a running turn
  Given the agent is still answering
  When I send another message
  Then both messages are answered in order, with no error
```

## Owner view

```gherkin
Scenario: Owner reads embed conversations
  Given visitors have chatted in the widget
  When I open the embed connection's conversations as a project member
  Then each conversation is listed with the embed's name
  And it opens in the session view with the visitor's messages and the agent's replies
```

## Limits

```gherkin
Scenario: Rate limit
  When I send messages faster than the configured limit
  Then the widget shows a short wait message
  And the ingress answered with a rate-limit status and Retry-After

Scenario: Archived embed
  Given the project member archives the embed connection
  When I reload the allowed test page
  Then the widget shows that the chat is unavailable
```
