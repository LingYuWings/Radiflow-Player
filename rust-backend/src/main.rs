use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{ErrorKind, Read, Write},
    net::SocketAddr,
    path::{Path, PathBuf},
    process,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
    time::UNIX_EPOCH,
};

use axum::{
    Json, Router,
    extract::{Path as AxumPath, Query, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use clap::{Parser, ValueEnum};
use flate2::{Compression, read::GzDecoder, write::GzEncoder};
use lofty::{
    file::{AudioFile, TaggedFileExt},
    prelude::Accessor,
    probe::Probe,
};
use percent_encoding::percent_decode_str;
use reqwest::Client;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tower::ServiceExt;
use tower_http::services::ServeFile;

const AUDIO_EXTENSIONS: &[&str] = &[".mp3", ".wav", ".flac", ".m4a", ".ogg"];
const LIBRARY_CACHE_DIRECTORY_NAME: &str = "local";
const LIBRARY_CACHE_FILE_NAME: &str = "library-cache.json";
const LIBRARY_CACHE_COVER_BUNDLE_FILE_NAME: &str = "cover-cache.json.gz";
const LEGACY_LIBRARY_CACHE_IMAGE_DIRECTORY_NAME: &str = "image";
const LIBRARY_CACHE_VERSION: u32 = 1;
const LYRIC_CACHE_DIRECTORY_NAME: &str = "lyric";
const LYRIC_CACHE_INDEX_FILE_NAME: &str = "index.json";
const LYRIC_CACHE_VERSION: u32 = 1;
const LYRIC_CACHE_DB_FILE_NAME: &str = "lyrics.db";
const READY_PREFIX: &str = "RADIFLOW_BACKEND_READY ";
const ERROR_PREFIX: &str = "RADIFLOW_BACKEND_ERROR ";

type AppError = Box<dyn std::error::Error + Send + Sync>;
type AppResult<T> = Result<T, AppError>;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
enum ServerMode {
    Development,
    Production,
}

#[derive(Parser, Debug)]
#[command(author, version, about)]
struct Cli {
    #[arg(long, default_value_t = 3000)]
    port: u16,
    #[arg(long, default_value = "0.0.0.0")]
    host: String,
    #[arg(long, value_enum, default_value_t = ServerMode::Development)]
    mode: ServerMode,
    #[arg(long, default_value = ".")]
    static_root: PathBuf,
    #[arg(long, default_value = "music")]
    music_dir: PathBuf,
}

#[derive(Clone)]
struct AppState {
    client: Client,
    cover_bundle_cache: Arc<Mutex<HashMap<String, PersistedCoverBundle>>>,
    has_primed_library_cache: Arc<AtomicBool>,
    metadata_cache: Arc<Mutex<HashMap<String, LibrarySongPayload>>>,
    music_dir: Arc<RwLock<PathBuf>>,
}

#[derive(Debug)]
struct StartupError {
    code: &'static str,
    message: String,
}

impl std::fmt::Display for StartupError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for StartupError {}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct LibrarySongPayload {
    filename: String,
    #[serde(rename = "fileUrl")]
    file_url: String,
    title: String,
    artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PersistedLibraryCache {
    version: u32,
    folder: String,
    #[serde(rename = "generatedAt")]
    generated_at: String,
    songs: Vec<LibrarySongPayload>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PersistedCoverAsset {
    #[serde(rename = "mimeType")]
    mime_type: String,
    data: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PersistedCoverBundle {
    version: u32,
    folder: String,
    #[serde(rename = "generatedAt")]
    generated_at: String,
    assets: HashMap<String, PersistedCoverAsset>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct PersistedLyricData {
    #[serde(skip_serializing_if = "Option::is_none")]
    lrc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lyric: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tlyric: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trans: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    yrc: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PersistedLyricFile {
    version: u32,
    title: String,
    artist: String,
    #[serde(rename = "songId")]
    song_id: Option<String>,
    #[serde(rename = "savedAt")]
    saved_at: String,
    data: PersistedLyricData,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PersistedLyricIndexEntry {
    #[serde(rename = "cacheFile")]
    cache_file: String,
    title: String,
    artist: String,
    #[serde(rename = "savedAt")]
    saved_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PersistedLyricIndex {
    version: u32,
    folder: String,
    #[serde(rename = "generatedAt")]
    generated_at: String,
    entries: HashMap<String, PersistedLyricIndexEntry>,
}

#[derive(Debug)]
struct PersistedLyricDatabaseRow {
    title: String,
    artist: String,
    song_id: Option<String>,
    lrc: Option<String>,
    lyric: Option<String>,
    tlyric: Option<String>,
    trans: Option<String>,
    yrc: Option<String>,
    saved_at: String,
}

#[derive(Debug, Deserialize)]
struct RefreshLibraryQuery {
    refresh: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SetMusicDirPayload {
    path: String,
}

#[derive(Debug, Deserialize)]
struct LyricsQuery {
    title: Option<String>,
    artist: Option<String>,
    file: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearchProxyQuery {
    word: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LyricProxyQuery {
    id: Option<String>,
}

#[derive(Clone)]
struct LyricLookupAssociation {
    artist: String,
    file_url: Option<String>,
    title: String,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    if let Err(error) = run(cli).await {
        emit_startup_error(startup_error_code(error.as_ref()), &error.to_string());
        process::exit(1);
    }
}

async fn run(cli: Cli) -> AppResult<()> {
    ensure_directory(&cli.music_dir)?;

    let state = AppState {
        client: Client::builder().build()?,
        cover_bundle_cache: Arc::new(Mutex::new(HashMap::new())),
        has_primed_library_cache: Arc::new(AtomicBool::new(false)),
        metadata_cache: Arc::new(Mutex::new(HashMap::new())),
        music_dir: Arc::new(RwLock::new(cli.music_dir.clone())),
    };

    let router = build_router(state, cli.mode, cli.static_root.clone());
    let bind_address = format!("{}:{}", cli.host, cli.port);
    let listener = tokio::net::TcpListener::bind(&bind_address)
        .await
        .map_err(|error| startup_error_for_bind(&error))?;
    let bound_address = listener.local_addr()?;

    emit_ready(&cli.host, bound_address);
    axum::serve(listener, router).await?;
    Ok(())
}

fn build_router(state: AppState, mode: ServerMode, static_root: PathBuf) -> Router {
    let router = Router::new()
        .route("/api/music", get(get_music))
        .route("/api/settings/music-dir", get(get_music_dir).post(set_music_dir))
        .route("/api/library/cover/{cover_id}", get(get_cover))
        .route("/api/lyrics", get(get_lyrics))
        .route("/api/proxy/search", get(proxy_search))
        .route("/api/proxy/lyric", get(proxy_lyric))
        .route("/music/{*requested_path}", get(stream_music))
        .with_state(state);

    if mode == ServerMode::Production {
        let dist_root = Arc::new(static_root.join("dist"));
        router.fallback(move |request| serve_renderer_asset(request, dist_root.clone()))
    } else {
        router
    }
}

async fn get_music(
    State(state): State<AppState>,
    Query(query): Query<RefreshLibraryQuery>,
) -> Response {
    let music_dir = current_music_dir(&state);
    let should_force_refresh = is_refresh_requested(query.refresh.as_deref())
        || !state.has_primed_library_cache.load(Ordering::SeqCst);

    match get_library_payload(&state, &music_dir, should_force_refresh) {
        Ok(payload) => {
            state.has_primed_library_cache.store(true, Ordering::SeqCst);
            Json(json!({
                "folder": payload.folder,
                "songs": payload.songs,
            }))
            .into_response()
        }
        Err(_) => json_status_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list music files"),
    }
}

async fn set_music_dir(
    State(state): State<AppState>,
    Json(payload): Json<SetMusicDirPayload>,
) -> Response {
    let next_dir = PathBuf::from(payload.path.clone());
    if !next_dir.exists() {
        return json_status_error(StatusCode::BAD_REQUEST, "Invalid path");
    }

    {
        let mut music_dir = state.music_dir.write().expect("music dir lock poisoned");
        *music_dir = next_dir.clone();
    }
    state.has_primed_library_cache.store(false, Ordering::SeqCst);

    match get_library_payload(&state, &next_dir, true) {
        Ok(payload) => {
            state.has_primed_library_cache.store(true, Ordering::SeqCst);
            Json(json!({
                "success": true,
                "path": payload.folder,
                "songsCount": payload.songs.len(),
            }))
            .into_response()
        }
        Err(_) => json_status_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to refresh music cache"),
    }
}

async fn get_music_dir(State(state): State<AppState>) -> Response {
    Json(json!({
        "path": current_music_dir(&state).to_string_lossy(),
    }))
    .into_response()
}

async fn get_cover(
    State(state): State<AppState>,
    AxumPath(cover_id): AxumPath<String>,
) -> Response {
    let music_dir = current_music_dir(&state);
    let Some(cover_asset) = get_persisted_cover_bundle(&state, &music_dir)
        .and_then(|bundle| bundle.assets.get(&cover_id).cloned())
    else {
        return json_status_error(StatusCode::NOT_FOUND, "Cover not found");
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    if let Ok(content_type) = HeaderValue::from_str(&cover_asset.mime_type) {
        headers.insert(header::CONTENT_TYPE, content_type);
    }

    match BASE64.decode(cover_asset.data.as_bytes()) {
        Ok(bytes) => (headers, bytes).into_response(),
        Err(_) => json_status_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to read cover data"),
    }
}

async fn get_lyrics(
    State(state): State<AppState>,
    Query(query): Query<LyricsQuery>,
) -> Response {
    let title = query.title.unwrap_or_default().trim().to_string();
    let artist = query.artist.unwrap_or_default().trim().to_string();
    let file_url = query.file.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    let music_dir = current_music_dir(&state);
    let association = LyricLookupAssociation {
        artist: artist.clone(),
        file_url: file_url.clone(),
        title: title.clone(),
    };
    let manual_payload = get_manual_lyric_payload(&music_dir, file_url.as_deref());

    if title.is_empty() || artist.is_empty() {
        return json_code_error(StatusCode::BAD_REQUEST, 400, "Missing title or artist");
    }

    if let Some(cached_payload) = get_stored_lyric_payload(&music_dir, &association) {
        return Json(json!({
            "code": 200,
            "data": cached_payload.data,
            "source": "local",
        }))
        .into_response();
    }

    let search_url = format!(
        "https://api.vkeys.cn/v2/music/tencent/search/song?word={}",
        percent_encode_query(&format!("{} {}", title, artist)),
    );
    let search_response = match state.client.get(search_url).send().await {
        Ok(response) => response,
        Err(_) => {
            return fallback_manual_or_error(
                manual_payload.clone(),
                StatusCode::INTERNAL_SERVER_ERROR,
                500,
                "Failed to fetch lyrics",
            )
        }
    };
    let search_value = match search_response.json::<Value>().await {
        Ok(value) => value,
        Err(_) => {
            return fallback_manual_or_error(
                manual_payload.clone(),
                StatusCode::INTERNAL_SERVER_ERROR,
                500,
                "Failed to fetch lyrics",
            )
        }
    };

    let search_results = extract_search_results(&search_value);
    let Some(song_id) = extract_song_id(search_results.first()) else {
        return fallback_manual_or_error(
            manual_payload.clone(),
            StatusCode::NOT_FOUND,
            404,
            "Song not found in search results",
        );
    };

    let lyric_url = format!(
        "https://api.vkeys.cn/v2/music/tencent/lyric?id={}",
        percent_encode_query(&song_id),
    );
    let lyric_response = match state.client.get(lyric_url).send().await {
        Ok(response) => response,
        Err(_) => {
            return fallback_manual_or_error(
                manual_payload.clone(),
                StatusCode::INTERNAL_SERVER_ERROR,
                500,
                "Failed to fetch lyrics",
            )
        }
    };
    let lyric_value = match lyric_response.json::<Value>().await {
        Ok(value) => value,
        Err(_) => {
            return fallback_manual_or_error(
                manual_payload.clone(),
                StatusCode::INTERNAL_SERVER_ERROR,
                500,
                "Failed to fetch lyrics",
            )
        }
    };

    let lyric_payload = sanitize_lyric_payload(lyric_value.get("data"));
    if lyric_value.get("code").and_then(Value::as_i64) != Some(200) || !has_usable_lyrics(&lyric_payload)
    {
        return fallback_manual_or_error(
            manual_payload,
            StatusCode::NOT_FOUND,
            404,
            "Lyrics not found in API response",
        );
    }

    match persist_lyric_payload_to_database(&music_dir, &association, &lyric_payload, Some(song_id)) {
        Ok(payload) => Json(json!({
            "code": 200,
            "data": payload.data,
            "source": "remote",
        }))
        .into_response(),
        Err(_) => json_code_error(StatusCode::INTERNAL_SERVER_ERROR, 500, "Failed to cache lyrics"),
    }
}

async fn proxy_search(
    State(state): State<AppState>,
    Query(query): Query<SearchProxyQuery>,
) -> Response {
    let Some(word) = query.word.filter(|value| !value.trim().is_empty()) else {
        return json_status_error(StatusCode::BAD_REQUEST, "Missing word");
    };

    proxy_json(
        &state.client,
        &format!(
            "https://api.vkeys.cn/v2/music/tencent/search/song?word={}",
            percent_encode_query(word.trim()),
        ),
    )
    .await
}

async fn proxy_lyric(
    State(state): State<AppState>,
    Query(query): Query<LyricProxyQuery>,
) -> Response {
    let Some(id) = query.id.filter(|value| !value.trim().is_empty()) else {
        return json_status_error(StatusCode::BAD_REQUEST, "Missing id");
    };

    proxy_json(
        &state.client,
        &format!(
            "https://api.vkeys.cn/v2/music/tencent/lyric?id={}",
            percent_encode_query(id.trim()),
        ),
    )
    .await
}

async fn stream_music(
    State(state): State<AppState>,
    AxumPath(requested_path): AxumPath<String>,
    request: Request,
) -> Response {
    let music_dir = current_music_dir(&state);
    let Some(resolved_path) = resolve_music_file_path(&music_dir, &requested_path) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    match ServeFile::new(resolved_path).oneshot(request).await {
        Ok(response) => response.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn proxy_json(client: &Client, url: &str) -> Response {
    let response = match client.get(url).send().await {
        Ok(response) => response,
        Err(_) => return json_status_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch remote payload"),
    };
    let status = StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::OK);

    match response.json::<Value>().await {
        Ok(payload) => (status, Json(payload)).into_response(),
        Err(_) => json_status_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to decode remote payload"),
    }
}

async fn serve_renderer_asset(request: Request, dist_root: Arc<PathBuf>) -> Response {
    let request_path = request.uri().path().trim_start_matches('/');
    let index_path = dist_root.join("index.html");
    let asset_path = resolve_dist_asset_path(&dist_root, request_path).unwrap_or(index_path);

    match ServeFile::new(asset_path).oneshot(request).await {
        Ok(response) => response.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn fallback_manual_or_error(
    manual_payload: Option<PersistedLyricData>,
    status: StatusCode,
    code: u16,
    message: &str,
) -> Response {
    if let Some(payload) = manual_payload {
        return Json(json!({
            "code": 200,
            "data": payload,
            "source": "manual",
        }))
        .into_response();
    }

    json_code_error(status, code, message)
}

fn startup_error_for_bind(error: &std::io::Error) -> AppError {
    let code = if error.kind() == ErrorKind::AddrInUse {
        "EADDRINUSE"
    } else {
        "STARTUP_ERROR"
    };

    Box::new(StartupError {
        code,
        message: error.to_string(),
    })
}

fn startup_error_code(error: &(dyn std::error::Error + 'static)) -> &'static str {
    error
        .downcast_ref::<StartupError>()
        .map(|value| value.code)
        .unwrap_or("STARTUP_ERROR")
}

fn current_music_dir(state: &AppState) -> PathBuf {
    state.music_dir.read().expect("music dir lock poisoned").clone()
}

fn ensure_directory(path: &Path) -> AppResult<()> {
    fs::create_dir_all(path)?;
    Ok(())
}

fn is_refresh_requested(value: Option<&str>) -> bool {
    matches!(value, Some("1" | "true"))
}

fn json_status_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn json_code_error(status: StatusCode, code: u16, message: &str) -> Response {
    (status, Json(json!({ "code": code, "error": message }))).into_response()
}

fn now_iso_string() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn get_cache_key(file_path: &Path, metadata: &fs::Metadata) -> String {
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis())
        .unwrap_or_default();

    format!("{}|{}|{}", file_path.display(), modified_at, metadata.len())
}

fn get_library_cache_directory(music_dir: &Path) -> PathBuf {
    music_dir.join(LIBRARY_CACHE_DIRECTORY_NAME)
}

fn get_library_cache_file_path(music_dir: &Path) -> PathBuf {
    get_library_cache_directory(music_dir).join(LIBRARY_CACHE_FILE_NAME)
}

fn get_library_cover_bundle_file_path(music_dir: &Path) -> PathBuf {
    get_library_cache_directory(music_dir).join(LIBRARY_CACHE_COVER_BUNDLE_FILE_NAME)
}

fn get_lyric_cache_directory(music_dir: &Path) -> PathBuf {
    music_dir.join(LYRIC_CACHE_DIRECTORY_NAME)
}

fn get_lyric_cache_index_file_path(music_dir: &Path) -> PathBuf {
    get_lyric_cache_directory(music_dir).join(LYRIC_CACHE_INDEX_FILE_NAME)
}

fn get_lyric_cache_database_file_path(music_dir: &Path) -> PathBuf {
    get_lyric_cache_directory(music_dir).join(LYRIC_CACHE_DB_FILE_NAME)
}

fn normalize_lyric_lookup_part(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn resolve_lyric_file_name_from_url(file_url: Option<&str>) -> Option<String> {
    let suffix = file_url?.strip_prefix("/music/")?;
    percent_decode_str(suffix)
        .decode_utf8()
        .ok()
        .map(|value| value.into_owned())
}

fn get_lyric_association_keys(association: &LyricLookupAssociation) -> Vec<String> {
    let mut keys = HashSet::new();
    let normalized_title = normalize_lyric_lookup_part(&association.title);
    let normalized_artist = normalize_lyric_lookup_part(&association.artist);

    if !normalized_title.is_empty() && !normalized_artist.is_empty() {
        keys.insert(format!("track:{normalized_title}::{normalized_artist}"));
    }

    if let Some(file_name) = resolve_lyric_file_name_from_url(association.file_url.as_deref()) {
        keys.insert(format!("file:{}", file_name.to_lowercase()));
    }

    keys.into_iter().collect()
}

fn sanitize_lyric_payload(value: Option<&Value>) -> PersistedLyricData {
    let Some(candidate) = value.and_then(Value::as_object) else {
        return PersistedLyricData::default();
    };

    PersistedLyricData {
        lrc: candidate.get("lrc").and_then(Value::as_str).map(str::to_string),
        lyric: candidate.get("lyric").and_then(Value::as_str).map(str::to_string),
        tlyric: candidate.get("tlyric").and_then(Value::as_str).map(str::to_string),
        trans: candidate.get("trans").and_then(Value::as_str).map(str::to_string),
        yrc: candidate.get("yrc").and_then(Value::as_str).map(str::to_string),
    }
}

fn has_usable_lyrics(payload: &PersistedLyricData) -> bool {
    payload.yrc.as_deref().is_some_and(|value| !value.trim().is_empty())
        || payload.lrc.as_deref().is_some_and(|value| !value.trim().is_empty())
        || payload.lyric.as_deref().is_some_and(|value| !value.trim().is_empty())
}

fn get_manual_lyric_payload(music_dir: &Path, file_url: Option<&str>) -> Option<PersistedLyricData> {
    let music_file_name = resolve_lyric_file_name_from_url(file_url)?;
    let lyric_dir = get_lyric_cache_directory(music_dir);
    if !lyric_dir.exists() {
        return None;
    }

    let expected_base_name = Path::new(&music_file_name)
        .file_stem()?
        .to_string_lossy()
        .to_lowercase();

    for entry in fs::read_dir(lyric_dir).ok()?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(file_stem) = path.file_stem().map(|value| value.to_string_lossy().to_lowercase()) else {
            continue;
        };
        if file_stem != expected_base_name {
            continue;
        }

        let extension = path
            .extension()
            .map(|value| format!(".{}", value.to_string_lossy().to_lowercase()))
            .unwrap_or_default();
        if !matches!(extension.as_str(), ".lrc" | ".yrc" | ".txt") {
            continue;
        }

        let lyric_text = fs::read_to_string(path).ok()?.trim().to_string();
        if lyric_text.is_empty() {
            return None;
        }

        return if extension == ".yrc" {
            Some(PersistedLyricData {
                yrc: Some(lyric_text),
                ..PersistedLyricData::default()
            })
        } else {
            Some(PersistedLyricData {
                lrc: Some(lyric_text),
                ..PersistedLyricData::default()
            })
        };
    }

    None
}

fn get_lyric_database(music_dir: &Path) -> AppResult<Connection> {
    ensure_directory(&get_lyric_cache_directory(music_dir))?;
    let connection = Connection::open(get_lyric_cache_database_file_path(music_dir))?;
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS lyric_cache (
          association_key TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          artist TEXT NOT NULL,
          file_name TEXT,
          song_id TEXT,
          lrc TEXT,
          lyric TEXT,
          tlyric TEXT,
          trans TEXT,
          yrc TEXT,
          saved_at TEXT NOT NULL
        );
        ",
    )?;

    Ok(connection)
}

fn get_stored_lyric_payload(
    music_dir: &Path,
    association: &LyricLookupAssociation,
) -> Option<PersistedLyricFile> {
    if let Some(payload) = get_persisted_lyric_payload_from_database(music_dir, association) {
        return Some(payload);
    }

    let payload = get_persisted_lyric_payload(music_dir, association)?;
    let _ = persist_lyric_payload_to_database(
        music_dir,
        association,
        &payload.data,
        payload.song_id.clone(),
    );
    Some(payload)
}

fn get_persisted_lyric_payload_from_database(
    music_dir: &Path,
    association: &LyricLookupAssociation,
) -> Option<PersistedLyricFile> {
    let connection = get_lyric_database(music_dir).ok()?;
    let mut statement = connection
        .prepare(
            "
            SELECT title, artist, song_id, lrc, lyric, tlyric, trans, yrc, saved_at
            FROM lyric_cache
            WHERE association_key = ?
            LIMIT 1
            ",
        )
        .ok()?;

    for key in get_lyric_association_keys(association) {
        let row = statement
            .query_row([key.as_str()], |row| {
                Ok(PersistedLyricDatabaseRow {
                    title: row.get(0)?,
                    artist: row.get(1)?,
                    song_id: row.get(2)?,
                    lrc: row.get(3)?,
                    lyric: row.get(4)?,
                    tlyric: row.get(5)?,
                    trans: row.get(6)?,
                    yrc: row.get(7)?,
                    saved_at: row.get(8)?,
                })
            })
            .ok();

        let Some(row) = row else {
            continue;
        };
        let payload = PersistedLyricData {
            lrc: row.lrc.clone(),
            lyric: row.lyric.clone(),
            tlyric: row.tlyric.clone(),
            trans: row.trans.clone(),
            yrc: row.yrc.clone(),
        };
        if !has_usable_lyrics(&payload) {
            continue;
        }

        return Some(PersistedLyricFile {
            version: LYRIC_CACHE_VERSION,
            title: row.title,
            artist: row.artist,
            song_id: row.song_id,
            saved_at: row.saved_at,
            data: payload,
        });
    }

    None
}

fn persist_lyric_payload_to_database(
    music_dir: &Path,
    association: &LyricLookupAssociation,
    payload: &PersistedLyricData,
    song_id: Option<String>,
) -> AppResult<PersistedLyricFile> {
    let connection = get_lyric_database(music_dir)?;
    let file_name = resolve_lyric_file_name_from_url(association.file_url.as_deref());
    let saved_at = now_iso_string();
    let mut statement = connection.prepare(
        "
        INSERT INTO lyric_cache (
          association_key,
          title,
          artist,
          file_name,
          song_id,
          lrc,
          lyric,
          tlyric,
          trans,
          yrc,
          saved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(association_key) DO UPDATE SET
          title = excluded.title,
          artist = excluded.artist,
          file_name = excluded.file_name,
          song_id = excluded.song_id,
          lrc = excluded.lrc,
          lyric = excluded.lyric,
          tlyric = excluded.tlyric,
          trans = excluded.trans,
          yrc = excluded.yrc,
          saved_at = excluded.saved_at
        ",
    )?;

    for key in get_lyric_association_keys(association) {
        statement.execute(params![
            key,
            association.title,
            association.artist,
            file_name.clone(),
            song_id.clone(),
            payload.lrc.clone(),
            payload.lyric.clone(),
            payload.tlyric.clone(),
            payload.trans.clone(),
            payload.yrc.clone(),
            saved_at.clone(),
        ])?;
    }

    Ok(PersistedLyricFile {
        version: LYRIC_CACHE_VERSION,
        title: association.title.clone(),
        artist: association.artist.clone(),
        song_id,
        saved_at,
        data: payload.clone(),
    })
}

fn read_persisted_lyric_index(music_dir: &Path) -> Option<PersistedLyricIndex> {
    let raw_index = fs::read_to_string(get_lyric_cache_index_file_path(music_dir)).ok()?;
    let parsed: PersistedLyricIndex = serde_json::from_str(&raw_index).ok()?;

    if parsed.version != LYRIC_CACHE_VERSION || parsed.folder != music_dir.to_string_lossy() {
        return None;
    }

    Some(parsed)
}

fn read_persisted_lyric_file(music_dir: &Path, cache_file: &str) -> Option<PersistedLyricFile> {
    let raw_payload = fs::read_to_string(get_lyric_cache_directory(music_dir).join(cache_file)).ok()?;
    let parsed: PersistedLyricFile = serde_json::from_str(&raw_payload).ok()?;

    if parsed.version != LYRIC_CACHE_VERSION || !has_usable_lyrics(&parsed.data) {
        return None;
    }

    Some(parsed)
}

fn get_persisted_lyric_payload(
    music_dir: &Path,
    association: &LyricLookupAssociation,
) -> Option<PersistedLyricFile> {
    let lyric_index = read_persisted_lyric_index(music_dir)?;

    for key in get_lyric_association_keys(association) {
        let Some(entry) = lyric_index.entries.get(&key) else {
            continue;
        };
        if let Some(payload) = read_persisted_lyric_file(music_dir, &entry.cache_file) {
            return Some(payload);
        }
    }

    None
}

fn get_cover_file_extension(mime_type: Option<&str>) -> &'static str {
    let normalized = mime_type.unwrap_or_default().to_lowercase();
    if normalized.contains("jpeg") || normalized.contains("jpg") {
        return "jpg";
    }
    if normalized.contains("png") {
        return "png";
    }
    if normalized.contains("webp") {
        return "webp";
    }
    if normalized.contains("gif") {
        return "gif";
    }
    "bin"
}

fn get_cover_asset_id(data: &[u8], mime_type: Option<&str>) -> String {
    let mut hasher = Sha1::new();
    hasher.update(data);
    if let Some(mime_type) = mime_type {
        hasher.update(mime_type.as_bytes());
    }
    let digest = hasher.finalize();

    format!(
        "{:x}.{}",
        digest,
        get_cover_file_extension(mime_type),
    )
}

fn get_cover_asset_id_from_url(cover_url: Option<&str>) -> Option<String> {
    let last_segment = cover_url?.split('/').next_back()?;
    percent_decode_str(last_segment)
        .decode_utf8()
        .ok()
        .map(|value| value.into_owned())
}

fn get_cover_asset_url(asset_id: &str) -> String {
    format!("/api/library/cover/{}", percent_encode_path_segment(asset_id))
}

fn cleanup_legacy_cover_directory(music_dir: &Path) {
    let legacy_directory = get_library_cache_directory(music_dir).join(LEGACY_LIBRARY_CACHE_IMAGE_DIRECTORY_NAME);
    if legacy_directory.exists() {
        let _ = fs::remove_dir_all(legacy_directory);
    }
}

fn read_persisted_cover_bundle(music_dir: &Path) -> Option<PersistedCoverBundle> {
    let compressed_bundle = fs::read(get_library_cover_bundle_file_path(music_dir)).ok()?;
    let mut decoder = GzDecoder::new(&compressed_bundle[..]);
    let mut raw_bundle = String::new();
    decoder.read_to_string(&mut raw_bundle).ok()?;
    let parsed: PersistedCoverBundle = serde_json::from_str(&raw_bundle).ok()?;

    if parsed.version != LIBRARY_CACHE_VERSION || parsed.folder != music_dir.to_string_lossy() {
        return None;
    }

    Some(parsed)
}

fn get_persisted_cover_bundle(state: &AppState, music_dir: &Path) -> Option<PersistedCoverBundle> {
    let cache_key = music_dir.to_string_lossy().to_string();

    if let Some(bundle) = state
        .cover_bundle_cache
        .lock()
        .expect("cover bundle lock poisoned")
        .get(&cache_key)
        .cloned()
    {
        return Some(bundle);
    }

    let bundle = read_persisted_cover_bundle(music_dir)?;
    state
        .cover_bundle_cache
        .lock()
        .expect("cover bundle lock poisoned")
        .insert(cache_key, bundle.clone());
    Some(bundle)
}

fn persist_cover_bundle(
    state: &AppState,
    music_dir: &Path,
    cover_assets: HashMap<String, PersistedCoverAsset>,
) -> AppResult<PersistedCoverBundle> {
    ensure_directory(&get_library_cache_directory(music_dir))?;

    let payload = PersistedCoverBundle {
        version: LIBRARY_CACHE_VERSION,
        folder: music_dir.to_string_lossy().to_string(),
        generated_at: now_iso_string(),
        assets: cover_assets,
    };
    let bundle_file_path = get_library_cover_bundle_file_path(music_dir);
    let temp_bundle_file_path = bundle_file_path.with_extension("gz.tmp");

    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(serde_json::to_string(&payload)?.as_bytes())?;
    fs::write(&temp_bundle_file_path, encoder.finish()?)?;
    fs::rename(&temp_bundle_file_path, &bundle_file_path)?;

    state
        .cover_bundle_cache
        .lock()
        .expect("cover bundle lock poisoned")
        .insert(music_dir.to_string_lossy().to_string(), payload.clone());
    cleanup_legacy_cover_directory(music_dir);

    Ok(payload)
}

fn read_persisted_library_cache(music_dir: &Path) -> Option<PersistedLibraryCache> {
    let raw_cache = fs::read_to_string(get_library_cache_file_path(music_dir)).ok()?;
    let parsed: PersistedLibraryCache = serde_json::from_str(&raw_cache).ok()?;

    if parsed.version != LIBRARY_CACHE_VERSION || parsed.folder != music_dir.to_string_lossy() {
        return None;
    }

    Some(parsed)
}

fn persist_library_cache(
    music_dir: &Path,
    songs: Vec<LibrarySongPayload>,
) -> AppResult<PersistedLibraryCache> {
    ensure_directory(&get_library_cache_directory(music_dir))?;

    let payload = PersistedLibraryCache {
        version: LIBRARY_CACHE_VERSION,
        folder: music_dir.to_string_lossy().to_string(),
        generated_at: now_iso_string(),
        songs,
    };
    let cache_file_path = get_library_cache_file_path(music_dir);
    let temp_cache_file_path = cache_file_path.with_extension("json.tmp");
    fs::write(&temp_cache_file_path, serde_json::to_string(&payload)?)?;
    fs::rename(&temp_cache_file_path, &cache_file_path)?;

    Ok(payload)
}

fn read_library_songs(state: &AppState, music_dir: &Path) -> AppResult<Vec<LibrarySongPayload>> {
    let previous_cover_bundle = get_persisted_cover_bundle(state, music_dir);
    let mut next_cover_assets = HashMap::new();
    let mut files = Vec::new();

    for entry in fs::read_dir(music_dir)? {
        let entry = entry?;
        let full_path = entry.path();
        if !full_path.is_file() || !is_audio_file(&full_path) {
            continue;
        }

        files.push(full_path);
    }

    files.sort_by_key(|path| path.file_name().map(|value| value.to_os_string()));

    let mut songs = Vec::new();
    let mut active_files = HashSet::new();

    for full_path in files {
        let metadata = fs::metadata(&full_path)?;
        let cache_key = get_cache_key(&full_path, &metadata);
        let file_name = full_path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        active_files.insert(full_path.to_string_lossy().to_string());

        let cached_track = state
            .metadata_cache
            .lock()
            .expect("metadata cache lock poisoned")
            .get(&cache_key)
            .cloned();
        if let Some(track) = cached_track {
            if let Some(cover_asset_id) = get_cover_asset_id_from_url(track.cover.as_deref()) {
                if let Some(bundle) = &previous_cover_bundle {
                    if let Some(asset) = bundle.assets.get(&cover_asset_id) {
                        next_cover_assets.insert(cover_asset_id, asset.clone());
                    }
                }
            }

            songs.push(track);
            continue;
        }

        let payload = read_single_song_payload(&full_path, &file_name, &mut next_cover_assets);
        state
            .metadata_cache
            .lock()
            .expect("metadata cache lock poisoned")
            .insert(cache_key, payload.clone());
        songs.push(payload);
    }

    state
        .metadata_cache
        .lock()
        .expect("metadata cache lock poisoned")
        .retain(|cache_key, _| {
            let file_path = cache_key.split('|').next().unwrap_or_default();
            if !file_path.starts_with(&music_dir.to_string_lossy().to_string()) {
                return true;
            }

            active_files.contains(file_path)
        });

    let _ = persist_cover_bundle(state, music_dir, next_cover_assets)?;
    Ok(songs)
}

fn read_single_song_payload(
    full_path: &Path,
    file_name: &str,
    next_cover_assets: &mut HashMap<String, PersistedCoverAsset>,
) -> LibrarySongPayload {
    let title_fallback = strip_extension(file_name);
    let file_url = format!("/music/{}", percent_encode_path_segment(file_name));
    let tagged_file = match Probe::open(full_path).and_then(|probe| probe.read()) {
        Ok(tagged_file) => tagged_file,
        Err(_) => {
            return LibrarySongPayload {
                filename: file_name.to_string(),
                file_url,
                title: title_fallback,
                artist: "Unknown Artist".to_string(),
                album: None,
                cover: None,
                duration: None,
            };
        }
    };

    let properties = tagged_file.properties();
    let primary_tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
    let title = primary_tag
        .and_then(|tag| tag.title())
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| title_fallback.clone());
    let artist = primary_tag
        .and_then(|tag| tag.artist())
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Unknown Artist".to_string());
    let album = primary_tag
        .and_then(|tag| tag.album())
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty());
    let cover = primary_tag.and_then(|tag| tag.pictures().first()).map(|picture| {
        let mime_type = picture
            .mime_type()
            .map(ToString::to_string)
            .unwrap_or_else(|| "application/octet-stream".to_string());
        let asset_id = get_cover_asset_id(picture.data(), Some(&mime_type));
        next_cover_assets.entry(asset_id.clone()).or_insert_with(|| PersistedCoverAsset {
            mime_type,
            data: BASE64.encode(picture.data()),
        });
        get_cover_asset_url(&asset_id)
    });
    let duration = {
        let seconds = properties.duration().as_secs_f64();
        if seconds.is_finite() && seconds > 0.0 {
            Some(seconds)
        } else {
            None
        }
    };

    LibrarySongPayload {
        filename: file_name.to_string(),
        file_url,
        title,
        artist,
        album,
        cover,
        duration,
    }
}

fn get_library_payload(
    state: &AppState,
    music_dir: &Path,
    force_refresh: bool,
) -> AppResult<PersistedLibraryCache> {
    if !force_refresh {
        if let Some(payload) = read_persisted_library_cache(music_dir) {
            return Ok(payload);
        }
    }

    let songs = read_library_songs(state, music_dir)?;
    persist_library_cache(music_dir, songs)
}

fn extract_search_results(search_value: &Value) -> Vec<Value> {
    if search_value.get("code").and_then(Value::as_i64) != Some(200) {
        return Vec::new();
    }

    if let Some(array) = search_value.get("data").and_then(Value::as_array) {
        return array.clone();
    }

    search_value
        .get("data")
        .and_then(|value| value.get("list"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn extract_song_id(value: Option<&Value>) -> Option<String> {
    let candidate = value?.as_object()?;

    for key in ["id", "songid", "songmid"] {
        let Some(value) = candidate.get(key) else {
            continue;
        };

        if let Some(value) = value.as_str() {
            return Some(value.to_string());
        }
        if let Some(value) = value.as_i64() {
            return Some(value.to_string());
        }
        if let Some(value) = value.as_u64() {
            return Some(value.to_string());
        }
    }

    None
}

fn resolve_music_file_path(music_dir: &Path, requested_path: &str) -> Option<PathBuf> {
    let decoded_path = percent_decode_str(requested_path)
        .decode_utf8()
        .ok()?
        .into_owned();
    if decoded_path.is_empty()
        || decoded_path.contains('/')
        || decoded_path.contains('\\')
        || decoded_path.contains("..")
    {
        return None;
    }

    let candidate = music_dir.join(decoded_path);
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

fn resolve_dist_asset_path(dist_root: &Path, requested_path: &str) -> Option<PathBuf> {
    if requested_path.is_empty() {
      return None;
    }

    let decoded_path = percent_decode_str(requested_path)
        .decode_utf8()
        .ok()?
        .into_owned();
    let relative_path = Path::new(&decoded_path);

    if relative_path.components().any(|component| {
        matches!(
            component,
            std::path::Component::Prefix(_)
                | std::path::Component::RootDir
                | std::path::Component::ParentDir
        )
    }) {
        return None;
    }

    let candidate = dist_root.join(relative_path);
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

fn strip_extension(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.to_string())
}

fn is_audio_file(path: &Path) -> bool {
    let extension = path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy().to_lowercase()))
        .unwrap_or_default();

    AUDIO_EXTENSIONS.iter().any(|candidate| *candidate == extension)
}

fn percent_encode_path_segment(value: &str) -> String {
    value.bytes().fold(String::new(), |mut output, byte| {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(byte as char);
        } else {
            output.push_str(&format!("%{:02X}", byte));
        }
        output
    })
}

fn percent_encode_query(value: &str) -> String {
    percent_encode_path_segment(value)
}

fn emit_ready(host: &str, address: SocketAddr) {
    let resolved_host = if host == "0.0.0.0" { "127.0.0.1" } else { host };
    println!(
        "{}{}",
        READY_PREFIX,
        json!({
            "host": host,
            "port": address.port(),
            "url": format!("http://{}:{}", resolved_host, address.port()),
        })
    );
}

fn emit_startup_error(code: &str, message: &str) {
    eprintln!(
        "{}{}",
        ERROR_PREFIX,
        json!({
            "code": code,
            "message": message,
        })
    );
}