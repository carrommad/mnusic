// =============================================================================
// worker.js — OffscreenCanvas Web Worker: Particle Engine & Render Loop
// Runs in an isolated thread. Receives postMessage commands from the main thread.
// =============================================================================

let canvas = null;
let ctx = null;
let width = 800;
let height = 600;
let nodeObjects = [];
let soundRipples = [];

let currentLoad = 97.5;
let TOTAL_NODES = 1944;
let stretchFactor = 1.8;
let nodeBlobScale = 1.0;
let collisionPercent = 15;

let mouseX = -1000;
let mouseY = -1000;

let globalBreathingPhase = 0;
let breathingCycleSeconds = 30;
let breathingPhaseDriftMult = 0.37;

// ---------------------------------------------------------------------------
// Message dispatcher
// ---------------------------------------------------------------------------
self.onmessage = function(e) {
    const data = e.data;

    if (data.type === 'mouseMove') {
        mouseX = data.x;
        mouseY = data.y;
    }
    else if (data.type === 'init') {
        canvas = data.canvas;
        width = data.width;
        height = data.height;
        const dpr = Math.min(data.dpr || 1, 1.5);
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);

        ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) ctx.scale(dpr, dpr);

        // GPU context loss auto-recovery
        if (canvas.addEventListener) {
            canvas.addEventListener('webglcontextlost', (evt) => evt.preventDefault(), false);
            canvas.addEventListener('contextlost', (evt) => {
                evt.preventDefault();
                ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
            }, false);
        }

        TOTAL_NODES = data.totalNodes;
        currentLoad = data.currentLoad;
        nodeBlobScale = data.nodeBlobScale || 1.0;
        stretchFactor = data.stretchFactor || 1.8;
        collisionPercent = data.collisionPercent !== undefined ? data.collisionPercent : 15;
        breathingCycleSeconds = data.breathingCycleSeconds || 30;
        breathingPhaseDriftMult = data.breathingPhaseDriftMult || 0.37;
        initNodeObjects();
        renderLoop();
    }
    else if (data.type === 'resize') {
        width = data.width;
        height = data.height;
        const dpr = data.dpr || 1;
        if (canvas) {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            if (ctx) ctx.scale(dpr, dpr);
        }
    }
    else if (data.type === 'updateState') {
        currentLoad = data.currentLoad;
        TOTAL_NODES = data.totalNodes;
        stretchFactor = data.stretchFactor;
        nodeBlobScale = data.nodeBlobScale || 1.0;
        collisionPercent = data.collisionPercent !== undefined ? data.collisionPercent : 15;
        breathingCycleSeconds = data.breathingCycleSeconds;
        breathingPhaseDriftMult = data.breathingPhaseDriftMult;
        initNodeObjects();
    }
    else if (data.type === 'spawnRippleFromRandomNode') {
        const targetNode = nodeObjects[data.nodeIndex] || nodeObjects[Math.floor(Math.random() * nodeObjects.length)];
        if (targetNode) {
            targetNode.flashAlpha = 3.5; // Intense luminescent glow flash on node
            let colorStr = '6, 182, 212';
            if (targetNode.type === 'gpu') colorStr = '245, 158, 11';
            else if (targetNode.type === 'inter') colorStr = '244, 63, 94';

            soundRipples.push({
                parentNode: targetNode,
                x: targetNode.x,
                y: targetNode.y,
                maxR: Math.max(220, (data.maxR || 100) * 2.5), // Big expanding circumference ring
                currR: 0,
                color: colorStr,
                duration: 75, // Smooth ~1.25 second expansion pulse
                frame: 0
            });
        }
    }
};

