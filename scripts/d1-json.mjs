// Some Wrangler versions emit upload progress before the JSON response for --file.
export function d1Json(output){for(let i=output.indexOf('[');i!==-1;i=output.indexOf('[',i+1)){try{const value=JSON.parse(output.slice(i));if(Array.isArray(value)&&value.every(v=>v&&typeof v==='object'&&('results'in v||'success'in v)))return value;}catch{}}throw new Error('D1の応答形式を読み取れませんでした。');}
