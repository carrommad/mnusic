// =============================================================================
// ui.js — Global Application State, Web Worker Setup, and UI Controls / Event Listeners
// =============================================================================

let isLumiMode = false;
let lumiPollInterval = null;

let currentScaleKey = 'pentatonic';
let currentLoad = 97.5; 
let TOTAL_NODES = 1944;
let previousAllocCount = Math.round((97.5 / 100) * TOTAL_NODES);
let stretchFactor = 1.8;
let nodeBlobScale = 1.0;
let selectedTimbre = 'xylophone';
let variationAmount = 0.35;

let breathingCycleSeconds = 30;
let breathingPhaseDriftMult = 0.37;
let collisionPercent = 15;
let currentBreathingModulation = 0;

let isAutoEvolveActive = false;
let autoEvolveTimeout = null;

// Web Worker reference & canvas element
let renderWorker = null;
let canvasElement = null;

function initOffscreenWorker() {
    renderWorker = new Worker('code/worker.js');

    renderWorker.onmessage = function(e) {
        if (e.data.type === 'breathingUpdate') {
            currentBreathingModulation = e.data.normalizedBreathing;
            const stretchVal = document.getElementById('stretchVal');
            if (stretchVal) stretchVal.innerText = `${e.data.currentDynamicStretch.toFixed(2)}x (Breathing)`;
        } else if (e.data.type === 'nodeDisplaced') {
            playFluidDisplacementChime(e.data.mouseX, e.data.count);
        } else if (e.data.type === 'collisionSparks') {
            playCollisionSparkChime(e.data.count);
        }
    };

    const offscreen = canvasElement.transferControlToOffscreen();
    const width = canvasElement.parentElement.clientWidth;
    const height = canvasElement.parentElement.clientHeight;

    renderWorker.postMessage({
        type: 'init',
        canvas: offscreen,
        width: width,
        height: height,
        dpr: window.devicePixelRatio || 1,
        totalNodes: TOTAL_NODES,
        currentLoad: currentLoad,
        nodeBlobScale: nodeBlobScale,
        stretchFactor: stretchFactor,
        collisionPercent: collisionPercent,
        breathingCycleSeconds: breathingCycleSeconds,
        breathingPhaseDriftMult: breathingPhaseDriftMult
    }, [offscreen]);
}

function syncWorkerState() {
    if (!renderWorker) return;
    renderWorker.postMessage({
        type: 'updateState',
        currentLoad: currentLoad,
        totalNodes: TOTAL_NODES,
        stretchFactor: stretchFactor,
        nodeBlobScale: nodeBlobScale,
        collisionPercent: collisionPercent,
        breathingCycleSeconds: breathingCycleSeconds,
        breathingPhaseDriftMult: breathingPhaseDriftMult
    });
}

function resizeCanvas() {
    if (!canvasElement) return;
    const w = canvasElement.parentElement.clientWidth;
    const h = canvasElement.parentElement.clientHeight;
    if (renderWorker) {
        renderWorker.postMessage({ type: 'resize', width: w, height: h, dpr: window.devicePixelRatio || 1 });
    }
}

