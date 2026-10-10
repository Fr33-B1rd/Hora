import {readFile} from 'node:fs/promises';
const root=new URL('../agent/',import.meta.url);
export async function agentSkills(){
  const manifest=JSON.parse(await readFile(new URL('skills.json',root),'utf8'));
  const entries=await Promise.all(manifest.map(async entry=>{
    if(!/^[a-z][a-z0-9-]{0,63}$/.test(entry.name)||!Array.isArray(entry.tools))throw Error('Invalid skill manifest');
    const text=await readFile(new URL(`skills/${entry.name}/SKILL.md`,root),'utf8');
    const front=text.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n/);
    const name=front?.[1].match(/^name: (.+)$/m)?.[1].trim(),description=front?.[1].match(/^description: (.+)$/m)?.[1].trim();
    if(name!==entry.name||!description)throw Error('Invalid skill frontmatter');
    return {...entry,description,body:text.slice(front[0].length).trim()};
  }));
  return {policy:await readFile(new URL('AGENTS.md',root),'utf8'),entries};
}
