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

- [x] 3.1 Emit one media part per `event.files` entry in `parse_event`, named by file id only; skip entries without an id. A file-only share carries no empty text part.
- [x] 3.2 Implement `fetch_media`: resolve the id through `files.info` at download time (no private URL is stored on the event), then download with the bot token; refuse an HTML (login page) response.
- [x] 3.3 Unit tests: mapping with files, files.info resolution plus download over the fake, size refusal.

## 4. Review follow-ups

- [x] 4.1 Telegram `fetch_media` raises a status-only error on a failed download instead of `raise_for_status()`, whose message carries the token-bearing URL into the dispatcher's warning log. Unit test asserts the token is absent.
- [x] 4.2 A file without a platform filename is stored as `<kind>-<send time>.<ext>`, with the extension from the detected type. Built from the message, not the clock, so the attachment idempotency check still matches on retry.
- [x] 4.3 Spec states that the platform attachment limit (10 MB, 15 MB audio; video counts as other) is the effective cap, below each channel's advertised `files.receive.max_bytes`.

## 5. Out of scope

- Sending files from the agent to any channel.
- Transcription or document parsing anywhere in the platform; the harness owns file content.
