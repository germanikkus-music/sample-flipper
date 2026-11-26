# Sample Flipper

Load a sample, chop it, flip the chops, rearrange them into a new beat, and
export WAVs plus an MPC drum program. Built by Germanikkus for the MPC Live III.

It's plain HTML, CSS and JavaScript with no build step and no internet needed,
so the same folder runs on your Mac offline and on GitHub Pages.

## Run it on your Mac (offline)

Double-click **`index.html`**, or double-click **`Sample Flipper.command`**,
which opens it in your default browser. Chrome or Safari both work.

The first time you open the `.command` file, macOS may ask whether to open it.
If it says it can't be verified, right-click it, choose **Open**, then **Open**
again. After that a double-click works.

## Using it

1. **Load**: drop a file anywhere on the page or tap **Load sample**. WAV, AIFF,
   MP3, M4A and the audio track of an MP4 are supported. WAV/AIFF keep their
   sample rate; everything else decodes at 44.1 kHz.
2. **Sample BPM** (the sample's own tempo): read from the file name when it
   has one (Splice-style names like `OS_ES_90_synth_chords_love_Am.wav` → 90
   BPM), otherwise detected from the audio. **Detect**, **½**, **×2** and
   **Tap** adjust it, or set **Sample is** to the number of bars the sample is
   (1, 2, 4, 8 or 16) and the BPM comes from its length. The info line under
   the waveform shows how many bars that makes it.
3. **Trim** (optional, before chopping): turn on **Select** (or hold
   <kbd>Shift</kbd>) and drag across the waveform. The edges snap to beats
   while **Snap to beat** is on, and the info line shows the length in bars.
   Drag the yellow edges to adjust; **▶ Sample** plays just the selection.
   **Keep** trims the sample to the selection, **Cut** removes it and joins
   the rest. Either one re-chops the result. **Undo** (<kbd>⌘Z</kbd>) puts it
   back; <kbd>Esc</kbd> or a click clears the selection.
4. **Chop**:
   - **Transients** with a **Sensitivity** slider (good for drums). If it
     finds fewer than 4 hits, the status line says so: switch to Equal slices.
   - **Equal slices**: 4, 8, 16 or 32 (good for chords and pads; sustained
     loops are sliced one chop per bar automatically).
   - **Tap chop** (or <kbd>M</kbd>): plays the sample; tap on each hit to drop
     a marker.
   - **+ Marker**: when on, clicking the waveform adds a chop there.
     **Double-click** the waveform adds one in any mode. (+ Marker and
     Select take turns: turning one on turns the other off.)
   - **Clear chops** removes every marker, so the whole sample is one chop
     on A01. Press **Chop** to chop again.
   - Drag markers to adjust. Right-click a marker, or select it and press
     <kbd>Delete</kbd>, to remove it.
   - Scroll or pinch to zoom, drag to pan, click the overview strip to jump.
5. **Pads**: 16 pads laid out like the MPC (A01 bottom-left). Click or tap, or
   use the keys: <kbd>1 2 3 4</kbd> / <kbd>Q W E R</kbd> / <kbd>A S D F</kbd> /
   <kbd>Z X C V</kbd> (top row to bottom row). Up to 64 chops across banks A–D.
6. **Flip** the selected chop: reverse, pitch (±24 semitones, changes speed
   like an MPC tune), gain, fade in/out, and choke (choked chops cut each other
   off). **Apply to all** copies the settings to every chop.
7. **Sequencer**: all bars in one chart, 4 bars by default. **Length**
   switches to 2 or 1 bar, which makes the cells bigger. <kbd>Space</kbd>
   plays and stops. **Original** puts each chop where it sat in the loop
   (shorter loops repeat to fill the bars), **Swing** shuffles the 16ths.
   **Flip it** rearranges pads A01–A16 (the bank on screen) in the style
   picked next to it:
   - **Random**: a chop on most 8ths, the odd 16th, each bar on a downbeat.
   - **Shuffle**: the original rhythm with the chops swapped around.
   - **Chop & stab**: hits on the beats with gaps between.
   - **Stutter**: a chop per beat, some rolled as 16ths or 8ths (more often
     at the end of a bar).
   - **Half-time**: the original groove at half speed.
   - **Reverse order**: the original rhythm, chops back to front.
   - **Call & response**: bars 1 and 3 play the original, bars 2 and 4 a flip.

   Each Flip it is kept: **◀ ▶** step through the last 20, and edits you make
   to a flip stay with it. Chopping again starts a fresh list.
8. **Beat**: a drum beat to play your chops against (the same drums as
   Chord Stage).
   - **▶ Beat** (or <kbd>B</kbd>) starts and stops it. **Beat style**: neo
     soul, boom bap, R&B slow jam, trap, pop, funk, gospel shuffle, jazz
     swing, bossa nova, click, and three in 3/4 (slow 3/4, jazz waltz, click
     3/4). **Drums** sets the level, **Fills every 4 bars** adds a fill at the
     end of every 4th bar and a crash on the next bar 1.
   - **Tempo** is what the beat *and the pattern* play at; **Tap** sets it
     (tap 4 times). Until you set it yourself, Tempo follows Sample BPM, so
     nothing is warped. **Tempo = sample** puts it back on the sample's tempo.
     Tempo, style, level and warp are remembered.
   - **Drums with ▶ Play** (on by default): ▶ Play starts the drums too, both
     on bar 1, and ■ Stop stops both. With the beat already running, ▶ Play
     waits for its next bar 1 (the button shows **… bar 1**), and the beat
     keeps going when you stop the pattern. ▶ Beat with a pattern playing
     comes in on the pattern's next bar 1.
   - One clock runs the drums and the pattern, so they can't drift. Changing
     the Tempo or the style while they play stays in time.
   - **Warp**: how the chops fit a Tempo that isn't the sample's own. The
     line under the beat says what's happening (for example "Sample 90 BPM →
     plays at 84, stretched 7% slower, same pitch").
     - **Keep pitch (stretch)**: each chop is time-stretched so it fills the
       same number of steps at the new tempo, pitch unchanged. Each chop
       still starts on its step, so hits land on the beat. Best within about
       ±15%; further than that you'll hear some graininess on sustained
       sounds (a sharp hit is left as is and just cut or padded).
     - **Repitch (MPC-style)**: chops play faster or slower like a record
       or the MPC's tune, so the pitch moves with the tempo (+1.2 semitones
       for 90 → 84 BPM). Cleanest sound, but the key changes.
     - **Off**: chops play as recorded; each still starts on its step, so
       the hits are on the beat, but at a faster Tempo long chops get cut
       off by the next one and at a slower Tempo there are gaps.
   - **Swing** in the sequencer is separate from the beat's swing. Swung
     styles (neo soul, gospel, jazz) push their off-beats late; raise
     **Swing** if the chops sound early against them.
   - The pattern is always in 4/4 steps. Over a 3/4 style it keeps the beat
     but its bars won't line up with the drum bars, so use a 3/4 style for
     3/4 samples played by hand on the pads.
