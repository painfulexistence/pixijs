// One instanced cube mesh: per-vertex position/normal, per-instance offset/color.
// The shader ignores Pixi's 2D transforms and uses its own view-projection matrix,
// so it declares neither `globalUniforms` nor `localUniforms` (Pixi then leaves groups 0/1 to us).

export const wgsl = /* wgsl */`
struct Scene {
    uViewProj: mat4x4<f32>,
    uLightDir: vec4<f32>,
    uTime: f32,
};

@group(0) @binding(0) var<uniform> scene: Scene;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) vNormal: vec3<f32>,
    @location(1) vColor: vec3<f32>,
};

fn rotation(axis: vec3<f32>, angle: f32) -> mat3x3<f32> {
    let a = normalize(axis);
    let s = sin(angle);
    let c = cos(angle);
    let oc = 1.0 - c;
    return mat3x3<f32>(
        vec3<f32>(oc * a.x * a.x + c,       oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s),
        vec3<f32>(oc * a.x * a.y - a.z * s, oc * a.y * a.y + c,       oc * a.y * a.z + a.x * s),
        vec3<f32>(oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c),
    );
}

@vertex
fn mainVert(
    @location(0) aPosition: vec3<f32>,
    @location(1) aNormal: vec3<f32>,
    @location(2) aOffset: vec3<f32>,
    @location(3) aColor: vec3<f32>,
) -> VertexOutput {
    let t = scene.uTime;
    let r = rotation(aOffset + vec3<f32>(0.3, 1.0, 0.5), t * 0.8 + length(aOffset));
    let wave = sin(t * 1.5 - length(aOffset.xz) * 0.35) * 1.2;
    let world = r * aPosition + aOffset + vec3<f32>(0.0, wave, 0.0);

    var out: VertexOutput;
    var clip = scene.uViewProj * vec4<f32>(world, 1.0);
    // The projection matrix is GL-style (z in [-w, w]); WebGPU wants z in [0, w].
    clip.z = (clip.z + clip.w) * 0.5;
    out.position = clip;
    out.vNormal = r * aNormal;
    out.vColor = aColor;
    return out;
}

@fragment
fn mainFrag(@location(0) vNormal: vec3<f32>, @location(1) vColor: vec3<f32>) -> @location(0) vec4<f32> {
    let light = max(dot(normalize(vNormal), normalize(scene.uLightDir.xyz)), 0.0);
    return vec4<f32>(vColor * (0.25 + 0.75 * light), 1.0);
}
`;

// WebGL2 fallback, used when the worker can't get a WebGPU adapter.
export const glVertex = /* glsl */`
in vec3 aPosition;
in vec3 aNormal;
in vec3 aOffset;
in vec3 aColor;

uniform mat4 uViewProj;
uniform vec4 uLightDir;
uniform float uTime;

out vec3 vNormal;
out vec3 vColor;

mat3 rotation(vec3 axis, float angle) {
    vec3 a = normalize(axis);
    float s = sin(angle);
    float c = cos(angle);
    float oc = 1.0 - c;
    return mat3(
        oc * a.x * a.x + c,       oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
        oc * a.x * a.y - a.z * s, oc * a.y * a.y + c,       oc * a.y * a.z + a.x * s,
        oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c
    );
}

void main() {
    mat3 r = rotation(aOffset + vec3(0.3, 1.0, 0.5), uTime * 0.8 + length(aOffset));
    float wave = sin(uTime * 1.5 - length(aOffset.xz) * 0.35) * 1.2;
    vec3 world = r * aPosition + aOffset + vec3(0.0, wave, 0.0);

    gl_Position = uViewProj * vec4(world, 1.0);
    vNormal = r * aNormal;
    vColor = aColor;
}
`;

export const glFragment = /* glsl */`
precision mediump float;

in vec3 vNormal;
in vec3 vColor;

uniform vec4 uLightDir;

out vec4 finalColor;

void main() {
    float light = max(dot(normalize(vNormal), normalize(uLightDir.xyz)), 0.0);
    finalColor = vec4(vColor * (0.25 + 0.75 * light), 1.0);
}
`;
