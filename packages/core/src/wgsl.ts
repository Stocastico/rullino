// Shared WGSL helpers, prepended to every generated shader. Each mirrors a CPU function
// (color.ts, oklab.ts) so filters can be written the same way on both sides.
// Names are prefixed rl_ to stay clear of filter code.

export const colorWgsl = /* wgsl */ `
fn rl_srgb_to_linear(c: vec3f) -> vec3f {
  let a = abs(c);
  return sign(c) * select(pow((a + 0.055) / 1.055, vec3f(2.4)), a / 12.92, a <= vec3f(0.04045));
}

fn rl_linear_to_srgb(c: vec3f) -> vec3f {
  let a = abs(c);
  return sign(c) * select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a * 12.92, a <= vec3f(0.0031308));
}

fn rl_cbrt(x: vec3f) -> vec3f {
  return sign(x) * pow(abs(x), vec3f(1.0 / 3.0));
}

fn rl_linear_to_oklab(c: vec3f) -> vec3f {
  let lms = rl_cbrt(vec3f(
    dot(c, vec3f(0.4122214708, 0.5363325363, 0.0514459929)),
    dot(c, vec3f(0.2119034982, 0.6806995451, 0.1073969566)),
    dot(c, vec3f(0.0883024619, 0.2817188376, 0.6299787005)),
  ));
  return vec3f(
    dot(lms, vec3f(0.2104542553, 0.7936177850, -0.0040720468)),
    dot(lms, vec3f(1.9779984951, -2.4285922050, 0.4505937099)),
    dot(lms, vec3f(0.0259040371, 0.7827717662, -0.8086757660)),
  );
}

fn rl_oklab_to_linear(lab: vec3f) -> vec3f {
  let l_ = dot(lab, vec3f(1.0, 0.3963377774, 0.2158037573));
  let m_ = dot(lab, vec3f(1.0, -0.1055613458, -0.0638541728));
  let s_ = dot(lab, vec3f(1.0, -0.0894841775, -1.2914855480));
  let lms = vec3f(l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_);
  return vec3f(
    dot(lms, vec3f(4.0767416621, -3.3077115913, 0.2309699292)),
    dot(lms, vec3f(-1.2684380046, 2.6097574011, -0.3413193965)),
    dot(lms, vec3f(-0.0041960863, -0.7034186147, 1.7076147010)),
  );
}

fn rl_luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn rl_unpremultiply(c: vec4f) -> vec4f {
  if (c.a <= 0.0) { return vec4f(0.0, 0.0, 0.0, c.a); }
  return vec4f(c.rgb / c.a, c.a);
}

fn rl_premultiply(c: vec4f) -> vec4f {
  return vec4f(c.rgb * c.a, c.a);
}
`;
