import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  POLICY_VERSION,
  compareRecordsAscending,
  dayRange,
  isTimestamp,
  isUuid,
  recordInRange,
  seoulDay,
  validateRecord,
  type ConsentStatus,
  type DateRange,
  type GlucoseRecord,
  type RecordInput,
  type MealRecord,
  type MealInput,
  type FoodCatalogItem,
  type UserPreferences,
  type PreferencesInput,
  type ImportBatch,
} from "../domain";
import { ApiError, noConsent, notFound } from "./errors";
import { materializeMeal } from './service-validation';
import { isHealthProfile, validateHealthProfile, type HealthProfile, type HealthProfileInput } from "../domain/health-profile";

export const DEMO_USERS = {
  a: { id: "11111111-1111-4111-8111-111111111111", email: "demo-a@example.invalid" },
  b: { id: "22222222-2222-4222-8222-222222222222", email: "demo-b@example.invalid" },
} as const;

type DemoConsent = { user_id: string; policy_version: string; agreed_at: string };
type ImportReceipt={user_id:string;request_id:string;batch_id:string;file_sha256:string;content_sha256:string};
type DemoData = { version: 1 | 2; records: GlucoseRecord[]; consents: DemoConsent[]; meals?:MealRecord[];preferences?:UserPreferences[];imports?:ImportBatch[];importRequests?:ImportReceipt[];healthProfiles?:HealthProfile[];healthProfileClock?:string };
const userIds = new Set<string>(Object.values(DEMO_USERS).map((user) => user.id));

// 로컬 파일도 손상되거나 직접 바뀔 수 있어 기록 번호·소유자·동의 형식을 다시 확인해요.
export function validateDemoData(value: unknown): value is DemoData {
  if (typeof value !== "object" || !value) return false;
  const data = value as DemoData;
  if (![1, 2].includes(data.version) || !Array.isArray(data.records) || !Array.isArray(data.consents)) {
    return false;
  }
  const ids = new Set<string>();
  for (const record of data.records) {
    if (
      typeof record !== "object" ||
      !record ||
      !isUuid(record.id) ||
      ids.has(record.id) ||
      !userIds.has(record.user_id) ||
      typeof record.glucose_mg_dl !== "number" ||
      !isTimestamp(record.created_at) ||
      !isTimestamp(record.updated_at) ||
      !validateRecord(record).ok
    ) {
      return false;
    }
    ids.add(record.id);
  }
  const consentUsers = new Set<string>();
  if (data.healthProfileClock !== undefined && !isTimestamp(data.healthProfileClock)) return false;
  if (data.healthProfiles !== undefined) {
    if (!Array.isArray(data.healthProfiles)) return false;
    const profileUsers = new Set<string>();
    for (const profile of data.healthProfiles) {
      if (!isHealthProfile(profile) || !userIds.has(profile.user_id) || profileUsers.has(profile.user_id)) return false;
      profileUsers.add(profile.user_id);
    }
  }
  if (data.meals !== undefined && (!Array.isArray(data.meals) || data.meals.some(meal=>!meal || !isUuid(meal.id) || !userIds.has(meal.user_id) || !isTimestamp(meal.meal_at) || !Array.isArray(meal.items) || meal.items.some(item=>item.user_id!==meal.user_id || item.meal_id!==meal.id)))) return false;
  if (data.preferences !== undefined && (!Array.isArray(data.preferences) || data.preferences.some(item=>!item||!userIds.has(item.user_id)||typeof item.matching_enabled!=='boolean'))) return false;
  if (data.imports !== undefined && (!Array.isArray(data.imports) || data.imports.some(item=>!item||!isUuid(item.id)||!isUuid(item.request_id)||!userIds.has(item.user_id)||!isTimestamp(item.imported_at)))) return false;
  if(data.importRequests!==undefined&&(!Array.isArray(data.importRequests)||data.importRequests.some(item=>!item||!isUuid(item.request_id)||!userIds.has(item.user_id)||!data.imports?.some(batch=>batch.id===item.batch_id&&batch.user_id===item.user_id))))return false;
  for (const consent of data.consents) {
    if (
      typeof consent !== "object" ||
      !consent ||
      !userIds.has(consent.user_id) ||
      consentUsers.has(consent.user_id) ||
      typeof consent.policy_version !== "string" ||
      !consent.policy_version.length ||
      consent.policy_version.length > 32 ||
      !isTimestamp(consent.agreed_at)
    ) {
      return false;
    }
    consentUsers.add(consent.user_id);
  }
  return true;
}

