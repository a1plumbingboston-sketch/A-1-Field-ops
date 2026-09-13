import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');
const pkg=JSON.parse(await read('package.json'));
const publicFiles=(await readdir(root)).filter(n=>/\.(js|css|html|webmanifest)$/.test(n)).sort();
const fingerprint=createHash('sha256');
for(const name of publicFiles){
  if(name==='service-worker.js')continue;
  const source=(await read(name)).replace(/(<meta name="fieldops-release" content=")[^"]+"/g,'$1RELEASE"').replace(/\?v=[^"'\s<>]+/g,'');
  fingerprint.update(name).update(source);
}
const commit=(process.env.VERCEL_GIT_COMMIT_SHA||fingerprint.digest('hex')).slice(0,12);
const id=`${pkg.version}-${commit}`;
const assets=new Set(['/','/index.html','/employee.html','/manifest.webmanifest','/employee.webmanifest','/a1-logo.png']);
// Include every local first-party JS/CSS dependency, including ES-module imports.
for(const name of publicFiles)if(/\.(js|css)$/.test(name)&&name!=='service-worker.js')assets.add('/'+name);
for(const name of ['index.html','employee.html']){
  let html=await read(name);
  if(!html.includes('name="fieldops-release"'))throw Error(`Missing update metadata in ${name}`);
  html=html.replace(/(<meta name="fieldops-release" content=")[^"]+("\s*\/?>)/,`$1${id}$2`);
  html=html.replace(/((?:src|href)=")(\/|\.\/)?([^"?#]+\.(?:js|css))(?:\?[^"#]*)?("|#)/g,(all,start,prefix='',file,end)=>{
    if(file.includes(':'))return all;
    const url='/'+file+'?v='+id;assets.add(url);return start+(prefix||'')+file+'?v='+id+end;
  });
  await writeFile(path.join(root,name),html);
}
for(const asset of assets){const name=asset.split('?')[0].slice(1)||'index.html';await stat(path.join(root,name));}
let worker=await read('service-worker.js');
worker=worker.replace(/^const CACHE=.*;$/m,`const CACHE='a1-fieldops-${id}';`).replace(/^const ASSETS=.*;$/m,`const ASSETS=${JSON.stringify([...assets])};`);
await writeFile(path.join(root,'service-worker.js'),worker);
await writeFile(path.join(root,'release.json'),JSON.stringify({id,version:pkg.version})+'\n');
console.log(`FieldOps release ${id}: ${assets.size} offline assets prepared.`);
