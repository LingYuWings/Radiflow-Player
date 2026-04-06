import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { FolderOpen, FolderPlus, Globe2, ImagePlus, Info, Library, Monitor, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { AppLanguage, SettingsCopy } from '../lib/copy';

interface SettingsViewProps {
  copy: SettingsCopy;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  currentFolder: string | null;
  isElectron: boolean;
  onSelectFolder: () => void;
  onOpenFolder: () => void;
  onRefreshLibrary: () => void;
  isRefreshingLibrary: boolean;
  effect: 'blur' | 'streamer';
  backgroundSource: 'default' | 'custom';
  hasCustomBackground: boolean;
  customBackgroundBlur: number;
  onEffectChange: (effect: 'blur' | 'streamer') => void;
  onBackgroundSourceChange: (source: 'default' | 'custom') => void;
  onSelectCustomBackground: (file: File | null) => void;
  onRemoveCustomBackground: () => void;
  onCustomBackgroundBlurChange: (blur: number) => void;
  libraryCount: number;
  appName: string;
  appVersion: string;
}

const SettingsCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <section className="rounded-3xl border border-white/10 bg-black/20 backdrop-blur-2xl customizable-backdrop-medium p-6 md:p-8 shadow-2xl">
    <div className="flex items-center gap-3 mb-6 text-white">
      <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-white/70">
        {icon}
      </div>
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
    </div>
    {children}
  </section>
);

