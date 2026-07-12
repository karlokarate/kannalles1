#!/usr/bin/env node
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`Node.js ${process.versions.node} ist zu alt. Benötigt wird >=22.18.0; Node 24 LTS wird empfohlen.`);
  process.exit(1);
}
