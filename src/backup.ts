import { restoreCardSession } from './learningSession';
import type { AppExport, CardSession, LearnCard } from './types';

export const backupStores = ['projects', 'materials', 'notes', 'tasks', 'mistakes', 'weak_points', 'mock_attempts'] as const;
export type BackupStore = typeof backupStores[number];
type Row = Record<string, unknown>;
const invalid = (field: string): never => { throw new Error(`备份格式不正确：${field}。原有数据没有改动。`); };
const object = (v: unknown, field: string): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : invalid(field);
const text = (r: Row, key: string, required = true) => {
  if (!required && r[key] === undefined) return;
  if (typeof r[key] !== 'string') invalid(key);
};
const number = (r: Row, key: string, min: number, max: number, required = true) => {
  if (!required && r[key] === undefined) return;
  if (typeof r[key] !== 'number' || !Number.isFinite(r[key]) || (r[key] as number) < min || (r[key] as number) > max) invalid(key);
};
const oneOf = (r: Row, key: string, values: string[], required = true) => {
  if (!required && r[key] === undefined) return;
  if (!values.includes(r[key] as string)) invalid(key);
};
function strings(r: Row, key: string) {
  if (r[key] !== undefined && (!Array.isArray(r[key]) || !(r[key] as unknown[]).every(x => typeof x === 'string'))) invalid(key);
}

/** Validate the entire file before opening any write transaction. */
export function validateBackup(input: unknown): AppExport {
  const data = object(input, '文件内容');
  if (data.version !== 1 && data.version !== 2) invalid('不支持的备份版本');
  text(data, 'exported_at');
  const normalized: Row = { version: data.version, exported_at: data.exported_at };
  const projectIds = new Set<string>();
  for (const name of backupStores) {
    const rows = data[name] ?? (['projects','materials','notes'].includes(name) ? invalid(name) : []);
    if (!Array.isArray(rows)) invalid(name);
    const ids = new Set<string>();
    normalized[name] = (rows as unknown[]).map(raw => {
      const row = object(raw, name);
      text(row, 'id'); text(row, 'created_at');
      if (!(row.id as string).trim() || ids.has(row.id as string)) invalid(`${name} 的 ID 为空或重复`);
      ids.add(row.id as string);
      if (name === 'projects') {
        text(row,'subject'); text(row,'exam_date'); text(row,'updated_at');
        number(row,'daily_minutes',10,1440);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.exam_date as string) || !Number.isFinite(Date.parse(row.exam_date as string))) invalid('考试日期');
        text(row,'target_score',false); text(row,'weak_points',false);
        projectIds.add(row.id as string);
      } else {
        text(row,'project_id');
        if (!projectIds.has(row.project_id as string)) invalid(`${name} 引用了不存在的项目`);
      }
      for (const key of ['title','content','question','reason','fix','date','feedback','score','updated_at']) {
        const required: Record<string,string[]> = {
          materials:['title','content'], notes:['title','content'], tasks:['title','date','updated_at'],
          mistakes:['question','reason','fix','updated_at'], weak_points:['title','updated_at'],
          mock_attempts:['title','score','feedback'],
        };
        if (required[name]?.includes(key)) text(row,key);
        else text(row,key,false);
      }
      for (const key of ['source_url','file_name','source_note_id','source_material_id','source_title','source_section','evidence','exam_points','explanation','practice_questions','memorization','completed_at','last_reviewed_at','note']) text(row,key,false);
      strings(row,'warnings'); strings(row,'image_data_urls');
      if (name === 'materials') oneOf(row,'kind',['text','file','handwriting','video','pdf','markdown','document']);
      if (name === 'notes') oneOf(row,'mode',['plan','teach','practice','mock']);
      if (name === 'tasks') {
        number(row,'estimated_minutes',1,1440); oneOf(row,'status',['todo','done']);
        oneOf(row,'module_status',['todo','doing','done'],false);
        oneOf(row,'priority',['low','medium','high'],false); oneOf(row,'difficulty',['low','medium','high'],false);
        number(row,'importance_rank',0,Number.MAX_SAFE_INTEGER,false); number(row,'order',0,Number.MAX_SAFE_INTEGER,false);
        if (row.cards !== undefined) {
          if (!Array.isArray(row.cards)) invalid('cards');
          const cardIds = new Set<string>();
          for (const c of row.cards as unknown[]) {
            const card=object(c,'card'); text(card,'id'); text(card,'front');
            if (!(card.id as string).trim() || cardIds.has(card.id as string)) invalid('卡片 ID');
            cardIds.add(card.id as string);
            oneOf(card,'type',['concept','mistake','exam','quick_memory']);
            const back=object(card.back,'card.back'); text(back,'answer'); text(back,'examAnswer',false); text(back,'memoryTip',false);
            number(card,'importance',0,Number.MAX_SAFE_INTEGER,false);
          }
        }
      }
      if (name === 'tasks') {
        if (row.memorized !== undefined && typeof row.memorized !== 'boolean') invalid('memorized');
        if (row.card_session !== undefined && !restoreCardSession((row.cards || []) as LearnCard[], row.card_session as CardSession)) invalid('card_session');
      }
      if (name === 'mistakes') oneOf(row,'status',['new','reviewed']);
      if (name === 'weak_points') {text(row,'evidence');oneOf(row,'severity',['low','medium','high']);}
      if (name === 'mock_attempts') {number(row,'duration_minutes',0,1440);oneOf(row,'test_mode',['text','answer'],false);}
      return row;
    });
  }
  return normalized as unknown as AppExport;
}
