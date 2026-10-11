import * as THREE from "three";

export const SHELL_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    vY = position.y;
    gl_Position = projectionMatrix * mv;
  }
`;

export const SHELL_FRAG = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform float uFade;
  uniform float uTime;
  uniform float uPulse;
  uniform float uHighlight;
  uniform float uOrgan;
  varying vec3 vN;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vView);
    float ndv = max(dot(n, v), 0.0);
    float fres = pow(1.0 - ndv, 2.0);
    float key = clamp(dot(n, normalize(vec3(-0.45, 0.65, 0.72))) * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = uBase * (0.22 + 0.5 * key);
    col += uRim * fres * (1.05 + uHighlight * 0.85);
    float l = abs(fract(vY * 5.5) - 0.5);
    float line = smoothstep(0.43, 0.5, l);
    float band = exp(-pow((fract(uTime * 0.05) * 11.0 - 5.5 - vY) * 1.5, 2.0));
    col += uRim * line * (0.08 + 0.4 * fres) + uRim * band * 0.28;
    float sweep = 0.0;
    if (uPulse >= 0.0) {
      float yb = mix(5.4, -5.4, uPulse);
      float d = vY - yb;
      sweep = exp(-d * d * 3.0) + 0.3 * exp(-max(d, 0.0) * 1.4) * step(0.0, d) * (1.0 - uPulse);
      col += vec3(0.78, 0.96, 1.0) * sweep * 1.45;
    }
    col += vec3(0.55, 0.9, 1.0) * uHighlight * 0.22;
    float organBoost = 0.12 + uOrgan * 0.28;
    float alpha = (organBoost + fres * 0.72 + line * 0.12 + band * 0.14 + sweep * 0.55 + uHighlight * 0.25)
      * (0.2 + 0.8 * smoothstep(-5.15, -3.2, vY)) * uFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

export const POINT_VERT = /* glsl */ `
  uniform float uSize;
  uniform float uFade;
  uniform float uPulse;
  varying float vA;
  varying float vB;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float b = 0.0;
    if (uPulse >= 0.0) { float d = position.y - mix(5.4, -5.4, uPulse); b = exp(-d * d * 2.0); }
    vB = b;
    gl_PointSize = uSize * (1.0 + 1.5 * b) * (14.0 / max(-mv.z, 1.0));
    vA = uFade * (0.22 + 0.78 * smoothstep(-5.1, -2.5, position.y));
    gl_Position = projectionMatrix * mv;
  }
`;

export const POINT_FRAG = /* glsl */ `
  varying float vA;
  varying float vB;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.12, length(d));
    gl_FragColor = vec4(mix(vec3(0.55, 0.88, 1.0), vec3(1.0), vB), a * vA * (0.65 + 0.35 * vB));
    #include <colorspace_fragment>
  }
`;

export function makeShellMaterial(organ: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uBase: { value: new THREE.Color(organ ? "#1a1430" : "#0c1a3a") },
      uRim: { value: new THREE.Color(organ ? "#9ad4ff" : "#69dcff") },
      uFade: { value: 1 },
      uTime: { value: 0 },
      uPulse: { value: -1 },
      uHighlight: { value: 0 },
      uOrgan: { value: organ ? 1 : 0 },
    },
  });
}

export function makePointMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uSize: { value: 3.0 }, uFade: { value: 1 }, uPulse: { value: -1 } },
  });
}

export function makeLabelTexture(title: string, note: string | null): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = "rgba(8, 14, 28, 0.72)";
    roundRect(g, 8, 16, 496, note ? 96 : 72, 16);
    g.fill();
    g.strokeStyle = "rgba(105, 220, 255, 0.45)";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "#e8eef9";
    g.font = "600 36px system-ui, sans-serif";
    g.textBaseline = "middle";
    g.fillText(title, 28, note ? 48 : 52, 456);
    if (note) {
      g.fillStyle = "#89b4c8";
      g.font = "500 22px system-ui, sans-serif";
      g.fillText(note, 28, 88, 456);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
