import React, { useEffect, useRef } from 'react';
import type { PlaybackError } from '../lib/audioPlayback';
import type { AppLanguage } from '../lib/copy';

export function PlaybackErrorDialog({ track, error, language, onDismiss }: {
  track: string;
  error: PlaybackError;
  language: AppLanguage;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const zh = language === 'zh-CN';
  const reasons: Record<string, string> = {
    NETEASE_TRACK_UNAVAILABLE: zh
      ? '网易云未提供可播放的完整音频。歌曲可能无版权、已下架，或当前账号无权播放。'
      : 'NetEase did not provide a full stream. The track may be unlicensed, removed, or unavailable to this account.',
    NETEASE_PREVIEW_ONLY: zh ? '网易云只提供试听片段，当前账号无法播放完整版。' : 'NetEase only offers a preview to this account.',
    NETEASE_RISK_CONTROL: zh
      ? `网易云暂时限制了播放请求。${error.retryAfter ? `请至少等待 ${error.retryAfter} 秒后重试。` : '请稍后重试。'}`
      : `NetEase temporarily limited playback requests. ${error.retryAfter ? `Wait at least ${error.retryAfter} seconds before trying again.` : 'Try again later.'}`,
    NETEASE_SESSION_CHANGED: zh ? '检查期间网易云登录会话已变化，请重试。' : 'The NetEase session changed during the check. Try again.',
    NETEASE_LOOKUP_FAILED: zh ? '网易云取址请求失败，请稍后重试。' : 'The NetEase stream lookup failed. Try again later.',
    NETEASE_SDK_INIT_FAILED: zh ? '网易云播放协议初始化失败，请检查网络后重试。' : 'NetEase playback encryption could not be initialized. Check your connection and try again.',
    NETEASE_CHECK_TIMEOUT: zh ? '检查网易云歌曲是否可播放时超时。' : 'The NetEase playback check timed out.',
    NETEASE_CHECK_NETWORK: zh ? '无法连接播放器的本地服务。' : 'The player could not reach its local service.',
    MEDIA_SOURCE_MISSING: zh ? '这首歌缺少音频文件或地址。' : 'This track has no audio file or URL.',
    MEDIA_ERR_2: zh ? '读取音频时网络或文件连接中断。' : 'The connection was interrupted while reading the audio.',
    MEDIA_ERR_3: zh ? '音频数据无法解码，文件可能已损坏。' : 'The audio could not be decoded. The file may be damaged.',
    MEDIA_ERR_4: zh ? '音频地址不可用，或播放器不支持此格式。' : 'The audio source is unavailable or uses an unsupported format.',
  };
  const reason = Object.hasOwn(reasons, error.code)
    ? reasons[error.code]
    : zh ? '播放器无法加载或解码音频。' : 'The player could not load or decode the audio.';

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby="playback-error-title"
      aria-describedby="playback-error-reason"
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-3xl border border-white/10 bg-[#171717] p-6 text-white shadow-2xl backdrop:bg-black/65"
    >
      <h2 id="playback-error-title" className="text-xl font-bold">{zh ? '无法播放' : 'Playback failed'}</h2>
      <p className="mt-3 break-words font-medium">{track}</p>
      <p id="playback-error-reason" className="mt-2 text-sm text-white/75">
        {reason}
      </p>
      <p className="mt-3 select-text break-all font-mono text-xs text-white/60">
        {error.code}{error.httpStatus ? ` · HTTP ${error.httpStatus}` : ''}
      </p>
      <div className="mt-5 flex justify-end">
        <button type="button" autoFocus onClick={onDismiss} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          {zh ? '关闭' : 'Close'}
        </button>
      </div>
    </dialog>
  );
}
