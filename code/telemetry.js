// =============================================================================
// telemetry.js — Cluster Node Status Fetcher & UI Telemetry Counter Sync
// Reads scratch/cluster_node_status.txt for live LUMI telemetry updates
// =============================================================================

function updateNodeCount() {
    const newAllocCount = Math.round((currentLoad / 100) * TOTAL_NODES);
    const idleCount = TOTAL_NODES - newAllocCount;
    const delta = newAllocCount - previousAllocCount;

    // Ratios based on node allocation probability: GPU (~3%), INTERACTIVE (~5%), CPU (~92%)
    const totalGpu = Math.round(TOTAL_NODES * 0.03);
    const totalInter = Math.round(TOTAL_NODES * 0.05);
    const totalCpu = TOTAL_NODES - totalGpu - totalInter;

    const activeGpu = Math.min(totalGpu, Math.round(newAllocCount * 0.03));
    const activeInter = Math.min(totalInter, Math.round(newAllocCount * 0.05));
    const activeCpu = Math.max(0, newAllocCount - activeGpu - activeInter);

    document.getElementById('statCpuActive').innerText = activeCpu.toLocaleString();
    document.getElementById('statCpuTotal').innerText = totalCpu.toLocaleString();

    document.getElementById('statGpuActive').innerText = activeGpu.toLocaleString();
    document.getElementById('statGpuTotal').innerText = totalGpu.toLocaleString();

    document.getElementById('statInterActive').innerText = activeInter.toLocaleString();
    document.getElementById('statInterTotal').innerText = totalInter.toLocaleString();

    document.getElementById('statIdleActive').innerText = idleCount.toLocaleString();
    document.getElementById('statIdleTotal').innerText = TOTAL_NODES.toLocaleString();

    document.getElementById('statAllocActive').innerText = newAllocCount.toLocaleString();
    document.getElementById('statAllocTotal').innerText = TOTAL_NODES.toLocaleString();

    document.getElementById('hudNodes').innerText = `${newAllocCount.toLocaleString()} / ${TOTAL_NODES.toLocaleString()}`;

    recordTelemetryHistory(activeCpu, activeGpu, activeInter, idleCount);
    drawTelemetryGraph();

    syncWorkerState();

    if (delta !== 0 && isPlaying) {
        triggerVirtualXylophoneWaterfall(previousAllocCount, newAllocCount);
    }

    previousAllocCount = newAllocCount;
}

const telemetryHistory = [];
const MAX_GRAPH_HISTORY = 40;

// Seed initial points so graph renders immediately upon initialization
(function seedTelemetryHistory() {
    const initAlloc = 1895;
    const totalN = 1944;
    for (let i = 0; i < 20; i++) {
        const jitter = Math.sin(i * 0.5) * 15;
        const alloc = Math.round(initAlloc + jitter);
        const gpu = Math.round(alloc * 0.03);
        const inter = Math.round(alloc * 0.05);
        const cpu = alloc - gpu - inter;
        telemetryHistory.push({ cpu, gpu, inter, idle: totalN - alloc });
    }
})();

function recordTelemetryHistory(cpu, gpu, inter, idle) {
    telemetryHistory.push({ cpu, gpu, inter, idle });
    if (telemetryHistory.length > MAX_GRAPH_HISTORY) {
        telemetryHistory.shift();
    }
}

function drawTelemetryGraph() {
    const canvas = document.getElementById('telemetryGraphCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (telemetryHistory.length < 2) return;

    const step = w / (MAX_GRAPH_HISTORY - 1);
    const maxVal = TOTAL_NODES || 1;

    // Draw subtle grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5);
    ctx.stroke();

    const series = [
        { key: 'cpu', color: '#06b6d4' },
        { key: 'gpu', color: '#f59e0b' },
        { key: 'inter', color: '#f43f5e' }
    ];

    series.forEach(s => {
        ctx.beginPath();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = 'round';

        telemetryHistory.forEach((pt, idx) => {
            const x = idx * step;
            const y = h - (pt[s.key] / maxVal) * (h - 8) - 4;
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });

        ctx.stroke();
    });
}

async function fetchLumiClusterStatus() {
    try {
        const response = await fetch('scratch/cluster_node_status.txt?t=' + Date.now());
        if (!response.ok) throw new Error('Live telemetry file unreachable');
        const text = await response.text();

        let totalAlloc = 0;
        let totalIdle = 0;

        const lines = text.split('\n');
        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
                const state = parts[4].toLowerCase();
                const count = parseInt(parts[3]) || 0;
                if (state.includes('alloc')) {
                    totalAlloc += count;
                } else if (state.includes('idle')) {
                    totalIdle += count;
                } else if (state.includes('mix')) {
                    totalAlloc += Math.round(count * 0.7);
                    totalIdle += Math.round(count * 0.3);
                }
            }
        });

        const lumiTotal = (totalAlloc + totalIdle) || 4360;
        if (TOTAL_NODES !== lumiTotal) {
            TOTAL_NODES = lumiTotal;
        }

        const loadPct = (totalAlloc / TOTAL_NODES) * 100;
        currentLoad = loadPct;

        updateNodeCount();
        updateMusicEngine();

        const log = document.getElementById('noteLog');
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerText = `> Live LUMI Sync: ${totalAlloc} Alloc / ${totalIdle} Idle (${loadPct.toFixed(1)}% Load)`;
        log.prepend(entry);
        if (log.children.length > 12) log.removeChild(log.lastChild);

    } catch (err) {
        if (TOTAL_NODES !== 4315) TOTAL_NODES = 4315;
        currentLoad = 91.3;
        updateNodeCount();
        updateMusicEngine();
    }
}
