import {apiRoute} from '@/lib/server/http';import {listNews} from '@/lib/server/services';import {requestContext} from '@/lib/server/session';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){return apiRoute(request,async()=>listNews(await requestContext(request),{signal:request.signal}));}
