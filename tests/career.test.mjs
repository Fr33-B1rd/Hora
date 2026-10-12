import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {extractText,docxText,unzipEntry} from '../lib/documents.mjs';
import {readProfile,editCareer,describeSchedule} from '../lib/profile.mjs';

// A minimal zip writer, enough to build a Word file for the tests.
function zip(files,{store=false}={}){
  const parts=[],central=[];let offset=0;
  for(const [name,text] of Object.entries(files)){
    const raw=Buffer.from(text,'utf8'),data=store?raw:deflateRawSync(raw),nameBytes=Buffer.from(name);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(store?0:8,8);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(nameBytes.length,26);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(store?0:8,10);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(raw.length,24);entry.writeUInt16LE(nameBytes.length,28);entry.writeUInt32LE(offset,42);
    parts.push(local,nameBytes,data);central.push(entry,nameBytes);offset+=30+nameBytes.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,directory,end]);
}
const paragraph=t=>`<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const body=`<?xml version="1.0"?><w:document><w:body>${paragraph('Maria Lind')}${paragraph('Data scientist &amp; team lead')}<w:p><w:r><w:t>Python</w:t><w:tab/><w:t>SQL</w:t><w:br/><w:t>R&#233;sum&#xE9;</w:t></w:r></w:p></w:body></w:document>`;
const longText='Maria Lind. Data scientist with six years of experience in forecasting. '.repeat(5);

test('text is read from Word files, compressed or stored, with paragraphs and entities intact',()=>{
  for(const store of [false,true]){
    const file=zip({'[Content_Types].xml':'<Types/>','word/document.xml':body,'word/styles.xml':'<w:styles/>'},{store});
    assert.equal(docxText(file),'Maria Lind\nData scientist & team lead\nPython\tSQL\nRésumé');
  }
  assert.equal(unzipEntry(zip({'a.txt':'x'}),'word/document.xml'),null);
  assert.throws(()=>docxText(Buffer.from('not a zip at all, just some text that is long enough')),/not a readable Word file/);
  assert.throws(()=>docxText(zip({'other.xml':'<x/>'})),/not a readable Word file/);
});

test('each kind of upload is read or refused with a reason the user can act on',async()=>{
  assert.equal(await extractText('cv.txt',Buffer.from('﻿Line one  \r\n\r\n\r\n\r\nLine   two\r\n')),'Line one\n\nLine two');
  assert.equal(await extractText('CV.MD',Buffer.from('# Maria')),'# Maria');
  assert.match(await extractText('cv.docx',zip({'word/document.xml':body})),/Maria Lind/);
  const pdf=Buffer.from('%PDF-1.7 fake');
  assert.equal(await extractText('cv.pdf',pdf,{run:async()=>longText+'\f'}),longText.trim());
  await assert.rejects(extractText('cv.pdf',pdf,{run:async()=>{throw Object.assign(Error('spawn pdftotext ENOENT'),{code:'ENOENT'});}}),/cannot read PDFs yet.*paste the text/s);
  await assert.rejects(extractText('cv.pdf',pdf,{run:async()=>{throw Error('exit 1');}}),/could not be read/);
  await assert.rejects(extractText('cv.pdf',pdf,{run:async()=>'  \n '}),/may be a scan/);
  await assert.rejects(extractText('cv.pdf',Buffer.from('<html>not a pdf</html>')),/not a readable PDF/);
  await assert.rejects(extractText('cv.pages',Buffer.from('x')),/PDF, Word/);
  await assert.rejects(extractText('cv',Buffer.from('x')),/PDF, Word/);
  await assert.rejects(extractText('cv.txt',Buffer.from([65,0,66])),/readable text/);
});

