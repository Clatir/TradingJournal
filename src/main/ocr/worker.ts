/**
 * OCR worker thread: Tesseract (WebAssembly, offline) with the English LSTM model. The page is read as sparse text
 * (PSM 11: labels and values scattered over a panel) and returned as TSV word boxes.
 */
import { parentPort } from 'node:worker_threads'
import { gunzipSync } from 'node:zlib'
import createCore from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js'

export type OcrRequest = { kind: 'init'; model: Uint8Array } | { kind: 'read'; id: number; image: Uint8Array }
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
      api.SetVariable('tessedit_pageseg_mode', '11')
      api.Recognize(null)
      const tsv = api.GetTSVText(0)
      core.FS.unlink('/input')
      parentPort!.postMessage({ id: msg.id, tsv } satisfies OcrReply)
    } catch (e) {
      parentPort!.postMessage({ id: msg.id, error: e instanceof Error ? e.message : String(e) } satisfies OcrReply)
    }
  })()
})
