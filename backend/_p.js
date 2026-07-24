const { Pool } = require('pg'); require('dotenv').config();
const IORedis = require('ioredis');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
const r = new IORedis(process.env.REDIS_URL);
(async () => {
  const run = await p.query("select id,name,status from uploads where status in ('registering','extracting','extracted') and deleted_at is null");
  if (!run.rows.length) { console.log('Nada rodando — deploy livre.'); await p.end(); await r.quit(); return; }
  for (const u of run.rows) { await r.set('ctrl:pause:'+u.id, '1', 'EX', 86400); console.log('pause #'+u.id+' '+u.name); }
  await p.end(); await r.quit();
})().catch(e => console.log('ERR: ' + e.message));
