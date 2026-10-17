# Chord Fluency Piano

A static browser app (plain HTML/CSS/JS ES modules, no build step) built for a pianist who reads the
right hand well and wants to get fluent with chords. You connect a Yamaha CVP (or any MIDI keyboard)
over USB, and the app shows what you play on a keyboard and a grand staff and names the chord live.
It has play-along modes, an arrangement generator and chord drills.

## Run it

```bash
cd piano-app
python3 -m http.server 8080          # or: npx serve .   (any static file server works)
# open http://localhost:8080 in Chrome or Edge
```

* **Web MIDI needs a secure context.** `http://localhost` counts as secure. If you deploy the app,
  serve it over **https** (GitHub Pages, Netlify, Cloudflare Pages, S3+CloudFront and so on). It's just
  static files: upload the whole folder.
* Opening `index.html` straight from disk (`file://`) won't work, because browsers block ES modules there.
* **Browsers:** Chrome or Edge on Windows/macOS/Linux, and **Chrome on Android** (connect the piano with a
  USB-OTG adapter). Safari and iOS don't support Web MIDI. You can still use the on-screen keyboard and the
  computer keyboard there.
* **Yamaha CVP:** connect the piano's **USB TO HOST** port to the computer/phone. A USB-MIDI interface on
  MIDI OUT also works. Click **Connect MIDI**, then pick the input. The app picks a Yamaha/CVP/"Digital Piano"
  port automatically. If the CVP's style accompaniment or extra parts send notes on other channels, set **Ch** to `1`.
  You can choose the CVP as the **Output** so accompaniment and "Listen" play through the piano's own sound.
  Otherwise a small built-in synth plays them.
* With no piano connected, click the on-screen keys or use the computer keyboard: `Z S X D C V G B H N J M ,` = C3–C4,
  and `Q 2 W 3 E R 5 T 6 Y 7 U I` = C4–C5.

### Tests

```bash
node --test tests/        # 26 tests: theory, chord detection, song format, arranger, practice engines, simulated MIDI, trainer
```

Every engine is pure JS with no DOM, so the tests feed it **simulated MIDI bytes** (`[0x90, note, vel]`,
note-off, CC64 sustain, Yamaha active-sensing `0xFE`) and simulated performances with exact timestamps.
The UI was also tested in headless Chrome with a fake `navigator.requestMIDIAccess` device named "Digital Piano-1".
Screenshots are in `tests/screens/`. In the browser console you can call `cfp.sim([60,64,67])` to "play" a chord.

## Features

| Area | What it does |
|---|---|
| **MIDI** | Input/output device picker, channel filter, sustain pedal, hot-plug. Optional monitoring through the built-in synth. |
| **Live display** | Pressed keys light up on an 88/61/49-key keyboard. Notes are drawn on a grand staff, spelled for the current key. The chord name updates live (triads, 6ths, 7ths, 9ths, sus, dim/half-dim, aug, slash chords/inversions, alternative names). |
| **Library** | Stored in IndexedDB (falls back to localStorage). Import `.json` files (a single song, an array, or a bundle), paste JSON, export one song or all, restore the examples, and **Copy AI prompt**. |
| **Editor** | Metadata fields plus text areas for melody, chords, optional LH/RH arrangement. Live score preview with bar-length checks. **Step entry** from MIDI: play a note or chord and it's appended with the selected duration, or the detected chord symbol goes into the chord line. Raw JSON view. |
| **Arranger** | Styles: **pop ballad, ragtime stride, gospel/hymn, country**. LH patterns: **block, broken (arpeggio), stride/boom-chick** (or the style default). Voice-led LH chords, octave bass in ragtime, alternating bass and walk-ups in country/gospel, RH chord-tone fills under the melody. Can be saved into the song. |
| **Play-along** | **Wait for me** only moves on when you play the correct notes or chord. **Steady tempo** has a metronome, count-in and scoring (perfect ≤60 ms, good ≤120 ms, ok ≤ window; hits, misses, extra notes, rushing/dragging). Parts: right hand, left hand, both, **melody + chord symbols** (LH plays the named chord in any voicing), or chord symbols only. Auto-play the other hand, keyboard hints, bar range, loop, click a bar to start there, Listen. |
| **Chord trainer** | Drills chords and inversions in all 12 keys. Pick chord types (maj, m, dim, aug, sus4, 7, maj7, m7, m7b5, dim7, 6) and inversions (root, 1st, 2nd, 3rd). Order can be random, circle of fifths or chromatic. **Progression drills** in all keys: I–IV–V–I (voice-led inversions), I–vi–IV–V, ii7–V7–Imaj7, I–I7–IV–iv, I–V7–I. Live MIDI feedback tells you about missing or extra notes and wrong inversions. Optional 5-second limit, streaks, and stats per chord type/inversion and per root (slowest first). |

