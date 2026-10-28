/// <reference lib="webworker" />
import { parseFiles, serializeItems, type TransferRequest } from '../core/transfer/transfer-ops'

self.onmessage = (e: MessageEvent<TransferRequest>) => {
  const req = e.data
  try {
    const result = req.op === 'serialize' ? serializeItems(req.items, req.shared) : parseFiles(req.files)
    self.postMessage({ id: req.id, result })
  } catch (err) {
    self.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) })
  }
}
