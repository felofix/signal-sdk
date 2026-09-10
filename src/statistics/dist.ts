/** Distribution functions and descriptive statistics, implemented in-repo. */

export function expit(x: number): number {
  return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
}

export function mean(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return values.length ? sum / values.length : NaN;
}

export function variance(values: ArrayLike<number>): number {
  const m = mean(values);
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += (values[i] - m) ** 2;
  return values.length ? sum / values.length : NaN;
}

/** numpy's default linear-interpolation quantile. */
export function quantile(values: ArrayLike<number>, q: number): number {
  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function median(values: ArrayLike<number>): number {
  return quantile(values, 0.5);
}

/** Acklam's rational approximation with one Newton refinement. */
export function normPpf(p: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : p >= 1 ? Infinity : NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  let x: number;
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else {
    const q = p - 0.5;
    const r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

export function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

/** Complementary error function (W. J. Cody's rational approximations, ~1e-15). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  let result: number;
  if (z < 0.5) {
    const t = z * z;
    const p = [3.16112374387056560e0, 1.13864154151050156e2, 3.77485237685302021e2, 3.20937758913846947e3, 1.85777706184603153e-1];
    const q = [2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3];
    let num = p[4] * t, den = t;
    for (let i = 0; i < 3; i++) { num = (num + p[i]) * t; den = (den + q[i]) * t; }
    result = 1 - (z * (num + p[3])) / (den + q[3]);
  } else if (z <= 4) {
    const p = [5.64188496988670089e-1, 8.88314979438837594e0, 6.61191906371416295e1, 2.98635138197400131e2, 8.81952221241769090e2, 1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3, 2.15311535474403846e-8];
    const q = [1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3, 3.29079923573345963e3, 4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3];
    let num = p[8] * z, den = z;
    for (let i = 0; i < 7; i++) { num = (num + p[i]) * z; den = (den + q[i]) * z; }
    result = ((num + p[7]) / (den + q[7])) * Math.exp(-z * z);
  } else {
    const p = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2, 6.58749161529837803e-4, 1.63153871373020978e-2];
    const q = [2.56852019228982242e0, 1.87295284992346725e0, 5.27905102951428412e-1, 6.05183413124413191e-2, 2.33520497626869185e-3];
    const t = 1 / (z * z);
    let num = p[5] * t, den = t;
    for (let i = 0; i < 4; i++) { num = (num + p[i]) * t; den = (den + q[i]) * t; }
    const ratio = (t * (num + p[4])) / (den + q[4]);
    result = (Math.exp(-z * z) / z) * (1 / Math.sqrt(Math.PI) - ratio);
  }
  return x < 0 ? 2 - result : result;
}

/** Lanczos log-gamma. */
export function lgamma(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized incomplete beta I_x(a, b) via the continued fraction (Numerical Recipes). */
export function betainc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  if (x < (a + 1) / (a + b + 2)) return (Math.exp(lbeta) * betacf(x, a, b)) / a;
  return 1 - (Math.exp(lbeta) * betacf(1 - x, b, a)) / b;
}

function betacf(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-14) break;
  }
  return h;
}

/** Quantile of Beta(a, b) by bisection on the regularized incomplete beta. */
export function betaPpf(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let low = 0, high = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (betainc(mid, a, b) < p) low = mid; else high = mid;
    if (high - low < 1e-13) break;
  }
  return (low + high) / 2;
}

export function tCdf(x: number, df: number): number {
  const tail = 0.5 * betainc(df / (df + x * x), df / 2, 0.5);
  return x >= 0 ? 1 - tail : tail;
}

/** Student-t quantile by bracketing and bisection on the cdf. */
export function tPpf(p: number, df: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  if (!Number.isFinite(df) || df > 1e6) return normPpf(p);
  let low = -1, high = 1;
  while (tCdf(low, df) > p) low *= 2;
  while (tCdf(high, df) < p) high *= 2;
  for (let i = 0; i < 300; i++) {
    const mid = (low + high) / 2;
    if (tCdf(mid, df) < p) low = mid; else high = mid;
    if (high - low < 1e-12 * Math.max(1, Math.abs(mid))) break;
  }
  return (low + high) / 2;
}

/** Clopper–Pearson interval for a binomial proportion. */
export function proportionInterval(successes: number, trials: number, confidence = 0.95): [number, number] {
  const alpha = 1 - confidence;
  const low = successes === 0 ? 0 : betaPpf(alpha / 2, successes, trials - successes + 1);
  const high = successes === trials ? 1 : betaPpf(1 - alpha / 2, successes + 1, trials - successes);
  return [low, high];
}

function ranks(values: ArrayLike<number>): Float64Array {
  const order = Array.from({ length: values.length }, (_, i) => i).sort((i, j) => values[i] - values[j]);
  const out = new Float64Array(values.length);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && values[order[end + 1]] === values[order[start]]) end++;
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k++) out[order[k]] = rank;
    start = end + 1;
  }
  return out;
}

export function pearson(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
}

export function spearman(x: ArrayLike<number>, y: ArrayLike<number>): number {
  return pearson(ranks(x), ranks(y));
}
