# Tasks

Requested by Mahmoud on 2026-09-25: images native where supported, everything else as workspace files, on all three channels.

## 1. WhatsApp

- [x] 1.1 Add `audio` and `video` to `_MEDIA_TYPES`; keep sticker, location, and contacts on the fixed reply. Update the mapping tests.
- [x] 1.2 Update the capabilities comment and the shared `UNSUPPORTED_TEXT` wording.

## 2. Telegram

- [x] 2.1 Emit media parts for `photo` (largest size), `document`, `voice`, `audio`, `video`, and `video_note` in `parse_event`; caption stays a leading text part.
- [x] 2.2 Implement `fetch_media` over `getFile` and the file download path; the hosted adapter overrides only the token source.
- [x] 2.3 Flip `files.receive` to supported with the Bot API's 20 MB cap; hosted capabilities inherit.
- [x] 2.4 Unit tests: mapping per kind, fetch over a mock transport, hosted token override.

## 3. Slack

- [x] 3.1 Emit one media part per `event.files` entry in `parse_event`; skip entries without a private download URL.
- [x] 3.2 Implement `fetch_media` over `url_private_download` with the bot token; refuse an HTML (login page) response.
- [x] 3.3 Unit tests: mapping with files, fetch over the fake, size refusal.

## 4. Out of scope

- Sending files from the agent to any channel.
- Transcription or document parsing anywhere in the platform; the harness owns file content.
