// WebGL renderer for the "streamer" light-flow background.
//
// The DOM version paints ten viewport-sized radial gradients and moves each on
// the compositor; a palette change cross-fades two complete layer stacks. Here
// the same field is evaluated in one fragment pass at reduced resolution, the
// palette is interpolated as uniforms (no duplicate layers), and the loop is
// capped and paused when the window is hidden. A low-amplitude domain warp and
// ordered dithering add liquid movement and remove gradient banding.

export interface StreamerBlobConfig {
  left: string;
  top: string;
  size: number; // vmax
  opacity: number;
  duration: number; // seconds, before the speed multiplier
  phase: number; // seconds of negative delay
  xKeys: number[]; // px, keyframes at 0/25/50/75/100%
  yKeys: number[];
}

export interface StreamerRenderer {
  setPalette: (colors: string[], animate: boolean) => void;
  dispose: () => void;
}

export interface StreamerRendererOptions {
  reducedMotion: boolean;
  speedMultiplier: number;
  onContextLost?: () => void;
  /** Canvas pixels per CSS pixel. The field is soft, so half resolution is invisible. */
  resolutionScale?: number;
  maxFps?: number;
}

type RGB = [number, number, number];

const MAX_BLOBS = 10;
const PALETTE_TRANSITION_MS = 900;
const MAX_CANVAS_WIDTH = 1600;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const hslToRgb = (h: number, s: number, l: number): RGB => {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = clamp01(s);
  const light = clamp01(l);
  if (sat === 0) return [light, light, light];
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)];
};

