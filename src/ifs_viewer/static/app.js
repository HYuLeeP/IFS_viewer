(() => {
    "use strict";

    const VIRIDIS_STOPS = [
        [68, 1, 84],
        [72, 35, 116],
        [64, 67, 135],
        [52, 94, 141],
        [41, 120, 142],
        [32, 144, 140],
        [34, 167, 132],
        [68, 190, 112],
        [121, 209, 81],
        [189, 223, 38],
        [253, 231, 37],
    ];

    const dom = {
        hduSelect: document.querySelector("#hduSelect"),
        bandControl: document.querySelector("#bandControl"),
        bandSelect: document.querySelector("#bandSelect"),
        selectedFilePicker: document.querySelector("#selectedFilePicker"),
        selectExplorerButton: document.querySelector("#selectExplorerButton"),
        openPathButton: document.querySelector("#openPathButton"),
        pathDialog: document.querySelector("#pathDialog"),
        pathForm: document.querySelector("#pathForm"),
        pathInput: document.querySelector("#pathInput"),
        pathError: document.querySelector("#pathError"),
        submitPathButton: document.querySelector("#submitPathButton"),
        closePathButton: document.querySelector("#closePathButton"),
        cancelPathButton: document.querySelector("#cancelPathButton"),
        recentPathList: document.querySelector("#recentPathList"),
        statusDot: document.querySelector("#statusDot"),
        loadStatus: document.querySelector("#loadStatus"),
        themeChoices: document.querySelectorAll("[data-theme-choice]"),
        workspace: document.querySelector("#workspace"),
        rightStack: document.querySelector(".right-stack"),
        rightSplitter: document.querySelector("#rightSplitter"),
        infoPanel: document.querySelector(".panel--info"),
        mapViewButton: document.querySelector("#mapViewButton"),
        spectrumViewButton: document.querySelector("#spectrumViewButton"),
        splitter: document.querySelector("#splitter"),
        mapViewport: document.querySelector("#mapViewport"),
        mapTitle: document.querySelector("#mapTitle"),
        mapCanvas: document.querySelector("#mapCanvas"),
        mapEmpty: document.querySelector("#mapEmpty"),
        mapBusy: document.querySelector("#mapBusy"),
        mapResetButton: document.querySelector("#mapResetButton"),
        rotationHandle: document.querySelector("#rotationHandle"),
        rotationReadout: document.querySelector("#rotationReadout"),
        pixelTooltip: document.querySelector("#pixelTooltip"),
        colorMinInput: document.querySelector("#colorMinInput"),
        colorMaxInput: document.querySelector("#colorMaxInput"),
        colorLowHandle: document.querySelector("#colorLowHandle"),
        colorHighHandle: document.querySelector("#colorHighHandle"),
        colorbarTrack: document.querySelector("#colorbarTrack"),
        colorResetButton: document.querySelector("#colorResetButton"),
        colorFullButton: document.querySelector("#colorFullButton"),
        colorTightenButton: document.querySelector("#colorTightenButton"),
        colorWidenButton: document.querySelector("#colorWidenButton"),
        imageRangeChip: document.querySelector("#imageRangeChip"),
        projectionSwitch: document.querySelector("#projectionSwitch"),
        imageStatisticInputs: document.querySelectorAll(
            'input[name="imageStatistic"]',
        ),
        projectionLabel: document.querySelector("#projectionLabel"),
        integratedInterval: document.querySelector("#integratedInterval"),
        selectedPixelLabel: document.querySelector("#selectedPixelLabel"),
        spectrumPlot: document.querySelector("#spectrumPlot"),
        spectrumEmpty: document.querySelector("#spectrumEmpty"),
        spectrumModeChip: document.querySelector("#spectrumModeChip"),
        spectrumResetButton: document.querySelector("#spectrumResetButton"),
        redshiftInput: document.querySelector("#redshiftInput"),
        restFrameToggle: document.querySelector("#restFrameToggle"),
        lineSelect: document.querySelector("#lineSelect"),
        lineHint: document.querySelector("#lineHint"),
        lineResult: document.querySelector("#lineResult"),
        clearLineButton: document.querySelector("#clearLineButton"),
        summaryGrid: document.querySelector("#summaryGrid"),
        headerCount: document.querySelector("#headerCount"),
        headerWarning: document.querySelector("#headerWarning"),
        headerDetails: document.querySelector("#headerDetails"),
        headerTableBody: document.querySelector("#headerTableBody"),
        toastRegion: document.querySelector("#toastRegion"),
        appLoader: document.querySelector("#appLoader"),
        appLoaderText: document.querySelector("#appLoaderText"),
    };

    const state = {
        cube: null,
        activeSource: null,
        lines: [],
        image: null,
        spectrum: null,
        selectedPixel: null,
        observedRange: null,
        defaultWavelengthRange: null,
        colorLimits: { min: 0, max: 1 },
        autoColorLimits: { min: 0, max: 1 },
        colorDataRange: { min: 0, max: 1 },
        colorEditRange: { min: 0, max: 1 },
        linesByIndex: [],
        redshift: 0,
        hasRedshift: false,
        restFrame: false,
        clickedObservedWavelength: null,
        imageRequest: null,
        spectrumRequest: null,
        mapHasData: false,
        narrowView: "map",
        imageStatistic: "median",
        dataKind: null,
        supportsSpectrum: false,
    };

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function niceNumber(value) {
        if (!Number.isFinite(value)) {
            return "—";
        }
        const absolute = Math.abs(value);
        if (absolute !== 0 && (absolute >= 10000 || absolute < 0.01)) {
            return value.toExponential(3);
        }
        if (absolute >= 100) {
            return value.toFixed(1);
        }
        if (absolute >= 1) {
            return value.toFixed(3);
        }
        return value.toPrecision(4);
    }

    function formatWavelength(value) {
        return Number.isFinite(value) ? `${value.toFixed(2)} Å` : "—";
    }

    function textElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        element.textContent = text;
        return element;
    }

    function showToast(message, kind = "info", duration = 4200) {
        const toast = document.createElement("div");
        toast.className = `toast${kind === "error" ? " is-error" : ""}${kind === "warning" ? " is-warning" : ""}`;
        toast.textContent = message;
        dom.toastRegion.append(toast);
        window.setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateY(5px)";
            window.setTimeout(() => toast.remove(), 180);
        }, duration);
    }

    function setStatus(label, status = "ready") {
        dom.loadStatus.textContent = label;
        dom.statusDot.className = "status-dot";
        if (status === "ready") {
            dom.statusDot.classList.add("is-ready");
        } else if (status === "loading") {
            dom.statusDot.classList.add("is-loading");
        } else if (status === "error") {
            dom.statusDot.classList.add("is-error");
        }
    }

    async function apiJson(url, options = {}) {
        const response = await fetch(url, options);
        let payload;
        try {
            payload = await response.json();
        } catch (error) {
            throw new Error(`The server returned an unreadable response (${response.status}).`);
        }
        if (!response.ok) {
            throw new Error(payload.error || `Request failed with status ${response.status}.`);
        }
        return payload;
    }

    function themeColors() {
        const styles = getComputedStyle(document.documentElement);
        const color = (name) => styles.getPropertyValue(name).trim();
        return {
            mapCanvas: color("--map-canvas-bg"),
            mapPlot: color("--map-plot-bg"),
            mapBorder: color("--map-border"),
            mapAxis: color("--map-axis"),
            mapAxisLine: color("--map-axis-line"),
            mapHint: color("--map-hint"),
            mapHover: color("--map-hover"),
            plotPaper: color("--plot-paper"),
            plotFont: color("--plot-font"),
            plotAxis: color("--plot-axis"),
            plotGrid: color("--plot-grid"),
            plotAxisLine: color("--plot-axis-line"),
            plotTick: color("--plot-tick"),
            plotTickMinor: color("--plot-tick-minor"),
        };
    }

    function applyTheme(theme, { persist = true } = {}) {
        const selectedTheme = theme === "light" ? "light" : "dark";
        document.documentElement.dataset.theme = selectedTheme;
        document.documentElement.style.colorScheme = selectedTheme;
        for (const button of dom.themeChoices) {
            const active = button.dataset.themeChoice === selectedTheme;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        }
        if (persist) {
            try {
                localStorage.setItem("ifs-viewer-theme", selectedTheme);
            } catch {
                // Theme persistence is optional.
            }
        }
        mapView.requestRender();
        if (state.spectrum) {
            renderSpectrum({ preserveRange: true });
        }
    }

    class MapView {
        constructor(canvas, viewport, rotationHandle) {
            this.canvas = canvas;
            this.viewport = viewport;
            this.rotationHandle = rotationHandle;
            this.context = canvas.getContext("2d", { alpha: false });
            this.imagePayload = null;
            this.values = null;
            this.height = 0;
            this.width = 0;
            this.pixelOriginX = 0;
            this.pixelOriginY = 0;
            this.zoom = 1;
            this.panX = 0;
            this.panY = 0;
            this.rotation = 0;
            this.hoverPixel = null;
            this.selectedPixel = null;
            this.colorMin = 0;
            this.colorMax = 1;
            this.offscreen = document.createElement("canvas");
            this.offscreenContext = this.offscreen.getContext("2d");
            this.fitScale = 1;
            this.dpr = 1;
            this.logicalWidth = 1;
            this.logicalHeight = 1;
            this.plot = { left: 54, top: 20, right: 14, bottom: 46 };
            this.dragMode = null;
            this.dragStart = null;
            this.lastPointer = null;
            this.rotationStart = 0;
            this.frameRequested = false;
            this.callbacks = {
                onPixelClick: () => {},
                onPixelHover: () => {},
            };
            this.bindEvents();
            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(viewport);
        }

        setCallbacks(callbacks) {
            this.callbacks = { ...this.callbacks, ...callbacks };
        }

        setImage(payload) {
            this.imagePayload = payload;
            this.values = payload.values;
            this.height = payload.shape[0];
            this.width = payload.shape[1];
            this.pixelOriginX = payload.pixel_origin?.x || 0;
            this.pixelOriginY = payload.pixel_origin?.y || 0;
            this.zoom = 1;
            this.panX = 0;
            this.panY = 0;
            this.hoverPixel = null;
            this.computeFitScale();
            this.buildOffscreenImage();
            this.resize();
        }

        setColorLimits(minimum, maximum) {
            if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
                return;
            }
            if (minimum >= maximum) {
                return;
            }
            this.colorMin = minimum;
            this.colorMax = maximum;
            this.buildOffscreenImage();
            this.requestRender();
        }

        setSelectedPixel(pixel) {
            this.selectedPixel = pixel;
            this.requestRender();
        }

        clear() {
            this.imagePayload = null;
            this.values = null;
            this.height = 0;
            this.width = 0;
            this.pixelOriginX = 0;
            this.pixelOriginY = 0;
            this.hoverPixel = null;
            this.selectedPixel = null;
            this.requestRender();
        }

        computeFitScale() {
            const plotWidth = Math.max(
                20,
                this.logicalWidth - this.plot.left - this.plot.right,
            );
            const plotHeight = Math.max(
                20,
                this.logicalHeight - this.plot.top - this.plot.bottom,
            );
            if (!this.width || !this.height) {
                this.fitScale = 1;
                return;
            }
            this.fitScale = Math.min(plotWidth / this.width, plotHeight / this.height) * 0.92;
        }

        resize() {
            const bounds = this.canvas.getBoundingClientRect();
            this.logicalWidth = Math.max(1, bounds.width);
            this.logicalHeight = Math.max(1, bounds.height);
            this.dpr = Math.min(2, window.devicePixelRatio || 1);
            this.canvas.width = Math.round(this.logicalWidth * this.dpr);
            this.canvas.height = Math.round(this.logicalHeight * this.dpr);
            this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            this.computeFitScale();
            this.requestRender();
        }

        totalScale() {
            return this.fitScale * this.zoom;
        }

        center() {
            const plotWidth = this.logicalWidth - this.plot.left - this.plot.right;
            const plotHeight = this.logicalHeight - this.plot.top - this.plot.bottom;
            return {
                x: this.plot.left + plotWidth / 2 + this.panX,
                y: this.plot.top + plotHeight / 2 + this.panY,
            };
        }

        buildOffscreenImage() {
            if (!this.values || !this.width || !this.height) {
                return;
            }
            this.offscreen.width = this.width;
            this.offscreen.height = this.height;
            const imageData = this.offscreenContext.createImageData(this.width, this.height);
            const output = imageData.data;
            const span = this.colorMax - this.colorMin;
            const denominator = span === 0 ? 1 : span;

            for (let y = 0; y < this.height; y += 1) {
                const outputY = this.height - 1 - y;
                for (let x = 0; x < this.width; x += 1) {
                    const value = this.values[y][x];
                    const offset = (outputY * this.width + x) * 4;
                    if (value === null || !Number.isFinite(value)) {
                        output[offset + 3] = 0;
                        continue;
                    }
                    const ratio = clamp((value - this.colorMin) / denominator, 0, 1);
                    const [red, green, blue] = interpolateViridis(ratio);
                    output[offset] = red;
                    output[offset + 1] = green;
                    output[offset + 2] = blue;
                    output[offset + 3] = 255;
                }
            }
            this.offscreenContext.putImageData(imageData, 0, 0);
        }

        requestRender() {
            if (this.frameRequested) {
                return;
            }
            this.frameRequested = true;
            requestAnimationFrame(() => {
                this.frameRequested = false;
                this.render();
            });
        }

        plotRectangle() {
            return {
                x: this.plot.left,
                y: this.plot.top,
                width: Math.max(
                    1,
                    this.logicalWidth - this.plot.left - this.plot.right,
                ),
                height: Math.max(
                    1,
                    this.logicalHeight - this.plot.top - this.plot.bottom,
                ),
            };
        }

        render() {
            const context = this.context;
            const plot = this.plotRectangle();
            const colors = themeColors();
            context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            context.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
            context.fillStyle = colors.mapCanvas;
            context.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
            context.fillStyle = colors.mapPlot;
            context.fillRect(plot.x, plot.y, plot.width, plot.height);
            context.strokeStyle = colors.mapBorder;
            context.lineWidth = 1;
            context.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.width - 1, plot.height - 1);

            if (!this.values) {
                this.rotationHandle.style.display = "none";
                return;
            }

            const center = this.center();
            const scale = this.totalScale();
            context.save();
            context.beginPath();
            context.rect(plot.x, plot.y, plot.width, plot.height);
            context.clip();
            context.save();
            context.translate(center.x, center.y);
            context.rotate(this.rotation);
            context.scale(scale, scale);
            context.translate(-this.width / 2, -this.height / 2);
            context.imageSmoothingEnabled = false;
            context.drawImage(this.offscreen, 0, 0);
            context.restore();

            if (this.selectedPixel) {
                this.drawPixelOutline(
                    context,
                    center,
                    scale,
                    this.selectedPixel,
                    1.05,
                    "#ff5252",
                );
            }
            if (this.hoverPixel) {
                this.drawPixelOutline(
                    context,
                    center,
                    scale,
                    this.hoverPixel,
                    1.38,
                    colors.mapHover,
                );
            }
            context.restore();

            this.drawAxes(context, plot, center, scale);
            this.positionRotationHandle(center, scale);
        }

        drawPixelOutline(context, center, scale, pixel, enlargement, color) {
            const margin = (enlargement - 1) / 2;
            const sourceX = pixel.x - margin;
            const sourceTop = this.height - 1 - pixel.y - margin;
            context.save();
            context.translate(center.x, center.y);
            context.rotate(this.rotation);
            context.scale(scale, scale);
            context.translate(-this.width / 2, -this.height / 2);
            context.strokeStyle = color;
            context.lineWidth = Math.max(1.2, 1.8 / scale);
            context.strokeRect(sourceX, sourceTop, enlargement, enlargement);
            context.restore();

            const screenPixel = this.worldToScreen(
                { x: pixel.x + 0.5, y: pixel.y + 0.5 },
                center,
                scale,
            );
            context.save();
            context.strokeStyle = color;
            context.globalAlpha = 0.5;
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(screenPixel.x - 5, screenPixel.y);
            context.lineTo(screenPixel.x + 5, screenPixel.y);
            context.moveTo(screenPixel.x, screenPixel.y - 5);
            context.lineTo(screenPixel.x, screenPixel.y + 5);
            context.stroke();
            context.restore();
        }

        drawAxes(context, plot, center, scale) {
            const colors = themeColors();
            context.save();
            context.font = "9px 'Cascadia Code', Consolas, monospace";
            context.fillStyle = colors.mapAxis;
            context.strokeStyle = colors.mapAxisLine;
            context.lineWidth = 1;
            context.textAlign = "center";
            context.textBaseline = "top";

            if (Math.abs(this.rotation) < 0.0001) {
                const imageLeft = center.x - (this.width / 2) * scale;
                const imageTop = center.y - (this.height / 2) * scale;
                const imageRight = center.x + (this.width / 2) * scale;
                const imageBottom = center.y + (this.height / 2) * scale;
                const xStep = niceAxisStep(this.width, 5);
                const yStep = niceAxisStep(this.height, 5);

                for (let x = 0; x <= this.width; x += xStep) {
                    const pixelX = imageLeft + x * scale;
                    if (pixelX < plot.x || pixelX > plot.x + plot.width) {
                        continue;
                    }
                    context.beginPath();
                    context.moveTo(pixelX, imageBottom);
                    context.lineTo(pixelX, imageBottom + 4);
                    context.stroke();
                    context.fillText(
                        String(x + this.pixelOriginX),
                        pixelX,
                        imageBottom + 7,
                    );
                }

                for (let y = 0; y <= this.height; y += yStep) {
                    const pixelY = imageBottom - y * scale;
                    if (pixelY < plot.y || pixelY > plot.y + plot.height) {
                        continue;
                    }
                    context.beginPath();
                    context.moveTo(imageLeft, pixelY);
                    context.lineTo(imageLeft - 4, pixelY);
                    context.stroke();
                    context.textAlign = "right";
                    context.textBaseline = "middle";
                    context.fillText(
                        String(y + this.pixelOriginY),
                        imageLeft - 7,
                        pixelY,
                    );
                }

                context.textAlign = "center";
                context.textBaseline = "bottom";
                context.fillText("PIXEL X", plot.x + plot.width / 2, this.logicalHeight - 8);
                context.save();
                context.translate(12, plot.y + plot.height / 2);
                context.rotate(-Math.PI / 2);
                context.textAlign = "center";
                context.textBaseline = "top";
                context.fillText("PIXEL Y", 0, 0);
                context.restore();
            } else {
                context.textAlign = "left";
                context.textBaseline = "bottom";
                context.fillText("ROTATED FIELD · PIXEL MAPPING ACTIVE", plot.x + 8, this.logicalHeight - 8);
            }

            context.textAlign = "right";
            context.textBaseline = "top";
            context.fillStyle = colors.mapHint;
            context.fillText(`ZOOM ${this.zoom.toFixed(1)}×`, plot.x + plot.width - 8, plot.y + 8);
            context.restore();
        }

        positionRotationHandle(center, scale) {
            const corner = this.worldToScreen(
                { x: this.width, y: this.height },
                center,
                scale,
            );
            const plot = this.plotRectangle();
            const visible = (
                corner.x >= plot.x - 20
                && corner.x <= plot.x + plot.width + 20
                && corner.y >= plot.y - 20
                && corner.y <= plot.y + plot.height + 20
            );
            this.rotationHandle.style.display = visible ? "flex" : "none";
            this.rotationHandle.style.left = `${clamp(corner.x, 14, this.logicalWidth - 14)}px`;
            this.rotationHandle.style.top = `${clamp(corner.y, 14, this.logicalHeight - 14)}px`;
        }

        worldToScreen(pixel, center, scale) {
            const localX = pixel.x - this.width / 2;
            const localY = this.height / 2 - pixel.y;
            const cos = Math.cos(this.rotation);
            const sin = Math.sin(this.rotation);
            return {
                x: center.x + (localX * cos - localY * sin) * scale,
                y: center.y + (localX * sin + localY * cos) * scale,
            };
        }

        screenToPixel(screenX, screenY) {
            const center = this.center();
            const scale = this.totalScale();
            const deltaX = screenX - center.x;
            const deltaY = screenY - center.y;
            const cos = Math.cos(this.rotation);
            const sin = Math.sin(this.rotation);
            const localX = (cos * deltaX + sin * deltaY) / scale;
            const localY = (-sin * deltaX + cos * deltaY) / scale;
            const sourceX = Math.floor(localX + this.width / 2);
            const topRow = Math.floor(localY + this.height / 2);
            const sourceY = this.height - 1 - topRow;
            if (
                sourceX < 0
                || sourceX >= this.width
                || sourceY < 0
                || sourceY >= this.height
            ) {
                return null;
            }
            return { x: sourceX, y: sourceY };
        }

        pointerPosition(event) {
            const bounds = this.canvas.getBoundingClientRect();
            return {
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
            };
        }

        pixelValue(pixel) {
            return this.values?.[pixel.y]?.[pixel.x] ?? null;
        }

        bindEvents() {
            this.canvas.addEventListener("wheel", (event) => {
                if (!this.values) {
                    return;
                }
                event.preventDefault();
                const pointer = this.pointerPosition(event);
                const center = this.center();
                const oldScale = this.totalScale();
                const newZoom = clamp(this.zoom * (event.deltaY > 0 ? 0.86 : 1.16), 1, 45);
                const newScale = this.fitScale * newZoom;
                const cos = Math.cos(this.rotation);
                const sin = Math.sin(this.rotation);
                const deltaX = pointer.x - center.x;
                const deltaY = pointer.y - center.y;
                const localX = (cos * deltaX + sin * deltaY) / oldScale;
                const localY = (-sin * deltaX + cos * deltaY) / oldScale;
                const plot = this.plotRectangle();
                const baseCenterX = plot.x + plot.width / 2;
                const baseCenterY = plot.y + plot.height / 2;
                const newCenterX =
                    pointer.x - (localX * cos - localY * sin) * newScale;
                const newCenterY =
                    pointer.y - (localX * sin + localY * cos) * newScale;
                this.zoom = newZoom;
                this.panX = newCenterX - baseCenterX;
                this.panY = newCenterY - baseCenterY;
                this.hoverPixel = null;
                dom.pixelTooltip.classList.remove("is-visible");
                this.requestRender();
            }, { passive: false });

            this.canvas.addEventListener("pointerdown", (event) => {
                if (!this.values || event.button !== 0) {
                    return;
                }
                const pointer = this.pointerPosition(event);
                this.dragMode = "pan";
                this.dragStart = {
                    x: pointer.x,
                    y: pointer.y,
                    panX: this.panX,
                    panY: this.panY,
                };
                this.lastPointer = pointer;
                this.canvas.setPointerCapture(event.pointerId);
                this.canvas.style.cursor = "grabbing";
            });

            this.canvas.addEventListener("pointermove", (event) => {
                if (!this.values) {
                    return;
                }
                const pointer = this.pointerPosition(event);
                if (this.dragMode === "pan" && this.dragStart) {
                    const deltaX = pointer.x - this.dragStart.x;
                    const deltaY = pointer.y - this.dragStart.y;
                    this.panX = this.dragStart.panX + deltaX;
                    this.panY = this.dragStart.panY + deltaY;
                    this.requestRender();
                    return;
                }
                this.updateHover(pointer, event);
            });

            this.canvas.addEventListener("pointerup", (event) => {
                if (!this.values || event.button !== 0) {
                    return;
                }
                const pointer = this.pointerPosition(event);
                const wasClick = (
                    this.dragStart
                    && Math.hypot(
                        pointer.x - this.dragStart.x,
                        pointer.y - this.dragStart.y,
                    ) < 5
                );
                this.dragMode = null;
                this.dragStart = null;
                this.canvas.style.cursor = "crosshair";
                if (wasClick) {
                    const pixel = this.screenToPixel(pointer.x, pointer.y);
                    if (pixel) {
                        this.callbacks.onPixelClick(pixel);
                    }
                }
            });

            this.canvas.addEventListener("pointercancel", () => {
                this.dragMode = null;
                this.dragStart = null;
                this.canvas.style.cursor = "crosshair";
            });

            this.canvas.addEventListener("pointerleave", () => {
                if (this.dragMode === "pan") {
                    return;
                }
                this.hoverPixel = null;
                dom.pixelTooltip.classList.remove("is-visible");
                this.requestRender();
            });

            this.canvas.addEventListener("dblclick", () => this.resetView());

            this.rotationHandle.addEventListener("pointerdown", (event) => {
                if (!this.values) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                const bounds = this.canvas.getBoundingClientRect();
                const handleBounds = this.viewport.getBoundingClientRect();
                const pointerX = event.clientX - bounds.left;
                const pointerY = event.clientY - bounds.top;
                const center = this.center();
                const pointerAngle = Math.atan2(pointerY - center.y, pointerX - center.x);
                this.rotationStart = pointerAngle - this.rotation;
                this.dragMode = "rotation";
                this.rotationHandle.setPointerCapture(event.pointerId);
                this.rotationHandle.style.cursor = "grabbing";
                dom.rotationReadout.classList.add("is-visible");
                void handleBounds;

                const handleMove = (moveEvent) => {
                    const moveX = moveEvent.clientX - bounds.left;
                    const moveY = moveEvent.clientY - bounds.top;
                    let angle =
                        Math.atan2(moveY - center.y, moveX - center.x)
                        - this.rotationStart;
                    if (moveEvent.shiftKey) {
                        const step = Math.PI / 12;
                        angle = Math.round(angle / step) * step;
                    }
                    this.rotation = angle;
                    dom.rotationReadout.textContent = `${this.rotationDegrees().toFixed(0)}°`;
                    this.requestRender();
                };

                const handleUp = () => {
                    window.removeEventListener("pointermove", handleMove);
                    window.removeEventListener("pointerup", handleUp);
                    this.dragMode = null;
                    this.rotationHandle.style.cursor = "grab";
                    window.setTimeout(
                        () => dom.rotationReadout.classList.remove("is-visible"),
                        900,
                    );
                };

                window.addEventListener("pointermove", handleMove);
                window.addEventListener("pointerup", handleUp, { once: true });
            });
        }

        updateHover(pointer, event) {
            const pixel = this.screenToPixel(pointer.x, pointer.y);
            const changed = (
                !pixel
                || !this.hoverPixel
                || pixel.x !== this.hoverPixel.x
                || pixel.y !== this.hoverPixel.y
            );
            this.hoverPixel = pixel;
            this.canvas.style.cursor = pixel ? "crosshair" : "default";

            if (!pixel) {
                dom.pixelTooltip.classList.remove("is-visible");
                this.callbacks.onPixelHover(null);
                if (changed) {
                    this.requestRender();
                }
                return;
            }

            const value = this.pixelValue(pixel);
            const displayedX = pixel.x + this.pixelOriginX;
            const displayedY = pixel.y + this.pixelOriginY;
            dom.pixelTooltip.replaceChildren(
                textElement(
                    "strong",
                    "",
                    `Pixel ${displayedX}, ${displayedY}`,
                ),
                document.createTextNode(
                    value === null ? "No finite sample" : `Value ${niceNumber(value)}`,
                ),
            );
            const tooltipWidth = 148;
            const tooltipHeight = 45;
            const viewportWidth = this.viewport.clientWidth;
            const viewportHeight = this.viewport.clientHeight;
            dom.pixelTooltip.style.left = `${clamp(pointer.x + 15, 8, viewportWidth - tooltipWidth - 8)}px`;
            dom.pixelTooltip.style.top = `${clamp(pointer.y + 15, 8, viewportHeight - tooltipHeight - 8)}px`;
            dom.pixelTooltip.classList.add("is-visible");
            this.callbacks.onPixelHover(pixel, value, event);
            if (changed) {
                this.requestRender();
            }
        }

        rotationDegrees() {
            return ((this.rotation * 180) / Math.PI) % 360;
        }

        resetView() {
            this.zoom = 1;
            this.panX = 0;
            this.panY = 0;
            this.rotation = 0;
            dom.rotationReadout.textContent = "0°";
            this.requestRender();
        }
    }

    function interpolateViridis(ratio) {
        const scaled = clamp(ratio, 0, 1) * (VIRIDIS_STOPS.length - 1);
        const index = Math.min(VIRIDIS_STOPS.length - 2, Math.floor(scaled));
        const fraction = scaled - index;
        const first = VIRIDIS_STOPS[index];
        const second = VIRIDIS_STOPS[index + 1];
        return [
            Math.round(first[0] + (second[0] - first[0]) * fraction),
            Math.round(first[1] + (second[1] - first[1]) * fraction),
            Math.round(first[2] + (second[2] - first[2]) * fraction),
        ];
    }

    function niceAxisStep(length, targetTicks) {
        const roughStep = Math.max(1, length / Math.max(1, targetTicks));
        const magnitude = 10 ** Math.floor(Math.log10(roughStep));
        const normalized = roughStep / magnitude;
        let niceNormalized;
        if (normalized <= 1) {
            niceNormalized = 1;
        } else if (normalized <= 2) {
            niceNormalized = 2;
        } else if (normalized <= 5) {
            niceNormalized = 5;
        } else {
            niceNormalized = 10;
        }
        return Math.max(1, Math.round(niceNormalized * magnitude));
    }

    const mapView = new MapView(
        dom.mapCanvas,
        dom.mapViewport,
        dom.rotationHandle,
    );

    function setPanelsRatio(ratio) {
        const bounds = dom.workspace.getBoundingClientRect();
        const splitterWidth = 11;
        const minimumLeft = 340;
        const minimumRight = 430;
        const available = bounds.width - 28 - splitterWidth;
        const left = clamp(
            ratio * available,
            minimumLeft,
            Math.max(minimumLeft, available - minimumRight),
        );
        dom.workspace.style.setProperty(
            "--left-panel",
            `${left}px`,
        );
        requestAnimationFrame(() => {
            mapView.resize();
            if (state.spectrum) {
                Plotly.Plots.resize(dom.spectrumPlot);
            }
        });
    }

    function setNarrowView(view) {
        state.narrowView = view === "spectrum" ? "spectrum" : "map";
        dom.workspace.classList.toggle(
            "is-show-map",
            state.narrowView === "map",
        );
        dom.workspace.classList.toggle(
            "is-show-spectrum",
            state.narrowView === "spectrum",
        );
        const mapActive = state.narrowView === "map";
        dom.mapViewButton.classList.toggle("is-active", mapActive);
        dom.spectrumViewButton.classList.toggle("is-active", !mapActive);
        dom.mapViewButton.setAttribute("aria-pressed", String(mapActive));
        dom.spectrumViewButton.setAttribute("aria-pressed", String(!mapActive));
        requestAnimationFrame(() => {
            mapView.resize();
            if (state.spectrum && dom.spectrumPlot._fullLayout) {
                Plotly.Plots.resize(dom.spectrumPlot);
            }
        });
    }

    function bindSplitter() {
        let active = false;
        const move = (event) => {
            if (!active) {
                return;
            }
            const bounds = dom.workspace.getBoundingClientRect();
            setPanelsRatio((event.clientX - bounds.left - 14) / (bounds.width - 28));
        };
        const end = () => {
            active = false;
            dom.splitter.classList.remove("is-dragging");
            window.removeEventListener("pointermove", move);
        };
        dom.splitter.addEventListener("pointerdown", (event) => {
            active = true;
            dom.splitter.classList.add("is-dragging");
            dom.splitter.setPointerCapture(event.pointerId);
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", end, { once: true });
        });
        dom.splitter.addEventListener("dblclick", () => setPanelsRatio(0.54));
        dom.splitter.addEventListener("keydown", (event) => {
            const bounds = dom.workspace.getBoundingClientRect();
            const current = parseFloat(
                getComputedStyle(dom.workspace).getPropertyValue("--left-panel"),
            );
            const currentRatio = (Number.isFinite(current) ? current : bounds.width * 0.54)
                / Math.max(1, bounds.width - 28);
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                setPanelsRatio(currentRatio - 0.025);
            } else if (event.key === "ArrowRight") {
                event.preventDefault();
                setPanelsRatio(currentRatio + 0.025);
            } else if (event.key === "Home") {
                event.preventDefault();
                setPanelsRatio(0.54);
            }
        });
    }

    function setInfoPanelHeight(height) {
        const rightStackHeight = dom.rightStack.getBoundingClientRect().height;
        const minimumSpectrumHeight = 260;
        const splitterHeight = 9;
        const maximumInfoHeight = Math.max(
            150,
            rightStackHeight - minimumSpectrumHeight - splitterHeight,
        );
        const selectedHeight = clamp(height, 150, maximumInfoHeight);
        dom.rightStack.style.setProperty(
            "--info-panel-height",
            `${selectedHeight}px`,
        );
        requestAnimationFrame(() => {
            if (dom.spectrumPlot._fullLayout) {
                Plotly.Plots.resize(dom.spectrumPlot);
            }
        });
    }

    function bindRightSplitter() {
        let dragBounds = null;
        const move = (event) => {
            if (!dragBounds) {
                return;
            }
            setInfoPanelHeight(dragBounds.bottom - event.clientY - 4.5);
        };
        const end = () => {
            dragBounds = null;
            dom.rightSplitter.classList.remove("is-dragging");
            window.removeEventListener("pointermove", move);
        };
        dom.rightSplitter.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            dragBounds = dom.rightStack.getBoundingClientRect();
            dom.rightSplitter.classList.add("is-dragging");
            dom.rightSplitter.setPointerCapture(event.pointerId);
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", end, { once: true });
        });
        dom.rightSplitter.addEventListener("dblclick", () => {
            setInfoPanelHeight(262);
        });
        dom.rightSplitter.addEventListener("keydown", (event) => {
            const currentHeight =
                dom.infoPanel.getBoundingClientRect().height;
            if (event.key === "ArrowUp") {
                event.preventDefault();
                setInfoPanelHeight(currentHeight - 20);
            } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setInfoPanelHeight(currentHeight + 20);
            } else if (event.key === "Home") {
                event.preventDefault();
                setInfoPanelHeight(262);
            }
        });
    }

    function finiteValues(payload = state.image) {
        if (!payload) {
            return [];
        }
        const values = [];
        for (const row of payload.values) {
            for (const value of row) {
                if (value !== null && Number.isFinite(value)) {
                    values.push(value);
                }
            }
        }
        return values;
    }

    function percentile(sortedValues, fraction) {
        if (!sortedValues.length) {
            return NaN;
        }
        const position = (sortedValues.length - 1) * fraction;
        const lower = Math.floor(position);
        const upper = Math.ceil(position);
        if (lower === upper) {
            return sortedValues[lower];
        }
        const fractionBetween = position - lower;
        return (
            sortedValues[lower] * (1 - fractionBetween)
            + sortedValues[upper] * fractionBetween
        );
    }

    function applyAutomaticColorLimits() {
        const values = finiteValues().sort((a, b) => a - b);
        if (!values.length) {
            return;
        }
        let dataMinimum = values[0];
        let dataMaximum = values[values.length - 1];
        if (dataMinimum === dataMaximum) {
            const rangePadding = Math.max(1, Math.abs(dataMinimum) * 0.05);
            dataMinimum -= rangePadding;
            dataMaximum += rangePadding;
        }
        state.colorDataRange = {
            min: dataMinimum,
            max: dataMaximum,
        };
        let minimum = percentile(values, 0.01);
        let maximum = percentile(values, 0.99);
        if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
            return;
        }
        if (minimum === maximum) {
            const padding = Math.max(1, Math.abs(minimum) * 0.05);
            minimum -= padding;
            maximum += padding;
        }
        state.autoColorLimits = { min: minimum, max: maximum };
        const autoSpan = maximum - minimum;
        state.colorEditRange = {
            min: minimum - autoSpan * 0.2,
            max: maximum + autoSpan * 0.2,
        };
        setColorLimits(minimum, maximum);
    }

    function applyFullColorLimits() {
        const { min, max } = state.colorDataRange;
        if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
            return;
        }
        setColorLimits(min, max);
    }

    function setColorLimits(minimum, maximum) {
        if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) {
            return;
        }
        const editSpan =
            state.colorEditRange.max - state.colorEditRange.min;
        if (minimum < state.colorEditRange.min) {
            state.colorEditRange.min = minimum - editSpan * 0.1;
        }
        if (maximum > state.colorEditRange.max) {
            state.colorEditRange.max = maximum + editSpan * 0.1;
        }
        state.colorLimits = { min: minimum, max: maximum };
        dom.colorMinInput.value = minimum.toPrecision(7);
        dom.colorMaxInput.value = maximum.toPrecision(7);
        updateColorHandlePositions();
        updateColorRangeTitle();
        mapView.setColorLimits(minimum, maximum);
    }

    function updateColorHandlePositions() {
        const editRange =
            state.colorEditRange.max - state.colorEditRange.min;
        const lowPercent = editRange === 0
            ? 0
            : (
                (state.colorLimits.min - state.colorEditRange.min)
                / editRange
            ) * 100;
        const highPercent = editRange === 0
            ? 100
            : (
                (state.colorLimits.max - state.colorEditRange.min)
                / editRange
            ) * 100;
        dom.colorLowHandle.style.bottom = `${clamp(lowPercent, 0, 100)}%`;
        dom.colorHighHandle.style.bottom = `${clamp(highPercent, 0, 100)}%`;
    }

    function updateColorRangeTitle() {
        dom.colorbarTrack.title =
            `Editable color range ${niceNumber(state.colorEditRange.min)}`
            + ` to ${niceNumber(state.colorEditRange.max)}.`
            + " Scroll to widen or tighten; drag the limits to adjust colors.";
    }

    function changeColorEditRange(factor) {
        const oldSpan =
            state.colorEditRange.max - state.colorEditRange.min;
        if (!(oldSpan > 0)) {
            return;
        }
        const center = (
            state.colorLimits.min + state.colorLimits.max
        ) / 2;
        let newSpan = oldSpan * factor;
        if (factor < 1) {
            const requiredSpan = (
                state.colorLimits.max - state.colorLimits.min
            ) * 1.08;
            newSpan = Math.max(newSpan, requiredSpan);
        }
        state.colorEditRange = {
            min: center - newSpan / 2,
            max: center + newSpan / 2,
        };
        updateColorHandlePositions();
        updateColorRangeTitle();
    }

    function bindColorControls() {
        const bindHandle = (handle, isHigh) => {
            handle.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                handle.setPointerCapture(event.pointerId);
                const trackBounds = dom.colorbarTrack.getBoundingClientRect();
                const move = (moveEvent) => {
                    const ratio = clamp(
                        1 - (moveEvent.clientY - trackBounds.top) / trackBounds.height,
                        0,
                        1,
                    );
                    const range =
                        state.colorEditRange.max - state.colorEditRange.min;
                    const proposed =
                        state.colorEditRange.min + ratio * range;
                    if (isHigh) {
                        setColorLimits(state.colorLimits.min, Math.max(proposed, state.colorLimits.min + range * 0.005));
                    } else {
                        setColorLimits(Math.min(proposed, state.colorLimits.max - range * 0.005), state.colorLimits.max);
                    }
                };
                window.addEventListener("pointermove", move);
                window.addEventListener(
                    "pointerup",
                    () => window.removeEventListener("pointermove", move),
                    { once: true },
                );
            });
        };
        bindHandle(dom.colorLowHandle, false);
        bindHandle(dom.colorHighHandle, true);

        dom.colorMinInput.addEventListener("change", () => {
            setColorLimits(
                Number(dom.colorMinInput.value),
                state.colorLimits.max,
            );
        });
        dom.colorMaxInput.addEventListener("change", () => {
            setColorLimits(
                state.colorLimits.min,
                Number(dom.colorMaxInput.value),
            );
        });
        dom.colorResetButton.addEventListener("click", applyAutomaticColorLimits);
        dom.colorFullButton.addEventListener("click", applyFullColorLimits);
        dom.colorTightenButton.addEventListener(
            "click",
            () => changeColorEditRange(0.7),
        );
        dom.colorWidenButton.addEventListener(
            "click",
            () => changeColorEditRange(1.5),
        );
        dom.colorbarTrack.addEventListener("wheel", (event) => {
            event.preventDefault();
            changeColorEditRange(event.deltaY > 0 ? 1.35 : 1 / 1.35);
        }, { passive: false });
    }

    function setLoaderVisible(visible, text = "") {
        dom.appLoader.classList.toggle("is-visible", visible);
        if (text) {
            dom.appLoaderText.textContent = text;
        }
    }

    function setWorkspaceControlsEnabled(enabled) {
        for (const input of dom.imageStatisticInputs) {
            input.disabled = !enabled;
        }
        for (const control of [
            dom.mapResetButton,
            dom.colorMinInput,
            dom.colorMaxInput,
            dom.colorLowHandle,
            dom.colorHighHandle,
            dom.colorResetButton,
            dom.colorFullButton,
            dom.colorTightenButton,
            dom.colorWidenButton,
            dom.spectrumResetButton,
            dom.redshiftInput,
            dom.restFrameToggle,
            dom.lineSelect,
            dom.clearLineButton,
            dom.spectrumViewButton,
        ]) {
            control.disabled = !enabled;
        }
    }

    function setEmptyWorkspace() {
        state.cube = null;
        state.activeSource = null;
        state.image = null;
        state.spectrum = null;
        state.selectedPixel = null;
        state.observedRange = null;
        state.defaultWavelengthRange = null;
        state.supportsSpectrum = false;
        mapView.clear();
        dom.mapEmpty.classList.remove("is-hidden");
        dom.mapTitle.textContent = "Spatial view";
        dom.imageRangeChip.textContent = "No data";
        dom.integratedInterval.textContent = "No data";
        dom.selectedPixelLabel.textContent = "No pixel selected";
        dom.projectionLabel.textContent = "No file";
        dom.spectrumModeChip.textContent = "No file";
        dom.spectrumEmpty.querySelector("span").textContent =
            "Open a FITS file to begin.";
        dom.spectrumEmpty.classList.remove("is-hidden");
        if (dom.spectrumPlot._fullLayout) {
            Plotly.purge(dom.spectrumPlot);
            dom.spectrumPlot._spectralAtlasEventsBound = false;
        }
        dom.spectrumPlot.replaceChildren();
        dom.hduSelect.replaceChildren(new Option("No file open", ""));
        dom.hduSelect.disabled = true;
        dom.bandControl.hidden = true;
        dom.summaryGrid.replaceChildren(
            textElement(
                "div",
                "summary-empty",
                "Open a FITS file to inspect its header.",
            ),
        );
        dom.headerCount.textContent = "No header loaded";
        dom.headerWarning.hidden = true;
        dom.headerTableBody.replaceChildren();
        dom.headerDetails.open = false;
        dom.lineHint.textContent = "Open a FITS file to begin.";
        dom.lineResult.textContent = "";
        setWorkspaceControlsEnabled(false);
        setStatus("Ready — open a FITS file", "ready");
    }

    function populateHduSelect(source, selectedHdu) {
        state.activeSource = source;
        dom.hduSelect.replaceChildren();
        if (!source || !source.hdus?.length) {
            dom.hduSelect.append(new Option("No image HDUs", ""));
            dom.hduSelect.disabled = true;
            return;
        }
        for (const hdu of source.hdus) {
            const shape = hdu.shape.join(" × ");
            dom.hduSelect.append(
                new Option(
                    `${hdu.index} · ${hdu.name} · ${shape}`,
                    String(hdu.index),
                ),
            );
        }
        dom.hduSelect.value = String(selectedHdu);
        dom.hduSelect.disabled = source.hdus.length < 2;
    }

    async function reopenWithHdu(hduIndex) {
        if (!state.activeSource?.path) {
            return;
        }
        state.imageRequest?.abort();
        state.spectrumRequest?.abort();
        setStatus("Loading HDU", "loading");
        setLoaderVisible(true, `Opening HDU ${hduIndex}.`);
        try {
            const payload = await apiJson("/api/open-path", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    path: state.activeSource.path,
                    hdu: hduIndex,
                }),
            });
            await installCubePayload(payload);
        } catch (error) {
            setStatus("HDU open failed", "error");
            showToast(error.message, "error", 7000);
        } finally {
            setLoaderVisible(false);
        }
    }

    async function installCubePayload(payload) {
        state.cube = payload.cube;
        state.lines = payload.lines;
        state.image = payload.image;
        populateHduSelect(payload.source, payload.cube.hdu_index);
        state.dataKind = payload.cube.data_kind;
        state.supportsSpectrum = payload.cube.supports_spectrum;
        state.observedRange = state.supportsSpectrum
            ? {
                min: payload.image.lambda_min,
                max: payload.image.lambda_max,
            }
            : null;
        state.defaultWavelengthRange = state.observedRange
            ? { ...state.observedRange }
            : null;
        state.spectrum = null;
        state.selectedPixel = null;
        state.hasRedshift = false;
        state.restFrame = false;
        state.redshift = 0;
        state.clickedObservedWavelength = null;
        dom.redshiftInput.value = "";
        dom.restFrameToggle.checked = false;
        dom.spectrumEmpty.classList.remove("is-hidden");
        if (dom.spectrumPlot._fullLayout) {
            Plotly.purge(dom.spectrumPlot);
            dom.spectrumPlot._spectralAtlasEventsBound = false;
        }
        dom.spectrumPlot.replaceChildren();
        dom.headerDetails.open = false;
        configureDataPresentation(payload);

        mapView.setImage(payload.image);
        applyAutomaticColorLimits();
        mapView.setSelectedPixel(null);
        renderCubeMetadata();
        populateLineSelect();
        clearLineIdentification();
        renderImageRange();
        setStatus("Cube ready", "ready");

        const brightestPixel = findBrightestPixel(payload.image);
        if (brightestPixel) {
            await choosePixel(brightestPixel);
        } else {
            dom.mapEmpty.classList.remove("is-hidden");
        }
        if (payload.cube.warnings?.length) {
            showToast(payload.cube.warnings.join(" "), "warning", 6500);
        }
    }

    function configureDataPresentation(payload) {
        const cube = payload.cube;
        const image = payload.image;
        const bands = cube.bands || [];
        const hasMultipleBands =
            cube.data_kind === "band_stack" && bands.length > 1;
        setWorkspaceControlsEnabled(true);

        dom.bandControl.hidden = !hasMultipleBands;
        dom.bandSelect.replaceChildren();
        for (const band of bands) {
            dom.bandSelect.append(
                new Option(band.label, String(band.index)),
            );
        }
        if (hasMultipleBands) {
            dom.bandSelect.value = String(image.band_index ?? 0);
        }

        dom.projectionSwitch.hidden = !cube.supports_spectrum;
        dom.redshiftInput.disabled = !cube.supports_spectrum;
        dom.restFrameToggle.disabled = !cube.supports_spectrum;
        dom.spectrumResetButton.disabled = !cube.supports_spectrum;
        dom.lineSelect.disabled = true;
        dom.clearLineButton.disabled = true;
        dom.spectrumViewButton.disabled = !cube.supports_spectrum;

        if (cube.supports_spectrum) {
            setImageStatistic(image.statistic, { refresh: false });
            dom.spectrumEmpty.querySelector("span").textContent =
                "Select a spatial pixel to extract its spectrum.";
        } else if (cube.data_kind === "band_stack") {
            dom.mapTitle.textContent = image.band_label || "Band image";
            dom.imageRangeChip.textContent =
                `Band ${(image.band_index ?? 0) + 1} of ${bands.length}`;
            dom.integratedInterval.textContent = "Not applicable";
            dom.projectionLabel.textContent = "Selected band";
            dom.spectrumEmpty.querySelector("span").textContent =
                "Band images do not contain a spectral axis.";
        } else {
            dom.mapTitle.textContent = "FITS image";
            dom.imageRangeChip.textContent = "Single 2D image";
            dom.integratedInterval.textContent = "Not applicable";
            dom.projectionLabel.textContent = "2D image";
            dom.spectrumEmpty.querySelector("span").textContent =
                "This FITS HDU is a 2D image and has no spectral axis.";
        }
    }

    function recentPaths() {
        try {
            const stored = JSON.parse(
                localStorage.getItem("ifs-viewer-recent-paths")
                || localStorage.getItem("cube-viewer-recent-paths")
                || "[]",
            );
            return Array.isArray(stored) ? stored.filter((path) => typeof path === "string") : [];
        } catch {
            return [];
        }
    }

    function rememberRecentPath(path) {
        const paths = [
            path,
            ...recentPaths().filter((item) => item !== path),
        ].slice(0, 5);
        try {
            localStorage.setItem("ifs-viewer-recent-paths", JSON.stringify(paths));
        } catch {
            // Path history is optional when browser storage is unavailable.
        }
    }

    function renderRecentPaths() {
        dom.recentPathList.replaceChildren();
        for (const path of recentPaths()) {
            dom.recentPathList.append(new Option(path, path));
        }
    }

    function showPathDialog() {
        dom.pathError.hidden = true;
        dom.pathError.textContent = "";
        renderRecentPaths();
        const [latestPath] = recentPaths();
        if (latestPath) {
            dom.pathInput.value = latestPath;
        }
        dom.pathDialog.showModal();
        requestAnimationFrame(() => {
            dom.pathInput.focus();
            dom.pathInput.select();
        });
    }

    function selectFileInExplorer() {
        dom.selectedFilePicker.click();
    }

    async function openSelectedExplorerFile(file) {
        state.imageRequest?.abort();
        state.spectrumRequest?.abort();
        dom.selectExplorerButton.disabled = true;
        dom.selectExplorerButton.textContent = "Locating…";
        setStatus("Locating selected file", "loading");
        setLoaderVisible(
            true,
            `Matching ${file.name} (${file.size.toLocaleString()} bytes) to a local path.`,
        );

        try {
            const payload = await apiJson("/api/open-selected", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: file.name,
                    size: file.size,
                    last_modified: file.lastModified,
                }),
            });
            await installCubePayload(payload);
            rememberRecentPath(payload.resolved_path);
        } catch (error) {
            setStatus("File lookup failed", "error");
            showToast(error.message, "error", 7000);
        } finally {
            dom.selectedFilePicker.value = "";
            dom.selectExplorerButton.disabled = false;
            dom.selectExplorerButton.textContent = "Select in Explorer…";
            setLoaderVisible(false);
        }
    }

    function setPathSubmitting(isSubmitting) {
        dom.submitPathButton.disabled = isSubmitting;
        dom.submitPathButton.classList.toggle("is-loading", isSubmitting);
        dom.submitPathButton.querySelector(".button-label").textContent =
            isSubmitting ? "Opening" : "Open file";
    }

    async function openDirectPath(path) {
        state.imageRequest?.abort();
        state.spectrumRequest?.abort();
        setStatus("Opening local file", "loading");
        setPathSubmitting(true);
        setLoaderVisible(
            true,
            "Opening the original FITS file in place and preparing its first image.",
        );
        dom.pathDialog.close();

        try {
            const payload = await apiJson("/api/open-path", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path }),
            });
            await installCubePayload(payload);
            rememberRecentPath(path);
        } catch (error) {
            setStatus("File open failed", "error");
            showToast(error.message, "error", 7000);
            dom.pathError.textContent = error.message;
            dom.pathError.hidden = false;
            dom.pathDialog.showModal();
        } finally {
            setPathSubmitting(false);
            setLoaderVisible(false);
        }
    }

    function findBrightestPixel(image) {
        let best = null;
        let bestValue = -Infinity;
        for (let y = 0; y < image.shape[0]; y += 1) {
            for (let x = 0; x < image.shape[1]; x += 1) {
                const value = image.values[y][x];
                if (value !== null && Number.isFinite(value) && value > bestValue) {
                    bestValue = value;
                    best = { x, y };
                }
            }
        }
        return best;
    }

    async function choosePixel(pixel) {
        if (!state.cube) {
            return;
        }
        state.selectedPixel = pixel;
        mapView.setSelectedPixel(pixel);
        const displayedPixel = pixelDisplayCoordinates(pixel);
        dom.selectedPixelLabel.textContent =
            `x ${displayedPixel.x} · y ${displayedPixel.y}`;
        dom.mapEmpty.classList.add("is-hidden");
        updateSummarySelectedPixel();
        if (!state.supportsSpectrum) {
            state.spectrum = null;
            dom.spectrumEmpty.classList.remove("is-hidden");
            dom.spectrumModeChip.textContent = "No spectral axis";
            dom.lineHint.textContent =
                "This FITS HDU contains a 2D image, not a spectrum.";
            setStatus("Pixel selected", "ready");
            return;
        }
        state.spectrumRequest?.abort();
        const controller = new AbortController();
        state.spectrumRequest = controller;
        setStatus("Extracting spectrum", "loading");

        try {
            const payload = await apiJson(
                `/api/cubes/${state.cube.cube_id}/spectrum?x=${pixel.x}&y=${pixel.y}`,
                { signal: controller.signal },
            );
            if (controller.signal.aborted) {
                return;
            }
            state.spectrum = payload;
            dom.spectrumEmpty.classList.add("is-hidden");
            clearLineIdentification();
            await renderSpectrum({ resetRange: true });
            setStatus("Pixel selected", "ready");
            updateSummarySelectedPixel();
            if (window.innerWidth <= 980) {
                setNarrowView("spectrum");
            }
        } catch (error) {
            if (error.name !== "AbortError") {
                showToast(error.message, "error");
                setStatus("Spectrum failed", "error");
            }
        }
    }

    function renderCubeMetadata() {
        const cube = state.cube;
        if (!cube) {
            return;
        }
        const basic = cube.basic_header;
        const kindLabels = {
            spectral_cube: "Spectral cube",
            long_slit: "Long slit",
            image: "2D image",
            band_stack: "Band stack",
        };
        const wavelengthSummary = cube.wavelength
            ? `${formatWavelength(cube.wavelength.min)} – ${formatWavelength(cube.wavelength.max)}`
            : "not applicable";
        const samplingSummary = cube.wavelength
            ? `${cube.wavelength.pixel_scale.toFixed(3)} Å / pixel`
            : "not applicable";
        const crop = cube.spatial_crop;
        const cropSummary = (
            crop
            && (
                crop.x_start > 0
                || crop.y_start > 0
                || crop.x_stop < crop.original_width
                || crop.y_stop < crop.original_height
            )
        )
            ? `${crop.original_width} × ${crop.original_height} → `
                + `${crop.x_stop - crop.x_start} × ${crop.y_stop - crop.y_start}`
            : "none";
        const items = [
            ["File", cube.filename],
            ["HDU", `${cube.hdu_index} · ${cube.hdu_name}`],
            ["Data kind", kindLabels[cube.data_kind] || cube.data_kind],
            ["Object", basic.OBJECT || "not recorded"],
            ["Instrument", basic.INSTRUME || basic.TELESCOP || "not recorded"],
            ["Spectral axis", cube.spectral_axis_fits === null
                ? "none"
                : `FITS axis ${cube.spectral_axis_fits}`],
            ["Spatial shape", `${cube.spatial_shape.width} × ${cube.spatial_shape.height}`],
            ["NaN border crop", cropSummary],
            ["Wavelength", wavelengthSummary],
            ["Sampling", samplingSummary],
            ["Selected pixel", state.selectedPixel
                ? `x ${pixelDisplayCoordinates(state.selectedPixel).x} · y ${pixelDisplayCoordinates(state.selectedPixel).y}`
                : "none"],
            ["Flux unit", basic.BUNIT || "FITS units"],
        ];
        dom.summaryGrid.replaceChildren();
        for (const [label, value] of items) {
            const item = document.createElement("div");
            item.className = "summary-item";
            item.dataset.label = label;
            item.append(
                textElement("span", "", label),
                textElement("strong", "", String(value)),
            );
            dom.summaryGrid.append(item);
        }
        dom.headerCount.textContent = `${cube.header_cards.length} cards`;
        dom.headerTableBody.replaceChildren();
        for (const card of cube.header_cards) {
            const row = document.createElement("tr");
            row.append(
                textElement("td", "", card.keyword),
                textElement("td", "", card.value === null ? "null" : String(card.value)),
                textElement("td", "", card.comment || ""),
            );
            dom.headerTableBody.append(row);
        }

        if (cube.warnings?.length) {
            dom.headerWarning.hidden = false;
            dom.headerWarning.textContent = cube.warnings.join(" ");
        } else {
            dom.headerWarning.hidden = true;
            dom.headerWarning.textContent = "";
        }
    }

    function updateSummarySelectedPixel() {
        const item = [...dom.summaryGrid.querySelectorAll(".summary-item")].find(
            (entry) => entry.dataset.label === "Selected pixel",
        );
        if (item && state.selectedPixel) {
            const displayedPixel = pixelDisplayCoordinates(state.selectedPixel);
            item.querySelector("strong").textContent =
                `x ${displayedPixel.x} · y ${displayedPixel.y}`;
        }
    }

    function pixelDisplayCoordinates(pixel) {
        const crop = state.cube?.spatial_crop;
        return {
            x: pixel.x + (crop?.x_start || 0),
            y: pixel.y + (crop?.y_start || 0),
        };
    }

    function renderImageRange() {
        if (!state.observedRange) {
            return;
        }
        const rangeText =
            `${state.observedRange.min.toFixed(1)}–${state.observedRange.max.toFixed(1)} Å`;
        dom.integratedInterval.textContent = rangeText;
        dom.imageRangeChip.textContent = rangeText;
    }

    function setImageStatistic(statistic, { refresh = true } = {}) {
        if (
            !state.supportsSpectrum
            || !["median", "mean"].includes(statistic)
        ) {
            return;
        }
        state.imageStatistic = statistic;
        for (const input of dom.imageStatisticInputs) {
            input.checked = input.value === statistic;
        }
        const label = statistic === "median" ? "Median" : "Mean";
        dom.mapTitle.textContent = `${label} flux`;
        dom.projectionLabel.textContent = `NaN-aware ${statistic}`;
        if (refresh && state.cube && state.observedRange) {
            requestImageRange(
                state.observedRange.min,
                state.observedRange.max,
            );
        }
    }

    async function requestImageRange(
        observedMin,
        observedMax,
        { resetSpectrumRange = false } = {},
    ) {
        if (!state.cube || !state.supportsSpectrum) {
            return;
        }
        const fullMin = state.cube.wavelength.min;
        const fullMax = state.cube.wavelength.max;
        const minimum = clamp(Math.min(observedMin, observedMax), fullMin, fullMax);
        const maximum = clamp(Math.max(observedMin, observedMax), fullMin, fullMax);
        if (!(maximum > minimum)) {
            return;
        }

        state.imageRequest?.abort();
        const controller = new AbortController();
        state.imageRequest = controller;
        dom.mapBusy.classList.add("is-visible");
        setStatus(`Updating ${state.imageStatistic} image`, "loading");

        try {
            const payload = await apiJson(
                `/api/cubes/${state.cube.cube_id}/image`
                + `?lambda_min=${encodeURIComponent(minimum)}`
                + `&lambda_max=${encodeURIComponent(maximum)}`
                + `&statistic=${encodeURIComponent(state.imageStatistic)}`,
                { signal: controller.signal },
            );
            if (controller.signal.aborted) {
                return;
            }
            state.image = payload;
            setImageStatistic(payload.statistic, { refresh: false });
            state.observedRange = {
                min: payload.lambda_min,
                max: payload.lambda_max,
            };
            mapView.setImage(payload);
            applyAutomaticColorLimits();
            mapView.setSelectedPixel(state.selectedPixel);
            renderImageRange();
            await renderSpectrum(
                resetSpectrumRange
                    ? { resetRange: true }
                    : { preserveRange: true },
            );
            setStatus("Cube ready", "ready");
        } catch (error) {
            if (error.name !== "AbortError") {
                showToast(error.message, "error");
                setStatus("Image update failed", "error");
            }
        } finally {
            if (state.imageRequest === controller) {
                dom.mapBusy.classList.remove("is-visible");
            }
        }
    }

    async function requestBandImage(bandIndex) {
        if (!state.cube || state.supportsSpectrum) {
            return;
        }
        state.imageRequest?.abort();
        const controller = new AbortController();
        state.imageRequest = controller;
        dom.mapBusy.classList.add("is-visible");
        setStatus("Loading image band", "loading");

        try {
            const payload = await apiJson(
                `/api/cubes/${state.cube.cube_id}/image`
                + `?band=${encodeURIComponent(bandIndex)}`,
                { signal: controller.signal },
            );
            if (controller.signal.aborted) {
                return;
            }
            state.image = payload;
            mapView.setImage(payload);
            applyAutomaticColorLimits();
            mapView.setSelectedPixel(state.selectedPixel);
            dom.bandSelect.value = String(payload.band_index ?? 0);
            dom.mapTitle.textContent = payload.band_label || "Band image";
            dom.imageRangeChip.textContent =
                `Band ${(payload.band_index ?? 0) + 1} of ${state.cube.bands.length}`;
            setStatus("Band loaded", "ready");
        } catch (error) {
            if (error.name !== "AbortError") {
                showToast(error.message, "error");
                setStatus("Band update failed", "error");
            }
        } finally {
            if (state.imageRequest === controller) {
                dom.mapBusy.classList.remove("is-visible");
            }
        }
    }

    function populateLineSelect() {
        dom.lineSelect.replaceChildren(new Option("Choose a line", ""));
        const groups = [
            ["emission", "Emission (pPXF)"],
            ["absorption", "Absorption / stellar (NIST ASD)"],
        ];
        for (const [kind, label] of groups) {
            const matchingLines = state.lines
                .map((line, index) => ({ line, index }))
                .filter((entry) => entry.line.kind === kind);
            if (!matchingLines.length) {
                continue;
            }
            const group = document.createElement("optgroup");
            group.label = label;
            for (const { line, index } of matchingLines) {
                group.append(
                    new Option(
                        `${line.display_name || line.name} · `
                        + `${line.rest_wavelength.toFixed(3)} Å`,
                        String(index),
                    ),
                );
            }
            dom.lineSelect.append(group);
        }
        dom.lineSelect.disabled = true;
    }

    function clearLineIdentification() {
        state.clickedObservedWavelength = null;
        dom.lineSelect.value = "";
        dom.lineSelect.disabled = true;
        dom.clearLineButton.disabled = true;
        dom.lineHint.textContent = "Click the spectrum.";
        dom.lineResult.textContent = "";
    }

    function currentDisplayFactor() {
        return state.restFrame && state.hasRedshift
            ? 1 + state.redshift
            : 1;
    }

    function displayWavelength(observed) {
        return observed / currentDisplayFactor();
    }

    function observedWavelength(displayed) {
        return displayed * currentDisplayFactor();
    }

    function lineAnnotationsAndShapes(displayMinimum, displayMaximum) {
        const shapes = [];
        const annotations = [];
        const colors = themeColors();
        const factor = currentDisplayFactor();

        if (
            state.observedRange
            && state.observedRange.max > state.observedRange.min
        ) {
            shapes.push({
                type: "rect",
                xref: "x",
                yref: "paper",
                x0: displayWavelength(state.observedRange.min),
                x1: displayWavelength(state.observedRange.max),
                y0: 0,
                y1: 1,
                fillcolor: "rgba(255, 82, 82, 0.055)",
                line: {
                    color: "rgba(255, 82, 82, 0.7)",
                    width: 1,
                    dash: "dot",
                },
                layer: "below",
            });
        }

        if (state.clickedObservedWavelength !== null) {
            const clickedDisplay = state.clickedObservedWavelength / factor;
            shapes.push({
                type: "line",
                xref: "x",
                yref: "paper",
                x0: clickedDisplay,
                x1: clickedDisplay,
                y0: 0,
                y1: 1,
                line: { color: "#ff5252", width: 1.2, dash: "solid" },
            });
        }

        if (state.restFrame && state.hasRedshift) {
            const visibleLines = state.lines
                .filter(
                    (line) =>
                        line.rest_wavelength >= displayMinimum
                        && line.rest_wavelength <= displayMaximum,
                )
                .sort(
                    (first, second) =>
                        first.rest_wavelength - second.rest_wavelength,
                );
            visibleLines.forEach((line, index) => {
                shapes.push({
                    type: "line",
                    xref: "x",
                    yref: "paper",
                    x0: line.rest_wavelength,
                    x1: line.rest_wavelength,
                    y0: 0,
                    y1: 1,
                    line: {
                        color: line.kind === "absorption"
                            ? "rgba(224, 177, 110, 0.35)"
                            : "rgba(102, 204, 255, 0.22)",
                        width: 0.8,
                    },
                });
                annotations.push({
                    x: line.rest_wavelength,
                    y: 1.015 + (index % 4) * 0.055,
                    xref: "x",
                    yref: "paper",
                    text: renderLineLatex(line),
                    showarrow: false,
                    xanchor: "center",
                    yanchor: "bottom",
                    textangle: 0,
                    font: {
                        family: "Cascadia Code, Consolas, monospace",
                        size: 8.5,
                        color: line.kind === "absorption"
                            ? "#b7833e"
                            : colors.plotAxis,
                    },
                });
            });
        }

        return { shapes, annotations };
    }

    function renderLineLatex(line) {
        if (!line.latex || !window.MathJax) {
            return line.display_name || line.name;
        }
        return `$${line.latex}$`;
    }

    async function renderSpectrum({ resetRange = false, preserveRange = false } = {}) {
        if (!state.spectrum || !window.Plotly) {
            return;
        }
        const factor = currentDisplayFactor();
        const displayX = state.spectrum.wavelength.map((value) => value / factor);
        const displayMinimum = displayX[0];
        const displayMaximum = displayX[displayX.length - 1];
        const colors = themeColors();
        const previousRange = (
            preserveRange
            && dom.spectrumPlot._fullLayout?.xaxis?.range
        ) ? [...dom.spectrumPlot._fullLayout.xaxis.range] : null;
        const { shapes, annotations } = lineAnnotationsAndShapes(
            Math.min(displayMinimum, displayMaximum),
            Math.max(displayMinimum, displayMaximum),
        );
        const traces = [
            {
                type: "scatter",
                mode: "lines",
                x: displayX,
                y: state.spectrum.flux,
                line: { color: "#66ccff", width: 1.25 },
                hovertemplate:
                    "λ %{x:.3f} Å<br>flux %{y:.5g}<extra></extra>",
                connectgaps: false,
            },
        ];

        if (state.clickedObservedWavelength !== null) {
            const clickedDisplay = state.clickedObservedWavelength / factor;
            const closestIndex = findClosestIndex(displayX, clickedDisplay);
            traces.push({
                type: "scatter",
                mode: "markers",
                x: [displayX[closestIndex]],
                y: [state.spectrum.flux[closestIndex]],
                marker: {
                    color: "#ff5252",
                    size: 9,
                    symbol: "x",
                    line: { color: "#ff5252", width: 1 },
                },
                hoverinfo: "skip",
                showlegend: false,
            });
        }

        const topMargin =
            state.restFrame && state.hasRedshift ? 84 : 24;
        const layout = {
            paper_bgcolor: colors.plotPaper,
            plot_bgcolor: colors.plotPaper,
            margin: { l: 64, r: 22, t: topMargin, b: 72 },
            showlegend: false,
            hovermode: "closest",
            dragmode: "select",
            selectdirection: "h",
            font: {
                family: "Cascadia Code, Consolas, monospace",
                size: 9,
                color: colors.plotFont,
            },
            xaxis: {
                title: {
                    text: state.restFrame && state.hasRedshift
                        ? "Rest wavelength [Å]"
                        : "Observed wavelength [Å]",
                    font: { size: 10, color: colors.plotAxis },
                    standoff: 12,
                },
                range: previousRange || [displayMinimum, displayMaximum],
                gridcolor: colors.plotGrid,
                griddash: "dash",
                zeroline: false,
                showline: true,
                linecolor: colors.plotAxisLine,
                linewidth: 1,
                ticks: "inside",
                tickcolor: colors.plotTick,
                ticklen: 5,
                minor: {
                    tickmode: "auto",
                    ticks: "inside",
                    ticklen: 2.5,
                    tickcolor: colors.plotTickMinor,
                    nticks: 5,
                },
                tickfont: { size: 9 },
                fixedrange: false,
                separatethousands: false,
            },
            yaxis: {
                title: {
                    text: "flux",
                    font: { size: 10, color: colors.plotAxis },
                    standoff: 12,
                },
                gridcolor: colors.plotGrid,
                griddash: "dash",
                zeroline: false,
                showline: true,
                linecolor: colors.plotAxisLine,
                linewidth: 1,
                ticks: "inside",
                tickcolor: colors.plotTick,
                ticklen: 5,
                minor: {
                    tickmode: "auto",
                    ticks: "inside",
                    ticklen: 2.5,
                    tickcolor: colors.plotTickMinor,
                    nticks: 5,
                },
                tickfont: { size: 9 },
                fixedrange: true,
                separatethousands: false,
            },
            shapes,
            annotations,
            newselection: {
                line: { color: "#ff5252", width: 1, dash: "dot" },
                mode: "immediate",
            },
        };
        const config = {
            displayModeBar: false,
            responsive: false,
            scrollZoom: false,
            doubleClick: false,
            displaylogo: false,
        };

        await Plotly.react(dom.spectrumPlot, traces, layout, config);
        bindPlotlyGraphEvents();
        if (resetRange || !previousRange) {
            await Plotly.relayout(dom.spectrumPlot, {
                "xaxis.range": [displayMinimum, displayMaximum],
            });
        }
        const activeRange = dom.spectrumPlot._fullLayout.xaxis.range;
        autoScaleFlux(displayX, activeRange);
        dom.spectrumModeChip.textContent =
            state.restFrame && state.hasRedshift
                ? `Rest frame · z ${state.redshift.toPrecision(5)}`
                : "Observed frame";
    }

    function findClosestIndex(xValues, target) {
        let closestIndex = 0;
        let closestDistance = Infinity;
        for (let index = 0; index < xValues.length; index += 1) {
            const distance = Math.abs(xValues[index] - target);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
            }
        }
        return closestIndex;
    }

    function autoScaleFlux(displayX, xRange) {
        if (!state.spectrum) {
            return;
        }
        const minimumX = Math.min(xRange[0], xRange[1]);
        const maximumX = Math.max(xRange[0], xRange[1]);
        let minimumFlux = Infinity;
        let maximumFlux = -Infinity;
        for (let index = 0; index < displayX.length; index += 1) {
            const x = displayX[index];
            const flux = state.spectrum.flux[index];
            if (x < minimumX || x > maximumX || flux === null || !Number.isFinite(flux)) {
                continue;
            }
            minimumFlux = Math.min(minimumFlux, flux);
            maximumFlux = Math.max(maximumFlux, flux);
        }
        if (!Number.isFinite(minimumFlux) || !Number.isFinite(maximumFlux)) {
            Plotly.relayout(dom.spectrumPlot, { "yaxis.range": [0, 1] });
            return;
        }
        if (minimumFlux === maximumFlux) {
            const padding = Math.max(1, Math.abs(minimumFlux) * 0.05);
            minimumFlux -= padding;
            maximumFlux += padding;
        } else {
            const padding = (maximumFlux - minimumFlux) * 0.08;
            minimumFlux -= padding;
            maximumFlux += padding;
        }
        Plotly.relayout(dom.spectrumPlot, {
            "yaxis.range": [minimumFlux, maximumFlux],
        });
    }

    function bindPlotlyGraphEvents() {
        if (dom.spectrumPlot._spectralAtlasEventsBound) {
            return;
        }
        dom.spectrumPlot._spectralAtlasEventsBound = true;

        dom.spectrumPlot.on("plotly_click", (event) => {
            if (!event.points?.length || !state.spectrum) {
                return;
            }
            const clickedDisplay = Number(event.points[0].x);
            state.clickedObservedWavelength = observedWavelength(clickedDisplay);
            dom.lineSelect.disabled = false;
            dom.lineSelect.value = "";
            dom.clearLineButton.disabled = false;
            dom.lineHint.textContent =
                `Observed ${formatWavelength(state.clickedObservedWavelength)}`;
            dom.lineResult.textContent = "Waiting for line";
            renderSpectrum({ preserveRange: true });
        });

        dom.spectrumPlot.on("plotly_selected", (event) => {
            if (!state.spectrum) {
                return;
            }
            let selectedDisplayMinimum;
            let selectedDisplayMaximum;
            if (event?.range?.x) {
                [selectedDisplayMinimum, selectedDisplayMaximum] = event.range.x;
            } else if (event?.points?.length) {
                const values = event.points.map((point) => Number(point.x));
                selectedDisplayMinimum = Math.min(...values);
                selectedDisplayMaximum = Math.max(...values);
            }
            if (
                !Number.isFinite(selectedDisplayMinimum)
                || !Number.isFinite(selectedDisplayMaximum)
            ) {
                return;
            }
            const factor = currentDisplayFactor();
            requestImageRange(
                selectedDisplayMinimum * factor,
                selectedDisplayMaximum * factor,
            );
        });
    }

    function bindSpectrumInteractions() {
        dom.spectrumPlot.addEventListener("wheel", (event) => {
            if (!state.spectrum || !dom.spectrumPlot._fullLayout) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const layout = dom.spectrumPlot._fullLayout;
            const size = layout._size;
            const bounds = dom.spectrumPlot.getBoundingClientRect();
            const localX = event.clientX - bounds.left;
            const fraction = clamp((localX - size.l) / size.w, 0, 1);
            const current = layout.xaxis.range;
            const currentMinimum = Math.min(current[0], current[1]);
            const currentMaximum = Math.max(current[0], current[1]);
            const currentSpan = currentMaximum - currentMinimum;
            const anchor = currentMinimum + fraction * currentSpan;
            const factor = event.deltaY > 0 ? 1.18 : 0.84;
            let newSpan = currentSpan * factor;
            const factorRedshift = currentDisplayFactor();
            const fullObservedMinimum = state.cube.wavelength.min;
            const fullObservedMaximum = state.cube.wavelength.max;
            const fullDisplayMinimum = fullObservedMinimum / factorRedshift;
            const fullDisplayMaximum = fullObservedMaximum / factorRedshift;
            const fullSpan = Math.abs(fullDisplayMaximum - fullDisplayMinimum);
            const pixelSpan = fullSpan / Math.max(20, state.spectrum.wavelength.length);
            newSpan = clamp(newSpan, pixelSpan * 2, fullSpan);
            let newMinimum = anchor - fraction * newSpan;
            let newMaximum = anchor + (1 - fraction) * newSpan;
            if (newMinimum < Math.min(fullDisplayMinimum, fullDisplayMaximum)) {
                newMaximum += (
                    Math.min(fullDisplayMinimum, fullDisplayMaximum) - newMinimum
                );
                newMinimum = Math.min(fullDisplayMinimum, fullDisplayMaximum);
            }
            if (newMaximum > Math.max(fullDisplayMinimum, fullDisplayMaximum)) {
                newMinimum -= (
                    newMaximum - Math.max(fullDisplayMinimum, fullDisplayMaximum)
                );
                newMaximum = Math.max(fullDisplayMinimum, fullDisplayMaximum);
            }
            const factorDisplay = currentDisplayFactor();
            const displayX = state.spectrum.wavelength.map(
                (value) => value / factorDisplay,
            );
            Plotly.relayout(dom.spectrumPlot, {
                "xaxis.range": [newMinimum, newMaximum],
            }).then(() => autoScaleFlux(displayX, [newMinimum, newMaximum]));
        }, { passive: false });

        dom.spectrumPlot.addEventListener(
            "dblclick",
            resetSpectrumToDefaultSelection,
        );

        dom.spectrumResetButton.addEventListener("click", resetSpectrumView);
        dom.mapResetButton.addEventListener("click", () => mapView.resetView());

        dom.redshiftInput.addEventListener("input", () => {
            const value = dom.redshiftInput.value.trim();
            if (!value) {
                state.hasRedshift = false;
                state.redshift = 0;
            } else {
                const redshift = Number(value);
                if (!Number.isFinite(redshift) || redshift <= -1) {
                    dom.redshiftInput.setAttribute("aria-invalid", "true");
                    return;
                }
                dom.redshiftInput.removeAttribute("aria-invalid");
                state.hasRedshift = true;
                state.redshift = redshift;
            }
            if (state.restFrame && !state.hasRedshift) {
                state.restFrame = false;
                dom.restFrameToggle.checked = false;
            }
            renderSpectrum({ resetRange: true });
        });

        dom.restFrameToggle.addEventListener("change", () => {
            if (dom.restFrameToggle.checked && !state.hasRedshift) {
                dom.restFrameToggle.checked = false;
                showToast("Enter a redshift before switching to the rest frame.", "warning");
                return;
            }
            state.restFrame = dom.restFrameToggle.checked;
            renderSpectrum({ resetRange: true });
        });

        dom.lineSelect.addEventListener("change", () => {
            if (
                dom.lineSelect.value === ""
                || state.clickedObservedWavelength === null
            ) {
                return;
            }
            const line = state.lines[Number(dom.lineSelect.value)];
            if (!line) {
                return;
            }
            const redshift =
                state.clickedObservedWavelength / line.rest_wavelength - 1;
            if (!Number.isFinite(redshift) || redshift <= -1) {
                showToast("The selected wavelengths do not produce a valid redshift.", "error");
                return;
            }
            state.hasRedshift = true;
            state.redshift = redshift;
            state.restFrame = true;
            dom.redshiftInput.value = redshift.toPrecision(9);
            dom.restFrameToggle.checked = true;
            dom.lineHint.textContent =
                `${line.display_name || line.name} at `
                + formatWavelength(line.rest_wavelength);
            dom.lineResult.textContent =
                `z = ${redshift.toPrecision(7)}\n`
                + `${state.clickedObservedWavelength.toFixed(3)} Å`
                + ` / ${line.rest_wavelength.toFixed(3)} Å − 1`;
            renderSpectrum({ resetRange: true });
        });

        dom.clearLineButton.addEventListener("click", () => {
            state.clickedObservedWavelength = null;
            dom.lineSelect.value = "";
            dom.lineSelect.disabled = true;
            dom.clearLineButton.disabled = true;
            dom.lineHint.textContent = "Click the spectrum.";
            dom.lineResult.textContent = "";
            renderSpectrum({ preserveRange: true });
        });
    }

    function resetSpectrumView() {
        if (!state.spectrum) {
            return;
        }
        const factor = currentDisplayFactor();
        const xValues = state.spectrum.wavelength.map((value) => value / factor);
        const range = [xValues[0], xValues[xValues.length - 1]];
        Plotly.relayout(dom.spectrumPlot, { "xaxis.range": range })
            .then(() => autoScaleFlux(xValues, range));
    }

    function resetSpectrumToDefaultSelection() {
        if (!state.spectrum) {
            return;
        }
        if (!state.defaultWavelengthRange) {
            resetSpectrumView();
            return;
        }
        requestImageRange(
            state.defaultWavelengthRange.min,
            state.defaultWavelengthRange.max,
            { resetSpectrumRange: true },
        );
    }

    function bindFileControls() {
        dom.hduSelect.addEventListener("change", () => {
            const hduIndex = Number(dom.hduSelect.value);
            if (Number.isInteger(hduIndex) && state.activeSource) {
                reopenWithHdu(hduIndex);
            }
        });
        dom.selectExplorerButton.addEventListener("click", selectFileInExplorer);
        dom.selectedFilePicker.addEventListener("change", () => {
            const [file] = dom.selectedFilePicker.files;
            if (file) {
                openSelectedExplorerFile(file);
            }
        });
        dom.openPathButton.addEventListener("click", showPathDialog);
        dom.closePathButton.addEventListener("click", () => dom.pathDialog.close());
        dom.cancelPathButton.addEventListener("click", () => dom.pathDialog.close());
        dom.pathForm.addEventListener("submit", (event) => {
            event.preventDefault();
            const path = dom.pathInput.value.trim();
            if (!path) {
                dom.pathError.textContent = "Enter a local FITS file path.";
                dom.pathError.hidden = false;
                dom.pathInput.focus();
                return;
            }
            openDirectPath(path);
        });
        dom.bandSelect.addEventListener("change", () => {
            requestBandImage(Number(dom.bandSelect.value));
        });
        for (const input of dom.imageStatisticInputs) {
            input.addEventListener("change", () => {
                if (input.checked) {
                    setImageStatistic(input.value);
                }
            });
        }
        dom.mapViewButton.addEventListener("click", () => setNarrowView("map"));
        dom.spectrumViewButton.addEventListener("click", () => {
            setNarrowView("spectrum");
        });
        for (const themeButton of dom.themeChoices) {
            themeButton.addEventListener("click", () => {
                applyTheme(themeButton.dataset.themeChoice);
            });
        }
    }

    async function initialise() {
        const initialTheme =
            document.documentElement.dataset.theme === "light"
                ? "light"
                : "dark";
        setNarrowView("map");
        bindFileControls();
        bindSplitter();
        bindRightSplitter();
        bindColorControls();
        bindSpectrumInteractions();
        mapView.setCallbacks({
            onPixelClick: (pixel) => choosePixel(pixel),
        });
        if (/Mac/i.test(navigator.platform)) {
            dom.selectExplorerButton.textContent = "Select in Finder…";
        }
        applyTheme(initialTheme, { persist: false });
        setEmptyWorkspace();
        setLoaderVisible(false);
    }

    if (!window.Plotly) {
        showToast("The local Plotly bundle did not load.", "error", 8000);
    }
    initialise().catch((error) => {
        setLoaderVisible(false);
        setStatus("Initialisation failed", "error");
        showToast(error.message, "error", 8000);
    });
})();