// ---------------------------------------------------------------------------
// Node pool: maintains TOTAL_NODES particles, toggling visibility via busyAlpha
// ---------------------------------------------------------------------------
function initNodeObjects() {
    if (nodeObjects.length !== TOTAL_NODES) {
        nodeObjects = [];
        for (let i = 0; i < TOTAL_NODES; i++) {
            let type = 'cpu';
            let baseRadius = Math.random() * 1.5 + 1.2;

            const randType = Math.random();
            if (randType < 0.03) {
                type = 'gpu';
                baseRadius = Math.random() * 3 + 4.5;
            } else if (randType < 0.08) {
                type = 'inter';
                baseRadius = Math.random() * 2 + 2.5;
            }

            nodeObjects.push({
                id: i,
                type: type,
                x: Math.random() * (width || 1200),
                y: Math.random() * (height || 800),
                vx: (Math.random() - 0.5) * 0.8,
                vy: (Math.random() - 0.5) * 0.8,
                baseRadius: baseRadius,
                isBusy: true,
                targetBusy: true,
                busyAlpha: 1.0,
                flashAlpha: 0.0,
                angle: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.018
            });
        }
    }

    // Mark exactly allocCount nodes as visible
    const allocCount = Math.round((currentLoad / 100) * TOTAL_NODES);
    for (let i = 0; i < nodeObjects.length; i++) {
        const node = nodeObjects[i];
        const isAllocated = i < allocCount;
        node.targetBusy = isAllocated;
        node.busyAlpha = isAllocated ? 1.0 : 0.0;
    }
}

