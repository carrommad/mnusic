// =============================================================================
// telemetry.js — Cluster Node Status Fetcher & UI Telemetry Counter Sync
// Reads scratch/cluster_node_status.txt for live LUMI telemetry updates
// =============================================================================

function updateNodeCount() {
    const newAllocCount = Math.round((currentLoad / 100) * TOTAL_NODES);
    const delta = newAllocCount - previousAllocCount;

    const busyGpu = Math.round(newAllocCount * 0.01);
    const busyCpu = newAllocCount - busyGpu;

    document.getElementById('statAlloc').innerText = newAllocCount.toLocaleString();
    document.getElementById('statIdle').innerText = (TOTAL_NODES - newAllocCount).toLocaleString();
    document.getElementById('hudNodes').innerText = `${newAllocCount.toLocaleString()} / ${TOTAL_NODES.toLocaleString()} Nodes`;
    document.getElementById('statCpu').innerText = busyCpu.toLocaleString();
    document.getElementById('statGpu').innerText = busyGpu.toLocaleString();

    syncWorkerState();

    if (delta !== 0 && isPlaying) {
        triggerVirtualXylophoneWaterfall(previousAllocCount, newAllocCount);
    }

    previousAllocCount = newAllocCount;
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
