import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';

const loaded = new Set<string>();

export function loadEnvFiles(projectRoot: string): void {
  const candidates = filterUnique(
    [process.env.AGENAI_ENV_FILE, '.env', '.env.local', '.env.live'].filter(Boolean) as string[]
  );

  candidates.forEach((candidate) => {
    const fullPath = path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate);
    if (!existsSync(fullPath) || loaded.has(fullPath)) {
      return;
    }
    dotenvConfig({ path: fullPath, override: true });
    loaded.add(fullPath);
  });
}

function filterUnique(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
