import type { AiNote, ApiConfig, AppExport, InviteState, Mistake, MockAttempt, StudyMaterial, StudyProject, StudyTask, WeakPoint } from "./types";
import { restoreCardSession } from "./learningSession";
import { backupStores, validateBackup } from "./backup";
import { defaultInviteState, normalizeInviteState } from "./inviteState";

const DB_NAME = "kaobuddy-db";
const DB_VERSION = 2;
const API_CONFIG_KEY = "kaobuddy-api-config";
const INVITE_STATE_KEY = "kaobuddy-invite-state";

type StoreName = "projects" | "materials" | "notes" | "tasks" | "mistakes" | "weak_points" | "mock_attempts";

function ensureStore(db: IDBDatabase, name: StoreName, indexes: string[] = []) {
  if (db.objectStoreNames.contains(name)) return;
  const store = db.createObjectStore(name, { keyPath: "id" });
  indexes.forEach((index) => store.createIndex(index, index));
}

function ensureIndex(db: IDBDatabase, storeName: StoreName, indexName: string, keyPath?: string) {
  try {
    const store = db.transaction(storeName, "versionchange" as never).objectStore(storeName) as unknown as IDBObjectStore;
    if (!store.indexNames.contains(indexName)) {
      store.createIndex(indexName, keyPath || indexName);
    }
  } catch {
    // Transaction may fail if the store was just created — the index was
    // already set up by ensureStore above.
  }
}

// ---------------------------------------------------------------------------
// Schema migrations — add new entries when bumping DB_VERSION.
// Each migration runs exactly once: when oldVersion < migration.version.
// ---------------------------------------------------------------------------

const MIGRATIONS: Array<{ version: number; upgrade: (db: IDBDatabase) => void }> = [
  {
    version: 1,
    upgrade(db) {
      ensureStore(db, "projects");
      ensureStore(db, "materials", ["project_id"]);
      ensureStore(db, "notes", ["project_id"]);
      ensureStore(db, "tasks", ["project_id", "date"]);
      ensureStore(db, "mistakes", ["project_id"]);
      ensureStore(db, "weak_points", ["project_id"]);
      ensureStore(db, "mock_attempts", ["project_id"]);
    },
  },
  // Example for future use:
  // {
  //   version: 2,
  //   upgrade(db) {
  //     ensureStore(db, "settings");
  //     ensureIndex(db, "tasks", "updated_at", "updated_at");
  //   },
  // },
];

function runMigrations(db: IDBDatabase, oldVersion: number) {
  for (const migration of MIGRATIONS) {
    if (migration.version > oldVersion && migration.version <= DB_VERSION) {
      migration.upgrade(db);
    }
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      runMigrations(request.result, event.oldVersion);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => reject(new Error("请关闭其他考搭子页面，再重试数据操作。"));
  });
}

async function getAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    transaction.oncomplete = () => { db.close(); resolve(request.result as T[]); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

async function write(storeNames: StoreName[], operation: (tx: IDBTransaction) => void): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, "readwrite");
    let failure: unknown;
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(failure || tx.error || new Error("数据没有保存，请重试。")); };
    try { operation(tx); } catch (error) { failure = error; tx.abort(); }
  });
}

const put = <T,>(name: StoreName, value: T) => write([name], tx => { tx.objectStore(name).put(value); });
const deleteById = (name: StoreName, id: string) => write([name], tx => { tx.objectStore(name).delete(id); });

function normalizeTask(task: StudyTask, index: number): StudyTask {
  const moduleStatus = task.module_status || (task.status === "done" ? "done" : "todo");
  return {
    ...task,
    status: moduleStatus === "done" ? "done" : "todo",
    module_status: moduleStatus,
    priority: task.priority || "medium",
    difficulty: task.difficulty || "medium",
    importance_rank: typeof task.importance_rank === "number" ? task.importance_rank : index + 1,
    exam_points: task.exam_points || task.note || "",
    practice_questions: task.practice_questions || "",
    order: typeof task.order === "number" ? task.order : index,
  };
}

