import { BrowserWindow, session } from 'electron'

/** In-memory session of the PDF window: nothing but the document itself (data: URL) is ever loaded. */
const PARTITION = 'pdf-export'
let sessionReady = false

function pdfSession(): Electron.Session {
  const s = session.fromPartition(PARTITION)
  if (!sessionReady) {
    s.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }))
    s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    sessionReady = true
  }
  return s
}

/**
 * A self-contained HTML document printed to an A4 PDF by a hidden, sandboxed window with JavaScript disabled and
 * every request other than the document blocked; the window is destroyed afterwards.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { session: pdfSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, spellcheck: false }
  })
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
    })
  } finally {
    win.destroy()
  }
}
