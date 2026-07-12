#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import { getGatewayOpenApiDocument } from '../contracts/source/search-api.contract.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'contracts', 'generated');
const jsonPath = path.join(outDir, 'search-api.openapi.json');
const yamlPath = path.join(outDir, 'search-api.openapi.yaml');
const checkOnly = process.argv.includes('--check');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

const document = stable(getGatewayOpenApiDocument());
const json = `${JSON.stringify(document, null, 2)}\n`;
const yaml = YAML.stringify(document, { lineWidth: 0, sortMapEntries: true });

if (checkOnly) {
  const [currentJson, currentYaml] = await Promise.all([
    readFile(jsonPath, 'utf8'),
    readFile(yamlPath, 'utf8')
  ]).catch((error) => {
    throw new Error(`OpenAPI-Ausgabe fehlt. Zuerst npm run api:generate ausführen: ${error.message}`);
  });
  if (currentJson !== json || currentYaml !== yaml) {
    throw new Error('OpenAPI-Drift erkannt: contracts/generated stimmt nicht mit contracts/source/search-api.contract.mjs überein.');
  }
  console.log(JSON.stringify({ openapiCurrent: true, json: path.relative(root, jsonPath), yaml: path.relative(root, yamlPath) }));
} else {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(jsonPath, json),
    writeFile(yamlPath, yaml)
  ]);
  console.log(JSON.stringify({ openapi: document.openapi, version: document.info?.version, paths: Object.keys(document.paths ?? {}).length }));
}