export const SettingsView: React.FC<SettingsViewProps> = ({
  copy,
  language,
  onLanguageChange,
  currentFolder,
  isElectron,
  onSelectFolder,
  onOpenFolder,
  onRefreshLibrary,
  isRefreshingLibrary,
  effect,
  backgroundSource,
  hasCustomBackground,
  customBackgroundBlur,
  onEffectChange,
  onBackgroundSourceChange,
  onSelectCustomBackground,
  onRemoveCustomBackground,
  onCustomBackgroundBlurChange,
  libraryCount,
  appName,
  appVersion,
}) => {
  const backgroundFileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="h-full w-full max-w-6xl mx-auto flex flex-col p-8 md:p-12 overflow-y-auto scrollbar-hide">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10"
      >
        <h1 className="text-5xl font-black tracking-tighter text-white uppercase">{copy.title}</h1>
        <p className="text-white/40 font-mono text-xs tracking-widest uppercase mt-2">{copy.subtitle}</p>
      </motion.div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
        <div className="space-y-6">
          <SettingsCard title={copy.general} icon={<Globe2 size={18} />}>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-white">{copy.language}</p>
                <p className="text-sm text-white/45 mt-1">{copy.languageDescription}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => onLanguageChange('zh-CN')}
                  className={cn(
                    'rounded-2xl px-4 py-3 text-sm font-semibold transition-all border',
                    language === 'zh-CN'
                      ? 'bg-white text-black border-white shadow-lg'
                      : 'bg-white/5 text-white/65 border-white/10 hover:bg-white/10 hover:text-white'
                  )}
                >
                  {copy.chinese}
                </button>
                <button
                  type="button"
                  onClick={() => onLanguageChange('en-US')}
                  className={cn(
                    'rounded-2xl px-4 py-3 text-sm font-semibold transition-all border',
                    language === 'en-US'
                      ? 'bg-white text-black border-white shadow-lg'
                      : 'bg-white/5 text-white/65 border-white/10 hover:bg-white/10 hover:text-white'
                  )}
                >
                  {copy.english}
                </button>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard title={copy.library} icon={<Library size={18} />}>
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-white">{copy.currentFolder}</p>
                <p className="text-sm text-white/45 mt-1">{copy.currentFolderDescription}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/75 break-all min-h-16 flex items-center">
                {currentFolder || copy.folderUnavailable}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onRefreshLibrary}
                  className="rounded-2xl px-4 py-3 bg-white text-black text-sm font-semibold hover:scale-[1.02] transition-transform flex items-center gap-2"
                >
                  <RefreshCw size={16} className={cn(isRefreshingLibrary && 'animate-spin')} />
                  {copy.refreshLibrary}
                </button>

                {isElectron && (
                  <>
                    <button
                      type="button"
                      onClick={onSelectFolder}
                      className="rounded-2xl px-4 py-3 bg-white/5 border border-white/10 text-white/75 text-sm font-semibold hover:bg-white/10 hover:text-white transition-all flex items-center gap-2"
                    >
                      <FolderPlus size={16} />
                      {copy.selectFolder}
                    </button>
                    <button
                      type="button"
                      onClick={onOpenFolder}
                      className="rounded-2xl px-4 py-3 bg-white/5 border border-white/10 text-white/75 text-sm font-semibold hover:bg-white/10 hover:text-white transition-all flex items-center gap-2"
                    >
                      <FolderOpen size={16} />
                      {copy.openFolder}
                    </button>
                  </>
                )}
              </div>

              <p className="text-sm text-white/40">{copy.refreshDescription}</p>
            </div>
          </SettingsCard>
        </div>

        <div className="space-y-6">
          <SettingsCard title={copy.appearance} icon={<Sparkles size={18} />}>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-white">{copy.backgroundSource}</p>
                <p className="text-sm text-white/45 mt-1">{copy.customBackgroundDescription}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => onBackgroundSourceChange('default')}
                  className={cn(
                    'rounded-2xl px-4 py-3 text-sm font-semibold transition-all border',
                    backgroundSource === 'default'
                      ? 'bg-white text-black border-white shadow-lg'
                      : 'bg-white/5 text-white/65 border-white/10 hover:bg-white/10 hover:text-white'
                  )}
                >
                  {copy.useBuiltInBackground}
                </button>
                <button
                  type="button"
                  onClick={() => hasCustomBackground && onBackgroundSourceChange('custom')}
                  disabled={!hasCustomBackground}
                  className={cn(
                    'rounded-2xl px-4 py-3 text-sm font-semibold transition-all border disabled:opacity-40 disabled:hover:bg-white/5 disabled:hover:text-white/65',
                    backgroundSource === 'custom'
                      ? 'bg-white text-black border-white shadow-lg'
                      : 'bg-white/5 text-white/65 border-white/10 hover:bg-white/10 hover:text-white'
                  )}
                >
                  {copy.useCustomBackground}
                </button>
              </div>

              <input
                ref={backgroundFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  onSelectCustomBackground(event.target.files?.[0] ?? null);
                  event.currentTarget.value = '';
                }}
              />

              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/75">
                {hasCustomBackground ? copy.customBackgroundReady : copy.customBackgroundNotSelected}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => backgroundFileInputRef.current?.click()}
                  className="rounded-2xl px-4 py-3 bg-white text-black text-sm font-semibold hover:scale-[1.02] transition-transform flex items-center gap-2"
                >
                  <ImagePlus size={16} />
                  {hasCustomBackground ? copy.replaceCustomBackground : copy.uploadCustomBackground}
                </button>

                {hasCustomBackground && (
                  <button
                    type="button"
                    onClick={onRemoveCustomBackground}
                    className="rounded-2xl px-4 py-3 bg-white/5 border border-white/10 text-white/75 text-sm font-semibold hover:bg-white/10 hover:text-white transition-all flex items-center gap-2"
                  >
                    <Trash2 size={16} />
                    {copy.removeCustomBackground}
                  </button>
                )}
              </div>

              {hasCustomBackground && backgroundSource === 'custom' && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-semibold text-white">{copy.customBackgroundBlur}</p>
                    <span className="text-xs font-mono uppercase tracking-[0.18em] text-white/45">{customBackgroundBlur}px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="120"
                    step="1"
                    value={customBackgroundBlur}
                    onChange={(event) => onCustomBackgroundBlurChange(Number.parseInt(event.target.value, 10))}
                    className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer accent-white"
                  />
                </div>
              )}

              {backgroundSource === 'default' && (
                <>
                  <div>
                <p className="text-sm font-semibold text-white">{copy.backgroundEffect}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => onEffectChange('blur')}
                      className={cn(
                        'rounded-2xl px-4 py-3 text-sm font-semibold transition-all border',
                        effect === 'blur'
                          ? 'bg-white text-black border-white shadow-lg'
                          : 'bg-white/5 text-white/65 border-white/10 hover:bg-white/10 hover:text-white'
                      )}
                    >
                      {copy.blurMode}
                    </button>
                    <button
                      type="button"
                      onClick={() => onEffectChange('streamer')}
                      className={cn(
                        'rounded-2xl px-4 py-3 text-sm font-semibold transition-all border',
                        effect === 'streamer'
                          ? 'bg-white text-black border-white shadow-lg'
                          : 'bg-white/5 text-white/65 border-white/10 hover:bg-white/10 hover:text-white'
                      )}
                    >
                      {copy.streamerMode}
                    </button>
                  </div>
                </>
              )}
            </div>
          </SettingsCard>

          <SettingsCard title={copy.about} icon={<Info size={18} />}>
            <div className="space-y-4 text-sm text-white/75">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-white font-semibold">{appName}</p>
                <p className="text-white/50 mt-1">{copy.version}: {appVersion}</p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 flex items-center justify-between gap-3">
                  <span className="text-white/55">{copy.runtime}</span>
                  <span className="text-white font-semibold inline-flex items-center gap-2">
                    <Monitor size={15} />
                    {isElectron ? 'Electron' : 'Web'}
                  </span>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 flex items-center justify-between gap-3">
                  <span className="text-white/55">{copy.libraryStats}</span>
                  <span className="text-white font-semibold">{copy.tracksCount(libraryCount)}</span>
                </div>
              </div>
            </div>
          </SettingsCard>
        </div>
      </div>
    </div>
  );
};