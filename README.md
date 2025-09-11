# trackpad-theremin

a minimalist **trackpad theremin** built with React and the Web Audio API.  
press and glide to play: **x = pitch**, **y = volume**.

try it here:
[efeis.github.io/trackpad-theremin/ ](https://efeis.github.io/trackpad-theremin/)

---

## features

- **continuous pitch & volume** mapped to the pad (inspired by the theremin instrument)
- **quantize to notes** (snap frequency to nearest semitone)
- **different waveforms**: sine, square, saw, triangle, **warm-saw**, **warm-square**
- **convolution reverb** with a procedurally generated impulse response
- **recording** to an audio clip (via `MediaRecorder`) with **download**
- **on-screen readouts** for pitch (Hz), volume, and musical note
- **note scale overlay** across the pad
- accessible **reverb mix slider**

> audio rendering is fully client-side. nothing is uploaded unless you share recordings manually.

---

## how it works (architecture)

- **web audio graph**
  - `OscillatorNode` -> `GainNode` -> **dry** → master
  - `OscillatorNode` -> `GainNode` -> `ConvolverNode` (**wet**) → master
  - master feeds **speakers** and (when recording) a `MediaStreamDestination` for the **MediaRecorder**.
- **wave shaping**
  - built-in oscillator types *and* custom **PeriodicWave** tables (`warm-saw`, `warm-square`) for softer highs with a cut-off.
- **reverb**
  - `ConvolverNode` buffer is generated at runtime (simple noisy tail with exponential decay).
- **pointer → sound mapping**
  - horizontal (x) -> frequency in **log scale** between 130–2000 Hz.
  - vertical (y) -> volume envelope (quadratic for more control near the bottom).
  - optional **quantization** snaps to nearest MIDI note.
- **smoothing**
  - parameter changes are smoothed with `setTargetAtTime` to avoid zipper noise.

---

## controls & UI

- **pad**: press and glide (pointer/touch). release to stop tone.
- **quantize to notes**: toggles semitone snapping.
- **wave**: choose between 6 wave types (including two custom “warm” variants).
- **reverb**: toggle on/off, then adjust **mix** on the reverb chip (drag or use <-/->, home/end on your keyboard).
- **record**: start/stop. finished takes appear in **check recordings** with an audio player and **download** link.

> autoplay policies: the first sound requires a **user gesture**. if audio is muted, click/tap the pad once to initialize the `AudioContext`.

---

## browser support & permissions

- **audio**: uses `AudioContext`. some mobile browsers (ios safari) require a **tap** to start audio.
- **recording**: uses `MediaRecorder`. availability varies by browser-chrome/edge/firefox are good; ios safari support may lag. the app falls back with a notice if unsupported.

---

## troubleshooting

- **no sound**: click the pad once to unlock audio. check system output device/volume.
- **recording button disabled or no file after stop**: your browser may not support `MediaRecorder` for audio—try chrome or firefox.
- **very harsh highs**: try **warm-saw** or **warm-square** wave types.

---

have fun!
