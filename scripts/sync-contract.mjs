// Copies the API contract from a sibling keel-backend checkout and records its
// version in package.json, so that test/contract.test.ts can tell when the copy
// here has drifted from the version this server was written against.
//
// Usage: npm run sync:contract [-- /path/to/keel-backend]
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const backend = resolve(process.argv[2] ?? '../keel-backend');
const source = resolve(backend, 'docs/api/keel-openapi.yaml');
const target = new URL('../openapi/keel-openapi.yaml', import.meta.url);

copyFileSync(source, target);

const yaml = readFileSync(target, 'utf8');
const version = yaml.match(/^ {2}version:\s*['"]?([^'"\s]+)/m)?.[1];
if (!version) throw new Error(`no info.version found in ${source}`);

const pkgUrl = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'));
const previous = pkg.keel.contractVersion;
pkg.keel.contractVersion = version;
writeFileSync(pkgUrl, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`contract ${previous} -> ${version} copied from ${source}`);
if (previous !== version) {
  console.log('Review the tools against the contract changes before releasing.');
}
