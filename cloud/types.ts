export interface Statement {bind(...args:unknown[]):Statement;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>;run():Promise<{meta:{changes:number}}>}
export interface Database {prepare(sql:string):Statement;batch(statements:Statement[]):Promise<unknown[]>}
export interface Env {ASTRA_LOOP?:{getByName(name:string):{wake(scope:string):Promise<void>}};ASTRA_OPENAI_KEY?:string;ASTRA_SCHEDULE_ENABLED?:string; ASTRA_MODEL?:string;CONNECTOR_KEY?:string;DB:Database;ASSETS:{fetch(request:Request):Promise<Response>};ADMIN_PASSWORD:string;SESSION_SECRET:string}
