const antfu = require('@antfu/eslint-config').default

module.exports = antfu({
  ignores: [
    'dist',
    'test',
    'webpack.config.js',
    'src/types/types_supabase.ts',
  ],
})
