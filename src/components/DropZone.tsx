import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, FileImage, File } from 'lucide-react';

interface DropZoneProps {
  label: string;
  sublabel: string;
  accept: string;
  maxFiles: number;
  files: File[];
  onFilesChange: (files: File[]) => void;
  icon: 'psd' | 'image';
}

export default function DropZone({ label, sublabel, accept, maxFiles, files, onFilesChange, icon }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files).slice(0, maxFiles);
    onFilesChange([...files, ...droppedFiles].slice(0, maxFiles));
  }, [files, maxFiles, onFilesChange]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files).slice(0, maxFiles);
      onFilesChange([...files, ...selected].slice(0, maxFiles));
    }
  }, [files, maxFiles, onFilesChange]);

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const IconComponent = icon === 'psd' ? File : FileImage;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{label}</h3>
        <span className="font-mono text-xs text-muted-foreground">{files.length}/{maxFiles}</span>
      </div>

      <label
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`
          relative flex cursor-pointer flex-col items-center justify-center
          rounded-lg border-2 border-dashed p-8 transition-all duration-200
          ${isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-dropzone-border bg-dropzone hover:border-muted-foreground/30'
          }
        `}
      >
        <input
          type="file"
          accept={accept}
          multiple
          onChange={handleFileInput}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
        <motion.div
          animate={isDragOver ? { scale: 1.1, y: -4 } : { scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300 }}
        >
          <Upload className={`mb-3 h-8 w-8 ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
        </motion.div>
        <p className="text-sm font-medium text-foreground">{sublabel}</p>
        <p className="mt-1 text-xs text-muted-foreground">oder klicke zum Auswählen</p>
      </label>

      {files.length > 0 && (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-secondary/50 p-2">
          <AnimatePresence>
            {files.map((file, i) => (
              <motion.div
                key={`${file.name}-${i}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-secondary"
              >
                <IconComponent className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="flex-1 truncate font-mono text-secondary-foreground">{file.name}</span>
                <span className="shrink-0 text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)}MB</span>
                <button
                  onClick={(e) => { e.preventDefault(); removeFile(i); }}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
