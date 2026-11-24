import {build} from 'esbuild';
import {mkdir,copyFile,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true}); await mkdir('dist/.openai',{recursive:true});
await build({entryPoints:['worker.mjs'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',loader:{'.html':'text','.md':'text'},minify:false});
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built Customer Ticket Agent');
