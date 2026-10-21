import {apiRoute} from '@/lib/server/http';import {listBenefits} from '@/lib/server/services';import {requestContext} from '@/lib/server/session';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){return apiRoute(request,async()=>listBenefits(await requestContext(request)));}
