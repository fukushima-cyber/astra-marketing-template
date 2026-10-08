export const pageNames = {autonomy:'事業エージェント（事業全体）',ads:'広告運用（事業全体）',improvements:'改善・診断（事業全体）',overview:'全体の数字',analytics:'詳細分析',posts:'SNS投稿',business:'案件・ファネル設定',connections:'データ接続',work:'施策・タスク管理',okr:'目標のつながり（OKR）'} as const;
export type AccessPage = keyof typeof pageNames;
export type Grant = {businessId:string;page:AccessPage;edit:boolean;projects:string[]|null};
export type Identity = {id:string;companyId:string;name:string;email:string;role:'owner'|'member';version:number;grants:Grant[]};
export const accessPages=Object.keys(pageNames) as AccessPage[];
export function allAccessGrants(businessIds:string[],edit:boolean):Grant[]{return [...new Set(businessIds)].flatMap(businessId=>accessPages.map(page=>({businessId,page,edit,projects:null})));}
export function permission(user:Identity, businessId:string, page:AccessPage):Grant|null {
 return user.role==='owner'?{businessId,page,edit:true,projects:null}:user.grants.find(g=>g.businessId===businessId&&g.page===page)??null;
}
export function can(user:Identity,businessId:string,page:AccessPage,edit=false){const g=permission(user,businessId,page);return !!g&&(!edit||g.edit);}
