// =============================================================================
// audio.js — Web Audio API Synthesizer, Scales, Reverb & FM Timbre Oscillators
// =============================================================================

const SCALES = {
    pentatonic: [146.83, 220.00, 293.66, 349.23, 440.00, 523.25, 587.33, 698.46, 880.00, 1046.50, 1174.66, 1396.91],
    dorian: [146.83, 164.81, 174.61, 196.00, 220.00, 246.94, 261.63, 293.66, 329.63, 349.23, 392.00, 440.00],
    lydian: [130.81, 146.83, 164.81, 185.00, 196.00, 220.00, 246.94, 261.63, 293.66, 329.63, 369.99, 392.00],
    wholeTone: [130.81, 146.83, 164.81, 185.00, 207.65, 233.08, 261.63, 293.66, 329.63, 369.99, 415.30, 466.16],
    major: [130.81, 146.83, 164.81, 174.61, 196.00, 220.00, 246.94, 261.63, 293.66, 329.63, 349.23, 392.00]
};

let audioCtx = null;
let isPlaying = false;
let masterGain = null;
let reverbNode = null;
let activeTimers = [];

function initAudio() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();

    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.4, audioCtx.currentTime);

    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = createReverbImpulse(audioCtx, 7.0, 2.0);

    masterGain.connect(reverbNode);
    reverbNode.connect(audioCtx.destination);
    masterGain.connect(audioCtx.destination);
}

function createReverbImpulse(ctx, duration, decay) {
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        const n = length - i;
        const weight = Math.pow(n / length, decay);
        left[i] = (Math.random() * 2 - 1) * weight;
        right[i] = (Math.random() * 2 - 1) * weight;
    }
    return impulse;
}

function getVirtualBarFrequency(barIndex) {
    const activeScale = SCALES[currentScaleKey] || SCALES.pentatonic;
    const ratio = barIndex / TOTAL_NODES;
    const noteOffset = Math.floor(ratio * activeScale.length);
    const octaveShift = Math.floor(ratio * 3);
    const baseFreq = activeScale[noteOffset % activeScale.length];
    return baseFreq * Math.pow(2, octaveShift * 0.5);
}

function getVirtualBarPan(barIndex) {
    return (barIndex / TOTAL_NODES) * 1.6 - 0.8;
}

function triggerXylophoneNote(freq, pan = 0, volumeMult = 1.0, isGpu = false) {
    if (!audioCtx || !isPlaying) return;

    const now = audioCtx.currentTime;
    const carrier = audioCtx.createOscillator();
    const carrierGain = audioCtx.createGain();
    const modulator = audioCtx.createOscillator();
    const modulatorGain = audioCtx.createGain();
    const panner = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;

    const breathingPitchDetune = currentBreathingModulation * 12;
    const tunedFreq = freq * Math.pow(2, breathingPitchDetune / 1200);

    let modRatio = 2.0;
    let modIndex = 350;
    let decayTime = 1.6 + (currentBreathingModulation * 0.4);

    if (isGpu) {
        modRatio = 4.0;
        modIndex = 500;
        decayTime = 2.4 + (currentBreathingModulation * 0.6);
    } else if (selectedTimbre === 'marimba') {
        modRatio = 3.5;
        modIndex = 150;
        decayTime = 2.0 + (currentBreathingModulation * 0.5);
    } else if (selectedTimbre === 'celesta') {
        modRatio = 1.0;
        modIndex = 450;
        decayTime = 2.8 + (currentBreathingModulation * 0.7);
    } else if (selectedTimbre === 'vibraphone') {
        modRatio = 2.0;
        modIndex = 250;
        decayTime = 3.5 + (currentBreathingModulation * 0.8);
    }

    carrier.frequency.setValueAtTime(tunedFreq, now);
    modulator.frequency.setValueAtTime(tunedFreq * modRatio, now);

    modulatorGain.gain.setValueAtTime(modIndex, now);
    modulatorGain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    modulator.connect(carrierGain);
    modulator.connect(carrier.frequency);

    const baseVol = (isGpu ? 0.26 : 0.20) * volumeMult;
    carrierGain.gain.setValueAtTime(0.0001, now);
    carrierGain.gain.linearRampToValueAtTime(baseVol, now + 0.004);
    carrierGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.2, decayTime));

    if (panner) {
        panner.pan.setValueAtTime(pan, now);
        carrier.connect(carrierGain);
        carrierGain.connect(panner);
        panner.connect(masterGain);
    } else {
        carrier.connect(carrierGain);
        carrierGain.connect(masterGain);
    }

    modulator.start(now);
    carrier.start(now);
    modulator.stop(now + Math.max(0.2, decayTime) + 0.1);
    carrier.stop(now + Math.max(0.2, decayTime) + 0.1);

    let targetNodeIndex = Math.floor(Math.random() * TOTAL_NODES);

    if (renderWorker) {
        renderWorker.postMessage({
            type: 'spawnRippleFromRandomNode',
            nodeIndex: targetNodeIndex,
            maxR: isGpu ? 140 : 85,
            duration: Math.max(0.2, decayTime) * 60
        });
    }
}

