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

    // Reduced FM mod index for crystal clear bell tone, boosted volume for high-pitched melodic note drops
    const breathingPitchDetune = currentBreathingModulation * 25; // Gentle 25-cent breathing drift
    const tunedFreq = freq * Math.pow(2, breathingPitchDetune / 1200);

    let modRatio = 2.0;
    let modIndex = 80; // Crisp bell clarity
    let decayTime = 1.8 + (currentBreathingModulation * 0.8);

    if (isGpu) {
        modRatio = 4.0;
        modIndex = 140;
        decayTime = 2.4;
    } else if (selectedTimbre === 'marimba') {
        modRatio = 3.5;
        modIndex = 40;
        decayTime = 2.0;
    } else if (selectedTimbre === 'celesta') {
        modRatio = 1.0;
        modIndex = 110;
        decayTime = 3.0;
    } else if (selectedTimbre === 'vibraphone') {
        modRatio = 2.0;
        modIndex = 60;
        decayTime = 3.2;
    }

    carrier.frequency.setValueAtTime(tunedFreq, now);
    modulator.frequency.setValueAtTime(tunedFreq * modRatio, now);

    modulatorGain.gain.setValueAtTime(modIndex, now);
    modulatorGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    modulator.connect(carrierGain);
    modulator.connect(carrier.frequency);

    const baseVol = (isGpu ? 0.48 : 0.42) * volumeMult; // High clear volume presence
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
        // CPU PAR (Cyan): Dual-Harmonic Resonant Wooden Mallet Sweep
        const baseNote = scaleNotes[Math.floor(Math.random() * scaleNotes.length)];
        const startFreq = isEntering ? baseNote * 0.8 : baseNote * 1.6;
        const endFreq = isEntering ? baseNote * 1.6 : baseNote * 0.7;
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.35);

        const subOsc = audioCtx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(startFreq * 0.5, now);
        subOsc.frequency.exponentialRampToValueAtTime(endFreq * 0.5, now + 0.35);
        subOsc.connect(gain);
        subOsc.start(now);
        subOsc.stop(now + 0.5);

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1600, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.32, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);

        osc.connect(filter);
        filter.connect(gain);

    } else if (partitionType === 'gpu') {
        // GPU A100 (Gold): Massive Sub-Bass FM Thunder Drop (Low Octave)
        const baseNote = scaleNotes[0] * 0.5; // Deep sub bass
        const modOsc = audioCtx.createOscillator();
        const modGain = audioCtx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(isEntering ? baseNote * 0.7 : baseNote * 2.2, now);
        osc.frequency.exponentialRampToValueAtTime(isEntering ? baseNote * 2.2 : baseNote * 0.5, now + 0.65);

        modOsc.type = 'square';
        modOsc.frequency.setValueAtTime(isEntering ? baseNote * 4.0 : baseNote * 1.0, now);
        modGain.gain.setValueAtTime(650, now);
        modGain.gain.exponentialRampToValueAtTime(0.1, now + 0.6);

        modOsc.connect(osc.frequency);
        modOsc.start(now);
        modOsc.stop(now + 0.7);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.45, now + 0.035);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);

        osc.connect(gain);

    } else if (partitionType === 'inter') {
        // INTERACTIVE (Rose): Sparkling Piercing Dual-Crystal Bell Cascade
        const baseNote = scaleNotes[scaleNotes.length - 1] * 2.2;
        const startFreq = isEntering ? baseNote * 0.75 : baseNote * 1.9;
        const endFreq = isEntering ? baseNote * 1.9 : baseNote * 0.6;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.32);

        // Highpass sparkle filter
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(1500, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.38, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);

        osc.connect(filter);
        filter.connect(gain);
    }

    if (panner) {
        panner.pan.setValueAtTime(pan, now);
        gain.connect(panner);
        panner.connect(reverbNode || masterGain);
    } else {
        gain.connect(reverbNode || masterGain);
    }

    osc.start(now);
    osc.stop(now + 0.75);
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
