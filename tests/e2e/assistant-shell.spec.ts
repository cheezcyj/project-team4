import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function login(page:Page){
  await page.goto('/login');
  await page.getByRole('button',{name:'가상 계정 A로 시작',exact:true}).click();
  await expect(page).toHaveURL(/\/(?:consent|dashboard)/);
  if(new URL(page.url()).pathname==='/consent'){
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'동의하고 시작하기',exact:true}).click();
  }
  await expect(page.getByRole('heading',{name:'혈당 한눈에',exact:true})).toBeVisible();
}

test('ten measurement situations expose meal slots only when relevant and persist the explicit choice',async({page})=>{
  await login(page);
  await page.goto('/records/new');
  await expect(page.getByRole('radio')).toHaveCount(10);
  await page.getByLabel('혈당값',{exact:false}).fill('122');
  await page.getByRole('radio',{name:'식후',exact:true}).check();
  await expect(page.getByRole('radio')).toHaveCount(15);
  await page.getByRole('radio',{name:'점심',exact:true}).check();
  await page.getByRole('button',{name:'기록 저장',exact:true}).click();
  await expect(page).toHaveURL(/\/records\?date=/);
  const data=await (await page.request.get('/api/records')).json();
  const record=data.records.find((r:{glucose_mg_dl:number;meal_slot:string;measurement_context:string})=>r.glucose_mg_dl===122&&r.meal_slot==='lunch'&&r.measurement_context==='after_meal');
  expect(record).toBeTruthy();
  await page.goto(`/records/${record.id}/edit`);
  await expect(page.getByRole('radio',{name:'점심',exact:true})).toBeChecked();
  await page.getByRole('radio',{name:'운동 후',exact:true}).check();
  await expect(page.getByRole('radio',{name:'점심',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'수정 저장',exact:true}).click();
  await expect(page).toHaveURL(/\/records\?date=/);
  const stored=(await (await page.request.get(`/api/records/${record.id}`)).json()).record;
  expect(stored.measurement_context).toBe('after_exercise');
  expect(stored.meal_slot).toBeNull();
});

test('disabled assistant checks availability without sending a question, restores focus and clears on logout',async({page})=>{
  await login(page);
  await expect(page.getByRole('img',{name:/최근 7일 혈당 그래프/}).locator('.recharts-scatter-line path')).toHaveAttribute('d', /L/);
  const outbound:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&/\/(?:chat|ai|assistant)(?:\/|$)/.test(new URL(request.url()).pathname))outbound.push(request.url());});
  await page.getByRole('button',{name:'도우미 열기',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'이어드림 도우미',exact:true});
  await expect(panel).toBeVisible();
  await panel.getByLabel('질문',{exact:true}).fill('가상 질문 초안');
  await expect(panel.getByRole('button',{name:'질문 전송 준비 중'})).toBeDisabled();
  await expect(page).toHaveURL(/\/dashboard$/);
  await panel.getByLabel('질문',{exact:true}).press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole('button',{name:'도우미 열기',exact:true})).toBeFocused();
  expect(outbound).toEqual([]);
  await page.getByRole('button',{name:'로그아웃',exact:true}).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button',{name:'도우미 열기',exact:true}).click();
  await expect(panel.getByLabel('질문',{exact:true})).toHaveValue('');
  await expect(panel.getByLabel('질문',{exact:true})).toBeDisabled();
});

test('news stays empty and responsive navigation and assistant expose accessible content',async({page},info)=>{
  test.setTimeout(90_000);
  await login(page);
  const newsRequests:string[]=[];
  page.on('request',request=>{if(request.url().includes('/api/news'))newsRequests.push(request.url());});
  await page.goto('/news');
  await expect(page.getByText('아직 등록된 소식이 없어요.',{exact:true})).toBeVisible();
  expect(newsRequests).toEqual([]);
  for(const width of [360,768,1280]){
    await page.setViewportSize({width,height:900});
    await page.goto('/records/new');
    await expect(page.getByLabel('혈당값',{exact:false})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.getByRole('button',{name:'도우미 열기',exact:true}).click();
    const panel=page.getByRole('dialog',{name:'이어드림 도우미',exact:true});
    await expect(panel).toBeVisible();
    const box=await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);
    const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;
    expect(violations).toEqual([]);
    await page.screenshot({path:info.outputPath(`assistant-${width}.png`),fullPage:true});
    await panel.getByRole('button',{name:'도우미 닫기',exact:true}).click();
    await page.screenshot({path:info.outputPath(`record-v7-${width}.png`),fullPage:true});
    if(width<900){
      await page.getByRole('button',{name:'전체 메뉴 열기'}).click();
      await expect(page.getByRole('dialog',{name:'전체 메뉴',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'전체 메뉴 닫기'}).click();
    }
  }
});
