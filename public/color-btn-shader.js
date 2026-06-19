import {
  ShaderMount,
  meshGradientFragmentShader,
  getShaderColorFromString,
} from '/vendor/@paper-design/shaders/index.js';

/** Paper artboard B99-0 — Mesh Gradient */
const MESH_COLORS = ['#4694F6', '#FEBEFF', '#72FF8A', '#FF6A83', '#FFEC2F', '#9F9FFF'];

export function mountColorBtnShader(container) {
  const colors = MESH_COLORS.map(getShaderColorFromString);
  return new ShaderMount(
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
}
