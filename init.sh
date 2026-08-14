#!/bin/sh
set -eu

cd "$(dirname "$0")"
npm ci
npm run check

printf '%s\n' 'Ready. Start with: node src/cli.js'
