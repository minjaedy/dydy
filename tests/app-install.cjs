const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync,existsSync}=require('node:fs'),{resolve}=require('node:path');
const root=resolve(__dirname,'..');

const base=new URL('https://minjaedy.github.io/dydy/');
const manifest=JSON.parse(readFileSync(resolve(root,'manifest.webmanifest'),'utf8'));
const manifestURL=new URL('manifest.webmanifest',base);
test('installed app identity is its own path, not the shared GitHub Pages origin',()=>{
  const start=new URL(manifest.start_url,manifestURL);
  // Per W3C, id is resolved against start_url's ORIGIN, not the manifest directory.
  const id=new URL(manifest.id,start.origin+'/');
  assert.equal(id.href,base.href);
  assert.equal(new URL(manifest.scope,manifestURL).href,base.href);
  assert.ok(start.href.startsWith(base.href));
  assert.notEqual(id.pathname,'/');
});
test('install icons and head resources exist with correct dimensions and separate maskable artwork',()=>{
  for(const icon of manifest.icons){
    const url=new URL(icon.src,manifestURL);assert.ok(url.href.startsWith(base.href));
    const data=readFileSync(resolve(root,url.pathname.slice(base.pathname.length)));
    assert.equal(data.subarray(1,4).toString(),'PNG');
    assert.equal(`${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`,icon.sizes);
    assert.equal(data[25],icon.purpose==='maskable'?2:6,'maskable is RGB, rounded artwork retains RGBA');
  }
  for(const purpose of ['any','maskable'])assert.ok(manifest.icons.some(i=>i.purpose===purpose&&i.sizes==='1024x1024'));
  const html=readFileSync(resolve(root,'index.html'),'utf8');let manifests=0,apple=0;
  for(const tag of html.match(/<link\b[^>]*>/g)||[]){
    const attrs=Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    if(!['manifest','icon','apple-touch-icon'].includes(attrs.rel))continue;
    const url=new URL(attrs.href,base);assert.ok(url.href.startsWith(base.href));
    assert.ok(existsSync(resolve(root,url.pathname.slice(base.pathname.length))),attrs.href);
    if(attrs.rel==='manifest')manifests++;
    if(attrs.rel==='apple-touch-icon'){apple++;assert.match(attrs.href,/maskable-180\.png/);}
  }
  assert.equal(manifests,1);assert.equal(apple,1);
});
