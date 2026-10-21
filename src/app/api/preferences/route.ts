import {apiRoute,jsonBody} from '@/lib/server/http';import {getPreferences,savePreferences,removePreferences} from '@/lib/server/services';import {requestContext} from '@/lib/server/session';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){return apiRoute(request,async()=>({preferences:await getPreferences(await requestContext(request))}));}
export async function PUT(request:Request){return apiRoute(request,async()=>({preferences:await savePreferences(await requestContext(request),await jsonBody(request))}),true);}
export async function DELETE(request:Request){return apiRoute(request,async()=>{await removePreferences(await requestContext(request));return {ok:true};},true);}
