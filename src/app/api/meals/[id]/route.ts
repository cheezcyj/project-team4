import {apiRoute,jsonBody} from '@/lib/server/http';
import {getMeal,saveMeal,removeMeal} from '@/lib/server/services';
import {requestContext} from '@/lib/server/session';
export const runtime='nodejs';export const dynamic='force-dynamic';
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){return apiRoute(request,async()=>({meal:await getMeal(await requestContext(request),(await params).id)}));}
export async function PATCH(request:Request,{params}:Params){return apiRoute(request,async()=>({meal:await saveMeal(await requestContext(request),await jsonBody(request,262144),(await params).id)}),true);}
export async function DELETE(request:Request,{params}:Params){return apiRoute(request,async()=>{await removeMeal(await requestContext(request),(await params).id);return {ok:true};},true);}
