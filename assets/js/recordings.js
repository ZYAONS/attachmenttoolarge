/* ==========================================================================
   attachmenttoolarge — alternate recordings

   These are NOT re-tellings of the rap. Each is its own song: its own words, its
   own arrangement, its own name. They share only the subject — a file that will
   not fit, and a person waiting on it.

     wire        — electric Memphis soul-blues. Twelve-bar AAB throughout, tremolo
                   guitar and Hammond organ, horn stabs, gospel backing voices,
                   deep baritone. Rain, a wire that will not carry, an office girl
                   who says call again.
     ninetynine  — 80s neon synth-pop. Gated-reverb drums, arpeggiated analog
                   synths, fretless bass, falsetto hook. About the progress bar
                   itself, the one that stops at ninety-nine and stays there.

   Rendered by tools/music-ai/generate-version.mjs — nothing is downloaded locally.
   ========================================================================== */
window.ATTRECORDINGS = [
  {
    id: "wire",
    title: "Wrong Side of the Wire",
    style: "electric Memphis soul-blues, twelve-bar in E, tremolo guitar, Hammond organ, " +
           "horn section stabs, gospel backing voices, swinging shuffle, deep male baritone, " +
           "room mics, late-night studio, warm and wide",
    note: "Not a retelling — a different night entirely. Rain, a wire that will not carry, " +
          "and a man being politely told to call again.",
    sections: [
      { label: "INTRO", lines: [
        "Rain on the window, and the wire don't carry me tonight"
      ]},
      { label: "VERSE 1", lines: [
        "Rain on the window, and the wire don't carry me tonight",
        "Rain on the window, and the wire don't carry me tonight",
        "I got a whole lot of nothin' that I'm tryin' to send outright"
      ]},
      { label: "VERSE 2", lines: [
        "The machine in the basement, it hums like a tired man",
        "The machine in the basement, it hums like a tired man",
        "It counted every byte I gave it, and it told me what it can't"
      ]},
      { label: "CHORUS", lines: [
        "Wrong side of the wire, wrong side of the line",
        "Wrong side of the wire, wrong side of the line",
        "Ain't no use in knockin' — that door was built too fine"
      ]},
      { label: "VERSE 3", lines: [
        "I called up the office, the girl said call again",
        "I called up the office, the girl said call again",
        "So I'm standin' in the weather with a number and a name"
      ]},
      { label: "VERSE 4", lines: [
        "Somewhere there's a man who could open up that gate",
        "Somewhere there's a man who could open up that gate",
        "He's gone on vacation, baby, and I ain't got time to wait"
      ]},
      { label: "OUTRO", lines: [
        "So I fold it in my pocket, and I walk it down the street",
        "Fold it in my pocket, walk it down the street",
        "'Cause a wire ain't a river, and a limit ain't a sea"
      ]}
    ]
  },
  {
    id: "ninetynine",
    title: "Ninety-Nine Forever",
    style: "80s neon synth-pop, gated reverb drums, sparkly arpeggiated analog synths, " +
           "fretless bass, glassy electric piano, falsetto male hook, wide chorused guitars, " +
           "night-drive production, big 1985 chorus",
    note: "About the progress bar itself: the one that reaches ninety-nine, stops, and stays " +
          "there while you rearrange your whole evening around it.",
    sections: [
      { label: "INTRO", lines: [
        "(Ninety-nine, ninety-nine)"
      ]},
      { label: "VERSE 1", lines: [
        "Midnight in the office and the lights are on for no one",
        "I'm watching a rectangle lie to me in slow motion",
        "It says ninety-nine, it says ninety-nine",
        "It's been saying ninety-nine since I was twenty-five"
      ]},
      { label: "PRE-CHORUS", lines: [
        "Tell me something true, tell me something true",
        "Is it you that's tired, or is it me that's holding on?"
      ]},
      { label: "CHORUS", lines: [
        "Ninety-nine forever, never a hundred",
        "Ninety-nine forever, don't you leave me hanging here",
        "I'll wait until the morning, I'll wait until the wire is clear",
        "Ninety-nine forever, and I'm still right here"
      ]},
      { label: "VERSE 2", lines: [
        "I bought a bigger mailbox, I paid a man to raise the ceiling",
        "I asked that man politely: is there any room for feeling?",
        "He said the policy's from long ago, the policy is a stone",
        "And what a stone decides is what a stone decides alone"
      ]},
      { label: "BRIDGE", lines: [
        "(If it never lands, if it never lands)",
        "I'll cut it into six and I will carry it in my hands",
        "(If it never lands, if it never lands)",
        "I'll carry it in pieces to the far end of the land"
      ]},
      { label: "OUTRO", lines: [
        "Ninety-nine, ninety-nine — never a hundred",
        "(Ninety-nine, ninety-nine)"
      ]}
    ]
  }
];
