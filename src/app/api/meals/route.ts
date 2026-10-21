import {apiRoute,jsonBody} from '@/lib/server/http';
import {listMeals,saveMeal} from '@/lib/server/services';
import {requestContext} from '@/lib/server/session';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){return apiRoute(request,async()=>listMeals(await requestContext(request),Object.fromEntries(new URL(request.url).searchParams)));}
export async function POST(request:Request){return apiRoute(request,async()=>({meal:await saveMeal(await requestContext(request),await jsonBody(request,262144))}),true,201);}
