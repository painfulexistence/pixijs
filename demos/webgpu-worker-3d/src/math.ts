// Minimal column-major mat4 helpers (same layout as WGSL `mat4x4<f32>` and GLSL `mat4`).

export type Mat4 = Float32Array;

export function perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4
{
    // OpenGL-style clip space (z in [-1, 1]). The WGSL shader remaps z to WebGPU's [0, 1].
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);

    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;

    return out;
}

export function lookAt(
    out: Mat4,
    eye: [number, number, number],
    target: [number, number, number],
    up: [number, number, number],
): Mat4
{
    let zx = eye[0] - target[0];
    let zy = eye[1] - target[1];
    let zz = eye[2] - target[2];
    let len = Math.hypot(zx, zy, zz) || 1;

    zx /= len;
    zy /= len;
    zz /= len;

    let xx = (up[1] * zz) - (up[2] * zy);
    let xy = (up[2] * zx) - (up[0] * zz);
    let xz = (up[0] * zy) - (up[1] * zx);

    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len;
    xy /= len;
    xz /= len;

    const yx = (zy * xz) - (zz * xy);
    const yy = (zz * xx) - (zx * xz);
    const yz = (zx * xy) - (zy * xx);

    out.set([
        xx, yx, zx, 0,
        xy, yy, zy, 0,
        xz, yz, zz, 0,
    ]);
    out[12] = -((xx * eye[0]) + (xy * eye[1]) + (xz * eye[2]));
    out[13] = -((yx * eye[0]) + (yy * eye[1]) + (yz * eye[2]));
    out[14] = -((zx * eye[0]) + (zy * eye[1]) + (zz * eye[2]));
    out[15] = 1;

    return out;
}

export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4
{
    for (let col = 0; col < 4; col++)
    {
        const b0 = b[col * 4];
        const b1 = b[(col * 4) + 1];
        const b2 = b[(col * 4) + 2];
        const b3 = b[(col * 4) + 3];

        for (let row = 0; row < 4; row++)
        {
            out[(col * 4) + row] = (a[row] * b0) + (a[4 + row] * b1) + (a[8 + row] * b2) + (a[12 + row] * b3);
        }
    }

    return out;
}
