import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Copy, Check, Moon, Sun, LogOut, UserX, Download, Loader2, Globe, PlayCircle, Bell, BellOff, Send } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useThemeStore } from '../store/themeStore';
import { useLanguageStore } from '../store/languageStore';
import { useNotificationsStore } from '../store/notificationsStore';
import { exportWorkspaceData } from '../lib/exportData';
import { functions } from '../lib/firebase';
import OnboardingModal from '../components/OnboardingModal';

const sendTestNotificationCall = httpsCallable<void, { ok: boolean; sentToDevices: number }>(functions, 'sendTestPushNotification');

export default function SettingsView() {
  const { profile, logOut } = useAuthStore();
  const { permission, enabling, error: notifError, enable: enableNotifications, disable: disableNotifications } = useNotificationsStore();
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const { workspace, removeMember } = useWorkspaceStore();
  const { dark, toggle } = useThemeStore();
  const { language, setLanguage, t } = useLanguageStore();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport() {
    if (!workspace) return;
    setExporting(true);
    setExportError(null);
    try {
      await exportWorkspaceData(workspace.id, workspace.name);
    } catch (e) {
      setExportError((e as { message?: string })?.message || 'Не удалось выгрузить данные. Попробуйте ещё раз.');
    } finally {
      setExporting(false);
    }
  }

  const isOwner = !!profile && !!workspace && profile.uid === workspace.ownerUid;

  function copyInvite() {
    if (!workspace) return;
    navigator.clipboard.writeText(workspace.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleRemove(uid: string, name: string) {
    if (!workspace) return;
    if (confirm(`Удалить ${name} из пространства? Он потеряет доступ и сможет вернуться только по новому приглашению.`)) {
      removeMember(workspace.id, uid);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">{t('settings_title')}</h1>

      <div className="rounded-2xl glass p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-500">Профиль</h2>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-rose-400 text-white flex items-center justify-center font-semibold">
            {profile?.displayName?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="font-medium text-sm">{profile?.displayName}</p>
            <p className="text-xs text-neutral-400">{profile?.email}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl glass p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-500">{t('settings_language')}</h2>
        <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-xl p-1 text-sm font-medium">
          <button
            onClick={() => setLanguage('ru')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition ${language === 'ru' ? 'bg-white dark:bg-neutral-700 shadow text-indigo-600 dark:text-indigo-400' : 'text-neutral-500'}`}
          >
            <Globe size={14} /> Русский
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition ${language === 'en' ? 'bg-white dark:bg-neutral-700 shadow text-indigo-600 dark:text-indigo-400' : 'text-neutral-500'}`}
          >
            <Globe size={14} /> English
          </button>
        </div>
        <p className="text-[11px] text-neutral-400">
          {language === 'ru'
            ? 'Пока переведена только навигация и этот экран — остальные разделы переводим постепенно.'
            : 'Only navigation and this screen are translated so far — other sections are being translated gradually.'}
        </p>
      </div>

      <div className="rounded-2xl glass p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-500">Пространство</h2>
        <div className="flex items-center justify-between text-sm">
          <span>{workspace?.name}</span>
        </div>
        <button
          onClick={copyInvite}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {t('settings_invite_code')}: {workspace?.inviteCode}
        </button>
        <div className="space-y-1.5">
          {workspace?.members.map((m) => (
            <div key={m.uid} className="flex items-center justify-between text-xs text-neutral-500">
              <span>{m.displayName}{m.uid === workspace.ownerUid ? ' (владелец)' : ''}</span>
              <div className="flex items-center gap-2">
                <span>{m.email}</span>
                {isOwner && m.uid !== workspace.ownerUid && (
                  <button
                    onClick={() => handleRemove(m.uid, m.displayName)}
                    className="text-neutral-400 hover:text-rose-500"
                    title="Удалить участника"
                  >
                    <UserX size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {!isOwner && (
          <p className="text-[11px] text-neutral-400">
            Удалять участников может только владелец пространства.
          </p>
        )}
      </div>

      <div className="rounded-2xl glass p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-500">Уведомления на этом устройстве</h2>
        {permission === 'unsupported' && (
          <p className="text-xs text-neutral-400">Этот браузер не поддерживает push-уведомления.</p>
        )}
        {permission === 'denied' && (
          <p className="text-xs text-neutral-400">
            Уведомления заблокированы в настройках браузера для этого сайта — разрешите их там, чтобы включить здесь.
          </p>
        )}
        {(permission === 'default' || permission === 'granted') && (
          <button
            onClick={async () => {
              if (!profile) return;
              if (permission === 'granted') {
                await disableNotifications(profile.uid);
              } else {
                try {
                  await enableNotifications(profile.uid);
                } catch {
                  // ошибка уже показана ниже через notifError
                }
              }
            }}
            disabled={enabling}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium disabled:opacity-60"
          >
            {enabling ? <Loader2 size={15} className="animate-spin" /> : permission === 'granted' ? <BellOff size={15} /> : <Bell size={15} />}
            {enabling ? 'Включаю...' : permission === 'granted' ? 'Отключить уведомления' : 'Включить уведомления'}
          </button>
        )}
        {permission === 'granted' && (
          <button
            onClick={async () => {
              setTestSending(true);
              setTestResult(null);
              try {
                await sendTestNotificationCall();
                setTestResult({ ok: true, text: 'Отправлено! Проверьте телефон/компьютер.' });
              } catch (e) {
                setTestResult({ ok: false, text: (e as { message?: string })?.message || 'Не удалось отправить' });
              } finally {
                setTestSending(false);
              }
            }}
            disabled={testSending}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-sm font-medium disabled:opacity-60"
          >
            {testSending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {testSending ? 'Отправляю...' : 'Отправить тестовое уведомление'}
          </button>
        )}
        {testResult && (
          <p className={`text-xs ${testResult.ok ? 'text-emerald-500' : 'text-rose-500'}`}>{testResult.text}</p>
        )}
        {notifError && <p className="text-xs text-rose-500">{notifError}</p>}
        <p className="text-[11px] text-neutral-400">
          Напоминания о задачах и важных датах будут приходить push-уведомлением на это устройство. На iPhone работает
          только если сайт добавлен на домашний экран (Поделиться → "На экран «Домой»").
        </p>
      </div>

      <div className="rounded-2xl glass p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-500">{t('settings_theme')}</h2>
        <button
          onClick={toggle}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium"
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
          {dark ? t('settings_theme_light') : t('settings_theme_dark')}
        </button>
      </div>

      <div className="rounded-2xl glass p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-500">Приветствие</h2>
        <button
          onClick={() => setShowOnboarding(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium"
        >
          <PlayCircle size={15} /> Посмотреть приветствие ещё раз
        </button>
      </div>

      {showOnboarding && <OnboardingModal onClose={() => setShowOnboarding(false)} />}

      <div className="rounded-2xl glass p-5 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-500">{t('settings_export')}</h2>
        <p className="text-xs text-neutral-400">{t('settings_export_desc')}</p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm font-medium disabled:opacity-60"
        >
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {exporting ? t('settings_export_loading') : t('settings_export_button')}
        </button>
        {exportError && <p className="text-xs text-rose-500">{exportError}</p>}
      </div>

      <button
        onClick={logOut}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-500 text-sm font-medium"
      >
        <LogOut size={15} /> {t('settings_logout')}
      </button>
    </div>
  );
}
