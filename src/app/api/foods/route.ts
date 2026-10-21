import {apiRoute} from '@/lib/server/http';import {searchFoods} from '@/lib/server/services';import {requestContext} from '@/lib/server/session';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){return apiRoute(request,async()=>searchFoods(await requestContext(request),new URL(request.url).searchParams.get('q')??''));}
