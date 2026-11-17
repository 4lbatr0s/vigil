# ADR-0025: Study agents can see the pictures in a note

## Status
Accepted (2026-11-17).

## Context
Notes hold pasted diagrams and screenshots (ADR-0021), but agents only read text, so a card maker cannot make a card from a labelled diagram. Sending files to a model provider is a privacy decision the owner must make.

## Decision
- A setting, off by default (Settings, Pictures): "agents see pictures" (`GET/PUT /api/images/settings`).
- When on, the card maker (`/api/notes/:id/card-proposals`) and the recall checker (`/api/notes/:id/recall-check`) get up to 4 of the note's own pictures with the task, as image content with a base64 data URL. Only links of the form `![](attachments/<16 hex>.<png|jpg|gif|webp>)` count; the name must match the attachment pattern, so nothing else on disk or the web is read. A missing file is skipped; all together at most 8 MB. These agents have no tools and no write access.
- The run log shows `[+ N pictures]` in the prompt event, never the pictures.
- Ollama is now asked for a 16,384-token window (`VIGIL_LLM_NUM_CTX` overrides) instead of its 4,096 default, because a note, a picture and a thinking model's reasoning shared 4,096 tokens and left an empty reply.

## Consequences
- The pictures go to the owner's model provider, like the note text already does. The setting text says so.
- A model that cannot read images may fail the run or ignore them; the owner turns the setting off then.
- The tutors, quiz master and explain-it-back (chat agents with no tools) get the pictures linked in their opening message, once; later turns and agents with tools do not.
