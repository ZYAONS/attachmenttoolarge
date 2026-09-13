/* ==========================================================================
   attachmenttoolarge — alternate recordings of the same story

   The single "Attachment Too Large" started as a boom-bap rap (assets/js/lyrics.js).
   These are two more treatments of the same complaint, each written in the form the
   genre actually uses, because a blues that is not AAB is just a rap with a guitar:

     blues — twelve-bar AAB. First line stated, second line repeated, third line
             answers it. That repetition is the form, not laziness.
     pop   — verse / pre-chorus / chorus with a gang-vocal hook, a bridge, and a
             key-lift in the last chorus. Built to be shouted, not studied.

   Generated the same way as the rap: tools/music-ai/generate-version.mjs.
   ========================================================================== */
window.ATTRECORDINGS = [
  {
    id: "blues",
    title: "Attachment Too Large (Blues)",
    style: "delta blues turned Chicago, twelve-bar in A, slide guitar and harmonica, " +
           "walking upright bass, shuffled brushes, gravelly male lead, call and response, " +
           "warm tube amp, juke-joint room, recorded late",
    note: "The same story told the way it would be told on a porch: twelve bars, AAB, " +
          "and the mailman carrying the shards one at a time.",
    sections: [
      { label: "INTRO", lines: [
        "Woke up this mornin', that progress bar was still at ninety-nine"
      ]},
      { label: "VERSE 1", lines: [
        "Woke up this mornin', that progress bar was still at ninety-nine",
        "I been waitin' on a spreadsheet, Lord, since seven fifty-nine",
        "Postmaster wrote me a letter, said son your file's too fat",
        "Said put it in a shared location — but my buyer ain't got that"
      ]},
      { label: "CHORUS", lines: [
        "Twenty megabytes of trouble, thirty-three when you count the code",
        "Twenty megabytes of trouble, thirty-three when you count the code",
        "So I cut it into pieces, and I carried that heavy load"
      ]},
      { label: "VERSE 2", lines: [
        "Every name in my folder, it say final, final-two",
        "Every name in my folder, it say final, final-two",
        "And every single one of 'em got edited — same as me and you"
      ]},
      { label: "OUTRO", lines: [
        "So mailman, take my shards now, one by one and slow",
        "Mailman, take my shards now, one by one and slow",
        "'Cause a big file ain't a bad man, he just got nowhere to go"
      ]}
    ]
  },
  {
    id: "pop",
    title: "Attachment Too Large (Anthem)",
    style: "anthemic arena pop rock, stomp-and-clap drums, huge gang-vocal whoa-ohs, " +
           "punchy synth bass, bright chugging guitars, soaring male lead, " +
           "stadium chorus, modern radio production, key lift on the final chorus",
    note: "The same complaint, built for a stadium: stomps, claps, a hook the whole " +
          "room can shout, and one last chorus a step higher.",
    sections: [
      { label: "INTRO", lines: [
        "(Whoa-oh, whoa-oh)"
      ]},
      { label: "VERSE 1", lines: [
        "Nineteen fifty-nine and the cursor's still blinking",
        "Twenty-four point seven and the whole room's sinking",
        "Postmaster's letter with a polite little lie",
        "Put it in a shared location — well, I won't say goodbye"
      ]},
      { label: "PRE-CHORUS", lines: [
        "I count the megabytes, I count 'em all night",
        "Thirty-three when the code is done — that's the number I fight"
      ]},
      { label: "CHORUS", lines: [
        "So cut it up! Cut it up! I'm not giving in",
        "Send it out in pieces till the other side wins",
        "Cut it up! Cut it up! Let the pieces fly",
        "A big file's not a crime — it's just a bigger sky",
        "(Whoa-oh, whoa-oh)"
      ]},
      { label: "VERSE 2", lines: [
        "Every folder in the city says final, final-two",
        "Stomp your feet on the floor, that's what editors do",
        "I learned me a trick: six shards and a hash",
        "They double-click on the other side — no cloud, no cash"
      ]},
      { label: "BRIDGE", lines: [
        "When the bar hits ninety-nine",
        "And you're running out of time",
        "You don't need a link tonight",
        "You just need to split the light"
      ]},
      { label: "OUTRO", lines: [
        "Too large? Then cut it. Piece by piece. Send it. Go!",
        "(Whoa-oh, whoa-oh)"
      ]}
    ]
  }
];
