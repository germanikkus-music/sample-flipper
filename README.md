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
2. **Tempo**: read from the file name when it has one (Splice-style names like
   `OS_ES_90_synth_chords_love_Am.wav` → 90 BPM), otherwise detected from the
   audio. **Detect**, **½**, **×2** and **Tap** adjust it.
3. **Chop**:
   - **Transients** with a **Sensitivity** slider (good for drums).
   - **Equal slices**: 4, 8, 16 or 32 (good for chords and pads; sustained
     loops are sliced one chop per bar automatically).
   - **Tap chop** (or <kbd>M</kbd>): plays the sample; tap on each hit to drop
     a marker.
   - **+ Marker**: when on, clicking the waveform adds a marker.
   - Drag markers to adjust. Right-click a marker, or select it and press
     <kbd>Delete</kbd>, to remove it.
   - Scroll or pinch to zoom, drag to pan, click the overview strip to jump.
4. **Pads**: 16 pads laid out like the MPC (A01 bottom-left). Click or tap, or
   use the keys: <kbd>1 2 3 4</kbd> / <kbd>Q W E R</kbd> / <kbd>A S D F</kbd> /
   <kbd>Z X C V</kbd> (top row to bottom row). Up to 64 chops across banks A–D.
5. **Flip** the selected chop: reverse, pitch (±24 semitones, changes speed
   like an MPC tune), gain, fade in/out, and choke (choked chops cut each other
   off). **Apply to all** copies the settings to every chop.
6. **Sequencer**: 16 steps per bar for the current bank. <kbd>Space</kbd>
   plays and stops. **Original** puts each chop where it sat in the loop,
   **Flip it** makes a random rearrangement, **Swing** shuffles the 16ths.
7. **Export**:
   - **Chops .zip**: one WAV per chop with flips baked in, plus an MPC drum
     program (`.xpm`) in the same folder. Unzip, copy the folder to your MPC
     (SD card, USB or the internal drive), and load the `.xpm`. Chop 1 is on
     pad A01; choked chops share mute group 1.
   - The zip also holds the sequence as an MPC pattern (`.mpcpattern`),
     with the number of bars set by **Bars**. On the MPC, load the program onto a
     track, then import the pattern into that track. Chop 1 plays note 36
     (pad A01), chop 2 note 37, and so on, with swing baked in.
   - **Pattern .wav**: the sequence rendered at the current BPM for 1–8 bars,
     cut to exact loop length.
   - **Export chop .wav**: just the selected chop.
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
- The sequencer is one bar (16 steps) per bank.
- An MP4 with no audio track, or with audio the browser can't decode (for
  example ALAC), shows an error. Convert those to WAV first.

## Files

```
index.html            the app
css/style.css         look and feel
js/audio.js           decoding, flips, WAV encoding, downloads
js/analysis.js        transient and BPM detection
js/waveform.js        waveform, zoom, markers
js/xpm.js             MPC drum program writer
js/zip.js             tiny ZIP writer (no libraries)
js/app.js             UI, pads, sequencer, exports
Sample Flipper.command  double-click launcher for macOS
docs/guide.html       color-coded guide (the Guide link in the app)
docs/Sample Flipper Guide.pdf  the same guide as a 3-page PDF
```

To rebuild the PDF after editing `docs/guide.html`, open the guide in Chrome and
print it (Save as PDF, Letter, no margins, background graphics on), or:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --virtual-time-budget=3000 --print-to-pdf="docs/Sample Flipper Guide.pdf" "file://$PWD/docs/guide.html"
```