// Attach UI Event Listeners once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    canvasElement = document.getElementById('ambientCanvas');

    window.addEventListener('resize', resizeCanvas);

    canvasElement.parentElement.addEventListener('mousemove', (e) => {
        const rect = canvasElement.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (renderWorker) {
            renderWorker.postMessage({ type: 'mouseMove', x: x, y: y });
        }
    });

    canvasElement.parentElement.addEventListener('mouseleave', () => {
        if (renderWorker) {
            renderWorker.postMessage({ type: 'mouseMove', x: -1000, y: -1000 });
        }
    });

    initOffscreenWorker();

    const mainLayout = document.getElementById('mainLayout');
    const btnToggleSidebar = document.getElementById('btnToggleSidebar');
    const sidebarIcon = document.getElementById('sidebarIcon');
    const sidebarText = document.getElementById('sidebarText');
    const canvasContainer = document.getElementById('canvasContainer');
    const btnFullscreen = document.getElementById('btnFullscreen');
    const btnAutoEvolve = document.getElementById('btnAutoEvolve');
    const hudAutoEvolve = document.getElementById('hudAutoEvolve');

    btnAutoEvolve.addEventListener('click', () => {
        isAutoEvolveActive = !isAutoEvolveActive;

        if (isAutoEvolveActive) {
            btnAutoEvolve.classList.add('active-auto');
            btnAutoEvolve.innerHTML = 'AUTO-EVOLVE';
            
            hudAutoEvolve.innerText = 'ACTIVE';
            hudAutoEvolve.style.color = 'var(--accent-violet)';

            const randomMinutes = (1.5 + Math.random() * 2.5);
            const nextDelayMs = randomMinutes * 60 * 1000;
            autoEvolveTimeout = setTimeout(executeAutoEvolveShift, nextDelayMs);

            const log = document.getElementById('noteLog');
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.style.color = '#8b5cf6';
            entry.innerText = `> Auto-Evolve Active (First Shift in ${randomMinutes.toFixed(1)}m)`;
            log.prepend(entry);
            if (log.children.length > 12) log.removeChild(log.lastChild);
        } else {
            btnAutoEvolve.classList.remove('active-auto');
            btnAutoEvolve.innerHTML = 'AUTO-EVOLVE';
            if (autoEvolveTimeout) clearTimeout(autoEvolveTimeout);
            hudAutoEvolve.innerText = 'OFF';
            hudAutoEvolve.style.color = 'var(--text-secondary)';
        }
    });

    let isSidebarCollapsed = false;

    btnToggleSidebar.addEventListener('click', () => {
        isSidebarCollapsed = !isSidebarCollapsed;
        if (isSidebarCollapsed) {
            mainLayout.classList.add('sidebar-collapsed');
            sidebarIcon.innerText = '⇤';
            sidebarText.innerText = 'SHOW MENU';
        } else {
            mainLayout.classList.remove('sidebar-collapsed');
            sidebarIcon.innerText = '⇥';
            sidebarText.innerText = 'HIDE MENU';
        }
        setTimeout(resizeCanvas, 400);
    });

    btnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            if (canvasContainer.requestFullscreen) {
                canvasContainer.requestFullscreen();
            } else if (canvasContainer.webkitRequestFullscreen) {
                canvasContainer.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    });

    document.addEventListener('fullscreenchange', () => {
        setTimeout(resizeCanvas, 100);
    });

    const btnSimulated = document.getElementById('btnSimulated');
    const btnLumi = document.getElementById('btnLumi');
    const hudSource = document.getElementById('hudSource');
    const simulatedControlGroup = document.getElementById('simulatedControlGroup');

    btnSimulated.addEventListener('click', () => {
        isLumiMode = false;
        btnSimulated.className = 'toggle-btn active';
        btnLumi.className = 'toggle-btn';
        hudSource.innerText = 'MARENOSTRUM5 (Simulated)';
        hudSource.style.color = 'var(--accent-gold)';
        simulatedControlGroup.style.opacity = '1.0';
        simulatedControlGroup.style.pointerEvents = 'auto';

        if (lumiPollInterval) clearInterval(lumiPollInterval);
        TOTAL_NODES = 1944;
        currentLoad = parseFloat(document.getElementById('loadSlider').value);
        updateNodeCount();
        updateMusicEngine();
    });

    btnLumi.addEventListener('click', () => {
        isLumiMode = true;
        btnLumi.className = 'toggle-btn active-lumi';
        btnSimulated.className = 'toggle-btn';
        hudSource.innerText = 'LUMI (Slurm Telemetry)';
        hudSource.style.color = 'var(--accent-cyan)';
        simulatedControlGroup.style.opacity = '0.4';
        simulatedControlGroup.style.pointerEvents = 'none';

        TOTAL_NODES = 4360;
        fetchLumiClusterStatus();
        if (lumiPollInterval) clearInterval(lumiPollInterval);
        lumiPollInterval = setInterval(fetchLumiClusterStatus, 5000);
    });

    const loadSlider = document.getElementById('loadSlider');
    const loadVal = document.getElementById('loadVal');

    loadSlider.addEventListener('input', (e) => {
        if (isLumiMode) return;
        currentLoad = parseFloat(e.target.value);
        loadVal.innerText = `${currentLoad.toFixed(1)}%`;

        updateNodeCount();
        updateMusicEngine();
    });

    const timbreSelect = document.getElementById('timbreSelect');
    timbreSelect.addEventListener('change', (e) => {
        selectedTimbre = e.target.value;
        const log = document.getElementById('noteLog');
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerText = `> Switched Instrument: ${timbreSelect.options[timbreSelect.selectedIndex].text}`;
        log.prepend(entry);
    });

    const scaleSelect = document.getElementById('scaleSelect');
    scaleSelect.addEventListener('change', (e) => {
        currentScaleKey = e.target.value;
        updateMusicEngine();
        const log = document.getElementById('noteLog');
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerText = `> Switched Scale: ${scaleSelect.options[scaleSelect.selectedIndex].text}`;
        log.prepend(entry);
    });

    const variationSlider = document.getElementById('variationSlider');
    const variationVal = document.getElementById('variationVal');
    variationSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        variationAmount = val / 100;
        const desc = val === 0 ? '0% (Fixed Loop)' : val < 40 ? `${val}% Subtle Drift` : `${val}% Generative Endless`;
        variationVal.innerText = desc;
        updateMusicEngine();
    });

    const blobScaleSlider = document.getElementById('blobScaleSlider');
    const blobScaleVal = document.getElementById('blobScaleVal');
    blobScaleSlider.addEventListener('input', (e) => {
        nodeBlobScale = parseFloat(e.target.value);
        blobScaleVal.innerText = `${nodeBlobScale.toFixed(1)}x Scale`;
        syncWorkerState();
    });

    const collisionDensitySlider = document.getElementById('collisionDensitySlider');
    const collisionDensityVal = document.getElementById('collisionDensityVal');
    collisionDensitySlider.addEventListener('input', (e) => {
        collisionPercent = parseInt(e.target.value);
        collisionDensityVal.innerText = `${collisionPercent}% Collidable`;
        syncWorkerState();
    });

    const stretchSlider = document.getElementById('stretchSlider');
    stretchSlider.addEventListener('input', (e) => {
        stretchFactor = parseFloat(e.target.value);
        syncWorkerState();
    });

    const cycleTimeSlider = document.getElementById('cycleTimeSlider');
    const cycleTimeVal = document.getElementById('cycleTimeVal');
    cycleTimeSlider.addEventListener('input', (e) => {
        breathingCycleSeconds = parseFloat(e.target.value);
        cycleTimeVal.innerText = `${breathingCycleSeconds}s Cycle`;
        syncWorkerState();
    });

    const phaseDriftSlider = document.getElementById('phaseDriftSlider');
    const phaseDriftVal = document.getElementById('phaseDriftVal');
    phaseDriftSlider.addEventListener('input', (e) => {
        breathingPhaseDriftMult = parseFloat(e.target.value);
        phaseDriftVal.innerText = `${breathingPhaseDriftMult.toFixed(2)}x Harmonic`;
        syncWorkerState();
    });

    const reverbSlider = document.getElementById('reverbSlider');
    const reverbVal = document.getElementById('reverbVal');
    reverbSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        reverbVal.innerText = `${val}s`;
        if (audioCtx && reverbNode) {
            reverbNode.buffer = createReverbImpulse(audioCtx, val, 2.0);
        }
    });

    const audioBtn = document.getElementById('audioToggleBtn');
    audioBtn.addEventListener('click', () => {
        if (!isPlaying) {
            if (!audioCtx) initAudio();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            isPlaying = true;
            audioBtn.classList.add('active');
            audioBtn.innerText = '⏸ PAUSE SOUNDSCAPE';
            updateMusicEngine();
        } else {
            isPlaying = false;
            audioBtn.classList.remove('active');
            audioBtn.innerText = '▶ GENERATE SOUNDSCAPE';
            activeTimers.forEach(t => clearInterval(t));
            activeTimers = [];
        }
    });
});
