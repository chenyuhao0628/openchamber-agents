import { build, context } from 'esbuild';
const options = ['main', 'section'].map(name => ({ entryPoints: [`src/panel/${name}.ts`], outfile: `panel/${name}.js`, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, loader: { '.css': 'text' }, logLevel: 'info' }));
if (process.argv.includes('--watch')) {
  for (const option of options) await (await context(option)).watch();
} else await Promise.all(options.map(option => build(option)));
