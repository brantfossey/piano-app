// Seed songs. These are SIMPLE PLACEHOLDERS (simplified, public-domain tunes) for testing the app,
// not authoritative transcriptions. They are written in the AI-friendly text notation.
export const SEED_SONGS = [
  {
    format: 'piano-song', version: 1,
    id: 'seed-amazing-grace',
    title: 'Amazing Grace (simple placeholder)',
    composer: 'Traditional (tune "New Britain"), public domain',
    source: 'Simplified placeholder melody typed from memory — verify against real sheet music',
    placeholder: true,
    tags: ['hymn', 'placeholder'],
    key: 'G', timeSignature: '3/4', tempo: 72, pickupBeats: 1,
    melodyText: `| D4:1"A-"
      | G4:2"ma-" B4:0.5"zing" G4:0.5 | B4:2"grace" A4:1"how" | G4:2"sweet" E4:1"the" | D4:2"sound" D4:1"that"
      | G4:2"saved" B4:0.5"a" G4:0.5 | B4:2"wretch" A4:1"like" | D5:3"me" | D5:2 B4:1"I"
      | D5:2"once" B4:0.5"was" G4:0.5 | B4:2"lost" A4:1"but" | G4:2"now" E4:1"am" | D4:2"found" D4:1"was"
      | G4:2"blind" B4:0.5"but" G4:0.5 | B4:2"now" A4:1"I" | G4:3"see" | G4:2 |`,
    chordsText: `| N.C. | G | G7 | C | G | G | Em | D | D7 | G | G7 | C | G | Em | D7 | G | G |`,
    // Lyrics & Chords view: chords in [brackets] sit above the syllable where they change (John Newton, 1779, public domain).
    lyricsText: `[Verse 1]
A[G]mazing [G7]grace, how [C]sweet the [G]sound
That saved a [Em]wretch like [D]me [D7]
I [G]once was [G7]lost, but [C]now am [G]found,
Was [Em]blind, but [D7]now I [G]see.

[Verse 2]
'Twas [G]grace that [G7]taught my [C]heart to [G]fear,
And grace my [Em]fears re[D]lieved; [D7]
How [G]precious [G7]did that [C]grace ap[G]pear
The [Em]hour I [D7]first be[G]lieved.`,
  },
  {
    format: 'piano-song', version: 1,
    id: 'seed-ode-to-joy',
    title: 'Ode to Joy (simple placeholder, with left hand)',
    composer: 'Ludwig van Beethoven (public domain)',
    source: 'Simplified placeholder; includes a hand-written block-chord left hand as an example arrangement',
    placeholder: true,
    tags: ['classical', 'placeholder', 'beginner'],
    key: 'C', timeSignature: '4/4', tempo: 96, pickupBeats: 0,
    melodyText: `| E4:1 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:0.5 D4:2
                 | E4:1 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2 |`,
    chordsText: `| C | G | C | G | C | G | C G | G C |`,
    arrangement: {
      style: 'manual',
      leftHandText: `| C3+E3+G3:4 | B2+D3+G3:4 | C3+E3+G3:4 | B2+D3+G3:4
                     | C3+E3+G3:4 | B2+D3+G3:4 | C3+E3+G3:2 B2+D3+G3:2 | B2+D3+G3:2 C3+E3+G3:2 |`,
    },
  },
  {
    format: 'piano-song', version: 1,
    id: 'seed-the-entertainer',
    title: 'The Entertainer – opening theme (simple placeholder)',
    composer: 'Scott Joplin, 1902 (public domain)',
    source: 'Heavily simplified placeholder of the A theme — not the original rhythm/harmony',
    placeholder: true,
    tags: ['ragtime', 'placeholder'],
    key: 'C', timeSignature: '2/4', tempo: 76, pickupBeats: 0.5,
    melodyText: `| D4:0.25 D#4:0.25
      | E4:0.25 C5:0.5 E4:0.25 C5:0.5 E4:0.25 C5:0.25 | C5:1.25 C5:0.25 D5:0.25 D#5:0.25
      | E5:0.25 C5:0.25 D5:0.25 E5:0.5 B4:0.25 D5:0.5 | C5:1.5 D4:0.25 D#4:0.25
      | E4:0.25 C5:0.5 E4:0.25 C5:0.5 E4:0.25 C5:0.25 | C5:1.5 A4:0.25 G4:0.25
      | F#4:0.25 A4:0.25 C5:0.25 E5:0.5 D5:0.25 C5:0.25 A4:0.25 | D5:1.5 D4:0.25 D#4:0.25
      | E4:0.25 C5:0.5 E4:0.25 C5:0.5 E4:0.25 C5:0.25 | C5:1.25 C5:0.25 D5:0.25 D#5:0.25
      | E5:0.25 C5:0.25 D5:0.25 E5:0.5 B4:0.25 D5:0.5 | C5:2 |`,
    chordsText: `| N.C. | C | C | C G7 | C | C | C | D7 | G7 | C | C7 | F G7 | C |`,
  },
  {
    format: 'piano-song', version: 1,
    id: 'seed-saints',
    title: 'When the Saints Go Marching In (simple placeholder)',
    composer: 'Traditional (public domain)',
    source: 'Simplified placeholder melody',
    placeholder: true,
    tags: ['gospel', 'placeholder'],
    key: 'F', timeSignature: '4/4', tempo: 100, pickupBeats: 3,
    melodyText: `| F4:1"Oh" A4"when" Bb4"the"
      | C5:4"saints" | r:1 F4:1"go" A4"march-" Bb4"ing" | C5:4"in" | r:1 F4:1"oh" A4"when" Bb4"the"
      | C5:2"saints" A4:2"go" | F4:2"march-" A4:2"ing" | G4:4"in" | r:1 A4:1"oh" A4"Lord" G4"I"
      | F4:3"want" F4:1"to" | A4:2"be" C5:1"in" C5 | C5:1"that" Bb4:3"num-" | r:1 A4:1"ber" Bb4"when" C5"the"
      | A4:2"saints" F4:2"go" | G4:2"march-" G4:2"ing" | F4:4"in" | r:1 |`,
    chordsText: `| N.C. | F | F | F | F | F | F | C7 | C7 | F | F7 | Bb | Bb | F | C7 | F | F |`,
    lyricsText: `Oh when the [F]saints go marching in,
Oh when the saints go marching [C7]in,
Oh Lord, I [F]want to [F7]be in [Bb]that number,
When the [F]saints go [C7]marching [F]in.`,
  },
];
