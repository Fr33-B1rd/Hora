import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
export function createStore(directory) {
  mkdirSync(directory,{recursive:true});
  const keyPath=join(directory,'local.key');
  if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});
  const key=readFileSync(keyPath), db=new DatabaseSync(join(directory,'daylight.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const get=id=>{const row=db.prepare('SELECT value FROM state WHERE id=?').get(id);return row?JSON.parse(row.value):null;};
  const put=(id,value)=>db.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,JSON.stringify(value));
  const prunePreviews=()=>db.prepare("DELETE FROM state WHERE id LIKE 'preview:%' AND json_extract(value,'$.expires') < ?").run(Date.now());
  prunePreviews();
  return {get,put,prunePreviews,clearPreviews:()=>db.prepare("DELETE FROM state WHERE id LIKE 'preview:%'").run(),remove:id=>db.prepare('DELETE FROM state WHERE id=?').run(id),close:()=>db.close(),
    tokens(value) {
      if(value===null){db.prepare('DELETE FROM state WHERE id=?').run('oauth');return;}
      if(value!==undefined){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);put('oauth',{iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')});return;}
      const row=get('oauth');if(!row)return null;const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(row.iv,'base64'));decipher.setAuthTag(Buffer.from(row.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.data,'base64')),decipher.final()]).toString());
    }
  };
}
