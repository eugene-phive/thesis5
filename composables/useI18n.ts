import type { AppLanguage } from '~/shared/api'
import { resolveMessage, type MessageKey } from '~/shared/i18n'

export { messages, resolveMessage } from '~/shared/i18n'
export type { MessageKey } from '~/shared/i18n'

export function useI18n() {
  const locale = useState<AppLanguage>('locale', () => 'en')

  function t(key: MessageKey, params?: Record<string, string | number>): string {
    return resolveMessage(locale.value, key, params)
  }

  async function setLanguage(language: AppLanguage): Promise<void> {
    locale.value = language
    try {
      await window.api?.settings.set({ language })
    } catch {
      // настройки недоступны вне Electron — язык остаётся на текущей сессии
    }
  }

  async function toggleLanguage(): Promise<void> {
    await setLanguage(locale.value === 'ru' ? 'en' : 'ru')
  }

  async function loadLanguage(): Promise<void> {
    try {
      const settings = await window.api?.settings.get()
      if (settings?.language) locale.value = settings.language
    } catch {
      // игнорируем — используем значение по умолчанию
    }
  }

  return { locale, t, setLanguage, toggleLanguage, loadLanguage }
}
