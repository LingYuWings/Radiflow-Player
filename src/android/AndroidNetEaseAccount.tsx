import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { LogIn, LogOut, X } from 'lucide-react';
import { getSettingsCopy, type AppLanguage } from '../lib/copy';
import { netease, type OnlineSession } from './netease';

type QrCode = { key: string; qrImage: string };
type QrStatus = { code: number; isLoggedIn?: boolean; account?: OnlineSession['account'] };
export interface NetEaseAccountHandle { handleBack(): boolean; }

export const AndroidNetEaseAccount = forwardRef<NetEaseAccountHandle, {
  language: AppLanguage;
  native: boolean;
  session: OnlineSession | null;
  onSession: (session: OnlineSession) => void;
}>(function AndroidNetEaseAccount({ language, native, session, onSession }, ref) {
  const copy = getSettingsCopy(language);
  const chinese = language === 'zh-CN';
  const [qr, setQr] = useState<QrCode | null>(null);
  const [status, setStatus] = useState(801);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const active = !!qr;
  const expired = status === 800;

  const showError = (cause: unknown) => setError(cause instanceof Error ? cause.message : chinese ? '网易云请求失败' : 'NetEase request failed');
  useImperativeHandle(ref, () => ({
    handleBack() {
      if (!qr) return false;
      setQr(null);
      return true;
    },
  }), [qr]);

  useEffect(() => {
    const modal = dialog.current;
    if (active && modal && !modal.open) modal.showModal();
    return () => { if (modal?.open) modal.close(); };
  }, [active]);

  useEffect(() => {
    if (!qr || expired) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const result = await netease<QrStatus>('/api/netease/login/qr/check?key=' + encodeURIComponent(qr.key));
        if (cancelled) return;
        setStatus(result.code);
        if (result.code === 803) {
          onSession({ isLoggedIn: !!result.isLoggedIn, account: result.account });
          setQr(null);
          if (!result.isLoggedIn) setError(chinese ? '网易云未能确认账号，请重新登录。' : 'NetEase could not confirm the account. Sign in again.');
        } else if (result.code !== 800) timer = window.setTimeout(poll, 1700);
      } catch (cause) {
        if (!cancelled) { showError(cause); setStatus(800); }
      }
    };
    timer = window.setTimeout(poll, 1500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [qr, chinese, onSession, expired]);

  const startLogin = async () => {
    setBusy(true);
    setError('');
    try {
      const code = await netease<QrCode>('/api/netease/login/qr/start', 'POST');
      setStatus(801);
      setQr(code);
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    setBusy(true);
    setError('');
    try { onSession(await netease<OnlineSession>('/api/netease/logout', 'POST')); }
    catch (cause) { showError(cause); }
    finally { setBusy(false); }
  };

  return <section className="rf-mobile-settings-card rf-mobile-net-account rf-glass">
    <h2>{copy.netease}</h2>
    <div className="rf-mobile-setting-row">
      <span>{session?.isLoggedIn ? session.account?.nickname : chinese ? '未登录' : 'Signed out'}</span>
      {session?.isLoggedIn
        ? <button type="button" disabled={busy} onClick={() => void logout()}><LogOut size={17} />{copy.neteaseLogout}</button>
        : <button type="button" disabled={!native || busy} onClick={() => void startLogin()}><LogIn size={17} />{copy.neteaseStartQrLogin}</button>}
    </div>
    {!active && error && <p className="rf-mobile-inline-error" role="alert">{error}</p>}
    <dialog ref={dialog} className="rf-mobile-dialog rf-glass" onCancel={event => { event.preventDefault(); setQr(null); }}>
      <header><h2>{copy.neteaseStartQrLogin}</h2>
        <button type="button" className="rf-mobile-icon-button" aria-label={chinese ? '关闭' : 'Close'} onClick={() => setQr(null)}><X size={20} /></button>
      </header>
      {qr && <div className="rf-mobile-qr">
        {qr.qrImage && <img src={qr.qrImage} alt={copy.neteaseQrHint} />}
        <p>{status === 800 ? (chinese ? '二维码已过期' : 'QR code expired')
          : status === 802 ? (chinese ? '请在网易云音乐中确认登录' : 'Confirm sign-in in NetEase Music') : copy.neteaseQrHint}</p>
        {status === 800 && <button type="button" className="rf-primary-button" disabled={busy} onClick={() => void startLogin()}>
          {chinese ? '获取新二维码' : 'Get a new code'}
        </button>}
        {error && <p className="rf-mobile-inline-error" role="alert">{error}</p>}
      </div>}
    </dialog>
  </section>;
});
