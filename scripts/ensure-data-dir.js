#!/usr/bin/env node

import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure data directory exists
const dataDir = './data';

if (!existsSync(dataDir)) {
  console.log('Creating data directory...');
  mkdirSync(dataDir, { recursive: true });
  console.log('Data directory created successfully');
} else {
  console.log('Data directory already exists');
}
