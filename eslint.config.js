import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

const forbidden = {
  paths: [
    { name: 'react', message: 'core/adapters 不可依賴 React。' },
    { name: 'react-dom', message: 'core/adapters 不可依賴 React。' },
  ],
  patterns: [
    { group: ['react/*', 'react-dom/*'], message: 'core/adapters 不可依賴 React。' },
    { group: ['@/features/*', '@/features'], message: 'core/adapters 不可依賴 features。' },
    { group: ['@/ui/*', '@/ui'], message: 'core/adapters 不可依賴 ui。' },
  ],
}

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report', '.superpowers'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ['*.config.{js,ts}', 'e2e/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/core/**/*.{ts,tsx}', 'src/adapters/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', forbidden] },
  },
)
