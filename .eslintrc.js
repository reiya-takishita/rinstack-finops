/*global module*/
/*eslint no-undef: "error"*/

module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2016,
    sourceType: 'module',
  },
  env: {
    browser: true,
    es2019: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  plugins: ['@typescript-eslint'],
  rules: {
    // anyを禁止
    '@typescript-eslint/no-explicit-any': 'error',
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
  }
};
