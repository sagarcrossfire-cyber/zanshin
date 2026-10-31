// ESLint flat config — spec §13.2 custom rules live in ./eslint-rules/.
// no-color-literals: no hex/rgb color values in TS/TSX outside tokens.css.
// no-direct-storage-fetch: screens/components must not touch indexedDB or fetch directly.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { noColorLiterals } from './eslint-rules/no-color-literals.js';
import { noDirectStorageFetch } from './eslint-rules/no-direct-storage-fetch.js';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-standalone/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'public/**', '*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { parserOptions: { projectService: true } },
    plugins: { 'react-hooks': reactHooks, zanshin: { rules: { 'no-color-literals': noColorLiterals, 'no-direct-storage-fetch': noDirectStorageFetch } } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'zanshin/no-color-literals': 'error',
      'zanshin/no-direct-storage-fetch': 'error',
    },
  },
  {
    files: ['tests/**', 'scripts/**', 'eslint-rules/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
  },
  {
    // Plain JS tooling files have no TS project; lint them without type info.
    files: ['eslint-rules/**/*.js', 'scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { Buffer: 'readonly', URL: 'readonly', console: 'readonly', process: 'readonly', setTimeout: 'readonly' },
      parserOptions: { projectService: false },
    },
  },
);
