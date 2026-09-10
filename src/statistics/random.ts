/** A seeded generator with the distributions the statistics need. No dependencies. */

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

export class Rng {
  private s0: number; private s1: number; private s2: number; private s3: number;
  private spare: number | null = null;

  constructor(seed: number) {
    const mix = splitmix32(Math.floor(seed));
    this.s0 = mix(); this.s1 = mix(); this.s2 = mix(); this.s3 = mix();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** xoshiro128** — uniform in [0, 1). */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0; this.s3 ^= this.s1; this.s1 ^= this.s2; this.s0 ^= this.s3;
    this.s2 ^= t; this.s3 = rotl(this.s3, 11);
    return result / 4294967296;
  }

  /** Integer in [low, high). */
  integer(low: number, high: number): number {
    return low + Math.floor(this.next() * (high - low));
  }

  integers(low: number, high: number, count: number): Int32Array {
    const out = new Int32Array(count);
    for (let i = 0; i < count; i++) out[i] = this.integer(low, high);
    return out;
  }

  normal(mean = 0, sd = 1): number {
    if (this.spare !== null) { const value = this.spare; this.spare = null; return mean + sd * value; }
    let u: number, v: number, s: number;
    do { u = 2 * this.next() - 1; v = 2 * this.next() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const factor = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * factor;
    return mean + sd * u * factor;
  }

  normals(count: number, mean = 0, sd = 1): Float64Array {
    const out = new Float64Array(count);
    for (let i = 0; i < count; i++) out[i] = this.normal(mean, sd);
    return out;
  }

  /** Marsaglia–Tsang gamma with shape boost for shape < 1. */
  gamma(shape: number, scale = 1): number {
    if (shape <= 0) return 0;
    if (shape < 1) return this.gamma(shape + 1, scale) * Math.pow(this.next(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number, v: number;
      do { x = this.normal(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = this.next();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }

  beta(a: number, b: number): number {
    const x = this.gamma(a);
    const y = this.gamma(b);
    return x + y === 0 ? 0.5 : x / (x + y);
  }

  /** Exact binomial by geometric waiting times; cost is proportional to n·min(p, 1−p). */
  binomial(n: number, p: number): number {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    const flip = p > 0.5;
    const q = flip ? 1 - p : p;
    const logq = Math.log(1 - q);
    let count = 0;
    let position = -1;
    for (;;) {
      position += 1 + Math.floor(Math.log(1 - this.next()) / logq);
      if (position >= n) break;
      count += 1;
    }
    return flip ? n - count : count;
  }

  lognormal(mu: number, sigma: number): number {
    return Math.exp(this.normal(mu, sigma));
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.integer(0, i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Non-deterministic randomness for operational selection. */
export function systemRandom(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 4294967296;
}
