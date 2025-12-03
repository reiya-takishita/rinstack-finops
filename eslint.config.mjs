import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'tmp/**',
      '*.config.js',
      'migrations/**',
      'seeders/**',
      'scripts/**',
    ],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2016,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // anyを禁止
      '@typescript-eslint/no-explicit-any': 'error',
      // require()の使用を許可（CommonJSファイル用）
      '@typescript-eslint/no-require-imports': 'off',
      // 文字列をシングルクォートで囲む
      'quotes': ['error', 'single'],
      // 末尾に余分なスペースを禁止
      'no-trailing-spaces': 'error',
      // 不必要な括弧を禁止
      'no-extra-parens': 'error',
      // == や != ではなく === や !== を使用することを強制
      'eqeqeq': ['error', 'always'],
      // アロー関数の引数を常に括弧で囲むことを強制
      'arrow-parens': ['error', 'always'],
      // evalの禁止
      'no-eval': 'error',
      // JavaScript URLスキームを禁止
      'no-script-url': 'error',
      // インデントはスペース2個に統一
      'indent': ['error', 2],
      // 2個以上の連続スペースを禁止
      'no-multi-spaces': 'error',
    },
  },
  // CommonJSファイル用の設定
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 2016,
        sourceType: 'script',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  }
);

