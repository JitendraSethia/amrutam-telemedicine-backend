/* eslint-disable no-console */
import { writeFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';

/**
 * Dumps the OpenAPI document generated from the live route schemas to
 * `openapi.json`, keeping the committed spec in lock-step with the code
 * (run in CI to fail on drift).
 */
async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();
  const spec = app.swagger();
  writeFileSync('openapi.json', JSON.stringify(spec, null, 2));
  console.log('Wrote openapi.json');
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