function playPartitionNodeChime(partitionType, isEntering = true) {
    if (!audioCtx || !isPlaying) return;
    const now = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const panner = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;

    const pan = (Math.random() - 0.5) * 1.6;
    const scaleNotes = SCALES[currentScaleKey] || SCALES['pentatonic'];

    if (partitionType === 'cpu') {
        // CPU PAR: Clean Sine/Triangle Soft Chime (Mid Register)
        const baseNote = scaleNotes[Math.floor(Math.random() * scaleNotes.length)];
        const startFreq = isEntering ? baseNote : baseNote * 1.25;
        const endFreq = isEntering ? baseNote * 1.25 : baseNote;
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.15);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    } else if (partitionType === 'gpu') {
        // GPU A100: Deep Sub-Bass FM Resonance (Low Register)
        const baseNote = scaleNotes[0] * 0.5; // Deep octave drop
        const modOsc = audioCtx.createOscillator();
        const modGain = audioCtx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(baseNote, now);

        modOsc.frequency.setValueAtTime(isEntering ? baseNote * 2.0 : baseNote * 0.5, now);
        modGain.gain.setValueAtTime(300, now);
        modGain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

        modOsc.connect(osc.frequency);
        modOsc.start(now);
        modOsc.stop(now + 0.4);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

    } else if (partitionType === 'inter') {
        // INTERACTIVE: Sparkling Glass Crystal Bell (High Register)
        const baseNote = scaleNotes[scaleNotes.length - 1] * 2.0; // High register
        const startFreq = isEntering ? baseNote : baseNote * 1.5;
        const endFreq = isEntering ? baseNote * 1.5 : baseNote * 0.8;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.18);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.08, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);
    }

    osc.connect(gain);
    if (panner) {
        panner.pan.setValueAtTime(pan, now);
        gain.connect(panner);
        panner.connect(reverbNode || masterGain);
    } else {
        gain.connect(reverbNode || masterGain);
    }

    osc.start(now);
    osc.stop(now + 0.4);
}

function playFluidDisplacementChime(x, count) {
    if (!audioCtx || !isPlaying) return;
    const now = audioCtx.currentTime;

    const pan = Math.max(-0.95, Math.min(0.95, (x / canvasElement.clientWidth) * 2 - 1));
    const scaleNotes = SCALES[currentScaleKey] || SCALES['pentatonic'];
    const noteIdx = (Math.floor(x / 40) + count) % scaleNotes.length;
    const freq = scaleNotes[noteIdx] * 2.0;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const panner = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

    osc.connect(gain);
    if (panner) {
        panner.pan.setValueAtTime(pan, now);
        gain.connect(panner);
        panner.connect(reverbNode || masterGain);
    } else {
        gain.connect(reverbNode || masterGain);
    }

    osc.start(now);
    osc.stop(now + 0.26);
}

function playCollisionSparkChime(count) {
    if (!audioCtx || !isPlaying) return;
    const now = audioCtx.currentTime;

    const scaleNotes = SCALES[currentScaleKey] || SCALES['pentatonic'];
    const freq = scaleNotes[Math.floor(Math.random() * scaleNotes.length)];
    const pan = (Math.random() - 0.5) * 1.6;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const panner = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * 1.5, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.08);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(Math.min(0.04, 0.015 * count), now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

    osc.connect(gain);
    if (panner) {
        panner.pan.setValueAtTime(pan, now);
        gain.connect(panner);
        panner.connect(reverbNode || masterGain);
    } else {
        gain.connect(reverbNode || masterGain);
    }

    osc.start(now);
    osc.stop(now + 0.10);
}