// ---------------------------------------------------------------------------
// Render loop: runs at 60 FPS via requestAnimationFrame
// ---------------------------------------------------------------------------
function renderLoop() {
    if (!ctx) return;

    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, width, height);

    const phaseStep = (Math.PI * 2) / (breathingCycleSeconds * 60);
    globalBreathingPhase += phaseStep;

    const harmonicDepth = breathingPhaseDriftMult * 2.5; // Amplified depth for strong visual contrast
    const maxAmplitude = (stretchFactor - 1.0) * harmonicDepth;
    const wave = (Math.sin(globalBreathingPhase) * 0.70 + Math.sin(globalBreathingPhase * breathingPhaseDriftMult) * 0.30);
    const slowOrganicDrift = wave * maxAmplitude;
    const normalizedBreathing = Math.max(-1.0, Math.min(1.0, wave));
    const currentDynamicStretch = Math.max(1.0, stretchFactor + slowOrganicDrift * 1.8);

    self.postMessage({
        type: 'breathingUpdate',
        normalizedBreathing: normalizedBreathing,
        currentDynamicStretch: currentDynamicStretch
    });

    // --- O(N) Spatial Grid for Collision Detection ---
    const gridSize = 45;
    const grid = new Map();

    if (collisionPercent > 0) {
        for (let i = 0; i < nodeObjects.length; i++) {
            const n = nodeObjects[i];
            if ((n.id % 100) < collisionPercent) {
                const col = Math.floor(n.x / gridSize);
                const row = Math.floor(n.y / gridSize);
                const key = `${col}_${row}`;
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push(n);
            }
        }
    }

    let sparkCount = 0;
    grid.forEach((nodes) => {
        if (nodes.length < 2) return;
        for (let i = 0; i < nodes.length; i++) {
            const n1 = nodes[i];
            for (let j = i + 1; j < nodes.length; j++) {
                const n2 = nodes[j];
                const dx = n2.x - n1.x;
                const dy = n2.y - n1.y;
                const distSq = dx * dx + dy * dy;
                const minDist = (n1.baseRadius + n2.baseRadius) * 2.2 * nodeBlobScale;

                if (distSq < minDist * minDist && distSq > 0.5) {
                    const dist = Math.sqrt(distSq);
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const bounceForce = 0.35 * (collisionPercent / 50.0);

                    n1.vx -= nx * bounceForce;
                    n1.vy -= ny * bounceForce;
                    n2.vx += nx * bounceForce;
                    n2.vy += ny * bounceForce;

                    n1.rotSpeed += (Math.random() - 0.5) * 0.02 * (collisionPercent / 50.0);
                    n2.rotSpeed += (Math.random() - 0.5) * 0.02 * (collisionPercent / 50.0);

                    if (soundRipples.length < 20 && Math.random() < 0.4) {
                        soundRipples.push({
                            x: (n1.x + n2.x) * 0.5,
                            y: (n1.y + n2.y) * 0.5,
                            maxR: 25, currR: 0,
                            color: '148, 163, 184',
                            duration: 25, frame: 0
                        });
                    }
                    sparkCount++;
                }
            }
        }
    });

    if (sparkCount > 0 && Math.random() < 0.25) {
        self.postMessage({ type: 'collisionSparks', count: sparkCount });
    }

    const loadRatio = currentLoad / 100;
    const currentStretch = 1.0 + (currentDynamicStretch - 1.0) * loadRatio;
    let displacedCount = 0;

    for (let i = 0; i < nodeObjects.length; i++) {
        const n = nodeObjects[i];

        if (mouseX >= 0 && mouseY >= 0) {
            const dx = n.x - mouseX;
            const dy = n.y - mouseY;
            const distSq = dx * dx + dy * dy;
            const forceRadius = 60;
            if (distSq < forceRadius * forceRadius && distSq > 1) {
                const dist = Math.sqrt(distSq);
                const force = (1.0 - dist / forceRadius) * 0.8;
                n.vx += (dx / dist) * force;
                n.vy += (dy / dist) * force;
                n.flashAlpha = Math.max(n.flashAlpha, 0.7);
                displacedCount++;
            }
        }

        n.vx *= 0.98;
        n.vy *= 0.98;

        n.x += (n.vx + (n.vx > 0 ? 0.3 : -0.3)) * (0.4 + loadRatio);
        n.y += (n.vy + (n.vy > 0 ? 0.3 : -0.3)) * (0.4 + loadRatio);
        n.angle += n.rotSpeed * (0.4 + loadRatio);

        const margin = 40;
        if (n.x < -margin) n.x = width + margin;
        if (n.x > width + margin) n.x = -margin;
        if (n.y < -margin) n.y = height + margin;
        if (n.y > height + margin) n.y = -margin;

        n.busyAlpha = n.targetBusy ? 1.0 : 0.0;

        if (n.flashAlpha > 0.01) {
            n.flashAlpha *= 0.90;
        } else {
            n.flashAlpha = 0.0;
        }

        ctx.save();
        ctx.translate(n.x, n.y);
        ctx.rotate(n.angle);

        const effStretch = 1.0 + (currentStretch - 1.0) * n.busyAlpha;
        let radiusX = n.baseRadius * Math.sqrt(effStretch) * nodeBlobScale;
        let radiusY = (n.baseRadius / Math.sqrt(effStretch)) * nodeBlobScale;

        if (n.flashAlpha > 0.1) {
            radiusX *= (1.0 + n.flashAlpha * 0.4);
            radiusY *= (1.0 + n.flashAlpha * 0.4);
        }

        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(0.1, radiusX), Math.max(0.1, radiusY), 0, 0, Math.PI * 2);

        if (n.flashAlpha > 0.05) {
            ctx.fillStyle = `rgba(255, 255, 255, ${0.7 + n.flashAlpha * 0.3})`;
            ctx.fill();
        } else if (n.busyAlpha > 0.05) {
            if (n.type === 'gpu') {
                ctx.fillStyle = `rgba(245, 158, 11, ${0.5 + n.busyAlpha * 0.5})`;
            } else if (n.type === 'inter') {
                ctx.fillStyle = `rgba(244, 63, 94, ${0.55 + n.busyAlpha * 0.45})`;
            } else {
                ctx.fillStyle = `rgba(6, 182, 212, ${(0.50 + loadRatio * 0.45) * n.busyAlpha})`;
            }
            ctx.fill();
        }
        ctx.restore();
    }

    if (displacedCount > 0 && Math.random() < 0.35) {
        self.postMessage({ type: 'nodeDisplaced', count: displacedCount, mouseX: mouseX, mouseY: mouseY });
    }

    // Cap ripple count
    if (soundRipples.length > 15) soundRipples.splice(0, soundRipples.length - 15);

    // Draw expanding acoustic ripples
    for (let i = soundRipples.length - 1; i >= 0; i--) {
        const r = soundRipples[i];
        r.frame++;
        const progress = r.frame / r.duration;
        const currR = r.maxR * Math.sin(progress * Math.PI);
        const alpha = Math.sin(progress * Math.PI) * 0.75;

        if (r.parentNode) {
            r.x = r.parentNode.x;
            r.y = r.parentNode.y;
            r.parentNode.flashAlpha = Math.max(r.parentNode.flashAlpha, alpha * 1.2);
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(r.x, r.y, Math.max(0.1, currR), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r.color}, ${alpha})`;
        ctx.lineWidth = Math.max(1.8, 3.5 * (1.0 - progress));
        ctx.stroke();

        // Inner glowing halo ring
        ctx.beginPath();
        ctx.arc(r.x, r.y, Math.max(0.1, currR * 0.85), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r.color}, ${alpha * 0.45})`;
        ctx.lineWidth = 1.0;
        ctx.stroke();

        ctx.restore();

        if (progress >= 1.0) {
            soundRipples.splice(i, 1);
        }
    }

    requestAnimationFrame(renderLoop);
}
