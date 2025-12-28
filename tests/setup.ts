import { existsSync, mkdirSync } from 'node:fs';

// Ensure data directory exists before any tests run
// This is needed because some modules create singletons on import
// that require the data directory to exist
if (!existsSync('./data')) {
  mkdirSync('./data', { recursive: true });
}