The 4 example songs (**Amazing Grace, Ode to Joy, The Entertainer opening, When the Saints**) are
**simple placeholders**: simplified public-domain tunes typed from memory and marked `"placeholder": true`.
Replace them with proper transcriptions.

---

## Song JSON format (for people and AI assistants)

The format was designed so an assistant can write it straight from sheet music. You can write each part
**either as compact text (recommended)** or as explicit event arrays. The importer accepts both,
reports errors (bad pitch, unknown chord) and warnings (a bar's length doesn't match the time signature).

### Minimal example (text form)

```json
{
  "format": "piano-song",
  "version": 1,
  "title": "Amazing Grace",
  "composer": "Traditional",
  "source": "Hymnal p. 123",
  "placeholder": false,
  "key": "G",
  "timeSignature": "3/4",
  "tempo": 72,
  "pickupBeats": 1,
  "melodyText": "| D4:1 | G4:2 B4:0.5 G4:0.5 | B4:2 A4:1 | G4:2 E4:1 | D4:2 D4:1 | G4:3 | G4:2 |",
  "chordsText": "| N.C. | G | G7 | C | G | G | G |"
}
```

### Top-level fields

| Field | Required | Meaning |
|---|---|---|
| `format`, `version` | recommended | `"piano-song"`, `1` |
| `title` | yes | Song title |
| `id` | no | Stable id. Importing a song with the same id replaces the old one. Generated if missing. |
| `composer`, `arranger`, `source`, `notes` | no | Free text. Use `source` for the book/page and to describe any simplification. |
| `placeholder` | no | `true` if the content is simplified or uncertain |
| `tags` | no | Array of strings |
| `key` | yes | `"C"`, `"Eb"`, `"F#"`, minor: `"Am"`, `"F#m"`. Used for spelling and the key signature. |
| `timeSignature` | yes | `"4/4"`, `"3/4"`, `"2/4"`, `"6/8"`, … |
| `tempo` | no | Quarter-note BPM (default 90) |
| `pickupBeats` | no | Length of the pickup (anacrusis) bar in quarter-note beats. `0` = none. |
| `melodyText` *or* `melody` | yes | Right-hand melody (top line, one note at a time) |
| `chordsText` *or* `chords` | yes for chord features | Chord symbols with timing |
| `arrangement` | no | Written accompaniment: `{ "style": "...", "leftHandText" or "leftHand", "rightHandText" or "rightHand" }`. `rightHand` is the full RH (melody plus harmony notes). The melody alone is still used for the melody modes. |

### Time and durations

* All durations and positions are in **quarter-note beats** (whole = 4, half = 2, quarter = 1,
  eighth = 0.5, sixteenth = 0.25, dotted quarter = 1.5, dotted half = 3, triplet eighth = `1/3`).
* `beat` 0 is the very first note of the piece (the start of the pickup bar if there is one).
  Bar *n* starts at `pickupBeats + (n-1) × beatsPerBar`. Beats per bar = `num × 4 / den`, so 6/8 = 3.

### Note text (`melodyText`, `leftHandText`, `rightHandText`)

```
| D4:1 | G4:2 B4:e G4 | C4+E4+G4:h r:q | F#4:1.5 G4:0.5 A4:1 |
```

* Tokens are separated by whitespace. Line breaks are fine.
* `|` is a bar line. It doesn't change timing; it's used to check bar lengths, so always write them.
* **Pitch:** letter + optional `#`/`b` (also `##`, `bb`) + octave. **Middle C = C4.** A0 is the lowest piano key, C8 the highest.
  Write the pitch that **sounds**: apply the key signature and accidentals yourself (in G major an F is `F#4`).
* **Chord/dyad:** join pitches with `+`: `G2+D3+G3:2`.
* **Duration** after `:`: a number (`1`, `0.5`, `1.5`, `0.75`), a fraction (`1/3`, `2/3`), or a letter
  `w h q e s t` with optional `.` (dotted) / `..` (double dotted) / `t` suffix (triplet): `h.` = 3, `et` = 1/3.
  **If you omit the duration, the previous one is reused.**
* **Rest:** `r:1` (also `rest`).
* **Ties:** write one note with the combined length. If it crosses a bar line, that bar shows a warning, which is fine.
* **Lyrics (optional):** `G4:2"grace"`, a syllable with no spaces right after the token. Inside a JSON string the quotes need escaping (`\"grace\"`), or you can leave lyrics out.
* The first bar is the pickup when `pickupBeats > 0`. The last bar may be short (it completes the pickup).

