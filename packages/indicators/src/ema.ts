export function ema(values: number[], length: number): number | null {
  if (length <= 0 || values.length < length) {
    return null;
  }

  const multiplier = 2 / (length + 1);
  let emaValue = average(values.slice(0, length));

  for (let i = length; i < values.length; i += 1) {
    emaValue = (values[i] - emaValue) * multiplier + emaValue;
  }

  return emaValue;
}

const average = (nums: number[]): number => {
  const sum = nums.reduce((acc, value) => acc + value, 0);
  return sum / nums.length;
};
