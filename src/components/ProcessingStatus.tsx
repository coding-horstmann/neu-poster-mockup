import { motion } from 'framer-motion';
import type { ProcessingProgress } from '@/lib/psd-processor';

interface ProcessingStatusProps {
  progress: ProcessingProgress | null;
  isProcessing: boolean;
  isDone: boolean;
}

export default function ProcessingStatus({ progress, isProcessing, isDone }: ProcessingStatusProps) {
  if (!progress && !isDone) return null;

  const percent = progress ? Math.round((progress.current / progress.total) * 100) : 100;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {isDone ? 'Fertig' : 'Verarbeitung'}
        </h3>
        <span className="font-mono text-sm font-bold text-primary">
          {percent}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>

      {isProcessing && progress && (
        <div className="space-y-1">
          <p className="truncate font-mono text-xs text-muted-foreground">
            Mockup: <span className="text-secondary-foreground">{progress.currentMockup}</span>
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            Poster: <span className="text-secondary-foreground">{progress.currentPoster}</span>
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {progress.current} / {progress.total} Bilder
          </p>
        </div>
      )}

      {isDone && (
        <p className="font-mono text-xs text-success">
          ✓ Alle Bilder erfolgreich generiert
        </p>
      )}
    </div>
  );
}