test('the job search can be set up, changed and cleared from the page, in the state the script reads',async()=>{
  const home=await mkdtemp(join(tmpdir(),'daylight-career-')),file=join(home,'daylight/jobs.json'),saved=async()=>JSON.parse(await readFile(file,'utf8'));
  try{
    assert.deepEqual((await readProfile(home)).career,{cv:null,prefs:{roles:[],places:[],languages:[],avoid:[],notes:[],remote:'yes',country:'Sweden',seniority:null},lastLooked:null,matches:[]});
    await assert.rejects(editCareer(home,{action:'cv_text',text:'too short'}),/too short/);
    await editCareer(home,{action:'cv_text',text:longText,name:'CV (pasted)'});
    await editCareer(home,{action:'cv_file',name:'..\\maria/cv.docx',data:zip({'word/document.xml':`<w:document>${paragraph(longText)}</w:document>`}).toString('base64')});
    let s=await saved();assert.equal(s.cv.name,'.. maria cv.docx');assert.equal(s.cv.text,longText.trim());assert.match(s.cv.added,/^\d{4}-\d\d-\d\d$/);
    await assert.rejects(editCareer(home,{action:'cv_file',name:'cv.pdf',data:Buffer.alloc(3.1e6).toString('base64')}),/larger than 3 MB/);
    await assert.rejects(editCareer(home,{action:'cv_file',name:'cv.pdf'}),/Choose a file/);
    // Matches found under the old wishes are cleared when a wish changes; dismissing one leaves the rest.
    const match=(id,fit)=>({id,title:'Data Scientist',employer:'Acme',place:'Stockholm',remote:false,url:'https://example.test/'+id,fit,met:4,of:6,meets:['Python: “Python”'],gaps:['Azure'],found:'2026-10-12',credit:'Jobicy',source:'jobicy',text:'full posting text'});
    s.matches=[match('a',70),match('b',90)];s.seen={a:'2026-10-12',b:'2026-10-12',c:'2026-10-12'};s.lastRun='2026-10-12T08:00:00+00:00';s.prefs.notes=['no defence'];await writeFile(file,JSON.stringify(s));
    const shown=(await readProfile(home)).career;
    assert.deepEqual(shown.matches.map(m=>m.id),['b','a']);assert.equal(shown.matches[0].source,'Jobicy');assert.equal(shown.matches[0].text,undefined);assert.equal(shown.cv.characters,longText.trim().length);assert.equal(shown.cv.text,undefined);
    await editCareer(home,{action:'dismiss',id:'a'});s=await saved();assert.deepEqual(s.matches.map(m=>m.id),['b']);assert.equal(Object.keys(s.seen).length,3);
    await assert.rejects(editCareer(home,{action:'dismiss',id:'a'}),e=>e.status===409);
    s.matches=[match('b',90),{...match('c',80),employer:'Konsult AB'}];await writeFile(file,JSON.stringify(s));
    await editCareer(home,{action:'prefs',avoid:'konsult'});s=await saved();
    assert.deepEqual(s.matches.map(m=>m.id),['b']);assert.equal(Object.keys(s.seen).length,3);   // ruling something out keeps what it does not touch
    await editCareer(home,{action:'prefs',roles:'data scientist, ML engineer, data scientist',places:[],languages:['English'],avoid:' consulting ,',remote:'only'});
    s=await saved();assert.deepEqual(s.prefs.roles,['data scientist','ML engineer']);assert.deepEqual(s.prefs.avoid,['consulting']);assert.equal(s.prefs.remote,'only');assert.deepEqual(s.prefs.notes,['no defence']);
    assert.deepEqual([s.matches,s.seen,s.lastRun],[[],{},null]);
    await assert.rejects(editCareer(home,{action:'prefs',remote:'sometimes'}),/Remote must be/);
    await editCareer(home,{action:'note_remove',text:'no defence'});assert.deepEqual((await saved()).prefs.notes,[]);
    await assert.rejects(editCareer(home,{action:'note_remove',text:'no defence'}),e=>e.status===409);
    await editCareer(home,{action:'cv_remove'});assert.equal((await saved()).cv,null);
    await assert.rejects(editCareer(home,{action:'apply'}),/Unknown action/);
  }finally{await rm(home,{recursive:true,force:true});}
});

test('the job watch’s schedule reads as plain words',()=>{
  assert.equal(describeSchedule('15 */3 * * *'),'Every 3 hours');assert.equal(describeSchedule('30 7 * * *'),'Every day at 07:30');
});
