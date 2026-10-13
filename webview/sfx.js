// Board Tycoon sound effects. Synthesized with Web Audio, plus a few tiny voice clips inlined as base64 (BT_VOICES).
// Defines BT_SFX, which app.js reads. Browsers only allow sound after the user interacts with
// the page, so the audio context starts on the first click or key press in the panel; until
// then every sound is silently skipped.
const BT_SFX = (function () {
    "use strict";

    const STORE_KEY = "board-tycoon.sound";
    const Ctx = window.AudioContext || window.webkitAudioContext;
    let ctx = null;
    let out = null;
    let noiseBuf = null;
    let on = true;
    try {
        on = localStorage.getItem(STORE_KEY) !== "off";
    } catch (e) {
        /* storage unavailable */
    }

    function unlock() {
        if (!Ctx) return;
        if (!ctx) {
            try {
                ctx = new Ctx();
            } catch (e) {
                return;
            }
            const comp = ctx.createDynamicsCompressor();
            comp.connect(ctx.destination);
            out = ctx.createGain();
            out.gain.value = 0.5;
            out.connect(comp);
            noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const d = noiseBuf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === "suspended") ctx.resume();
    }
    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);

    // ------------------------------------------------------------ voices
    // `at` is seconds from now. Each voice is a short enveloped oscillator or noise burst.
    function tone(freq, at, dur, o) {
        o = o || {};
        const t0 = ctx.currentTime + at;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = o.type || "sine";
        osc.frequency.setValueAtTime(freq, t0);
        if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(o.gain || 0.3, t0 + (o.attack || 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(out);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }
    function noise(at, dur, o) {
        o = o || {};
        const t0 = ctx.currentTime + at;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = o.filter || "bandpass";
        f.frequency.setValueAtTime(o.freq || 2000, t0);
        if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
        f.Q.value = o.q || 1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(o.gain || 0.3, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(f);
        f.connect(g);
        g.connect(out);
        src.start(t0, Math.random() * 0.5);
        src.stop(t0 + dur + 0.02);
    }
    function clack(at, gain) {
        noise(at, 0.05, { freq: 3200, q: 2, gain: gain || 0.5 });
        tone(900 + Math.random() * 300, at, 0.06, { type: "square", gain: 0.06 });
    }
    function notes(freqs, step, dur, o) {
        freqs.forEach((f, i) => tone(f, i * step + ((o && o.at) || 0), dur, o));
    }

    // Spoken "build a land" clips (inlined base64 mp3s in BT_VOICES). Decoded on first use; one
    // picked at random per purchase, never the same twice in a row.
    let voiceBufs = null;
    let lastVoice = -1;
    function voice(at) {
        if (typeof BT_VOICES === "undefined" || !BT_VOICES.length) return;
        if (!voiceBufs) {
            voiceBufs = BT_VOICES.map((b64) => {
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                return ctx.decodeAudioData(bytes.buffer).catch(() => null);
            });
        }
        let i = Math.floor(Math.random() * voiceBufs.length);
        if (i === lastVoice) i = (i + 1) % voiceBufs.length;
        lastVoice = i;
        const t0 = ctx.currentTime + at;
        voiceBufs[i].then((buf) => {
            if (!buf) return;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(out);
            src.start(Math.max(t0, ctx.currentTime));
        });
    }

    // ------------------------------------------------------------ sounds
    const SOUNDS = {
        /** Dice shaking in the hand while the roll is on its way. */
        shake() {
            for (let i = 0; i < 7; i++) clack(i * 0.07 + Math.random() * 0.03, 0.3);
        },
        /** Dice hitting the table; timed to the panel's drop animation. */
        dice() {
            clack(0.3, 0.5);
            clack(0.39, 0.45);
            clack(0.48, 0.2);
        },
        doubles() {
            notes([1047, 1319, 1568, 2093], 0.06, 0.25, { at: 0.55, gain: 0.12 });
        },
        coinIn() {
            tone(988, 0, 0.09, { type: "square", gain: 0.2 });
            tone(1319, 0.08, 0.35, { type: "square", gain: 0.2 });
        },
        coinOut() {
            tone(784, 0, 0.18, { type: "triangle", gain: 0.5, to: 392 });
            noise(0, 0.12, { freq: 5000, q: 3, gain: 0.08 });
        },
        /** Someone else's money moved: a quiet tick so spectators notice. */
        coin() {
            tone(1319, 0, 0.12, { gain: 0.2 });
        },
        /** The "SOLD" stamp. */
        buy() {
            tone(140, 0.2, 0.18, { gain: 0.6, to: 50 });
            noise(0.2, 0.08, { filter: "lowpass", freq: 900, gain: 0.4 });
            notes([784, 1175], 0.07, 0.3, { at: 0.32, gain: 0.12, type: "triangle" });
            voice(0.45);
        },
        build() {
            tone(320, 0, 0.08, { type: "triangle", gain: 0.4 });
            tone(260, 0.11, 0.1, { type: "triangle", gain: 0.4 });
        },
        sell() {
            tone(260, 0, 0.08, { type: "triangle", gain: 0.3 });
            tone(200, 0.09, 0.12, { type: "triangle", gain: 0.3 });
        },
        card() {
            noise(0, 0.25, { filter: "highpass", freq: 1500, to: 6000, gain: 0.6 });
        },
        /** Gavel: auction opens. */
        auction() {
            for (let i = 0; i < 3; i++) {
                tone(220, i * 0.13, 0.07, { type: "triangle", gain: 0.45 });
                noise(i * 0.13, 0.04, { filter: "lowpass", freq: 1200, gain: 0.3 });
            }
        },
        myTurn() {
            notes([784, 1047], 0.12, 0.4, { gain: 0.18, attack: 0.02 });
        },
        trade() {
            notes([1319, 1760], 0.1, 0.25, { gain: 0.14, type: "triangle" });
        },
        jail() {
            tone(110, 0, 0.6, { type: "square", gain: 0.25 });
            tone(117, 0, 0.6, { type: "square", gain: 0.25 });
            noise(0, 0.3, { freq: 600, q: 4, gain: 0.3 });
        },
        /** Owes more than they hold. */
        debt() {
            tone(330, 0, 0.18, { type: "triangle", gain: 0.25 });
            tone(262, 0.18, 0.3, { type: "triangle", gain: 0.25 });
        },
        bankrupt() {
            notes([392, 370, 349], 0.28, 0.3, { type: "sawtooth", gain: 0.2 });
            tone(330, 0.84, 0.8, { type: "sawtooth", gain: 0.2, to: 300 });
        },
        win() {
            notes([523, 659, 784], 0.12, 0.2, { type: "triangle", gain: 0.25 });
            [1047, 1319, 1568].forEach((f) => tone(f, 0.36, 1.1, { type: "triangle", gain: 0.15 }));
        },
        error() {
            tone(180, 0, 0.15, { type: "square", gain: 0.25, to: 120 });
        },
    };

    /** Play a sound now, or `delay` ms from now. */
    function play(name, delay) {
        if (delay) return void setTimeout(() => play(name), delay);
        if (!on || !ctx || ctx.state !== "running" || !SOUNDS[name]) return;
        try {
            SOUNDS[name]();
        } catch (e) {
            /* a sound must never break the panel */
        }
    }

    return {
        play,
        /** False when the browser has no Web Audio: hide the toggle. */
        supported: !!Ctx,
        get on() {
            return on;
        },
        setOn(v) {
            on = !!v;
            try {
                localStorage.setItem(STORE_KEY, on ? "on" : "off");
            } catch (e) {
                /* storage unavailable: the choice lasts for this session */
            }
            if (on) {
                unlock();
                if (ctx) ctx.resume().then(() => play("coin"), () => {});
            }
        },
    };
})();
