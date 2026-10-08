export class BodyTooLarge extends Error {}
export async function boundedText(r:Request,limit:number){
 const reader=r.body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new BodyTooLarge('入力が大きすぎます。');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.byteLength;}return new TextDecoder().decode(bytes);
}
