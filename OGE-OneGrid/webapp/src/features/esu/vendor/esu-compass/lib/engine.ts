import {programs,type State,type Family,type Coverage,type Workload,type Host,type Sql,type Program} from './model';
export const DAY=86400000;
export const stamp=(d:string)=>Date.parse(d+'T00:00:00Z');
export const iso=(n:number)=>new Date(n).toISOString().slice(0,10);
export const addDays=(d:string,n:number)=>iso(stamp(d)+n*DAY);
export function addMonths(d:string,n:number){const x=new Date(stamp(d));const day=x.getUTCDate();x.setUTCDate(1);x.setUTCMonth(x.getUTCMonth()+n);const last=new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0)).getUTCDate();x.setUTCDate(Math.min(day,last));return iso(x.getTime());}
export const hours=(a:string,b:string)=>Math.max(0,(stamp(b)-stamp(a))/3600000);
const maxD=(...xs:string[])=>xs.filter(Boolean).sort().at(-1)!;
const minD=(...xs:string[])=>xs.filter(Boolean).sort()[0];
const round2=(n:number)=>Math.ceil(n/2)*2;
export function programFor(family:Family,version:string){return programs.find(p=>p.family===family&&p.version===version);}
export function statusFor(p:Program|undefined,date:string){if(!p)return 'unknown';if(date<=p.eos)return 'supported';if(p.end&&date>=p.end)return 'expired';if(!p.bounds.length)return 'unpublished';return 'esu';}
export function billableWindows(h:Host,ws:Workload[],channel:'arc'|'annual'){
 const physical=Math.max(16,h.sockets*(channel==='annual'?Math.max(8,h.coresPerSocket):h.coresPerSocket));
 if(h.windowsMode==='vm')return ws.reduce((n,w)=>n+(w.kind==='vm'?round2(Math.max(8,w.cores))*w.quantity:physical)*h.quantity,0);
 const oses=ws.reduce((n,w)=>n+w.quantity,0);
 return physical*h.quantity*(h.windowsMode==='datacenter'?1:Math.max(1,Math.ceil(oses/2)));
}
export function billableSql(h:Host,w:Workload,s:Sql,channel:'arc'|'annual'){
 const c=w.kind==='physical'?h.sockets*h.coresPerSocket:w.cores;
 const min=channel==='annual'&&w.kind==='physical'?h.sockets*4:4;
 let n=Math.max(min,c);if(channel==='arc'&&s.edition==='Standard')n=Math.min(24,n);
 return (channel==='annual'?round2(n):n)*w.quantity*h.quantity;
}
export type Line={id:string;label:string;family:Family;version:string;edition:string;units:number;unitLabel:string;rate:number|null;coverage:Coverage;members:string[];host:Host;eligibility:boolean;free:boolean;notes:string[];status:string;annualKey:string;entitlement:string};
export type Charge={lineId:string;label:string;date:string;end:string;kind:'esu'|'catchup'|'prior'|'annual'|'base';amount:number;detail:string};
export type Estimate={lines:Line[];charges:Charge[];months:{date:string;label:string;esu:number;catchup:number;annual:number;base:number;total:number}[];total:number;recurring:number;catchup:number;prior:number;annual:number;base:number;warnings:string[];missing:string[];coverageGaps:string[];complete:boolean;end:string};
function coverageEqual(a:Coverage,b:Coverage){return a.mode===b.mode&&a.paidThrough===b.paidThrough&&a.priorYears===b.priorYears;}
export function makeLines(s:State,channel:'arc'|'annual'):Line[]{
 const lines:Line[]=[];
 for(const h of s.hosts){
  const ws=s.workloads.filter(w=>w.hostId===h.id);
  const groups=new Map<string,Workload[]>();
  for(const w of ws.filter(w=>w.osVersion!=='none')){
   const ed=h.windowsMode==='datacenter'?'Datacenter':h.windowsMode==='standard'?'Standard':channel==='arc'&&w.kind==='vm'?'Standard':w.osEdition;
   const k=h.windowsMode==='vm'?`${w.id}-${ed}`:`${w.osVersion}-${ed}`;
   groups.set(k,[...(groups.get(k)||[]),w]);
  }
  for(const [k,g] of groups){
   const w=g[0],version=w.osVersion,edition=h.windowsMode==='datacenter'?'Datacenter':h.windowsMode==='standard'?'Standard':channel==='arc'&&w.kind==='vm'?'Standard':w.osEdition;
   const key=`windows-${version.startsWith('2012')?'2012':version}-${edition}`,p=programFor('windows',version),notes:string[]=[];
   const free=version.startsWith('2012')&&(h.location==='azure'||h.location==='azurelocal'&&h.azureVerified);
   const eligibility=free||g.every(x=>['sa','subscription','spla','payg'].includes(x.osEntitlement));
   if(!eligibility)notes.push('Active SA or qualifying server subscription/SPLA is required.');
   if(h.windowsMode==='standard')notes.push('Standard physical stacking needs agreement confirmation; full host cores are repeated for each two OSEs.');
   if(h.windowsMode!=='vm'&&!h.rightsConfirmed)notes.push('Confirm underlying host virtualization rights.');
   if(g.some(x=>!coverageEqual(x.coverage,w.coverage)))notes.push('Pooled workloads have different coverage histories. Split into separate host groups.');
   lines.push({id:`w-${h.id}-${k}`,label:h.windowsMode==='vm'?w.name:`${h.name} · Windows pool`,family:'windows',version,edition,units:billableWindows(h,g,channel),unitLabel:h.windowsMode==='vm'&&w.kind==='vm'?'virtual cores':'physical cores',rate:s.prices.meters[key]?.rate??null,coverage:w.coverage,members:g.map(x=>x.id),host:h,eligibility,free,notes,status:statusFor(p,s.start),annualKey:key,entitlement:w.osEntitlement});
  }
  const sqlGroups=new Map<string,{w:Workload;sq:Sql}[]>();
  for(const w of ws)for(const sq of w.sql){
   const k=h.sqlMode==='enterprise'&&w.kind==='vm'?sq.version:`${w.id}-${sq.version}`;
   sqlGroups.set(k,[...(sqlGroups.get(k)||[]),{w,sq}]);
  }
  for(const [k,g] of sqlGroups){
   const pooled=h.sqlMode==='enterprise'&&g[0].w.kind==='vm';
   const order=['Express','Web','Developer','Standard','Enterprise'];
   const first=[...g].sort((a,b)=>order.indexOf(b.sq.edition)-order.indexOf(a.sq.edition))[0];
   const {w,sq}=first;const edition=pooled?'Enterprise':sq.edition,version=sq.version,key=`sql-${version}-${edition}`;
   const free=(version==='2014'&&(h.location==='azure'||h.location==='azurelocal'&&h.azureVerified))||(!pooled&&(edition==='Developer'||g.every(x=>x.sq.exempt&&x.w.sql.every(q=>q.exempt))));
   const eligibility=free||g.every(x=>['sa','subscription','payg'].includes(x.sq.entitlement));
   const notes:string[]=[];
   if(g.some(x=>x.sq.exempt&&!x.w.sql.every(q=>q.exempt)))notes.push('Passive/dev-test exemption not applied: every SQL installation on the OSE must be confirmed eligible.');
   if(!eligibility)notes.push('Arc requires SA/subscription or SQL PAYG; Server+CAL needs a separately validated annual offer.');
   if(['Web','Express'].includes(edition)&&!free)notes.push('No paid Standard/Enterprise ESU mapping is assumed for this edition.');
   if(pooled&&(h.location!=='onprem'&&h.location!=='azurelocal'))notes.push('Physical unlimited virtualization is not modeled on listed-provider infrastructure.');
   if(pooled&&!h.rightsConfirmed)notes.push('Confirm Enterprise unlimited virtualization entitlement and Arc scope configuration.');
   if(edition==='Standard'&&w.cores>24)notes.push('Arc Standard uses the documented 24-core cap. Validate larger OSEs and edition projection.');
   if(g.some(x=>!coverageEqual(x.sq.coverage,sq.coverage)))notes.push('Pooled workloads have different coverage histories. Split into separate host groups.');
   lines.push({id:`s-${h.id}-${k}`,label:pooled?`${h.name} · SQL ${version} pool`:w.name,family:'sql',version,edition,units:pooled?Math.max(16,h.sockets*h.coresPerSocket)*h.quantity:billableSql(h,w,sq,channel),unitLabel:pooled||w.kind==='physical'?'physical cores':'virtual cores',rate:s.prices.meters[key]?.rate??null,coverage:sq.coverage,members:[...new Set(g.map(x=>x.w.id))],host:h,eligibility,free,notes,status:statusFor(programFor('sql',version),s.start),annualKey:key,entitlement:sq.entitlement});
  }
 }
 return lines;
}
export function estimate(s:State,channel:'arc'|'annual'='arc',cutoffs:Record<string,string>={}):Estimate{
 const end=addMonths(s.start,s.months),lines=makeLines(s,channel),charges:Charge[]=[],missing:string[]=[],warnings:string[]=[],coverageGaps:string[]=[];
 if(lines.length&&!s.eligibilityConfirmed)missing.push('Confirm required SA/subscription, CAL/connector coverage and current service packs in Rates & agreements.');
 const add=(l:Line,date:string,to:string,kind:Charge['kind'],amount:number,detail:string)=>{if(amount>0)charges.push({lineId:l.id,label:`${l.label} · ${l.family==='sql'?'SQL':'Windows'} ${l.version}`,date,end:to,kind,amount,detail});};
 for(const l of lines){
  const p=programFor(l.family,l.version);const stop=minD(end,cutoffs[l.id]||end);const label=`${l.label} / ${l.family} ${l.version}`;
  if(s.start<'2026-10-15')warnings.push('Historical planning uses the loaded price book, not an archived invoice price history.');
  if(stop<=s.start)continue;
  warnings.push(...l.notes.map(n=>`${label}: ${n}`));
  if(l.notes.some(n=>/different coverage|Confirm underlying|Confirm Enterprise|not modeled/.test(n)))missing.push(`${label}: licensing configuration needs confirmation`);
  if(!p){missing.push(`${label}: unrecognized version`);continue;}
  if(l.status==='expired'){coverageGaps.push(`${label}: ESU program has ended; no purchasable future coverage.`);continue;}
  if(!p.bounds.length){if(stop>addDays(p.eos,1))missing.push(`${label}: horizon crosses end of support; future ESU offer is unpriced.`);continue;}
  if(p.end<stop)coverageGaps.push(`${label}: ESU ends ${addDays(p.end,-1)} within this forecast.`);
  if(p.provisional&&stop>'2028-01-01')missing.push(`${label}: later WS2016 annual boundaries are provisional (January anniversaries); obtain confirmed dates.`);
  if(l.free){if(l.edition==='Developer')warnings.push(`${label}: zero-billed Developer edition still needs a qualifying nonproduction ESU entitlement; this is not a standalone production ESU offer.`);continue;}
  if(!l.eligibility){missing.push(`${label}: missing eligible license entitlement`);continue;}
  if(l.edition==='Express'||l.edition==='Web'){missing.push(`${label}: edition requires licensing review`);continue;}
  const active=maxD(s.start,p.bounds[0]),finish=minD(stop,p.end);
  if(finish<=active)continue;
  const y=p.bounds.findIndex((b,i)=>i<3&&active>=b&&active<p.bounds[i+1]);
  const annual=s.prices.annual[l.annualKey]||[null,null,null];
  const annualCharge=(yr:number,date:string,kind:'prior'|'annual')=>{
   if(annual[yr]===null||annual[yr]===undefined){missing.push(`${label}: year ${yr+1} annual quote missing`);return;}
   add(l,date,date,kind,annual[yr]!*l.units*(1-s.annualDiscount/100),`${l.units} cores × $${annual[yr]} per core for ESU year ${yr+1}; no proration`);
  };
  const paid=Math.max(0,Math.min(3,l.coverage.priorYears));
  if(channel==='annual'){
   for(let yr=0;yr<3;yr++)if(yr>=paid&&p.bounds[yr]<finish){annualCharge(yr,yr<y?s.start:maxD(active,p.bounds[yr]),yr<y?'prior':'annual');}
  }else{
   if(l.rate===null){missing.push(`${label}: hourly ESU rate missing`);continue;}
   if(l.coverage.mode==='annual'&&l.family==='windows'&&l.version==='2016'){missing.push(`${label}: Windows 2016 VL-to-Arc transition is unsupported`);continue;}
   if(l.family==='sql')for(let yr=paid;yr<y;yr++)annualCharge(yr,s.start,'prior');
   let backStart=l.family==='windows'?p.eos:p.bounds[y];
   if(l.family==='windows'&&l.version.startsWith('2012'))backStart='2023-10-10';
   if(l.coverage.mode==='arc'&&l.coverage.paidThrough)backStart=maxD(backStart,addDays(l.coverage.paidThrough,1));
   if(active>s.start)backStart=active; // pre-enrollment does not create catch-up
   const backRate=s.prices.meters[l.annualKey+'-back']?.rate??l.rate;
   const backHours=hours(backStart,active);
   if(backHours)add(l,s.start,s.start,'catchup',backHours*l.units*backRate*(1-s.backDiscount/100),`${backHours} hours × ${l.units} cores × $${backRate}; ${backStart} to ${active} (exclusive)`);
   let date=active;
   while(date<finish){const next=minD(finish,iso(Date.UTC(new Date(stamp(date)).getUTCFullYear(),new Date(stamp(date)).getUTCMonth()+1,1)));const hrs=hours(date,next);add(l,date,next,'esu',hrs*l.units*l.rate*(1-s.discount/100),`${hrs} hours × ${l.units} cores × $${l.rate}`);date=next;}
  }
 }
 // Base SQL software is licensed once per OSE (or eligible host pool), not once per ESU version.
 const baseGroups=new Map<string,{h:Host;w:Workload;sq:Sql}[]>();
 for(const h of s.hosts)for(const w of s.workloads.filter(w=>w.hostId===h.id)){
  const payg=w.sql.filter(q=>q.entitlement==='payg'&&['Standard','Enterprise'].includes(q.edition));
  if(!payg.length||w.sql.every(q=>q.exempt))continue;
  const key=h.sqlMode==='enterprise'&&w.kind==='vm'?`host-${h.id}`:`ose-${w.id}`;
  for(const sq of payg)baseGroups.set(key,[...(baseGroups.get(key)||[]),{h,w,sq}]);
 }
 for(const [key,g] of baseGroups){
  const {h,w}=g[0],pooled=key.startsWith('host-');
  const edition=pooled||g.some(x=>x.sq.edition==='Enterprise')?'Enterprise':'Standard';
  const ids=new Set(g.map(x=>x.w.id));
  const related=lines.filter(l=>l.family==='sql'&&l.members.some(id=>ids.has(id)));
  if(!related.length)continue;
  const line=related.find(l=>l.edition===edition)||related[0];
  const finish=minD(end,...(related.every(l=>cutoffs[l.id])?[maxD(...related.map(l=>cutoffs[l.id]))]:[end]));
  const r=s.prices.meters[`sql-base-${edition}`]?.rate;
  if(r===undefined){missing.push(`${w.name}: base SQL PAYG rate missing`);continue;}
  const units=pooled?Math.max(16,h.sockets*h.coresPerSocket)*h.quantity:billableSql(h,w,{...g[0].sq,edition},'arc');
  add(line,s.start,finish,'base',hours(s.start,finish)*units*r*(1-s.discount/100),`Base SQL ${edition} PAYG once per OSE/host pool: ${units} cores × $${r}/hour; separate from each version's ESU`);
 }
 const months:Estimate['months']=[];let date=s.start;
 while(date<end){const next=minD(end,iso(Date.UTC(new Date(stamp(date)).getUTCFullYear(),new Date(stamp(date)).getUTCMonth()+1,1)));const row={date,label:new Date(stamp(date)).toLocaleDateString('en-US',{month:'short',year:'2-digit',timeZone:'UTC'}),esu:0,catchup:0,annual:0,base:0,total:0};
  for(const c of charges){let amount=0;if(c.date===c.end)amount=c.date>=date&&c.date<next?c.amount:0;else amount=c.amount*hours(maxD(date,c.date),minD(next,c.end))/hours(c.date,c.end);if(c.kind==='esu')row.esu+=amount;else if(c.kind==='base')row.base+=amount;else if(c.kind==='catchup'||c.kind==='prior')row.catchup+=amount;else row.annual+=amount;}
  row.total=row.esu+row.catchup+row.annual+row.base;months.push(row);date=next;
 }
 const sum=(k:Charge['kind'])=>charges.filter(c=>c.kind===k).reduce((n,c)=>n+c.amount,0);
 const recurring=sum('esu'),catchup=sum('catchup'),prior=sum('prior'),annual=sum('annual'),base=sum('base');
 return {lines,charges,months,total:recurring+catchup+prior+annual+base,recurring,catchup,prior,annual,base,warnings:[...new Set(warnings)],missing:[...new Set(missing)],coverageGaps:[...new Set(coverageGaps)],complete:missing.length===0&&coverageGaps.length===0,end};
}
export function miCost(s:State){
 const m=s.mi,meters=s.prices.meters,missing:string[]=[];
 const get=(key:string,override?:number|null)=>{const n=override??meters[key]?.rate;if(n===undefined){missing.push(`Missing ${key} meter for ${s.prices.region}`);return 0;}return n;};
 const totalCores=m.instances*m.vcores;
 const ratio=m.ahbEdition==='Enterprise'?(m.tier==='gp'?4:1):(m.tier==='gp'?1:0.25);
 const requiredCores=Math.ceil(totalCores/ratio);
 const ahbValid=m.ahb&&m.ahbConfirmed&&m.ahbCores>=requiredCores;
 if(m.ahb&&!ahbValid)missing.push(`AHB requires ${requiredCores} eligible ${m.ahbEdition} cores and confirmed allocation; license-included pricing is retained.`);
 let computeRate=0,commitment=0;
 if(m.term==='payg')computeRate=get(`mi-${m.tier}-compute`,m.computeOverride);
 else{const duration=m.term==='one'?12:36;commitment=get(`mi-${m.tier}-${m.term}`,m.computeOverride)*totalCores;computeRate=commitment/(duration*730*totalCores);}
 const zone=m.zone?get(`mi-${m.tier}-zone`)*totalCores*730:0;
 const compute=computeRate*totalCores*730,license=ahbValid?0:get(`mi-${m.tier}-license`,m.licenseOverride)*totalCores*730;
 const billableGB=Math.max(0,Math.ceil(m.storageGB/32)*32-32);
 const storage=get(`mi-${m.tier}-storage${m.zone?'-zone':''}`,m.storageOverride)*billableGB*m.instances;
 const backup=get('mi-backup',m.backupOverride)*m.backupGB*m.instances;
 const monthly=compute+license+zone+storage+backup+m.extrasMonthly+m.saMonthly;
 return {compute,license,zone,storage,backup,monthly,commitment,requiredCores,ahbValid,totalCores,missing,complete:missing.length===0,computeRate};
}
export function migration(s:State){
 const base=estimate(s),mi=miCost(s),cutoffs:Record<string,string>={},partialPools:string[]=[];
 const selected=s.workloads.filter(w=>w.migrate&&w.sql.length>0);const selectedIds=new Set(selected.map(w=>w.id));
 for(const l of base.lines){
  const chosen=l.members.filter(id=>selectedIds.has(id)&&(l.family==='sql'||s.workloads.find(w=>w.id===id)?.retireOS));
  if(chosen.length===l.members.length&&chosen.length)cutoffs[l.id]=addDays(maxD(s.start,s.mi.cutover),l.family==='windows'?s.mi.windowsLagDays:0);
  else if(chosen.length)partialPools.push(`${l.label}: shared physical license stays billed until all covered OSEs leave.`);
 }
 const residual=estimate(s,'arc',cutoffs),cut=maxD(s.start,s.mi.cutover),end=base.end;
 const activeMonths=hours(cut,end)/730;
 const overlap=Math.max(0,(Math.min(stamp(cut),stamp(end))-Math.max(stamp(s.start),stamp(cut)-s.mi.overlapMonths*730*3600000))/3600000/730);
 const modeledMonths=hours(s.start,end)/730;
 const baseOperations=(s.costs.otherMonthly+s.costs.saMonthly)*modeledMonths+s.costs.oneTime;
 const retainedOperations=baseOperations-(s.mi.baselineAvoidableMonthly+s.mi.baselineSaMonthly)*activeMonths;
 const targetMonths=activeMonths+overlap;
 const miRun=targetMonths>0?(s.mi.term==='payg'?mi.monthly*targetMonths:(mi.monthly-mi.compute)*targetMonths+mi.commitment):0,oneTime=cut<end?s.mi.migrationCost:0;
 const current=base.total+baseOperations,target=residual.total+retainedOperations+miRun+oneTime;
 const savings=current-target;const esuAvoided=base.recurring-residual.recurring;
 const recurringMonthlySaving=activeMonths>0?(base.recurring-residual.recurring+base.base-residual.base)/activeMonths+s.mi.baselineAvoidableMonthly+s.mi.baselineSaMonthly-mi.monthly:0;
 const payback=recurringMonthlySaving>0&&s.mi.term==='payg'?(oneTime+mi.monthly*overlap)/recurringMonthlySaving:null;
 const complete=base.complete&&residual.complete&&mi.complete&&selected.length>0&&cut<end&&s.mi.baselineAvoidableMonthly<=s.costs.otherMonthly&&s.mi.baselineSaMonthly<=s.costs.saMonthly;
 return {base,residual,mi,current,target,savings,esuAvoided,payback,activeMonths,overlap,modeledMonths,baseOperations,retainedOperations,miRun,oneTime,selected,partialPools,complete};
}
export const money=(n:number,digits=0)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:digits}).format(n);
