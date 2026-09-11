import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('signature pad handles touch coordinates, ignores a second finger, clears ink and prevents blank acceptance',async()=>{
 const html=fs.readFileSync(new URL('../customer-sign.html',import.meta.url),'utf8');
 const paths=[],context2d={fillRect(){},beginPath(){},moveTo(...p){paths.push(p)},lineTo(...p){paths.push(p)},stroke(){}};
 const elements={sig:{width:900,height:350,getContext:()=>context2d,getBoundingClientRect:()=>({left:10,top:20,width:360,height:140}),setPointerCapture(){}},clear:{},sign:{},name:{value:'Test Customer'},msg:{}};
 const ctx=vm.createContext({document:{getElementById:id=>elements[id]},canvas:null,ctx:null,drawing:false,hasInk:false,saving:false,activePointer:null});
 const source=html.slice(html.indexOf('function setupCanvas()'),html.indexOf('async function load()'));
 vm.runInContext(source,ctx);vm.runInContext('setupCanvas()',ctx);
 const e=(id,x,y)=>({pointerId:id,clientX:x,clientY:y,preventDefault(){}});
 elements.sig.onpointerdown(e(1,10,20));elements.sig.onpointerdown(e(2,100,100));elements.sig.onpointermove(e(2,150,100));assert.equal(paths.length,1);
 elements.sig.onpointermove(e(1,190,90));assert.deepEqual(paths[1],[450,175]);assert.equal(ctx.hasInk,true);
 elements.sig.onpointercancel(e(1));assert.equal(ctx.drawing,false);
 elements.clear.onclick();assert.equal(ctx.hasInk,false);
 await vm.runInContext('sign()',ctx);assert.match(elements.msg.textContent,/draw your signature/);
});
