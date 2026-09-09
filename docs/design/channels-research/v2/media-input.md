# Media input for channels (images, voice) — scope and decision

Status: proposal for Mahmoud. Both Slack and Telegram currently read only text, so
images, voice, and files are ignored on both. Verified 2026-09-08: a photo to the
Telegram bot got "I don't see an image attached", a voice note got no reply.

## Why this is not a quick adapter change
The agent's input is a list of content parts that flow: adapter.parse_event →
processed.content → compose_input → ChannelTurnInput.content → the workflow invoke →
the runner → the model. Today every part is `{"type":"text"}`. Adding an image or
audio part means the WHOLE path must carry and understand it, including the shared
sessions/runner layer that the playground also uses. That is a cross-cutting
multimodal change, not a channels-only one, so it needs a deliberate decision.

## Images (recommended first, the model is multimodal)
Plan:
1. Adapter: detect a photo (Telegram `photo`, Slack `files`), pick the largest size,
   download the bytes (Telegram getFile then the file URL with the bot token; Slack
   the private file URL with the bot token), and emit an image content part.
2. Content-part shape: add `{"type":"image", ...}`. Decide the carrier:
   - Option A: a data URL (base64 inline). Simplest, no storage, but large payloads
     bloat the turn and the log.
   - Option B: store the bytes (SeaweedFS, like session attachments) and pass a URL.
     More moving parts, but bounded payloads and reuse of the attachment path.
   Recommendation: Option B if the sessions layer already stores attachments; else A
   for the first cut, capped by size.
3. Sessions/runner: confirm the invoke and the model call forward an image part. This
   is the real integration point and must be checked against the playground's own
   image support before building.

## Voice (needs transcription, bigger)
A voice note has no text. Options:
- Transcribe to text before the agent reads it (a speech-to-text step), then pass the
  transcript as a text part with a marker. Needs a transcription service/model.
- Pass the audio to a model that accepts audio. gpt-5.6-luna's audio support is
  unconfirmed; likely not.
Recommendation: defer voice until images land, then add transcription as its own step.

## Open questions for Mahmoud
1. Do the sessions layer and gpt-5.6-luna already accept an image content part, the way
   the playground does? (This decides whether images are days or hours of work.)
2. Data URL vs stored-and-referenced for image bytes?
3. Is voice in scope for the first release, or a fast-follow?

## Shared, not per-channel
Whatever we build goes in the shared channels layer (download + content-part shaping),
so Slack and Telegram both get it from one implementation.


## Investigation update (2026-09-09): image support IS buildable
The platform already has the pieces, so images are not a missing-infrastructure blocker:
- `core/sessions/attachments/` is a full attachments subsystem with `AttachmentKind.IMAGE`,
  media-type validation, and a size cap (`max_image_bytes`). The playground uploads images here.
- The session input carries `PendingInputAttachment` (an `attachment_id`), so a message
  references an uploaded attachment by id.
- The runner already handles images: codex-acp expands an ACP image into an inline data URL for
  the model call.

Concrete integration path for channels (Slack + Telegram, shared layer):
1. Adapter: detect a photo, download the bytes (Telegram getFile + file URL; Slack private URL).
2. Upload the bytes through the attachments service -> get an attachment_id.
3. Pass the attachment through the channel invoke. Today `_invoke_via_workflows_service` sends
   only `inputs.messages[].content` (text). It must also carry the attachment id, the way the
   playground's input does (`PendingInputAttachment`).
4. The runner then forwards the image to the model.

Two things still need Mahmoud before building:
- SCOPE: confirm images are in scope for this release (he flagged the gap; did not confirm "now").
- MODEL VISION: the current QA model is gpt-5.6-luna via the Pi harness. The runner's image
  expansion is codex-acp-specific; whether the Pi harness/gpt-5.6-luna accepts images is
  unconfirmed. A vision-capable model is required to actually process the image.

Recommendation: confirm scope + a vision model, then build the four steps above in the shared
layer (a day of work, both channels at once). Voice still needs a transcription step and stays
after images.
