#!/usr/bin/env node
// Prints the CHANGELOG.md section of a version (default: package.json version) – the GitHub release
// notes the app shows under "Co nowego". Fails when the section is missing, so a version bump without
// notes is caught by CI before anything is published.
import { readFileSync } from 'node:fs'

const version = process.argv[2] ?? JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const lines = text.split('\n')
const start = lines.findIndex((l) => l.trim() === `## ${version}` || l.startsWith(`## ${version} `))
if (start < 0) {
  console.error(`CHANGELOG.md nie ma sekcji "## ${version}" – dopisz opis zmian tej wersji.`)
  process.exit(1)
}
let end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
if (end < 0) end = lines.length
const notes = lines.slice(start + 1, end).join('\n').trim()
if (!notes) {
  console.error(`Sekcja "## ${version}" w CHANGELOG.md jest pusta.`)
  process.exit(1)
}
process.stdout.write(`${notes}\n`)
