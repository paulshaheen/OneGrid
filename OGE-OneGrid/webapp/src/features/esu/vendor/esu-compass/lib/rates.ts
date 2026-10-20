import type {Meter,PriceBook} from './model';
export type RetailItem={productName:string;skuName:string;meterName:string;retailPrice:number;unitOfMeasure:string;type:string;armRegionName:string;meterId:string;effectiveStartDate:string;reservationTerm?:string};
export function parseRates(items:RetailItem[],region:string,checked:string):PriceBook {
 const meters:Record<string,Meter>={};
 const add=(key:string,product:string,sku:string,type='Consumption',term?:string,meter?:string)=>{
  const matches=items.filter(x=>x.productName===product&&x.skuName===sku&&x.type===type&&(!term||x.reservationTerm===term)&&(!meter||x.meterName===meter)&&(x.armRegionName===region||x.armRegionName==='Global')).sort((a,b)=>b.effectiveStartDate.localeCompare(a.effectiveStartDate));
  const x=matches[0];if(x&&Number.isFinite(x.retailPrice)) meters[key]={key,name:x.productName+' · '+x.meterName,rate:x.retailPrice,unit:x.unitOfMeasure,meterId:x.meterId,effectiveStart:x.effectiveStartDate.slice(0,10),source:'Azure Retail API'};
 };
 for(const v of ['2012','2016'])for(const e of ['Standard','Datacenter'])add(`windows-${v}-${e}`,'Azure Arc Extended Security Updates',`WS${v} ${e==='Standard'?'Std':'DC'} 1C`);
 for(const v of ['2014','2016'])for(const e of ['Standard','Enterprise']){
  const p='Azure Arc-enabled SQL Server - Arc-enabled servers',s=`${e==='Standard'?'Std':'Ent'} edition`;
  add(`sql-${v}-${e}`,p,`${s} - ESU ${v}`);add(`sql-${v}-${e}-back`,p,`${s} - ESU ${v} back billing`);add(`sql-base-${e}`,p,`${s} - PAYG`);
 }
 for(const t of ['gp','bc']){
  const label=t==='gp'?'General Purpose':'Business Critical',p=`SQL Managed Instance ${label}`;
  add(`mi-${t}-compute`,`${p} - Compute Gen5`,'vCore');
  add(`mi-${t}-one`,`${p} - Compute Gen5`,'vCore','Reservation','1 Year');
  add(`mi-${t}-three`,`${p} - Compute Gen5`,'vCore','Reservation','3 Years');
  add(`mi-${t}-zone`,`${p} - Compute Gen5`,'1 vCore Zone Redundancy');
  add(`mi-${t}-license`,`${p} - SQL License`,'vCore');
  add(`mi-${t}-storage`,`${p} - Storage`,label,'Consumption',undefined,`${label} Data Stored`);
  add(`mi-${t}-storage-zone`,`${p} - Storage`,`${label} Zone Redundancy`,'Consumption',undefined,`${label} Zone Redundancy Data Stored`);
 }
 add('mi-backup','SQL Managed Instance PITR Backup Storage','Backup LRS');
 return {checked,region,meters,annual:{},notes:''};
}
