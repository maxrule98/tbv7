type Matrix = number[][];

export function ar4Forecast(values: number[]): number {
  if (values.length < 6) {
    return 0;
  }

  const rows: Matrix = [];
  const targets: number[] = [];

  for (let i = 4; i < values.length; i += 1) {
    rows.push([1, values[i - 1], values[i - 2], values[i - 3], values[i - 4]]);
    targets.push(values[i]);
  }

  const xt = transpose(rows);
  const xtx = multiply(xt, rows);
  const xty = multiplyVector(xt, targets);
  const coeffs = solveLinearSystem(xtx, xty);

  if (!coeffs) {
    return values[values.length - 1];
  }

  const last = values.length - 1;
  return (
    coeffs[0] +
    coeffs[1] * values[last] +
    coeffs[2] * values[last - 1] +
    coeffs[3] * values[last - 2] +
    coeffs[4] * values[last - 3]
  );
}

export const transpose = (matrix: Matrix): Matrix => {
  const rows = matrix.length;
  const cols = rows === 0 ? 0 : matrix[0].length;
  const result: Matrix = Array.from({ length: cols }, () => Array(rows).fill(0));

  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      result[j][i] = matrix[i][j];
    }
  }

  return result;
};

export const multiply = (a: Matrix, b: Matrix): Matrix => {
  if (a.length === 0 || b.length === 0) {
    return [];
  }

  const aCols = a[0].length;
  const bRows = b.length;

  if (aCols !== bRows) {
    throw new Error('Matrix dimensions mismatch');
  }

  const bCols = b[0].length;
  const result: Matrix = Array.from({ length: a.length }, () => Array(bCols).fill(0));

  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < bCols; j += 1) {
      let sum = 0;
      for (let k = 0; k < aCols; k += 1) {
        sum += a[i][k] * b[k][j];
      }
      result[i][j] = sum;
    }
  }

  return result;
};

export const multiplyVector = (matrix: Matrix, vector: number[]): number[] => {
  if (matrix.length === 0) {
    return [];
  }

  if (matrix[0].length !== vector.length) {
    throw new Error('Matrix/vector dimension mismatch');
  }

  return matrix.map((row) => row.reduce((acc, value, idx) => acc + value * vector[idx], 0));
};

export const solveLinearSystem = (matrix: Matrix, vector: number[]): number[] | null => {
  const n = matrix.length;
  const augmented: Matrix = matrix.map((row, i) => [...row, vector[i]]);

  for (let i = 0; i < n; i += 1) {
    let maxRow = i;
    for (let k = i + 1; k < n; k += 1) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }

    if (Math.abs(augmented[maxRow][i]) < 1e-8) {
      return null;
    }

    if (maxRow !== i) {
      [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
    }

    for (let k = i + 1; k < n; k += 1) {
      const factor = augmented[k][i] / augmented[i][i];
      for (let j = i; j <= n; j += 1) {
        augmented[k][j] -= factor * augmented[i][j];
      }
    }
  }

  const solution = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = augmented[i][n];
    for (let j = i + 1; j < n; j += 1) {
      sum -= augmented[i][j] * solution[j];
    }
    solution[i] = sum / augmented[i][i];
  }

  return solution;
};