9. **Export**:
   - **Chops .zip**: one WAV per chop with flips baked in, plus an MPC drum
     program (`.xpm`) in the same folder. Unzip, copy the folder to your MPC
     (SD card, USB or the internal drive), and load the `.xpm`. Chop 1 is on
     pad A01; choked chops share mute group 1.
   - The zip also holds the sequence as an MPC pattern (`.mpcpattern`),
     with the number of bars set by **Bars**. On the MPC, load the program onto a
     track, then import the pattern into that track. Chop 1 plays note 36
     (pad A01), chop 2 note 37, and so on, with swing baked in.
   - **Pattern .wav**: the sequence rendered at the Tempo (warped the way
     Warp is set) for 1, 2 or 4 bars, cut to exact loop length. The drums
     aren't in it.
   - **Export chop .wav**: just the selected chop. Chops (here and in the
     zip) export as recorded, not warped, so the MPC can warp them itself.
   - 16-bit or 24-bit.

## Put it on GitHub Pages

1. Create a new repository on GitHub (for example `sample-flipper`). It can be
   public, or private if your GitHub plan allows Pages on private repos.
2. From this folder:

   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/sample-flipper.git
   git push -u origin main
   ```

3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from
   a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute it's live at `https://YOUR-USERNAME.github.io/sample-flipper/`.
   It works on your phone too. Audio never leaves the device; everything runs
   in the browser.

## Notes and limits

- The `.xpm` follows the layout of Akai's own drum kits (file version 2.1, the
  XML format MPC OS 2.x and 3.x both load). It has been checked against those
  kits but not yet loaded on an MPC, so try it once on the Live III before
  relying on it.
- The `.mpcpattern` uses the older JSON layout found in Akai's drum-kit
  patterns and in the NeoSoul expansion (960 ticks per beat). MPC OS 3.x saves
  a newer layout but ships expansions in the older one. It also hasn't been
  imported on the MPC yet.
- Pitch is baked into exported chops by resampling, so a pitched-up chop is
  shorter and a pitched-down chop longer, same as the MPC's tune.
- BPM detection is tuned for loops. For a one-shot or a long song, check the
  number and use ½ / ×2 / Tap.
- The step grid shows the 16 pads of the current bank. With more than 16
  chops, switch banks to place the others.
- An MP4 with no audio track, or with audio the browser can't decode (for
  example ALAC), shows an error. Convert those to WAV first.

## Files

```
index.html            the app
css/style.css         look and feel
js/audio.js           decoding, flips, time-stretch, WAV encoding, downloads
js/analysis.js        transient and BPM detection
js/beat.js            drum beat styles and synth drums (from Chord Stage)
js/waveform.js        waveform, zoom, markers
js/xpm.js             MPC drum program writer
js/zip.js             tiny ZIP writer (no libraries)
js/app.js             UI, pads, sequencer + beat clock, warp, exports
Sample Flipper.command  double-click launcher for macOS
docs/guide.html       color-coded guide (the Guide link in the app)
docs/Sample Flipper Guide.pdf  the same guide as a 3-page PDF
```

To rebuild the PDF after editing `docs/guide.html`, open the guide in Chrome and
print it (Save as PDF, Letter, no margins, background graphics on), or:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --virtual-time-budget=3000 --print-to-pdf="docs/Sample Flipper Guide.pdf" "file://$PWD/docs/guide.html"
```
