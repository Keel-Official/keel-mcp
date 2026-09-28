import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.ts') && !path.endsWith('schema.d.ts') ? [path] : [];
  });
}

describe('static guarantees', () => {
  it('src issues no request other than GET', () => {
    const offenders = sources(join(root, 'src')).filter((file) =>
      /\.(POST|PUT|PATCH|DELETE)\(|method:\s*['"](POST|PUT|PATCH|DELETE)/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('src never parses a monetary value as a float', () => {
    const offenders = sources(join(root, 'src')).filter((file) =>
      /parseFloat\(|Number\((?:risk|data|point|item|row)\./.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('the copied contract is the version package.json records', () => {
    const yaml = readFileSync(join(root, 'openapi/keel-openapi.yaml'), 'utf8');
    const version = yaml.match(/^ {2}version:\s*['"]?([^'"\s]+)/m)?.[1];
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(version).toBe(pkg.keel.contractVersion);
  });
});
