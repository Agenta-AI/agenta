# WhatsApp hosted connection

## Purpose

Let a user connect a phone to an Agenta agent through Agenta's own WhatsApp number, with the same concepts and flow as the hosted Telegram bot.

## ADDED Requirements

### Requirement: Bind link
When the deployment has the hosted WhatsApp number configured, Agenta SHALL let a project editor mint a bind link for an agent. Minting SHALL create or reuse the project's one `whatsapp_hosted` connection, point its default channel agent at the calling agent, store a one-time 12-character code with a 30-minute lifetime, and return a `https://wa.me/<display number>?text=<message>` link whose message reads `Hi Agenta! Connect my WhatsApp. Code: <code>` with the code in three groups of four.

#### Scenario: Mint on a configured deployment
- **WHEN** an editor asks for a hosted WhatsApp bind link
- **THEN** Agenta SHALL return the link, its lifetime in seconds, and the connection ID

#### Scenario: Deployment without the hosted number
- **WHEN** any of the five required hosted WhatsApp settings is missing
- **THEN** Agenta SHALL answer 404 with "The hosted WhatsApp number is not configured on this deployment." and the connect card SHALL offer only "Use your own number"

#### Scenario: Mint from a second agent in the same project
- **WHEN** the project's hosted connection answers with agent A and an editor mints a link from agent B
- **THEN** Agenta SHALL retarget the connection to agent B, as hosted Telegram does

### Requirement: Bind by code
Agenta SHALL treat an inbound message on the hosted number as a bind attempt when it contains a code-shaped string, ignoring case and dashes or spaces between the groups. A valid code SHALL bind the sender's phone to the code's project and connection and link the sender to the Agenta user who minted it, in one transaction, and SHALL be answered with "You are connected. Send a message and your agent will reply."

#### Scenario: User sends the prefilled message
- **WHEN** an unbound phone sends `Hi Agenta! Connect my WhatsApp. Code: K7QM-4XRT-9BDA` with a live code
- **THEN** Agenta SHALL bind the phone, reply with the greeting, and the bindings list for the connection SHALL include the phone

#### Scenario: User edits the words around the code
- **WHEN** an unbound phone sends `connect k7qm 4xrt 9bda please` with a live code
- **THEN** Agenta SHALL bind the phone exactly as for the unedited message

#### Scenario: User edits the code
- **WHEN** an unbound phone sends a code-shaped string that matches no live code
- **THEN** Agenta SHALL reply "That connection link is not valid anymore. Please generate a new one from Agenta and try again." and SHALL write nothing

#### Scenario: Expired or spent code
- **WHEN** an unbound phone sends a code that expired or was already used by another phone
- **THEN** Agenta SHALL send the same "not valid anymore" reply and SHALL write nothing

#### Scenario: Meta re-delivers the completing message
- **WHEN** the message that completed a bind arrives again
- **THEN** Agenta SHALL keep the existing binding and SHALL NOT send a second greeting as an error

#### Scenario: A Telegram token sent to WhatsApp
- **WHEN** a phone sends a code minted for hosted Telegram
- **THEN** Agenta SHALL treat it as unknown

### Requirement: One project per phone
A phone SHALL be bound to at most one project per deployment on the hosted number, and a project's hosted connection SHALL answer with one agent, as on hosted Telegram.

#### Scenario: Phone bound to another project
- **WHEN** a phone bound to project A sends a live code minted in project B
- **THEN** Agenta SHALL reply "This WhatsApp number is connected to another Agenta project. Disconnect it from that project first, then create a new connection link." and SHALL NOT move the binding

#### Scenario: Phone already bound to this project
- **WHEN** a phone bound to project A sends a fresh live code minted in project A
- **THEN** Agenta SHALL reply "This chat is already connected to Agenta. To change the agent, disconnect it in Agenta first." and SHALL NOT consume the code

#### Scenario: Bound phone sends an order number
- **WHEN** a bound phone sends text containing a code-shaped string that matches no code
- **THEN** Agenta SHALL route it to the agent as an ordinary message

### Requirement: Routing by sender phone
Agenta SHALL route every non-bind message on the hosted number by the pair (hosted phone number ID, sender `wa_id`) to the bound project and connection, then through the normal inbox, grants and default agent. Runs SHALL be attributed to the Agenta user who minted the code.

#### Scenario: Bound phone writes
- **WHEN** a bound phone sends "What's on my calendar today?"
- **THEN** Agenta SHALL record the event on the bound project's connection and the connection's agent SHALL answer in the same WhatsApp chat

#### Scenario: Two users in two projects
- **WHEN** phones bound to project A and project B write at the same time
- **THEN** each message SHALL reach only its own project's agent

### Requirement: Unknown senders
Agenta SHALL NOT reply to a message from an unbound phone unless the message is a bind attempt.

#### Scenario: Stranger says hello
- **WHEN** a phone that never bound sends "hello"
- **THEN** Agenta SHALL send nothing and SHALL record nothing in any project's inbox

### Requirement: Unbinding
Disconnecting the hosted WhatsApp connection in Agenta SHALL archive it and free every phone bound to it, so each phone can bind again to any project. STOP and START from a bound phone SHALL keep their bring-your-own meaning and SHALL NOT change the binding.

#### Scenario: Editor disconnects
- **WHEN** an editor disconnects WhatsApp in project A
- **THEN** every phone bound to project A SHALL become unbound, and a later "hello" from those phones SHALL get no reply

#### Scenario: User sends STOP
- **WHEN** a bound phone sends STOP
- **THEN** the phone SHALL stay bound and the agent SHALL not answer until the phone sends START

### Requirement: Connect card
The WhatsApp connect card SHALL offer "Agenta's WhatsApp" and "Your own number" when the hosted number is available, opening on the hosted tab. The hosted tab SHALL show the bind link as a QR code and an "Open WhatsApp" button, poll the connection's bindings, show Connected when a new binding appears, and show an expired state with a way to mint a new link after 30 minutes. It SHALL state the per-project daily message limit.

#### Scenario: Connect from a phone scan
- **WHEN** a user scans the QR code, sends the prefilled message, and the phone binds
- **THEN** the card SHALL move to Connected without any click in the browser

#### Scenario: Link expires unused
- **WHEN** 30 minutes pass with no new binding
- **THEN** the card SHALL show the expired state and a button that mints a new link
