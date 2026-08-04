use dioxus::prelude::*;
use uuid::Uuid;

use crate::{
    bilibili, client,
    models::{
        ApiConfig, AppData, BiliVideo, Importance, Material, MaterialKind, ModuleStatus,
        StudyModule, StudyProject, WorkspaceTab,
    },
    storage,
};

const CSS: Asset = asset!("/assets/styles.css");
const STUDY_IMAGE: Asset = asset!("/assets/study-companion-evening.png");

#[component]
pub fn App() -> Element {
    let mut data = use_signal(AppData::default);
    use_effect(move || {
        let stored = storage::load();
        if stored.project.is_some() {
            data.set(stored);
        }
    });
    let has_project = data.read().project.is_some();

    rsx! {
        document::Title { "KaoBuddy 考研搭子" }
        document::Meta { name: "description", content: "把资料、计划、练习和 B 站课程放进同一个考研工作台。" }
        document::Meta { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" }
        document::Meta { name: "theme-color", content: "#17251f" }
        document::Meta { name: "color-scheme", content: "light dark" }
        document::Link { rel: "stylesheet", href: CSS }
        if cfg!(all(feature = "web", not(feature = "desktop"))) {
            document::Link { rel: "manifest", href: "/manifest.webmanifest" }
            document::Script { src: "/register-sw.js" }
        }
        if has_project {
            Workspace { data }
        } else {
            Onboarding { data }
        }
    }
}

#[component]
fn Onboarding(data: Signal<AppData>) -> Element {
    let mut subject = use_signal(String::new);
    let mut exam_date = use_signal(|| "2026-12-19".to_string());
    let mut daily_minutes = use_signal(|| "180".to_string());
    let mut target_score = use_signal(|| "380".to_string());
    let mut weak_points = use_signal(String::new);
    let mut error = use_signal(String::new);

    let create_project = move |event: FormEvent| {
        event.prevent_default();
        if subject.read().trim().is_empty() {
            error.set("先告诉我你要考什么专业或科目。".into());
            return;
        }
        let minutes = daily_minutes
            .read()
            .parse::<u32>()
            .unwrap_or(180)
            .clamp(10, 1440);
        let project = StudyProject {
            id: Uuid::new_v4().to_string(),
            subject: subject.read().trim().to_owned(),
            exam_date: exam_date.read().clone(),
            daily_minutes: minutes,
            target_score: target_score.read().trim().to_owned(),
            weak_points: weak_points.read().trim().to_owned(),
        };
        let mut next = data.read().clone();
        next.project = Some(project);
        next.modules = AppData::demo_modules();
        storage::save(&next);
        let mut data = data;
        data.set(next);
    };

    rsx! {
        main { class: "onboarding-shell",
            section { class: "onboarding-copy",
                div { class: "brand-lockup",
                    div { class: "brand-mark", "K" }
                    div {
                        strong { "KaoBuddy" }
                        span { "考研搭子" }
                    }
                }
                div { class: "onboarding-message",
                    p { class: "eyebrow", "今天先推进一小步" }
                    h1 { "把漫长的考研，过成每天都知道该做什么。" }
                    p { class: "lead", "资料、计划、课程和练习放在一起。KaoBuddy 不催你打卡，只陪你把下一件事做完。" }
                }
                div { class: "trust-note",
                    strong { "本地优先" }
                    span { "学习数据和 API Key 只保存在这台 Windows 电脑里。" }
                }
                img { class: "study-image", src: STUDY_IMAGE, alt: "夜晚在书桌前专注复习的学生" }
            }

            section { class: "setup-panel",
                div { class: "setup-heading",
                    span { "建立你的备考坐标" }
                    h2 { "先认识一下" }
                    p { "以后随时能修改。现在只填最影响计划的几项。" }
                }
                form { onsubmit: create_project,
                    label {
                        span { "报考专业或科目" }
                        input {
                            value: "{subject}",
                            placeholder: "例如：计算机 408 + 数学一",
                            oninput: move |event| subject.set(event.value()),
                            autofocus: true,
                        }
                    }
                    div { class: "form-grid",
                        label {
                            span { "考试日期" }
                            input { r#type: "date", value: "{exam_date}", oninput: move |event| exam_date.set(event.value()) }
                        }
                        label {
                            span { "每天可学习" }
                            div { class: "input-suffix",
                                input { r#type: "number", min: "10", max: "1440", value: "{daily_minutes}", oninput: move |event| daily_minutes.set(event.value()) }
                                span { "分钟" }
                            }
                        }
                    }
                    div { class: "form-grid",
                        label {
                            span { "目标分数" }
                            input { value: "{target_score}", placeholder: "例如：380", oninput: move |event| target_score.set(event.value()) }
                        }
                        label {
                            span { "目前最担心的部分" }
                            input { value: "{weak_points}", placeholder: "例如：数学进度慢", oninput: move |event| weak_points.set(event.value()) }
                        }
                    }
                    if !error.read().is_empty() {
                        p { class: "form-error", role: "alert", "{error}" }
                    }
                    button { class: "primary-action", r#type: "submit", "进入我的考研工作台" }
                    p { class: "form-helper", "创建后会生成一组示例任务，帮助你理解工作流。" }
                }
            }
        }
    }
}

#[component]
fn Workspace(data: Signal<AppData>) -> Element {
    let mut tab = use_signal(|| WorkspaceTab::Today);
    let mut notice = use_signal(String::new);
    let project = data.read().project.clone().expect("project checked by app");

    rsx! {
        div { class: "app-shell",
            aside { class: "sidebar",
                div { class: "sidebar-brand",
                    div { class: "brand-mark compact", "K" }
                    div { strong { "KaoBuddy" } span { "考研搭子" } }
                }
                nav { aria_label: "主要导航",
                    for item in WorkspaceTab::ALL {
                        button {
                            class: if *tab.read() == item { "nav-item active" } else { "nav-item" },
                            onclick: move |_| tab.set(item),
                            span { class: "nav-glyph", "{nav_glyph(item)}" }
                            span { "{item.label()}" }
                        }
                    }
                }
                div { class: "sidebar-bottom",
                    p { "目标" }
                    strong { "{project.subject}" }
                    span { "{project.days_left()} 天后上场" }
                }
            }

            main { class: "workspace",
                header { class: "topbar",
                    div {
                        p { class: "context-line", "{project.subject}" }
                        h1 { "{tab.read().label()}" }
                    }
                    div { class: "topbar-actions",
                        span { class: "local-badge", "本地已保存" }
                        button { class: "quiet-button", onclick: move |_| tab.set(WorkspaceTab::Settings), "AI 连接" }
                    }
                }

                if !notice.read().is_empty() {
                    div { class: "notice", role: "status",
                        span { "{notice}" }
                        button { aria_label: "关闭提示", onclick: move |_| notice.set(String::new()), "关闭" }
                    }
                }

                div { class: "page-stage",
                    match *tab.read() {
                        WorkspaceTab::Today => rsx! { TodayPage { data, on_navigate: move |next| tab.set(next) } },
                        WorkspaceTab::Plan => rsx! { PlanPage { data } },
                        WorkspaceTab::Materials => rsx! { MaterialsPage { data, notice } },
                        WorkspaceTab::Videos => rsx! { VideosPage { data, notice } },
                        WorkspaceTab::Mock => rsx! { MockPage { data, notice } },
                        WorkspaceTab::Review => rsx! { ReviewPage { data } },
                        WorkspaceTab::Settings => rsx! { SettingsPage { data, notice } },
                    }
                }
            }
        }
    }
}

fn nav_glyph(tab: WorkspaceTab) -> &'static str {
    match tab {
        WorkspaceTab::Today => "今",
        WorkspaceTab::Plan => "计",
        WorkspaceTab::Materials => "资",
        WorkspaceTab::Videos => "播",
        WorkspaceTab::Mock => "考",
        WorkspaceTab::Review => "复",
        WorkspaceTab::Settings => "设",
    }
}

#[component]
fn TodayPage(data: Signal<AppData>, on_navigate: EventHandler<WorkspaceTab>) -> Element {
    let project = data.read().project.clone().unwrap();
    let progress = data.read().progress();
    let today_minutes: u32 = data
        .read()
        .modules
        .iter()
        .filter(|module| module.status != ModuleStatus::Done)
        .map(|module| module.minutes)
        .sum();
    let focus = data
        .read()
        .modules
        .iter()
        .find(|module| module.status == ModuleStatus::Doing)
        .cloned()
        .or_else(|| data.read().modules.first().cloned());

    rsx! {
        section { class: "today-layout page-enter",
            div { class: "countdown-block",
                div {
                    p { "距离考试" }
                    strong { "{project.days_left()}" }
                    span { "天" }
                }
                p { "别盯着终点。今天的 {project.daily_minutes} 分钟，才是你真正能握住的进度。" }
            }

            div { class: "daily-summary",
                div { class: "progress-ring", style: "--progress: {progress}deg",
                    div { strong { "{progress}%" } span { "总进度" } }
                }
                div {
                    p { "今日安排" }
                    h2 { "{data.read().modules.len()} 个学习块，共 {today_minutes} 分钟" }
                    button { class: "text-action", onclick: move |_| on_navigate.call(WorkspaceTab::Plan), "查看完整计划" }
                }
            }

            section { class: "focus-block",
                p { class: "section-kicker", "现在只做这一件" }
                if let Some(module) = focus {
                    h2 { "{module.title}" }
                    p { "{module.detail}" }
                    div { class: "focus-meta",
                        span { "{module.minutes} 分钟" }
                        span { "{importance_label(module.importance)}" }
                    }
                    button {
                        class: "primary-action compact-action",
                        onclick: move |_| set_module_status(data, module.id.clone(), ModuleStatus::Done),
                        "完成这一块"
                    }
                } else {
                    EmptyState { title: "今天还没有学习块", body: "去学习计划里加一项具体任务，搭子就能陪你推进。" }
                }
            }

            section { class: "companion-note",
                div { class: "companion-avatar", "K" }
                div {
                    strong { "搭子提醒" }
                    p { "卡住时先缩小任务。把“复习一章”改成“做两道题并标出错因”，启动会容易很多。" }
                }
            }
        }
    }
}

#[component]
fn PlanPage(data: Signal<AppData>) -> Element {
    let mut new_title = use_signal(String::new);
    let mut ai_result = use_signal(String::new);
    let mut ai_loading = use_signal(|| false);
    let add_module = move |event: FormEvent| {
        event.prevent_default();
        let title = new_title.read().trim().to_owned();
        if title.is_empty() {
            return;
        }
        let mut next = data.read().clone();
        next.modules.push(StudyModule {
            id: Uuid::new_v4().to_string(),
            title,
            detail: "手动添加的学习块，可以从小任务开始。".into(),
            minutes: 40,
            status: ModuleStatus::Todo,
            importance: Importance::Medium,
        });
        storage::save(&next);
        let mut data = data;
        data.set(next);
        new_title.set(String::new());
    };

    rsx! {
        section { class: "page-enter plan-page",
            div { class: "page-intro",
                h2 { "把大目标拆成能完成的学习块" }
                p { "拖延通常不是不努力，而是下一步还不够具体。先把任务写到可以直接开始。" }
            }
            form { class: "quick-add", onsubmit: add_module,
                label { class: "sr-only", r#for: "new-module", "新的学习块" }
                input { id: "new-module", value: "{new_title}", placeholder: "例如：完成 2022 年英语一阅读第一篇", oninput: move |event| new_title.set(event.value()) }
                button { r#type: "submit", "加入计划" }
                button {
                    class: "secondary-action",
                    r#type: "button",
                    disabled: ai_loading(),
                    onclick: move |_| {
                        let snapshot = data.read().clone();
                        ai_loading.set(true);
                        spawn(async move {
                            let result = client::call_ai(
                                "/api/ai/plan",
                                &snapshot,
                                "请按优先级给出接下来两周可执行的考研学习计划。",
                            )
                            .await;
                            ai_result.set(result.unwrap_or_else(|error| format!("生成失败：{error}")));
                            ai_loading.set(false);
                        });
                    },
                    if ai_loading() { "正在生成" } else { "AI 拆计划" }
                }
            }

            if !ai_result().is_empty() {
                article { class: "ai-output", h3 { "搭子给出的计划" } pre { "{ai_result}" } }
            }

            div { class: "kanban-grid",
                ModuleColumn { title: "待学习", status: ModuleStatus::Todo, data }
                ModuleColumn { title: "进行中", status: ModuleStatus::Doing, data }
                ModuleColumn { title: "已完成", status: ModuleStatus::Done, data }
            }
        }
    }
}

#[component]
fn ModuleColumn(title: &'static str, status: ModuleStatus, data: Signal<AppData>) -> Element {
    let modules: Vec<StudyModule> = data
        .read()
        .modules
        .iter()
        .filter(|module| module.status == status)
        .cloned()
        .collect();
    rsx! {
        section { class: "module-column",
            header { h3 { "{title}" } span { "{modules.len()}" } }
            if modules.is_empty() {
                p { class: "column-empty", "这里暂时是空的。" }
            }
            for module in modules {
                ModuleCard { module, column_status: status, data }
            }
        }
    }
}

#[component]
fn ModuleCard(module: StudyModule, column_status: ModuleStatus, data: Signal<AppData>) -> Element {
    let start_id = module.id.clone();
    let done_id = module.id.clone();
    rsx! {
        article { class: "module-item",
            div { class: "module-topline",
                span { class: "importance {importance_class(module.importance)}", "{importance_label(module.importance)}" }
                span { "{module.minutes} 分钟" }
            }
            h4 { "{module.title}" }
            p { "{module.detail}" }
            div { class: "module-actions",
                if column_status != ModuleStatus::Doing {
                    button { class: "small-button", onclick: move |_| set_module_status(data, start_id.clone(), ModuleStatus::Doing), "开始" }
                }
                if column_status != ModuleStatus::Done {
                    button { class: "small-button secondary", onclick: move |_| set_module_status(data, done_id.clone(), ModuleStatus::Done), "完成" }
                }
            }
        }
    }
}

fn set_module_status(mut data: Signal<AppData>, id: String, status: ModuleStatus) {
    let mut next = data.read().clone();
    if status == ModuleStatus::Doing {
        for module in &mut next.modules {
            if module.status == ModuleStatus::Doing {
                module.status = ModuleStatus::Todo;
            }
        }
    }
    if let Some(module) = next.modules.iter_mut().find(|module| module.id == id) {
        module.status = status;
    }
    storage::save(&next);
    data.set(next);
}

#[component]
fn MaterialsPage(data: Signal<AppData>, notice: Signal<String>) -> Element {
    let mut title = use_signal(String::new);
    let mut content = use_signal(String::new);
    let add_material = move |event: FormEvent| {
        event.prevent_default();
        if content.read().trim().is_empty() {
            let mut notice = notice;
            notice.set("先粘贴一段资料内容。".into());
            return;
        }
        let material = Material {
            id: Uuid::new_v4().to_string(),
            title: if title.read().trim().is_empty() {
                "未命名笔记".into()
            } else {
                title.read().trim().into()
            },
            kind: MaterialKind::Text,
            content: content.read().trim().into(),
            source_url: None,
        };
        let mut next = data.read().clone();
        next.materials.push(material);
        storage::save(&next);
        let mut data = data;
        data.set(next);
        title.set(String::new());
        content.set(String::new());
        let mut notice = notice;
        notice.set("资料已保存到本地。".into());
    };

    rsx! {
        section { class: "page-enter materials-layout",
            div { class: "material-dropzone",
                div { class: "page-intro",
                    h2 { "把散落的资料收进来" }
                    p { "支持粘贴文字，也保留 PDF、DOCX、Markdown 和手写图片入口。文件内容只在本机解析。" }
                }
                div { class: "file-actions",
                    label { class: "file-button",
                        input {
                            r#type: "file",
                            multiple: true,
                            accept: ".pdf,.doc,.docx,.txt,.md,.rtf,image/*",
                            onchange: move |event| {
                                let files = event.files();
                                let mut data = data;
                                let mut notice = notice;
                                spawn(async move {
                                    if files.is_empty() {
                                        return;
                                    }
                                    let mut next = data.read().clone();
                                    for file in files {
                                        let name = file.name();
                                        let content = file
                                            .read_string()
                                            .await
                                            .unwrap_or_else(|_| "二进制资料已建立索引，解析结果会在生成时补充。".into());
                                        next.materials.push(Material {
                                            id: Uuid::new_v4().to_string(),
                                            title: name.clone(),
                                            kind: material_kind_from_name(&name),
                                            content,
                                            source_url: None,
                                        });
                                    }
                                    storage::save(&next);
                                    data.set(next);
                                    notice.set("本地文件已加入资料库。".into());
                                });
                            }
                        }
                        "选择本地文件"
                    }
                    span { "PDF / 文档 / 手写照片" }
                }
                form { class: "material-form", onsubmit: add_material,
                    label { span { "资料标题" } input { value: "{title}", placeholder: "例如：数据结构第 3 章", oninput: move |event| title.set(event.value()) } }
                    label { span { "正文或课堂笔记" } textarea { value: "{content}", placeholder: "粘贴内容后，后续可让 AI 拆知识点、讲解和出题。", oninput: move |event| content.set(event.value()) } }
                    button { r#type: "submit", "保存资料" }
                }
            }
            div { class: "material-library",
                header { h3 { "资料库" } span { "{data.read().materials.len()} 项" } }
                if data.read().materials.is_empty() {
                    EmptyState { title: "资料库还是空的", body: "先粘贴一小段课程笔记，之后再慢慢补齐。" }
                }
                for item in data.read().materials.clone() {
                    article { class: "library-row",
                        div { class: "material-kind", "{material_kind_label(item.kind)}" }
                        div { h4 { "{item.title}" } p { "{excerpt(&item.content, 80)}" } }
                    }
                }
            }
        }
    }
}

#[component]
fn VideosPage(data: Signal<AppData>, notice: Signal<String>) -> Element {
    let mut video_url = use_signal(String::new);
    let mut notes = use_signal(String::new);
    let mut selected = use_signal(|| data.read().videos.first().map(|video| video.id.clone()));
    let add_video = move |event: FormEvent| {
        event.prevent_default();
        let source_url = video_url.read().trim().to_owned();
        let Some(embed_url) = bilibili::embed_url(&source_url) else {
            let mut notice = notice;
            notice.set(
                "没有识别出 B 站 BV/AV 号，请检查链接。短链接可先在浏览器打开后复制完整地址。"
                    .into(),
            );
            return;
        };
        let video = BiliVideo {
            id: Uuid::new_v4().to_string(),
            title: format!("B 站课程 {}", extract_bvid(&source_url)),
            source_url,
            embed_url,
            description: "已加入视频自习室。可边看边整理知识点。".into(),
        };
        selected.set(Some(video.id.clone()));
        let mut next = data.read().clone();
        next.materials.push(Material {
            id: Uuid::new_v4().to_string(),
            title: video.title.clone(),
            kind: MaterialKind::Video,
            content: video.description.clone(),
            source_url: Some(video.source_url.clone()),
        });
        next.videos.push(video);
        storage::save(&next);
        let mut data = data;
        data.set(next);
        video_url.set(String::new());
        let mut notice = notice;
        notice.set("视频已加入自习室，同时保存为学习资料。".into());
    };
    let active_video = selected
        .read()
        .as_ref()
        .and_then(|id| {
            data.read()
                .videos
                .iter()
                .find(|video| &video.id == id)
                .cloned()
        })
        .or_else(|| data.read().videos.first().cloned());

    rsx! {
        section { class: "page-enter video-page",
            div { class: "video-heading",
                div { class: "page-intro",
                    h2 { "课程就在这里看，笔记也留在这里" }
                    p { "粘贴公开视频链接即可播放。KaoBuddy 不下载视频，播放能力由 B 站官方播放器提供。" }
                }
                form { class: "video-add", onsubmit: add_video,
                    label { class: "sr-only", r#for: "bili-url", "B 站视频链接" }
                    input { id: "bili-url", value: "{video_url}", placeholder: "https://www.bilibili.com/video/BV...", oninput: move |event| video_url.set(event.value()) }
                    button { r#type: "submit", "加入自习室" }
                }
            }

            if let Some(video) = active_video {
                div { class: "video-workspace",
                    div { class: "player-wrap",
                        iframe {
                            src: "{video.embed_url}",
                            title: "{video.title}",
                            allowfullscreen: true,
                            scrolling: "no",
                            frame_border: "0",
                            allow: "autoplay; fullscreen; picture-in-picture",
                        }
                    }
                    aside { class: "video-notes",
                        span { "正在学习" }
                        h3 { "{video.title}" }
                        p { "{video.description}" }
                        label {
                            span { "随手记" }
                            textarea {
                                value: "{notes}",
                                placeholder: "记下老师强调的考点、时间点和疑问。",
                                oninput: move |event| notes.set(event.value()),
                            }
                        }
                        button {
                            class: "secondary-action",
                            onclick: move |_| {
                                let content = notes.read().trim().to_owned();
                                if content.is_empty() {
                                    let mut notice = notice;
                                    notice.set("先记下一条课程笔记。".into());
                                    return;
                                }
                                let mut next = data.read().clone();
                                next.materials.push(Material {
                                    id: Uuid::new_v4().to_string(),
                                    title: format!("{} · 课程笔记", video.title),
                                    kind: MaterialKind::Text,
                                    content,
                                    source_url: Some(video.source_url.clone()),
                                });
                                storage::save(&next);
                                let mut data = data;
                                data.set(next);
                                notes.set(String::new());
                                let mut notice = notice;
                                notice.set("课程笔记已保存到资料库。".into());
                            },
                            "保存到资料库"
                        }
                    }
                }
                div { class: "video-list",
                    for item in data.read().videos.clone() {
                        button {
                            class: if selected.read().as_ref() == Some(&item.id) { "video-row active" } else { "video-row" },
                            onclick: move |_| selected.set(Some(item.id.clone())),
                            span { "播放" }
                            div { strong { "{item.title}" } small { "{item.source_url}" } }
                        }
                    }
                }
            } else {
                EmptyState { title: "自习室还没有课程", body: "从一条 B 站公开视频开始。加入后可以直接观看，也会进入资料库。" }
            }
        }
    }
}

#[component]
fn MockPage(data: Signal<AppData>, notice: Signal<String>) -> Element {
    let project = data.read().project.clone().unwrap();
    let mut paper = use_signal(String::new);
    let mut loading = use_signal(|| false);
    rsx! {
        section { class: "page-enter mock-layout",
            div { class: "mock-brief",
                p { class: "section-kicker", "模拟一次真实上场" }
                h2 { "{project.subject} 阶段模拟" }
                p { "AI 会严格根据资料库出题。可以自定义时长与题型，完成后逐题批改并收录错题。" }
                div { class: "mock-options",
                    label { span { "考试时长" } select { option { "60 分钟" } option { "90 分钟" } option { selected: true, "120 分钟" } option { "180 分钟" } } }
                    label { span { "题型偏好" } select { option { "综合" } option { "选择题优先" } option { "简答题优先" } option { "计算题优先" } } }
                }
                button {
                    class: "primary-action compact-action",
                    disabled: loading(),
                    onclick: move |_| {
                        let snapshot = data.read().clone();
                        if snapshot.api.api_key.trim().is_empty() {
                            let mut notice = notice;
                            notice.set("模拟卷生成需要先在 AI 设置中填写 API Key。".into());
                            return;
                        }
                        loading.set(true);
                        spawn(async move {
                            let result = client::call_ai(
                                "/api/ai/mock-exam",
                                &snapshot,
                                "生成一套 120 分钟综合模拟卷，题目和参考答案分区展示。",
                            )
                            .await;
                            paper.set(result.unwrap_or_else(|error| format!("生成失败：{error}")));
                            loading.set(false);
                        });
                    },
                    if loading() { "正在出卷" } else { "生成模拟卷" }
                }
            }
            div { class: "mock-side",
                h3 { "本次覆盖" }
                p { "已导入 {data.read().materials.len()} 份资料，当前计划包含 {data.read().modules.len()} 个知识模块。" }
                div { class: "coverage-list",
                    for module in data.read().modules.iter().take(4) {
                        div { span { "{importance_label(module.importance)}" } strong { "{module.title}" } }
                    }
                }
            }
            if !paper().is_empty() {
                article { class: "ai-output mock-paper", h3 { "阶段模拟卷" } pre { "{paper}" } }
            }
        }
    }
}

#[component]
fn ReviewPage(data: Signal<AppData>) -> Element {
    rsx! {
        section { class: "page-enter review-page",
            div { class: "page-intro",
                h2 { "错题不是失败记录，是下一轮提分路线" }
                p { "模拟考试和模块练习里答错或扣分的题会自动来到这里，也可以手动补充。" }
            }
            div { class: "review-switcher",
                button { class: "active", "错题本" }
                button { "临考速背" }
                button { "学习卡片" }
            }
            if data.read().mistakes.is_empty() {
                EmptyState { title: "还没有错题", body: "完成一次模块练习或模拟考试后，错题会自动归档并生成复习建议。" }
            }
        }
    }
}

#[component]
fn SettingsPage(data: Signal<AppData>, notice: Signal<String>) -> Element {
    let api = data.read().api.clone();
    let mut provider = use_signal(|| api.provider_name);
    let mut base_url = use_signal(|| api.base_url);
    let mut api_key = use_signal(|| api.api_key);
    let mut model = use_signal(|| api.model);
    let mut testing = use_signal(|| false);
    let save_api = move |event: FormEvent| {
        event.prevent_default();
        let mut next = data.read().clone();
        next.api = ApiConfig {
            provider_name: provider.read().trim().into(),
            base_url: base_url.read().trim().trim_end_matches('/').into(),
            api_key: api_key.read().trim().into(),
            model: model.read().trim().into(),
        };
        storage::save(&next);
        let mut data = data;
        data.set(next);
        let mut notice = notice;
        notice.set("AI 配置已保存在这台 Windows 电脑。".into());
    };
    rsx! {
        section { class: "page-enter settings-layout",
            div { class: "settings-copy",
                h2 { "连接你自己的 AI" }
                p { "支持 OpenAI-compatible 接口。原生 Rust 会直接请求你配置的服务商，不需要 KaoBuddy 后端。" }
                div { class: "privacy-callout",
                    strong { "使用建议" }
                    p { "如果模型不支持图片，请先用 PDF 文字层或粘贴文本。需要识别手写图片时选择支持视觉的模型。" }
                }
            }
            form { class: "settings-form", onsubmit: save_api,
                label { span { "服务商名称" } input { value: "{provider}", oninput: move |event| provider.set(event.value()) } }
                label { span { "API 地址" } input { value: "{base_url}", oninput: move |event| base_url.set(event.value()) } }
                label { span { "API Key" } input { r#type: "password", value: "{api_key}", placeholder: "sk-...", oninput: move |event| api_key.set(event.value()) } }
                label { span { "模型" } input { value: "{model}", oninput: move |event| model.set(event.value()) } }
                div { class: "settings-actions",
                    button { r#type: "submit", "保存配置" }
                    button {
                        class: "secondary-action",
                        r#type: "button",
                        disabled: testing(),
                        onclick: move |_| {
                            let mut snapshot = data.read().clone();
                            snapshot.api = ApiConfig {
                                provider_name: provider.read().trim().into(),
                                base_url: base_url.read().trim().trim_end_matches('/').into(),
                                api_key: api_key.read().trim().into(),
                                model: model.read().trim().into(),
                            };
                            if snapshot.api.api_key.is_empty() {
                                let mut notice = notice;
                                notice.set("先填写 API Key，再测试连接。".into());
                                return;
                            }
                            testing.set(true);
                            spawn(async move {
                                let result = client::call_ai("/api/ai/test", &snapshot, "测试连接").await;
                                let mut notice = notice;
                                notice.set(result.unwrap_or_else(|error| format!("连接失败：{error}")));
                                testing.set(false);
                            });
                        },
                        if testing() { "正在测试" } else { "测试连接" }
                    }
                }
            }
        }
    }
}

#[component]
fn EmptyState(title: &'static str, body: &'static str) -> Element {
    rsx! {
        div { class: "empty-state",
            div { class: "empty-mark", "K" }
            h3 { "{title}" }
            p { "{body}" }
        }
    }
}

fn importance_label(value: Importance) -> &'static str {
    match value {
        Importance::High => "高优先",
        Importance::Medium => "中优先",
        Importance::Low => "低优先",
    }
}

fn importance_class(value: Importance) -> &'static str {
    match value {
        Importance::High => "high",
        Importance::Medium => "medium",
        Importance::Low => "low",
    }
}

fn material_kind_label(value: MaterialKind) -> &'static str {
    match value {
        MaterialKind::Text => "文字",
        MaterialKind::File => "文件",
        MaterialKind::Handwriting => "手写",
        MaterialKind::Video => "视频",
        MaterialKind::Pdf => "PDF",
        MaterialKind::Markdown => "MD",
        MaterialKind::Document => "文档",
    }
}

fn material_kind_from_name(name: &str) -> MaterialKind {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".pdf") {
        MaterialKind::Pdf
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
        MaterialKind::Markdown
    } else if lower.ends_with(".doc") || lower.ends_with(".docx") || lower.ends_with(".rtf") {
        MaterialKind::Document
    } else if lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".webp")
    {
        MaterialKind::Handwriting
    } else {
        MaterialKind::File
    }
}

fn excerpt(value: &str, max_chars: usize) -> String {
    let text: String = value.chars().take(max_chars).collect();
    if value.chars().count() > max_chars {
        format!("{text}...")
    } else {
        text
    }
}

fn extract_bvid(value: &str) -> String {
    regex::Regex::new(r"(?i)(BV[0-9A-Za-z]{10})")
        .ok()
        .and_then(|pattern| pattern.captures(value))
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_owned())
        .unwrap_or_else(|| "课程".into())
}
