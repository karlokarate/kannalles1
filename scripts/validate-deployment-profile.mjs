#!/usr/bin/env node
import process from 'node:process';
import { validateDeploymentProfile } from './deployment-profile.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const result = validateDeploymentProfile(
  argument('--profile') ?? process.env.RELEASE_DEPLOYMENT_PROFILE,
  argument('--gateway') ?? process.env.DATA_GATEWAY_URL ?? process.env.VITE_DATA_GATEWAY_URL ?? ''
);
console.log(JSON.stringify({ deploymentProfile: result.profile, gatewayUrl: result.gatewayUrl || null }));
