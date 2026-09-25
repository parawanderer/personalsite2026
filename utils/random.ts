/**
 * Seeded PRNG (mulberry32) so procedural layouts are reproducible per seed
 * https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */
export const makeRng = (seed: number): () => number => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const hash2 = (x: number, y: number, seed: number): number => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
};

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * 2D value noise in range [-1, 1]
 */
export const valueNoise2D = (x: number, y: number, seed: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);

    const a = hash2(x0, y0, seed);
    const b = hash2(x0 + 1, y0, seed);
    const c = hash2(x0, y0 + 1, seed);
    const d = hash2(x0 + 1, y0 + 1, seed);

    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return (top + (bottom - top) * ty) * 2 - 1;
};

/**
 * Two octaves of value noise, range roughly [-1, 1]
 */
export const fbm2D = (x: number, y: number, seed: number): number => {
    return (valueNoise2D(x, y, seed) * 2 + valueNoise2D(x * 2.03, y * 2.03, seed + 17)) / 3;
};