function seedData(): DemoData {
  const todayStart = Date.parse(dayRange(seoulDay()).start);
  const now = new Date().toISOString();
  const samples = [
    { id: "10000000-0000-4000-8000-000000000001", user_id: DEMO_USERS.a.id, day: -2, value: 98, context: "fasting", memo: "가상 기록: 아침 측정" },
    { id: "10000000-0000-4000-8000-000000000002", user_id: DEMO_USERS.a.id, day: -1, value: 124, context: "after_meal_2h", memo: "가상 기록: 점심 식사 후" },
    { id: "10000000-0000-4000-8000-000000000003", user_id: DEMO_USERS.a.id, day: 0, value: 112, context: "before_meal", memo: "가상 기록: 저녁 식사 전" },
    { id: "20000000-0000-4000-8000-000000000001", user_id: DEMO_USERS.b.id, day: -1, value: 105, context: "other", memo: "계정 B의 가상 기록" },
  ] as const;
  return {
    version: 2,
    healthProfiles: [],
    consents: [],
    records: samples.map((item) => ({
      id: item.id,
      user_id: item.user_id,
      glucose_mg_dl: item.value,
      measured_at: new Date(todayStart + item.day * 86_400_000 + 8 * 3_600_000).toISOString(),
      measurement_context: item.context,
      meal_memo: item.memo,
      created_at: now,
      updated_at: now,
    })),
  };
}

type QueueRegistry = typeof globalThis & {
  __glucoseDemoQueues?: Map<string, Promise<unknown>>;
};
const registry = globalThis as QueueRegistry;
registry.__glucoseDemoQueues ??= new Map();

/** 한 서버 프로세스 안에서 같은 파일의 읽기·쓰기를 차례로 처리하는 시연용 저장소예요. */
export class DemoStore {
  constructor(private readonly filename = path.join(process.cwd(), ".local", "demo-data.json")) {}

