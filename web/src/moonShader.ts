// Moon surface shader shared by the Globe and the landing page.
// Vertex: scene axes from the Moon ME frame (X = x, Y = z north up, Z = -y).
export const VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vMe;
void main() {
  vUv = uv;
  vMe = vec3(position.x, -position.z, position.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

// Lunar-Lambert lighting (half Lambert, half Lommel-Seeliger: the full Moon has little limb darkening),
// on relief normals. Exact mathematical solar penumbra: angular radius of the Sun seen from the Moon is
// 0.267 deg (sin = 0.004655 rad). Disc fraction uses exact circular segment area.
export const FRAG = /* glsl */ `
uniform sampler2D uColor, uRelief; uniform vec3 uSun, uCam; uniform float uRel, uNight;
varying vec2 vUv; varying vec3 vMe;
void main() {
  vec3 up = normalize(vMe);
  float lon = atan(up.y, up.x);
  vec3 east = vec3(-sin(lon), cos(lon), 0.0);
  vec3 north = cross(up, east);
  vec3 r = texture2D(uRelief, vUv).rgb * 2.0 - 1.0;
  vec3 n = normalize(uRel * (r.x * east + r.y * north) + r.z * up);

  // Exact mathematical solar penumbra: solar disc angular radius = 0.267 deg (sin = 0.004655)
  float sinEl = dot(up, uSun);
  float x = clamp(sinEl / 0.004655, -1.0, 1.0);
  float discFrac = 1.0 - (acos(x) - x * sqrt(max(0.0, 1.0 - x * x))) / 3.14159265;

  float ci = max(dot(n, uSun), 0.0) * discFrac;
  float ce = max(dot(n, normalize(uCam - up)), 0.0);
  float L = mix(ci, 2.0 * ci / (ci + ce + 1e-4), 0.5);
  vec3 albedo = pow(texture2D(uColor, vUv).rgb, vec3(2.2));
  gl_FragColor = vec4(pow(albedo * (1.15 * L + uNight), vec3(1.0 / 2.2)), 1.0);
}`
