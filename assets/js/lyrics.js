/* ==========================================================================
   attachmenttoolarge — single: "Attachment Too Large"
   Single source of truth: both the site pages and the music engine read this,
   so the lyrics can never drift apart.

   ★ Want a real vocal instead of the system voice?
     Drop the audio at assets/audio/rap.mp3 and tell us — we will wire it into
     the player and the system voice will step aside automatically.
     Prompt for Suno / ElevenLabs is at the bottom of rap.html.
   ========================================================================== */
window.ATTLYRICS = {
  title: "Attachment Too Large",
  subtitle: "a song about a 20 MB wall",
  artist: "The Attachment Too Large Society",
  bpm: 88,
  style: "boom-bap · late-night office · tape hiss",
  /* One line per two bars. The system voice and the karaoke highlight both
     follow this exact order. */
  sections: [
    {
      label: "INTRO",
      lines: [
        "Eleven forty at night, cursor blinking slow",
        "Dragged the file in and the whole thing froze"
      ]
    },
    {
      label: "HOOK",
      hook: true,
      lines: [
        "Attachment too large, attachment too large",
        "It ain't that I can't send it, it's the line they drew too hard",
        "Attachment too large, attachment too large",
        "Five-five-oh, five-point-three-point-four, I know it by heart"
      ]
    },
    {
      label: "VERSE 1",
      lines: [
        "Twenty-four point seven megabytes of quarterly truth",
        "Progress bar sat at ninety-nine and it never moved",
        "Postmaster wrote back, polite as a priest",
        "\"Put it in a shared location, send a link instead\" — please",
        "But the buyer on the other end? Phone only, never clicks",
        "You say \"just send a link\", I say \"that's how you lose the deal\"",
        "Zero-x-eight-zero-zero-four-zero-six-one-zero, cold little code",
        "Translated into human: this door does not open, no",
        "Dug through the docs for hours, twenty megs is the wall",
        "Thirty-five lives on another product line, page four of it all",
        "Admin said don't touch it, that policy's from the guy before",
        "And I believe him — nobody knows where that chain starts anymore"
      ]
    },
    {
      label: "HOOK",
      hook: true,
      lines: [
        "Attachment too large, attachment too large",
        "It ain't that I can't send it, it's the line they drew too hard",
        "Attachment too large, attachment too large",
        "Five-five-oh, five-point-three-point-four, I know it by heart"
      ]
    },
    {
      label: "VERSE 2",
      lines: [
        "Opened up the folder, every name said \"final\"",
        "Final-two, final-real, final-do-not-edit-at-all",
        "Every single one of them got edited twice",
        "Human optimism, written in the filename, nice",
        "Then I learned one trick: cut it into six and send",
        "Four point one megs a piece, they double-click and it's back again",
        "No sign-up, no strange cloud drive, no link that dies in seven days",
        "No explaining to a stranger why the URL expired again",
        "Too large is not a verdict, it's a setting someone chose",
        "Splitting is the dumb fix, but the dumb one always holds",
        "Past twenty megabytes we still say the whole thing out",
        "Ain't a flex — it's making sure the other side receives it now"
      ]
    },
    {
      label: "OUTRO",
      lines: [
        "Paperclip pops up: \"Need help writing that mail?\"",
        "Yeah, I do — so I went and wrote the tool",
        "Eleven forty failed, so zero-four became a repo",
        "Too large? Then cut it. Piece by piece. Send it. Go."
      ]
    }
  ]
};
