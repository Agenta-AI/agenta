# Channel inbound media

## Purpose

Define which inbound message kinds each connected channel passes to the agent as session attachments, and what the sender sees when a kind cannot be passed. Delivery to the agent itself is unchanged: the shared inbox replaces each media part with a stored session attachment, and the runner materializes every attachment as a file in the session working directory, inlining only supported native images into the model prompt.

## ADDED Requirements

### Requirement: WhatsApp media kinds
The WhatsApp adapter SHALL pass inbound `image`, `document`, `audio`, and `video` messages to the agent as media parts. A caption SHALL become a text part before the media part. Stickers, locations, and contact cards SHALL keep the fixed unsupported reply; reactions and system notices SHALL be dropped.

#### Scenario: Voice note
- **WHEN** a customer sends a WhatsApp voice note
- **THEN** the agent SHALL receive the audio file as a session attachment and no fixed refusal SHALL be sent

#### Scenario: Sticker
- **WHEN** a customer sends a sticker
- **THEN** the customer SHALL receive one fixed unsupported reply and no turn SHALL run

### Requirement: Telegram media kinds
The Telegram adapter SHALL pass inbound `photo`, `document`, `voice`, `audio`, `video`, and `video_note` messages to the agent as media parts, on both the custom-bot and hosted-bot paths. For a `photo`, the adapter SHALL pick the largest size Telegram offers. A caption SHALL become a text part before the media parts.

#### Scenario: Bare photo
- **WHEN** a user sends a photo with no caption to a Telegram bot
- **THEN** the agent SHALL receive the image as a session attachment instead of an empty message

#### Scenario: Voice message on the hosted bot
- **WHEN** a user sends a voice message to the hosted Agenta bot
- **THEN** the adapter SHALL download it with the deployment bot token and the agent SHALL receive it as a session attachment

### Requirement: Slack file shares
The Slack adapter SHALL pass each `files` entry that carries a file id to the agent as a media part, next to the message text; an entry without an id SHALL be skipped without failing the message. The stored part SHALL name the file by id only; the adapter SHALL resolve the current private URL through `files.info` at download time, so no private URL is persisted on the inbox event. A file resolved without a downloadable URL (an external or tombstoned file) SHALL surface to the agent as the standard short text note.

#### Scenario: File with a comment
- **WHEN** a Slack user shares a PDF with the comment "please summarize"
- **THEN** the agent SHALL receive the comment as text and the PDF as a session attachment

### Requirement: Adapter downloads with the channel's own credentials
Each adapter SHALL download a named file itself: WhatsApp through the Graph API media endpoint with the connection's access token, Telegram through `getFile` and the file path with the bot token (the deployment token on the hosted path), and Slack through `files.info` and the resolved private download URL with the bot token. A download larger than the platform attachment limit SHALL be reported as too large, and the agent SHALL still see a short text note in place of the file.

#### Scenario: Oversize file
- **WHEN** a user sends a file larger than the platform attachment limit
- **THEN** the agent SHALL receive a text note naming the kind and that it was too large, and the turn SHALL still run

#### Scenario: A failed download does not expose a token
- **WHEN** a Telegram file download returns an HTTP error
- **THEN** the raised error SHALL carry the status code only, never the download URL, because that URL contains the bot token and the dispatcher logs the error message

### Requirement: The platform attachment limit decides what the agent can read
A channel's `files.receive.max_bytes` capability SHALL describe the channel's own cap (Telegram 20 MB, WhatsApp 100 MB, Slack 1 GB). The effective limit SHALL be the platform attachment limit for the file's kind, which is lower: 10 MB for images and documents, 15 MB for audio, and 10 MB for everything else. Video has no kind of its own, so it counts as "other" and is capped at 10 MB.

#### Scenario: A long video
- **WHEN** a user sends a 40 MB video on WhatsApp, which the channel accepts
- **THEN** the agent SHALL receive the "too large to read" text note in place of the video, and the turn SHALL still run

### Requirement: Attachment delivery to the agent is unchanged
The shared pipeline SHALL keep its behavior: media parts become stored session attachments, every attachment is materialized as a file under `attachments/<attachment-id>/<filename>` in the session working directory with a prompt mention, and only supported native image types are additionally inlined into the model prompt. The platform SHALL NOT transcribe audio or extract document contents; acting on a file's content is the harness's responsibility.

#### Scenario: A file sent without a name
- **WHEN** a user sends a file the platform names nowhere (a Telegram photo, voice note, or video note, or a WhatsApp image or voice note)
- **THEN** the attachment SHALL be named `<kind>-<YYYYMMDD-HHMMSS>.<ext>`, using the message's send time in UTC and an extension taken from the file's detected type (for example `audio-20261001-143005.ogg`), so a retried dispatch stores the same name

#### Scenario: Audio reaches the harness as a file
- **WHEN** a voice note is attached to a turn
- **THEN** the model prompt SHALL contain a file mention, not inline audio, and the file SHALL exist in the session working directory