/** Parses the palette formats Background produces: rgb()/rgba() and modern hsl(). Channels in 0..1. */
export function parseCssColor(value: string): RGB | null {
  const text = value.trim().toLowerCase();
  const numbers = (text.match(/-?\d*\.?\d+/g) || []).map(Number);
  if (text.startsWith('rgb') && numbers.length >= 3) {
    return [clamp01(numbers[0] / 255), clamp01(numbers[1] / 255), clamp01(numbers[2] / 255)];
  }
  if (text.startsWith('hsl') && numbers.length >= 3) {
    return hslToRgb(numbers[0], numbers[1] / 100, numbers[2] / 100);
  }
  const hex = text.match(/^#([0-9a-f]{6})$/);
  if (hex) {
    const int = Number.parseInt(hex[1], 16);
    return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
  }
  return null;
}

// Same timing as the CSS keyframes: ease-in-out per 25% segment.
const easeInOut = (t: number) => t * t * (3 - 2 * t);

/** Offset (px) of a blob at `seconds`, matching rf-blob-drift with a negative delay of `phase`. */
export function blobOffsetAt(blob: StreamerBlobConfig, seconds: number, speedMultiplier: number): [number, number] {
  const duration = Math.max(1, blob.duration * speedMultiplier);
  const progress = (((seconds + blob.phase) / duration) % 1 + 1) % 1;
  const segment = Math.min(3, Math.floor(progress * 4));
  const local = easeInOut(progress * 4 - segment);
  const x = blob.xKeys[segment] + (blob.xKeys[segment + 1] - blob.xKeys[segment]) * local;
  const y = blob.yKeys[segment] + (blob.yKeys[segment + 1] - blob.yKeys[segment]) * local;
  return [x, y];
}

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
uniform float u_warp;
uniform vec3 u_under[3];
uniform vec4 u_blob[${MAX_BLOBS}];
uniform vec3 u_color[${MAX_BLOBS}];
uniform int u_count;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 p = v_uv * u_res;
  // Underpainting: CSS linear-gradient(135deg, c0, c1 55%, c2) under black 55%.
  float gradLen = (u_res.x + u_res.y) * 0.70710678;
  float t = clamp(dot(p - u_res * 0.5, vec2(0.70710678)) / gradLen + 0.5, 0.0, 1.0);
  vec3 col = t < 0.55 ? mix(u_under[0], u_under[1], t / 0.55) : mix(u_under[1], u_under[2], (t - 0.55) / 0.45);
  col *= 0.45;

  // Slow liquid warp of the sampling position; amplitude scales with the window.
  float m = max(u_res.x, u_res.y);
  vec2 q = p + u_warp * m * 0.022 * vec2(
    sin(p.y / m * 5.2 + u_time * 0.11) + 0.5 * sin(p.x / m * 3.1 - u_time * 0.07),
    cos(p.x / m * 4.6 - u_time * 0.09) + 0.5 * cos(p.y / m * 2.7 + u_time * 0.05)
  );

  for (int i = 0; i < ${MAX_BLOBS}; i++) {
    if (i >= u_count) break;
    vec4 b = u_blob[i];
    // radial-gradient(circle, color 8%, transparent 72%) over the farthest-corner radius.
    float d = distance(q, b.xy) / b.z;
    float a = b.w * (1.0 - clamp((d - 0.08) / 0.64, 0.0, 1.0));
    col = mix(col, u_color[i], a);
  }

  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const compile = (gl: WebGLRenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('Streamer shader failed to compile:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const isSoftwareRenderer = (gl: WebGLRenderingContext) => {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    // Software GL is slower than the compositor path it would replace.
    return /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
};

const percent = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed / 100 : 0.5;
};

export function createStreamerRenderer(
  canvas: HTMLCanvasElement,
  blobs: StreamerBlobConfig[],
  options: StreamerRendererOptions,
): StreamerRenderer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: true,
    }) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl || gl.isContextLost() || isSoftwareRenderer(gl)) return null;

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Streamer shader failed to link:', gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    res: gl.getUniformLocation(program, 'u_res'),
    time: gl.getUniformLocation(program, 'u_time'),
    warp: gl.getUniformLocation(program, 'u_warp'),
    under: gl.getUniformLocation(program, 'u_under'),
    blob: gl.getUniformLocation(program, 'u_blob'),
    color: gl.getUniformLocation(program, 'u_color'),
    count: gl.getUniformLocation(program, 'u_count'),
  };

  const activeBlobs = blobs.slice(0, MAX_BLOBS);
  const blobData = new Float32Array(MAX_BLOBS * 4);
  const colorData = new Float32Array(MAX_BLOBS * 3);
  const underData = new Float32Array(9);
  const resolutionScale = options.resolutionScale ?? 0.5;
  const frameInterval = 1000 / (options.maxFps ?? 30);

  let fromPalette: RGB[] = [[0.32, 0.32, 0.32], [0.15, 0.15, 0.15]];
  let toPalette: RGB[] = fromPalette;
  let paletteStart = -Infinity;
  let cssWidth = 0;
  let cssHeight = 0;
  let frameId = 0;
  let lastFrame = -Infinity;
  let disposed = false;
  let contextLost = false;

  const paletteAt = (now: number) => {
    const progress = clamp01((now - paletteStart) / PALETTE_TRANSITION_MS);
    const eased = easeInOut(progress);
    const length = Math.max(fromPalette.length, toPalette.length);
    const colorAt = (palette: RGB[], index: number) => palette[index % palette.length];
    return {
      settled: progress >= 1,
      colors: Array.from({ length }, (_, index) => {
        const a = colorAt(fromPalette, index);
        const b = colorAt(toPalette, index);
        return [a[0] + (b[0] - a[0]) * eased, a[1] + (b[1] - a[1]) * eased, a[2] + (b[2] - a[2]) * eased] as RGB;
      }),
    };
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    cssWidth = Math.max(1, rect.width);
    cssHeight = Math.max(1, rect.height);
    const scale = Math.min(resolutionScale, MAX_CANVAS_WIDTH / cssWidth);
    const width = Math.max(1, Math.round(cssWidth * scale));
    const height = Math.max(1, Math.round(cssHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const draw = (now: number) => {
    if (!gl || contextLost) return true;
    const seconds = options.reducedMotion ? 0 : now / 1000;
    const { colors, settled } = paletteAt(now);
    const vmax = Math.max(cssWidth, cssHeight) / 100;

    activeBlobs.forEach((blob, index) => {
      const [dx, dy] = options.reducedMotion ? [0, 0] : blobOffsetAt(blob, seconds, options.speedMultiplier);
      const halfSize = (blob.size * vmax) / 2;
      blobData[index * 4] = percent(blob.left) * cssWidth + dx;
      blobData[index * 4 + 1] = percent(blob.top) * cssHeight + dy;
      blobData[index * 4 + 2] = halfSize * Math.SQRT2;
      blobData[index * 4 + 3] = blob.opacity;
      const color = colors[index % colors.length];
      colorData.set(color, index * 3);
    });
    const first = colors[0];
    const second = colors[1] || first;
    const third = colors[2] || second;
    underData.set(first, 0);
    underData.set(second, 3);
    underData.set(third, 6);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.res, cssWidth, cssHeight);
    gl.uniform1f(uniforms.time, seconds);
    gl.uniform1f(uniforms.warp, options.reducedMotion ? 0 : 1);
    gl.uniform3fv(uniforms.under, underData);
    gl.uniform4fv(uniforms.blob, blobData);
    gl.uniform3fv(uniforms.color, colorData);
    gl.uniform1i(uniforms.count, activeBlobs.length);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return settled;
  };

  const loop = (now: number) => {
    frameId = 0;
    if (disposed || contextLost) return;
    if (now - lastFrame >= frameInterval - 1) {
      lastFrame = now;
      const settled = draw(now);
      // Reduced motion: draw only until a palette change has settled.
      if (options.reducedMotion && settled) return;
    }
    if (document.visibilityState === 'visible') frameId = requestAnimationFrame(loop);
  };

  const start = () => {
    if (!frameId && !disposed && !contextLost && document.visibilityState === 'visible') {
      lastFrame = -Infinity;
      frameId = requestAnimationFrame(loop);
    }
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') start();
    else if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
  };

  const handleContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    options.onContextLost?.();
  };

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    resize();
    start();
  });
  resizeObserver?.observe(canvas);
  if (!resizeObserver) window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', handleVisibility);
  canvas.addEventListener('webglcontextlost', handleContextLost);
  resize();
  start();

  return {
    setPalette(colors, animate) {
      const parsed = colors.map(parseCssColor).filter((color): color is RGB => Boolean(color));
      if (parsed.length === 0) return;
      const now = performance.now();
      fromPalette = animate ? paletteAt(now).colors : parsed;
      toPalette = parsed;
      paletteStart = animate ? now : -Infinity;
      start();
    },
    dispose() {
      disposed = true;
      if (frameId) cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibility);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      if (gl && !contextLost) {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        // No loseContext(): the same canvas may host the next renderer
        // (StrictMode re-runs effects); the context is freed with the canvas.
      }
    },
  };
}
