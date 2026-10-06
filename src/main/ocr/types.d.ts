/// <reference types="electron-vite/node" />

// Emscripten build of Tesseract with the wasm embedded (tesseract.js-core); only what the OCR worker uses.
declare module 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js' {
  interface TessBaseAPI {
    Init(dataPath: string, lang: string, oem: number): number
    SetImageFile(exif: number, angle: number): void
    SetVariable(name: string, value: string): boolean
    Recognize(monitor: null): number
    GetTSVText(page: number): string
    End(): void
  }
  interface TesseractCore {
    FS: { writeFile(path: string, data: Uint8Array): void; unlink(path: string): void }
    TessBaseAPI: new () => TessBaseAPI
  }
  const createCore: (options?: Record<string, unknown>) => Promise<TesseractCore>
  export default createCore
}
