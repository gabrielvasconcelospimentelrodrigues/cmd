const {Pool}=require("pg");require("dotenv").config();const p=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{const {rows}=await p.query("select id,name,patients_registered r,patients_errored e,patients_found f,current_step from uploads where deleted_at is null and status='registering' order by uploaded_at desc limit 2");
if(!rows.length)console.log("(nada registering)");rows.forEach(x=>console.log("#"+x.id+" '"+String(x.name||'').slice(0,10)+"' reg="+x.r+"/"+x.f+" err="+x.e+" | "+String(x.current_step||'').slice(0,30)));await p.end();})().catch(e=>console.log("db"));
