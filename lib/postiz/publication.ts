import { PostizError, type PostizDraft } from './types.ts';
import type { MediaAsset } from './media.ts';
import { snsPlatform } from './platforms.ts';
export function publicationSpec(d:Partial<PostizDraft>){return {title:d.title??'',platform:d.platform??'',assetIds:d.assetIds??[],options:d.options??{}};}
export function validatePublication(d:PostizDraft,platform:string,assets:MediaAsset[],thumbnail?:MediaAsset){
 const bad=(message:string):never=>{throw new PostizError(message,'validation');};
 if(!snsPlatform(platform))bad('対象外のSNSです。');if(d.platform&&d.platform!==platform&&!(d.platform==='instagram'&&platform==='instagram-standalone'))bad('選択したSNSとアカウントが一致しません。');
 if(d.reviewState==='rejected'||d.reviewState==='changes')bad('差し戻し・却下された下書きは修正して保存してください。');
 const images=assets.filter(a=>a.mime.startsWith('image/')),videos=assets.filter(a=>a.mime==='video/mp4');
 if(platform==='x'||platform==='threads'){
  const max=platform==='x'?4:10;
  if(videos.length||images.length>max)bad(`この版の${snsPlatform(platform)?.name}投稿は画像${max}枚までに対応しています。`);
 }else if(platform.startsWith('instagram')){
  if(d.options?.format==='reel'){if(videos.length!==1||assets.length!==1)bad('リールにはMP4動画を1本選択してください。');}
  else if(d.options?.format==='post'){if(!images.length||images.length>10||videos.length)bad('画像投稿には画像を1〜10枚選択してください。');}
  else bad('Instagramの投稿形式を選択してください。');
 }else if(platform==='youtube'){
  if(videos.length!==1||assets.length!==1)bad('YouTubeにはMP4動画を1本選択してください。');
  if(!d.title.trim()||d.title.length>100)bad('動画タイトルは1〜100文字で入力してください。');
  if(!['public','unlisted','private'].includes(d.options?.visibility??''))bad('公開範囲を選択してください。');
  if(!['yes','no'].includes(d.options?.kids??''))bad('子ども向けの設定を選択してください。');
 }
 if(thumbnail&&!thumbnail.mime.startsWith('image/'))bad('表紙には画像を選択してください。');
 if(thumbnail&&platform!=='youtube')bad('この版の表紙設定はYouTubeに対応しています。');
}
export function providerSettings(d:PostizDraft,platform:string,thumbnail?:{id:string;path:string}){
 if(platform.startsWith('instagram'))return {__type:platform,post_type:'post',is_trial_reel:false,collaborators:[]};
 if(platform==='youtube')return {__type:platform,title:d.title,type:d.options?.visibility,selfDeclaredMadeForKids:d.options?.kids,tags:[],...(thumbnail?{thumbnail}:{})};
 return {__type:platform,...(platform==='x'?{who_can_reply_post:'everyone'}:{})};
}
