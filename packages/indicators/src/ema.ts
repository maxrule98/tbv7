export function emaSeries(values: number[], period: number): number[] {
  if (period <= 0) {
    throw new Error('EMA period must be positive');
  }

  const multiplier = 2 / (period + 1);
  let prev: number | null = null;

  return values.map((value) => {
    if (prev === null) {
      prev = value;
      return value;
    }

    prev = (value - prev) * multiplier + prev;
    return prev;
  });
}
