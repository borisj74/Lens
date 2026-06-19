// Color filter button — Paper "Mesh Gradient" shader (artboard B99-0).
// Loaded as a module script (see index.html). Uses the same CDN pattern as logo-shader.js
// so Vercel does not compile this file to CommonJS.

const SHADERS_CDN = 'https://esm.sh/@paper-design/shaders@0.0.76';
const MESH_COLORS = ['#4694F6', '#FEBEFF', '#72FF8A', '#FF6A83', '#FFEC2F', '#9F9FFF'];

async function initColorBtnShader() {
  const container = document.getElementById('color-btn-shader');
  if (!container || container.dataset.shaderMounted) return;

  let shaders;
  try {
    shaders = await import(SHADERS_CDN);
  } catch (err) {
    console.warn('[color-btn-shader] Could not load Paper shaders from CDN:', err);
    return;
  }

  const { ShaderMount, meshGradientFragmentShader, getShaderColorFromString } = shaders;
  const colors = MESH_COLORS.map(getShaderColorFromString);

  new ShaderMount(
    container,
    meshGradientFragmentShader,
    {
      u_colors: colors,
      u_colorsCount: colors.length,
      u_distortion: 0.8,
      u_swirl: 0.1,
      u_grainMixer: 0,
      u_grainOverlay: 0,
      u_fit: 1,
      u_scale: 1,
      u_rotation: 0,
      u_offsetX: 0,
      u_offsetY: 0,
      u_originX: 0.5,
      u_originY: 0.5,
      u_worldWidth: 0,
      u_worldHeight: 0,
    },
    undefined,
    1,
    81204.58,
    2,
  );

  container.dataset.shaderMounted = 'true';
}

initColorBtnShader();