  private async atomicWrite(data: DemoData): Promise<void> {
    await mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    try {
      // 새 파일을 끝까지 쓴 뒤 교체해 저장 도중 기존 파일이 반쯤 덮이지 않게 해요.
      await writeFile(temporary, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.filename);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async load(): Promise<DemoData> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filename, "utf8"));
      if (!validateDemoData(value)) throw new Error("Invalid demo data");
      // 기존 시연 파일은 기록·동의를 유지한 채 다음 저장 때 새 형식으로 옮겨요.
      value.version = 2;
      value.healthProfiles ??= [];
      const latestProfileTime = Math.max(0, ...value.healthProfiles.map(profile => Date.parse(profile.updated_at)),
        value.healthProfileClock ? Date.parse(value.healthProfileClock) : 0);
      if (latestProfileTime) value.healthProfileClock = new Date(latestProfileTime).toISOString();
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const data = seedData();
        await this.atomicWrite(data);
        return data;
      }
      // 이미 있는 파일이 잘못됐을 때는 초기화하지 않고 복구할 수 있도록 그대로 남겨요.
      throw new ApiError(503, "DATA_UNAVAILABLE", "시연 기록을 불러오지 못했어요. 서버의 데이터 파일을 확인해 주세요.");
    }
  }

  private async transaction<T>(write: boolean, action: (data: DemoData) => T): Promise<T> {
    // 서로 다른 DemoStore 객체라도 같은 파일을 쓰면 같은 대기 줄을 사용해요.
    const previous = registry.__glucoseDemoQueues!.get(this.filename) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(async () => {
      const data = await this.load();
      const result = action(data);
      if (write) {
        try {
          await this.atomicWrite(data);
        } catch {
          throw new ApiError(503, "UNKNOWN_OUTCOME", "저장 결과를 확인하지 못했어요. 기록을 다시 확인해 주세요.");
        }
      }
      return result;
    });
    registry.__glucoseDemoQueues!.set(this.filename, pending);
    try {
      return await pending;
    } finally {
      // 뒤에 새 작업이 붙었다면 그 작업의 대기 줄까지 지우지 않아요.
      if (registry.__glucoseDemoQueues!.get(this.filename) === pending) {
        registry.__glucoseDemoQueues!.delete(this.filename);
      }
    }
  }

  consent(userId: string): Promise<ConsentStatus> {
    return this.transaction(false, (data) => {
      const consent = data.consents.find((item) => item.user_id === userId);
      return !consent ? "missing" : consent.policy_version === POLICY_VERSION ? "current" : "outdated";
    });
  }

  agree(userId: string): Promise<void> {
    return this.transaction(true, (data) => {
      const existing = data.consents.find((item) => item.user_id === userId);
      if (existing?.policy_version === POLICY_VERSION) return;
      if (existing) {
        throw new ApiError(409, "POLICY_OUTDATED", "이 계정의 동의 안내가 변경되었어요. 새 시연 계정을 사용해 주세요.");
      }
      data.consents.push({ user_id: userId, policy_version: POLICY_VERSION, agreed_at: new Date().toISOString() });
    });
  }

  private requireConsent(data: DemoData, userId: string): void {
    if (!data.consents.some((item) => item.user_id === userId && item.policy_version === POLICY_VERSION)) {
      noConsent();
    }
  }

  list(userId: string, range: DateRange): Promise<GlucoseRecord[]> {
    return this.transaction(false, (data) =>
      data.records
        .filter((record) => record.user_id === userId && recordInRange(record, range))
        .sort(compareRecordsAscending)
        .reverse(),
    );
  }

  get(userId: string, id: string): Promise<GlucoseRecord> {
    return this.transaction(false, (data) => {
      const record = data.records.find((item) => item.user_id === userId && item.id === id);
      if (!record) notFound();
      return record;
    });
  }

  insert(userId: string, id: string, input: RecordInput): Promise<GlucoseRecord> {
    return this.transaction(true, (data) => {
      this.requireConsent(data, userId);
      if (data.records.some((item) => item.id === id)) {
        throw new ApiError(409, "RECORD_EXISTS", "같은 기록 번호가 이미 있어요. 저장된 기록을 확인해 주세요.");
      }
      const now = new Date().toISOString();
      const record: GlucoseRecord = { ...input, id, user_id: userId, created_at: now, updated_at: now };
      data.records.push(record);
      return record;
    });
  }

  update(userId: string, id: string, input: RecordInput, expectedUpdatedAt: string): Promise<GlucoseRecord> {
    return this.transaction(true, (data) => {
      const record = data.records.find((item) => item.user_id === userId && item.id === id);
      if (!record) notFound();
      this.requireConsent(data, userId);
      if (Date.parse(record.updated_at) !== Date.parse(expectedUpdatedAt)) {
        throw new ApiError(409, "STALE_RECORD", "다른 화면에서 기록이 바뀌었어요. 최신 기록을 확인해 주세요.");
      }
      // 같은 밀리초에 연속 수정해도 시각이 달라져 오래된 화면의 덮어쓰기를 구분할 수 있어요.
      Object.assign(record, input, {
        updated_at: new Date(Math.max(Date.now(), Date.parse(record.updated_at) + 1)).toISOString(),
      });
      return record;
    });
  }

  remove(userId: string, id: string): Promise<void> {
    return this.transaction(true, (data) => {
      const index = data.records.findIndex((item) => item.user_id === userId && item.id === id);
      if (index === -1) notFound();
      data.records.splice(index, 1);
    });
  }

  listMeals(userId:string,range:DateRange):Promise<MealRecord[]> {
    return this.transaction(false,data=>(data.meals??[]).filter(meal=>meal.user_id===userId&&Date.parse(meal.meal_at)>=Date.parse(range.start)&&Date.parse(meal.meal_at)<Date.parse(range.end)).sort((a,b)=>Date.parse(b.meal_at)-Date.parse(a.meal_at)||b.id.localeCompare(a.id)));
  }
  getMeal(userId:string,id:string):Promise<MealRecord> {
    return this.transaction(false,data=>{const meal=data.meals?.find(item=>item.id===id&&item.user_id===userId);if(!meal)notFound();return meal;});
  }
  saveMeal(userId:string,id:string,input:MealInput,foods:FoodCatalogItem[],expected?:string):Promise<MealRecord> {
    return this.transaction(true,data=>{
      this.requireConsent(data,userId);data.meals??=[];
      const old=data.meals.find(item=>item.id===id&&item.user_id===userId);
      if(expected){if(!old)notFound();if(Date.parse(old.updated_at)!==Date.parse(expected))throw new ApiError(409,'STALE_RECORD','다른 화면에서 식사가 바뀌었어요. 최신 기록을 확인해 주세요.');}
      else if(data.meals.some(item=>item.id===id))throw new ApiError(409,'RECORD_EXISTS','같은 식사 번호가 이미 있어요.');
      const meal=materializeMeal(input,id,userId,foods,old);
      if(meal.items.some(item=>data.meals!.some(other=>other.id!==id&&other.items.some(otherItem=>otherItem.id===item.id))))throw new ApiError(409,'RECORD_EXISTS','음식 항목 번호가 이미 있어요. 식사를 다시 열어 주세요.');
      if(old)data.meals[data.meals.indexOf(old)]=meal;else data.meals.push(meal);
      return meal;
    });
  }
  removeMeal(userId:string,id:string):Promise<void>{return this.transaction(true,data=>{const index=data.meals?.findIndex(item=>item.id===id&&item.user_id===userId)??-1;if(index<0)notFound();data.meals!.splice(index,1);});}
  getPreferences(userId:string):Promise<UserPreferences|null>{return this.transaction(false,data=>data.preferences?.find(item=>item.user_id===userId)??null);}
  savePreferences(userId:string,input:PreferencesInput):Promise<UserPreferences>{return this.transaction(true,data=>{
    data.preferences??=[];const old=data.preferences.find(item=>item.user_id===userId);const now=new Date().toISOString();
    const preferences={...input,user_id:userId,consented_at:input.matching_enabled?old?.consented_at??now:null,updated_at:now};
    if(old)data.preferences[data.preferences.indexOf(old)]=preferences;else data.preferences.push(preferences);return preferences;
  });}
  removePreferences(userId:string):Promise<void>{return this.transaction(true,data=>{data.preferences=(data.preferences??[]).filter(item=>item.user_id!==userId);});}
  getHealthProfile(userId: string): Promise<HealthProfile | null> {
    return this.transaction(false, data => {
      if (!userIds.has(userId)) throw new ApiError(401, "UNAUTHORIZED", "다시 로그인해 주세요.");
      return data.healthProfiles?.find(profile => profile.user_id === userId) ?? null;
    });
  }
  saveHealthProfile(userId: string, input: HealthProfileInput): Promise<HealthProfile> {
    return this.transaction(true, data => {
      if (!userIds.has(userId)) throw new ApiError(401, "UNAUTHORIZED", "다시 로그인해 주세요.");
      this.requireConsent(data, userId);
      const validation = validateHealthProfile(input);
      if (!validation.ok) throw new ApiError(422, "INVALID_INPUT", "입력한 내용을 확인해 주세요.", validation.fields);
      const { expected_updated_at, notice_version, sex, age, height_cm, weight_kg } = validation.value;
      data.healthProfiles ??= [];
      const old = data.healthProfiles.find(profile => profile.user_id === userId);
      if (old ? expected_updated_at !== old.updated_at : expected_updated_at !== null) {
        throw new ApiError(409, "STALE_PROFILE", "다른 화면에서 개인정보가 바뀌었어요. 최신 정보를 다시 불러와 주세요.");
      }
      // 개인정보를 삭제해도 파일 전체의 시계 값만 남겨 같은 밀리초 재생성의 버전 재사용을 막아요.
      const now = new Date(Math.max(Date.now(), data.healthProfileClock ? Date.parse(data.healthProfileClock) + 1 : 0)).toISOString();
      data.healthProfileClock = now;
      const profile: HealthProfile = {
        user_id: userId, sex, age, height_cm, weight_kg, notice_version,
        consented_at: now, created_at: old?.created_at ?? now, updated_at: now,
      };
      if (old) data.healthProfiles[data.healthProfiles.indexOf(old)] = profile;
      else data.healthProfiles.push(profile);
      return profile;
    });
  }
  removeHealthProfile(userId: string, expectedUpdatedAt: string): Promise<void> {
    return this.transaction(true, data => {
      if (!userIds.has(userId)) throw new ApiError(401, "UNAUTHORIZED", "다시 로그인해 주세요.");
      if (!isTimestamp(expectedUpdatedAt)) throw new ApiError(422, "INVALID_INPUT", "최신 정보를 불러온 뒤 삭제해 주세요.");
      const old = data.healthProfiles?.find(profile => profile.user_id === userId);
      if (!old) return;
      if (old.updated_at !== expectedUpdatedAt) {
        throw new ApiError(409, "STALE_PROFILE", "다른 화면에서 개인정보가 바뀌었어요. 최신 정보를 다시 불러와 주세요.");
      }
      data.healthProfiles = data.healthProfiles!.filter(profile => profile.user_id !== userId);
    });
  }
  getImport(userId:string,requestId:string):Promise<ImportBatch>{return this.transaction(false,data=>{const receipt=data.importRequests?.find(item=>item.user_id===userId&&item.request_id===requestId);const batch=data.imports?.find(item=>item.user_id===userId&&(item.request_id===requestId||item.id===receipt?.batch_id));if(!batch)notFound();return batch;});}
  importRecords(userId:string,requestId:string,fileHash:string,contentHash:string,records:RecordInput[]):Promise<{batch:ImportBatch;duplicate:boolean}>{return this.transaction(true,data=>{
    this.requireConsent(data,userId);data.imports??=[];data.importRequests??=[];
    const receipt=data.importRequests.find(item=>item.user_id===userId&&item.request_id===requestId);
    if(receipt&&(receipt.file_sha256!==fileHash||receipt.content_sha256!==contentHash))throw new ApiError(409,'IMPORT_CONFLICT','같은 요청 번호의 내용이 달라요. 파일을 다시 선택해 주세요.');
    const existingRequest=data.imports.find(item=>item.user_id===userId&&item.request_id===requestId);
    if(existingRequest && (existingRequest.file_sha256!==fileHash || existingRequest.content_sha256!==contentHash))throw new ApiError(409,'IMPORT_CONFLICT','같은 요청 번호의 내용이 달라요. 파일을 다시 선택해 주세요.');
    const duplicate=existingRequest??data.imports.find(item=>item.user_id===userId&&(item.id===receipt?.batch_id||item.file_sha256===fileHash||item.content_sha256===contentHash));
    if(duplicate){if(!receipt)data.importRequests.push({user_id:userId,request_id:requestId,batch_id:duplicate.id,file_sha256:fileHash,content_sha256:contentHash});return {batch:duplicate,duplicate:true};}
    const now=new Date().toISOString();const batch:ImportBatch={id:randomUUID(),user_id:userId,request_id:requestId,file_sha256:fileHash,content_sha256:contentHash,row_count:records.length,imported_at:now,format_version:'csv-v1'};
    const normalized=records.map(record=>validateRecord(record));if(!records.length||records.length>1000||normalized.some(record=>!record.ok))throw new ApiError(422,'INVALID_INPUT','가져올 행을 확인해 주세요.');
    data.records.push(...records.map((record,index)=>({...record,id:randomUUID(),user_id:userId,created_at:now,updated_at:now,import_batch_id:batch.id,source_row_number:index+1})));
    data.imports.push(batch);data.importRequests.push({user_id:userId,request_id:requestId,batch_id:batch.id,file_sha256:fileHash,content_sha256:contentHash});return {batch,duplicate:false};
  });}
}
