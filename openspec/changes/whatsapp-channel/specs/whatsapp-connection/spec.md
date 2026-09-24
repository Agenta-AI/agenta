# WhatsApp connection

## Purpose

Let a project connect a WhatsApp business phone number to Channels, prove every inbound request came from Meta, and disconnect cleanly.

## ADDED Requirements

### Requirement: Bring-your-own number connection
Agenta SHALL let a project editor connect a WhatsApp business number by entering a phone number ID, a permanent system-user access token, and the Meta app secret. Agenta SHALL verify the token against the phone number before it stores the connection, SHALL store the token and app secret in the project vault, and SHALL key the connection on the phone number ID.

#### Scenario: Valid credentials
- **WHEN** an editor submits a phone number ID and a token that can read that number
- **THEN** Agenta SHALL store the connection with the number's display name and SHALL show the webhook URL and a generated verify token to paste into Meta

#### Scenario: Token cannot read the number
- **WHEN** the token is invalid or lacks access to the phone number
- **THEN** Agenta SHALL refuse the connection with a setup error and SHALL store nothing

#### Scenario: Number already connected elsewhere
- **WHEN** the phone number ID is already connected to another project on the same deployment
- **THEN** Agenta SHALL refuse the connection with an identity conflict

### Requirement: Webhook verify handshake
Agenta SHALL answer Meta's webhook verification GET request. When `hub.mode` is `subscribe` and `hub.verify_token` matches a WhatsApp connection's verify token, Agenta SHALL respond 200 with the `hub.challenge` value as the plain-text body.

#### Scenario: Matching verify token
- **WHEN** Meta sends the verification request with a known verify token
- **THEN** Agenta SHALL return the challenge value unchanged as plain text

#### Scenario: Unknown verify token
- **WHEN** the verify token matches no WhatsApp connection
- **THEN** Agenta SHALL respond 403 and SHALL NOT echo the challenge

### Requirement: Signed event ingress
Agenta SHALL accept WhatsApp event POSTs only when the `X-Hub-Signature-256` header equals the HMAC-SHA256 of the raw body keyed with the app secret of the connection named by `metadata.phone_number_id`. Agenta SHALL compare signatures in constant time, store accepted events in the inbox, and acknowledge before running the agent.

#### Scenario: Valid signature
- **WHEN** an event arrives with a correct signature for the named phone number
- **THEN** Agenta SHALL store the event and respond with an acknowledgment without waiting for the agent

#### Scenario: Forged or missing signature
- **WHEN** the signature is missing or does not match
- **THEN** Agenta SHALL respond 401 and SHALL NOT store the event

#### Scenario: Redelivered event
- **WHEN** Meta redelivers a message with a WhatsApp message ID already stored
- **THEN** Agenta SHALL NOT start a second turn for it

### Requirement: Embedded Signup connection
When a deployment is configured as a Meta Tech Provider, Agenta SHALL offer Embedded Signup. The popup result SHALL be exchanged for a business token on the server, and the resulting connection SHALL behave exactly like a bring-your-own connection for the same phone number. Agenta SHALL NOT offer a shared Agenta-owned WhatsApp number.

#### Scenario: Embedded Signup not configured
- **WHEN** the deployment has no Tech Provider app configured
- **THEN** the connect screen SHALL offer only the bring-your-own form

#### Scenario: Customer completes Embedded Signup
- **WHEN** a customer finishes the Meta popup for their number
- **THEN** Agenta SHALL create a connection keyed on that phone number ID with no credentials typed by the customer

### Requirement: Customer-paid messaging
Agenta SHALL NOT attach an Agenta credit line or payment method to a customer's WhatsApp Business Account. The connect screen SHALL state that Meta bills the customer's business directly for WhatsApp messages.

#### Scenario: Connect screen billing notice
- **WHEN** an editor opens the WhatsApp connect screen
- **THEN** the screen SHALL say that Meta bills their business directly and link Meta's pricing page

### Requirement: Disconnect
Archiving a WhatsApp connection SHALL stop routing its events and SHALL tell the operator to remove the callback URL in their Meta app. Agenta SHALL NOT unsubscribe the app from the business account, because the same Meta app may serve the business's other tools.

#### Scenario: Events after archive
- **WHEN** Meta delivers an event for an archived connection
- **THEN** Agenta SHALL NOT start a turn
