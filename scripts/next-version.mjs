#!/usr/bin/env node
// CI update test: sets package.json to the next patch version (like a future release) and prints it.
// The workflow restores package.json with git afterwards.
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(file, 'utf8'))
const [major, minor, patch] = pkg.version.split(/[-+]/)[0].split('.').map(Number)
pkg.version = `${major}.${minor}.${patch + 1}`
writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
process.stdout.write(pkg.version)
