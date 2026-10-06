/**
 * OCR worker thread: Tesseract (WebAssembly, offline) with the English LSTM model. A page is read as sparse text
 * (PSM 11: labels and values scattered over a panel), a cut-out value as one line with only its characters allowed;
 * the result is TSV word boxes.
 */
import { parentPort } from 'node:worker_threads'
import { gunzipSync } from 'node:zlib'
import createCore from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js'

export interface OcrOptions {
  /** Tesseract page segmentation: 11 = sparse text (default), 7 = one line, 6 = one block. */
  psm?: number
  /** Only these characters (e.g. digits for a price); empty = any. */
  whitelist?: string
}
export type OcrRequest = { kind: 'init'; model: Uint8Array } | { kind: 'read'; id: number; image: Uint8Array; options?: OcrOptions }
export type OcrReply = { id: number; tsv: string } | { id: number; error: string }

type Api = InstanceType<Awaited<ReturnType<typeof createCore>>['TessBaseAPI']>
let ready: Promise<{ core: Awaited<ReturnType<typeof createCore>>; api: Api }> | null = null

parentPort!.on('message', (msg: OcrRequest) => {
  if (msg.kind === 'init') {
    ready = (async () => {
      const core = await createCore()
      core.FS.writeFile('/eng.traineddata', gunzipSync(msg.model))
      const api = new core.TessBaseAPI()
      if (api.Init('/', 'eng', 1) !== 0) throw new Error('Nie udało się uruchomić OCR (model językowy).')
      return { core, api }
    })()
    return
  }
  void (async () => {
    try {
      if (!ready) throw new Error('OCR nie został uruchomiony.')
      const { core, api } = await ready
      core.FS.writeFile('/input', msg.image)
      api.SetImageFile(1, 0)
      api.SetVariable('tessedit_pageseg_mode', String(msg.options?.psm ?? 11))
      api.SetVariable('tessedit_char_whitelist', msg.options?.whitelist ?? '')
      api.Recognize(null)
      const tsv = api.GetTSVText(0)
      core.FS.unlink('/input')
      parentPort!.postMessage({ id: msg.id, tsv } satisfies OcrReply)
    } catch (e) {
      parentPort!.postMessage({ id: msg.id, error: e instanceof Error ? e.message : String(e) } satisfies OcrReply)
    }
  })()
})
