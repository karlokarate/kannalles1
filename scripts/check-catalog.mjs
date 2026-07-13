#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { runPython } from './run-python.mjs';

const root = path.resolve(import.meta.dirname, '..');
const result = runPython(['scripts/validate-catalog-artifacts.py'], { cwd: root });
process.exit(result.status ?? 1);
