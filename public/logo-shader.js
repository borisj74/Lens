// Animated logo mark — Paper "Dithering" swirl shader.
// Reproduces the Paper design (node 4JS-1) using the framework-agnostic core
// package @paper-design/shaders (the vanilla canvas API under the React wrapper).
// Exact params captured from the design's <Dithering> component.

const SHADERS_CDN = 'https://esm.sh/@paper-design/shaders@0.0.76';

async function initLogoShader() {
  const mount = document.getElementById('logo-mark');
  if (!mount) return;

  let shaders;
  try {
    shaders = await import(SHADERS_CDN);
  } catch (err) {
    // CDN unreachable: leave the solid black circle as a graceful fallback.
    console.warn('[logo-shader] Could not load Paper shaders from CDN:', err);
    return;
  }

  const {
    ShaderMount,
    ditheringFragmentShader,
    DitheringShapes,
    DitheringTypes,
    ShaderFitOptions,
    getShaderColorFromString,
  } = shaders;

  // Params lifted verbatim from the Paper design (4JS-1):
  // <Dithering speed={1} shape="swirl" type="4x4" size={0.1} scale={0.42}
  //   colorBack="#00000000" colorFront="#109789" /> on a 38px #000 circle.
  const uniforms = {
    u_colorBack: getShaderColorFromString('#00000000'),
    u_colorFront: getShaderColorFromString('#109789'),
    u_shape: DitheringShapes['swirl'],
    u_type: DitheringTypes['4x4'],
    u_pxSize: 0.1,
    u_fit: ShaderFitOptions['none'],
    u_scale: 0.42,
    u_rotation: 0,
    u_offsetX: 0,
    u_offsetY: 0,
    u_originX: 0.5,
    u_originY: 0.5,
    u_worldWidth: 0,
    u_worldHeight: 0,
  };

  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  // Respect reduced-motion: render a single static frame instead of animating.
  const speed = prefersReducedMotion ? 0 : 1;
  const frame = prefersReducedMotion ? 7813548.948 : 0;

  // new ShaderMount(parentElement, fragmentShader, uniforms,
  //   webGlContextAttributes?, speed, frame, minPixelRatio?, maxPixelCount?)
  new ShaderMount(mount, ditheringFragmentShader, uniforms, undefined, speed, frame);
}

initLogoShader();
