import { APP_ACCENTS, type AppAccent } from '~/shared/api'

export function useAccent() {
  const accent = useState<AppAccent>('accent', () => 'violet')

  function applyAccent(value: AppAccent): void {
    accent.value = value
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.accent = value
    }
  }

  async function setAccent(value: AppAccent): Promise<void> {
    applyAccent(value)
    try {
      await window.api?.settings.set({ accent: value })
    } catch {
      // настройки недоступны вне Electron — тема остаётся на текущую сессию
    }
  }

  async function cycleAccent(): Promise<void> {
    const index = APP_ACCENTS.indexOf(accent.value)
    const next = APP_ACCENTS[(index + 1) % APP_ACCENTS.length] ?? 'violet'
    await setAccent(next)
  }

  async function loadAccent(): Promise<void> {
    let value = accent.value
    try {
      const settings = await window.api?.settings.get()
      if (settings?.accent) value = settings.accent
    } catch {
      // игнорируем — используем значение по умолчанию
    }
    applyAccent(value)
  }

  return { accent, setAccent, cycleAccent, loadAccent }
}
