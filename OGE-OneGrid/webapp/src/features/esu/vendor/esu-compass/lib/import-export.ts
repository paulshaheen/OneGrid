import {z} from 'zod';
import {newCoverage,newHost,newWorkload,newSql,type State} from './model';
const positive=z.number().int().min(1).max(100000),nonnegative=z.number().min(0).max(1e12),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'Invalid date');
const coverage=z.object({mode:z.enum(['new','arc','annual']),paidThrough:z.union([date,z.literal('')]),priorYears:z.number().int().min(0).max(3)});
const entitlement=z.enum(['sa','subscription','spla','payg','none','servercal']);
const sql=z.object({id:z.string().min(1),version:z.enum(['2012','2014','2016','2017','2019','2022','2025']),edition:z.enum(['Standard','Enterprise','Developer','Express','Web']),entitlement,exempt:z.boolean(),coverage});
const host=z.object({id:z.string().min(1),name:z.string().min(1).max(160),quantity:positive,sockets:positive,coresPerSocket:positive,location:z.enum(['onprem','azure','azurelocal','other']),azureVerified:z.boolean(),windowsMode:z.enum(['vm','standard','datacenter']),sqlMode:z.enum(['vm','enterprise']),rightsConfirmed:z.boolean()});
const workload=z.object({id:z.string().min(1),hostId:z.string(),name:z.string().min(1).max(160),kind:z.enum(['vm','physical']),quantity:positive,cores:positive,osVersion:z.enum(['none','2008 R2','2012','2012 R2','2016','2019','2022','2025']),osEdition:z.enum(['Standard','Datacenter']),osEntitlement:entitlement,coverage,sql:z.array(sql).max(30),migrate:z.boolean(),retireOS:z.boolean()});
const meter=z.object({key:z.string(),name:z.string(),rate:nonnegative,unit:z.string(),meterId:z.string(),effectiveStart:z.string(),source:z.string()});
export const stateSchema=z.object({schema:z.literal(1),eligibilityConfirmed:z.boolean(),customer:z.string().max(160),sample:z.boolean(),hosts:z.array(host).max(2000),workloads:z.array(workload).max(10000),start:date,months:z.number().int().min(1).max(60),discount:z.number().min(0).max(100),backDiscount:z.number().min(0).max(100),annualDiscount:z.number().min(0).max(100),tax:z.number().min(0).max(100),costs:z.object({saMonthly:nonnegative,otherMonthly:nonnegative,oneTime:nonnegative}),
 prices:z.object({checked:date,region:z.string(),meters:z.record(meter),annual:z.record(z.tuple([nonnegative.nullable(),nonnegative.nullable(),nonnegative.nullable()])),notes:z.string().max(5000)}),
 mi:z.object({enabled:z.boolean(),instances:positive,vcores:positive,storageGB:nonnegative,backupGB:nonnegative,tier:z.enum(['gp','bc']),term:z.enum(['payg','one','three']),ahb:z.boolean(),ahbEdition:z.enum(['Standard','Enterprise']),ahbCores:nonnegative,ahbConfirmed:z.boolean(),readiness:z.boolean(),zone:z.boolean(),computeOverride:nonnegative.nullable(),licenseOverride:nonnegative.nullable(),storageOverride:nonnegative.nullable(),backupOverride:nonnegative.nullable(),extrasMonthly:nonnegative,saMonthly:nonnegative,baselineAvoidableMonthly:nonnegative,baselineSaMonthly:nonnegative,migrationCost:nonnegative,overlapMonths:z.number().min(0).max(24),windowsLagDays:z.number().int().min(0).max(5),cutover:date,otherTargetMonthly:nonnegative,otherMigrationCost:nonnegative,baselineReviewed:z.boolean()})}).superRefine((s,ctx)=>{
 const ids=new Set(s.hosts.map(h=>h.id));if(ids.size!==s.hosts.length)ctx.addIssue({code:'custom',message:'Duplicate host IDs.'});
 if(new Set(s.workloads.map(w=>w.id)).size!==s.workloads.length)ctx.addIssue({code:'custom',message:'Duplicate workload IDs.'});
 for(const w of s.workloads){if(!ids.has(w.hostId))ctx.addIssue({code:'custom',message:`${w.name}: host does not exist.`});if(w.kind==='physical'&&w.quantity!==1)ctx.addIssue({code:'custom',message:`${w.name}: a bare-metal OSE has quantity 1 per host.`});}
});
export function validateState(data:unknown):State{return stateSchema.parse(data) as State;}
export function parseCSV(text:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw new Error('CSV has an unclosed quotation mark.');row.push(field);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
export function importInventory(text:string,state:State):State{
 const rows=parseCSV(text.replace(/^\uFEFF/,''));if(rows.length<2)throw new Error('CSV needs a header and at least one workload.');
 const headers=rows[0].map(x=>x.trim());for(const key of ['host','workload','vcores','os_version'])if(!headers.includes(key))throw new Error(`CSV column missing: ${key}`);
 const hosts:State['hosts']=[],workloads:State['workloads']=[];
 for(const [index,row] of rows.slice(1).entries()){
  const v=Object.fromEntries(headers.map((h,i)=>[h,(row[i]||'').trim()]));
  let h=hosts.find(h=>h.name===v.host);if(!h){h={...newHost(),name:v.host,quantity:Number(v.host_count||1),sockets:Number(v.sockets||2),coresPerSocket:Number(v.cores_per_socket||8),location:(v.location||'onprem') as State['hosts'][0]['location']};hosts.push(h);}
  let w=workloads.find(w=>w.name===v.workload&&w.hostId===h.id);
  if(!w){w={...newWorkload(h.id),name:v.workload,kind:(v.kind||'vm') as 'vm'|'physical',quantity:Number(v.quantity||1),cores:Number(v.vcores),osVersion:v.os_version||'none',osEdition:(v.os_edition||'Standard') as 'Standard',osEntitlement:(v.os_entitlement||'none') as 'none',migrate:v.migrate==='true',retireOS:v.retire_os==='true',coverage:newCoverage()};workloads.push(w);}
  if(v.sql_version)w.sql.push({...newSql(),version:v.sql_version,edition:(v.sql_edition||'Standard') as 'Standard',entitlement:(v.sql_entitlement||'none') as 'none'});
  if(!v.host||!v.workload)throw new Error(`Row ${index+2}: host and workload are required.`);
 }
 return validateState({...state,sample:false,eligibilityConfirmed:false,hosts,workloads});
}
export const csvTemplate='host,host_count,sockets,cores_per_socket,location,workload,kind,quantity,vcores,os_version,os_edition,os_entitlement,sql_version,sql_edition,sql_entitlement,migrate,retire_os\nHost-01,1,2,12,onprem,Finance-SQL,vm,1,8,2016,Standard,sa,2016,Enterprise,sa,true,true\nHost-01,1,2,12,onprem,App-01,vm,1,4,2016,Standard,sa,,,,false,false\n';
export function csvEscape(x:unknown){let s=String(x??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export function download(name:string,content:string,type='application/json'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
