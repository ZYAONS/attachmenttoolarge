# Release kit — the three recordings

Everything needed to publish tracks 2, 3 and 4 somewhere that accepts uploads.
The audio is in `assets/audio/`, the words are in `assets/js/lyrics.js` and
`assets/js/recordings.js`, and the generation parameters are beside each mp3 in
its `.generation.json`.

## Already published

GitHub Releases — https://github.com/attachment-too-large/attachmenttoolarge/releases/tag/recordings-v1

Permanent links to all three recordings, the cover, and `lyrics.txt`. Published by
`node tools/publish-recordings.mjs --release`, which is idempotent: run it again
with `--tag recordings-v2` to cut a new one, or with no tag to re-upload anything
that is missing.

## Where else they can go, honestly

| Platform | Can this be published from here? | Because |
|---|---|---|
| GitHub Releases | **Yes, done** | Open API, permanent URLs, no account needed beyond the repo's own token |
| Internet Archive | **Yes, with your keys** | Genuinely open upload API. Create a free account, set `IA_ACCESS` / `IA_SECRET`, and the same bundle can go up as a public item — the only streaming-ish host that allows this |
| Audius | Only through their app | Decentralised and free to upload, but the upload flow expects a signed-in artist account |
| SoundCloud, Audiomack | No | Upload needs an account; the old public upload API was closed to new apps |
| Bandcamp, Jamendo, Free Music Archive | No | Account, artist profile and (usually) review before anything appears |
| NetEase Cloud Music, QQ Music | No | Account, phone verification, real-name verification, and a review queue |
| Spotify, Apple Music | No | Nothing uploads directly: it goes through a distributor (DistroKid, Amuse, TuneCore), which is an account and usually a fee |

The short version: **an upload has to come from the account holder.** That is not a
technical limit I can route around — it is the point of those accounts. What can be
prepared is everything the upload needs, and that is this folder plus the release.

## Tracks

| # | File | Title | Genre | Length | Notes |
|---|------|-------|-------|--------|-------|
| 01 | — | Failed at 19:59 | Ambient / lo-fi | loops | Not a file. Synthesised in the browser; there is nothing to upload. |
| 02 | `rap.mp3` | Attachment Too Large | Hip-hop / boom-bap | 2:50 | 320 kbps, 48 kHz, male rap vocal |
| 03 | `wire.mp3` | Wrong Side of the Wire | Soul blues | 2:48 | 320 kbps, 48 kHz, twelve-bar AAB |
| 04 | `ninetynine.mp3` | Ninety-Nine Forever | Synth-pop | 2:48 | 320 kbps, 48 kHz, 1980s production |

## Shared metadata

- **Artist / uploader**: attachmenttoolarge (The Attachment Too Large Society)
- **Album**: One Complaint
- **Language**: English
- **Explicit**: no
- **Lyrics**: available in the repository, and printed on the record page
- **Rights**: the words and the arrangement are ours; each recording was generated
  from those words by ACE-Step, an open-source model, running on a Hugging Face
  Space. Disclose that in the upload form where a service asks whether the audio
  is AI-generated — several now require it.
- **Cover art**: `assets/img/emblem.svg` (the verdigris medallion) or a frame from
  the record screen, `preview/tactical.png`.

## Before uploading anywhere

1. **Check the terms.** NetEase Cloud Music, Spotify, Apple Music and the rest each
   have their own rules about AI-generated audio, and some distributors reject it
   outright. Read the current rule for the service you are uploading to; do not
   assume the answer from a year ago still holds.
2. **Decide who the artist is.** A fictional society cannot hold an account; a real
   person has to, and that person is then responsible for the content and for any
   takedown request.
3. **Keep the licence straight.** The code and the site are MIT. That does not
   automatically cover the recordings; say explicitly what others may do with them.

## What this kit cannot do

An account cannot be created or an upload made on someone else's behalf: signing up
needs a phone number and a CAPTCHA, and the upload has to come from the account
holder. This folder is the material, ready for a person to post.
