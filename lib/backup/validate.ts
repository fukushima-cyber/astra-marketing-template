import {tableFingerprint} from '../../cloud/database-migration.ts';
import {migrationTables} from '../../cloud/migration-tables.ts';
export async function validateBackup(value:unknown,project:string){
 const b=value as {format:string;project:string;at:string;tables:Record<string,Record<string,string|number|null>[]>;fingerprints:{table:string;count:number;sha256:string}[]};
 if(!b||b.format!=='astra-private-database-backup'||b.project!==project||!Number.isFinite(Date.parse(b.at))||!b.tables||!Array.isArray(b.fingerprints))throw new Error('Backup format or project mismatch');
 const names=[...migrationTables,'scheduler_state'].sort();if(JSON.stringify(Object.keys(b.tables).sort())!==JSON.stringify(names)||b.fingerprints.length!==names.length||new Set(b.fingerprints.map(f=>f.table)).size!==names.length)throw new Error('Backup table list mismatch');
 for(const name of names){const rows=b.tables[name],f=b.fingerprints.find(f=>f.table===name);if(!Array.isArray(rows)||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r))||!f||rows.length!==f.count||await tableFingerprint(rows)!==f.sha256)throw new Error('Backup fingerprint mismatch: '+name);}
 return b;
}
