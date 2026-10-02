#!/usr/bin/env node
/** Renders resources/icon.png (512x512) with Chromium canvas: dark tile, amber candles. */
import { writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage()
const b64 = await page.evaluate(() => {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const x = c.getContext('2d')
  x.fillStyle = '#0b0d10'
  x.beginPath()
  x.roundRect(16, 16, 480, 480, 72)
  x.fill()
  x.strokeStyle = '#2b323b'
  x.lineWidth = 6
  x.stroke()
  // grid
  x.strokeStyle = '#1e232a'
  x.lineWidth = 3
  for (const y of [150, 256, 362]) {
    x.beginPath()
    x.moveTo(70, y)
    x.lineTo(442, y)
    x.stroke()
  }
  const candle = (cx, o, cl, h, l, color) => {
    x.strokeStyle = color
    x.fillStyle = color
    x.lineWidth = 10
    x.beginPath()
    x.moveTo(cx, h)
    x.lineTo(cx, l)
    x.stroke()
    x.fillRect(cx - 30, Math.min(o, cl), 60, Math.abs(cl - o))
  }
  candle(146, 330, 380, 300, 420, '#4f5862')
  candle(256, 360, 220, 190, 390, '#e8a33d')
  candle(366, 210, 120, 92, 240, '#e8a33d')
  return c.toDataURL('image/png').split(',')[1]
})
writeFileSync(new URL('../resources/icon.png', import.meta.url), Buffer.from(b64, 'base64'))
await browser.close()
console.log('resources/icon.png')
