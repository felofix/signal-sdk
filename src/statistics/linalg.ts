/** Small dense linear algebra for the mixed model: row-major Float64Array matrices. */

export interface Matrix { rows: number; cols: number; data: Float64Array }

export function zeros(rows: number, cols: number): Matrix {
  return { rows, cols, data: new Float64Array(rows * cols) };
}

export function get(m: Matrix, i: number, j: number): number {
  return m.data[i * m.cols + j];
}

export function set(m: Matrix, i: number, j: number, value: number): void {
  m.data[i * m.cols + j] = value;
}

/** Lower-triangular Cholesky factor of a symmetric positive-definite matrix; throws when not SPD. */
export function cholesky(a: Matrix): Matrix {
  const n = a.rows;
  const l = zeros(n, n);
  for (let j = 0; j < n; j++) {
    let diag = get(a, j, j);
    for (let k = 0; k < j; k++) diag -= l.data[j * n + k] ** 2;
    if (!(diag > 0) || !Number.isFinite(diag)) throw new RangeError("Matrix is not positive definite");
    const root = Math.sqrt(diag);
    l.data[j * n + j] = root;
    for (let i = j + 1; i < n; i++) {
      let sum = get(a, i, j);
      for (let k = 0; k < j; k++) sum -= l.data[i * n + k] * l.data[j * n + k];
      l.data[i * n + j] = sum / root;
    }
  }
  return l;
}

/** Solve L y = b for lower-triangular L. */
export function solveLower(l: Matrix, b: ArrayLike<number>): Float64Array {
  const n = l.rows;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= l.data[i * n + k] * y[k];
    y[i] = sum / l.data[i * n + i];
  }
  return y;
}

/** Solve Lᵀ x = y for lower-triangular L. */
export function solveUpperTransposed(l: Matrix, y: ArrayLike<number>): Float64Array {
  const n = l.rows;
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= l.data[k * n + i] * x[k];
    x[i] = sum / l.data[i * n + i];
  }
  return x;
}

/** Solve A x = b given the Cholesky factor of A. */
export function solveWithCholesky(l: Matrix, b: ArrayLike<number>): Float64Array {
  return solveUpperTransposed(l, solveLower(l, b));
}

export function logDeterminantFromCholesky(l: Matrix): number {
  let sum = 0;
  for (let i = 0; i < l.rows; i++) sum += Math.log(l.data[i * l.rows + i]);
  return 2 * sum;
}
