export type BoardCard={id:string;type:'sticky'|'text'|'action';title:string;body:string;color:'yellow'|'blue'|'green'|'pink'|'white';x:number;y:number;width:number;height:number};
export type BoardEdge={id:string;from:string;to:string;label:string};
export type WhiteboardData={version:number;cards:BoardCard[];edges:BoardEdge[];updatedAt:string};
export const emptyWhiteboard:WhiteboardData={version:0,cards:[],edges:[],updatedAt:''};
const text=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max;
export function validateWhiteboard(value:unknown):WhiteboardData{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('ボードの内容を確認してください。');
 const board=value as WhiteboardData;if(!Number.isSafeInteger(board.version)||board.version<0||!Array.isArray(board.cards)||!Array.isArray(board.edges)||board.cards.length>200||board.edges.length>400)throw new Error('ボードの内容を確認してください。');
 if(new Set(board.cards.map(card=>card.id)).size!==board.cards.length||new Set(board.edges.map(edge=>edge.id)).size!==board.edges.length)throw new Error('ボードの部品が重複しています。');
 for(const card of board.cards)if(!text(card.id,100)||!card.id||!['sticky','text','action'].includes(card.type)||!text(card.title,100)||!text(card.body,2000)||!['yellow','blue','green','pink','white'].includes(card.color)||![card.x,card.y,card.width,card.height].every(Number.isFinite)||card.x<0||card.y<0||card.x>5000||card.y>5000||card.width<140||card.width>600||card.height<90||card.height>600)throw new Error('カードの内容や位置を確認してください。');
 for(const edge of board.edges)if(!text(edge.id,100)||!edge.id||!text(edge.label,100)||!board.cards.some(card=>card.id===edge.from)||!board.cards.some(card=>card.id===edge.to)||edge.from===edge.to)throw new Error('カードのつながりを確認してください。');
 return structuredClone(board);
}
