import { useState } from 'react';
import { validateBackup } from '../backup';
import { storage } from '../storage';
import type { AppExport } from '../types';

function downloadBackup(data: AppExport, prefix = 'kaobuddy-backup') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BackupPanel({ onImported, beforeImport, disabled = false }: { onImported: () => Promise<void>; beforeImport: () => Promise<void>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<AppExport | null>(null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  async function exportData() {
    setWorking(true);
    try { downloadBackup(await storage.exportAll()); setMessage('备份已下载。文件包含学习资料，请妥善保管。'); }
    catch { setMessage('备份失败，请重试。'); }
    finally { setWorking(false); }
  }
  async function importData(mode: 'merge' | 'replace') {
    if (!pending) return;
    if (mode === 'replace' && !window.confirm('替换会移除当前全部项目和学习记录。继续前会先下载当前数据的备份，请确认浏览器允许下载。是否继续？')) return;
    setWorking(true);
    try {
      await beforeImport();
      if (mode === 'replace') downloadBackup(await storage.exportAll(), 'kaobuddy-before-replace');
      await storage.importAll(pending, mode);
      await onImported(); setPending(null);
      setMessage(mode === 'merge' ? '备份已合并，同 ID 的本地记录已保留。' : '备份已恢复，替换前的数据已下载为单独文件。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '导入失败，原有数据没有改动。'); }
    finally { setWorking(false); }
  }
  return <div className="backup-control">
    <button type="button" className="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>数据备份</button>
    {open && <section className="backup-panel" aria-label="数据备份与恢复">
      <h2>数据备份与恢复</h2>
      <p>资料保存在当前浏览器。换设备或清理浏览器前，记得下载一份。API Key 不包含在备份中。</p>
      <button type="button" disabled={disabled || working} onClick={exportData}>下载备份</button>
      <label>选择备份 JSON<input type="file" accept=".json,application/json" disabled={disabled || working} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; setPending(null);
        if (!file) return;
        setWorking(true);
        try {
          if (file.size > 100 * 1024 * 1024) throw new Error('备份超过 100 MB，请先拆分资料后重新导出。');
          const data = validateBackup(JSON.parse(await file.text())); setPending(data);
          setMessage(`已检查：${data.projects.length} 个项目、${data.materials.length} 份资料、${data.tasks?.length || 0} 个模块。`);
        } catch (error) { setMessage(error instanceof SyntaxError ? '这个文件不是有效的 JSON 备份。原有数据没有改动。' : error instanceof Error ? error.message : '无法读取备份。'); }
        finally { setWorking(false); }
      }} /></label>
      {pending && <div className="actions wrap">
        <button type="button" disabled={disabled || working} onClick={() => importData('merge')}>合并到现有数据</button>
        <button type="button" className="danger" disabled={disabled || working} onClick={() => importData('replace')}>备份当前数据并替换</button>
        <button type="button" className="secondary" disabled={working} onClick={() => setPending(null)}>取消导入</button>
      </div>}
      <p role="status">{working ? '正在处理，请稍候…' : message}</p>
    </section>}
  </div>;
}
