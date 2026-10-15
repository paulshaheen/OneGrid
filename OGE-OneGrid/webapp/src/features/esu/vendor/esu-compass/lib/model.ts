export type Family = 'windows'|'sql';
export type Entitlement = 'sa'|'subscription'|'spla'|'payg'|'none'|'servercal';
export type Coverage = { mode: 'new'|'arc'|'annual'; paidThrough: string; priorYears: number };
export type Sql = { id:string; version:string; edition:'Standard'|'Enterprise'|'Developer'|'Express'|'Web'; entitlement:Entitlement; exempt:boolean; coverage:Coverage };
export type Workload = { id:string; hostId:string; name:string; kind:'vm'|'physical'; quantity:number; cores:number; osVersion:string; osEdition:'Standard'|'Datacenter'; osEntitlement:Entitlement; coverage:Coverage; sql:Sql[]; migrate:boolean; retireOS:boolean };
export type Host = { id:string; name:string; quantity:number; sockets:number; coresPerSocket:number; location:'onprem'|'azure'|'azurelocal'|'other'; azureVerified:boolean; windowsMode:'vm'|'standard'|'datacenter'; sqlMode:'vm'|'enterprise'; rightsConfirmed:boolean };
export type Meter = {key:string; name:string; rate:number; unit:string; meterId:string; effectiveStart:string; source:string};
export type PriceBook = {checked:string; region:string; meters:Record<string,Meter>; annual:Record<string,[number|null,number|null,number|null]>; notes:string};
export type MI = { enabled:boolean; instances:number; vcores:number; storageGB:number; backupGB:number; tier:'gp'|'bc'; term:'payg'|'one'|'three'; ahb:boolean; ahbEdition:'Standard'|'Enterprise'; ahbCores:number; ahbConfirmed:boolean; readiness:boolean; zone:boolean; computeOverride:number|null; licenseOverride:number|null; storageOverride:number|null; backupOverride:number|null; extrasMonthly:number; saMonthly:number; baselineAvoidableMonthly:number; baselineSaMonthly:number; migrationCost:number; overlapMonths:number; windowsLagDays:number; cutover:string; otherTargetMonthly:number; otherMigrationCost:number; baselineReviewed:boolean };
export type State = {schema:1; eligibilityConfirmed:boolean; customer:string; sample:boolean; hosts:Host[]; workloads:Workload[]; start:string; months:number; discount:number; backDiscount:number; annualDiscount:number; prices:PriceBook; mi:MI; tax:number; costs:{saMonthly:number;otherMonthly:number;oneTime:number}};
export type Program = {family:Family; version:string; eos:string; bounds:string[]; end:string; provisional?:boolean};
export const programs:Program[]=[
 {family:'windows',version:'2008 R2',eos:'2020-01-14',bounds:['2020-01-15','2021-01-13','2022-01-12','2023-01-11'],end:'2023-01-11'},
 {family:'windows',version:'2012',eos:'2023-10-10',bounds:['2023-10-11','2024-10-09','2025-10-15','2026-10-14'],end:'2026-10-14'},
 {family:'windows',version:'2012 R2',eos:'2023-10-10',bounds:['2023-10-11','2024-10-09','2025-10-15','2026-10-14'],end:'2026-10-14'},
 {family:'windows',version:'2016',eos:'2027-01-12',bounds:['2027-01-13','2028-01-13','2029-01-13','2030-01-13'],end:'2030-01-13',provisional:true},
 {family:'windows',version:'2019',eos:'2029-01-09',bounds:[],end:''},
 {family:'windows',version:'2022',eos:'2031-10-14',bounds:[],end:''},
 {family:'windows',version:'2025',eos:'2034-11-14',bounds:[],end:''},
 {family:'sql',version:'2012',eos:'2022-07-12',bounds:['2022-07-13','2023-07-12','2024-07-10','2025-07-09'],end:'2025-07-09'},
 {family:'sql',version:'2014',eos:'2024-07-09',bounds:['2024-07-10','2025-07-09','2026-07-15','2027-07-13'],end:'2027-07-13'},
 {family:'sql',version:'2016',eos:'2026-07-14',bounds:['2026-07-15','2027-07-14','2028-07-19','2029-07-18'],end:'2029-07-18'},
 {family:'sql',version:'2017',eos:'2027-10-12',bounds:[],end:''},
 {family:'sql',version:'2019',eos:'2030-01-08',bounds:[],end:''},
 {family:'sql',version:'2022',eos:'2033-01-11',bounds:[],end:''},
 {family:'sql',version:'2025',eos:'2036-01-06',bounds:[],end:''}
];
export const sources=[
 ['Pricing policy · April 2026','https://www.microsoft.com/en-us/licensing/news/services-pricing-consistency-update','New 2016 ESU offers remain paid in Azure and Azure Local. Older offers retain their existing rules.'],
 ['Windows Server core licensing','https://learn.microsoft.com/en-us/azure/azure-arc/servers/license-extended-security-updates','Arc Windows: 8 virtual cores per VM or at least 16 physical cores per host. Virtual licensing uses Standard ESU. SA or qualifying subscription is separate.'],
 ['Windows Server billing','https://learn.microsoft.com/en-us/azure/azure-arc/servers/billing-extended-security-updates','Activated license resources keep billing until reduced or deactivated. Late enrollment and reactivation create catch-up charges; reductions can take up to five days.'],
 ['SQL ESU metering and eligibility','https://learn.microsoft.com/en-us/sql/sql-server/azure-arc/extended-security-updates','Group SQL by operating-system environment and version, using the highest edition. Different eligible versions are charged separately. Prior-year coverage must be established.'],
 ['SQL licensing and passive replicas','https://learn.microsoft.com/en-us/sql/sql-server/azure-arc/manage-license-billing','Server+CAL is not an Arc ESU entitlement. Passive and nonproduction exemptions need verified eligibility; a DR label alone is insufficient.'],
 ['SQL ESU questions','https://learn.microsoft.com/en-us/sql/sql-server/end-of-support/extended-security-updates-frequently-asked-questions','SQL 2016 Azure ESU is paid. The newer FAQ gives July 15, 2026 as its billing start.'],
 ['Required CAL and connector coverage','https://learn.microsoft.com/en-us/lifecycle/faq/sql-server-extended-security-updates','Required CALs and external connector licenses need qualifying active SA or equivalent subscriptions. Enter those costs separately; CALs do not receive their own ESU update license.'],
 ['Microsoft product lifecycle','https://learn.microsoft.com/en-us/lifecycle/faq/extended-security-updates','ESU terms are product-specific, not calendar years. Expired programs do not restart after migration.'],
 ['SQL 2014 lifecycle','https://learn.microsoft.com/en-us/lifecycle/products/sql-server-2014','Final coverage date: July 12, 2027. This planner prefers the product lifecycle record over the conflicting SQL FAQ date.'],
 ['SQL 2016 lifecycle','https://learn.microsoft.com/en-us/lifecycle/products/sql-server-2016','ESU final coverage date: July 17, 2029.'],
 ['Azure Local ESU','https://learn.microsoft.com/en-us/azure/azure-local/manage/azure-benefits-esu','SQL 2014 retains qualifying free ESU. Azure verification is required. SQL 2016 and Windows Server 2016 follow paid pricing.'],
 ['Managed Instance pricing','https://azure.microsoft.com/en-us/pricing/details/azure-sql-managed-instance/single/','MI has separate compute, licensing, storage and backup costs. Regional retail rates are estimates, not customer agreement quotes.'],
 ['Azure Hybrid Benefit','https://learn.microsoft.com/en-us/azure/azure-sql/azure-hybrid-benefit','Qualifying SQL core licenses can cover MI licensing; edition and tier determine the conversion. The migration allowance is 180 days.'],
 ['Azure reservations','https://learn.microsoft.com/en-us/azure/azure-sql/database/reservations-discount-overview','Reserved compute does not cover software, storage or networking. Commitment costs continue even when capacity is unused.'],
 ['Azure Migrate assessment','https://learn.microsoft.com/en-us/azure/migrate/tutorial-assess-sql','Validate compatibility and performance-based target sizing before treating the migration estimate as a business case.'],
 ['Azure Retail Prices API','https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices','Public, unauthenticated retail meters. The app records meter IDs, units and effective dates; negotiated prices can be entered separately.'],
 ['WS2016 price correction','https://learn.microsoft.com/en-us/partner-center/announcements/2026-september','August 2026 CSP annual ESU prices were corrected in September. Enter a current per-year quote rather than infer percentages.']
];
export const newCoverage=():Coverage=>({mode:'new',paidThrough:'',priorYears:0});
export const uid=()=>Math.random().toString(36).slice(2,10);
export const newHost=():Host=>({id:uid(),name:'New host',quantity:1,sockets:2,coresPerSocket:8,location:'onprem',azureVerified:false,windowsMode:'vm',sqlMode:'vm',rightsConfirmed:false});
export const newWorkload=(hostId:string):Workload=>({id:uid(),hostId,name:'New workload',kind:'vm',quantity:1,cores:4,osVersion:'2016',osEdition:'Standard',osEntitlement:'sa',coverage:newCoverage(),sql:[],migrate:false,retireOS:false});
export const newSql=():Sql=>({id:uid(),version:'2016',edition:'Standard',entitlement:'sa',exempt:false,coverage:newCoverage()});
