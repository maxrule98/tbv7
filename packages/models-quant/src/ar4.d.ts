type Matrix = number[][];
export declare function ar4Forecast(values: number[]): number;
export declare const transpose: (matrix: Matrix) => Matrix;
export declare const multiply: (a: Matrix, b: Matrix) => Matrix;
export declare const multiplyVector: (matrix: Matrix, vector: number[]) => number[];
export declare const solveLinearSystem: (matrix: Matrix, vector: number[]) => number[] | null;
export {};
