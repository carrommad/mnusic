// =============================================================================
// music.js — Generative Music Loop Engine, Auto-Evolve Shift, and Waterfall Sweeps
// =============================================================================

function triggerVirtualXylophoneWaterfall(startNodeIndex, targetNodeIndex) {
    const numSteps = Math.abs(targetNodeIndex - startNodeIndex);
    if (numSteps === 0) return;

    const isAddingNodes = targetNodeIndex > startNodeIndex;
    const hudWaterfall = document.getElementById('hudWaterfall');

    hudWaterfall.innerText = isAddingNodes ? 
        `SWEEPING RIGHT (+${numSteps} BARS)` : 
        `SWEEPING LEFT (-${numSteps} BARS)`;
    hudWaterfall.style.color = isAddingNodes ? '#10b981' : '#f43f5e';

    const stride = Math.max(1, Math.floor(numSteps / 32));
    const actualStrikes = Math.ceil(numSteps / stride);

    logWaterfallEvent(startNodeIndex, targetNodeIndex, numSteps, isAddingNodes);

    let stepCount = 0;
    const stepInterval = Math.max(15, Math.min(45, 800 / actualStrikes));

    for (let i = 0; i < numSteps; i += stride) {
        const currentBar = isAddingNodes ? (startNodeIndex + i) : (startNodeIndex - i);

        setTimeout(() => {
            if (!isPlaying) return;

            const freq = getVirtualBarFrequency(currentBar);
            const pan = getVirtualBarPan(currentBar);
            const isGpuBar = currentBar >= Math.floor(TOTAL_NODES * 0.95);

            triggerXylophoneNote(freq, pan, 1.1, isGpuBar);
        }, stepCount * stepInterval);

        stepCount++;
    }

    setTimeout(() => {
        hudWaterfall.innerText = 'IDLE';
        hudWaterfall.style.color = '#f59e0b';
    }, stepCount * stepInterval + 600);
}

function logWaterfallEvent(start, end, numSteps, isAdding) {
    const log = document.getElementById('noteLog');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const dirStr = isAdding ? '▶ SWEEP RIGHT (+Busy)' : '◀ SWEEP LEFT (-Busy)';
    entry.innerText = `> ${dirStr}: Swept ${numSteps} bars (Xylophone Bar ${start} → ${end})`;
    log.prepend(entry);
    if (log.children.length > 12) log.removeChild(log.lastChild);
}

function updateMusicEngine() {
    activeTimers.forEach(t => clearInterval(t));
    activeTimers = [];

    if (!isPlaying) return;

    const loopLengths = [2300, 3100, 4700, 6100]; 

    loopLengths.forEach((loopLength, voiceIdx) => {
        const voiceTimer = setInterval(() => {
            if (!isPlaying) return;

            const activeAllocCount = Math.round((currentLoad / 100) * TOTAL_NODES);
            if (activeAllocCount === 0) return;

            let barIdx = Math.floor((voiceIdx / 4) * activeAllocCount);

            if (Math.random() < variationAmount) {
                const randomOffset = Math.floor((Math.random() - 0.5) * activeAllocCount * 0.4);
                barIdx = Math.max(0, Math.min(activeAllocCount - 1, barIdx + randomOffset));
            }

            const activeScale = SCALES[currentScaleKey] || SCALES.pentatonic;
            let freq = getVirtualBarFrequency(barIdx);

            if (Math.random() < (variationAmount * 0.5)) {
                const scaleShift = Math.floor(Math.random() * activeScale.length);
                freq = activeScale[scaleShift] * (Math.random() > 0.5 ? 2.0 : 1.0);
            }

            const pan = getVirtualBarPan(barIdx);
            const isGpu = barIdx >= Math.floor(TOTAL_NODES * 0.95);

            triggerXylophoneNote(freq, pan, 0.75, isGpu);

        }, loopLength / (Math.max(15, currentLoad || 50) / 50));

        activeTimers.push(voiceTimer);
    });
}

function executeAutoEvolveShift() {
    if (!isAutoEvolveActive) return;

    const timbres = ['xylophone', 'marimba', 'celesta', 'vibraphone'];
    const scales = ['pentatonic', 'dorian', 'lydian', 'wholeTone', 'major'];
    const reverbOptions = [3.0, 5.0, 7.0, 9.0, 11.0];

    const randomTimbre = timbres[Math.floor(Math.random() * timbres.length)];
    const randomScale = scales[Math.floor(Math.random() * scales.length)];
    const randomReverb = reverbOptions[Math.floor(Math.random() * reverbOptions.length)];

    selectedTimbre = randomTimbre;
    document.getElementById('timbreSelect').value = randomTimbre;

    currentScaleKey = randomScale;
    document.getElementById('scaleSelect').value = randomScale;

    document.getElementById('reverbSlider').value = randomReverb;
    document.getElementById('reverbVal').innerText = `${randomReverb.toFixed(1)}s`;
    if (audioCtx && reverbNode) {
        reverbNode.buffer = createReverbImpulse(audioCtx, randomReverb, 2.0);
    }

    updateMusicEngine();

    const randomMinutes = (1.5 + Math.random() * 2.5);
    const nextDelayMs = randomMinutes * 60 * 1000;

    const hudAutoEvolve = document.getElementById('hudAutoEvolve');
    hudAutoEvolve.innerText = 'ACTIVE';
    hudAutoEvolve.style.color = 'var(--accent-violet)';

    const log = document.getElementById('noteLog');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.style.color = '#8b5cf6';
    entry.innerText = `> 🎲 Auto-Evolved: ${randomTimbre.toUpperCase()} | ${randomScale.toUpperCase()} | Reverb ${randomReverb}s`;
    log.prepend(entry);
    if (log.children.length > 12) log.removeChild(log.lastChild);

    autoEvolveTimeout = setTimeout(executeAutoEvolveShift, nextDelayMs);
}
