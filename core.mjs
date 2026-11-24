export const areas=['account','uploads','studies','simulations','analysis','billing','privacy','other'];
export const statuses=['open','in_progress','waiting_on_customer','resolved'];
export const factorEnums={impact:['question','minor','degraded','blocked','outage'],scope:['unknown','one','several','all'],urgency:['unknown','routine','soon','immediate'],workaround:['unknown','yes','no'],risk:['none','suspected_security','suspected_data_loss']};
export function cleanFactors(value={}){return Object.fromEntries(Object.entries(factorEnums).map(([k,vs])=>[k,vs.includes(value[k])?value[k]:(k==='risk'?'none':'unknown')]));}
export function triage(raw){
 const f=cleanFactors(raw), reasons=[];
 if(f.risk!=='none')return {severity:1,label:'Critical',reason:'Suspected security or data-loss risk needs immediate human review; this is not a confirmed incident.'};
 if((f.impact==='outage'||f.impact==='blocked') && f.scope==='all' && f.workaround==='no')return {severity:1,label:'Critical',reason:'Work is blocked for all reported users with no workaround.'};
 let severity=3;
 if(f.impact==='blocked'||f.impact==='outage'){severity=2;reasons.push('Core work is blocked');}
 if(f.impact==='degraded'&&['several','all'].includes(f.scope)&&f.workaround==='no'){severity=2;reasons.push('Multiple users affected with no workaround');}
 if(f.urgency==='immediate'&&f.workaround==='no'&&f.impact!=='question'&&f.impact!=='minor'){severity=Math.min(severity,2);reasons.push('Immediate deadline and no workaround');}
 if(f.impact==='question'||f.impact==='minor'){severity=4;reasons.push('Guidance or a minor issue');}
 if(!reasons.length)reasons.push('Limited impact reported; severity can change as details arrive');
 return {severity,label:['','Critical','High','Normal','Low'][severity],reason:reasons.join('. ')+'.'};
}
export const outputSchema={type:'object',additionalProperties:false,properties:{
 answer:{type:'string'},needs_ticket:{type:'boolean'},subject:{type:'string'},summary:{type:'string'},area:{type:'string',enum:areas},
 expected:{type:'string'},actual:{type:'string'},next_action:{type:'string'},missing_information:{type:'array',items:{type:'string'}},
 tried:{type:'array',items:{type:'string'}},knowledge_ids:{type:'array',items:{type:'string'}},
 factors:{type:'object',additionalProperties:false,properties:Object.fromEntries(Object.entries(factorEnums).map(([k,v])=>[k,{type:'string',enum:v}])),required:Object.keys(factorEnums)}},
 required:['answer','needs_ticket','subject','summary','area','expected','actual','next_action','missing_information','tried','knowledge_ids','factors']};
export function validDiagnosis(d){return d&&typeof d.answer==='string'&&d.answer.trim()&&d.answer.length<=9000&&typeof d.needs_ticket==='boolean'&&areas.includes(d.area)&&['subject','summary','expected','actual','next_action'].every(k=>typeof d[k]==='string'&&d[k].length<=6000)&&['missing_information','tried','knowledge_ids'].every(k=>Array.isArray(d[k])&&d[k].length<=30&&d[k].every(v=>typeof v==='string'&&v.length<=2000))&&d.factors&&Object.entries(factorEnums).every(([k,vs])=>vs.includes(d.factors[k]));}
export function fallback(message,knowledge){
 const words=message.toLowerCase();
 const matched=knowledge.map(k=>({k,score:k.id==='research-background'?0:k.title.toLowerCase().split(/\W+/).filter(w=>w.length>3&&words.includes(w)).length})).sort((a,b)=>b.score-a.score)[0];
 return {answer:matched?.score ? matched.k.text+' If this does not help, describe what happened and I can record it for support.' : 'I can record this for support. What were you trying to do, and what happened instead?',
 needs_ticket:true,subject:'Customer support request',summary:message,area:'other',expected:'Not yet confirmed',actual:message,next_action:'Review the customer report; automated AI assistance was unavailable.',missing_information:['Impact and any safe error message'],tried:[],knowledge_ids:matched?.score?[matched.k.id]:[],factors:{impact:'degraded',scope:'unknown',urgency:'unknown',workaround:'unknown',risk:'none'}};
}
export function boundedHistory(messages){return messages.slice(-8).map(m=>({role:m.role==='assistant'?'assistant':'user',content:m.content.slice(0,6000)}));}
