import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import JSZip from 'jszip';
import {readInput} from '../src/input.js';
import {planText} from '../src/plan.js';
import {buildDeck} from '../src/build.js';
import type {Config} from '../src/types.js';
const exec=promisify(execFile);
const config:Config={provider:'none',python:process.env.MVP_PYTHON||'python',timeoutMs:10000,maxImageBytes:1024*1024,animate:false,render:false,strict:false};

test('reads a real DOCX package and preserves heading and body text',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-docx-'));const zip=new JSZip();
 zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
 zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 zip.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
 zip.file('word/styles.xml','<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>');
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>DOCX 来源</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>研究方法</w:t></w:r></w:p><w:p><w:r><w:t>真实 Word 原生段落必须被完整提取。</w:t></w:r></w:p></w:body></w:document>');
 const file=path.join(dir,'source.docx');await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
 const plan=await readInput(file,config);assert.equal(plan.title,'DOCX 来源');assert.equal(plan.slides[0].title,'研究方法');
 assert.ok(plan.slides.flatMap(s=>s.body).join('').includes('真实 Word 原生段落必须被完整提取。'));
});

test('reads a real PDF text layer through the declared Python backend',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-pdf-'));const file=path.join(dir,'source.pdf');
 await exec(config.python,['-c','import fitz,sys; d=fitz.open(); p=d.new_page(); p.insert_text((72,72), "Native PDF evidence 2026"); d.save(sys.argv[1])',file],{windowsHide:true,timeout:20000});
 const plan=await readInput(file,config);assert.ok(plan.slides.flatMap(s=>s.body).join('').includes('Native PDF evidence 2026'));
});

test('PPTX import follows relationship order and identifies native named titles',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-pptx-input-'));
 const source=planText('# Import\n## [L04] First logical title\nNative first body\n## [L04] Second logical title\nNative second body');
 const built=await buildDeck(source,{version:'1.0',assets:[],warnings:[]},dir);
 const zip=await JSZip.loadAsync(await fs.readFile(built.pptxPath));
 const pres=await zip.file('ppt/presentation.xml')!.async('string');
 zip.file('ppt/presentation.xml',pres.replace(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/,(_,inner:string)=>`<p:sldIdLst>${inner.match(/<p:sldId\s[^>]*\/>/g)!.reverse().join('')}</p:sldIdLst>`));
 const reordered=path.join(dir,'reordered.pptx');await fs.writeFile(reordered,await zip.generateAsync({type:'nodebuffer'}));
 const imported=await readInput(reordered,config);
 assert.equal(imported.slides[0].title,'Second logical title');
 assert.equal(imported.slides[1].title,'First logical title');
 assert.ok(imported.slides[0].body.join('').includes('Native second body'));
});

test('rejects missing, unsupported, empty and malformed inputs with real errors',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mvp-input-errors-'));
 await assert.rejects(readInput(path.join(dir,'missing.md'),config),/ENOENT/);
 await assert.rejects(readInput(path.join(dir,'source.exe'),config),/Unsupported/);
 const file=path.join(dir,'empty.txt');await fs.writeFile(file,'   ');await assert.rejects(readInput(file,config),/no extractable text/);
 const json=path.join(dir,'bad.json');await fs.writeFile(json,'{"slides":[]}');await assert.rejects(readInput(json,config),/Invalid deck plan/);
});