export const storage = {
  projects: () => getAll<StudyProject>("projects"),
  materials: () => getAll<StudyMaterial>("materials"),
  notes: () => getAll<AiNote>("notes"),
  tasks: () => getAll<StudyTask>("tasks"),
  mistakes: () => getAll<Mistake>("mistakes"),
  weakPoints: () => getAll<WeakPoint>("weak_points"),
  mockAttempts: () => getAll<MockAttempt>("mock_attempts"),
  saveProject: (project: StudyProject) => put("projects", project),
  deleteProject: (id: string) => write([...backupStores], tx => {
    tx.objectStore("projects").delete(id);
    for (const name of backupStores.filter(name => name !== "projects")) {
      const store = tx.objectStore(name);
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        if (cursor.result.value.project_id === id) cursor.result.delete();
        cursor.result.continue();
      };
    }
  }),
  saveMaterial: (material: StudyMaterial) => put("materials", material),
  deleteMaterial: (id: string) => deleteById("materials", id),
  saveNote: (note: AiNote) => put("notes", note),
  deleteNote: (id: string) => deleteById("notes", id),
  saveTask: (task: StudyTask) => write(["tasks"], tx => {
    const store = tx.objectStore("tasks");
    const request = store.get(task.id);
    request.onsuccess = () => {
      const current = request.result as StudyTask | undefined;
      const value = current ? {...task, memorized: current.memorized,
        card_session: JSON.stringify(current.cards) === JSON.stringify(task.cards) ? current.card_session : undefined} : task;
      try { store.put(value); } catch { tx.abort(); }
    };
  }),
  updateTaskLearning: (id: string, patch: Pick<StudyTask, "card_session" | "memorized">) => write(["tasks"], tx => {
    const store = tx.objectStore("tasks");
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) return;
      if (patch.card_session && !restoreCardSession(request.result.cards || [], patch.card_session)) return;
      try { store.put({ ...request.result, ...patch }); } catch { tx.abort(); }
    };
  }),
  deleteTask: (id: string) => deleteById("tasks", id),
  saveMistake: (mistake: Mistake) => put("mistakes", mistake),
  deleteMistake: (id: string) => deleteById("mistakes", id),
  saveWeakPoint: (weakPoint: WeakPoint) => put("weak_points", weakPoint),
  deleteWeakPoint: (id: string) => deleteById("weak_points", id),
  saveMockAttempt: (attempt: MockAttempt) => put("mock_attempts", attempt),
  deleteMockAttempt: (id: string) => deleteById("mock_attempts", id),
  saveApiConfig: (config: ApiConfig) => localStorage.setItem(API_CONFIG_KEY, JSON.stringify(config)),
  getApiConfig: (): ApiConfig | null => {
    const raw = localStorage.getItem(API_CONFIG_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ApiConfig;
    } catch {
      return null;
    }
  },
  saveInviteState: (state: InviteState) => localStorage.setItem(INVITE_STATE_KEY, JSON.stringify(state)),
  getInviteState: (): InviteState => {
    const raw = localStorage.getItem(INVITE_STATE_KEY);
    if (!raw) return defaultInviteState;
    try {
      return normalizeInviteState(JSON.parse(raw) as Partial<InviteState>);
    } catch {
      return defaultInviteState;
    }
  },
  exportAll: async (): Promise<AppExport> => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([...backupStores], "readonly");
      const data: Record<string, unknown> = {version: 2, exported_at: new Date().toISOString()};
      for (const name of backupStores) {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => { data[name] = request.result; };
      }
      tx.oncomplete = () => { db.close(); resolve(data as AppExport); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  },
  importAll: async (input: unknown, mode: "merge" | "replace" = "merge") => {
    const data = validateBackup(input);
    await write([...backupStores], tx => {
      for (const name of backupStores) {
        const store = tx.objectStore(name);
        if (mode === "replace") store.clear();
        (data[name] || []).forEach((item, index) => {
          const value = name === "tasks" ? normalizeTask(item as StudyTask, index) : item;
          if (mode === "replace") { store.put(value); return; }
          const existing = store.get(item.id);
          existing.onsuccess = () => {
            if (existing.result !== undefined) return;
            try { store.put(value); } catch { tx.abort(); }
          };
        });
      }
    });
  }

};

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}
