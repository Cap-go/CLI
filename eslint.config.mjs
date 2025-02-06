import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: [
    'dist',
    'test',
    'webpack.config.js',
    'src/types/types_supabase.ts',
  ],
})
