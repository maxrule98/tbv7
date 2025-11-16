export interface Ar4ForecastResult {
  forecast: number;
  coefficients: number[];
}

const ORDER = 4;

export function computeAr4Forecast(series: number[]): Ar4ForecastResult | null {
  if (series.length <= ORDER) {
    return null;
  }

  const rows: number[][] = [];
  const targets: number[] = [];

  for (let i = ORDER; i < series.length; i += 1) {
    const row: number[] = [1];
    for (let lag = 1; lag <= ORDER; lag += 1) {
      row.push(series[i - lag]);
    }
    rows.push(row);
    targets.push(series[i]);
  }

  const xtx = createMatrix(rows[0].length);
  const xty = new Array(rows[0].length).fill(0);

  rows.forEach((row, rowIdx) => {
    for (let i = 0; i < row.length; i += 1) {
      xty[i] += row[i] * targets[rowIdx];
      for (let j = 0; j < row.length; j += 1) {
        xtx[i][j] += row[i] * row[j];
      }
    }
  });

  const coefficients = solveLinearSystem(xtx, xty);
  if (!coefficients) {
    return null;
  }

  const latestRow: number[] = [1];
  for (let lag = 1; lag <= ORDER; lag += 1) {
    latestRow.push(series[series.length - lag]);
  }

  const forecast = dotProduct(coefficients, latestRow);
  return { forecast, coefficients };
}

function createMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => new Array(size).fill(0));
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const augmented = matrix.map((row, idx) => [...row, vector[idx]]);

  for (let i = 0; i < n; i += 1) {
    let pivot = augmented[i][i];
    let pivotRow = i;

    for (let row = i + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][i]) > Math.abs(pivot)) {
        pivot = augmented[row][i];
        pivotRow = row;
      }
    }

    if (Math.abs(pivot) < 1e-8) {
      return null;
    }

    if (pivotRow !== i) {
      [augmented[i], augmented[pivotRow]] = [augmented[pivotRow], augmented[i]];
    }

    const pivotVal = augmented[i][i];
    for (let col = i; col <= n; col += 1) {
      augmented[i][col] /= pivotVal;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === i) continue;
      const factor = augmented[row][i];
      for (let col = i; col <= n; col += 1) {
        augmented[row][col] -= factor * augmented[i][col];
      }
    }
  }

  return augmented.map((row) => row[n]);
}

function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, value, idx) => sum + value * b[idx], 0);
}
