# Proposal

## Why

WhatsApp customers can send an agent images and documents; Slack and Telegram users cannot, even though the whole delivery pipeline behind WhatsApp media is channel-agnostic. A photo sent to a Telegram bot today arrives as an empty message, a file shared in Slack arrives as its comment text only, and a WhatsApp voice note gets a canned refusal. The gap is only in the per-channel adapters.

Status: Requested by Mahmoud on 2026-09-25 ("all the paths have all of these kinds"). Direction confirmed the same day: images stay native where the model supports them; every other kind, including audio and PDF, reaches the agent as a workspace file, and understanding that file is the harness's problem, not the platform's.

## What Changes

- Slack, Telegram (custom and hosted bot), and WhatsApp all pass inbound files to the agent as session attachments, the way WhatsApp already passes images and documents.
- WhatsApp additionally accepts `audio` (voice notes) and `video` messages as attachments instead of replying "I can read text, images and documents here."
- Telegram accepts `photo`, `document`, `voice`, `audio`, `video`, and `video_note` messages as attachments; a caption stays a leading text part. The Telegram capabilities declare file receive supported up to the Bot API's 20 MB download cap.
- Slack reads the `files` array on a message and passes each entry as an attachment next to the message text.
- The shared "unsupported message" reply wording changes to name files and voice notes, since only stickers, locations, and contact cards remain unsupported on WhatsApp.
- No change to how attachments reach the agent. The existing inbox `_attach_media` step and the runner keep their behavior: native image types are inlined into the model prompt where the harness, adapter, and model support them; everything else is materialized as a file at `attachments/<id>/<filename>` in the session working directory with a prompt mention. Transcribing audio or parsing a PDF is the harness's concern.
- Sending files from the agent back out to a channel stays out of scope; no channel supports it yet.

## Capabilities

### New Capabilities

- `channel-inbound-media`: which inbound message kinds each channel passes to the agent as attachments, and how each adapter downloads them.

### Modified Capabilities

None structurally. The WhatsApp conversation spec's media requirement is generalized by this change (audio and video move from the fixed-reply list to attachments); the Slack and Telegram adapters gain the same behavior.

## Impact

Backend only, all inside `api/oss/src/core/channels/adapters/` plus one shared string:

- `whatsapp/mapping.py`: `audio` and `video` join `_MEDIA_TYPES`.
- `telegram/mapping.py` and `telegram/adapter.py`: media parts in `parse_event`, a `fetch_media` implementation over `getFile`; `telegram_hosted/adapter.py` overrides only the token source.
- `slack/adapter.py`: media parts from `event.files` in `parse_event`, a `fetch_media` implementation over `url_private_download`. The manifest already requests `files:read`.
- `telegram/capabilities.py`: `files.receive` flips to supported, 20 MB.
- `render/render.py`: `UNSUPPORTED_TEXT` wording.

No schema, route, frontend, or runner changes. Attachment size limits stay the platform's existing ones (10 MB images and documents, 15 MB audio, 10 MB other); an oversize file degrades to a short text note, as today.
