import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {onRequestPut} from '../functions/api/save.js';

function database() {
  const sql=new DatabaseSync(':memory:');
  for(const name of ['0001_cloud_save.sql','0002_cloud_sessions_and_versions.sql','0003_cloud_storage_quota.sql']) sql.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  let racing=false,arrivals=0,release;
  const gate=new Promise(resolve=>release=resolve);
  return {sql,race(){racing=true;},prepare(query){return {bind(...values){
    const params=Object.fromEntries(values.map((v,i)=>[String(i+1),v]));
    return {async first(){
      const row=sql.prepare(query).get(params)||null;
      if(racing&&query.includes('SELECT revision, updated_at')) {if(++arrivals===2)release();await gate;}
      return row;
    },execute(){return {results:sql.prepare(query).all(params),success:true};}};
  }};},async batch(statements){
    sql.exec('BEGIN');try{const result=statements.map(s=>s.execute());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}
  }};
}

test('two writers with the same revision cannot both commit',async()=>{
  const db=database();
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code='TX-'+Array.from({length:4},()=>[...randomBytes(8)].map(b=>alphabet[b%alphabet.length]).join('')).join('-');
  const write=(revision,gold)=>onRequestPut({env:{GAME_DB:db},request:new Request('https://game.test/api/save',{method:'PUT',headers:{authorization:`Bearer ${code}`},body:JSON.stringify({expectedRevision:revision,state:{version:5,ruler:'玄宗',kingdom:'唐',calendar:{year:741,month:1,day:1},gold,provinces:{},regions:{}}})})});
  try{
    assert.equal((await write(null,850)).status,200);
    db.race();
    const responses=await Promise.all([write(1,851),write(1,852)]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    assert.equal(db.sql.prepare('SELECT revision FROM game_saves').get().revision,2);
  }finally{db.sql.close();}
});
