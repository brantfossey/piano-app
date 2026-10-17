// Instructions an AI assistant can follow to turn sheet music into importable song JSON.
export const AI_PROMPT = `You are transcribing sheet music into JSON for the "Chord Fluency Piano" app.
Output ONLY valid JSON (no comments, no markdown). One song = one object; several songs = {"songs":[...]}.

{
  "format": "piano-song", "version": 1,
  "title": "Song title", "composer": "Composer / lyricist", "source": "Book or URL, page",
  "placeholder": false,
  "key": "G",                 // major "C","Eb","F#"; minor "Am","F#m"
  "timeSignature": "3/4",
  "tempo": 76,                // quarter-note beats per minute
  "pickupBeats": 1,           // length of the pickup (anacrusis) bar in quarter-note beats, 0 if none
  "melodyText": "| D4:1 | G4:2 B4:0.5 G4:0.5 | ... |",
  "chordsText": "| N.C. | G | G7 | C | G D7 | ... |",
  "lyricsText": "[Verse 1]\nA[G]mazing [G7]grace, how [C]sweet the [G]sound\n...",   // OPTIONAL lyrics with chords
  "arrangement": {            // OPTIONAL: only if the sheet music has a written left hand / full piano part
    "leftHandText": "| r:1 | G2+D3:3 | ... |",
    "rightHandText": "| D4:1 | B3+D4+G4:2 ... |"   // optional full right hand incl. harmony notes
  }
}

NOTE TEXT RULES (melodyText, leftHandText, rightHandText)
- Tokens separated by spaces. "|" = bar line (used to check bar lengths; always write them).
- A note: pitch + ":" + duration, e.g. G4:1. Middle C is C4. Sharps "#", flats "b": F#4, Bb3.
  Write the pitch that sounds (apply the key signature and accidentals yourself: in G major an F is F#).
- Several notes struck together: join with "+", e.g. C3+E3+G3:2.
- Rest: r:duration. Durations are in QUARTER-NOTE BEATS: whole 4, dotted half 3, half 2, dotted quarter 1.5,
  quarter 1, dotted eighth 0.75, eighth 0.5, sixteenth 0.25, triplet eighth 1/3, quarter-note triplet 2/3.
  Letters also work: w h q e s, "." for dotted (h. = 3), "t" for triplet (et = 1/3).
- If you omit ":duration" the previous duration is reused.
- Ties: write one note with the combined duration (it may cross a bar line; that bar will show a warning, which is OK).
- In 6/8, a bar is 3 quarter-beats (six eighths = 6 x 0.5).
- melodyText = the top melody line only (one note at a time). Optional lyric syllable: G4:1"grace" (no spaces inside quotes).
- The FIRST bar is the pickup bar when pickupBeats > 0; the final bar may be short to complete the pickup.

CHORD TEXT RULES (chordsText)
- One "|"-separated bar per measure, in the same order as the melody, starting with the pickup bar if any (use N.C. there).
- Chords without a duration share the bar equally: "| C G |" in 4/4 = 2 beats each. Explicit: "| C:3 G7:1 |".
- "%" repeats the previous chord, "N.C." = no chord.
- Symbols: C, Cm, C7, Cmaj7, Cm7, Cdim, Cdim7, Cm7b5, Caug, Csus2, Csus4, C7sus4, C6, Cm6, Cadd9, C9, Cmaj9, Cm9, C6/9, C7b9, C13, C5,
  and slash chords like G/B, C/E, D7/F#. Use the chord symbols printed on the music; if there are none, infer
  simple diatonic harmony and set "source" to say the chords were inferred.

LYRICS & CHORDS (lyricsText, optional; used by the Lyrics & Chords play-along view)
- ChordPro style: put each chord in [brackets] directly before the syllable where it changes: "A[G]mazing [G7]grace".
  A chord at the end of a line with no words under it is fine: "like [D]me [D7]".
- One lyric line per line (use \n inside the JSON string); an empty line between verses.
- A line that is only "[Verse 1]", "[Chorus]", "[Bridge]" (not a chord symbol) is a section heading.
- Same chord symbols as chordsText. Write the chords in the order they are played, repeating verses in full;
  write a chord again only where it changes or is struck again. [N.C.] = no chord.
- Only include lyrics that are public domain or that the user owns; otherwise leave lyricsText out.

QUALITY CHECKLIST
- Every full bar must add up to the time signature (4/4 = 4 beats, 3/4 = 3, 2/4 = 2, 6/8 = 3).
- Melody range check: hymn/pop melodies usually sit between C4 and G5.
- Set "placeholder": true if you simplified or are unsure; describe what was simplified in "source".
- Arrays are also accepted instead of text, e.g. "melody":[{"beat":0,"dur":1,"pitch":"D4"}] and
  "chords":[{"beat":1,"dur":3,"symbol":"G"}] where beat = quarter-note position from the start (pickup starts at 0).`;
