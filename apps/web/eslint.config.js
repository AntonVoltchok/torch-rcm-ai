// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import pluginQuery from '@tanstack/eslint-plugin-query'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'public', 'src/routeTree.gen.ts', 'src/api/generated.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...pluginQuery.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'The demo clock is the server clock: use useClock(), never Date.now().' },
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'The demo clock is the server clock: use useClock(), never new Date().' },
      ],
    },
  },
  // TanStack Router's redirect()/notFound() are thrown by design.
  { files: ['src/routes/**'], rules: { '@typescript-eslint/only-throw-error': 'off' } },
  { files: ['**/*.js', '**/*.mjs'], ...tseslint.configs.disableTypeChecked },
  { files: ['src/mocks/**', 'e2e/**', 'src/**/*.test.{ts,tsx}', 'src/test/**', 'src/lib/sse.ts', 'src/hooks/useRunEvents.ts', 'src/hooks/useFirehose.ts'], rules: { 'no-restricted-syntax': 'off' } },
)
