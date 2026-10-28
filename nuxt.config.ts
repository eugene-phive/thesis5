export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  ssr: false,
  modules: [
    'nuxt-electron',
    // nuxt-electron по умолчанию ставит baseURL './' и buildAssetsDir '/',
    // что нужно для загрузки собранного приложения через file://.
    // На dev-сервере такие значения дают 404 на всех путях, поэтому в dev
    // возвращаем стандартные для Nuxt значения.
    (_options, nuxt) => {
      if (nuxt.options.dev) {
        nuxt.options.app.baseURL = '/'
        nuxt.options.app.buildAssetsDir = '/_nuxt/'
        nuxt.options.runtimeConfig.app.baseURL = '/'
        nuxt.options.runtimeConfig.app.buildAssetsDir = '/_nuxt/'
      }
    },
  ],

  // Добавьте эту секцию
  router: {
    options: {
      hashMode: true,
    },
  },

  electron: {
    build: [
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            // Нативный модуль нельзя бандлить — он загружается из node_modules
            rolldownOptions: {
              external: ['better-sqlite3'],
            },
          },
        },
      },
      {
        // Preload-скрипт Electron загружает как CommonJS (.cjs),
        // поэтому формат сборки нужно переопределить
        entry: 'electron/preload.ts',
        vite: {
          build: {
            lib: false,
            rolldownOptions: {
              input: 'electron/preload.ts',
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
                codeSplitting: false,
              },
            },
          },
        },
      },
    ],
  },
})
