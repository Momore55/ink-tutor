/**
 * Ink Tutor - Audio-Visual Playback Synchronizer (playback-sync.js)
 * 
 * Solves audio-visual timing desynchronization between Gemini Live 24kHz PCM audio output
 * and dynamic SVG canvas stroke rendering.
 * 
 * Key Features:
 * 1. Audio Clock-Driven Epoch Anchoring: Maps stroke progress directly to AudioContext.currentTime.
 * 2. Hardware Output Latency Compensation: Incorporates AudioContext.outputLatency for Bluetooth/speakers.
 * 3. Time-Delta Continuous Interpolation: Prevents frame-rate drops from causing cumulative lag.
 * 4. Instant Barge-In Flushing: Instantly halts active drawings upon interruption events.
 */

export class PlaybackSynchronizer {
    /**
     * @param {AudioContext} audioCtx - Active Web Audio context
     * @param {Object} options - Configuration parameters
     * @param {Function} options.onRenderStrokePoint - Callback to draw stroke points (strokeId, progress, point)
     * @param {Function} options.onStrokeComplete - Callback when a stroke finishes drawing
     * @param {number} [options.manualDelayMs=0] - Additional manual user offset calibration in milliseconds
     */
    constructor(audioCtx, options = {}) {
        this.audioCtx = audioCtx;
        this.onRenderStrokePoint = options.onRenderStrokePoint || (() => {});
        this.onStrokeComplete = options.onStrokeComplete || (() => {});
        this.manualDelayMs = options.manualDelayMs || 0;

        this.strokeQueue = [];
        this.activeStrokes = [];
        this.animFrameId = null;
        this.playbackEpochTime = null; // AudioContext timestamp corresponding to t=0 of speech
        this.isRunning = false;
    }

    /**
     * Set or reset the speech playback epoch.
     * Call this when a new turn's audio stream starts playing.
     * 
     * @param {number} [epochTime] - AudioContext timestamp for start of turn. Defaults to current time.
     */
    startTurn(epochTime = null) {
        this.playbackEpochTime = epochTime !== null ? epochTime : this.audioCtx.currentTime;
        this.strokeQueue = [];
        this.activeStrokes = [];
        this.isRunning = true;
        
        if (!this.animFrameId) {
            this.loop = this.loop.bind(this);
            this.animFrameId = requestAnimationFrame(this.loop);
        }
    }

    /**
     * Compute current hardware output latency (speakers, wired, or Bluetooth).
     * @returns {number} Delay in seconds
     */
    getHardwareLatencySeconds() {
        const outputLatency = this.audioCtx.outputLatency || 0;
        const baseLatency = this.audioCtx.baseLatency || 0;
        const manualDelay = this.manualDelayMs / 1000.0;
        return outputLatency + baseLatency + manualDelay;
    }

    /**
     * Queue a vector stroke or drawing action received from the model/drawing agent.
     * 
     * @param {Object} strokeData
     * @param {string} strokeData.id - Unique stroke identifier
     * @param {Array<{x: number, y: number}>} strokeData.points - Array of trajectory coordinate points
     * @param {number} strokeData.onsetSeconds - Estimated onset time relative to audio start (seconds)
     * @param {number} strokeData.durationSeconds - Expected total drawing duration (seconds)
     */
    enqueueStroke(strokeData) {
        this.strokeQueue.push({
            id: strokeData.id,
            points: strokeData.points,
            onsetSeconds: strokeData.onsetSeconds,
            durationSeconds: Math.max(0.05, strokeData.durationSeconds), // Avoid division by zero
            started: false,
            completed: false
        });
        
        // Sort queue chronologically by onset time
        this.strokeQueue.sort((a, b) => a.onsetSeconds - b.onsetSeconds);
    }

    /**
     * Main animation loop running on requestAnimationFrame.
     * Computes exact progress using time-deltas against AudioContext.currentTime.
     */
    loop() {
        if (!this.isRunning) {
            this.animFrameId = null;
            return;
        }

        const now = this.audioCtx.currentTime;
        const hardwareDelay = this.getHardwareLatencySeconds();
        
        // Effective audio clock time elapsed since speech turn epoch, adjusted for physical sound output delay
        const audioClockTime = Math.max(0, (now - this.playbackEpochTime) - hardwareDelay);

        // 1. Promote scheduled strokes from queue to active list when onset timestamp is reached
        for (let i = this.strokeQueue.length - 1; i >= 0; i--) {
            const stroke = this.strokeQueue[i];
            if (audioClockTime >= stroke.onsetSeconds) {
                stroke.started = true;
                this.activeStrokes.push(stroke);
                this.strokeQueue.splice(i, 1);
            }
        }

        // 2. Render active strokes using time-delta catchup
        for (let i = this.activeStrokes.length - 1; i >= 0; i--) {
            const stroke = this.activeStrokes[i];
            const elapsedSinceOnset = audioClockTime - stroke.onsetSeconds;
            
            // Continuous progress calculation [0.0, 1.0]
            const rawProgress = elapsedSinceOnset / stroke.durationSeconds;
            const progress = Math.min(1.0, Math.max(0.0, rawProgress));

            // Determine target point index based on progress
            const pointCount = stroke.points.length;
            const targetIndex = Math.floor(progress * (pointCount - 1));
            const currentPoint = stroke.points[targetIndex] || stroke.points[pointCount - 1];

            // Trigger canvas draw callback
            this.onRenderStrokePoint(stroke.id, progress, currentPoint, stroke.points);

            // Mark completion if stroke duration has elapsed
            if (progress >= 1.0) {
                stroke.completed = true;
                this.onStrokeComplete(stroke.id);
                this.activeStrokes.splice(i, 1);
            }
        }

        // Continue animation loop
        this.animFrameId = requestAnimationFrame(this.loop);
    }

    /**
     * Handle interruption (barge-in event).
     * Immediately clears all pending and active strokes and stops the render loop.
     */
    handleInterruption() {
        this.strokeQueue = [];
        this.activeStrokes = [];
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    /**
     * Update manual calibration delay in milliseconds.
     * @param {number} delayMs 
     */
    setManualDelay(delayMs) {
        this.manualDelayMs = delayMs;
    }
}
