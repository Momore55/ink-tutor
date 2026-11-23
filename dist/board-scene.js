/**
 * board-scene.js - Ink Tutor SVG/Canvas Board Renderer
 * 
 * Provides smooth spline interpolation and catch-up rendering for handwritten vector strokes.
 * Designed to work directly with PlaybackSynchronizer for real-time audio-visual sync.
 */

export class BoardScene {
    /**
     * @param {HTMLElement|HTMLCanvasElement|SVGSVGElement} container - Canvas or SVG container element
     * @param {Object} options - Renderer configuration options
     */
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            strokeColor: options.strokeColor || '#1e293b',
            strokeWidth: options.strokeWidth || 3,
            smoothness: options.smoothness || 0.25, // Catmull-Rom tension
            useCanvas: container instanceof HTMLCanvasElement,
            ...options
        };

        this.activeStrokes = new Map(); // strokeId -> { points, pathElement, completed }
        this.completedStrokes = [];

        if (this.options.useCanvas) {
            this.ctx = this.container.getContext('2d');
            this.setupCanvasPixelRatio();
        } else {
            // Assume SVG container
            this.svgGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            this.svgGroup.setAttribute('id', 'ink-tutor-strokes');
            this.container.appendChild(this.svgGroup);
        }
    }

    /**
     * Ensures high-DPI crisp canvas rendering on Retina displays
     */
    setupCanvasPixelRatio() {
        if (!this.ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.container.getBoundingClientRect();
        this.container.width = rect.width * dpr;
        this.container.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
    }

    /**
     * Renders a stroke at exact progress [0.0 to 1.0], correctly handling time-delta catchups.
     * 
     * @param {string} strokeId - Unique stroke identifier
     * @param {number} progress - Elapsed progress [0.0, 1.0]
     * @param {Object} currentPoint - Current interpolated point {x, y}
     * @param {Array<Object>} points - Full array of vector keyframe points [{x, y}, ...]
     */
    renderStrokeProgress(strokeId, progress, currentPoint, points) {
        if (!points || points.length === 0) return;

        let strokeState = this.activeStrokes.get(strokeId);
        if (!strokeState) {
            strokeState = this._createStrokeElement(strokeId);
            this.activeStrokes.set(strokeId, strokeState);
        }

        // Clamp progress
        const clampedProgress = Math.min(Math.max(progress, 0), 1);

        // Determine how many discrete points have been traversed
        const maxIndex = points.length - 1;
        const exactIndex = clampedProgress * maxIndex;
        const targetIndex = Math.min(Math.floor(exactIndex) + 1, maxIndex);

        // Extract active points up to the current fractional index + current interpolated point
        const activeSubPoints = points.slice(0, targetIndex);
        if (currentPoint) {
            activeSubPoints.push(currentPoint);
        }

        // Generate smooth Catmull-Rom spline path string
        const dPath = this._generateSplinePath(activeSubPoints);

        if (this.options.useCanvas) {
            this._drawCanvasPath(strokeState, dPath);
        } else if (strokeState.pathElement) {
            strokeState.pathElement.setAttribute('d', dPath);
        }
    }

    /**
     * Finalizes a completed stroke (e.g. bakes SVG path into static layer or main canvas)
     * @param {string} strokeId 
     */
    markStrokeFinished(strokeId) {
        const strokeState = this.activeStrokes.get(strokeId);
        if (strokeState) {
            strokeState.completed = true;
            this.completedStrokes.push(strokeState);
            this.activeStrokes.delete(strokeId);
        }
    }

    /**
     * Instantly purges active or uncompleted strokes on user barge-in / interruption
     */
    cancelActiveStrokes() {
        for (const [strokeId, strokeState] of this.activeStrokes.entries()) {
            if (strokeState.pathElement && strokeState.pathElement.parentNode) {
                strokeState.pathElement.parentNode.removeChild(strokeState.pathElement);
            }
        }
        this.activeStrokes.clear();
        if (this.options.useCanvas) {
            this.redrawCanvas();
        }
    }

    /**
     * Clears all strokes on the whiteboard canvas
     */
    clearBoard() {
        this.cancelActiveStrokes();
        this.completedStrokes = [];
        if (!this.options.useCanvas && this.svgGroup) {
            this.svgGroup.innerHTML = '';
        } else if (this.ctx) {
            this.ctx.clearRect(0, 0, this.container.width, this.container.height);
        }
    }

    /**
     * Creates a new path node in SVG or Canvas context
     * @private
     */
    _createStrokeElement(strokeId) {
        if (this.options.useCanvas) {
            return { id: strokeId, completed: false, pathData: '' };
        }

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('id', `stroke-${strokeId}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', this.options.strokeColor);
        path.setAttribute('stroke-width', this.options.strokeWidth);
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        this.svgGroup.appendChild(path);

        return { id: strokeId, pathElement: path, completed: false };
    }

    /**
     * Converts a series of coordinate points into a smooth Catmull-Rom cubic bezier SVG path string
     * @private
     */
    _generateSplinePath(points) {
        if (!points || points.length === 0) return '';
        if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
        if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

        let d = `M ${points[0].x} ${points[0].y}`;
        const alpha = this.options.smoothness;

        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[Math.max(i - 1, 0)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(i + 2, points.length - 1)];

            // Calculate Catmull-Rom control points
            const cp1x = p1.x + (p2.x - p0.x) * alpha;
            const cp1y = p1.y + (p2.y - p0.y) * alpha;
            const cp2x = p2.x - (p3.x - p1.x) * alpha;
            const cp2y = p2.y - (p3.y - p1.y) * alpha;

            d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
        }

        return d;
    }

    /**
     * Renders path onto Canvas context
     * @private
     */
    _drawCanvasPath(strokeState, dPath) {
        strokeState.pathData = dPath;
        this.redrawCanvas();
    }

    /**
     * Redraws all strokes on HTML5 Canvas
     */
    redrawCanvas() {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.container.width, this.container.height);

        const all = [...this.completedStrokes, ...this.activeStrokes.values()];
        for (const stroke of all) {
            if (!stroke.pathData) continue;
            const path2D = new Path2D(stroke.pathData);
            this.ctx.strokeStyle = this.options.strokeColor;
            this.ctx.lineWidth = this.options.strokeWidth;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.stroke(path2D);
        }
    }
}
