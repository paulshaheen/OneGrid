import snapshot from './retail-snapshot.json';
import {parseRates, type RetailItem} from './rates';
import {newCoverage, type State} from './model';
export function initialState(sample=true):State {
 const coverage=()=>({...newCoverage(),mode:'arc' as const,paidThrough:'2026-10-14',priorYears:2});
 return {schema:1,eligibilityConfirmed:sample,customer:sample?'Contoso Energy':'Your organization',sample,start:'2026-10-15',months:6,discount:0,backDiscount:0,annualDiscount:0,tax:0,costs:{saMonthly:0,otherMonthly:0,oneTime:0},
 prices:parseRates(snapshot.items as RetailItem[],'eastus',snapshot.retrievedAt),
 hosts:sample?[{id:'host-1',name:'Production cluster',quantity:2,sockets:2,coresPerSocket:12,location:'onprem',azureVerified:false,windowsMode:'vm',sqlMode:'vm',rightsConfirmed:true},{id:'host-2',name:'Regional applications',quantity:1,sockets:2,coresPerSocket:8,location:'onprem',azureVerified:false,windowsMode:'vm',sqlMode:'vm',rightsConfirmed:true}]:[],
 workloads:sample?[
 {id:'w1',hostId:'host-1',name:'Finance SQL',kind:'vm',quantity:2,cores:8,osVersion:'2016',osEdition:'Datacenter',osEntitlement:'sa',coverage:newCoverage(),sql:[{id:'s1',version:'2016',edition:'Enterprise',entitlement:'sa',exempt:false,coverage:{...coverage(),priorYears:0}}],migrate:true,retireOS:true},
 {id:'w2',hostId:'host-1',name:'Operations SQL',kind:'vm',quantity:2,cores:4,osVersion:'2016',osEdition:'Standard',osEntitlement:'sa',coverage:newCoverage(),sql:[{id:'s2',version:'2014',edition:'Standard',entitlement:'sa',exempt:false,coverage:coverage()}],migrate:true,retireOS:true},
 {id:'w3',hostId:'host-2',name:'Application services',kind:'vm',quantity:6,cores:4,osVersion:'2016',osEdition:'Standard',osEntitlement:'subscription',coverage:newCoverage(),sql:[],migrate:false,retireOS:false}
 ]:[],
 mi:{enabled:true,instances:2,vcores:8,storageGB:512,backupGB:100,tier:'gp',term:'payg',ahb:false,ahbEdition:'Enterprise',ahbCores:4,ahbConfirmed:false,readiness:false,zone:false,computeOverride:null,licenseOverride:null,storageOverride:null,backupOverride:null,extrasMonthly:0,saMonthly:0,baselineAvoidableMonthly:0,baselineSaMonthly:0,migrationCost:0,overlapMonths:1,windowsLagDays:5,cutover:'2027-01-15',otherTargetMonthly:0,otherMigrationCost:0,baselineReviewed:false}};
}
