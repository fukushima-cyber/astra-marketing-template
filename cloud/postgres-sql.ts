// SQLite compatibility for the application's existing, server-owned SQL only.
// Values always remain bind parameters; this is never an endpoint for arbitrary SQL.
import {migrationTables} from './migration-tables.ts';
const jsonNames=new Set(['json_extract','json_set','json_each','json']);
function closing(sql:string,start:number){let depth=1,quote='';for(let i=start+1;i<sql.length;i++){const c=sql[i];if(quote){if(c===quote){if(sql[i+1]===quote)i++;else quote='';}continue;}if(c==="'"||c==='"'){quote=c;continue;}if(c==='(')depth++;if(c===')'&&!--depth)return i;}throw new Error('Unclosed SQL function');}
function argumentsOf(sql:string){const args:string[]=[];let start=0,depth=0,quote='';for(let i=0;i<sql.length;i++){const c=sql[i];if(quote){if(c===quote){if(sql[i+1]===quote)i++;else quote='';}continue;}if(c==="'"||c==='"'){quote=c;continue;}if(c==='(')depth++;if(c===')')depth--;if(c===','&&!depth){args.push(sql.slice(start,i).trim());start=i+1;}}args.push(sql.slice(start).trim());return args;}
function path(literal:string){if(!/^'\$\.[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*'$/.test(literal))throw new Error('Unsupported JSON path');return 'ARRAY['+literal.slice(3,-1).split('.').map(s=>"'"+s+"'").join(',')+']';}
function rewrite(sql:string):string{let out='',quote='';for(let i=0;i<sql.length;){const c=sql[i];if(quote){out+=c;i++;if(c===quote){if(sql[i]===quote){out+=sql[i++];}else quote='';}continue;}if(c==="'"||c==='"'){quote=c;out+=c;i++;continue;}const match=/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(sql.slice(i));if(match&&jsonNames.has(match[1].toLowerCase())){const open=i+match[0].lastIndexOf('('),end=closing(sql,open),args=argumentsOf(sql.slice(open+1,end)),name=match[1].toLowerCase();const a=args.map(rewrite);let value:string;
 if(name==='json_each'){if(a.length!==1)throw new Error('Unsupported json_each');value='astra.json_each('+a[0]+')';}
 else if(name==='json'){if(a.length!==1)throw new Error('Unsupported json');value='('+a[0]+')::jsonb';}
 else if(name==='json_extract'){if(a.length!==2)throw new Error('Unsupported json_extract');const p=path(args[1]),extract='(('+a[0]+')::jsonb #>> '+p+')';
  if(args[1]==="'$.edit'")value='CASE WHEN '+extract+"='true' THEN 1 WHEN "+extract+"='false' THEN 0 ELSE ("+extract+')::bigint END';
  else if(args[1].startsWith("'$.values.")||args[1]==="'$.nextAt'")value='('+extract+')::numeric';
  else if(args[1]==="'$.projects'")value="NULLIF((("+a[0]+')::jsonb #> '+p+")::text,'null')";
  else value=extract;
 }else{if(a.length<3||a.length%2!==1)throw new Error('Unsupported json_set');value='('+a[0]+')::jsonb';for(let k=1;k<a.length;k+=2){const replacement=/^json\s*\(/i.test(args[k+1])?a[k+1]:'to_jsonb(('+a[k+1]+')::text)';value='jsonb_set('+value+','+path(args[k])+','+replacement+',true)';}value='('+value+')::text';}
 out+=value;i=end+1;continue;}out+=c;i++;}return out;}
export function postgresSql(source:string){if(/;|--|\/\*/.test(source))throw new Error('Only single server-owned SQL statements are supported');let sql=rewrite(source),ignore=/^\s*INSERT\s+OR\s+IGNORE\s+/i.test(sql);sql=sql.replace(/^\s*INSERT\s+OR\s+IGNORE\s+/i,'INSERT ');if(ignore)sql+=' ON CONFLICT DO NOTHING';sql=sql.replace(/SET attempts=attempts\+1/g,'SET attempts=login_limits.attempts+1');sql=sql.replace(/\bAS\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,(all,name:string)=>/[A-Z]/.test(name)?'AS "'+name+'"':all);
 let out='',quote='',n=0;for(let i=0;i<sql.length;i++){const c=sql[i];if(quote){out+=c;if(c===quote){if(sql[i+1]===quote)out+=sql[++i];else quote='';}continue;}if(c==="'"||c==='"'){quote=c;out+=c;continue;}out+=c==='?'?'$'+(++n):c;}
 out=out.replace(/\b(FROM|JOIN|INTO|UPDATE)\s+("?[a-z_]+"?)/gi,(all,key:string,table:string)=>migrationTables.includes(table.replace(/"/g,'') as typeof migrationTables[number])||table==='scheduler_state'?key+' astra.'+table:all);
 out=out.replace(/\bemail\s*=\s*(\$\d+)/gi,'email OPERATOR(extensions.=) $1');
 out=out.replace(/(\$\d+)\s+IS\s+(NOT\s+)?NULL/gi,'$1::text IS $2NULL');return {sql:out,parameters:n};}
