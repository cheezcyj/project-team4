import {apiRoute,jsonBody} from '@/lib/server/http';import {getImport,importCsv} from '@/lib/server/services';import {requestContext} from '@/lib/server/session';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){return apiRoute(request,async()=>({batch:await getImport(await requestContext(request),new URL(request.url).searchParams.get('request_id')??'')}));}
export async function POST(request:Request){return apiRoute(request,async()=>importCsv(await requestContext(request),await jsonBody(request,12*1024*1024)),true,201);}