### Chord text (`chordsText`)

```
| N.C. | G | G7 | C G/B | Am:2 D7:1 | % |
```

* One `|`-separated bar per measure, in the same bar order as the melody (pickup bar first, usually `N.C.`).
* Chords **without a duration share the bar equally** (`| C G |` in 4/4 = 2 + 2). Use `Am:2 D7:1` for uneven splits.
* `%` repeats the previous chord. `N.C.` = no chord (no accompaniment there).
* A chord lasts until the next chord.
* Supported symbols (root `A`–`G` with `#`/`b`):
  `C Cm Cdim Caug Csus2 Csus4 Csus C5 C6 Cm6 C7 Cmaj7 CM7 CΔ Cm7 C-7 Cm7b5 Cø Cdim7 C°7 Cm(maj7) C7sus4 C7#5 C+7 Cadd9 C2 Cmadd9 C6/9 C9 Cmaj9 Cm9 C7b9 C13`
  and slash chords `G/B`, `C/E`, `D7/F#`, `Am/G`.

### Array form (equivalent, used by the app's export)

```json
{
  "melody":  [ { "beat": 0, "dur": 1, "pitch": "D4", "lyric": "A-" },
               { "beat": 1, "dur": 2, "pitch": "G4" } ],
  "chords":  [ { "beat": 1, "dur": 3, "symbol": "G" } ],
  "arrangement": {
    "style": "manual",
    "leftHand":  [ { "beat": 1, "dur": 3, "pitches": ["G2", "D3", "G3"] } ],
    "rightHand": [ { "beat": 1, "dur": 2, "pitches": ["B3", "D4", "G4"] } ]
  }
}
```

* `pitch` (one note) or `pitches` (array). MIDI numbers (60 = C4) are accepted too.
* `dur` may also be a duration string (`"q."`). If a chord's `dur` is missing, it lasts until the next chord.

### Several songs in one file

```json
{ "format": "piano-song-bundle", "version": 1, "songs": [ { ... }, { ... } ] }
```

A plain JSON array of songs works too.

### Checklist for an AI transcribing sheet music

1. Read the key signature, time signature and pickup. Set `key`, `timeSignature`, `pickupBeats`.
2. Write the **top melody line** in `melodyText`, bar by bar with `|`, using sounding pitches (key signature applied).
3. Copy the printed chord symbols into `chordsText`, one bar per measure, with durations where a bar has uneven splits.
   If none are printed, infer simple diatonic harmony and say so in `source`.
4. If the score has a real piano accompaniment you want to practise, add `arrangement.leftHandText`
   (and optionally `rightHandText` with the harmony notes). Otherwise leave it out: the app generates one.
5. Check every full bar adds up (4/4 = 4 beats, 3/4 = 3, 6/8 = 3). Set `"placeholder": true` if anything was simplified or guessed.
6. Output only JSON. Don't use comments.

The **Copy AI prompt** button in the Library copies a condensed version of these rules (`js/prompt.js`).
Examples: `songs/example-amazing-grace.text-form.json`, `songs/example-ode-to-joy.array-form.json`,
`songs/all-examples.bundle.json`.

---

## File layout

```
index.html            UI shell
css/style.css
js/theory.js          pitches, keys/spelling, chord symbols, chord detection, inversions, durations
js/songformat.js      song JSON parsing/validation/normalization, text <-> events, import/export
js/arranger.js        two-hand arrangement generator (styles × LH patterns)
js/practice.js        play-along engines: WaitEngine, SteadyEngine (pure, testable)
js/trainer.js         chord/inversion/progression drills
js/midi.js            Web MIDI hub (+ simulated input), computer-keyboard map
js/audio.js           WebAudio synth + metronome, optional MIDI-out routing
js/keyboard.js        on-screen piano (SVG, multi-touch)
js/staff.js           grand-staff renderer (SVG)
js/storage.js         IndexedDB/localStorage library
js/seeds.js           placeholder example songs
js/prompt.js          AI transcription prompt
js/app.js             UI wiring
songs/                example JSON files
tests/                node --test suites + screenshots
```

### Known limitations

* The notation is a proportional-spacing practice view, not engraving. It has no beams, rests aren't drawn
  (gaps show silence), and ties are shown as single long notes.
* Each text line (melody / LH / RH) is one rhythm stream. Independent voices inside one hand (a held note
  under moving notes) go in the array form. The editor's text view can only show the first voice of such events.
* Swing is stored (`"swing": true`) but playback is straight.
