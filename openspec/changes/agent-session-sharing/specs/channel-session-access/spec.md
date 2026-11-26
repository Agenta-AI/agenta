## ADDED Requirements

### Requirement: Channel sessions follow the agent's visibility
A channel (Slack, Telegram) session SHALL take its policy from the agent of the channel turn that creates it, also when the sender is a linked Agenta user. For a project-visible agent, the session SHALL be project-visible with no owner. For a private agent, the session SHALL be private and owned by the agent's owner. This rule SHALL take precedence over the general ownership rule. Existing sessions SHALL keep their policy. The installation setup screen SHALL state this audience.

#### Scenario: Linked Slack sender, project agent
- **WHEN** Alice, a linked Slack user, starts a thread with an installed project-visible agent
- **THEN** the session has no owner, Alice is the turn sender only, and members can read the session in Agenta and send to it

#### Scenario: Private agent
- **WHEN** someone in a Telegram chat writes to Alice's private agent
- **THEN** the session is private and owned by Alice; only Alice and the people she shares it with see it in Agenta

### Requirement: Members write to channel sessions in Agenta
A channel session SHALL follow the same send rules as any other session: a project-visible one gives Participant to members with the project capability, and a private one gives send to its owner and its participants. A send from Agenta SHALL run the turn in the channel session.

#### Scenario: Member writes to a Slack chat in Agenta
- **WHEN** Bob, a project Editor, opens a project-visible session that comes from Slack and sends a message
- **THEN** the turn runs and the answer shows in Agenta

### Requirement: Private agents may answer in channels
A channel agent of a private agent SHALL be active. Only the agent's owner SHALL write an active channel agent of a private agent; anyone else SHALL get the answer for an unknown agent. Making an agent private SHALL NOT change its channel agents. Everyone in the channel SHALL be able to talk to the agent.

#### Scenario: Agent made private
- **WHEN** Alice makes an installed agent private
- **THEN** new Slack messages still get an agent turn, and their new sessions are private to Alice

#### Scenario: Install a private agent of someone else
- **WHEN** Bob activates a channel agent for Alice's private agent
- **THEN** the service answers as for an unknown agent

### Requirement: A channel turn of a private agent runs under its owner's binding
At admission, the installation principal SHALL be allowed to run a private agent on its own channel turn (run origin `installation`) when the binding's creator is the agent's owner. A child run of that turn SHALL NOT be allowed. The same binding SHALL read, run and edit the private channel sessions its creator owns; another binding SHALL NOT.

#### Scenario: Another binding
- **WHEN** a binding that Bob created tries to run Alice's private agent or to read its channel session
- **THEN** the decision refuses it

### Requirement: Only the channel's run creates a channel session
A session id that a channel thread names SHALL be created only by that channel's run. Any other first touch SHALL create nothing and SHALL be answered as a hidden session.

#### Scenario: A member renames a channel thread's session first
- **WHEN** Bob renames a channel thread's session id before the channel's run created it
- **THEN** no row is created, and the channel's run later creates it with the channel policy

### Requirement: Channel activation is serialized with policy writes
Activating a channel agent SHALL lock the artifact row, read its current policy without a cache, and write the channel agent in the same transaction. Channel references in the `workflow` and the `application` families SHALL both be resolved; references that name no agent SHALL be refused.

#### Scenario: Activation races with make-private
- **WHEN** Alice activates a channel agent while she makes the agent private
- **THEN** both writes commit in some order, and the private agent keeps its active channel agent

#### Scenario: Application-family reference
- **WHEN** a channel agent names its agent by `application_revision`
- **THEN** the reference is resolved to the agent and its policy is checked
