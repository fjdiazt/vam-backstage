import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export async function recoverStorage(api) {
  const storage = await api.storage.status()
  if (!storage.available) return storage
  await api.scan.start()
  return api.storage.status()
}

export default function StorageGate({ children }) {
  const [storage, setStorage] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState(null)

  useEffect(() => {
    void window.api.storage
      .status()
      .then(setStorage)
      .catch((error) => setRetryError(error.message))
    return window.api.onStorageChanged(setStorage)
  }, [])

  const retry = useCallback(async () => {
    if (retrying) return
    setRetrying(true)
    setRetryError(null)
    try {
      setStorage(await recoverStorage(window.api))
    } catch (error) {
      setRetryError(error.message)
    } finally {
      setRetrying(false)
    }
  }, [retrying])

  if (storage && (!storage.required || storage.available)) return children

  return (
    <div className="h-full bg-base flex items-center justify-center p-6">
      {storage ? (
        <section className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 text-center shadow-xl">
          <AlertTriangle size={36} className="mx-auto mb-4 text-warning" aria-hidden />
          <h1 className="text-lg font-semibold text-text-primary">VaM storage unavailable</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Restore the Windows share mounted at <span className="font-mono select-text">{storage.path || '/vam'}</span>
            .
          </p>
          <p className="mt-2 text-xs text-error break-words select-text">{retryError || storage.error}</p>
          <Button className="mt-5" onClick={retry} disabled={retrying}>
            {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {retrying ? 'Checking…' : 'Retry'}
          </Button>
        </section>
      ) : (
        <Loader2 size={22} className="animate-spin text-accent-blue" aria-label="Checking VaM storage" />
      )}
    </div>
  )
}
