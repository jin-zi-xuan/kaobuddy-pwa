use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StudyProject {
    pub id: String,
    pub subject: String,
    pub exam_date: String,
    pub daily_minutes: u32,
    pub target_score: String,
    pub weak_points: String,
}

impl StudyProject {
    pub fn days_left(&self) -> i64 {
        let today = Local::now().date_naive();
        NaiveDate::parse_from_str(&self.exam_date, "%Y-%m-%d")
            .map(|date| (date - today).num_days().max(0))
            .unwrap_or_default()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StudyModule {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub minutes: u32,
    pub status: ModuleStatus,
    pub importance: Importance,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModuleStatus {
    Todo,
    Doing,
    Done,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Importance {
    High,
    Medium,
    Low,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Material {
    pub id: String,
    pub title: String,
    pub kind: MaterialKind,
    pub content: String,
    pub source_url: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MaterialKind {
    Text,
    File,
    Handwriting,
    Video,
    Pdf,
    Markdown,
    Document,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BiliVideo {
    pub id: String,
    pub title: String,
    pub source_url: String,
    pub embed_url: String,
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Mistake {
    pub id: String,
    pub question: String,
    pub reason: String,
    pub reviewed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ApiConfig {
    pub provider_name: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            provider_name: "DeepSeek".into(),
            base_url: "https://api.deepseek.com".into(),
            api_key: String::new(),
            model: "deepseek-chat".into(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct AppData {
    pub project: Option<StudyProject>,
    pub materials: Vec<Material>,
    pub modules: Vec<StudyModule>,
    pub videos: Vec<BiliVideo>,
    pub mistakes: Vec<Mistake>,
    pub api: ApiConfig,
}

impl AppData {
    pub fn demo_modules() -> Vec<StudyModule> {
        vec![
            StudyModule {
                id: Uuid::new_v4().to_string(),
                title: "英语阅读：主旨题定位".into(),
                detail: "完成一篇真题阅读，整理定位词和错误选项特征。".into(),
                minutes: 45,
                status: ModuleStatus::Doing,
                importance: Importance::High,
            },
            StudyModule {
                id: Uuid::new_v4().to_string(),
                title: "政治：马克思主义基本原理".into(),
                detail: "复盘唯物辩证法高频概念，补齐易混点。".into(),
                minutes: 35,
                status: ModuleStatus::Todo,
                importance: Importance::Medium,
            },
            StudyModule {
                id: Uuid::new_v4().to_string(),
                title: "专业课：核心章节复述".into(),
                detail: "不看资料口述章节结构，再检查遗漏。".into(),
                minutes: 50,
                status: ModuleStatus::Todo,
                importance: Importance::High,
            },
        ]
    }

    pub fn progress(&self) -> u32 {
        if self.modules.is_empty() {
            return 0;
        }
        let done = self
            .modules
            .iter()
            .filter(|module| module.status == ModuleStatus::Done)
            .count();
        ((done as f32 / self.modules.len() as f32) * 100.0).round() as u32
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WorkspaceTab {
    Today,
    Plan,
    Materials,
    Videos,
    Mock,
    Review,
    Settings,
}

impl WorkspaceTab {
    pub const ALL: [Self; 7] = [
        Self::Today,
        Self::Plan,
        Self::Materials,
        Self::Videos,
        Self::Mock,
        Self::Review,
        Self::Settings,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Today => "今天",
            Self::Plan => "学习计划",
            Self::Materials => "资料库",
            Self::Videos => "视频自习室",
            Self::Mock => "模拟考试",
            Self::Review => "错题与速背",
            Self::Settings => "AI 设置",
        }
    }
}
