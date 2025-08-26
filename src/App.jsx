import { useEffect, useRef, useState } from "react";

export default function App() {
  // ----------------------------- state & refs -----------------------------
  const [freqReadout, setFreqReadout] = useState("— Hz");
  const [volReadout, setVolReadout] = useState("—");
  const [noteReadout, setNoteReadout] = useState("—");

  const [wetMix, setWetMix] = useState(0.25); // 0..1 dry/wet
  const [reverbOn, setReverbOn] = useState(false);
  const [quantize, setQuantize] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [clips, setClips] = useState([]);

  // wave type is state
  const [wave, setWave] = useState("sine"); // 'sine' | 'square' | 'sawtooth' | 'triangle' | 'warm-saw' | 'warm-square'
  const periodicWavesRef = useRef({}); // name -> PeriodicWave

  const ctxRef = useRef(null);
  const oscRef = useRef(null);
  const gainRef = useRef(null);

  // master & reverb network
  const dryRef = useRef(null);
  const wetRef = useRef(null);
  const convolverRef = useRef(null);
  const masterRef = useRef(null);
  const reverbWiredRef = useRef(false);

  // recording
  const mediaDestRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedBlobsRef = useRef([]);
  const recordWiredRef = useRef(false);

  // pad interactions
  const padRef = useRef(null);
  const isDownRef = useRef(false);

  // ----------------------------- musical constants -----------------------------
  const minHz = 130;
  const maxHz = 2000;
  const smoothing = 0.012;
  const A4 = 440;

  // ----------------------------- mapping helpers -----------------------------
  const xToFreq = (x01) => minHz * Math.pow(maxHz / minHz, x01);
  const yToVol = (y01) => Math.pow(1 - y01, 2);
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const freqToMidiExact = (f) => 69 + 12 * Math.log2(f / A4);
  const quantizeToSemitone = (f) => midiToFreq(Math.round(freqToMidiExact(f)));
  const NOTE = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const midiToLabel = (m) => `${NOTE[m % 12]}${Math.floor(m / 12) - 1}`;

  // ----------------------------- reverb impulse -----------------------------
  function makeImpulse(ctx, seconds = 1.4, decay = 2.2) {
    const rate = ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / seconds, decay);
      }
    }
    return buf;
  }

  // ----------------------------- audio context and node setup -----------------------------
  function ensureCtx() {
    if (!ctxRef.current) {
      const C = window.AudioContext || window.webkitAudioContext;
      ctxRef.current = new C();
    }
    return ctxRef.current;
  }

  function setupBusAndReverbIfNeeded() {
    const ctx = ensureCtx();

    if (!masterRef.current) masterRef.current = ctx.createGain();
    if (!dryRef.current) dryRef.current = ctx.createGain();
    if (!wetRef.current) wetRef.current = ctx.createGain();
    if (!convolverRef.current) {
      const conv = ctx.createConvolver();
      conv.buffer = makeImpulse(ctx);
      convolverRef.current = conv;
    }

    if (!reverbWiredRef.current) {
      try { masterRef.current.connect(ctx.destination); } catch {}
      if (mediaDestRef.current && !recordWiredRef.current) {
        try { masterRef.current.connect(mediaDestRef.current); } catch {}
        recordWiredRef.current = true;
      }
      try { dryRef.current.connect(masterRef.current); } catch {}
      try { convolverRef.current.connect(wetRef.current); } catch {}
      try { wetRef.current.connect(masterRef.current); } catch {}
      reverbWiredRef.current = true;
    }

    // initial wet/dry
    const wet = reverbOn ? wetMix : 0;
    if (dryRef.current) dryRef.current.gain.value = 1 - wet;
    if (wetRef.current) wetRef.current.gain.value = wet;
  }

  function ensureRecorderThings() {
    const ctx = ensureCtx();
    if (!mediaDestRef.current) mediaDestRef.current = ctx.createMediaStreamDestination();
    if (masterRef.current && !recordWiredRef.current) {
      try { masterRef.current.connect(mediaDestRef.current); } catch {}
      recordWiredRef.current = true;
    }
    return mediaDestRef.current;
  }

  // ----------------------------- custom (warm) waves -----------------------------
  function ensurePeriodicWaves() {
    const ctx = ensureCtx();

    if (!periodicWavesRef.current["warm-saw"]) {
      const N = 32;
      const real = new Float32Array(N + 1);
      const imag = new Float32Array(N + 1);
      for (let n = 1; n <= N; n++) {
        imag[n] = -(1 / n) * Math.exp(-n / 14);
      }
      periodicWavesRef.current["warm-saw"] = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    if (!periodicWavesRef.current["warm-square"]) {
      const N = 32;
      const real = new Float32Array(N + 1);
      const imag = new Float32Array(N + 1);
      for (let n = 1; n <= N; n += 2) {
        imag[n] = (1 / n) * Math.exp(-n / 10);
      }
      periodicWavesRef.current["warm-square"] = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    }
  }

  function applyWaveType(osc, waveName) {
    if (!osc) return;
    if (waveName === "warm-saw" || waveName === "warm-square") {
      ensurePeriodicWaves();
      const pw = periodicWavesRef.current[waveName];
      if (pw) {
        try { osc.setPeriodicWave(pw); } catch {}
      }
    } else {
      try { osc.type = waveName; } catch {}
    }
  }


  // keep wet/dry in sync when state changes
  useEffect(() => {
    if (dryRef.current && wetRef.current) {
      const wet = reverbOn ? wetMix : 0;
      dryRef.current.gain.value = 1 - wet;
      wetRef.current.gain.value = wet;
    }
  }, [wetMix, reverbOn]);

  // smoothly update the running oscillator when wave type changes
  useEffect(() => {
    const osc = oscRef.current;
    const gNode = gainRef.current;
    const ctx = ctxRef.current;
    if (!osc || !gNode || !ctx) return;

    try {
      const now = ctx.currentTime;
      const g = gNode.gain;
      const prev = g.value || 0.0001;
      const dip = Math.max(0.0001, prev * 0.5);
      g.setTargetAtTime(dip, now, 0.02);
      setTimeout(() => {
        applyWaveType(osc, wave);
        g.setTargetAtTime(prev, ctx.currentTime, 0.02);
      }, 25);
    } catch {
      applyWaveType(osc, wave);
    }
  }, [wave]);

  // ----------------------------- playback -----------------------------
  async function startTone() {
    const ctx = ensureCtx();
    await ctx.resume();

    if (oscRef.current) stopTone();

    setupBusAndReverbIfNeeded();

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    applyWaveType(osc, wave);
    g.gain.value = 0.0001;

    osc.connect(g);
    try { g.connect(dryRef.current); } catch {}
    try { g.connect(convolverRef.current); } catch {}

    try { osc.start(); } catch {}

    oscRef.current = osc;
    gainRef.current = g;
  }

  function stopTone() {
    const ctx = ctxRef.current;
    if (!ctx || !oscRef.current || !gainRef.current) return;
    const t = ctx.currentTime;
    try { gainRef.current.gain.setTargetAtTime(0.0001, t, 0.005); } catch {}
    try { oscRef.current.stop(t + 0.03); } catch {}
    setTimeout(() => {
      try { oscRef.current?.disconnect(); } catch {}
      try { gainRef.current?.disconnect(); } catch {}
      oscRef.current = null;
      gainRef.current = null;
    }, 60);
  }

  // ----------------------------- recording -----------------------------
  async function startRecording() {
    const ctx = ensureCtx();
    await ctx.resume();
    setupBusAndReverbIfNeeded();
    ensureRecorderThings();

    if (typeof window.MediaRecorder === "undefined") {
      alert("Recording not supported in this browser.");
      return;
    }

    recordedBlobsRef.current = [];

    let rec;
    const stream = mediaDestRef.current.stream;
    const tryTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ];
    for (let i = 0; i < tryTypes.length; i++) {
      const mt = tryTypes[i];
      try {
        rec = new MediaRecorder(stream, { mimeType: mt });
        break;
      } catch {}
    }
    if (!rec) {
      try { rec = new MediaRecorder(stream); } catch (e) {
        console.warn("MediaRecorder failed:", e);
        return;
      }
    }

    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) recordedBlobsRef.current.push(ev.data);
    };
    rec.onstop = () => {
      const mime = rec.mimeType || "audio/webm";
      const blob = new Blob(recordedBlobsRef.current, { type: mime });
      const url = URL.createObjectURL(blob);
      setClips((old) => [...old, { url, createdAt: new Date(), bytes: blob.size, mime }]);
    };

    try { rec.start(); } catch {}
    mediaRecorderRef.current = rec;
    setIsRecording(true);
  }

  function stopRecording() {
    const r = mediaRecorderRef.current;
    if (r && r.state !== "inactive") {
      try { r.stop(); } catch {}
    }
    setIsRecording(false);
  }

  async function toggleRecording() {
    if (isRecording) stopRecording(); else await startRecording();
  }

  // ----------------------------- pointer to sound mapping -----------------------------
  function updateFromPointer(clientX, clientY) {
    if (!ctxRef.current || !oscRef.current || !gainRef.current || !padRef.current) return;
    const rect = padRef.current.getBoundingClientRect();
    let x = (clientX - rect.left) / rect.width;
    let y = (clientY - rect.top) / rect.height;
    if (x < 0) x = 0; if (x > 1) x = 1;
    if (y < 0) y = 0; if (y > 1) y = 1;

    let f = xToFreq(x);
    if (quantize) f = quantizeToSemitone(f);
    const v = yToVol(y);

    const t = ctxRef.current.currentTime;
    try { oscRef.current.frequency.setTargetAtTime(f, t, smoothing); } catch {}
    try { gainRef.current.gain.setTargetAtTime(v, t, smoothing); } catch {}

    setFreqReadout(`${Math.round(f)} Hz`);
    setVolReadout(v.toFixed(2));
    const m = Math.round(freqToMidiExact(f));
    const noteF = midiToFreq(m);
    const cents = Math.round(1200 * Math.log2(f / noteF));
    setNoteReadout(`${midiToLabel(m)}${cents ? (cents > 0 ? ` +${cents}¢` : ` ${cents}¢`) : ""}`);

    try {
      padRef.current.style.setProperty("--x", `${(x * 100).toFixed(2)}%`);
      padRef.current.style.setProperty("--y", `${(y * 100).toFixed(2)}%`);
    } catch {}
  }

  // ----------------------------- toggles -----------------------------
  function toggleQuantize() {
    setQuantize((prev) => {
      const next = !prev;
      if (next && ctxRef.current && oscRef.current) {
        const ctx = ctxRef.current;
        const t = ctx.currentTime;
        const cur = oscRef.current.frequency.value || 0;
        const snap = quantizeToSemitone(cur);
        try { oscRef.current.frequency.setTargetAtTime(snap, t, smoothing); } catch {}
        setFreqReadout(`${Math.round(snap)} Hz`);
        const m = Math.round(freqToMidiExact(snap));
        const noteF = midiToFreq(m);
        const cents = Math.round(1200 * Math.log2(snap / noteF));
        setNoteReadout(`${midiToLabel(m)}${cents ? (cents > 0 ? ` +${cents}¢` : ` ${cents}¢`) : ""}`);
      }
      return next;
    });
  }

  function toggleReverb() {
    setReverbOn((on) => {
      const next = !on;
      const wet = next ? wetMix : 0;
      if (dryRef.current) dryRef.current.gain.value = 1 - wet;
      if (wetRef.current) wetRef.current.gain.value = wet;
      return next;
    });
  }

  // ----------------------------- pointer handlers -----------------------------
  async function onPointerDown(e) {
    e.preventDefault();
    isDownRef.current = true;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
    await startTone();
    updateFromPointer(e.clientX, e.clientY);
  }
  function onPointerMove(e) {
    if (!isDownRef.current) return;
    updateFromPointer(e.clientX, e.clientY);
  }
  function onPointerUpOrCancel() {
    if (!isDownRef.current) return;
    isDownRef.current = false;
    stopTone();
  }

  useEffect(() => {
    function up() { onPointerUpOrCancel(); }
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  // ----------------------------- derived readouts -----------------------------
  const reverbPercent = Math.round((reverbOn ? wetMix : 0) * 100);
  const reverbReadout = `%${reverbPercent}`;

  // ----------------------------- note scale -----------------------------
  const midiMin = Math.ceil(freqToMidiExact(minHz));
  const midiMax = Math.floor(freqToMidiExact(maxHz));
  const scale = [];
  for (let m = midiMin; m <= midiMax; m++) {
    const name = NOTE[m % 12];
    const isNatural = name.indexOf('#') === -1;
    const f = midiToFreq(m);
    const x = Math.log(f / minHz) / Math.log(maxHz / minHz);
    scale.push({ m, name, isNatural, x, label: midiToLabel(m) });
  }

  // ----------------------------- UI -----------------------------
  return (
    <div
      className="min-h-screen w-full bg-[#FBFBFB] text-[#4C4C4C] flex items-center justify-center p-6"
      style={{
        fontFamily:
          'DM Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
      }}
    >
      <div className="w-full max-w-5xl">
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight">trackpad theremin</h1>
          <p className="opacity-70 mt-1 text-[14px]">
            press and glide. x = pitch, y = volume. use 'quantize to notes' button for discrete notes.
          </p>
        </header>

        {/* pad */}
        <div
          ref={padRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUpOrCancel}
          onPointerCancel={onPointerUpOrCancel}
          onPointerLeave={onPointerUpOrCancel}
          className="relative w-full aspect-[16/9] select-none overflow-hidden rounded-[28px] border border-[#E9E9E9] bg-[#F4F4F4]"
          style={{ touchAction: "none" }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(220px 220px at var(--x,50%) var(--y,50%), rgba(0,0,0,0.06), transparent 60%)",
            }}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-60 text-[13px] text-[#787878]">
            <div className="rounded-full border border-black/10 px-3 py-1 bg-white/40 backdrop-blur-sm">
              press &amp; glide
            </div>

            {/* note scale (inside pad) */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8">
              <div className="relative h-full">
                {scale.map((n) => (
                  <div
                    key={n.m}
                    className="absolute bottom-1"
                    style={{ left: `${(n.x * 100).toFixed(3)}%`, transform: "translateX(-50%)" }}
                  >
                    <div className={`${n.isNatural ? 'bg-[#CFCFCF] h-3' : 'bg-[#E7E7E7] h-2'} w-px mx-auto`} />
                    {n.isNatural && (
                      <div className="mt-1 text-[10px] text-[#9A9A9A] leading-none text-center">{n.label}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* readout chips */}
        <div className="mt-6 grid grid-cols-4 gap-2">
          <Chip label="pitch" value={freqReadout} />
          <Chip label="volume" value={volReadout} />
          <Chip label="note" value={noteReadout} />
          <ReverbChip
            label="reverb"
            value={reverbReadout}
            progress={reverbOn ? wetMix : 0}
            enabled={reverbOn}
            onChange={(v) => setWetMix(v)}
          />
        </div>

        {/* controls */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <PillButton onClick={toggleRecording}>
            <span className="inline-flex items-center gap-3 text-[15px]">
              <span>record</span>
              {isRecording ? <Square color="#E81515" size={8} /> : <Dot color="#E81515" size={10} />}
            </span>
          </PillButton>

          <PillButton onClick={() => setShowLibrary((s) => !s)}>
            <span className="text-[15px]">check recordings</span>
          </PillButton>

          <WaveSelect value={wave} onChange={setWave} />

          <PillButton onClick={toggleQuantize} aria-pressed={quantize}>
            <span className="flex flex-col items-left text-[15px] w-full">
              <Dot color={quantize ? "#16A34A" : "#E81515"} />
              <span>quantize to notes</span>
            </span>
          </PillButton>

          <PillButton onClick={toggleReverb} aria-pressed={reverbOn}>
            <span className="flex flex-col items-left text-[15px] w-full">
              <Dot color={reverbOn ? "#16A34A" : "#E81515"} />
              <span>reverb</span>
            </span>
          </PillButton>
        </div>

        {/* recordings panel */}
        {showLibrary && (
          <div className="mt-4 rounded-[16px] border border-[#E9E9E9] bg-white p-4">
            {clips.length === 0 ? (
              <div className="text-[14px] text-[#787878]">No recordings yet.</div>
            ) : (
              <ul className="space-y-3">
                {clips.map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <div className="text-[13px] text-[#787878]">
                      <span className="font-semibold text-[#4C4C4C] mr-2"> take {i + 1}:</span>
                      <span>{c.createdAt.toLocaleString?.() || "just now"}</span>
                    </div>
                    <audio src={c.url} controls className="w-[260px]" />
                    <a
                      className="text-[13px] underline"
                      href={c.url}
                      download={`trackpad-theremin-take-${i + 1}.${(c.mime||'audio/webm').split('/')[1]||'webm'}`}
                    >
                      download
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* footer */}
        <div className="mt-8 flex items-center justify-center">
          <div className="inline-flex items-center gap-2 text-[12px] text-[#9A9A9A]">
            <span>a project by</span>
            <a href="https://twitter.com/efeis1" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#4C4C4C] hover:underline" aria-label="efeis on twitter">efeis</a>
            <img src="/efeis-cutout.png" alt="efeis logo" className="h-4 w-4 object-contain" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- UI atoms --- */
function Dot({ color = "#E81515", size = 4 }) {
  return (
    <span
      className="inline-block rounded-full"
      style={{ background: color, width: size, height: size }}
    />
  );
}

function Square({ color = "#E81515", size = 8 }) {
  return (
    <span
      className="inline-block"
      style={{ background: color, width: size, height: size }}
    />
  );
}

function Chip({ label, value }) {
  return (
    <div className="relative overflow-hidden flex h-10 items-center justify-between rounded-[14px] border border-[#E9E9E9] bg-white px-3">
      <div className="relative z-10 flex w-full items-center justify-between">
        <span className="uppercase tracking-wide text-[#9A9A9A] text-[12px]">{label} -</span>
        <strong className="font-semibold tabular-nums text-[13px]">{value}</strong>
      </div>
    </div>
  );
}

function ReverbChip({ label, value, progress, enabled, onChange }) {
  const ref = useRef(null);
  const draggingRef = useRef(false);
  const pct = Math.max(0, Math.min(1, progress ?? 0));

  function setFromClientX(clientX) {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x01 = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, x01));
    onChange?.(clamped);
  }

  function onPointerDown(e) {
    if (!enabled) return;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
    draggingRef.current = true;
    setFromClientX(e.clientX);
  }
  function onPointerMove(e) {
    if (!enabled || !draggingRef.current) return;
    setFromClientX(e.clientX);
  }
  function onPointerUpOrCancel() {
    draggingRef.current = false;
  }
  function onKeyDown(e) {
    if (!enabled) return;
    const step = e.shiftKey ? 0.1 : 0.01;
    if (e.key === "ArrowRight") { e.preventDefault(); onChange?.(Math.min(1, pct + step)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); onChange?.(Math.max(0, pct - step)); }
    else if (e.key === "Home") { e.preventDefault(); onChange?.(0); }
    else if (e.key === "End") { e.preventDefault(); onChange?.(1); }
  }

  return (
    <div
      ref={ref}
      style={{ touchAction: "none" }}
      className={`relative overflow-hidden flex h-10 items-center justify-between rounded-[14px] border border-[#E9E9E9] bg-white px-3 select-none ${
        enabled ? "cursor-ew-resize" : "cursor-not-allowed opacity-90"
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUpOrCancel}
      onPointerCancel={onPointerUpOrCancel}
      role="slider"
      aria-label="reverb mix"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100)}
      aria-disabled={!enabled}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {/* fill layer */}
      <div
        className="absolute inset-y-0 left-0 bg-[#E9E9E9]"
        style={{ width: `${pct * 100}%` }}
        aria-hidden="true"
      />
      {/* content */}
      <div className="relative z-10 flex w-full items-center justify-between">
        <span className="uppercase tracking-wide text-[#9A9A9A] text-[12px]">
          {label.toUpperCase()} -
        </span>
        <strong className="font-semibold tabular-nums text-[13px]">
          {value}
        </strong>
      </div>
    </div>
  );
}

function PillButton({ children, onClick, className = "" }) {
  return (
    <button
      onClick={onClick}
      className={`h-12 rounded-[16px] border border-[#E9E9E9] bg-white px-4 inline-flex items-center justify-center whitespace-nowrap ${className}`}
    >
      {children}
    </button>
  );
}

function WaveSelect({ value, onChange }) {
  return (
    <label className="h-12 rounded-[16px] border border-[#E9E9E9] bg-white px-4 inline-flex items-center justify-between gap-3">
      <span className="text-[13px] text-[#787878]">wave</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent outline-none text-[15px] text-[#4C4C4C]"
      >
        <option value="sine">sine</option>
        <option value="square">square</option>
        <option value="sawtooth">saw</option>
        <option value="triangle">triangle</option>
        <option value="warm-saw">warm saw</option>
        <option value="warm-square">warm square</option>
      </select>
    </label>
  );
}
