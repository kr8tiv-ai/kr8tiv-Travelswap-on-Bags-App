const fs=require('fs'),path=require('path');
function walk(d){
  const r=[];
  for(const f of fs.readdirSync(d,{withFileTypes:true})){
    const p=path.join(d,f.name);
    if(f.isDirectory()&&!f.name.includes('__tests__')&&f.name!=='node_modules') r.push(...walk(p));
    else if(f.isFile()&&f.name.endsWith('.ts')) r.push(p);
  }
  return r;
}
console.log(walk('backend/src').join('\n'));
