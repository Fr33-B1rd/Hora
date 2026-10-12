// Text out of an uploaded document (a CV), without third-party libraries:
// plain text and Markdown as they are, Word files by reading their zip
// container, PDFs through the `pdftotext` program where the machine has it.
import {inflateRawSync} from 'node:zlib';
import {spawn} from 'node:child_process';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const tidy=text=>text.replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').replace(/[ \t]{2,}/g,' ').trim();
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
const unescape=s=>s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(whole,code)=>code[0]==='#'?String.fromCodePoint(code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):Number(code.slice(1))):entities[code.toLowerCase()]??whole);

// One file out of a zip archive, by name. Reads the central directory, so
// archives written in streaming mode (sizes after the data) work too.
export function unzipEntry(buffer,wanted){
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-66000);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw fail('This is not a readable Word file.');
  const count=buffer.readUInt16LE(end+10);let at=buffer.readUInt32LE(end+16);
  for(let n=0;n<count&&at+46<=buffer.length;n++){
    if(buffer.readUInt32LE(at)!==0x02014b50)break;
    const method=buffer.readUInt16LE(at+10),packed=buffer.readUInt32LE(at+20),size=buffer.readUInt32LE(at+24),nameLength=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32),local=buffer.readUInt32LE(at+42);
    const name=buffer.toString('utf8',at+46,at+46+nameLength);
    if(name===wanted){
      if(size>20e6)throw fail('That document is too large.');
      const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28),data=buffer.subarray(start,start+packed);
      if(method===0)return data;
      if(method===8)return inflateRawSync(data,{maxOutputLength:20e6});
      throw fail('This Word file uses a compression this server cannot read.');
    }
    at+=46+nameLength+extra+comment;
  }
  return null;
}

export function docxText(buffer){
  const xml=unzipEntry(buffer,'word/document.xml');
  if(!xml)throw fail('This is not a readable Word file.');
  return tidy(unescape(xml.toString('utf8').replace(/<w:tab\b[^>]*\/>/g,'\t').replace(/<w:(br|cr)\b[^>]*\/>/g,'\n').replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'')));
}

// `run` can be replaced in tests; it resolves to the program's standard output.
const pdftotext=buffer=>new Promise((resolve,reject)=>{
  const child=spawn('pdftotext',['-layout','-enc','UTF-8','-','-'],{windowsHide:true}),out=[];let size=0;
  const timer=setTimeout(()=>child.kill(),20000);
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size<5e6)out.push(chunk);});
  child.on('close',code=>{clearTimeout(timer);code===0?resolve(Buffer.concat(out).toString('utf8')):reject(Error('pdftotext exited with '+code));});
  child.stdin.on('error',()=>{});child.stdin.end(buffer);
});

export async function extractText(name,buffer,{run=pdftotext}={}){
  const kind=(/\.([a-z0-9]+)$/i.exec(name||'')?.[1]||'').toLowerCase();
  let text;
  if(kind==='txt'||kind==='md'||kind==='markdown')text=tidy(buffer.toString('utf8').replace(/^﻿/,''));
  else if(kind==='docx')text=docxText(buffer);
  else if(kind==='pdf'){
    if(buffer.subarray(0,5).toString('latin1')!=='%PDF-')throw fail('This is not a readable PDF.');
    try{text=tidy(await run(buffer));}
    catch(error){throw fail(error.code==='ENOENT'?'This server cannot read PDFs yet. Upload a Word or text file, or paste the text instead.':'This PDF could not be read. Upload a Word or text file, or paste the text instead.');}
    if(text.length<200)throw fail('No text could be read from this PDF (it may be a scan). Paste the text instead.');
  }else throw fail('Upload a PDF, Word (.docx), text or Markdown file.');
  if(/\u0000/.test(text))throw fail('This file does not contain readable text.');
  return text;
}
