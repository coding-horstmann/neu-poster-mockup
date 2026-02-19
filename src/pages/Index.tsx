import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Zap, Download, RotateCcw, Layers } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import DropZone from '@/components/DropZone';
import ProcessingStatus from '@/components/ProcessingStatus';
import { processAllCombinations, type ProcessingProgress } from '@/lib/psd-processor';
import { Button } from '@/components/ui/button';

type AppState = 'idle' | 'processing' | 'done' | 'error';

const Index = () => {
  const [psdFiles, setPsdFiles] = useState<File[]>([]);
  const [posterFiles, setPosterFiles] = useState<File[]>([]);
  const [state, setState] = useState<AppState>('idle');
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [results, setResults] = useState<Map<string, Blob>>(new Map());
  const [errorMsg, setErrorMsg] = useState('');

  const canStart = psdFiles.length > 0 && posterFiles.length > 0 && state === 'idle';
  const totalImages = psdFiles.length * posterFiles.length;

  const handleStart = useCallback(async () => {
    setState('processing');
    setErrorMsg('');
    try {
      const resultMap = await processAllCombinations(psdFiles, posterFiles, setProgress);
      if (resultMap.size === 0) {
        setErrorMsg('Keine Bilder konnten generiert werden. Prüfe ob deine PSD-Dateien eine Ebene namens "DESIGN_HERE" enthalten.');
        setState('error');
      } else {
        setResults(resultMap);
        setState('done');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Unbekannter Fehler');
      setState('error');
    }
  }, [psdFiles, posterFiles]);

  const handleDownload = useCallback(async () => {
    const zip = new JSZip();
    results.forEach((blob, name) => {
      zip.file(name, blob);
    });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(zipBlob, 'mockups.zip');
  }, [results]);

  const handleReset = () => {
    setState('idle');
    setProgress(null);
    setResults(new Map());
    setErrorMsg('');
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-5">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
            <Layers className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">Mockup Generator</h1>
            <p className="text-xs text-muted-foreground font-mono">PSD × Poster → JPEG</p>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Upload zones */}
          <div className="grid gap-6 md:grid-cols-2">
            <DropZone
              label="Mockups (PSD)"
              sublabel="PSD-Dateien hierher ziehen"
              accept=".psd"
              maxFiles={50}
              files={psdFiles}
              onFilesChange={setPsdFiles}
              icon="psd"
            />
            <DropZone
              label="Poster (Bilder)"
              sublabel="JPEG / PNG hierher ziehen"
              accept=".jpg,.jpeg,.png,.webp"
              maxFiles={50}
              files={posterFiles}
              onFilesChange={setPosterFiles}
              icon="image"
            />
          </div>

          {/* Info bar */}
          {canStart && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-5 py-3"
            >
              <p className="font-mono text-sm text-muted-foreground">
                <span className="text-foreground font-semibold">{totalImages}</span> Bilder werden generiert
                <span className="text-muted-foreground ml-1">({psdFiles.length} × {posterFiles.length})</span>
              </p>
            </motion.div>
          )}

          {/* Processing status */}
          <ProcessingStatus
            progress={progress}
            isProcessing={state === 'processing'}
            isDone={state === 'done'}
          />

          {/* Error */}
          {state === 'error' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-5 py-3">
              <p className="font-mono text-sm text-destructive">{errorMsg}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            {state === 'idle' && (
              <Button
                onClick={handleStart}
                disabled={!canStart}
                size="lg"
                className="gap-2 font-semibold"
              >
                <Zap className="h-4 w-4" />
                Generierung starten
              </Button>
            )}

            {state === 'processing' && (
              <Button disabled size="lg" className="gap-2 animate-pulse-glow">
                <Zap className="h-4 w-4 animate-spin" />
                Verarbeite...
              </Button>
            )}

            {state === 'done' && (
              <>
                <Button onClick={handleDownload} size="lg" className="gap-2 font-semibold">
                  <Download className="h-4 w-4" />
                  ZIP herunterladen ({results.size} Bilder)
                </Button>
                <Button onClick={handleReset} variant="secondary" size="lg" className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Neu starten
                </Button>
              </>
            )}

            {state === 'error' && (
              <Button onClick={handleReset} variant="secondary" size="lg" className="gap-2">
                <RotateCcw className="h-4 w-4" />
                Erneut versuchen
              </Button>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-4">
        <p className="mx-auto max-w-4xl font-mono text-xs text-muted-foreground">
          Clientseitige Verarbeitung · Keine Daten verlassen deinen Browser
        </p>
      </footer>
    </div>
  );
};

export default Index;
